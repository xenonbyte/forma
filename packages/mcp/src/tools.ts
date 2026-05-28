import {
  access,
  copyFile,
  mkdir,
  readdir,
  rm
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  FormaError,
  PencilAppSessionAdapter,
  createOdRuntime,
  defaultPencilRunner,
  findBaselinePreviewMetadata,
  getArtifactDir,
  languages,
  platforms,
  readYaml,
  validateArtifactManifest,
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
  "list_product_artifacts",
  "get_product_artifact",
  "generate_requirement_design",
  "refine_requirement_design",
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

const generateRequirementDesignSchema = z.object({
  product_id: z.string().min(1),
  requirement_id: z.string().min(1),
  mode: z.enum(["generate", "rebuild"])
}).strict();

const refineRequirementDesignSchema = z.object({
  product_id: z.string().min(1),
  requirement_id: z.string().min(1),
  instructions: z.string()
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
  session_id: sessionIdSchema,
  pencil_binding_id: nonEmptyStringSchema.optional()
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
  list_product_artifacts: listProductArtifactsSchema,
  get_product_artifact: getProductArtifactSchema,
  generate_requirement_design: generateRequirementDesignSchema,
  refine_requirement_design: refineRequirementDesignSchema,
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
  list_product_artifacts: "List open-design artifacts for a product.",
  get_product_artifact: "Read an open-design artifact manifest and supporting file list.",
  generate_requirement_design: "Generate a new open-design artifact for a requirement.",
  refine_requirement_design: "Refine an existing open-design artifact with new instructions.",
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
    list_product_artifacts: tool("list_product_artifacts", async (input) =>
      listProductArtifacts(store, input)),
    get_product_artifact: tool("get_product_artifact", async (input) =>
      getProductArtifact(store, input)),
    generate_requirement_design: tool("generate_requirement_design", async (input) =>
      generateRequirementDesign(store, input)),
    refine_requirement_design: tool("refine_requirement_design", async (input) =>
      refineRequirementDesign(store, input)),
    export_artifact: tool("export_artifact", async (input) =>
      exportArtifact(store, input)),
    rollback_requirement_design: tool("rollback_requirement_design", async (input) =>
      rollbackRequirementDesign(store, input)),
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

// ─── Artifact tool implementations ───────────────────────────────────────────

function artifactPreviewUrl(productId: string, artifactId: string): string {
  return `/products/${productId}/artifacts/${artifactId}/preview/2x.png`;
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

async function generateRequirementDesign(
  store: FormaStore,
  input: z.infer<typeof generateRequirementDesignSchema>
): Promise<{ artifact_id: string; status: "complete" }> {
  const { product_id, requirement_id, mode } = input;

  // Verify requirement belongs to product
  const req = await store.requirements.getRequirement({ requirement_id });
  if (req.product_id !== product_id) {
    throw new FormaError("REQUIREMENT_NOT_FOUND", "Requirement not found for this product", {
      product_id,
      requirement_id
    });
  }

  // Get product for context
  const product = await store.products.getProduct(product_id);

  // Generate artifact (outside lock)
  const output = await createOdRuntime().generate({
    kind: "html",
    requirementId: requirement_id,
    sourceSkillId: "fm-design",
    style: (product as Record<string, unknown>).style !== undefined
      ? ((product as Record<string, unknown>).style as Record<string, unknown>).name as string | undefined
      : undefined,
    platform: product.platform,
    language: product.default_language,
    ignoreInternalCache: mode === "rebuild"
  });

  // Validate manifest
  const validation = validateArtifactManifest(output.manifest);
  if (!validation.ok) {
    throw new FormaError("ARTIFACT_MANIFEST_INVALID", `Invalid artifact manifest: ${validation.error}`, {
      requirement_id,
      error: validation.error
    });
  }

  // Convert supporting files
  const files = new Map(
    [...output.supportingFiles.entries()].map(([k, v]) => [k, Buffer.from(v)])
  );

  // Write artifact
  const { artifactId } = await store.artifacts.writeArtifact({
    productId: product_id,
    manifest: output.manifest,
    files
  });

  // Update pointer under lock
  await store.runProductMutation({ operation: "update_requirement_pointer", product_id }, async () => {
    await store.products.setRequirementArtifactPointerLocked(product_id, requirement_id, artifactId);
  });

  return { artifact_id: artifactId, status: "complete" };
}

async function refineRequirementDesign(
  store: FormaStore,
  input: z.infer<typeof refineRequirementDesignSchema>
): Promise<{ artifact_id: string; status: "complete" }> {
  const { product_id, requirement_id, instructions } = input;

  // Validate instructions
  if (instructions.trim() === "") {
    throw new FormaError("ARTIFACT_INVALID_INPUT", "Instructions must not be empty", { requirement_id });
  }

  // Verify requirement belongs to product
  const req = await store.requirements.getRequirement({ requirement_id });
  if (req.product_id !== product_id) {
    throw new FormaError("REQUIREMENT_NOT_FOUND", "Requirement not found for this product", {
      product_id,
      requirement_id
    });
  }

  // Get current pointer for previousArtifactId
  const product = await store.products.getProduct(product_id);
  const previousArtifactId = product.requirements?.[requirement_id]?.latestArtifactId;

  // Generate artifact (outside lock)
  const output = await createOdRuntime().generate({
    kind: "html",
    requirementId: requirement_id,
    sourceSkillId: "fm-design",
    instructions,
    style: (product as Record<string, unknown>).style !== undefined
      ? ((product as Record<string, unknown>).style as Record<string, unknown>).name as string | undefined
      : undefined,
    platform: product.platform,
    language: product.default_language
  });

  // Build manifest with previousArtifactId
  const manifestWithPrev = {
    ...output.manifest,
    metadata: { ...output.manifest.metadata, previousArtifactId }
  };

  // Validate manifest
  const validation = validateArtifactManifest(manifestWithPrev);
  if (!validation.ok) {
    throw new FormaError("ARTIFACT_MANIFEST_INVALID", `Invalid artifact manifest: ${validation.error}`, {
      requirement_id,
      error: validation.error
    });
  }

  // Convert supporting files
  const files = new Map(
    [...output.supportingFiles.entries()].map(([k, v]) => [k, Buffer.from(v)])
  );

  // Write artifact
  const { artifactId } = await store.artifacts.writeArtifact({
    productId: product_id,
    manifest: manifestWithPrev,
    files
  });

  // Update pointer under lock
  await store.runProductMutation({ operation: "update_requirement_pointer", product_id }, async () => {
    await store.products.setRequirementArtifactPointerLocked(product_id, requirement_id, artifactId);
  });

  return { artifact_id: artifactId, status: "complete" };
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
      // Add manifest.json
      const manifestJson = JSON.stringify(manifest, null, 2);
      zip.addFile("manifest.json", Buffer.from(manifestJson, "utf8"));

      // Add supporting files
      const supportingFiles = manifest.supportingFiles ?? [];
      for (const relPath of supportingFiles) {
        const srcPath = join(artifactDir, relPath);
        try {
          const AdmZipImport = AdmZip;
          void AdmZipImport;
          zip.addLocalFile(srcPath, relPath.includes("/") ? relPath.substring(0, relPath.lastIndexOf("/")) : "");
        } catch {
          // Skip files that can't be read
        }
      }

      // Add preview
      const previewPath = join(artifactDir, "preview", "2x.png");
      try {
        zip.addLocalFile(previewPath, "preview");
      } catch {
        // Preview may not exist
      }

      zip.writeZip(outputPath);
    } catch (err) {
      // Clean up partial zip on failure
      try {
        await rm(outputPath, { force: true });
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  }

  return { output_path: outputPath };
}

async function rollbackRequirementDesign(
  store: FormaStore,
  input: z.infer<typeof rollbackRequirementDesignSchema>
): Promise<{ rolled_back_to: string; previous_pointer: string | null }> {
  const { product_id, requirement_id, target_artifact_id } = input;

  // Verify requirement exists and belongs to product
  const req = await store.requirements.getRequirement({ requirement_id });
  if (req.product_id !== product_id) {
    throw new FormaError("REQUIREMENT_NOT_FOUND", "Requirement not found for this product", {
      product_id,
      requirement_id
    });
  }

  // Verify target artifact exists and belongs to this requirement
  let targetManifest: ArtifactManifest;
  try {
    ({ manifest: targetManifest } = await store.artifacts.readArtifact(product_id, target_artifact_id));
  } catch (err) {
    if (err instanceof FormaError && err.code === "ARTIFACT_NOT_FOUND") {
      throw err;
    }
    throw err;
  }

  if (targetManifest.requirementId !== requirement_id) {
    throw new FormaError("ARTIFACT_NOT_FOUND", "Artifact does not belong to this requirement", {
      product_id,
      requirement_id,
      artifact_id: target_artifact_id
    });
  }

  // Get current pointer
  const product = await store.products.getProduct(product_id);
  const currentPointer = product.requirements?.[requirement_id]?.latestArtifactId ?? null;

  // No-op if target is already current
  if (currentPointer === target_artifact_id) {
    return { rolled_back_to: target_artifact_id, previous_pointer: target_artifact_id };
  }

  // Update pointer under lock
  await store.runProductMutation({ operation: "rollback_requirement_pointer", product_id }, async () => {
    await store.products.setRequirementArtifactPointerLocked(product_id, requirement_id, target_artifact_id);
  });

  return { rolled_back_to: target_artifact_id, previous_pointer: currentPointer };
}

function getV6Services(store: FormaStore): V6ServiceOverrides {
  return ((store as FormaStore & { v6?: V6ServiceOverrides }).v6 ?? {});
}

function sessionAdapter(store: FormaStore): PencilAppSessionAdapter {
  return new PencilAppSessionAdapter({ home: store.home, runner: defaultPencilRunner });
}

async function sessionBindingContext(home: string, adapter: PencilAppSessionAdapter, input: { session_id: string; pencil_binding_id?: string }): Promise<{ bindingId: string; expectedStagingPath: string }> {
  const record = await findMcpSessionRecord(home, input.session_id);
  const bindingId = input.pencil_binding_id ?? record.pencil_binding_id;
  const binding = adapter.getBinding(bindingId);
  if (binding && binding.session_id !== input.session_id) {
    throw new ToolError("INVALID_INPUT", "Pencil binding does not belong to this session", {
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
