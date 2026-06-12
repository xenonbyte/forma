---
r2p_stage: risk_discovery
r2p_version: 2
r2p_status: approved
r2p_created_at: 2026-06-12T19:09:05.161338+00:00
r2p_updated_at: 2026-06-12T19:40:11.533685+00:00
---

# Risk Discovery

## Risks

### RISK-SEC-001 `media-config.yaml` 计费凭证泄露
Status: mitigated

缓解已转化为 M1 验收硬项（见正文）。

APIKEY 是计费凭证，可能经 server 静态服务、artifact/brand-assets zip 导出、诊断包、日志或 FormaError details 外泄。缓解：文件 0600 创建/收紧（win32 按平台跳过）；读接口只回脱敏元数据（env 来源连尾号都不回显）；导出/诊断排除测试为 M1 验收硬项；错误 details 不携带 key。

### RISK-SEC-002 `save_brand_asset` HTML 渲染沙箱逃逸
Status: mitigated

缓解已转化为 M3 验收硬项（见正文）。

agent 提交的排版 HTML 经 puppeteer 渲染，恶意/出错的 HTML 可能执行脚本、拉远程资源、读白名单外 `file://`。缓解：默认禁脚本；先 localize 再渲染（浏览器层不出现 `forma-image://`）；拦截白名单只放行重写后 bundle 内 `file://` + path-boundary 校验通过的产品预览；`http(s):`、协议相对 URL、越界路径一律 fail loud。测试覆盖脚本拦截/远程拒绝/file 越界拒绝/白名单预览可用四类。

### RISK-SEC-003 `forma-image://` 解析路径越界
Status: mitigated

缓解已转化为 M1 验收硬项（见正文）。

staging/brand 引用解析若拼接任意路径可读出仓外文件。缓解：解析全部经现有 `path-boundary.ts` 校验；id 不存在/越界抛 `MEDIA_IMAGE_NOT_FOUND`，整次保存失败。

### RISK-DEP-001 火山方舟 API 形态漂移
Status: deferred

延期闭环：M1 实现前复核官方文档（owner=M1 实现，PLAN 已排首步）。

模型 ID 下线、endpoint/请求/响应字段变更会使 renderer 失效；文档站 JS 渲染导致自动核验困难。缓解：附录 A 已锁来源 URL + 页面更新时间，M1 实现前必须人工复核官方页面；目录 + renderer 注册表把变化面隔离在单文件；`MEDIA_PROVIDER_ERROR` details 携带 status 与截断 body 便于诊断。

### RISK-DEP-002 生图计费失控
Status: mitigated

agent 重试、count 放大、CI 误调真实 provider 都会产生费用。缓解：`count` 上限 4；自动化测试一律 stub provider 不打外网；`POST /api/media/test` 用最小尺寸单张且仅用户主动触发；真实 key 调用只出现在手动验收。

### RISK-DEP-003 lucide-static 版本漂移
Status: mitigated

图标集随上游变化导致检索结果不稳定。缓解：`lucide-icons.json` 产物入库（构建不依赖在线源），升级 = 显式重跑 `scripts/vendor-lucide.mjs` + diff 审查；ISC 许可证随附。

### RISK-DATA-001 icon unit 移除破坏旧 artifact
Status: mitigated

`manifest.forma.productIcon` 本就 optional（`artifact-manifest.ts:225`），旧 artifact 含 icon unit 继续有效，零迁移；`validateArtifactManifest` 对 present 时的 SVG 约束保留。回归测试覆盖旧数据加载。

### RISK-DATA-002 生成图撑爆资产管线预算
Status: mitigated

2048 母版 + 多张插图可能触及 4MiB HTML / 48MiB 资产 / 200 文件预算。缓解：`forma-image:` 字节并入既有 data: 处理流，走同一降采样（@1x/@2x/@3x）与预算检查，超限 fail loud（含测试）；agent 视检选优后只引用选中图。

### RISK-DATA-003 暂存区垃圾堆积
Status: mitigated

候选图生成多、消费少。缓解：写入新条目时清扫 >24h 旧条目（沿用 `artifact-tmp-cleanup.ts` 模式）；design-save 消费时拷贝不删源，TTL 兜底。

### RISK-DATA-004 brand-assets 并发写竞争
Status: mitigated

`saveBrandAsset` 走 `runProductMutation` per-product 文件锁，写在锁内原子完成；生成（`generateProductImage`）不动产品状态故不走锁，避免长任务占锁。

### RISK-PROC-001 UNCONFIRMED 规格被误固化
Status: deferred

延期闭环：M5 实现前按官方文档核定（owner=M5 实现，PLAN 已排首步）。

商店图像素值（iOS/Android/Web OG）与 Seedream aspect→size 映射目前均为占位，禁止直接落表或写入测试。缓解：M1/M5 各自实现前按官方文档核定，preset 表测试必须记录来源 URL 与核实日期。

### RISK-PROC-002 craft 冻结约定被破坏
Status: mitigated

`craft/` 既有 vendor 文件不可编辑（ATTRIBUTION 冻结）。本批次只新增 `craft/image-prompts.md`，并同步 README 索引与 slug 测试；M0 的 craft 分发走 MCP 返回值新增字段，不改 vendor 文件。

## Boundaries

- core 只保证单次调用结构有效性，不做跨资产存在性校验；前置检测（5.2 矩阵）全部在 agent 模板层，失败 = 停止 + 指引，不静默降级。
- 生成图唯一落盘通路是现有资产管线（design-save → `localizeArtifactAssets`）与 brand-assets 存储；不开第二条通路。
- 渲染/管线只接受本地资源；任何远程引用 fail loud（沿用 `ARTIFACT_REMOTE_RESOURCE` 原则）。
- 自动化测试不打外网、不需要真实 APIKEY、不需要 Pencil CLI；真实 provider 调用只在用户手动验收。
- 提示词归 agent 层（craft 文档 + 模板），core 只透传 prompt 并按 purpose 定默认尺寸。
- od-* 工作区包与本批次无关，不触碰。

## Scope Overflow Risks

- 多 provider 诱惑：实现期顺手加 OpenAI/Gemini renderer——明确推迟，v1 目录仅 volcengine + stub（stub 不进设置 UI）。
- Web 手动生图界面蔓延：Settings 只做厂商/模型/KEY/BaseURL 配置 + 测试连接，不做生成入口。
- ICON 历史版本树、monochrome 变体、i2i 编辑：均已列非范围，出现需求另立批次。
- 画布功能膨胀：品牌资产画布 v1 仅分组展示 + 单下载 + zip 导出，不做编辑/重排。

## Mitigations

汇总：安全三项（SEC-001/002/003）全部转化为里程碑验收硬项（测试名单已写入需求文档 M1/M3 验收段）；外部依赖两项开放风险（DEP-001、PROC-001）以「实现前官方文档复核 + 来源 URL/日期入测试」闭环，Owner 分别为 M1/M5 实现期；其余风险由架构设计直接消解（锁、TTL、optional 字段、产物入库、预算复用），各自有对应测试断言。

## Trace
<!-- Map this stage's IDs to upstream/downstream. R3 derives & checks closure. -->
| This ID | Upstream | Status |
|---|---|---|
| RISK-SEC-001 | SCOPE-IN-002 / SCOPE-IN-008 | mitigated |
| RISK-SEC-002 | SCOPE-IN-004 / SCOPE-IN-008 | mitigated |
| RISK-SEC-003 | SCOPE-IN-002 | mitigated |
| RISK-DEP-001 | SCOPE-IN-002 / Assumptions / Open Questions | deferred |
| RISK-DEP-002 | SCOPE-IN-002 / Acceptance Criteria | mitigated |
| RISK-DEP-003 | SCOPE-IN-003 | mitigated |
| RISK-DATA-001 | SCOPE-IN-004 / Assumptions | mitigated |
| RISK-DATA-002 | SCOPE-IN-002 / SCOPE-IN-005 | mitigated |
| RISK-DATA-003 | SCOPE-IN-002 | mitigated |
| RISK-DATA-004 | SCOPE-IN-004 | mitigated |
| RISK-PROC-001 | SCOPE-IN-006 / Open Questions | deferred |
| RISK-PROC-002 | SCOPE-IN-005 / Assumptions | mitigated |

## Upstream Summary (read-only)
# Requirement Brief

## Goal

为 Forma 接入图片生成能力，解决「LLM 手绘图标/ICON 质量差、无插图/海报/商店图」的痛点。按六个独立可交付、可验证、可回滚的里程碑（M0–M5）实施：媒体基座（火山方舟 Seedream provider + `forma-image://` 暂存引用协议 + 后台图片模型设置）、内置 Lucide 功能图标库、应用 ICON 重构（新命令 fm-app-icon + 移除 LLM 手绘 icon unit + 品牌资产画布）、设计稿插图（fm-design IMAGERY 接入）、营销资产（新命令 fm-brand-assets：商店图 + 海报，HTML 排版合成 + puppeteer 渲染）。原则：移植优于自研（open-design media 管线裁剪）、生成图必须过现有资产管线、文字密集资产走 HTML 排版、全增量零迁移、未配置时显式降级 fail loud。

## In-Scope

- SCOPE-IN-001 **M0 craft 分发缺口修复**（D10）：`get_component_baseline` 返回值新增 `craft_rules` 字段（纯增量）；fm-refine-components / fm-change-style 模板（×3 平台）新增 palette design-read 步骤（色板轮换检查）。
- SCOPE-IN-002 **M1 媒体基座**：新增 `packages/core/src/media/`（`image-models.ts` 目录 / `image-config.ts` 凭证（YAML、env 优先、脱敏、preserve_api_key、409 防误清空、0600 权限含 win32 例外）/ `image-generate.ts` 调度器（renderer 注册表：volcengine + stub）/ `image-staging.ts` 暂存区（TTL >24h 清扫））；资产管线接受可选 `resolveFormaImage` 解析器；MCP 新工具 `generate_image`；server 路由 `GET /api/media/models`、`GET/PUT /api/media/config`、`POST /api/media/test`；web Settings 新增「图片模型」节；新增 6 个 FormaError 错误码（5.5 节）。
- SCOPE-IN-003 **M2 Lucide 图标库**（D1）：`lucide-static` devDependency + `scripts/vendor-lucide.mjs` 生成入库的 `packages/core/assets/lucide-icons.json`（~1500 个）；core 检索服务；MCP 新工具 `search_icons`；模板硬规则「功能图标禁止手绘」（×3 平台）+ shared SKILL.md 自审项。
- SCOPE-IN-004 **M3 应用 ICON 重构**（D5/D6/D8）：`packages/core/src/brand-assets.ts`（manifest、`saveBrandAsset` 走 `runProductMutation` 锁、sharp 多尺寸派生、zip 导出）；MCP 新工具 `save_brand_asset` / `list_brand_assets`；HTML 源渲染沙箱（禁脚本、先 localize 再渲染、白名单拦截、fail loud）；新模板 fm-app-icon（×3 平台）；icon unit 移除五连改（component-baseline spec、fm-refine-components、fm-change-style、fm-design、manifest 零改动）；品牌资产画布 v1（viewer `AssetTile` + web 路由 `#/products/:pid/brand-assets` + server 三条路由）。
- SCOPE-IN-005 **M4 设计稿插图**：新增 `craft/image-prompts.md`（per-purpose 脚手架 + anti-slop 禁则 + 锁色板 + 视检否决清单，同步 craft/README.md 与 slug 测试）；fm-design 模板 IMAGERY 判定（×3 平台，未配置显式降级）；shared SKILL.md 自审项。
- SCOPE-IN-006 **M5 营销资产**（D3/D4）：新模板 fm-brand-assets（×3 平台，商店图 + 海报）；商店图尺寸 preset 表放 core（实现期按官方文档核定，当前值 UNCONFIRMED 禁止落表/落测试）；画布页扩展商店图/海报分组。
- SCOPE-IN-007 **命令前置条件矩阵**（5.2 节）：fm-app-icon / fm-refine-components / fm-design / fm-brand-assets 的前置检测全部在模板层实现，检测失败 = 停止 + 明确指引。
- SCOPE-IN-008 **安全约束**：`media-config.yaml` 计费凭证不得被静态服务/zip 导出/诊断/日志/错误 details 暴露，诊断仅脱敏元数据；渲染沙箱两层防护（引用形态 vs 拦截白名单）。

## Out-of-Scope

- SCOPE-OUT-001 视频/音频生成（od media 管线含视频/音频，本期只裁剪移植 image）。
- SCOPE-OUT-002 i2i 图生图、图片编辑（SeedEdit）；v1 仅 t2i。
- SCOPE-OUT-003 Web 端手动生图界面（生成仅 agent/MCP 驱动；后台只做模型配置 + 连通性测试）。
- SCOPE-OUT-004 fm-change-style 后自动重生成 ICON/营销资产（D11：只标记「可能过期」）。
- SCOPE-OUT-005 标注画布改动（插图随设计稿 bundle 落盘后天然可见）。
- SCOPE-OUT-006 ICON monochrome 单色变体。
- SCOPE-OUT-007 od 异步 task 层（media-tasks / 202+wait 轮询 / byok-tools）。
- SCOPE-OUT-008 生图结果的人脸/版权审核（单用户本地工具，用户视检选优）。

## Non-Goals

- 首发不做多 provider（只接火山方舟 Seedream 一家，D2），但架构保持可扩展（目录加条目 + 注册 renderer）。
- 不做 ICON / 营销资产的历史版本树（v1 覆盖式更新）。
- 不让 agent 传 base64 图片字节过 LLM 上下文（D7：一律 `forma-image://` 引用）。
- core 不内置提示词模板（D9：提示词脚手架放 agent 层 `craft/image-prompts.md`，core 只透传 prompt）。
- core 不做跨资产存在性校验（前置检测全在模板层）。

## Assumptions

- 火山方舟 API 形态以附录 A 为准（2026-06-13 核实：5 个 Seedream 模型 ID、`POST {ark}/api/v3/images/generations`、Bearer + `b64_json`）；M1 实现前必须重新打开官方页面复核，不一致以官方为准。
- sharp、puppeteer、node-html-parser、zip 能力均已在 repo 中（无运行时新 npm 依赖；`lucide-static` 仅 devDependency）。
- `manifest.forma.productIcon` 为 optional（已核实 `packages/core/src/artifact-manifest.ts:225`），icon unit 移除零迁移。
- `craft/` 既有 vendor 文件冻结不可编辑，新增文件允许（需同步 README 索引与 slug 测试）。
- 真实 ARK APIKEY 仅用户手动验收时提供（计费操作，不进 CI）。

## Acceptance Criteria

- 每里程碑收口：`pnpm test` + `pnpm typecheck` 全绿；涉及模板的跑既有模板/craft 断言测试。
- 所有自动化测试不打外网（stub provider + 本地渲染）。
- M0：`get_component_baseline` 返回 `craft_rules` 且含 ai-tells 文档（测试断言）。
- M1：stub provider 覆盖目录校验/凭证优先级/脱敏/409 防清空/暂存 put-resolve-TTL/管线 `forma-image:` 解析（含预算超限、引用缺失 fail loud）/权限创建与收紧（win32 跳过）/导出与诊断排除；手动：真实 key 测试连接成功。
- M2：检索服务测试（命中/空结果/limit）；icons.json 脚本可重生成且 diff 干净；模板禁手绘断言。
- M3：brand-assets 存储测试（锁、尺寸派生、manifest、zip）；渲染沙箱测试（脚本拦截、远程拒绝、file 越界拒绝、白名单预览可用）；`brand/` 命名空间解析测试；手动：真实 key 跑 fm-app-icon 全流程 → 画布可见全尺寸组并可导出。
- M4：craft 新文档 slug 测试；手动：真实 key 跑含插图页 fm-design，插图落 bundle 且预览/标注画布可见。
- M5：preset 表（含来源 URL + 核实日期）与渲染尺寸测试；手动：真实 key 全流程出一套商店图 + 海报并 zip 导出。
- 回滚：任一里程碑回退 = 删除新代码，不触碰存量数据（全增量）。

## Open Questions

- Seedream aspect→size 像素映射的每档值：M1 实现时按火山官方 API 参考（82379/1541523）核定（原则：每档取该模型推荐的最高质量像素值 ≥2K）。Owner：M1 实现。
- 商店图各平台精确规格：当前示例值（iOS 1290×2796 / Android 1080×1920 / Web OG 1200×630）均为 UNCONFIRMED 占位；M5 实现前按 App Store Connect / Google Play / Open Graph 官方文档核定并记录来源 URL 与核实日期。Owner：M5 实现。

## Sources

- `docs/image-generation-requirements.md`（本仓库，commits ce65240 + bd04fc7，2026-06-13 用户审定）— 本 brief 的唯一上游需求。
- open-design 移植源：`~/x-studio/forma2-cankao/open-design/apps/daemon/src/{media-models,media-config,media}.ts`（附录 B 映射）。
- 火山方舟官方文档（附录 A 表）：https://www.volcengine.com/docs/82379/1330310 、/1541523 、/1824121（2026-06-13 复查）。
- taste-skill（GitHub `Leonxlnx/taste-skill`）：纯提示词借鉴，无代码移植。

## Trace
<!-- Map this stage's IDs to upstream/downstream. R3 derives & checks closure. -->
| This ID | Upstream | Status |
|---|---|---|
| SCOPE-IN-001 | 原始文档 §6 M0 / D10 | covered |
| SCOPE-IN-002 | 原始文档 §6 M1 / §5.3 / §5.5 / D2 / D7 | covered |
| SCOPE-IN-003 | 原始文档 §6 M2 / D1 | covered |
| SCOPE-IN-004 | 原始文档 §6 M3 / D5 / D6 / D8 / D11 | covered |
| SCOPE-IN-005 | 原始文档 §6 M4 / D9 | covered |
| SCOPE-IN-006 | 原始文档 §6 M5 / D3 / D4 | covered |
| SCOPE-IN-007 | 原始文档 §5.1 / §5.2 | covered |
| SCOPE-IN-008 | 原始文档 §6 M1 安全约束段 / M3 渲染沙箱段 | covered |
| SCOPE-OUT-001..008 | 原始文档 §4 非范围表（8 项逐一对应） | covered |

## Upstream Summary (read-only)
# Forma 生图能力需求设计文档

- 日期：2026-06-13（v1，待审查）
- 分支：`feat/image-generation`
- 来源：生图能力立项讨论（open-design 媒体管线审查 → taste-skill 借鉴评估 → 7 项开放问题逐项决策 → 顺序死锁修订）
- 状态：方案已决策完备，待用户审查后实施
- 原则：移植优于自研（open-design `apps/daemon` media 管线裁剪）；生成图必须过现有资产管线（不开第二条落盘通路）；文字密集资产走 HTML 排版而非生图直出；全部增量式改动、旧数据零迁移；未配置模型时显式降级、fail loud 不静默兜底。

## 1. 背景与痛点

Forma 当前没有任何图片生成能力。设计相关图像资产的现状：

- **产品 ICON**：fm-refine-components 的 icon unit 由 LLM 手绘 SVG 双变体（`packages/agent/templates/claude/fm-refine-components.md:27`），质量差，商用不可接受。
- **功能图标**：设计稿/组件 HTML 里由 LLM 手绘内联 SVG，质量差、风格不一致。
- **插图/海报/商店图**：完全没有。
- **资产管线**（`packages/core/src/artifact-asset-pipeline.ts`）：只接受 `data:` 内联资源，拒绝远程引用（`ARTIFACT_REMOTE_RESOURCE`），自动降采样 @1x/@2x/@3x，有预算上限（4MiB HTML / 48MiB 资产 / 200 文件）。
- **渲染能力**：`packages/core/src/preview-renderer.ts` 是 puppeteer + viewport 可配，已具备 HTML→任意尺寸 PNG 的能力。
- **后台设置**：`packages/web/src/pages/Settings.tsx` 是 15 行语言切换空壳。

待解决的痛点（立项输入）：

1. 设计稿和组件的图标、ICON 质量差，且无法提供插图、海报、商店图。
2. fm-refine-components / fm-design 产出的组件/设计稿图标残次不齐。
3. 设计稿页面需要插图时无供给。
4. 产品缺商店图、海报。
5. 标注设计稿缺图标/图片资源（注：插图随设计稿 bundle 落盘后标注画布天然可见，本痛点传递性解决，无独立改动）。

## 2. 决策记录（全部已用户拍板）

| # | 决策 | 取代/否决的方案 |
|---|---|---|
| D1 | 功能图标用**内置 Lucide 图标库**（全量 vendor，~1500 个），不走生图 | 生图生成功能图标（24px 线性图标一致性差、不可缩放、不可 token 着色） |
| D2 | Provider **首发只接火山方舟 Seedream 一家**，架构保持多 provider 可扩展；设置交互 = 选厂商 → 选模型 → 填 APIKEY | 首发 4 家（OpenAI/Gemini/火山/自定义）——用户改为渐进接入 |
| D3 | 商店图/海报走 **HTML 排版合成 + puppeteer 渲染**，生图模型只产素材（插画/背景），不产成品 | 纯生图直出（中文文字渲染不可用） |
| D4 | 新增独立命令 **fm-brand-assets**（商店图+海报），不并入 fm-refine-components | 组件库流程顺带生成（多张生图+渲染拖垮主流程、失败面叠加） |
| D5 | **应用 ICON 独立为新命令 fm-app-icon**，用 Seedream 生图（2048 母版 → sharp 多尺寸）。理由：商店图依赖设计稿预览（fm-brand-assets 晚于 fm-design），而设计稿启动页又需要 ICON，ICON 留在 fm-brand-assets 会形成顺序死锁 | 应用 ICON 由 fm-brand-assets 生成（顺序死锁）；从 SVG 导出 raster（SVG 源头是 LLM 手绘，丑的根源在源头） |
| D6 | **fm-refine-components 的 icon unit 整体移除**（LLM 手绘 SVG 产品 ICON 退役）。`manifest.forma.productIcon` 本就 optional（`packages/core/src/artifact-manifest.ts:225`），旧 artifact 零迁移 | 保留 SVG 产品 ICON 作为 UI 内矢量标识 + 双向参照联动（用户否决：源头质量不可救） |
| D7 | 生成图经 **`forma-image://` 暂存引用**进资产管线（LLM 不传 base64），新增 `brand/` 命名空间引用持久品牌资产 | agent 传 base64（上下文爆炸）；绕过管线直接落盘（开第二条通路） |
| D8 | 应用 ICON + 商店图 + 海报在**同一个独立画布页**展示（viewer 新 AssetTile），单资产下载 + zip 全量导出 | 塞进现有 BrandResources 页（该页保留组件库职责不变） |
| D9 | 提示词脚手架放 **agent 层**（`craft/image-prompts.md` 新文件 + 模板步骤），core 只透传 prompt、按 purpose 定默认尺寸。借鉴 taste-skill 的 anti-slop 词表与锁色板规则（taste-skill 生图部分是纯提示词框架，无代码可移植） | core 内置 prompt 模板（提示词迭代不应依赖发版） |
| D10 | **遗留缺口顺手修**（M0）：fm-refine-components 流程拿不到 craft 文档，palette 轮换规则（`craft/ai-tells.md:63`）触达不到色板诞生的流程 | 留作独立后续批次 |
| D11 | fm-change-style 换风格后，应用 ICON / 营销资产在画布**标记「可能过期」**，不自动重生成 | 自动级联重生成（慢、贵、用户不一定想换 ICON） |

## 3. 范围

六个里程碑 M0–M5，各自独立可交付、可验证、可回滚：

- M0：craft 分发缺口修复（D10）
- M1：媒体基座（provider 目录 / 凭证配置 / 生成调度 / 暂存区 / `forma-image:` 管线 / 后台设置）
- M2：Lucide 图标库（D1）
- M3：应用 ICON 重构（fm-app-icon 命令 + icon unit 移除 + 品牌资产画布 v1）
- M4：设计稿插图（fm-design IMAGERY 接入）
- M5：营销资产（fm-brand-assets：商店图 + 海报 + 画布扩展）

全量约 30+ 文件：core 新增 ~8、修改 ~5；mcp/server/web/viewer 各若干；agent 模板 3 平台 ×（2 新命令 + 3 既有命令修改）；测试同步。无新服务、无运行时新 npm 依赖（sharp / puppeteer / node-html-parser / zip 能力已有；`lucide-static` 仅 devDependency）。

## 4. 非范围（明确不做）

| 项 | 不做的理由 |
|---|---|
| 视频/音频生成 | od media 管线含视频/音频，本期只裁剪移植 image |
| i2i 图生图、图片编辑（SeedEdit） | v1 仅 t2i；renderer 接口天然可扩展，等真实需求 |
| Web 端手动生图界面 | 生成仅 agent/MCP 驱动；后台只做模型配置 + 连通性测试 |
| fm-change-style 后自动重生成 ICON/营销资产 | 见 D11，只标记过期 |
| 标注画布改动 | 插图随设计稿 bundle 落盘，标注画布已能渲染 bundle |
| ICON monochrome 单色变体 | 深色水印等场景 v1 不做，等真实需要（生图单色版或图像处理去色均可行） |
| od 异步 task 层（media-tasks / 202+wait 轮询） | Forma 生成由 agent 经 MCP 同步等待，无 UI 轮询需求 |
| 生图结果的人脸/版权审核 | 单用户本地工具，资产由用户视检选优 |

## 5. 总体架构

```
                  后台 Settings「图片模型」节（厂商→模型→APIKEY）
                            │ GET/PUT /api/media/config（脱敏）
                            ▼
              $FORMA_HOME/media-config.yaml ◄── env 变量优先
                            │
 agent 命令                  ▼                packages/core/src/media/
 (fm-app-icon /     MCP generate_image ────► image-generate.ts 调度器
  fm-design /                │               （renderer 注册表：volcengine | stub）
  fm-brand-assets)           │ ◄── { ref: "forma-image://<id>", preview_path }
        │                    ▼      （agent 用 Read 视检候选图）
        │        $FORMA_HOME/data/<pid>/image-staging/<id>.png + <id>.json
        │
        ├─ 设计稿/组件: HTML 里 <img src="forma-image://<id>">
        │     └─► generate_requirement_design / generate_components → design-save
        │           └─► artifact-asset-pipeline 解析 forma-image:
        │                 staging 或 brand-assets 取字节 → 降采样 @1x/@2x/@3x
        │                 → 预算检查 → assets/ 落盘（与 data: 资源同一条管线）
        │
        ├─ 应用 ICON: MCP save_brand_asset(kind=app-icon, image_ref)
        │     └─► 2048 母版 + sharp 按 platform 派生全套尺寸 + favicon
        │
        └─ 商店图/海报: agent 写排版 HTML → MCP save_brand_asset(kind=store-shot|poster, html)
              └─► puppeteer 按目标像素尺寸渲染 PNG
                            │
                            ▼
        $FORMA_HOME/data/products/<pid>/od-project/brand-assets/<kind>/…
                            │
                            ▼
        品牌资产画布页 #/products/:pid/brand-assets
        （AssetTile 分组：应用 ICON 组 / 商店图组 / 海报组；单下载 + zip 全量导出）
```

### 5.1 推荐工作流（无死锁线性顺序）

```
init_product_config → fm-app-icon → fm-refine-components → fm-design → fm-brand-assets
```

### 5.2 命令前置条件矩阵

| 命令 | 选定产品 | init_product_config | 图片模型已配置 | 应用 ICON 已生成 | 有预览的设计稿 |
|---|---|---|---|---|---|
| fm-app-icon | 必须 | 必须 | 必须 | —（自己生成） | 不需要 |
| fm-refine-components | 必须 | 必须 | 不需要 | **硬前置**：缺失则停止并引导跑 fm-app-icon | 不需要 |
| fm-design | 必须 | 必须 | 仅插图页需要 | **条件前置**：页面 spec 涉及 ICON 展示（启动页/登录页/导航品牌位）→ 硬性要求；无关页面 → 提醒一句后放行 | 不需要 |
| fm-brand-assets | 必须 | 必须 | 必须 | **硬前置**（商店图必然展示 ICON） | 商店图必须（要嵌真实页面截图），海报不需要 |

前置检测全部在**模板层**实现（经 `list_brand_assets` / `list_product_artifacts` 查询后判断），core 不做跨资产存在性校验（core 只保证单次调用的结构有效性）。检测失败 = 停止 + 明确指引，不静默降级。

### 5.3 `forma-image://` 引用协议

| 形态 | 后端 | 生命周期 |
|---|---|---|
| `forma-image://<uuid>` | 暂存区 `data/<pid>/image-staging/` | `generate_image` 写入；design-save 消费时拷贝进 bundle（不删源）；写入新条目时顺手清扫 >24h 旧条目（沿用 `artifact-tmp-cleanup.ts` 模式） |
| `forma-image://brand/app-icon` | 品牌资产存储的 ICON 母版 | 持久，随 save_brand_asset 更新 |
| `forma-image://brand/app-icon@<size>` | ICON 指定尺寸派生（如 `@512`） | 同上 |

解析时机：`localizeArtifactAssets`（design-save 入口）。解析失败（id 不存在/越界）抛 `MEDIA_IMAGE_NOT_FOUND`，整次保存失败（fail loud）。解析成功后字节流与 `data:` 资源走完全相同的降采样、预算、manifest 记账逻辑。

### 5.4 存储布局（新增部分）

```
$FORMA_HOME/
├── media-config.yaml                          # 新增：provider 凭证（见 6.M1）
└── data/
    ├── <productId>/
    │   └── image-staging/                     # 新增：生成图暂存
    │       ├── <uuid>.png
    │       └── <uuid>.json                    # { purpose, prompt, model, width, height, created_at }
    └── products/<productId>/od-project/
        └── brand-assets/                      # 新增：持久品牌资产
            ├── manifest.json                  # { assets: [{ kind, name, files, brand_style, model, generated_at }] }
            ├── app-icon/                      # master.png(2048) + icon-1024.png … favicon-16.png
            ├── store-shots/                   # <name>.png（按 platform 预置尺寸）
            └── posters/                       # <name>.png
```

`brand-assets/manifest.json` 每条记录写入生成时的 `brand_style` slug；web 画布以 `asset.brand_style !== product.brand_style` 判定「可能过期」徽标（D11）。

### 5.5 新增 FormaError 错误码

| 码 | 场景 |
|---|---|
| `MEDIA_NOT_CONFIGURED` | 所选 provider 无可用 APIKEY（env 与存储均无） |
| `MEDIA_PROVIDER_ERROR` | provider HTTP 非 2xx / 响应不可解析（details 含 status 与截断 body） |
| `MEDIA_INVALID_INPUT` | 未注册的 model id、model 与 provider 不匹配、非法 aspect/count |
| `MEDIA_IMAGE_NOT_FOUND` | `forma-image://` 引用在暂存区与品牌资产中均不存在 |
| `BRAND_ASSET_INVALID_INPUT` | save_brand_asset 入参非法（未知 kind、html 与 image_ref 二者皆缺/皆给、非法尺寸） |
| `BRAND_ASSET_NOT_FOUND` | list/导出指定的资产不存在 |

## 6. 分里程碑详细设计

### M0 craft 分发缺口修复（D10，独立先行）

**问题**：fm-design 经 `get_design_context` 拿到 craft 规则文档（`fm-design.md:26`），而 fm-refine-components 只调 `get_style`（`fm-refine-components.md:21`），拿不到 craft 文档。palette 轮换规则（`craft/ai-tells.md:63`，反「artisan 默认色板」）只触达了被禁止发明色板的页面流程（`craft/design-read.md:25`），最需要它的组件库（brand tokens 诞生处）反而看不见。

**改动**：

1. `packages/core` + `packages/mcp`：`get_component_baseline` 返回值新增 `craft_rules` 字段（与 `get_design_context` 同源的 craft 文档集），**纯增量字段**，旧调用方不受影响。
2. fm-refine-components 模板（×3 平台）：步骤 5 之后新增「palette design-read」步骤——定义 brand tokens 前按 `craft_rules` 执行色板轮换检查（明确禁止落入 beige/cream + brass/clay/oxblood 默认组合，除非 brand_style tokens 已锁定）。
3. fm-change-style 模板（×3 平台）：同样新增该步骤（换风格 = 重定色板，同样需要）。

**验收**：core/mcp 测试断言 `get_component_baseline` 返回 `craft_rules` 且包含 ai-tells 文档；模板测试（如有模板 lint）通过；`pnpm test` + `pnpm typecheck` 全绿。

### M1 媒体基座

**新增 `packages/core/src/media/`（移植映射见附录 B）：**

1. **`image-models.ts`** — provider/模型目录与类型：

```ts
export type ImageProvider = { id: string; label: string; hint: string;
  defaultBaseUrl?: string; docsUrl?: string };
export type ImageModel = { id: string; label: string; hint: string;
  provider: string; default?: boolean };
```

   v1 目录：provider = `volcengine`（默认 baseUrl `https://ark.cn-beijing.volces.com/api/v3`）+ `stub`（测试用确定性占位，不出现在设置 UI）。模型（已于 2026-06-13 经火山方舟官方文档核实）：

   | Model ID | 说明 |
   |---|---|
   | `doubao-seedream-5-0-260128` | Seedream 5.0，最强（**默认**） |
   | `doubao-seedream-5-0-lite-260128` | 5.0 Lite，快/便宜（迭代期） |
   | `doubao-seedream-4-5-251128` | Seedream 4.5 |
   | `doubao-seedream-4-0-250828` | Seedream 4.0 |
   | `doubao-seedream-3-0-t2i-250415` | Seedream 3.0 文生图 |

   后续扩展一家 provider = 目录加条目 + 注册一个 renderer 函数，调度器不动。

2. **`image-config.ts`** — 凭证配置，存 `$FORMA_HOME/media-config.yaml`：

```yaml
providers:
  volcengine:
    api_key: "…"
    base_url: "https://ark.cn-beijing.volces.com/api/v3"   # 可省，省略用默认
    model: "doubao-seedream-5-0-260128"                     # 当前选用模型
```

   语义照搬 od `media-config.ts`：env 优先（`FORMA_VOLCENGINE_API_KEY` > `ARK_API_KEY` > `VOLCENGINE_API_KEY`）；读接口脱敏（只回 `configured/source/api_key_tail(末4位)/base_url/model`，env 来源连尾巴都不回显）；写接口支持 `preserve_api_key`（UI 改 model 不必重填 key）；空 payload 将清空已有配置时返回 409 拒绝（防误清空），`force=true` 才放行。

   安全约束：`media-config.yaml` 含计费凭证，新建时必须以用户私有权限写入（mode `0600`），更新时保留既有更严格权限；若既有文件权限宽于 `0600`，写入时收紧到 `0600`。该文件不得被 server 静态服务、artifact/brand-assets zip 导出、诊断包、日志或错误 details 暴露；诊断输出仅允许脱敏元数据（`configured/source/model/base_url/api_key_tail`，且 env 来源不回显尾号）。测试覆盖权限创建/收紧、脱敏读取、防误清空和导出/诊断排除。平台例外：Windows 上 Node 忽略 POSIX mode，无 `0600` 语义——权限创建/收紧的实现与测试在 `win32` 按平台跳过（`process.platform` 门控），其余约束（不暴露、脱敏、防误清空）跨平台不变。

3. **`image-generate.ts`** — 生成调度器：校验 model 在目录内且 surface 匹配 → `resolveProviderConfig` 取凭证（无 key 抛 `MEDIA_NOT_CONFIGURED`）→ 按 provider id 查 renderer 注册表 → 执行。v1 renderer：
   - `volcengine`：`POST {baseUrl}/images/generations`，Bearer 鉴权，`{ model, prompt, size, response_format: "b64_json" }`，解析 `data[0].b64_json|url`（参考 od `media.ts:1293-1343`）。aspect→size 映射按火山官方 API 参考（文档 82379/1541523）实现，原则：每档取该模型推荐的最高质量像素值（≥2K）。
   - `stub`：确定性 PNG 字节（含尺寸编码），测试全程不打网络。

4. **`image-staging.ts`** — 暂存区：`put(productId, bytes, meta) → { id, ref, path }`；`resolve(productId, ref) → bytes`（含 `brand/` 命名空间转发到 brand-assets 存储，M3 接入）；路径越界用现有 `path-boundary.ts` 校验；写入时清扫 >24h 旧条目。

**接线：**

- `packages/core/src/errors.ts`：新增 5.5 节错误码。
- `packages/core/src/store.ts`：`createFormaStore` 装配 media 服务，暴露 `generateProductImage(input)`（生成不动产品状态，**不走** `runProductMutation` 锁）。
- `packages/core/src/artifact-asset-pipeline.ts` + `design-save.ts`：管线入口接受可选 `resolveFormaImage` 解析器；HTML 走查时把 `forma-image:` 引用按 5.3 节解析成字节后并入既有 data: 处理流。
- `packages/mcp/src/tools.ts`：新增工具 **`generate_image`**：

```
generate_image(product_id, purpose: "app-icon"|"illustration"|"hero"|"poster-bg"|"store-shot-bg",
               prompt, aspect?: "1:1"|"16:9"|"9:16"|"4:3"|"3:4", count?: 1..4)
→ { images: [{ id, ref, preview_path, width, height }], provider_note, warnings }
```

   `purpose` 只决定默认 aspect 与暂存元数据，prompt 由 agent 全权构造（D9）；`preview_path` 为本地绝对路径，agent 用 Read 视检候选。
- `packages/server`：路由 `GET /api/media/models`、`GET/PUT /api/media/config`、`POST /api/media/test`（用当前配置生成一张最小尺寸图验证连通性，返回 `{ ok, provider_note }` 或错误；用户主动触发，单张计费可接受）。
- `packages/web/src/pages/Settings.tsx`：新增「图片模型」节——厂商下拉（目录驱动，当前仅火山方舟）→ 模型下拉（目录联动）→ APIKEY 输入（已配置显示 `••••` + 末 4 位）→ Base URL（预填默认值可改）→「测试连接」按钮。

**验收**：stub provider 覆盖目录校验/凭证优先级/脱敏/409 防清空/暂存 put-resolve-TTL/管线 forma-image: 解析（含预算超限、引用缺失 fail loud）；server 路由测试；Settings UI 测试；`pnpm test` + `pnpm typecheck`。手动验收：填真实 ARK key → 测试连接成功。

### M2 Lucide 图标库（D1）

1. `lucide-static` 加入根 devDependencies；新增 `scripts/vendor-lucide.mjs`：从 lucide-static 生成 `packages/core/assets/lucide-icons.json`（`name → { svg, tags, categories }`，全量 ~1500 个，~1.5MB，产物入库；升级 Lucide 重跑脚本）。
2. `packages/core`：图标检索服务（名称前缀/子串 + tag 匹配，懒加载 JSON）。
3. `packages/mcp/src/tools.ts`：新增工具 **`search_icons`**：

```
search_icons(query, limit? = 10) → { icons: [{ name, tags, svg }] }
```

4. 模板改造（×3 平台）：fm-design / fm-refine-components 新增硬规则——**功能图标禁止手绘**，必须经 `search_icons` 取 Lucide SVG 内联（`currentColor` 继承 + stroke-width 随 tokens）；shared `SKILL.md` 自审清单增加「功能图标均来自图标库」检查项。

**验收**：检索服务测试（命中/空结果/limit）；MCP 工具测试；icons.json 由脚本可重新生成且 diff 干净；模板含禁手绘规则断言（craft 测试既有模式）。

### M3 应用 ICON 重构（D5/D6/D8）

**3a. brand-assets 存储与 MCP：**

- 新增 `packages/core/src/brand-assets.ts`：manifest 读写、`saveBrandAsset`（**走 `runProductMutation` 锁**）、`listBrandAssets`、zip 导出（复用 `export_artifact` 既有 zip 能力）、app-icon 尺寸派生（sharp：2048 母版 → iOS 1024/180/120、Android 512/192/144/96/72/48、Web 512/192/32/16，按 product.platform 输出对应组 + favicon）。
- `packages/mcp/src/tools.ts` 新增：

```
save_brand_asset(product_id, kind: "app-icon"|"store-shot"|"poster",
                 source: { image_ref? : string, html?: string },   # 二选一：app-icon 用 image_ref；store-shot/poster 用 html
                 name, target?: { width, height } | { preset: string })
→ { kind, name, files: [{ path, width, height }], generated_at }

list_brand_assets(product_id, kind?) → { assets: […含 brand_style 与 stale 判定所需字段] }
```

  `html` 源经 puppeteer 按目标尺寸渲染（复用 preview-renderer 的 file:// bundle 渲染与子资源 fail-loud 逻辑；HTML 内允许 `forma-image://` 引用与产品自身 artifact 预览图的本地引用，同样走解析器，禁远程）。渲染沙箱必须默认禁脚本或拦截脚本执行，并拦截所有子资源请求。分两层表述：`forma-image://` 与产品预览引用属于「HTML 源允许的引用形态」，在**渲染前**由解析器重写为本地 bundle 文件（与 design-save 管线同序：先 localize 再渲染）——浏览器层不会出现 `forma-image://` 请求；拦截层白名单只放行重写后 bundle 目录内的 `file://` 与经 path-boundary 校验通过的产品预览文件。`http(s):`、协议相对 URL、白名单外的任意 `file://`、越界路径和未授权本地资源一律 fail loud。测试覆盖脚本拦截、远程请求拒绝、file 越界拒绝、允许列表预览图可用。

**3b. fm-app-icon 命令（新模板 ×3 平台）：**

流程：确认产品 + 校验 config（platform/brand_style）+ 校验图片模型已配置 → `get_style(brand_style)` 取色板 → 按 `craft/image-prompts.md` 的 app-icon 脚手架构造 prompt（注入品牌色、产品定位；禁文字、禁 mockup 边框、单一主体、居中构图）→ `generate_image(purpose="app-icon", count=3..4)` → Read 逐张视检（按脚手架的否决清单淘汰）→ 选优 → `save_brand_asset(kind="app-icon", image_ref)` → 报告生成尺寸组与画布地址。已有 ICON 时为「更新」语义：明确告知将覆盖并继续（资产无版本树，v1 不做 ICON 历史）。

**3c. icon unit 移除五连改：**

1. `packages/core/src/component-baseline.ts`：baseline spec 去掉 `productIcon` 节（+ 测试）。
2. fm-refine-components 模板（×3）：删 icon unit 步骤与 `product_icon`/SVG `supporting_files` 提交；重构既有库时即使源里有 icon unit 也不再输出；新增 5.2 节硬前置检测。
3. fm-change-style 模板（×3）：废弃 shape 几何复用/recolor 规则；完成后提示「应用 ICON 与营销资产可能过期，可重跑 fm-app-icon / fm-brand-assets」。
4. fm-design 模板（×3）：`fm-design.md:36` 的「复用 componentLibrary.productIcon SVG」改为「经 `list_brand_assets` 确认 ICON 后用 `forma-image://brand/app-icon@<size>` 引用」；新增 5.2 节条件前置检测。
5. manifest/校验零改动（`forma.productIcon` 本就 optional，旧 artifact 含 icon unit 继续有效；`validateArtifactManifest` 对 present 时的 SVG 约束保留，用于旧数据）。

**3d. 品牌资产画布 v1：**

- `packages/viewer`：新增 `AssetTile`（图片瓦片：缩略 + 尺寸标签 + 下载按钮 + stale 徽标）。
- `packages/web`：新路由 `#/products/:pid/brand-assets`（React Flow 画布，v1 仅应用 ICON 分组），入口于产品详情 + BrandResources 页；工具栏「全部导出」。
- `packages/server`：`GET /api/products/:pid/brand-assets`（列表+manifest）、`GET /api/products/:pid/brand-assets/files/*`（path-boundary 校验的文件服务）、`GET /api/products/:pid/brand-assets/export`（zip）。

**验收**：brand-assets 存储测试（锁、尺寸派生、manifest、zip）；MCP 工具测试；管线 `brand/` 命名空间解析测试；viewer/web 组件测试；模板断言更新（含 icon unit 移除后的 fm-refine-components 全集断言）。手动验收：真实 key 跑 fm-app-icon 全流程 → 画布可见全尺寸组并可导出。

### M4 设计稿插图

1. 新增 `craft/image-prompts.md`（craft 冻结只限既有 vendor 文件，新增允许，需同步 `craft/README.md` 索引与 craft 测试 slug 列表）：per-purpose 提示词脚手架（illustration / hero / poster-bg / store-shot-bg / app-icon）+ 借鉴 taste-skill 的 anti-slop 禁则（禁紫蓝渐变、漂浮 blob、generic 套图）+ **锁色板规则**（同一产品的所有生成素材锁定 brand tokens 色板）+ 视检否决清单（文字乱码、肢体/透视崩坏、风格漂移）。
2. fm-design 模板（×3）：Design Read 步骤（既有第 5 步）增加 **IMAGERY 判定**——页面 spec 是否需要插图（空状态/引导页/营销页 hero）；需要且模型已配置 → 走 `generate_image(purpose="illustration"|"hero")` + Read 视检 + `forma-image://` 引用；模型未配置 → 明确降级为现行 CSS/SVG 装饰路线并在产出报告中注明（不静默）。
3. shared `SKILL.md` 自审清单：增加「生成插图已逐张视检且与色板一致」检查项。

**验收**：craft 测试覆盖新文档 slug；模板断言更新；手动验收：真实 key 跑一个含插图页的 fm-design，插图经管线落 bundle 且预览/标注画布可见。

### M5 营销资产（fm-brand-assets，D3/D4）

1. fm-brand-assets 命令（新模板 ×3 平台），范围 = **商店图 + 海报**。流程：确认产品 + 5.2 节前置检测（含 ICON 硬前置；商店图要求至少一个有预览的设计稿，缺失则停止并指引先跑 fm-design）→ 读 brand tokens + 应用 ICON + 设计稿预览图 → 按 platform 生成：
   - **商店图**：尺寸 preset 是 M5 实现期核定项；当前示例值 iOS `1290×2796`（6.7" 竖屏组）、Android Play `1080×1920`、Web OG `1200×630` 均为 **UNCONFIRMED 占位**，禁止直接落表或写入测试。M5 实现前必须按 App Store Connect、Google Play、Open Graph/平台分享图官方文档核定尺寸并在 preset 表测试中记录来源 URL 与核实日期。agent 写排版 HTML（设备框 + 真实页面截图 + 卖点文案 + 品牌色背景，可用 `generate_image(purpose="store-shot-bg")` 产背景素材）→ `save_brand_asset(kind="store-shot", html, preset)`。
   - **海报**：`1080×1920` 竖版（朋友圈/分享场景），HTML 排版 + 生图插画素材 → `save_brand_asset(kind="poster", html, target)`。
2. 画布页扩展商店图/海报两个分组（AssetTile 复用）。
3. 商店图尺寸预设表放 core（`brand-assets.ts`），按 product.platform 给 agent 返回可用 preset 清单（实现时以各商店当时官方规格为准核定像素值，原则：每平台取主力机型/官方推荐尺寸 1–2 档，不求全集）。

**验收**：preset 表与渲染尺寸测试；模板断言；手动验收：真实 key 全流程出一套商店图 + 海报并 zip 导出。

## 7. 测试与验证总则

- 每里程碑收口必跑：`pnpm test` + `pnpm typecheck`；涉及 agent 模板的跑既有模板/craft 断言测试。
- 所有自动化测试 **不打外网**（stub provider + 本地渲染），与现有套件「不需要 Pencil CLI」原则一致。
- 真实 provider 调用仅出现在用户手动验收（计费操作，不进 CI）。
- 单文件调试：`npx vitest run packages/core/tests/<file>.test.ts`。

## 8. 兼容性与回滚

- **零迁移**：旧组件库的 icon unit 与 `manifest.forma.productIcon` 依旧有效（字段 optional）；新生成不再产出。
- **全增量**：`media-config.yaml`、`image-staging/`、`brand-assets/` 均为新文件/目录；任一里程碑回退 = 删除新代码，不触碰存量数据。
- **降级路径**：图片模型未配置时——fm-design 走现行 CSS/SVG 装饰（显式注明）；fm-app-icon / fm-brand-assets 直接停止并指引配置；核心设计管线（无图需求）完全不受影响。
- **外部状态**：唯一外部副作用是调用火山方舟 API（计费）；失败不留半成品（暂存区条目自带 TTL 清扫，brand-assets 写在锁内原子完成）。

## 9. 显式遗留

| 项 | 说明 | Owner |
|---|---|---|
| Seedream aspect→size 像素映射 | 实现时按火山官方 API 参考（82379/1541523）核定每档值 | M1 实现 |
| 商店图各平台精确规格 | 当前 M5 示例值均为 UNCONFIRMED 占位；实现时按各商店/平台当时官方文档核定，并同步来源 URL、核实日期、preset 表与测试 | M5 实现 |
| ICON monochrome 变体 | v1 不做，见非范围 | 后续需求 |
| ICON / 营销资产历史版本 | v1 覆盖式更新，无版本树；若需要回滚历史另立需求 | 后续需求 |
| 更多 provider（OpenAI / Gemini / 自定义兼容端点） | 架构已留位：目录加条目 + 一个 renderer | 后续需求 |

## 附录 A：Seedream 模型核实记录

2026-06-13 经火山方舟官方文档核实：可生图模型为 `doubao-seedream-5-0-260128`、`doubao-seedream-5-0-lite-260128`、`doubao-seedream-4-5-251128`、`doubao-seedream-4-0-250828`、`doubao-seedream-3-0-t2i-250415`；`doubao-seededit-3-0-i2i-250628` 为 i2i 编辑模型，v1 不收录。端点 `POST {ark}/api/v3/images/generations`（OpenAI 形，Bearer + `response_format: b64_json`）。

官方来源入口（2026-06-13 复查；火山文档正文由站点 JS 渲染，以下保留稳定 URL 与页面可见最近更新时间，M1 实现前必须重新打开官方页面核对 model id、endpoint、`response_format`、返回字段和 aspect/size 映射；若与本文不一致，以官方文档为准并同步更新目录与测试）：

| 来源 | URL | 页面可见最近更新时间 | 本文依赖字段 |
|---|---|---|---|
| 模型列表 | https://www.volcengine.com/docs/82379/1330310 | 2026.06.12 11:41:23 | 可用 Seedream/SeedEdit 模型 ID 与模型类别 |
| 图片生成 API | https://www.volcengine.com/docs/82379/1541523 | 2026.06.04 15:34:26 | `images/generations` 端点、鉴权、请求/响应字段、尺寸参数 |
| Seedream 4.0-5.0 教程 | https://www.volcengine.com/docs/82379/1824121 | 2026.06.04 20:43:36 | Seedream 4.0/5.0 文生图模型用法和规格说明 |

## 附录 B：open-design 移植映射

| forma 目标 | od 源（`~/x-studio/forma2-cankao/open-design`） | 取舍 |
|---|---|---|
| `core/src/media/image-models.ts` | `apps/daemon/src/media-models.ts` | 取类型与目录结构；砍视频/音频/21 provider 至 volcengine+stub |
| `core/src/media/image-config.ts` | `apps/daemon/src/media-config.ts` | 取 env 优先/脱敏/preserveApiKey/409 防清空；JSON 改 YAML、砍 OAuth 借用与 alias 机制 |
| `core/src/media/image-generate.ts` | `apps/daemon/src/media.ts`（`generateMedia` 骨架 + `renderVolcengineImage` L1293-1343） | 取调度骨架与火山 renderer；砍其余 renderer、imageRef、composition |
| （不移植） | `media-tasks.ts` / `media-routes.ts` 202+wait / `byok-tools.ts` | 异步任务层无需求；byok 的工具描述措辞可参考 |
| `craft/image-prompts.md` | taste-skill（GitHub `Leonxlnx/taste-skill`：brandkit / imagegen-frontend-*） | 纯提示词借鉴：anti-slop 禁则、锁色板、purpose 模板结构；无代码 |
| 海报 HTML 路线 | `skills/poster-hero/SKILL.md` | 版式结构参考（竖版 1080×1920、上留白/中主题/下信息卡） |
<!-- /r2p-read-only -->

## Project Context (read-only)
# Project Context Pack

- repo_root: `/Users/xubo/x-studio/forma`
- languages: {'TypeScript': 101893, 'JavaScript': 22178}
- package_managers: npm
- test_commands: ['npm test']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies (18):
  - @xenonbyte/forma-cli workspace:* (npm)
  - @xenonbyte/forma-core workspace:* (npm)
  - @xenonbyte/forma-server workspace:* (npm)
  - @biomejs/biome 2.2.4 (npm, dev)
  - @types/js-yaml ^4.0.9 (npm, dev)
  - @types/node ^24.0.0 (npm, dev)
  - @vitest/browser 4.1.6 (npm, dev)
  - @vitest/browser-playwright 4.1.6 (npm, dev)
  - @xyflow/react 12.10.2 (npm, dev)
  - happy-dom ^20.9.0 (npm, dev)
  - js-yaml ^4.1.1 (npm, dev)
  - playwright 1.60.0 (npm, dev)
  - react ^19.2.6 (npm, dev)
  - react-dom ^19.2.6 (npm, dev)
  - tsup ^8.0.0 (npm, dev)
  - tsx ^4.20.0 (npm, dev)
  - typescript ^5.9.0 (npm, dev)
  - vitest ^4.0.7 (npm, dev)
- source_dirs: ['bin', 'craft', 'design-version', 'docs', 'output', 'packages', 'scripts', 'spikes', 'styles']
<!-- /r2p-read-only -->
<!-- /r2p-read-only -->

## Project Context (read-only)
# Project Context Pack

- repo_root: `/Users/xubo/x-studio/forma`
- languages: {'TypeScript': 101893, 'JavaScript': 22178}
- package_managers: npm
- test_commands: ['npm test']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies (18):
  - @xenonbyte/forma-cli workspace:* (npm)
  - @xenonbyte/forma-core workspace:* (npm)
  - @xenonbyte/forma-server workspace:* (npm)
  - @biomejs/biome 2.2.4 (npm, dev)
  - @types/js-yaml ^4.0.9 (npm, dev)
  - @types/node ^24.0.0 (npm, dev)
  - @vitest/browser 4.1.6 (npm, dev)
  - @vitest/browser-playwright 4.1.6 (npm, dev)
  - @xyflow/react 12.10.2 (npm, dev)
  - happy-dom ^20.9.0 (npm, dev)
  - js-yaml ^4.1.1 (npm, dev)
  - playwright 1.60.0 (npm, dev)
  - react ^19.2.6 (npm, dev)
  - react-dom ^19.2.6 (npm, dev)
  - tsup ^8.0.0 (npm, dev)
  - tsx ^4.20.0 (npm, dev)
  - typescript ^5.9.0 (npm, dev)
  - vitest ^4.0.7 (npm, dev)
- source_dirs: ['bin', 'craft', 'design-version', 'docs', 'output', 'packages', 'scripts', 'spikes', 'styles']
<!-- /r2p-read-only -->
