# 设计稿切图导出 + 开发 agent 定稿访问控制 Design

> **状态:** 设计已定稿(8 轮 `/think` 收敛),待批准实现。本文件是实现契约 + 后续加需求的基础。
> **日期:** 2026-06-01
> **前置阅读:** `docs/superpowers/plans/2026-05-31-p7-viewer.md`(viewer 通道)、仓库根 `CLAUDE.md`(架构/store/不可变版本)。

---

## Goal

给 Forma 增加**设计稿切图资源**能力,并约束**开发 agent 只能消费已定稿(归档)的设计稿**:

1. 需求**归档时**,同步把该需求所有页面设计稿里的内联图标(`<svg>`)切成 **SVG + PNG@{1,2,3}x** 资源落盘(切图全部成功才提交归档状态)。
2. 开发 agent 经一条带"定稿 gate"的新 MCP 通道 `get_design_handoff` 消费;后台管理(web)、设计稿客户端(desktop/viewer)走 HTTP 不受限。

## Background / Problem

- Forma 设计稿是 **pure-static HTML**;图标用**内联 `<svg>`**(矢量,`currentColor` 跟随文字色)表达,不是位图。
- 现状**没有任何切图产物**:`localizeArtifactAssets`(`packages/core/src/artifact-asset-pipeline.ts:448`)只抽取 HTML 里的 `data:` 内联位图,内联 `<svg>` 元素留在 HTML 里、不成文件。实测一个 design-page artifact 的 `supportingFiles` 只有 `index.html` + `preview/{1x,2x}.png`,`forma.assets: []`。
- 痛点:**开发还原设计稿时拿不到独立图标资源**——Web 端可读 HTML 内联 SVG,但移动端原生(Android/iOS)需要 PNG/独立矢量文件。
- 约束:设计稿**未定稿时不应被开发 agent 获取**(设计还会变);定稿信号 = 需求**归档**。

## Scope / Non-scope

**做(In scope)**
- 内联 `<svg>` → `SVG + PNG@{1,2,3}x` + 清单的切图提取(纯函数)。
- 归档时同步触发切图(两阶段事务:切图全成功才提交 `archived`)。
- 开发消费通道 `get_design_handoff`(archived gate)。
- 可选手动入口 `export_artifact(format="icons")`。
- 开发/设计两套 agent 模板(软隔离)。

**不做(Non-scope)**
保存期切图 / 改 `index.html` / 改动 `v{n}` 版本目录不可变性 / 改 manifest schema / 平台特定打包(VectorDrawable、iOS `.xcassets`、Android density 桶) / 异步任务队列(UX 选同步) / 解档(unarchive)路径 / best-effort 吞错 / MCP 运行时硬隔离 profile / 切图 stale 检测 / **元素级坐标标注(归入未来 P4)** / 引入新依赖。

> **R1 追加后更正(2026-06-02):** 上面 Non-scope 中「**元素级坐标标注(归入未来 P4)**」与「**引入新依赖**」两项已被文末「**追加需求 R1**」推翻——R1 以 **vendor(fork)`vzi-core`** 的方式,在归档时采集元素级坐标/大小/文本/层级标注。

---

## 关键决策(固化总表)

| 维度 | 最终决策 | 理由 |
|---|---|---|
| **切图内容** | 内联 `<svg>` → `<name>.svg`(保留 `currentColor`) + `<name>@{1,2,3}x.png`(sharp · **透明底** · **不注前景色** · `contentHash` 去重 · 密度可配) + `icons.json` | SVG 矢量保真;PNG 服务移动端;透明底可在任意背景复用 |
| **时机** | 需求**归档时**同步触发(非保存期) | 归档=定稿交付点;`active` 硬条件保证全页设计稿 `done`、输入稳定;`archived` 终态→切图永不 stale |
| **事务性** | 两阶段:① 锁外切图全成功(清旧+tmp+原子 rename)② 锁内提交 `archived`;任一页失败→**整体抛错、状态留 `active`、可重试** | 把中断后果导向安全侧("`active`+多余切图"可恢复,消灭"`archived`+无切图") |
| **UX** | 同步等待(loading 到完成) | 小需求秒级可接受;大需求规模后再考虑异步 |
| **落盘** | ~~`…/artifacts/<artifactId>/icons/v{n}/`~~ **→ R1 改 page 级 `…/<artifactId>/icons/`**(归档只转每页最终版本,一页一份;源版本入 icons.json `version`);**本文余下所有 `icons/v{n}/` 同此读作 page 级 `icons/`**,见 §R1.1 | `icons/` 兄弟目录,绕版本不可变约束 |
| **每次归档** | 对每个 artifact **清旧 `icons/v{n}/` + 整套重生成**(tmp+原子 rename) | 幂等、无半套残留(重试场景) |
| **通道隔离** | web/desktop/viewer 走 HTTP 不受限;开发 agent 走 MCP,**软隔离**(设计/开发两套模板) | MCP 与 HTTP 本就是两套独立入口,gate 加 MCP 侧不阻塞 HTTP 客户端 |
| **访问 gate** | 开发通道 `get_design_handoff` 校验 `status==="archived"`,否则 `REQUIREMENT_NOT_FINALIZED` | 未定稿不给开发 agent;切图天然只在归档后存在 |
| **handoff 数据** | 每页 `{pageId, artifactId, version, indexHtmlPath, icons[]}` + 需求/规则上下文;~~**不含元素坐标标注**~~(**R1 推翻**:经 `.vzi` 提供元素 bounds/文本/tokens,见文末 R1) | 元素类型/层级/文字靠 HTML 源码自带;Web 还原最佳路径是复用 HTML+CSS,坐标对 HTML 还原价值低 |
| **手动入口** | `export_artifact(format="icons")` 取某版切图(可选,非失败兜底) | 失败靠重试归档;手动入口用于预览/单 artifact 重导 |

---

## 架构 & 数据流

### 通道隔离(谁走哪)

```
后台管理(web)   ─┐
设计稿客户端      ├─► HTTP server(Fastify)  →  可访问未定稿(创作/预览), 不受限
(desktop+viewer) ┘     /api/products/.../artifacts/.../bundle | /preview

设计 agent  ──► MCP 创作通道(不 gate): get_product_artifact / export_artifact /
                 get_design_context / change_artifact_style   (生成·自检·改样式需访问未归档, 不动)

开发 agent  ──► MCP 开发通道(archived gate): get_design_handoff(product_id, requirement_id)
```

- **MCP(stdio)与 HTTP(Fastify)是两套独立入口**,只共享同一 core store。证据:web=`FormaApiClient`→`/api/...`(`packages/web/src/api.ts`);desktop=`getJson('/api/...')`、bundle 走 `${base}/api/products/.../bundle/index.html`(`packages/desktop/src/renderer/viewer/resolver.ts:13`);viewer 是纯渲染库不自取数;agent=MCP 工具(`packages/mcp/src/tools.ts:258`)。
- MCP 工具清单里**没有 archive 工具**,归档只在 HTTP(`routes.ts:292`)——归档是后台管理动作,开发 agent 只消费、不归档。

### 归档触发(两阶段事务,状态提交是最后一步)

```
后台点击「归档」(仅 active 可点, ProductDetail.tsx:260)
   │ PUT /api/products/:id/requirements/:reqId/archive  (server/routes.ts:292)
   ▼
预检: 需求必须 active (非 active 快速拒)
   ▼
【阶段1 · 切图 · 锁外 · 必须全部成功】
   listDesignPointers(productId).filter(p => p.requirementId === reqId)   每页 (pageId, artifactId, version)
     └─ 读 v{n}/index.html → extractIconAssets
        → 写 tmpDir → 原子 rename 覆盖 <artifactId>/icons/v{n}/  (先清旧)
   任一页失败 → 抛错 → 不进入阶段2 → 状态仍 active → 前端报错可重试
   ▼ 全部切图落盘成功
【阶段2 · 状态提交 · 锁内】
   store.requirements.archiveRequirement(reqId)
     └ 复用现有 archiveRequirementLocked: 锁内重校验 status==="active" → 写 archived (并发保护)
   ▼
返回 { requirement(archived), icons:{ pages, totalIcons } }
```

> **R1 扩展:** 阶段1 实际为 **切图 → vzi**(切图先产文件,vzi 资源引用指向切图;见 §R1.3),响应含 `vzi:{ pages, totalElements }`。

---

## 详细设计

### 1. 切图提取(纯函数)

新建 `packages/core/src/artifact-icon-extraction.ts`:

```
extractIconAssets(html: string, opts?: { densities?: number[] }) → {
  files: Map<string, Buffer>,   // icons/<name>.svg, icons/<name>@{1,2,3}x.png
  manifest: IconManifest        // 写成 icons.json
}
```

- 用 `node-html-parser` 解析(与 `artifact-asset-pipeline.ts` 一致),`querySelectorAll('svg')` 取所有内联 `<svg>`。
- 每个 SVG:
  - **SVG 文件** `icons/<name>.svg`:序列化该 `<svg>` outerHTML,**保留 `currentColor`**。
  - **PNG** `icons/<name>@{1,2,3}x.png`:`sharp(Buffer.from(svgString))` 栅格化(sharp 原生支持 SVG 输入,SVG→PNG;Context7 `/lovell/sharp` 确认)。**透明背景**(不调用 `flatten`)、**不注前景色**(`currentColor` 脱离上下文按默认渲染为黑,清单标 `usesCurrentColor`)。基准像素尺寸取 SVG `width/height` 属性,缺失则用 `viewBox` 宽高;`@2x/@3x` 按倍数 `resize`。
  - **去重**:按 SVG 内容 `contentHash`(复用 `artifact-asset-pipeline.ts:71` 的 sha256.slice(0,16))命名/去重。
- 命名:`aria-label`(自身/父级)优先→ `icon-<序号>-<宽x高>`。
- `icons.json` 每项:`{ name, size:{w,h}, usesCurrentColor, files:{ svg, png:{1x,2x,3x} } }` + 顶层 `{ artifactId, version, generatedFrom:"requirement-archive"|"manual-export" }`。
- **静态安全**:产出的 `*.svg` 会过 `scanSvg`(`packages/core/src/artifact-static-validation.ts:201`,禁 `<script>`/`on*`/remote/data href)——干净图标 SVG 不会失败;PNG 是二进制不参与静态校验。

### 2. 归档编排(锁外切图 + 锁内提交)

新建 `packages/core/src/requirement-icon-export.ts`(窄依赖,仿 `design-save.ts` 的 `SaveDesignDeps` 模式避免循环依赖):

```
exportRequirementIcons(deps, { productId, requirementId }) → { pages:[{pageId, count}], totalIcons }
```

- 遍历 `listDesignPointers(productId)`(`packages/core/src/product.ts:240`,`DesignPointer` 含 `requirementId/pageId/variant/artifactId/version`,`product.ts:29`)过滤本需求。
- 每 artifact:读 `getArtifactVersionDir(...)/index.html` → `extractIconAssets` → 写 `<artifactBase>/icons/v{n}/.tmp-xxxx/` → `rm -rf icons/v{n}/`(清旧) → 原子 `rename` 到 `icons/v{n}/`(参照 `artifact-store.ts:303-315` 的 tmp+rename 模式)。
- **任一页失败即整体抛错**(不 best-effort 吞错),让上层不提交归档。
- 落盘位置在 `v{n}` 兄弟目录(`icons/v{n}/`),不触发 `writeArtifactVersion` 的 `ARTIFACT_ALREADY_EXISTS`(`artifact-store.ts:298`,只检查 `v{n}` 本身),`listArtifactVersions` 的 `^v\d+$` 正则不会误判 `icons`(`artifact-store.ts:357`)。

**接入点**:`packages/server/src/routes.ts:292` 的 archive 路由——先预检 active → `exportRequirementIcons`(锁外) → 成功后 `store.requirements.archiveRequirement(reqId)`(锁内,`requirement.ts:354`,内部 `archiveRequirementLocked` 的 `status!=="active"` 校验天然兼作并发保护,`requirement.ts:363`)。**不改 core 归档逻辑**,只在调用前插切图。

### 3. 开发消费通道 `get_design_handoff`

`packages/mcp/src/tools.ts` 新增工具(注册表 `tools.ts:258`、descriptions `:281`、handler map `:309`):

```
get_design_handoff(product_id, requirement_id) →
  // gate: 需求 status 必须 "archived", 否则 throw FormaError("REQUIREMENT_NOT_FINALIZED", ...)
  {
    requirement: { id, title, status:"archived" },
    pages: [{
      pageId, artifactId, version,
      indexHtmlPath,                              // 同机本地路径(MCP stdio 同机), agent 直接读 HTML
      icons: [{ name, svgPath, pngPaths:{1x,2x,3x}, usesCurrentColor }]
    }],
    rules, copy                                   // 复用 get_product_rules / get_page_copy 上下文
  }
```

> **R1 更新:** 此为主方案初版返回;**最终结构以 §R1.4 为准**——每页加 `vziPath`;切图↔vzi 关联改为 **vzi 元素资源 ref 正指切图产物**(见 §R1.5),不在 icon 侧反指;开发工具改为 **3+1 套、去 `product_id`**(`get_design_handoff`/`get_page_ui`/`get_ui_node`/可选 `search_page_ui`)。

- **现有 `get_product_artifact`(`tools.ts:542`)/`export_artifact`(`:616`)/`get_design_context`(`:214/306`)不动**——它们属设计创作通道,需访问未归档(自检/改样式)。
- 元素类型/层级/文字 = `indexHtmlPath` 的 HTML 源码自带;~~**不含坐标标注**(见 P4)~~ **→ R1 已推翻:坐标/大小/文本/层级经 `.vzi` 提供,最终 handoff 结构见 §R1.4。**

### 4. 手动入口 `export_artifact(format="icons")`

- `exportArtifactSchema.format` enum 加 `"icons"`(`tools.ts:175`);`exportArtifact`(`:616`)加分支:按 current/pointer version 读 `index.html` → `extractIconAssets` → 落盘(可写 `exports/<product>/<artifactId>/v{n}/icons/` 或返回 `icons/v{n}/` 路径)。
- 契约 `ArtifactExportKind` 加 `'icons'`(`packages/od-contracts/src/api/artifacts.ts:25`)。
- 定位:随时取某版切图/单 artifact 重导,**非失败兜底**(归档失败靠重试)。

---

## 分阶段实施(建议 P1 → P2 → P3)

> **R1 合并后排序:** 本节已与 R1 合并,实际实施总排序见 **§R1.6「总实施排序」**——P2 与 R1 的归档采集合并为一次改 `routes.ts:292`,不独立两轮。

### P1 — 切图核心(core,可纯单测验证)
- [ ] `packages/core/src/artifact-icon-extraction.ts`:`extractIconAssets`(提取 + sharp 栅格化 + 清单 + 去重 + 密度可配)。
- [ ] `packages/core/src/requirement-icon-export.ts`:`exportRequirementIcons`(遍历 design pointers、清旧 + tmp + 原子 rename、单页失败整体抛错)。
- [ ] 单测 `packages/core/tests/artifact-icon-extraction.test.ts`:透明底 / `currentColor→黑` / `contentHash` 去重 / 密度档 / 命名。
- [ ] 单测 `packages/core/tests/requirement-icon-export.test.ts`:多页遍历 / 单页失败整体抛错 / tmp+rename 原子替换 / 清旧重建幂等。

### P2 — 归档触发(server)
- [ ] `packages/server/src/routes.ts:292` archive 路由改两阶段:预检 active → `exportRequirementIcons`(锁外,全成功否则抛) → `archiveRequirement`(锁内) → 切图结果并入响应。
- [ ] web 归档反馈:复用 `archiving` state(`packages/web/src/pages/ProductDetail.tsx:65`),失败显示可重试错误,成功 toast 带"N 张 / M 页"。
- [ ] 集成测试:active 归档 → 切图全成功**才**变 `archived` 且各页 `icons/v{n}/` 完整;注入一页失败 → 仍 `active`、无半套残留、可重试;重试 → 清旧重切成功。

### P3 — 开发通道(mcp + od-contracts + agent)
- [ ] `get_design_handoff`(archived gate)+ schema + description + handler。
- [ ] `export_artifact` 加 `format="icons"`;`ArtifactExportKind += 'icons'`。
- [ ] 新增"开发消费" agent 模板(`packages/agent/templates/claude/` 先行,codex/gemini 后续),引导 `get_design_handoff`;扩展 `help` 的 `workflows.develop_frontend`(`tools.ts:322`)。
- [ ] mcp 测试:未归档调 `get_design_handoff` → 拒 `REQUIREMENT_NOT_FINALIZED`;归档后 → 返回各页 `indexHtmlPath` + `icons`;`get_product_artifact` 对未归档仍可读(不受 gate 影响)。

---

## 风险与回滚

- **最脆弱假设**:归档时全页设计稿 `done` 且稳定 → 由 `active` 硬条件强制成立(`resolveRequirementStatus`,`requirement.ts:775`:任一页 `pending/expired` 则停在 `submitted`),稳固。
- **原子性极限**:非数据库事务——阶段2写状态瞬间崩溃 → `active`+完整切图(安全、可重试)。残留 tmp 目录在下次归档/启动时清理。
- **软隔离边界**:gate 是工具内状态校验;隔离靠"开发 agent 只装开发模板"的**部署约定**,非运行时强鉴权。不可信开发 agent 仍能调未 gate 的 `get_product_artifact` 绕过——需硬隔离时见未来扩展。
- **Rollback**:纯增量副产物。按 P3 → P2 → P1 倒序移除(工具/模板 → 路由编排 → core 文件),归档行为还原、存量数据零影响。

---

## 未来扩展(已讨论,本期不做)

- **P4 · 元素级坐标标注 — ⚠️ 已由文末「追加需求 R1」取代**(改 vendor `vzi-core`,**不再自研**扩展 `RenderedDomSnapshot`)。以下为原自研设想,仅留档:扩展渲染快照——现状 `RenderedDomSnapshot`(`packages/core/src/quality/rendered-dom.ts:35`)**只采含文字的元素、记 `tag/text/font/color`、无坐标、不持久化**(仅喂 craft-lint)。原 P4 设想:记录全元素 `getBoundingClientRect` + 类型 + 关键样式、归档时持久化、`get_design_handoff` 返回。
- **CLI `forma export-icons <product> <artifact>`**:CLI 与 server/mcp 共享 `createFormaStore`(`packages/cli/src/index.ts`,现仅 `serve/mcp/install/status` 等),可直接调 core 切图函数,适合脚本化/CI。现状 CLI 无任何内容操作命令,属"扩展 CLI 职责"决策。
- **MCP 硬隔离 profile**:`forma mcp --profile=dev` 启动时只注册带 gate 的开发消费工具子集(运行时强制),替代软隔离;需改 MCP 启动 + CLI。
- **平台特定打包**:生成 Android `VectorDrawable` XML / iOS `.xcassets` / `drawable-<density>/` 桶目录(需额外转换库)。
- **切图 stale 检测**:仅当引入解档(unarchive)再编辑路径后才需要;当前 `archived` 终态使切图永不过期。

---

## 关键代码锚点(实现速查)

| 关注点 | 位置 |
|---|---|
| `data:` 资源提取参考(sharp/contentHash 用法) | `packages/core/src/artifact-asset-pipeline.ts:448` / `:71` |
| 保存管线(窄依赖模式、tmp+render、finalFiles) | `packages/core/src/design-save.ts:96` |
| 静态校验(新 SVG 会被 scanSvg 校验) | `packages/core/src/artifact-static-validation.ts:201` |
| 版本不可变 / tmp+rename / 版本正则 | `packages/core/src/artifact-store.ts:289` / `:298` / `:303` / `:357` |
| 归档(active 校验) | `packages/core/src/requirement.ts:354` / `:361` / `:363` |
| 需求状态机(active 条件) | `packages/core/src/requirement.ts:775` |
| 归档 HTTP 路由 | `packages/server/src/routes.ts:292` |
| design pointer | `packages/core/src/product.ts:29` / `:240` |
| MCP 工具注册 / getProductArtifact / exportArtifact | `packages/mcp/src/tools.ts:258` / `:542` / `:616` / `:175` |
| 渲染快照(原 P4 起点;R1 改 vzi,仅历史参考) | `packages/core/src/quality/rendered-dom.ts:35` / `packages/core/src/preview-renderer.ts:68` |
| 契约 ArtifactExportKind | `packages/od-contracts/src/api/artifacts.ts:25` |
| desktop/viewer 走 HTTP 证据 | `packages/desktop/src/renderer/viewer/resolver.ts:13` / `packages/desktop/src/main/index.ts` |
| web 走 HTTP | `packages/web/src/api.ts`(`FormaApiClient`) |

---

## Open questions / 后续需求(待补充)

> 用于继续扩充本方案的其他需求,逐条追加。

- **R1 · 归档时 VZI 标注采集(vendor `vzi-core`)+ 切图融合 + 开发通道走 VZI 数据** — 已定稿,待批准实现。详见下文「追加需求 R1」。

---

## 追加需求 R1 · 归档时 VZI 标注采集(vendor vzi-core)·切图融合·开发通道走 VZI 数据

> **状态:** 设计已定稿(承接主方案 + 本轮 4 次收敛),待批准实现。
> **日期:** 2026-06-02
> **前置阅读:** 本文件主方案;`~/x-studio/vzi-core`(README、`docs/{vzi-format-spec,api-reference,transformation-flows,dependency-boundaries}.md`);fork 基线 vzi-core commit `698942c`。
> **supersede:** 主方案 Non-scope「元素级坐标标注 / 引入新依赖」、关键决策表「handoff 数据」行、§3 末、未来扩展「P4」段(见 §R1.7)。

### R1.0 Goal

归档时,除切图外,为每页设计稿采集**元素级标注数据(文本 / 位置 / 大小 / 类型 / 层级 / 设计 token / annotations)**,服务移动端原生(Compose/SwiftUI/XML)精确还原。手段:**vendor `vzi-core` 的 HTML→`.vzi` 链路**(已验证库,fork 进 Forma 修细节 bug),归档把每页 `v{n}/index.html` 转成 `.vzi` 持久化;开发 agent 经 **Forma 自身 MCP** 拿 `.vzi` 结构化数据。

### R1.1 关键决策(固化)

| 维度 | 决策 | 理由 |
|---|---|---|
| **标注来源** | 不自研提取器;vendor vzi 后端链路:`PuppeteerParser.parseAsync(html)` → IR → `VZITransformer.transform` → `VZIContent` → `VZIEncoder.encode` → `.vzi` | vzi `IRElement.bounds{x,y,w,h}` + 类型 + `colorTokens/fontTokens` + `spatialIndex`(层级)+ `annotations[]`,覆盖"文本/位置/大小/层级",超原 P4 设想 |
| **集成方式** | **Vendor(拷源码进 Forma、二次修改)**,非 tarball 依赖 | 库有细节 bug 需 fork 修;Forma 持可控副本 |
| **vendor 范围** | 后端 `types`+`parser`+`transformer`+`format`;渲染 `renderer`(**先集成、暂不接 UI**);读取层 `MCPTransformer`+schemas(从 `apps/mcp` 摘) | 见 §R1.2 |
| **不 vendor** | `platform-extractors`/`platform-client`/`platform-contracts`(Figma)、`quality-lab`、`apps/mcp` 的 server 外壳(Forma 有自己 MCP) | Forma 走 HTML 路径无 Figma;MCP 单服务 |
| **parser 模式** | **只保留 puppeteer 模式**,删 sync/JSDOM 轻量路径 | 轻量模式精度不可接受;puppeteer 真实布局准确 |
| **视口** | 按 `product.platform` 映射到 vzi `viewportPreset`(见下「视口映射」);**单视口快照**,清单记 `platform`+`viewport`+`viewportSource` | parser 原生支持 `viewportPreset` 入参;自带 `ResponsiveDetector` 可附响应式元数据 |
| **落盘(page 级,不随版本)** | `$FORMA_HOME/data/products/<productId>/od-project/artifacts/<artifactId>/vzi/page.vzi`(**一页一个 vzi**;`od-project` 固定段);**切图同改 page 级** `…/<artifactId>/icons/<name>.{svg,png}`+`icons.json`;均为 `<artifactId>/` 下、与不可变 `v{n}/` 并列的兄弟目录;**源版本记入 metadata**(vzi `sourceVersion` / icons.json `version`),路径不带版本;tmp+原子 rename;每次归档清旧重生成 | 归档只转**每页最终版本**(`archived` 终态、不再变),故 vzi/切图天然一页一份、无版本维度;`^v\d+$` 不匹配 `vzi`/`icons`,绕版本不可变(`artifact-paths.ts:93`/`artifact-store.ts:357`);artifactId 按页稳定累积版本(`design-save.ts:179`) |
| **事务** | 并入主方案两阶段:阶段1(锁外)**切图 → vzi 采集**(vzi build 时把 image/inline-svg 元素资源引用重写为指向切图产物),两者全成功才阶段2(锁内)提交 `archived`;任一页任一步失败→整体抛错、留 `active`、可重试 | 复用已定失败语义,导向安全侧 |
| **切图 × vzi** | 互补不替代(vzi 不产原始 svg 串/不栅格化);**vzi 元素资源引用正指切图产物**(文档序对齐);单次重活不重复 | 见 §R1.5 |
| **开发通道** | Forma MCP vendor `MCPTransformer` 读取逻辑,**自身暴露 vzi 数据**(单 MCP);对外 **3+1 工具**(`get_design_handoff`+`get_page_ui`+`get_ui_node`+可选 `search_page_ui`,去 product_id,参考 Figma-Context-MCP 少次富信息),背后 vzi 6 原语 | 不另起 `vzi-core-mcp`;符合 vzi「VZI→MCP JSON」路径;见 §R1.4 |

**视口映射(R1,对齐 vzi `VIEWPORT_PRESETS`,`puppeteer-parser.ts:26`):**

| `product.platform` | vzi preset | 像素(W×H) |
|---|---|---|
| `mobile` | `mobile` | 390×884 |
| `tablet` | `tablet` | 768×1024 |
| `desktop` | `desktop` | 1024×1280 |
| `web` | `desktop`(web 属桌面级,复用) | 1024×1280 |
| **未设置**(`platform` 为 optional,`product.ts:42`) | `desktop`(可观测兜底) | 1024×1280 |

- 缺省时用 `desktop` 兜底,并在 `.vzi`/清单记 `viewportSource:"default(desktop)"` 使兜底**可观测、不静默**。
- 经 parser `viewportPreset` 入参(等价 `computedStyleOptions.viewportWidth/Height`)。

### R1.2 Vendor 清单与落点

Forma 工作区 `packages/*`(pnpm 10.33)。vendored 包**保留 `@vzi-core/*` 包名**(免改内部 import),作为 workspace 包落 `packages/vzi-*/`:

| vzi 源包 | Forma 落点 | 角色 | 二次修改 |
|---|---|---|---|
| `@vzi-core/types` | `packages/vzi-types` | IR/渲染类型 | 按需 |
| `@vzi-core/parser` | `packages/vzi-parser` | HTML→IR(**仅 puppeteer**) | 删 sync/JSDOM 轻量路径;对齐 Forma `puppeteer@25`;复审 ext 依赖(jsdom 可能可删) |
| `@vzi-core/transformer` | `packages/vzi-transformer` | IR→VZIContent | 修细节 bug |
| `@vzi-core/format` | `packages/vzi-format` | `.vzi` 编解码 | 修细节 bug |
| `@vzi-core/renderer` | `packages/vzi-renderer` | CanvasKit 渲染(**先集成不用**) | 仅保证可 build,不接 UI |
| `apps/mcp` 的 `MCPTransformer`+schemas | `packages/mcp` 内(或 `packages/vzi-read`) | `.vzi`→结构化 JSON | 摘读取逻辑去 server 外壳;**`packages/mcp` 因此依赖 `@vzi-core/format`(VZIDecoder)+`@vzi-core/types`(VZIContent)+ 本读取层** |

外部新增依赖(随 vendored 包):cheerio/postcss/tailwindcss/autoprefixer/rbush/msgpackr/ajv/canvaskit-wasm(及视 parser 取舍的 jsdom)。**puppeteer/react/react-dom/sharp/node-html-parser Forma 已有。**

### R1.3 归档采集编排

新建 `packages/core/src/requirement-vzi-capture.ts`(仿 `requirement-icon-export.ts` 窄依赖):

```
captureRequirementVzi(deps, { productId, requirementId }) → { pages:[{pageId, elementCount}], totalElements }
```

- 入参含上一步切图的 `iconManifest`(用于解析资源引用)。
- 遍历 `listDesignPointers(productId)` 过滤本需求(同切图)。
- 每 artifact:读最终版本 `v{n}/index.html`(归档指针所指)→ `parseAsync(html,{usePuppeteer:true, viewportPreset:←platform})` → `transformer.transform(ir,{enableAnnotations:true})`(**默认即 true**(`transformer.ts:105`),显式保持不关→产间距/对齐/尺寸红线 `annotations[]`)→ 构建 `VZIContent`(**build 时按 `iconManifest` 文档序把每个 image/inline-svg 元素的资源引用重写为指向 `<artifactId>/icons/` 对应切图文件**;metadata 记 `sourceVersion=n`)→ `encoder.encode()` → 写 `<artifactBase>/.tmp-vzi-xxx/page.vzi` → 删旧 `vzi/` → 原子 `rename` `.tmp-vzi-xxx/` → `vzi/`。
- **任一页失败整体抛错**(fail-loud,不吞)。
- `vzi/` 兄弟目录(**page 级,无 `v{n}` 子层**),绕版本不可变(`^v\d+$` 不误判 `vzi`)。

**接入** `packages/server/src/routes.ts:292` archive 路由:阶段1(锁外)由一个薄编排 `exportArchiveAssets(deps,{productId,requirementId})` 统一执行 **`exportRequirementIcons` → `captureRequirementVzi`**(**切图先行**产出 `iconManifest`;vzi build 据此把元素资源引用指向切图产物;**统一 tmp 清理 + 整体 fail-loud**),全成功 → 阶段2 `archiveRequirement`(锁内)。任一抛错→不提交、留 `active`。

**归档响应统一**为 `{ requirement(archived), icons:{pages,totalIcons}, vzi:{pages,totalElements} }`(取代主方案仅 `icons` 的响应);web toast 据此显示「N 元素 / M 页」。

### R1.4 开发消费通道(Forma MCP 暴露 VZI 数据)

> **工具形态参考 GLips/Figma-Context-MCP:少次、富信息、深度受限**——避免 agent 陷入"列树→逐节点拉"的 N+1。对外只暴露 **3+1** 工具,背后由 vendored vzi 读取层(`MCPTransformer`,内部 `VZIDecoder.decode(vziPath)`)支撑;vzi 6 原语(`get_vzi_overview`/`list_vzi_elements`/`get_vzi_element`/`search_vzi_elements`/`get_vzi_tokens`/`get_vzi_annotations`)只作**内部实现**,不直接对外。
>
> **入参约定:** 全部**去 `product_id`**(`requirement_id` 全局可解析,内部 `productIdForRequirement`/`readRequirementById`,`requirement.ts:355/420`);`page_id` 是 **requirement 作用域**(design pointer 键 `(requirementId,pageId,variant)`,`product.ts:88`),故 B/C/D 收 `(requirement_id, page_id)`,内部解析为该页 `vziPath`。

**A. `get_design_handoff(requirement_id)`** — 入口 + gate + 目录。
- gate:`status==="archived"` 否则 `REQUIREMENT_NOT_FINALIZED`。
```
{ requirement:{id,title,status:"archived"},
  pages:[{ pageId, title, vziPath, indexHtmlPath, iconCount }],
  rules, copy }
```

**B. `get_page_ui(requirement_id, page_id, { depth?, fields?, node_id? })`** — 主力,对标 `get_figma_data`。一次返回**深度受限简化树 + 顶层去重 tokens + 切图路径 + annotations**:
```
{ viewport, platform,
  tokens:{ colors:[…], fonts:[…] },         // globalVars 式去重,节点引 styleRef
  tree:[{ id, type, bounds:{x,y,w,h}, text, styleRef,
          assetRef,                         // 解析为 <artifactId>/icons/… 同机绝对路径
          children:[…] }],                  // 到 depth 为止
  annotations:[ 间距/对齐/尺寸红线 ] }
```
- `depth` 控树深(默认浅、可加深);`fields ∈ layout|text|visuals|all`(对标 Figma `layoutAndText/contentOnly/visualsOnly`)控字段;`node_id` 给定则返回**以该节点为根的子树**(吸收"取子树",免 N+1)。
- 背后:`get_vzi_overview` + `list_vzi_elements`(树化)+ `get_vzi_tokens`(**嵌顶层**)+ `get_vzi_annotations`。

**C. `get_ui_node(requirement_id, page_id, node_id)`** — 深钻单节点全量:完整样式(非仅 ref)+ 解析后切图路径 + 父/子 id + 该节点 annotations。背后 `get_vzi_element(elementId, depth=0)`。

**D.(可选)`search_page_ui(requirement_id, page_id, query)`** — 大页面按文本/类型检索。背后 `search_vzi_elements`。

- **资源返回切图数据**:B/C 对含资源(image/inline-svg)的元素,`assetRef` 由 read-layer 解析为 `<artifactId>/icons/` 切图文件的**同机绝对路径**(与 `vziPath`/`indexHtmlPath` 同机)。`.vzi` 内存稳定相对/逻辑 ref,read-layer 解析为绝对路径。

→ agent 先 `get_design_handoff(requirement_id)` 拿页目录,再 `get_page_ui` 一次拿"树+tokens+切图+annotations",仅在需单节点全部细节时 `get_ui_node`。**单 MCP,无外部 server。** 现有创作通道(`get_product_artifact`/`export_artifact`/`get_design_context`/`change_artifact_style`)不动。

**手动入口(对称 `format="icons"`):** `export_artifact(format="vzi")` 取某版 `.vzi`(单 artifact 重导/调试,非失败兜底);`ArtifactExportKind += 'vzi'`(`packages/od-contracts/src/api/artifacts.ts:25`)。

### R1.5 切图 × VZI 融合

- `.vzi` = 布局/几何/层级/结构化 `SVGData`/`imageData` + 稳定 element id;**不产**原生可用 `.svg`/`.png`(svg-extractor 只出结构化 paths/circles/rects、不留原始串;image-extractor 只记 src/元数据、不栅格化)。
- 切图 `icons/` = 原生可落地资源文件(**保留**)。
- **链接方向:vzi 元素 → 切图产物**(正向,非反指)。vzi build 时把每个 image/inline-svg 元素的资源引用重写为指向 `<artifactId>/icons/` 对应文件;`.vzi` 因此自包含(结构/几何 + 可落地资源指针),MCP 读一处即得"元素 + 切图资源"。
- **匹配键**:内联 svg/img 的**文档序序号**(切图 `node-html-parser` 与 vzi puppeteer 同序枚举);fork 可为每 svg 元素保留 `contentHash` 做兜底校验;对齐失败 fail-loud(不静默)。
- **顺序**:phase-1 内 **切图 → vzi**——切图先产出 `<artifactId>/icons/` 文件 + `iconManifest`,vzi build 据此解析资源引用(被指向目标须先存在)。
- 单次重活不重复:仅 vzi 一次 puppeteer 渲染拿几何;切图走轻量 `node-html-parser` 取原始 svg 串 + sharp 栅格,不开浏览器。
- (后期渲染接入后)PNG 栅格化**可选**迁 vzi `renderer` 离屏 node 导出替代 sharp;`.svg` 原始标记始终由 HTML 侧出。

### R1.6 分步实施

**总实施排序(主方案 P1–P3 与 R1 合并,不独立两轮改归档路由):**
P4a(vendor & 修复)→ P1(切图核心)→ **合并 P2+P4b**(归档阶段1 = 切图 → vzi,vzi 资源引用指向切图产物,一次改 `routes.ts:292` + 一套集成测试)→ **合并 P3+P4c**(handoff + vzi 读取工具 + agent 模板)→ P4d(renderer 先集成不用)。

**P4a — vendor & 修复(独立可验证)**
- [ ] 拷 5 包 + 读取层进 `packages/vzi-*`,保 `@vzi-core/*` 名,接入 pnpm workspace + build(CLI 末位 bundling 不受影响)。
- [ ] parser 删轻量模式、对齐 `puppeteer@25`;各包修细节 bug 至 build+test 通过。
- [ ] **conformance 冒烟**:真实 Forma design-page HTML 过 `parse→transform→encode→decode` 往返,断言 `elements>0`、`bounds` 非零、round-trip 一致(类似 `smoke:pencil`,需 puppeteer)。

**P4b — 归档采集(core+server)**
- [ ] `requirement-vzi-capture.ts` + 单测(多页遍历 / 单页失败整体抛错 / tmp+rename / 清旧幂等 / viewport 随 platform)。
- [ ] archive 路由阶段1 由 `exportArchiveAssets` 统一编排 **切图 → vzi**(vzi 资源引用指向切图产物),全成功才提交;集成测试(全成功才 `archived` / 注入失败仍 `active` 无残留可重试;**校验 vzi 元素资源 ref 解析到存在的切图文件**)。
- [ ] web 归档反馈复用 `archiving` state(`ProductDetail.tsx:65`),toast 带"N 元素 / M 页"。

**P4c — 开发通道(mcp)**
- [ ] `get_design_handoff(requirement_id)`(去 product_id)+ **3+1 对外工具** `get_page_ui` / `get_ui_node` / `search_page_ui`(背后 vendored vzi 读取层 6 原语;`get_page_ui` 含 depth/fields/node_id + 顶层 tokens + 切图 assetRef + annotations)。
- [ ] 开发 agent 模板引导"先 handoff 后 vzi 读取"。
- [ ] mcp 测试:未归档拒;归档后返回 `vziPath` + 读取工具可用;创作通道不受 gate 影响。

**P4d — 渲染(先集成不用)**
- [ ] `packages/vzi-renderer` build 通过,**不接 UI、不被任何运行时代码 import**(dormant);核实 `canvaskit-wasm` 不进 CLI/server 运行时 bundle(无 import 边界 + tree-shake),记录安装体积增量;预留 web/desktop viewer 接入点。

### R1.7 本节 supersede 原文

| 原文条目 | 处置 |
|---|---|
| Non-scope「元素级坐标标注(归入未来 P4)」 | R1 实现 |
| Non-scope「引入新依赖」 | R1 vendor vzi-core(fork)引入 |
| 关键决策表「handoff 数据」行"不含元素坐标标注" | R1 经 `.vzi` 提供 |
| §3 末"不含坐标标注(见 P4)" | R1 supersedes |
| 未来扩展「P4 · 元素级坐标标注」(原拟"自研渲染快照扩展") | 由 vendor vzi-core 取代落地 |
| 切图/vzi 落盘 `icons/v{n}/`、`vzi/v{n}/`(版本子目录) | **改 page 级** `icons/`、`vzi/page.vzi`(一页一份,归档只转最终版本;源版本入 metadata) |

### R1.8 风险与回滚

- **fork 维护(最主要新增成本)**:vendored vzi 与上游分叉,后续上游修复需手动同步;记录 fork 基线 commit `698942c`,改动集中、注释来源。
- **最脆弱假设**:vzi puppeteer 解析对 Forma HTML 保真——用户已确认"大体没问题",剩余细节 bug 由 vendoring 修 + conformance 冒烟兜底。
- **单视口局限**:响应式设计在其他屏宽 rect 会变;清单显式标注覆盖范围,多视口属更远扩展(parser `ResponsiveDetector` 可先附断点元数据)。
- **依赖失效**:无 Chrome → 归档 fail-loud(与 preview 同 Chrome 依赖)。
- **回滚**:vendored 包 + 采集子步 + handoff 字段 + renderer 均增量;倒序移除(渲染→mcp→采集→vendor 包),归档行为还原,存量零影响。

### R1.9 代码锚点(补充)

| 关注点 | 位置 |
|---|---|
| vendor 落点 | `packages/vzi-{types,parser,transformer,format,renderer}`;读取层 `packages/mcp` 内 |
| vzi 后端链路参照 | `~/x-studio/vzi-core` parser `parseAsync`/`PuppeteerParser`、transformer `VZITransformer.transform`、format `VZIEncoder/VZIDecoder` |
| `.vzi` 读取参照 | vzi-core `apps/mcp/src/transformers/MCPTransformer.ts` + `tools/*`(`get_element`/`get_annotations`/`get_tokens`/`list_elements`/`search_elements`/`read_vzi`) |
| 采集编排接入 | `packages/server/src/routes.ts:292`(与切图并列阶段1) |
| 视口来源 | `product.platform`(`packages/core/src/schemas.ts:4`)→ vzi `viewportPreset`(`puppeteer-parser.ts:26`;见 §R1.1 视口映射) |
| 切图↔vzi 关联 | vzi 元素资源 ref → `<artifactId>/icons/`(文档序匹配,`contentHash` 兜底);read-layer 解析为绝对路径 |
| VZIContent 结构 | vzi-core `packages/format` + `docs/vzi-format-spec.md`(`elements`/`spatialIndex`/`colorTokens`/`fontTokens`/`annotations`/`images`) |
