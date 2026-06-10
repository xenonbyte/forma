# Canvas Stitch-Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the three Forma canvases (brand-resources / design / annotation) into Stitch-style full-screen pages with Figma trackpad gestures, platform-icon tile headers + theme-color selection, and split the component library into per-unit horizontally-laid-out selectable tiles.

**Architecture:** Two rendering engines stay: React Flow `Canvas` (brand + design) and CanvasKit `AnnotationPage`. Points 1/4/5 are implemented in both. The component library is decomposed via **composition, not parsing**: the agent emits `tokens_css` + `units[]` (markup fragments); `design-save` composes one combined `index.html` (feeds the unchanged preview/validation/thumbnail pipeline) AND one `unit-<id>.html` per unit (canvas tiles), recording `manifest.forma.units`. The viewer renders one tile per unit via the existing `kind:"asset"` resolver path. No HTML parser, no preview-pipeline change.

**Tech Stack:** TypeScript monorepo (pnpm), React 19 + `@xyflow/react` (viewer), `@vzi-core/renderer` CanvasKit (annotation), Fastify (server), MCP stdio (mcp), Zod schemas, Vitest (node + browser env).

**Locked decisions:**
- Component split = **Path A** (real per-unit tiles): `tokens.css` + per-unit HTML + `forma.units`.
- Gestures = two-finger pan + pinch zoom (Figma standard).
- Scope = all three canvases (incl. CanvasKit annotation).
- Selection theme color = `#4f46e5`.
- Back targets: design/annotation → requirement detail; brand → product detail.
- **No** old-library compatibility fallback — a component-library artifact without `forma.units` renders an explicit empty state (dev phase; the lone calculator test product will be deleted and regenerated).
- design-save resolution: compose combined `index.html` (entry/preview/validation unchanged) + per-unit `unit-<id>.html`; all CSS lives in shared `tokens.css`, unit `body_html` is pure markup.

---

## File Structure

**Created:**
- `packages/viewer/src/tiles/PlatformIcon.tsx` — platform→inline-SVG glyph (mobile/tablet/desktop/web), shared by both engines.
- `packages/web/src/components/CanvasShell.tsx` — full-screen top bar: `[← back]  productName · typeName`.
- `packages/web/src/viewer/componentLibraryMapper.ts` — `manifest.forma.units` → `NormalizeArtifactInput[]` (incl. icon unit).
- Test files alongside each.

**Modified:**
- `packages/viewer/src/model.ts` — `platform?`, `bundlePath?` on tile types.
- `packages/viewer/src/normalize.ts` — thread `platform`/`bundlePath` → `htmlBundle` asset ref.
- `packages/viewer/src/Canvas.tsx` — tile header (platform icon + name), `#4f46e5` selection, Figma gestures.
- `packages/web/src/routes.tsx` — `chrome?: "fullscreen"` on `RouteDefinition`; mark 3 canvas routes.
- `packages/web/src/App.tsx` — render fullscreen routes without `<Layout>`, wrap in `CanvasShell`.
- `packages/web/src/pages/{DesignView,AnnotationPage,BrandResources}.tsx` — drop inline top bars, full-screen height, report product name, use units (brand).
- `packages/web/src/api.ts` — expose `manifest.forma.units` in the Web artifact manifest type.
- `packages/web/src/i18n.ts` — `canvas.type.*`, `canvas.back` keys (en + zh).
- `packages/core/src/artifact-manifest.ts` — `ArtifactComponentUnit` type + `forma.units` validation.
- `packages/core/src/design-save.ts` — accept `tokensCss`+`units`; compose index.html + unit files; emit `forma.units`.
- `packages/core/src/store.ts` — `GenerateComponentsInput` gains `tokensCss`+`units`; passthrough.
- `packages/mcp/src/tools.ts` — `generateComponentsSchema` → `tokens_css`+`units`; handler maps to store.
- `packages/agent/templates/{claude,codex,gemini}/fm-refine-components*` — emit units contract.

---

## Part A — Viewer tile chrome + gestures

### Task A1: Add `platform` + `bundlePath` to the viewer model

**Files:**
- Modify: `packages/viewer/src/model.ts`
- Modify: `packages/viewer/src/normalize.ts`
- Test: `packages/viewer/src/normalize.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Add to `packages/viewer/src/normalize.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildViewerModel } from "./normalize.js";

describe("buildViewerModel platform + bundlePath", () => {
  it("carries platform onto tiles and uses bundlePath as an asset htmlBundle ref", () => {
    const model = buildViewerModel({
      entry: "page",
      artifacts: [
        {
          artifactId: "lib", kind: "component-library", pageId: "brand", pageName: "brand",
          variant: "default", title: "Button", version: 2, width: 320, height: 420,
          platform: "mobile", bundlePath: "unit-button.html",
        },
      ],
    });
    const tile = model.tiles[0]!;
    expect(tile.platform).toBe("mobile");
    expect(tile.htmlBundle).toEqual({ artifactId: "lib", version: 2, kind: "asset", path: "unit-button.html" });
  });

  it("defaults htmlBundle to the bundle entry when bundlePath is absent", () => {
    const model = buildViewerModel({
      entry: "requirement",
      artifacts: [
        { artifactId: "a", kind: "design-page", pageId: "p", pageName: "P", variant: "default",
          title: "P", version: 1, width: 390, height: 844 },
      ],
    });
    expect(model.tiles[0]!.htmlBundle).toEqual({ artifactId: "a", version: 1, kind: "bundle" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/viewer/src/normalize.test.ts`
Expected: FAIL (`platform`/`bundlePath` not on input type; htmlBundle always `kind:"bundle"`).

- [ ] **Step 3: Implement**

In `packages/viewer/src/model.ts`, add optional fields to `ViewerTile` (after `height`):
```ts
  /** 设备平台,驱动 tile 头部平台图标。component-library 单元复用产品 platform。 */
  platform?: string;
```
In `packages/viewer/src/normalize.ts`, extend `NormalizeArtifactInput`:
```ts
  width: number;
  height: number;
  /** 设备平台(可选);透传到 tile 用于平台图标。 */
  platform?: string;
  /** bundle 内子文档相对路径;设了则 htmlBundle 解析为该 asset 而非 bundle 入口。 */
  bundlePath?: string;
```
In `buildViewerModel`, change the tile mapping:
```ts
  const tiles: ViewerTile[] = input.artifacts.map((a) => ({
    id: tileId(a),
    kind: a.kind,
    pageId: a.pageId,
    pageName: a.pageName,
    variant: a.variant,
    title: a.title,
    version: a.version,
    width: a.width,
    height: a.height,
    ...(a.platform !== undefined ? { platform: a.platform } : {}),
    htmlBundle:
      a.bundlePath !== undefined
        ? { artifactId: a.artifactId, version: a.version, kind: "asset", path: a.bundlePath }
        : { artifactId: a.artifactId, version: a.version, kind: "bundle" },
    previewImages: buildPreviewRefs(a),
  }));
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/viewer/src/normalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src/model.ts packages/viewer/src/normalize.ts packages/viewer/src/normalize.test.ts
git commit -m "feat(viewer): carry platform + bundlePath on tiles (asset htmlBundle)"
```

### Task A2: `PlatformIcon` component

**Files:**
- Create: `packages/viewer/src/tiles/PlatformIcon.tsx`
- Test: `packages/viewer/src/tiles/PlatformIcon.browser.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect } from "vitest";
import { PlatformIcon } from "./PlatformIcon.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PlatformIcon", () => {
  it("renders an svg with a data-platform marker, defaulting unknown to web", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<PlatformIcon platform="mobile" />));
    expect(container.querySelector("svg[data-platform='mobile']")).not.toBeNull();
    act(() => root.render(<PlatformIcon platform={undefined} />));
    expect(container.querySelector("svg[data-platform='web']")).not.toBeNull();
    act(() => root.unmount());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/viewer/src/tiles/PlatformIcon.browser.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```tsx
// packages/viewer/src/tiles/PlatformIcon.tsx
type Platform = "mobile" | "tablet" | "desktop" | "web";

function normalize(platform: string | undefined): Platform {
  return platform === "mobile" || platform === "tablet" || platform === "desktop" ? platform : "web";
}

const PATHS: Record<Platform, string> = {
  mobile: "M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5Zm2.5 14.5h3",
  tablet: "M6.5 4h11A1.5 1.5 0 0 1 19 5.5v13A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5v-13A1.5 1.5 0 0 1 6.5 4Zm4.5 14h2",
  desktop: "M4.5 5.5h15v9h-15zM9 19h6M12 14.5V19",
  web: "M4.5 5.5h15v13h-15zM4.5 9h15",
};

/** Platform glyph for a tile header. Unknown/absent → web. */
export function PlatformIcon({ platform, size = 14 }: { platform: string | undefined; size?: number }): React.ReactElement {
  const p = normalize(platform);
  return (
    <svg aria-hidden="true" data-platform={p} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d={PATHS[p]} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/viewer/src/tiles/PlatformIcon.browser.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src/tiles/PlatformIcon.tsx packages/viewer/src/tiles/PlatformIcon.browser.test.tsx
git commit -m "feat(viewer): add PlatformIcon glyph component"
```

### Task A3: Tile header (platform icon + name) + `#4f46e5` selection

**Files:**
- Modify: `packages/viewer/src/Canvas.tsx:42-100` (SelectionFrame + TileNodeComponent)
- Test: `packages/viewer/src/Canvas.browser.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `packages/viewer/src/Canvas.browser.test.tsx` (inside `describe("Canvas")`):
```tsx
  it("tile header shows a platform icon and selection frame uses the theme color", async () => {
    const model = buildViewerModel({
      entry: "page",
      artifacts: [
        { artifactId: "a", kind: "design-page", pageId: "p", pageName: "P", variant: "default",
          title: "登录页", version: 1, width: 390, height: 844, platform: "mobile" },
      ],
    });
    const first = model.tiles[0]!;
    const container = render(<Canvas model={model} mode="design" resolver={resolver} defaultSelectedTileId={first.id} />);
    await act(async () => { await sleep(50); });
    const title = container.querySelector("[data-testid='tile-title']")!;
    expect(title.querySelector("svg[data-platform='mobile']")).not.toBeNull();
    expect(title.textContent).toContain("登录页");
    const frame = container.querySelector("[data-testid='selection-frame']") as HTMLElement;
    expect(frame.style.borderColor).toBe("rgb(79, 70, 229)"); // #4f46e5
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/viewer/src/Canvas.browser.test.tsx`
Expected: FAIL (no svg in title; border is `#1d4ed8`).

- [ ] **Step 3: Implement**

In `packages/viewer/src/Canvas.tsx`, add import:
```ts
import { PlatformIcon } from "./tiles/PlatformIcon.js";
```
Change `SelectionFrame` border + shadow to the theme color:
```tsx
        border: "2px solid #4f46e5",
        background: "rgba(79,70,229,0.10)",
        pointerEvents: "none",
        boxShadow: "0 0 0 1px rgba(79,70,229,0.18)",
```
Replace the title `<div>` body (the `{data.tile.title}` expression) so the label is `[icon] name`, and make the wrapper a flex row. Replace lines `66-86` with:
```tsx
        <div
          data-testid="tile-title"
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            marginBottom: 6,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 500,
            lineHeight: "1.4",
            color: selected ? "#4f46e5" : "#52525b",
            maxWidth: 280,
            overflow: "hidden",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          <span style={{ display: "inline-flex", flexShrink: 0 }}>
            <PlatformIcon platform={data.tile.platform} />
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {data.tile.title}
          </span>
        </div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/viewer/src/Canvas.browser.test.tsx`
Expected: PASS (existing `pointerEvents:none` + component-library interactive tests still green).

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src/Canvas.tsx packages/viewer/src/Canvas.browser.test.tsx
git commit -m "feat(viewer): tile header platform icon + #4f46e5 selection frame"
```

### Task A4: Figma trackpad gestures (two-finger pan + pinch zoom)

**Files:**
- Modify: `packages/viewer/src/Canvas.tsx:150-168` (ReactFlow props)
- Test: `packages/viewer/src/Canvas.gestures.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

`@xyflow/react` does not expose gesture config on the DOM, so assert the props object we pass. Refactor the props into an exported constant and test it.

Create `packages/viewer/src/Canvas.gestures.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { CANVAS_INTERACTION_PROPS } from "./Canvas.js";

describe("CANVAS_INTERACTION_PROPS", () => {
  it("pans on two-finger scroll and zooms on pinch (Figma standard)", () => {
    expect(CANVAS_INTERACTION_PROPS.panOnScroll).toBe(true);
    expect(CANVAS_INTERACTION_PROPS.panOnScrollMode).toBe("free");
    expect(CANVAS_INTERACTION_PROPS.zoomOnScroll).toBe(false);
    expect(CANVAS_INTERACTION_PROPS.zoomOnPinch).toBe(true);
    expect(CANVAS_INTERACTION_PROPS.panOnDrag).toBe(true);
    expect(CANVAS_INTERACTION_PROPS.zoomOnDoubleClick).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/viewer/src/Canvas.gestures.test.tsx`
Expected: FAIL (`CANVAS_INTERACTION_PROPS` not exported).

- [ ] **Step 3: Implement**

In `packages/viewer/src/Canvas.tsx`, add near the top (after imports):
```ts
/** 画布交互手势:双指拖=平移,捏合/Cmd+滚轮=缩放,左键拖=平移(Figma 标准,对齐标注页)。 */
export const CANVAS_INTERACTION_PROPS = {
  panOnScroll: true,
  panOnScrollMode: "free",
  zoomOnScroll: false,
  zoomOnPinch: true,
  panOnDrag: true,
  zoomOnDoubleClick: false,
} as const;
```
Replace the `<ReactFlow>` gesture props (`panOnDrag zoomOnScroll panOnScroll={false}`) with a spread + keep min/max zoom:
```tsx
    <ReactFlow
      nodes={nodes}
      onNodesChange={onNodesChange}
      edges={[]}
      nodeTypes={nodeTypes}
      onlyRenderVisibleElements
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      {...CANVAS_INTERACTION_PROPS}
      minZoom={0.1}
      maxZoom={4}
      proOptions={{ hideAttribution: false }}
    >
```
Note: `panOnScrollMode` value `"free"` is `PanOnScrollMode.Free`; the string literal is accepted by `@xyflow/react` v12 prop typing.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/viewer/src/Canvas.gestures.test.tsx packages/viewer/src/Canvas.browser.test.tsx`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src/Canvas.tsx packages/viewer/src/Canvas.gestures.test.tsx
git commit -m "feat(viewer): Figma trackpad gestures (two-finger pan, pinch zoom)"
```

---

## Part B — Full-screen canvas shell (web)

### Task B1: `chrome` flag on routes + i18n type keys

**Files:**
- Modify: `packages/web/src/routes.tsx` (RouteDefinition + 3 canvas routes)
- Modify: `packages/web/src/i18n.ts`
- Test: `packages/web/src/routes.test.tsx` (append) — if absent, assert in `App.test.tsx` instead

- [ ] **Step 1: Write the failing test**

Append to `packages/web/src/routes.test.tsx`:
```tsx
import { routeTable } from "./routes.js";

it("marks the three canvas routes as full-screen chrome", () => {
  const paths = routeTable.filter((r) => r.chrome === "fullscreen").map((r) => r.path).sort();
  expect(paths).toEqual(
    [
      "/products/:productId/brand",
      "/products/:productId/requirements/:reqId/annotation",
      "/products/:productId/requirements/:reqId/design",
    ].sort(),
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/web/src/routes.test.tsx`
Expected: FAIL (`chrome` not a field).

- [ ] **Step 3: Implement**

In `packages/web/src/routes.tsx`, add to `RouteDefinition`:
```ts
  /** "fullscreen" renders the page outside the sidebar Layout (canvas pages). */
  chrome?: "fullscreen";
```
Add `chrome: "fullscreen"` to the three route entries whose components are `BrandResourcesRoute`, `DesignViewRoute`, `AnnotationPageRoute` (the `/brand`, `/requirements/:reqId/design`, `/requirements/:reqId/annotation` entries).

In `packages/web/src/i18n.ts`, add to the `en` map and the `zh` map:
```ts
// en
"canvas.type.brand": "Brand resources",
"canvas.type.design": "Design",
"canvas.type.annotation": "Annotation",
"canvas.back": "Back",
// zh
"canvas.type.brand": "品牌资源",
"canvas.type.design": "设计稿",
"canvas.type.annotation": "标注",
"canvas.back": "返回",
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/web/src/routes.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/routes.tsx packages/web/src/i18n.ts packages/web/src/routes.test.tsx
git commit -m "feat(web): chrome:fullscreen route flag + canvas type i18n"
```

### Task B2: `CanvasShell` component

**Files:**
- Create: `packages/web/src/components/CanvasShell.tsx`
- Test: `packages/web/src/components/CanvasShell.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect } from "vitest";
import { LocaleProvider } from "../LocaleContext.js";
import { CanvasShell } from "./CanvasShell.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CanvasShell", () => {
  it("renders a back link, product name and type name, plus children", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <LocaleProvider>
          <CanvasShell backHref="/products/P1" productName="计算器" typeName="品牌资源">
            <div data-testid="canvas-body" />
          </CanvasShell>
        </LocaleProvider>,
      ),
    );
    const back = container.querySelector("a[href='/products/P1']")!;
    expect(back).not.toBeNull();
    expect(container.textContent).toContain("计算器");
    expect(container.textContent).toContain("品牌资源");
    expect(container.querySelector("[data-testid='canvas-body']")).not.toBeNull();
    act(() => root.unmount());
    container.remove();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/web/src/components/CanvasShell.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```tsx
// packages/web/src/components/CanvasShell.tsx
import type { ReactNode } from "react";
import { useT } from "../LocaleContext.js";

export interface CanvasShellProps {
  backHref: string;
  productName: string;
  typeName: string;
  children: ReactNode;
}

const focusClasses =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

/** Full-screen canvas wrapper: a thin top bar (back + product · type) over a flood-fill body. */
export function CanvasShell({ backHref, productName, typeName, children }: CanvasShellProps) {
  const t = useT();
  return (
    <div className="flex h-screen flex-col bg-[#f7f8fa] text-zinc-950">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-200 bg-[#fdfdfd] px-3">
        <a
          aria-label={t("canvas.back")}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-700 transition hover:bg-zinc-200/80 hover:text-zinc-950 active:scale-95 ${focusClasses}`}
          href={backHref}
        >
          <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
            <path d="M14.5 6 9 12l5.5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-zinc-950">{productName}</span>
          <span className="text-zinc-300">·</span>
          <span className="shrink-0 text-sm font-medium text-zinc-500">{typeName}</span>
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/web/src/components/CanvasShell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/CanvasShell.tsx packages/web/src/components/CanvasShell.test.tsx
git commit -m "feat(web): CanvasShell full-screen top bar"
```

### Task B3: Render fullscreen routes without `<Layout>`

**Files:**
- Modify: `packages/web/src/App.tsx`
- Test: `packages/web/src/App.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `packages/web/src/App.test.tsx` (follow the file's existing render harness; this asserts a fullscreen route omits the sidebar `aside`):
```tsx
it("renders fullscreen canvas routes without the sidebar Layout", async () => {
  window.history.pushState({}, "", "/products/P1/brand");
  const container = renderApp(); // existing helper in this test file
  await flush();                  // existing helper
  expect(container.querySelector("aside")).toBeNull();
  expect(container.querySelector("[data-testid='canvas-shell']")).not.toBeNull();
});
```
(If `App.test.tsx` lacks `renderApp`/`flush` helpers, mirror the render pattern already used by the nearest existing test in that file.)

Also add `data-testid="canvas-shell"` to `CanvasShell`'s root `<div>` from Task B2 (update its test's root query is unaffected).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/web/src/App.test.tsx`
Expected: FAIL (sidebar still rendered for `/brand`).

- [ ] **Step 3: Implement**

In `packages/web/src/components/CanvasShell.tsx`, add `data-testid="canvas-shell"` to the root `<div>`.

In `packages/web/src/App.tsx`, change `AppShell` to branch on `chrome`:
```tsx
import { CanvasShell } from "./components/CanvasShell.js";
import { canvasShellMeta } from "./routes.js";
```
Inside `AppShell`, before building breadcrumbs:
```tsx
  if (match.route.chrome === "fullscreen") {
    const meta = canvasShellMeta(match, t, breadcrumbLabels);
    return (
      <CanvasShell backHref={meta.backHref} productName={meta.productName} typeName={meta.typeName}>
        <Page
          hash={match.hash}
          navigationState={match.navigationState}
          onBreadcrumbLabel={onBreadcrumbLabel}
          params={match.params}
          route={match.route}
        />
      </CanvasShell>
    );
  }
```

In `packages/web/src/routes.tsx`, export a helper:
```ts
export function canvasShellMeta(
  match: RouteMatch,
  t: (key: string) => string,
  labels: Record<string, string>,
): { backHref: string; productName: string; typeName: string } {
  const pid = match.params.productId ?? "";
  const reqId = match.params.reqId ?? "";
  const productName = labels[`product:${pid}`] ?? pid;
  const enc = encodeURIComponent;
  if (match.route.path === "/products/:productId/brand") {
    return { backHref: `/products/${enc(pid)}`, productName, typeName: t("canvas.type.brand") };
  }
  if (match.route.path === "/products/:productId/requirements/:reqId/annotation") {
    return {
      backHref: `/products/${enc(pid)}/requirements/${enc(reqId)}`,
      productName,
      typeName: t("canvas.type.annotation"),
    };
  }
  return {
    backHref: `/products/${enc(pid)}/requirements/${enc(reqId)}`,
    productName,
    typeName: t("canvas.type.design"),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/web/src/App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/routes.tsx packages/web/src/components/CanvasShell.tsx packages/web/src/App.test.tsx
git commit -m "feat(web): render canvas routes full-screen via CanvasShell"
```

### Task B4: Strip inline top bars + full-bleed canvases + report product name

**Files:**
- Modify: `packages/web/src/routes.tsx`
- Modify: `packages/web/src/pages/DesignView.tsx`
- Modify: `packages/web/src/pages/BrandResources.tsx`
- Modify: `packages/web/src/pages/AnnotationPage.tsx`
- Test: existing `DesignView.test.tsx`, `BrandResources.test.tsx`, `AnnotationPage` tests, plus route wrapper coverage in `routes.test.tsx` or `App.test.tsx`

- [ ] **Step 1: Write the failing test**

In `packages/web/src/pages/DesignView.test.tsx`, add:
```tsx
it("reports the product name for the canvas shell and has no inline back link", async () => {
  const labels: Record<string, string> = {};
  const onBreadcrumbLabel = (k: string, v: string) => { labels[k] = v; };
  // render DesignView with a client whose getProduct returns { name: "计算器", platform: "mobile", ... }
  // ...existing harness...
  await flush();
  expect(labels["product:P1"]).toBe("计算器");
  // inline "← back to requirement" link removed (shell owns navigation)
  expect(container.querySelector("a[href$='/requirements/R1']")).toBeNull();
});
```
(Mirror the file's existing client/builder harness for DesignView; add `onBreadcrumbLabel` to the props it passes.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/web/src/pages/DesignView.test.tsx`
Expected: FAIL (inline back link present; name not reported).

- [ ] **Step 3: Implement**

`DesignView.tsx`:
- Add `onBreadcrumbLabel?` to `DesignViewProps` and call it once product loads:
  ```ts
  props.onBreadcrumbLabel?.(`product:${productId}`, product.name);
  ```
  (thread `onBreadcrumbLabel` from the route props; `DesignViewRoute` in routes.tsx already receives `RoutePageProps` which carries it — pass it through.)
- Replace the outer wrapper `return (...)` so it drops the inline top bar (lines `96-105`) and fills the shell:
  ```tsx
  return (
    <div className="relative h-full w-full overflow-hidden bg-white">
      {state.status === "empty" ? (
        <div className="flex h-full items-center justify-center p-8">
          <div className="w-full max-w-md">
            <StatePanel state="empty" title={t("design.view")}>
              {state.uiAffected ? t("design.canvasEmpty") : t("design.noUiChanges")}
            </StatePanel>
          </div>
        </div>
      ) : (
        <Canvas model={state.model} mode="design" resolver={resolver} />
      )}
    </div>
  );
  ```
- Thread `platform` into the model: in the `mapArtifactsToViewerInputs` call, the mapper already sets width/height per platform; extend it (Task E precondition) to also set `platform: product.platform`. For Part B, add `platform` in `mapArtifactsToViewerInputs` now:
  in `packages/web/src/viewer/mapArtifacts.ts`, inside the pushed object add `...(input.platform !== undefined ? { platform: input.platform } : {})`.

`routes.tsx`:
- Thread the shell label callback through all three canvas route wrappers so product names can reach `CanvasShell`:
  ```tsx
  function AnnotationPageRoute(props: RoutePageProps) {
    return <AnnotationPage client={apiClient} onBreadcrumbLabel={props.onBreadcrumbLabel} params={props.params as { productId: string; reqId: string }} />;
  }

  function BrandResourcesRoute(props: RoutePageProps) {
    return <BrandResources client={apiClient} onBreadcrumbLabel={props.onBreadcrumbLabel} params={props.params} />;
  }

  function DesignViewRoute(props: RoutePageProps) {
    return <DesignView client={apiClient} onBreadcrumbLabel={props.onBreadcrumbLabel} params={props.params} />;
  }
  ```
- Add a focused route-wrapper test that renders brand and annotation routes through the existing `App`/route harness and proves `breadcrumbLabels["product:<id>"]` is populated from `getProduct`, not left as the raw product id.

`BrandResources.tsx`:
- Add `onBreadcrumbLabel?` to props; call `props.onBreadcrumbLabel?.(`product:${productId}`, product.name)` after `getProduct`.
- Remove the standalone product-icon `<img>` block (lines `139-149`) — the icon becomes a canvas tile in Part E. Replace the ready `return` with a full-bleed canvas:
  ```tsx
  return (
    <div className="relative h-full w-full overflow-hidden bg-white">
      <Canvas model={state.model} mode="design" resolver={resolver} />
    </div>
  );
  ```
  (Remove now-unused `iconUrl` state field + its derivation; keep `ViewState` `ready` as `{ status: "ready"; model }`.)

`AnnotationPage.tsx`:
- Add `onBreadcrumbLabel?` to props; fetch the product name (client has `getProduct`) and report it. After `getRequirementHandoff` succeeds, also `void client.getProduct(productId).then((p) => props.onBreadcrumbLabel?.(`product:${productId}`, p.name)).catch(() => {})`.
- Remove the inline top bar (`293-301`) and make the canvas container fill: change the outer `<div className="flex h-[calc(100vh-8rem)] flex-col gap-2">` to `<div className="relative h-full w-full">` and drop the back `<a>`/page-count `<span>` row. Keep the error/empty `StatePanel` branches (their inline back links can stay; shell also has one — acceptable, or remove for consistency).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/web/src/pages/DesignView.test.tsx packages/web/src/pages/BrandResources.test.tsx`
Expected: PASS. Fix any test that asserted the removed inline top bars.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/routes.tsx packages/web/src/pages/DesignView.tsx packages/web/src/pages/BrandResources.tsx packages/web/src/pages/AnnotationPage.tsx packages/web/src/viewer/mapArtifacts.ts packages/web/src/pages/DesignView.test.tsx
git commit -m "feat(web): full-bleed canvases, drop inline top bars, report product name + platform"
```

---

## Part C — Annotation parity (CanvasKit)

### Task C1: Platform icon + theme-color focus label in `PageFrameOverlays`

**Files:**
- Modify: `packages/web/src/pages/AnnotationPage.tsx:449-499` (`PageFrameOverlays`) + `toAdapterInput`/frame to carry platform
- Test: `packages/web/src/pages/AnnotationPage` test (the existing overlay test file)

- [ ] **Step 1: Write the failing test**

In the AnnotationPage overlay test, assert a focused frame label renders the platform icon and uses indigo when focused:
```tsx
// Given a ready annotation page with platform "mobile", the focused page label
// contains an svg[data-platform='mobile'] and text-indigo-600 class.
expect(label.querySelector("svg[data-platform='mobile']")).not.toBeNull();
expect(label.className).toContain("text-indigo-600");
```
(Use the file's existing harness to reach a focused frame; if none, add a minimal one selecting an element to focus its page.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/web/src/pages/AnnotationPage` (the overlay test path)
Expected: FAIL (no icon; focused color is `text-blue-700`).

- [ ] **Step 3: Implement**

- Pass `platform` to `PageFrameOverlays`: `AnnotationPage` already has `product`? No — fetch in C/B4 already adds a product fetch for the name; capture platform in state too (`const [platform, setPlatform] = useState<string>()` set in the same `getProduct` callback).
- Add `platform?: string` param to `PageFrameOverlays` and import `PlatformIcon` from `@xenonbyte/forma-viewer` (export it from the viewer index — see Step 3b).
- In the focused (non-error) label JSX, wrap with an inline-flex row: `<PlatformIcon platform={platform} />` + the title span; change focused class from `text-blue-700` to `text-indigo-600` and unfocused stays `text-zinc-600`.

Step 3b — export `PlatformIcon` from viewer: add to `packages/viewer/src/index.ts`:
```ts
export { PlatformIcon } from "./tiles/PlatformIcon.js";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/web/src/pages/AnnotationPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/AnnotationPage.tsx packages/viewer/src/index.ts
git commit -m "feat(web): annotation page labels gain platform icon + indigo focus"
```

### Task C2: Confirm annotation two-finger pan matches Figma feel

**Files:**
- Read-only check: `packages/web/src/pages/AnnotationPage.tsx:330-345` (`CanvasKitSurface panOnPrimaryDrag`)

- [ ] **Step 1: Verify gesture parity (no code unless mismatch)**

`CanvasKitSurface` already takes `panOnPrimaryDrag` (left-drag pan) and handles wheel for pan + ctrl/⌘-wheel zoom. Run the app (`pnpm dev:web`), open an annotation page, confirm two-finger = pan and pinch = zoom. If the surface zooms on plain two-finger (mismatch with React Flow), add the surface's pan-on-scroll prop (check `@vzi-core/renderer` `CanvasKitSurfaceProps`); otherwise no change.

- [ ] **Step 2: Commit only if changed**

```bash
git add packages/web/src/pages/AnnotationPage.tsx
git commit -m "fix(web): align annotation trackpad pan/zoom with canvas"
```

---

## Part D — Component library contract (backend, composition)

### Task D1: `forma.units` manifest type + validation

**Files:**
- Modify: `packages/core/src/artifact-manifest.ts`
- Test: `packages/core/tests/artifact-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/tests/artifact-manifest.test.ts`:
```ts
it("accepts forma.units with entries ⊆ supportingFiles and unique ids", () => {
  const r = validateArtifactManifest({
    version: 1, id: "A1b2C3d4E5f6G7h8", kind: "component-library", renderer: "html",
    title: "Lib", entry: "index.html", status: "complete",
    exports: ["index.html"],
    supportingFiles: ["index.html", "tokens.css", "unit-foundations.html", "unit-button.html"],
    createdAt: "t", updatedAt: "t",
    forma: { units: [
      { id: "foundations", title: "Foundations", role: "foundations", entry: "unit-foundations.html", width: 520, height: 720 },
      { id: "button", title: "Button", role: "component", entry: "unit-button.html", width: 320, height: 420 },
    ] },
  });
  expect(r.ok).toBe(true);
});

it("rejects forma.units entry not in supportingFiles", () => {
  const r = validateArtifactManifest({
    version: 1, id: "A1b2C3d4E5f6G7h8", kind: "component-library", renderer: "html",
    title: "Lib", entry: "index.html", status: "complete", exports: ["index.html"],
    supportingFiles: ["index.html"], createdAt: "t", updatedAt: "t",
    forma: { units: [{ id: "x", title: "X", role: "component", entry: "unit-x.html" }] },
  });
  expect(r.ok).toBe(false);
});

it("rejects duplicate unit ids", () => {
  const r = validateArtifactManifest({
    version: 1, id: "A1b2C3d4E5f6G7h8", kind: "component-library", renderer: "html",
    title: "Lib", entry: "index.html", status: "complete", exports: ["index.html"],
    supportingFiles: ["index.html", "unit-a.html"], createdAt: "t", updatedAt: "t",
    forma: { units: [
      { id: "a", title: "A", role: "component", entry: "unit-a.html" },
      { id: "a", title: "A2", role: "component", entry: "unit-a.html" },
    ] },
  });
  expect(r.ok).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/tests/artifact-manifest.test.ts`
Expected: FAIL (`forma.units` not validated; passes through but supportingFiles check missing → first test may pass, the reject tests FAIL).

- [ ] **Step 3: Implement**

In `packages/core/src/artifact-manifest.ts`:
Add the type:
```ts
const UNIT_ROLES = ["foundations", "icon", "component"] as const;

export interface ArtifactComponentUnit {
  /** Stable slug, unique within the library. */
  id: string;
  /** Display name shown on the tile header. */
  title: string;
  role: (typeof UNIT_ROLES)[number];
  /** Bundle-relative HTML for this unit (⊆ supportingFiles). */
  entry: string;
  /** Intrinsic tile size; viewer falls back to platform default when absent. */
  width?: number;
  height?: number;
}
```
Add `units?: ArtifactComponentUnit[];` to `ArtifactFormaExtension`.
In `validateFormaExtension`, after the `assets` block, add:
```ts
  if (f["units"] !== undefined) {
    if (!Array.isArray(f["units"])) {
      return { ok: false, error: "forma.units must be an array" };
    }
    const seen = new Set<string>();
    for (const u of f["units"] as unknown[]) {
      if (typeof u !== "object" || u === null || Array.isArray(u)) {
        return { ok: false, error: "forma.units entry must be an object" };
      }
      const unit = u as Record<string, unknown>;
      if (typeof unit["id"] !== "string" || unit["id"].length === 0) {
        return { ok: false, error: "forma.units id must be a non-empty string" };
      }
      if (seen.has(unit["id"])) {
        return { ok: false, error: `forma.units id is duplicated: ${unit["id"]}` };
      }
      seen.add(unit["id"]);
      if (typeof unit["title"] !== "string" || unit["title"].length === 0) {
        return { ok: false, error: "forma.units title must be a non-empty string" };
      }
      if (!(UNIT_ROLES as readonly string[]).includes(unit["role"] as string)) {
        return { ok: false, error: `forma.units role must be one of: ${UNIT_ROLES.join(", ")}` };
      }
      if (validateSupportingPath(unit["entry"]) === null) {
        return { ok: false, error: `forma.units entry invalid: ${String(unit["entry"])}` };
      }
      for (const dim of ["width", "height"] as const) {
        if (unit[dim] !== undefined && (typeof unit[dim] !== "number" || (unit[dim] as number) <= 0)) {
          return { ok: false, error: `forma.units ${dim} must be a positive number` };
        }
      }
    }
  }
```
In `validateArtifactManifest`, after the `productIcon` ⊆ supportingFiles check (inside `if (m["forma"] !== undefined)` block, after the productIcon block), add a units ⊆ supportingFiles check:
```ts
    const units = formaResult.value.units;
    if (units !== undefined) {
      for (const unit of units) {
        if (!supportingFileIndex.has(unit.entry)) {
          return { ok: false, error: `forma.units entry missing from supportingFiles: ${unit.entry}` };
        }
      }
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/tests/artifact-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/artifact-manifest.ts packages/core/tests/artifact-manifest.test.ts
git commit -m "feat(core): forma.units manifest type + validation"
```

### Task D2: `design-save` composes index.html + per-unit files + forma.units

**Files:**
- Modify: `packages/core/src/design-save.ts`
- Test: `packages/core/tests/design-save.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/tests/design-save.test.ts` (mirror its existing `saveDesignArtifact` harness/deps):
```ts
it("composes a combined index.html + per-unit files and records forma.units", async () => {
  const result = await saveDesignArtifact(deps, {
    productId: "P-x", kind: "component-library", title: "Lib",
    tokensCss: ":root{--fg:#111}\n.btn{color:var(--fg)}",
    units: [
      { id: "foundations", title: "Foundations", role: "foundations", bodyHtml: "<section data-od-id=\"foundations\"><h2>Color</h2></section>" },
      { id: "button", title: "Button", role: "component", bodyHtml: "<section data-od-id=\"components\"><button class=\"btn\">A</button></section>" },
    ],
    forma: { brandStyle: "apple", platform: "mobile" },
  });
  const dir = artifactVersionDir(deps, "P-x", result.artifactId, result.version); // test helper
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  expect(manifest.entry).toBe("index.html");
  expect(manifest.forma.units.map((u: any) => u.entry)).toEqual(["unit-foundations.html", "unit-button.html"]);
  const tokens = await readFile(join(dir, "tokens.css"), "utf8");
  expect(tokens).toContain("--fg:#111");
  const indexHtml = await readFile(join(dir, "index.html"), "utf8");
  expect(indexHtml).toContain("Color");
  expect(indexHtml).toContain("class=\"btn\"");
  expect(indexHtml).toContain("href=\"tokens.css\"");
  const unitBtn = await readFile(join(dir, "unit-button.html"), "utf8");
  expect(unitBtn).toContain("class=\"btn\"");
  expect(unitBtn).not.toContain("Color"); // only this unit's body
});
```

Add security regression tests in the same file:
```ts
// tokens.css is NOT routed through localizeArtifactAssets; it is scanned by
// validateStaticArtifact (cssFiles), whose remote-url() violation surfaces as
// ARTIFACT_NOT_STATIC.
it("rejects unsafe urls in tokensCss before writing unit files", async () => {
  await expect(
    saveDesignArtifact(deps, {
      productId: "P-x", kind: "component-library", title: "Lib",
      tokensCss: ".card{background:url(https://example.com/card.png)}",
      units: [{ id: "button", title: "Button", role: "component", bodyHtml: "<section>Button</section>" }],
      forma: { brandStyle: "apple", platform: "mobile" },
    }),
  ).rejects.toMatchObject({ code: "ARTIFACT_NOT_STATIC" });
});

// A remote ref in a unit body is rejected by localizeArtifactAssets' rejectRemote
// (on the composed index.html, which concatenates every unit body) BEFORE
// validateStaticArtifact runs — so the code is ARTIFACT_REMOTE_RESOURCE.
it("localizes and validates every generated unit document, not only index.html", async () => {
  await expect(
    saveDesignArtifact(deps, {
      productId: "P-x", kind: "component-library", title: "Lib",
      tokensCss: ":root{--fg:#111}",
      units: [{ id: "button", title: "Button", role: "component", bodyHtml: "<img src=\"https://example.com/bad.png\">" }],
      forma: { brandStyle: "apple", platform: "mobile" },
    }),
  ).rejects.toMatchObject({ code: "ARTIFACT_REMOTE_RESOURCE" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/tests/design-save.test.ts`
Expected: FAIL (`tokensCss`/`units` not on `SaveDesignInput`).

- [ ] **Step 3: Implement**

In `packages/core/src/design-save.ts`:
Add input types + extend `SaveDesignInput`:
```ts
export interface ComponentUnitInput {
  id: string;
  title: string;
  role: "foundations" | "icon" | "component";
  /** Pure markup fragment (no <html>/<head>); styled only via shared tokens.css classes. */
  bodyHtml: string;
  width?: number;
  height?: number;
}
```
On `SaveDesignInput`, make `html` optional and add unit inputs:
```ts
  /** Single-document HTML (design-page, and legacy single-doc libraries). */
  html?: string;
  /** Component-library decomposition: shared CSS written to tokens.css. */
  tokensCss?: string;
  /** Component-library decomposition: ordered units → per-unit HTML + forma.units. */
  units?: ComponentUnitInput[];
```
Add a slug guard + composition helpers near the other helpers:
```ts
const UNIT_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

function composeUnitDocument(tokensHref: string, bodyHtml: string, title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="${tokensHref}"></head><body>${bodyHtml}</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
```
At the top of `saveDesignArtifact`, before Step 1, normalize the html source — if `units` provided, compose `localInput.html`:
```ts
  let html = input.html;
  let composedUnits: { id: string; title: string; role: ComponentUnitInput["role"]; entry: string; width?: number; height?: number; doc: string }[] = [];
  let tokensFile: Buffer | undefined;
  if (input.units && input.units.length > 0) {
    if (input.kind !== "component-library") {
      throw new FormaError("INVALID_INPUT", "units is only valid for component-library", {});
    }
    if (input.tokensCss === undefined) {
      throw new FormaError("INVALID_INPUT", "units requires tokensCss", {});
    }
    const seen = new Set<string>();
    for (const u of input.units) {
      if (!UNIT_ID_REGEX.test(u.id)) throw new FormaError("INVALID_INPUT", `unit id invalid: ${u.id}`, { id: u.id });
      if (seen.has(u.id)) throw new FormaError("INVALID_INPUT", `unit id duplicated: ${u.id}`, { id: u.id });
      seen.add(u.id);
    }
    tokensFile = Buffer.from(input.tokensCss, "utf8");
    composedUnits = input.units.map((u) => ({
      id: u.id, title: u.title, role: u.role, entry: `unit-${u.id}.html`,
      ...(u.width !== undefined ? { width: u.width } : {}),
      ...(u.height !== undefined ? { height: u.height } : {}),
      doc: composeUnitDocument("tokens.css", u.bodyHtml, u.title),
    }));
    const combinedBody = input.units.map((u) => u.bodyHtml).join("\n");
    html = composeUnitDocument("tokens.css", combinedBody, input.title);
  }
  if (html === undefined) {
    throw new FormaError("INVALID_INPUT", "either html or units must be provided", {});
  }
```
Replace every later use of `input.html`/`html` in the function with this local `html`, but do **not** validate only the composed `index.html`. Unit output must stay inside the same static-safety boundary:
- Run `localizeArtifactAssets({ html })` for the composed index as today.
- Also run `localizeArtifactAssets({ html: u.doc })` for every `composedUnits` entry.
- Merge each localization pass's `files` into the shared localized file map after `assertNoSupportingFileCollision(...)`, so any downloaded/localized assets referenced by unit documents are persisted with the bundle.
- Store each unit's **localized** document text, for example `localizedUnitDocs.set(u.entry, unitLocalized.html)`. Never write the pre-localization `u.doc` to `finalFiles`.
- Add `tokens.css` to `cssFiles` before `validateStaticArtifact`, using `decodeUtf8(tokensFile, "tokens.css")`, so remote/data/javascript CSS references are rejected.
- Run `validateStaticArtifact` for the composed `localizedHtml` and for every localized unit document, all with the same `svgFiles` and `cssFiles`. Throw `ARTIFACT_NOT_STATIC` if any document or CSS file violates the pure-static policy.

In Step 5 (build final file set), after merging caller files, write tokens + unit docs:
```ts
  if (tokensFile !== undefined) {
    finalFiles.set("tokens.css", tokensFile);
    for (const u of composedUnits) {
      const localizedDoc = localizedUnitDocs.get(u.entry);
      if (localizedDoc === undefined) {
        // Internal invariant (every composed unit was localized above). There is no
        // INTERNAL code in the FormaError enum; ARTIFACT_WRITE_FAIL is the closest fit.
        throw new FormaError("ARTIFACT_WRITE_FAIL", `missing localized unit document: ${u.entry}`, { entry: u.entry });
      }
      finalFiles.set(u.entry, Buffer.from(localizedDoc, "utf8"));
    }
  }
```
In Step 6 (build `formaExtension`), add units:
```ts
    ...(composedUnits.length > 0
      ? { units: composedUnits.map(({ id, title, role, entry, width, height }) => ({ id, title, role, entry, ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) })) }
      : {}),
```
(Note: `tokens.css`, localized unit files, and localized unit assets are auto-included in `supportingFiles` because that array is `Array.from(finalFiles.keys())`.) Also ensure the temp preview dir writes `tokens.css` so the combined `index.html` resolves shared styles during preview render — add after `writeBundleFiles(tempDir, callerFiles)`:
```ts
    if (tokensFile !== undefined) {
      await writeFile(join(tempDir, "tokens.css"), tokensFile);
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/tests/design-save.test.ts`
Expected: PASS. Existing single-`html` design-page tests stay green (units path is opt-in).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/design-save.ts packages/core/tests/design-save.test.ts
git commit -m "feat(core): design-save composes component-library units (index.html + unit files + forma.units)"
```

### Task D3: `store.generateComponents` accepts units

**Files:**
- Modify: `packages/core/src/store.ts` (`GenerateComponentsInput` + the `saveDesignArtifact` call)
- Test: `packages/core/tests/store-design-mutations.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/tests/store-design-mutations.test.ts`:
```ts
it("generateComponents persists units and sets the designSystem pointer", async () => {
  const store = await createTestStore(); // existing helper
  const productId = await seedProduct(store, { platform: "mobile" }); // existing helper
  const res = await store.generateComponents(productId, {
    title: "Lib", brandStyle: "apple",
    tokensCss: ":root{--fg:#111}",
    units: [{ id: "foundations", title: "Foundations", role: "foundations", bodyHtml: "<section><h2>Color</h2></section>" }],
  });
  expect(res.version).toBe(1);
  const product = await store.products.getProduct(productId);
  expect(product.designSystemArtifactId).toBe(res.artifact_id);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/core/tests/store-design-mutations.test.ts`
Expected: FAIL (`tokensCss`/`units` not on `GenerateComponentsInput`).

- [ ] **Step 3: Implement**

In `packages/core/src/store.ts`, find `GenerateComponentsInput` (the input type for `generateComponents`). Make `html` optional and add:
```ts
  html?: string;
  tokensCss?: string;
  units?: import("./design-save.js").ComponentUnitInput[];
```
In the `generateComponents` function's `saveDesignArtifact({...})` call, thread them. Replace `html: input.html,` with:
```ts
          ...(input.html !== undefined ? { html: input.html } : {}),
          ...(input.tokensCss !== undefined ? { tokensCss: input.tokensCss } : {}),
          ...(input.units !== undefined ? { units: input.units } : {}),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/core/tests/store-design-mutations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/store.ts packages/core/tests/store-design-mutations.test.ts
git commit -m "feat(core): store.generateComponents threads tokensCss + units"
```

### Task D4: MCP `generate_components` schema + handler

**Files:**
- Modify: `packages/mcp/src/tools.ts` (`generateComponentsSchema` + handler)
- Test: `packages/mcp/tests/tools.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/mcp/tests/tools.test.ts` (mirror its existing `generate_components` harness):
```ts
it("generate_components accepts units + tokens_css and persists a unit library", async () => {
  const { tools, store } = await makeTools(); // existing helper
  const productId = await seedProduct(store, { platform: "mobile" });
  const res = await callTool(tools, "generate_components", {
    product_id: productId, title: "Lib", brand_style: "apple",
    tokens_css: ":root{--fg:#111}",
    units: [{ id: "button", title: "Button", role: "component", body_html: "<section><button>A</button></section>" }],
  });
  expect(res.isError).toBeUndefined();
});

it("generate_components rejects neither html nor units", async () => {
  const { tools, store } = await makeTools();
  const productId = await seedProduct(store, { platform: "mobile" });
  const res = await callTool(tools, "generate_components", { product_id: productId, title: "Lib", brand_style: "apple" });
  expect(res.isError).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/mcp/tests/tools.test.ts -t generate_components`
Expected: FAIL (`units`/`tokens_css` rejected by `.strict()`).

- [ ] **Step 3: Implement**

In `packages/mcp/src/tools.ts`, define a unit schema near `supportingFileSchema`:
```ts
const componentUnitSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    title: z.string().min(1),
    role: z.enum(["foundations", "icon", "component"]),
    body_html: z.string().min(1),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
  })
  .strict();
```
Replace `generateComponentsSchema`:
```ts
const generateComponentsSchema = z
  .object({
    product_id: z.string().min(1),
    title: z.string().min(1),
    brand_style: z.string().min(1),
    system_style: z.string().min(1).optional(),
    html: z.string().min(1).optional(),
    tokens_css: z.string().min(1).optional(),
    units: z.array(componentUnitSchema).min(1).optional(),
    product_icon: productIconSchema.optional(),
    supporting_files: z.array(supportingFileSchema).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (!input.html && !input.units) {
      ctx.addIssue({ code: "custom", message: "provide either html or units" });
    }
    if (input.units && !input.tokens_css) {
      ctx.addIssue({ code: "custom", message: "units requires tokens_css" });
    }
  });
```
In the handler, thread the new fields. Replace `html: input.html,` (in the `generate_components` tool body) with:
```ts
        ...(input.html !== undefined ? { html: input.html } : {}),
        ...(input.tokens_css !== undefined ? { tokensCss: input.tokens_css } : {}),
        ...(input.units !== undefined
          ? {
              units: input.units.map((u) => ({
                id: u.id, title: u.title, role: u.role, bodyHtml: u.body_html,
                ...(u.width !== undefined ? { width: u.width } : {}),
                ...(u.height !== undefined ? { height: u.height } : {}),
              })),
            }
          : {}),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/mcp/tests/tools.test.ts -t generate_components`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/tools.ts packages/mcp/tests/tools.test.ts
git commit -m "feat(mcp): generate_components accepts units + tokens_css"
```

---

## Part E — Viewer renders component-library units (web)

### Task E1: `componentLibraryMapper`

**Files:**
- Create: `packages/web/src/viewer/componentLibraryMapper.ts`
- Test: `packages/web/src/viewer/componentLibraryMapper.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mapComponentLibraryUnits } from "./componentLibraryMapper.js";

describe("mapComponentLibraryUnits", () => {
  const base = {
    artifactId: "lib", version: 3, platform: "mobile" as const,
    units: [
      { id: "foundations", title: "Foundations", role: "foundations" as const, entry: "unit-foundations.html", width: 520, height: 720 },
      { id: "button", title: "Button", role: "component" as const, entry: "unit-button.html" },
    ],
  };

  it("maps each unit to an input with its bundlePath, platform, and size", () => {
    const inputs = mapComponentLibraryUnits(base);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      artifactId: "lib", kind: "component-library", pageId: "brand-resources",
      variant: "000-foundations", title: "Foundations", version: 3, bundlePath: "unit-foundations.html",
      platform: "mobile", width: 520, height: 720,
    });
    // unit without explicit size falls back to platform canvas (mobile 390x844)
    expect(inputs[1]).toMatchObject({ variant: "001-button", bundlePath: "unit-button.html", width: 390, height: 844 });
  });

  it("orders variants so the horizontal layout follows emit order, not alphabetical", () => {
    const inputs = mapComponentLibraryUnits({
      ...base,
      units: [
        { id: "foundations", title: "Foundations", role: "foundations", entry: "unit-foundations.html" },
        { id: "icon", title: "Icon", role: "icon", entry: "unit-icon.html" },
        { id: "button", title: "Button", role: "component", entry: "unit-button.html" },
      ],
    });
    // compareVariant sorts lexicographically; ordinal prefixes keep emit order.
    expect(inputs.map((i) => i.variant)).toEqual(["000-foundations", "001-icon", "002-button"]);
  });

  it("returns empty for no units", () => {
    expect(mapComponentLibraryUnits({ ...base, units: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/web/src/viewer/componentLibraryMapper.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// packages/web/src/viewer/componentLibraryMapper.ts
import type { NormalizeArtifactInput } from "@xenonbyte/forma-viewer";
import type { Platform } from "../api.js";
import { canvasSizeForPlatform } from "./mapArtifacts.js";

export interface ComponentLibraryUnit {
  id: string;
  title: string;
  role: "foundations" | "icon" | "component";
  entry: string;
  width?: number;
  height?: number;
}

export interface MapComponentLibraryInput {
  artifactId: string;
  version: number;
  platform: Platform | undefined;
  units: ComponentLibraryUnit[];
}

/**
 * BC3': product-level mapper — one component-library artifact's forma.units →
 * one NormalizeArtifactInput per unit, all in the fixed "brand-resources" group
 * so they lay out horizontally. variant = zero-padded ordinal + unit id: a stable,
 * unique tile-id/selection key whose lexicographic order (used by buildGroups'
 * compareVariant) preserves emit order — Foundations → Icon → components.
 */
export function mapComponentLibraryUnits(input: MapComponentLibraryInput): NormalizeArtifactInput[] {
  const fallback = canvasSizeForPlatform(input.platform);
  return input.units.map((u, i) => ({
    artifactId: input.artifactId,
    kind: "component-library",
    pageId: "brand-resources",
    pageName: "brand-resources",
    variant: `${String(i).padStart(3, "0")}-${u.id}`,
    title: u.title,
    version: input.version,
    width: u.width ?? fallback.width,
    height: u.height ?? fallback.height,
    ...(input.platform !== undefined ? { platform: input.platform } : {}),
    bundlePath: u.entry,
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/web/src/viewer/componentLibraryMapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/viewer/componentLibraryMapper.ts packages/web/src/viewer/componentLibraryMapper.test.ts
git commit -m "feat(web): mapComponentLibraryUnits (forma.units → per-unit tiles)"
```

### Task E2: `BrandResources` renders units; no-units → explicit empty

**Files:**
- Modify: `packages/web/src/api.ts`
- Modify: `packages/web/src/pages/BrandResources.tsx`
- Test: `packages/web/src/pages/BrandResources.test.tsx`

- [ ] **Step 1: Write the failing test**

In `packages/web/src/pages/BrandResources.test.tsx`, update/add (the artifact detail manifest carries `forma.units`):
```tsx
it("renders one tile per component-library unit", async () => {
  const client = fakeClient({
    getProduct: async () => ({ id: "P1", name: "计算器", platform: "mobile", designSystemArtifactId: "lib" } as any),
    getProductArtifact: async () => ({
      current_version: 3,
      manifest: { title: "Lib", forma: { platform: "mobile", units: [
        { id: "foundations", title: "Foundations", role: "foundations", entry: "unit-foundations.html" },
        { id: "button", title: "Button", role: "component", entry: "unit-button.html" },
      ] } },
    } as any),
  });
  // render + flush via existing harness
  await flush();
  expect(container.querySelectorAll("iframe").length).toBe(2);
});

it("shows an empty state when the library has no units", async () => {
  const client = fakeClient({
    getProduct: async () => ({ id: "P1", name: "计算器", platform: "mobile", designSystemArtifactId: "lib" } as any),
    getProductArtifact: async () => ({ current_version: 1, manifest: { title: "Lib", forma: {} } } as any),
  });
  await flush();
  expect(container.textContent).toContain("尚未关联组件库"); // brand.noPointerHelp or a new no-units key
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/web/src/pages/BrandResources.test.tsx`
Expected: FAIL (still maps a single tile via the removed `mapBrandResourcesArtifact`).

- [ ] **Step 3: Implement**

In `packages/web/src/pages/BrandResources.tsx`:
- In `packages/web/src/api.ts`, add the Web-facing manifest unit type next to `ArtifactAssetEntryWeb`/`ArtifactProductIconWeb` and expose it from `ArtifactFormaExtensionWeb`:
  ```ts
  export interface ArtifactComponentUnitWeb {
    id: string;
    title: string;
    role: "foundations" | "icon" | "component";
    entry: string;
    width?: number;
    height?: number;
  }

  export interface ArtifactFormaExtensionWeb {
    // existing fields...
    units?: ArtifactComponentUnitWeb[];
  }
  ```
- Replace the `mapBrandResourcesArtifact` import with `mapComponentLibraryUnits` from `../viewer/componentLibraryMapper.js`.
- In `load()`, after resolving `detail`/`version`, read units:
  ```ts
  const units = (detail.manifest.forma?.units ?? []) as ComponentLibraryUnit[];
  if (units.length === 0) {
    if (!cancelled) setState({ status: "empty" });
    return;
  }
  const inputs = mapComponentLibraryUnits({
    artifactId, version, platform: product.platform, units,
  });
  const model = buildViewerModel({ entry: "page", artifacts: inputs });
  if (!cancelled) setState({ status: "ready", model });
  ```
- Add a dedicated i18n key for the no-units case (`brand.noUnitsHelp`: "组件库为空,运行 fm-refine-components 重新生成。") and show it in the `empty` branch, or reuse `brand.noPointerHelp`.
- Keep `ViewState.ready` as `{ status: "ready"; model }` (icon `<img>` already removed in B4; the icon now arrives as a `role:"icon"` unit tile).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/web/src/pages/BrandResources.test.tsx`
Expected: PASS. Delete the now-dead `mapBrandResourcesArtifact` + its test cases in `BrandResources.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api.ts packages/web/src/pages/BrandResources.tsx packages/web/src/viewer/brandResourcesMapper.ts packages/web/src/pages/BrandResources.test.tsx packages/web/src/i18n.ts
git commit -m "feat(web): brand canvas renders per-unit component tiles; explicit empty without units"
```

### Task E3: Remove dead `brandResourcesMapper`

**Files:**
- Delete: `packages/web/src/viewer/brandResourcesMapper.ts`
- Modify: any remaining importers

- [ ] **Step 1: Find importers**

Run: `grep -rn "brandResourcesMapper\|mapBrandResourcesArtifact" packages/web/src`
Expected: only the deleted test references remain.

- [ ] **Step 2: Delete + verify build**

```bash
git rm packages/web/src/viewer/brandResourcesMapper.ts
npx vitest run packages/web
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(web): remove dead brandResourcesMapper (replaced by units mapper)"
```

---

## Part F — Agent templates emit units

### Task F1: Rewrite `fm-refine-components` (claude) for the units contract

**Files:**
- Modify: `packages/agent/templates/claude/fm-refine-components.md`

- [ ] **Step 1: Update the generation + save contract**

Replace step 6 ("Generate ... as one self-contained static HTML document ... three sections") and step 7 (the `generate_components` payload) to instruct emitting **tokens_css + units**:
- All shared CSS (design tokens, base styles, component classes, fonts) goes in `tokens_css`.
- Emit one unit per renderable surface, in order:
  - `{ id:"foundations", role:"foundations", title:"Foundations", body_html }` — token visualization for every `baseline.foundations` category.
  - `{ id:"icon", role:"icon", title:"<Product> Icon", body_html }` — the product icon showcase (the SVG files still go through `product_icon` + `supporting_files` exactly as today).
  - one `{ id:"<component-slug>", role:"component", title, body_html }` per `baseline.components` entry (slug `^[a-z0-9][a-z0-9-]{0,63}$`), covering its states/variants.
- Each `body_html` is a pure markup fragment (NO `<html>`/`<head>`/`<style>`); it must render correctly using only the classes/variables defined in `tokens_css`.
- Save with `generate_components` passing `{ product_id, title, brand_style, system_style?, tokens_css, units, product_icon?, supporting_files? }`. The single-`html` argument is removed for new libraries.
- Keep the productIcon geometry-reuse rules unchanged (read `manifest.forma.productIcon.shape` on refine).

- [ ] **Step 2: Verify the template references no removed field**

Run: `grep -n "html\b" packages/agent/templates/claude/fm-refine-components.md`
Confirm remaining `html` mentions are about `body_html`/markup, not a top-level `html` payload.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/templates/claude/fm-refine-components.md
git commit -m "docs(agent): fm-refine-components (claude) emits tokens_css + units"
```

### Task F2: Mirror to codex template

**Files:**
- Modify: `packages/agent/templates/codex/fm-refine-components/SKILL.md`

- [ ] **Step 1: Apply the same contract changes as F1 (codex wording).**
- [ ] **Step 2: Commit**

```bash
git add packages/agent/templates/codex/fm-refine-components/SKILL.md
git commit -m "docs(agent): fm-refine-components (codex) emits tokens_css + units"
```

### Task F3: Mirror to gemini template

**Files:**
- Modify: `packages/agent/templates/gemini/fm-refine-components.toml`

- [ ] **Step 1: Apply the same contract changes as F1 (gemini/toml wording).**
- [ ] **Step 2: Commit**

```bash
git add packages/agent/templates/gemini/fm-refine-components.toml
git commit -m "docs(agent): fm-refine-components (gemini) emits tokens_css + units"
```

---

## Final verification

- [ ] **Full suite + typecheck**

```bash
pnpm build
pnpm typecheck
pnpm test
```
Expected: all green. Update any pre-existing component-library tests (d8205ab batch in `routes.test.ts`, `tools.test.ts`, `design-save.test.ts`, `store-design-mutations.test.ts`) whose fixtures used a single `html` payload to the new `units` shape.

- [ ] **Manual acceptance (`pnpm dev:web`)**

1. Use an isolated disposable home, for example `FORMA_HOME=/tmp/forma-canvas-stitch-acceptance pnpm dev:web`; create/delete only a known throwaway product in that isolated home, then run `fm-refine-components` → brand canvas shows `[Icon] [Foundations] [Button] [Input] …` horizontally, each independently selectable with `#4f46e5` border + platform-icon header. Do not delete products from the default `~/.forma` data directory during acceptance.
2. Brand/design canvases: two-finger drag pans, pinch zooms; no two-finger zoom.
3. All three canvases are full-screen with `[← back] productName · typeName`; back lands on requirement detail (design/annotation) or product detail (brand).
4. Annotation page label shows the platform icon and indigo focus color.

---

## Self-Review notes

- **Spec coverage:** Point 1 → A4/C2; Point 2 → D1–D4 + E1–E2 + F1–F3; Point 3 (icon as tile) → role:"icon" unit (F1) rendered by E2 + the `<img>` removal (B4); Point 4 → B1–B4 + C; Point 5 → A2–A3 + C1. All covered.
- **Type consistency:** `ComponentUnitInput` (design-save) uses `bodyHtml`; MCP input uses `body_html` mapped in the handler; manifest `ArtifactComponentUnit` uses `entry` (no body). `mapComponentLibraryUnits` consumes manifest units (`entry`), not input units (`bodyHtml`). Tile `variant` = `NNN-<unitId>` (ordinal-prefixed) so the horizontal order survives `compareVariant`'s lexicographic sort; the tile id `${artifactId}:${version}:${variant}` stays unique and is the selection key.
- **No old-library fallback:** E2 renders explicit empty when `forma.units` absent (locked decision).
- **Risk — composed preview:** the combined `index.html` is what the preview/craft-lint/thumbnail pipeline sees; per-unit files are canvas-only. If a unit's markup needs a class not in `tokens_css`, it renders unstyled in BOTH index.html and its unit file — caught by the F-template contract ("all CSS in tokens_css") and visible in manual acceptance.
