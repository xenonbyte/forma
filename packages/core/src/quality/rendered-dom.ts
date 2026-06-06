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

/** A page-root element sampled for outer corner rounding (screen-edge-radius rule). */
export interface RootCornerSample {
  /** lowercased tag name */
  tag: string;
  /** computed corner radii in CSS px, TL/TR/BR/BL order (percentages resolved against the side length) */
  radiusPx: [number, number, number, number];
  /**
   * true when the matching corner touches the viewport corner, in TL/TR/BR/BL order.
   * Optional for backward compatibility with hand-built snapshots.
   */
  edgeContact?: [boolean, boolean, boolean, boolean];
  /** true when the element spans the viewport edge (body is always sampled as true) */
  coversViewport: boolean;
}

export interface RenderedDomSnapshot {
  viewport: { width: number; height: number };
  textNodes: RenderedTextNode[];
  /**
   * Corner radii of the page roots: document.body plus descendant candidates
   * that render as full-bleed containers touching at least one viewport corner.
   * Optional for backward compatibility: hand-built snapshots may omit it, in
   * which case the screen-edge-radius check reports skipped.
   */
  rootCorners?: RootCornerSample[];
}

/**
 * Runs INSIDE the browser via `page.evaluate`. MUST be self-contained: it may not
 * reference any module-scope identifier — only window/document/getComputedStyle.
 * Returns a JSON-serializable RenderedDomSnapshot.
 */
export function extractSnapshotInPage(): RenderedDomSnapshot {
  // Hard caps so a pathological page cannot produce an unbounded snapshot or stall
  // the extractor: at most MAX captured text nodes, and at most MAX_VISITED elements
  // walked. Locals (not module-scope) to keep this function self-contained.
  const MAX = 5000;
  const MAX_VISITED = 100000;

  function parseRgbString(value: string): [number, number, number, number] | null {
    const m = value.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const parts = m[1]
      .split(/[,/\s]+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length < 3) return null;
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    const a = parts[3] === undefined ? 1 : Number(parts[3]);
    return [r, g, b, Number.isFinite(a) ? a : 1];
  }

  // Canvas-backed resolver for modern CSS colors. getComputedStyle may report
  // oklch()/color-mix()/color(...) verbatim (not rgb()); painting the value and
  // reading the pixel back resolves ANY browser-renderable color to sRGB bytes.
  const colorCache = new Map<string, [number, number, number, number]>();
  const probeCanvas = document.createElement("canvas");
  probeCanvas.width = 1;
  probeCanvas.height = 1;
  const probeCtx = probeCanvas.getContext("2d", { willReadFrequently: true });

  /**
   * Resolve any computed CSS color string to sRGB rgba (0–255, alpha 0–1). Tries a
   * fast rgb()/rgba() parse, then falls back to canvas painting for modern formats.
   * Returns [0,0,0,0] (transparent) when the color cannot be resolved — so the node
   * drops out of judging rather than being silently treated as opaque black.
   */
  function resolveRgba(value: string): [number, number, number, number] {
    if (!value) return [0, 0, 0, 0];
    const hit = colorCache.get(value);
    if (hit) return hit;
    let out = parseRgbString(value);
    if (!out && probeCtx) {
      // An invalid color assignment leaves fillStyle unchanged; probe two sentinels
      // to tell "accepted" (both normalize equal) from "rejected" (stay different).
      probeCtx.fillStyle = "#000";
      probeCtx.fillStyle = value;
      const a1 = probeCtx.fillStyle;
      probeCtx.fillStyle = "#fff";
      probeCtx.fillStyle = value;
      const a2 = probeCtx.fillStyle;
      if (a1 === a2) {
        probeCtx.clearRect(0, 0, 1, 1);
        probeCtx.fillStyle = value;
        probeCtx.fillRect(0, 0, 1, 1);
        const d = probeCtx.getImageData(0, 0, 1, 1).data;
        out = [d[0], d[1], d[2], d[3] / 255];
      }
    }
    const resolved: [number, number, number, number] = out ?? [0, 0, 0, 0];
    colorCache.set(value, resolved);
    return resolved;
  }

  function compositeOver(
    fg: [number, number, number, number],
    bg: [number, number, number, number],
  ): [number, number, number, number] {
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
    let sawBgLayer = false; // a background color has joined the stack
    let sealed = false; // an opaque layer caps the background; stop collecting
    while (node) {
      const cs = getComputedStyle(node);
      const op = parseFloat(cs.opacity);
      const hasOpacity = Number.isFinite(op) && op < 1;
      // CSS opacity<1 fades the element's whole group (its own background + every
      // descendant) over the parent backdrop. If a background color is in that
      // group, the recorded color is not what renders, so it cannot be reduced to
      // one solid color → mark non-solid. (Opacity on a node that contributes no
      // background only fades the foreground, already folded into the fg alpha.)
      if (hasOpacity && sawBgLayer) {
        solid = false;
        break;
      }
      if (!sealed) {
        // A gradient/background-image is the actual backdrop here; not a solid color.
        if (cs.backgroundImage && cs.backgroundImage !== "none") {
          solid = false;
          break;
        }
        const bg = resolveRgba(cs.backgroundColor);
        if (bg[3] > 0) {
          // This node both paints a background and fades itself → that background
          // renders faded; non-solid.
          if (hasOpacity) {
            solid = false;
            break;
          }
          layers.push(bg);
          sawBgLayer = true;
          if (bg[3] >= 1) sealed = true; // opaque: stop collecting, but keep
          // scanning ancestors for a fading group
        }
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
    return (cs.fontFamily.split(",")[0] ?? "").replace(/['"]/g, "").trim().toLowerCase();
  }

  // CSS opacity compounds multiplicatively down the ancestor chain, but
  // getComputedStyle(...).color stays opaque. Fold the effective opacity into the
  // captured foreground alpha so faded/disabled copy is judged on its rendered
  // lightness (and opacity:0 text becomes alpha 0, which the lint filters out).
  function effectiveOpacity(el: Element): number {
    let op = 1;
    let node: Element | null = el;
    while (node) {
      const v = parseFloat(getComputedStyle(node).opacity);
      if (Number.isFinite(v)) op *= Math.max(0, Math.min(1, v));
      node = node.parentElement;
    }
    return op;
  }

  function pushNode(el: Element, cs: CSSStyleDeclaration, color: [number, number, number, number], text: string): void {
    const bg = resolveBackground(el);
    const op = effectiveOpacity(el);
    const folded: [number, number, number, number] = [color[0], color[1], color[2], color[3] * op];
    textNodes.push({
      tag: el.tagName.toLowerCase(),
      fontSizePx: parseFloat(cs.fontSize) || 0,
      fontFamily: primaryFamily(cs),
      color: folded,
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
    let out = "";
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) out += child.textContent ?? "";
    }
    return out;
  }

  function placeholderText(
    el: Element,
    cs: CSSStyleDeclaration,
  ): { text: string; color: [number, number, number, number] } | null {
    const placeholder = el.getAttribute("placeholder");
    if (!placeholder || placeholder.trim().length === 0) return null;
    const pcs = getComputedStyle(el, "::placeholder");
    const pColor = pcs && pcs.color ? resolveRgba(pcs.color) : resolveRgba(cs.color);
    return { text: placeholder, color: pColor };
  }

  /**
   * Rendered text for a form control comes from attributes, not child text nodes —
   * but only for controls whose value/placeholder is actually painted as text.
   * <input type=checkbox|radio|file|color|range|hidden|image|date…> draw no text
   * label (their .value is a submit value like "on"), so they are skipped. Returns
   * the visible label + its rendered color, or null when there is none to judge.
   */
  function formControlText(
    el: Element,
    cs: CSSStyleDeclaration,
  ): { text: string; color: [number, number, number, number] } | null {
    const tag = el.tagName.toLowerCase();
    const control = el as HTMLInputElement | HTMLTextAreaElement;
    const value = control.value != null ? String(control.value) : "";

    if (tag === "textarea") {
      if (value.trim().length > 0) return { text: value, color: resolveRgba(cs.color) };
      return placeholderText(el, cs);
    }
    if (tag !== "input") return null;

    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    // Buttons paint their value as the label.
    if (type === "submit" || type === "button" || type === "reset") {
      return value.trim().length > 0 ? { text: value, color: resolveRgba(cs.color) } : null;
    }
    // Textual inputs paint their value; password masks it (skip value), but all
    // of these can show placeholder text.
    if (
      type === "text" ||
      type === "search" ||
      type === "email" ||
      type === "tel" ||
      type === "url" ||
      type === "number" ||
      type === "password"
    ) {
      if (value.trim().length > 0 && type !== "password") {
        return { text: value, color: resolveRgba(cs.color) };
      }
      return placeholderText(el, cs);
    }
    // checkbox / radio / file / color / range / hidden / image / date / … → no drawn text.
    return null;
  }

  function visit(el: Element): void {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return;
    // An ancestor display:none leaves this element's own computed display intact,
    // so check actual layout: an unrendered element generates no client rects.
    if (el.getClientRects().length === 0) return;

    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea") {
      const fc = formControlText(el, cs);
      if (fc) pushNode(el, cs, fc.color, fc.text);
      return;
    }

    // <select> renders its selected option's label; that text lives in descendant
    // <option> nodes, so directText(select) misses it — capture it explicitly.
    if (tag === "select") {
      const sel = el as HTMLSelectElement;
      const opt =
        sel.selectedOptions && sel.selectedOptions.length > 0
          ? sel.selectedOptions[0]
          : sel.options
            ? sel.options[sel.selectedIndex]
            : null;
      const label = opt ? (opt.textContent ?? "") : "";
      if (label.trim().length > 0) pushNode(el, cs, resolveRgba(cs.color), label);
      return;
    }

    const own = directText(el);
    if (own.trim().length > 0) pushNode(el, cs, resolveRgba(cs.color), own);
  }

  const textNodes: RenderedTextNode[] = [];
  // Stream the tree instead of materializing every element up front: a generated
  // artifact can carry a huge decorative/hidden DOM with few text nodes, and this
  // extractor runs on every save. We cap BOTH the captured text nodes (MAX) and the
  // total elements visited (MAX_VISITED) so a pathological page can't stall or
  // exhaust memory. <body> itself is visited first so text directly under it
  // (<body>Hello</body>) is linted (querySelectorAll('*') would skip body).
  let visited = 0;
  const stack: Element[] = document.body ? [document.body] : [];
  while (stack.length > 0) {
    if (textNodes.length >= MAX || visited >= MAX_VISITED) break;
    const el = stack.pop()!;
    visited++;
    visit(el);
    // Push children reversed so they are processed in document order.
    const children = el.children;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }

  // Sample the page roots' corner radii for the screen-edge-radius rule: body
  // (always, it touches the viewport edge by definition) plus bounded descendant
  // candidates rendering as full-bleed root containers. Real generated bundles
  // commonly nest the screen as body > #app > main; direct-body sampling would
  // miss rounded outer corners in that structure. Computed border-*-radius is
  // one or two <length-percentage>s ("8px", "50%", "8px 16px"); percentages
  // resolve against the corresponding box side, so any positive percentage
  // yields a positive px value (recorded as non-zero).
  function cornerRadiusPx(value: string, rect: DOMRect): number {
    const parts = value.trim().split(/\s+/);
    let max = 0;
    for (let i = 0; i < parts.length; i++) {
      const num = parseFloat(parts[i]);
      if (!Number.isFinite(num) || num <= 0) continue;
      const px = parts[i].endsWith("%") ? (num / 100) * (i === 0 ? rect.width : rect.height) : num;
      if (px > max) max = px;
    }
    return max;
  }

  const EDGE_EPSILON = 2;

  function cornerEdgeContact(rect: DOMRect): [boolean, boolean, boolean, boolean] {
    const touchesLeft = rect.left <= EDGE_EPSILON;
    const touchesTop = rect.top <= EDGE_EPSILON;
    const touchesRight = rect.right >= window.innerWidth - EDGE_EPSILON;
    const touchesBottom = rect.bottom >= window.innerHeight - EDGE_EPSILON;
    return [
      touchesTop && touchesLeft,
      touchesTop && touchesRight,
      touchesBottom && touchesRight,
      touchesBottom && touchesLeft,
    ];
  }

  function sampleCorners(el: Element, edgeContactOverride?: [boolean, boolean, boolean, boolean]): RootCornerSample {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const edgeContact = edgeContactOverride ?? cornerEdgeContact(rect);
    return {
      tag: el.tagName.toLowerCase(),
      radiusPx: [
        cornerRadiusPx(cs.borderTopLeftRadius, rect),
        cornerRadiusPx(cs.borderTopRightRadius, rect),
        cornerRadiusPx(cs.borderBottomRightRadius, rect),
        cornerRadiusPx(cs.borderBottomLeftRadius, rect),
      ],
      edgeContact,
      coversViewport: edgeContact.some(Boolean),
    };
  }

  const rootCorners: RootCornerSample[] = [];
  if (document.body) {
    const sampled = new Set<Element>();
    rootCorners.push(sampleCorners(document.body, [true, true, true, true]));
    sampled.add(document.body);

    let cornerVisited = 0;
    const cornerStack = Array.from(document.body.children).reverse();
    while (cornerStack.length > 0 && cornerVisited < MAX_VISITED) {
      const el = cornerStack.pop()!;
      cornerVisited++;

      const rect = el.getBoundingClientRect();
      const edgeContact = cornerEdgeContact(rect);
      if (el.getClientRects().length > 0 && rect.width >= window.innerWidth * 0.98 && edgeContact.some(Boolean)) {
        if (!sampled.has(el)) {
          rootCorners.push(sampleCorners(el, edgeContact));
          sampled.add(el);
        }
      }

      const children = el.children;
      for (let i = children.length - 1; i >= 0; i--) cornerStack.push(children[i]);
    }
  }

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    textNodes,
    rootCorners,
  };
}
