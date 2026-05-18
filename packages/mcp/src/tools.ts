import { access } from "node:fs/promises";
import { join } from "node:path";
import { assertProductConfig, FormaError, languages, PencilService, platforms, type createFormaStore } from "@xenonbyte/forma-core";
import * as z from "zod/v4";

export const formaToolNames = [
  "help",
  "list_products",
  "get_product",
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
  "complete_product_init",
  "update_product_config",
  "list_styles",
  "get_style",
  "save_requirement",
  "generate_page_design",
  "generate_components",
  "save_designs",
  "rollback_design",
  "diff_designs",
  "get_design_annotations",
  "export_design_asset"
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
export type FormaStore = ReturnType<typeof createFormaStore>;

export interface FormaPencilService {
  generatePageDesign(input: { product_id: string; prompt: string; workspace: string }): Promise<unknown>;
  generateComponents(input: { product_id: string; prompt: string; workspace: string }): Promise<unknown>;
}

export interface CreateFormaToolsOptions {
  pencil?: FormaPencilService;
}

export interface FormaMcpServerLike {
  registerTool(name: string, config: { title: string; description: string; inputSchema: z.ZodType }, handler: FormaToolHandler): unknown;
}

const emptySchema = z.object({}).strict();
const productIdSchema = z.object({ product_id: z.string().min(1) }).strict();
const requirementIdSchema = z.object({ requirement_id: z.string().min(1) }).strict();
const designIdSchema = z.object({ design_id: z.string().min(1) }).strict();
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
const ruleInputSchema = z.object({
  id: z.string().min(1),
  page_id: z.string().min(1).optional(),
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1),
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
const getRequirementSchema = z.union([
  z.object({ requirement_id: z.string().min(1) }).strict(),
  z.object({ product_id: z.string().min(1) }).strict()
]);
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
const pencilGenerationSchema = z.object({
  product_id: z.string().min(1),
  prompt: z.string().min(1),
  workspace: z.string().min(1)
}).strict();
const componentGenerationSchema = z.object({
  product_id: z.string().min(1),
  prompt: z.string().min(1),
  workspace: z.string().min(1)
}).strict();
const saveDesignInputSchema = z.object({
  page_id: z.string().min(1),
  pen_path: z.string().min(1),
  preview_path: z.string().min(1),
  mode: z.enum(["generate", "update", "refine"]).optional()
}).strict();
const saveDesignsSchema = z.object({
  requirement_id: z.string().min(1),
  designs: z.array(saveDesignInputSchema)
}).strict();
const diffDesignsSchema = z.object({
  design_id: z.string().min(1),
  v1: z.number().int().positive(),
  v2: z.number().int().positive()
}).strict();
const exportDesignAssetSchema = z.object({
  design_id: z.string().min(1),
  node_id: z.string().min(1),
  format: z.enum(["png", "svg", "pdf"])
}).strict();
const styleNameSchema = z.object({ name: z.string().min(1) }).strict();

export const formaToolInputSchemas = {
  help: emptySchema,
  list_products: emptySchema,
  get_product: productIdSchema,
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
  complete_product_init: productIdSchema,
  update_product_config: productConfigSchema,
  list_styles: emptySchema,
  get_style: styleNameSchema,
  save_requirement: saveRequirementSchema,
  generate_page_design: pencilGenerationSchema,
  generate_components: componentGenerationSchema,
  save_designs: saveDesignsSchema,
  rollback_design: designIdSchema,
  diff_designs: diffDesignsSchema,
  get_design_annotations: designIdSchema,
  export_design_asset: exportDesignAssetSchema
} satisfies Record<FormaToolName, z.ZodType>;

const descriptions = {
  help: "List available Forma MCP tools.",
  list_products: "List Forma products.",
  get_product: "Read a product.",
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
  complete_product_init: "Mark product components as initialized.",
  update_product_config: "Update platform, style, and language configuration for a product.",
  list_styles: "List installed styles.",
  get_style: "Read style metadata and design guidance.",
  save_requirement: "Create or update a requirement through the unified state machine.",
  generate_page_design: "Generate a page design through Pencil.",
  generate_components: "Generate product components through Pencil.",
  save_designs: "Persist validated design outputs.",
  rollback_design: "Rollback a design to the previous version.",
  diff_designs: "Diff annotations between two design versions.",
  get_design_annotations: "Read design annotations.",
  export_design_asset: "Export a design node asset."
} satisfies Record<FormaToolName, string>;

export function createFormaTools(store: FormaStore, options: CreateFormaToolsOptions = {}): FormaTools {
  const pencil = options.pencil ?? new PencilService({ home: store.home });
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
            "get_design_annotations",
            "export_design_asset",
            "get_product_rules"
          ]
        }
      }
    })),
    list_products: tool("list_products", async () => store.products.listProducts()),
    get_product: tool("get_product", async (input) => store.products.getProduct(input.product_id)),
    get_product_baseline: tool("get_product_baseline", async (input) => store.baseline.getProductBaseline(input.product_id)),
    get_baseline_page: tool("get_baseline_page", async (input) => getBaselinePage(store, input.product_id, input.page_id)),
    get_baseline_image: tool("get_baseline_image", async (input) => getBaselineImage(store, input.product_id, input.page_id)),
    get_requirement_history: tool("get_requirement_history", async (input) => store.requirements.getRequirementHistory(input.product_id)),
    get_requirement: tool("get_requirement", async (input) => getRequirementWithCopyAndDesignMetadata(store, input)),
    get_product_rules: tool("get_product_rules", async (input) => store.requirements.getProductRules(input.product_id)),
    get_page_copy: tool("get_page_copy", async (input) => getPageCopy(store, input)),
    update_page_copy: tool("update_page_copy", async (input) => updatePageCopy(store, input)),
    get_current_session: tool("get_current_session", async () => store.sessions.getCurrentSession()),
    set_current_session: tool("set_current_session", async (input) => store.sessions.setCurrentProduct(input.product_id)),
    init_product_config: tool("init_product_config", async (input) => {
      const { product_id: productId, ...config } = input;
      return store.products.initProductConfig(productId, config);
    }),
    complete_product_init: tool("complete_product_init", async (input) => store.products.markComponentsInitialized(input.product_id)),
    update_product_config: tool("update_product_config", async (input) => {
      const { product_id: productId, ...config } = input;
      return store.products.initProductConfig(productId, config);
    }),
    list_styles: tool("list_styles", async () => store.styles.listStyles()),
    get_style: tool("get_style", async (input) => store.styles.getStyle(input.name)),
    save_requirement: tool("save_requirement", async (input) => store.requirements.saveRequirement(input)),
    generate_page_design: tool("generate_page_design", async (input) => {
      const product = await store.products.getProduct(input.product_id);
      assertProductConfig(product, input.product_id, ["platform", "style", "languages", "components_initialized"]);
      return pencil.generatePageDesign(input);
    }),
    generate_components: tool("generate_components", async (input) => {
      const product = await store.products.getProduct(input.product_id);
      assertProductConfig(product, input.product_id, ["platform", "style", "languages"]);
      return pencil.generateComponents(input);
    }),
    save_designs: tool("save_designs", async (input) => store.designs.saveDesigns(
      input.requirement_id,
      input.designs.map((design: z.infer<typeof saveDesignInputSchema>) => ({
        page_id: design.page_id,
        penPath: design.pen_path,
        previewPath: design.preview_path,
        mode: design.mode
      }))
    )),
    rollback_design: tool("rollback_design", async (input) => store.designs.rollbackDesign(input.design_id)),
    diff_designs: tool("diff_designs", async (input) => store.designs.diffDesigns(input.design_id, input.v1, input.v2)),
    get_design_annotations: tool("get_design_annotations", async (input) => store.designs.getDesignAnnotations(input.design_id)),
    export_design_asset: tool("export_design_asset", async (input) => store.designs.exportDesignAsset(input.design_id, input.node_id, input.format))
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

function successResult(data: unknown): FormaToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function errorResult(error: unknown): FormaToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(toFormaErrorPayload(error)) }] };
}

function toFormaErrorPayload(error: unknown): { error_code: string; message: string; details: Record<string, unknown> } {
  if (error instanceof FormaError) {
    return error.toJSON();
  }
  if (error instanceof ToolError) {
    return { error_code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof z.ZodError) {
    return { error_code: "VALIDATION_ERROR", message: "Invalid tool input", details: { issues: error.issues } };
  }
  return { error_code: "INTERNAL_ERROR", message: "Unexpected tool error", details: {} };
}

async function getRequirementWithCopyAndDesignMetadata(store: FormaStore, input: z.infer<typeof getRequirementSchema>) {
  const requirement = await store.requirements.getRequirement(input);
  const copyTranslations = await store.copy.getTranslations(requirement.product_id, requirement.id);
  const pages = await Promise.all(requirement.pages.map(async (page) => {
    if (!page.design_id) {
      return page;
    }

    try {
      return { ...page, design_metadata: await store.designs.getDesignMetadata(page.design_id) };
    } catch (error) {
      if (isFormaErrorCode(error, "DESIGN_NOT_FOUND")) {
        return page;
      }
      throw error;
    }
  }));

  return { ...requirement, pages, copy_translations: copyTranslations };
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
  const requirements = store.requirements as typeof store.requirements & {
    getLatestRequirement?: (productId: string) => ReturnType<typeof store.requirements.getLatestRequirement>;
  };
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
  const sourceRequirements = new Set(baselinePage.source_requirements);
  const requirements = (await store.requirements.getRequirementHistory(productId))
    .filter((requirement) => sourceRequirements.has(requirement.id))
    .sort(compareRequirementsNewestFirst);

  for (const requirement of requirements) {
    const page = requirement.pages.find((item) => item.baseline_page === pageId);
    if (!page?.design_id) {
      continue;
    }

    const previewPath = await getDesignPreviewPath(store, productId, requirement.id, page.design_id);
    if (!previewPath) {
      continue;
    }

    return {
      product_id: productId,
      baseline_page_id: pageId,
      requirement_id: requirement.id,
      requirement_page_id: page.page_id,
      design_id: page.design_id,
      preview_path: previewPath
    };
  }

  throw new ToolError("BASELINE_IMAGE_NOT_FOUND", "Baseline image not found", {
    product_id: productId,
    page_id: pageId,
    source_requirements: baselinePage.source_requirements
  });
}

async function getDesignPreviewPath(store: FormaStore, productId: string, requirementId: string, designId: string): Promise<string | undefined> {
  try {
    const metadata = await store.designs.getDesignMetadata(designId);
    if (isRecord(metadata) && typeof metadata.preview_path === "string" && await fileExists(metadata.preview_path)) {
      return metadata.preview_path;
    }
  } catch (error) {
    if (!isFormaErrorCode(error, "DESIGN_NOT_FOUND")) {
      throw error;
    }
  }

  const previewPath = join(store.home, "data", productId, requirementId, designId, "preview@2x.png");
  return (await fileExists(previewPath)) ? previewPath : undefined;
}

function compareRequirementsNewestFirst(
  left: { id: string; created_at?: string; updated_at?: string },
  right: { id: string; created_at?: string; updated_at?: string }
): number {
  return timestampForRequirement(right) - timestampForRequirement(left) || left.id.localeCompare(right.id);
}

function timestampForRequirement(requirement: { created_at?: string; updated_at?: string }): number {
  const updatedAt = requirement.updated_at ? Date.parse(requirement.updated_at) : Number.NaN;
  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }
  const createdAt = requirement.created_at ? Date.parse(requirement.created_at) : Number.NaN;
  return Number.isFinite(createdAt) ? createdAt : 0;
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

function titleFromToolName(name: string): string {
  return name.split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function isFormaErrorCode(error: unknown, code: string): error is FormaError {
  return error instanceof FormaError && error.code === code;
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
