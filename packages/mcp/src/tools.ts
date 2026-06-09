import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  COMPONENT_BASELINES,
  FormaError,
  artifactBundleUrl,
  artifactPreviewUrl,
  assetDensityPath,
  buildDesignContext,
  extractIconAssets,
  getArtifactDir,
  getArtifactVersionDir,
  getArtifactVersionPreviewPath,
  getFormaPaths,
  languages,
  mapToComponentPlatform,
  normalizeFormaExtension,
  normalizeKind,
  platforms,
  type ArtifactManifest,
  type FormaStore,
} from "@xenonbyte/forma-core";
import { PuppeteerParser } from "@vzi-core/parser";
import { VZITransformer, buildVziContentFromTransformResult } from "@vzi-core/transformer";
import { VZIEncoder } from "@vzi-core/format";
import AdmZip from "adm-zip";
import * as z from "zod/v4";
import { toolGetDesignHandoff, toolGetPageUi, toolGetUiNode, toolSearchPageUi } from "./design-handoff.js";
import {
  mcpGetDesignHandoffSchema,
  mcpGetPageUiSchema,
  mcpGetUiNodeSchema,
  mcpSearchPageUiSchema,
} from "./vzi-read-schemas.js";

export const formaToolNames = [
  "help",
  "list_products",
  "get_product",
  "confirm_product_id",
  "get_product_baseline",
  "get_component_baseline",
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
  "generate_requirement_design",
  "generate_components",
  "change_artifact_style",
  "get_design_context",
  "get_design_handoff",
  "get_page_ui",
  "get_ui_node",
  "search_page_ui",
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

type RequirementHistoryRecord = Awaited<ReturnType<FormaStore["requirements"]["getRequirementHistory"]>>[number];
type RequirementHistoryPageRecord = RequirementHistoryRecord["pages"][number];

interface BaselinePageRecord {
  id: string;
  copy: unknown[];
  features: string;
  fields: string;
  interactions: string;
  name: string;
  semantic_contract?: unknown;
  semantic_contract_coverage?: unknown;
  source_requirements: string[];
}

export interface FormaMcpServerLike {
  registerTool(
    name: string,
    config: { title: string; description: string; inputSchema: z.ZodType },
    handler: FormaToolHandler,
  ): unknown;
}

const emptySchema = z.object({}).strict();
const productIdSchema = z.object({ product_id: z.string().min(1) }).strict();
const baselinePageSchema = z.object({ product_id: z.string().min(1), page_id: z.string().min(1) }).strict();
const copyItemSchema = z
  .object({
    context: z.string().min(1),
    text: z.string().min(1),
  })
  .strict();
const translationEntrySchema = z
  .object({
    context: z.string().min(1),
    texts: z.record(z.string(), z.string()),
    outdated: z.boolean().optional(),
  })
  .strict();
const pageTranslationSchema = z
  .object({
    page_id: z.string().min(1),
    entries: z.array(translationEntrySchema),
  })
  .strict();
const semanticContractItemSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
  })
  .strict();
const ruleSemanticSchema = z
  .object({
    fields: z.array(semanticContractItemSchema).optional(),
    actions: z.array(semanticContractItemSchema).optional(),
    component_keys: z.array(z.string().min(1)).optional(),
    allowed_copy: z.array(z.string()).optional(),
  })
  .strict();
const ruleInputSchema = z
  .object({
    id: z.string().min(1),
    page_id: z.string().min(1).optional(),
    given: z.string().min(1),
    when: z.string().min(1),
    then: z.string().min(1),
    semantic: ruleSemanticSchema.optional(),
    replaces_rule_id: z.string().optional(),
  })
  .strict();
const requirementPageInputSchema = z
  .object({
    page_id: z.string().min(1),
    name: z.string().min(1),
    baseline_page: z.string().min(1),
    features: z.string().optional(),
    copy: z.array(copyItemSchema).optional(),
    fields: z.string().optional(),
    interactions: z.string().optional(),
    declared_fields: z.array(semanticContractItemSchema).optional(),
    declared_actions: z.array(semanticContractItemSchema).optional(),
    declared_component_keys: z.array(z.string().min(1)).optional(),
    change_type: z.enum(["new", "patch", "rebuild"]),
    change_summary: z.string().optional(),
  })
  .strict();
const navigationInputSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().optional(),
  })
  .strict();
const saveRequirementSchema = z
  .object({
    requirement_id: z.string().min(1),
    document_md: z.string(),
    ui_affected: z.boolean(),
    pages: z.array(requirementPageInputSchema),
    navigation: z.array(navigationInputSchema),
    translations: z.array(pageTranslationSchema).optional(),
    rules: z.array(ruleInputSchema).optional(),
    remove_rule_ids: z.array(z.string().min(1)).optional(),
    remove_page_ids: z.array(z.string().min(1)).optional(),
  })
  .strict();
const listProductArtifactsSchema = z
  .object({
    product_id: z.string().min(1),
    kind: z
      .enum(["html", "design-page", "component-library", "markdown-document", "svg", "image", "preview-only"])
      .optional(),
    include_superseded: z.boolean().optional(),
  })
  .strict();

const getProductArtifactSchema = z
  .object({
    product_id: z.string().min(1),
    artifact_id: z.string().min(1),
  })
  .strict();

const exportArtifactSchema = z
  .object({
    product_id: z.string().min(1),
    artifact_id: z.string().min(1),
    format: z.enum(["html", "svg", "png", "zip", "icons", "vzi"]),
  })
  .strict();

const generateRequirementDesignSchema = z
  .object({
    product_id: z.string().min(1),
    requirement_id: z.string().min(1),
    page_id: z.string().min(1),
    html: z.string().min(1),
    title: z.string().min(1),
    brand_style: z.string().min(1),
    system_style: z.string().min(1).optional(),
    variant: z.string().optional(),
  })
  .strict();

/** Validate a relative bundle path (no absolute, no traversal) for MCP supporting_files. */
function isValidSupportingPath(value: string): boolean {
  if (value.length === 0) return false;
  if (value.includes("\x00")) return false;
  if (/^[a-zA-Z]:[/\\]/.test(value)) return false;
  if (/^[/\\]{2}/.test(value)) return false;
  if (value.startsWith("/")) return false;
  const segs = value.split(/[/\\]/);
  return !segs.some((s) => s === "..");
}

const supportingFileSchema = z
  .object({
    path: z.string().min(1).refine(isValidSupportingPath, {
      message: "supporting_files path must be a relative bundle path (no absolute, no traversal)",
    }),
    content_type: z.literal("image/svg+xml"),
    content_base64: z.string().min(1),
  })
  .strict();

const productIconShapeSchema = z
  .object({
    shape_id: z.string().min(1),
    geometry: z.string().min(1),
    source_version: z.string().min(1),
  })
  .strict();

const productIconSchema = z
  .object({
    primary: z.string().min(1).refine(isValidSupportingPath, {
      message: "product_icon.primary must be a relative bundle path (no absolute, no traversal)",
    }),
    monochrome: z.string().min(1).refine(isValidSupportingPath, {
      message: "product_icon.monochrome must be a relative bundle path (no absolute, no traversal)",
    }),
    shape: productIconShapeSchema,
  })
  .strict();

const generateComponentsSchema = z
  .object({
    product_id: z.string().min(1),
    html: z.string().min(1),
    title: z.string().min(1),
    brand_style: z.string().min(1),
    system_style: z.string().min(1).optional(),
    product_icon: productIconSchema.optional(),
    supporting_files: z.array(supportingFileSchema).optional(),
  })
  .strict();

const changeArtifactStyleSchema = z
  .object({
    product_id: z.string().min(1),
    artifact_id: z.string().min(1),
    html: z.string().min(1),
    title: z.string().min(1),
    brand_style: z.string().min(1),
    system_style: z.string().min(1).optional(),
  })
  .strict();

const getDesignContextSchema = z
  .object({
    product_id: z.string().min(1),
    requirement_id: z.string().min(1),
    page_id: z.string().min(1).optional(),
    brand_style: z.string().min(1).optional(),
    system_style: z.string().min(1).optional(),
    craft_slugs: z.array(z.string().min(1)).optional(),
  })
  .strict();

const getRequirementSchema = z
  .object({
    requirement_id: z.string().min(1).optional(),
    product_id: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (Boolean(input.requirement_id) === Boolean(input.product_id)) {
      context.addIssue({ code: "custom", message: "provide exactly one of requirement_id or product_id" });
    }
  });
const getPageCopySchema = z
  .object({
    product_id: z.string().min(1),
    page_id: z.string().min(1),
    requirement_id: z.string().min(1).optional(),
  })
  .strict();
const productConfigSchema = z
  .object({
    product_id: z.string().min(1),
    platform: z.enum(platforms),
    brand_style: z.string().min(1),
    system_style: z.string().min(1).optional(),
    languages: z.array(z.enum(languages)).min(1),
    default_language: z.enum(languages),
  })
  .strict()
  .refine((config) => config.languages.includes(config.default_language), {
    message: "default_language must be included in languages",
    path: ["default_language"],
  });
const confirmProductIdSchema = z
  .object({
    product_id: z.string().min(1),
    expected_name: z.string().optional(),
  })
  .strict();
const getStyleSchema = z.object({ name: z.string().min(1) }).strict();

export const formaToolInputSchemas = {
  help: emptySchema,
  list_products: emptySchema,
  get_product: productIdSchema,
  confirm_product_id: confirmProductIdSchema,
  get_product_baseline: productIdSchema,
  get_component_baseline: productIdSchema,
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
  generate_requirement_design: generateRequirementDesignSchema,
  generate_components: generateComponentsSchema,
  change_artifact_style: changeArtifactStyleSchema,
  get_design_context: getDesignContextSchema,
  get_design_handoff: mcpGetDesignHandoffSchema,
  get_page_ui: mcpGetPageUiSchema,
  get_ui_node: mcpGetUiNodeSchema,
  search_page_ui: mcpSearchPageUiSchema,
} satisfies Record<FormaToolName, z.ZodType>;

const descriptions = {
  help: "List available Forma MCP tools and guidance for reading artifacts and assets.",
  list_products: "List Forma products.",
  get_product: "Read a product.",
  confirm_product_id: "Confirm that a product id exists and optionally verify its name.",
  get_product_baseline: "Read the current functional baseline pages and navigation for a product.",
  get_component_baseline:
    "Read the component baseline spec (foundations, productIcon spec, component list with states/variants) for a product's platform. Use before generate_components to know what to build.",
  get_baseline_page: "Read one baseline page from the product's current baseline artifact.",
  get_baseline_image: "Get the preview image path for the product's current baseline artifact.",
  get_requirement_history: "List product requirement history.",
  get_requirement: "Read a requirement by id or latest product requirement.",
  get_product_rules: "Read product-level behavioral rules.",
  get_page_copy: "Read source copy and translations for a requirement page.",
  init_product_config: "Write platform, style, and language configuration for an existing product.",
  update_product_config: "Update platform, style, and language configuration for a product.",
  list_styles: "List installed styles.",
  get_style:
    "Read a style by name: brand styles return DESIGN.md + tokens.css + components.html; system styles return catalog metadata.",
  save_requirement: "Create or update a requirement through the unified state machine.",
  list_product_artifacts: "List open-design artifacts for a product.",
  get_product_artifact: "Read an open-design artifact manifest, bundle_url, per-asset urls, and versions.",
  export_artifact: "Export an open-design artifact to html, svg, png, zip (self-contained bundle), icons, or vzi.",
  generate_requirement_design: "Save an AI-generated static HTML design artifact for a requirement page.",
  generate_components: "Save an AI-generated static HTML component-library artifact.",
  change_artifact_style:
    "Save an AI-generated static HTML artifact as a new version of an existing artifact with a new style applied.",
  get_design_context:
    "Read design context BEFORE generating: craft rules + selected brand/system style + the page spec + applicable rules. Call this before generate_requirement_design (separate from the save tools).",
  get_design_handoff:
    "Read the design-handoff entry for an archived requirement: page directory with variant/artifactId, vziPath, indexHtmlPath, iconCount, rules, and copy. Only available after the requirement is archived.",
  get_page_ui:
    "Read the full element tree (with tokens, annotations, and resolved asset paths) for one archived requirement page/variant. Supports variant/artifact_id disambiguation plus depth/fields/node_id filtering.",
  get_ui_node:
    "Read complete detail for a single UI element node from an archived requirement page/variant: styles, bounds, parent/children, node-scoped annotations, and resolved asset path.",
  search_page_ui:
    "Search an archived requirement page/variant's UI elements by text content or type. Supports variant/artifact_id disambiguation when page IDs are reused.",
} satisfies Record<FormaToolName, string>;

export function createFormaTools(store: FormaStore): FormaTools {
  return {
    help: tool("help", async () => ({
      tools: formaToolNames,
      usage_guide: {
        guidance: [
          "Use save_requirement for all requirement submissions and updates.",
          "Use get_product_rules to inspect persisted behavioral rules.",
          "Use get_page_copy to inspect page-level source copy translations.",
          "Use get_product_artifact to read a design — it returns bundle_url, per-asset urls, preview_url, versions, and current_version.",
          "Open a design by fetching bundle_url (self-contained HTML). Load assets from their density-keyed urls.",
          "Use export_artifact with format=zip to download the complete self-contained bundle (index.html + assets + manifest.json), format=png for the preview image, format=html/svg for the single entry file, format=icons for generated icon assets, or format=vzi for a decodable VZI file.",
        ],
        workflows: {
          develop_frontend: [
            "get_design_handoff",
            "get_page_ui",
            "get_ui_node",
            "search_page_ui",
            "get_requirement",
            "get_product_rules",
          ],
        },
      },
    })),
    list_products: tool("list_products", async () => store.products.listProducts()),
    get_product: tool("get_product", async (input) => store.products.getProduct(input.product_id)),
    confirm_product_id: tool("confirm_product_id", async (input) => confirmProductId(store, input)),
    get_product_baseline: tool("get_product_baseline", async (input) => getProductBaseline(store, input.product_id)),
    get_component_baseline: tool("get_component_baseline", async (input) => {
      const product = await store.products.getProduct(input.product_id);
      const componentPlatform = mapToComponentPlatform(product.platform);
      return { platform: componentPlatform, baseline: COMPONENT_BASELINES[componentPlatform] };
    }),
    get_baseline_page: tool("get_baseline_page", async (input) =>
      getBaselinePage(store, input.product_id, input.page_id),
    ),
    get_baseline_image: tool("get_baseline_image", async (input) => getBaselineImage(store, input.product_id)),
    get_requirement_history: tool("get_requirement_history", async (input) =>
      store.requirements.getRequirementHistory(input.product_id),
    ),
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
    get_style: tool("get_style", async (input) => getStyle(store, input.name)),
    save_requirement: tool("save_requirement", async (input) => store.requirements.saveRequirement(input)),
    list_product_artifacts: tool("list_product_artifacts", async (input) => listProductArtifacts(store, input)),
    get_product_artifact: tool("get_product_artifact", async (input) => getProductArtifact(store, input)),
    export_artifact: tool("export_artifact", async (input) => exportArtifact(store, input)),
    generate_requirement_design: tool("generate_requirement_design", async (input) =>
      store.generateRequirementDesign(input.product_id, input.requirement_id, {
        html: input.html,
        title: input.title,
        pageId: input.page_id,
        variant: input.variant,
        brandStyle: input.brand_style,
        systemStyle: input.system_style,
      }),
    ),
    generate_components: tool("generate_components", async (input) =>
      store.generateComponents(input.product_id, {
        html: input.html,
        title: input.title,
        brandStyle: input.brand_style,
        systemStyle: input.system_style,
        ...(input.product_icon !== undefined
          ? {
              productIcon: {
                primary: input.product_icon.primary,
                monochrome: input.product_icon.monochrome,
                shape: {
                  shapeId: input.product_icon.shape.shape_id,
                  geometry: input.product_icon.shape.geometry,
                  sourceVersion: input.product_icon.shape.source_version,
                },
              },
            }
          : {}),
        ...(input.supporting_files !== undefined
          ? {
              supportingFiles: (input.supporting_files as Array<{ path: string; content_type: string; content_base64: string }>).map((sf) => ({
                path: sf.path,
                contentType: sf.content_type,
                contentBase64: sf.content_base64,
              })),
            }
          : {}),
      }),
    ),
    change_artifact_style: tool("change_artifact_style", async (input) =>
      store.changeArtifactStyle(input.product_id, input.artifact_id, {
        html: input.html,
        title: input.title,
        brandStyle: input.brand_style,
        systemStyle: input.system_style,
      }),
    ),
    get_design_context: tool("get_design_context", async (input) => {
      const ctx = await buildDesignContext(
        {
          styles: store.styles,
          requirements: store.requirements,
          products: store.products,
          artifacts: store.artifacts,
        },
        {
          productId: input.product_id,
          requirementId: input.requirement_id,
          pageId: input.page_id,
          brandStyle: input.brand_style,
          systemStyle: input.system_style,
          craftSlugs: input.craft_slugs,
        },
      );

      // Enrich componentLibrary with MCP-layer URL helpers (bundleUrl/previewUrl).
      // Core returns only the core-resolvable parts (incl. the bundle entry); URLs are MCP concerns.
      if (ctx.componentLibrary !== undefined) {
        const { artifactId, version, entry } = ctx.componentLibrary;
        return {
          ...ctx,
          componentLibrary: {
            ...ctx.componentLibrary,
            bundleUrl: artifactBundleUrl(input.product_id, artifactId, version, entry),
            previewUrl: artifactPreviewUrl(input.product_id, artifactId, version, "2x"),
          },
        };
      }

      return ctx;
    }),
    get_design_handoff: tool("get_design_handoff", async (input) => toolGetDesignHandoff(store, input)),
    get_page_ui: tool("get_page_ui", async (input) => toolGetPageUi(store, input)),
    get_ui_node: tool("get_ui_node", async (input) => toolGetUiNode(store, input)),
    search_page_ui: tool("search_page_ui", async (input) => toolSearchPageUi(store, input)),
  };
}

export function registerFormaTools(server: FormaMcpServerLike, tools: FormaTools): void {
  for (const name of formaToolNames) {
    server.registerTool(
      name,
      {
        title: titleFromToolName(name),
        description: descriptions[name],
        inputSchema: formaToolInputSchemas[name],
      },
      tools[name],
    );
  }
}

function tool<Name extends FormaToolName, Input>(
  name: Name,
  handler: (input: any) => Promise<Input> | Input,
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

async function listProductArtifacts(store: FormaStore, input: z.infer<typeof listProductArtifactsSchema>) {
  const { product_id, kind, include_superseded = false } = input;

  const product = await store.products.getProduct(product_id);
  const pointers = product.requirements ?? {};
  const currentPointerIds = new Set(
    Object.values(pointers)
      .map((r) => r.latestArtifactId)
      .filter(Boolean),
  );

  // Build a map of artifactId → version from design pointers for current-version lookup
  const designPointers = await store.products.listDesignPointers(product_id);
  const pointerVersionByArtifactId = new Map<string, number>();
  for (const ptr of designPointers) {
    pointerVersionByArtifactId.set(ptr.artifactId, ptr.version);
    // Bug #3: also add design pointer artifact IDs to the current-pointer set
    currentPointerIds.add(ptr.artifactId);
  }

  // SPEC-BEHAVIOR-008 (B7): component-library current resolution is SOLELY via
  // designSystemArtifactId pointer. Do NOT use updated_at, array order, or superseded flag.
  const dsArtifactId = product.designSystemArtifactId;

  const entries = await store.artifacts.listArtifacts(product_id);
  const artifacts = [];

  for (const { artifactId } of entries) {
    // Get versioned manifest
    const versions = await store.artifacts.listArtifactVersions(product_id, artifactId);

    let manifest: ArtifactManifest;
    let currentVersion: number;

    if (versions.length > 0) {
      // Use pointer version if available, else highest version
      currentVersion = pointerVersionByArtifactId.get(artifactId) ?? Math.max(...versions);
      try {
        ({ manifest } = await store.artifacts.readArtifactVersion(product_id, artifactId, currentVersion));
      } catch {
        continue;
      }
    } else {
      // Fall back to unversioned manifest (legacy artifacts)
      try {
        ({ manifest } = await store.artifacts.readArtifact(product_id, artifactId));
      } catch {
        continue;
      }
      currentVersion = 1;
    }

    const normalizedKind = normalizeKind(manifest.kind);

    // Apply kind filter after normalization (filter checks both old and new kind names)
    if (kind !== undefined && normalizedKind !== kind && manifest.kind !== kind) {
      continue;
    }

    const formaExt = manifest.forma ? normalizeFormaExtension(manifest.forma) : undefined;

    let superseded: boolean;
    if (normalizedKind === "component-library") {
      // SPEC-BEHAVIOR-008: component-library current = id matches designSystemArtifactId pointer.
      // When pointer is unset or this artifact ≠ pointer → superseded (hidden by default).
      superseded = artifactId !== dsArtifactId;
    } else {
      const hasRequirementId = manifest.requirementId !== undefined || formaExt?.requirementId !== undefined;
      const isCurrentPointer = currentPointerIds.has(artifactId);
      superseded = hasRequirementId && !isCurrentPointer;
    }

    if (!include_superseded && superseded) {
      continue;
    }

    artifacts.push({
      id: artifactId,
      kind: normalizedKind,
      title: manifest.title,
      requirement_id: formaExt?.requirementId ?? manifest.requirementId,
      page_id: formaExt?.pageId,
      variant: formaExt?.variant,
      versions,
      current_version: currentVersion,
      preview_url: artifactPreviewUrl(product_id, artifactId, currentVersion, "2x"),
      updated_at: manifest.updatedAt,
      source_skill_id: manifest.sourceSkillId,
      superseded,
    });
  }

  return { artifacts };
}

async function getProductArtifact(store: FormaStore, input: z.infer<typeof getProductArtifactSchema>) {
  const { product_id, artifact_id } = input;

  // Determine available versions
  const versions = await store.artifacts.listArtifactVersions(product_id, artifact_id);

  // Determine current version from design pointer (if any) or max version
  const designPointers = await store.products.listDesignPointers(product_id);
  const pointer = designPointers.find((p) => p.artifactId === artifact_id);

  let manifest: ArtifactManifest;
  let currentVersion: number | undefined;

  if (versions.length > 0) {
    currentVersion = pointer?.version ?? Math.max(...versions);
    ({ manifest } = await store.artifacts.readArtifactVersion(product_id, artifact_id, currentVersion));
  } else {
    // Bug #4: fall back to flat (legacy) artifact when no versioned dirs exist
    try {
      ({ manifest } = await store.artifacts.readArtifact(product_id, artifact_id));
    } catch {
      throw new FormaError("ARTIFACT_NOT_FOUND", "Artifact not found or has no versions", {
        artifact_id,
        product_id,
      });
    }
    currentVersion = undefined;
  }

  // Normalize kind and forma extension
  manifest.kind = normalizeKind(manifest.kind);
  if (manifest.forma) {
    manifest.forma = normalizeFormaExtension(manifest.forma);
  }

  // Build bundle URL and preview URL (versioned only; null for legacy flat artifacts)
  const bundle_url =
    currentVersion !== undefined ? artifactBundleUrl(product_id, artifact_id, currentVersion, manifest.entry) : null;
  const preview_url =
    currentVersion !== undefined ? artifactPreviewUrl(product_id, artifact_id, currentVersion, "2x") : null;

  // Build per-asset density URL map
  const assets = (manifest.forma?.assets ?? []).map((entry) => {
    const urls: Record<string, string> = {};
    if (currentVersion !== undefined) {
      for (const d of entry.density) {
        const densityPath = assetDensityPath(entry.path, d);
        urls[`${d}x`] = artifactBundleUrl(product_id, artifact_id, currentVersion!, densityPath);
      }
    }
    return {
      path: entry.path,
      role: entry.role,
      density: entry.density,
      ...(entry.degraded !== undefined ? { degraded: entry.degraded } : {}),
      urls,
    };
  });

  return {
    manifest,
    bundle_url,
    assets,
    preview_url,
    versions,
    current_version: currentVersion ?? null,
  };
}

async function exportArtifact(
  store: FormaStore,
  input: z.infer<typeof exportArtifactSchema>,
): Promise<{ output_path: string; note?: string }> {
  const { product_id, artifact_id, format } = input;

  // Determine current version
  const versions = await store.artifacts.listArtifactVersions(product_id, artifact_id);
  let currentVersion: number;
  let manifest: ArtifactManifest;

  if (versions.length > 0) {
    const designPointers = await store.products.listDesignPointers(product_id);
    const pointer = designPointers.find((p) => p.artifactId === artifact_id);
    currentVersion = pointer?.version ?? Math.max(...versions);
    ({ manifest } = await store.artifacts.readArtifactVersion(product_id, artifact_id, currentVersion));
  } else {
    // Fall back to legacy unversioned artifact
    ({ manifest } = await store.artifacts.readArtifact(product_id, artifact_id));
    currentVersion = 1;
  }

  assertArtifactSupportsExportFormat(manifest, artifact_id, format);

  const productsDir = getFormaPaths(store.home).productsDir;

  // Use versioned dir when versions exist, otherwise legacy unversioned dir
  const artifactBase =
    versions.length > 0
      ? getArtifactVersionDir(productsDir, product_id, artifact_id, currentVersion)
      : getArtifactDir(productsDir, product_id, artifact_id);

  const exportsDir = join(store.home, "exports", product_id);
  await mkdir(exportsDir, { recursive: true });

  const outputPath = join(exportsDir, `${artifact_id}.${format}`);

  if (format === "png") {
    let previewSrc: string;
    if (versions.length > 0) {
      previewSrc = getArtifactVersionPreviewPath(productsDir, product_id, artifact_id, currentVersion, "2x");
    } else {
      previewSrc = join(artifactBase, "preview", "2x.png");
    }
    await copyFile(previewSrc, outputPath);
  } else if (format === "html" || format === "svg") {
    const entry = artifactExportEntry(manifest, format);
    if (entry === undefined) {
      throw unsupportedArtifactFormatError(manifest, artifact_id, format);
    }
    const entrySrc = join(artifactBase, entry);
    await copyFile(entrySrc, outputPath);
    const hasAssets = (manifest.supportingFiles ?? []).some((f) => f.startsWith("assets/"));
    if (hasAssets) {
      return {
        output_path: outputPath,
        note: "Only the single entry file is included. Assets are not exported in html/svg format. Use format=zip for the complete self-contained bundle.",
      };
    }
  } else if (format === "zip") {
    const zip = new AdmZip();
    try {
      const manifestJson = JSON.stringify(manifest, null, 2);
      zip.addFile("manifest.json", Buffer.from(manifestJson, "utf8"));
      const addedFiles = new Set<string>();

      addArtifactFileToZip(zip, artifactBase, manifest.entry, addedFiles);
      for (const relPath of manifest.supportingFiles ?? []) {
        if (addedFiles.has(relPath)) {
          continue;
        }
        try {
          addArtifactFileToZip(zip, artifactBase, relPath, addedFiles);
        } catch {
          // Skip unreadable supporting files
        }
      }

      try {
        if (versions.length > 0) {
          const previewSrc = getArtifactVersionPreviewPath(productsDir, product_id, artifact_id, currentVersion, "2x");
          const previewBuf = await readFile(previewSrc);
          zip.addFile("preview/2x.png", previewBuf);
        } else {
          zip.addLocalFile(join(artifactBase, "preview", "2x.png"), "preview");
        }
      } catch {
        // Preview may not exist for all artifact kinds
      }

      zip.writeZip(outputPath);
    } catch (err) {
      await rm(outputPath, { force: true }).catch(() => undefined);
      throw err;
    }
  } else if (format === "icons") {
    const htmlEntry = artifactExportEntry(manifest, "html");
    if (htmlEntry === undefined) {
      throw unsupportedArtifactFormatError(manifest, artifact_id, format);
    }
    return await exportArtifactIcons(artifactBase, htmlEntry, artifact_id, product_id, exportsDir);
  } else if (format === "vzi") {
    const htmlEntry = artifactExportEntry(manifest, "html");
    if (htmlEntry === undefined) {
      throw unsupportedArtifactFormatError(manifest, artifact_id, format);
    }
    return await exportArtifactVzi(artifactBase, htmlEntry, artifact_id, product_id, exportsDir);
  }

  return { output_path: outputPath };
}

/**
 * Manual icon export for a single artifact: reads the manifest HTML entry, runs
 * extractIconAssets, and writes the result to an export staging directory.
 * Does NOT touch archive state or requirement status.
 */
async function exportArtifactIcons(
  artifactBase: string,
  htmlEntry: string,
  artifactId: string,
  productId: string,
  exportsDir: string,
): Promise<{ output_path: string }> {
  const htmlPath = join(artifactBase, htmlEntry);
  let html: string;
  try {
    html = await readFile(htmlPath, "utf8");
  } catch (err) {
    throw new FormaError("ARTIFACT_NOT_FOUND", `Could not read ${htmlEntry} for artifact ${artifactId}`, {
      artifactId,
      path: htmlPath,
      cause: String(err),
    });
  }

  let result: Awaited<ReturnType<typeof extractIconAssets>>;
  try {
    result = await extractIconAssets(html, {
      artifactId,
      productId,
      requirementId: "manual-export",
      pageId: "manual",
      version: "manual",
      generatedFrom: "manual-export",
    });
  } catch (err) {
    if (err instanceof FormaError) throw err;
    throw new FormaError(
      "ARTIFACT_WRITE_FAIL",
      `Icon extraction failed for artifact ${artifactId}: ${err instanceof Error ? err.message : String(err)}`,
      { artifactId, productId, cause: String(err) },
    );
  }

  // Write to export staging dir: <exportsDir>/<artifactId>.icons/
  const iconsExportDir = join(exportsDir, `${artifactId}.icons`);
  await rm(iconsExportDir, { recursive: true, force: true });
  await mkdir(iconsExportDir, { recursive: true });

  for (const [relativePath, buf] of result.files) {
    const destPath = join(iconsExportDir, relativePath);
    const destDir = dirname(destPath);
    await mkdir(destDir, { recursive: true });
    await writeFile(destPath, buf);
  }

  // Write icons.json manifest
  await writeFile(join(iconsExportDir, "icons.json"), JSON.stringify(result.manifest, null, 2), "utf8");

  return { output_path: iconsExportDir };
}

/**
 * Manual VZI export for a single artifact: reads the manifest HTML entry, runs the
 * PuppeteerParser → VZITransformer → VZIEncoder chain, and writes the result
 * to an export staging file.
 * Does NOT touch archive state or requirement status.
 * Icon resource linking is OPTIONAL for manual export; this implementation
 * generates a valid decodable .vzi without icon assetRef injection.
 */
async function exportArtifactVzi(
  artifactBase: string,
  htmlEntry: string,
  artifactId: string,
  productId: string,
  exportsDir: string,
): Promise<{ output_path: string }> {
  const htmlPath = join(artifactBase, htmlEntry);
  let html: string;
  try {
    html = await readFile(htmlPath, "utf8");
  } catch (err) {
    throw new FormaError("ARTIFACT_NOT_FOUND", `Could not read ${htmlEntry} for artifact ${artifactId}`, {
      artifactId,
      path: htmlPath,
      cause: String(err),
    });
  }

  // Parse HTML → IR via Puppeteer
  let ir: import("@vzi-core/types").IntermediateRepresentation;
  const parser = new PuppeteerParser({
    viewportPreset: "desktop",
    baseUrl: pathToFileURL(`${artifactBase}/`).toString(),
  });
  try {
    ir = await parser.parse(html);
  } catch (err) {
    throw new FormaError(
      "ARTIFACT_WRITE_FAIL",
      `VZI parse failed for artifact ${artifactId}: ${err instanceof Error ? err.message : String(err)}`,
      { artifactId, productId, cause: String(err) },
    );
  } finally {
    await parser.dispose().catch(() => undefined);
  }

  // Transform IR → VZIContent
  let vziBytes: Uint8Array;
  try {
    const transformer = new VZITransformer({
      title: artifactId,
      createdBy: "forma-manual-export",
      sourceType: "file",
      sourceIdentifier: `${productId}/${artifactId}`,
      enableAnnotations: true,
      enableTokenExtraction: true,
    });
    const transformResult = transformer.transform(ir);
    const content = buildVziContentFromTransformResult(transformResult);

    // Attach Forma metadata
    const extMeta = content.metadata as typeof content.metadata & Record<string, unknown>;
    extMeta["formaProductId"] = productId;
    extMeta["formaArtifactId"] = artifactId;
    extMeta["formaGenerationSource"] = "forma-manual-export";

    const encoder = new VZIEncoder();
    vziBytes = encoder.encode(content);
  } catch (err) {
    throw new FormaError(
      "ARTIFACT_WRITE_FAIL",
      `VZI encode failed for artifact ${artifactId}: ${err instanceof Error ? err.message : String(err)}`,
      { artifactId, productId, cause: String(err) },
    );
  }

  const vziOutputPath = join(exportsDir, `${artifactId}.vzi`);
  await writeFile(vziOutputPath, Buffer.from(vziBytes));

  return { output_path: vziOutputPath };
}

function assertArtifactSupportsExportFormat(
  manifest: ArtifactManifest,
  artifactId: string,
  format: z.infer<typeof exportArtifactSchema>["format"],
): void {
  // Formats that are always supported regardless of artifact kind
  if (format === "zip" || format === "png") {
    return;
  }

  if (format === "icons" || format === "vzi") {
    if (artifactExportEntry(manifest, "html") !== undefined) {
      return;
    }
    throw unsupportedArtifactFormatError(manifest, artifactId, format);
  }

  if (artifactExportEntry(manifest, format) !== undefined) {
    return;
  }

  throw unsupportedArtifactFormatError(manifest, artifactId, format);
}

function unsupportedArtifactFormatError(
  manifest: ArtifactManifest,
  artifactId: string,
  format: z.infer<typeof exportArtifactSchema>["format"],
): FormaError {
  return new FormaError("ARTIFACT_UNSUPPORTED_FORMAT", "Artifact does not support requested export format", {
    artifact_id: artifactId,
    kind: manifest.kind,
    format,
    exports: manifest.exports,
  });
}

function artifactExportEntry(manifest: ArtifactManifest, format: "html" | "svg"): string | undefined {
  const extension = `.${format}`;
  if (manifest.kind === format || manifest.entry.toLowerCase().endsWith(extension)) {
    return manifest.entry;
  }
  return manifest.exports.find((path) => path.toLowerCase().endsWith(extension));
}

function addArtifactFileToZip(zip: AdmZip, artifactDir: string, relPath: string, addedFiles: Set<string>): void {
  const srcPath = join(artifactDir, relPath);
  zip.addLocalFile(srcPath, archiveDirname(relPath));
  addedFiles.add(relPath);
}

function archiveDirname(relPath: string): string {
  return relPath.includes("/") ? relPath.substring(0, relPath.lastIndexOf("/")) : "";
}

// ─── Retained tool implementations ───────────────────────────────────────────

async function confirmProductId(store: FormaStore, input: z.infer<typeof confirmProductIdSchema>) {
  const { product_id, expected_name } = input;
  const product = await store.products.getProduct(product_id);
  const confirmed = expected_name === undefined || expected_name === product.name;
  return { confirmed, name: product.name };
}

async function getStyle(store: FormaStore, name: string) {
  const brandStyles = await store.styles.listStyles();
  if (brandStyles.some((s) => s.name === name)) {
    return store.styles.getStyle(name);
  }
  const systemStyles = await store.styles.listSystemStyles();
  const systemStyle = systemStyles.find((s) => s.name === name);
  if (systemStyle) {
    return systemStyle;
  }
  throw new FormaError("INVALID_INPUT", "Style not found", { style: name });
}

function successResult(data: unknown): FormaToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function errorResult(error: unknown): FormaToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(toFormaErrorPayload(error)) }] };
}

function toFormaErrorPayload(error: unknown): {
  error_code: string;
  message: string;
  details: Record<string, unknown>;
} {
  if (error instanceof FormaError) {
    return error.toJSON();
  }
  if (error instanceof z.ZodError) {
    const forbiddenPathIssue = error.issues.find((issue) => issue.message === "FORBIDDEN_PATH_PARAMETER");
    if (forbiddenPathIssue) {
      return {
        error_code: "FORBIDDEN_PATH_PARAMETER",
        message: "Path parameters are not allowed",
        details: { parameter: forbiddenPathIssue.path.join(".") },
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
      page_id: input.page_id,
    });
  }

  const translations = await store.copy.getTranslations(requirement.product_id, requirement.id);
  return {
    product_id: requirement.product_id,
    requirement_id: requirement.id,
    page_id: input.page_id,
    copy: page.copy ?? [],
    translations: translations.find((item) => item.page_id === input.page_id) ?? {
      page_id: input.page_id,
      entries: [],
    },
  };
}

async function getProductRequirement(store: FormaStore, productId: string, requirementId: string) {
  const requirement = await store.requirements.getRequirement({ requirement_id: requirementId });
  if (requirement.product_id !== productId) {
    throw new FormaError("REQUIREMENT_PRODUCT_MISMATCH", "Requirement does not belong to product", {
      product_id: productId,
      requirement_id: requirementId,
      requirement_product_id: requirement.product_id,
    });
  }

  return requirement;
}

async function getLatestNonArchivedRequirement(store: FormaStore, productId: string) {
  return store.requirements.getLatestRequirement(productId);
}

async function getProductBaseline(store: FormaStore, productId: string) {
  await store.products.getProduct(productId);
  const requirements = (await store.requirements.getRequirementHistory(productId))
    .filter((requirement) => requirement.status !== "archived")
    .sort(compareRequirementsOldestFirst);
  const pagesById = new Map<string, BaselinePageRecord>();
  const navigation: unknown[] = [];

  for (const requirement of requirements) {
    if (Array.isArray(requirement.navigation)) {
      navigation.push(...mapRequirementNavigationToBaseline(requirement.pages, requirement.navigation));
    }

    for (const page of requirement.pages) {
      const pageId = stringValue(page.baseline_page) ?? stringValue(page.page_id);
      if (!pageId) {
        continue;
      }

      const existing = pagesById.get(pageId);
      pagesById.set(pageId, {
        id: pageId,
        name: stringValue(page.name) ?? existing?.name ?? pageId,
        features: stringValue(page.features) ?? existing?.features ?? "",
        copy: Array.isArray(page.copy) ? page.copy : (existing?.copy ?? []),
        fields: stringValue(page.fields) ?? existing?.fields ?? "",
        interactions: stringValue(page.interactions) ?? existing?.interactions ?? "",
        ...(page.semantic_contract !== undefined ? { semantic_contract: page.semantic_contract } : {}),
        ...(page.semantic_contract_coverage !== undefined
          ? { semantic_contract_coverage: page.semantic_contract_coverage }
          : {}),
        source_requirements: uniqueStrings([...(existing?.source_requirements ?? []), requirement.id]),
      });
    }
  }

  return {
    baseline: {
      product_id: productId,
      pages: [...pagesById.values()],
      navigation,
    },
  };
}

function mapRequirementNavigationToBaseline(pages: RequirementHistoryPageRecord[], navigation: unknown[]): unknown[] {
  const pageToBaseline = new Map<string, string>();
  for (const page of pages) {
    const pageId = stringValue(page.page_id);
    const baselineId = stringValue(page.baseline_page) ?? pageId;
    if (!pageId || !baselineId) {
      continue;
    }
    pageToBaseline.set(pageId, baselineId);
    pageToBaseline.set(baselineId, baselineId);
  }

  return navigation.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const fromRaw = stringValue(item.from);
    const toRaw = stringValue(item.to);
    if (!fromRaw || !toRaw) {
      return [];
    }
    return [
      {
        ...item,
        from: pageToBaseline.get(fromRaw) ?? fromRaw,
        to: pageToBaseline.get(toRaw) ?? toRaw,
      },
    ];
  });
}

function compareRequirementsOldestFirst(left: RequirementHistoryRecord, right: RequirementHistoryRecord): number {
  return timestampForRequirement(left) - timestampForRequirement(right) || left.id.localeCompare(right.id);
}

function timestampForRequirement(requirement: RequirementHistoryRecord): number {
  const updatedAt = requirement.updated_at ? Date.parse(requirement.updated_at) : Number.NaN;
  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }
  const createdAt = requirement.created_at ? Date.parse(requirement.created_at) : Number.NaN;
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

async function getBaselinePage(store: FormaStore, productId: string, pageId: string) {
  const product = await store.products.getProduct(productId);
  if (!product.designSystemArtifactId) {
    throw new FormaError("ARTIFACT_NOT_FOUND", "No baseline artifact for this product", { product_id: productId });
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
    throw new FormaError("ARTIFACT_NOT_FOUND", "No baseline artifact for this product", { product_id: productId });
  }
  const productsDir = getFormaPaths(store.home).productsDir;
  const artifactDir = getArtifactDir(productsDir, productId, product.designSystemArtifactId);
  return { path: join(artifactDir, "preview", "2x.png") };
}

function titleFromToolName(name: string): string {
  return name
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
