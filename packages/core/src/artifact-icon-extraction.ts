/**
 * artifact-icon-extraction.ts
 *
 * Extracts inline <svg> elements from static HTML, validates each one for
 * safety, and produces:
 *   - A Map<string, Buffer> of relative file paths under icons/ → content.
 *   - An IconManifest with per-icon metadata including density PNG paths.
 *
 * Pure function — no disk writes. A later task wires this to disk.
 */

import { createHash } from "node:crypto";
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

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Extracts all inline <svg> elements from `html`, validates each for safety,
 * and returns a set of icon files (SVG + density-tier PNGs) plus an IconManifest.
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
    const el = svgElements[i];
    const svgText = el.toString();

    // 1. Safety validation — collect violations via the shared scanSvg, then throw
    const svgViolations: string[] = [];
    scanSvg(`icon[${i}]`, svgText, svgViolations);
    if (svgViolations.length > 0) {
      throw new FormaError(
        "ARTIFACT_NOT_STATIC",
        `Unsafe SVG at icon index ${i}: ${svgViolations[0]}`,
        { index: i, violations: svgViolations },
      );
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
