/**
 * design-save.ts — P4.3: save pipeline
 *
 * Orchestrates:
 *   1. localizeArtifactAssets   (P4.1)
 *   2. validateStaticArtifact   (P4.2)
 *   3. renderArtifactPreview    (P3) — browser render outside any lock
 *   4. artifacts.writeArtifactVersion — has its own internal lock
 *   5. products.setDesignPointerLocked — inside the artifact write lock (design-page only)
 *
 * Does NOT import from store.ts to avoid circular dependencies.
 * store.ts satisfies the narrow SaveDesignDeps interface declared here.
 *
 * NOTE ON LOCKING:
 *   writeArtifactVersion acquires the product mutation lock internally. Design
 *   page pointer updates and store-level commit hooks run inside that lock.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TextDecoder } from "node:util";
import { VIEWPORT_PRESETS } from "@vzi-core/parser";
import type { ArtifactStore } from "./artifact-store.js";
import type {
  ArtifactAssetEntry,
  ArtifactCraftCheck,
  ArtifactFormaExtension,
  ArtifactManifest,
  ArtifactProductIcon,
  ArtifactProvenance,
} from "./artifact-manifest.js";
import { validateSupportingPath } from "./artifact-manifest.js";
import { localizeArtifactAssets } from "./artifact-asset-pipeline.js";
import { validateStaticArtifact } from "./artifact-static-validation.js";
import { renderArtifactPreview } from "./preview-renderer.js";
import { lintCraft } from "./quality/craft-lint.js";
import type { ProductService } from "./product.js";
import { FormaError } from "./errors.js";

// ─── Public types ──────────────────────────────────────────────────────────────

/** A supporting file submitted by the caller (e.g. product icon SVG assets). */
export interface SupportingFileInput {
  /** Bundle-relative path — must pass validateSupportingPath (no absolute, no traversal). */
  path: string;
  /** MIME type — only "image/svg+xml" accepted for icon assets. */
  contentType: string;
  /** Base64-encoded file content. */
  contentBase64: string;
}

/** Max per-file size for caller-supplied supporting files (256 KB). */
const MAX_SUPPORTING_FILE_BYTES = 256 * 1024;
const RESERVED_SUPPORTING_FILE_PATHS = new Set(["index.html", "manifest.json"]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export interface ComponentUnitInput {
  id: string;
  title: string;
  role: "foundations" | "icon" | "component";
  /** Pure markup fragment (no <html>/<head>); styled only via shared tokens.css classes. */
  bodyHtml: string;
  width?: number;
  height?: number;
}

export interface SaveDesignInput {
  productId: string;
  kind: "design-page" | "component-library";
  /** Single-document HTML (design-page, and legacy single-doc libraries). */
  html?: string;
  title: string;
  forma: {
    requirementId?: string;
    pageId?: string;
    variant?: string;
    brandStyle?: string;
    systemStyle?: string;
    platform?: string;
    language?: string;
    provenance?: ArtifactProvenance;
    /** Product icon metadata — when present, primary/monochrome must be in supportingFiles (SPEC-DATA-001). */
    productIcon?: ArtifactProductIcon;
  };
  /** Component-library decomposition: shared CSS written to tokens.css. */
  tokensCss?: string;
  /** Component-library decomposition: ordered units → per-unit HTML + forma.units. */
  units?: ComponentUnitInput[];
  /**
   * Caller-supplied supporting files (e.g. product icon SVGs).
   * Each file is validated and written into the artifact bundle verbatim.
   * Only "image/svg+xml" content_type is accepted; files must not exceed 256 KB.
   */
  supportingFiles?: SupportingFileInput[];
  /** Pass to add a new version to an existing artifact; omit to create a new artifact (v1). */
  artifactId?: string;
  commitHooks?: {
    beforeWriteLocked?(): Promise<void> | void;
    afterPointerLocked?(input: {
      artifactId: string;
      version: number;
      requirementId: string;
      pageId: string;
      variant: string;
    }): Promise<void> | void;
  };
}

export interface SaveDesignResult {
  artifactId: string;
  version: number;
  previewStatus: "ready" | "failed";
}

export interface SaveDesignDeps {
  artifacts: ArtifactStore;
  products: ProductService;
  productsRoot: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a 16-char alphanumeric artifact ID matching /^[a-zA-Z0-9]{16}$/ */
function generateArtifactId(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  return Array.from(randomBytes(16), (byte) => alphabet[byte % alphabet.length]).join("");
}

/** Safely decode a Buffer as UTF-8; throw a clear error if invalid. */
function decodeUtf8(buf: Buffer, path: string): string {
  try {
    return UTF8_DECODER.decode(buf);
  } catch (err) {
    throw new FormaError("ARTIFACT_INVALID_INPUT", `Failed to decode ${path} as UTF-8`, { path, cause: String(err) });
  }
}

function isSvgBundlePath(path: string): boolean {
  return path.toLowerCase().endsWith(".svg");
}

function assertSvgBundlePath(path: string, label: string): void {
  if (!isSvgBundlePath(path)) {
    throw new FormaError("INVALID_INPUT", `${label} must end with .svg: ${path}`, { path });
  }
}

function stripSvgProlog(svgText: string): string | null {
  let remaining = svgText.replace(/^\uFEFF/, "").trimStart();

  for (;;) {
    if (remaining.startsWith("<?xml")) {
      const end = remaining.indexOf("?>");
      if (end === -1) return null;
      remaining = remaining.slice(end + 2).trimStart();
      continue;
    }
    if (remaining.startsWith("<!--")) {
      const end = remaining.indexOf("-->");
      if (end === -1) return null;
      remaining = remaining.slice(end + 3).trimStart();
      continue;
    }
    if (/^<!doctype\s+svg\b/i.test(remaining)) {
      const end = remaining.indexOf(">");
      if (end === -1) return null;
      remaining = remaining.slice(end + 1).trimStart();
      continue;
    }
    return remaining;
  }
}

function assertSvgContent(path: string, buf: Buffer): void {
  let svgText: string;
  try {
    svgText = decodeUtf8(buf, path);
  } catch (err) {
    throw new FormaError("INVALID_INPUT", `supportingFiles SVG content must be valid UTF-8: ${path}`, {
      path,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  const body = stripSvgProlog(svgText);
  if (body === null || !/^<svg(?:[\s>/]|$)/i.test(body)) {
    throw new FormaError("INVALID_INPUT", `supportingFiles SVG content must have an <svg> root: ${path}`, { path });
  }
}

function normalizeBundlePath(path: string, label: string): string {
  if (validateSupportingPath(path) === null) {
    throw new FormaError("INVALID_INPUT", `${label} invalid: ${path}`, { path });
  }
  const normalizedPath = path.replace(/\\/g, "/");
  const segments = normalizedPath.split("/");
  if (segments.some((segment) => segment === "" || segment === ".")) {
    throw new FormaError("INVALID_INPUT", `${label} invalid: ${path}`, { path });
  }
  return segments.join("/");
}

const UNIT_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function composeUnitDocument(tokensHref: string, bodyHtml: string, title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="${tokensHref}"></head><body>${bodyHtml}</body></html>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Validate and decode caller-supplied supporting files (SPEC-DATA-001).
 * Returns a Map<path, Buffer> ready to be merged into finalFiles.
 * Throws FormaError("INVALID_INPUT") on any violation.
 */
function validateAndDecodeSupportingFiles(
  supportingFiles: SupportingFileInput[] | undefined,
): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  if (!supportingFiles || supportingFiles.length === 0) return result;

  for (const sf of supportingFiles) {
    const normalizedPath = normalizeBundlePath(sf.path, "supportingFiles path");
    if (
      RESERVED_SUPPORTING_FILE_PATHS.has(normalizedPath) ||
      normalizedPath === "preview" ||
      normalizedPath.startsWith("preview/")
    ) {
      throw new FormaError("INVALID_INPUT", `supportingFiles path is reserved: ${sf.path}`, { path: sf.path });
    }
    if (result.has(normalizedPath)) {
      throw new FormaError("INVALID_INPUT", `supportingFiles path is duplicated: ${sf.path}`, { path: sf.path });
    }
    // Only SVG content type accepted for icon assets
    if (sf.contentType !== "image/svg+xml") {
      throw new FormaError(
        "INVALID_INPUT",
        `supportingFiles content_type must be image/svg+xml, got: ${sf.contentType}`,
        { path: sf.path, contentType: sf.contentType },
      );
    }
    assertSvgBundlePath(normalizedPath, "supportingFiles path");
    // Decode base64. Buffer.from never throws — it silently drops invalid chars —
    // so reject input that decodes to nothing rather than persisting an empty asset.
    const buf = Buffer.from(sf.contentBase64, "base64");
    if (buf.byteLength === 0) {
      throw new FormaError("INVALID_INPUT", `supportingFiles content_base64 is empty or not valid base64: ${sf.path}`, {
        path: sf.path,
      });
    }
    // Size cap
    if (buf.byteLength > MAX_SUPPORTING_FILE_BYTES) {
      throw new FormaError(
        "INVALID_INPUT",
        `supportingFiles file exceeds max size (${MAX_SUPPORTING_FILE_BYTES} bytes): ${sf.path}`,
        { path: sf.path, size: buf.byteLength },
      );
    }
    assertSvgContent(normalizedPath, buf);
    result.set(normalizedPath, buf);
  }
  return result;
}

function assertNoSupportingFileCollision(callerFiles: Map<string, Buffer>, generatedFiles: Map<string, Buffer>): void {
  for (const path of callerFiles.keys()) {
    if (generatedFiles.has(path)) {
      throw new FormaError("INVALID_INPUT", `supportingFiles path conflicts with generated artifact file: ${path}`, {
        path,
      });
    }
  }
}

async function writeBundleFiles(rootDir: string, files: Map<string, Buffer>): Promise<void> {
  for (const [relativePath, buf] of files) {
    const destPath = join(rootDir, relativePath);
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, buf);
  }
}

export async function saveDesignArtifact(deps: SaveDesignDeps, input: SaveDesignInput): Promise<SaveDesignResult> {
  const { artifacts, products } = deps;
  const { productId, kind, title, forma } = input;

  // ── Step 0a: Normalize units input → composed index.html + per-unit docs ─────
  type ComposedUnit = {
    id: string;
    title: string;
    role: ComponentUnitInput["role"];
    entry: string;
    width?: number;
    height?: number;
    doc: string;
  };
  let composedUnits: ComposedUnit[] = [];
  let tokensFile: Buffer | undefined;
  let html: string;
  if (input.units && input.units.length > 0) {
    if (kind !== "component-library") {
      throw new FormaError("INVALID_INPUT", "units is only valid for component-library", {});
    }
    if (input.tokensCss === undefined) {
      throw new FormaError("INVALID_INPUT", "units requires tokensCss", {});
    }
    const seen = new Set<string>();
    for (const u of input.units) {
      if (!UNIT_ID_REGEX.test(u.id)) throw new FormaError("INVALID_INPUT", `unit id invalid: ${u.id}`, { id: u.id });
      if (seen.has(u.id)) throw new FormaError("INVALID_INPUT", `unit id duplicated: ${u.id}`, { id: u.id });
      seen.add(u.id);
    }
    tokensFile = Buffer.from(input.tokensCss, "utf8");
    composedUnits = input.units.map((u) => ({
      id: u.id,
      title: u.title,
      role: u.role,
      entry: `unit-${u.id}.html`,
      ...(u.width !== undefined ? { width: u.width } : {}),
      ...(u.height !== undefined ? { height: u.height } : {}),
      doc: composeUnitDocument("tokens.css", u.bodyHtml, u.title),
    }));
    const combinedBody = input.units.map((u) => u.bodyHtml).join("\n");
    html = composeUnitDocument("tokens.css", combinedBody, title);
  } else if (input.html !== undefined) {
    html = input.html;
  } else {
    throw new FormaError("INVALID_INPUT", "either html or units must be provided", {});
  }

  // ── Step 0b: Validate and decode caller-supplied supporting files (SPEC-DATA-001) ──
  const callerFiles = validateAndDecodeSupportingFiles(input.supportingFiles);
  const productIcon =
    forma.productIcon === undefined
      ? undefined
      : {
          ...forma.productIcon,
          primary: normalizeBundlePath(forma.productIcon.primary, "forma.productIcon.primary"),
          monochrome: normalizeBundlePath(forma.productIcon.monochrome, "forma.productIcon.monochrome"),
        };

  // Validate productIcon: primary/monochrome must be in callerFiles (⊆ supportingFiles)
  if (productIcon !== undefined) {
    const { primary, monochrome } = productIcon;
    assertSvgBundlePath(primary, "forma.productIcon.primary");
    assertSvgBundlePath(monochrome, "forma.productIcon.monochrome");
    if (!callerFiles.has(primary)) {
      throw new FormaError(
        "INVALID_INPUT",
        `forma.productIcon.primary "${primary}" is not present in supportingFiles`,
        { path: primary },
      );
    }
    if (!callerFiles.has(monochrome)) {
      throw new FormaError(
        "INVALID_INPUT",
        `forma.productIcon.monochrome "${monochrome}" is not present in supportingFiles`,
        { path: monochrome },
      );
    }
  }

  // ── Step 1: localizeArtifactAssets (pure, no lock) ───────────────────────────
  const { html: localizedHtml, files, assets } = await localizeArtifactAssets({ html });
  assertNoSupportingFileCollision(callerFiles, files);

  // Localize each composed unit document and collect their assets into the shared file map
  const localizedUnitDocs = new Map<string, string>();
  for (const u of composedUnits) {
    const unitLocalized = await localizeArtifactAssets({ html: u.doc });
    // Merge localized unit assets into the shared files map
    for (const [path, buf] of unitLocalized.files) {
      files.set(path, buf);
    }
    localizedUnitDocs.set(u.entry, unitLocalized.html);
  }

  // ── Step 2: validateStaticArtifact (pure, no lock) ───────────────────────────
  const svgFiles = new Map<string, string>();
  const cssFiles = new Map<string, string>();
  for (const [path, buf] of files) {
    if (path.endsWith(".svg")) {
      svgFiles.set(path, decodeUtf8(buf, path));
    } else if (path.endsWith(".css")) {
      cssFiles.set(path, decodeUtf8(buf, path));
    }
  }
  for (const [path, buf] of callerFiles) {
    svgFiles.set(path, decodeUtf8(buf, path));
  }
  // Add tokens.css to cssFiles so unsafe CSS refs are caught before writing
  if (tokensFile !== undefined) {
    cssFiles.set("tokens.css", decodeUtf8(tokensFile, "tokens.css"));
  }

  const validationResult = validateStaticArtifact({
    html: localizedHtml,
    svgFiles,
    cssFiles,
  });
  if (!validationResult.ok) {
    throw new FormaError("ARTIFACT_NOT_STATIC", "Artifact is not pure-static", {
      violations: validationResult.violations,
    });
  }

  // Validate each localized unit document against the same static boundary
  for (const u of composedUnits) {
    const localizedDoc = localizedUnitDocs.get(u.entry);
    if (localizedDoc === undefined) {
      // Invariant: every composed unit was localized above. Fail loud rather than
      // silently skipping a unit's static-safety validation.
      throw new FormaError("ARTIFACT_WRITE_FAIL", `missing localized unit document: ${u.entry}`, { entry: u.entry });
    }
    const unitValidation = validateStaticArtifact({ html: localizedDoc, svgFiles, cssFiles });
    if (!unitValidation.ok) {
      throw new FormaError("ARTIFACT_NOT_STATIC", `Unit "${u.id}" is not pure-static`, {
        violations: unitValidation.violations,
      });
    }
  }

  // ── Step 3: Render preview to a temp dir (no lock, browser render) ───────────
  // Resolve platform: explicit input wins, else fall back to product config.
  let platform = forma.platform;
  if (platform === undefined) {
    try {
      platform = (await products.getProduct(productId)).platform;
    } catch {
      // Resolution failure is treated as "unconfigured" and must not change save
      // semantics; observable via the screen-edge-radius detail (platform=undefined).
      platform = undefined;
    }
  }
  // Mobile renders at VIEWPORT_PRESETS.mobile (390×884) — the *render* viewport.
  // Deliberately distinct from the 390×844 web canvas tile (mapArtifacts.ts).
  const viewport = platform === "mobile" ? VIEWPORT_PRESETS.mobile : undefined;

  const tempDir = join(tmpdir(), `forma-save-${randomBytes(8).toString("hex")}`);
  let previewStatus: "ready" | "failed" = "failed";
  let previewError: string | undefined;
  let preview1xBuf: Buffer | undefined;
  let preview2xBuf: Buffer | undefined;
  let craftChecks: ArtifactCraftCheck[] | undefined;

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, "index.html"), Buffer.from(localizedHtml, "utf8"));
    await writeBundleFiles(tempDir, files);
    await writeBundleFiles(tempDir, callerFiles);
    if (tokensFile !== undefined) {
      await writeFile(join(tempDir, "tokens.css"), tokensFile);
    }

    const previewOutDir = join(tempDir, "preview");
    try {
      const renderResult = await renderArtifactPreview({
        bundleDir: tempDir,
        outDir: previewOutDir,
        extractDom: true,
        ...(viewport ? { viewport } : {}),
      });
      preview1xBuf = await readFile(join(previewOutDir, "1x.png"));
      preview2xBuf = await readFile(join(previewOutDir, "2x.png"));
      previewStatus = "ready";
      if (renderResult.snapshotError) {
        craftChecks = [
          { id: "craft-lint", passed: false, detail: `snapshot extraction failed: ${renderResult.snapshotError}` },
        ];
      } else if (renderResult.snapshot) {
        try {
          craftChecks = lintCraft(renderResult.snapshot, { platform });
        } catch (err) {
          // Lint is observable but non-blocking: record a single failed check.
          craftChecks = [
            {
              id: "craft-lint",
              passed: false,
              detail: `lint failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ];
        }
      }
    } catch (err) {
      previewError = err instanceof FormaError ? err.message : String(err);
      previewStatus = "failed";
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }

  // Capture preview results before any lock acquisition
  const finalPreviewStatus = previewStatus;
  const finalPreviewError = previewError;
  const finalPreview1x = preview1xBuf;
  const finalPreview2x = preview2xBuf;
  const finalCraftChecks = craftChecks;

  // ── Step 4: Determine artifact id (version is allocated atomically by the store)
  // An existing artifactId appends a new version; otherwise this is a fresh v1.
  const artifactId = input.artifactId ?? generateArtifactId();

  // ── Step 5: Build final file set ──────────────────────────────────────────────
  const finalFiles = new Map<string, Buffer>();
  finalFiles.set("index.html", Buffer.from(localizedHtml, "utf8"));
  for (const [path, buf] of files) {
    finalFiles.set(path, buf);
  }
  assertNoSupportingFileCollision(callerFiles, finalFiles);
  // Merge caller-supplied supporting files (e.g. product icon SVGs) — SPEC-DATA-001
  for (const [path, buf] of callerFiles) {
    finalFiles.set(path, buf);
  }
  // Write tokens.css and localized unit docs (units decomposition)
  if (tokensFile !== undefined) {
    finalFiles.set("tokens.css", tokensFile);
    for (const u of composedUnits) {
      const localizedDoc = localizedUnitDocs.get(u.entry);
      if (localizedDoc === undefined) {
        throw new FormaError("ARTIFACT_WRITE_FAIL", `missing localized unit document: ${u.entry}`, { entry: u.entry });
      }
      finalFiles.set(u.entry, Buffer.from(localizedDoc, "utf8"));
    }
  }
  if (finalPreviewStatus === "ready" && finalPreview1x && finalPreview2x) {
    finalFiles.set("preview/1x.png", finalPreview1x);
    finalFiles.set("preview/2x.png", finalPreview2x);
  }

  // ── Step 6: Build ArtifactManifest ────────────────────────────────────────────
  const now = new Date().toISOString();
  const supportingFiles = Array.from(finalFiles.keys());

  // Build icon assets from productIcon SVG paths (role: "icon") — SPEC-DATA-001
  const iconAssets: ArtifactAssetEntry[] = [];
  if (productIcon !== undefined) {
    const { primary, monochrome } = productIcon;
    iconAssets.push({ path: primary, density: [1], role: "icon" });
    if (monochrome !== primary) {
      iconAssets.push({ path: monochrome, density: [1], role: "icon" });
    }
  }

  const formaExtension: ArtifactFormaExtension = {
    ...forma,
    ...(productIcon !== undefined ? { productIcon } : {}),
    ...(platform !== undefined ? { platform } : {}),
    ...(kind === "design-page" ? { variant: forma.variant ?? "default" } : {}),
    assets: [...assets, ...iconAssets],
    preview: {
      status: finalPreviewStatus,
      generatedAt: now,
      ...(finalPreviewError ? { error: finalPreviewError } : {}),
    },
    ...(finalCraftChecks ? { quality: { craftChecks: finalCraftChecks } } : {}),
    ...(composedUnits.length > 0
      ? {
          units: composedUnits.map(({ id, title: unitTitle, role, entry, width, height }) => ({
            id,
            title: unitTitle,
            role,
            entry,
            ...(width !== undefined ? { width } : {}),
            ...(height !== undefined ? { height } : {}),
          })),
        }
      : {}),
  };

  const manifest: ArtifactManifest = {
    version: 1,
    id: artifactId,
    kind,
    renderer: "html",
    title,
    entry: "index.html",
    status: "complete",
    exports: ["index.html"],
    supportingFiles,
    createdAt: now,
    updatedAt: now,
    forma: formaExtension,
  };

  // ── Step 7: writeArtifactVersion (has its own internal lock; allocates version)
  const { version } = await artifacts.writeArtifactVersion({
    productId,
    artifactId,
    manifest,
    files: finalFiles,
    ...(input.commitHooks?.beforeWriteLocked ? { beforeWriteLocked: input.commitHooks.beforeWriteLocked } : {}),
    afterWriteLocked: async ({ version: writtenVersion }) => {
      if (kind === "component-library") {
        // Single source of truth for "current component library" is the product
        // pointer. First create writes it; append re-asserts the same artifactId
        // (idempotent). The pointer write runs INSIDE the artifact write lock, so a
        // failure here rolls back the just-written version (artifact-store cleanup)
        // — never leaving an orphan library nor exposing a failed version as max.
        await products.setDesignSystemArtifactPointerLocked(productId, artifactId);
        // Observable pointer-activation log (matches existing [forma] console.warn usage).
        console.warn(
          `[forma] component-library pointer activated: product=${productId} artifact=${artifactId} version=${writtenVersion}`,
        );
        return;
      }
      if (kind !== "design-page" || !forma.requirementId || !forma.pageId) {
        return;
      }
      const variant = forma.variant ?? "default";
      const previousPointer = await products.getDesignPointer(productId, forma.requirementId, forma.pageId, variant);
      await products.setDesignPointerLocked(productId, {
        requirementId: forma.requirementId,
        pageId: forma.pageId,
        variant,
        artifactId,
        version: writtenVersion,
        designStatus: "active",
      });
      try {
        await input.commitHooks?.afterPointerLocked?.({
          artifactId,
          version: writtenVersion,
          requirementId: forma.requirementId,
          pageId: forma.pageId,
          variant,
        });
      } catch (error) {
        if (previousPointer) {
          await products.setDesignPointerLocked(productId, previousPointer);
        } else {
          await products.removeDesignPointerLocked(productId, forma.requirementId, forma.pageId, variant);
        }
        throw error;
      }
    },
  });

  return { artifactId, version, previewStatus: finalPreviewStatus };
}
