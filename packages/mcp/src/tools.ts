import {
  copyFile,
  mkdir,
  rm
} from "node:fs/promises";
import { join } from "node:path";
import {
  FormaError,
  getArtifactDir,
  getFormaPaths,
  languages,
  platforms,
  type ArtifactManifest,
  type FormaStore,
  type SchemaNormalizationRecoveryState
} from "@xenonbyte/forma-core";
import AdmZip from "adm-zip";
import * as z from "zod/v4";

export const formaToolNames = [
  "help",
  "list_products",
  "get_product",
  "confirm_product_id",
  "delete_product",
  "get_product_baseline",
  "get_baseline_page",
  "get_baseline_image",
  "get_requirement_history",
  "get_requirement",
  "get_product_rules",
  "get_page_copy",
  "init_product_config",
  "update_product_config",
  "list_styles",
  "get_style",
  "save_requirement",
  "list_product_artifacts",
  "get_product_artifact",
  "export_artifact",
  "rollback_requirement_design",
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
type V6ServiceOverrides = Partial<{
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
const listProductArtifactsSchema = z.object({
  product_id: z.string().min(1),
  kind: z.enum(["html", "design-system", "markdown-document", "svg", "image", "preview-only"]).optional(),
  include_superseded: z.boolean().optional()
}).strict();

const getProductArtifactSchema = z.object({
  product_id: z.string().min(1),
  artifact_id: z.string().min(1)
}).strict();

const exportArtifactSchema = z.object({
  product_id: z.string().min(1),
  artifact_id: z.string().min(1),
  format: z.enum(["html", "svg", "png", "zip"])
}).strict();

const rollbackRequirementDesignSchema = z.object({
  product_id: z.string().min(1),
  requirement_id: z.string().min(1),
  target_artifact_id: z.string().min(1)
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
const confirmProductIdSchema = z.object({
  product_id: z.string().min(1),
  expected_name: z.string().optional()
}).strict();
const getStyleSchema = z.object({ product_id: z.string().min(1) }).strict();
const nonEmptyStringSchema = z.string().min(1);
const sessionIdSchema = z.string().regex(/^S-[a-f0-9]{16}$/);
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
const sessionBaseSchema = {
  session_id: sessionIdSchema
};
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
  confirm_product_id: confirmProductIdSchema,
  delete_product: deleteProductSchema,
  get_product_baseline: productIdSchema,
  get_baseline_page: baselinePageSchema,
  get_baseline_image: productIdSchema,
  get_requirement_history: productIdSchema,
  get_requirement: getRequirementSchema,
  get_product_rules: productIdSchema,
  get_page_copy: getPageCopySchema,
  init_product_config: productConfigSchema,
  update_product_config: productConfigSchema,
  list_styles: emptySchema,
  get_style: getStyleSchema,
  save_requirement: saveRequirementSchema,
  list_product_artifacts: listProductArtifactsSchema,
  get_product_artifact: getProductArtifactSchema,
  export_artifact: exportArtifactSchema,
  rollback_requirement_design: rollbackRequirementDesignSchema,
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
  confirm_product_id: "Confirm that a product id exists and optionally verify its name.",
  delete_product: "Delete a product after explicit id confirmation.",
  get_product_baseline: "Read the design-system artifact manifest for a product.",
  get_baseline_page: "Read one baseline page from the design-system artifact.",
  get_baseline_image: "Get the preview image path for the design-system artifact.",
  get_requirement_history: "List product requirement history.",
  get_requirement: "Read a requirement by id or latest product requirement.",
  get_product_rules: "Read product-level behavioral rules.",
  get_page_copy: "Read source copy and translations for a requirement page.",
  init_product_config: "Write platform, style, and language configuration for an existing product.",
  update_product_config: "Update platform, style, and language configuration for a product.",
  list_styles: "List installed styles.",
  get_style: "Read design token metadata from the product design-system artifact.",
  save_requirement: "Create or update a requirement through the unified state machine.",
  list_product_artifacts: "List open-design artifacts for a product.",
  get_product_artifact: "Read an open-design artifact manifest and supporting file list.",
  export_artifact: "Export an open-design artifact to html, svg, png, or zip.",
  rollback_requirement_design: "Rewind the requirement artifact pointer to a previous artifact.",
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
          "Use get_page_copy to inspect page-level source copy translations."
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
    confirm_product_id: tool("confirm_product_id", async (input) => confirmProductId(store, input)),
    delete_product: tool("delete_product", async (input) => store.deleteProduct(input)),
    get_product_baseline: tool("get_product_baseline", async (input) => getProductBaseline(store, input.product_id)),
    get_baseline_page: tool("get_baseline_page", async (input) => getBaselinePage(store, input.product_id, input.page_id)),
    get_baseline_image: tool("get_baseline_image", async (input) => getBaselineImage(store, input.product_id)),
    get_requirement_history: tool("get_requirement_history", async (input) => store.requirements.getRequirementHistory(input.product_id)),
    get_requirement: tool("get_requirement", async (input) => getRequirementWithCopy(store, input)),
    get_product_rules: tool("get_product_rules", async (input) => store.requirements.getProductRules(input.product_id)),
    get_page_copy: tool("get_page_copy", async (input) => getPageCopy(store, input)),
    init_product_config: tool("init_product_config", async (input) => {
      const { product_id: productId, ...config } = input;
      return store.products.initProductConfig(productId, config);
    }),
    update_product_config: tool("update_product_config", async (input) => {
      const { product_id: productId, ...config } = input;
      return store.products.initProductConfig(productId, config);
    }),
    list_styles: tool("list_styles", async () => store.styles.listStyles()),
    get_style: tool("get_style", async (input) => getStyle(store, input.product_id)),
    save_requirement: tool("save_requirement", async (input) => store.requirements.saveRequirement(input)),
    list_product_artifacts: tool("list_product_artifacts", async (input) =>
      listProductArtifacts(store, input)),
    get_product_artifact: tool("get_product_artifact", async (input) =>
      getProductArtifact(store, input)),
    export_artifact: tool("export_artifact", async (input) =>
      exportArtifact(store, input)),
    rollback_requirement_design: tool("rollback_requirement_design", async (input) =>
      rollbackRequirementDesign(store, input)),
    session_get_guidelines: tool("session_get_guidelines", async (input) =>
      v6.sessionGetGuidelines ? v6.sessionGetGuidelines({ home: store.home, ...input }) : sessionToolFallback("session_get_guidelines")),
    session_get_variables: tool("session_get_variables", async (input) =>
      v6.sessionGetVariables ? v6.sessionGetVariables({ home: store.home, ...input }) : sessionToolFallback("session_get_variables")),
    session_batch_get: tool("session_batch_get", async (input) =>
      v6.sessionBatchGet ? v6.sessionBatchGet({ home: store.home, ...input }) : sessionToolFallback("session_batch_get")),
    session_snapshot_layout: tool("session_snapshot_layout", async (input) =>
      v6.sessionSnapshotLayout ? v6.sessionSnapshotLayout({ home: store.home, ...input }) : sessionToolFallback("session_snapshot_layout")),
    session_get_screenshot: tool("session_get_screenshot", async (input) =>
      v6.sessionGetScreenshot ? v6.sessionGetScreenshot({ home: store.home, ...input }) : sessionToolFallback("session_get_screenshot")),
    session_export_nodes: tool("session_export_nodes", async (input) =>
      v6.sessionExportNodes ? v6.sessionExportNodes({ home: store.home, ...input }) : sessionToolFallback("session_export_nodes"))
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

// ─── Artifact tool implementations ───────────────────────────────────────────

function artifactPreviewUrl(productId: string, artifactId: string): string {
  return `/api/products/${encodeURIComponent(productId)}/artifacts/${encodeURIComponent(artifactId)}/preview/2x`;
}

async function listProductArtifacts(
  store: FormaStore,
  input: z.infer<typeof listProductArtifactsSchema>
) {
  const { product_id, kind, include_superseded = false } = input;

  const product = await store.products.getProduct(product_id);
  const pointers = product.requirements ?? {};
  const currentPointerIds = new Set(
    Object.values(pointers).map((r) => r.latestArtifactId).filter(Boolean)
  );

  const entries = await store.artifacts.listArtifacts(product_id);
  const artifacts = [];

  for (const { artifactId } of entries) {
    let manifest: ArtifactManifest;
    try {
      ({ manifest } = await store.artifacts.readArtifact(product_id, artifactId));
    } catch {
      continue;
    }

    if (kind !== undefined && manifest.kind !== kind) {
      continue;
    }

    const hasRequirementId = manifest.requirementId !== undefined;
    const isCurrentPointer = currentPointerIds.has(artifactId);
    const superseded = hasRequirementId && !isCurrentPointer;

    if (!include_superseded && superseded) {
      continue;
    }

    artifacts.push({
      id: artifactId,
      kind: manifest.kind,
      title: manifest.title,
      preview_url: artifactPreviewUrl(product_id, artifactId),
      updated_at: manifest.updatedAt,
      source_skill_id: manifest.sourceSkillId,
      requirement_id: manifest.requirementId,
      superseded
    });
  }

  return { artifacts };
}

async function getProductArtifact(
  store: FormaStore,
  input: z.infer<typeof getProductArtifactSchema>
) {
  const { product_id, artifact_id } = input;
  const { manifest } = await store.artifacts.readArtifact(product_id, artifact_id);
  return {
    manifest,
    supportingFiles: manifest.supportingFiles ?? [],
    preview_url: artifactPreviewUrl(product_id, artifact_id)
  };
}

async function exportArtifact(
  store: FormaStore,
  input: z.infer<typeof exportArtifactSchema>
): Promise<{ output_path: string }> {
  const { product_id, artifact_id, format } = input;

  const { manifest } = await store.artifacts.readArtifact(product_id, artifact_id);

  const productsDir = join(store.home, "data", "products");
  const artifactDir = getArtifactDir(productsDir, product_id, artifact_id);

  const exportsDir = join(store.home, "exports", product_id);
  await mkdir(exportsDir, { recursive: true });

  const outputPath = join(exportsDir, `${artifact_id}.${format}`);

  if (format === "png") {
    const previewSrc = join(artifactDir, "preview", "2x.png");
    await copyFile(previewSrc, outputPath);
  } else if (format === "html" || format === "svg") {
    const entrySrc = join(artifactDir, manifest.entry);
    await copyFile(entrySrc, outputPath);
  } else if (format === "zip") {
    const zip = new AdmZip();
    try {
      const manifestJson = JSON.stringify(manifest, null, 2);
      zip.addFile("manifest.json", Buffer.from(manifestJson, "utf8"));
      const addedFiles = new Set<string>();

      addArtifactFileToZip(zip, artifactDir, manifest.entry, addedFiles);
      for (const relPath of manifest.supportingFiles ?? []) {
        if (addedFiles.has(relPath)) {
          continue;
        }
        try {
          addArtifactFileToZip(zip, artifactDir, relPath, addedFiles);
        } catch {
          // Skip unreadable supporting files
        }
      }

      try {
        zip.addLocalFile(join(artifactDir, "preview", "2x.png"), "preview");
      } catch {
        // Preview may not exist for all artifact kinds
      }

      zip.writeZip(outputPath);
    } catch (err) {
      await rm(outputPath, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  return { output_path: outputPath };
}

function addArtifactFileToZip(zip: AdmZip, artifactDir: string, relPath: string, addedFiles: Set<string>): void {
  const srcPath = join(artifactDir, relPath);
  zip.addLocalFile(srcPath, archiveDirname(relPath));
  addedFiles.add(relPath);
}

function archiveDirname(relPath: string): string {
  return relPath.includes("/") ? relPath.substring(0, relPath.lastIndexOf("/")) : "";
}

async function rollbackRequirementDesign(
  store: FormaStore,
  input: z.infer<typeof rollbackRequirementDesignSchema>
): Promise<{ rolled_back_to: string; previous_pointer: string | null }> {
  const { product_id, requirement_id, target_artifact_id } = input;

  const req = await store.requirements.getRequirement({ requirement_id });
  if (req.product_id !== product_id) {
    throw new FormaError("REQUIREMENT_NOT_FOUND", "Requirement not found for this product", {
      product_id,
      requirement_id
    });
  }

  const { manifest: targetManifest } = await store.artifacts.readArtifact(product_id, target_artifact_id);

  if (targetManifest.requirementId !== requirement_id) {
    throw new FormaError("ARTIFACT_NOT_FOUND", "Artifact does not belong to this requirement", {
      product_id,
      requirement_id,
      artifact_id: target_artifact_id
    });
  }

  const product = await store.products.getProduct(product_id);
  const currentPointer = product.requirements?.[requirement_id]?.latestArtifactId ?? null;

  if (currentPointer === target_artifact_id) {
    return { rolled_back_to: target_artifact_id, previous_pointer: target_artifact_id };
  }

  await store.runProductMutation({ operation: "rollback_requirement_pointer", product_id }, async () => {
    await store.products.setRequirementArtifactPointerLocked(product_id, requirement_id, target_artifact_id);
  });

  return { rolled_back_to: target_artifact_id, previous_pointer: currentPointer };
}

// ─── New C-04 tool implementations ───────────────────────────────────────────

async function confirmProductId(store: FormaStore, input: z.infer<typeof confirmProductIdSchema>) {
  const { product_id, expected_name } = input;
  const product = await store.products.getProduct(product_id);
  const confirmed = expected_name === undefined || expected_name === product.name;
  return { confirmed, name: product.name };
}

async function getStyle(store: FormaStore, productId: string) {
  const product = await store.products.getProduct(productId);
  if (!product.designSystemArtifactId) {
    throw new FormaError("STYLE_NOT_FOUND", "No design-system artifact for this product", { product_id: productId });
  }
  const { manifest } = await store.artifacts.readArtifact(productId, product.designSystemArtifactId);
  return { tokens: (manifest.metadata as Record<string, unknown> | undefined)?.tokens ?? {} };
}

function getV6Services(store: FormaStore): V6ServiceOverrides {
  return ((store as FormaStore & { v6?: V6ServiceOverrides }).v6 ?? {});
}

function sessionToolFallback(tool: string): never {
  throw new FormaError("FORMA_DESKTOP_CONFIG_UNSUPPORTED", "Pencil session tools require a v6 service override", { tool });
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
  if (error instanceof z.ZodError) {
    const forbiddenPathIssue = error.issues.find((issue) => issue.message === "FORBIDDEN_PATH_PARAMETER");
    if (forbiddenPathIssue) {
      return {
        error_code: "FORBIDDEN_PATH_PARAMETER",
        message: "Path parameters are not allowed",
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
    throw new FormaError("REQUIREMENT_PAGE_NOT_FOUND", "Requirement page not found", {
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

async function getProductRequirement(store: FormaStore, productId: string, requirementId: string) {
  const requirement = await store.requirements.getRequirement({ requirement_id: requirementId });
  if (requirement.product_id !== productId) {
    throw new FormaError("REQUIREMENT_PRODUCT_MISMATCH", "Requirement does not belong to product", {
      product_id: productId,
      requirement_id: requirementId,
      requirement_product_id: requirement.product_id
    });
  }

  return requirement;
}

async function getLatestNonArchivedRequirement(store: FormaStore, productId: string) {
  return store.requirements.getLatestRequirement(productId);
}

async function getProductBaseline(store: FormaStore, productId: string) {
  const product = await store.products.getProduct(productId);
  if (!product.designSystemArtifactId) {
    throw new FormaError("ARTIFACT_NOT_FOUND", "No design-system artifact for this product", { product_id: productId });
  }
  const { manifest } = await store.artifacts.readArtifact(productId, product.designSystemArtifactId);
  return { baseline: manifest };
}

async function getBaselinePage(store: FormaStore, productId: string, pageId: string) {
  const product = await store.products.getProduct(productId);
  if (!product.designSystemArtifactId) {
    throw new FormaError("ARTIFACT_NOT_FOUND", "No design-system artifact for this product", { product_id: productId });
  }
  const { manifest } = await store.artifacts.readArtifact(productId, product.designSystemArtifactId);
  const rawPages = (manifest.metadata as Record<string, unknown> | undefined)?.pages;
  const pages: unknown[] = Array.isArray(rawPages) ? rawPages : [];
  const page = pages.find((item) => {
    if (typeof item !== "object" || item === null) return false;
    const p = item as Record<string, unknown>;
    return p.id === pageId || p.page_id === pageId;
  });
  if (!page) {
    throw new FormaError("ARTIFACT_NOT_FOUND", "Baseline page not found", { product_id: productId, page_id: pageId });
  }
  return page;
}

async function getBaselineImage(store: FormaStore, productId: string) {
  const product = await store.products.getProduct(productId);
  if (!product.designSystemArtifactId) {
    throw new FormaError("ARTIFACT_NOT_FOUND", "No design-system artifact for this product", { product_id: productId });
  }
  const productsDir = getFormaPaths(store.home).productsDir;
  const artifactDir = getArtifactDir(productsDir, productId, product.designSystemArtifactId);
  return { path: join(artifactDir, "preview", "2x.png") };
}

function titleFromToolName(name: string): string {
  return name.split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
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
