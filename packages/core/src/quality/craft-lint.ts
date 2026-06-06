import type { ArtifactCraftCheck } from "../artifact-manifest.js";
import { compositeOver, contrastRatio, type Rgb } from "./contrast.js";
import type { RenderedDomSnapshot, RenderedTextNode } from "./rendered-dom.js";

export interface LintOptions {
  /** WCAG AA normal-text minimum. Default 4.5. */
  minContrast?: number;
  /** Max distinct font sizes (type-scale discipline). Default 8. */
  maxDistinctFontSizes?: number;
  /** Max distinct text+background colors (palette restraint). Default 12. */
  maxColors?: number;
  /** Max distinct font families (typography discipline). Default 3. */
  maxFontFamilies?: number;
  /** Target platform; "mobile" enables the screen-edge-radius rule. No default. */
  platform?: string;
}

const DEFAULTS: Required<Omit<LintOptions, "platform">> = {
  minContrast: 4.5,
  maxDistinctFontSizes: 8,
  maxColors: 12,
  maxFontFamilies: 3,
};

/** A text node is visible (countable) when it has size and a non-transparent color. */
function isVisible(n: RenderedTextNode): boolean {
  return n.fontSizePx > 0 && n.color[3] > 0;
}

function rgbKey(c: Rgb): string {
  return `${c[0]},${c[1]},${c[2]}`;
}

/**
 * Deterministic craft lint over a rendered-DOM snapshot. Pure: no browser, no IO.
 * Returns one ArtifactCraftCheck per rule. Brand-agnostic; thresholds via options.
 *
 * Invariant: a node's `backgroundColor` is used (RGB only, alpha ignored) only when
 * `backgroundSolid` is true. `extractSnapshotInPage` resolves ancestor backgrounds
 * to an opaque color and sets `backgroundSolid=false` when the backdrop is a
 * gradient/image — those nodes are skipped by the contrast/palette rules. A caller
 * that hand-builds a snapshot must set `backgroundSolid` accordingly (and composite
 * any translucent background to opaque) or contrast/palette results will be off.
 */
export function lintCraft(snapshot: RenderedDomSnapshot, options: LintOptions = {}): ArtifactCraftCheck[] {
  const opts = { ...DEFAULTS, ...options };
  const visible = snapshot.textNodes.filter(isVisible);

  return [
    contrastCheck(visible, opts.minContrast),
    typeScaleCheck(visible, opts.maxDistinctFontSizes),
    colorPaletteCheck(visible, opts.maxColors),
    fontFamilyCheck(visible, opts.maxFontFamilies),
    screenEdgeRadiusCheck(snapshot, options.platform),
  ];
}

/**
 * Mobile screens render edge-to-edge: a rounded outer corner on a page root
 * (body, or a full-bleed top-level container) leaves a visible notch against
 * the device edge. Only enforced when platform === "mobile"; the check is
 * always emitted (skipped otherwise) for observability.
 */
function screenEdgeRadiusCheck(snapshot: RenderedDomSnapshot, platform?: string): ArtifactCraftCheck {
  if (platform !== "mobile") {
    return { id: "screen-edge-radius", passed: true, detail: `skipped (platform=${platform})` };
  }
  const corners = snapshot.rootCorners;
  if (!corners) {
    return { id: "screen-edge-radius", passed: true, detail: "skipped (no rootCorners in snapshot)" };
  }
  const rounded = corners.filter((c) => c.radiusPx.some((r) => r > 0));
  if (rounded.length === 0) {
    return {
      id: "screen-edge-radius",
      passed: true,
      detail: `all root corners square (${corners.length} element(s) checked)`,
    };
  }
  const sample = rounded
    .slice(0, 3)
    .map((c) => `${c.tag} has rounded outer corner(s): [${c.radiusPx.join(",")}]px`)
    .join("; ");
  return { id: "screen-edge-radius", passed: false, detail: sample };
}

function contrastCheck(nodes: RenderedTextNode[], min: number): ArtifactCraftCheck {
  // Only nodes with a solid backdrop are judgeable. Text over a gradient/image has
  // no single background color, so it is skipped rather than judged against a wrong
  // white fallback (which would produce both false fails and false passes).
  const judgeable = nodes.filter((n) => n.backgroundSolid);
  const skipped = nodes.length - judgeable.length;
  const skipNote = skipped > 0 ? ` (${skipped} skipped: non-solid background)` : "";

  const failures: Array<{ text: string; ratio: number }> = [];
  for (const n of judgeable) {
    const fg = compositeOver(n.color, [n.backgroundColor[0], n.backgroundColor[1], n.backgroundColor[2]]);
    const bg: Rgb = [n.backgroundColor[0], n.backgroundColor[1], n.backgroundColor[2]];
    const ratio = contrastRatio(fg, bg);
    if (ratio < min) failures.push({ text: n.text, ratio });
  }
  if (failures.length === 0) {
    return { id: "contrast-aa", passed: true, detail: `all ${judgeable.length} text node(s) ≥ ${min}:1${skipNote}` };
  }
  const worst = failures.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  const sample = failures
    .slice(0, 3)
    .map((f) => `"${f.text}" (${f.ratio.toFixed(2)}:1)`)
    .join("; ");
  return {
    id: "contrast-aa",
    passed: false,
    detail: `${failures.length}/${judgeable.length} text node(s) below ${min}:1 (worst ${worst.ratio.toFixed(2)}:1)${skipNote}. e.g. ${sample}`,
  };
}

function typeScaleCheck(nodes: RenderedTextNode[], max: number): ArtifactCraftCheck {
  const sizes = [...new Set(nodes.map((n) => n.fontSizePx))].sort((a, b) => a - b);
  const passed = sizes.length <= max;
  return {
    id: "type-scale",
    passed,
    detail: `${sizes.length} distinct font size(s) (max ${max}): [${sizes.join(", ")}]`,
  };
}

function colorPaletteCheck(nodes: RenderedTextNode[], max: number): ArtifactCraftCheck {
  const colors = new Set<string>();
  for (const n of nodes) {
    if (n.backgroundSolid) {
      colors.add(rgbKey(compositeOver(n.color, [n.backgroundColor[0], n.backgroundColor[1], n.backgroundColor[2]])));
      colors.add(rgbKey([n.backgroundColor[0], n.backgroundColor[1], n.backgroundColor[2]]));
    } else {
      // Backdrop color is indeterminate; count only the author's text color, not a
      // fabricated white background.
      colors.add(rgbKey([n.color[0], n.color[1], n.color[2]]));
    }
  }
  const passed = colors.size <= max;
  return {
    id: "color-palette",
    passed,
    detail: `${colors.size} distinct text+background color(s) (max ${max})`,
  };
}

function fontFamilyCheck(nodes: RenderedTextNode[], max: number): ArtifactCraftCheck {
  const families = [...new Set(nodes.map((n) => n.fontFamily).filter((f) => f.length > 0))];
  const passed = families.length <= max;
  return {
    id: "font-families",
    passed,
    detail: `${families.length} distinct font famil(ies) (max ${max}): [${families.join(", ")}]`,
  };
}
