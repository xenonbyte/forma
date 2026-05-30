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
   * Only meaningful when `backgroundSolid` is true; otherwise it is a best-effort
   * fallback and must not be used to judge contrast/palette.
   */
  backgroundColor: [number, number, number, number];
  /**
   * true when the node's backdrop reduces to a single solid color. false when the
   * nearest painted backdrop is a CSS gradient or background-image, in which case
   * `backgroundColor` is indeterminate and contrast/palette skip the node rather
   * than judging it against a wrong white fallback.
   */
  backgroundSolid: boolean;
  /** trimmed rendered text (direct text, or a form control's value/placeholder), truncated */
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

  function resolveBackground(el: Element): { color: [number, number, number, number]; solid: boolean } {
    const layers: Array<[number, number, number, number]> = [];
    let node: Element | null = el;
    let solid = true;
    while (node) {
      const cs = getComputedStyle(node);
      // A gradient or background-image is the actual backdrop here; it cannot be
      // reduced to one color, so mark the stack non-solid and stop.
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        solid = false;
        break;
      }
      const bg = parseRgb(cs.backgroundColor);
      if (bg[3] > 0) {
        layers.push(bg);
        if (bg[3] >= 1) break; // an opaque layer seals everything beneath it
      }
      node = node.parentElement;
    }
    let resolved: [number, number, number, number] = [255, 255, 255, 1];
    for (const layer of layers.reverse()) {
      resolved = compositeOver(layer, resolved);
    }
    return { color: [resolved[0], resolved[1], resolved[2], 1], solid };
  }

  function primaryFamily(cs: CSSStyleDeclaration): string {
    return (cs.fontFamily.split(',')[0] ?? '').replace(/['"]/g, '').trim().toLowerCase();
  }

  function pushNode(el: Element, cs: CSSStyleDeclaration, color: [number, number, number, number], text: string): void {
    const bg = resolveBackground(el);
    textNodes.push({
      tag: el.tagName.toLowerCase(),
      fontSizePx: parseFloat(cs.fontSize) || 0,
      fontFamily: primaryFamily(cs),
      color,
      backgroundColor: bg.color,
      backgroundSolid: bg.solid,
      text: text.trim().slice(0, 80),
    });
  }

  /**
   * Concatenated DIRECT text of an element (its own text nodes only, not
   * descendants). Each element is captured with its own computed style, so a
   * parent must not absorb a styled child's text (e.g. the "world" in
   * `<p>Hello <strong>world</strong></p>` belongs to <strong>, not <p>) — that
   * would judge the child's pixels against the wrong style and double-count it.
   */
  function directText(el: Element): string {
    let out = '';
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) out += child.textContent ?? '';
    }
    return out;
  }

  /**
   * Rendered text for a form control comes from attributes, not child text nodes.
   * Returns the visible label (value, else placeholder) and the color it renders
   * in, or null when the control shows no judgeable text.
   */
  function formControlText(el: Element, cs: CSSStyleDeclaration): { text: string; color: [number, number, number, number] } | null {
    const tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return null;
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    const control = el as HTMLInputElement | HTMLTextAreaElement;
    const value = control.value != null ? String(control.value) : '';
    // password renders masked dots — not real text to judge.
    if (value.trim().length > 0 && type !== 'password') {
      return { text: value, color: parseRgb(cs.color) };
    }
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim().length > 0) {
      const pcs = getComputedStyle(el, '::placeholder');
      const pColor = pcs && pcs.color ? parseRgb(pcs.color) : parseRgb(cs.color);
      return { text: placeholder, color: pColor };
    }
    return null;
  }

  const textNodes: RenderedTextNode[] = [];
  const all = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of Array.from(all)) {
    if (textNodes.length >= MAX) break;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;

    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      const fc = formControlText(el, cs);
      if (fc) pushNode(el, cs, fc.color, fc.text);
      continue;
    }

    const own = directText(el);
    if (own.trim().length === 0) continue;
    pushNode(el, cs, parseRgb(cs.color), own);
  }

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    textNodes,
  };
}
