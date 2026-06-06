---
r2p_stage: design
r2p_version: 4
r2p_status: approved
r2p_created_at: 2026-06-06T09:34:31.919546+00:00
r2p_updated_at: 2026-06-06T10:18:31.913571+00:00
---

# Design

## Design Summary

三个改动面，单一 PR 内交付：

1. **生成规则 + 确定性防线（需求#1）**：在 `od-contracts` 提示词中追加"移动端最外层边缘必须直角"的固定语句（与既有 device-shell 禁令同落点）；同时在 core 的 craft lint 管线新增 `screen-edge-radius` 确定性检查——渲染 DOM 快照捕捉视口角落元素的 computed `border-radius`，移动端平台保存时检出最外层圆角（DEC-004，用户已确认双重防线）。管理端 `PlatformTemplatePreview` 中两处移动端 mock（`rounded-[24px] border-[6px]` 手机壳轮廓 + 假状态栏）同步改为直角全幅屏幕内容。
2. **无限画布直渲 HTML（需求#2）**：重写 `DesignView.tsx` 为 Stitch 式纯画布全幅页面（DEC-001/002）：复用 `forma-viewer` 的 `Canvas`（React Flow + `DesignTile` 沙箱 iframe + 视口虚拟化）+ `buildViewerModel` + web `mapArtifacts`/`resolver`，不再渲染 PNG 截图网格与 lightbox；删除 `/viewer` 与 `/pages/:pageId/viewer` 独立路由及 `ViewerPage.tsx`。
3. **需求详情精简（需求#3）**：`RequirementDetail.tsx` 只保留需求文档卡片；卡片右上角两个图标按钮：复制（`document_md` → 剪贴板，带成功反馈）与打开设计稿（链接到 `/design` 画布页）；移除逐页列表、右侧截图预览、导航面板与 `forma://` 深链（DEC-003）。

无待决事项：OQ-001→DEC-001（纯画布）、OQ-002→DEC-002（重写 /design 删 /viewer）、OQ-003→DEC-004（提示词+静态检查）、OQ-004→DEC-003（移除深链），均已由用户在检查点确认。

## Current Code Evidence

- `packages/web/src/pages/DesignView.tsx:99-155` — PNG 截图网格（`/preview/1x`）+ lightbox（`/preview/2x`），待重写。
- `packages/web/src/pages/RequirementDetail.tsx:104-207` — 文档 `<pre>` + 逐页列表（每页 `action.openDesign` 链到 `/design?page_id=`）+ 右栏截图预览/`forma://` 深链/导航面板，待精简。
- `packages/web/src/pages/ViewerPage.tsx` + `packages/web/src/routes.tsx:85-98,231-245` — 既有画布路由（`/viewer`、`/pages/:pageId/viewer`），grep 确认无应用内链接引用，仅路由注册与测试。
- `packages/viewer/src/Canvas.tsx:73-86` — React Flow 画布，`onlyRenderVisibleElements` 虚拟化；`tiles/DesignTile.tsx:15-23` — 沙箱 iframe（`sandbox="allow-same-origin allow-forms"`，无 `allow-scripts`）。
- `packages/viewer/src/Viewer.tsx:21-58` — 三栏布局（DesignList/Canvas/AnnotationSlot），桌面端 `WorkspacePane` 在用，**不动**；web 端绕过它直接组合 `Canvas`。
- `packages/web/src/viewer/mapArtifacts.ts:5-14` — 平台画布尺寸映射（mobile 390×844）；`resolver.ts` — bundle ResourceRef → `/api/.../versions/:v/bundle/` URL。
- `packages/core/src/design-save.ts:147-168` — 保存管线渲染预览并跑 `lintCraft(renderResult.snapshot)`；`SaveDesignInput.forma.platform` 字段存在（`design-save.ts:50`）**但生产调用方（MCP tools）从不填充**（`packages/mcp/src/tools.ts:234-245` schema `.strict()` 无 platform），platform 须从产品配置解析（`SaveDesignDeps.products` 可用）。`renderArtifactPreview` 支持 `viewport` 入参（`preview-renderer.ts:12,33`，默认 1280×800）。
- `packages/core/src/quality/rendered-dom.ts:35-38` — `RenderedDomSnapshot { viewport, textNodes }`，`extractSnapshotInPage()` 在浏览器内执行、必须自包含。
- `packages/core/src/quality/craft-lint.ts:43-53` — 纯函数 lint，返回 `ArtifactCraftCheck[]`（id: contrast-aa / type-scale / color-palette / font-families）。
- `packages/od-contracts/src/prompts/discovery.ts:216,260-261,268` — mobile/iOS/Android "screen content only — no device shell" 规则；`tests/system-prompt.test.ts` 已断言 shell 禁令（bdccbe5）。
- `packages/web/src/components/PlatformTemplatePreview.tsx:558-…,843-…` — `ProductStyleMobilePreview` / `MobileSpecPreview` 仍画 `rounded-[24px] border-[6px]` 手机壳轮廓 + "9:41" 假状态栏。
- `packages/web/src/components/Layout.tsx:151` — `WorkSurface({ children, title })` 无 actions 槽位，需扩展。

## Requirements Coverage

| 需求 | 覆盖设计项 |
|---|---|
| RAW#1 移动端外缘禁圆角 | DES-PROMPT-001、DES-LINT-001、DES-WEB-003 |
| RAW#2 无限画布直渲 HTML | DES-WEB-001、DES-ROUTE-001 |
| RAW#3 详情页仅文档+两图标 | DES-WEB-002 |
| AC-005 空态/`ui_affected=false` | DES-WEB-001/002 内嵌 |
| AC-006 测试与类型检查 | DES-TEST-001 |

## Options Considered

- **画布实现**（→DES-WEB-001）
  - A. 复用 `forma-viewer` 的 `Canvas` 组件直接组合（不经 `Viewer` 三栏外壳）✅ 选用：零新依赖、沙箱/虚拟化/定位已就绪、desktop 在用路径不受影响。
  - B. 在 web 包内用 `@xyflow/react` 重新写画布 — 重复造轮子，двух处维护。
  - C. 自研 transform/wheel 画布 — 工作量大且丢虚拟化。
- **路由归并**（→DES-ROUTE-001，DEC-002 已定）：重写 `/design` 为画布并删除 `/viewer` 两条路由；不做重定向（无应用内引用，书签失效落 NotFound 可接受，risk 已记 RISK-COMPAT-001 low）。
- **圆角防线**（→DES-LINT-001，DEC-004 已定）
  - A. 仅提示词 — 不确定性高。
  - B. 提示词 + 渲染 DOM computed-style 检查 ✅ 选用：拿到的是真实计算值（含 Tailwind/类名/内联所有来源），假阳性最低。
  - C. 提示词 + 静态 CSS 文本解析 — 无法可靠解析 utility class/层叠，弃。
- **复制按钮实现**（→DES-WEB-002）：`navigator.clipboard.writeText`，非 secure context 或失败时按钮态显示失败提示（不引入第三方库；admin 通常 localhost=secure context）。

## Chosen Design

### DES-PROMPT-001 移动端提示词追加"直角外缘"禁令
`packages/od-contracts/src/prompts/discovery.ts`：
- 行 216（Mobile app prototype）：在 "do NOT draw any device shell (…)" 后追加固定语句：`The outermost screen edges MUST be square — no border-radius on <body> or any full-bleed root container (no rounded screen silhouette).`
- 行 260（iOS）/ 261（Android）：在各自 "screen content only (…)" 括注里同步加 `square outer corners — no rounded screen edges`。
- 行 268（multi-screen side-by-side）：补充 plain content panels 的直角约束一句。
`packages/od-contracts/src/prompts/system.ts`（评审修订，点名落点）：在 **cross-platform deliverable rule（system.ts:416）** 与 **product-realism rule（system.ts:424）** 两条目内各追加同一句直角约束（system.ts 无 "device shell" 字样，不能以该词定位）；除此两处外 system.ts 不再扩散。
`packages/od-contracts/tests/system-prompt.test.ts`：新增断言——上述固定语句逐字出现在渲染后的 prompt 中（与既有 shell 禁令断言同模式）。

### DES-LINT-001 `screen-edge-radius` 确定性检查（craft lint 新规则）
0. **platform 来源（评审修订）**：`SaveDesignInput.forma.platform` 在生产路径上从未被调用方填充（MCP `generateRequirementDesignSchema` 为 `.strict()` 且无 platform 字段，`packages/mcp/src/tools.ts:234-245,448-457`）。因此 `saveDesignArtifact` 内自行解析：`const platform = forma.platform ?? (await products.getProduct(productId)).platform`（`SaveDesignDeps` 已含 `products`，`design-save.ts:74-78`），解析结果同时写入 manifest `forma.platform`（修复既有字段恒空问题）并传给 lint 与渲染。
1. **按平台视口渲染快照（评审修订）**：`design-save.ts:147` 现调用 `renderArtifactPreview` 不传 viewport（默认 1280×800，`preview-renderer.ts:33`），移动端固定宽 ~390px 的圆角"屏幕剪影"容器在 1280 视口下无法被全幅判定命中。修订：platform 为 `mobile` 时传 `viewport: { width: 390, height: 884 }`（对齐 core 既有 `requirement-vzi-capture.ts` 的 mobile 预设），其余平台维持默认。**附带行为变化（有意）**：mobile artifact 的 preview PNG 从桌面宽截图变为移动视口截图，预览更忠实；消费方（ProductDetail 卡片等）仅按 `<img>` 展示，不依赖固定宽高比。
2. `packages/core/src/quality/rendered-dom.ts`：
   - `RenderedDomSnapshot` 增加可选字段 `rootCorners?: { tag: string; radiusPx: [number, number, number, number]; coversViewport: boolean }[]`（四角 TL/TR/BR/BL 的 computed border-radius px 值）。
   - `extractSnapshotInPage()` 内（保持自包含）：取 `document.body` 与 body 的直接子元素中"覆盖视口"者（`getBoundingClientRect` 与视口交叠 ≥98% 宽且顶部 ≤2px 视为全幅根容器；视口已按平台修正，启发式可靠），读取 `getComputedStyle().borderTopLeftRadius` 等四值解析为 px，写入 `rootCorners`。旧快照无此字段 → 检查跳过（向后兼容，手工构建快照的测试不受影响）。
3. `packages/core/src/quality/craft-lint.ts`：
   - `LintOptions` 增加 `platform?: string`。
   - 新规则 `screenEdgeRadiusCheck`：仅当 `platform === "mobile"` 且 `snapshot.rootCorners` 存在时判定；任一全幅根容器（或 body）任一角 radius > 0 → `{ id: "screen-edge-radius", passed: false, detail: "<tag> has rounded outer corner(s): [..px]" }`；否则 passed: true。非 mobile 或无数据 → `passed: true, detail: "skipped (platform=<x>)"`（检查始终出现在 craftChecks 列表，可观测）。
4. `packages/core/src/design-save.ts:157`：`lintCraft(renderResult.snapshot, { platform })`（platform 取自第 0 步解析值）。
与既有规则一致：**非阻断**（保存成功，craftChecks 标 fail），由 fm-design 自审环节驱动重生成（fm-design.md 第 7 步已要求对 `passed:false` 修复重生成，无需改 skill 文案——新检查 id 自动纳入）。
**防空转护栏**：新增集成测试断言"mobile 产品保存设计后 craftChecks 含非 skipped 的 `screen-edge-radius` 结果"，防止防线静默失效。

### DES-WEB-001 DesignView 重写为 Stitch 式纯画布
`packages/web/src/pages/DesignView.tsx` 重写：
- 数据：`Promise.all([getProduct, getRequirement, listProductArtifacts])`（同现 ViewerPage 逻辑），按 `requirement_id` 过滤 + `mapArtifactsToViewerInputs`（平台尺寸沿用 `canvasSizeForPlatform`）→ `buildViewerModel({ entry: "requirement", artifacts })`。
- 渲染：全幅容器（`calc(100vh - <chrome>)`）直接挂 `forma-viewer` 的 `Canvas`（`mode="design"`、`resolver=createWebResourceResolver(productId)`）；不渲染 `Viewer` 三栏外壳（DEC-001）、不渲染 DesignList/AnnotationSlot；保留 React Flow `Background` 点阵底。模式固定 design（标注模式不进此页，AnnotationPage 不变）。
- 空态：无可渲染 artifact → 居中空态卡（沿用现 No designs yet 样式，文案 i18n 化）；`ui_affected=false` → 同空态文案变体。加载/错误态沿用 `StatePanel`。
- 顶栏：仅保留轻量返回链接（回需求详情）+ 需求 ID 标签，避免 Stitch 式画布上的多余 chrome。
- `ArtifactSummary` 类型/`filterDesignArtifacts` 等导出被 `RequirementDetail` 引用 — 重写时保留导出或上移至 `api.ts`（实现时定，保证编译）。

### DES-ROUTE-001 路由归并
`packages/web/src/routes.tsx`：
- 删除 `/products/:productId/requirements/:reqId/viewer` 与 `/products/:productId/requirements/:reqId/pages/:pageId/viewer` 两条注册及 `RequirementViewerRoute`/`PageViewerRoute`/`ViewerPage` import。
- 删除 `packages/web/src/pages/ViewerPage.tsx` 与其测试（其数据组装逻辑并入新 DesignView）。
- `/design` 路由保持原 path 不变（`DesignViewRoute`），title 不变。`routes.test.ts` 同步更新。

### DES-WEB-002 RequirementDetail 精简
`packages/web/src/pages/RequirementDetail.tsx` 重写为单列：
- 仅保留：顶部状态行（StatusBadge + `ui_affected=false` 徽标 + 需求 ID，保留——属于文档语境信息）+ 需求文档 `WorkSurface`。
- `WorkSurface`（`Layout.tsx:151`）增加可选 `actions?: ReactNode` 槽位，渲染在标题行右侧（向后兼容，其他调用点不变）。
- actions 内两个图标按钮（带 `aria-label` + title tooltip，inline SVG 图标，沿用 zinc/amber 按钮风格）：
  - **复制**：`navigator.clipboard.writeText(requirement.document_md)`；成功后图标短暂切换为 ✓（约 2s）并设 `aria-live="polite"` 提示；失败显示错误态。文档为空时禁用。
  - **打开设计稿**：`<a href={/products/:pid/requirements/:rid/design}>`；`ui_affected=false` 或无 html artifact 时禁用（灰态 + tooltip 说明），避免死链（AC-005）。判定复用现有 `listProductArtifacts(productId, "html")` 结果。
- 删除：逐页列表 `WorkSurface`、右栏 artifact 截图预览、`forma://` 深链（DEC-003）、导航面板及 `xl:grid-cols` 双栏布局。
- i18n：新增 `action.copyDocument`、`action.copied`、`requirement.openDesignDisabled` 等键；移除不再引用的 `requirement.pages*`、`design.artifactPreview`、`action.openInApp` 等死键。**注意（评审修订）**：`requirement.navigation` 被 `BaselineView.tsx:213` 使用，不在删除清单内；逐键 grep 确认无其他引用后才删除。

### DES-WEB-003 管理端移动端 mock 直角化
`packages/web/src/components/PlatformTemplatePreview.tsx`：`ProductStyleMobilePreview` 与 `MobileSpecPreview` 的外层 `rounded-[24px] border-[6px]`（手机壳轮廓）改为直角细边框屏幕面板（如 `border border-zinc-200`，无圆角），移除 "9:41" 假状态栏行——与生成规则"screen content only + square corners"对齐。

### DES-TEST-001 测试与验证
- od-contracts：`system-prompt.test.ts` 加固定语句**逐字出现**断言（注意：既有 de-shell 测试 `system-prompt.test.ts:111-120` 是否定式 not.toMatch 模式，新断言为肯定式，二者并存）。
- core：`craft-lint` 单测——手工快照含/不含 `rootCorners`、mobile/非 mobile、圆角/直角四象限；platform 解析（forma.platform 缺省时回退产品配置）单测；"mobile 保存 → 非 skipped screen-edge-radius"集成测试（防空转护栏）。
- web：重写 `DesignView.test.tsx`（渲染 Canvas 容器、空态、`sandbox` 属性断言不含 `allow-scripts`〔MIT-001〕）；重写 `RequirementDetail.test.tsx`(仅文档+两按钮、复制成功反馈 mock clipboard、禁用态、不再渲染 pages/navigation/preview)；删除 `ViewerPage.test.tsx`（评审核实：`routes.test.ts` 无 viewer 路由引用，仅在路由表快照类断言受影响时顺带更新）。
- 全量：`pnpm test` + `pnpm typecheck`。

## Decision Requests

none

## Rollback

- 全部为前端展示层 + 提示词 + 非阻断 lint 改动，无数据/磁盘格式/API 变更：`git revert` 单提交即可完全回滚。
- `screen-edge-radius` 为非阻断检查，异常时最坏情况是 craftChecks 多一条 failed 记录，不影响保存；`rootCorners` 字段可选，旧快照消费方不受影响。
- 路由删除可逆（revert 恢复 ViewerPage）。

## Observability

- `screen-edge-radius` 结果写入 artifact manifest 的 `forma.quality.craftChecks`，经 `get_product_artifact` / admin 可见；detail 文案包含违规 tag 与各角 px 值，可直接定位。
- 复制失败在按钮上呈现错误态（用户可感知），无 silent fallback。
- 画布加载失败沿用 `StatePanel` error 态展示 `error_code - message`。

## SPEC Handoff

- 实施顺序建议：DES-LINT-001（core，含测试）→ DES-PROMPT-001（od-contracts）→ DES-WEB-001/ROUTE-001（画布+路由）→ DES-WEB-002（详情页）→ DES-WEB-003（mock 直角化）→ DES-TEST-001 全量验证。
- 关键约束传递给 SPEC：① DesignTile 沙箱属性不得加 `allow-scripts`（测试断言）；② 保留 `onlyRenderVisibleElements`；③ `extractSnapshotInPage` 必须保持自包含（不引用模块作用域标识符）；④ 不动 desktop `WorkspacePane` 与 `Viewer` 三栏导出；⑤ i18n 键增删需中英双语同步。
- 受影响文件清单（预计）：`od-contracts/src/prompts/{discovery,system}.ts`、`od-contracts/tests/system-prompt.test.ts`、`core/src/quality/{rendered-dom,craft-lint}.ts`、`core/src/design-save.ts`、core 对应测试、`web/src/pages/{DesignView,RequirementDetail}.tsx`(+tests)、`web/src/pages/ViewerPage.tsx`(删)、`web/src/routes.tsx`(+test)、`web/src/components/{Layout,PlatformTemplatePreview}.tsx`、`web/src/i18n.ts`。

## Trace

| This ID | Upstream | Status |
|---|---|---|
| DES-PROMPT-001 | SCOPE-IN-001 / AC-001 / RISK-PROMPT-001 / MIT-005 | designed |
| DES-LINT-001 | SCOPE-IN-001 / AC-001 / DEC-004(OQ-003) / RISK-PROMPT-001 | designed |
| DES-WEB-001 | SCOPE-IN-003 / AC-002 / DEC-001 / RISK-SEC-001 / RISK-PERF-001 / MIT-001 / MIT-002 | designed |
| DES-ROUTE-001 | DEC-002 / RISK-COMPAT-001 / MIT-003 | designed |
| DES-WEB-002 | SCOPE-IN-004 / SCOPE-IN-005 / AC-003 / AC-004 / AC-005 / DEC-003 / RISK-COMPAT-002 / MIT-004 | designed |
| DES-WEB-003 | SCOPE-IN-002 / RAW#1 | designed |
| DES-TEST-001 | SCOPE-IN-006 / AC-006 / MIT-001..004 | designed |

## Upstream Summary (read-only)
# Risk Discovery

## User Decisions (2026-06-06, checkpoint Q&A) [USER]

- DEC-001 画布页采用 Stitch 式**纯画布全幅**布局（不保留 forma-viewer 三栏的左设计列表/右标注 slot）。→ 解决 OQ-001
- DEC-002 **重写 `/design` 为画布**，移除 `/viewer` 独立路由，保留单一入口。→ 解决 OQ-002
- DEC-003 需求详情页右侧「在应用中打开」（`forma://` 深链）入口**一并移除**。→ 解决 OQ-004

## Risks

### RISK-SEC-001 HTML 直渲的脚本执行面
Status: mitigated
闭合依据（2026-06-06）：MIT-001 落实为 SPEC-BEHAVIOR-005 [ADDRESSED] 沙箱契约 + TEST-VIEWER-001（DesignTile.browser.test.tsx 断言无 allow-scripts）、PLAN-TASK-004/005。
后台画布从"PNG 截图"改为"HTML 实渲"后，设计稿 HTML 进入管理端 DOM 环境。若重写 `/design` 时未沿用沙箱约束（现 `DesignTile` 为 `sandbox="allow-same-origin allow-forms"`、**不含** `allow-scripts`），或绕过 iframe 直接 `dangerouslySetInnerHTML`，将打开脚本执行/管理端会话窃取面。设计稿在保存时虽经纯静态校验（无 `<script>`/`on*`/`javascript:`），但历史版本与异常产物不能假定全部干净。

### RISK-SEC-002 `allow-same-origin` 与 API 同源
Status: mitigated
闭合依据（2026-06-06）：design/SPEC 固化"allow-same-origin 与 allow-scripts 不得并存"（代码注释 + TEST-VIEWER-001 不并存断言，PLAN-TASK-004）。
iframe `src` 指向同源 `/api/.../bundle/*`，`allow-same-origin` + 无 `allow-scripts` 的组合当前安全（无脚本即无 DOM/网络访问），但若未来为动画等原因加回 `allow-scripts`，两者组合即等于无沙箱。需要在代码注释/测试中固化"二者不可同时开启"的约束。

### RISK-PERF-001 多页 iframe 画布性能
Status: mitigated
闭合依据（2026-06-06）：SPEC-BEHAVIOR-005 [ADDRESSED] 虚拟化契约（onlyRenderVisibleElements 保持开启，Canvas 内建），PLAN-TASK-005。
一个需求可能有多页 × 多版本设计稿，每个 tile 是一个完整 iframe 文档。现有 `Canvas.tsx` 已用 React Flow `onlyRenderVisibleElements` 做视口虚拟化；重写为"纯画布全幅"时必须保留该虚拟化与按需卸载，否则大需求会卡顿/吃内存。

### RISK-COMPAT-001 路由删除的引用面
Status: mitigated
闭合依据（2026-06-06）：MIT-003/MIT-004 落实为 SPEC-BEHAVIOR-006 [ADDRESSED]（及 007/010）与 PLAN-TASK-005/007/009（路由删除同步测试、i18n 键护栏）。
移除 `/viewer`、`/pages/:pageId/viewer` 路由：grep 确认仅 `routes.tsx` 注册与测试引用，应用内无导航链接指向；桌面端走自己的 `WorkspacePane`（不经 web 路由）。残余风险：用户书签/外部记录的旧 URL 会落到 NotFound。
### RISK-COMPAT-002 RequirementDetail 精简的下游依赖
Status: mitigated
闭合依据（2026-06-06）：MIT-003/MIT-004 落实为 SPEC-BEHAVIOR-006 [ADDRESSED]（及 007/010）与 PLAN-TASK-005/007/009（路由删除同步测试、i18n 键护栏）。
移除逐页列表/截图预览/导航面板与 `forma://` 深链（DEC-003）后，需同步更新 `RequirementDetail.test.tsx`、i18n 键与可能引用 `action.openInApp`、`requirement.pages` 等文案键的地方；`listProductArtifacts` 注入式 client 接口形状变化会影响测试桩。

### RISK-PROMPT-001 提示词约束的非确定性
Status: mitigated
闭合依据（2026-06-06）：DEC-004 双重防线——提示词逐字语句（SPEC-BEHAVIOR-001 [ADDRESSED]）+ screen-edge-radius 确定性检查（SPEC-BEHAVIOR-002 [ADDRESSED] ..004），PLAN-TASK-001..003。
"最外层禁止圆角"走提示词路径与手机壳禁令同落点（`od-contracts/prompts`），但 LLM 输出非确定：仅靠提示词可能漂移。若不加确定性防线（artifact 静态校验或 craft lint 检出最外层 `border-radius`），AC-001 只能验证"规则存在"而非"产物合规"。

### RISK-SCOPE-001 od-contracts 子系统状态
Status: mitigated
闭合依据（2026-06-06）：MIT-006 范围限定（od-contracts 仅动 prompts 字符串与测试，PLAN-TASK-003），残余风险接受。
`od-*` 包按仓库 CLAUDE.md 标注为 WIP、未进入 npm 发布集，但默认 `pnpm build/typecheck/test` 覆盖；提示词与测试改动风险低。需求#1 的既往修复（bdccbe5）即落在此处，证实其为用户实际生成路径。

## Boundaries

- 仅触达：`packages/web`（pages/routes/components/i18n + 测试）、`packages/viewer`（如纯画布需要新的无侧栏组合导出）、`packages/od-contracts`（prompts + prompt 测试）。
- 不触达：`packages/core` 持久化/校验管线（除非 design 阶段确认加确定性圆角校验）、`packages/server` API、`packages/desktop`、`packages/mcp`、标注画布（`AnnotationPage`/VZI）、归档 handoff。
- 截图/预览生成管线保留（其他入口仍消费，如 ProductDetail 卡片）；只改两个页面的展示层。

## Scope Overflow Risks

- OVERFLOW-001 借机重构 `forma-viewer` 包整体 API/三栏布局 → 只为纯画布提供最小组合（如直接复用 `Canvas` + 模型构建），不动 desktop 在用的 `Viewer` 三栏导出。
- OVERFLOW-002 顺手改造 ProductDetail、StyleLibrary 等其他管理页 → 明确不在范围（Non-Goals）。
- OVERFLOW-003 给画布加编辑/标注/AI 对话能力 → 只读浏览，超出即砍。
- OVERFLOW-004 回溯重写历史设计稿去圆角 → Out-of-Scope（SCOPE-OUT-001）。

## Mitigations

- MIT-001（→RISK-SEC-001/002）重写后的画布 tile 必须继续走 `DesignTile` 沙箱 iframe 路径；新增测试断言 `sandbox` 属性不含 `allow-scripts`，且代码注释固化"`allow-same-origin` 与 `allow-scripts` 不得并存"。
- MIT-002（→RISK-PERF-001）保留 `onlyRenderVisibleElements` 视口虚拟化；画布数据按需求过滤（沿用 `requirement_id` 过滤 + 排除 `design-system`/`component-library`）。
- MIT-003（→RISK-COMPAT-001）删除路由的同时更新 `routes.test.ts` 与所有引用；NotFound 页已有回 Products 的出口，旧链接失效可接受。
- MIT-004（→RISK-COMPAT-002）同一提交内更新 `RequirementDetail.test.tsx`/`DesignView.test.tsx`/i18n 键；移除不再使用的文案键避免死键。
- MIT-005（→RISK-PROMPT-001）提示词条目写成可被 `system-prompt.test.ts` 精确断言的固定语句；确定性校验已由 DEC-004 确认并落入 design/SPEC（screen-edge-radius）。
- MIT-006（→RISK-SCOPE-001）od-contracts 改动限定在 prompts 字符串与对应测试，不动包结构。

## Trace

| This ID | Upstream | Status |
|---|---|---|
| DEC-001 | OQ-001 | resolved |
| DEC-002 | OQ-002 | resolved |
| DEC-003 | OQ-004 | resolved |
| RISK-SEC-001 / RISK-SEC-002 | SCOPE-IN-003 / AC-002 | [ADDRESSED] |
| RISK-PERF-001 | SCOPE-IN-003 / AC-002 | [ADDRESSED] |
| RISK-COMPAT-001 | DEC-002 / SCOPE-IN-003 | [ADDRESSED] |
| RISK-COMPAT-002 | SCOPE-IN-004 / AC-003 / AC-004 | [ADDRESSED] |
| RISK-PROMPT-001 | SCOPE-IN-001 / AC-001 / OQ-003 | [ADDRESSED] |
| RISK-SCOPE-001 | SCOPE-IN-001 | [ADDRESSED] |
| OVERFLOW-001..004 | Non-Goals / Out-of-Scope | [ADDRESSED] |
| MIT-001..006 | 对应 RISK-* | [ADDRESSED] |

## Upstream Summary (read-only)
# Requirement Brief

## Goal

对 Forma 做三项联动的功能修改与优化：

1. **移动端设计稿外缘直角化**：移动端（mobile）生成的 UI 设计稿，其最外层屏幕边缘不得再呈现圆角。此前已移除手机壳（device shell）样式（commit `bdccbe5`，仅禁止 phone frame / bezel / notch / status bar / gesture bar），但生成规则未禁止最外层容器的圆角，生成结果仍常带"屏幕圆角"残留。
2. **后台管理设计稿页改为无限画布直渲 HTML**：后台管理（web 管理端）的需求设计稿页面不再展示 PNG 截图（当前 `DesignView.tsx` 为截图网格 + lightbox），改为类 Google Stitch 的无限画布，直接渲染各页面的 HTML 设计稿（可平移/缩放，HTML 以沙箱 iframe 实时呈现）。
3. **后台管理需求详情页精简**：需求详情页（`RequirementDetail.tsx`）仅保留"需求文档"内容区；文档卡片右上角提供两个图标按钮——"复制"（复制需求文档内容）与"打开设计稿"（进入第 2 点的 HTML 设计稿无限画布页面）。不再展示逐页列表、逐页"打开设计"入口、右侧设计稿截图预览与导航关系面板。

## In-Scope

- SCOPE-IN-001 生成规则更新：在移动端生成提示规则中明确禁止设计稿最外层边缘圆角（screen content 最外层容器/body 不得有 border-radius），落点为现有 device-shell 禁令所在的提示文件（`packages/od-contracts/src/prompts/discovery.ts` 的 mobile/iOS/Android 规则、`system.ts` 相关契约条目），并同步更新相应测试（`packages/od-contracts/tests/system-prompt.test.ts`）。
- SCOPE-IN-002 管理端模板预览同步：`packages/web/src/components/PlatformTemplatePreview.tsx` 中 mobile 模板结构/预览如仍隐含外缘圆角表达，一并修正，与生成规则保持一致。
- SCOPE-IN-003 设计稿页改造：将 `/products/:productId/requirements/:reqId/design` 的展示从 PNG 截图网格改为无限画布直渲 HTML 设计稿；复用仓库既有能力（`@xenonbyte/forma-viewer` 的 React Flow 无限画布 + `DesignTile` 沙箱 iframe，已在 `/viewer` 路由可用）作为首选实现基础，具体复用/合并方式由 design 阶段决定。
- SCOPE-IN-004 需求详情页精简：`RequirementDetail.tsx` 改为仅渲染需求文档主体；右上角新增"复制文档"与"打开设计稿"两个图标按钮；移除逐页列表、右侧截图预览面板与导航面板。
- SCOPE-IN-005 入口收敛：从需求详情"打开设计稿"直达统一的画布页面（不再按 page 逐个进入）；处理 `ui_affected=false` 与"暂无设计稿"两类状态的合理呈现。
- SCOPE-IN-006 相关测试与文案：更新受影响的 web 测试（`DesignView.test.tsx`、`RequirementDetail.test.tsx`、路由测试等）与 i18n 文案键。

## Out-of-Scope

- SCOPE-OUT-001 对已生成的历史设计稿 HTML 做回溯改写/迁移（仅约束新生成产物；历史稿是否重生成由用户自行操作）。
- SCOPE-OUT-002 桌面端（Electron desktop）与 MCP 工具面的功能变更（除非 design 阶段证明共享组件必须同步调整）。
- SCOPE-OUT-003 标注画布（`AnnotationPage`，VZI/CanvasKit 渲染）与归档交接（design handoff）流程的改动。
- SCOPE-OUT-004 截图/预览生成管线本身的移除（`preview-renderer` 等仍可能被其他入口使用，如产品详情卡片）；仅改变设计稿页与需求详情页的展示方式。
- SCOPE-OUT-005 新增后端 API（现有 bundle 路由 `/api/products/:pid/artifacts/:aid/versions/:v/bundle/*` 已可直渲 HTML；若 design 阶段发现确需新端点，走 gap 路由）。

## Non-Goals

- 不引入可编辑画布（拖拽改版式、改设计稿内容）；画布为只读浏览（平移/缩放/定位）。
- 不重做后台管理整体信息架构，仅调整上述两个页面。
- 不更换前端技术栈（继续 React + 自研 hash 路由 + Tailwind 风格类 + 既有 viewer 包）。

## Assumptions

- ASSUME-001 "像 Stitch 那样"指：深色/中性底的无限画布上并排陈列各页面 HTML 实渲帧，支持滚轮缩放与拖拽平移，点击可聚焦定位；不要求 Stitch 的 AI 对话侧栏。[USER 措辞推断，细节 UNCONFIRMED，由 design 阶段定]
- ASSUME-002 "复制"图标复制的是需求文档原文（`document_md` 的 markdown 文本）到剪贴板。[ASSUMPTION]
- ASSUME-003 第 1 点的修复以"生成规则/提示词约束"为主路径（与既往手机壳移除同一落点）；是否追加确定性校验（craft lint / artifact 静态校验项）由 design 阶段评估。[ASSUMPTION]
- ASSUME-004 既有 `/viewer` 路由（`ViewerPage` + `forma-viewer`）是"HTML 设计稿无限画布"的现成基础；第 2/3 点的"打开设计稿"最终指向该画布形态的页面（路由归并或 DesignView 重写，二选一，design 阶段定）。[CODE]

## Acceptance Criteria

- AC-001 移动端生成提示规则中存在明确、可测试的"最外层边缘禁止圆角"约束；`od-contracts` 相关 prompt 测试覆盖该条目并通过。
- AC-002 后台管理需求设计稿页面不再以 PNG 截图为主体呈现；打开后是无限画布，画布内每个页面以 HTML 实渲（沙箱 iframe，无脚本执行）呈现，支持平移与缩放。
- AC-003 需求详情页仅展示需求文档主体；右上角有"复制"与"打开设计稿"两个图标按钮：复制按钮将文档内容写入剪贴板并有成功反馈；"打开设计稿"跳转到 AC-002 的画布页面（不经过逐页列表）。
- AC-004 需求详情页不再渲染逐页列表、右侧截图预览面板与导航面板。
- AC-005 `ui_affected=false` 或尚无设计稿的需求：详情页"打开设计稿"入口与画布页有合理的禁用/空态表现（不报错、不出现死链）。
- AC-006 `pnpm test` 与 `pnpm typecheck` 通过；受影响的 web/viewer/od-contracts 测试已更新。

## Open Questions

- OQ-001 第 2 点画布页是否保留 `forma-viewer` 现有三栏布局（左设计列表/右标注 slot），还是 Stitch 式纯画布全幅展示？（用户"不需要再展示每个页面了"仅明确针对需求详情页的逐页列表）
- OQ-002 现有 `/design` 与 `/viewer` 两条路由如何归并：`/design` 重写为画布，还是 `/design` 跳转 `/viewer`、保留单一实现？
- OQ-003 第 1 点是否需要确定性防线（如 artifact 静态校验/craft lint 检出最外层 border-radius）以防提示词漂移？
- OQ-004 需求详情页右侧"在应用中打开"（`forma://` 深链）入口是否随面板一并移除？

## Sources

- 用户原始需求（00-raw-requirement.md，2026-06-06）。
- 代码勘察（2026-06-06）[CODE]：
  - `packages/web/src/pages/DesignView.tsx`（截图网格 + lightbox，`/preview/1x|2x`）
  - `packages/web/src/pages/RequirementDetail.tsx`（文档 + 逐页列表 + 截图预览 + 导航面板）
  - `packages/web/src/pages/ViewerPage.tsx`、`packages/viewer/src/{Viewer,Canvas,tiles/DesignTile}.tsx`（React Flow 无限画布，沙箱 iframe 直渲 HTML bundle）
  - `packages/web/src/routes.tsx`（`/design`、`/viewer`、`/annotation` 路由并存）
  - `packages/od-contracts/src/prompts/{discovery,system}.ts`（mobile "screen content only / no device shell" 规则，无外缘圆角禁令）
  - `git show bdccbe5`（手机壳移除提交：prompts + PlatformTemplatePreview）
  - `packages/server/src/routes.ts`（bundle/preview/vzi 等 artifact 路由）

## Trace

| This ID | Upstream | Status |
|---|---|---|
| SCOPE-IN-001 | RAW#1（移动端边缘不能圆角） | covered |
| SCOPE-IN-002 | RAW#1 | covered |
| SCOPE-IN-003 | RAW#2（无限画布显示 HTML 设计稿） | covered |
| SCOPE-IN-004 | RAW#3（需求详情仅文档 + 两图标） | covered |
| SCOPE-IN-005 | RAW#3（不需要再展示每个页面） | covered |
| SCOPE-IN-006 | RAW#1/2/3（验证配套） | covered |
| AC-001 | RAW#1 | covered |
| AC-002 | RAW#2 | covered |
| AC-003 / AC-004 / AC-005 | RAW#3 | covered |

## Upstream Summary (read-only)
深度阅读项目代码，对Forma功能修改与优化
1、移动端生成的UI设计稿的边缘不能是圆角，之前我们去掉了手机壳样式，但是现在还保留设计稿边缘圆角
2、后台管理里需求设计稿不再显示截图，使用无限画布显示HTML设计稿，像Stitch那样
3、后台管理需求详情调整，仅显示 需求文档；需求文档的右上角展示两个图标：复制 和 打开设计稿（进入第2点的描述的HTML设计稿页面，不需要再展示每个页面了）
<!-- /r2p-read-only -->

## Project Context (read-only)
# Project Context Pack

- repo_root: `/Users/xubo/x-studio/forma`
- languages: {'TypeScript': 94255, 'JavaScript': 22016}
- package_managers: npm
- test_commands: ['vitest run']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies: 3 found
- source_dirs: ['bin', 'craft', 'design-version', 'docs', 'output', 'packages', 'scripts', 'spikes', 'styles']
<!-- /r2p-read-only -->
<!-- /r2p-read-only -->

## Project Context (read-only)
# Project Context Pack

- repo_root: `/Users/xubo/x-studio/forma`
- languages: {'TypeScript': 94255, 'JavaScript': 22016}
- package_managers: npm
- test_commands: ['vitest run']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies: 3 found
- source_dirs: ['bin', 'craft', 'design-version', 'docs', 'output', 'packages', 'scripts', 'spikes', 'styles']
<!-- /r2p-read-only -->
