# Open-Design 设计生成能力迁移 实施计划

> **For agentic workers:** 本文件是**规划文档**，不是逐步 TDD 实施稿。每个 Phase 给出目标 / 改动文件 / 应用的已锁定决策 / 验收标准 / 依赖。真正执行某个 Phase 时，再用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 展开到 task/step 级。**未经用户确认不要开始实现。**

**Goal:** 在 DESIGN-v8 完成 Pencil→open-design **结构性**迁移（vendored 包、manifest v1、桌面端只读壳、fm-* 重写为 stub）之后，把 open-design 的**设计生成能力本体**还原进 forma：真实的 craft 设计原则、全量品牌风格、生成流程、质量门、预览图。验收线是 **达到 OpenDesign 的设计稿质量**。

**Architecture:** 沿用 forma「**AI 在外、forma 在内**」模型——用户的 claude/codex/gemini 会话即生成器，forma 通过 MCP 提供知识与数据、负责落盘。设计知识（craft + style）走 **MCP 即时下发**作为唯一来源；fm-* 模板退化为**薄胶水**；artifact 按 **page→N artifact、artifact→N version** 组织；生成类 MCP 工具从「生成」语义改为「**保存 AI 生成的 HTML 稿**」语义；`odRuntime` 抽象移除。

**Tech Stack:** TypeScript ESM, Node ≥22, pnpm workspace, Vitest, YAML 持久化（`writeYamlAtomic`），puppeteer（bundled，含 Chromium）做 HTML→PNG，React + Vite（web/desktop）。

**上游迁移源:** `/Users/xubo/x-studio/forma2-cankao/open-design`（DESIGN-v8 锁定的 fork 参考）。craft 取 `craft/*.md`（Apache 2.0）；品牌风格取 `design-systems/`（源 `bergside/awesome-design-skills`，MIT）；框架目录项取 `skills/`（`od.mode: design-system` 的 stub）。

---

## 关联文档

- 前置：`design-version/DESIGN-v8.md`（结构性迁移，已完成）。本计划是 DESIGN-v8 设计能力相关目标的**能力落地**：目标 2（manifest 持久化）/ 3（MCP 语义）/ **4（fm-* 重写）** / 5（web 风格 + 需求页）/ 6（桌面端），并继续遵守目标 1（不引 daemon / 上游桌面端）与 **7（mutation 仅经 fm-* MCP、桌面端无编辑入口）**。
- 现状基线：`main` @ `9c1c065`（v8 迁移收尾，741 测试通过，typecheck clean）

---

## 锁定决策（本次梳理产出，不可在实现期擅改）

| # | 决策点 | 结论 |
|---|---|---|
| **Q1** | Style 迁移（β） | 152 brand styles（每个 3 文件 `DESIGN.md`+`components.html`+`tokens.css`，MIT）+ 17 框架 catalog stub；product config 拆 `brand_style`+`system_style`；后台 + StylePicker/Library/Detail 全适配新格式；**统一一份风格，非独立维护** |
| **Q2** | fm-design 步数 | 无参全量 = **三步**（plan→generate→self-review）；带描述修改 = **单步**（定位→生成→轻量自查，无 scope 确认门） |
| **Q3** | HTML 格式 | 单 artifact = **纯静态 `index.html`（HTML+CSS、无 JS）+ 每版本 `assets/` 资源文件夹**：**所有切图资源本地化**（HTML 不准引远程 URL），**栅格图按 `srcset` 多倍图**（以 master 降采样产 1x/2x/3x、**不上采样**、manifest 登记**实际 density 集**、不足标 `degraded`；SVG 单份），图片为**可抓取文件**（不用 data URL）；`supportingFiles` 为扁平路径索引（od v1 原字段）、`manifest.forma.assets` 为权威视图（**相对路径 + density + role，不存 URL**；assets 路径须 ⊆ supportingFiles）；URL 由 MCP/API **读时动态算**；变体靠 **page→N artifact**；查看见追加 scope 的两个画布 |
| **Q4** | 多 CLI | 重知识走 **MCP 即时下发**（单一来源）；命令模板 = **薄胶水手维护三份**（claude `.md` / codex `SKILL.md` / gemini `.toml`）；**暂不造 single-source 生成器**（修正：当前 `install.ts` 仅纯拷贝） |
| **质量门** | 达到 OpenDesign 质量 | craft/*.md **原样迁移** + **即时下发**保 salience + **强制 self-review** + **确定性 HTML lint**（机械规则）；与 OpenDesign 同一 AI 引擎，质量可达，机械规则上有机会更稳 |
| **Q5** | manifest schema | 新增字段**全部置于 forma 扩展命名空间 `manifest.forma.{...}`**（不碰 vendored od v1 顶层、规避其严格校验——已锁）：`brand_style`/`system_style`/`requirement_id`/`page_id`(分组键、可重复)/`variant`/`platform`/`language`/`provenance{model,source_skill_id,generated_at,prompt_digest}`/`quality.craft_checks`/`preview{status:ready\|failed,generated_at,error?}`（**冻结时一次性写定**；transient `pending` 在可变指针索引、不入 manifest）。**血缘**：修改/改风格 = 同 artifact 新 version（version 链即血缘，**不设 `parent_artifact_id`**）。**variant 规则**：design-page artifact **始终有 `variant`、默认 `default`、同 `page_id` 下唯一**（**旧数据读取兼容**：缺 variant 读时视为 `default`；补齐后 + 所有新 design-page 写入**必须**有 variant）。`requirement_id`/`page_id`/`variant` 仅 **design-page kind** 适用；**`component-library` kind**（原 `design-system` 改名）走 kind 专属 schema（无这三者），同样以静态 HTML bundle 存储 |
| **预览图** | HTML→PNG | **bundle 全量 puppeteer**（自带 Chromium，开箱即用、任意机器可渲染）；接受安装体积代价；离线安装处理 `PUPPETEER_SKIP_DOWNLOAD` + CI 缓存 |

## 追加 scope（评审期新增 · 2026-05-29）

| 项 | 决策 |
|---|---|
| **两个画布口子（共用外壳）** | 两个口子**都是无限画布**，共用同一外壳：**左 = 设计稿列表**（点击**定位/跳转**到画布上那张稿）/ **中 = 无限画布**（pan/zoom；**范围随入口**：**按需求入口**铺该需求**全部** artifact、**按页面入口**只铺该 page 的 artifact/variant；每个 **variant** 一张 tile）/ **右 = 标注信息栏**（**预留 slot**，内容将来接）。性能靠**区域/视口虚拟化**（只渲可见 tile、离屏卸载、增量挂载），不靠限量。(1) **设计画布**：tile 渲**纯静态 HTML 设计稿**（每 variant 一份）。(2) **标注画布**：tile 渲 **PNG**（后续接标注）。按需求 / 按页面两个进入维度。 |
| **共享 viewer 引擎** | `设计画布` + `标注画布` 共用外壳，做成**共享 React 包 `@xenonbyte/forma-viewer`** + 规范化数据契约；**web 与 desktop 都从数据直接渲染、不分叉**（各自注入资源解析器：web 走 HTTP、desktop 走 IPC）。**SUPERSEDES** 上次「桌面端主查看器 / web 轻管理」——改为引擎共享、两端同源。 |
| **设计稿客户端（desktop）外壳重做** | desktop 仍**视觉 + 交互全重做 + 自我 dogfood**（外壳走 craft + 选定 brand style 过同一套 lint），但查看主体改为**接入共享 viewer 包**。原因：现状 `packages/desktop` 全是内联 `#ccc` 裸样式、无设计系统，「太丑」；卖设计质量的产品自己客户端不能拉胯。 |
| **HTML 纯静态** | 设计稿 = HTML+CSS、**无 JS**（收紧自**早期评审**曾允许的「最小内联 JS」结论；当前 Q3 行已是无 JS）。好处：PNG 渲染确定、设计画布天然静态、lint 更简单；variant 切换本就靠独立 artifact，不需页面内 JS。 |
| **MCP 设计稿读取面优化（A–G）** | 面向开发者取数的 MCP 读取面整体优化：**A** `get_product_artifact` 返回 **served bundle URL + assets 清单（含 1x/2x/3x density 与各自 URL）**，让开发直接取 HTML 与图；**B** 读取面加 **page_id / variant / version 维度**（按页面查稿、列版本历史）；**C** **删除 6 个 Pencil 遗留 `session_*` 工具**；**D** 清理引用**已删 design-system 基线 artifact** 的描述；`kind` 枚举 **`design-system`→`component-library`**；**E** `generate_*` 描述随 save 语义反转更新；**F** `export_artifact` 的 html/svg 连带 `assets/`（或明确完整包用 zip）；**G** `help`/`develop_frontend` 补 artifact + asset 取数指引。 |

---

## 架构要点（实现期对照）

1. **知识在内、AI 在外**：craft 规则 + style token/components 是质量本体，必须由 forma 持有并经 MCP 下发；不内联进三平台模板。
2. **即时下发保 salience**：生成每页前经**读取面工具 `get_design_context`**现取 craft + style + 页面规格（recency 最高），而非开头一次性灌；**与 save 工具分离**——`get_design_context` 在生成**前**调，save 在生成**后**调（堵住「save 工具内『生成前即时取』」的时序漏洞）。
3. **生成语义反转**：`generate_*` / `change_artifact_style` 不再「调 runtime 生成」，而是「**接收 AI 已生成的 HTML → 校验 → 落盘为 versioned artifact → 触发预览渲染**」。`odRuntime`（`packages/core/src/od-runtime.ts` 的 `mainOdRuntime` stub）移除，`OD_RUNTIME_FAILED` 路径消失。
4. **cardinality**：`requirement → page → N artifact(各带 variant) → N version`（`page` 即需求模型的 page，其现有字段名为 `baseline_page`）。`page_id` 是分组键、可重复。需求模型（`requirement.ts`）无独立「弹窗/modal」类型——弹窗作为一个 page 条目建模；约定：独立成屏（含独立弹窗页）= 自己的 `page_id`，同屏瞬时状态/响应式变体 = 该 page 下的 `variant`。**术语统一**：UI 状态/响应式变体一律称 `variant`（**始终存在、默认 `default`、同 page 唯一**）；`design_status` 专指**生成生命周期**（pending/active/expired）。现 schema 每 page 一个 `design_status`；新模型把它**挂到 `(requirement_id,page_id,variant)` 当前指针上**（见 #12）——不在 page、也不在不可变快照里（Phase 1 细化）。
5. **预览与保存**：bundled puppeteer 下 save **同步渲染** preview，冻结时把 `manifest.forma.preview` **一次性写定** `ready`（成功）或 `failed`+error（渲染出错）——**绝不在已冻结 manifest 上做 pending→ready 变更**（违反不可变）。transient `pending`（渲染延后/环境缺失）只记在**可变指针索引**；要延后重渲一律**产新 version**、不改旧 manifest。
6. **质量可追溯**：self-review + HTML lint 结果写入 `manifest.forma.quality.craft_checks`，后台可展示「这张稿过了哪些规则」。
7. **自我 dogfood**：desktop 外壳遵循 craft + 选定 brand style，并过**同一套 craft lint**——该 lint 作用于**渲染后的 DOM/HTML**（见 P5），故 P9 把外壳渲染成 DOM/HTML 后即可跑同一套规则（CI 可执行），而非靠人眼。查看器即「好设计」的质量样板。
8. **共享 viewer 引擎**：`设计画布(静态 HTML)` + `标注画布(PNG)` 共用一套无限画布外壳（左 设计稿列表 / 中 画布 / 右 标注 slot），做成共享 React 包 `@xenonbyte/forma-viewer`，纯展示、数据驱动、注入资源解析器；web 与 desktop 同源消费、无分叉。**SUPERSEDES**「桌面端主查看器 / web 轻管理」（两端经同一引擎渲染，无主次之分）。
9. **设计稿纯静态 + 区域渲染**：artifact = HTML+CSS、无 JS。画布**一次性铺该需求所有稿**；性能靠**区域/视口虚拟化**——只挂载可见 tile 的 served-URL `<iframe src + sandbox>`（离屏卸载、增量挂载），故设计画布渲全量 HTML 也不卡。标注画布渲 PNG（更轻）。
10. **资源本地化（自包含 bundle）**：每个 artifact 版本 = `index.html` + 同版本 `assets/` 文件夹；所有切图资源本地化、无远程 URL；栅格图按 `srcset` 多倍图（master 降采样产 1x/2x/3x、不上采样、manifest 登记实际 density 集、不足标 `degraded`）、SVG 单份；图片为可抓取文件（非 data URL）。目的：① 将来转标注稿能直接拿图；② MCP 取数能拿资源；③ 离线可移植。资源**per-version 自包含**（rollback 安全；dedup 留作将来优化）。
11. **资源处理三定（已锁）**：① 降采样用 **`sharp`**；② 服务端**不对外 fetch**——AI 会话里把图以 data URL 内联交来，save 抽成本地文件 + `sharp` 降采样，HTML 含远程 URL 引用则**报错拒绝**（零 SSRF）；③ 设计画布用 **served-URL `iframe src` + `sandbox`**（forma server 静态服务 bundle，相对 assets 自然解析、无 JS），不用 srcdoc。
12. **版本指针 / 持久化模型（闭合）**：artifact 的每个 `v{n}` 是**不可变快照**（含其 bundle + manifest）。另有**可变的「当前版本指针」索引**：键 = `(requirement_id, page_id, variant)` → `{ artifact_id, version, design_status }`，存于 product/requirement 记录（扩展现有 `product.requirements[reqId]` 指针）。`rollback_requirement_design` **只改指针**指向某旧 version，旧 version 仍在盘、不删。`design_status` 是**指针记录的字段**（随指针、不随快照）。**修改/改风格 = 同 artifact 新 version**（version 链即血缘，无需 `parent_artifact_id`）。**唯一性**：每个 `(req,page,variant)` 仅一个当前指针。Phase 1 定结构与约束。

---

## 受影响文件（高层）

- `packages/core/src/` — manifest schema（含 assets 清单）、product config schema、artifact 存储（page→N、variant、version、**每版本 `assets/`**）、`styles.ts` 改造、新增 `preview-renderer`、**新增 asset 本地化/降采样管线**、新增 `quality/`（craft 清单 + html lint）、移除 `od-runtime.ts`、`install.ts`（`formaInstallCommands` 扩容）
- `packages/mcp/src/tools.ts` — 生成类工具语义反转、`get_style` 扩展、craft 下发、**artifact 取数暴露 assets/served URL**、**读取面优化 A–G**（含移除 6 个 `session_*` Pencil 遗留工具、清理 `design-system` 残留描述/枚举、`help` 指引补全）
- `packages/agent/templates/{shared,claude,codex,gemini}/` — fm-design / fm-refine-components / fm-change-style 重写为薄胶水；`packages/agent/src/index.ts`（`formaAgentCommands` 扩容）
- `packages/viewer/*` — **新建共享包 `@xenonbyte/forma-viewer`**：无限画布外壳（左 设计稿列表 / 中 画布 / 右 标注 slot）+ `设计画布`(静态 HTML) / `标注画布`(PNG) 两种 tile 渲染器 + 规范化数据契约 + 资源解析器注入；依赖 React Flow
- `packages/web/*` — 接入 `@xenonbyte/forma-viewer`（按需求 / 按页面两个视图入口）+ `StylePickerDialog`/`StyleLibrary`/`StyleDetail` 适配 + 产品/需求管理 + routes
- `packages/desktop/src/renderer/*` — 接入 `@xenonbyte/forma-viewer`（注入经本地 server 的资源 URL）+ 外壳（`SessionGate`/`ProductsHome`/`ProductView`/`ArtifactDetail`）重做 + 消费 brand `tokens.css` 的样式地基（dogfood）
- `packages/server/src/routes.ts` — 新增 artifact bundle 静态服务路由（供 viewer `iframe src`；desktop 经本地 server 代理复用同一 URL）
- 打包资源：bundled `craft/`、bundled `styles/`（152 brand + 17 stub）、LICENSE/归属
- `package.json` / 各包 deps — puppeteer、`@xyflow/react`（在 viewer 包）、`sharp`（降采样，已定）

---

## 分阶段计划

依赖图：`P1,P2` 可并行先行 → `P3` 依赖 P1 → `P4` 依赖 P1/P2/P3 → `P5` 依赖 P2/P4 → `P6` 依赖 P4/P5 → `P7`(共享 viewer 包) 依赖 P1/P3/P4 → `P8`(web 接入) 依赖 P7 + P2、`P9`(desktop 接入 + 外壳 dogfood) 依赖 P7 + P2 + P5（dogfood lint），P8/P9 可并行。

### Phase 1 — 数据 / Schema 地基
- **目标**：manifest v1 扩字段 + product config 拆 brand/system + page→N artifact / artifact→N version 模型落地 + **每版本 assets 存储布局**。
- **改动**：`packages/core/src/`（manifest schema、product config schema、artifact 存储与目录布局）+ tests。目录：`…/v{n}/index.html` + `…/v{n}/assets/<name>@{1,2,3}x.<ext>`（SVG 单份、无需多倍）+ `…/v{n}/preview/{1,2}x.png`；`manifest.forma.assets` 清单（每图 **相对路径 + density 集 + role，不存 URL**——URL 读时算），与 `supportingFiles`（扁平路径索引）的关系：**assets 路径须 ⊆ supportingFiles**，加一致性校验。新增 forma 字段**可选/加性**（旧 artifact 仍校验通过、读取兼容）。**当前版本指针索引**：键 `(requirement_id,page_id,variant)`→`{artifact_id,version,design_status}`，存 product/requirement 记录，**唯一性约束**；version 快照不可变（`design_status` 在指针、不在快照）。并新增**一次性补齐脚本**：扫描现有 artifact 回填新字段（`page_id` 由需求推、`variant` 默认 `default`、density 集由现有 preview 兜、`design_status` 落到当前指针、建当前指针），幂等可重跑。
- **应用决策**：Q5（全部新字段，含 `variant`、`quality.craft_checks`）、Q3（cardinality + 资源本地化）、架构要点 10（per-version 自包含）。
- **验收**：schema 校验通过；读写往返；同 `page_id` 多 artifact + 多 version 能正确存取与列举；**`variant` 始终存在（默认 `default`、同 page 唯一）被校验**；**当前版本指针唯一性 + rollback 改指针不删旧 version 被校验**；`manifest.forma.assets` ⊆ `supportingFiles` 一致性校验通过、能列某版本 assets（含 density 集）；**补齐脚本对现有 artifact 幂等回填、回填后与新生成的 artifact 校验一致**。

### Phase 2 — 内容迁移（craft + styles）
- **目标**：把 OpenDesign 的质量本体搬进来并成为唯一风格来源。
- **改动**：bundled `craft/*.md`（~11 文件，原样）；bundled `styles/`（152 brand × 3 文件 + 17 stub）；`packages/core/src/styles.ts` 改造（支持 DESIGN.md+tokens.css+components.html 新格式，替换硬编码 `styleVariablesSchema` 为 token 读取）；LICENSE/归属文件。
- **应用决策**：Q1（β 全量）、质量门（craft 原样）。与 DESIGN-v8 **背景清单第 3 条**一致：读 open-design 风格 token、不再自维护旧 schema。
- **验收**：`listStyles` 返回 152 brand + 17 stub；`getStyle` 返回三文件内容；后台与生成共用同一份；MIT/Apache 归属正确落地。

### Phase 3 — 预览渲染器 API（puppeteer bundled）
- **目标**：提供 HTML→PNG 的 renderer API（产出 `preview/1x.png` + `preview/2x.png`），**仅 API + 测试**；真正接 save 在 P4。
- **改动**：新增 `packages/core/src/preview-renderer.ts`（puppeteer，**从已落盘 bundle 的 dir/URL base 渲染**——`file://` 或 served URL 指向 bundle，使相对 `assets/` 能解析，**不裸 `setContent(html)`**；两次 `deviceScaleFactor:1/2` 截图）；`package.json` 加 puppeteer；离线/CI 文档（`PUPPETEER_SKIP_DOWNLOAD`、缓存）。**不在本阶段接 save 流程**（save 流程在 P4 定义）。
- **应用决策**：锁定决策「预览图」（bundle puppeteer）；解耦（失败 → `preview: pending`，不丢 HTML）。
- **验收**：给定一个 fixture bundle（`index.html` + `assets/`）产出 1x/2x PNG 且**相对 assets 被正确渲染**（验证不是裸 setContent）；渲染失败可抛错供上层降级；离线安装路径有说明。

### Phase 4 — 核心 / MCP：知识下发 + generate→save 语义反转 + 移除 odRuntime
- **目标**：让生成类工具以「保存 AI 生成稿」工作，知识经 MCP 即时下发。
- **改动**：移除 `od-runtime.ts`（`mainOdRuntime` stub）；`packages/mcp/src/tools.ts` 中 `generate_requirement_design` / `generate_components` / `change_artifact_style` 改语义（接收 HTML → **asset 本地化**（把内联 data-URL 图**抽成本地文件**、`sharp` 以 master 降采样产 1x/2x/3x（不上采样、不足存实际档位 + 标 `degraded`）、改写为本地 `srcset`；SVG 单份；**服务端不 fetch**，HTML 含远程 URL 引用直接**报错拒绝**）→ **校验（纯静态：拒绝 `<script>`、内联 `on*`、`javascript:` URL、外链脚本/样式；扫描 CSS `url()`/`@import`/`@font-face`、`srcset`/`<source>`/`poster`/`<link>` 等所有 URL 入口确保无远程引用；SVG 内 `<script>`/事件属性/外链 `href` 须 sanitize 或拒绝）** → 落 versioned artifact bundle + 写 `manifest.forma` 字段与 assets 清单（含实际 density 集））；**修改/改风格一律产同 artifact 新 version（不设 `parent_artifact_id`）**；**`generate_components`（`component-library` kind，原 design-system 改名）也走同一保存链路存为静态 HTML bundle，但 `requirement_id`/`page_id`/`variant` 不适用、走 kind 专属 schema**；**接预览渲染**（save 落 bundle 后，调 P3 renderer 从 bundle base 渲 `preview/{1,2}x.png`，**冻结时一次性写定 `manifest.forma.preview`=`ready`/`failed`+error**；渲染延后则 transient `pending` 入可变指针索引、重渲产新 version、不改旧 manifest）；**新增 server 静态服务 artifact bundle 路由**（供 `iframe src`）；`get_style` 扩展返回三文件；artifact 取数暴露 assets；**`change_artifact_style`/`generate_*` 的 style 入参拆 `brand_style`+`system_style`**；**调整 `rollback_requirement_design` 语义**：回退**某 page/variant 的版本指针**（非整需求快照、只改指针不删旧 version），入参带 `page_id`/`variant`/目标 version；**新增读取面工具 `get_design_context`**（生成**前**调用，返回 craft + style + 页面规格 + 适用 rules，与 save 工具分离）；更新 `shared/SKILL.md`（删除 `OD_RUNTIME_FAILED` 说明）。
- **MCP 读取面优化（A–G）**：**A** `get_product_artifact` 返回 served bundle URL + assets 清单（含 1x/2x/3x density；**各 URL 读时由 server/MCP 算，manifest 只存相对路径**）；**B** `list_product_artifacts`/查询加 `page_id`+`variant` 分组、新增列 artifact 版本历史；**C** 移除 6 个 `session_*`（连带 `formaToolNames`/schemas/descriptions/`createFormaTools`/`V6ServiceOverrides` 清理）；**D** 清理 `get_baseline_page`/`get_baseline_image`/`get_style` 描述里对**已删 design-system 基线 artifact** 的引用；`kind` 枚举 **`design-system`→`component-library`**（component-library = `generate_components` 产物的 kind）；**E** `generate_*` 描述去掉 `OD_RUNTIME_FAILED`、改 save 语义；**F** `export_artifact` 的 html/svg 连带 `assets/`（或文档明确完整包用 zip）；**G** `help`/`develop_frontend` 补 artifact + asset 取数指引。
- **应用决策**：Q4（知识走 MCP）、Q3（HTML 格式 + 资源本地化）、Q5（落字段）、架构要点 3/10/11；追加 scope「MCP 读取面优化 A–G」。
- **验收**：工具以保存语义工作；保存后 HTML **无远程引用（含 CSS `url()`/`@import`/`@font-face`、`srcset`/`source`/`poster`/`link`）、无 `<script>`/内联事件/`javascript:`/外链脚本、SVG 无脚本/事件/外链**（纯静态校验生效）、`assets/` 含本地图、栅格图按实际 density 集（优先 1x/2x/3x、不足标 `degraded`、绝不上采样）、HTML 用本地 `srcset`；**`get_design_context` 在生成前可取 craft+style+规格**；`get_style` 返回新格式；**开发者经 MCP 能拿到 served bundle URL + 各 asset URL（读时算）/density、能按 page/variant 查稿、能列版本历史**；`session_*` 已移除、工具列表无 Pencil 残留；`kind` 枚举为 `component-library`、**无 `kind: design-system`、无用户可见旧描述/枚举残留**；html 导出带 assets；仓库中不再有 `OD_RUNTIME_FAILED` stub 路径；相关测试更新。

### Phase 5 — 质量门
- **目标**：把「达到 OpenDesign 质量」做成可执行检查。
- **改动**：新增 `packages/core/src/quality/`——self-review 清单（craft 可核对项）+ 确定性 **craft lint**：**作用于「渲染后的 DOM/HTML」**（输入 = 渲染产出的 DOM/HTML，而非源文件），故同一套规则可复用于 ① artifact ② desktop 外壳（见 P9）。机械规则：每屏 `--accent` 可见使用 ≤ N、对比度 ≥ 4.5:1、字号取 type scale 集合、token 遵循。artifact save 时跑并写 `manifest.forma.quality.craft_checks`。
- **应用决策**：质量门、Q5（`quality.craft_checks`）、架构要点 7（lint DOM 级、可复用于 dogfood）。
- **验收**：lint 能判机械规则并报告违规；**lint 可独立作用于任意渲染 DOM/HTML（为 P9 dogfood 复用打基础）**；`manifest.forma.quality.craft_checks` 正确落盘。（「fm-design 强制 self-review」的验收归 **P6**。）

### Phase 6 — 技能模板重写（fm-* 薄胶水，三平台）
- **目标**：fm-design / fm-refine-components / fm-change-style 重写为薄胶水，编排 MCP + 遵循下发知识 + 强制 self-review。
- **改动**：`packages/agent/templates/{shared,claude,codex,gemini}/` 三平台手维护；`fm-design` 内置 Q2 的三步/单步分叉、入参用 `brand_style`+`system_style`、**规定调用顺序：`get_design_context`（取 craft+style+规格）→ AI 生成 → save 工具**，并**强制 self-review**（对照 craft 清单/lint，违规重生成）；`fm-change-style` 同步拆 style 入参；`fm-rollback-design` 模板适配新 rollback 语义（page/variant 版本指针）；`formaInstallCommands`（`install.ts`）与 `formaAgentCommands`（`agent/src/index.ts`）扩容纳入设计类命令。
- **应用决策**：Q2（步数）、Q4（薄胶水 + 暂不造生成器）、质量门（强制 self-review）、架构要点 2（先 `get_design_context` 后 save）。
- **依赖**：P4（save/读取面工具）、**P5（self-review 用的 craft lint）**。
- **验收**：三平台安装产出对应文件；模板薄、重知识不内联、显式调 MCP；**fm-design 强制 self-review 且调用顺序正确（先 `get_design_context` 后 save）**；install/agent 命令清单覆盖新命令；模板测试更新。

### Phase 7 — 共享 viewer 包（`@xenonbyte/forma-viewer`）
- **目标**：一个数据驱动、纯展示的共享 React 包，承载两个画布口子（共用外壳），供 web/desktop 同源消费、不分叉。
- **改动**：新建 `packages/viewer`：
  - **数据契约**：`requirement → page → artifact(variant, version)` + 资源句柄（`previewUrl 1x/2x`、`htmlRef`）的规范化 view-model；这是 web/desktop 唯一耦合点。
  - **无限画布外壳**（React Flow `@xyflow/react`）：**左 = 设计稿列表**（按 page→variant 列；点击**定位/跳转**画布到那张 tile）、**中 = 画布**（pan/zoom，本地态不落盘；**范围随入口**：需求入口铺全需求、页面入口只铺该 page 的 variant）、**右 = 标注信息栏**（**预留 slot**，本期不实现内容）。**区域渲染**：用 React Flow `onlyRenderVisibleElements`（执行期 Context7 核对）只渲视口内 tile、离屏卸载、增量挂载。
  - **两种 tile 渲染器**：`设计画布` = **`<iframe src=<served-URL> sandbox>`**（指向 forma server 静态服务的 artifact bundle，相对 `assets/` 自然解析；`sandbox` 不给 `allow-scripts` → 静态无 JS；仅可见时挂载）；`标注画布` = `<img>` 渲 PNG（LOD `1x→2x`）。外壳一套，只换渲染器。
  - **资源解析器注入**：组件不直接取数；由宿主注入 artifact bundle 的 **served base URL** 与 PNG URL（web=forma server HTTP；desktop=经本地 forma server 代理同一 URL）；相对 assets 由该 URL 自然解析。
- **应用决策**：两个画布口子（共用外壳）；共享 viewer 引擎；HTML 纯静态 + 区域渲染（视口虚拟化）；画布库 React Flow；右侧标注 slot 仅预留。
- **依赖**：P1（schema）/ P3（PNG 作 tile）/ P4（artifact/HTML/style 读取）。
- **验收**：给定 view-model + 资源解析器，画布一次铺全部稿；设计画布渲静态 HTML（`sandbox` 禁脚本）、标注画布渲 PNG；**区域虚拟化**只挂载可见 tile 的 iframe（离屏卸载）；左列表点选能定位到对应 tile；右标注 slot 存在但为空占位；组件可测（React Flow 依赖 DOM 量测，jsdom 不足 → P7 定测试策略：vitest 浏览器模式或 mock）。

### Phase 8 — Web 接入 + 后台管理
- **目标**：web 后台接入共享 viewer（按需求 / 按页面两个入口）+ 风格/产品/需求管理。
- **改动**：`packages/web` 接入 `@xenonbyte/forma-viewer` + HTTP 资源解析器；`StylePickerDialog`/`StyleLibrary`/`StyleDetail` 适配（DESIGN.md + tokens + `components.html` iframe 预览）；ProductNew 改 `brand_style`+`system_style`+平台+语言；需求/页面两维度入口；routes。
- **应用决策**：两个查看口子；共享 viewer 引擎；Q1（UI 适配 + 后台风格展示）、Q5（字段读取）。
- **验收**：按需求 / 按页面都能打开设计画布 + 标注画布；双风格选择写入 config；后台风格页 + 弹窗可用；viewer 复用自共享包、未重写。

### Phase 9 — 桌面端接入 + 外壳 dogfood 重做
- **目标**：desktop 接入共享 viewer + 外壳视觉/交互全重做 + 自我 dogfood，纯只读。
- **改动**：
  - 接入 `@xenonbyte/forma-viewer` + **IPC 资源解析器**（经只读 preload bridge）。
  - **外壳重做**：`SessionGate` / `ProductsHome` / `ProductView` / `ArtifactDetail` 用选定 brand `tokens.css` + craft 规则建立样式体系，替换内联 `#ccc` 裸样式；英文占位改中文；按需求 / 按页面两入口。
  - **dogfood 可执行检查**：把外壳**渲染成 DOM/HTML 后跑 P5 的 DOM-level craft lint**（CI 可执行），而非人眼审。
  - **只读约束不变**（DESIGN-v8）：无编辑入口，mutation 仅经 fm-* MCP；仅交付 `pnpm desktop:dev`。
- **应用决策**：共享 viewer 引擎；dogfood=外壳渲染产物过 P5 的 DOM-level craft lint；重做深度=视觉+交互全重做。
- **依赖**：P7、**P2（brand tokens.css）**、P5（craft lint）。
- **验收**：两视图经共享包可用；外壳渲染成 DOM/HTML 后**跑同一套 craft lint 通过**（CI 可执行）；仍纯只读；中文文案；`pnpm desktop:dev` 可跑。
- **执行期注**：外壳具体视觉方向（配色/明暗/密度/选哪个 brand style）用 `design` 技能 + `superpowers:brainstorming` 在动手时定，不在规划期拍死。

---

## 风险与开放项

- **安装体积（已接受）**：bundled puppeteer 拉 ~150MB+ Chromium。需在 README/CI 说明 `PUPPETEER_SKIP_DOWNLOAD`、缓存、air-gapped 安装路径。
- **质量 salience 风险（已兜底）**：MCP 下发的 craft 比 system prompt salience 略低；靠即时下发 + 强制 self-review + 确定性 lint 补平。
- **许可与归属**：craft（Apache 2.0）、styles（MIT，源 `bergside/awesome-design-skills`）必须随包保留 LICENSE 与归属；迁移时记录上游 commit SHA（与 DESIGN-v8 vendored 冻结一致）。
- **lint 阈值标定**：机械规则的具体阈值（如 `--accent` 上限、type scale 集合）需在 Phase 5 依据 craft 原文标定，不得拍脑袋。
- **暂不做**：single-source→三格式模板生成器（仅当薄胶水长胖再评估）；不引入 daemon / od-sidecar / open-design 桌面端（DESIGN-v8 非目标，继续遵守）。
- **画布库（已采用）**：**React Flow `@xyflow/react`**（节点+连线+pan/zoom+minimap+原生只读，MIT），位于共享 viewer 包。用户已批准（「合理即用」）；执行期 Context7 核对 API + 复核 license。备选 tldraw（更重）/ 自写已弃。
- **画布渲染策略（区域虚拟化）**：两个口子都是无限画布、共用外壳，**一次性铺该需求所有稿**。性能靠**区域/视口虚拟化**——React Flow `onlyRenderVisibleElements`（执行期 Context7 核对）只渲视口内 tile、离屏卸载、增量挂载；设计画布的 served-URL `<iframe src + sandbox>` 仅可见时挂载。左列表点选 = 定位/跳转到对应 tile（不是切换单张）。上次「选中只渲一张」「聚焦切 iframe + 并发上限」均**作废**。PNG 与 HTML 同按 version 绑定。HTML 全量 tile 的虚拟化效果需在 P7 用较多稿量压测。
- **共享数据契约（新增耦合点）**：`@xenonbyte/forma-viewer` 的 view-model 契约是 web(HTTP)/desktop(IPC) 唯一耦合点；契约变更需同步两端 + 测试，避免重新分叉。
- **新增 workspace 包**：`packages/viewer` 是合理的去重手段（两个 React 宿主共用），符合 repo 既有 `@xenonbyte/forma-*` 包约定；非投机抽象。
- **状态粒度迁移**：`design_status` 从「按 page」改「按 artifact」是 schema 行为变更，Phase 1 需红/绿测试覆盖。
- **现有 v8 artifact 兼容（已定：补齐脚本）**：新字段可选/加性（旧 artifact 仍校验通过、读时缺 `variant` 视为 `default`）+ **一次性补齐脚本**幂等回填（`page_id` 推、`variant` 默认 `default`、density 兜、`design_status` 落当前指针、建指针）。Phase 1 落脚本 + 验收幂等性。
- **rollback 语义（已定）**：`rollback_requirement_design` 回退**某 page/variant 的版本指针**（非整需求快照），入参带 `page_id`/`variant`/目标 version；Phase 4 改语义、Phase 6 同步 fm-rollback-design 模板。
- **style 入参拆分（已定）**：`change_artifact_style` 与 `generate_*` 的 style 入参拆 `brand_style`+`system_style`，P4 落、P6 模板同步。
- **降采样库（已定 `sharp`）+ density 规则**：sharp 原生 libvips，主流平台预编译，质量/速度优于 jimp。density：以 master 降采样产 1x/2x/3x、**不上采样**；master 不足三档时存实际可得档位并在 manifest 标 `degraded`；manifest 始终登记**实际 density 集**。（消除「必须三档」与「存一档」的旧冲突。）
- **图源策略（已定：服务端零 fetch）**：artifact 必须自包含——AI 会话内联 data URL 交来，save 抽成本地文件 + `sharp` 降采样；HTML 含远程 URL 引用即**报错拒绝**。无 SSRF 面、fail loud。（要拉远程图，在 AI 会话里拉、内联交来。）
- **HTML 渲染（已定：served-URL iframe）**：forma server 静态服务 artifact bundle，`<iframe src + sandbox>`（无 `allow-scripts`）渲染——相对 assets 自然解析、静态无 JS；不用 srcdoc。desktop 经本地 server 代理复用同一 URL。
- **per-version 资源存储增长**：资源 per-version 自包含会随版本增多占空间；content-hash dedup 留作将来优化，本期不做。
- **assets 与 supportingFiles 双源一致性**：`supportingFiles`=扁平路径索引（od v1 原字段）、`manifest.forma.assets`=带 density/URL/role 的权威视图；约束 **assets 路径 ⊆ supportingFiles**，save 时校验、不一致即报错，避免双源漂移。
- **纯静态校验（save 期）**：拒绝 `<script>`、内联 `on*`、`javascript:` URL、外链脚本/样式；**扫描 CSS `url()`/`@import`/`@font-face`、`srcset`/`<source>`/`poster`/`<link>` 等所有 URL 入口**确保无远程引用；**SVG 内 `<script>`/事件属性/外链 `href`** 须 sanitize 或拒绝；否则 save 报错。保证「无 JS + 资源本地化」可执行、非口头约定。
- **标注设计稿（不在本规划范围，仅留解耦口）**：将来用 HTML 解析库把设计稿转「标注设计稿」是**另立需求**，门槛=HTML 生成质量稳定后再接。本规划只保证**零耦合改造**：① 无限画布的 tile 图源走资源解析器边界（PNG 来自原始截图还是将来的标注渲染，对画布透明）；② artifact 的**原始单文件 HTML 完整保留**，供将来解析库直接消费，无需重生成。现在**不实现、不引解析库、不在 schema 里预埋标注字段**。

## 整体 Definition of Done

9 个 Phase 全部验收；`pnpm test` / `pnpm typecheck` 全绿；用真实需求跑通 `fm-design` 全量三步与单步修改，产出**纯静态 HTML**（无 JS：无 `<script>`/内联事件/`javascript:`/外链脚本，CSS/SVG 亦无远程引用与脚本）稿过 self-review + lint、预览图正确生成、**所有切图资源本地化（栅格图尽量 1x/2x/3x，不足不上采样、登记实际 density 并标 `degraded`；无远程引用）且 MCP 可取（URL 读时算）**；共享 `@xenonbyte/forma-viewer` 的 **设计画布(静态 HTML) + 标注画布(PNG)** 两个画布（共用外壳：左列表 / 中画布 / 右标注 slot）在 web 与 desktop **同源可用**（按需求 / 按页面入口），画布一次铺全部稿 + 区域虚拟化、左列表定位跳转、右标注 slot 预留；desktop 外壳 dogfood 重做完成、过同一套 craft lint、仍纯只读、中文文案、`pnpm desktop:dev` 可跑；web 后台管理 + 风格展示可用；许可归属落地；DESIGN-v8 非目标（不引 daemon / od-sidecar / open-design 桌面端、桌面端无编辑入口）未被违反。
