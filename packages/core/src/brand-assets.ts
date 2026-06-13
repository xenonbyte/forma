/**
 * brand-assets.ts — PLAN-TASK-015 (M3)
 *
 * Persists per-product brand assets under the DESIGN tree:
 *   $FORMA_HOME/data/products/<productId>/od-project/brand-assets/
 *     ├── manifest.json
 *     ├── app-icon/      (per-surface variant matrix; atomically replaced)
 *     ├── store-shots/   (html render path)
 *     ├── banners/       (html render path)
 *     └── posters/       (html render path)
 *
 * saveBrandAsset is a discriminated union on `kind` (SPEC-DATA-006):
 *   - app-icon: master refs (logo/bg/safe-logo) are resolved locally and
 *     sharp-derived into the full per-surface variant set (deriveAppIconVariants,
 *     Task 3); the product's ENTIRE app-icon set is then atomically replaced
 *     (one record per (surface, variant)). Returns { kind, assets }.
 *   - store-shot/banner/poster: the author HTML is rendered to one PNG at the
 *     caller-supplied target through the renderHtml sandbox seam. Returns
 *     { kind, asset }.
 *
 * resolveBrandImageRef (SPEC-DATA-008) resolves the brand/ namespace, considering
 * only STANDARD-variant app-icon files:
 *   forma-image://brand/app-icon        → the largest standard-variant file
 *   forma-image://brand/app-icon@<size> → the standard-variant file whose width === size
 * image-staging.ts forwards its brand/ prefix here.
 *
 * IMPORT DIRECTION: this module statically imports resolveFormaImageRef from
 * image-staging.ts (to read the staged masters for app-icon). image-staging.ts
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
import { z } from "zod";
import { getBrandAssetKindDir, getBrandAssetsDir, getBrandAssetsManifestPath } from "./artifact-paths.js";
import { deriveAppIconVariants, type DerivedIconVariant } from "./brand-icon-derive.js";
import { FormaError } from "./errors.js";
import { resolveFormaImageRef } from "./media/image-staging.js";
import { getFormaPaths } from "./paths.js";
import { isSameOrChildPath } from "./path-boundary.js";
import { getProductMutationLock } from "./product-mutation-lock.js";
import { brandSurfaces, brandSurfacesForPlatform } from "./schemas.js";
import type { BrandSurface, Platform } from "./schemas.js";

// ─── Public constants ──────────────────────────────────────────────────────────

/**
 * Standard app-icon variant names — the "primary" square icon for each surface.
 * resolveBrandImageRef (bare `forma-image://brand/app-icon` and `@<size>`) only
 * considers files belonging to these variants, so it never returns a foreground/
 * background/monochrome layer.
 */
const STANDARD_APP_ICON_VARIANTS = new Set(["standard", "android-standard", "ios-standard"]);

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

/**
 * app-icon save: the master image refs are resolved locally and sharp-derived
 * into the full per-surface variant set (Task 3 `deriveAppIconVariants`); the
 * product's entire app-icon set is then atomically replaced. Optional colour
 * overrides flow through to monochrome / tinted / dark variants.
 */
export interface SaveAppIconInput {
  product_id: string;
  kind: "app-icon";
  brand_style: string;
  /** Product platform — drives the surface set (mobile/tablet → android+ios). */
  platform: Platform;
  /** Master image a — transparent-background logo. */
  logo_ref: string;
  /** Master image b — opaque background. */
  bg_ref: string;
  /** Master image c — safe-area logo (required for mobile/tablet surfaces). */
  safe_logo_ref?: string;
  /** Optional colour overrides for tinted / monochrome variants. */
  colors?: { mono?: string; tint?: string; dark_bg?: string };
  /** The generation model id, recorded in every emitted record when present. */
  model?: string;
}

/**
 * store-shot / banner / poster save: the author HTML is rendered to a single
 * PNG at the caller-supplied target via the injected sandbox renderer.
 */
export interface SaveMediaBrandAssetInput {
  product_id: string;
  kind: "store-shot" | "banner" | "poster";
  name: string;
  brand_style: string;
  source: { html: string };
  /** The platform surface this asset targets (omit for single-surface/poster). */
  surface?: BrandSurface;
  /** Optional variant discriminator (e.g. poster orientation). */
  variant?: string;
  /** Exact render dimensions (the agent supplies plan sizes). */
  target: { width: number; height: number };
  /** The generation model id, recorded in the manifest when present. */
  model?: string;
}

export type SaveBrandAssetInput = SaveAppIconInput | SaveMediaBrandAssetInput;

export interface SavedBrandAsset {
  kind: BrandAssetKind;
  name: string;
  files: BrandAssetFile[];
  generated_at: string;
  /** The platform surface this asset targets (omitted for single-surface). */
  surface?: BrandSurface;
  /** Optional variant discriminator. */
  variant?: string;
  /** Non-fatal advisories. */
  warnings: string[];
}

/**
 * Discriminated result of saveBrandAsset:
 *   - app-icon: the full freshly-derived set of records (atomic replacement).
 *   - media kinds: the single rendered asset.
 */
export type SaveBrandAssetResult =
  | { kind: "app-icon"; assets: BrandAssetRecord[] }
  | { kind: "store-shot" | "banner" | "poster"; asset: SavedBrandAsset };

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

// ─── store-shot / banner / poster render target validation ────────────────────

/** Validates an explicit `{ width, height }` render target. */
function assertRenderTarget(kind: BrandAssetKind, target: { width: number; height: number }): void {
  const { width, height } = target;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Render target width/height must be positive integers", {
      kind,
      width,
      height,
    });
  }
}

/**
 * store-shot / banner / poster save: render the author HTML to a single PNG
 * through the injected sandbox renderer (brand-asset-render.ts), then persist +
 * record it. Render happens OUTSIDE the lock (it touches only the staging/brand
 * read tree, never product state); only the file write + manifest update run
 * under the per-product mutation lock. Same kind+name replaces the prior record.
 */
async function saveRenderedBrandAsset(
  deps: BrandAssetDeps,
  input: SaveMediaBrandAssetInput,
): Promise<SaveBrandAssetResult> {
  if (!deps.renderHtml) {
    throw new FormaError("BRAND_ASSET_INVALID_INPUT", `${input.kind} rendering is not available`, {
      kind: input.kind,
      reason: "no_html_renderer",
    });
  }
  const html = input.source.html;
  if (typeof html !== "string" || html.length === 0) {
    throw new FormaError("BRAND_ASSET_INVALID_INPUT", `${input.kind} source must be non-empty html`, {
      kind: input.kind,
    });
  }
  assertRenderTarget(input.kind, input.target);
  const { width, height } = input.target;

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
      ...(input.surface !== undefined ? { surface: input.surface } : {}),
      ...(input.variant !== undefined ? { variant: input.variant } : {}),
    };

    const manifest = await readManifest(deps.home, input.product_id);
    const next = manifest.assets.filter((a) => !(a.kind === record.kind && a.name === record.name));
    next.push(record);
    await writeManifest(deps.home, input.product_id, { assets: next });
    await warnOnPruneFailure(context, assetDir, assetWriteDir);

    const asset: SavedBrandAsset = {
      kind: record.kind,
      name: record.name,
      files: record.files,
      generated_at: record.generated_at,
      ...(record.surface !== undefined ? { surface: record.surface } : {}),
      ...(record.variant !== undefined ? { variant: record.variant } : {}),
      warnings: [...context.warnings],
    };
    return { kind: input.kind, asset };
  });
}

// ─── app-icon derivation + atomic replacement ──────────────────────────────────

/**
 * Resolves the app-icon master refs, derives the full per-surface variant set
 * (Task 3 deriveAppIconVariants), and ATOMICALLY REPLACES the product's entire
 * app-icon set: all prior app-icon records + their files are removed and the new
 * set written under the per-product mutation lock.
 *
 * One BrandAssetRecord is produced per (surface, variant). Multi-size variants
 * (e.g. ios-standard) collapse into one record with multiple files.
 */
async function saveAppIcon(deps: BrandAssetDeps, input: SaveAppIconInput): Promise<SaveBrandAssetResult> {
  // Resolve the staged master refs OUTSIDE the lock (reads; no product state).
  const logo = await resolveFormaImageRef(deps.home, input.product_id, input.logo_ref);
  const background = await resolveFormaImageRef(deps.home, input.product_id, input.bg_ref);
  const safeLogo =
    input.safe_logo_ref !== undefined
      ? await resolveFormaImageRef(deps.home, input.product_id, input.safe_logo_ref)
      : undefined;

  // Derive per surface. web/desktop have no surfaces → derive once (surface undefined).
  const surfaces = brandSurfacesForPlatform(input.platform);
  const surfaceList: (BrandSurface | undefined)[] = surfaces.length > 0 ? surfaces : [undefined];

  type SurfacedVariant = DerivedIconVariant & { surface?: BrandSurface };
  const derived: SurfacedVariant[] = [];
  for (const surface of surfaceList) {
    const variants = await deriveAppIconVariants({
      ...(surface !== undefined ? { surface } : {}),
      platform: input.platform,
      logo,
      background,
      ...(safeLogo !== undefined ? { safeLogo } : {}),
      ...(input.colors !== undefined ? { colors: input.colors } : {}),
    });
    for (const v of variants) {
      derived.push(surface !== undefined ? { ...v, surface } : v);
    }
  }

  const generatedAt = new Date().toISOString();

  return deps.runProductMutation({ operation: "save_brand_asset", product_id: input.product_id }, async (context) => {
    const productsRoot = getFormaPaths(deps.home).productsDir;
    const kindDir = getBrandAssetKindDir(productsRoot, input.product_id, KIND_SUBDIR["app-icon"]);

    // Group derived variants into one record per (surface, variant).
    type Group = { surface?: BrandSurface; variant: string; entries: SurfacedVariant[] };
    const groups = new Map<string, Group>();
    for (const v of derived) {
      const surface = v.surface;
      const key = `${surface ?? ""}::${v.variant}`;
      let group = groups.get(key);
      if (!group) {
        group = { ...(surface !== undefined ? { surface } : {}), variant: v.variant, entries: [] };
        groups.set(key, group);
      }
      group.entries.push(v);
    }

    // Write all PNGs into one immutable generation dir under the kind dir, then
    // atomically replace the whole app-icon set (remove every prior file + dir).
    const fileBytes = new Map<string, Buffer>();
    type PendingRecord = {
      surface?: BrandSurface;
      variant: string;
      files: Array<{ relName: string; width: number; height: number }>;
    };
    const pending: PendingRecord[] = [];
    for (const group of groups.values()) {
      const files: PendingRecord["files"] = [];
      group.entries.forEach((entry, i) => {
        const relName = `${group.surface ? `${group.surface}-` : ""}${group.variant}-${entry.width}x${entry.height}-${i}.png`;
        fileBytes.set(relName, entry.png);
        files.push({ relName, width: entry.width, height: entry.height });
      });
      pending.push({
        ...(group.surface !== undefined ? { surface: group.surface } : {}),
        variant: group.variant,
        files,
      });
    }

    const generationDir = await writeAssetDirAtomic(kindDir, fileBytes);

    const records: BrandAssetRecord[] = pending.map((p) => ({
      kind: "app-icon",
      name: p.variant,
      files: p.files.map((f) => ({ path: join(generationDir, f.relName), width: f.width, height: f.height })),
      brand_style: input.brand_style,
      ...(input.model !== undefined ? { model: input.model } : {}),
      generated_at: generatedAt,
      ...(p.surface !== undefined ? { surface: p.surface } : {}),
      variant: p.variant,
    }));

    // Atomic replacement: drop ALL prior app-icon records, then add the new set.
    const manifest = await readManifest(deps.home, input.product_id);
    const next = manifest.assets.filter((a) => a.kind !== "app-icon");
    next.push(...records);
    await writeManifest(deps.home, input.product_id, { assets: next });
    // Prune every prior generation under the kind dir except the one just written.
    await warnOnPruneFailure(context, kindDir, generationDir);

    return { kind: "app-icon", assets: records };
  });
}

// ─── saveBrandAsset ──────────────────────────────────────────────────────────

export async function saveBrandAsset(deps: BrandAssetDeps, input: SaveBrandAssetInput): Promise<SaveBrandAssetResult> {
  assertValidKind(input.kind);

  if (input.kind === "app-icon") {
    return saveAppIcon(deps, input);
  }

  assertValidName(input.name);
  return saveRenderedBrandAsset(deps, input);
}

// ─── deleteBrandAsset (SPEC-BEHAVIOR-006) ──────────────────────────────────────

/**
 * Removes one brand-asset record (by kind+name) and its on-disk files.
 *
 * Every file path must resolve under the product's brand-assets kind dir; an
 * absolute / `..` / out-of-boundary path is rejected with BRAND_ASSET_INVALID_INPUT
 * rather than deleted. A record that does not exist fails loud (not a silent
 * no-op). Runs under the per-product mutation lock.
 */
export async function deleteBrandAsset(
  deps: BrandAssetDeps,
  input: { product_id: string; kind: BrandAssetKind; name: string },
): Promise<{ deleted: boolean }> {
  assertValidKind(input.kind);

  return deps.runProductMutation({ operation: "delete_brand_asset", product_id: input.product_id }, async () => {
    const productsRoot = getFormaPaths(deps.home).productsDir;
    const kindDir = getBrandAssetKindDir(productsRoot, input.product_id, KIND_SUBDIR[input.kind]);

    const manifest = await readManifest(deps.home, input.product_id);
    const record = manifest.assets.find((a) => a.kind === input.kind && a.name === input.name);
    if (!record) {
      throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Brand asset not found", {
        product_id: input.product_id,
        kind: input.kind,
        name: input.name,
        reason: "not_found",
      });
    }

    // Boundary check every recorded file before removing anything.
    for (const file of record.files) {
      if (!isSameOrChildPath(kindDir, file.path)) {
        throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Brand asset file path escapes its kind directory", {
          product_id: input.product_id,
          kind: input.kind,
          name: input.name,
          reason: "path_traversal",
        });
      }
    }

    // Drop the manifest record first, then delete the files. The remaining
    // manifest never references the deleted files.
    const next = manifest.assets.filter((a) => !(a.kind === input.kind && a.name === input.name));
    await writeManifest(deps.home, input.product_id, { assets: next });
    for (const file of record.files) {
      await rm(file.path, { force: true });
    }

    return { deleted: true };
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

// ─── resolveBrandImageRef (SPEC-BEHAVIOR-004) ──────────────────────────────────

const BRAND_SCHEME = "forma-image://brand/";

/**
 * Resolves a `forma-image://brand/...` reference to raw image bytes.
 *
 *   forma-image://brand/app-icon        → the largest STANDARD-variant icon file
 *   forma-image://brand/app-icon@<size> → the STANDARD-variant file whose width === size
 *
 * Only files belonging to a standard variant (standard / android-standard /
 * ios-standard) are considered, so a foreground/background/monochrome layer is
 * never returned. Missing asset, unknown kind, or unknown size →
 * MEDIA_IMAGE_NOT_FOUND. The on-disk path is path-boundary checked before any read.
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
    // Consider only STANDARD-variant app-icon files (the primary square icon).
    const manifest = await readManifest(home, productId);
    const standardFiles = manifest.assets
      .filter((a) => a.kind === "app-icon" && a.variant !== undefined && STANDARD_APP_ICON_VARIANTS.has(a.variant))
      .flatMap((a) => a.files);
    if (standardFiles.length === 0) {
      throw new FormaError("MEDIA_IMAGE_NOT_FOUND", "No standard app-icon brand asset", { ref, reason: "not_found" });
    }

    // Bare ref → largest width (stable on ties by record/file order).
    // @size  → the file whose width === size.
    let file: BrandAssetFile | undefined;
    if (size === undefined) {
      for (const candidate of standardFiles) {
        if (file === undefined || candidate.width > file.width) file = candidate;
      }
    } else {
      file = standardFiles.find((f) => f.width === size);
    }
    if (!file) {
      throw new FormaError("MEDIA_IMAGE_NOT_FOUND", "Brand asset size not in set", {
        ref,
        reason: "size_not_in_set",
        available: [...new Set(standardFiles.map((f) => f.width))].sort((a, b) => a - b),
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
