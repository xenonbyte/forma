/**
 * archive-asset-export.ts
 *
 * Orchestrator that runs the full archive-asset pipeline for a requirement:
 *
 *   Phase 1 → icons  (exportRequirementIcons  — Task 4)
 *   Phase 2 → VZI    (captureRequirementVzi   — Task 5)
 *
 * Icons run first; their result is passed directly into VZI capture so that
 * icon asset refs can be injected during the VZI build step.
 *
 * A failure in either phase throws immediately (fail-loud).  Cleanup of any
 * temp directories is handled internally by each phase.
 *
 * Narrow-deps pattern: callers (store, tests) inject real or fake
 * implementations via ExportArchiveAssetsDeps.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DesignPointer } from './product.js';
import type { Platform } from './schemas.js';
import type { IconGeneratedFrom } from './artifact-icon-extraction.js';
import {
  exportRequirementIcons,
  type ExportRequirementIconsDeps,
  type ExportRequirementIconsResult,
} from './requirement-icon-export.js';
import {
  captureRequirementVzi,
  type CaptureRequirementVziDeps,
  type CaptureRequirementVziResult,
} from './requirement-vzi-capture.js';
import { FormaError } from './errors.js';
import type { GetRequirementPageIds } from './requirement-design-pointer-filter.js';

// ─── Public types ──────────────────────────────────────────────────────────────

/**
 * Combined deps for both phases.  The individual phase dep types are
 * structurally compatible so their sub-sets are unified here.
 */
export interface ExportArchiveAssetsDeps {
  /** Absolute path to the products root (contains <productId>/od-project/…). */
  productsRoot: string;
  /** Returns the platform for the given product (undefined if not set). */
  getProductPlatform: (productId: string) => Promise<Platform | undefined>;
  /** Returns all design pointers for the given product. */
  listDesignPointers: (productId: string) => Promise<DesignPointer[]>;
  /** Returns current page ids for the requirement, so removed-page pointers are excluded. */
  getRequirementPageIds?: GetRequirementPageIds;
  /** Read a file from disk. */
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

export interface ExportArchiveAssetsInput {
  productId: string;
  requirementId: string;
  /** Used to stamp icon manifests (who triggered the export). */
  generatedFrom: IconGeneratedFrom;
}

export interface ExportArchiveAssetsResult {
  icons: ExportRequirementIconsResult;
  vzi: CaptureRequirementVziResult;
}

// ─── Helpers: narrow-deps adapters ────────────────────────────────────────────

/**
 * Adapt the unified deps to the icon export phase deps shape.
 * (All fields are present — this is a structural projection.)
 */
function toIconDeps(deps: ExportArchiveAssetsDeps): ExportRequirementIconsDeps {
  return {
    productsRoot: deps.productsRoot,
    getProductPlatform: deps.getProductPlatform,
    listDesignPointers: deps.listDesignPointers,
    getRequirementPageIds: deps.getRequirementPageIds,
    readFile: deps.readFile,
    writeFile: deps.writeFile,
    rmDir: deps.rmDir,
    rename: deps.rename,
    mkdir: deps.mkdir,
  };
}

/**
 * Adapt the unified deps to the VZI capture phase deps shape.
 */
function toVziDeps(deps: ExportArchiveAssetsDeps): CaptureRequirementVziDeps {
  return {
    productsRoot: deps.productsRoot,
    getProductPlatform: deps.getProductPlatform,
    listDesignPointers: deps.listDesignPointers,
    getRequirementPageIds: deps.getRequirementPageIds,
    readFile: deps.readFile,
    writeFile: deps.writeFile,
    rmDir: deps.rmDir,
    rename: deps.rename,
    mkdir: deps.mkdir,
  };
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Run the full archive-asset export for a requirement:
 *   1. Export icons (fail-loud — throws if any page fails)
 *   2. Capture VZI, passing the icon result so icon refs can be injected
 *
 * Returns `{ icons, vzi }`.  Any failure aborts the entire export.
 */
export async function exportArchiveAssets(
  deps: ExportArchiveAssetsDeps,
  input: ExportArchiveAssetsInput,
): Promise<ExportArchiveAssetsResult> {
  const { productId, requirementId, generatedFrom } = input;

  // ── Phase 1: icons ────────────────────────────────────────────────────────
  let icons: ExportRequirementIconsResult;
  try {
    icons = await exportRequirementIcons(toIconDeps(deps), {
      productId,
      requirementId,
      generatedFrom,
    });
  } catch (err) {
    if (err instanceof FormaError) throw err;
    throw new FormaError(
      'ARTIFACT_WRITE_FAIL',
      `Archive-asset export (icons phase) failed for requirement ${requirementId}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      { productId, requirementId, phase: 'icons', cause: String(err) },
    );
  }

  // ── Phase 2: VZI (receives icon result for asset-ref injection) ───────────
  let vzi: CaptureRequirementVziResult;
  try {
    vzi = await captureRequirementVzi(toVziDeps(deps), { productId, requirementId }, icons);
  } catch (err) {
    if (err instanceof FormaError) throw err;
    throw new FormaError(
      'ARTIFACT_WRITE_FAIL',
      `Archive-asset export (VZI phase) failed for requirement ${requirementId}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      { productId, requirementId, phase: 'vzi', cause: String(err) },
    );
  }

  return { icons, vzi };
}

// ─── Real deps factory ────────────────────────────────────────────────────────

/**
 * Build production-ready deps from a ProductService and productsRoot.
 * Tests can inject fakes instead.
 */
export function makeExportArchiveAssetsDeps(
  productsRoot: string,
  getProductPlatformFn: (productId: string) => Promise<Platform | undefined>,
  listDesignPointersFn: (productId: string) => Promise<DesignPointer[]>,
  getRequirementPageIdsFn?: GetRequirementPageIds,
): ExportArchiveAssetsDeps {
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
