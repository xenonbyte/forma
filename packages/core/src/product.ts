import { access } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { FormaError } from "./errors.js";
import { createId } from "./ids.js";
import type { Platform } from "./schemas.js";
import { platforms } from "./schemas.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

const styleConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  design_md_path: z.string().min(1),
  variables: z.record(z.string(), z.string())
});

const productIndexEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string()
});

const productIndexSchema = z.object({
  products: z.array(productIndexEntrySchema)
});

const productSchema = productIndexEntrySchema.extend({
  platform: z.enum(platforms).optional(),
  style: styleConfigSchema.optional(),
  components_initialized: z.boolean().optional()
});

const productConfigSchema = z.object({
  platform: z.enum(platforms),
  style: styleConfigSchema
});

export type ProductIndexEntry = z.infer<typeof productIndexEntrySchema>;
export type Product = z.infer<typeof productSchema>;
export type ProductConfig = {
  platform: Platform;
  style: z.infer<typeof styleConfigSchema>;
};

export interface ProductServiceOptions {
  home: string;
}

export class ProductService {
  private readonly dataDir: string;
  private readonly indexFile: string;

  constructor(options: ProductServiceOptions) {
    this.dataDir = join(options.home, "data");
    this.indexFile = join(this.dataDir, "products.yaml");
  }

  async createProduct(input: { name: string; description: string }): Promise<Product> {
    const product = productSchema.parse({
      id: createId("product"),
      name: input.name,
      description: input.description,
      components_initialized: false
    });
    const index = await this.readProductIndex();

    await writeYamlAtomic(this.indexFile, {
      products: [...index.products, productIndexEntrySchema.parse(product)]
    });
    await writeYamlAtomic(this.productFile(product.id), product);

    return product;
  }

  async initProductConfig(productId: string, config: ProductConfig): Promise<Product> {
    const product = await this.getProduct(productId);
    const next = productSchema.parse({
      ...product,
      ...productConfigSchema.parse(config)
    });

    await writeYamlAtomic(this.productFile(productId), next);
    return next;
  }

  async markComponentsInitialized(productId: string): Promise<Product> {
    const product = await this.getProduct(productId);
    const next = productSchema.parse({ ...product, components_initialized: true });

    await writeYamlAtomic(this.productFile(productId), next);
    return next;
  }

  async getProduct(productId: string): Promise<Product> {
    const file = this.productFile(productId);
    if (!(await fileExists(file))) {
      throw new FormaError("PRODUCT_NOT_FOUND", "Product not found", { product_id: productId });
    }

    return readYamlAs(file, productSchema);
  }

  async listProducts(): Promise<ProductIndexEntry[]> {
    return (await this.readProductIndex()).products;
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
