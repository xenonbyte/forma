/**
 * Rendered-DOM snapshot: the contract between the browser-side extractor and the
 * pure craft lint. JSON-serializable so it can cross the puppeteer boundary and
 * be hand-built in unit tests / reused by the P9 desktop dogfood.
 */

export interface RenderedTextNode {
  /** lowercased tag name */
  tag: string;
  /** computed font-size in CSS px */
  fontSizePx: number;
  /** primary font-family, lowercased and unquoted */
  fontFamily: string;
  /** computed color as rgba (0–255, alpha 0–1) */
  color: [number, number, number, number];
  /**
   * effective (ancestor-resolved, opaque) background color as rgba. Always opaque
   * (alpha=1): extractSnapshotInPage composites translucent ancestor layers down
   * to a solid color, and lintCraft relies on this — it ignores the alpha channel.
   */
  backgroundColor: [number, number, number, number];
  /** trimmed direct text content, truncated */
  text: string;
}

export interface RenderedDomSnapshot {
  viewport: { width: number; height: number };
  textNodes: RenderedTextNode[];
}

/** Hard cap so a pathological page cannot produce an unbounded snapshot. */
const MAX_TEXT_NODES = 5000;

/**
 * Runs INSIDE the browser via `page.evaluate`. MUST be self-contained: it may not
 * reference any module-scope identifier — only window/document/getComputedStyle.
 * Returns a JSON-serializable RenderedDomSnapshot.
 */
export function extractSnapshotInPage(): RenderedDomSnapshot {
  const MAX = 5000;

  function parseRgb(value: string): [number, number, number, number] {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 1];
    const parts = m[1].split(',').map((p) => p.trim());
    const r = Number(parts[0]) || 0;
    const g = Number(parts[1]) || 0;
    const b = Number(parts[2]) || 0;
    const a = parts[3] === undefined ? 1 : Number(parts[3]);
    return [r, g, b, Number.isFinite(a) ? a : 1];
  }

  function compositeOver(fg: [number, number, number, number], bg: [number, number, number, number]): [number, number, number, number] {
    const a = Math.max(0, Math.min(1, fg[3]));
    const bgA = Math.max(0, Math.min(1, bg[3]));
    const outA = a + bgA * (1 - a);
    if (outA <= 0) return [0, 0, 0, 0];
    return [
      Math.round((fg[0] * a + bg[0] * bgA * (1 - a)) / outA),
      Math.round((fg[1] * a + bg[1] * bgA * (1 - a)) / outA),
      Math.round((fg[2] * a + bg[2] * bgA * (1 - a)) / outA),
      outA,
    ];
  }

  function effectiveBackground(el: Element): [number, number, number, number] {
    const layers: Array<[number, number, number, number]> = [];
    let node: Element | null = el;
    while (node) {
      const bg = parseRgb(getComputedStyle(node).backgroundColor);
      if (bg[3] > 0) layers.push(bg);
      node = node.parentElement;
    }
    let resolved: [number, number, number, number] = [255, 255, 255, 1];
    for (const layer of layers.reverse()) {
      resolved = compositeOver(layer, resolved);
    }
    return [resolved[0], resolved[1], resolved[2], 1];
  }

  function hasDirectText(el: Element): boolean {
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3 && (child.textContent ?? '').trim().length > 0) return true;
    }
    return false;
  }

  const textNodes: RenderedTextNode[] = [];
  const all = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of Array.from(all)) {
    if (textNodes.length >= MAX) break;
    if (!hasDirectText(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const family = (cs.fontFamily.split(',')[0] ?? '').replace(/['"]/g, '').trim().toLowerCase();
    textNodes.push({
      tag: el.tagName.toLowerCase(),
      fontSizePx: parseFloat(cs.fontSize) || 0,
      fontFamily: family,
      color: parseRgb(cs.color),
      backgroundColor: effectiveBackground(el),
      text: (el.textContent ?? '').trim().slice(0, 80),
    });
  }

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    textNodes,
  };
}
