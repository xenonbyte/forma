import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { FormaError } from "./errors.js";
import { createId } from "./ids.js";
import {
  defaultProductMutationWarningSink,
  getProductMutationLock,
  runProductMutationWithWarnings,
  type ProductMutationContext,
  type ProductMutationLock
} from "./product-mutation-lock.js";
import { languages, platforms } from "./schemas.js";
import { styleMetadataSchema } from "./styles.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

export const productIdSchema = z.string().regex(/^P-[a-f0-9]{6}$/);

const productIndexEntrySchema = z.object({
  id: productIdSchema,
  name: z.string().min(1),
  description: z.string()
});

const productIndexSchema = z.object({
  products: z.array(productIndexEntrySchema)
});

const productSchema = productIndexEntrySchema.extend({
  platform: z.enum(platforms).optional(),
  style: styleMetadataSchema.optional(),
  languages: z.array(z.enum(languages)).optional(),
  default_language: z.enum(languages).optional(),
  requirements: z.record(z.string(), z.object({
    latestArtifactId: z.string().optional()
  })).optional()
}).superRefine((product, context) => {
  const hasLanguages = product.languages !== undefined;
  const hasDefaultLanguage = product.default_language !== undefined;

  if (hasLanguages !== hasDefaultLanguage) {
    context.addIssue({
      code: "custom",
      message: "languages and default_language must be configured together",
      path: hasLanguages ? ["default_language"] : ["languages"]
    });
    return;
  }

  if (product.languages !== undefined && product.languages.length === 0) {
    context.addIssue({
      code: "custom",
      message: "languages must not be empty",
      path: ["languages"]
    });
  }

  if (
    product.languages !== undefined &&
    product.default_language !== undefined &&
    !product.languages.includes(product.default_language)
  ) {
    context.addIssue({
      code: "custom",
      message: "default_language must be included in languages",
      path: ["default_language"]
    });
  }
});

const productConfigSchema = z.object({
  platform: z.enum(platforms),
  style: styleMetadataSchema,
  languages: z.array(z.enum(languages)).min(1),
  default_language: z.enum(languages)
}).superRefine((config, context) => {
  if (!config.languages.includes(config.default_language)) {
    context.addIssue({
      code: "custom",
      message: "default_language must be included in languages",
      path: ["default_language"]
    });
  }
});

export type ProductIndexEntry = z.infer<typeof productIndexEntrySchema>;
export type Product = z.infer<typeof productSchema>;
export type ProductConfig = z.infer<typeof productConfigSchema>;
export type ProductConfigField = "platform" | "style" | "languages";
export type ProductRequirements = Record<string, { latestArtifactId?: string }>;

export interface ProductServiceOptions {
  home: string;
  productMutationLock?: ProductMutationLock;
  onProductMutationWarning?: (warning: string) => void;
}

export class ProductService {
  private readonly home: string;
  private readonly dataDir: string;
  private readonly indexFile: string;
  private readonly productMutationLock: ProductMutationLock;
  private readonly onProductMutationWarning: (warning: string) => void;

  constructor(options: ProductServiceOptions) {
    this.home = options.home;
    this.dataDir = join(options.home, "data");
    this.indexFile = join(this.dataDir, "products.yaml");
    this.productMutationLock = options.productMutationLock ?? getProductMutationLock(options.home);
    this.onProductMutationWarning = options.onProductMutationWarning ?? defaultProductMutationWarningSink;
  }

  async createProduct(input: { name: string; description: string }): Promise<Product> {
    return this.runProductMutation({ operation: "create_product" }, async () => this.createProductLocked(input));
  }

  async createProductLocked(input: { name: string; description: string }): Promise<Product> {
    const product = productSchema.parse({
      id: createId("product"),
      name: input.name,
      description: input.description
    });
    const index = await this.readProductIndex();

    await writeYamlAtomic(this.productFile(product.id), product);
    await writeYamlAtomic(this.indexFile, {
      products: [...index.products, productIndexEntrySchema.parse(product)]
    });

    return product;
  }

  async initProductConfig(productId: string, config: ProductConfig): Promise<Product> {
    return this.runProductMutation({ operation: "init_product_config", product_id: productId }, async () =>
      this.initProductConfigLocked(productId, config)
    );
  }

  async initProductConfigLocked(productId: string, config: ProductConfig): Promise<Product> {
    const product = await this.getProduct(productId);
    const next = productSchema.parse({
      ...product,
      ...productConfigSchema.parse(config)
    });

    await writeYamlAtomic(this.productFile(next.id), next);
    return next;
  }

  componentLibraryFile(productId: string): string {
    return join(this.home, "library", `${this.parseProductId(productId)}.lib.pen`);
  }

  async getProduct(productId: string): Promise<Product> {
    const parsedProductId = this.parseProductId(productId);
    const index = await this.readProductIndex();
    if (!index.products.some((product) => product.id === parsedProductId)) {
      throw new FormaError("PRODUCT_NOT_FOUND", "Product not found", { product_id: parsedProductId });
    }

    const file = this.productFile(parsedProductId);
    if (!(await fileExists(file))) {
      throw new FormaError("PRODUCT_NOT_FOUND", "Product not found", { product_id: parsedProductId });
    }

    return readYamlAs(file, productSchema);
  }

  async listProducts(): Promise<ProductIndexEntry[]> {
    return (await this.readProductIndex()).products;
  }

  async setRequirementArtifactPointerLocked(
    productId: string,
    requirementId: string,
    artifactId: string
  ): Promise<string | undefined> {
    const product = await this.getProduct(productId);
    const requirements = product.requirements ?? {};
    const previous = requirements[requirementId]?.latestArtifactId;
    const updatedRequirements = {
      ...requirements,
      [requirementId]: { latestArtifactId: artifactId }
    };
    const updated = productSchema.parse({ ...product, requirements: updatedRequirements });
    await writeYamlAtomic(this.productFile(productId), updated);
    return previous;
  }

  private async readProductIndex(): Promise<z.infer<typeof productIndexSchema>> {
    if (!(await fileExists(this.indexFile))) {
      return { products: [] };
    }

    return readYamlAs(this.indexFile, productIndexSchema);
  }

  private productFile(productId: string): string {
    return join(this.dataDir, productId, "product.yaml");
  }

  private parseProductId(productId: string): string {
    const parsed = productIdSchema.safeParse(productId);
    if (!parsed.success) {
      throw new FormaError("PRODUCT_NOT_FOUND", "Product not found", { product_id: productId });
    }

    return parsed.data;
  }

  private async runProductMutation<T>(
    input: { operation: string; product_id?: string },
    fn: (context: ProductMutationContext) => Promise<T>
  ): Promise<T> {
    return runProductMutationWithWarnings(
      this.productMutationLock,
      input,
      fn,
      this.onProductMutationWarning
    );
  }
}

export async function assertValidComponentLibrary(file: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new FormaError("INVALID_INPUT", "Component library is invalid", {
      file,
      cause: error instanceof Error ? error.message : String(error)
    });
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.children) || parsed.children.length === 0 || containsTruncationMarker(parsed)) {
    throw new FormaError("INVALID_INPUT", "Component library is invalid", { file });
  }
}

export function assertProductConfig(product: unknown, productId: string, fields: ProductConfigField[]): void {
  const missing = fields.filter((field) => isProductConfigFieldIncomplete(product, field));

  if (missing.length > 0) {
    throw new FormaError("PRODUCT_CONFIG_INCOMPLETE", "Product config incomplete", {
      product_id: productId,
      missing
    });
  }
}

function isProductConfigFieldIncomplete(product: unknown, field: ProductConfigField): boolean {
  if (!isRecord(product)) {
    return true;
  }

  switch (field) {
    case "platform":
      return product.platform === undefined;
    case "style":
      return product.style === undefined;
    case "languages":
      return (
        !Array.isArray(product.languages) ||
        product.languages.length === 0 ||
        typeof product.default_language !== "string" ||
        !product.languages.includes(product.default_language)
      );
  }
}

function containsTruncationMarker(value: unknown): boolean {
  if (value === "...") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(containsTruncationMarker);
  }
  if (isRecord(value)) {
    return Object.values(value).some(containsTruncationMarker);
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
