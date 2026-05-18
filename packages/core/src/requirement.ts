import { randomBytes } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { BaselineService, baselineNavigationSchema } from "./baseline.js";
import { copyItemSchema, type CopyByPage, type CopyService, type PageTranslation } from "./copy.js";
import { FormaError } from "./errors.js";
import { createId } from "./ids.js";
import type { ProductService } from "./product.js";
import { requirementStatuses, designStatuses } from "./schemas.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

export const requirementIdSchema = z.string().regex(/^R-[a-f0-9]{8}$/);

export const requirementPageSchema = z.object({
  page_id: z.string().min(1),
  name: z.string().min(1),
  baseline_page: z.string().min(1),
  design_status: z.enum(designStatuses),
  design_id: z.string().regex(/^D-[a-f0-9]{8}$/).optional(),
  change_type: z.enum(["new", "patch", "rebuild"]).optional(),
  features: z.string().optional(),
  copy: z.array(z.lazy(() => copyItemSchema)).optional(),
  fields: z.string().optional(),
  interactions: z.string().optional()
}).strict();

export const requirementSchema = z.object({
  id: requirementIdSchema,
  product_id: z.string().regex(/^P-[a-f0-9]{6}$/),
  title: z.string().min(1),
  status: z.enum(requirementStatuses),
  ui_affected: z.boolean().default(true),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  pages: z.array(requirementPageSchema),
  navigation: z.array(z.lazy(() => baselineNavigationSchema))
}).strict();

const requirementPageInputSchema = z.object({
  page_id: z.string().min(1),
  name: z.string().min(1),
  baseline_page: z.string().min(1),
  features: z.string().optional(),
  copy: z.array(z.lazy(() => copyItemSchema)).optional(),
  fields: z.string().optional(),
  interactions: z.string().optional(),
  change_type: z.enum(["new", "patch", "rebuild"]),
  change_summary: z.string().optional()
}).strict();

const ruleInputSchema = z.object({
  id: z.string().min(1),
  page_id: z.string().min(1).optional(),
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1),
  replaces_rule_id: z.string().optional()
}).strict();

const storedRuleSchema = ruleInputSchema.omit({ replaces_rule_id: true }).extend({
  source_requirement: requirementIdSchema
}).strict();

const rulesFileSchema = z.object({
  rules: z.array(storedRuleSchema)
}).strict();

const translationEntryInputSchema = z.object({
  context: z.string().min(1),
  texts: z.record(z.string(), z.string()),
  outdated: z.boolean().optional()
}).strict();

const pageTranslationInputSchema = z.object({
  page_id: z.string().min(1),
  entries: z.array(translationEntryInputSchema)
}).strict();

const saveRequirementInputSchema = z.object({
  requirement_id: requirementIdSchema,
  document_md: z.string(),
  ui_affected: z.boolean().default(true),
  pages: z.array(requirementPageInputSchema).default([]),
  navigation: z.array(z.lazy(() => baselineNavigationSchema)).default([]),
  translations: z.array(pageTranslationInputSchema).default([]),
  rules: z.array(ruleInputSchema).default([]),
  remove_rule_ids: z.array(z.string().min(1)).default([]),
  remove_page_ids: z.array(z.string().min(1)).default([])
}).strict();

export type RequirementPage = z.infer<typeof requirementPageSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type RequirementWithDocument = Requirement & { document_md: string };
export type StoredRule = z.infer<typeof storedRuleSchema>;
export type SaveRequirementInput = z.input<typeof saveRequirementInputSchema>;

type ParsedSaveRequirementInput = z.infer<typeof saveRequirementInputSchema>;

export interface SubmitRequirementInput {
  requirement_id: string;
  document_md: string;
  pages: Array<Omit<RequirementPage, "design_status"> & { design_status?: RequirementPage["design_status"] }>;
  navigation: z.infer<typeof baselineNavigationSchema>[];
}

export interface UpdateRequirementInput extends SubmitRequirementInput {
  expired_pages: string[];
}

export interface RequirementServiceOptions {
  home: string;
  products: ProductService;
  baseline: BaselineService;
  copy: CopyService;
}

interface RequirementServiceTestHooks {
  afterBaselineUpdate?(): Promise<void> | void;
  afterTranslationsWrite?(): Promise<void> | void;
  afterDocumentWrite?(): Promise<void> | void;
  afterRulesWrite?(): Promise<void> | void;
}

export class RequirementService {
  private readonly dataDir: string;
  private readonly products: ProductService;
  private readonly baseline: BaselineService;
  private readonly copy: CopyService;
  private testHooks: RequirementServiceTestHooks;

  constructor(options: RequirementServiceOptions) {
    this.dataDir = join(options.home, "data");
    this.products = options.products;
    this.baseline = options.baseline;
    this.copy = options.copy;
    this.testHooks = {};
  }

  setTestHooksForUnitTests(hooks: RequirementServiceTestHooks): void {
    this.testHooks = hooks;
  }

  async createEmptyRequirement(productId: string, title: string): Promise<Requirement> {
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
      navigation: []
    });

    await writeYamlAtomic(this.requirementFile(requirement.product_id, requirement.id), requirement);
    return requirement;
  }

  async saveRequirement(input: SaveRequirementInput): Promise<Requirement> {
    const parsed = saveRequirementInputSchema.parse(input);
    const current = await this.readRequirementById(parsed.requirement_id);
    if (current.status === "archived") {
      throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
        requirement_id: current.id,
        status: current.status
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
      status: current.status
    });
  }

  async submitRequirement(input: SubmitRequirementInput): Promise<Requirement> {
    const current = await this.readRequirementById(input.requirement_id);
    if (current.status !== "empty") {
      throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
        requirement_id: input.requirement_id,
        status: current.status
      });
    }
    assertDocument(input.document_md);
    assertPages(input.pages);

    const pages = input.pages.map((page) => requirementPageSchema.parse({ ...page, design_status: "pending" }));
    const next = requirementSchema.parse({
      ...current,
      status: "submitted",
      updated_at: new Date().toISOString(),
      pages,
      navigation: input.navigation
    });

    await this.commitRequirementAndBaseline(next, input.document_md);
    return next;
  }

  async updateRequirement(input: UpdateRequirementInput): Promise<Requirement> {
    const current = await this.readRequirementById(input.requirement_id);
    if (current.status !== "submitted" && current.status !== "active") {
      throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
        requirement_id: input.requirement_id,
        status: current.status
      });
    }
    assertDocument(input.document_md);
    assertPages(input.pages);

    const currentPagesById = new Map(current.pages.map((page) => [page.page_id, page]));
    const expiredIds = new Set(input.expired_pages);
    const nextActivePages = input.pages.map((page) => {
      const currentPage = currentPagesById.get(page.page_id);
      const designStatus = expiredIds.has(page.page_id) ? "expired" : (currentPage?.design_status ?? "pending");
      return requirementPageSchema.parse({ ...page, design_status: designStatus });
    });
    const nextActiveIds = new Set(nextActivePages.map((page) => page.page_id));
    const expiredPages = current.pages
      .filter((page) => expiredIds.has(page.page_id) && !nextActiveIds.has(page.page_id))
      .map((page) => requirementPageSchema.parse({ ...page, design_status: "expired" }));

    const next = requirementSchema.parse({
      ...current,
      updated_at: new Date().toISOString(),
      pages: [...nextActivePages, ...expiredPages],
      navigation: input.navigation
    });

    await this.commitRequirementAndBaseline(next, input.document_md);
    return next;
  }

  async archiveRequirement(requirementId: string): Promise<Requirement> {
    const current = await this.readRequirementById(requirementId);
    if (current.status !== "active") {
      throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
        requirement_id: requirementId,
        status: current.status
      });
    }

    const next = requirementSchema.parse({ ...current, status: "archived", updated_at: new Date().toISOString() });
    await writeYamlAtomic(this.requirementFile(next.product_id, next.id), next);
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
    const requirements = (await this.readProductRequirements(productId)).filter((requirement) => requirement.status !== "archived");
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
        })
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
      .map((page) => requirementPageSchema.parse({ ...stripPageInputMetadata(page), design_status: "pending" }));
    assertPages(pages);
    const next = requirementSchema.parse({
      ...current,
      status: resolveRequirementStatus(pages),
      ui_affected: true,
      updated_at: new Date().toISOString(),
      pages,
      navigation: filterRemovedNavigation(input.navigation, current.pages, pages, removePageIds)
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
        return requirementPageSchema.parse({
          ...currentPage,
          ...stripPageInputMetadata(page),
          design_status: resolveDesignStatus(page.change_type)
        });
      });
    const unchangedPages = current.pages.filter((page) => !inputPageIds.has(page.page_id) && !removePageIds.has(page.page_id));
    const pages = [...changedPages, ...unchangedPages];
    assertPages(pages);
    const next = requirementSchema.parse({
      ...current,
      status: resolveRequirementStatus(pages),
      ui_affected: true,
      updated_at: new Date().toISOString(),
      pages,
      navigation: filterRemovedNavigation(input.navigation, current.pages, pages, removePageIds)
    });

    await this.commitWithBaseline(current, next, input);
    return next;
  }

  private async doLogicOnlyUpdate(current: Requirement, input: ParsedSaveRequirementInput): Promise<Requirement> {
    const next = requirementSchema.parse({
      ...current,
      status: current.pages.length === 0 || current.pages.every((page) => page.design_status === "done") ? "active" : current.status,
      ui_affected: false,
      updated_at: new Date().toISOString()
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
    removePageIds: string[]
  ): Promise<void> {
    const parsedRequirementId = requirementIdSchema.parse(requirementId);
    const incomingRules = rules.map((rule) => ruleInputSchema.parse(rule));
    const replacementRuleIds = new Set(
      incomingRules.flatMap((rule) => rule.replaces_rule_id ? [rule.replaces_rule_id] : [])
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
          source_requirement: parsedRequirementId
        });
      })
    ];

    await writeYamlAtomic(this.rulesFile(productId), { rules: nextRules });
  }

  private async commitRequirementAndBaseline(requirement: Requirement, documentMd: string): Promise<void> {
    const files = [
      this.baselineFile(requirement.product_id),
      this.documentFile(requirement.product_id, requirement.id),
      this.requirementFile(requirement.product_id, requirement.id)
    ];
    const snapshots = await snapshotFiles(files);

    try {
      await this.baseline.updateFromRequirement({
        productId: requirement.product_id,
        requirementId: requirement.id,
        pages: requirement.pages,
        navigation: mapNavigationToBaseline(requirement.pages, requirement.navigation)
      });
      await this.testHooks.afterBaselineUpdate?.();
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
    input: ParsedSaveRequirementInput
  ): Promise<void> {
    const files = [
      this.requirementFile(requirement.product_id, requirement.id),
      this.documentFile(requirement.product_id, requirement.id),
      this.translationsFile(requirement.product_id, requirement.id),
      this.baselineFile(requirement.product_id),
      this.rulesFile(requirement.product_id)
    ];
    const product = await this.products.getProduct(requirement.product_id);
    const mergedTranslations = await this.mergedTranslationsForUiSave(current, requirement, input.translations, product.languages?.length === 1);
    const snapshots = await snapshotFiles(files);

    try {
      await this.baseline.updateFromRequirement({
        productId: requirement.product_id,
        requirementId: requirement.id,
        pages: requirement.pages,
        navigation: mapNavigationToBaseline(requirement.pages, requirement.navigation)
      });
      await this.testHooks.afterBaselineUpdate?.();
      await this.copy.saveTranslations(requirement.product_id, requirement.id, mergedTranslations);
      await this.testHooks.afterTranslationsWrite?.();
      await writeDocumentAtomic(this.documentFile(requirement.product_id, requirement.id), input.document_md);
      await this.testHooks.afterDocumentWrite?.();
      await this.writeRulesForRequirement(
        requirement.product_id,
        requirement.id,
        input.rules,
        input.remove_rule_ids,
        input.remove_page_ids
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
      this.rulesFile(requirement.product_id)
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
        []
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
    isSingleLanguage: boolean
  ): Promise<PageTranslation[]> {
    if (isSingleLanguage) {
      return [];
    }

    const oldCopy = copyByPageId(current.pages);
    const newCopy = copyByPageId(requirement.pages);
    return this.copy.mergeTranslations(requirement.product_id, requirement.id, oldCopy, newCopy, translations);
  }

  private parseRequirementId(requirementId: string): string {
    const parsed = requirementIdSchema.safeParse(requirementId);
    if (!parsed.success) {
      throw new FormaError("REQUIREMENT_NOT_FOUND", "Requirement not found", { requirement_id: requirementId });
    }

    return parsed.data;
  }
}

function assertDocument(documentMd: string): void {
  if (documentMd.trim().length === 0) {
    throw new FormaError("DOCUMENT_EMPTY", "Document is empty");
  }
}

function assertPages(pages: unknown[]): void {
  if (pages.length === 0) {
    throw new FormaError("PAGES_EMPTY", "Pages are empty");
  }
}

function stripPageInputMetadata(page: z.infer<typeof requirementPageInputSchema>): Omit<z.infer<typeof requirementPageInputSchema>, "change_summary"> {
  const { change_summary: _changeSummary, ...requirementPage } = page;
  return requirementPage;
}

function resolveDesignStatus(changeType: z.infer<typeof requirementPageInputSchema>["change_type"]): RequirementPage["design_status"] {
  return changeType === "new" ? "pending" : "expired";
}

function resolveRequirementStatus(pages: RequirementPage[]): Requirement["status"] {
  return pages.some((page) => page.design_status === "pending" || page.design_status === "expired") ? "submitted" : "active";
}

function copyByPageId(pages: RequirementPage[]): CopyByPage {
  return Object.fromEntries(pages.map((page) => [page.page_id, page.copy ?? []]));
}

function filterRemovedNavigation(
  navigation: z.infer<typeof baselineNavigationSchema>[],
  currentPages: RequirementPage[],
  nextPages: RequirementPage[],
  removePageIds: Set<string>
): z.infer<typeof baselineNavigationSchema>[] {
  const removedBaselineIds = new Set(
    currentPages
      .filter((page) => removePageIds.has(page.page_id))
      .flatMap((page) => [page.page_id, page.baseline_page])
  );
  const nextPageIds = new Set(nextPages.flatMap((page) => [page.page_id, page.baseline_page]));

  return navigation.filter((item) => {
    if (removePageIds.has(item.from) || removePageIds.has(item.to) || removedBaselineIds.has(item.from) || removedBaselineIds.has(item.to)) {
      return false;
    }
    return nextPageIds.has(item.from) && nextPageIds.has(item.to);
  });
}

function mapNavigationToBaseline(
  pages: RequirementPage[],
  navigation: z.infer<typeof baselineNavigationSchema>[]
): z.infer<typeof baselineNavigationSchema>[] {
  const pageToBaseline = new Map(
    pages.flatMap((page) => [
      [page.page_id, page.baseline_page],
      [page.baseline_page, page.baseline_page]
    ])
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
  return Promise.all(files.map(async (file) => {
    if (!(await fileExists(file))) {
      return { file, existed: false };
    }
    return { file, existed: true, content: await readFile(file) };
  }));
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
