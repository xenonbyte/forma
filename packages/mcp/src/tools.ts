import { access } from "node:fs/promises";
import { join } from "node:path";
import { FormaError, PencilService, type createFormaStore } from "@xenonbyte/forma-core";
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
  "get_current_session",
  "set_current_session",
  "init_product_config",
  "complete_product_init",
  "update_product_config",
  "list_styles",
  "get_style",
  "submit_requirement",
  "update_requirement",
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
  copy: z.string().optional(),
  fields: z.string().optional(),
  interactions: z.string().optional()
}).strict();
const navigationInputSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional()
}).strict();
const submitRequirementSchema = z.union([
  z.object({
    requirement_id: z.string().min(1),
    document_md: z.string(),
    pages: z.array(requirementPageInputSchema),
    navigation: z.array(navigationInputSchema)
  }).strict(),
  z.object({
    product_id: z.string().min(1),
    title: z.string().min(1),
    document_md: z.string(),
    pages: z.array(requirementPageInputSchema),
    navigation: z.array(navigationInputSchema)
  }).strict()
]);
const updateRequirementSchema = z.object({
  requirement_id: z.string().min(1),
  document_md: z.string(),
  pages: z.array(requirementPageInputSchema),
  navigation: z.array(navigationInputSchema),
  expired_pages: z.array(z.string().min(1))
}).strict();
const getRequirementSchema = z.union([
  z.object({ requirement_id: z.string().min(1) }).strict(),
  z.object({ product_id: z.string().min(1) }).strict()
]);
const productConfigSchema = z.object({
  product_id: z.string().min(1),
  platform: z.enum(["mobile", "desktop", "tablet", "web"]),
  style: styleMetadataSchema
}).strict();
const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string()
}).strict();
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
  get_current_session: emptySchema,
  set_current_session: productIdSchema,
  init_product_config: createProductSchema,
  complete_product_init: productIdSchema,
  update_product_config: productConfigSchema,
  list_styles: emptySchema,
  get_style: styleNameSchema,
  submit_requirement: submitRequirementSchema,
  update_requirement: updateRequirementSchema,
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
  get_current_session: "Read the current product session.",
  set_current_session: "Set the current product session.",
  init_product_config: "Create a product record before configuration.",
  complete_product_init: "Mark product components as initialized.",
  update_product_config: "Update platform and style configuration for a product.",
  list_styles: "List installed styles.",
  get_style: "Read style metadata and design guidance.",
  submit_requirement: "Submit a new or existing requirement.",
  update_requirement: "Update a submitted or active requirement.",
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
    help: tool("help", async () => ({ tools: formaToolNames })),
    list_products: tool("list_products", async () => store.products.listProducts()),
    get_product: tool("get_product", async (input) => store.products.getProduct(input.product_id)),
    get_product_baseline: tool("get_product_baseline", async (input) => store.baseline.getProductBaseline(input.product_id)),
    get_baseline_page: tool("get_baseline_page", async (input) => getBaselinePage(store, input.product_id, input.page_id)),
    get_baseline_image: tool("get_baseline_image", async (input) => getBaselineImage(store, input.product_id, input.page_id)),
    get_requirement_history: tool("get_requirement_history", async (input) => store.requirements.getRequirementHistory(input.product_id)),
    get_requirement: tool("get_requirement", async (input) => store.requirements.getRequirement(input)),
    get_current_session: tool("get_current_session", async () => store.sessions.getCurrentSession()),
    set_current_session: tool("set_current_session", async (input) => store.sessions.setCurrentProduct(input.product_id)),
    init_product_config: tool("init_product_config", async (input) => store.products.createProduct(input)),
    complete_product_init: tool("complete_product_init", async (input) => store.products.markComponentsInitialized(input.product_id)),
    update_product_config: tool("update_product_config", async (input) => {
      const { product_id: productId, ...config } = input;
      return store.products.initProductConfig(productId, config);
    }),
    list_styles: tool("list_styles", async () => store.styles.listStyles()),
    get_style: tool("get_style", async (input) => store.styles.getStyle(input.name)),
    submit_requirement: tool("submit_requirement", async (input) => {
      if ("requirement_id" in input) {
        return store.requirements.submitRequirement(input);
      }
      const requirement = await store.requirements.createEmptyRequirement(input.product_id, input.title);
      return store.requirements.submitRequirement({
        requirement_id: requirement.id,
        document_md: input.document_md,
        pages: input.pages,
        navigation: input.navigation
      });
    }),
    update_requirement: tool("update_requirement", async (input) => store.requirements.updateRequirement(input)),
    generate_page_design: tool("generate_page_design", async (input) => pencil.generatePageDesign(input)),
    generate_components: tool("generate_components", async (input) => pencil.generateComponents(input)),
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

async function getBaselinePage(store: FormaStore, productId: string, pageId: string) {
  const baseline = await store.baseline.getProductBaseline(productId);
  const page = baseline.pages.find((item) => item.id === pageId || ("page_id" in item && item.page_id === pageId));
  if (!page) {
    throw new ToolError("BASELINE_PAGE_NOT_FOUND", "Baseline page not found", { product_id: productId, page_id: pageId });
  }
  return page;
}

async function getBaselineImage(store: FormaStore, productId: string, pageId: string) {
  await getBaselinePage(store, productId, pageId);
  const requirement = await store.requirements.getRequirement({ product_id: productId });
  const page = requirement.pages.find((item) => item.baseline_page === pageId || item.page_id === pageId);
  if (!page?.design_id || page.design_status !== "done") {
    throw new ToolError("BASELINE_IMAGE_NOT_FOUND", "Baseline image not found", { product_id: productId, page_id: pageId });
  }

  const previewPath = join(store.home, "data", productId, requirement.id, page.design_id, "preview@2x.png");
  if (!(await fileExists(previewPath))) {
    throw new ToolError("BASELINE_IMAGE_NOT_FOUND", "Baseline image not found", {
      product_id: productId,
      page_id: pageId,
      requirement_id: requirement.id,
      design_id: page.design_id
    });
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
