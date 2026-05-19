import { access } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { copyItemSchema, type CopyItem } from "./copy.js";
import type { ProductService } from "./product.js";
import {
  defaultProductMutationWarningSink,
  getProductMutationLock,
  runProductMutationWithWarnings,
  type ProductMutationContext,
  type ProductMutationLock
} from "./product-mutation-lock.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

export const baselinePageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  features: z.string(),
  copy: z.array(z.lazy(() => copyItemSchema)),
  fields: z.string(),
  interactions: z.string(),
  source_requirements: z.array(z.string().min(1))
}).strict();

export const baselineNavigationSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional()
}).strict();

export const baselineSchema = z.object({
  product_id: z.string().min(1),
  pages: z.array(baselinePageSchema),
  navigation: z.array(baselineNavigationSchema)
}).strict();

export type BaselinePage = z.infer<typeof baselinePageSchema>;
export type BaselineNavigation = z.infer<typeof baselineNavigationSchema>;
export type ProductBaseline = z.infer<typeof baselineSchema>;

export interface BaselineSourcePage {
  page_id: string;
  name: string;
  baseline_page: string;
  features?: string;
  copy?: CopyItem[];
  fields?: string;
  interactions?: string;
  design_status?: string;
}

export interface BaselineServiceOptions {
  home: string;
  products: ProductService;
  productMutationLock?: ProductMutationLock;
  onProductMutationWarning?: (warning: string) => void;
}

export class BaselineService {
  private readonly dataDir: string;
  private readonly products: ProductService;
  private readonly productMutationLock: ProductMutationLock;
  private readonly onProductMutationWarning: (warning: string) => void;

  constructor(options: BaselineServiceOptions) {
    this.dataDir = join(options.home, "data");
    this.products = options.products;
    this.productMutationLock = options.productMutationLock ?? getProductMutationLock(options.home);
    this.onProductMutationWarning = options.onProductMutationWarning ?? defaultProductMutationWarningSink;
  }

  async getProductBaseline(productId: string): Promise<ProductBaseline> {
    await this.products.getProduct(productId);

    const file = this.baselineFile(productId);
    if (!(await fileExists(file))) {
      return emptyBaseline(productId);
    }

    return readYamlAs(file, baselineSchema);
  }

  async updateFromRequirement(input: {
    productId: string;
    requirementId: string;
    pages: BaselineSourcePage[];
    navigation: BaselineNavigation[];
  }): Promise<ProductBaseline> {
    return this.runProductMutation({ operation: "update_baseline", product_id: input.productId }, async () =>
      this.updateFromRequirementLocked(input)
    );
  }

  async updateFromRequirementLocked(input: {
    productId: string;
    requirementId: string;
    pages: BaselineSourcePage[];
    navigation: BaselineNavigation[];
  }): Promise<ProductBaseline> {
    const current = await this.getProductBaseline(input.productId);
    const sourcePages = input.pages;
    const sourceBaselineIds = new Set(sourcePages.map((page) => page.baseline_page));
    const nextPagesById = new Map(current.pages.map((page) => [page.id, { ...page }]));

    for (const page of current.pages) {
      if (page.source_requirements.includes(input.requirementId) && !sourceBaselineIds.has(page.id)) {
        nextPagesById.set(page.id, {
          ...page,
          source_requirements: page.source_requirements.filter((source) => source !== input.requirementId)
        });
      }
    }

    for (const page of sourcePages) {
      const existing = nextPagesById.get(page.baseline_page);
      nextPagesById.set(page.baseline_page, {
        id: page.baseline_page,
        name: page.name,
        features: page.features ?? "",
        copy: page.copy ?? [],
        fields: page.fields ?? "",
        interactions: page.interactions ?? "",
        source_requirements: dedupe([...(existing?.source_requirements ?? []), input.requirementId])
      });
    }

    const next = baselineSchema.parse({
      product_id: input.productId,
      pages: [...nextPagesById.values()].filter((page) => page.source_requirements.length > 0),
      navigation: input.navigation
    });

    await writeYamlAtomic(this.baselineFile(input.productId), next);
    return next;
  }

  private baselineFile(productId: string): string {
    return join(this.dataDir, productId, "baseline", "baseline.yaml");
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

function emptyBaseline(productId: string): ProductBaseline {
  return { product_id: productId, pages: [], navigation: [] };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
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
