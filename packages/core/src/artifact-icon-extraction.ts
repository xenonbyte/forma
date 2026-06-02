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
import { parse } from "node-html-parser";
import sharp from "sharp";
import { FormaError } from "./errors.js";

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
  size: { w: number; h: number };
  usesCurrentColor: boolean;
  /**
   * True only on the first occurrence of a given SVG content. Subsequent
   * occurrences with identical content set this to false.
   */
  sourceOrderFirst: boolean;
  files: {
    svg: string; // relative path, e.g. icons/<name>.svg
    png: Record<string, string>; // "1x" | "2x" | "3x" → relative path
  };
}

export interface IconManifest {
  // Top-level metadata
  artifactId: string;
  productId: string;
  requirementId: string;
  pageId: string;
  version: string;
  sourceVersion: string;
  generatedFrom: IconGeneratedFrom;
  icons: IconEntry[];
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
 * Run minimal SVG safety checks equivalent to scanSvg in artifact-static-validation.ts.
 * Throws FormaError(ARTIFACT_NOT_STATIC) on any violation.
 */
function assertSafeSvg(svgText: string, index: number): void {
  const root = parse(svgText, { comment: false });

  // Reject <script>
  if (root.querySelectorAll("script").length > 0) {
    throw new FormaError(
      "ARTIFACT_NOT_STATIC",
      `Unsafe SVG at icon index ${index}: contains <script> element`,
      { index },
    );
  }

  for (const el of root.querySelectorAll("*")) {
    const tag = el.tagName?.toLowerCase() ?? "";

    // Reject on* event handlers
    for (const attrName of Object.keys(el.attributes)) {
      if (attrName.toLowerCase().startsWith("on")) {
        throw new FormaError(
          "ARTIFACT_NOT_STATIC",
          `Unsafe SVG at icon index ${index}: inline event handler "${attrName}" on <${tag}>`,
          { index, attr: attrName },
        );
      }
    }

    // Reject remote / javascript: hrefs
    for (const hrefAttr of ["href", "xlink:href"]) {
      const val = el.getAttribute(hrefAttr) ?? el.rawAttributes[hrefAttr];
      if (!val) continue;
      const trimmed = val.trim();
      if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("//")) {
        throw new FormaError(
          "ARTIFACT_NOT_STATIC",
          `Unsafe SVG at icon index ${index}: remote ${hrefAttr} on <${tag}>: ${trimmed}`,
          { index },
        );
      }
      if (/^javascript:/i.test(trimmed)) {
        throw new FormaError(
          "ARTIFACT_NOT_STATIC",
          `Unsafe SVG at icon index ${index}: javascript: URL in ${hrefAttr} on <${tag}>`,
          { index },
        );
      }
    }
  }
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

  if (widthAttr && heightAttr) {
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

/**
 * Find the nearest aria-label on the element itself or a direct ancestor
 * within the HTML document tree. Returns undefined if none found.
 *
 * We pass the outer HTML of the SVG as it was extracted; the caller also
 * passes the original node so we can walk ancestors.
 */
function findAriaLabel(svgText: string): string | undefined {
  const root = parse(svgText, { comment: false });
  const svgEl = root.querySelector("svg");
  if (!svgEl) return undefined;

  // Check aria-label on the svg element itself
  const label = svgEl.getAttribute("aria-label");
  if (label?.trim()) return label.trim();

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

  // Track which content hashes have already produced physical files
  const physicalFilesByHash = new Map<
    string,
    { svgPath: string; pngPaths: Record<string, string> }
  >();

  const root = parse(html, { comment: true });
  const svgElements = root.querySelectorAll("svg");

  for (let i = 0; i < svgElements.length; i++) {
    const el = svgElements[i];
    const svgText = el.toString();

    // 1. Safety validation — throws FormaError on violation
    assertSafeSvg(svgText, i);

    const svgBuf = Buffer.from(svgText, "utf8");
    const hash = contentHash(svgBuf);

    // 2. Determine name
    const ariaLabel = findAriaLabel(svgText);
    const size = parseSvgSize(svgText);
    const baseName = ariaLabel
      ? `${slugify(ariaLabel)}-${hash}`
      : `icon-${i}-${size.w}x${size.h}-${hash}`;

    const id = baseName;
    const usesCurrentColor = detectCurrentColor(svgText);

    // 3. Check for dedup
    const alreadyProduced = physicalFilesByHash.get(hash);
    const isFirstOccurrence = alreadyProduced === undefined;

    let svgPath: string;
    let pngPaths: Record<string, string>;

    if (isFirstOccurrence) {
      // Write physical SVG file
      svgPath = `icons/${baseName}.svg`;
      files.set(svgPath, svgBuf);

      // Generate PNG tiers
      pngPaths = {};
      const baseW = size.w > 0 ? size.w : 24;
      const baseH = size.h > 0 ? size.h : 24;

      for (const density of densities) {
        const targetW = Math.round(baseW * density);
        const targetH = Math.round(baseH * density);
        const pngBuf = await sharp(svgBuf, { density: 96 * density })
          .resize({ width: targetW, height: targetH, fit: "fill" })
          .png()
          .toBuffer();

        const densityKey = `${density}x`;
        const pngPath = `icons/${baseName}@${densityKey}.png`;
        files.set(pngPath, pngBuf);
        pngPaths[densityKey] = pngPath;
      }

      physicalFilesByHash.set(hash, { svgPath, pngPaths });
    } else {
      // Reuse existing physical files
      svgPath = alreadyProduced.svgPath;
      pngPaths = alreadyProduced.pngPaths;
    }

    icons.push({
      id,
      size,
      usesCurrentColor,
      sourceOrderFirst: isFirstOccurrence,
      files: {
        svg: svgPath,
        png: pngPaths,
      },
    });
  }

  const manifest: IconManifest = {
    artifactId: metadata.artifactId,
    productId: metadata.productId,
    requirementId: metadata.requirementId,
    pageId: metadata.pageId,
    version: metadata.version,
    sourceVersion: metadata.version,
    generatedFrom: metadata.generatedFrom,
    icons,
  };

  return { files, manifest };
}
