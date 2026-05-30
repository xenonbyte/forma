import { describe, expect, it } from 'vitest';
import { lintCraft } from '../src/quality/craft-lint.js';
import type { RenderedDomSnapshot, RenderedTextNode } from '../src/quality/rendered-dom.js';

function node(over: Partial<RenderedTextNode> = {}): RenderedTextNode {
  return {
    tag: 'p',
    fontSizePx: 16,
    fontFamily: 'inter',
    color: [17, 17, 17, 1],
    backgroundColor: [255, 255, 255, 1],
    backgroundSolid: true,
    text: 'sample',
    ...over,
  };
}

function snap(nodes: RenderedTextNode[]): RenderedDomSnapshot {
  return { viewport: { width: 1280, height: 800 }, textNodes: nodes };
}

function check(checks: ReturnType<typeof lintCraft>, id: string) {
  const c = checks.find((x) => x.id === id);
  if (!c) throw new Error(`missing check ${id}`);
  return c;
}

describe('lintCraft', () => {
  it('emits one check per rule with id+passed', () => {
    const checks = lintCraft(snap([node()]));
    const ids = checks.map((c) => c.id).sort();
    expect(ids).toEqual(['color-palette', 'contrast-aa', 'font-families', 'type-scale']);
    for (const c of checks) expect(typeof c.passed).toBe('boolean');
  });

  it('contrast-aa passes for #111 on white, fails for #aaa on white', () => {
    expect(check(lintCraft(snap([node({ color: [17, 17, 17, 1] })])), 'contrast-aa').passed).toBe(true);
    const bad = check(lintCraft(snap([node({ color: [170, 170, 170, 1] })])), 'contrast-aa');
    expect(bad.passed).toBe(false);
    expect(bad.detail).toMatch(/4\.5/);
  });

  it('contrast-aa composites translucent text over its background before judging', () => {
    // near-white text at full alpha on white → fails; but check it does not crash on alpha
    const c = check(lintCraft(snap([node({ color: [255, 255, 255, 0.4] })])), 'contrast-aa');
    expect(c.passed).toBe(false);
  });

  it('type-scale fails when distinct font sizes exceed the max', () => {
    const nodes = [12, 14, 16, 18, 20, 24, 28, 32, 40].map((px) => node({ fontSizePx: px }));
    const c = check(lintCraft(snap(nodes), { maxDistinctFontSizes: 8 }), 'type-scale');
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/9/);
  });

  it('type-scale passes within the max', () => {
    const nodes = [16, 16, 24, 32].map((px) => node({ fontSizePx: px }));
    expect(check(lintCraft(snap(nodes), { maxDistinctFontSizes: 8 }), 'type-scale').passed).toBe(true);
  });

  it('color-palette counts distinct text + background colors and fails past the max', () => {
    const nodes = [
      node({ color: [10, 10, 10, 1], backgroundColor: [255, 255, 255, 1] }),
      node({ color: [20, 20, 20, 1], backgroundColor: [240, 240, 240, 1] }),
      node({ color: [30, 30, 30, 1], backgroundColor: [200, 200, 200, 1] }),
    ];
    expect(check(lintCraft(snap(nodes), { maxColors: 3 }), 'color-palette').passed).toBe(false);
    expect(check(lintCraft(snap(nodes), { maxColors: 12 }), 'color-palette').passed).toBe(true);
  });

  it('font-families fails past the max distinct families', () => {
    const nodes = [node({ fontFamily: 'inter' }), node({ fontFamily: 'georgia' }), node({ fontFamily: 'courier' }), node({ fontFamily: 'arial' })];
    expect(check(lintCraft(snap(nodes), { maxFontFamilies: 3 }), 'font-families').passed).toBe(false);
  });

  it('ignores invisible nodes (alpha 0 / size 0) in contrast', () => {
    const c = check(lintCraft(snap([node({ color: [170, 170, 170, 0] }), node({ color: [17, 17, 17, 1] })])), 'contrast-aa');
    expect(c.passed).toBe(true);
  });

  it('skips non-solid-background nodes in contrast (gradient/image is unsupported, not a false fail)', () => {
    // A would-be failing pair (light grey text) but its backdrop is a gradient/image.
    const c = check(lintCraft(snap([node({ color: [200, 200, 200, 1], backgroundSolid: false })])), 'contrast-aa');
    expect(c.passed).toBe(true);
    expect(c.detail).toMatch(/skipped/);
  });

  it('judges only solid-background nodes, noting skipped non-solid ones', () => {
    const c = check(
      lintCraft(
        snap([
          node({ color: [17, 17, 17, 1], backgroundSolid: true }), // judgeable, passes
          node({ color: [10, 10, 10, 1], backgroundSolid: false }), // skipped
        ]),
      ),
      'contrast-aa',
    );
    expect(c.passed).toBe(true);
    expect(c.detail).toMatch(/1 text node/);
    expect(c.detail).toMatch(/1 skipped/);
  });

  it('non-solid nodes do not inject a fabricated white background into the palette', () => {
    // Two non-solid nodes sharing one text color → 1 distinct color, not 1 color + white.
    const c = check(
      lintCraft(snap([
        node({ color: [10, 20, 30, 1], backgroundSolid: false }),
        node({ color: [10, 20, 30, 1], backgroundSolid: false }),
      ]), { maxColors: 1 }),
      'color-palette',
    );
    expect(c.passed).toBe(true);
  });

  it('is a pure function over an arbitrary hand-built snapshot (reusable, no DOM)', () => {
    expect(() => lintCraft(snap([]))).not.toThrow();
    const empty = lintCraft(snap([]));
    expect(empty.every((c) => c.passed)).toBe(true);
  });
});
