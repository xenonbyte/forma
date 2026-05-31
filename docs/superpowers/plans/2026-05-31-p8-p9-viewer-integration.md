# P8 + P9 — Viewer 接入(web + desktop)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **本计划合并两个独立子系统**(P8 web / P9 desktop),共享一个前置阶段(P0)。两个 Phase 段各自独立可执行、可独立产出可测软件;P8、P9 互不阻塞(都只依赖 P0 + 已并入 main 的 P7 viewer)。
>
> **来源**:总纲 `docs/superpowers/plans/2026-05-29-open-design-design-capability-implementation.md`(P8 锁定决策 Q1/Q5、两画布入口)+ P9 设计 spec `docs/superpowers/specs/2026-05-31-p9-desktop-viewer-design.md`(本次 brainstorm 已批准,D1–D7)。

**Goal:** web 后台与 desktop 客户端经同一 `@xenonbyte/forma-viewer` 包同源消费设计/标注画布——web 注入同源 HTTP 资源解析器、desktop 注入指向本地 forma server 的 HTTP 资源解析器;desktop 同时把外壳重构为统一工作区 IA、用 brand `tokens.css` 全重样并过同一套 craft lint(dogfood),全程纯只读。

**Architecture:** viewer 是已成型的纯展示包(`buildViewerModel(NormalizeArtifactInput[]) → ViewerModel`、`<Viewer model resolver>`,内置设计/标注模式切换 + 区域虚拟化)。两端各自:① 把宿主 artifact 数据映射成中性 `NormalizeArtifactInput[]`;② 实现 `ResourceResolver`(把不透明 `ResourceRef` 解析成 server 版本化 URL)。唯一新增的后端工作是 P0:扩展 artifact 列表读取面,暴露 viewer 映射所需的 `page_id`/`variant`/`current_version`(现列表不带)。desktop 另做外壳 IA 重构 + dogfood lint。

**Tech Stack:** TypeScript ESM (Node ≥22, pnpm workspace)。web = React 19 + Vite 7 + 自写 hash 路由(`routes.tsx`)。desktop = Electron 41 + electron-vite + **升级到 React 19**(D1);单测 vitest 3(node/happy-dom)不动,dogfood 浏览器测试走**根 vitest 4 browser project**(playwright/chromium,复用 P7 基建)。server = Fastify。viewer = `@xenonbyte/forma-viewer`(已在 main)。

---

## ⚠️ 执行期前置核对

- viewer 公开 API(P7 已落、main 上):`buildViewerModel({ entry, artifacts })`、`<Viewer model resolver />`、类型 `NormalizeArtifactInput`/`ResourceRef`/`ResourceResolver`/`ViewerModel`/`ArtifactKind`(`"design-page"|"component-library"`)。动手前 `grep -n "export" packages/viewer/src/index.ts` 复核签名未变。
- server 版本化路由(P4 已落):`GET /api/products/:pid/artifacts/:aid/versions/:v/bundle/*`(bundle/asset)、`GET …/versions/:v/preview/:res`(`res` ∈ `1x.png`/`2x.png`)。
- craft lint API(P5 已落,P9 dogfood 用):`packages/core/src/quality/` 的 `lintCraft(snapshot, options) → ArtifactCraftCheck[]`、`extractSnapshotInPage() → RenderedDomSnapshot`。动手前复核签名。
- 纪律:串行执行,一个 task 落盘 + 测试绿 + 提交后再下一个;浏览器测试**后台运行 + 写日志文件**(勿管道接 `tail`,会缓冲到结束看不到进度;进程长时间 0% CPU = 卡死);源文件严禁混入 markdown 围栏(落盘后 grep 扫描);只 `git add` 指定文件;全量 `pnpm test` 不回退。

---

## File Structure

**P0(共享前置 · core/server/web/desktop 读取面)**
| 文件 | 改动 |
|---|---|
| `packages/core/src/server-artifact-read.ts`(或现有 artifact 读取聚合处) | `resolveCurrentArtifact` 额外返回 `version` |
| `packages/server/src/routes.ts` | `GET /api/products/:pid/artifacts` 列表项加 `page_id`/`variant`/`current_version`、`kind` 归一化 |
| `packages/web/src/api.ts` | `ArtifactSummary` 加 `page_id?`/`variant?`/`current_version?`;`kind` 注释为归一值 |
| `packages/desktop/src/renderer/forma.d.ts` | `FormaArtifact` 加同样字段 |

**P8(web)**
| 文件 | 改动 |
|---|---|
| `packages/web/src/viewer/mapArtifacts.ts` | Create:宿主 artifact + requirement.pages → `NormalizeArtifactInput[]`(纯函数 + platform 默认尺寸) |
| `packages/web/src/viewer/resolver.ts` | Create:`createWebResourceResolver(productId)`(同源版本化 URL) |
| `packages/web/src/pages/ViewerPage.tsx` | Create:加载 + 映射 + `<Viewer>`;两入口(requirement / page) |
| `packages/web/src/routes.tsx` | Modify:加两条 viewer 路由 |
| `packages/web/src/pages/ProductNew.tsx` | Modify:brand_style + system_style + platform + language |
| `packages/web/src/pages/StyleLibrary.tsx` / `StyleDetail.tsx` / `components/StylePickerDialog.tsx` | Modify:适配 Q1 三文件风格格式(DESIGN.md + tokens + components.html iframe) |
| 对应 `*.test.ts(x)` | 每个新文件/改动配测试 |

**P9(desktop · 详见下方 Phase P9 段)**
- `packages/desktop/package.json`(React 19)、`packages/viewer/package.json`(peer `^19`)
- `packages/desktop/src/preload/index.ts` + `main/index.ts`(第 8 只读方法 `formaServerBaseUrl` + IPC)
- `packages/desktop/src/renderer/{AppShell,Sidebar,TopBar,WorkspacePane,ConnectionGate,StyleDetail,viewer/{mapArtifacts,resolver}}.tsx` + hash 路由 + `clean` tokens.css
- `vitest.config.ts`(根:新增 desktop-shell-dogfood browser project)+ `packages/desktop/src/renderer/*.dogfood.browser.test.tsx`

---

## Phase P0 — 扩展 artifact 读取面(共享前置)

> P8、P9 的 viewer 映射都需要每个 design-page artifact 的 `page_id`/`variant`/`current_version`。现列表 `GET /api/products/:pid/artifacts` 不带这三者(只有 `id/kind/title/preview_url/updated_at/source_skill_id/requirement_id/superseded`)。数据在 `manifest.forma.{pageId,variant}` + 指针 `pointerVersions`(当前版本号)里。本阶段把它们补进列表响应,并让 `kind` 归一(`html→design-page`、`design-system→component-library`)。

### Task P0.1: `resolveCurrentArtifact` 返回 version + 列表响应扩展

**Files:**
- Modify: `packages/server/src/routes.ts`(`resolveCurrentArtifact` 返回 `version`;列表项加字段)
- Modify: `packages/web/src/api.ts`(`ArtifactSummary` 类型)
- Test: `packages/server/tests/artifact-routes.test.ts`(现有列表测试;若无则新建)

- [ ] **Step 1: 写失败测试** — 在 server 列表测试里加断言:design-page artifact 的列表项含 `page_id`、`variant`(缺省 `"default"`)、`current_version`(数字),且 `kind` 为归一值 `"design-page"`。

```ts
// packages/server/tests/artifact-routes.test.ts(在现有 "list artifacts" describe 内加)
it("exposes page_id, variant and current_version for design-page artifacts", async () => {
  // 复用本文件既有的 fixture：一个已保存 design-page artifact 的 product。
  // (沿用现有 beforeEach/helper；下面只示意断言形状。)
  const res = await app.inject({ method: "GET", url: `/api/products/${pid}/artifacts` });
  expect(res.statusCode).toBe(200);
  const { artifacts } = res.json() as {
    artifacts: Array<{ id: string; kind: string; page_id?: string; variant?: string; current_version?: number }>;
  };
  const dp = artifacts.find((a) => a.kind === "design-page");
  expect(dp).toBeDefined();
  expect(typeof dp!.page_id).toBe("string");
  expect(dp!.variant).toBe("default");
  expect(typeof dp!.current_version).toBe("number");
});
```

> 执行期:本仓库已有 server artifact 路由测试(`grep -rln "api/products.*artifacts" packages/server/tests`);把上面断言并入既有 "list artifacts" 套件,复用其 fixture（一个保存过 design-page 的临时 FORMA_HOME）。若确无该测试文件，按既有 server 测试惯例（`buildServer`/`app.inject`）新建。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/server/tests/artifact-routes.test.ts`
Expected: FAIL — 列表项无 `page_id`/`variant`/`current_version`。

- [ ] **Step 3: 让 `resolveCurrentArtifact` 返回 version**

`packages/server/src/routes.ts` 现有(约 755–765 行):
```ts
async function resolveCurrentArtifact(
  store: FormaRoutesStore,
  pid: string,
  artifactId: string,
  pointerVersions: Map<string, number>
): Promise<{ manifest: ArtifactManifest; etag: string }> {
  // …
  const version = pointerVersions.get(artifactId) ?? Math.max(...versions);
  // …（读取该 version 的 manifest，算 etag）
  return { manifest, etag };
}
```
改为额外返回 `version`(签名 + return 同步加 `version`):
```ts
): Promise<{ manifest: ArtifactManifest; etag: string; version: number }> {
  // …不变…
  return { manifest, etag, version };
}
```
（`getArtifact` 路由处的解构 `const { manifest, etag } = await resolveCurrentArtifact(...)` 不需改——多返回一个字段不影响。）

- [ ] **Step 4: 列表路由补字段 + kind 归一**

`packages/server/src/routes.ts` 列表路由(约 347–372 行)循环体改为:
```ts
for (const { artifactId } of entries) {
  let manifest: ArtifactManifest;
  let version: number;
  try {
    ({ manifest, version } = await resolveCurrentArtifact(store, pid, artifactId, pointerVersions));
  } catch {
    continue; // unreadable artifact — skip
  }
  if (kindFilter && normalizeKind(manifest.kind) !== normalizeKind(kindFilter)) continue;
  const requirementId = manifest.requirementId ?? manifest.forma?.requirementId;
  const superseded = requirementId !== undefined && !currentPointerIds.has(artifactId);
  if (!includeSuperseded && superseded) continue;
  const forma = manifest.forma ? normalizeFormaExtension(manifest.forma) : undefined;
  artifacts.push({
    id: artifactId,
    kind: normalizeKind(manifest.kind),          // 归一:design-page / component-library
    title: manifest.title,
    preview_url: artifactPreviewUrl(pid, artifactId, "2x"),
    updated_at: manifest.updatedAt,
    source_skill_id: manifest.sourceSkillId,
    requirement_id: requirementId,
    page_id: forma?.pageId,                       // design-page 才有
    variant: forma?.variant,                      // normalizeFormaExtension 已补 default
    current_version: version,
    superseded
  });
}
```
确保 `normalizeKind` 与 `normalizeFormaExtension` 已从 `@xenonbyte/forma-core`(或 artifact-manifest)import(routes.ts 顶部);未 import 则加。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run packages/server/tests/artifact-routes.test.ts`
Expected: PASS。

- [ ] **Step 6: 同步 web `ArtifactSummary` 类型**

`packages/web/src/api.ts` 的 `ArtifactSummary`(约 221–230 行)加三个可选字段(注释 kind 为归一值):
```ts
export interface ArtifactSummary {
  id: string;
  /** 归一 kind:"design-page" | "component-library"。 */
  kind: string;
  title: string;
  preview_url?: string;
  updated_at: string;
  source_skill_id?: string;
  requirement_id?: string;
  /** design-page only — 分组键。 */
  page_id?: string;
  /** design-page only — 变体,缺省 "default"。 */
  variant?: string;
  /** 当前版本指针的版本号(versioned bundle/preview URL 用)。 */
  current_version?: number;
  superseded: boolean;
}
```
（desktop `forma.d.ts` 的 `FormaArtifact` 同步在 P9 Task 中做——见 P9 段;此处只动 web。）

- [ ] **Step 7: typecheck + 全量不回退 + Commit**

Run: `pnpm --filter @xenonbyte/forma-server typecheck && pnpm --filter @xenonbyte/forma-web typecheck` → PASS
Run: `pnpm test` → 全绿(新增 1 断言;现有不回退)
```bash
git add packages/server/src/routes.ts packages/web/src/api.ts packages/server/tests/artifact-routes.test.ts
git commit -m "feat(p8/p9): expose page_id/variant/current_version + normalized kind in artifact list

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase P8 — Web 接入 viewer + 后台管理

### Task P8.1: web viewer 数据映射(纯函数)

**Files:**
- Create: `packages/web/src/viewer/mapArtifacts.ts`
- Test: `packages/web/src/viewer/mapArtifacts.test.ts`

- [ ] **Step 1: 写失败测试 `packages/web/src/viewer/mapArtifacts.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { mapArtifactsToViewerInputs, canvasSizeForPlatform } from "./mapArtifacts.js";
import type { ArtifactSummary } from "../api.js";

const artifacts: ArtifactSummary[] = [
  { id: "a", kind: "design-page", title: "登录页", updated_at: "", superseded: false, page_id: "login", variant: "default", current_version: 2 },
  { id: "b", kind: "design-page", title: "登录页 宽屏", updated_at: "", superseded: false, page_id: "login", variant: "wide", current_version: 2 },
  { id: "c", kind: "component-library", title: "组件库", updated_at: "", superseded: false } // 非 design-page,应被过滤
];
const pages = [{ page_id: "login", name: "登录页" }];

describe("mapArtifactsToViewerInputs", () => {
  it("maps design-page artifacts to NormalizeArtifactInput, dropping non-design-page and incomplete", () => {
    const out = mapArtifactsToViewerInputs({ artifacts, pages, platform: "web" });
    expect(out.map((x) => x.artifactId)).toEqual(["a", "b"]);
    expect(out[0]).toEqual({
      artifactId: "a", kind: "design-page", pageId: "login", pageName: "登录页",
      variant: "default", title: "登录页", version: 2, width: 1280, height: 800
    });
  });

  it("falls back to pageId when page name is unknown, and uses platform canvas size", () => {
    const out = mapArtifactsToViewerInputs({ artifacts: [artifacts[0]], pages: [], platform: "mobile" });
    expect(out[0].pageName).toBe("login");
    expect({ w: out[0].width, h: out[0].height }).toEqual({ w: 390, h: 844 });
  });

  it("drops design-page artifacts missing page_id/variant/current_version (must come from read surface, not inferred)", () => {
    const incomplete: ArtifactSummary = { id: "x", kind: "design-page", title: "x", updated_at: "", superseded: false };
    expect(mapArtifactsToViewerInputs({ artifacts: [incomplete], pages, platform: "web" })).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/web/src/viewer/mapArtifacts.test.ts`
Expected: FAIL — 模块未建。

- [ ] **Step 3: 写 `packages/web/src/viewer/mapArtifacts.ts`**

```ts
import type { NormalizeArtifactInput } from "@xenonbyte/forma-viewer";
import type { ArtifactSummary, Platform } from "../api.js";

/** 按平台的默认画布尺寸(后端 manifest 暂无 width/height,P8/P9 共用此映射 — 见 P9 spec D7)。 */
const PLATFORM_CANVAS: Record<Platform, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 834, height: 1112 },
  desktop: { width: 1280, height: 800 },
  web: { width: 1280, height: 800 }
};

export function canvasSizeForPlatform(platform: Platform | undefined): { width: number; height: number } {
  return PLATFORM_CANVAS[platform ?? "web"] ?? PLATFORM_CANVAS.web;
}

export interface MapArtifactsInput {
  artifacts: ArtifactSummary[];
  /** requirement.pages 的 page_id→name(用于 tile pageName)。 */
  pages: Array<{ page_id: string; name: string }>;
  platform: Platform | undefined;
}

/**
 * 宿主 artifact 列表 → viewer 中性输入。
 * 只取 design-page 且 page_id/variant/current_version 齐全者(这三者必须来自读取面,
 * 不得从 URL/标题推断 — 见 P9 spec)。width/height 按平台默认。
 */
export function mapArtifactsToViewerInputs(input: MapArtifactsInput): NormalizeArtifactInput[] {
  const pageName = new Map(input.pages.map((p) => [p.page_id, p.name]));
  const { width, height } = canvasSizeForPlatform(input.platform);
  const result: NormalizeArtifactInput[] = [];
  for (const a of input.artifacts) {
    if (a.kind !== "design-page") continue;
    if (!a.page_id || !a.variant || typeof a.current_version !== "number") continue;
    result.push({
      artifactId: a.id,
      kind: "design-page",
      pageId: a.page_id,
      pageName: pageName.get(a.page_id) ?? a.page_id,
      variant: a.variant,
      title: a.title,
      version: a.current_version,
      width,
      height
    });
  }
  return result;
}
```

- [ ] **Step 4: 跑测试确认通过** → `npx vitest run packages/web/src/viewer/mapArtifacts.test.ts`(3 passed)

- [ ] **Step 5: typecheck + Commit**

Run: `pnpm --filter @xenonbyte/forma-web typecheck` → PASS
```bash
git add packages/web/src/viewer/mapArtifacts.ts packages/web/src/viewer/mapArtifacts.test.ts
git commit -m "feat(p8): web artifact->viewer input mapping (platform canvas size)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task P8.2: web HTTP `ResourceResolver`

**Files:**
- Create: `packages/web/src/viewer/resolver.ts`
- Test: `packages/web/src/viewer/resolver.test.ts`

- [ ] **Step 1: 写失败测试 `packages/web/src/viewer/resolver.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { createWebResourceResolver } from "./resolver.js";
import type { ResourceRef } from "@xenonbyte/forma-viewer";

describe("createWebResourceResolver", () => {
  const r = createWebResourceResolver("p1");
  const base = "/api/products/p1/artifacts/a/versions/3";

  it("resolves the html bundle entry", () => {
    const ref: ResourceRef = { artifactId: "a", version: 3, kind: "bundle" };
    expect(r.resolve(ref)).toBe(`${base}/bundle/index.html`);
  });

  it("resolves a versioned preview png by density", () => {
    expect(r.resolve({ artifactId: "a", version: 3, kind: "preview", density: "2x" })).toBe(`${base}/preview/2x.png`);
  });

  it("resolves a bundle asset by path", () => {
    expect(r.resolve({ artifactId: "a", version: 3, kind: "asset", path: "assets/logo.png" })).toBe(`${base}/bundle/assets/logo.png`);
  });

  it("url-encodes product and artifact ids", () => {
    const enc = createWebResourceResolver("p/1");
    expect(enc.resolve({ artifactId: "a b", version: 1, kind: "bundle" })).toBe(
      "/api/products/p%2F1/artifacts/a%20b/versions/1/bundle/index.html"
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL(模块未建)

- [ ] **Step 3: 写 `packages/web/src/viewer/resolver.ts`**

```ts
import type { ResourceRef, ResourceResolver } from "@xenonbyte/forma-viewer";

/**
 * web 同源 HTTP 资源解析器,产品作用域。URL 路径与 server 版本化路由一致:
 * bundle → /versions/:v/bundle/index.html;asset → /versions/:v/bundle/:path;
 * preview → /versions/:v/preview/:density.png(server 要求 .png 后缀)。
 */
export function createWebResourceResolver(productId: string): ResourceResolver {
  const pid = encodeURIComponent(productId);
  return {
    resolve(ref: ResourceRef): string {
      const aid = encodeURIComponent(ref.artifactId);
      const base = `/api/products/${pid}/artifacts/${aid}/versions/${ref.version}`;
      if (ref.kind === "preview") {
        return `${base}/preview/${ref.density ?? "1x"}.png`;
      }
      if (ref.kind === "asset") {
        return `${base}/bundle/${ref.path ?? ""}`;
      }
      return `${base}/bundle/index.html`;
    }
  };
}
```

- [ ] **Step 4: 跑测试确认通过**(4 passed)

- [ ] **Step 5: typecheck + Commit**

```bash
git add packages/web/src/viewer/resolver.ts packages/web/src/viewer/resolver.test.ts
git commit -m "feat(p8): web same-origin HTTP ResourceResolver (versioned bundle/preview URLs)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task P8.3: `ViewerPage` + 两条路由(按需求 / 按页面)

**Files:**
- Create: `packages/web/src/pages/ViewerPage.tsx`
- Modify: `packages/web/src/routes.tsx`(加两条路由 + Route 包装)
- Test: `packages/web/src/pages/ViewerPage.test.tsx`(happy-dom 组件测,mock client;viewer 内部真实 RF 渲染不在此验证 — 归 P7/desktop dogfood)

> **说明**:`<Viewer>` 内部用 React Flow,需真实 DOM 量测。web 既有组件测在 happy-dom(jsdom 类)下跑,无法真实渲染 RF。故 `ViewerPage.test.tsx` 只验证**装配与数据流**:加载态、错误态、把映射后的 model 传给一个**注入的/mock 的 Viewer**(用 `vi.mock("@xenonbyte/forma-viewer")` 替身,断言收到的 props)。viewer 自身的真实渲染由 P7 浏览器测试覆盖,无需在 web 重复。

- [ ] **Step 1: 写失败测试 `packages/web/src/pages/ViewerPage.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const viewerSpy = vi.fn();
vi.mock("@xenonbyte/forma-viewer", () => ({
  buildViewerModel: (input: unknown) => ({ __model: input }),
  Viewer: (props: { model: unknown }) => {
    viewerSpy(props);
    return <div data-testid="viewer" />;
  }
}));

import { ViewerPage } from "./ViewerPage.js";
import type { FormaApiClient } from "../api.js";

function fakeClient(): FormaApiClient {
  return {
    getProduct: async () => ({ id: "p1", name: "P", description: "", platform: "web" }),
    getRequirement: async () => ({
      id: "r1", title: "需求", product_id: "p1", status: "active", created_at: "", updated_at: "",
      navigation: [], document_md: "",
      pages: [{ baseline_page: "login", design_status: "done", name: "登录页", page_id: "login" }]
    }),
    listProductArtifacts: async () => ({
      artifacts: [{ id: "a", kind: "design-page", title: "登录页", updated_at: "", superseded: false, page_id: "login", variant: "default", current_version: 1 }]
    })
  } as unknown as FormaApiClient;
}

describe("ViewerPage", () => {
  it("loads requirement + artifacts and renders Viewer with a built model (requirement entry)", async () => {
    render(<ViewerPage client={fakeClient()} params={{ productId: "p1", reqId: "r1" }} entry="requirement" />);
    await waitFor(() => expect(screen.getByTestId("viewer")).toBeTruthy());
    expect(viewerSpy).toHaveBeenCalled();
    const model = viewerSpy.mock.calls[0][0].model as { __model: { entry: string; artifacts: Array<{ artifactId: string }> } };
    expect(model.__model.entry).toBe("requirement");
    expect(model.__model.artifacts.map((a) => a.artifactId)).toEqual(["a"]);
  });

  it("filters to a single page for the page entry", async () => {
    render(<ViewerPage client={fakeClient()} params={{ productId: "p1", reqId: "r1", pageId: "login" }} entry="page" />);
    await waitFor(() => expect(screen.getByTestId("viewer")).toBeTruthy());
    const model = viewerSpy.mock.calls.at(-1)![0].model as { __model: { entry: string } };
    expect(model.__model.entry).toBe("page");
  });
});
```

> 执行期:`@testing-library/react` 是否已是 web devDep — `grep '@testing-library/react' packages/web/package.json`;若无则该测试改用 web 既有的渲染惯例(查 `packages/web/src/**/*.test.tsx` 现用什么:`render`/`createRoot`)。**与既有测试风格一致**,不引新依赖。

- [ ] **Step 2: 跑测试确认失败** → FAIL(ViewerPage 未建)

- [ ] **Step 3: 写 `packages/web/src/pages/ViewerPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Viewer, buildViewerModel } from "@xenonbyte/forma-viewer";
import type { ViewerEntry } from "@xenonbyte/forma-viewer";
import type { FormaApiClient } from "../api.js";
import { mapArtifactsToViewerInputs } from "../viewer/mapArtifacts.js";
import { createWebResourceResolver } from "../viewer/resolver.js";

export interface ViewerPageProps {
  client: FormaApiClient;
  params: { productId: string; reqId: string; pageId?: string };
  entry: ViewerEntry;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; model: ReturnType<typeof buildViewerModel> };

export function ViewerPage({ client, params, entry }: ViewerPageProps): React.ReactElement {
  const { productId, reqId, pageId } = params;
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void (async () => {
      try {
        const [product, requirement, artifactList] = await Promise.all([
          client.getProduct(productId),
          client.getRequirement(productId, reqId),
          client.listProductArtifacts(productId)
        ]);
        const reqArtifacts = artifactList.artifacts.filter((a) => a.requirement_id === reqId);
        const scoped = entry === "page" ? reqArtifacts.filter((a) => a.page_id === pageId) : reqArtifacts;
        const inputs = mapArtifactsToViewerInputs({
          artifacts: scoped,
          pages: requirement.pages.map((p) => ({ page_id: p.page_id, name: p.name })),
          platform: product.platform
        });
        const model = buildViewerModel({ entry, artifacts: inputs });
        if (!cancelled) setState({ status: "ready", model });
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "加载失败" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, productId, reqId, pageId, entry]);

  if (state.status === "loading") return <div role="status">加载中…</div>;
  if (state.status === "error") return <div role="alert">加载失败:{state.message}</div>;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Viewer model={state.model} resolver={createWebResourceResolver(productId)} />
    </div>
  );
}
```

> 注:`by-page` 过滤同时按 `requirement_id === reqId && page_id === pageId`(page_id 是可重复分组键,见 spec)。本实现先按 reqId 过滤、再按 pageId,等价。

- [ ] **Step 4: 加路由 `packages/web/src/routes.tsx`**

import 增加:
```tsx
import { ViewerPage } from "./pages/ViewerPage.js";
```
`routeTable` 在 `DesignViewRoute` 那条之后加两条:
```tsx
  {
    component: RequirementViewerRoute,
    context: "Design",
    navGroup: "products",
    path: "/products/:productId/requirements/:reqId/viewer",
    title: ({ reqId }) => `${reqId} 画布`
  },
  {
    component: PageViewerRoute,
    context: "Design",
    navGroup: "products",
    path: "/products/:productId/requirements/:reqId/pages/:pageId/viewer",
    title: ({ pageId }) => `${pageId} 画布`
  },
```
并加两个 Route 包装(放在 `DesignViewRoute` 附近):
```tsx
function RequirementViewerRoute(props: RoutePageProps) {
  return <ViewerPage client={apiClient} params={props.params as { productId: string; reqId: string }} entry="requirement" />;
}
function PageViewerRoute(props: RoutePageProps) {
  return <ViewerPage client={apiClient} params={props.params as { productId: string; reqId: string; pageId: string }} entry="page" />;
}
```

- [ ] **Step 5: 跑测试确认通过** → `npx vitest run packages/web/src/pages/ViewerPage.test.tsx`(2 passed);并跑既有 `routes.test.ts` 不回退。

- [ ] **Step 6: typecheck + 全量 + Commit**

Run: `pnpm --filter @xenonbyte/forma-web typecheck` → PASS;`pnpm test` 不回退
```bash
git add packages/web/src/pages/ViewerPage.tsx packages/web/src/routes.tsx packages/web/src/pages/ViewerPage.test.tsx
git commit -m "feat(p8): web ViewerPage + by-requirement/by-page routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task P8.4: web 风格/配置类型对齐 core(3 文件格式 + brand/system + 系统风格路由)

> **背景(执行期已核实)**:core 早已切到新格式,web 落后未同步——core `StyleMetadata = {name,description,category?,upstream?,design_md_path,tokens_css_path,components_html_path}`(strict,**无 `variables`**);`getStyle → BrandStyleContent {kind:'brand', metadata, designMd, tokensCss, componentsHtml}`;`listSystemStyles → SystemStyleMetadata {name,description,mode:'design-system',category?,upstream?}`;产品 config 已是 `brand_style`(必填)+`system_style`(可选)(server `/api/products/:id/config` 路由 + `product.ts` schema)。web `api.ts` 的 `StyleMetadata`(含 `variables`)/`StyleVariables`/`StyleDetailPayload`/`ProductConfigInput{style}` 都是旧的。system styles 还**无 HTTP 路由**。本 task 先补类型 + 路由(P8.5 再改组件)。

**Files:**
- Modify: `packages/server/src/routes.ts`(加 `GET /api/system-styles`)
- Modify: `packages/web/src/api.ts`(类型 + client 方法)
- Test: `packages/web/src/api.test.ts`(既有;加 system-styles + config 形状断言)、`packages/server/tests`(system-styles 路由)

- [ ] **Step 1: 加 server 系统风格路由** — `packages/server/src/routes.ts`,在 `/api/styles/:name`(约 499 行)后加:
```ts
  app.get("/api/system-styles", async () => store.styles.listSystemStyles());
```
并把 `FormaRoutesStore` 的 `styles` 接口(约 92 行)补 `listSystemStyles(): Promise<unknown>;`(若未声明)。写 server 测试:`GET /api/system-styles` 200 且返回数组(复用既有 server 测试 fixture/`app.inject`)。

- [ ] **Step 2: 改 web `api.ts` 类型与 client**

替换旧 `StyleVariables`/`StyleMetadata`/`StyleDetailPayload`(约 26–41、216–219 行)为:
```ts
export interface StyleMetadata {
  name: string;
  description: string;
  category?: string;
  upstream?: string;
  design_md_path: string;
  tokens_css_path: string;
  components_html_path: string;
}

export interface SystemStyleMetadata {
  name: string;
  description: string;
  mode: "design-system";
  category?: string;
  upstream?: string;
}

/** getStyle 返回的三文件内容(对齐 core BrandStyleContent)。 */
export interface BrandStyleContent {
  kind: "brand";
  metadata: StyleMetadata;
  designMd: string;
  tokensCss: string;
  componentsHtml: string;
}
```
（删除 `StyleVariables` 与旧 `StyleDetailPayload`;全仓库 `grep -rn "StyleVariables\|StyleDetailPayload" packages/web/src` 改引用——见 P8.5。）

`ProductConfigInput`(约 139–144 行)改:
```ts
export interface ProductConfigInput {
  default_language: Language;
  languages: Language[];
  platform: Platform;
  brand_style: string;
  system_style?: string;
}
```
`Product`（约 49–54 行）`style?: StyleMetadata` 改为 `brand_style?: string; system_style?: string;`（与 core product 一致）。

`FormaApiClient` 接口 + `createApiClient` 实现:
- `getStyle(name): Promise<BrandStyleContent>`（返回类型改）。
- 加 `listSystemStyles(): Promise<SystemStyleMetadata[]>` → `apiArray<SystemStyleMetadata>("/api/system-styles", requestOptions(fetcher))`。
- `configureProduct` 入参类型已是 `ProductConfigInput`，无需改实现（body 透传新字段）。

- [ ] **Step 3: 跑测试** — `npx vitest run packages/web/src/api.test.ts packages/server/tests`(对应改/加的断言绿);`pnpm --filter @xenonbyte/forma-web typecheck` 此刻**会因 P8.5 未改的组件报错**——P8.4 只改 api.ts + server;**typecheck 的 web 部分留到 P8.5 末尾整体转绿**(本 task 提交前只验 server typecheck + 改动测试)。

- [ ] **Step 4: Commit**（server 路由 + web 类型/client;web 组件 P8.5 再动)
```bash
git add packages/server/src/routes.ts packages/web/src/api.ts packages/web/src/api.test.ts packages/server/tests
git commit -m "feat(p8): sync web style/config types to core (3-file brand + system styles route)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task P8.5: web 风格组件适配三文件格式 + ProductNew 双风格

> 把消费旧 `variables` 的组件改为消费 3 文件(`tokensCss`/`componentsHtml`/`designMd`),并让 ProductNew 选 brand + system。受影响:`StyleLibrary`/`StyleDetail`/`StylePickerDialog`/`StyleCard`/`StylePreviewPanel`/`TokenCard`/`ProductNew` 及其测试。`grep -rln "variables\|StyleVariables\|StyleDetailPayload" packages/web/src` 列全部引用,逐一改。

**Files:**（Modify,逐组件配既有测试）
- `packages/web/src/components/StylePreviewPanel.tsx`(预览改 `components.html` iframe + tokens 注入)
- `packages/web/src/components/StyleCard.tsx`(去 variables 预览条,改 category/upstream 元信息)
- `packages/web/src/components/TokenCard.tsx`(若仅服务 variables,改为渲染 tokens.css 解析出的键值,或并入 StyleDetail)
- `packages/web/src/pages/StyleDetail.tsx`(消费 `BrandStyleContent`:DESIGN.md + tokens.css 文本 + components.html iframe sandbox 无脚本)
- `packages/web/src/pages/StyleLibrary.tsx`(去 `requiredVariables`/`hasCompleteVariables`/variable 过滤,改 category 过滤)
- `packages/web/src/pages/ProductNew.tsx`(加 system style 选择;`configureProduct` 传 `brand_style`+`system_style`)

- [ ] **Step 1: StyleDetail 改为消费 `BrandStyleContent`** — 写失败测试(mock `getStyle` 返回 `{kind:'brand', metadata, designMd, tokensCss, componentsHtml}`,断言:渲染 DESIGN.md 文本、渲染 tokens.css 文本块、出现一个 `iframe[sandbox]`(components.html 预览,sandbox 无 `allow-scripts`,srcDoc=componentsHtml))。然后改实现:
```tsx
// 关键片段(替换原 variables 渲染)
<WorkSurface title={tx("style.detail.designMd")}>
  <pre className="…">{state.style.designMd || tx("style.detail.designMdEmpty")}</pre>
</WorkSurface>
<WorkSurface title="Tokens">
  <pre className="…">{state.style.tokensCss}</pre>
</WorkSurface>
<WorkSurface title="Components">
  <iframe title="components" sandbox="allow-same-origin" srcDoc={state.style.componentsHtml} style={{ width: "100%", height: 480, border: "none" }} />
</WorkSurface>
```
（state.style 类型从 `StyleDetailPayload` 改为 `BrandStyleContent`;去掉 `metadata.variables` 用法。）

- [ ] **Step 2: StylePickerDialog 去 variables** — 候选卡片预览条原用 `stylePreviewTokens(style.variables)`;新 `StyleMetadata` 无 variables。改为:候选卡显示 name/description/category(无颜色条,或点选后用 `getStyle` 详情里的 components.html 缩略 iframe 作预览,与 StyleDetail 一致)。`previewMetadata`/`StylePreviewPanel` 同步。删 `stylePreviewTokens`/`tokenValue`/`cssLength`/`StyleVariables` 引用。测试:候选列表渲染、搜索过滤、confirm 回调(沿用既有 `data-style-picker-*` 选择器断言)。

- [ ] **Step 3: StyleLibrary 去 variable 过滤** — 删 `requiredVariables`/`hasCompleteVariables`/`VariableFilter`;过滤改为 category + query(category 来自 `style.category ?? styleCategory(style)`)。`StyleCard` 去颜色预览条,显示 name/description/category/upstream。改既有 StyleLibrary/StyleCard 测试。

- [ ] **Step 4: ProductNew 双风格** — 现表单有单 `StylePickerDialog`(brand)。改:
  - state 增 `systemStyleName`;加 system 选择控件(下拉,数据来自新增的 `client.listSystemStyles()`;system 可选)。
  - `canSubmit` 仍只要求 brand(`styleName`,即 brand_style)非空;system 可空。
  - `configureProduct` 调用改:`{ default_language, languages, platform, brand_style: styleName, ...(systemStyleName ? { system_style: systemStyleName } : {}) }`。
  - `ProductNewProps.client` 的 Pick 增 `"listSystemStyles"`。
  改既有 ProductNew 测试(若有断言 `style` 字段,改 `brand_style`)。

- [ ] **Step 5: 全量转绿** — `pnpm --filter @xenonbyte/forma-web typecheck`(P8.4+P8.5 后 web 整体 typecheck 应 0 错);`pnpm test` 全绿不回退;`grep -rn "variables\|StyleVariables\|StyleDetailPayload" packages/web/src` 应无残留(除非有意保留的本地解析)。

- [ ] **Step 6: Commit**
```bash
git add packages/web/src/pages/StyleDetail.tsx packages/web/src/pages/StyleLibrary.tsx packages/web/src/pages/ProductNew.tsx packages/web/src/components/StylePickerDialog.tsx packages/web/src/components/StyleCard.tsx packages/web/src/components/StylePreviewPanel.tsx packages/web/src/components/TokenCard.tsx packages/web/src/**/*.test.tsx
git commit -m "feat(p8): adapt web style UI to 3-file format + dual brand/system style in ProductNew

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> **P8 验收**:按需求/按页面经共享 `<Viewer>` 打开设计/标注画布(两画布可切换);双风格(brand 必填 + system 可选)+ platform + language 写入 config;后台风格页消费三文件(DESIGN.md + tokens + components.html iframe);viewer 复用自包未重写;`pnpm test`/`typecheck` 全绿。

---

## Phase P9 — Desktop 接入 viewer + 外壳 dogfood 重做

> 照 P9 设计 spec `docs/superpowers/specs/2026-05-31-p9-desktop-viewer-design.md`(D1–D7)。纯只读。

### Task P9.1: desktop 升 React 19 + viewer peer 收窄 ^19

**Files:** `packages/desktop/package.json`、`packages/viewer/package.json`、(可选)`packages/viewer/src/Canvas.tsx`

- [ ] **Step 1** `packages/desktop/package.json`:`react`/`react-dom` → `^19.0.0`,`@types/react`/`@types/react-dom` → `^19.0.0`(devDeps)。
- [ ] **Step 2** `packages/viewer/package.json`:`peerDependencies.react`/`react-dom` → `^19.0.0`(两端均 19,不再跨版本)。
- [ ] **Step 3** `pnpm install`。
- [ ] **Step 4** 核实 @types/react@18 是否已从树中消失:`find node_modules/.pnpm -maxdepth 1 -name '@types+react@18*'`。若**无**,可移除 `Canvas.tsx` 的 `as NodeTypes` 断言(改回 `const nodeTypes = { tile: TileNodeComponent }`)并验 `pnpm --filter @xenonbyte/forma-viewer typecheck` 仍绿;若仍有 18(其他包引入)则**保留断言**。
- [ ] **Step 5** 验证:`pnpm --filter @xenonbyte/forma-desktop typecheck`、`pnpm --filter @xenonbyte/forma-desktop test`(desktop 既有 vitest 3 单测)、`pnpm test` 全绿。
- [ ] **Step 6** Commit:
```bash
git add packages/desktop/package.json packages/viewer/package.json pnpm-lock.yaml packages/viewer/src/Canvas.tsx
git commit -m "feat(p9): bump desktop to React 19; narrow viewer peer to ^19

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task P9.2: preload bridge 第 8 只读方法 `formaServerBaseUrl` + IPC + DTO 拓宽

**Files:** `packages/desktop/src/preload/index.ts`、`packages/desktop/src/main/index.ts`、`packages/desktop/src/renderer/forma.d.ts`、对应 `*.test.ts`(`api-surface.test.ts`/`index.test.ts`)

- [ ] **Step 1: 写失败测试** — 在 `preload/api-surface.test.ts` 的 `ALLOWED_METHODS` 与 `preload/index.test.ts` 的 `EXPECTED_API_KEYS` 加 `'formaServerBaseUrl'`(8 个);在 `main/index.test.ts` 加:`registerFormaIpcHandlers` 注册了 `forma:serverBaseUrl` 且调用 `client.serverBaseUrl()`。先跑确认失败。

- [ ] **Step 2: preload** — `packages/desktop/src/preload/index.ts` 的 `readonlyApi` 加:
```ts
  formaServerBaseUrl: () => ipcRenderer.invoke('forma:serverBaseUrl'),
```
（注释"exactly these seven"改为"eight readonly methods"。）

- [ ] **Step 3: main** — `FormaDesktopClient` 接口加 `serverBaseUrl(): string;`;`createFormaHttpClient` 返回对象加 `serverBaseUrl: () => baseUrl,`;`registerFormaIpcHandlers` 加 `ipcMain.handle('forma:serverBaseUrl', () => client.serverBaseUrl());`。

- [ ] **Step 4: forma.d.ts** — `FormaDesktopAPI` 加 `formaServerBaseUrl(): Promise<string>;`;`FormaArtifact` 拓宽(承载 viewer 映射所需,来自 P0 已扩展的 server 列表):
```ts
interface FormaArtifact {
  id: string;
  kind: string;
  title: string;
  preview_url?: string;
  updated_at: string;
  requirement_id?: string;
  page_id?: string;
  variant?: string;
  current_version?: number;
}
```
（`listArtifacts` 返回类型已是 `{ artifacts: FormaArtifact[] }`,字段透传 P0 扩展后的 server 列表。）

- [ ] **Step 5** 跑测试绿(preload/main);`pnpm --filter @xenonbyte/forma-desktop typecheck`;Commit:
```bash
git add packages/desktop/src/preload/index.ts packages/desktop/src/main/index.ts packages/desktop/src/renderer/forma.d.ts packages/desktop/src/preload/*.test.ts packages/desktop/src/main/index.test.ts
git commit -m "feat(p9): expose formaServerBaseUrl readonly bridge method + widen artifact DTO

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task P9.3: desktop `ResourceResolver`(指向本地 forma server 的绝对 URL)

**Files:** Create `packages/desktop/src/renderer/viewer/resolver.ts`、Test `…/resolver.test.ts`

- [ ] **Step 1: 失败测试** — 与 web `resolver.test.ts` 同构,但 base 是绝对的:`createDesktopResourceResolver("http://127.0.0.1:3000", "p1")`,断言 bundle → `http://127.0.0.1:3000/api/products/p1/artifacts/a/versions/3/bundle/index.html`、preview density `2x` → `…/preview/2x.png`、asset path → `…/bundle/<path>`,且 baseUrl 末尾斜杠归一。

- [ ] **Step 2: 实现**:
```ts
import type { ResourceRef, ResourceResolver } from "@xenonbyte/forma-viewer";

/** desktop 资源解析器:URL 路径与 web 一致,base 指向本地 forma server(经 preload formaServerBaseUrl 取得)。 */
export function createDesktopResourceResolver(baseUrl: string, productId: string): ResourceResolver {
  const base = baseUrl.replace(/\/+$/, "");
  const pid = encodeURIComponent(productId);
  return {
    resolve(ref: ResourceRef): string {
      const aid = encodeURIComponent(ref.artifactId);
      const root = `${base}/api/products/${pid}/artifacts/${aid}/versions/${ref.version}`;
      if (ref.kind === "preview") return `${root}/preview/${ref.density ?? "1x"}.png`;
      if (ref.kind === "asset") return `${root}/bundle/${ref.path ?? ""}`;
      return `${root}/bundle/index.html`;
    }
  };
}
```
- [ ] **Step 3** 测试绿 + typecheck + Commit `feat(p9): desktop ResourceResolver (local forma server absolute URLs)`。

### Task P9.4: desktop viewer 数据映射

**Files:** Create `packages/desktop/src/renderer/viewer/mapArtifacts.ts`、Test `…/mapArtifacts.test.ts`

- [ ] 与 P8.1 同构(纯函数 + 平台默认尺寸),输入用 desktop `FormaArtifact[]` + requirement pages(`getRequirement` 返回的 pages:`{page_id,name}`)+ platform。**只取 design-page 且 page_id/variant/current_version 齐全**;`page_id`/`variant`/`current_version` 必须来自 P0 扩展的列表 DTO,**不得从 URL/标题推断**(spec)。按需求入口过滤 `requirement_id===reqId`,按页面入口加 `&& page_id===pageId`。测试断言映射形状与过滤;实现照 P8.1 的 `mapArtifactsToViewerInputs` 适配 desktop 类型。Commit `feat(p9): desktop artifact->viewer input mapping`。

### Task P9.5: IA 外壳(统一工作区)+ hash 路由 + clean tokens.css

**Files(Create,均 `packages/desktop/src/renderer/`):** `AppShell.tsx`、`Sidebar.tsx`、`TopBar.tsx`、`WorkspacePane.tsx`、`ConnectionGate.tsx`、`StyleDetail.tsx`、`router.ts`(hash 路由)、`theme.css`(import clean tokens + 外壳样式);Modify `main.tsx`(挂 `ConnectionGate`→`AppShell`)。旧 `SessionGate`/`ProductsHome`/`ProductView`/`ArtifactDetail` 及其测试**替换/删除**。

> 每个组件**纯只读**、消费 `window.forma`、用 clean tokens.css 的 CSS 变量(无内联裸 `#ccc`)。下列给职责 + 关键结构 + 数据接线 + 测试要点;实现按此 + 既有 React 18→19 测试惯例(`createRoot`/`act`,happy-dom 单测;真实 DOM 量测归 P9.6 dogfood)。

- [ ] **Step 1 `theme.css`**:`@import` 或构建期注入 `styles/clean/tokens.css`(electron-vite 经相对路径/别名引入仓库 `styles/clean/tokens.css`;若构建不便,把 `clean/tokens.css` 内容复制为 `packages/desktop/src/renderer/clean.tokens.css` 并 import),其下定义外壳用到的 CSS 变量(背景/前景/accent/字号 scale/圆角)。外壳组件一律用 `var(--…)`,不写裸色值(dogfood 前提)。

- [ ] **Step 2 `ConnectionGate.tsx`** — props `{ children }`;挂载时 `window.forma.formaServerStatus()`;`false`→渲染全屏遮罩(中文文案 + 重试按钮再调一次);`true`→渲染 `children`(AppShell)。测试:mock `window.forma`,断言断连渲染遮罩(`[data-gate="disconnected"]`)、连通渲染 children。

- [ ] **Step 3 `Sidebar.tsx`** — props `{ products, activeProductId, requirements, pages, styles, nav, onSelect }`;渲染:产品切换(下拉)、导航分区"需求 / 页面 / 风格"列表(各项 `<button data-nav-…>` → `onSelect`)、底部连接状态点。测试:渲染分区与项、点击回调。

- [ ] **Step 4 `TopBar.tsx`** — props `{ productName, crumb }`;面包屑 + 产品名。测试:渲染文案。

- [ ] **Step 5 `WorkspacePane.tsx`** — props `{ selection, productId, baseUrl }`;按 selection:
  - `{type:"requirement", reqId}` → 加载 `getRequirement`+`listArtifacts`→ `mapArtifactsToViewerInputs`(entry `requirement`)→ `<Viewer model resolver={createDesktopResourceResolver(baseUrl, productId)} />`。
  - `{type:"page", reqId, pageId}` → 同上,entry `page`,加 page 过滤。
  - `{type:"style", name}` → `<StyleDetail name>`。
  测试(happy-dom,mock window.forma + `vi.mock("@xenonbyte/forma-viewer")` 替身):断言传给 Viewer 的 model.entry / artifacts 过滤正确(与 web ViewerPage 测试同法)。

- [ ] **Step 6 `StyleDetail.tsx`(desktop)** — props `{ name }`;`window.forma` 暂无 getStyle(只读 7+1 方法不含风格)——**经本地 server HTTP** 取:`fetch(`${baseUrl}/api/styles/${name}`)` 得 `BrandStyleContent`,渲染 DESIGN.md + tokens + components.html iframe(sandbox 无脚本),与 web StyleDetail 同。测试:mock fetch 返回三文件,断言渲染。

- [ ] **Step 7 `router.ts` + `AppShell.tsx`** — hash 路由(`#/products/:pid/requirements/:reqId`、`…/pages/:pageId`、`#/styles/:name`),解析 hash→selection;`AppShell` 组合 Sidebar + TopBar + WorkspacePane,持有 selection 状态 + 启动加载(`listProducts`,选首个产品后 `listRequirements`/`listArtifacts`/system+brand styles 列表)+ `formaServerBaseUrl()` 取一次 baseUrl 传给 WorkspacePane。`main.tsx` 渲 `<ConnectionGate><AppShell/></ConnectionGate>` + import `theme.css`。测试:路由解析纯函数;AppShell 装配(mock window.forma)。

- [ ] **Step 8** 删旧屏(SessionGate/ProductsHome/ProductView/ArtifactDetail + 测试);`pnpm --filter @xenonbyte/forma-desktop typecheck` + `test` 绿;`pnpm desktop:dev` 可起(人工/CI smoke 视情况)。Commit `feat(p9): unified-workspace desktop shell (sidebar IA, clean tokens, read-only) + viewer integration`。

### Task P9.6: dogfood — 根 vitest4 browser project + 6 屏 craft lint

**Files:** Modify `vitest.config.ts`(根:加 `desktop-shell` browser project);Create `packages/desktop/src/renderer/*.dogfood.browser.test.tsx`(6 屏)

- [ ] **Step 1: 根 vitest.config.ts 加 project** — 在现有 `projects` 数组(unit + viewer)后加第三个 `desktop-shell` browser project,复用 viewer project 的 playwright/chromium + `optimizeDeps.include`(react/react-dom/jsx runtime + @xyflow/react);`include: ["packages/desktop/src/renderer/**/*.dogfood.browser.test.tsx"]`;`resolve.alias` 同 workspaceAliases。（desktop 自身 vitest 3 单测项目不变。）

- [ ] **Step 2: 6 屏 dogfood 测试** — 每个测试在真实 chromium 渲染一屏(mock `window.forma` 注入假数据;viewer 屏可让 `<Viewer>` 真实渲染或对 RF mock——dogfood 关注**外壳 chrome** 的文本,viewer tile 是 iframe、不进 `extractSnapshotInPage` 的 textNodes),然后:
```tsx
import { extractSnapshotInPage } from "@xenonbyte/forma-core";
import { lintCraft } from "@xenonbyte/forma-core";
// …createRoot 渲染该屏到 document.body,await 布局…
const snapshot = extractSnapshotInPage();      // 读真实 document
const checks = lintCraft(snapshot);            // 4 条规则
for (const c of checks) expect(c.passed).toBe(true);
```
覆盖 spec 的 6 屏:需求设计画布、需求标注画布、页面设计画布、页面标注画布、风格详情、断连遮罩。**外壳文本(sidebar/topbar/gate/风格详情)须过 contrast≥4.5 / 字号取 type scale / 调色板克制 / 字体族 ≤3**——这正是消费 clean tokens.css 的目的。

> 执行期:`extractSnapshotInPage`/`lintCraft` 须从 `@xenonbyte/forma-core` 导出可达(`grep -n "extractSnapshotInPage\|lintCraft" packages/core/src/index.ts`;未导出则在 core index 补 `export`,作为本 task 第 0 步,单独提交)。`ArtifactCraftCheck` 的"通过"字段名以 `artifact-manifest.ts` 实际为准(`grep -n "interface ArtifactCraftCheck" packages/core/src/artifact-manifest.ts` 核对 `passed`/`pass`/`ok`)。

- [ ] **Step 3: 验证** — 后台运行 + 写日志(勿管道 tail):`npx vitest run --project desktop-shell > /tmp/p9-dogfood.log 2>&1`,读日志确认 6 屏 lint 全过、无 flaky reload;`pnpm test` 全量(unit + viewer + desktop-shell 三 project)全绿不回退。
- [ ] **Step 4: Commit** `test(p9): dogfood craft-lint for desktop shell screens (root vitest browser project)`。

> **P9 验收**:两入口经共享 `<Viewer>` 可用、设计/标注画布可切换;外壳统一工作区 + 侧边栏、消费 clean tokens.css、无裸样式;6 屏渲染后过同一套 craft lint(CI 可执行);纯只读;中文;`pnpm desktop:dev` 可跑;`pnpm test`/`typecheck`/`build` 全绿;desktop React 19、viewer peer ^19、P7 React-18-未测 nit 结清。

---

## 自审(against spec)

**Spec 覆盖(总纲 P8 + P9 spec):**
- P8 web 接 viewer 两入口 → P8.1/P8.2/P8.3 ✅;双风格+platform+language → P8.4/P8.5 ✅;后台风格三文件展示 → P8.5 ✅;viewer 复用未重写 → 仅 import `@xenonbyte/forma-viewer` ✅。
- P9 desktop 接 viewer(IPC/本地 server URL)→ P9.2/P9.3/P9.4/P9.5 ✅;IA 重构统一工作区 → P9.5 ✅;dogfood 同套 craft lint → P9.6 ✅;React 19 + peer ✅ P9.1;纯只读 → 全程无 mutation 入口 ✅。
- 共享前置(读取面缺字段)→ P0 ✅(两端共用)。

**类型一致性:** `NormalizeArtifactInput`/`ResourceRef`/`ResourceResolver`/`ViewerEntry` 取自 `@xenonbyte/forma-viewer`(P7 已定);`ArtifactSummary`(web)/`FormaArtifact`(desktop)在 P0/P9.2 统一加 `page_id`/`variant`/`current_version`;`BrandStyleContent`/`StyleMetadata` 对齐 core;resolver URL 路径 web/desktop 一致(仅 base 差)。

**Placeholder 扫描:** 无 TBD/TODO。少量"执行期核对/二选一"(@types/react@18 是否残留 → 决定是否去 cast;theme.css 引入方式;`ArtifactCraftCheck` 字段名;extractSnapshotInPage/lintCraft 是否已 core 导出)为**有意的执行期确认点**,均给了确认命令与两种走法,非占位。P8.5/P9.5 的大组件给了职责+关键结构+数据接线+测试要点而非逐行重抄既有组件——执行者按既有同构组件惯例落地。

**已知风险:**
- desktop React 19 + electron-vite(vite 5)/vitest 3 兼容:P9.1 以 `pnpm desktop:dev` + desktop test 验证;dogfood 走**根 vitest 4**(不动 desktop vitest 3),规避 vite5/vitest4 冲突。
- clean tokens.css 引入 desktop 渲染:P9.5 Step 1 给两种走法(别名引入 / 复制内容),dogfood lint 是其正确性裁判。

## 执行 Handoff

计划保存于 `docs/superpowers/plans/2026-05-31-p8-p9-viewer-integration.md`。建议用 **superpowers:subagent-driven-development** 串行执行:P0 →(P8.1…P8.5)/(P9.1…P9.6)。P8、P9 仅共享 P0,可并行或顺序;每 task implementer + spec 评审 + 代码质量评审,浏览器测试用后台+日志纪律。
