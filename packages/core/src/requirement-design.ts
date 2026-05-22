import { createHash, randomBytes } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { z } from "zod";
import { assertDesignQualityPassed, runDesignQualityPipeline, type DesignQualityReport } from "./design-quality.js";
import { commitRequirementDesignSessionWithCandidates, type RequirementCommitCandidate } from "./design-session.js";
import { FormaError } from "./errors.js";
import { isRecord, nodeMetadataString, normalizeDesignName, parsePenDocument, walkPenNodes, type PenDocument, type PenNode } from "./pen-model.js";
import { PencilAppSessionAdapter } from "./pencil-adapter.js";
import { defaultPencilRunner } from "./pencil.js";
import { requirementSchema, type Requirement, type RequirementPage } from "./requirement.js";
import { deriveAllowedSemanticSurface, readSemanticScope } from "./semantic-scope.js";
import { parseSessionId } from "./session-id.js";
import { readYaml, readYamlAs, writeYamlAtomic } from "./yaml.js";

const productIdSchema = z.string().regex(/^P-[a-f0-9]{6}$/);
const requirementIdSchema = z.string().regex(/^R-[a-f0-9]{8}$/);

const relativePathSchema = z.string().min(1).refine((value) => !isAbsolute(value) && !normalize(value).split(/[\\/]/).includes(".."), {
  message: "path must be relative"
});

export const requirementDesignPageSchema = z.object({
  page_id: z.string().min(1),
  status: z.enum(["pending", "done", "expired"]).optional().default("pending"),
  preview_file: relativePathSchema.optional(),
  page_version: z.number().int().nonnegative().optional(),
  frame_id: z.string().min(1).optional(),
  frame_snapshot_file: relativePathSchema.optional(),
  semantic_mode: z.enum(["managed", "unmanaged_import"]).optional(),
  warnings: z.array(z.string()).optional(),
  quality_report_file: relativePathSchema.optional()
}).strict();

export const requirementDesignMetadataSchema = z.object({
  schema_version: z.literal(1),
  product_id: productIdSchema,
  requirement_id: requirementIdSchema,
  canvas_file: relativePathSchema,
  canvas_version: z.number().int().nonnegative(),
  canvas_revision: z.string().min(1).optional(),
  component_library_version: z.number().int().positive().optional(),
  pages: z.array(requirementDesignPageSchema),
  unmanaged_components: z.array(z.object({
    node_id: z.string().min(1),
    name: z.string().optional(),
    classification: z.enum(["unmanaged_component_candidate", "top_level_non_page"])
  }).strict()).default([]),
  history: z.array(z.object({
    version: z.number().int().nonnegative().optional(),
    file: relativePathSchema.optional(),
    session_id: z.string().min(1).optional(),
    audit_link: relativePathSchema.optional(),
    created_at: z.string().optional()
  }).strict()).default([])
}).strict();

export type RequirementDesignMetadata = z.infer<typeof requirementDesignMetadataSchema>;
export type RequirementDesignPageMetadata = z.infer<typeof requirementDesignPageSchema>;

export interface RequirementDesignPaths {
  requirement_dir: string;
  canvas_file: string;
  metadata_file: string;
  previews_dir: string;
  canvas_history_dir: string;
  page_history_dir: string;
  preview_history_dir: string;
}

export interface RequirementFrameMapping {
  page_id: string;
  frame_id: string;
  strategy: "metadata_page_id" | "normalized_frame_prefix" | "normalized_name";
}

export interface UnmanagedComponentCandidate {
  node_id: string;
  name?: string;
  classification: "unmanaged_component_candidate" | "top_level_non_page";
}

export interface RequirementFrameMappingResult {
  mappings: RequirementFrameMapping[];
  unmanaged_components: UnmanagedComponentCandidate[];
}

export interface IndexRequirementDesignCanvasResult {
  product_id: string;
  requirement_id: string;
  canvas_version: number;
  canvas_revision: string;
  pages: RequirementDesignPageMetadata[];
  unmanaged_components: UnmanagedComponentCandidate[];
  blocked_pages: Array<{ page_id: string; frame_id: string; code: string; message: string }>;
}

const pageFrameKinds = new Set(["page_frame", "page"]);
const frameTypes = new Set(["frame", "artboard", "canvas"]);
const unmanagedComponentNames = new Set([
  "button",
  "card",
  "checkbox",
  "divider",
  "input",
  "modal",
  "select",
  "table",
  "tabs",
  "toast"
]);

export type RequirementDesignReadModel =
  | {
      status: "missing";
      product_id: string;
      requirement_id: string;
      metadata_path: string;
      canvas_path: string;
      pages: [];
    }
  | {
      status: "complete";
      product_id: string;
      requirement_id: string;
      metadata_path: string;
      canvas_path: string;
      canvas_version: number;
      canvas_revision?: string;
      component_library_version?: number;
      pages: Array<z.infer<typeof requirementDesignPageSchema> & { preview_path?: string }>;
      history: Array<{ version?: number; file?: string; session_id?: string; audit_link?: string; created_at?: string }>;
    }
  | {
      status: "invalid";
      product_id: string;
      requirement_id: string;
      metadata_path: string;
      canvas_path: string;
      missing_files: string[];
      error?: string;
    };

export async function getRequirementDesign(home: string, productId: string, requirementId: string): Promise<RequirementDesignReadModel> {
  const parsedProductId = productIdSchema.parse(productId);
  const parsedRequirementId = requirementIdSchema.parse(requirementId);
  const requirementDir = join(resolve(home), "data", parsedProductId, parsedRequirementId);
  const metadataPath = join(requirementDir, "design.yaml");
  const canvasPath = join(requirementDir, "design.pen");

  if (!(await pathExists(metadataPath))) {
    return {
      status: "missing",
      product_id: parsedProductId,
      requirement_id: parsedRequirementId,
      metadata_path: metadataPath,
      canvas_path: canvasPath,
      pages: []
    };
  }

  let metadata: z.infer<typeof requirementDesignMetadataSchema>;
  try {
    await assertRegularFileUnderRoot(requirementDir, metadataPath);
    metadata = await readYamlAs(metadataPath, requirementDesignMetadataSchema);
    if (metadata.product_id !== parsedProductId || metadata.requirement_id !== parsedRequirementId) {
      throw new Error("requirement design metadata does not match path");
    }
  } catch (error) {
    return {
      status: "invalid",
      product_id: parsedProductId,
      requirement_id: parsedRequirementId,
      metadata_path: metadataPath,
      canvas_path: canvasPath,
      missing_files: [],
      error: errorMessage(error)
    };
  }
  const resolvedCanvasPath = join(requirementDir, metadata.canvas_file);
  const missingFiles = [
    resolvedCanvasPath,
    ...metadata.pages.flatMap((page) => page.preview_file ? [join(requirementDir, page.preview_file)] : []),
    ...metadata.history.flatMap((entry) => entry.file ? [join(requirementDir, entry.file)] : [])
  ].filter((file, index, files) => files.indexOf(file) === index);
  const missing = [];
  for (const file of missingFiles) {
    const validation = await validateRegularFileUnderRoot(requirementDir, file);
    if (validation.status === "missing") {
      missing.push(file);
    } else if (validation.status === "invalid") {
      return {
        status: "invalid",
        product_id: parsedProductId,
        requirement_id: parsedRequirementId,
        metadata_path: metadataPath,
        canvas_path: resolvedCanvasPath,
        missing_files: [],
        error: validation.error
      };
    }
  }
  if (missing.length > 0) {
    return {
      status: "invalid",
      product_id: parsedProductId,
      requirement_id: parsedRequirementId,
      metadata_path: metadataPath,
      canvas_path: resolvedCanvasPath,
      missing_files: missing
    };
  }

  return {
    status: "complete",
    product_id: parsedProductId,
    requirement_id: parsedRequirementId,
    metadata_path: metadataPath,
    canvas_path: resolvedCanvasPath,
    canvas_version: metadata.canvas_version,
    canvas_revision: metadata.canvas_revision,
    component_library_version: metadata.component_library_version,
    pages: metadata.pages.map((page) => ({
      ...page,
      ...(page.preview_file ? { preview_path: join(requirementDir, page.preview_file) } : {})
    })),
    history: metadata.history
  };
}

export function requirementDesignPaths(home: string, productId: string, requirementId: string): RequirementDesignPaths {
  const productIdParsed = productIdSchema.parse(productId);
  const requirementIdParsed = requirementIdSchema.parse(requirementId);
  const requirementDir = join(resolve(home), "data", productIdParsed, requirementIdParsed);
  return {
    requirement_dir: requirementDir,
    canvas_file: join(requirementDir, "design.pen"),
    metadata_file: join(requirementDir, "design.yaml"),
    previews_dir: join(requirementDir, "previews"),
    canvas_history_dir: join(requirementDir, "history", "canvas"),
    page_history_dir: join(requirementDir, "history", "pages"),
    preview_history_dir: join(requirementDir, "history", "previews")
  };
}

export function requirementDesignRelativePaths(pageId: string, canvasVersion: number, pageVersion: number): {
  canvas: string;
  metadata: string;
  preview: string;
  canvas_history_pen: string;
  canvas_history_metadata: string;
  page_fragment: string;
  historical_preview: string;
} {
  return {
    canvas: "design.pen",
    metadata: "design.yaml",
    preview: `previews/${pageId}@2x.png`,
    canvas_history_pen: `history/canvas/canvas.c${canvasVersion}.pen`,
    canvas_history_metadata: `history/canvas/canvas.c${canvasVersion}.yaml`,
    page_fragment: `history/pages/${pageId}.p${pageVersion}.pen-fragment`,
    historical_preview: `history/previews/${pageId}.p${pageVersion}@2x.png`
  };
}

export async function readRequirementDesignMetadata(home: string, productId: string, requirementId: string): Promise<RequirementDesignMetadata> {
  return readYamlAs(requirementDesignPaths(home, productId, requirementId).metadata_file, requirementDesignMetadataSchema);
}

export async function writeRequirementDesignMetadata(
  home: string,
  productId: string,
  requirementId: string,
  metadata: RequirementDesignMetadata
): Promise<void> {
  await writeYamlAtomic(requirementDesignPaths(home, productId, requirementId).metadata_file, requirementDesignMetadataSchema.parse(metadata));
}

export function resolveRequirementPageFrames(requirement: Pick<Requirement, "pages">, document: PenDocument): RequirementFrameMappingResult {
  const topLevel = document.children;
  const pagesById = new Map(requirement.pages.map((page) => [page.page_id, page]));
  const mappings: RequirementFrameMapping[] = [];
  const usedFrameIds = new Set<string>();
  const unmanaged_components = classifyUnmanagedTopLevelCandidates(topLevel);

  for (const node of topLevel) {
    const metadataPageId = nodeMetadataString(node, "page_id");
    const kind = nodeMetadataString(node, "kind");
    if (metadataPageId && kind && !pageFrameKinds.has(kind)) {
      continue;
    }
    if (metadataPageId) {
      const metadataPage = pagesById.get(metadataPageId);
      const nameMatch = requirement.pages.find((page) => normalizeDesignName(page.name) === normalizeDesignName(node.name ?? ""));
      if (!metadataPage || (nameMatch && nameMatch.page_id !== metadataPageId)) {
        throw new FormaError("PAGE_FRAME_MISMATCH", "Page frame metadata conflicts with requirement pages", {
          frame_id: node.id,
          metadata_page_id: metadataPageId,
          name_page_id: nameMatch?.page_id
        });
      }
      mappings.push({ page_id: metadataPageId, frame_id: node.id, strategy: "metadata_page_id" });
      usedFrameIds.add(node.id);
    }
  }

  for (const page of requirement.pages) {
    if (mappings.some((mapping) => mapping.page_id === page.page_id)) {
      continue;
    }
    const prefixCandidates = candidateFrames(topLevel, usedFrameIds).filter((node) =>
      normalizeDesignName(node.name ?? "").startsWith(normalizeDesignName(page.page_id))
    );
    if (prefixCandidates.length > 1) {
      throw new FormaError("PAGE_FRAME_AMBIGUOUS", "Multiple frames match page id prefix", { page_id: page.page_id, frame_ids: prefixCandidates.map((node) => node.id) });
    }
    if (prefixCandidates.length === 1) {
      mappings.push({ page_id: page.page_id, frame_id: prefixCandidates[0]!.id, strategy: "normalized_frame_prefix" });
      usedFrameIds.add(prefixCandidates[0]!.id);
      continue;
    }

    const nameCandidates = candidateFrames(topLevel, usedFrameIds).filter((node) =>
      normalizeDesignName(node.name ?? "") === normalizeDesignName(page.name)
    );
    if (nameCandidates.length > 1) {
      throw new FormaError("PAGE_FRAME_AMBIGUOUS", "Multiple frames match page name", { page_id: page.page_id, frame_ids: nameCandidates.map((node) => node.id) });
    }
    if (nameCandidates.length === 1) {
      mappings.push({ page_id: page.page_id, frame_id: nameCandidates[0]!.id, strategy: "normalized_name" });
      usedFrameIds.add(nameCandidates[0]!.id);
      continue;
    }
    throw new FormaError("PAGE_FRAME_NOT_FOUND", "Page frame was not found", { page_id: page.page_id });
  }

  return { mappings, unmanaged_components };
}

export async function indexRequirementDesignCanvas(input: {
  home: string;
  product_id: string;
  requirement_id: string;
  previewExporter?: (input: { frame_id: string; page_id: string; output_file: string }) => Promise<void>;
  testHooks?: {
    afterPromote?: (entry: { kind: string; target_file: string }) => Promise<void> | void;
  };
}): Promise<IndexRequirementDesignCanvasResult> {
  const paths = requirementDesignPaths(input.home, input.product_id, input.requirement_id);
  const requirementFile = join(paths.requirement_dir, "requirement.yaml");
  const requirement = await readYamlAs(requirementFile, requirementSchema);
  const canvasRaw = await readFile(paths.canvas_file, "utf8");
  const document = parsePenDocument(canvasRaw);
  const mapping = resolveRequirementPageFrames(requirement, document);
  const semanticScope = await deriveAllowedSemanticSurface({
    home: input.home,
    product_id: input.product_id,
    requirement_id: input.requirement_id,
    language: "default",
    current_design: document
  });
  const previous = await getRequirementDesign(input.home, input.product_id, input.requirement_id);
  const previousCanvasVersion = previous.status === "complete" ? previous.canvas_version : 0;
  const stageDir = join(paths.requirement_dir, `.index-stage-${randomBytes(8).toString("hex")}`);
  const stagePreviews = join(stageDir, "previews");
  await mkdir(stagePreviews, { recursive: true });
  const canvasVersion = previous.status === "complete" ? previousCanvasVersion + 1 : 1;
  const canvasRevision = sha256(await readFile(paths.canvas_file));
  const promotedTargets: IndexPromotionSnapshot[] = [];
  try {
    const pages: RequirementDesignPageMetadata[] = [];
    const blockedPages: IndexRequirementDesignCanvasResult["blocked_pages"] = [];
    for (const page of requirement.pages) {
      const found = mapping.mappings.find((item) => item.page_id === page.page_id)!;
      const frame = walkPenNodes(document.children).find((node) => node.id === found.frame_id);
      if (!frame) {
        throw new FormaError("PAGE_FRAME_NOT_FOUND", "Page frame was not found", { page_id: page.page_id, frame_id: found.frame_id });
      }
      const qualityReport = await runDesignQualityPipeline({
        document: { children: [frame] },
        semantic_scope: semanticScope
      });
      if (qualityReport.status === "blocked") {
        const firstIssue = qualityReport.hard_checks.issues[0];
        blockedPages.push({
          page_id: page.page_id,
          frame_id: found.frame_id,
          code: firstIssue?.code ?? "INVALID_INPUT",
          message: firstIssue?.message ?? "Design quality blocked"
        });
        pages.push(requirementDesignPageSchema.parse({
          page_id: page.page_id,
          status: page.design_status === "done" ? "done" : "pending",
          frame_id: found.frame_id,
          semantic_mode: hasFormaMetadata(document, found.frame_id) ? "managed" : "unmanaged_import",
          warnings: qualityReport.hard_checks.issues.map((issue) => issue.code)
        }));
        continue;
      }
      const previousPage = previous.status === "complete" ? previous.pages.find((item) => item.page_id === page.page_id) : undefined;
      const pageVersion = (previousPage?.page_version ?? 0) + 1;
      const relativePaths = requirementDesignRelativePaths(page.page_id, canvasVersion, pageVersion);
      const candidatePreview = join(stagePreviews, `${page.page_id}@2x.png`);
      const candidatePageFragment = join(stageDir, `${page.page_id}.p${pageVersion}.pen-fragment`);
      if (input.previewExporter) {
        try {
          await input.previewExporter({ frame_id: found.frame_id, page_id: page.page_id, output_file: candidatePreview });
        } catch (error) {
          throw new FormaError("PREVIEW_EXPORT_FAILED", "Preview candidate export failed", {
            page_id: page.page_id,
            reason: errorMessage(error)
          });
        }
      } else {
        await writeFile(candidatePreview, "");
      }
      await writeFile(candidatePageFragment, JSON.stringify(frame, null, 2), "utf8");
      pages.push(requirementDesignPageSchema.parse({
        page_id: page.page_id,
        status: "done",
        preview_file: relativePaths.preview,
        page_version: pageVersion,
        frame_id: found.frame_id,
        frame_snapshot_file: relativePaths.page_fragment,
        semantic_mode: hasFormaMetadata(document, found.frame_id) ? "managed" : "unmanaged_import",
        warnings: hasFormaMetadata(document, found.frame_id) ? [] : ["UNMANAGED_COPY_UNVERIFIED"]
      }));
    }

    const metadata: RequirementDesignMetadata = requirementDesignMetadataSchema.parse({
      schema_version: 1,
      product_id: input.product_id,
      requirement_id: input.requirement_id,
      canvas_file: "design.pen",
      canvas_version: canvasVersion,
      canvas_revision: canvasRevision,
      pages,
      unmanaged_components: mapping.unmanaged_components,
      history: [
        ...(previous.status === "complete" ? previous.history : []),
        {
          version: canvasVersion,
          file: `history/canvas/canvas.c${canvasVersion}.pen`,
          created_at: new Date().toISOString()
        }
      ]
    });
    const metadataCandidate = join(stageDir, "design.yaml");
    await writeYamlAtomic(metadataCandidate, metadata);
    const requirementCandidate = join(stageDir, "requirement.yaml");
      await writeYamlAtomic(requirementCandidate, requirementSchema.parse({
        ...requirement,
        status: pages.length === requirement.pages.length && pages.every((page) => page.status === "done") ? "active" : requirement.status,
        updated_at: new Date().toISOString(),
        pages: requirement.pages.map((page) => {
          const indexed = pages.find((item) => item.page_id === page.page_id);
        return indexed ? { ...page, design_status: indexed.status } : page;
      })
    }));
    const historyPen = join(stageDir, "canvas.history.pen");
    const historyYaml = join(stageDir, "canvas.history.yaml");
    await copyFile(paths.canvas_file, historyPen);
    await writeYamlAtomic(historyYaml, metadata);
    await writeYamlAtomic(join(stageDir, "index-journal.yaml"), {
      schema_version: 1,
      status: "committing",
      product_id: input.product_id,
      requirement_id: input.requirement_id
    });
    await mkdir(paths.previews_dir, { recursive: true });
    await mkdir(paths.canvas_history_dir, { recursive: true });
    for (const page of pages) {
      if (!page.preview_file) {
        continue;
      }
      await promoteIndexFile(input.home, join(stagePreviews, `${page.page_id}@2x.png`), join(paths.requirement_dir, page.preview_file!), "preview", promotedTargets, input.testHooks);
    }
    for (const page of pages) {
      if (!page.frame_snapshot_file || page.page_version === undefined) {
        continue;
      }
      await promoteIndexFile(
        input.home,
        join(stageDir, `${page.page_id}.p${page.page_version}.pen-fragment`),
        join(paths.requirement_dir, page.frame_snapshot_file),
        "page_fragment",
        promotedTargets,
        input.testHooks
      );
    }
    await promoteIndexFile(input.home, historyPen, join(paths.canvas_history_dir, `canvas.c${canvasVersion}.pen`), "canvas_history", promotedTargets, input.testHooks);
    await promoteIndexFile(input.home, historyYaml, join(paths.canvas_history_dir, `canvas.c${canvasVersion}.yaml`), "canvas_history_metadata", promotedTargets, input.testHooks);
    await promoteIndexFile(input.home, metadataCandidate, paths.metadata_file, "metadata", promotedTargets, input.testHooks);
    await promoteIndexFile(input.home, requirementCandidate, requirementFile, "requirement", promotedTargets, input.testHooks);
    await writeYamlAtomic(join(stageDir, "index-journal.yaml"), {
      schema_version: 1,
      status: "committed",
      product_id: input.product_id,
      requirement_id: input.requirement_id
    });
    return {
      product_id: input.product_id,
      requirement_id: input.requirement_id,
      canvas_version: canvasVersion,
      canvas_revision: canvasRevision,
      pages,
      unmanaged_components: mapping.unmanaged_components,
      blocked_pages: blockedPages
    };
  } catch (error) {
    await restoreIndexPromotions(input.home, promotedTargets).catch(() => undefined);
    await writeYamlAtomic(join(stageDir, "index-journal.yaml"), {
      schema_version: 1,
      status: "failed",
      product_id: input.product_id,
      requirement_id: input.requirement_id,
      reason: errorMessage(error)
    }).catch(() => undefined);
    throw error;
  } finally {
    await rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function getRequirementDesignHistory(input: { home: string; product_id: string; requirement_id: string }): Promise<RequirementDesignMetadata["history"]> {
  const metadata = await readRequirementDesignMetadata(input.home, input.product_id, input.requirement_id);
  return metadata.history;
}

export async function rollbackRequirementDesign(input: {
  home: string;
  product_id: string;
  requirement_id: string;
  canvas_version: number;
}): Promise<{ operation: "rollback"; source_canvas_file: string; operations: Array<{ tool: "batch_design"; args: Record<string, unknown>; intent: "rollback" }> }> {
  const paths = requirementDesignPaths(input.home, input.product_id, input.requirement_id);
  const source = join(paths.canvas_history_dir, `canvas.c${input.canvas_version}.pen`);
  await assertRegularFileUnderRoot(paths.requirement_dir, source);
  return {
    operation: "rollback",
    source_canvas_file: relative(resolve(input.home), source),
    operations: [{ tool: "batch_design", args: { restore_canvas_version: input.canvas_version }, intent: "rollback" }]
  };
}

export async function diffRequirementDesignVersions(input: {
  home: string;
  product_id: string;
  requirement_id: string;
  from_canvas_version: number;
  to_canvas_version: number;
}): Promise<{ from_canvas_version: number; to_canvas_version: number; changed: boolean; from_hash: string; to_hash: string }> {
  const paths = requirementDesignPaths(input.home, input.product_id, input.requirement_id);
  const from = await readFile(join(paths.canvas_history_dir, `canvas.c${input.from_canvas_version}.pen`));
  const to = await readFile(join(paths.canvas_history_dir, `canvas.c${input.to_canvas_version}.pen`));
  const fromHash = sha256(from);
  const toHash = sha256(to);
  return {
    from_canvas_version: input.from_canvas_version,
    to_canvas_version: input.to_canvas_version,
    changed: fromHash !== toHash,
    from_hash: fromHash,
    to_hash: toHash
  };
}

export async function exportRequirementDesignAsset(input: {
  home: string;
  product_id: string;
  requirement_id: string;
  kind: "canvas" | "preview";
  page_id?: string;
}): Promise<{ path: string; revision: string }> {
  const paths = requirementDesignPaths(input.home, input.product_id, input.requirement_id);
  const metadata = await readRequirementDesignMetadata(input.home, input.product_id, input.requirement_id);
  const file = input.kind === "canvas"
    ? paths.canvas_file
    : join(paths.requirement_dir, metadata.pages.find((page) => page.page_id === input.page_id)?.preview_file ?? "");
  if (input.kind === "preview" && !input.page_id) {
    throw new FormaError("INVALID_INPUT", "page_id is required for preview export");
  }
  if (input.kind === "preview") {
    const page = metadata.pages.find((item) => item.page_id === input.page_id);
    if (!page?.preview_file) {
      throw new FormaError("PREVIEW_NOT_EXPORTED", "Preview was not exported", {
        page_id: input.page_id,
        preview_file: page?.preview_file,
        canvas_revision: metadata.canvas_revision
      });
    }
  }
  const validation = await validateRegularFileUnderRoot(paths.requirement_dir, file);
  if (input.kind === "preview" && validation.status !== "valid") {
    const page = metadata.pages.find((item) => item.page_id === input.page_id);
    throw new FormaError("PREVIEW_NOT_EXPORTED", "Preview was not exported", {
      page_id: input.page_id,
      preview_file: page?.preview_file,
      canvas_revision: metadata.canvas_revision
    });
  }
  await assertRegularFileUnderRoot(paths.requirement_dir, file);
  return { path: file, revision: sha256(await readFile(file)) };
}

export async function commitRequirementDesignSession(input: {
  home: string;
  session_id: string;
  page_id: string;
  frame_id: string;
  quality_report?: DesignQualityReport;
  previewExporter: (input: { frame_id: string; page_id: string; output_file: string }) => Promise<void>;
  commitSubstrate?: (input: { home: string; session_id: string; candidates: RequirementCommitCandidate[] }) => Promise<unknown>;
}): Promise<{ session_id: string; status: "committed"; candidates: RequirementCommitCandidate[] }> {
  if (!input.page_id || !input.frame_id) {
    throw new FormaError("INVALID_INPUT", "page_id and frame_id are required", { page_id: input.page_id, frame_id: input.frame_id });
  }
  if (!input.quality_report) {
    throw new FormaError("INVALID_INPUT", "Successful deterministic quality report is required", { session_id: input.session_id });
  }
  let qualityReport = input.quality_report;
  if (qualityReport.status === "blocked") {
    throw new FormaError("INVALID_INPUT", "Successful deterministic quality report is required", {
      session_id: input.session_id,
      blocked_codes: qualityReport.hard_checks.issues.map((issue) => issue.code)
    });
  }
  const home = resolve(input.home);
  const session = await findRequirementSessionLoose(home, input.session_id);
  await assertLiveStagingBeforeDefaultCommitCandidateBuild(home, session);
  const paths = requirementDesignPaths(home, session.product_id, session.requirement_id);
  const [stagingRaw, requirement] = await Promise.all([
    readFile(session.staging_path, "utf8"),
    readYamlAs(join(paths.requirement_dir, "requirement.yaml"), requirementSchema)
  ]);
  const stagingRevision = sha256(stagingRaw);
  if (stagingRevision !== session.last_controlled_revision) {
    throw new FormaError("INVALID_INPUT", "Staging revision does not match the controlled session revision", {
      session_id: session.session_id,
      expected_revision: session.last_controlled_revision,
      actual_revision: stagingRevision
    });
  }
  const noGuardRaw = stripSessionBindingGuardsFromRawStagingForMetadata(stagingRaw);
  const canvasRevision = sha256(noGuardRaw);
  const document = parsePenDocument(stagingRaw);
  const page = requirement.pages.find((item) => item.page_id === input.page_id);
  if (!page) {
    throw new FormaError("INVALID_INPUT", "Page is not part of requirement", { page_id: input.page_id });
  }
  const frame = walkPenNodes(document.children).find((node) => node.id === input.frame_id);
  if (!frame) {
    throw new FormaError("PAGE_FRAME_NOT_FOUND", "Target frame was not found", { frame_id: input.frame_id, page_id: input.page_id });
  }
  const semanticScope = await readSemanticScope(session.semantic_scope_file);
  const verifiedQualityReport = await runDesignQualityPipeline({
    document,
    semantic_scope: semanticScope
  });
  assertDesignQualityPassed(verifiedQualityReport);
  qualityReport = {
    ...verifiedQualityReport,
    warnings: [...verifiedQualityReport.warnings, ...qualityReport.warnings],
    ...(qualityReport.ai_visual_review ? { ai_visual_review: qualityReport.ai_visual_review } : {})
  };
  const previous = await getRequirementDesign(home, session.product_id, session.requirement_id);
  const previousMetadata = previous.status === "complete" ? await readRequirementDesignMetadata(home, session.product_id, session.requirement_id) : undefined;
  const canvasVersion = previous.status === "complete" ? previous.canvas_version + 1 : 1;
  const previousPage = previous.status === "complete" ? previous.pages.find((item) => item.page_id === input.page_id) : undefined;
  const pageVersion = (previousPage?.page_version ?? 0) + 1;
  const rels = requirementDesignRelativePaths(input.page_id, canvasVersion, pageVersion);
  const candidateDir = join(session.session_dir, "commit-candidates");
  await mkdir(candidateDir, { recursive: true });
  const previewCandidate = join(candidateDir, `${input.page_id}@2x.png`);
  try {
    await input.previewExporter({ frame_id: input.frame_id, page_id: input.page_id, output_file: previewCandidate });
  } catch (error) {
    throw new FormaError("PREVIEW_EXPORT_FAILED", "Preview candidate export failed", { page_id: input.page_id, reason: errorMessage(error) });
  }
  try {
    await assertRegularFileUnderRoot(session.session_dir, previewCandidate);
  } catch (error) {
    throw new FormaError("INVALID_INPUT", "Preview candidate is required before commit", {
      page_id: input.page_id,
      reason: errorMessage(error)
    });
  }

  const metadataCandidate = join(candidateDir, "design.yaml");
  const designCandidate = join(candidateDir, "design.pen");
  const requirementCandidate = join(candidateDir, "requirement.yaml");
  const historyPenCandidate = join(candidateDir, `canvas.c${canvasVersion}.pen`);
  const historyYamlCandidate = join(candidateDir, `canvas.c${canvasVersion}.yaml`);
  const pageFragmentCandidate = join(candidateDir, `${input.page_id}.p${pageVersion}.pen-fragment`);
  const historyPreviewCandidate = join(candidateDir, `${input.page_id}.p${pageVersion}@2x.png`);
  await writeFile(designCandidate, noGuardRaw, "utf8");
  await writeFile(historyPenCandidate, noGuardRaw, "utf8");
  await writeFile(pageFragmentCandidate, JSON.stringify(frame, null, 2), "utf8");
  await copyFile(previewCandidate, historyPreviewCandidate);
  const nextPages = requirement.pages.map((candidatePage) => {
    if (candidatePage.page_id !== input.page_id) {
      const existing = previousMetadata?.pages.find((item) => item.page_id === candidatePage.page_id);
      return existing ?? requirementDesignPageSchema.parse({ page_id: candidatePage.page_id, status: candidatePage.design_status });
    }
    return requirementDesignPageSchema.parse({
      page_id: input.page_id,
      status: "done",
      preview_file: rels.preview,
      page_version: pageVersion,
      frame_id: input.frame_id,
      frame_snapshot_file: rels.page_fragment,
      quality_report_file: `history/pages/${input.page_id}.p${pageVersion}.quality.yaml`,
      semantic_mode: frame.metadata?.type === "forma" ? "managed" : "unmanaged_import",
      warnings: qualityReport.warnings
    });
  });
  const metadata = requirementDesignMetadataSchema.parse({
    schema_version: 1,
    product_id: session.product_id,
    requirement_id: session.requirement_id,
    canvas_file: "design.pen",
    canvas_version: canvasVersion,
    canvas_revision: canvasRevision,
    pages: nextPages,
    unmanaged_components: previousMetadata?.unmanaged_components ?? [],
    history: [
      ...(previousMetadata?.history ?? []),
      { version: canvasVersion, file: rels.canvas_history_pen, session_id: session.session_id, created_at: new Date().toISOString() }
    ]
  });
  await writeYamlAtomic(metadataCandidate, metadata);
  await writeYamlAtomic(historyYamlCandidate, metadata);
  await writeYamlAtomic(requirementCandidate, requirementSchema.parse({
    ...requirement,
    status: requirement.pages.every((candidatePage) => candidatePage.page_id === input.page_id || candidatePage.design_status === "done") ? "active" : requirement.status,
    updated_at: new Date().toISOString(),
    pages: requirement.pages.map((candidatePage) => candidatePage.page_id === input.page_id ? { ...candidatePage, design_status: "done" } : candidatePage)
  }));
  const candidates = await buildCommitCandidates(home, [
    { target: join(paths.canvas_history_dir, `canvas.c${canvasVersion}.pen`), candidate: historyPenCandidate, kind: "canvas_history", order: 1 },
    { target: join(paths.canvas_history_dir, `canvas.c${canvasVersion}.yaml`), candidate: historyYamlCandidate, kind: "canvas_history_metadata", order: 2 },
    { target: join(paths.page_history_dir, `${input.page_id}.p${pageVersion}.pen-fragment`), candidate: pageFragmentCandidate, kind: "page_fragment", order: 3 },
    { target: join(paths.preview_history_dir, `${input.page_id}.p${pageVersion}@2x.png`), candidate: historyPreviewCandidate, kind: "history_preview", order: 4 },
    { target: join(paths.previews_dir, `${input.page_id}@2x.png`), candidate: previewCandidate, kind: "preview", order: 5 },
    { target: paths.canvas_file, candidate: designCandidate, kind: "design_canvas", order: 6 },
    { target: paths.metadata_file, candidate: metadataCandidate, kind: "design_metadata", order: 7 },
    { target: join(paths.requirement_dir, "requirement.yaml"), candidate: requirementCandidate, kind: "requirement_metadata", order: 8 }
  ], stagingRevision);
  const substrate = input.commitSubstrate ?? ((payload) => commitRequirementDesignSessionWithCandidates(payload));
  await substrate({ home, session_id: input.session_id, candidates });
  return { session_id: input.session_id, status: "committed", candidates };
}

export async function planImportMetadataNormalization(input: {
  home: string;
  session_id: string;
  frame_id: string;
}): Promise<
  | {
      status: "planned";
      staging_revision: string;
	      operations: Array<{ tool: "batch_design"; args: Record<string, unknown>; target_node_ids: string[]; intent: "import_metadata_normalization" }>;
    }
  | {
      status: "blocked";
      code: "UNMANAGED_METADATA_NORMALIZATION_REQUIRED";
      staging_revision: string;
      unresolved_nodes: string[];
    }
> {
  const session = await findRequirementSessionLoose(resolve(input.home), input.session_id);
  const [raw, scope] = await Promise.all([
    readFile(session.staging_path, "utf8"),
    readYaml<Record<string, unknown>>(session.semantic_scope_file)
  ]);
  const document = parsePenDocument(raw);
  const frame = walkPenNodes(document.children).find((node) => node.id === input.frame_id);
  if (!frame) {
    throw new FormaError("PAGE_FRAME_NOT_FOUND", "Target frame was not found", { frame_id: input.frame_id });
  }
  const revision = sha256(raw);
  if (typeof scope.staging_revision === "string" && scope.staging_revision !== revision) {
    return {
      status: "blocked",
      code: "UNMANAGED_METADATA_NORMALIZATION_REQUIRED",
      staging_revision: revision,
      unresolved_nodes: [input.frame_id]
    };
  }
  const allowedCopy = new Set(Array.isArray(scope.allowed_copy) ? scope.allowed_copy.filter((item): item is string => typeof item === "string") : []);
  const nodes = walkPenNodes(frame.children ?? []).filter((node) => node.metadata?.type !== "forma");
  const unresolved: string[] = [];
  const operations = [];
  for (const node of nodes) {
    const text = typeof node.text === "string" ? node.text : undefined;
    if (!text || !allowedCopy.has(text)) {
      unresolved.push(node.id);
      continue;
    }
    operations.push({
      tool: "batch_design" as const,
      args: {
        node_id: node.id,
        metadata: {
          type: "forma",
          kind: "text",
          copy: text
        }
      },
      target_node_ids: [node.id],
      intent: "import_metadata_normalization" as const
    });
  }
  if (unresolved.length > 0) {
    return { status: "blocked", code: "UNMANAGED_METADATA_NORMALIZATION_REQUIRED", staging_revision: revision, unresolved_nodes: unresolved };
  }
  return { status: "planned", staging_revision: revision, operations };
}

function candidateFrames(nodes: PenNode[], usedFrameIds: Set<string>): PenNode[] {
  return nodes.filter((node) => !usedFrameIds.has(node.id) && frameTypes.has((node.type ?? "frame").toLowerCase()) && !isTopLevelComponent(node));
}

function classifyUnmanagedTopLevelCandidates(nodes: PenNode[]): UnmanagedComponentCandidate[] {
  return nodes.flatMap((node) => {
    if (!isTopLevelComponent(node)) {
      return [];
    }
    const name = node.name;
    const reusable = node.metadata?.reusable === true || node.reusable === true;
    const normalizedName = normalizeDesignName(name ?? "");
    return [{
      node_id: node.id,
      ...(name ? { name } : {}),
      classification: reusable && unmanagedComponentNames.has(normalizedName)
        ? "unmanaged_component_candidate" as const
        : "top_level_non_page" as const
    }];
  });
}

function isTopLevelComponent(node: PenNode): boolean {
  const kind = nodeMetadataString(node, "kind");
  const type = (node.type ?? "").toLowerCase();
  return type === "component" || kind === "component" || kind === "component_instance";
}

function hasFormaMetadata(document: PenDocument, frameId: string): boolean {
  const frame = walkPenNodes(document.children).find((node) => node.id === frameId);
  return frame?.metadata?.type === "forma";
}

interface IndexPromotionSnapshot {
  target: string;
  backup?: string;
  existed: boolean;
}

async function promoteIndexFile(
  home: string,
  source: string,
  target: string,
  kind: string,
  promotedTargets: IndexPromotionSnapshot[],
  testHooks?: { afterPromote?: (entry: { kind: string; target_file: string }) => Promise<void> | void }
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const backup = join(dirname(source), `.backup-${randomBytes(6).toString("hex")}-${target.split("/").at(-1) ?? "file"}`);
  const existed = await pathExists(target);
  if (existed) {
    await copyFile(target, backup);
  }
  await copyFile(source, target);
  promotedTargets.push({ target, existed, ...(existed ? { backup } : {}) });
  await testHooks?.afterPromote?.({ kind, target_file: relative(resolve(home), target) });
}

async function restoreIndexPromotions(_home: string, promotedTargets: IndexPromotionSnapshot[]): Promise<void> {
  for (const snapshot of promotedTargets.reverse()) {
    if (!snapshot.existed) {
      await rm(snapshot.target, { force: true });
      continue;
    }
    if (snapshot.backup) {
      await copyFile(snapshot.backup, snapshot.target);
    }
  }
}

function stripSessionBindingGuardsFromRawStagingForMetadata(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new FormaError("PEN_FILE_INVALID", "Pencil document must be valid JSON", {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!isRecord(parsed)) {
    throw new FormaError("PEN_FILE_INVALID", "Pencil document must be an object", {
      cause: "document is not an object"
    });
  }
  const children = parsed.children;
  if (!Array.isArray(children)) {
    throw new FormaError("PEN_FILE_INVALID", "Pencil document must contain children[]", {
      cause: "children is missing or not an array"
    });
  }
  const document = {
    ...parsed,
    children: children.filter((node) => !isSessionBindingGuardMarker(node))
  };
  if (containsSessionBindingGuardMarker(document.children)) {
    throw new FormaError("PEN_FILE_INVALID", "Sanitized candidate still contains a session binding guard");
  }
  return `${JSON.stringify(document, null, 2)}\n`;
}

function containsSessionBindingGuardMarker(nodes: unknown[]): boolean {
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    if (isSessionBindingGuardMarker(node)) return true;
    if (Array.isArray(node.children) && containsSessionBindingGuardMarker(node.children)) return true;
  }
  return false;
}

function isSessionBindingGuardMarker(node: unknown): boolean {
  if (!isRecord(node)) return false;
  if (typeof node.id === "string" && node.id.startsWith("formaSessionBindingGuard")) return true;
  return isRecord(node.metadata) && node.metadata.kind === "session_binding_guard";
}

async function buildCommitCandidates(
  home: string,
  entries: Array<{ target: string; candidate: string; kind: string; order: number }>,
  sourceStagingRevision?: string
): Promise<RequirementCommitCandidate[]> {
  const candidates: RequirementCommitCandidate[] = [];
  for (const entry of entries.sort((left, right) => left.order - right.order)) {
    const targetExists = await pathExists(entry.target);
    candidates.push({
      target_file: relative(home, entry.target),
      candidate_file: relative(home, entry.candidate),
      replacement_kind: entry.kind,
      restore_order: entry.order,
      candidate_hash: sha256(await readFile(entry.candidate)),
      ...(sourceStagingRevision ? { source_staging_revision: sourceStagingRevision } : {}),
      ...(targetExists ? { old_hash: sha256(await readFile(entry.target)) } : { old_file_missing: true })
    });
  }
  return candidates;
}

async function findRequirementSessionLoose(home: string, sessionId: string): Promise<{
  session_id: string;
  product_id: string;
  requirement_id: string;
  session_file: string;
  session_dir: string;
  staging_path: string;
  last_controlled_revision: string;
  semantic_scope_file: string;
  pencil_binding_id: string;
  status: string;
}> {
  const parsedSessionId = parseSessionId(sessionId);
  const dataDir = join(home, "data");
  for (const productId of await safeReaddir(dataDir)) {
    const productDir = join(dataDir, productId);
    for (const requirementId of await safeReaddir(productDir)) {
      if (requirementId === "sessions" || requirementId.startsWith("D-")) continue;
      const file = join(productDir, requirementId, "sessions", parsedSessionId, "design_session.yaml");
      if (!await pathExists(file)) continue;
      const raw = await readYaml<Record<string, unknown>>(file);
      if (
        raw.session_id !== parsedSessionId
        || raw.product_id !== productId
        || raw.requirement_id !== requirementId
        || raw.scope !== "requirement_canvas"
      ) {
        throw new FormaError("INVALID_INPUT", "Requirement session metadata is invalid", { session_id: parsedSessionId });
      }
      const stagingFile = typeof raw.staging_file === "string" ? raw.staging_file : undefined;
      const semanticScopeFile = typeof raw.semantic_scope_file_relative === "string" ? raw.semantic_scope_file_relative : undefined;
      const lastControlledRevision = typeof raw.last_controlled_revision === "string" ? raw.last_controlled_revision : undefined;
      const pencilBindingId = typeof raw.pencil_binding_id === "string" ? raw.pencil_binding_id : undefined;
      const status = typeof raw.status === "string" ? raw.status : undefined;
      if (!stagingFile || !semanticScopeFile || !lastControlledRevision || !pencilBindingId || !status) {
        throw new FormaError("INVALID_INPUT", "Requirement session metadata is invalid", { session_id: parsedSessionId });
      }
      return {
        session_id: parsedSessionId,
        product_id: productId,
        requirement_id: requirementId,
        session_file: file,
        session_dir: dirname(file),
        staging_path: join(home, stagingFile),
        last_controlled_revision: lastControlledRevision,
        semantic_scope_file: join(home, semanticScopeFile),
        pencil_binding_id: pencilBindingId,
        status
      };
    }
  }
  throw new FormaError("INVALID_INPUT", "Design session not found", { session_id: sessionId });
}

async function assertLiveStagingBeforeDefaultCommitCandidateBuild(
  home: string,
  session: Awaited<ReturnType<typeof findRequirementSessionLoose>>
): Promise<void> {
  if (session.status !== "running") {
    throw new FormaError("INVALID_INPUT", "Session is not running", { status: session.status });
  }
  const adapter = new PencilAppSessionAdapter({ home, runner: defaultPencilRunner });
  try {
    await adapter.assertActiveStagingBinding({
      bindingId: session.pencil_binding_id,
      expectedStagingPath: session.staging_path
    });
  } catch (error) {
    if (error instanceof FormaError && error.code === "PENCIL_APP_REQUIRED") {
      await writeYamlAtomic(session.session_file, {
        ...(await readYaml<Record<string, unknown>>(session.session_file)),
        status: "recoverable",
        updated_at: new Date().toISOString()
      });
    }
    throw error;
  }
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await import("node:fs/promises").then((fs) => fs.readdir(path));
  } catch {
    return [];
  }
}

function sha256(bytes: Buffer | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function assertRegularFileUnderRoot(root: string, file: string): Promise<void> {
  const validation = await validateRegularFileUnderRoot(root, file);
  if (validation.status !== "valid") {
    throw new Error(validation.status === "missing" ? `file is missing: ${file}` : validation.error);
  }
}

async function validateRegularFileUnderRoot(
  root: string,
  file: string
): Promise<{ status: "valid" } | { status: "missing" } | { status: "invalid"; error: string }> {
  let fileInfo: Awaited<ReturnType<typeof lstat>>;
  try {
    fileInfo = await lstat(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { status: "missing" };
    }
    return { status: "invalid", error: errorMessage(error) };
  }
  try {
    const [rootReal, fileReal] = await Promise.all([realpath(root), realpath(file)]);
    if (fileReal !== rootReal && !fileReal.startsWith(`${rootReal}/`)) {
      return { status: "invalid", error: `file realpath escapes requirement dir: ${file}` };
    }
    const targetInfo = fileInfo.isSymbolicLink() ? await stat(fileReal) : fileInfo;
    if (!targetInfo.isFile()) {
      return { status: "invalid", error: `file is not a regular file: ${file}` };
    }
    return { status: "valid" };
  } catch (error) {
    return { status: "invalid", error: errorMessage(error) };
  }
}
