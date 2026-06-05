/**
 * requirement-handoff-pages.ts
 *
 * Shared resolution of archived design-handoff pages for a requirement.
 * One record per requirement-archive icons/VZI bundle (manifest-driven).
 * Used by both the MCP handoff tools and the HTTP annotation route, so the
 * `generatedFrom='requirement-archive'` selection logic lives in exactly one place.
 *
 * Pure core: no network, no renderer/canvaskit imports (respects the
 * vzi-renderer import boundary).
 */

import { constants as fsConstants } from "node:fs";
import type { Dirent } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { FormaError } from "./errors.js";
import {
  getArtifactsDir,
  getArtifactIconsManifestPath,
  getArtifactVziPath,
  getArtifactVersionDir,
} from "./artifact-paths.js";

export interface HandoffPagePointer {
  pageId: string;
  variant: string;
  artifactId: string;
  version: number;
  vziPath: string;
  indexHtmlPath: string;
  iconCount: number;
}

export interface HandoffIconManifestInfo {
  iconCount: number;
  requirementId?: string;
  pageId?: string;
  variant?: string;
  version?: number;
  generatedFrom?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseManifestVersion(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const match = value.match(/^v?([1-9]\d*)$/);
  if (!match) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export async function assertReadableHandoffFile(
  path: string,
  artifactId: string,
  handoffType: "icons" | "vzi",
): Promise<void> {
  try {
    await access(path, fsConstants.R_OK);
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new FormaError("ARTIFACT_NOT_FOUND", `Generated ${handoffType} handoff file not found`, {
        artifactId,
        handoffType,
        path,
      });
    }
    throw new FormaError("ARTIFACT_WRITE_FAIL", `Generated ${handoffType} handoff file is unreadable`, {
      artifactId,
      handoffType,
      path,
      cause: err.message,
    });
  }
}

function parseHandoffIconManifest(raw: string, artifactId: string): HandoffIconManifestInfo {
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch {
    throw new FormaError("ARTIFACT_INVALID_INPUT", "Corrupt icons manifest", { artifactId });
  }
  if (!isRecord(manifest) || !Array.isArray(manifest.icons)) {
    throw new FormaError("ARTIFACT_INVALID_INPUT", "Corrupt icons manifest", { artifactId });
  }
  return {
    iconCount: manifest.icons.length,
    requirementId: typeof manifest.requirementId === "string" ? manifest.requirementId : undefined,
    pageId: typeof manifest.pageId === "string" ? manifest.pageId : undefined,
    variant: typeof manifest.variant === "string" ? manifest.variant : undefined,
    version: parseManifestVersion(manifest.sourceVersion ?? manifest.version),
    generatedFrom: typeof manifest.generatedFrom === "string" ? manifest.generatedFrom : undefined,
  };
}

export async function readHandoffIconManifest(
  iconsManifestPath: string,
  artifactId: string,
): Promise<HandoffIconManifestInfo> {
  let raw: string;
  try {
    raw = await readFile(iconsManifestPath, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new FormaError("ARTIFACT_NOT_FOUND", "Generated icons manifest not found", {
        artifactId,
        handoffType: "icons",
        path: iconsManifestPath,
      });
    }
    throw new FormaError("ARTIFACT_WRITE_FAIL", "Generated icons manifest is unreadable", {
      artifactId,
      handoffType: "icons",
      path: iconsManifestPath,
      cause: err.message,
    });
  }
  return parseHandoffIconManifest(raw, artifactId);
}

/**
 * Resolve archived requirement-archive handoff bundles for a requirement.
 * Returns one record per matching icons/VZI bundle, sorted deterministically.
 *
 * Manifest-driven: a missing page.vzi does NOT fail the list — the VZI binary
 * read is deferred to the individual page-read call so one missing file does
 * not fail the whole route.
 */
export async function listArchivedHandoffPages(
  productsRoot: string,
  productId: string,
  requirementId: string,
  currentPageIds?: ReadonlySet<string>,
): Promise<HandoffPagePointer[]> {
  const artifactsDir = getArtifactsDir(productsRoot, productId);
  let entries: Dirent[];
  try {
    entries = await readdir(artifactsDir, { withFileTypes: true });
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw new FormaError("ARTIFACT_WRITE_FAIL", "Failed to read artifact directory for archived handoff", {
      productId,
      path: artifactsDir,
      cause: err.message,
    });
  }

  const pages: HandoffPagePointer[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const artifactId = entry.name;
    if (artifactId.startsWith(".tmp-")) continue;

    let iconsManifestPath: string;
    try {
      iconsManifestPath = getArtifactIconsManifestPath(productsRoot, productId, artifactId);
    } catch (cause) {
      if (cause instanceof FormaError && cause.code === "ARTIFACT_INVALID_INPUT") continue;
      throw cause;
    }

    let manifest: HandoffIconManifestInfo;
    try {
      manifest = await readHandoffIconManifest(iconsManifestPath, artifactId);
    } catch (cause) {
      if (cause instanceof FormaError && cause.code === "ARTIFACT_NOT_FOUND") continue;
      throw cause;
    }

    if (manifest.requirementId !== requirementId || manifest.generatedFrom !== "requirement-archive") {
      continue;
    }
    if (!manifest.pageId || manifest.version === undefined) {
      throw new FormaError("ARTIFACT_INVALID_INPUT", "Corrupt icons manifest", {
        artifactId,
        requirement_id: requirementId,
      });
    }

    const version = manifest.version;
    const pageId = manifest.pageId;
    if (currentPageIds && !currentPageIds.has(pageId)) continue;

    const variant = manifest.variant ?? "default";
    // Do not require page.vzi readability here. The handoff list is
    // manifest-driven so one missing VZI does not fail the whole route; the
    // VZI binary route returns 404 and AnnotationPage records that page error.
    const vziPath = getArtifactVziPath(productsRoot, productId, artifactId);
    const indexHtmlPath = join(getArtifactVersionDir(productsRoot, productId, artifactId, version), "index.html");

    pages.push({ pageId, variant, artifactId, version, vziPath, indexHtmlPath, iconCount: manifest.iconCount });
  }

  return pages.sort(
    (a, b) =>
      a.pageId.localeCompare(b.pageId) ||
      a.variant.localeCompare(b.variant) ||
      a.artifactId.localeCompare(b.artifactId),
  );
}
