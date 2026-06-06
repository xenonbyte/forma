import { randomBytes } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { copyItemSchema, type CopyByPage, type CopyService, type PageTranslation } from "./copy.js";
import { FormaError } from "./errors.js";
import { createId } from "./ids.js";
import type { ProductService } from "./product.js";
import {
  defaultProductMutationWarningSink,
  getProductMutationLock,
  runProductMutationWithWarnings,
  type ProductMutationContext,
  type ProductMutationLock,
} from "./product-mutation-lock.js";
import { requirementStatuses } from "./schemas.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

// Minimal stubs for deleted Pencil-era schemas — replaced in v8 artifact model
const designStatuses = ["pending", "done", "expired"] as const;
const semanticContractItemSchema = z.object({ key: z.string().min(1), label: z.string().min(1) }).strict();
const semanticContractSchema = z
  .object({
    actions: z.array(semanticContractItemSchema),
    allowed_copy: z.array(z.string()),
    component_keys: z.array(z.string().min(1)),
    fields: z.array(semanticContractItemSchema),
    navigation: z.array(z.object({ target_page_id: z.string().min(1), label: z.string().optional() }).strict()),
  })
  .strict();
const semanticContractCoverageSchema = z.enum(["explicit", "minimal"]);
export const baselineNavigationSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().optional(),
  })
  .passthrough();
function buildSemanticContractForPage(input: {
  page: {
    semantic_contract?: unknown;
    semantic_contract_coverage?: unknown;
    copy?: Array<{ text?: string }>;
    declared_actions?: z.infer<typeof semanticContractItemSchema>[];
    declared_component_keys?: string[];
    declared_fields?: z.infer<typeof semanticContractItemSchema>[];
  };
}): { semantic_contract: z.infer<typeof semanticContractSchema>; semantic_contract_coverage: "explicit" | "minimal" } {
  if (input.page.semantic_contract !== undefined) {
    return {
      semantic_contract: semanticContractSchema.parse(input.page.semantic_contract),
      semantic_contract_coverage:
        input.page.semantic_contract_coverage === undefined
          ? "explicit"
          : semanticContractCoverageSchema.parse(input.page.semantic_contract_coverage),
    };
  }

  return {
    semantic_contract: semanticContractSchema.parse({
      actions: input.page.declared_actions ?? [],
      allowed_copy: uniqueStrings((input.page.copy ?? []).map((item) => item.text)),
      component_keys: input.page.declared_component_keys ?? [],
      fields: input.page.declared_fields ?? [],
      navigation: [],
    }),
    semantic_contract_coverage: "minimal",
  };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))];
}

export const requirementIdSchema = z.string().regex(/^R-[a-f0-9]{8}$/);

const forbiddenPersistedField = z
  .unknown()
  .optional()
  .superRefine((value, context) => {
    if (value !== undefined) {
      context.addIssue({ code: "custom", message: "field is not supported in v6 runtime schema" });
    }
  });
const forbiddenDesignIdField = z
  .string()
  .optional()
  .superRefine((value, context) => {
    if (value !== undefined) {
      context.addIssue({ code: "custom", message: "design_id is not supported in v6 runtime schema" });
    }
  });

export const requirementPageSchema = z
  .object({
    page_id: z.string().min(1),
    name: z.string().min(1),
    baseline_page: z.string().min(1),
    design_status: z.enum(designStatuses),
    design_id: forbiddenDesignIdField,
    design_metadata: forbiddenPersistedField,
    pen_path: forbiddenPersistedField,
    preview_path: forbiddenPersistedField,
    preview_file: forbiddenPersistedField,
    preview_url: forbiddenPersistedField,
    change_type: z.enum(["new", "patch", "rebuild"]).optional(),
    change_summary: z.string().optional(),
    features: z.string().optional(),
    copy: z.array(z.lazy(() => copyItemSchema)).optional(),
    fields: z.string().optional(),
    interactions: z.string().optional(),
    declared_fields: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) }).strict()).optional(),
    declared_actions: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) }).strict()).optional(),
    declared_component_keys: z.array(z.string().min(1)).optional(),
    semantic_contract: semanticContractSchema,
    semantic_contract_coverage: semanticContractCoverageSchema,
  })
  .strict();

export const requirementSchema = z
  .object({
    id: requirementIdSchema,
    product_id: z.string().regex(/^P-[a-f0-9]{6}$/),
    title: z.string().min(1),
    status: z.enum(requirementStatuses),
    ui_affected: z.boolean().default(true),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    pages: z.array(requirementPageSchema),
    navigation: z.array(z.lazy(() => baselineNavigationSchema)),
  })
  .strict();

const requirementPageInputSchema = z
  .object({
    page_id: z.string().min(1),
    name: z.string().min(1),
    baseline_page: z.string().min(1),
    features: z.string().optional(),
    copy: z.array(z.lazy(() => copyItemSchema)).optional(),
    fields: z.string().optional(),
    interactions: z.string().optional(),
    declared_fields: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) }).strict()).optional(),
    declared_actions: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) }).strict()).optional(),
    declared_component_keys: z.array(z.string().min(1)).optional(),
    semantic_contract: semanticContractSchema.optional(),
    semantic_contract_coverage: semanticContractCoverageSchema.optional(),
    change_type: z.enum(["new", "patch", "rebuild"]),
    change_summary: z.string().optional(),
  })
  .strict();

const ruleInputSchema = z
  .object({
    id: z.string().min(1),
    page_id: z.string().min(1).optional(),
    given: z.string().min(1),
    when: z.string().min(1),
    then: z.string().min(1),
    semantic: z
      .object({
        fields: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) }).strict()).optional(),
        actions: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) }).strict()).optional(),
        component_keys: z.array(z.string().min(1)).optional(),
        allowed_copy: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    replaces_rule_id: z.string().optional(),
  })
  .strict();

const storedRuleSchema = ruleInputSchema
  .omit({ replaces_rule_id: true })
  .extend({
    source_requirement: requirementIdSchema,
  })
  .strict();

const rulesFileSchema = z
  .object({
    rules: z.array(storedRuleSchema),
  })
  .strict();

const translationEntryInputSchema = z
  .object({
    context: z.string().min(1),
    texts: z.record(z.string(), z.string()),
    outdated: z.boolean().optional(),
  })
  .strict();

const pageTranslationInputSchema = z
  .object({
    page_id: z.string().min(1),
    entries: z.array(translationEntryInputSchema),
  })
  .strict();

const saveRequirementInputSchema = z
  .object({
    requirement_id: requirementIdSchema,
    document_md: z.string(),
    ui_affected: z.boolean().default(true),
    pages: z.array(requirementPageInputSchema).default([]),
    navigation: z.array(z.lazy(() => baselineNavigationSchema)).default([]),
    translations: z.array(pageTranslationInputSchema).default([]),
    rules: z.array(ruleInputSchema).default([]),
    remove_rule_ids: z.array(z.string().min(1)).default([]),
    remove_page_ids: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type RequirementPage = z.infer<typeof requirementPageSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type RequirementWithDocument = Requirement & { document_md: string };
export type StoredRule = z.infer<typeof storedRuleSchema>;
export type SaveRequirementInput = z.input<typeof saveRequirementInputSchema>;

type ParsedSaveRequirementInput = z.infer<typeof saveRequirementInputSchema>;

export interface SubmitRequirementInput {
  requirement_id: string;
  document_md: string;
  pages: Array<{
    page_id: string;
    name: string;
    baseline_page: string;
    design_status?: RequirementPage["design_status"];
    change_type?: RequirementPage["change_type"];
    change_summary?: string;
    features?: string;
    copy?: RequirementPage["copy"];
    fields?: string;
    interactions?: string;
    declared_fields?: RequirementPage["declared_fields"];
    declared_actions?: RequirementPage["declared_actions"];
    declared_component_keys?: RequirementPage["declared_component_keys"];
    semantic_contract?: RequirementPage["semantic_contract"];
    semantic_contract_coverage?: RequirementPage["semantic_contract_coverage"];
  }>;
  navigation: z.infer<typeof baselineNavigationSchema>[];
}

export interface UpdateRequirementInput extends SubmitRequirementInput {
  expired_pages: string[];
}

export interface RequirementServiceOptions {
  home: string;
  products: ProductService;
  copy: CopyService;
  productMutationLock?: ProductMutationLock;
  onProductMutationWarning?: (warning: string) => void;
}

interface RequirementServiceTestHooks {
  afterTranslationsWrite?(): Promise<void> | void;
  afterDocumentWrite?(): Promise<void> | void;
  afterRulesWrite?(): Promise<void> | void;
}

export class RequirementService {
  private readonly dataDir: string;
  private readonly products: ProductService;
  private readonly copy: CopyService;
  private readonly productMutationLock: ProductMutationLock;
  private readonly onProductMutationWarning: (warning: string) => void;
  private testHooks: RequirementServiceTestHooks;

  constructor(options: RequirementServiceOptions) {
    this.dataDir = join(options.home, "data");
    this.products = options.products;
    this.copy = options.copy;
    this.productMutationLock = options.productMutationLock ?? getProductMutationLock(options.home);
    this.onProductMutationWarning = options.onProductMutationWarning ?? defaultProductMutationWarningSink;
    this.testHooks = {};
  }

  setTestHooksForUnitTests(hooks: RequirementServiceTestHooks): void {
    this.testHooks = hooks;
  }

  async createEmptyRequirement(productId: string, title: string): Promise<Requirement> {
    return this.runProductMutation({ operation: "create_requirement", product_id: productId }, async () =>
      this.createEmptyRequirementLocked(productId, title),
    );
  }

  async createEmptyRequirementLocked(productId: string, title: string): Promise<Requirement> {
    await this.products.getProduct(productId);

    const now = new Date().toISOString();
    const requirement = requirementSchema.parse({
      id: createId("requirement"),
      product_id: productId,
      title,
      status: "empty",
      ui_affected: true,
      created_at: now,
      updated_at: now,
      pages: [],
      navigation: [],
    });

    await writeYamlAtomic(this.requirementFile(requirement.product_id, requirement.id), requirement);
    return requirement;
  }

  async saveRequirement(input: SaveRequirementInput): Promise<Requirement> {
    const productId = await this.productIdForRequirement(input.requirement_id);
    return this.runProductMutation({ operation: "save_requirement", product_id: productId }, async () =>
      this.saveRequirementLocked(input),
    );
  }

  async saveRequirementLocked(input: SaveRequirementInput): Promise<Requirement> {
    const parsed = saveRequirementInputSchema.parse(input);
    const current = await this.readRequirementById(parsed.requirement_id);
    if (current.status === "archived") {
      throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
        requirement_id: current.id,
        status: current.status,
      });
    }

    assertDocument(parsed.document_md);
    if (!parsed.ui_affected) {
      return this.doLogicOnlyUpdate(current, parsed);
    }

    assertPages(parsed.pages);
    if (current.status === "empty") {
      return this.doFirstSubmit(current, parsed);
    }
    if (current.status === "submitted" || current.status === "active") {
      return this.doPageUpdate(current, parsed);
    }

    throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
      requirement_id: current.id,
      status: current.status,
    });
  }

  async submitRequirement(input: SubmitRequirementInput): Promise<Requirement> {
    const productId = await this.productIdForRequirement(input.requirement_id);
    return this.runProductMutation({ operation: "submit_requirement", product_id: productId }, async () =>
      this.submitRequirementLocked(input),
    );
  }

  async submitRequirementLocked(input: SubmitRequirementInput): Promise<Requirement> {
    const current = await this.readRequirementById(input.requirement_id);
    if (current.status !== "empty") {
      throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
        requirement_id: input.requirement_id,
        status: current.status,
      });
    }
    assertDocument(input.document_md);
    assertPages(input.pages);

    const pages = input.pages.map((page) => resolveSubmittedPage({ ...page, design_status: "pending" }));
    const next = requirementSchema.parse({
      ...current,
      status: "submitted",
      updated_at: new Date().toISOString(),
      pages,
      navigation: input.navigation,
    });

    await this.commitRequirementAndBaseline(next, input.document_md);
    return next;
  }

  async updateRequirement(input: UpdateRequirementInput): Promise<Requirement> {
    const productId = await this.productIdForRequirement(input.requirement_id);
    return this.runProductMutation({ operation: "update_requirement", product_id: productId }, async () =>
      this.updateRequirementLocked(input),
    );
  }

  async updateRequirementLocked(input: UpdateRequirementInput): Promise<Requirement> {
    const current = await this.readRequirementById(input.requirement_id);
    if (current.status !== "submitted" && current.status !== "active") {
      throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
        requirement_id: input.requirement_id,
        status: current.status,
      });
    }
    assertDocument(input.document_md);
    assertPages(input.pages);

    const currentPagesById = new Map(current.pages.map((page) => [page.page_id, page]));
    const expiredIds = new Set(input.expired_pages);
    const nextActivePages = input.pages.map((page) => {
      const currentPage = currentPagesById.get(page.page_id);
      const designStatus = expiredIds.has(page.page_id) ? "expired" : (currentPage?.design_status ?? "pending");
      return resolveSubmittedPage({ ...page, design_status: designStatus }, currentPage);
    });
    const nextActiveIds = new Set(nextActivePages.map((page) => page.page_id));
    const expiredPages = current.pages
      .filter((page) => expiredIds.has(page.page_id) && !nextActiveIds.has(page.page_id))
      .map((page) => requirementPageSchema.parse({ ...page, design_status: "expired" }));

    const next = requirementSchema.parse({
      ...current,
      updated_at: new Date().toISOString(),
      pages: [...nextActivePages, ...expiredPages],
      navigation: input.navigation,
    });

    await this.commitRequirementAndBaseline(next, input.document_md);
    return next;
  }

  async archiveRequirement(requirementId: string): Promise<Requirement> {
    const productId = await this.productIdForRequirement(requirementId);
    return this.runProductMutation({ operation: "archive_requirement", product_id: productId }, async () =>
      this.archiveRequirementLocked(requirementId),
    );
  }

  async archiveRequirementLocked(requirementId: string): Promise<Requirement> {
    const current = await this.readRequirementById(requirementId);
    if (current.status !== "active") {
      throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
        requirement_id: requirementId,
        status: current.status,
      });
    }

    const next = requirementSchema.parse({ ...current, status: "archived", updated_at: new Date().toISOString() });
    const files = [this.requirementFile(next.product_id, next.id)];
    const snapshots = await snapshotFiles(files);
    try {
      await writeYamlAtomic(this.requirementFile(next.product_id, next.id), next);
    } catch (error) {
      await restoreSnapshots(snapshots);
      throw error;
    }
    return next;
  }

  async markPageDesignDone(requirementId: string, pageId: string): Promise<Requirement> {
    const productId = await this.productIdForRequirement(requirementId);
    return this.runProductMutation({ operation: "mark_page_design_done", product_id: productId }, async () =>
      this.markPageDesignDoneLocked(requirementId, pageId),
    );
  }

  async markPageDesignDoneLocked(requirementId: string, pageId: string): Promise<Requirement> {
    const current = await this.readRequirementById(requirementId);
    if (current.status !== "submitted" && current.status !== "active") {
      throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
        requirement_id: requirementId,
        status: current.status,
      });
    }

    let matched = false;
    const pages = current.pages.map((page) => {
      if (page.page_id !== pageId) {
        return page;
      }
      matched = true;
      return requirementPageSchema.parse({ ...page, design_status: "done" });
    });
    if (!matched) {
      throw new FormaError("REQUIREMENT_PAGE_NOT_FOUND", "Requirement page not found", {
        requirement_id: requirementId,
        page_id: pageId,
      });
    }

    const next = requirementSchema.parse({
      ...current,
      status: resolveRequirementStatus(pages),
      updated_at: new Date().toISOString(),
      pages,
    });
    const file = this.requirementFile(next.product_id, next.id);
    const snapshots = await snapshotFiles([file]);
    try {
      await writeYamlAtomic(file, next);
    } catch (error) {
      await restoreSnapshots(snapshots);
      throw error;
    }
    return next;
  }

  async getRequirement(input: { requirement_id: string } | { product_id: string }): Promise<RequirementWithDocument> {
    if ("requirement_id" in input) {
      const requirement = await this.readRequirementById(input.requirement_id);
      return this.withDocument(requirement);
    }

    return this.withDocument(await this.getLatestRequirement(input.product_id));
  }

  async getRequirementHistory(productId: string): Promise<RequirementWithDocument[]> {
    await this.products.getProduct(productId);
    const requirements = await this.readProductRequirements(productId);
    const ordered = requirements.sort(compareCreatedAtAsc);
    return Promise.all(ordered.map((requirement) => this.withDocument(requirement)));
  }

  async getLatestRequirement(productId: string): Promise<Requirement> {
    await this.products.getProduct(productId);
    const requirements = (await this.readProductRequirements(productId)).filter(
      (requirement) => requirement.status !== "archived",
    );
    const latest = requirements.sort(compareUpdatedAtDesc)[0];
    if (!latest) {
      throw new FormaError("REQUIREMENT_NOT_FOUND", "Requirement not found", { product_id: productId });
    }

    return latest;
  }

  async getProductRules(productId: string): Promise<StoredRule[]> {
    await this.products.getProduct(productId);
    return this.readRules(productId);
  }

  private async withDocument(requirement: Requirement): Promise<RequirementWithDocument> {
    return { ...requirement, document_md: await this.readDocument(requirement.product_id, requirement.id) };
  }

  private async readRequirementById(requirementId: string): Promise<Requirement> {
    const parsedRequirementId = this.parseRequirementId(requirementId);
    const products = await this.products.listProducts();
    for (const product of products) {
      const file = this.requirementFile(product.id, parsedRequirementId);
      if (await fileExists(file)) {
        const requirement = await readYamlAs(file, requirementSchema);
        if (requirement.id === parsedRequirementId && requirement.product_id === product.id) {
          return requirement;
        }
      }
    }

    throw new FormaError("REQUIREMENT_NOT_FOUND", "Requirement not found", { requirement_id: parsedRequirementId });
  }

  private async readProductRequirements(productId: string): Promise<Requirement[]> {
    const productDir = join(this.dataDir, productId);
    if (!(await fileExists(productDir))) {
      return [];
    }

    const entries = await readdir(productDir, { withFileTypes: true });
    const requirements = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && /^R-[a-f0-9]{8}$/.test(entry.name))
        .map(async (entry) => {
          const requirement = await readYamlAs(this.requirementFile(productId, entry.name), requirementSchema);
          return requirement.id === entry.name && requirement.product_id === productId ? requirement : null;
        }),
    );

    return requirements.filter((requirement): requirement is Requirement => requirement !== null);
  }

  private async readDocument(productId: string, requirementId: string): Promise<string> {
    const file = this.documentFile(productId, requirementId);
    if (!(await fileExists(file))) {
      return "";
    }

    return readFile(file, "utf8");
  }

  private async doFirstSubmit(current: Requirement, input: ParsedSaveRequirementInput): Promise<Requirement> {
    const removePageIds = new Set(input.remove_page_ids);
    const pages = input.pages
      .filter((page) => !removePageIds.has(page.page_id))
      .map((page) => resolveSavedPage(current.id, page));
    assertPages(pages);
    const next = requirementSchema.parse({
      ...current,
      status: resolveRequirementStatus(pages),
      ui_affected: true,
      updated_at: new Date().toISOString(),
      pages,
      navigation: filterRemovedNavigation(input.navigation, current.pages, pages, removePageIds),
    });

    await this.commitWithBaseline(current, next, input);
    return next;
  }

  private async doPageUpdate(current: Requirement, input: ParsedSaveRequirementInput): Promise<Requirement> {
    const removePageIds = new Set(input.remove_page_ids);
    const currentPagesById = new Map(current.pages.map((page) => [page.page_id, page]));
    const inputPageIds = new Set(input.pages.map((page) => page.page_id));
    const changedPages = input.pages
      .filter((page) => !removePageIds.has(page.page_id))
      .map((page) => {
        const currentPage = currentPagesById.get(page.page_id);
        return resolveSavedPage(current.id, page, currentPage);
      });
    const unchangedPages = current.pages.filter(
      (page) => !inputPageIds.has(page.page_id) && !removePageIds.has(page.page_id),
    );
    const pages = [...changedPages, ...unchangedPages];
    assertPages(pages);
    const next = requirementSchema.parse({
      ...current,
      status: resolveRequirementStatus(pages),
      ui_affected: true,
      updated_at: new Date().toISOString(),
      pages,
      navigation: filterRemovedNavigation(input.navigation, current.pages, pages, removePageIds),
    });

    await this.commitWithBaseline(current, next, input);
    return next;
  }

  private async doLogicOnlyUpdate(current: Requirement, input: ParsedSaveRequirementInput): Promise<Requirement> {
    const next = requirementSchema.parse({
      ...current,
      status:
        current.pages.length === 0 || current.pages.every((page) => page.design_status === "done")
          ? "active"
          : current.status,
      ui_affected: false,
      updated_at: new Date().toISOString(),
    });

    await this.commitLogicOnly(next, input);
    return next;
  }

  private requirementFile(productId: string, requirementId: string): string {
    return join(this.dataDir, productId, requirementId, "requirement.yaml");
  }

  private documentFile(productId: string, requirementId: string): string {
    return join(this.dataDir, productId, requirementId, "document.md");
  }

  private baselineFile(productId: string): string {
    return join(this.dataDir, productId, "baseline", "baseline.yaml");
  }

  private rulesFile(productId: string): string {
    return join(this.dataDir, productId, "baseline", "rules.yaml");
  }

  private translationsFile(productId: string, requirementId: string): string {
    return join(this.dataDir, productId, requirementId, "copy-translations.yaml");
  }

  private async readRules(productId: string): Promise<StoredRule[]> {
    const file = this.rulesFile(productId);
    if (!(await fileExists(file))) {
      return [];
    }

    return (await readYamlAs(file, rulesFileSchema)).rules;
  }

  private async writeRulesForRequirement(
    productId: string,
    requirementId: string,
    rules: z.infer<typeof ruleInputSchema>[],
    removeRuleIds: string[],
    removePageIds: string[],
  ): Promise<void> {
    const parsedRequirementId = requirementIdSchema.parse(requirementId);
    const incomingRules = rules.map((rule) => ruleInputSchema.parse(rule));
    const replacementRuleIds = new Set(
      incomingRules.flatMap((rule) => (rule.replaces_rule_id ? [rule.replaces_rule_id] : [])),
    );
    const explicitRemoveRuleIds = new Set(removeRuleIds);
    const explicitRemovePageIds = new Set(removePageIds);

    const retainedRules = (await this.readRules(productId)).filter((rule) => {
      if (rule.source_requirement === parsedRequirementId) {
        return false;
      }
      if (replacementRuleIds.has(rule.id) || explicitRemoveRuleIds.has(rule.id)) {
        return false;
      }
      if (rule.page_id && explicitRemovePageIds.has(rule.page_id)) {
        return false;
      }
      return true;
    });

    const nextRules = [
      ...retainedRules,
      ...incomingRules.map((rule) => {
        const { replaces_rule_id: _replacesRuleId, ...storedRule } = rule;
        return storedRuleSchema.parse({
          ...storedRule,
          id: `${parsedRequirementId}-${rule.id}`,
          source_requirement: parsedRequirementId,
        });
      }),
    ];

    await writeYamlAtomic(this.rulesFile(productId), { rules: nextRules });
  }

  private async commitRequirementAndBaseline(requirement: Requirement, documentMd: string): Promise<void> {
    const files = [
      this.documentFile(requirement.product_id, requirement.id),
      this.requirementFile(requirement.product_id, requirement.id),
    ];
    const snapshots = await snapshotFiles(files);

    try {
      await writeDocumentAtomic(this.documentFile(requirement.product_id, requirement.id), documentMd);
      await this.testHooks.afterDocumentWrite?.();
      await writeYamlAtomic(this.requirementFile(requirement.product_id, requirement.id), requirement);
    } catch (error) {
      await restoreSnapshots(snapshots);
      throw error;
    }
  }

  private async commitWithBaseline(
    current: Requirement,
    requirement: Requirement,
    input: ParsedSaveRequirementInput,
  ): Promise<void> {
    const files = [
      this.requirementFile(requirement.product_id, requirement.id),
      this.documentFile(requirement.product_id, requirement.id),
      this.translationsFile(requirement.product_id, requirement.id),
      this.rulesFile(requirement.product_id),
    ];
    const product = await this.products.getProduct(requirement.product_id);
    const mergedTranslations = await this.mergedTranslationsForUiSave(
      current,
      requirement,
      input.translations,
      product.languages?.length === 1,
    );
    const snapshots = await snapshotFiles(files);

    try {
      await this.copy.saveTranslationsLocked(requirement.product_id, requirement.id, mergedTranslations);
      await this.testHooks.afterTranslationsWrite?.();
      await writeDocumentAtomic(this.documentFile(requirement.product_id, requirement.id), input.document_md);
      await this.testHooks.afterDocumentWrite?.();
      await this.writeRulesForRequirement(
        requirement.product_id,
        requirement.id,
        input.rules,
        input.remove_rule_ids,
        input.remove_page_ids,
      );
      await this.testHooks.afterRulesWrite?.();
      await writeYamlAtomic(this.requirementFile(requirement.product_id, requirement.id), requirement);
    } catch (error) {
      await restoreSnapshots(snapshots);
      throw error;
    }
  }

  private async commitLogicOnly(requirement: Requirement, input: ParsedSaveRequirementInput): Promise<void> {
    const files = [
      this.requirementFile(requirement.product_id, requirement.id),
      this.documentFile(requirement.product_id, requirement.id),
      this.rulesFile(requirement.product_id),
    ];
    const snapshots = await snapshotFiles(files);

    try {
      await writeDocumentAtomic(this.documentFile(requirement.product_id, requirement.id), input.document_md);
      await this.testHooks.afterDocumentWrite?.();
      await this.writeRulesForRequirement(
        requirement.product_id,
        requirement.id,
        input.rules,
        input.remove_rule_ids,
        [],
      );
      await this.testHooks.afterRulesWrite?.();
      await writeYamlAtomic(this.requirementFile(requirement.product_id, requirement.id), requirement);
    } catch (error) {
      await restoreSnapshots(snapshots);
      throw error;
    }
  }

  private async mergedTranslationsForUiSave(
    current: Requirement,
    requirement: Requirement,
    translations: PageTranslation[],
    isSingleLanguage: boolean,
  ): Promise<PageTranslation[]> {
    if (isSingleLanguage) {
      return [];
    }

    const oldCopy = copyByPageId(current.pages);
    const newCopy = copyByPageId(requirement.pages);
    return this.copy.mergeTranslationsLocked(requirement.product_id, requirement.id, oldCopy, newCopy, translations);
  }

  private async productIdForRequirement(requirementId: string): Promise<string> {
    return (await this.readRequirementById(requirementId)).product_id;
  }

  private parseRequirementId(requirementId: string): string {
    const parsed = requirementIdSchema.safeParse(requirementId);
    if (!parsed.success) {
      throw new FormaError("REQUIREMENT_NOT_FOUND", "Requirement not found", { requirement_id: requirementId });
    }

    return parsed.data;
  }

  private async runProductMutation<T>(
    input: { operation: string; product_id?: string },
    fn: (context: ProductMutationContext) => Promise<T>,
  ): Promise<T> {
    return runProductMutationWithWarnings(this.productMutationLock, input, fn, this.onProductMutationWarning);
  }
}

function assertDocument(documentMd: string): void {
  if (documentMd.trim().length === 0) {
    throw new FormaError("INVALID_INPUT", "Document is empty");
  }
}

function assertPages(pages: unknown[]): void {
  if (pages.length === 0) {
    throw new FormaError("INVALID_INPUT", "Pages are empty");
  }
}

function resolveSavedPage(
  requirementId: string,
  page: z.infer<typeof requirementPageInputSchema>,
  currentPage?: RequirementPage,
): RequirementPage {
  if (page.change_type === "new") {
    return resolveSubmittedPage(
      { ...withoutSemanticContract(currentPage), ...page, design_status: "pending" },
      currentPage,
    );
  }

  if (currentPage?.design_status !== "done") {
    throw new FormaError("INVALID_INPUT", "Page is not done", {
      requirement_id: requirementId,
      page_id: page.page_id,
      change_type: page.change_type,
      design_status: currentPage?.design_status ?? "missing",
    });
  }

  return resolveSubmittedPage(
    {
      ...withoutSemanticContract(currentPage),
      ...page,
      design_status: "expired",
    },
    currentPage,
  );
}

function withoutSemanticContract(page: RequirementPage | undefined): Partial<RequirementPage> {
  if (!page) {
    return {};
  }
  const { semantic_contract: _semanticContract, semantic_contract_coverage: _semanticContractCoverage, ...rest } = page;
  return rest;
}

function resolveSubmittedPage(
  page: Record<string, unknown> & {
    page_id: string;
    name?: string;
    copy?: Array<{ text?: string }>;
    design_status?: RequirementPage["design_status"];
    semantic_contract?: RequirementPage["semantic_contract"];
    semantic_contract_coverage?: RequirementPage["semantic_contract_coverage"];
  },
  currentPage?: RequirementPage,
): RequirementPage {
  const built = buildSemanticContractForPage({
    page: {
      ...page,
      semantic_contract: page.semantic_contract,
      semantic_contract_coverage: page.semantic_contract_coverage,
    },
  });
  return requirementPageSchema.parse({
    ...page,
    design_status: page.design_status ?? "pending",
    semantic_contract: built.semantic_contract,
    semantic_contract_coverage: built.semantic_contract_coverage,
  });
}

function resolveRequirementStatus(pages: RequirementPage[]): Requirement["status"] {
  return pages.some((page) => page.design_status === "pending" || page.design_status === "expired")
    ? "submitted"
    : "active";
}

function copyByPageId(pages: RequirementPage[]): CopyByPage {
  return Object.fromEntries(pages.map((page) => [page.page_id, page.copy ?? []]));
}

function filterRemovedNavigation(
  navigation: z.infer<typeof baselineNavigationSchema>[],
  currentPages: RequirementPage[],
  nextPages: RequirementPage[],
  removePageIds: Set<string>,
): z.infer<typeof baselineNavigationSchema>[] {
  const removedBaselineIds = new Set(
    currentPages
      .filter((page) => removePageIds.has(page.page_id))
      .flatMap((page) => [page.page_id, page.baseline_page]),
  );
  const nextPageIds = new Set(nextPages.flatMap((page) => [page.page_id, page.baseline_page]));

  return navigation.filter((item) => {
    if (
      removePageIds.has(item.from) ||
      removePageIds.has(item.to) ||
      removedBaselineIds.has(item.from) ||
      removedBaselineIds.has(item.to)
    ) {
      return false;
    }
    return nextPageIds.has(item.from) && nextPageIds.has(item.to);
  });
}

function mapNavigationToBaseline(
  pages: RequirementPage[],
  navigation: z.infer<typeof baselineNavigationSchema>[],
): z.infer<typeof baselineNavigationSchema>[] {
  const pageToBaseline = new Map(
    pages.flatMap((page) => [
      [page.page_id, page.baseline_page],
      [page.baseline_page, page.baseline_page],
    ]),
  );

  return navigation.flatMap((item) => {
    const from = pageToBaseline.get(item.from);
    const to = pageToBaseline.get(item.to);
    return from && to ? [{ ...item, from, to }] : [];
  });
}

function compareCreatedAtAsc(a: Requirement, b: Requirement): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

function compareCreatedAtDesc(a: Requirement, b: Requirement): number {
  return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
}

function compareUpdatedAtDesc(a: Requirement, b: Requirement): number {
  return b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id);
}

async function writeDocumentAtomic(file: string, content: string): Promise<void> {
  const parentDir = dirname(file);
  await mkdir(parentDir, { recursive: true });

  const tempFile = join(parentDir, `.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(tempFile, content, "utf8");
    await rename(tempFile, file);
  } catch (error) {
    await rm(tempFile, { force: true });
    throw error;
  }
}

interface FileSnapshot {
  file: string;
  existed: boolean;
  content?: Buffer;
}

async function snapshotFiles(files: string[]): Promise<FileSnapshot[]> {
  return Promise.all(
    files.map(async (file) => {
      if (!(await fileExists(file))) {
        return { file, existed: false };
      }
      return { file, existed: true, content: await readFile(file) };
    }),
  );
}

async function restoreSnapshots(snapshots: FileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    if (!snapshot.existed) {
      await rm(snapshot.file, { force: true });
      continue;
    }
    await writeFileAtomic(snapshot.file, snapshot.content ?? Buffer.alloc(0));
  }
}

async function writeFileAtomic(file: string, content: string | Buffer): Promise<void> {
  const parentDir = dirname(file);
  await mkdir(parentDir, { recursive: true });

  const tempFile = join(parentDir, `.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(tempFile, content);
    await rename(tempFile, file);
  } catch (error) {
    await rm(tempFile, { force: true });
    throw error;
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
