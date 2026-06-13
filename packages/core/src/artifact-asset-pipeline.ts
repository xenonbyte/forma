/**
 * artifact-asset-pipeline.ts
 *
 * Localizes AI-generated HTML by:
 *  1. Extracting inlined data: resources (images, SVG, fonts, CSS)
 *  2. Down-sampling raster images via sharp into @1x/@2x/@3x density tiers
 *  3. Rejecting any remote http(s): references with ARTIFACT_REMOTE_RESOURCE
 *
 * Entry points walked:
 *   <img src|srcset>, <source src|srcset>, <link href>, <image href|xlink:href>,
 *   poster attr, inline <style> blocks, style="..." attrs, css url(data:) / @import url(data:)
 *
 * forma-image:// references (SPEC-BEHAVIOR-004) are intercepted at every surface
 * that classifies a data: reference, resolved to bytes via the optional
 * `resolveFormaImage` resolver, and fed through the identical data: handling flow
 * (down-sampling, budgets, manifest accounting). A forma-image:// reference with
 * no resolver — or a resolver that rejects — fails loud with MEDIA_IMAGE_NOT_FOUND.
 */

import { createHash } from "node:crypto";
import { parse } from "node-html-parser";
import sharp from "sharp";
import type { ArtifactAssetEntry } from "./artifact-manifest.js";
import { FormaError } from "./errors.js";

// ─── Input budgets (R3) ──────────────────────────────────────────────────────
// Enforced at the single entry point all save paths share (design-save →
// localizeArtifactAssets). Constants, not configuration: a generated page that
// exceeds these is a malfunctioning generator, not a use case.

/** Max bytes of input HTML (single generated page). */
export const MAX_HTML_BYTES = 4 * 1024 * 1024; // 4 MiB
/** Max total bytes across all localized asset files of one artifact version. */
export const MAX_TOTAL_ASSET_BYTES = 48 * 1024 * 1024; // 48 MiB
/** Max number of localized asset files in one artifact version. */
export const MAX_ASSET_COUNT = 200;
/** sharp decode ceiling — rejects raster decompression bombs before resize. */
const SHARP_PIXEL_LIMIT = 64_000_000; // ~64 MP — keep in sync with artifact-icon-extraction.ts

export function assertArtifactAssetBudgets(files: ReadonlyMap<string, Buffer>): void {
  if (files.size > MAX_ASSET_COUNT) {
    throw new FormaError("ARTIFACT_INVALID_INPUT", `Artifact asset count exceeds the ${MAX_ASSET_COUNT} budget`, {
      budget: "MAX_ASSET_COUNT",
      limit: MAX_ASSET_COUNT,
      actual: files.size,
    });
  }
  let totalAssetBytes = 0;
  for (const buf of files.values()) {
    totalAssetBytes += buf.byteLength;
  }
  if (totalAssetBytes > MAX_TOTAL_ASSET_BYTES) {
    throw new FormaError("ARTIFACT_INVALID_INPUT", `Artifact assets exceed the ${MAX_TOTAL_ASSET_BYTES}-byte budget`, {
      budget: "MAX_TOTAL_ASSET_BYTES",
      limit: MAX_TOTAL_ASSET_BYTES,
      actual: totalAssetBytes,
    });
  }
}

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Resolves a `forma-image://` reference (staging uuid or brand asset) to raw
 * image bytes. Both namespaces are handled by the resolver itself — the pipeline
 * does not distinguish them. Throws MEDIA_IMAGE_NOT_FOUND when the reference
 * cannot be resolved (unknown id, traversal, brand asset missing).
 */
export type ResolveFormaImage = (ref: string) => Promise<Buffer>;

export interface LocalizeInput {
  html: string;
  /** default 'assets' */
  assetDirName?: string;
  /**
   * Optional resolver for `forma-image://` references. When omitted, any
   * `forma-image://` reference fails loud with MEDIA_IMAGE_NOT_FOUND.
   */
  resolveFormaImage?: ResolveFormaImage;
}

export interface LocalizeResult {
  html: string;
  /** relative path → content; assets ⊆ these keys */
  files: Map<string, Buffer>;
  /** manifest.forma.assets entries */
  assets: ArtifactAssetEntry[];
}

export interface LocalizeCssResult {
  css: string;
  /** relative path → content; assets ⊆ these keys */
  files: Map<string, Buffer>;
  /** manifest.forma.assets entries */
  assets: ArtifactAssetEntry[];
}

// ─── Internal context shared across the walk ─────────────────────────────────

interface Context {
  assetDir: string;
  files: Map<string, Buffer>;
  assets: Map<string, ArtifactAssetEntry>; // keyed by canonical @1x / single path
  /** Optional forma-image:// resolver; absent ⇒ such refs fail loud. */
  resolveFormaImage?: ResolveFormaImage;
}

// ─── MIME → extension table ───────────────────────────────────────────────────

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "text/css": "css",
  "application/font-woff": "woff",
  "application/font-woff2": "woff2",
  "font/woff": "woff",
  "font/woff2": "woff2",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "application/font-ttf": "ttf",
  "application/font-otf": "otf",
  "application/octet-stream": "bin",
};

const RASTER_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** sha256(payload).slice(0,16) hex */
function contentHash(payload: Buffer): string {
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/** Parsed data: URL */
interface ParsedDataUrl {
  mime: string;
  /** Parameters stripped */
  charset?: string;
  isBase64: boolean;
  payload: Buffer;
}

/**
 * Parses a data: URL. Returns null if not a data: URL.
 * Supports base64 and url-encoded payloads.
 */
function parseDataUrl(url: string): ParsedDataUrl | null {
  if (!url.startsWith("data:")) return null;
  const rest = url.slice(5);
  const commaIdx = rest.indexOf(",");
  if (commaIdx === -1) return null;

  const header = rest.slice(0, commaIdx);
  const body = rest.slice(commaIdx + 1);

  const parts = header.split(";");
  const mime = (parts[0] || "text/plain").toLowerCase().trim();
  const isBase64 = parts.some((p) => p.trim() === "base64");
  const charsetPart = parts.find((p) => p.trim().startsWith("charset="));
  const charset = charsetPart?.split("=")[1]?.trim();

  let payload: Buffer;
  if (isBase64) {
    payload = Buffer.from(body, "base64");
  } else {
    // url-encoded
    let decoded: string;
    try {
      decoded = decodeURIComponent(body);
    } catch (err) {
      throw new FormaError("ARTIFACT_INVALID_INPUT", `Malformed url-encoded data: URL payload (${mime})`, {
        mime,
        cause: String(err),
      });
    }
    payload = Buffer.from(decoded, "utf8");
  }

  return { mime, charset, isBase64, payload };
}

/** Returns ext from mime; fallback to 'bin' */
function mimeToExt(mime: string): string {
  return MIME_TO_EXT[mime] ?? mime.split("/")[1]?.replace(/[^a-z0-9]/g, "") ?? "bin";
}

/** Throw ARTIFACT_REMOTE_RESOURCE for http(s): and protocol-relative (//...) URLs */
function rejectRemote(url: string): void {
  const trimmed = url.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("//")) {
    throw new FormaError("ARTIFACT_REMOTE_RESOURCE", `Remote resource references are not allowed: ${trimmed}`, {
      url: trimmed,
    });
  }
}

// ─── forma-image:// resolution (SPEC-BEHAVIOR-004) ────────────────────────────

const FORMA_IMAGE_SCHEME = "forma-image:";

/** True for any `forma-image:` reference (staging uuid or brand asset). */
function isFormaImageRef(url: string): boolean {
  return url.trim().startsWith(FORMA_IMAGE_SCHEME);
}

/** sharp output format → MIME used by the data: localization flow. */
const SHARP_FORMAT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
};

/**
 * Resolves a `forma-image:` reference to a ParsedDataUrl so it can re-use the
 * exact same localization path a data: image takes (down-sampling, dedup,
 * budgets, manifest accounting). The MIME is derived from the resolved bytes via
 * sharp so the canonical extension matches the actual format.
 *
 * Fails loud:
 *   - no resolver configured ⇒ MEDIA_IMAGE_NOT_FOUND (details.reason="no_resolver")
 *   - resolver rejection (unknown id / traversal / brand missing) propagates as-is
 *   - unreadable / unsupported bytes ⇒ the sharp-failure wrap (ARTIFACT_INVALID_INPUT)
 */
async function resolveFormaImageRef(url: string, ctx: Context): Promise<ParsedDataUrl> {
  const ref = url.trim();
  if (!ctx.resolveFormaImage) {
    throw new FormaError("MEDIA_IMAGE_NOT_FOUND", `No forma-image resolver available for reference: ${ref}`, {
      ref,
      reason: "no_resolver",
    });
  }

  const payload = await ctx.resolveFormaImage(ref);

  let format: string | undefined;
  try {
    format = (await sharp(payload, { limitInputPixels: SHARP_PIXEL_LIMIT }).metadata()).format;
  } catch (err) {
    throw new FormaError("ARTIFACT_INVALID_INPUT", "Raster image metadata read failed", {
      budget: "SHARP_PIXEL_LIMIT",
      cause: String(err),
    });
  }
  const mime = (format && SHARP_FORMAT_TO_MIME[format]) ?? "application/octet-stream";

  return { mime, isBase64: true, payload };
}

/**
 * Classifies one reference value the pipeline encounters at a localization
 * surface (img src/poster/href, link href, srcset candidate, css url()):
 *   - http(s) / protocol-relative ⇒ throws ARTIFACT_REMOTE_RESOURCE
 *   - forma-image: ⇒ resolves to bytes (or fails loud) and returns a ParsedDataUrl
 *   - data: ⇒ returns the parsed data url
 *   - anything else (relative/absolute local path) ⇒ returns null (left as-is)
 */
async function classifyLocalizableRef(url: string, ctx: Context): Promise<ParsedDataUrl | null> {
  if (isFormaImageRef(url)) {
    return resolveFormaImageRef(url, ctx);
  }
  rejectRemote(url);
  return parseDataUrl(url);
}

// ─── Raster down-sampling ─────────────────────────────────────────────────────

/**
 * Resize one density tier with the decode pixel ceiling. All sharp errors are
 * tagged with the SHARP_PIXEL_LIMIT budget; details.cause carries the original
 * message for disambiguation (corrupt input vs. genuine pixel-limit overflow).
 */
async function resizeTier(master: Buffer, width: number): Promise<Buffer> {
  try {
    return await sharp(master, { limitInputPixels: SHARP_PIXEL_LIMIT }).resize({ width }).toBuffer();
  } catch (err) {
    throw new FormaError("ARTIFACT_INVALID_INPUT", "Raster image processing failed", {
      budget: "SHARP_PIXEL_LIMIT",
      cause: String(err),
    });
  }
}

interface DensityTier {
  label: string;
  density: number;
  buffer: Buffer;
}

/**
 * Produces 3 density tiers (@1x/@2x/@3x) for a raster image. The master is
 * treated as the @3x tier and is never upscaled.
 *
 * `degraded` is set true whenever a tier cannot be genuinely downsampled because
 * the rounded target width collapses to the master width (tiny masters). In that
 * case the tier reuses the master bytes, so the density metadata is not honest —
 * consumers should treat the extra tiers as duplicates.
 */
async function downsampleRaster(
  master: Buffer,
  masterWidth: number,
): Promise<{ tiers: DensityTier[]; degraded: boolean }> {
  const w1x = Math.round(masterWidth / 3);
  const w2x = Math.round((masterWidth * 2) / 3);

  const tiers: DensityTier[] = [];
  let degraded = false;

  // @3x = master as-is
  tiers.push({ label: "3x", density: 3, buffer: master });

  // @2x: genuine downsample only when strictly smaller than master; otherwise the
  // width collapsed (tiny master) — reuse master bytes and mark degraded.
  if (w2x > 0 && w2x < masterWidth) {
    const buf = await resizeTier(master, w2x);
    tiers.push({ label: "2x", density: 2, buffer: buf });
  } else {
    tiers.push({ label: "2x", density: 2, buffer: master });
    degraded = true;
  }

  // @1x: always emit. Genuine downsample only when strictly smaller than master;
  // otherwise reuse master bytes (never upscale) and mark degraded.
  if (w1x > 0 && w1x < masterWidth) {
    const buf = await resizeTier(master, w1x);
    tiers.push({ label: "1x", density: 1, buffer: buf });
  } else {
    tiers.push({ label: "1x", density: 1, buffer: master });
    degraded = true;
  }

  // Sort ascending by density
  tiers.sort((a, b) => a.density - b.density);

  return { tiers, degraded };
}

// ─── CSS localization ─────────────────────────────────────────────────────────

/**
 * Walk a CSS text for url(...) and @import url(...) references.
 * - data: → localize
 * - http(s): → reject
 * Returns rewritten CSS.
 */
async function localizeCssText(css: string, ctx: Context): Promise<string> {
  // Process @import url(...) and url(...) patterns
  // Match both single/double quoted and unquoted urls
  const URL_PATTERN = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/g;
  // Also match bare @import "..." / @import '...' (any target; rejectRemote handles
  // http(s) AND protocol-relative //). Local bare imports pass through unchanged.
  const IMPORT_PATTERN = /@import\s+(['"])([^'"]+)\1/g;

  // Check @import bare strings first (reject remote, incl. protocol-relative //)
  let importMatch: RegExpExecArray | null;
  while ((importMatch = IMPORT_PATTERN.exec(css)) !== null) {
    rejectRemote(importMatch[2]);
  }

  // Process url() references
  const replacements: Array<{ start: number; end: number; replacement: string }> = [];
  let m: RegExpExecArray | null;
  URL_PATTERN.lastIndex = 0;
  while ((m = URL_PATTERN.exec(css)) !== null) {
    const url = m[2].trim();

    const parsed = await classifyLocalizableRef(url, ctx);
    if (!parsed) continue; // relative local ref, leave as-is

    const localPath = await localizeDataUrl(parsed, ctx);
    const replacement = `url('${localPath}')`;
    replacements.push({ start: m.index, end: m.index + m[0].length, replacement });
  }

  // Apply replacements in reverse order to preserve indices
  let result = css;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { start, end, replacement } = replacements[i];
    result = result.slice(0, start) + replacement + result.slice(end);
  }
  return result;
}

// ─── Core: localize a single parsed data: URL ─────────────────────────────────

/**
 * Localizes one data: URL payload.
 * - Rasters: writes 3 density tiers, returns the @1x path
 * - SVG/font/CSS: writes a single file, returns its path
 * Records asset entries and files into ctx.
 */
async function localizeDataUrl(parsed: ParsedDataUrl, ctx: Context): Promise<string> {
  const { mime, payload } = parsed;
  const ext = mimeToExt(mime);
  const hash = contentHash(payload);

  if (RASTER_MIMES.has(mime)) {
    // Check if already processed (dedup by hash)
    const canonical1x = `${ctx.assetDir}/${hash}@1x.${ext}`;
    if (ctx.files.has(canonical1x)) {
      // Already registered — return canonical
      return canonical1x;
    }

    // Get master width
    let meta: import("sharp").Metadata;
    try {
      meta = await sharp(payload, { limitInputPixels: SHARP_PIXEL_LIMIT }).metadata();
    } catch (err) {
      throw new FormaError("ARTIFACT_INVALID_INPUT", "Raster image metadata read failed", {
        budget: "SHARP_PIXEL_LIMIT",
        cause: String(err),
      });
    }
    const masterWidth = meta.width ?? 1;

    const { tiers, degraded } = await downsampleRaster(payload, masterWidth);

    // Write each tier
    for (const tier of tiers) {
      const path = `${ctx.assetDir}/${hash}@${tier.label}.${ext}`;
      ctx.files.set(path, tier.buffer);
    }

    // Find @1x tier for the canonical path
    const tier1x = tiers.find((t) => t.density === 1);
    const path1x = tier1x ? `${ctx.assetDir}/${hash}@1x.${ext}` : `${ctx.assetDir}/${hash}@${tiers[0].label}.${ext}`;

    const densities = tiers.map((t) => t.density).sort((a, b) => a - b);

    if (!ctx.assets.has(path1x)) {
      ctx.assets.set(path1x, {
        path: path1x,
        density: densities,
        role: "image",
        ...(degraded ? { degraded: true } : {}),
      });
    }

    return path1x;
  }

  if (mime === "image/svg+xml") {
    const path = `${ctx.assetDir}/${hash}.svg`;
    if (!ctx.files.has(path)) {
      ctx.files.set(path, payload);
      ctx.assets.set(path, { path, density: [1], role: "image" });
    }
    return path;
  }

  if (mime === "text/css") {
    const path = `${ctx.assetDir}/${hash}.css`;
    if (!ctx.files.has(path)) {
      // Recursively localize inner CSS references
      const cssText = payload.toString("utf8");
      const localizedCss = await localizeCssText(cssText, ctx);
      const finalBuf = Buffer.from(localizedCss, "utf8");
      ctx.files.set(path, finalBuf);
      ctx.assets.set(path, { path, density: [1], role: "stylesheet" });
    }
    return path;
  }

  // Font or other binary
  if (mime.startsWith("font/") || mime.startsWith("application/font") || mime === "application/octet-stream") {
    const path = `${ctx.assetDir}/${hash}.${ext}`;
    if (!ctx.files.has(path)) {
      ctx.files.set(path, payload);
      ctx.assets.set(path, { path, density: [1], role: "font" });
    }
    return path;
  }

  // Fallback: write as binary
  const path = `${ctx.assetDir}/${hash}.${ext}`;
  if (!ctx.files.has(path)) {
    ctx.files.set(path, payload);
    ctx.assets.set(path, { path, density: [1], role: "resource" });
  }
  return path;
}

// ─── Srcset rewriting helpers ─────────────────────────────────────────────────

/**
 * For raster data: images, rewrites to srcset with all density tiers.
 * Returns { src, srcset } strings.
 */
async function buildSrcset(parsed: ParsedDataUrl, ctx: Context): Promise<{ src: string; srcset: string }> {
  const { mime, payload } = parsed;
  const ext = mimeToExt(mime);
  const hash = contentHash(payload);

  if (!RASTER_MIMES.has(mime)) {
    // Non-raster: simple path
    const path = await localizeDataUrl(parsed, ctx);
    return { src: path, srcset: "" };
  }

  // Ensure localized (may have been deduped already)
  await localizeDataUrl(parsed, ctx);

  const canonical1x = `${ctx.assetDir}/${hash}@1x.${ext}`;
  const assetEntry = ctx.assets.get(canonical1x);
  if (!assetEntry) {
    const path = canonical1x;
    return { src: path, srcset: "" };
  }

  const densities = assetEntry.density;
  const srcsetParts = densities.map((d) => `${ctx.assetDir}/${hash}@${d}x.${ext} ${d}x`);
  return { src: canonical1x, srcset: srcsetParts.join(", ") };
}

// ─── Srcset attribute parsing ─────────────────────────────────────────────────

/**
 * Parse a srcset attribute into candidates. Follows the WHATWG rule that a URL
 * is a run of non-whitespace characters, so a comma inside a data: URL
 * (e.g. `data:image/png;base64,AAAA`) is part of the URL and not a candidate
 * separator. A naive `split(',')` corrupts such URLs.
 */
function parseSrcsetCandidates(srcset: string): Array<{ url: string; descriptor: string }> {
  const candidates: Array<{ url: string; descriptor: string }> = [];
  const n = srcset.length;
  let i = 0;
  while (i < n) {
    // Skip leading whitespace and stray commas between candidates
    while (i < n && (/\s/.test(srcset[i]) || srcset[i] === ",")) i++;
    if (i >= n) break;

    // URL = run of non-whitespace characters
    const urlStart = i;
    while (i < n && !/\s/.test(srcset[i])) i++;
    let url = srcset.slice(urlStart, i);
    let descriptor = "";

    if (url.endsWith(",")) {
      // Trailing comma(s) terminate the candidate with no descriptor
      url = url.replace(/,+$/, "");
    } else {
      // Skip whitespace, then collect the descriptor up to the next comma
      while (i < n && /\s/.test(srcset[i])) i++;
      const descStart = i;
      while (i < n && srcset[i] !== ",") i++;
      descriptor = srcset.slice(descStart, i).trim();
      if (i < n && srcset[i] === ",") i++; // consume the separator
    }

    if (url.length > 0) {
      candidates.push({ url, descriptor });
    }
  }
  return candidates;
}

/** Density from a srcset descriptor: "2x" → 2, "1.5x" → 1.5, "300w"/"" → undefined. */
function parseDescriptorDensity(descriptor: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)x$/.exec(descriptor.trim());
  return match ? Number(match[1]) : undefined;
}

/**
 * Localize a raster data: URL that already carries an explicit srcset descriptor.
 * Unlike `localizeDataUrl`/`buildSrcset`, this stores the provided image as a
 * single file at face value (no down-sampling, no fabricated density tiers) so
 * the candidate's descriptor (e.g. "2x") keeps pointing at the exact pixels the
 * author supplied instead of mislabeling a down-sampled @1x file.
 */
async function localizeRasterSingle(parsed: ParsedDataUrl, ctx: Context, density: number): Promise<string> {
  const { mime, payload } = parsed;
  const ext = mimeToExt(mime);
  const hash = contentHash(payload);
  const path = `${ctx.assetDir}/${hash}.${ext}`;

  if (!ctx.files.has(path)) {
    try {
      await sharp(payload, { limitInputPixels: SHARP_PIXEL_LIMIT }).metadata();
    } catch (err) {
      throw new FormaError("ARTIFACT_INVALID_INPUT", "Raster image metadata read failed", {
        budget: "SHARP_PIXEL_LIMIT",
        cause: String(err),
      });
    }
    ctx.files.set(path, payload);
  }
  const existing = ctx.assets.get(path);
  if (existing) {
    if (!existing.density.includes(density)) {
      existing.density = [...existing.density, density].sort((a, b) => a - b);
    }
  } else {
    ctx.assets.set(path, { path, density: [density], role: "image" });
  }
  return path;
}

// ─── Main localization walk ───────────────────────────────────────────────────

export async function localizeArtifactCss(
  css: string,
  assetDirName = "assets",
  resolveFormaImage?: ResolveFormaImage,
): Promise<LocalizeCssResult> {
  const ctx: Context = {
    assetDir: assetDirName,
    files: new Map(),
    assets: new Map(),
    ...(resolveFormaImage ? { resolveFormaImage } : {}),
  };
  const localizedCss = await localizeCssText(css, ctx);
  assertArtifactAssetBudgets(ctx.files);
  return {
    css: localizedCss,
    files: ctx.files,
    assets: Array.from(ctx.assets.values()),
  };
}

export async function localizeArtifactAssets(input: LocalizeInput): Promise<LocalizeResult> {
  const { html, assetDirName = "assets", resolveFormaImage } = input;

  const htmlBytes = Buffer.byteLength(html, "utf8");
  if (htmlBytes > MAX_HTML_BYTES) {
    throw new FormaError("ARTIFACT_INVALID_INPUT", `HTML exceeds the ${MAX_HTML_BYTES}-byte budget`, {
      budget: "MAX_HTML_BYTES",
      limit: MAX_HTML_BYTES,
      actual: htmlBytes,
    });
  }

  const ctx: Context = {
    assetDir: assetDirName,
    files: new Map(),
    assets: new Map(),
    ...(resolveFormaImage ? { resolveFormaImage } : {}),
  };

  const root = parse(html, { comment: true });

  // ── 1. Walk <img>, <source>, <image> for src / srcset / href / xlink:href ──

  const mediaTags = root.querySelectorAll("img, source, image");
  for (const el of mediaTags) {
    // src attribute
    const src = el.getAttribute("src");
    if (src) {
      const parsed = await classifyLocalizableRef(src, ctx);
      if (parsed) {
        if (RASTER_MIMES.has(parsed.mime)) {
          const { src: newSrc, srcset } = await buildSrcset(parsed, ctx);
          el.setAttribute("src", newSrc);
          el.setAttribute("srcset", srcset);
        } else {
          const path = await localizeDataUrl(parsed, ctx);
          el.setAttribute("src", path);
        }
      }
    }

    // srcset attribute
    const srcset = el.getAttribute("srcset");
    if (srcset) {
      const candidates = parseSrcsetCandidates(srcset);
      const newParts: string[] = [];
      let changed = false;
      for (const { url, descriptor } of candidates) {
        const parsed = await classifyLocalizableRef(url, ctx);
        if (parsed) {
          // Store the candidate at its declared density (default 1x) so the
          // descriptor keeps pointing at the exact image the author provided.
          const path = RASTER_MIMES.has(parsed.mime)
            ? await localizeRasterSingle(parsed, ctx, parseDescriptorDensity(descriptor) ?? 1)
            : await localizeDataUrl(parsed, ctx);
          newParts.push(descriptor ? `${path} ${descriptor}` : path);
          changed = true;
        } else {
          newParts.push(descriptor ? `${url} ${descriptor}` : url);
        }
      }
      if (changed) {
        el.setAttribute("srcset", newParts.join(", "));
      }
    }

    // poster attribute
    const poster = el.getAttribute("poster");
    if (poster) {
      const parsed = await classifyLocalizableRef(poster, ctx);
      if (parsed) {
        const path = await localizeDataUrl(parsed, ctx);
        el.setAttribute("poster", path);
      }
    }

    // href / xlink:href (for <image> SVG elements)
    for (const hrefAttr of ["href", "xlink:href"]) {
      const href = el.getAttribute(hrefAttr);
      if (href) {
        const parsed = await classifyLocalizableRef(href, ctx);
        if (parsed) {
          if (RASTER_MIMES.has(parsed.mime)) {
            const { src: newSrc, srcset } = await buildSrcset(parsed, ctx);
            el.setAttribute(hrefAttr, newSrc);
            el.setAttribute("srcset", srcset);
          } else {
            const path = await localizeDataUrl(parsed, ctx);
            el.setAttribute(hrefAttr, path);
          }
        }
      }
    }
  }

  // ── 2. Walk <link href> ────────────────────────────────────────────────────

  const links = root.querySelectorAll("link");
  for (const el of links) {
    const href = el.getAttribute("href");
    if (href) {
      const parsed = await classifyLocalizableRef(href, ctx);
      if (parsed) {
        const path = await localizeDataUrl(parsed, ctx);
        el.setAttribute("href", path);
      }
    }
  }

  // ── 3. Walk <video poster> ─────────────────────────────────────────────────

  const videos = root.querySelectorAll("video");
  for (const el of videos) {
    const poster = el.getAttribute("poster");
    if (poster) {
      const parsed = await classifyLocalizableRef(poster, ctx);
      if (parsed) {
        const path = await localizeDataUrl(parsed, ctx);
        el.setAttribute("poster", path);
      }
    }
  }

  // ── 4. Walk inline <style> blocks ─────────────────────────────────────────

  const styles = root.querySelectorAll("style");
  for (const el of styles) {
    const cssText = el.text;
    if (cssText) {
      const localized = await localizeCssText(cssText, ctx);
      if (localized !== cssText) {
        el.set_content(localized);
      }
    }
  }

  // ── 5. Walk style="..." attributes on all elements ────────────────────────

  const allElements = root.querySelectorAll("*");
  for (const el of allElements) {
    const style = el.getAttribute("style");
    if (style && (style.includes("url(") || style.includes("data:"))) {
      const localized = await localizeCssText(style, ctx);
      if (localized !== style) {
        el.setAttribute("style", localized);
      }
    }
  }

  assertArtifactAssetBudgets(ctx.files);

  return {
    html: root.toString(),
    files: ctx.files,
    assets: Array.from(ctx.assets.values()),
  };
}
