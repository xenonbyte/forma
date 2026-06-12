import type { ArtifactCraftCheck } from "../artifact-manifest.js";
import { compositeOver, contrastRatio, type Rgb } from "./contrast.js";
import type { RenderedDomSnapshot, RenderedTextNode, RootCornerSample } from "./rendered-dom.js";

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
    emDashCheck(visible),
    pureBlackCheck(visible),
    eyebrowDensityCheck(snapshot, visible),
  ];
}

// ─── no-em-dash ──────────────────────────────────────────────────────────────

/**
 * CJK character (ideographs, kana, hangul-adjacent punctuation, fullwidth
 * forms). Dashes adjacent to CJK text follow CJK punctuation conventions and
 * are exempt from the em-dash ban.
 */
function isCjkChar(ch: string): boolean {
  return /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/.test(ch);
}

/** Nearest non-whitespace char before/after index `i` (exclusive), or "". */
function nearestChar(text: string, i: number, dir: -1 | 1): string {
  for (let j = i + dir; j >= 0 && j < text.length; j += dir) {
    if (!/\s/.test(text[j])) return text[j];
  }
  return "";
}

/**
 * Em-dash (—) / en-dash (–) in Latin-context copy is the most reliable LLM
 * authorship tell (see craft/ai-tells.md). Exemptions: the Chinese double dash
 * `——` and any dash directly adjacent to CJK text, where the character is
 * legitimate punctuation.
 */
function emDashCheck(nodes: RenderedTextNode[]): ArtifactCraftCheck {
  const samples: string[] = [];
  let count = 0;
  for (const n of nodes) {
    for (let i = 0; i < n.text.length; i++) {
      const ch = n.text[i];
      if (ch !== "—" && ch !== "–") continue;
      // Chinese double dash —— : exempt both halves.
      if (ch === "—" && (n.text[i - 1] === "—" || n.text[i + 1] === "—")) continue;
      const prev = nearestChar(n.text, i, -1);
      const next = nearestChar(n.text, i, 1);
      if ((prev && isCjkChar(prev)) || (next && isCjkChar(next))) continue;
      count++;
      if (samples.length < 3) samples.push(`"${n.text}"`);
      break; // one finding per node is enough for the count's purpose
    }
  }
  if (count === 0) {
    return { id: "no-em-dash", passed: true, detail: "no em/en-dash in Latin-context text" };
  }
  return {
    id: "no-em-dash",
    passed: false,
    detail: `${count} text node(s) contain em/en-dash in Latin context. e.g. ${samples.join("; ")}`,
  };
}

// ─── no-pure-black ───────────────────────────────────────────────────────────

/**
 * Pure #000000 text or backgrounds cause vibration against saturated surfaces
 * and read as unstyled defaults (craft/color.md: use off-black). Only fully
 * opaque foregrounds are judged; translucent blacks composite to off-black.
 */
function pureBlackCheck(nodes: RenderedTextNode[]): ArtifactCraftCheck {
  const samples: string[] = [];
  let count = 0;
  for (const n of nodes) {
    const fgPure = n.color[0] === 0 && n.color[1] === 0 && n.color[2] === 0 && n.color[3] >= 0.99;
    const bgPure = n.backgroundSolid && n.backgroundColor[0] === 0 && n.backgroundColor[1] === 0 && n.backgroundColor[2] === 0;
    if (!fgPure && !bgPure) continue;
    count++;
    if (samples.length < 3) samples.push(`"${n.text}" (${fgPure ? "text" : "background"} #000000)`);
  }
  if (count === 0) {
    return { id: "no-pure-black", passed: true, detail: "no pure #000000 text or solid background" };
  }
  return {
    id: "no-pure-black",
    passed: false,
    detail: `${count} text node(s) use pure #000000. e.g. ${samples.join("; ")}`,
  };
}

// ─── eyebrow-density ─────────────────────────────────────────────────────────

/**
 * Tags whose small uppercase tracked text is a legitimate UI pattern (table
 * headers, buttons, form labels), not an eyebrow.
 */
const EYEBROW_EXCLUDED_TAGS = new Set([
  "th",
  "td",
  "button",
  "a",
  "label",
  "option",
  "summary",
  "legend",
  "input",
  "textarea",
  "select",
]);

function rendersUppercase(n: RenderedTextNode): boolean {
  if (n.uppercaseTransform) return true;
  const letters = n.text.match(/[A-Za-z]/g) ?? [];
  return letters.length >= 3 && !/[a-z]/.test(n.text);
}

/**
 * Eyebrow quota: max 1 eyebrow (small uppercase wide-tracking bare label) per
 * 3 <section> elements — the templated "label above every headline" rhythm is
 * a production AI tell (craft/ai-tells.md). Badges/chips are excluded via
 * `ownChrome`; table headers and buttons via tag. Skips when the snapshot
 * carries no section count or no letter-spacing instrumentation (hand-built
 * snapshots), or when the page has no <section> structure to ration against.
 */
function eyebrowDensityCheck(snapshot: RenderedDomSnapshot, nodes: RenderedTextNode[]): ArtifactCraftCheck {
  const sectionCount = snapshot.sectionCount;
  if (sectionCount === undefined) {
    return { id: "eyebrow-density", passed: true, detail: "skipped (no sectionCount in snapshot)" };
  }
  if (sectionCount === 0) {
    return { id: "eyebrow-density", passed: true, detail: "skipped (no <section> elements)" };
  }
  if (!nodes.some((n) => n.letterSpacingPx !== undefined)) {
    return { id: "eyebrow-density", passed: true, detail: "skipped (no letter-spacing data in snapshot)" };
  }
  const eyebrows = nodes.filter(
    (n) =>
      !EYEBROW_EXCLUDED_TAGS.has(n.tag) &&
      n.ownChrome !== true &&
      n.fontSizePx > 0 &&
      n.fontSizePx <= 14 &&
      (n.letterSpacingPx ?? 0) / n.fontSizePx >= 0.05 &&
      n.text.length <= 40 &&
      rendersUppercase(n),
  );
  const allowed = Math.max(1, Math.ceil(sectionCount / 3));
  if (eyebrows.length <= allowed) {
    return {
      id: "eyebrow-density",
      passed: true,
      detail: `${eyebrows.length} eyebrow(s) within quota (${allowed} allowed for ${sectionCount} section(s))`,
    };
  }
  const sample = eyebrows
    .slice(0, 3)
    .map((n) => `"${n.text}"`)
    .join("; ");
  return {
    id: "eyebrow-density",
    passed: false,
    detail: `${eyebrows.length} eyebrow(s) exceed quota (${allowed} allowed for ${sectionCount} section(s)). e.g. ${sample}`,
  };
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
  const rounded = corners
    .map((c) => ({ tag: c.tag, radiusPx: screenEdgeRadii(c) }))
    .filter((c) => c.radiusPx.some((r) => r > 0));
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

function screenEdgeRadii(sample: RootCornerSample): [number, number, number, number] {
  const edgeContact = sample.edgeContact ?? [true, true, true, true];
  return [
    edgeContact[0] ? sample.radiusPx[0] : 0,
    edgeContact[1] ? sample.radiusPx[1] : 0,
    edgeContact[2] ? sample.radiusPx[2] : 0,
    edgeContact[3] ? sample.radiusPx[3] : 0,
  ];
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
