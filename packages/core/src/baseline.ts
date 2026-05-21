import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { copyItemSchema, type CopyItem } from "./copy.js";
import { FormaError } from "./errors.js";
import type { ProductService } from "./product.js";
import {
  defaultProductMutationWarningSink,
  getProductMutationLock,
  runProductMutationWithWarnings,
  type ProductMutationContext,
  type ProductMutationLock
} from "./product-mutation-lock.js";
import {
  buildBaselineSemanticContractCandidate,
  type SemanticContract,
  type SemanticContractAction,
  type SemanticContractField
} from "./semantic-contract.js";
import { semanticContractCoverageSchema, semanticContractSchema } from "./semantic-contract-schema.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

export const baselinePageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  features: z.string(),
  copy: z.array(z.lazy(() => copyItemSchema)),
  fields: z.string(),
  interactions: z.string(),
  source_requirements: z.array(z.string().min(1)),
  semantic_contract: semanticContractSchema,
  semantic_contract_coverage: semanticContractCoverageSchema.optional()
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

const activeRequirementSourceSchema = z.object({
  id: z.string().min(1),
  product_id: z.string().min(1),
  status: z.string(),
  updated_at: z.string().optional(),
  created_at: z.string().optional(),
  pages: z.array(z.object({
    page_id: z.string().min(1),
    name: z.string().min(1),
    baseline_page: z.string().min(1),
    features: z.string().optional(),
    copy: z.array(z.lazy(() => copyItemSchema)).optional(),
    fields: z.string().optional(),
    interactions: z.string().optional(),
    design_status: z.string().optional(),
    semantic_contract: semanticContractSchema,
    semantic_contract_coverage: semanticContractCoverageSchema.optional(),
    declared_fields: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) }).strict()).optional(),
    declared_actions: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) }).strict()).optional(),
    declared_component_keys: z.array(z.string().min(1)).optional()
  }).passthrough()),
  navigation: z.array(baselineNavigationSchema).optional()
}).passthrough();

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
  semantic_contract?: SemanticContract;
  semantic_contract_coverage?: "explicit" | "minimal";
  declared_fields?: SemanticContractField[];
  declared_actions?: SemanticContractAction[];
  declared_component_keys?: string[];
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
    await this.getProductBaseline(input.productId);
    const activeSources = await this.readActiveRequirementSources(input.productId);
    if (input.pages.length > 0) {
      activeSources.set(input.requirementId, {
        id: input.requirementId,
        updated_at: new Date().toISOString(),
        pages: input.pages,
        navigation: input.navigation
      });
    } else {
      activeSources.delete(input.requirementId);
    }

    const pagesByBaseline = new Map<string, Array<{
      requirement_id: string;
      updated_at?: string;
      page: BaselineSourcePage;
    }>>();
    for (const source of activeSources.values()) {
      for (const page of source.pages) {
        const pages = pagesByBaseline.get(page.baseline_page) ?? [];
        pages.push({ requirement_id: source.id, updated_at: source.updated_at, page });
        pagesByBaseline.set(page.baseline_page, pages);
      }
    }

    const nextPages: BaselinePage[] = [];
    for (const [baselinePageId, sources] of [...pagesByBaseline.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const orderedSources = sources.sort(compareBaselineSourcesNewestFirst);
      const display = orderedSources[0]!.page;
      const sourceContracts = orderedSources.flatMap((source) => source.page.semantic_contract ? [{
        source_requirement: source.requirement_id,
        page_id: source.page.page_id,
        semantic_contract: source.page.semantic_contract
      }] : []);
      const built = buildBaselineSemanticContractCandidate({
        product_id: input.productId,
        pages: [
          {
            id: baselinePageId,
            name: display.name,
            copy: display.copy ?? [],
            semantic_contract: undefined,
            declared_fields: display.declared_fields,
            declared_actions: display.declared_actions,
            declared_component_keys: display.declared_component_keys,
            source_semantic_contracts: sourceContracts
          }
        ],
        navigation: [...activeSources.values()].flatMap((source) => source.navigation)
      });
      if (!built.ok) {
        throw new FormaError("BASELINE_SEMANTIC_CONTRACT_CONFLICT", "Baseline semantic contract conflict", {
          product_id: input.productId,
          baseline_page: baselinePageId,
          conflicts: built.conflicts
        });
      }
      const semantic = built.pages[0];
      nextPages.push({
        id: baselinePageId,
        name: display.name,
        features: display.features ?? "",
        copy: display.copy ?? [],
        fields: display.fields ?? "",
        interactions: display.interactions ?? "",
        source_requirements: orderedSources.map((source) => source.requirement_id),
        semantic_contract: semantic?.semantic_contract,
        semantic_contract_coverage: semantic?.semantic_contract_coverage
      });
    }

    const next = baselineSchema.parse({
      product_id: input.productId,
      pages: nextPages,
      navigation: [...activeSources.values()].flatMap((source) => source.navigation)
    });

    await writeYamlAtomic(this.baselineFile(input.productId), next);
    return next;
  }

  private baselineFile(productId: string): string {
    return join(this.dataDir, productId, "baseline", "baseline.yaml");
  }

  private async readActiveRequirementSources(productId: string): Promise<Map<string, {
    id: string;
    updated_at?: string;
    pages: BaselineSourcePage[];
    navigation: BaselineNavigation[];
  }>> {
    const productDir = join(this.dataDir, productId);
    if (!(await fileExists(productDir))) {
      return new Map();
    }
    const entries = await readdir(productDir, { withFileTypes: true });
    const sources = new Map<string, { id: string; updated_at?: string; pages: BaselineSourcePage[]; navigation: BaselineNavigation[] }>();
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^R-[a-f0-9]{8}$/.test(entry.name)) {
        continue;
      }
      const requirement = await readYamlAs(join(productDir, entry.name, "requirement.yaml"), activeRequirementSourceSchema);
      if (requirement.product_id !== productId || requirement.status === "archived" || requirement.status === "empty") {
        continue;
      }
      sources.set(requirement.id, {
        id: requirement.id,
        updated_at: requirement.updated_at ?? requirement.created_at,
        pages: requirement.pages,
        navigation: requirement.navigation ?? []
      });
    }
    return sources;
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

function compareBaselineSourcesNewestFirst(
  left: { requirement_id: string; updated_at?: string },
  right: { requirement_id: string; updated_at?: string }
): number {
  return timestamp(right.updated_at) - timestamp(left.updated_at) || right.requirement_id.localeCompare(left.requirement_id);
}

function timestamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
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
