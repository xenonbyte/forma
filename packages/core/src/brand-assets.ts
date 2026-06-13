/**
 * brand-assets.ts — PLAN-TASK-015 (M3)
 *
 * Persists per-product brand assets under the DESIGN tree:
 *   $FORMA_HOME/data/products/<productId>/od-project/brand-assets/
 *     ├── manifest.json
 *     ├── app-icon/      (master + per-platform derivatives + favicon)
 *     ├── store-shots/   (task 016 — html render path)
 *     └── posters/       (task 016 — html render path)
 *
 * This task implements the `app-icon` / `image_ref` path of SPEC-BEHAVIOR-006:
 * a staged 2048×2048 PNG master is sharp-derived into the per-platform size set
 * + favicon. The html → render path for store-shot/poster is task 016; the
 * `renderHtml` dependency seam below is where it plugs in (see RENDER SEAM).
 *
 * resolveBrandImageRef (SPEC-BEHAVIOR-004) resolves the brand/ namespace:
 *   forma-image://brand/app-icon        → the 2048 master bytes
 *   forma-image://brand/app-icon@<size> → the matching derivative (must exist)
 * image-staging.ts forwards its brand/ prefix here (replacing the M1 slot).
 *
 * IMPORT DIRECTION: this module statically imports resolveFormaImageRef from
 * image-staging.ts (to read the staged source for app-icon). image-staging.ts
 * dynamically imports resolveBrandImageRef from THIS module to forward brand/
 * refs — the one dynamic import breaks what would otherwise be a static cycle.
 *
 * All persistence runs inside runProductMutation (per-product lock). Reads
 * (list / resolve / zip export) are lock-free and home-bound.
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, relative, sep } from "node:path";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { z } from "zod";
import { getBrandAssetKindDir, getBrandAssetsDir, getBrandAssetsManifestPath } from "./artifact-paths.js";
import { FormaError } from "./errors.js";
import { resolveFormaImageRef } from "./media/image-staging.js";
import { getFormaPaths } from "./paths.js";
import { isSameOrChildPath } from "./path-boundary.js";
import { getProductMutationLock } from "./product-mutation-lock.js";
import { brandSurfaces } from "./schemas.js";
import type { BrandSurface, Platform } from "./schemas.js";

// ─── Public constants ──────────────────────────────────────────────────────────

/**
 * Per-platform app-icon size sets (square px). The 2048 master is always stored
 * in addition to these; favicon = the two smallest web sizes (16/32) re-emitted
 * under a `favicon-<size>.png` name (PNG, not multi-res .ico — sufficient for v1).
 *
 * Platform → set mapping (driven by the input `platform`):
 *   "mobile"            → ios + android  (+ web favicon for PWA)
 *   "web"/anything else → web            (web set already includes 32/16)
 */
export const APP_ICON_SIZES = {
  ios: [1024, 180, 120],
  android: [512, 192, 144, 96, 72, 48],
  web: [512, 192, 32, 16],
} as const satisfies Record<string, readonly number[]>;

/** Favicon sizes (PNG). These are a subset of the web set, re-emitted by name. */
const FAVICON_SIZES = [32, 16] as const;

/**
 * Store-shot / sharing-image presets — official platform sizes (PLAN-TASK-024).
 *
 * Every pixel value here was verified against the platform's own documentation
 * on the date in `verifiedAt`. NO placeholder values: each entry records the
 * `source` URL it was read from so the provenance is auditable. We keep the
 * PRIMARY 1-2 sizes per platform (not an exhaustive device matrix).
 *
 * Verified 2026-06-13:
 *   - ios-6.9       1320×2868  App Store Connect "Screenshot specifications":
 *                              the 6.9" display is the current required class;
 *                              1320×2868 is its newest/largest accepted portrait
 *                              resolution (iPhone 17 Pro Max / iPhone Air).
 *   - android-phone 1080×1920  Google Play Console "Add preview assets": phone
 *                              screenshots use 9:16 portrait, recommended 1080px
 *                              short edge → 1080×1920 is the recommended primary.
 *   - web-og        1200×630   Open Graph protocol (og:image, 1.91:1); the
 *                              1200×630 figure is the platform-recommended size
 *                              (Facebook sharing-image guidance corroborates).
 *
 * Each preset is tagged with the `platform`s it applies to so
 * listStoreShotPresets() can filter (see PLATFORM_PRESET_MAP for the mapping).
 */
export const STORE_SHOT_PRESETS = {
  "ios-6.9": {
    id: "ios-6.9",
    width: 1320,
    height: 2868,
    source: "https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/",
    verifiedAt: "2026-06-13",
  },
  "android-phone": {
    id: "android-phone",
    width: 1080,
    height: 1920,
    source: "https://support.google.com/googleplay/android-developer/answer/9866151",
    verifiedAt: "2026-06-13",
  },
  "web-og": {
    id: "web-og",
    width: 1200,
    height: 630,
    source: "https://ogp.me/",
    verifiedAt: "2026-06-13",
  },
} as const satisfies Record<string, StoreShotPreset>;

/**
 * Product platform → applicable store-shot preset ids.
 *
 *   mobile  → iOS + Android phone store screenshots
 *   web     → web Open Graph sharing image
 *   desktop → web Open Graph sharing image (desktop apps share via the web/OG)
 *   tablet  → web Open Graph sharing image — NO tablet-specific size was
 *             verified for v1, so tablet maps to the web/OG preset rather than
 *             guessing an iPad/tablet screenshot size.
 */
const PLATFORM_PRESET_MAP = {
  mobile: ["ios-6.9", "android-phone"],
  web: ["web-og"],
  desktop: ["web-og"],
  tablet: ["web-og"],
} as const satisfies Record<Platform, readonly (keyof typeof STORE_SHOT_PRESETS)[]>;

/** The master edge length (square). */
const MASTER_SIZE = 2048;

/** sharp decode ceiling — rejects raster decompression bombs. */
// ~64 MP — keep in sync with artifact-asset-pipeline.ts / artifact-icon-extraction.ts
const SHARP_PIXEL_LIMIT = 64_000_000;

/** Subdirectory per kind (internal, fixed — never caller-supplied). */
const KIND_SUBDIR = {
  "app-icon": "app-icon",
  "store-shot": "store-shots",
  banner: "banners",
  poster: "posters",
} as const satisfies Record<BrandAssetKind, string>;

// ─── Public types ────────────────────────────────────────────────────────────

export const BRAND_ASSET_KINDS = ["app-icon", "store-shot", "banner", "poster"] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];

/** A single emitted brand-asset file (bundle-relative path + pixel dims). */
export interface BrandAssetFile {
  /** Absolute on-disk path (under $FORMA_HOME). */
  path: string;
  width: number;
  height: number;
}

/** A manifest record for one brand asset (one kind+name). */
export interface BrandAssetRecord {
  kind: BrandAssetKind;
  name: string;
  /** Absolute on-disk paths + dims for every file of this asset. */
  files: BrandAssetFile[];
  brand_style: string;
  model?: string;
  generated_at: string;
  /**
   * The platform surface this asset targets. Omitted for web/desktop (single
   * surface) and for poster (platform-agnostic). Present for mobile/tablet
   * app-icon, store-shot, and banner records.
   */
  surface?: BrandSurface;
  /**
   * Optional variant discriminator: icon layer name, poster style, etc.
   * Omitted when not applicable.
   */
  variant?: string;
}

/** Source for a brand asset — EXACTLY ONE of image_ref / html. */
export interface BrandAssetSource {
  /** forma-image://<uuid> staged image — app-icon only. */
  image_ref?: string;
  /** HTML to render — store-shot / poster only (task 016). */
  html?: string;
}

/** Optional render target — ignored for app-icon (sizes are platform-derived). */
export type BrandAssetTarget = { width: number; height: number } | { preset: string };

/**
 * A verified store-shot / sharing-image preset (PLAN-TASK-024). `source` is the
 * official documentation URL the dimensions were read from; `verifiedAt` is the
 * ISO date (YYYY-MM-DD) the value was confirmed against that source.
 */
export interface StoreShotPreset {
  /** Stable preset id, e.g. "ios-6.9" / "android-phone" / "web-og". */
  id: string;
  /** Exact render width in px. */
  width: number;
  /** Exact render height in px. */
  height: number;
  /** Official documentation URL the dimensions were verified against. */
  source: string;
  /** ISO date (YYYY-MM-DD) the dimensions were verified on. */
  verifiedAt: string;
}

export interface SaveBrandAssetInput {
  product_id: string;
  kind: BrandAssetKind;
  name: string;
  brand_style: string;
  source: BrandAssetSource;
  /** Product platform — drives the app-icon size set (mobile → ios+android). */
  platform?: string;
  /** The generation model id, recorded in the manifest when present. */
  model?: string;
  /** Render target for store-shot/poster (task 016); app-icon ignores it. */
  target?: BrandAssetTarget;
}

export interface SavedBrandAsset {
  kind: BrandAssetKind;
  name: string;
  files: BrandAssetFile[];
  generated_at: string;
  /** Non-fatal advisories (e.g. master upscaled from < 2048). */
  warnings: string[];
}

/** Minimal mutation-lock surface the store provides (mirrors runProductMutation). */
export type RunProductMutation = <T>(
  input: { operation: string; product_id?: string },
  fn: (context: { warnings: string[] }) => Promise<T>,
) => Promise<T>;

export interface BrandAssetDeps {
  /** $FORMA_HOME root. */
  home: string;
  /** Serializes the save under the per-product mutation lock. */
  runProductMutation: RunProductMutation;
  /**
   * RENDER SEAM (task 016): resolves store-shot/poster `source.html` to a PNG
   * buffer at the target size, through the localize + interception sandbox
   * (brand-asset-render.ts). The store injects the puppeteer-backed renderer.
   * When a store-shot/poster save is attempted without it, the save fails loud
   * rather than silently producing nothing.
   */
  renderHtml?: (input: { html: string; width: number; height: number; productId: string }) => Promise<Buffer>;
}

// ─── Manifest schema ───────────────────────────────────────────────────────────

const brandAssetFileSchema = z
  .object({ path: z.string().min(1), width: z.number().int().positive(), height: z.number().int().positive() })
  .strict();

const brandAssetRecordSchema = z
  .object({
    kind: z.enum(BRAND_ASSET_KINDS),
    name: z.string().min(1),
    files: z.array(brandAssetFileSchema),
    brand_style: z.string().min(1),
    model: z.string().min(1).optional(),
    generated_at: z.string().refine((v) => Number.isFinite(Date.parse(v))),
    surface: z.enum(brandSurfaces).optional(),
    variant: z.string().min(1).optional(),
  })
  .strict();

const brandManifestSchema = z.object({ assets: z.array(brandAssetRecordSchema) }).strict();

type BrandManifest = z.infer<typeof brandManifestSchema>;

function toPortablePath(path: string): string {
  return path.split(sep).join("/");
}

function brandAssetExportPath(brandRoot: string, filePath: string): string {
  if (!isSameOrChildPath(brandRoot, filePath)) {
    throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Brand asset manifest contains an unsafe file path", {
      reason: "path_traversal",
    });
  }
  return toPortablePath(relative(brandRoot, filePath));
}

function sanitizeManifestForExport(brandRoot: string, manifest: BrandManifest): Buffer {
  const exported: BrandManifest = {
    assets: manifest.assets.map((asset) => ({
      ...asset,
      files: asset.files.map((file) => ({
        ...file,
        path: brandAssetExportPath(brandRoot, file.path),
      })),
    })),
  };
  return Buffer.from(JSON.stringify(exported, null, 2));
}

// ─── Name / kind validation ────────────────────────────────────────────────────

/** Asset names become single path segments — keep them strictly safe. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function assertValidName(name: string): void {
  if (typeof name !== "string" || !NAME_PATTERN.test(name) || name.includes("..")) {
    throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Invalid brand asset name", { name });
  }
}

function assertValidKind(kind: string): asserts kind is BrandAssetKind {
  if (!(BRAND_ASSET_KINDS as readonly string[]).includes(kind)) {
    throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Unknown brand asset kind", { kind });
  }
}

/** SPEC-BEHAVIOR-006: EXACTLY ONE of image_ref/html; app-icon image_ref only. */
function assertValidSource(kind: BrandAssetKind, source: BrandAssetSource): void {
  const hasRef = typeof source.image_ref === "string" && source.image_ref.length > 0;
  const hasHtml = typeof source.html === "string" && source.html.length > 0;
  if (hasRef === hasHtml) {
    throw new FormaError("BRAND_ASSET_INVALID_INPUT", "source must carry exactly one of image_ref or html", {
      kind,
      has_image_ref: hasRef,
      has_html: hasHtml,
    });
  }
  if (kind === "app-icon" && !hasRef) {
    throw new FormaError("BRAND_ASSET_INVALID_INPUT", "app-icon source must be an image_ref", { kind });
  }
  if (kind !== "app-icon" && !hasHtml) {
    throw new FormaError("BRAND_ASSET_INVALID_INPUT", `${kind} source must be html`, { kind });
  }
}

// ─── sharp helpers ───────────────────────────────────────────────────────────

async function readSquareMaster(bytes: Buffer): Promise<{ master: Buffer; warnings: string[] }> {
  const warnings: string[] = [];
  let meta: import("sharp").Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: SHARP_PIXEL_LIMIT }).metadata();
  } catch (err) {
    throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Source image is not a readable raster", {
      cause: String(err),
    });
  }
  const srcWidth = meta.width ?? 0;
  const srcHeight = meta.height ?? 0;
  if (srcWidth < 1 || srcHeight < 1) {
    throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Source image has no dimensions", {
      width: srcWidth,
      height: srcHeight,
    });
  }
  if (srcWidth < MASTER_SIZE || srcHeight < MASTER_SIZE) {
    warnings.push(
      `brand-asset app-icon source is smaller than ${MASTER_SIZE}px (${srcWidth}x${srcHeight}); upscaling to the ${MASTER_SIZE} master.`,
    );
  }
  // Always normalize the master to a square MASTER_SIZE PNG (cover-fit centred).
  const master = await resizeSquare(bytes, MASTER_SIZE);
  return { master, warnings };
}

async function resizeSquare(source: Buffer, size: number): Promise<Buffer> {
  try {
    return await sharp(source, { limitInputPixels: SHARP_PIXEL_LIMIT })
      .resize({ width: size, height: size, fit: "cover", position: "centre" })
      .png()
      .toBuffer();
  } catch (err) {
    throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Brand asset image processing failed", {
      size,
      cause: String(err),
    });
  }
}

/** Platform → app-icon size set + favicon emission plan. */
function planAppIconSizes(platform: string | undefined): { sizes: number[]; faviconSizes: number[] } {
  const sizeSet = new Set<number>([MASTER_SIZE]);
  if (platform === "mobile") {
    for (const w of APP_ICON_SIZES.ios) sizeSet.add(w);
    for (const w of APP_ICON_SIZES.android) sizeSet.add(w);
    // PWA favicon for native apps that also ship a web presence.
    for (const w of FAVICON_SIZES) sizeSet.add(w);
  } else {
    for (const w of APP_ICON_SIZES.web) sizeSet.add(w);
  }
  // Largest first → master derivation reuses the bigger source where possible.
  return { sizes: [...sizeSet].sort((a, b) => b - a), faviconSizes: [...FAVICON_SIZES] };
}

// ─── Durable generation write ──────────────────────────────────────────────────

/**
 * Writes a complete immutable generation for one kind+name, then atomically
 * makes that generation directory visible under `<kind>/<name>/`.
 *
 * The previous generation is not touched here. The manifest is switched only
 * after this returns, so lock-free crash recovery never observes a manifest
 * that points at files deleted by a failed replacement.
 */
async function writeAssetDirAtomic(destDir: string, files: Map<string, Buffer>): Promise<string> {
  const tmpDir = `${destDir}.tmp-${randomBytes(4).toString("hex")}`;
  const generationDir = join(destDir, `generation-${Date.now()}-${randomBytes(4).toString("hex")}`);
  try {
    await mkdir(tmpDir, { recursive: true });
    for (const [relName, buf] of files) {
      await writeFile(join(tmpDir, relName), buf);
    }
    await mkdir(destDir, { recursive: true });
    await rename(tmpDir, generationDir);
    return generationDir;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function pruneAssetDir(assetDir: string, keepDir: string): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(assetDir, { withFileTypes: true });
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "ENOENT") return;
    throw err;
  }

  for (const entry of entries) {
    const abs = join(assetDir, entry.name);
    if (abs === keepDir || !isSameOrChildPath(assetDir, abs)) continue;
    await rm(abs, { recursive: true, force: true });
  }
}

function cleanupWarning(err: unknown): string {
  const code = err instanceof Error && "code" in err ? (err as { code?: unknown }).code : undefined;
  return typeof code === "string" ? `Brand asset cleanup skipped (${code})` : "Brand asset cleanup skipped";
}

async function warnOnPruneFailure(context: { warnings: string[] }, assetDir: string, keepDir: string): Promise<void> {
  try {
    await pruneAssetDir(assetDir, keepDir);
  } catch (err) {
    context.warnings.push(cleanupWarning(err));
  }
}

// ─── Manifest read/write ────────────────────────────────────────────────────────

async function readManifest(home: string, productId: string): Promise<BrandManifest> {
  const productsRoot = getFormaPaths(home).productsDir;
  const manifestPath = getBrandAssetsManifestPath(productsRoot, productId);
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "ENOENT") {
      return { assets: [] };
    }
    throw err;
  }
  try {
    return brandManifestSchema.parse(JSON.parse(raw));
  } catch (err) {
    throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Brand asset manifest is corrupt", {
      product_id: productId,
      cause: String(err),
    });
  }
}

async function writeManifest(home: string, productId: string, manifest: BrandManifest): Promise<void> {
  const productsRoot = getFormaPaths(home).productsDir;
  const manifestPath = getBrandAssetsManifestPath(productsRoot, productId);
  await mkdir(getBrandAssetsDir(productsRoot, productId), { recursive: true });
  const tmp = `${manifestPath}.tmp-${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, JSON.stringify(manifest, null, 2));
  await rename(tmp, manifestPath);
}

// ─── store-shot / poster render target resolution ─────────────────────────────

/**
 * Resolves the render target to explicit pixel dimensions.
 *
 * Two forms are supported:
 *   - `{ width, height }` — explicit positive-integer pixels.
 *   - `{ preset }`        — a named preset id resolved through STORE_SHOT_PRESETS
 *                           (PLAN-TASK-024). Unknown preset ids fail loud with
 *                           BRAND_ASSET_INVALID_INPUT rather than guessing a size.
 */
function resolveRenderTarget(
  kind: BrandAssetKind,
  target: BrandAssetTarget | undefined,
): {
  width: number;
  height: number;
} {
  if (!target) {
    throw new FormaError(
      "BRAND_ASSET_INVALID_INPUT",
      `${kind} save requires a render target {width,height} or {preset}`,
      {
        kind,
        reason: "missing_target",
      },
    );
  }
  if ("preset" in target) {
    const preset = (STORE_SHOT_PRESETS as Record<string, StoreShotPreset>)[target.preset];
    if (!preset) {
      throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Unknown render preset", {
        kind,
        reason: "unknown_preset",
        preset: target.preset,
        available: Object.keys(STORE_SHOT_PRESETS),
      });
    }
    return { width: preset.width, height: preset.height };
  }
  const { width, height } = target;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Render target width/height must be positive integers", {
      kind,
      width,
      height,
    });
  }
  return { width, height };
}

/**
 * store-shot / poster save: render the author HTML to a single PNG through the
 * injected sandbox renderer (brand-asset-render.ts), then persist + record it
 * exactly like the app-icon path. Render happens OUTSIDE the lock (it touches
 * only the staging/brand read tree, never product state); only the file write +
 * manifest update run under the per-product mutation lock.
 */
async function saveRenderedBrandAsset(deps: BrandAssetDeps, input: SaveBrandAssetInput): Promise<SavedBrandAsset> {
  if (!deps.renderHtml) {
    throw new FormaError("BRAND_ASSET_INVALID_INPUT", `${input.kind} rendering is not available`, {
      kind: input.kind,
      reason: "no_html_renderer",
    });
  }
  // assertValidSource guaranteed a non-empty html for store-shot/poster.
  const html = input.source.html ?? "";
  const { width, height } = resolveRenderTarget(input.kind, input.target);

  const png = await deps.renderHtml({ html, width, height, productId: input.product_id });

  const generatedAt = new Date().toISOString();
  const subdir = KIND_SUBDIR[input.kind];

  return deps.runProductMutation({ operation: "save_brand_asset", product_id: input.product_id }, async (context) => {
    const productsRoot = getFormaPaths(deps.home).productsDir;
    const kindDir = getBrandAssetKindDir(productsRoot, input.product_id, subdir);
    const assetDir = join(kindDir, input.name);
    if (!isSameOrChildPath(kindDir, assetDir)) {
      throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Brand asset name escapes its kind directory", {
        name: input.name,
      });
    }

    const fileBytes = new Map<string, Buffer>([["image.png", png]]);
    const assetWriteDir = await writeAssetDirAtomic(assetDir, fileBytes);

    const files: BrandAssetFile[] = [{ path: join(assetWriteDir, "image.png"), width, height }];

    const record: BrandAssetRecord = {
      kind: input.kind,
      name: input.name,
      files,
      brand_style: input.brand_style,
      ...(input.model !== undefined ? { model: input.model } : {}),
      generated_at: generatedAt,
    };

    const manifest = await readManifest(deps.home, input.product_id);
    const next = manifest.assets.filter((a) => !(a.kind === record.kind && a.name === record.name));
    next.push(record);
    await writeManifest(deps.home, input.product_id, { assets: next });
    await warnOnPruneFailure(context, assetDir, assetWriteDir);

    return {
      kind: record.kind,
      name: record.name,
      files: record.files,
      generated_at: record.generated_at,
      warnings: [...context.warnings],
    } satisfies SavedBrandAsset;
  });
}

// ─── saveBrandAsset ──────────────────────────────────────────────────────────

export async function saveBrandAsset(deps: BrandAssetDeps, input: SaveBrandAssetInput): Promise<SavedBrandAsset> {
  assertValidKind(input.kind);
  assertValidName(input.name);
  assertValidSource(input.kind, input.source);

  if (input.kind !== "app-icon") {
    return saveRenderedBrandAsset(deps, input);
  }

  // ── app-icon path ──────────────────────────────────────────────────────────
  // Resolve the staged source OUTSIDE the lock (it is a read; no product state).
  // assertValidSource guarantees a non-empty image_ref for app-icon above.
  const imageRef = input.source.image_ref ?? "";
  const sourceBytes = await resolveFormaImageRef(deps.home, input.product_id, imageRef);

  const { master, warnings } = await readSquareMaster(sourceBytes);
  const { sizes, faviconSizes } = planAppIconSizes(input.platform);

  // Derive every size from the normalized master.
  const fileBytes = new Map<string, Buffer>();
  const fileDims: Array<{ relName: string; size: number }> = [];
  for (const size of sizes) {
    const buf = size === MASTER_SIZE ? master : await resizeSquare(master, size);
    const relName = size === MASTER_SIZE ? "master.png" : `icon-${size}.png`;
    fileBytes.set(relName, buf);
    fileDims.push({ relName, size });
  }
  // Favicons re-use the already-derived bytes under a favicon-<size>.png name.
  for (const size of faviconSizes) {
    const src = fileBytes.get(`icon-${size}.png`);
    const buf = src ?? (await resizeSquare(master, size));
    const relName = `favicon-${size}.png`;
    fileBytes.set(relName, buf);
    fileDims.push({ relName, size });
  }

  const generatedAt = new Date().toISOString();

  return deps.runProductMutation({ operation: "save_brand_asset", product_id: input.product_id }, async (context) => {
    const productsRoot = getFormaPaths(deps.home).productsDir;
    const kindDir = getBrandAssetKindDir(productsRoot, input.product_id, KIND_SUBDIR["app-icon"]);
    const assetDir = join(kindDir, input.name);
    // Defense-in-depth: the joined per-name dir must stay under the kind dir.
    if (!isSameOrChildPath(kindDir, assetDir)) {
      throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Brand asset name escapes its kind directory", {
        name: input.name,
      });
    }

    const assetWriteDir = await writeAssetDirAtomic(assetDir, fileBytes);

    const files: BrandAssetFile[] = fileDims.map(({ relName, size }) => ({
      path: join(assetWriteDir, relName),
      width: size,
      height: size,
    }));

    const record: BrandAssetRecord = {
      kind: "app-icon",
      name: input.name,
      files,
      brand_style: input.brand_style,
      ...(input.model !== undefined ? { model: input.model } : {}),
      generated_at: generatedAt,
    };

    // Overwrite semantics: same kind+name replaces the prior record.
    const manifest = await readManifest(deps.home, input.product_id);
    const next = manifest.assets.filter((a) => !(a.kind === record.kind && a.name === record.name));
    next.push(record);
    await writeManifest(deps.home, input.product_id, { assets: next });
    await warnOnPruneFailure(context, assetDir, assetWriteDir);

    return {
      kind: record.kind,
      name: record.name,
      files: record.files,
      generated_at: record.generated_at,
      warnings: [...warnings, ...context.warnings],
    } satisfies SavedBrandAsset;
  });
}

// ─── listBrandAssets ───────────────────────────────────────────────────────────

export async function listBrandAssets(
  home: string,
  productId: string,
  kind?: BrandAssetKind,
): Promise<BrandAssetRecord[]> {
  if (kind !== undefined) assertValidKind(kind);
  return getProductMutationLock(home).run({ operation: "list_brand_assets", product_id: productId }, async () => {
    const manifest = await readManifest(home, productId);
    return kind === undefined ? manifest.assets : manifest.assets.filter((a) => a.kind === kind);
  });
}

// ─── listStoreShotPresets ──────────────────────────────────────────────────────

/**
 * Returns the verified store-shot presets applicable to a product platform
 * (PLAN-TASK-024). The returned array is a fresh copy of fresh objects, so
 * callers can never mutate the static STORE_SHOT_PRESETS table.
 *
 * Mapping (see PLATFORM_PRESET_MAP): mobile → iOS + Android phone; web/desktop/
 * tablet → web Open Graph (no tablet-specific size verified for v1).
 */
export function listStoreShotPresets(platform: Platform): StoreShotPreset[] {
  const ids = PLATFORM_PRESET_MAP[platform] ?? [];
  return ids.map((id) => ({ ...STORE_SHOT_PRESETS[id] }));
}

// ─── resolveBrandImageRef (SPEC-BEHAVIOR-004) ──────────────────────────────────

const BRAND_SCHEME = "forma-image://brand/";

/**
 * Resolves a `forma-image://brand/...` reference to raw image bytes.
 *
 *   forma-image://brand/app-icon        → the 2048 master
 *   forma-image://brand/app-icon@<size> → the matching derivative
 *
 * Missing asset, unknown kind, or unknown size → MEDIA_IMAGE_NOT_FOUND.
 * The on-disk path is path-boundary checked before any read.
 */
export async function resolveBrandImageRef(home: string, productId: string, ref: string): Promise<Buffer> {
  if (!ref.startsWith(BRAND_SCHEME)) {
    throw new FormaError("MEDIA_IMAGE_NOT_FOUND", "Not a brand image reference", { ref, reason: "not_brand" });
  }
  const tail = ref.slice(BRAND_SCHEME.length); // e.g. "app-icon" | "app-icon@512"

  // Parse "<kind>[@<size>]". Reject anything with a path separator up front.
  if (tail.includes("/") || tail.includes("\\") || tail.includes("..")) {
    throw new FormaError("MEDIA_IMAGE_NOT_FOUND", "Invalid brand image reference", { ref, reason: "invalid_ref" });
  }
  const atIdx = tail.indexOf("@");
  const kindToken = atIdx === -1 ? tail : tail.slice(0, atIdx);
  const sizeToken = atIdx === -1 ? undefined : tail.slice(atIdx + 1);

  if (kindToken !== "app-icon") {
    throw new FormaError("MEDIA_IMAGE_NOT_FOUND", "Unknown brand asset reference", { ref, reason: "unknown_kind" });
  }

  let size: number | undefined;
  if (sizeToken !== undefined) {
    if (!/^\d{1,5}$/.test(sizeToken)) {
      throw new FormaError("MEDIA_IMAGE_NOT_FOUND", "Invalid brand image size", { ref, reason: "invalid_size" });
    }
    size = Number(sizeToken);
  }

  return getProductMutationLock(home).run({ operation: "resolve_brand_asset", product_id: productId }, async () => {
    // Locate the primary app-icon record. v1 resolves the asset named "primary"
    // when present, else the first/most-recent app-icon record.
    const manifest = await readManifest(home, productId);
    const records = manifest.assets.filter((a) => a.kind === "app-icon");
    const record = records.find((r) => r.name === "primary") ?? records.at(-1);
    if (!record) {
      throw new FormaError("MEDIA_IMAGE_NOT_FOUND", "No app-icon brand asset", { ref, reason: "not_found" });
    }

    // Choose the file: master (no size) or the matching derivative.
    const wantWidth = size ?? MASTER_SIZE;
    const file = record.files.find((f) => f.width === wantWidth);
    if (!file) {
      throw new FormaError("MEDIA_IMAGE_NOT_FOUND", "Brand asset size not in set", {
        ref,
        reason: "size_not_in_set",
        available: record.files.map((f) => f.width).sort((a, b) => a - b),
      });
    }

    // Path-boundary: the recorded path must stay under the product's brand-assets.
    const productsRoot = getFormaPaths(home).productsDir;
    const brandRoot = getBrandAssetsDir(productsRoot, productId);
    if (!isSameOrChildPath(brandRoot, file.path)) {
      throw new FormaError("MEDIA_IMAGE_NOT_FOUND", "Brand asset path escapes brand-assets dir", {
        ref,
        reason: "path_traversal",
      });
    }

    try {
      return Buffer.from(await readFile(file.path));
    } catch (err) {
      const code = err instanceof Error && "code" in err ? (err as { code: string }).code : undefined;
      if (code === "ENOENT") {
        throw new FormaError("MEDIA_IMAGE_NOT_FOUND", "Brand asset file missing on disk", { ref, reason: "not_found" });
      }
      throw err;
    }
  });
}

// ─── exportBrandAssetsZip ──────────────────────────────────────────────────────

/**
 * Zips the current manifest plus every file it references, with paths relative
 * to brand-assets/. Unreferenced generations left by interrupted replacements
 * are intentionally ignored.
 *
 * Security: only manifest paths UNDER the product's brand-assets dir are read —
 * the credential file ($FORMA_HOME/media-config.yaml) lives in a different tree
 * and can never be reached. Every entry is path-boundary checked first.
 */
export async function exportBrandAssetsZip(home: string, productId: string): Promise<Buffer> {
  return getProductMutationLock(home).run({ operation: "export_brand_assets", product_id: productId }, async () => {
    const productsRoot = getFormaPaths(home).productsDir;
    const brandRoot = getBrandAssetsDir(productsRoot, productId);
    const manifest = await readManifest(home, productId);
    const zip = new AdmZip();
    const seen = new Set<string>();

    zip.addFile("manifest.json", sanitizeManifestForExport(brandRoot, manifest));

    for (const asset of manifest.assets) {
      for (const file of asset.files) {
        const rel = brandAssetExportPath(brandRoot, file.path);
        if (seen.has(rel)) continue;
        seen.add(rel);
        try {
          zip.addFile(rel, await readFile(file.path));
        } catch (err) {
          const code = err instanceof Error && "code" in err ? (err as { code: string }).code : undefined;
          if (code === "ENOENT") {
            throw new FormaError("MEDIA_IMAGE_NOT_FOUND", "Brand asset file missing on disk", {
              product_id: productId,
              path: rel,
              reason: "not_found",
            });
          }
          throw err;
        }
      }
    }

    return zip.toBuffer();
  });
}
