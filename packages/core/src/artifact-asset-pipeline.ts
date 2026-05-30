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
 */

import { createHash } from 'node:crypto';
import { parse } from 'node-html-parser';
import sharp from 'sharp';
import type { ArtifactAssetEntry } from './artifact-manifest.js';
import { FormaError } from './errors.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface LocalizeInput {
  html: string;
  /** default 'assets' */
  assetDirName?: string;
}

export interface LocalizeResult {
  html: string;
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
}

// ─── MIME → extension table ───────────────────────────────────────────────────

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'text/css': 'css',
  'application/font-woff': 'woff',
  'application/font-woff2': 'woff2',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'application/font-ttf': 'ttf',
  'application/font-otf': 'otf',
  'application/octet-stream': 'bin',
};

const RASTER_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** sha256(payload).slice(0,16) hex */
function contentHash(payload: Buffer): string {
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
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
  if (!url.startsWith('data:')) return null;
  const rest = url.slice(5);
  const commaIdx = rest.indexOf(',');
  if (commaIdx === -1) return null;

  const header = rest.slice(0, commaIdx);
  const body = rest.slice(commaIdx + 1);

  const parts = header.split(';');
  const mime = (parts[0] || 'text/plain').toLowerCase().trim();
  const isBase64 = parts.some((p) => p.trim() === 'base64');
  const charsetPart = parts.find((p) => p.trim().startsWith('charset='));
  const charset = charsetPart?.split('=')[1]?.trim();

  let payload: Buffer;
  if (isBase64) {
    payload = Buffer.from(body, 'base64');
  } else {
    // url-encoded
    payload = Buffer.from(decodeURIComponent(body), 'utf8');
  }

  return { mime, charset, isBase64, payload };
}

/** Returns ext from mime; fallback to 'bin' */
function mimeToExt(mime: string): string {
  return MIME_TO_EXT[mime] ?? mime.split('/')[1]?.replace(/[^a-z0-9]/g, '') ?? 'bin';
}

/** Throw ARTIFACT_REMOTE_RESOURCE for http(s): and protocol-relative (//...) URLs */
function rejectRemote(url: string): void {
  const trimmed = url.trim();
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('//')
  ) {
    throw new FormaError(
      'ARTIFACT_REMOTE_RESOURCE',
      `Remote resource references are not allowed: ${trimmed}`,
      { url: trimmed },
    );
  }
}

// ─── Raster down-sampling ─────────────────────────────────────────────────────

interface DensityTier {
  label: string;
  density: number;
  buffer: Buffer;
}

/**
 * Produces up to 3 density tiers for a raster image.
 * Never upscales — if masterWidth < 3, emits only achievable tiers and sets degraded=true.
 */
async function downsampleRaster(
  master: Buffer,
  masterWidth: number,
): Promise<{ tiers: DensityTier[]; degraded: boolean }> {
  const w1x = Math.round(masterWidth / 3);
  const w2x = Math.round((masterWidth * 2) / 3);

  const tiers: DensityTier[] = [];

  // @3x = master as-is
  tiers.push({ label: '3x', density: 3, buffer: master });

  // @2x: only if w2x < masterWidth (always true when masterWidth > 1) and w2x > 0
  if (w2x > 0 && w2x < masterWidth) {
    const buf = await sharp(master).resize({ width: w2x }).toBuffer();
    tiers.push({ label: '2x', density: 2, buffer: buf });
  } else if (w2x === masterWidth && masterWidth > 0) {
    // same size, just reference master
    tiers.push({ label: '2x', density: 2, buffer: master });
  }

  // @1x: always emit (never upscale — reuse master if w1x rounds to 0 or equals masterWidth)
  if (w1x > 0 && w1x < masterWidth) {
    const buf = await sharp(master).resize({ width: w1x }).toBuffer();
    tiers.push({ label: '1x', density: 1, buffer: buf });
  } else {
    // w1x === 0 (tiny image) or w1x === masterWidth: reuse master bytes as @1x
    tiers.push({ label: '1x', density: 1, buffer: master });
  }

  // Sort ascending by density so we can assess degraded
  tiers.sort((a, b) => a.density - b.density);

  const degraded = tiers.length < 3;
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
    rejectRemote(url);

    const parsed = parseDataUrl(url);
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
    const meta = await sharp(payload).metadata();
    const masterWidth = meta.width ?? 1;

    const { tiers, degraded } = await downsampleRaster(payload, masterWidth);

    // Write each tier
    for (const tier of tiers) {
      const path = `${ctx.assetDir}/${hash}@${tier.label}.${ext}`;
      ctx.files.set(path, tier.buffer);
    }

    // Find @1x tier for the canonical path
    const tier1x = tiers.find((t) => t.density === 1);
    const path1x = tier1x
      ? `${ctx.assetDir}/${hash}@1x.${ext}`
      : `${ctx.assetDir}/${hash}@${tiers[0].label}.${ext}`;

    const densities = tiers.map((t) => t.density).sort((a, b) => a - b);

    if (!ctx.assets.has(path1x)) {
      ctx.assets.set(path1x, {
        path: path1x,
        density: densities,
        role: 'image',
        ...(degraded ? { degraded: true } : {}),
      });
    }

    return path1x;
  }

  if (mime === 'image/svg+xml') {
    const path = `${ctx.assetDir}/${hash}.svg`;
    if (!ctx.files.has(path)) {
      ctx.files.set(path, payload);
      ctx.assets.set(path, { path, density: [1], role: 'image' });
    }
    return path;
  }

  if (mime === 'text/css') {
    const path = `${ctx.assetDir}/${hash}.css`;
    if (!ctx.files.has(path)) {
      // Recursively localize inner CSS references
      const cssText = payload.toString('utf8');
      const localizedCss = await localizeCssText(cssText, ctx);
      const finalBuf = Buffer.from(localizedCss, 'utf8');
      ctx.files.set(path, finalBuf);
      ctx.assets.set(path, { path, density: [1], role: 'stylesheet' });
    }
    return path;
  }

  // Font or other binary
  if (
    mime.startsWith('font/') ||
    mime.startsWith('application/font') ||
    mime === 'application/octet-stream'
  ) {
    const path = `${ctx.assetDir}/${hash}.${ext}`;
    if (!ctx.files.has(path)) {
      ctx.files.set(path, payload);
      ctx.assets.set(path, { path, density: [1], role: 'font' });
    }
    return path;
  }

  // Fallback: write as binary
  const path = `${ctx.assetDir}/${hash}.${ext}`;
  if (!ctx.files.has(path)) {
    ctx.files.set(path, payload);
    ctx.assets.set(path, { path, density: [1], role: 'resource' });
  }
  return path;
}

// ─── Srcset rewriting helpers ─────────────────────────────────────────────────

/**
 * For raster data: images, rewrites to srcset with all density tiers.
 * Returns { src, srcset } strings.
 */
async function buildSrcset(
  parsed: ParsedDataUrl,
  ctx: Context,
): Promise<{ src: string; srcset: string }> {
  const { mime, payload } = parsed;
  const ext = mimeToExt(mime);
  const hash = contentHash(payload);

  if (!RASTER_MIMES.has(mime)) {
    // Non-raster: simple path
    const path = await localizeDataUrl(parsed, ctx);
    return { src: path, srcset: '' };
  }

  // Ensure localized (may have been deduped already)
  await localizeDataUrl(parsed, ctx);

  const canonical1x = `${ctx.assetDir}/${hash}@1x.${ext}`;
  const assetEntry = ctx.assets.get(canonical1x);
  if (!assetEntry) {
    const path = canonical1x;
    return { src: path, srcset: '' };
  }

  const densities = assetEntry.density;
  const srcsetParts = densities.map((d) => `${ctx.assetDir}/${hash}@${d}x.${ext} ${d}x`);
  return { src: canonical1x, srcset: srcsetParts.join(', ') };
}

// ─── Srcset attribute parsing ─────────────────────────────────────────────────

/** Extract individual URLs from a srcset attribute value */
function parseSrcsetUrls(srcset: string): string[] {
  // srcset = "url 2x, url2 1x" or just "url"
  return srcset
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

// ─── Main localization walk ───────────────────────────────────────────────────

export async function localizeArtifactAssets(input: LocalizeInput): Promise<LocalizeResult> {
  const { html, assetDirName = 'assets' } = input;

  const ctx: Context = {
    assetDir: assetDirName,
    files: new Map(),
    assets: new Map(),
  };

  const root = parse(html, { comment: true });

  // ── 1. Walk <img>, <source>, <image> for src / srcset / href / xlink:href ──

  const mediaTags = root.querySelectorAll('img, source, image');
  for (const el of mediaTags) {
    // src attribute
    const src = el.getAttribute('src');
    if (src) {
      rejectRemote(src);
      const parsed = parseDataUrl(src);
      if (parsed) {
        if (RASTER_MIMES.has(parsed.mime)) {
          const { src: newSrc, srcset } = await buildSrcset(parsed, ctx);
          el.setAttribute('src', newSrc);
          el.setAttribute('srcset', srcset);
        } else {
          const path = await localizeDataUrl(parsed, ctx);
          el.setAttribute('src', path);
        }
      }
    }

    // srcset attribute
    const srcset = el.getAttribute('srcset');
    if (srcset) {
      const urls = parseSrcsetUrls(srcset);
      const newParts: string[] = [];
      let changed = false;
      const parts = srcset.split(',');
      for (const part of parts) {
        const trimmed = part.trim();
        const spaceIdx = trimmed.lastIndexOf(' ');
        const urlPart = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
        const descriptor = spaceIdx > 0 ? trimmed.slice(spaceIdx) : '';
        rejectRemote(urlPart);
        const parsed = parseDataUrl(urlPart);
        if (parsed) {
          const path = await localizeDataUrl(parsed, ctx);
          newParts.push(`${path}${descriptor}`);
          changed = true;
        } else {
          newParts.push(trimmed);
        }
      }
      if (changed) {
        el.setAttribute('srcset', newParts.join(', '));
      }
      void urls; // suppressed unused warning
    }

    // poster attribute
    const poster = el.getAttribute('poster');
    if (poster) {
      rejectRemote(poster);
      const parsed = parseDataUrl(poster);
      if (parsed) {
        const path = await localizeDataUrl(parsed, ctx);
        el.setAttribute('poster', path);
      }
    }

    // href / xlink:href (for <image> SVG elements)
    for (const hrefAttr of ['href', 'xlink:href']) {
      const href = el.getAttribute(hrefAttr);
      if (href) {
        rejectRemote(href);
        const parsed = parseDataUrl(href);
        if (parsed) {
          if (RASTER_MIMES.has(parsed.mime)) {
            const { src: newSrc, srcset } = await buildSrcset(parsed, ctx);
            el.setAttribute(hrefAttr, newSrc);
            el.setAttribute('srcset', srcset);
          } else {
            const path = await localizeDataUrl(parsed, ctx);
            el.setAttribute(hrefAttr, path);
          }
        }
      }
    }
  }

  // ── 2. Walk <link href> ────────────────────────────────────────────────────

  const links = root.querySelectorAll('link');
  for (const el of links) {
    const href = el.getAttribute('href');
    if (href) {
      rejectRemote(href);
      const parsed = parseDataUrl(href);
      if (parsed) {
        const path = await localizeDataUrl(parsed, ctx);
        el.setAttribute('href', path);
      }
    }
  }

  // ── 3. Walk <video poster> ─────────────────────────────────────────────────

  const videos = root.querySelectorAll('video');
  for (const el of videos) {
    const poster = el.getAttribute('poster');
    if (poster) {
      rejectRemote(poster);
      const parsed = parseDataUrl(poster);
      if (parsed) {
        const path = await localizeDataUrl(parsed, ctx);
        el.setAttribute('poster', path);
      }
    }
  }

  // ── 4. Walk inline <style> blocks ─────────────────────────────────────────

  const styles = root.querySelectorAll('style');
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

  const allElements = root.querySelectorAll('*');
  for (const el of allElements) {
    const style = el.getAttribute('style');
    if (style && (style.includes('url(') || style.includes('data:'))) {
      const localized = await localizeCssText(style, ctx);
      if (localized !== style) {
        el.setAttribute('style', localized);
      }
    }
  }

  return {
    html: root.toString(),
    files: ctx.files,
    assets: Array.from(ctx.assets.values()),
  };
}
