/**
 * requirement-icon-export.ts
 *
 * Exports page-level icons/ directories for every design pointer of a
 * requirement. Uses a temp-dir + atomic rename pattern so any prior
 * stale icons/ is fully replaced and a mid-flight failure leaves no
 * partial state.
 *
 * Narrow-deps pattern: callers (store, tests) inject real or fake
 * implementations via ExportRequirementIconsDeps.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { VIEWPORT_PRESETS } from "@vzi-core/parser";
import type { DesignPointer } from "./product.js";
import type { IconManifest } from "./artifact-icon-extraction.js";
import { extractIconAssets } from "./artifact-icon-extraction.js";
import { getArtifactIconsDir, getArtifactVersionDir } from "./artifact-paths.js";
import { FormaError } from "./errors.js";
import type { IconGeneratedFrom } from "./artifact-icon-extraction.js";
import type { Platform } from "./schemas.js";
import {
  listCurrentRequirementDesignPointers,
  type GetRequirementPageIds,
} from "./requirement-design-pointer-filter.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface ExportRequirementIconsDeps {
  /** Absolute path to the products root (contains <productId>/od-project/…). */
  productsRoot: string;
  /** Returns the platform for the given product when archive/VZI alignment is required. */
  getProductPlatform?: (productId: string) => Promise<Platform | undefined>;
  /** Returns all design pointers for the given product. */
  listDesignPointers: (productId: string) => Promise<DesignPointer[]>;
  /** Returns current page ids for the requirement, when stale removed-page pointers must be excluded. */
  getRequirementPageIds?: GetRequirementPageIds;
  /** Read a file from disk (override in tests for observability). */
  readFile: (path: string) => Promise<Buffer>;
  /** Write a file to disk, creating parent dirs as needed. */
  writeFile: (path: string, data: Buffer | Uint8Array | string) => Promise<void>;
  /** Remove a directory tree (force, ignore-missing). */
  rmDir: (path: string) => Promise<void>;
  /** Atomically rename src → dest (must be same filesystem). */
  rename: (src: string, dest: string) => Promise<void>;
  /** Make a directory (recursive). */
  mkdir: (path: string) => Promise<void>;
}

export interface ExportRequirementIconsInput {
  productId: string;
  requirementId: string;
  generatedFrom: IconGeneratedFrom;
}

export interface ExportedPageIcons {
  pageId: string;
  artifactId: string;
  version: number;
  /** Number of distinct icon entries extracted. */
  count: number;
  manifest: IconManifest;
}

export interface ExportRequirementIconsResult {
  pages: ExportedPageIcons[];
  totalIcons: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive a temp sibling path for atomic writes. */
function tmpSiblingDir(iconsDir: string): string {
  const suffix = randomBytes(4).toString("hex");
  return `${iconsDir}.tmp-${suffix}`;
}

function resolveIconExtractionViewport(platform: Platform | undefined): {
  viewportWidth: number;
  viewportHeight: number;
} {
  switch (platform) {
    case "mobile":
      return {
        viewportWidth: VIEWPORT_PRESETS.mobile.width,
        viewportHeight: VIEWPORT_PRESETS.mobile.height,
      };
    case "tablet":
      return {
        viewportWidth: VIEWPORT_PRESETS.tablet.width,
        viewportHeight: VIEWPORT_PRESETS.tablet.height,
      };
    case "desktop":
    case "web":
    default:
      return {
        viewportWidth: VIEWPORT_PRESETS.desktop.width,
        viewportHeight: VIEWPORT_PRESETS.desktop.height,
      };
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * For every active design pointer of `requirementId`, reads the final
 * version's index.html, runs extractIconAssets, writes all icon files +
 * icons.json to a temp dir, then atomically replaces any existing icons/
 * dir with the new one.
 *
 * A single-page failure throws immediately (no partial commit). Temp dirs
 * are cleaned up on both success and failure.
 */
export async function exportRequirementIcons(
  deps: ExportRequirementIconsDeps,
  input: ExportRequirementIconsInput,
): Promise<ExportRequirementIconsResult> {
  const { productsRoot, getProductPlatform } = deps;
  const { productId, requirementId, generatedFrom } = input;
  const platform = getProductPlatform ? await getProductPlatform(productId) : undefined;
  const viewport = getProductPlatform ? resolveIconExtractionViewport(platform) : undefined;

  const pointers = await listCurrentRequirementDesignPointers(deps, productId, requirementId);

  const pages: ExportedPageIcons[] = [];

  for (const pointer of pointers) {
    const { artifactId, version, pageId, variant } = pointer;

    // Resolve paths
    const versionDir = getArtifactVersionDir(productsRoot, productId, artifactId, version);
    const htmlPath = join(versionDir, "index.html");
    const iconsDir = getArtifactIconsDir(productsRoot, productId, artifactId);
    const tmpDir = tmpSiblingDir(iconsDir);

    try {
      // Read the final version HTML
      let htmlBuf: Buffer;
      try {
        htmlBuf = await deps.readFile(htmlPath);
      } catch (err) {
        throw new FormaError("ARTIFACT_NOT_FOUND", `Could not read index.html for artifact ${artifactId} v${version}`, {
          productId,
          artifactId,
          version,
          path: htmlPath,
          cause: String(err),
        });
      }

      const html = htmlBuf.toString("utf8");

      // Extract icons (no disk writes here — may throw FormaError)
      const { files, manifest } = await extractIconAssets(
        html,
        {
          artifactId,
          productId,
          requirementId,
          pageId,
          variant,
          version: `v${version}`,
          generatedFrom,
        },
        viewport
          ? {
              computedVisibility: {
                ...viewport,
                baseUrl: pathToFileURL(`${versionDir}/`).toString(),
              },
            }
          : undefined,
      );

      // Write files + icons.json to temp dir
      await deps.mkdir(tmpDir);

      for (const [relativePath, buf] of files) {
        // relativePath starts with "icons/…", we strip that prefix since
        // we're writing directly into tmpDir (which will become icons/).
        const strippedPath = relativePath.startsWith("icons/") ? relativePath.slice("icons/".length) : relativePath;
        const destPath = join(tmpDir, strippedPath);
        const destDir = dirname(destPath);
        if (destDir !== tmpDir) {
          await deps.mkdir(destDir);
        }
        await deps.writeFile(destPath, buf);
      }

      // Write icons.json
      const manifestJson = JSON.stringify(manifest, null, 2);
      await deps.writeFile(join(tmpDir, "icons.json"), manifestJson);

      // Remove stale icons/ (if any), then atomic rename
      await deps.rmDir(iconsDir);
      await deps.rename(tmpDir, iconsDir);

      pages.push({
        pageId,
        artifactId,
        version,
        count: manifest.icons.length,
        manifest,
      });
    } catch (err) {
      // Ensure temp dir is cleaned up before propagating
      await deps.rmDir(tmpDir).catch(() => undefined);
      // Re-wrap non-FormaError as FormaError
      if (err instanceof FormaError) throw err;
      throw new FormaError(
        "ARTIFACT_WRITE_FAIL",
        `Icon export failed for artifact ${artifactId}: ${err instanceof Error ? err.message : String(err)}`,
        { productId, artifactId, pageId, cause: String(err) },
      );
    }
  }

  const totalIcons = pages.reduce((sum, p) => sum + p.count, 0);
  return { pages, totalIcons };
}

// ─── Real deps factory ────────────────────────────────────────────────────────

/**
 * Build production-ready deps from a ProductService and productsRoot.
 * Tests can inject fakes instead.
 */
export function makeExportRequirementIconsDeps(
  productsRoot: string,
  listDesignPointersFn: (productId: string) => Promise<DesignPointer[]>,
  getProductPlatformFn?: (productId: string) => Promise<Platform | undefined>,
  getRequirementPageIdsFn?: GetRequirementPageIds,
): ExportRequirementIconsDeps {
  return {
    productsRoot,
    getProductPlatform: getProductPlatformFn,
    listDesignPointers: listDesignPointersFn,
    getRequirementPageIds: getRequirementPageIdsFn,
    readFile: (path) => readFile(path),
    writeFile: async (path, data) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    rmDir: (path) => rm(path, { recursive: true, force: true }),
    rename: (src, dest) => rename(src, dest),
    mkdir: async (path) => {
      await mkdir(path, { recursive: true });
    },
  };
}
