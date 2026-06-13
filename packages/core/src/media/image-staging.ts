// ---------------------------------------------------------------------------
// Image staging area — SPEC-BEHAVIOR-001 / SPEC-BEHAVIOR-004
//
// Stores generated image bytes plus metadata under
//   $FORMA_HOME/data/<productId>/image-staging/<uuid>.png
//   $FORMA_HOME/data/<productId>/image-staging/<uuid>.json
//
// TTL is 24 h (STAGING_TTL_MS). Every put() sweeps expired entries (png+json
// paired) from the same product's staging dir before writing the new entry.
//
// Namespace:
//   forma-image://<uuid>      — staged image (this module)
//   forma-image://brand/...   — brand assets (M3, not yet wired; returns
//                               MEDIA_IMAGE_NOT_FOUND with brand-note details)
//
// Path safety: every resolved file path is checked with isSameOrChildPath
// (packages/core/src/path-boundary.ts) before any I/O. A traversal attempt
// (e.g. forma-image://../../etc/passwd) is treated as MEDIA_IMAGE_NOT_FOUND
// (fail loud, no silent fallback).
//
// uuid generation: node:crypto randomUUID() — consistent with other repo
// modules that need a one-shot unique id (no project-wide IdKind registry for
// staging ids).
// ---------------------------------------------------------------------------

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { FormaError } from "../errors.js";
import { isSameOrChildPath } from "../path-boundary.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Time-to-live for a staged image: 24 hours in milliseconds. */
export const STAGING_TTL_MS = 24 * 60 * 60 * 1000;

/** URI scheme prefix for forma-managed image references. */
const FORMA_IMAGE_SCHEME = "forma-image://";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Caller-supplied metadata for a staged image. `created_at` is added by
 * putStagedImage. `purpose` is kept as string for now; a union type can be
 * introduced when SPEC defines the closed set.
 */
export type StagedImageMeta = {
  /** Free-form purpose tag, e.g. "page-hero", "component-thumbnail". */
  purpose: string;
  /** The generation prompt that produced this image. */
  prompt: string;
  /** The model id used for generation, e.g. "doubao-seedream-5-0-260128". */
  model: string;
  /** Pixel width of the generated image. */
  width: number;
  /** Pixel height of the generated image. */
  height: number;
};

/** On-disk JSON metadata shape (StagedImageMeta + created_at). */
type StagedImageRecord = StagedImageMeta & { created_at: string };

/** Return value from putStagedImage. */
export type StagedImage = {
  /** The UUID assigned to this staged image. */
  id: string;
  /** The full forma-image:// reference, e.g. "forma-image://<uuid>". */
  ref: string;
  /** Absolute on-disk path to the .png file. */
  path: string;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns the staging directory for a product: data/<productId>/image-staging/. */
function stagingDir(home: string, productId: string): string {
  return join(home, "data", productId, "image-staging");
}

/** Returns the absolute .png path for a given uuid inside the staging dir. */
function pngPath(dir: string, uuid: string): string {
  return join(dir, `${uuid}.png`);
}

/** Returns the absolute .json path for a given uuid inside the staging dir. */
function jsonPath(dir: string, uuid: string): string {
  return join(dir, `${uuid}.json`);
}

/**
 * Sweeps entries older than STAGING_TTL_MS from `dir`.
 *
 * Age is determined by the `created_at` ISO timestamp in the .json sidecar
 * (not mtime). Using the stored timestamp makes sweep behaviour deterministic
 * and independent of filesystem clock resolution, copy operations, and backup
 * tools that reset mtime. A missing or malformed .json file means we cannot
 * determine the entry's age, so it is left alone (fail-safe).
 *
 * Pairs are removed as png+json together. If one removal fails it is logged
 * as a warning but does not abort the sweep (matching artifact-tmp-cleanup.ts
 * non-fatal pattern).
 */
async function sweepExpired(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // Dir doesn't exist yet on the very first put — nothing to sweep.
    return;
  }

  const now = Date.now();
  const pngFiles = entries.filter((e) => e.endsWith(".png"));

  for (const pngFile of pngFiles) {
    const uuid = pngFile.slice(0, -4); // strip ".png"
    const jPath = jsonPath(dir, uuid);

    let record: StagedImageRecord | null = null;
    try {
      const raw = await readFile(jPath, "utf8");
      record = JSON.parse(raw) as StagedImageRecord;
    } catch {
      // Missing or malformed sidecar — skip this entry.
      continue;
    }

    const createdAt = Date.parse(record.created_at);
    if (!Number.isFinite(createdAt)) continue; // malformed timestamp — skip

    if (now - createdAt >= STAGING_TTL_MS) {
      const pPath = pngPath(dir, uuid);
      try {
        await rm(pPath, { force: true });
      } catch (err) {
        console.warn(`[forma] image-staging: failed to remove ${pPath}:`, err);
      }
      try {
        await rm(jPath, { force: true });
      } catch (err) {
        console.warn(`[forma] image-staging: failed to remove ${jPath}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Writes `bytes` to the staging area for `productId`, assigns a UUID, and
 * persists a JSON sidecar with the supplied metadata + ISO `created_at`.
 *
 * Before writing, sweeps entries that have exceeded STAGING_TTL_MS from the
 * same product's staging directory.
 *
 * Returns a StagedImage with the uuid, full forma-image:// ref, and the
 * absolute .png path.
 */
export async function putStagedImage(
  home: string,
  productId: string,
  bytes: Buffer,
  meta: StagedImageMeta,
): Promise<StagedImage> {
  const dir = stagingDir(home, productId);

  // Sweep expired entries first (non-fatal internals handled inside sweep).
  await sweepExpired(dir);

  // Ensure the staging directory exists.
  await mkdir(dir, { recursive: true });

  const id = randomUUID();
  const pPath = pngPath(dir, id);
  const jPath = jsonPath(dir, id);

  const record: StagedImageRecord = {
    ...meta,
    created_at: new Date().toISOString(),
  };

  await writeFile(pPath, bytes);
  await writeFile(jPath, JSON.stringify(record, null, 2));

  return { id, ref: `${FORMA_IMAGE_SCHEME}${id}`, path: pPath };
}

/**
 * Resolves a `forma-image://` reference to the raw image bytes.
 *
 * Supported namespaces:
 *   - `forma-image://<uuid>`      — returns a Buffer copy of the staged PNG.
 *   - `forma-image://brand/...`   — reserved for M3 brand assets; currently
 *     throws MEDIA_IMAGE_NOT_FOUND with details.brand_note. The call site for
 *     M3 forwarding should be inserted where the TODO comment appears below.
 *
 * Throws MEDIA_IMAGE_NOT_FOUND for:
 *   - Malformed or missing scheme prefix.
 *   - `brand/` prefix (M3 not yet wired).
 *   - Path traversal attempts (uuid contains `../`, `..`, etc.).
 *   - Unknown uuid (file absent on disk).
 *
 * The resolved path is checked with isSameOrChildPath before I/O to prevent
 * directory traversal even on non-POSIX systems.
 */
export async function resolveFormaImageRef(
  home: string,
  productId: string,
  ref: string,
): Promise<Buffer> {
  // ── 1. Validate scheme ────────────────────────────────────────────────────
  if (!ref.startsWith(FORMA_IMAGE_SCHEME)) {
    throw new FormaError("MEDIA_IMAGE_NOT_FOUND", "Invalid forma-image:// reference", {
      ref,
      reason: "missing_scheme",
    });
  }

  const tail = ref.slice(FORMA_IMAGE_SCHEME.length); // e.g. "<uuid>" or "brand/logo.png"

  // ── 2. Brand namespace (M3 forwarding point) ──────────────────────────────
  if (tail.startsWith("brand/") || tail === "brand") {
    // TODO(M3): forward brand asset requests to the brand-assets service here.
    throw new FormaError("MEDIA_IMAGE_NOT_FOUND", "Brand assets are not yet available", {
      ref,
      brand_note:
        "forma-image://brand/ assets will be accessible once brand integration (M3) is wired. " +
        "Until then, all brand/ references return MEDIA_IMAGE_NOT_FOUND.",
    });
  }

  // ── 3. Path boundary check ────────────────────────────────────────────────
  // The tail is the UUID. We construct the expected path and verify it stays
  // inside the staging dir using isSameOrChildPath (handles ".." segments,
  // absolute-path injection, etc.).
  const dir = stagingDir(home, productId);
  const candidate = pngPath(dir, tail);

  if (!isSameOrChildPath(dir, candidate)) {
    throw new FormaError("MEDIA_IMAGE_NOT_FOUND", "Image reference resolves outside staging directory", {
      ref,
      reason: "path_traversal",
    });
  }

  // ── 4. Read bytes ─────────────────────────────────────────────────────────
  try {
    const buf = await readFile(candidate);
    // Return a copy so the caller cannot mutate our internal buffer.
    return Buffer.from(buf);
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: string }).code : undefined;
    if (code === "ENOENT") {
      throw new FormaError("MEDIA_IMAGE_NOT_FOUND", "Staged image not found", {
        ref,
        reason: "not_found",
      });
    }
    throw err;
  }
}
