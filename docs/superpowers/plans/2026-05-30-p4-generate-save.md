# P4 generate→save 语义反转 + 资源本地化 + 读取面 A–G Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。本文件是**待你评审**的拆解版 plan：每个 task 给文件/契约/关键代码/验收/依赖。**核心新模块给具体代码，mcp/server 大改给规格（执行期对照当前真实文件展开到 test/impl）。未经确认不要执行。**

**Goal:** 把生成类能力从「调 odRuntime 生成」反转为「**接收 AI 已生成的 HTML 稿 → 资源本地化 → 纯静态校验 → 落 versioned bundle + manifest.forma + assets 清单 → 渲染预览冻结 → 更新指针**」；新增生成前的 `get_design_context` 知识下发；优化 MCP 读取面 A–G；移除 `od-runtime.ts`；新增 server bundle 静态路由（供 iframe src）；**并修复 P1+P2 遗留的跨包红**（server/mcp 对 `getStyle`/`product.style` 的适配）。

**Architecture:** 「AI 在外、forma 在内」。core 提供 `saveDesignArtifact`（落盘+预览+指针的单一管线）+ `localizeArtifactAssets`（data: 抽取/sharp 降采样/本地 srcset/远程拒绝）+ `validateStaticArtifact`（无 JS + 资源本地）+ `buildDesignContext`（craft+style+页面规格+规则）。mcp 工具退化为这些 core 能力的**薄封装**；server 增 bundle 静态服务。

**Tech Stack:** TypeScript ESM, Node ≥22, Vitest, `sharp`（降采样，已锁），**`node-html-parser`（拟新增，见下方依赖决策）**，`puppeteer`（P3 已加），`adm-zip`（已有，export zip），zod。

---

## ✅ 已锁定的决策（2026-05-30 用户确认）

1. **新增依赖 `sharp`（已在主规划锁定）✅ 确认沿用**：原生 libvips，主流平台预编译。用于栅格图降采样产 1x/2x/3x。
2. **新增依赖 `node-html-parser` ✅ 已批准**：轻量（MIT、无原生）HTML 解析，用于 (a) 资源本地化时定位/改写 `<img|source|link|image|style|svg>` 的资源引用，(b) 静态校验时检测 `<script>`/`on*`/外链。CSS 内 `url()`/`@import`/`@font-face` 用受控正则在 CSS 文本上扫（解析器不解析 CSS），范围明确。
3. **AI 资源交付形态 ✅**：AI 会话把图以 **data: URL 内联在 HTML/CSS** 里交来（主规划「服务端零 fetch」）。`localizeArtifactAssets` 把 data: 抽成本地文件 + sharp 降采样；HTML 含远程 http(s) 引用 → **报错拒绝**。
4. **master 多倍图来源 ✅**：data: 内联即 master 位图，sharp **只降采样不升采样**；不足三档登记实际 density + `degraded`；SVG 单份。
5. **server bundle 路由 URL ✅ 确认**：`GET /api/products/:pid/artifacts/:aid/versions/:v/bundle/*`（静态服务该版本 bundle 目录，含 index.html + assets/）。viewer 的 `<iframe src>` 指这里；`get_product_artifact` 把各 asset 的 served URL **读时算**出来。
6. **`get_product_artifact` 响应形状 ✅ 确认**（A/B，见 P4.8）：返回 `{ manifest, bundle_url, assets:[{path,role,density,urls}], preview_url, versions }`。

> 四处拍板点（sharp 沿用 / node-html-parser 批准 / bundle URL / 响应形状）已锁定。其余按本 plan 执行。

---

## 关联 / 前置
- 前置：P1（manifest.forma/版本存储/指针）+ P2（styles/craft）+ P3（preview-renderer）均已合并 main。
- 本阶段**修复**跨包红：`packages/server/src/routes.ts` 的 `FormaRoutesStore.getStyle` 期望旧 `{metadata:{design_md_path}}`，与 P2 新 `BrandStyleContent` 不符（`app.ts:33` 报错）。P4.10 修。

---

## File Structure
**core（packages/core/src）：**
- `artifact-asset-pipeline.ts`（新）— `localizeArtifactAssets`（data: 抽取 + sharp 降采样 + 本地 srcset 改写 + 远程拒绝）。
- `artifact-static-validation.ts`（新）— `validateStaticArtifact`（无 JS + 资源本地 + SVG sanitize-reject）。
- `design-save.ts`（新）— `saveDesignArtifact`（localize→validate→writeArtifactVersion→render preview→freeze→pointer）。
- `design-context.ts`（新）— `buildDesignContext`（craft + style + 页面规格 + 规则）。
- `store.ts`（改）— `generateRequirementDesign`/`generateComponents`/`changeArtifactStyle` 改为委派 `saveDesignArtifact`（语义反转）；移除 `od-runtime.ts` import。
- 删除 `od-runtime.ts`。
- `index.ts`（改）— 导出新模块。
- deps：`sharp` + `node-html-parser`。

**mcp（packages/mcp/src/tools.ts）：**
- generate_*/change_artifact_style 语义反转 + style 入参拆 brand_style/system_style；新增 `get_design_context`；rollback 改 page/variant 指针；读取面 A–G（get_product_artifact/list_product_artifacts 重构、移除 6 个 session_*、kind 枚举、export_artifact、help、清理 design-system 残留描述）；删 `styleVariablesSchema`/旧 `styleMetadataSchema`（与 core 对齐）。

**server（packages/server/src）：**
- `routes.ts`（改）— `FormaRoutesStore.getStyle` 类型改 `BrandStyleContent`；config 路由用 brand_style/system_style；artifact list/get 适配新模型；**新增 bundle 静态路由**。
- `app.ts`（改）— `FormaServerStore` 随之对齐。

**templates：** `packages/agent/templates/shared/SKILL.md`（改）— 删 `OD_RUNTIME_FAILED` 说明（fm-* 模板重写归 P6，本阶段仅清运行时错误说明）。

---

## 依赖图（task 顺序）
`P4.1(资源管线) , P4.2(静态校验)` 可并行 → `P4.3(save 管线，依赖 1/2/P3) ` → `P4.4(design-context)` 独立可并行 → `P4.5(mcp generate→save，依赖 3) ` → `P4.6(mcp get_design_context，依赖 4) ` → `P4.7(rollback)` → `P4.8(读取面 A/B)` → `P4.9(读取面 C–G)` → `P4.10(server，依赖新 getStyle/save 模型)` → `P4.11(SKILL.md)`。core(1–4) 先行、mcp(5–9) 居中、server(10) 收尾、templates(11) 最后。

---

## Task P4.1: 资源本地化管线（data: 抽取 + sharp 降采样 + 远程拒绝）

**Files:** Create `packages/core/src/artifact-asset-pipeline.ts` + `tests/artifact-asset-pipeline.test.ts`；deps `sharp` + `node-html-parser`。

**契约：**
```ts
export interface LocalizeInput {
  html: string;                 // AI 交来的 HTML（资源以 data: 内联）
  assetDirName?: string;        // 默认 'assets'
}
export interface LocalizeResult {
  html: string;                 // 改写后：data: → 本地 srcset/相对路径
  files: Map<string, Buffer>;   // 待写入 bundle 的本地资源（相对路径 → 内容），⊆ supportingFiles
  assets: ArtifactAssetEntry[]; // manifest.forma.assets（path/density/role/degraded，无 URL）
}
export async function localizeArtifactAssets(input: LocalizeInput): Promise<LocalizeResult>;
```
**行为（验收即测）：**
- 用 `node-html-parser` 解析；遍历资源入口：`<img src|srcset>`、`<source src|srcset>`、`<link href>`（icon/preload 等）、`<image href>`(SVG)、`poster`、内联 `<style>` 与 `style=` 的 `url()`。
- 每个 **`data:` 栅格图**（png/jp/webp）→ 解码为 master Buffer → `sharp` 产 **实际可得** 1x/2x/3x（**不上采样**：以 master 像素宽度为最高档，向下产更低档；登记实际 density 集；不足标 `degraded`）→ 写 `assets/<hash>@{n}x.<ext>` → 把该引用改写为本地 `srcset="assets/<hash>@1x.. 1x, ..@2x.. 2x, ..@3x.. 3x"`（仅含实际档位）。
- 每个 **`data:` SVG/字体** → 单份写 `assets/<hash>.<ext>`，引用改本地相对路径，density `[1]`。
- 任一 **远程 `http(s):` 引用**（任意入口，含 CSS url()/@import/@font-face）→ **抛 `FormaError('ARTIFACT_REMOTE_RESOURCE')`**（零 fetch、fail-loud）。
- CSS 文本里的 `url(data:)`/`@font-face` data: 同样抽取本地化；CSS 里残留 `url(http...)`/`@import url(http...)` → 拒绝。
- 返回的 `assets[].path` 全部出现在 `files` 键里（与 A4 `validateAssetsAgainstSupportingFiles` 兼容）。
**关键实现点：** 命名用内容 hash（sha256 前 16）避免碰撞；ext 由 data: MIME 推断；sharp `resize` 仅在目标宽 < master 宽时执行。
**验收：** data: 栅格图 → 产多档本地 + 本地 srcset、master 不足档位标 degraded、绝不上采样；SVG 单份；远程引用（HTML/CSS 任一入口）抛 `ARTIFACT_REMOTE_RESOURCE`；assets ⊆ files。
**deps：** P1 的 `ArtifactAssetEntry`。新增 `errors.ts` code `ARTIFACT_REMOTE_RESOURCE`。

---

## Task P4.2: 纯静态校验（无 JS + 资源本地 + SVG sanitize-reject）

**Files:** Create `packages/core/src/artifact-static-validation.ts` + tests。

**契约：**
```ts
export interface StaticValidationInput { html: string; svgFiles?: Map<string, string>; cssFiles?: Map<string, string>; }
export type StaticValidationResult = { ok: true } | { ok: false; violations: string[] };
export function validateStaticArtifact(input: StaticValidationInput): StaticValidationResult;
```
**规则（验收即测，全部 fail-loud 收集 violations）：**
- 拒绝 `<script>`（任意位置，含 SVG 内）、内联事件属性 `on*=`、`javascript:` URL、外链 `<script src>`、外链 `<link rel=stylesheet href=http...>`、`<iframe>`/`<object>`/`<embed>`。
- 扫描 CSS（`<style>`、`style=`、cssFiles）的 `url(http...)`/`@import`(remote)/`@font-face src:url(http...)` → 远程引用违规。
- `srcset`/`<source>`/`poster`/`<link href>` 出现远程 → 违规。
- **任一入口残留 `data:`** → 违规（必须已被 P4.1 本地化；二者串用时此规则保证「未本地化即拒」）。
- SVG（svgFiles）含 `<script>`/事件属性/外链 `href`(http) → 违规（默认拒绝，不 sanitize）。
**验收：** 上述每条都有红/绿用例；干净的纯静态 HTML 通过；带 `<script>`/`on*`/`javascript:`/远程/残留 data:/SVG 脚本 各自报对应 violation。
**注：** 与 P4.1 顺序——save 管线先 localize（抽 data:）后 validate（此时不应再有 data:/远程）。

---

## Task P4.3: save 管线 + 移除 odRuntime

**Files:** Create `packages/core/src/design-save.ts` + tests；Modify `store.ts`；Delete `od-runtime.ts`；Modify `index.ts`。

**契约：**
```ts
export interface SaveDesignInput {
  productId: string;
  kind: 'design-page' | 'component-library';
  html: string;
  title: string;
  forma: {                       // design-page 必带 requirementId/pageId/variant
    requirementId?: string; pageId?: string; variant?: string;
    brandStyle?: string; systemStyle?: string; platform?: string; language?: string;
    provenance?: ArtifactProvenance;
  };
  artifactId?: string;           // 同 artifact 新 version 时传入；不传则新建 artifact
}
export interface SaveDesignResult { artifactId: string; version: number; previewStatus: 'ready' | 'failed'; }
export async function saveDesignArtifact(store, input: SaveDesignInput): Promise<SaveDesignResult>;
```
**流程（在 product mutation lock 内）：**
1. `localizeArtifactAssets(html)` → 改写 html + files + assets。
2. `validateStaticArtifact({ html, svgFiles, cssFiles })` → 不过即抛 `FormaError('ARTIFACT_NOT_STATIC', {violations})`。
3. 解析 entry：写 `index.html`(改写后) + assets files；构造 `ArtifactManifest`（kind、entry `index.html`、supportingFiles=所有文件、`forma`：variant 默认 default(design-page)、assets 清单、provenance、brandStyle/systemStyle、platform/language）。
4. 版本号：`artifactId` 已存在 → `max(listArtifactVersions)+1`，否则新 `artifactId` + v1。`writeArtifactVersion(...)`。
5. 预览：从 bundle 版本目录 base 调 P3 `renderArtifactPreview({ bundleDir: versionDir, outDir: versionDir/preview })`；成功 → `manifest.forma.preview={status:'ready',generatedAt}`，失败 → `{status:'failed',error,generatedAt}`。**冻结时一次性写定**（renderer 在 writeArtifactVersion 之后跑，需把 preview 状态写回该版本 manifest——实现：先写 bundle（不含 preview 字段），渲染后**原子改写该版本 manifest.json** 追加 preview 字段；或先渲染暂存再一次性写。选后者更干净：渲染到临时目录→拿到 status→带 preview 字段一次性 `writeArtifactVersion`）。**采用：先 localize/validate → 临时 bundle 落临时目录 → 渲染 preview → 带 preview 状态 + preview png 一次性 `writeArtifactVersion`。**（无 pending。）
6. design-page → `setDesignPointerLocked((req,page,variant)→{artifactId,version,designStatus:'active'})`。
7. 返回。
**store.ts 改：** `generateRequirementDesign`/`generateComponents`/`changeArtifactStyle` 不再 `createOdRuntime().generate()`；改为接收 HTML 参数并调 `saveDesignArtifact`。**签名变更**（加 `html`/forma 字段；去 odRuntime）。`createOdRuntime` import 删除；`od-runtime.ts` 文件删除；`OD_RUNTIME_FAILED` 仓库内不再产生（保留 error code 定义可，但无产生路径）。
**验收：** 给定干净 HTML（内联 data: 图）→ 产 versioned bundle（index.html+assets+preview/{1,2}x.png）、manifest.forma 完整（assets/preview=ready/variant）、design-page 建指针；含 `<script>` → 抛 `ARTIFACT_NOT_STATIC`；含远程图 → 抛 `ARTIFACT_REMOTE_RESOURCE`；同 artifactId 再 save → v2 + 指针指 v2；预览渲染失败（构造坏 bundle）→ previewStatus='failed' 且 manifest 记 failed（不抛、产物仍在）；`od-runtime.ts` 已删、仓库无 `mainOdRuntime`。
**deps：** P4.1/P4.2/P3 + P1 store/pointer。

---

## Task P4.4: get_design_context（生成前知识下发）

**Files:** Create `packages/core/src/design-context.ts` + tests；core 已有 craft(B1)/styles(B4)/requirement/rules 读取。

**契约：**
```ts
export interface DesignContextInput { productId: string; requirementId: string; pageId?: string; brandStyle?: string; systemStyle?: string; craftSlugs?: string[]; }
export interface DesignContextResult {
  craft: CraftDoc[];                 // 默认全量 craft；craftSlugs 给则取子集
  brandStyle?: BrandStyleContent;    // 三文件
  systemStyle?: SystemStyleMetadata; // 目录元数据
  page?: RequirementPage;            // 该页规格
  rules: StoredRule[];               // 适用规则（该 page + 全局）
  platform?: string; language?: string;
}
export async function buildDesignContext(store, input): Promise<DesignContextResult>;
```
**行为：** 组合 `styles.listCraftDocs/readCraftDoc`、`styles.getStyle(brandStyle)`、`styles.listSystemStyles().find(systemStyle)`、`requirements.getRequirement` 取 page、`requirements.getProductRules` 过滤适用、product 的 platform/language。
**验收：** 返回 craft（全量或子集）+ brand 三文件 + system 元数据 + 指定 page 规格 + 适用规则；未知 style/page 报错或空安全（按现有 getStyle/规格语义）。
**deps：** P2（craft+styles 新格式）。

---

## Task P4.5: MCP generate→save 语义反转 + style 入参拆分

**Files:** Modify `packages/mcp/src/tools.ts`（schemas + impls + descriptions）。

**改动（执行期对照当前文件展开 test/impl）：**
- `generateRequirementDesignSchema`/`generateComponentsSchema`/`changeArtifactStyle` schema：**加 `html: z.string().min(1)`**（AI 生成稿）+ `title`；**style 入参拆 `brand_style`(必)+`system_style`(可选)**（替换旧单 `style`/`design_system_id`）；design-page 用 requirement_id+page_id+variant，component-library 不带这三者。
- impl：不再调 `store.generateRequirementDesign(odRuntime...)`；改调 `store.generateRequirementDesign(productId, requirementId, { html, page_id, variant, brand_style, system_style, ... })`（store 内委派 `saveDesignArtifact`）。`change_artifact_style`：读源 artifact 当前 manifest → 以新 brand/system_style + 新 html 产**同 artifact 新 version**。
- 删 mcp 内 `styleVariablesSchema`/旧 `styleMetadataSchema`（与 core 对齐；`get_style` 返回新形见 P4.9）。
- descriptions：generate_* 去掉 `OD_RUNTIME_FAILED`、改 save 语义（见 P4.9 描述统一）。
**验收：** 三个工具以「保存 AI 稿」工作；入参 `html`+`brand_style`+`system_style`；保存后 artifact 为纯静态本地化 bundle、kind 正确、有预览；无 `OD_RUNTIME_FAILED` 返回路径。
**deps：** P4.3。

---

## Task P4.6: MCP 新增 `get_design_context` 工具

**Files:** Modify `tools.ts`（`formaToolNames` 加、schema、descriptions、handler）。
**Schema：** `{ product_id, requirement_id, page_id?, brand_style?, system_style?, craft_slugs? }`。Handler → `buildDesignContext`。描述：「生成**前**调用，取 craft 规则 + 选定 brand/system 风格 + 该页规格 + 适用规则；与 save 工具分离」。
**验收：** 工具返回 P4.4 的 context；在 generate 前可独立调用。
**deps：** P4.4。

---

## Task P4.7: rollback 改 page/variant 版本指针

**Files:** Modify `tools.ts`（`rollbackRequirementDesignSchema` + impl）。
**改动：** schema 由 `{product_id, requirement_id, target_artifact_id}` 改为 `{product_id, requirement_id, page_id, variant?(默认 default), target_version}`；impl 调 `store.products.rollbackDesignPointerLocked`（P1 已实现，回退指针不删旧版本），需在锁内（经 `store.runProductMutation`）+ 校验 target_version 在 `listArtifactVersions` 内（P1 留的「不校验在盘」在此补校验）。
**验收：** 回退某 page/variant 指针到指定旧 version；目标 version 不存在 → 报错；旧 version 仍在盘。
**deps：** P1 指针 + A3 listArtifactVersions。

---

## Task P4.8: 读取面 A/B —— get_product_artifact + list_product_artifacts 重构

**Files:** Modify `tools.ts`（两个工具 + helpers）+ 可能新增 core 读取助手（served URL 由 mcp/server 算）。
**get_product_artifact 响应（A）：**
```jsonc
{
  "manifest": { /* manifest.forma normalized: kind=normalizeKind, variant 补 default */ },
  "bundle_url": "/api/products/{pid}/artifacts/{aid}/versions/{v}/bundle/index.html",
  "assets": [{ "path":"assets/x@1x.png", "role":"image", "density":[1,2,3],
               "urls": { "1x":".../bundle/assets/x@1x.png", "2x":"...","3x":"..." } }],
  "preview_url": ".../versions/{v}/preview/2x.png",
  "versions": [1,2,3], "current_version": 3
}
```
- URL **读时算**（manifest 只存相对 path）。默认取 current pointer 的 version（design-page）或最新 version。
**list_product_artifacts（B）：** 加 `page_id`/`variant` 分组维度；每条带版本历史（`versions`）；kind 枚举更新（见 P4.9）；分组：按 `(requirementId,pageId,variant)`。
**验收：** 开发者经 MCP 拿到 served bundle URL + 各 asset URL（读时算）+ density + 版本历史；能按 page/variant 查稿。
**deps：** P4.10 的 bundle 路由（URL 形态一致）；可与 P4.10 并行定 URL 常量。

---

## Task P4.9: 读取面 C–G —— 清理 + 枚举 + export + help

**Files:** Modify `tools.ts`。
- **C**：移除 6 个 `session_*`（`formaToolNames`/schemas/descriptions/handlers/`V6ServiceOverrides`/`sessionToolFallback` 全清）。
- **D**：`kind` 枚举（`listProductArtifactsSchema` 等）`design-system`→`component-library` + 加 `design-page`；清理 `get_baseline_page`/`get_baseline_image`/`get_style` 描述里「design-system 基线 artifact」措辞。
- **E**：`generate_*`/`change_artifact_style` 描述去 `OD_RUNTIME_FAILED`、改 save 语义。
- **F**：`export_artifact`：`html`/`svg` 仅导出**单 entry 文件**；`zip` = 完整自包含包（index.html+assets/+manifest）；`png` = preview/2x。对 assetful artifact 的 html 导出**明确告知 assets 不随单文件走**。
- **G**：`help`（+ 若有 `develop_frontend`）补 artifact + asset 取数指引（bundle_url/assets urls/版本/导出）。
**验收：** 工具列表无 `session_*`、无 Pencil 残留；kind 无 `design-system`、有 `design-page`/`component-library`；export html/svg 单文件、zip 完整；help 含取数指引。
**deps：** 无强依赖（可在 P4.8 后做）。

---

## Task P4.10: server —— bundle 静态路由 + getStyle 类型修复 + 模型适配（修跨包红）

**Files:** Modify `packages/server/src/routes.ts` + `app.ts`。
- **修红**：`FormaRoutesStore.getStyle` 类型由旧 `{metadata:{design_md_path};...}` 改为 core 的 `BrandStyleContent`；`/api/products/:id/config` 路由（line ~246-249）适配 `brand_style`/`system_style`（取 brand_style 名→`getStyle`，system_style 名→catalog）。`FormaServerStore`/`FormaRoutesStore` 随之对齐，消除 `app.ts:33` TS2322。
- **新增 bundle 路由**：`GET /api/products/:pid/artifacts/:aid/versions/:v/bundle/*` → 经 `getArtifactVersionDir` 定位、`path-boundary` 夹紧、按扩展名设 content-type、流式返回（index.html / assets/*）。供 viewer iframe src。
- **artifact list/get 路由**：适配版本化 + manifest.forma（与 P4.8 MCP 形状对齐：bundle_url/assets/versions）。
**验收：** `pnpm --filter @xenonbyte/forma-server typecheck` 干净（跨包红消除）；bundle 路由能取 index.html + assets（路径越界拒绝）；config 路由写 brand_style/system_style；现有 server 测试更新通过。
**deps：** P2（BrandStyleContent）、P4.3/P4.8（artifact 模型）。**完成后 `pnpm build`/全量 typecheck 应恢复绿（web 若仍引用旧形态，归 P8）。**

---

## Task P4.11: shared/SKILL.md 清理 OD_RUNTIME_FAILED

**Files:** Modify `packages/agent/templates/shared/SKILL.md`（+ install 拷贝产物测试若校验内容）。
- 删除 `OD_RUNTIME_FAILED` 相关说明；generate_* 描述改「保存 AI 生成稿」。（fm-* 模板完整重写归 P6。）
**验收：** SKILL.md 无 `OD_RUNTIME_FAILED`；copy-assets/install 测试通过。

---

## 整体 Definition of Done（P4）
- generate_*/change_artifact_style 以「保存 AI 稿」工作：localize（data:→本地、远程拒绝）→ static-validate（无 JS）→ versioned bundle + manifest.forma(assets/preview/variant) → 预览冻结 ready/failed → design-page 建指针。
- `get_design_context` 生成前可取 craft+style+页面规格+规则。
- rollback 改 page/variant 指针；读取面 A–G 全落（served bundle URL + assets urls 读时算、按 page/variant 查、版本历史、无 session_*、kind 更新、export html/svg 单文件+zip 完整、help 指引）。
- `od-runtime.ts` 删除、无 `OD_RUNTIME_FAILED` 产生路径；SKILL.md 清理。
- server bundle 路由可用；**跨包红消除**：`pnpm --filter forma-server typecheck` + `pnpm build` 绿（web 残留归 P8）。
- `sharp`/`node-html-parser` 依赖就位（air-gapped 说明）。`pnpm test`（core/mcp/server）全绿、typecheck 绿。

## 风险 / 开放项
- **新依赖**：`sharp`（原生，已锁）+ `node-html-parser`（待你批）。Context7 不可用 → 二者 API 按稳定知识用、以测试为准（UNCONFIRMED）。
- **预览冻结时机**：采用「临时 bundle→渲染→带 preview 一次性 writeArtifactVersion」避免二次改写 manifest（P4.3 已定）。
- **data: 抽取边界**：MIME→ext 推断、CSS url() 扫描范围、SVG 内 image href data: —— 用解析器 + 受控 CSS 正则，红/绿用例覆盖。
- **MCP/server 大改**：tools.ts 1010 行 + routes.ts，执行期每 task 对照当前文件展开 TDD；P4.8/P4.10 的 URL 形态须一致（共享常量）。
- **sharp 三档策略**：只降采样、登记实际 density、不足标 degraded（与 P1 ArtifactAssetEntry 对齐）。
- **web 仍红**：P4 只修 server；web 对旧 `product.style`/getStyle 的适配归 P8。
