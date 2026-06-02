/**
 * artifact-icon-extraction.ts
 *
 * Extracts inline <svg> elements from static HTML, validates each one for
 * safety, and produces:
 *   - A Map<string, Buffer> of relative file paths under icons/ → content.
 *   - An IconManifest with per-icon metadata including density PNG paths.
 *
 * No disk writes. A later task wires this to disk.
 */

import { createHash } from "node:crypto";
import { PuppeteerParser } from "@vzi-core/parser";
import { parse, type HTMLElement } from "node-html-parser";
import sharp from "sharp";
import { FormaError } from "./errors.js";
import { scanSvg } from "./artifact-static-validation.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type IconGeneratedFrom = "requirement-archive" | "manual-export";

export interface IconExtractionMetadata {
  artifactId: string;
  productId: string;
  requirementId: string;
  pageId: string;
  version: string;
  generatedFrom: IconGeneratedFrom;
}

export interface IconExtractionOptions {
  /** Density multipliers. Default [1, 2, 3]. */
  densities?: number[];
  /**
   * When set, filters SVG occurrences through the same browser-computed
   * visibility source used by VZI capture.
   */
  computedVisibility?: {
    viewportWidth: number;
    viewportHeight: number;
    baseUrl?: string;
  };
}

export interface IconEntry {
  /** Unique identifier = slug + hash (or fallback name + hash). */
  id: string;
  /** Slug-safe name derived from the first occurrence label or fallback. */
  name: string;
  /** SVG content hash used for dedupe and VZI occurrence matching. */
  contentHash: string;
  size: { w: number; h: number };
  usesCurrentColor: boolean;
  /** Source-order index of the first occurrence of this unique SVG content. */
  sourceOrderFirst: number;
  /** Source-order indexes for every occurrence of this unique SVG content. */
  sourceOrders: number[];
  files: {
    svg: string; // relative path, e.g. icons/<name>.svg
    png: Record<string, string>; // "1x" | "2x" | "3x" → relative path
  };
}

export interface IconInstance {
  sourceOrder: number;
  iconId: string;
  contentHash: string;
}

export interface IconManifest {
  // Top-level metadata
  schemaVersion: 1;
  artifactId: string;
  productId: string;
  requirementId: string;
  pageId: string;
  version: string;
  sourceVersion: string;
  generatedFrom: IconGeneratedFrom;
  generatedAt: string;
  densities: number[];
  icons: IconEntry[];
  instances: IconInstance[];
}

export interface IconExtractionResult {
  files: Map<string, Buffer>;
  manifest: IconManifest;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const ICON_SOURCE_ORDER_ATTR = "data-forma-icon-source-order";

/** sha256(payload).slice(0,16) hex — same scheme as artifact-asset-pipeline.ts */
function contentHash(payload: Buffer): string {
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Slugify a label for use as a file basename component.
 * Lowercases, replaces non-alphanumeric runs with hyphens, trims edges.
 */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Detect whether an SVG string uses the CSS keyword `currentColor`.
 * Checks attribute values and text content.
 */
function detectCurrentColor(svgText: string): boolean {
  return /currentColor/i.test(svgText);
}

/**
 * Parse SVG dimensions. Prefers width/height attributes; falls back to viewBox.
 * Returns { w: 0, h: 0 } if neither is available.
 */
function parseSvgSize(svgText: string): { w: number; h: number } {
  const root = parse(svgText, { comment: false });
  const svgEl = root.querySelector("svg");
  if (!svgEl) return { w: 0, h: 0 };

  const widthAttr = svgEl.getAttribute("width");
  const heightAttr = svgEl.getAttribute("height");

  // Only accept plain numbers or `Npx`; reject `%`, `em`, `rem`, `vw`, etc.
  const isPlainNumber = (s: string) => /^\s*\d+(\.\d+)?(px)?\s*$/.test(s);
  if (widthAttr && heightAttr && isPlainNumber(widthAttr) && isPlainNumber(heightAttr)) {
    const w = parseFloat(widthAttr);
    const h = parseFloat(heightAttr);
    if (!isNaN(w) && !isNaN(h)) return { w, h };
  }

  const viewBox = svgEl.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/);
    if (parts.length >= 4) {
      const w = parseFloat(parts[2]);
      const h = parseFloat(parts[3]);
      if (!isNaN(w) && !isNaN(h)) return { w, h };
    }
  }

  return { w: 0, h: 0 };
}

function readAriaLabel(el: HTMLElement): string | undefined {
  const label = el.getAttribute("aria-label");
  if (label?.trim()) return label.trim();

  return undefined;
}

/**
 * Read accessible label from the SVG itself, then its direct parent.
 */
function findAriaLabel(svgEl: HTMLElement): string | undefined {
  const ownLabel = readAriaLabel(svgEl);
  if (ownLabel) return ownLabel;

  const parent = svgEl.parentNode;
  if (parent) return readAriaLabel(parent);

  return undefined;
}

function elementTagName(el: HTMLElement | undefined | null): string {
  return (el?.tagName ?? '').toLowerCase();
}

function parentElement(el: HTMLElement): HTMLElement | null {
  const parent = el.parentNode as HTMLElement | null | undefined;
  return parent && typeof parent.tagName === 'string' ? parent : null;
}

function styleDeclaresHidden(style: string | undefined): boolean {
  if (!style) return false;
  return /(?:^|;)\s*display\s*:\s*none\s*(?:;|$)/i.test(style) ||
    /(?:^|;)\s*visibility\s*:\s*hidden\s*(?:;|$)/i.test(style);
}

function classDeclaresHidden(className: string | undefined): boolean {
  return (className ?? '').split(/\s+/).includes('hidden');
}

function isInNonRenderedTree(el: HTMLElement): boolean {
  let current: HTMLElement | null = el;
  while (current) {
    if (elementTagName(current) === 'template') {
      return true;
    }
    if (current.hasAttribute('hidden')) {
      return true;
    }
    if (styleDeclaresHidden(current.getAttribute('style') ?? undefined)) {
      return true;
    }
    if (classDeclaresHidden(current.getAttribute('class') ?? undefined)) {
      return true;
    }
    current = parentElement(current);
  }
  return false;
}

function positiveNumericAttr(el: HTMLElement, attr: string): boolean {
  const value = el.getAttribute(attr);
  if (!value) return false;
  const numeric = parseFloat(value);
  return Number.isFinite(numeric) && numeric > 0;
}

function hasVziRenderableSvgPrimitive(svgEl: HTMLElement): boolean {
  if (svgEl.querySelectorAll('path').some((el) => (el.getAttribute('d') ?? '').trim().length > 0)) {
    return true;
  }
  if (svgEl.querySelectorAll('circle').some((el) => positiveNumericAttr(el, 'r'))) {
    return true;
  }
  if (svgEl.querySelectorAll('rect').some((el) =>
    positiveNumericAttr(el, 'width') && positiveNumericAttr(el, 'height')
  )) {
    return true;
  }
  return svgEl.querySelectorAll('polygon, polyline').some((el) =>
    (el.getAttribute('points') ?? '').trim().length > 0
  );
}

function isVziRenderableSvgOccurrence(svgEl: HTMLElement, svgText: string): boolean {
  if (isInNonRenderedTree(svgEl)) {
    return false;
  }
  const size = parseSvgSize(svgText);
  if (size.w <= 0 || size.h <= 0) {
    return false;
  }
  return hasVziRenderableSvgPrimitive(svgEl);
}

function assertSafeSvg(index: number, svgText: string): void {
  const svgViolations: string[] = [];
  scanSvg(`icon[${index}]`, svgText, svgViolations);
  if (svgViolations.length > 0) {
    throw new FormaError(
      "ARTIFACT_NOT_STATIC",
      `Unsafe SVG at icon index ${index}: ${svgViolations[0]}`,
      { index, violations: svgViolations },
    );
  }
}

function parseSourceOrder(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function collectComputedRenderableSvgSourceOrders(
  html: string,
  options: NonNullable<IconExtractionOptions["computedVisibility"]>,
): Promise<Set<number>> {
  const annotatedRoot = parse(html, { comment: true });
  const svgElements = annotatedRoot.querySelectorAll("svg");
  if (svgElements.length === 0) {
    return new Set();
  }

  for (let i = 0; i < svgElements.length; i++) {
    svgElements[i].setAttribute(ICON_SOURCE_ORDER_ATTR, String(i));
  }

  const parser = new PuppeteerParser({
    viewportWidth: options.viewportWidth,
    viewportHeight: options.viewportHeight,
    baseUrl: options.baseUrl,
    waitTime: 0,
    waitForPageReadyMarker: false,
    waitForFonts: false,
    waitForIconFonts: false,
    waitForImages: false,
    waitForStyleSheets: true,
    stabilityTime: 0,
  });

  try {
    const ir = await parser.parse(annotatedRoot.toString());
    const sourceOrders = new Set<number>();
    for (const element of Object.values(ir.elements)) {
      if (element.svgData === undefined) {
        continue;
      }
      const sourceOrder = parseSourceOrder(
        element.source?.dataAttributes?.[ICON_SOURCE_ORDER_ATTR],
      );
      if (sourceOrder !== undefined) {
        sourceOrders.add(sourceOrder);
      }
    }
    return sourceOrders;
  } finally {
    await parser.dispose().catch((disposeErr) => {
      console.warn(
        "[artifact-icon-extraction] PuppeteerParser.dispose() failed after computed visibility filtering:",
        disposeErr,
      );
    });
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Extracts all inline <svg> elements from `html`, validates each for safety,
 * optionally aligns occurrences with browser-computed VZI visibility, and
 * returns a set of icon files (SVG + density-tier PNGs) plus an IconManifest.
 *
 * @param html     - Full static HTML string.
 * @param metadata - Source identification attached to the manifest.
 * @param options  - Optional extraction settings (densities, etc.).
 */
export async function extractIconAssets(
  html: string,
  metadata: IconExtractionMetadata,
  options: IconExtractionOptions = {},
): Promise<IconExtractionResult> {
  const densities = options.densities ?? [1, 2, 3];
  const files = new Map<string, Buffer>();
  const icons: IconEntry[] = [];
  const instances: IconInstance[] = [];

  // Track which content hashes have already produced physical files
  const iconsByHash = new Map<string, IconEntry>();

  const root = parse(html, { comment: true });
  const svgElements = root.querySelectorAll("svg");

  for (let i = 0; i < svgElements.length; i++) {
    assertSafeSvg(i, svgElements[i].toString());
  }

  const computedRenderableSourceOrders = options.computedVisibility
    ? await collectComputedRenderableSvgSourceOrders(html, options.computedVisibility)
    : undefined;

  for (let i = 0; i < svgElements.length; i++) {
    const el = svgElements[i];
    const svgText = el.toString();

    if (computedRenderableSourceOrders && !computedRenderableSourceOrders.has(i)) {
      continue;
    }

    if (!isVziRenderableSvgOccurrence(el, svgText)) {
      continue;
    }

    const svgBuf = Buffer.from(svgText, "utf8");
    const hash = contentHash(svgBuf);

    // 2. Determine name
    const ariaLabel = findAriaLabel(el);
    const size = parseSvgSize(svgText);
    const slug = ariaLabel ? slugify(ariaLabel) : "";
    const iconName = slug || `icon-${i}-${size.w}x${size.h}`;
    const baseName = `${iconName}-${hash}`;

    const id = baseName;
    const usesCurrentColor = detectCurrentColor(svgText);

    // 3. Check for dedup
    let icon = iconsByHash.get(hash);

    if (!icon) {
      // Write physical SVG file
      const svgPath = `icons/${baseName}.svg`;
      files.set(svgPath, svgBuf);

      // Generate PNG tiers
      const pngPaths: Record<string, string> = {};
      const baseW = size.w > 0 ? size.w : 24;
      const baseH = size.h > 0 ? size.h : 24;

      for (const density of densities) {
        const targetW = Math.round(baseW * density);
        const targetH = Math.round(baseH * density);
        let pngBuf: Buffer;
        try {
          pngBuf = await sharp(svgBuf, { density: 96 * density })
            .resize({ width: targetW, height: targetH, fit: "fill" })
            .png()
            .toBuffer();
        } catch (e) {
          throw new FormaError(
            "ARTIFACT_INVALID_INPUT",
            `Failed to rasterize icon SVG at index ${i}: ${e instanceof Error ? e.message : String(e)}`,
            { index: i, sharpError: e instanceof Error ? e.message : String(e) },
          );
        }

        const densityKey = `${density}x`;
        const pngPath = `icons/${baseName}@${densityKey}.png`;
        files.set(pngPath, pngBuf);
        pngPaths[densityKey] = pngPath;
      }

      icon = {
        id,
        name: iconName,
        contentHash: hash,
        size,
        usesCurrentColor,
        sourceOrderFirst: i,
        sourceOrders: [i],
        files: {
          svg: svgPath,
          png: pngPaths,
        },
      };
      iconsByHash.set(hash, icon);
      icons.push(icon);
    } else {
      icon.sourceOrders.push(i);
    }

    instances.push({
      sourceOrder: i,
      iconId: icon.id,
      contentHash: hash,
    });
  }

  const manifest: IconManifest = {
    schemaVersion: 1,
    artifactId: metadata.artifactId,
    productId: metadata.productId,
    requirementId: metadata.requirementId,
    pageId: metadata.pageId,
    version: metadata.version,
    sourceVersion: metadata.version,
    generatedFrom: metadata.generatedFrom,
    generatedAt: new Date().toISOString(),
    densities,
    icons,
    instances,
  };

  return { files, manifest };
}
