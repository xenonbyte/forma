import { parse, type HTMLElement } from "node-html-parser";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface StaticValidationInput {
  html: string;
  /** relative path → SVG text (already localized) */
  svgFiles?: Map<string, string>;
  /** relative path → CSS text (already localized) */
  cssFiles?: Map<string, string>;
}

export type StaticValidationResult =
  | { ok: true }
  | { ok: false; violations: string[] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true when the value starts with http://, https://, or // (protocol-relative) */
function isRemoteUrl(value: string): boolean {
  const trimmed = value.trim();
  // Protocol-relative: exactly "//" at start (not a single "/" which is a local absolute path)
  return /^https?:\/\//i.test(trimmed) || trimmed.startsWith('//');
}

/** Returns true when the value starts with data: */
function isDataUrl(value: string): boolean {
  return /^data:/i.test(value.trim());
}

/** Returns true when the value starts with javascript: */
function isJavascriptUrl(value: string): boolean {
  return /^javascript:/i.test(value.trim());
}

/**
 * Scan a CSS text string for:
 *  - url(https?://...) — remote resource reference
 *  - @import with a remote URL
 *  - url(data:...) — residual data: URL
 *
 * Returns violation strings for every match found.
 */
function scanCssText(cssText: string, source: string): string[] {
  const violations: string[] = [];

  // Match url(...) with optional quotes, capturing the inner URL
  // We look for remote (https?:// or //), and data: variants
  const urlPattern = /url\s*\(\s*(['"]?)\s*((?:https?:|data:|\/\/)[^)'"]+)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = urlPattern.exec(cssText)) !== null) {
    const inner = m[2].trim();
    if (isRemoteUrl(inner)) {
      violations.push(`Remote CSS url() reference in ${source}: ${inner}`);
    } else if (isDataUrl(inner)) {
      violations.push(`Residual data: CSS url() in ${source}: ${inner.slice(0, 64)}`);
    }
  }

  // @import "https://..."; or @import url(https://...);
  // The url() form is already caught above; cover the bare-string @import form.
  const importPattern = /@import\s+(['"])(https?:\/\/[^'"]+)\1/gi;
  while ((m = importPattern.exec(cssText)) !== null) {
    violations.push(`Remote @import in ${source}: ${m[2]}`);
  }

  return violations;
}

/**
 * Inspect resource-carrying attributes on an element for:
 *  - remote http(s) URLs          → rule 6
 *  - javascript: URLs             → rule 3
 *  - residual data: URLs          → rule 8
 *
 * Checks: src, srcset, href, poster, xlink:href
 */
function scanResourceAttributes(el: HTMLElement, violations: string[]): void {
  const resourceAttrs = ["src", "srcset", "href", "poster"];

  for (const attr of resourceAttrs) {
    const val = el.getAttribute(attr);
    if (!val) continue;

    const trimmed = val.trim();
    if (isRemoteUrl(trimmed)) {
      violations.push(
        `Remote http(s) reference on <${el.tagName.toLowerCase()}> ${attr}="${trimmed}"`
      );
    } else if (isJavascriptUrl(trimmed)) {
      violations.push(
        `javascript: URL on <${el.tagName.toLowerCase()}> ${attr}="${trimmed}"`
      );
    } else if (isDataUrl(trimmed)) {
      violations.push(
        `Residual data: URL on <${el.tagName.toLowerCase()}> ${attr}="${trimmed.slice(0, 64)}"`
      );
    }

    // Also check each token in srcset (e.g. "https://x/y.png 2x, assets/z.png 1x")
    if (attr === "srcset") {
      for (const token of trimmed.split(",")) {
        const url = token.trim().split(/\s+/)[0];
        if (!url) continue;
        if (isRemoteUrl(url)) {
          violations.push(`Remote http(s) reference in srcset on <${el.tagName.toLowerCase()}>: ${url}`);
        } else if (isDataUrl(url)) {
          violations.push(`Residual data: URL in srcset on <${el.tagName.toLowerCase()}>: ${url.slice(0, 64)}`);
        }
      }
    }
  }

  // xlink:href — node-html-parser stores this as "xlink:href" in rawAttributes
  const xlinkHref =
    el.getAttribute("xlink:href") ?? el.rawAttributes["xlink:href"];
  if (xlinkHref) {
    const trimmed = xlinkHref.trim();
    if (isRemoteUrl(trimmed)) {
      violations.push(
        `Remote http(s) xlink:href on <${el.tagName.toLowerCase()}>: ${trimmed}`
      );
    } else if (isJavascriptUrl(trimmed)) {
      violations.push(
        `javascript: URL in xlink:href on <${el.tagName.toLowerCase()}>: ${trimmed}`
      );
    } else if (isDataUrl(trimmed)) {
      violations.push(
        `Residual data: URL in xlink:href on <${el.tagName.toLowerCase()}>: ${trimmed.slice(0, 64)}`
      );
    }
  }
}

/** Scan all elements of a parsed tree and push violations. */
function scanParsedTree(
  root: ReturnType<typeof parse>,
  violations: string[],
  context: string
): void {
  // Rule 1: <script> elements
  if (root.querySelectorAll("script").length > 0) {
    violations.push(`<script> element found in ${context}`);
  }

  // Rule 5: <iframe>, <object>, <embed>
  if (root.querySelectorAll("iframe").length > 0) {
    violations.push(`<iframe> element found in ${context}`);
  }
  if (root.querySelectorAll("object").length > 0) {
    violations.push(`<object> element found in ${context}`);
  }
  if (root.querySelectorAll("embed").length > 0) {
    violations.push(`<embed> element found in ${context}`);
  }

  // Rule 4: external stylesheets via <link>
  for (const el of root.querySelectorAll("link")) {
    const rel = (el.getAttribute("rel") ?? "").toLowerCase();
    const href = el.getAttribute("href") ?? "";
    if (rel === "stylesheet" && isRemoteUrl(href)) {
      violations.push(`External stylesheet <link rel="stylesheet" href="${href}">`);
    }
  }

  // Per-element rules
  for (const el of root.querySelectorAll("*")) {
    const tag = el.tagName?.toLowerCase() ?? "";

    // Rule 2: inline on* event handlers
    for (const [attrName] of Object.entries(el.attributes)) {
      if (attrName.toLowerCase().startsWith("on")) {
        violations.push(
          `Inline event handler attribute "${attrName}" on <${tag}> in ${context}`
        );
      }
    }

    // Rule 3 + 6 + 8: resource attribute scanning
    scanResourceAttributes(el, violations);

    // Rule 7: style="" attribute CSS
    const styleAttr = el.getAttribute("style");
    if (styleAttr) {
      violations.push(...scanCssText(styleAttr, `style attr on <${tag}> in ${context}`));
    }

    // Rule 7: <style> block text
    if (tag === "style") {
      violations.push(...scanCssText(el.text, `<style> block in ${context}`));
    }
  }
}

/** Scan an SVG file string (rule 9). */
function scanSvg(path: string, svgText: string, violations: string[]): void {
  const root = parse(svgText, { comment: false });

  // <script> in SVG
  if (root.querySelectorAll("script").length > 0) {
    violations.push(`<script> element in SVG file "${path}"`);
  }

  // on* event attributes and external href/xlink:href
  for (const el of root.querySelectorAll("*")) {
    const tag = el.tagName?.toLowerCase() ?? "";

    for (const [attrName] of Object.entries(el.attributes)) {
      if (attrName.toLowerCase().startsWith("on")) {
        violations.push(
          `Inline event handler attribute "${attrName}" on <${tag}> in SVG file "${path}"`
        );
      }
    }

    // href
    const href = el.getAttribute("href");
    if (href && isRemoteUrl(href.trim())) {
      violations.push(`Remote http(s) href in SVG file "${path}": ${href.trim()}`);
    }

    // xlink:href
    const xlinkHref =
      el.getAttribute("xlink:href") ?? el.rawAttributes["xlink:href"];
    if (xlinkHref && isRemoteUrl(xlinkHref.trim())) {
      violations.push(
        `Remote http(s) xlink:href in SVG file "${path}": ${xlinkHref.trim()}`
      );
    }
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Pure, synchronous static validator for a localized artifact.
 * Collects ALL violations — never throws.
 */
export function validateStaticArtifact(
  input: StaticValidationInput
): StaticValidationResult {
  const violations: string[] = [];

  // Scan HTML
  const root = parse(input.html, { comment: false });
  scanParsedTree(root, violations, "HTML");

  // Scan cssFiles
  if (input.cssFiles) {
    for (const [path, cssText] of input.cssFiles) {
      violations.push(...scanCssText(cssText, `cssFile "${path}"`));
    }
  }

  // Scan svgFiles
  if (input.svgFiles) {
    for (const [path, svgText] of input.svgFiles) {
      scanSvg(path, svgText, violations);
    }
  }

  if (violations.length === 0) {
    return { ok: true };
  }
  return { ok: false, violations };
}
