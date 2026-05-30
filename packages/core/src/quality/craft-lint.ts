import type { ArtifactCraftCheck } from '../artifact-manifest.js';
import { compositeOver, contrastRatio, type Rgb } from './contrast.js';
import type { RenderedDomSnapshot, RenderedTextNode } from './rendered-dom.js';

export interface LintOptions {
  /** WCAG AA normal-text minimum. Default 4.5. */
  minContrast?: number;
  /** Max distinct font sizes (type-scale discipline). Default 8. */
  maxDistinctFontSizes?: number;
  /** Max distinct text+background colors (palette restraint). Default 12. */
  maxColors?: number;
  /** Max distinct font families (typography discipline). Default 3. */
  maxFontFamilies?: number;
}

const DEFAULTS: Required<LintOptions> = {
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
 * Invariant: each node's `backgroundColor` is treated as opaque — only its RGB
 * channels are used and the alpha is ignored. `extractSnapshotInPage` guarantees
 * this by resolving ancestor backgrounds to an opaque color (alpha=1). A caller
 * that hand-builds a snapshot with a translucent `backgroundColor` must composite
 * it to opaque first, or contrast/palette results will be off.
 */
export function lintCraft(snapshot: RenderedDomSnapshot, options: LintOptions = {}): ArtifactCraftCheck[] {
  const opts = { ...DEFAULTS, ...options };
  const visible = snapshot.textNodes.filter(isVisible);

  return [
    contrastCheck(visible, opts.minContrast),
    typeScaleCheck(visible, opts.maxDistinctFontSizes),
    colorPaletteCheck(visible, opts.maxColors),
    fontFamilyCheck(visible, opts.maxFontFamilies),
  ];
}

function contrastCheck(nodes: RenderedTextNode[], min: number): ArtifactCraftCheck {
  const failures: Array<{ text: string; ratio: number }> = [];
  for (const n of nodes) {
    const fg = compositeOver(n.color, [n.backgroundColor[0], n.backgroundColor[1], n.backgroundColor[2]]);
    const bg: Rgb = [n.backgroundColor[0], n.backgroundColor[1], n.backgroundColor[2]];
    const ratio = contrastRatio(fg, bg);
    if (ratio < min) failures.push({ text: n.text, ratio });
  }
  if (failures.length === 0) {
    return { id: 'contrast-aa', passed: true, detail: `all ${nodes.length} text node(s) ≥ ${min}:1` };
  }
  const worst = failures.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  const sample = failures.slice(0, 3).map((f) => `"${f.text}" (${f.ratio.toFixed(2)}:1)`).join('; ');
  return {
    id: 'contrast-aa',
    passed: false,
    detail: `${failures.length}/${nodes.length} text node(s) below ${min}:1 (worst ${worst.ratio.toFixed(2)}:1). e.g. ${sample}`,
  };
}

function typeScaleCheck(nodes: RenderedTextNode[], max: number): ArtifactCraftCheck {
  const sizes = [...new Set(nodes.map((n) => n.fontSizePx))].sort((a, b) => a - b);
  const passed = sizes.length <= max;
  return {
    id: 'type-scale',
    passed,
    detail: `${sizes.length} distinct font size(s) (max ${max}): [${sizes.join(', ')}]`,
  };
}

function colorPaletteCheck(nodes: RenderedTextNode[], max: number): ArtifactCraftCheck {
  const colors = new Set<string>();
  for (const n of nodes) {
    colors.add(rgbKey(compositeOver(n.color, [n.backgroundColor[0], n.backgroundColor[1], n.backgroundColor[2]])));
    colors.add(rgbKey([n.backgroundColor[0], n.backgroundColor[1], n.backgroundColor[2]]));
  }
  const passed = colors.size <= max;
  return {
    id: 'color-palette',
    passed,
    detail: `${colors.size} distinct text+background color(s) (max ${max})`,
  };
}

function fontFamilyCheck(nodes: RenderedTextNode[], max: number): ArtifactCraftCheck {
  const families = [...new Set(nodes.map((n) => n.fontFamily).filter((f) => f.length > 0))];
  const passed = families.length <= max;
  return {
    id: 'font-families',
    passed,
    detail: `${families.length} distinct font famil(ies) (max ${max}): [${families.join(', ')}]`,
  };
}
