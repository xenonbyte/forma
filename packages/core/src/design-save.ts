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
import type { ArtifactStore } from "./artifact-store.js";
import type {
  ArtifactCraftCheck,
  ArtifactFormaExtension,
  ArtifactManifest,
  ArtifactProvenance,
} from "./artifact-manifest.js";
import { localizeArtifactAssets } from "./artifact-asset-pipeline.js";
import { validateStaticArtifact } from "./artifact-static-validation.js";
import { renderArtifactPreview } from "./preview-renderer.js";
import { lintCraft } from "./quality/craft-lint.js";
import type { ProductService } from "./product.js";
import { FormaError } from "./errors.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface SaveDesignInput {
  productId: string;
  kind: "design-page" | "component-library";
  html: string;
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
  };
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
    return buf.toString("utf8");
  } catch (err) {
    throw new FormaError("ARTIFACT_INVALID_INPUT", `Failed to decode ${path} as UTF-8`, { path, cause: String(err) });
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function saveDesignArtifact(deps: SaveDesignDeps, input: SaveDesignInput): Promise<SaveDesignResult> {
  const { artifacts, products } = deps;
  const { productId, kind, html, title, forma } = input;

  // ── Step 1: localizeArtifactAssets (pure, no lock) ───────────────────────────
  const { html: localizedHtml, files, assets } = await localizeArtifactAssets({ html });

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

  // ── Step 3: Render preview to a temp dir (no lock, browser render) ───────────
  const tempDir = join(tmpdir(), `forma-save-${randomBytes(8).toString("hex")}`);
  let previewStatus: "ready" | "failed" = "failed";
  let previewError: string | undefined;
  let preview1xBuf: Buffer | undefined;
  let preview2xBuf: Buffer | undefined;
  let craftChecks: ArtifactCraftCheck[] | undefined;

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, "index.html"), Buffer.from(localizedHtml, "utf8"));
    for (const [relativePath, buf] of files) {
      const destPath = join(tempDir, relativePath);
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, buf);
    }

    const previewOutDir = join(tempDir, "preview");
    try {
      const renderResult = await renderArtifactPreview({ bundleDir: tempDir, outDir: previewOutDir, extractDom: true });
      preview1xBuf = await readFile(join(previewOutDir, "1x.png"));
      preview2xBuf = await readFile(join(previewOutDir, "2x.png"));
      previewStatus = "ready";
      if (renderResult.snapshotError) {
        craftChecks = [
          { id: "craft-lint", passed: false, detail: `snapshot extraction failed: ${renderResult.snapshotError}` },
        ];
      } else if (renderResult.snapshot) {
        try {
          craftChecks = lintCraft(renderResult.snapshot);
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
  if (finalPreviewStatus === "ready" && finalPreview1x && finalPreview2x) {
    finalFiles.set("preview/1x.png", finalPreview1x);
    finalFiles.set("preview/2x.png", finalPreview2x);
  }

  // ── Step 6: Build ArtifactManifest ────────────────────────────────────────────
  const now = new Date().toISOString();
  const supportingFiles = Array.from(finalFiles.keys());

  const formaExtension: ArtifactFormaExtension = {
    ...forma,
    ...(kind === "design-page" ? { variant: forma.variant ?? "default" } : {}),
    assets,
    preview: {
      status: finalPreviewStatus,
      generatedAt: now,
      ...(finalPreviewError ? { error: finalPreviewError } : {}),
    },
    ...(finalCraftChecks ? { quality: { craftChecks: finalCraftChecks } } : {}),
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
      if (kind !== "design-page" || !forma.requirementId || !forma.pageId) {
        return;
      }
      const variant = forma.variant ?? "default";
      await products.setDesignPointerLocked(productId, {
        requirementId: forma.requirementId,
        pageId: forma.pageId,
        variant,
        artifactId,
        version: writtenVersion,
        designStatus: "active",
      });
      await input.commitHooks?.afterPointerLocked?.({
        artifactId,
        version: writtenVersion,
        requirementId: forma.requirementId,
        pageId: forma.pageId,
        variant,
      });
    },
  });

  return { artifactId, version, previewStatus: finalPreviewStatus };
}
