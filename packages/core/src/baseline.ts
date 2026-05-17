import { access } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ProductService } from "./product.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

export const baselinePageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  features: z.string(),
  copy: z.string(),
  fields: z.string(),
  interactions: z.string(),
  source_requirements: z.array(z.string().min(1))
});

export const baselineNavigationSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional()
});

export const baselineSchema = z.object({
  product_id: z.string().min(1),
  pages: z.array(baselinePageSchema),
  navigation: z.array(baselineNavigationSchema)
});

export type BaselinePage = z.infer<typeof baselinePageSchema>;
export type BaselineNavigation = z.infer<typeof baselineNavigationSchema>;
export type ProductBaseline = z.infer<typeof baselineSchema>;

export interface BaselineSourcePage {
  page_id: string;
  name: string;
  baseline_page: string;
  features?: string;
  copy?: string;
  fields?: string;
  interactions?: string;
  design_status?: string;
}

export interface BaselineServiceOptions {
  home: string;
  products: ProductService;
}

export class BaselineService {
  private readonly dataDir: string;
  private readonly products: ProductService;

  constructor(options: BaselineServiceOptions) {
    this.dataDir = join(options.home, "data");
    this.products = options.products;
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
    const current = await this.getProductBaseline(input.productId);
    const activePages = input.pages.filter((page) => page.design_status !== "expired");
    const activeBaselineIds = new Set(activePages.map((page) => page.baseline_page));
    const nextPagesById = new Map(current.pages.map((page) => [page.id, { ...page }]));

    for (const page of current.pages) {
      if (page.source_requirements.includes(input.requirementId) && !activeBaselineIds.has(page.id)) {
        nextPagesById.set(page.id, {
          ...page,
          source_requirements: page.source_requirements.filter((source) => source !== input.requirementId)
        });
      }
    }

    for (const page of activePages) {
      const existing = nextPagesById.get(page.baseline_page);
      nextPagesById.set(page.baseline_page, {
        id: page.baseline_page,
        name: page.name,
        features: page.features ?? "",
        copy: page.copy ?? "",
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
