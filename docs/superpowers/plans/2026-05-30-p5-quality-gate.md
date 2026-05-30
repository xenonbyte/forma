# P5 — 质量门（确定性 craft lint）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「达到 OpenDesign 质量」做成可执行检查：新增 `packages/core/src/quality/`，一套**作用于渲染后 DOM 快照**的确定性 craft lint（对比度 / type scale / 调色板 / 字体族），在 artifact save 时跑并把结果写入 `manifest.forma.quality.craftChecks`；lint 纯函数化、可被 P9 desktop 外壳 dogfood 复用。

**Architecture:** 拆成三层：**① 渲染快照抽取**（`extractSnapshotInPage` 在 puppeteer 页内 `page.evaluate` 走 DOM + `getComputedStyle`，产出可序列化的 `RenderedDomSnapshot`，复用 P3 preview 渲染的同一次页面加载，不二次启动浏览器）→ **② 纯 lint**（`lintCraft(snapshot, options?) → ArtifactCraftCheck[]`，零浏览器依赖、可单测、可被任意渲染 DOM 复用）→ **③ 落盘**（`design-save.ts` 把结果写进 `manifest.forma.quality.craftChecks`，**非阻断**：lint 失败只记录、不拒绝保存；强制 self-review / 违规重生成归 P6）。`manifest.forma.quality.craftChecks` 字段 P1 已存在，本阶段**不改 schema**。

**Tech Stack:** TypeScript ESM、Node ≥22、pnpm workspace、Vitest（`environment: "node"`）、puppeteer 25.x（`headless: 'shell'`，已 bundle）、node-html-parser（已在）。无新依赖。

**锁定决策（实现期对照，勿偏离）：**
1. **非阻断**：P5 的 lint **只记录**结果到 `manifest.forma.quality.craftChecks`，**不拒绝保存**（与 P4 预览一致：预览失败也不拒存）。「fm-design 强制 self-review / 违规重生成」是 **P6** 的模板职责。
2. **作用于渲染后 DOM**：lint 输入是**渲染后**的快照（真实 computed 颜色/字号），不是源 HTML 文本。抽取经 puppeteer `page.evaluate`。
3. **单次浏览器加载**：抽取复用 `renderArtifactPreview` 的 1x 页面（加 `extractDom` 开关返回快照），**不**为 lint 另启浏览器。
4. **lint 纯函数 + 可复用**：`lintCraft` 与 `extractSnapshotInPage` 都导出；P9 desktop 外壳渲成 DOM 后调同一对函数即可 dogfood（本阶段不接 P9，只导出 + 单测证明 DOM 无关）。
5. **品牌无关规则集**：本阶段四条机械规则均**不依赖品牌 token**（对比度、distinct 字号数、distinct 颜色数、distinct 字体族数），通过 `LintOptions` 暴露阈值，便于将来接品牌 token（如 `--accent ≤ N`）扩展。
6. **预览失败 → 不写 quality**：preview 渲染失败（无快照）时**省略** `manifest.forma.quality`（不可见地编一个假 check 反而误导）；preview 成功但 lint 抛错时，记一条 `{ id: 'craft-lint', passed: false, detail: 'lint failed: …' }` 使其可观测。
7. **命名**：字段 `manifest.forma.quality.craftChecks`（camelCase，P1 既有）；check 结构 `ArtifactCraftCheck = { id, passed, detail? }`（P1 既有，勿改）。

---

## File Structure

新增目录 `packages/core/src/quality/`，每文件单一职责：

| 文件 | 职责 |
|---|---|
| `packages/core/src/quality/contrast.ts` | 纯 WCAG 对比度数学：`relativeLuminance`、`contrastRatio`、`compositeOver`。无依赖。 |
| `packages/core/src/quality/rendered-dom.ts` | `RenderedDomSnapshot` / `RenderedTextNode` 类型 + `extractSnapshotInPage`（在浏览器上下文运行的**自包含**函数，供 `page.evaluate`）。 |
| `packages/core/src/quality/craft-lint.ts` | 纯 `lintCraft(snapshot, options?) → ArtifactCraftCheck[]`，四条规则；`LintOptions` 阈值。依赖 `./contrast.js`、`../artifact-manifest.js`（仅类型）。 |
| `packages/core/src/quality/self-review-checklist.ts` | `SelfReviewItem` 类型 + `SELF_REVIEW_CHECKLIST` 常量（craft 可核对项，供 P6 下发）。 |
| `packages/core/src/quality/index.ts` | 桶文件，re-export 上述公开 API。 |

修改：
| 文件 | 改动 |
|---|---|
| `packages/core/src/preview-renderer.ts` | `RenderPreviewInput` 加 `extractDom?: boolean`；`RenderPreviewResult` 加 `snapshot?: RenderedDomSnapshot`；在 1x 页 `page.evaluate(extractSnapshotInPage)`。 |
| `packages/core/src/design-save.ts` | 渲染时传 `extractDom: true`；preview 成功后 `lintCraft(snapshot)`，把结果写入 `manifest.forma.quality.craftChecks`。 |
| `packages/core/src/index.ts` | 新增 `export * from "./quality/index.js";`。 |

测试：
- `packages/core/tests/quality-contrast.test.ts`
- `packages/core/tests/quality-craft-lint.test.ts`
- `packages/core/tests/quality-self-review-checklist.test.ts`
- `packages/core/tests/quality-rendered-dom.test.ts`（puppeteer，需 `dangerouslyDisableSandbox`）
- 扩 `packages/core/tests/design-save.test.ts`（断言 craftChecks 落盘）

**注意（环境）：** 跑到 puppeteer 的测试（P5.2、P5.6）在本机需 `dangerouslyDisableSandbox: true`。`grep` 在本 shell 偶发不可用，用 `node -e` / Read 代替。core 改动后，mcp/server typecheck 走 core 的 `dist/`，故 **core 改完先 `pnpm --filter @xenonbyte/forma-core build` 再 typecheck**。

---

## Task P5.1: WCAG 对比度数学（纯函数）

**Files:**
- Create: `packages/core/src/quality/contrast.ts`
- Test: `packages/core/tests/quality-contrast.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/core/tests/quality-contrast.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { relativeLuminance, contrastRatio, compositeOver } from '../src/quality/contrast.js';

describe('contrast math', () => {
  it('relativeLuminance: black = 0, white = 1', () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
  });

  it('contrastRatio: black vs white = 21:1', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
  });

  it('contrastRatio is symmetric (order independent)', () => {
    const a = contrastRatio([10, 20, 30], [200, 210, 220]);
    const b = contrastRatio([200, 210, 220], [10, 20, 30]);
    expect(a).toBeCloseTo(b, 6);
  });

  it('contrastRatio: same color = 1:1', () => {
    expect(contrastRatio([120, 120, 120], [120, 120, 120])).toBeCloseTo(1, 6);
  });

  it('compositeOver: opaque fg returns fg unchanged', () => {
    expect(compositeOver([10, 20, 30, 1], [255, 255, 255])).toEqual([10, 20, 30]);
  });

  it('compositeOver: 50% black over white = mid grey', () => {
    expect(compositeOver([0, 0, 0, 0.5], [255, 255, 255])).toEqual([128, 128, 128]);
  });

  it('compositeOver: fully transparent fg returns bg', () => {
    expect(compositeOver([0, 0, 0, 0], [200, 210, 220])).toEqual([200, 210, 220]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/tests/quality-contrast.test.ts`
Expected: FAIL — `Cannot find module '../src/quality/contrast.js'`.

- [ ] **Step 3: 实现**

`packages/core/src/quality/contrast.ts`:
```ts
/**
 * WCAG 2.x contrast math. Pure, no dependencies.
 * RGB channels are 0–255; alpha is 0–1.
 */

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

/** sRGB channel (0–255) → linear-light value (0–1). */
function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

/** WCAG contrast ratio between two opaque colors (1:1 … 21:1). Order independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Alpha-composite a (possibly translucent) foreground over an opaque background. */
export function compositeOver(fg: Rgba, bg: Rgb): Rgb {
  const a = fg[3];
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
  ];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/core/tests/quality-contrast.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/quality/contrast.ts packages/core/tests/quality-contrast.test.ts
git commit -m "feat(p5): WCAG contrast math helpers"
```

---

## Task P5.2: 渲染 DOM 快照（类型 + 浏览器内抽取 + 接 preview-renderer）

**Files:**
- Create: `packages/core/src/quality/rendered-dom.ts`
- Modify: `packages/core/src/preview-renderer.ts`
- Test: `packages/core/tests/quality-rendered-dom.test.ts`

**说明：** `extractSnapshotInPage` 经 `page.evaluate` 序列化到浏览器执行，**必须自包含**——不得引用任何模块作用域标识符（不 import、不调 `contrast.ts`、不用 Node API），只用 `window`/`document`/`getComputedStyle`。返回值必须 JSON 可序列化。

- [ ] **Step 1: 写失败测试**

`packages/core/tests/quality-rendered-dom.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { renderArtifactPreview } from '../src/preview-renderer.js';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

describe('extractDom via renderArtifactPreview', () => {
  it('returns a snapshot of rendered text nodes with computed color/font', async () => {
    const bundleDir = join(tmpdir(), `forma-snap-${randomBytes(6).toString('hex')}`);
    const outDir = join(bundleDir, 'preview');
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, 'index.html'),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <h1 style="color:#111111;font-size:32px;font-family:Inter">Title</h1>
         <p style="color:#777777;font-size:16px;font-family:Inter">Body text here</p>
       </body></html>`,
      'utf8',
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      expect(result.snapshot).toBeDefined();
      const nodes = result.snapshot!.textNodes;
      // both the h1 and p carry direct text
      const sizes = nodes.map((n) => n.fontSizePx).sort((a, b) => a - b);
      expect(sizes).toContain(16);
      expect(sizes).toContain(32);
      // h1 color is near-black, on a white effective background
      const title = nodes.find((n) => n.text.includes('Title'));
      expect(title).toBeDefined();
      expect(title!.color[0]).toBeLessThan(40);
      expect(title!.backgroundColor.slice(0, 3)).toEqual([255, 255, 255]);
      expect(title!.fontFamily).toContain('inter');
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it('omits snapshot when extractDom is not set', async () => {
    const bundleDir = join(tmpdir(), `forma-snap2-${randomBytes(6).toString('hex')}`);
    const outDir = join(bundleDir, 'preview');
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(bundleDir, 'index.html'), `<!doctype html><body style="margin:0"><p>hi</p></body>`, 'utf8');
    try {
      const result = await renderArtifactPreview({ bundleDir, outDir });
      expect(result.snapshot).toBeUndefined();
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/tests/quality-rendered-dom.test.ts` （本机需在带 `dangerouslyDisableSandbox` 的 Bash 调用里跑）
Expected: FAIL — `extractDom`/`snapshot` 尚不存在（`result.snapshot` undefined 但第一个用例断言 defined 失败）。

- [ ] **Step 3: 实现快照类型 + 浏览器内抽取函数**

`packages/core/src/quality/rendered-dom.ts`:
```ts
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
  /** effective (ancestor-resolved, opaque) background color as rgba */
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

  function effectiveBackground(el: Element): [number, number, number, number] {
    let node: Element | null = el;
    while (node) {
      const bg = parseRgb(getComputedStyle(node).backgroundColor);
      if (bg[3] > 0) return [bg[0], bg[1], bg[2], 1];
      node = node.parentElement;
    }
    return [255, 255, 255, 1];
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
```
> 注：`MAX_TEXT_NODES` 常量保留作文档/将来 Node 侧使用；浏览器内函数用本地 `MAX` 以保持自包含。

- [ ] **Step 4: 接入 `preview-renderer.ts`**

修改 `packages/core/src/preview-renderer.ts`：

顶部加 import：
```ts
import { extractSnapshotInPage, type RenderedDomSnapshot } from './quality/rendered-dom.js';
```

`RenderPreviewInput` 加字段：
```ts
export interface RenderPreviewInput {
  bundleDir: string;
  outDir: string;
  entry?: string;
  viewport?: { width: number; height: number };
  /** When true, also extract a rendered-DOM snapshot from the 1x page for craft lint. */
  extractDom?: boolean;
}
```

`RenderPreviewResult` 加字段：
```ts
export interface RenderPreviewResult {
  files: { '1x': string; '2x': string };
  snapshot?: RenderedDomSnapshot;
}
```

在 1x 截图后、`page.close()` 前抽取快照。把循环体里的截图段改为：
```ts
        const buf = await page.screenshot({ type: 'png' });
        const file = join(input.outDir, `${label}.png`);
        await writeFile(file, buf);
        files[label] = file;
        if (label === '1x' && input.extractDom) {
          snapshot = await page.evaluate(extractSnapshotInPage);
        }
```
并在函数内（`const files...` 附近）声明：
```ts
    let snapshot: RenderedDomSnapshot | undefined;
```
把 `return { files };` 改为：
```ts
    return { files, ...(snapshot ? { snapshot } : {}) };
```

- [ ] **Step 5: 跑测试确认通过**

Run（带 sandbox 关闭）: `npx vitest run packages/core/tests/quality-rendered-dom.test.ts`
Expected: PASS（2 tests）。`result.snapshot.textNodes` 含 16 与 32 字号、Title 近黑、背景白、family 含 `inter`。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/quality/rendered-dom.ts packages/core/src/preview-renderer.ts packages/core/tests/quality-rendered-dom.test.ts
git commit -m "feat(p5): rendered-DOM snapshot extraction wired into preview render"
```

---

## Task P5.3: 确定性 craft lint（纯函数，四规则）

**Files:**
- Create: `packages/core/src/quality/craft-lint.ts`
- Test: `packages/core/tests/quality-craft-lint.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/core/tests/quality-craft-lint.test.ts`:
```ts
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

  it('is a pure function over an arbitrary hand-built snapshot (reusable, no DOM)', () => {
    expect(() => lintCraft(snap([]))).not.toThrow();
    const empty = lintCraft(snap([]));
    expect(empty.every((c) => c.passed)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/tests/quality-craft-lint.test.ts`
Expected: FAIL — `Cannot find module '../src/quality/craft-lint.js'`.

- [ ] **Step 3: 实现**

`packages/core/src/quality/craft-lint.ts`:
```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/core/tests/quality-craft-lint.test.ts`
Expected: PASS（10 tests）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/quality/craft-lint.ts packages/core/tests/quality-craft-lint.test.ts
git commit -m "feat(p5): deterministic craft lint (contrast/type-scale/palette/font-families)"
```

---

## Task P5.4: self-review 清单（供 P6 下发）

**Files:**
- Create: `packages/core/src/quality/self-review-checklist.ts`
- Test: `packages/core/tests/quality-self-review-checklist.test.ts`

**说明：** 清单是给 AI 在生成后**人工自检**的 craft 可核对项（非机械、lint 无法判定的部分，如层级/留白/状态覆盖）。每项关联一个真实 craft doc slug。P5 只产出 + 单测结构；其**下发/强制**归 P6。

- [ ] **Step 1: 写失败测试**

`packages/core/tests/quality-self-review-checklist.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SELF_REVIEW_CHECKLIST } from '../src/quality/self-review-checklist.js';
import { StyleService } from '../src/styles.js';

describe('SELF_REVIEW_CHECKLIST', () => {
  it('is a non-empty list of well-formed items', () => {
    expect(SELF_REVIEW_CHECKLIST.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const item of SELF_REVIEW_CHECKLIST) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
      expect(item.craftDoc).toMatch(/^[a-z0-9-]+$/);
      expect(item.prompt.trim().length).toBeGreaterThan(0);
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
    }
  });

  it('every referenced craftDoc slug exists in the bundled craft docs', async () => {
    const home = await mkdtemp(join(tmpdir(), 'forma-checklist-'));
    const styles = new StyleService({ home, bundledCraftDir: resolve('craft') });
    const slugs = new Set((await styles.listCraftDocs()).map((d) => d.slug));
    for (const item of SELF_REVIEW_CHECKLIST) {
      expect(slugs.has(item.craftDoc), `craftDoc "${item.craftDoc}" not found`).toBe(true);
    }
  });
});
```
> `StyleService` 构造入参形如 `{ home, bundledStylesDir?, bundledCraftDir? }`（见 `packages/core/src/styles.ts`）。`home` 用临时目录即可，仅 craft 读取走 `bundledCraftDir`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/tests/quality-self-review-checklist.test.ts`
Expected: FAIL — `Cannot find module '../src/quality/self-review-checklist.js'`.

- [ ] **Step 3: 实现**

`packages/core/src/quality/self-review-checklist.ts`:
```ts
/**
 * Self-review checklist: craft-checkable items the model verifies AFTER generating
 * a design (the non-mechanical complements to the deterministic craft lint). Each
 * item references a bundled craft doc slug. Surfaced/enforced by the P6 templates.
 */

export interface SelfReviewItem {
  /** stable kebab-case id */
  id: string;
  /** bundled craft doc slug this item draws from (must exist in craft/) */
  craftDoc: string;
  /** a concrete yes/no question the model answers about its own output */
  prompt: string;
}

export const SELF_REVIEW_CHECKLIST: SelfReviewItem[] = [
  {
    id: 'no-ai-slop',
    craftDoc: 'anti-ai-slop',
    prompt: 'Does the design avoid generic AI-slop patterns (centered everything, default purple gradients, equal-weight cards, emoji bullets)?',
  },
  {
    id: 'type-hierarchy',
    craftDoc: 'typography-hierarchy',
    prompt: 'Is there a clear typographic hierarchy with a small, consistent type scale rather than many ad-hoc sizes?',
  },
  {
    id: 'color-restraint',
    craftDoc: 'color',
    prompt: 'Is color used with restraint — a small palette, accent reserved for primary actions, neutrals carrying most surfaces?',
  },
  {
    id: 'contrast-accessible',
    craftDoc: 'accessibility-baseline',
    prompt: 'Does every text/control meet WCAG AA contrast against its actual background?',
  },
  {
    id: 'state-coverage',
    craftDoc: 'state-coverage',
    prompt: 'Are empty, loading, error, and edge states represented rather than only the happy path?',
  },
  {
    id: 'form-validation',
    craftDoc: 'form-validation',
    prompt: 'Do forms show inline validation, clear required/optional cues, and accessible error messaging?',
  },
  {
    id: 'motion-discipline',
    craftDoc: 'animation-discipline',
    prompt: 'Is motion purposeful and restrained (no gratuitous animation), respecting reduced-motion intent?',
  },
  {
    id: 'ux-laws',
    craftDoc: 'laws-of-ux',
    prompt: 'Does the layout honor core UX laws (Fitts, Hick, proximity, consistent affordances)?',
  },
];
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/core/tests/quality-self-review-checklist.test.ts`
Expected: PASS（2 tests）。所有 craftDoc slug 命中 `craft/`（anti-ai-slop / typography-hierarchy / color / accessibility-baseline / state-coverage / form-validation / animation-discipline / laws-of-ux 均存在）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/quality/self-review-checklist.ts packages/core/tests/quality-self-review-checklist.test.ts
git commit -m "feat(p5): craft self-review checklist (for P6 enforcement)"
```

---

## Task P5.5: 桶文件 + core 导出

**Files:**
- Create: `packages/core/src/quality/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 写桶文件**

`packages/core/src/quality/index.ts`:
```ts
export * from './contrast.js';
export * from './rendered-dom.js';
export * from './craft-lint.js';
export * from './self-review-checklist.js';
```

- [ ] **Step 2: 在 core 公共出口导出**

修改 `packages/core/src/index.ts`，在 `export * from "./design-save.js";` 之后追加一行：
```ts
export * from "./quality/index.js";
```

- [ ] **Step 3: 构建 core 验证导出无冲突**

Run: `pnpm --filter @xenonbyte/forma-core build`
Expected: tsc 成功，无重复导出/类型错误。

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/quality/index.ts packages/core/src/index.ts
git commit -m "feat(p5): export quality module from core"
```

---

## Task P5.6: save 管线接 lint，落 manifest.forma.quality.craftChecks

**Files:**
- Modify: `packages/core/src/design-save.ts`
- Test: `packages/core/tests/design-save.test.ts`

**当前 save 渲染段（参考）：** `design-save.ts` Step 3 在 temp bundle 上调 `renderArtifactPreview({ bundleDir: tempDir, outDir: previewOutDir })`，成功置 `previewStatus='ready'`、读 1x/2x PNG。本任务在该调用加 `extractDom: true`，把返回的 `snapshot` 经 `lintCraft` 转成 craftChecks，并在 Step 6 构建 `formaExtension` 时写入 `quality`。

- [ ] **Step 1: 写失败测试**

在 `packages/core/tests/design-save.test.ts` 的 `describe('saveDesignArtifact', …)` 内追加：
```ts
  it('persists deterministic craft checks into manifest.forma.quality.craftChecks', async () => {
    const input = await makeCleanInput({
      forma: { requirementId: 'req-q1', pageId: 'page-q1', variant: 'default' },
    });
    const deps = makeDeps();
    const result = await saveDesignArtifact(deps, input);
    expect(result.previewStatus).toBe('ready');

    const { productsRoot } = deps;
    const manifestJson = await readFile(
      join(productsRoot, productId, 'od-project', 'artifacts', result.artifactId, 'v1', 'manifest.json'),
      'utf8',
    );
    const manifest = JSON.parse(manifestJson);
    const checks = manifest.forma.quality?.craftChecks;
    expect(Array.isArray(checks)).toBe(true);
    const ids = checks.map((c: { id: string }) => c.id).sort();
    expect(ids).toEqual(['color-palette', 'contrast-aa', 'font-families', 'type-scale']);
    for (const c of checks) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.passed).toBe('boolean');
    }
  }, 90000);
```
> `makeCleanInput` 的固定 HTML（`<img>` + 近黑/白）渲染后必有可判文本节点；四条 check 均应落盘。

- [ ] **Step 2: 跑测试确认失败**

Run（带 sandbox 关闭）: `npx vitest run packages/core/tests/design-save.test.ts -t "craft checks"`
Expected: FAIL — `manifest.forma.quality` 为 undefined（尚未接 lint）。

- [ ] **Step 3: 实现接线**

修改 `packages/core/src/design-save.ts`：

(a) 顶部 import：
```ts
import { lintCraft } from './quality/craft-lint.js';
import type { ArtifactCraftCheck } from './artifact-manifest.js';
```
> `ArtifactCraftCheck` 与现有 `ArtifactFormaExtension`/`ArtifactManifest`/`ArtifactProvenance` 同来自 `./artifact-manifest.js`，合并进现有那条 import 即可。

(b) 在 Step 3 渲染区，声明一个 craftChecks 变量并在渲染调用处传 `extractDom: true`、转换快照：
找到：
```ts
  let previewStatus: 'ready' | 'failed' = 'failed';
  let previewError: string | undefined;
  let preview1xBuf: Buffer | undefined;
  let preview2xBuf: Buffer | undefined;
```
其后加：
```ts
  let craftChecks: ArtifactCraftCheck[] | undefined;
```
找到渲染调用：
```ts
      await renderArtifactPreview({ bundleDir: tempDir, outDir: previewOutDir });
      preview1xBuf = await readFile(join(previewOutDir, '1x.png'));
      preview2xBuf = await readFile(join(previewOutDir, '2x.png'));
      previewStatus = 'ready';
```
改为：
```ts
      const renderResult = await renderArtifactPreview({ bundleDir: tempDir, outDir: previewOutDir, extractDom: true });
      preview1xBuf = await readFile(join(previewOutDir, '1x.png'));
      preview2xBuf = await readFile(join(previewOutDir, '2x.png'));
      previewStatus = 'ready';
      if (renderResult.snapshot) {
        try {
          craftChecks = lintCraft(renderResult.snapshot);
        } catch (err) {
          // Lint is observable but non-blocking: record a single failed check.
          craftChecks = [{ id: 'craft-lint', passed: false, detail: `lint failed: ${err instanceof Error ? err.message : String(err)}` }];
        }
      }
```

(c) 把 craftChecks 透传到锁外（与现有 `finalPreview*` 同处）。找到：
```ts
  const finalPreviewStatus = previewStatus;
  const finalPreviewError = previewError;
  const finalPreview1x = preview1xBuf;
  const finalPreview2x = preview2xBuf;
```
其后加：
```ts
  const finalCraftChecks = craftChecks;
```

(d) Step 6 构建 `formaExtension` 时写入 quality（preview 失败/无快照则不写）。找到：
```ts
  const formaExtension: ArtifactFormaExtension = {
    ...forma,
    ...(kind === 'design-page' ? { variant: forma.variant ?? 'default' } : {}),
    assets,
    preview: {
      status: finalPreviewStatus,
      generatedAt: now,
      ...(finalPreviewError ? { error: finalPreviewError } : {}),
    },
  };
```
改为：
```ts
  const formaExtension: ArtifactFormaExtension = {
    ...forma,
    ...(kind === 'design-page' ? { variant: forma.variant ?? 'default' } : {}),
    assets,
    preview: {
      status: finalPreviewStatus,
      generatedAt: now,
      ...(finalPreviewError ? { error: finalPreviewError } : {}),
    },
    ...(finalCraftChecks ? { quality: { craftChecks: finalCraftChecks } } : {}),
  };
```

- [ ] **Step 4: 跑测试确认通过**

Run（带 sandbox 关闭）: `npx vitest run packages/core/tests/design-save.test.ts`
Expected: PASS（含新 craft-checks 用例；既有用例不回归）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/design-save.ts packages/core/tests/design-save.test.ts
git commit -m "feat(p5): run craft lint at save and persist manifest.forma.quality.craftChecks"
```

---

## Task P5.7: 集成验证（全包绿）

**Files:** 无（仅验证）

- [ ] **Step 1: 构建 core（供 mcp/server typecheck 用 dist）**

Run: `pnpm --filter @xenonbyte/forma-core build`
Expected: 成功。

- [ ] **Step 2: 全仓 typecheck**

Run: `pnpm typecheck`
Expected: 所有包（core/mcp/server/web/cli/agent + od-*）Done，0 错误。

- [ ] **Step 3: 全量测试**

Run（带 sandbox 关闭，因含 puppeteer 用例）: `pnpm test`
Expected: 全绿；新增约 21 个 quality 测试 + 1 个 design-save 用例通过，既有用例不回归。

- [ ] **Step 4: 自检 manifest 未改 schema**

确认未改动 `packages/core/src/artifact-manifest.ts`（`quality.craftChecks` 字段 P1 已存在、`validateFormaExtension` 已校验为数组）。`grep -n "quality" packages/core/src/artifact-manifest.ts` 应显示既有定义，无新增。

- [ ] **Step 5: 提交（如有验证期顺带修复）**

```bash
git add -A
git commit -m "chore(p5): integration verification — quality gate green across packages"
```
> 若 Step 2/3 全绿且无改动，则跳过本提交。

---

## Self-Review（plan 作者自检）

**1. Spec 覆盖（对照 master Phase 5）**
- 「新增 `packages/core/src/quality/`」→ P5.1–P5.5 ✅
- 「self-review 清单（craft 可核对项）」→ P5.4 ✅
- 「确定性 craft lint，作用于渲染后 DOM/HTML」→ P5.2（抽取）+ P5.3（lint）✅
- 「机械规则：对比度 ≥ 4.5:1 / 字号取 type scale 集合 / token 遵循（调色板+字体族代理）」→ P5.3 四规则 ✅（品牌 token 级 `--accent ≤ N` 列为将来扩展，见锁定决策 5；P5 验收不要求该具体规则）
- 「artifact save 时跑并写 `manifest.forma.quality.craftChecks`」→ P5.6 ✅
- 「lint 可独立作用于任意渲染 DOM/HTML（为 P9 dogfood 复用）」→ P5.3 纯函数 + 导出 `extractSnapshotInPage`/`lintCraft`（P5.2/P5.5）✅，P5.3 有「pure function over arbitrary snapshot」用例
- 「fm-design 强制 self-review 验收归 P6」→ 本 plan 不含，仅产出清单数据 ✅

**2. Placeholder 扫描**：无 TBD/“类似 TaskN”/省略代码；每个代码步骤含完整代码。✅

**3. 类型一致性**：`RenderedDomSnapshot`/`RenderedTextNode`（P5.2）被 P5.3 测试与 lint 一致引用；`ArtifactCraftCheck`（来自 `artifact-manifest.ts`）为 lint 返回与 manifest 字段同一类型；`extractSnapshotInPage` 返回 `RenderedDomSnapshot` 与 preview-renderer `snapshot?` 字段一致；`lintCraft(snapshot, options?)` 签名在 P5.3/P5.6 一致；`Rgb`/`Rgba` 在 contrast.ts 定义并被 craft-lint 复用。✅

**依赖前置**：依赖 P2（craft docs 已 bundle，P5.4 测试引用 `craft/`）、P4（save 管线 + preview-renderer extractDom 挂点）——均已在 main（HEAD `ec46c94`）落地。
