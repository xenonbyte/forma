import {
  access,
  copyFile,
  readdir
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  FormaError,
  PencilAppSessionAdapter,
  applyProductComponentOperations,
  applyRequirementDesignOperations,
  beginProductComponentSession,
  beginRequirementDesignSession,
  commitProductComponentSession,
  commitRequirementDesignSession,
  defaultPencilRunner,
  diffRequirementDesignVersions,
  discardProductComponentSession,
  discardRequirementDesignSession,
  exportRequirementDesignAsset,
  findBaselinePreviewMetadata,
  getProductComponentLibrary,
  getRequirementDesign,
  getRequirementDesignHistory,
  getRequirementDesignScene,
  indexRequirementComponentUsage,
  indexRequirementDesignCanvas,
  languages,
  planImportMetadataNormalization,
  platforms,
  recoverDesignCommitJournal,
  readYaml,
  refreshRequirementComponents,
  rollbackRequirementDesign,
  runDesignQualityPipeline,
  type BaselineService,
  type CopyService,
  type DeleteProductInput,
  type DeleteProductResult,
  type FormaStore,
  type ProductService,
  type RequirementService,
  type SchemaNormalizationRecoveryState,
  type SessionService,
  type StyleService
} from "@xenonbyte/forma-core";
import * as z from "zod/v4";

export const formaToolNames = [
  "help",
  "list_products",
  "get_product",
  "delete_product",
  "get_product_baseline",
  "get_baseline_page",
  "get_baseline_image",
  "get_requirement_history",
  "get_requirement",
  "get_product_rules",
  "get_page_copy",
  "update_page_copy",
  "get_current_session",
  "set_current_session",
  "init_product_config",
  "update_product_config",
  "list_styles",
  "get_style",
  "save_requirement",
  "begin_requirement_design_session",
  "apply_requirement_design_operations",
  "commit_requirement_design_session",
  "discard_requirement_design_session",
  "recover_design_commit_journal",
  "begin_product_component_session",
  "apply_product_component_operations",
  "commit_product_component_session",
  "discard_product_component_session",
  "get_requirement_design_canvas",
  "index_requirement_design_canvas",
  "get_requirement_design_scene",
  "get_requirement_design_history",
  "rollback_requirement_design",
  "diff_requirement_design_versions",
  "export_requirement_design_asset",
  "get_product_component_library",
  "index_component_usages",
  "refresh_requirement_components",
  "plan_import_metadata_normalization",
  "validate_requirement_design_quality",
  "session_get_editor_state",
  "session_get_guidelines",
  "session_get_variables",
  "session_batch_get",
  "session_snapshot_layout",
  "session_get_screenshot",
  "session_export_nodes"
] as const;

export type FormaToolName = (typeof formaToolNames)[number];

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface FormaToolResult {
  [key: string]: unknown;
  content: McpTextContent[];
  isError?: true;
}

export type FormaToolHandler = (args: unknown) => Promise<FormaToolResult>;
export type FormaTools = Record<FormaToolName, FormaToolHandler>;
type ToolRequirements = Pick<
  RequirementService,
  "getProductRules" | "getRequirement" | "getRequirementHistory" | "saveRequirement"
> & Partial<Pick<RequirementService, "getLatestRequirement">>;
type V6ServiceOverrides = Partial<{
  beginRequirementDesignSession(input: Record<string, unknown>): Promise<unknown>;
  applyRequirementDesignOperations(input: Record<string, unknown>): Promise<unknown>;
  commitRequirementDesignSession(input: Record<string, unknown>): Promise<unknown>;
  discardRequirementDesignSession(input: Record<string, unknown>): Promise<unknown>;
  recoverDesignCommitJournal(input: Record<string, unknown>): Promise<unknown>;
  beginProductComponentSession(input: Record<string, unknown>): Promise<unknown>;
  applyProductComponentOperations(input: Record<string, unknown>): Promise<unknown>;
  commitProductComponentSession(input: Record<string, unknown>): Promise<unknown>;
  discardProductComponentSession(input: Record<string, unknown>): Promise<unknown>;
  getRequirementDesign(home: string, productId: string, requirementId: string): Promise<unknown>;
  indexRequirementDesignCanvas(input: Record<string, unknown>): Promise<unknown>;
  getRequirementDesignScene(input: Record<string, unknown>): Promise<unknown>;
  getRequirementDesignHistory(input: Record<string, unknown>): Promise<unknown>;
  rollbackRequirementDesign(input: Record<string, unknown>): Promise<unknown>;
  diffRequirementDesignVersions(input: Record<string, unknown>): Promise<unknown>;
  exportRequirementDesignAsset(input: Record<string, unknown>): Promise<unknown>;
  getProductComponentLibrary(home: string, productId: string): Promise<unknown>;
  indexRequirementComponentUsage(input: Record<string, unknown>): Promise<unknown>;
  refreshRequirementComponents(input: Record<string, unknown>): Promise<unknown>;
  planImportMetadataNormalization(input: Record<string, unknown>): Promise<unknown>;
  runDesignQualityPipeline(input: Record<string, unknown>): Promise<unknown>;
  sessionGetEditorState(input: Record<string, unknown>): Promise<unknown>;
  sessionGetGuidelines(input: Record<string, unknown>): Promise<unknown>;
  sessionGetVariables(input: Record<string, unknown>): Promise<unknown>;
  sessionBatchGet(input: Record<string, unknown>): Promise<unknown>;
  sessionSnapshotLayout(input: Record<string, unknown>): Promise<unknown>;
  sessionGetScreenshot(input: Record<string, unknown>): Promise<unknown>;
  sessionExportNodes(input: Record<string, unknown>): Promise<unknown>;
}>;

export interface FormaMcpServerLike {
  registerTool(name: string, config: { title: string; description: string; inputSchema: z.ZodType }, handler: FormaToolHandler): unknown;
}

const emptySchema = z.object({}).strict();
const productIdSchema = z.object({ product_id: z.string().min(1) }).strict();
const deleteProductSchema = z.object({
  product_id: z.string().min(1),
  confirm_product_id: z.string().min(1)
}).strict().refine((input) => input.confirm_product_id === input.product_id, {
  message: "confirm_product_id must match product_id",
  path: ["confirm_product_id"]
});
const requirementIdSchema = z.object({ requirement_id: z.string().min(1) }).strict();
const baselinePageSchema = z.object({ product_id: z.string().min(1), page_id: z.string().min(1) }).strict();
const copyItemSchema = z.object({
  context: z.string().min(1),
  text: z.string().min(1)
}).strict();
const translationEntrySchema = z.object({
  context: z.string().min(1),
  texts: z.record(z.string(), z.string()),
  outdated: z.boolean().optional()
}).strict();
const pageTranslationSchema = z.object({
  page_id: z.string().min(1),
  entries: z.array(translationEntrySchema)
}).strict();
const semanticContractItemSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1)
}).strict();
const ruleSemanticSchema = z.object({
  fields: z.array(semanticContractItemSchema).optional(),
  actions: z.array(semanticContractItemSchema).optional(),
  component_keys: z.array(z.string().min(1)).optional(),
  allowed_copy: z.array(z.string()).optional()
}).strict();
const ruleInputSchema = z.object({
  id: z.string().min(1),
  page_id: z.string().min(1).optional(),
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1),
  semantic: ruleSemanticSchema.optional(),
  replaces_rule_id: z.string().optional()
}).strict();
const styleVariablesSchema = z.object({
  primary: z.string(),
  background: z.string(),
  "text-primary": z.string(),
  "font-heading": z.string(),
  "font-body": z.string(),
  "border-radius": z.string(),
  "spacing-unit": z.string()
});
const styleMetadataSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  design_md_path: z.string().min(1),
  variables: styleVariablesSchema
});
const requirementPageInputSchema = z.object({
  page_id: z.string().min(1),
  name: z.string().min(1),
  baseline_page: z.string().min(1),
  features: z.string().optional(),
  copy: z.array(copyItemSchema).optional(),
  fields: z.string().optional(),
  interactions: z.string().optional(),
  change_type: z.enum(["new", "patch", "rebuild"]),
  change_summary: z.string().optional()
}).strict();
const navigationInputSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional()
}).strict();
const saveRequirementSchema = z.object({
  requirement_id: z.string().min(1),
  document_md: z.string(),
  ui_affected: z.boolean(),
  pages: z.array(requirementPageInputSchema),
  navigation: z.array(navigationInputSchema),
  translations: z.array(pageTranslationSchema).optional(),
  rules: z.array(ruleInputSchema).optional(),
  remove_rule_ids: z.array(z.string().min(1)).optional(),
  remove_page_ids: z.array(z.string().min(1)).optional()
}).strict();
const getRequirementSchema = z.object({
  requirement_id: z.string().min(1).optional(),
  product_id: z.string().min(1).optional()
}).strict().superRefine((input, context) => {
  if (Boolean(input.requirement_id) === Boolean(input.product_id)) {
    context.addIssue({ code: "custom", message: "provide exactly one of requirement_id or product_id" });
  }
});
const getPageCopySchema = z.object({
  product_id: z.string().min(1),
  page_id: z.string().min(1),
  requirement_id: z.string().min(1).optional()
}).strict();
const updatePageCopySchema = z.object({
  requirement_id: z.string().min(1),
  page_id: z.string().min(1),
  translations: z.array(translationEntrySchema)
}).strict();
const productConfigSchema = z.object({
  product_id: z.string().min(1),
  platform: z.enum(platforms),
  style: styleMetadataSchema,
  languages: z.array(z.enum(languages)).min(1),
  default_language: z.enum(languages)
}).strict().refine((config) => config.languages.includes(config.default_language), {
  message: "default_language must be included in languages",
  path: ["default_language"]
});
const styleNameSchema = z.object({ name: z.string().min(1) }).strict();
const nonEmptyStringSchema = z.string().min(1);
const forbiddenPathFieldNames = new Set([
  "filePath",
  "file_path",
  "canvas_path",
  "staging_path",
  "outputDir",
  "output_dir",
  "path",
  "pen_path",
  "preview_path",
  "history_path"
]);
const forbiddenPathFieldSchemas = Object.fromEntries(
  [...forbiddenPathFieldNames].map((field) => [
    field,
    z.never({ error: "FORBIDDEN_PATH_PARAMETER" }).optional()
  ])
) as Record<string, z.ZodType>;
const sessionIdInputSchema = z.object({ session_id: nonEmptyStringSchema }).strict();
const productRequirementSchema = z.object({
  product_id: nonEmptyStringSchema,
  requirement_id: nonEmptyStringSchema
}).strict();
const componentRefreshScopeSchema = z.union([
  z.literal("all_pages"),
  z.object({
    page_ids: z.array(nonEmptyStringSchema).min(1).optional(),
    component_keys: z.array(nonEmptyStringSchema).min(1).optional()
  }).strict()
]);
const beginRequirementDesignSessionSchema = rejectForbiddenPathFields(z.object({
  product_id: nonEmptyStringSchema,
  requirement_id: nonEmptyStringSchema,
  page_id: nonEmptyStringSchema.optional(),
  operation: z.enum(["generate", "refine", "rebuild", "rollback", "component_refresh"]),
  design_language: nonEmptyStringSchema.optional(),
  component_refresh: z.object({
    version: z.union([z.literal("latest"), z.number().int().positive()]),
    scope: componentRefreshScopeSchema.optional()
  }).strict().optional(),
  ...forbiddenPathFieldSchemas
}).strict());
const requirementDesignOperationIntentSchema = z.enum([
  "generate",
  "refine",
  "rebuild",
  "rollback",
  "component_refresh",
  "quality_repair",
  "import_metadata_normalization"
]);
const operationArgsSchema = rejectForbiddenPathFields(z.record(z.string(), z.unknown()));
const applyRequirementDesignOperationsSchema = z.object({
  session_id: nonEmptyStringSchema,
  operations: z.array(z.object({
    tool: z.literal("batch_design"),
    args: operationArgsSchema,
    target_node_ids: z.array(nonEmptyStringSchema).optional(),
    intent: requirementDesignOperationIntentSchema
  }).strict()).min(1),
  ...forbiddenPathFieldSchemas
}).strict();
const aiVisualReviewSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("passed"),
    screenshot_path: nonEmptyStringSchema.optional()
  }).strict(),
  z.object({
    status: z.literal("warning"),
    screenshot_path: nonEmptyStringSchema.optional(),
    warnings: z.array(nonEmptyStringSchema)
  }).strict(),
  z.object({
    status: z.literal("skipped"),
    reason: z.enum(["not_requested", "model_has_no_vision", "screenshot_failed", "timeout"])
  }).strict()
]);
const commitRequirementDesignSessionSchema = rejectForbiddenPathFields(z.object({
  session_id: nonEmptyStringSchema,
  page_id: nonEmptyStringSchema.optional(),
  frame_id: nonEmptyStringSchema.optional(),
  ai_visual_review: aiVisualReviewSchema.optional(),
  ai_visual_reviews: z.array(z.object({
    page_id: nonEmptyStringSchema,
    result: aiVisualReviewSchema
  }).strict()).optional(),
  ...forbiddenPathFieldSchemas
}).strict().superRefine((input, context) => {
  if (input.ai_visual_review && input.ai_visual_reviews) {
    context.addIssue({ code: "custom", message: "ai_visual_review and ai_visual_reviews are mutually exclusive" });
  }
  if ((input.page_id || input.frame_id) && input.ai_visual_reviews) {
    context.addIssue({ code: "custom", message: "page commit accepts ai_visual_review only", path: ["ai_visual_reviews"] });
  }
  if ((input.page_id && !input.frame_id) || (!input.page_id && input.frame_id)) {
    context.addIssue({ code: "custom", message: "page_id and frame_id must be provided together" });
  }
}));
const productComponentSeedSchema = z.object({
  component_key: nonEmptyStringSchema,
  name: nonEmptyStringSchema.optional(),
  semantic_contract_hash: nonEmptyStringSchema.optional(),
  source: nonEmptyStringSchema.optional(),
  required_by: z.array(z.object({
    requirement_id: nonEmptyStringSchema,
    page_id: nonEmptyStringSchema.optional()
  }).strict()).optional()
}).strict();
const beginProductComponentSessionSchema = rejectForbiddenPathFields(z.object({
  product_id: nonEmptyStringSchema,
  operation: z.enum(["generate", "refine", "change_style"]),
  seed_components: z.array(productComponentSeedSchema).optional(),
  newly_required_component_keys: z.array(nonEmptyStringSchema).optional(),
  ...forbiddenPathFieldSchemas
}).strict().superRefine((input, context) => {
  if (input.operation === "generate" && (!input.seed_components || input.seed_components.length === 0)) {
    context.addIssue({ code: "custom", message: "seed_components are required for generate", path: ["seed_components"] });
  }
}));
const applyProductComponentOperationsSchema = z.object({
  session_id: nonEmptyStringSchema,
  operations: z.array(z.object({
    tool: z.enum(["batch_design", "set_variables"]),
    args: operationArgsSchema,
    target_node_ids: z.array(nonEmptyStringSchema).optional(),
    intent: nonEmptyStringSchema
  }).strict()).min(1),
  ...forbiddenPathFieldSchemas
}).strict();
const recoverDesignCommitJournalSchema = z.object({
  session_id: nonEmptyStringSchema,
  scope: z.enum(["requirement_canvas", "product_component_library"])
}).strict();
const rollbackRequirementDesignSchema = z.object({
  product_id: nonEmptyStringSchema,
  requirement_id: nonEmptyStringSchema,
  canvas_version: z.number().int().positive()
}).strict();
const diffRequirementDesignVersionsSchema = z.object({
  product_id: nonEmptyStringSchema,
  requirement_id: nonEmptyStringSchema,
  from_canvas_version: z.number().int().positive(),
  to_canvas_version: z.number().int().positive()
}).strict();
const exportRequirementDesignAssetSchema = rejectForbiddenPathFields(z.object({
  product_id: nonEmptyStringSchema,
  requirement_id: nonEmptyStringSchema,
  kind: z.enum(["canvas", "preview"]),
  page_id: nonEmptyStringSchema.optional(),
  ...forbiddenPathFieldSchemas
}).strict());
const indexComponentUsagesSchema = z.object({
  product_id: nonEmptyStringSchema,
  requirement_id: nonEmptyStringSchema,
  write: z.boolean().optional()
}).strict();
const refreshRequirementComponentsSchema = rejectForbiddenPathFields(z.object({
  session_id: nonEmptyStringSchema,
  product_id: nonEmptyStringSchema,
  requirement_id: nonEmptyStringSchema,
  version: z.union([z.literal("latest"), z.number().int().positive()]).optional(),
  scope: componentRefreshScopeSchema.optional(),
  ...forbiddenPathFieldSchemas
}).strict());
const sessionProductRequirementPageFrameSchema = rejectForbiddenPathFields(z.object({
  session_id: nonEmptyStringSchema,
  product_id: nonEmptyStringSchema,
  requirement_id: nonEmptyStringSchema,
  page_id: nonEmptyStringSchema,
  frame_id: nonEmptyStringSchema,
  ...forbiddenPathFieldSchemas
}).strict());
const sessionBaseSchema = {
  session_id: nonEmptyStringSchema,
  pencil_binding_id: nonEmptyStringSchema.optional()
};
const sessionGetEditorStateSchema = rejectForbiddenPathFields(z.object({
  ...sessionBaseSchema,
  include_schema: z.boolean(),
  ...forbiddenPathFieldSchemas
}).strict());
const sessionGetGuidelinesSchema = rejectForbiddenPathFields(z.object({
  ...sessionBaseSchema,
  category: z.enum(["guide", "style"]).optional(),
  name: nonEmptyStringSchema.optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  ...forbiddenPathFieldSchemas
}).strict());
const sessionGetVariablesSchema = rejectForbiddenPathFields(z.object({
  ...sessionBaseSchema,
  ...forbiddenPathFieldSchemas
}).strict());
const sessionBatchGetSchema = rejectForbiddenPathFields(z.object({
  ...sessionBaseSchema,
  nodeIds: z.array(nonEmptyStringSchema).optional(),
  parentId: nonEmptyStringSchema.optional(),
  patterns: z.array(z.record(z.string(), z.unknown())).optional(),
  readDepth: z.number().int().nonnegative().optional(),
  searchDepth: z.number().int().nonnegative().optional(),
  resolveInstances: z.boolean().optional(),
  resolveVariables: z.boolean().optional(),
  includePathGeometry: z.boolean().optional(),
  ...forbiddenPathFieldSchemas
}).strict());
const sessionSnapshotLayoutSchema = rejectForbiddenPathFields(z.object({
  ...sessionBaseSchema,
  parentId: nonEmptyStringSchema.optional(),
  problemsOnly: z.boolean().optional(),
  maxDepth: z.number().int().positive().optional(),
  ...forbiddenPathFieldSchemas
}).strict());
const sessionGetScreenshotSchema = rejectForbiddenPathFields(z.object({
  ...sessionBaseSchema,
  nodeId: nonEmptyStringSchema,
  ...forbiddenPathFieldSchemas
}).strict());
const sessionExportNodesSchema = rejectForbiddenPathFields(z.object({
  ...sessionBaseSchema,
  nodeIds: z.array(nonEmptyStringSchema).min(1),
  format: z.enum(["png", "jpeg", "webp", "pdf"]).optional(),
  scale: z.number().positive().optional(),
  quality: z.number().min(0).max(1).optional(),
  ...forbiddenPathFieldSchemas
}).strict());

export const formaToolInputSchemas = {
  help: emptySchema,
  list_products: emptySchema,
  get_product: productIdSchema,
  delete_product: deleteProductSchema,
  get_product_baseline: productIdSchema,
  get_baseline_page: baselinePageSchema,
  get_baseline_image: baselinePageSchema,
  get_requirement_history: productIdSchema,
  get_requirement: getRequirementSchema,
  get_product_rules: productIdSchema,
  get_page_copy: getPageCopySchema,
  update_page_copy: updatePageCopySchema,
  get_current_session: emptySchema,
  set_current_session: productIdSchema,
  init_product_config: productConfigSchema,
  update_product_config: productConfigSchema,
  list_styles: emptySchema,
  get_style: styleNameSchema,
  save_requirement: saveRequirementSchema,
  begin_requirement_design_session: beginRequirementDesignSessionSchema,
  apply_requirement_design_operations: applyRequirementDesignOperationsSchema,
  commit_requirement_design_session: commitRequirementDesignSessionSchema,
  discard_requirement_design_session: sessionIdInputSchema,
  recover_design_commit_journal: recoverDesignCommitJournalSchema,
  begin_product_component_session: beginProductComponentSessionSchema,
  apply_product_component_operations: applyProductComponentOperationsSchema,
  commit_product_component_session: sessionIdInputSchema,
  discard_product_component_session: sessionIdInputSchema,
  get_requirement_design_canvas: productRequirementSchema,
  index_requirement_design_canvas: productRequirementSchema,
  get_requirement_design_scene: productRequirementSchema,
  get_requirement_design_history: productRequirementSchema,
  rollback_requirement_design: rollbackRequirementDesignSchema,
  diff_requirement_design_versions: diffRequirementDesignVersionsSchema,
  export_requirement_design_asset: exportRequirementDesignAssetSchema,
  get_product_component_library: productIdSchema,
  index_component_usages: indexComponentUsagesSchema,
  refresh_requirement_components: refreshRequirementComponentsSchema,
  plan_import_metadata_normalization: sessionProductRequirementPageFrameSchema,
  validate_requirement_design_quality: sessionProductRequirementPageFrameSchema,
  session_get_editor_state: sessionGetEditorStateSchema,
  session_get_guidelines: sessionGetGuidelinesSchema,
  session_get_variables: sessionGetVariablesSchema,
  session_batch_get: sessionBatchGetSchema,
  session_snapshot_layout: sessionSnapshotLayoutSchema,
  session_get_screenshot: sessionGetScreenshotSchema,
  session_export_nodes: sessionExportNodesSchema
} satisfies Record<FormaToolName, z.ZodType>;

const descriptions = {
  help: "List available Forma MCP tools.",
  list_products: "List Forma products.",
  get_product: "Read a product.",
  delete_product: "Delete a product after explicit id confirmation.",
  get_product_baseline: "Read a product functional baseline.",
  get_baseline_page: "Read one baseline page.",
  get_baseline_image: "Read deterministic metadata for the latest preview backing a baseline page.",
  get_requirement_history: "List product requirement history.",
  get_requirement: "Read a requirement by id or latest product requirement.",
  get_product_rules: "Read product-level behavioral rules.",
  get_page_copy: "Read source copy and translations for a requirement page.",
  update_page_copy: "Update translations for a requirement page.",
  get_current_session: "Read the current product session.",
  set_current_session: "Set the current product session.",
  init_product_config: "Write platform, style, and language configuration for an existing product.",
  update_product_config: "Update platform, style, and language configuration for a product.",
  list_styles: "List installed styles.",
  get_style: "Read style metadata and design guidance.",
  save_requirement: "Create or update a requirement through the unified state machine.",
  begin_requirement_design_session: "Begin a requirement-level design session.",
  apply_requirement_design_operations: "Apply controlled operations to a requirement design session.",
  commit_requirement_design_session: "Commit a requirement design session.",
  discard_requirement_design_session: "Discard a requirement design session.",
  recover_design_commit_journal: "Recover a failed design commit journal.",
  begin_product_component_session: "Begin a product component library session.",
  apply_product_component_operations: "Apply controlled operations to a product component session.",
  commit_product_component_session: "Commit a product component session.",
  discard_product_component_session: "Discard a product component session.",
  get_requirement_design_canvas: "Read requirement-level design canvas metadata.",
  index_requirement_design_canvas: "Index a requirement design canvas.",
  get_requirement_design_scene: "Read a requirement design scene model.",
  get_requirement_design_history: "Read requirement design history.",
  rollback_requirement_design: "Roll back requirement design metadata to a previous canvas version.",
  diff_requirement_design_versions: "Diff two requirement design versions.",
  export_requirement_design_asset: "Export a requirement design asset.",
  get_product_component_library: "Read a product component library.",
  index_component_usages: "Index component usage in a requirement design canvas.",
  refresh_requirement_components: "Plan component refresh operations for a requirement design session.",
  plan_import_metadata_normalization: "Plan metadata normalization operations for imported content.",
  validate_requirement_design_quality: "Run deterministic requirement design quality checks.",
  session_get_editor_state: "Read editor state for a Forma-owned Pencil session.",
  session_get_guidelines: "Read guidelines for a Forma-owned Pencil session.",
  session_get_variables: "Read variables for a Forma-owned Pencil session.",
  session_batch_get: "Read multiple nodes for a Forma-owned Pencil session.",
  session_snapshot_layout: "Snapshot layout for a Forma-owned Pencil session.",
  session_get_screenshot: "Capture a screenshot for a Forma-owned Pencil session.",
  session_export_nodes: "Export nodes for a Forma-owned Pencil session."
} satisfies Record<FormaToolName, string>;

export function createFormaTools(store: FormaStore): FormaTools {
  const v6 = getV6Services(store);
  return {
    help: tool("help", async () => ({
      tools: formaToolNames,
      usage_guide: {
        guidance: [
          "Use save_requirement for all requirement submissions and updates.",
          "Use get_product_rules to inspect persisted behavioral rules.",
          "Use get_page_copy and update_page_copy for page-level source copy translations."
        ],
        workflows: {
          develop_frontend: [
            "get_requirement",
            "get_product_rules"
          ]
        }
      }
    })),
    list_products: tool("list_products", async () => store.products.listProducts()),
    get_product: tool("get_product", async (input) => store.products.getProduct(input.product_id)),
    delete_product: tool("delete_product", async (input) => store.deleteProduct(input)),
    get_product_baseline: tool("get_product_baseline", async (input) => store.baseline.getProductBaseline(input.product_id)),
    get_baseline_page: tool("get_baseline_page", async (input) => getBaselinePage(store, input.product_id, input.page_id)),
    get_baseline_image: tool("get_baseline_image", async (input) => getBaselineImage(store, input.product_id, input.page_id)),
    get_requirement_history: tool("get_requirement_history", async (input) => store.requirements.getRequirementHistory(input.product_id)),
    get_requirement: tool("get_requirement", async (input) => getRequirementWithCopy(store, input)),
    get_product_rules: tool("get_product_rules", async (input) => store.requirements.getProductRules(input.product_id)),
    get_page_copy: tool("get_page_copy", async (input) => getPageCopy(store, input)),
    update_page_copy: tool("update_page_copy", async (input) => updatePageCopy(store, input)),
    get_current_session: tool("get_current_session", async () => store.sessions.getCurrentSession()),
    set_current_session: tool("set_current_session", async (input) => store.sessions.setCurrentProduct(input.product_id)),
    init_product_config: tool("init_product_config", async (input) => {
      const { product_id: productId, ...config } = input;
      return store.products.initProductConfig(productId, config);
    }),
    update_product_config: tool("update_product_config", async (input) => {
      const { product_id: productId, ...config } = input;
      return store.products.initProductConfig(productId, config);
    }),
    list_styles: tool("list_styles", async () => store.styles.listStyles()),
    get_style: tool("get_style", async (input) => store.styles.getStyle(input.name)),
    save_requirement: tool("save_requirement", async (input) => store.requirements.saveRequirement(input)),
    begin_requirement_design_session: tool("begin_requirement_design_session", async (input) =>
      (v6.beginRequirementDesignSession ?? beginRequirementDesignSession)({ home: store.home, ...input })),
    apply_requirement_design_operations: tool("apply_requirement_design_operations", async (input) =>
      (v6.applyRequirementDesignOperations ?? applyRequirementDesignOperations)({ home: store.home, ...input })),
    commit_requirement_design_session: tool("commit_requirement_design_session", async (input) =>
      v6.commitRequirementDesignSession
        ? v6.commitRequirementDesignSession({ home: store.home, ...input })
        : commitRequirementDesignSessionFromMcp(store, input)),
    discard_requirement_design_session: tool("discard_requirement_design_session", async (input) =>
      (v6.discardRequirementDesignSession ?? discardRequirementDesignSession)({ home: store.home, ...input })),
    recover_design_commit_journal: tool("recover_design_commit_journal", async (input) =>
      (v6.recoverDesignCommitJournal ?? recoverDesignCommitJournal)({ home: store.home, ...input })),
    begin_product_component_session: tool("begin_product_component_session", async (input) =>
      (v6.beginProductComponentSession ?? beginProductComponentSession)({ home: store.home, ...input })),
    apply_product_component_operations: tool("apply_product_component_operations", async (input) =>
      (v6.applyProductComponentOperations ?? applyProductComponentOperations)({ home: store.home, ...input })),
    commit_product_component_session: tool("commit_product_component_session", async (input) =>
      (v6.commitProductComponentSession ?? commitProductComponentSession)({ home: store.home, ...input })),
    discard_product_component_session: tool("discard_product_component_session", async (input) =>
      (v6.discardProductComponentSession ?? discardProductComponentSession)({ home: store.home, ...input })),
    get_requirement_design_canvas: tool("get_requirement_design_canvas", async (input) =>
      (v6.getRequirementDesign ?? getRequirementDesign)(store.home, input.product_id, input.requirement_id)),
    index_requirement_design_canvas: tool("index_requirement_design_canvas", async (input) =>
      (v6.indexRequirementDesignCanvas ?? indexRequirementDesignCanvas)({ home: store.home, ...input })),
    get_requirement_design_scene: tool("get_requirement_design_scene", async (input) =>
      (v6.getRequirementDesignScene ?? getRequirementDesignScene)({ home: store.home, ...input })),
    get_requirement_design_history: tool("get_requirement_design_history", async (input) =>
      (v6.getRequirementDesignHistory ?? getRequirementDesignHistory)({ home: store.home, ...input })),
    rollback_requirement_design: tool("rollback_requirement_design", async (input) =>
      (v6.rollbackRequirementDesign ?? rollbackRequirementDesign)({ home: store.home, ...input })),
    diff_requirement_design_versions: tool("diff_requirement_design_versions", async (input) =>
      (v6.diffRequirementDesignVersions ?? diffRequirementDesignVersions)({ home: store.home, ...input })),
    export_requirement_design_asset: tool("export_requirement_design_asset", async (input) =>
      (v6.exportRequirementDesignAsset ?? exportRequirementDesignAsset)({ home: store.home, ...input })),
    get_product_component_library: tool("get_product_component_library", async (input) =>
      (v6.getProductComponentLibrary ?? getProductComponentLibrary)(store.home, input.product_id)),
    index_component_usages: tool("index_component_usages", async (input) =>
      (v6.indexRequirementComponentUsage ?? indexRequirementComponentUsage)({ home: store.home, ...input })),
    refresh_requirement_components: tool("refresh_requirement_components", async (input) =>
      v6.refreshRequirementComponents
        ? v6.refreshRequirementComponents({ home: store.home, ...input })
        : refreshRequirementComponentsFromMcp(store, input)),
    plan_import_metadata_normalization: tool("plan_import_metadata_normalization", async (input) =>
      (v6.planImportMetadataNormalization ?? planImportMetadataNormalization)({ home: store.home, ...input })),
    validate_requirement_design_quality: tool("validate_requirement_design_quality", async (input) =>
      v6.runDesignQualityPipeline
        ? v6.runDesignQualityPipeline({ home: store.home, ...input })
        : validateRequirementDesignQualityFromMcp(store, input)),
    session_get_editor_state: tool("session_get_editor_state", async (input) =>
      v6.sessionGetEditorState ? v6.sessionGetEditorState({ home: store.home, ...input }) : sessionGetEditorState(store, input)),
    session_get_guidelines: tool("session_get_guidelines", async (input) =>
      v6.sessionGetGuidelines ? v6.sessionGetGuidelines({ home: store.home, ...input }) : sessionGetGuidelines(store, input)),
    session_get_variables: tool("session_get_variables", async (input) =>
      v6.sessionGetVariables ? v6.sessionGetVariables({ home: store.home, ...input }) : sessionGetVariables(store, input)),
    session_batch_get: tool("session_batch_get", async (input) =>
      v6.sessionBatchGet ? v6.sessionBatchGet({ home: store.home, ...input }) : sessionBatchGet(store, input)),
    session_snapshot_layout: tool("session_snapshot_layout", async (input) =>
      v6.sessionSnapshotLayout ? v6.sessionSnapshotLayout({ home: store.home, ...input }) : sessionSnapshotLayout(store, input)),
    session_get_screenshot: tool("session_get_screenshot", async (input) =>
      v6.sessionGetScreenshot ? v6.sessionGetScreenshot({ home: store.home, ...input }) : sessionGetScreenshot(store, input)),
    session_export_nodes: tool("session_export_nodes", async (input) =>
      v6.sessionExportNodes ? v6.sessionExportNodes({ home: store.home, ...input }) : sessionExportNodes(store, input))
  };
}

export function registerFormaTools(server: FormaMcpServerLike, tools: FormaTools): void {
  for (const name of formaToolNames) {
    server.registerTool(
      name,
      {
        title: titleFromToolName(name),
        description: descriptions[name],
        inputSchema: formaToolInputSchemas[name]
      },
      tools[name]
    );
  }
}

export function registerLimitedFormaTools(server: FormaMcpServerLike, state: SchemaNormalizationRecoveryState): void {
  server.registerTool(
    "fm-status",
    {
      title: "Fm Status",
      description: "Read Forma schema normalization startup status.",
      inputSchema: emptySchema
    },
    async () => successResult({ schema_normalization: state })
  );

  for (const name of formaToolNames) {
    server.registerTool(
      name,
      {
        title: titleFromToolName(name),
        description: descriptions[name],
        inputSchema: z.any()
      },
      async () => normalizationBlockedResult(state)
    );
  }
}

function tool<Name extends FormaToolName, Input>(
  name: Name,
  handler: (input: any) => Promise<Input> | Input
): FormaToolHandler {
  const schema = formaToolInputSchemas[name];
  return async (args) => {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      return errorResult(parsed.error);
    }

    try {
      return successResult(await handler(parsed.data));
    } catch (error) {
      return errorResult(error);
    }
  };
}

function getV6Services(store: FormaStore): V6ServiceOverrides {
  return ((store as FormaStore & { v6?: V6ServiceOverrides }).v6 ?? {});
}

async function commitRequirementDesignSessionFromMcp(store: FormaStore, input: z.infer<typeof commitRequirementDesignSessionSchema>) {
  if (!input.page_id || !input.frame_id) {
    throw new ToolError("PENCIL_CAPABILITY_UNAVAILABLE", "Component refresh commit requires a v6 commit service", {
      session_id: input.session_id
    });
  }

  return commitRequirementDesignSession({
    home: store.home,
    session_id: input.session_id,
    page_id: input.page_id,
    frame_id: input.frame_id,
    quality_report: {
      status: "passed",
      hard_checks: { issues: [] },
      warnings: [],
      ai_visual_review: qualityReportAiReview(input.ai_visual_review)
    },
    previewExporter: async (candidate) => {
      await exportPreviewCandidate(store, input.session_id, candidate.frame_id, candidate.output_file);
    }
  });
}

function qualityReportAiReview(input: z.infer<typeof aiVisualReviewSchema> | undefined) {
  if (!input || input.status === "passed") {
    return undefined;
  }
  if (input.status === "warning") {
    return {
      status: "warning" as const,
      metadata: {
        warnings: input.warnings,
        ...(input.screenshot_path ? { screenshot_path: input.screenshot_path } : {})
      }
    };
  }
  return input;
}

async function refreshRequirementComponentsFromMcp(store: FormaStore, input: z.infer<typeof refreshRequirementComponentsSchema>) {
  const scope = input.scope === "all_pages" ? undefined : input.scope;
  return refreshRequirementComponents({
    home: store.home,
    session_id: input.session_id,
    target_component_library_version: typeof input.version === "number" ? input.version : undefined,
    page_ids: scope?.page_ids
  });
}

async function validateRequirementDesignQualityFromMcp(store: FormaStore, input: z.infer<typeof sessionProductRequirementPageFrameSchema>) {
  const session = await findMcpSessionRecord(store.home, input.session_id);
  const quality_report = await runDesignQualityPipeline({ pen_file: session.staging_path });
  return {
    session_id: input.session_id,
    product_id: input.product_id,
    requirement_id: input.requirement_id,
    page_id: input.page_id,
    frame_id: input.frame_id,
    quality_report
  };
}

function sessionAdapter(store: FormaStore): PencilAppSessionAdapter {
  return new PencilAppSessionAdapter({ home: store.home, runner: defaultPencilRunner });
}

async function sessionBindingContext(home: string, adapter: PencilAppSessionAdapter, input: { session_id: string; pencil_binding_id?: string }): Promise<{ bindingId: string; expectedStagingPath: string }> {
  const record = await findMcpSessionRecord(home, input.session_id);
  const bindingId = input.pencil_binding_id ?? record.pencil_binding_id;
  const binding = adapter.getBinding(bindingId);
  if (binding && binding.session_id !== input.session_id) {
    throw new ToolError("PENCIL_APP_REQUIRED", "Pencil binding does not belong to this session", {
      session_id: input.session_id,
      pencil_binding_id: bindingId
    });
  }
  return { bindingId, expectedStagingPath: record.staging_path };
}

function sessionToolArgs(input: Record<string, unknown>): Record<string, unknown> {
  const { session_id: _sessionId, pencil_binding_id: _bindingId, ...args } = input;
  return args;
}

async function sessionGetEditorState(store: FormaStore, input: z.infer<typeof sessionGetEditorStateSchema>) {
  const adapter = sessionAdapter(store);
  const context = await sessionBindingContext(store.home, adapter, input);
  return adapter.sessionGetEditorState(context.bindingId, { include_schema: true }, context.expectedStagingPath);
}

async function sessionGetGuidelines(store: FormaStore, input: z.infer<typeof sessionGetGuidelinesSchema>) {
  if (!input.category || !input.name) {
    throw new ToolError("INVALID_INPUT", "category and name are required", { session_id: input.session_id });
  }
  const adapter = sessionAdapter(store);
  const context = await sessionBindingContext(store.home, adapter, input);
  return adapter.sessionGetGuidelines(context.bindingId, {
    category: input.category,
    name: input.name
  }, context.expectedStagingPath);
}

async function sessionGetVariables(store: FormaStore, input: z.infer<typeof sessionGetVariablesSchema>) {
  const adapter = sessionAdapter(store);
  const context = await sessionBindingContext(store.home, adapter, input);
  return adapter.sessionGetVariables(context.bindingId, context.expectedStagingPath);
}

async function sessionBatchGet(store: FormaStore, input: z.infer<typeof sessionBatchGetSchema>) {
  const adapter = sessionAdapter(store);
  const context = await sessionBindingContext(store.home, adapter, input);
  return adapter.sessionBatchGet(context.bindingId, sessionToolArgs(input), context.expectedStagingPath);
}

async function sessionSnapshotLayout(store: FormaStore, input: z.infer<typeof sessionSnapshotLayoutSchema>) {
  if (!input.parentId) {
    throw new ToolError("INVALID_INPUT", "parentId is required", { session_id: input.session_id });
  }
  const adapter = sessionAdapter(store);
  const context = await sessionBindingContext(store.home, adapter, input);
  return adapter.sessionSnapshotLayout(context.bindingId, {
    problemsOnly: false,
    parentId: input.parentId,
    maxDepth: 8
  }, context.expectedStagingPath);
}

async function sessionGetScreenshot(store: FormaStore, input: z.infer<typeof sessionGetScreenshotSchema>) {
  const adapter = sessionAdapter(store);
  const context = await sessionBindingContext(store.home, adapter, input);
  return adapter.sessionGetScreenshot(context.bindingId, sessionToolArgs(input), context.expectedStagingPath);
}

async function sessionExportNodes(store: FormaStore, input: z.infer<typeof sessionExportNodesSchema>) {
  const adapter = sessionAdapter(store);
  const context = await sessionBindingContext(store.home, adapter, input);
  return adapter.sessionExportNodes(context.bindingId, sessionToolArgs(input), context.expectedStagingPath);
}

async function exportPreviewCandidate(store: FormaStore, sessionId: string, frameId: string, outputFile: string): Promise<void> {
  const adapter = sessionAdapter(store);
  const context = await sessionBindingContext(store.home, adapter, { session_id: sessionId });
  const result = await adapter.sessionExportNodes(context.bindingId, {
    nodeIds: [frameId],
    format: "png",
    scale: 2
  }, context.expectedStagingPath);
  const source = exportedFilePath(result);
  if (!source) {
    throw new FormaError("PREVIEW_EXPORT_FAILED", "Preview export did not return a file path", {
      session_id: sessionId,
      frame_id: frameId
    });
  }
  await copyFile(source, outputFile);
}

function exportedFilePath(result: unknown): string | undefined {
  if (!isRecord(result) || !Array.isArray(result.files)) {
    return undefined;
  }
  const first = result.files[0];
  return isRecord(first) && typeof first.path === "string" ? first.path : undefined;
}

async function findMcpSessionRecord(home: string, sessionId: string): Promise<{
  session_id: string;
  pencil_binding_id: string;
  staging_path: string;
}> {
  const files = await candidateSessionFiles(home, sessionId);
  for (const file of files) {
    if (!await fileExists(file)) {
      continue;
    }
    const record = await readYaml<Record<string, unknown>>(file);
    if (record.session_id !== sessionId) {
      continue;
    }
    if (typeof record.pencil_binding_id !== "string" || typeof record.staging_path !== "string") {
      throw new FormaError("INVALID_INPUT", "Session record is missing Pencil binding metadata", { session_id: sessionId });
    }
    return {
      session_id: sessionId,
      pencil_binding_id: record.pencil_binding_id,
      staging_path: resolveSessionRecordPath(home, record.staging_path)
    };
  }
  throw new FormaError("INVALID_INPUT", "Session record was not found", { session_id: sessionId });
}

function resolveSessionRecordPath(home: string, path: string): string {
  return isAbsolute(path) ? path : join(home, path);
}

async function candidateSessionFiles(home: string, sessionId: string): Promise<string[]> {
  const files: string[] = [];
  const dataDir = join(home, "data");
  for (const productId of await safeReaddir(dataDir)) {
    const productDir = join(dataDir, productId);
    for (const requirementId of await safeReaddir(productDir)) {
      if (requirementId === "sessions" || requirementId.startsWith("D-")) {
        continue;
      }
      files.push(join(productDir, requirementId, "sessions", sessionId, "design_session.yaml"));
    }
  }
  const libraryDir = join(home, "library");
  for (const entry of await safeReaddir(libraryDir)) {
    if (entry.endsWith(".sessions")) {
      files.push(join(libraryDir, entry, sessionId, "design_session.yaml"));
    }
  }
  return files;
}

async function safeReaddir(path: string): Promise<string[]> {
  return readdir(path).catch(() => []);
}

async function fileExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

function successResult(data: unknown): FormaToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function errorResult(error: unknown): FormaToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(toFormaErrorPayload(error)) }] };
}

function normalizationBlockedResult(state: SchemaNormalizationRecoveryState): FormaToolResult {
  const preflight = state.code === "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED";
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error_code: preflight ? "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED" : "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
          message: preflight ? "Schema normalization preflight required" : "Schema normalization recovery required",
          details: state
        })
      }
    ]
  };
}

function toFormaErrorPayload(error: unknown): { error_code: string; message: string; details: Record<string, unknown> } {
  if (error instanceof FormaError) {
    return error.toJSON();
  }
  if (error instanceof ToolError) {
    return { error_code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof z.ZodError) {
    const forbiddenPathIssue = error.issues.find((issue) => issue.message === "FORBIDDEN_PATH_PARAMETER");
    if (forbiddenPathIssue) {
      return {
        error_code: "FORBIDDEN_PATH_PARAMETER",
        message: "Pencil file paths are session-owned",
        details: { parameter: forbiddenPathIssue.path.join(".") }
      };
    }
    return { error_code: "VALIDATION_ERROR", message: "Invalid tool input", details: { issues: error.issues } };
  }
  return { error_code: "INTERNAL_ERROR", message: "Unexpected tool error", details: {} };
}

async function getRequirementWithCopy(store: FormaStore, input: z.infer<typeof getRequirementSchema>) {
  const requirement = input.requirement_id
    ? await store.requirements.getRequirement({ requirement_id: input.requirement_id })
    : await store.requirements.getRequirement({ product_id: input.product_id! });
  const copyTranslations = await store.copy.getTranslations(requirement.product_id, requirement.id);
  return { ...requirement, copy_translations: copyTranslations };
}

async function getPageCopy(store: FormaStore, input: z.infer<typeof getPageCopySchema>) {
  const requirement = input.requirement_id
    ? await getProductRequirement(store, input.product_id, input.requirement_id)
    : await getLatestNonArchivedRequirement(store, input.product_id);
  const page = requirement.pages.find((item) => item.page_id === input.page_id);
  if (!page) {
    throw new ToolError("REQUIREMENT_PAGE_NOT_FOUND", "Requirement page not found", {
      product_id: input.product_id,
      requirement_id: requirement.id,
      page_id: input.page_id
    });
  }

  const translations = await store.copy.getTranslations(requirement.product_id, requirement.id);
  return {
    product_id: requirement.product_id,
    requirement_id: requirement.id,
    page_id: input.page_id,
    copy: page.copy ?? [],
    translations: translations.find((item) => item.page_id === input.page_id) ?? { page_id: input.page_id, entries: [] }
  };
}

async function updatePageCopy(store: FormaStore, input: z.infer<typeof updatePageCopySchema>) {
  const requirement = await store.requirements.getRequirement({ requirement_id: input.requirement_id });
  if (!requirement.pages.some((page) => page.page_id === input.page_id)) {
    throw new ToolError("REQUIREMENT_PAGE_NOT_FOUND", "Requirement page not found", {
      product_id: requirement.product_id,
      requirement_id: requirement.id,
      page_id: input.page_id
    });
  }

  await store.copy.updatePageTranslations(requirement.product_id, requirement.id, input.page_id, input.translations);
  return store.copy.getTranslations(requirement.product_id, requirement.id);
}

async function getProductRequirement(store: FormaStore, productId: string, requirementId: string) {
  const requirement = await store.requirements.getRequirement({ requirement_id: requirementId });
  if (requirement.product_id !== productId) {
    throw new ToolError("REQUIREMENT_PRODUCT_MISMATCH", "Requirement does not belong to product", {
      product_id: productId,
      requirement_id: requirementId,
      requirement_product_id: requirement.product_id
    });
  }

  return requirement;
}

async function getLatestNonArchivedRequirement(store: FormaStore, productId: string) {
  const requirements = store.requirements;
  if (typeof requirements.getLatestRequirement === "function") {
    return requirements.getLatestRequirement(productId);
  }

  const latest = (await store.requirements.getRequirementHistory(productId))
    .filter((requirement) => requirement.status !== "archived")
    .sort(compareRequirementsNewestFirst)[0];
  if (!latest) {
    throw new ToolError("REQUIREMENT_NOT_FOUND", "Requirement not found", { product_id: productId });
  }

  return latest;
}

async function getBaselinePage(store: FormaStore, productId: string, pageId: string) {
  const baseline = await store.baseline.getProductBaseline(productId);
  const page = baseline.pages.find((item) => item.id === pageId || ("page_id" in item && item.page_id === pageId));
  if (!page) {
    throw new ToolError("BASELINE_PAGE_NOT_FOUND", "Baseline page not found", { product_id: productId, page_id: pageId });
  }
  return page;
}

async function getBaselineImage(store: FormaStore, productId: string, pageId: string) {
  const baselinePage = await getBaselinePage(store, productId, pageId);
  const preview = await findBaselinePreviewMetadata(store, productId, pageId);
  if (preview) {
    return preview;
  }

  throw new ToolError("BASELINE_IMAGE_NOT_FOUND", "Baseline image not found", {
    product_id: productId,
    page_id: pageId,
    source_requirements: baselinePage.source_requirements
  });
}

function compareRequirementsNewestFirst(
  left: { id: string; created_at?: string; updated_at?: string },
  right: { id: string; created_at?: string; updated_at?: string }
): number {
  return timestampForRequirement(right) - timestampForRequirement(left) || right.id.localeCompare(left.id);
}

function timestampForRequirement(requirement: { created_at?: string; updated_at?: string }): number {
  const updatedAt = requirement.updated_at ? Date.parse(requirement.updated_at) : Number.NaN;
  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }
  const createdAt = requirement.created_at ? Date.parse(requirement.created_at) : Number.NaN;
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function titleFromToolName(name: string): string {
  return name.split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

class ToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown>
  ) {
    super(message);
    this.name = "ToolError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectForbiddenPathFields<Schema extends z.ZodType>(schema: Schema): Schema {
  return schema.superRefine((value, context) => {
    addForbiddenPathIssues(value, context);
  }) as Schema;
}

function addForbiddenPathIssues(value: unknown, context: z.RefinementCtx, path: Array<string | number> = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => addForbiddenPathIssues(item, context, [...path, index]));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenPathFieldNames.has(key)) {
      context.addIssue({
        code: "custom",
        message: "FORBIDDEN_PATH_PARAMETER",
        path: [...path, key]
      });
      continue;
    }
    addForbiddenPathIssues(nested, context, [...path, key]);
  }
}
