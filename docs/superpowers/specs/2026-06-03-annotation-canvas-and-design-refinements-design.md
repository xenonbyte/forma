# Forma 标注画布与设计交付细化 — 需求文档

- 日期: 2026-06-03
- 状态: 草案（待实施）
- 建议分支: `feat/annotation-canvas-refinements`
- 关联: 续接已合并的 icon-export / VZI design-handoff 特性（`docs/superpowers/specs/2026-06-01-icon-export-design-handoff-design.md`）

---

## 1. 背景

1. **交付物已产出，但产品端无法消费。** 归档需求时，Forma 已经把最终设计转换为页级 icons（`<artifactId>/icons/` + `icons.json`）与 `.vzi` 文件（`<artifactId>/vzi/page.vzi`）。但当前只有 MCP 工具（`get_design_handoff` / `get_page_ui` / `get_ui_node` / `search_page_ui`）能读取这些交付物；web 与 desktop 都没有任何可视化入口。HTTP 层也无法取到 `.vzi`：现有 bundle 路由（`packages/server/src/routes.ts` 的 `…/versions/:v/bundle/*`）只服务 `v{n}/` 目录，覆盖不到其兄弟目录 `vzi/`、`icons/`。

2. **VZI 渲染存在两条并存路径，且都未接入任何 app。** `@xenonbyte/forma-vzi-renderer` 同时提供：
   - **CanvasKit live 渲染**（`CanvasKitSurface.tsx`，1093 行 + Border/Color/Gradient/Shadow/TextStyle 五个 converter + `FontManager`/`FontCache` + 命中索引）：从 IR 元素实时矢量渲染，保真度高。
   - **snapshot PNG 瓦片渲染**（`VZIRenderer.tsx` 的 `full|tile` 模式 + `tile/TileRenderEngine` + `snapshot/` + `SnapshotAnnotationOverlay`）：基于预烘焙 PNG 瓦片。
   经核查，`@xenonbyte/forma-vzi-renderer` 不被任何 app 包（web/desktop/server/mcp）依赖，两条路径都处于"已实现未接线"状态。

3. **生成侧两处长期痛点：**
   - 移动端设计稿被提示词强制绘制手机外壳（iPhone/Pixel frame、Dynamic Island、状态栏、home indicator），来源在 `packages/od-contracts/src/prompts/`。
   - 页面生成对"忠实需求"的约束偏弱：提示词鼓励"比要求更进取一步"，导致模型**加戏**（捏造需求未声明的页面/功能/元素）或**漏元素**。

4. **桌面端左栏混入与核心工作流无关的"品牌风格"导航**（`packages/desktop/src/renderer/Sidebar.tsx`）。

---

## 2. 目标

1. 为**归档需求**提供一个可视化**标注页**：无限画布，用 **CanvasKit** 渲染该需求下所有页面的 `.vzi`，支持平移/缩放与元素选中，为后续标注/检视打底。
2. **收敛 VZI 渲染为单一路径**：保留 CanvasKit，**移除 snapshot/PNG 瓦片**渲染路径。
3. **字体本地预埋**：CanvasKit 渲染零远程字体依赖；确定的资源数据直接打进包。不考虑包体积。
4. **生成侧收紧**：移动端去手机外壳；提高页面元素/功能对需求的**忠实度约束**。
5. **桌面端彻底移除品牌风格导航**（含 `style` 路由与 `StyleDetail`）。

---

## 3. 非目标

- **不**引入 leafer-ui 到标注页。已评估：从零做的 leafer 矢量渲染保真度明显低于现有 CanvasKit（leafer 路线只能从 forma2 那个 4 类型 / 6 样式属性的简化器起步，缺渐变/阴影/复杂边框/文本换行对齐）。按"保真度优先"裁定用 CanvasKit。
- **不**做 fm-design 元素级局部修改（架构外，见 §5.7，单独立项）。
- **不**做桌面端标注入口（仅 Web）。
- **不**做包体积优化（按指示，资源预埋优先于体积）。
- **不**改动 core 的 Puppeteer 预览截图链路与文件备份快照（见 §4 澄清）。

---

## 4. 名词澄清：三个互不相干的 "snapshot"

仓库里 "snapshot" 一词承载三种完全独立的含义，**本次只移除第 1 类**：

| # | 含义 | 位置 | 本次处置 |
|---|------|------|---------|
| 1 | **VZI snapshot 渲染**（PNG 瓦片） | `vzi-renderer/src/snapshot/`、`components/VZIRenderer.tsx`(full\|tile)、`components/SnapshotAnnotationOverlay.tsx`、`tile/*`、`vzi-types/src/snapshot.ts` | **移除** |
| 2 | **预览截图 + rendered-DOM 快照** | `core/src/preview-renderer.ts`（Puppeteer `page.screenshot()`）、`core/src/quality/rendered-dom.ts`（`extractSnapshotInPage` 供 craft-lint） | **保留，不动** |
| 3 | **文件内容备份快照** | `core/src/requirement.ts` 的 `snapshotFiles`/`restoreSnapshots`（原子写回滚） | **保留，不动** |

> 关键约束：实施"去 snapshot"时，搜索面必须限定在 `packages/vzi-renderer` 与 `packages/vzi-types/src/snapshot.ts`，**不得**触碰 `core/preview-renderer.ts`、`core/quality/*`、`core/requirement.ts` 中的同名概念，否则会破坏预览生成与原子写。

---

## 5. 详细需求

### 5.1 标注页（Web · CanvasKit 单 surface 无限画布）

**入口**：`packages/web/src/pages/ProductDetail.tsx` 需求列表行（`:259` 起的 grid，现为 4 列）。新增一列放"标注"按钮，**仅当 `requirement.status === "archived"`** 时渲染（与 Archive 按钮天然互斥：Archive 在 `status !== "active"` 时 disabled）。点击导航到新路由。

**路由**：`packages/web/src/routes.tsx`（`:48` 路由表）新增 `/products/:productId/requirements/:reqId/annotation`。i18n（`packages/web/src/i18n.ts`）新增 `action.annotate`。

**数据流**：

```
归档交付物 (disk):  data/products/<pid>/od-project/artifacts/<aid>/vzi/page.vzi
                                                              /icons/*  + icons.json
  │  ① core 新服务: listRequirementHandoffPages(pid, reqId)
  │     —— 从 mcp/src/design-handoff.ts 的 resolveArchivedPagePointers 抽出共享逻辑
  │        （按 requirementId + generatedFrom='requirement-archive' 锁定归档版本，
  │         跳过 .tmp- 目录，读 icons.json manifest）
  ▼
server 新增 3 路由 (packages/server/src/routes.ts):
  ② GET /api/products/:pid/requirements/:reqId/handoff
       → { pages: [{ pageId, artifactId, variant, vziUrl, iconBaseUrl }] }
  ③ GET /api/products/:pid/artifacts/:aid/vzi/page.vzi
       → 二进制 (application/octet-stream)，沿用 bundle 路由的 isSameOrChildPath 越界校验
  ④ GET /api/products/:pid/artifacts/:aid/icons/*
       → 图标资源 (供页面内 <img>/svg 引用解析)
  │
  ▼ fetch (arraybuffer)
web AnnotationPage (新页面 packages/web/src/pages/AnnotationPage.tsx):
  ⑤ 每页 .vzi → new VZIDecoder().decodeContent(bytes) → VZIContent { elements, metadata, annotations }
  ⑥ buildCanvasKitElementTree(content) 得每页根树；按 x 轴累加偏移
     (x = Σ(前序页宽 + gap)) 合成为单个 IRElement[]，每页包一层带页名的 frame 容器
  ⑦ 渲染单个 <CanvasKitSurface
        elements={合成后的 IRElement[]}
        interactive panOnPrimaryDrag
        viewport / onViewportChange   (内置缩放/平移)
        onSelectElement={…}            (内置命中测试)
     />
  ⑧ (phase 2) 标注层：VZIContent.annotations 矢量叠加 + 选中元素检视面板 (bounds/styles/tokens)
```

**单 surface 合成的依据**：`CanvasKitSurface` 的 props 接受 `elements?: IRElement[]`（多棵根树数组）或 `ir`，并内置 `viewport`（offsetX/offsetY/scale）平移缩放与 `onSelectElement`/`onHoverElement` 命中。因此把每页根树按布局偏移合并为一个 `IRElement[]`，即可用**单个 WebGL 上下文**渲染整个无限画布，规避多上下文上限（浏览器约 16 个）。

**web 新增依赖**：`@vzi-core/format`（`VZIDecoder`）+ `@xenonbyte/forma-vzi-renderer`（`CanvasKitSurface`），并在 web 的 Vite 配置接入 `canvaskit-wasm`（仓库根已有 `canvaskit-wasm@0.40.0`）的 wasm 资源加载。

**布局**：页面按需求的页顺序水平平铺（`page_id` 顺序，与 `getRequirementPageIds` 一致），页间留 gap，每页顶部显示页名/variant。初始视口 fit-to-content。

### 5.2 VZI 渲染收敛：移除 snapshot，仅保留 CanvasKit

**移除**（限定 `packages/vzi-renderer` 与 `packages/vzi-types/src/snapshot.ts`）：
- `vzi-renderer/src/snapshot/`（`manifest.ts`、`index.ts`）
- `vzi-renderer/src/components/VZIRenderer.tsx`（`full|tile` PNG 模式入口）及其 `VZIRenderMode`/`VZIViewportState` 导出
- `vzi-renderer/src/components/SnapshotAnnotationOverlay.tsx`
- `vzi-renderer/src/tile/`（`TileRenderEngine`、`ViewportCache`、`TileManager`/`TileCache`/`TileHashMap` 等）
- `vzi-renderer/src/node.ts` 中基于 `createDesignSnapshotManifest` 的离屏 PNG 生成路径（若整文件仅服务 snapshot，则整文件移除；若混用，仅摘除 snapshot 分支）
- `vzi-types/src/snapshot.ts`（`DesignSnapshotManifest`、`SnapshotBounds`、`SnapshotOutputFormat` 等）——需先确认无残余引用（见下）
- `vzi-renderer/src/index.ts` 中相关 re-export

**保留**：
- `vzi-renderer/src/canvaskit/**` 全部 + `components/CanvasKitSurface.tsx`、`components/FocusedPreviewSurface.tsx`
- `buildCanvasKitElementTree` / `flattenCanvasKitElements`
- CanvasKit 的 annotation 渲染模块（`canvaskit/annotations/**`，非 Snapshot 版）

**实施约束**：移除前用 `codegraph_impact` / grep 确认 `DesignSnapshotManifest` 等类型在 `vzi-transformer`、`od-*`、`core` 中无运行期引用；如有（例如 `vzi-transformer/src/mcp/types.ts`、`od-platform`），需一并清理或解耦，且**不得**误删 §4 第 2/3 类 snapshot。

### 5.3 字体预埋与资源内嵌（零远程拉取）

**现状**：`vzi-renderer/src/canvaskit/FontManager.ts` 从远程拉取字体——`raw.githubusercontent.com/google/material-design-icons/...`、`fonts.googleapis.com/...`（`:228-239`），配合 `FontCache`（IndexedDB）缓存，`withLocalFontFirst` 仅"本地优先再回退远程"。

**要求**：
1. 将渲染所需字体（正文字族 + Material Icons/Symbols 等图标字体）以**本地字体文件**形式打进包（随 `@xenonbyte/forma-vzi-renderer` 或 web 资源发布），尽可能多预埋常用字族。
2. `FontManager` 改为**纯本地加载**：默认字体与图标字体全部来自打包资源；移除/停用远程 URL 回退，使任意环境下 CanvasKit 渲染**不产生网络请求**。保留 `FontCache` 作为运行期内存/IndexedDB 缓存即可。
3. 其它"确定的资源数据"（如固定图标集）同样直接内嵌。
4. 不考虑包体积。

**可观测性**：字体缺失/加载失败必须显式报错或日志（不静默回退到错误字形），符合仓库"fail-loud、no silent fallback"原则。

### 5.4 移动端去手机外壳（生成提示词侧）

**来源已定位**（`packages/od-contracts/src/prompts/`）：
- `discovery.ts:216` "Real iPhone frame (Dynamic Island, status bar SVGs, home indicator)"
- `discovery.ts:260-261` iOS/Android 各自 frame
- `discovery.ts:270-298` 共享 frame 资源 + "mobile-app skill 在 seed 里内联 iPhone frame"
- `system.ts:455` 鼓励 device mockup
- `web/src/components/PlatformTemplatePreview.tsx:1286` 的 `"phone frame"` 描述符

**要求**：将上述指令改为——**移动端只输出页面内容本身，不绘制设备外壳/状态栏/灵动岛/home indicator/设备 bezel**。保留移动端必要的安全区与触达尺寸规范（44/48px hit target）等内容性约束，仅去掉设备外壳渲染。实施时若发现 seed HTML 中确有内联 iPhone frame，一并移除。

**风险**：影响后续所有移动端生成 → 实施后须重跑一次移动端生成做视觉验收。

### 5.5 页面生成忠实度约束收紧（对应确认问题 Q1）

**问题定性**：生成完全由 `get_design_context`（返回 page spec + craft rules + style tokens）驱动，无 schema 强制"只生成需求声明的元素"。而 `od-contracts` 系统提示词（如 `official-system.ts:118` "a notch more ambitious than what was asked"）把"进取"导向了**范围扩张**，导致加戏/漏元素。

**要求（提示词层面收紧，不加结构校验）**：
1. 在 `packages/agent/templates/claude/fm-design.md` 与对应 `templates/codex/fm-design/SKILL.md` 增加一条**范围忠实度（scope-fidelity）硬约束**：
   > 严格实现需求 page spec 中列出的页面、区块、功能与元素；**不得新增**需求未声明的页面、功能、控件或区块；如确有歧义，按 page spec 字面执行而非自行补全。
2. 调整 `od-contracts` 中导致范围膨胀的"进取"措辞（`official-system.ts:118`、`system.ts`/`directions.ts` 相关行），把"ambition / decisive flourish"的发挥**限定在视觉工艺与交互质量**，明确"不通过扩张范围来体现进取"。
3. 保留既有 craft 质量约束（contrast/type-scale/交互保真等），仅新增范围忠实度维度。

**验收**：用一个"元素清单明确"的需求做对照生成，确认产物只含声明元素、无凭空新增页面/功能。

### 5.6 桌面端彻底移除品牌风格导航（彻底版）

**移除清单**（`packages/desktop/src/renderer/`）：
- `Sidebar.tsx`：删除 `品牌风格 <section>`（`:121-139`）、`brandStyles` prop、`SidebarBrandStyle` 接口。
- `AppShell.tsx`：删除 `brandStyles` state（`:61`）、启动时 `forma.listStyles()` 调用与下发（`:80-88`）、所有 `style` nav 分支（`:42-43`、`:97`、`:128`、`:162`、`:220-221`、`:248`、`:265`）。
- `WorkspacePane.tsx`：从 `WorkspaceSelection` 删除 `{ type: 'style' }`（`:16`）及 `style` 渲染分支（`:31`），更新 `:52` 空态文案（去掉"品牌风格"）。
- `router.ts`：删除 `style` 路由类型与解析（`:14-17`、`:36`）。
- `StyleDetail.tsx`：删除（成为死代码）。
- `theme.css`：相关 `.sidebar__*` 品牌样式类如不再被引用可清理（可选）。

**验收**：桌面端左栏只剩 产品切换 / 需求 / 页面 + 连接状态；无任何品牌风格入口；`style` 路由不可达；typecheck 无残引用。

### 5.7 fm-design 局部修改（对应确认问题 Q2）— 现状澄清，非本次范围

**结论**：当前**不支持**元素级/局部修改。`fm-design.md` 的 Described 模式是**整页重生成**（"regenerate only that page"），`generate_requirement_design` 接收整页 HTML 并产出新 `v{n}`，模型每次重写整页。真正的局部 patch 需要新增 diff/patch 语义，属架构级改动，**本次不做**，在此记录为已知限制，待后续单独立项。

---

## 6. 受影响文件清单（按包）

| 包 | 文件 | 改动 |
|---|---|---|
| core | `src/requirement-handoff-pages.ts`（新） | 抽出归档页清单共享服务 |
| core | `src/index.ts` | 导出新服务 |
| mcp | `src/design-handoff.ts` | 复用 core 共享服务，去重 `resolveArchivedPagePointers` |
| server | `src/routes.ts` | 新增 3 路由（handoff 清单 / vzi 二进制 / icons） |
| web | `src/pages/ProductDetail.tsx` | 归档行新增"标注"按钮列 |
| web | `src/routes.tsx`、`src/i18n.ts` | 新路由 + 文案 |
| web | `src/pages/AnnotationPage.tsx`（新） | 标注画布页 |
| web | `src/api.ts` | `getRequirementHandoff` / `vziUrl` / `iconUrl` + 类型 |
| web | `package.json`、`vite.config.ts` | 加 `@vzi-core/format`、`@xenonbyte/forma-vzi-renderer`、canvaskit-wasm 接线 |
| vzi-renderer | `src/snapshot/`、`components/VZIRenderer.tsx`、`components/SnapshotAnnotationOverlay.tsx`、`tile/`、`node.ts`、`index.ts` | 移除 snapshot 路径 |
| vzi-renderer | `src/canvaskit/FontManager.ts` + 字体资源 | 本地预埋、零远程 |
| vzi-types | `src/snapshot.ts` | 移除 snapshot 类型 |
| od-contracts | `src/prompts/discovery.ts`、`system.ts`、`directions.ts`、`official-system.ts` | 去手机外壳 + 收紧范围忠实度 |
| agent | `templates/claude/fm-design.md`、`templates/codex/fm-design/SKILL.md` | 新增 scope-fidelity 约束 |
| desktop | `renderer/Sidebar.tsx`、`AppShell.tsx`、`WorkspacePane.tsx`、`router.ts`、删 `StyleDetail.tsx` | 彻底移除品牌风格 |

> 规模：跨 8+ 文件 + 一项新集成（CanvasKit-wasm 首次进 web）+ 一项删除（snapshot 路径）。属中大型改动，但按用户要求**统一在本需求文档内、一次性推进**，不拆分批次。

---

## 7. 验收标准

1. 归档某需求后，需求列表该行出现"标注"按钮（仅归档态）；点击进入标注页。
2. 标注页在无限画布上以 CanvasKit 渲染该需求**全部页面**的 `.vzi`，水平平铺、可平移/缩放、可点选元素；单 WebGL 上下文。
3. 全仓库 VZI 渲染只剩 CanvasKit；`vzi-renderer` 无 snapshot/tile 残留；`grep -r "DesignSnapshotManifest"` 在 src 中无引用。§4 第 2/3 类 snapshot 完好。
4. CanvasKit 渲染过程**零远程网络请求**（断网可正常渲染常用字族与图标字体）。
5. 重新生成的移动端设计稿**无手机外壳**。
6. 对"元素清单明确"的需求，生成产物只含声明元素、无凭空新增。
7. 桌面端左栏无品牌风格入口，`style` 路由不可达。
8. `pnpm typecheck` 与 `pnpm test` 全绿。

---

## 8. 验证命令

```bash
pnpm typecheck
pnpm test
# 针对性:
npx vitest run packages/core/tests/requirement-handoff-pages.test.ts
npx vitest run packages/server/tests/routes.test.ts
npx vitest run packages/web/src/pages/AnnotationPage.test.tsx
npx vitest run packages/web/src/pages/ProductDetail.test.tsx
pnpm check:vzi-boundary             # scripts/check-vzi-renderer-boundary.mjs，校验 vzi 渲染器 import 边界
```
手动验收：归档需求 → 打开标注页（平移/缩放/选中）；断网下重渲染验证字体；移动端重生成查外壳；桌面端查左栏。

---

## 9. 回滚

- 标注页（§5.1）、core 服务、server 路由：**纯新增**，删除即回滚，无数据迁移。
- snapshot 移除（§5.2）：从分支 revert 即恢复；snapshot 产物未被任何 app 消费，移除无生产数据影响。
- 字体预埋（§5.3）：恢复 `FontManager` 远程回退即可。
- 提示词（§5.4/5.5）：仅影响**未来**生成，不改动已存设计数据。
- 桌面品牌风格移除（§5.6）：UI/路由层，恢复文件即可。
- 全部改动**无数据库/磁盘 schema 迁移**，可整体回退。

---

## 10. 风险与遗留 unknown

1. **CanvasKit-wasm 首次进 web 的接线 + 字体预埋方式**（owner: 实施者，实施起步先做 ~30min spike）。理由：repo 内尚无 wasm 渲染器接入 app 的先例；需确认 Vite 的 wasm 资源加载、字体文件随包发布的路径解析、`FontManager` 初始化时机。属集成细节，非逻辑空缺。
2. **`DesignSnapshotManifest` 跨包引用面**：移除前必须用 `codegraph_impact` 核实 `vzi-transformer`/`od-*`/`core` 无运行期依赖；存在则需先解耦。
3. **提示词去外壳的副作用**：可能影响移动端整体观感，需重生成验收并按需微调措辞。
4. **多页 `.vzi` 合成的视口性能**：单 surface 合成大量元素时的渲染性能，需在真实归档需求（多页）上验证；必要时引入视口裁剪（仅渲染视口内页）。
