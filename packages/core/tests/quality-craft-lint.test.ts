import { describe, expect, it } from "vitest";
import { lintCraft } from "../src/quality/craft-lint.js";
import type { RenderedDomSnapshot, RenderedTextNode, RootCornerSample } from "../src/quality/rendered-dom.js";

function node(over: Partial<RenderedTextNode> = {}): RenderedTextNode {
  return {
    tag: "p",
    fontSizePx: 16,
    fontFamily: "inter",
    color: [17, 17, 17, 1],
    backgroundColor: [255, 255, 255, 1],
    backgroundSolid: true,
    text: "sample",
    ...over,
  };
}

function snap(nodes: RenderedTextNode[], rootCorners?: RootCornerSample[]): RenderedDomSnapshot {
  return { viewport: { width: 1280, height: 800 }, textNodes: nodes, ...(rootCorners ? { rootCorners } : {}) };
}

function check(checks: ReturnType<typeof lintCraft>, id: string) {
  const c = checks.find((x) => x.id === id);
  if (!c) throw new Error(`missing check ${id}`);
  return c;
}

describe("lintCraft", () => {
  it("emits one check per rule with id+passed", () => {
    const checks = lintCraft(snap([node()]));
    const ids = checks.map((c) => c.id).sort();
    expect(ids).toEqual([
      "color-palette",
      "contrast-aa",
      "eyebrow-density",
      "font-families",
      "no-em-dash",
      "no-pure-black",
      "screen-edge-radius",
      "type-scale",
    ]);
    for (const c of checks) expect(typeof c.passed).toBe("boolean");
  });

  it("contrast-aa passes for #111 on white, fails for #aaa on white", () => {
    expect(check(lintCraft(snap([node({ color: [17, 17, 17, 1] })])), "contrast-aa").passed).toBe(true);
    const bad = check(lintCraft(snap([node({ color: [170, 170, 170, 1] })])), "contrast-aa");
    expect(bad.passed).toBe(false);
    expect(bad.detail).toMatch(/4\.5/);
  });

  it("contrast-aa composites translucent text over its background before judging", () => {
    // near-white text at full alpha on white → fails; but check it does not crash on alpha
    const c = check(lintCraft(snap([node({ color: [255, 255, 255, 0.4] })])), "contrast-aa");
    expect(c.passed).toBe(false);
  });

  it("type-scale fails when distinct font sizes exceed the max", () => {
    const nodes = [12, 14, 16, 18, 20, 24, 28, 32, 40].map((px) => node({ fontSizePx: px }));
    const c = check(lintCraft(snap(nodes), { maxDistinctFontSizes: 8 }), "type-scale");
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/9/);
  });

  it("type-scale passes within the max", () => {
    const nodes = [16, 16, 24, 32].map((px) => node({ fontSizePx: px }));
    expect(check(lintCraft(snap(nodes), { maxDistinctFontSizes: 8 }), "type-scale").passed).toBe(true);
  });

  it("color-palette counts distinct text + background colors and fails past the max", () => {
    const nodes = [
      node({ color: [10, 10, 10, 1], backgroundColor: [255, 255, 255, 1] }),
      node({ color: [20, 20, 20, 1], backgroundColor: [240, 240, 240, 1] }),
      node({ color: [30, 30, 30, 1], backgroundColor: [200, 200, 200, 1] }),
    ];
    expect(check(lintCraft(snap(nodes), { maxColors: 3 }), "color-palette").passed).toBe(false);
    expect(check(lintCraft(snap(nodes), { maxColors: 12 }), "color-palette").passed).toBe(true);
  });

  it("font-families fails past the max distinct families", () => {
    const nodes = [
      node({ fontFamily: "inter" }),
      node({ fontFamily: "georgia" }),
      node({ fontFamily: "courier" }),
      node({ fontFamily: "arial" }),
    ];
    expect(check(lintCraft(snap(nodes), { maxFontFamilies: 3 }), "font-families").passed).toBe(false);
  });

  it("ignores invisible nodes (alpha 0 / size 0) in contrast", () => {
    const c = check(
      lintCraft(snap([node({ color: [170, 170, 170, 0] }), node({ color: [17, 17, 17, 1] })])),
      "contrast-aa",
    );
    expect(c.passed).toBe(true);
  });

  it("skips non-solid-background nodes in contrast (gradient/image is unsupported, not a false fail)", () => {
    // A would-be failing pair (light grey text) but its backdrop is a gradient/image.
    const c = check(lintCraft(snap([node({ color: [200, 200, 200, 1], backgroundSolid: false })])), "contrast-aa");
    expect(c.passed).toBe(true);
    expect(c.detail).toMatch(/skipped/);
  });

  it("judges only solid-background nodes, noting skipped non-solid ones", () => {
    const c = check(
      lintCraft(
        snap([
          node({ color: [17, 17, 17, 1], backgroundSolid: true }), // judgeable, passes
          node({ color: [10, 10, 10, 1], backgroundSolid: false }), // skipped
        ]),
      ),
      "contrast-aa",
    );
    expect(c.passed).toBe(true);
    expect(c.detail).toMatch(/1 text node/);
    expect(c.detail).toMatch(/1 skipped/);
  });

  it("non-solid nodes do not inject a fabricated white background into the palette", () => {
    // Two non-solid nodes sharing one text color → 1 distinct color, not 1 color + white.
    const c = check(
      lintCraft(
        snap([
          node({ color: [10, 20, 30, 1], backgroundSolid: false }),
          node({ color: [10, 20, 30, 1], backgroundSolid: false }),
        ]),
        { maxColors: 1 },
      ),
      "color-palette",
    );
    expect(c.passed).toBe(true);
  });

  it("is a pure function over an arbitrary hand-built snapshot (reusable, no DOM)", () => {
    expect(() => lintCraft(snap([]))).not.toThrow();
    const empty = lintCraft(snap([]));
    expect(empty.every((c) => c.passed)).toBe(true);
  });

  it("screen-edge-radius fails on mobile when a root container has a rounded outer corner", () => {
    const corners: RootCornerSample[] = [
      { tag: "body", radiusPx: [0, 0, 0, 0], coversViewport: true },
      { tag: "div", radiusPx: [24, 24, 24, 24], coversViewport: true },
    ];
    const c = check(lintCraft(snap([node()], corners), { platform: "mobile" }), "screen-edge-radius");
    expect(c.passed).toBe(false);
    expect(c.detail).toBe("div has rounded outer corner(s): [24,24,24,24]px");
  });

  it("screen-edge-radius ignores rounded corners that do not touch the matching viewport corner", () => {
    const corners: RootCornerSample[] = [
      { tag: "body", radiusPx: [0, 0, 0, 0], coversViewport: true, edgeContact: [true, true, true, true] },
      { tag: "header", radiusPx: [0, 0, 24, 24], coversViewport: true, edgeContact: [true, true, false, false] },
    ];
    const c = check(lintCraft(snap([node()], corners), { platform: "mobile" }), "screen-edge-radius");
    expect(c.passed).toBe(true);
    expect(c.detail).toBe("all root corners square (2 element(s) checked)");
  });

  it("screen-edge-radius lists at most 3 violating elements", () => {
    const corners: RootCornerSample[] = [
      { tag: "div", radiusPx: [8, 8, 0, 0], coversViewport: true },
      { tag: "main", radiusPx: [16, 16, 16, 16], coversViewport: true },
      { tag: "section", radiusPx: [0, 0, 12, 12], coversViewport: true },
      { tag: "article", radiusPx: [4, 4, 4, 4], coversViewport: true },
    ];
    const c = check(lintCraft(snap([node()], corners), { platform: "mobile" }), "screen-edge-radius");
    expect(c.passed).toBe(false);
    expect(c.detail).toContain("div has rounded outer corner(s): [8,8,0,0]px");
    expect(c.detail).toContain("main");
    expect(c.detail).toContain("section");
    expect(c.detail).not.toContain("article");
  });

  it("screen-edge-radius passes on mobile when all root corners are square", () => {
    const corners: RootCornerSample[] = [
      { tag: "body", radiusPx: [0, 0, 0, 0], coversViewport: true },
      { tag: "div", radiusPx: [0, 0, 0, 0], coversViewport: true },
    ];
    const c = check(lintCraft(snap([node()], corners), { platform: "mobile" }), "screen-edge-radius");
    expect(c.passed).toBe(true);
    expect(c.detail).toBe("all root corners square (2 element(s) checked)");
  });

  it("screen-edge-radius is skipped for non-mobile platforms (including undefined)", () => {
    const corners: RootCornerSample[] = [{ tag: "div", radiusPx: [24, 24, 24, 24], coversViewport: true }];
    const desktop = check(lintCraft(snap([node()], corners), { platform: "desktop" }), "screen-edge-radius");
    expect(desktop.passed).toBe(true);
    expect(desktop.detail).toBe("skipped (platform=desktop)");
    const none = check(lintCraft(snap([node()], corners)), "screen-edge-radius");
    expect(none.passed).toBe(true);
    expect(none.detail).toBe("skipped (platform=undefined)");
  });

  it("screen-edge-radius is skipped on mobile when the snapshot has no rootCorners (back-compat)", () => {
    const c = check(lintCraft(snap([node()]), { platform: "mobile" }), "screen-edge-radius");
    expect(c.passed).toBe(true);
    expect(c.detail).toBe("skipped (no rootCorners in snapshot)");
  });

  it("no-em-dash fails on em-dash and en-dash in Latin copy", () => {
    const em = check(lintCraft(snap([node({ text: "Fast — reliable" })])), "no-em-dash");
    expect(em.passed).toBe(false);
    expect(em.detail).toMatch(/Fast/);
    const en = check(lintCraft(snap([node({ text: "2018–2026" })])), "no-em-dash");
    expect(en.passed).toBe(false);
  });

  it("no-em-dash exempts the Chinese double dash and CJK-adjacent dashes", () => {
    const double = check(lintCraft(snap([node({ text: "设计——快速交付" })])), "no-em-dash");
    expect(double.passed).toBe(true);
    const adjacent = check(lintCraft(snap([node({ text: "速度 — 极快" })])), "no-em-dash");
    expect(adjacent.passed).toBe(true);
    const clean = check(lintCraft(snap([node({ text: "Fast - reliable" })])), "no-em-dash");
    expect(clean.passed).toBe(true);
  });

  it("no-pure-black flags #000000 text and solid backgrounds, not off-black", () => {
    const fg = check(lintCraft(snap([node({ color: [0, 0, 0, 1] })])), "no-pure-black");
    expect(fg.passed).toBe(false);
    expect(fg.detail).toMatch(/text #000000/);
    const bg = check(
      lintCraft(snap([node({ color: [240, 240, 240, 1], backgroundColor: [0, 0, 0, 1] })])),
      "no-pure-black",
    );
    expect(bg.passed).toBe(false);
    expect(bg.detail).toMatch(/background #000000/);
    const offBlack = check(lintCraft(snap([node({ color: [15, 15, 15, 1] })])), "no-pure-black");
    expect(offBlack.passed).toBe(true);
    // Translucent black composites to off-black → not judged as pure black.
    const translucent = check(lintCraft(snap([node({ color: [0, 0, 0, 0.6] })])), "no-pure-black");
    expect(translucent.passed).toBe(true);
  });

  function eyebrow(text: string, over: Partial<RenderedTextNode> = {}): RenderedTextNode {
    return node({ tag: "span", fontSizePx: 11, letterSpacingPx: 1.2, uppercaseTransform: true, text, ...over });
  }

  function snapWithSections(nodes: RenderedTextNode[], sectionCount: number): RenderedDomSnapshot {
    return { ...snap(nodes), sectionCount };
  }

  it("eyebrow-density fails past the 1-per-3-sections quota and passes within it", () => {
    const labels = ["SELECTED WORK", "THE HARDWARE", "FOUR COLORWAYS"].map((t) => eyebrow(t));
    const over = check(lintCraft(snapWithSections(labels, 3)), "eyebrow-density");
    expect(over.passed).toBe(false);
    expect(over.detail).toMatch(/3 eyebrow/);
    const within = check(lintCraft(snapWithSections([eyebrow("SELECTED WORK")], 3)), "eyebrow-density");
    expect(within.passed).toBe(true);
    const nine = check(lintCraft(snapWithSections(labels, 9)), "eyebrow-density");
    expect(nine.passed).toBe(true);
  });

  it("eyebrow-density ignores badges (ownChrome), table headers, and normal-tracking text", () => {
    const nodes = [
      eyebrow("ACTIVE", { ownChrome: true }),
      eyebrow("NAME", { tag: "th" }),
      eyebrow("Plain label", { uppercaseTransform: false, text: "Plain label" }),
      node({ letterSpacingPx: 0, text: "BODY COPY IN CAPS BUT UNTRACKED", fontSizePx: 11 }),
    ];
    const c = check(lintCraft(snapWithSections(nodes, 3)), "eyebrow-density");
    expect(c.passed).toBe(true);
    expect(c.detail).toMatch(/0 eyebrow/);
  });

  it("eyebrow-density counts text-derived all-caps when uppercaseTransform is false", () => {
    const nodes = [
      eyebrow("00 / INDEX", { uppercaseTransform: false, text: "SELECTED WORK" }),
      eyebrow("002 · FEATURED", { uppercaseTransform: false, text: "FEATURED COMMISSION" }),
    ];
    const c = check(lintCraft(snapWithSections(nodes, 3)), "eyebrow-density");
    expect(c.passed).toBe(false);
  });

  it("eyebrow-density skips without sectionCount, with zero sections, or without letter-spacing data", () => {
    const noCount = check(lintCraft(snap([eyebrow("SELECTED WORK")])), "eyebrow-density");
    expect(noCount.passed).toBe(true);
    expect(noCount.detail).toBe("skipped (no sectionCount in snapshot)");
    const zero = check(lintCraft(snapWithSections([eyebrow("SELECTED WORK")], 0)), "eyebrow-density");
    expect(zero.passed).toBe(true);
    expect(zero.detail).toBe("skipped (no <section> elements)");
    const bare = node({ text: "HELLO WORLD" }); // helper omits letterSpacingPx
    const uninstrumented = check(lintCraft(snapWithSections([bare], 3)), "eyebrow-density");
    expect(uninstrumented.passed).toBe(true);
    expect(uninstrumented.detail).toBe("skipped (no letter-spacing data in snapshot)");
  });
});
