结论：需修改（阻塞项 2 项，均为 Test Matrix / Trace 的小幅缺口，定点可修）

> 评审对象：`06-spec.md`（r2p_stage: spec, version 3, HEAD=bd04fc7）
> 评审人：SPEC 只读子代理 · 2026-06-13
> 上游：05-design.md（v2 approved, DES-ARCH-001..009）、04-risk-discovery.md（v1 approved, RISK-*）、docs/image-generation-requirements.md（用户审定，权威）

**阻塞项**

1. **Test Matrix M3 缺「MCP 工具测试」（save_brand_asset / list_brand_assets）。** 权威文档 §6 M3 验收明确列出「brand-assets 存储测试…；**MCP 工具测试**；管线 `brand/` 命名空间解析测试；…」，而 SPEC Test Matrix 的 M3 三行只覆盖 core 层（`packages/core/tests/brand-assets.test.ts`）、沙箱、管线/viewer/web/server/模板断言，工具层（入参 schema 校验、`BRAND_ASSET_INVALID_INPUT` / `BRAND_ASSET_NOT_FOUND` 经 MCP 以 `{ error_code, message, details }` 形态返回）无测试条目。对照：M2 行已含「mcp `search_icons` 测试」，M3 不应缺位。修法：M3 增加一条 mcp 工具测试行（文件级命名）。
2. **RISK-DATA-001 的「旧数据加载回归测试」在 Test Matrix 缺位，且 Trace 映射错位。** 风险缓解原文（04-risk-discovery RISK-DATA-001）要求「**回归测试覆盖旧数据加载**」（含 `forma.productIcon` 的旧 artifact manifest 仍可加载/`validateArtifactManifest` 校验通过）。SPEC Trace 行「Test Matrix M3 模板断言 | RISK-DATA-001（旧 artifact 零迁移回归）| covered」把该风险映射到模板断言——模板断言只检查模板文本（icon unit 移除后全集），不验证旧 manifest 数据加载，无法承接该缓解。修法：Test Matrix M3 增加一条 manifest 层零迁移回归测试（present 时 SVG 约束保留 + 旧 artifact 加载成功），并把 Trace 该行指向它。

---

## 契约完整性

**DES-ARCH → SPEC-BEHAVIOR 映射完整**（九项全部承接）：

| DES-ARCH | 承接 | 核查 |
|---|---|---|
| 001 media 子系统 | SPEC-BEHAVIOR-001/002 | ✅ 行为序（校验→凭证→renderer→暂存→返回）、count 上限 4 不静默截断、不走 mutation 锁均落为可测行为 |
| 002 forma-image 协议 | SPEC-BEHAVIOR-004 | ✅ 双命名空间、解析时机、并入 data: 流、fail loud、M1 期 `brand/` 未接线语义（新增澄清，非矛盾） |
| 003 凭证配置 | SPEC-BEHAVIOR-003 | ✅ env 链、脱敏字段集、preserve_api_key、409/force、0600 创建/收紧、win32 门控、排除清单 |
| 004 Lucide | SPEC-BEHAVIOR-005 | ✅ 输入/匹配/返回/空结果不报错 |
| 005 brand-assets | SPEC-BEHAVIOR-006/008 | ✅ source 恰好一个、kind×source 约束、锁内原子、覆盖语义、返回形态 |
| 006 渲染沙箱+画布 | SPEC-BEHAVIOR-007/008 | ✅ 两层（先 localize / 拦截白名单）、四类拒绝、stale 判定在 web 层 |
| 007 agent 命令层 | SPEC-BEHAVIOR-010 + 「agent 层契约」段 | ✅ 前置矩阵逐命令、检测经 list_brand_assets/list_product_artifacts |
| 008 M0 craft 分发 | SPEC-BEHAVIOR-009 | ✅ craft_rules 同源、纯增量、模板 palette design-read |
| 009 错误码+降级 | SPEC-BEHAVIOR-010 + 错误码表 | ✅ 6 码语义见各行为契约；降级路径显式 |

四个 MCP 工具均有签名 + 行为契约引用；六条 server 路由成表（见建议 3 的计数口径）；`media-config.yaml` schema、两处存储布局（`data/<pid>/image-staging/`、`data/products/<pid>/od-project/brand-assets/`）、6 个 FormaError 码 + HTTP 映射均在「API / Data / Config Contracts」落位。无 TBD/TODO/「以后再说」类占位：仅有的两处延期项（aspect→size、商店图 preset）是被要求的 UNCONFIRMED 纪律项，带 owner；`lucide-static`「待 M2 锁定」带 owner 与动作（固定版本 + 产物记录 + 许可证随附），可接受。

## 与权威文档一致性

逐项对照 `docs/image-generation-requirements.md` §5/§6，**无矛盾、无弱化**：

- **错误码语义（§5.5）**：六码逐一吻合。`count>4 → MEDIA_INVALID_INPUT`（§5.5「非法 aspect/count」）、`MEDIA_IMAGE_NOT_FOUND` =「暂存区与品牌资产均不存在」（SPEC-BEHAVIOR-004 的 M1 期 `brand/` 未接线 → 同码，与该语义自洽）、`BRAND_ASSET_NOT_FOUND` 限定「明确指名单个资产」而 list 空查询回空数组（SPEC-BEHAVIOR-008），与 §5.5「list/导出指定的资产不存在」一致。
- **前置矩阵（§5.2）**：SPEC-BEHAVIOR-010 四命令逐列吻合——fm-app-icon（产品+config+模型）、fm-refine-components（ICON 硬前置、模型不需要）、fm-design（ICON 条件前置：涉及 ICON 展示硬性/否则提醒放行；插图页需模型否则显式降级——与 §6 M4 降级条款一致）、fm-brand-assets（模型+ICON 硬前置+商店图需有预览设计稿）。检测全在模板层、失败=停止+指引，未弱化。
- **forma-image 协议（§5.3）**：命名空间、解析时机 `localizeArtifactAssets`、失败整次保存失败、拷贝不删源、同一降采样/预算/记账，全部保留；预算数值（4MiB/48MiB/200 文件）照搬无改动。
- **存储布局（§5.4）**：暂存 `<uuid>.{png,json}`（元数据字段集与 §5.4 一致）与 brand-assets 四目录结构逐字吻合。
- **M1 凭证安全段**：0600 新建/更严保留/宽则收紧、win32 按 `process.platform` 跳过权限语义其余约束不变、静态服务/zip/诊断/日志/FormaError details 五处排除、诊断仅脱敏元数据、env 来源连尾号不回——SPEC-BEHAVIOR-003 全部保留，无弱化。
- **M3 沙箱段**：默认禁脚本、先 localize 再渲染（浏览器层不出现 `forma-image://`）、白名单仅 bundle 内 `file://` + path-boundary 校验的产品预览、`http(s):`/协议相对/白名单外 `file://`/越界一律中止 + 不出降级图——SPEC-BEHAVIOR-007 全部保留，且「fail loud，不出降级图」是对权威文档的加严表述，方向正确。
- **模型目录**：五个 Seedream ID + 默认 `doubao-seedream-5-0-260128` 与附录 A 一致；SeedEdit 未混入。

## 测试矩阵核查

- **全自动化离线**：开头总则明确「stub provider + 本地渲染、不需要真实 APIKEY、不需要 Pencil CLI」，stub renderer 契约（SPEC-BEHAVIOR-002）保证确定性字节不打网络 ✅。
- **手动计费验收分离**：M1 测试连接 / M3 fm-app-icon / M4 插图页 / M5 商店图+海报 zip，单独成段、标注用户执行+计费 ✅。
- **安全硬项**：凭证三件套（0600 创建/收紧 win32 跳过、脱敏 env 不回尾号、静态服务/zip/诊断排除）在 M1 两行落位 ✅；沙箱四类（脚本拦截/远程拒绝/file 越界拒绝/白名单预览可用）在 M3 行注明「四类全覆盖」✅。
- **逐里程碑对照权威文档验收**：M0（craft_rules 含 ai-tells + 模板断言）✅；M1（目录校验/凭证优先级/脱敏/409/put-resolve-TTL/管线解析含预算超限与引用缺失 fail loud/`brand/` 未接线/6 路由/Settings）✅；M2（命中/空/limit、diff 干净、禁手绘断言、mcp 工具测试）✅；M3 ❌ 见阻塞项 1、2；M4（slug 入索引、IMAGERY 判定与显式降级文案）✅；M5（preset 表含来源 URL+日期、按 preset 渲染像素精确）✅；收口命令每里程碑 `pnpm test` + `pnpm typecheck` ✅。

## UNCONFIRMED 纪律

- **aspect→size 每档像素值**：SPEC-BEHAVIOR-002 明确「M1 实现期核定项（UNCONFIRMED）」，只给原则（≥2K、按 82379/1541523 落表并记来源 URL + 核实日期），正文与 Test Matrix 均未出现任何具体像素值 ✅。External Documentation Checked 表对应行带 owner（M1）✅。
- **商店图 preset 像素**：External Documentation Checked 表「UNCONFIRMED：当前像素示例值禁止落表/落测试；M5 实现前核定」，owner M5；SPEC 正文未复述权威文档中的示例值（1290×2796 等）✅。
- **purpose→默认 aspect 映射**（app-icon→1:1 等）是比例而非像素，属 SPEC 层合理决策，不违纪 ✅。
- **app-icon 派生尺寸组**（iOS 1024/180/120 等）与 2048 母版为权威文档 §6 M3 已审定值，不在 UNCONFIRMED 集合内，直接落表合规 ✅。

## Trace 闭环

- DES-ARCH-001..009 全部出现在 Trace 上游列（001→B1/B2，002→B4，003→B3，004→B5，005→B6/B8，006→B7/B8，007→B10，008→B9，009→B10）✅。
- RISK 承接：SEC-001→B3、SEC-002→B7、SEC-003→B4、DEP-001→B2+External Docs 行（open，owner 已标）、DEP-002→B1、DEP-003→B5、DATA-002/003→B4、DATA-004→B6、PROC-001→External Docs 行（open，owner 已标）✅。
- **RISK-DATA-001 映射错位**——见阻塞项 2。
- RISK-PROC-002 未在 SPEC Trace 表显式成行（经 DES-ARCH-007→SPEC-BEHAVIOR-010 + agent 层契约「同步 README 索引与 slug 测试」传递闭环），见建议 4。

## PLAN Handoff 可执行性

六条交接项齐备、可执行：
1. M0→M5 排序 + 每里程碑独立收口（代码+测试+`pnpm test`/`pnpm typecheck`+模板断言+用户 `/check`）✅。
2. 文件级清单按里程碑展开，M3 五连改点名 `packages/core/src/component-baseline.ts` ✅。
3. **两个 UNCONFIRMED 核定任务显式排各自里程碑首位**（M1 第一步复核火山文档落 aspect→size 表；M5 第一步核定 preset 含来源 URL+日期入测试）✅，与 RISK-DEP-001/PROC-001 闭环要求一致。
4. 手动验收列为用户步骤、不进 CI、标注真实 ARK key 前置 ✅。
5. **模板改动 ×3 平台（claude/codex/gemini）+ shared 逐平台列出防遗漏** ✅。
6. M1 store 装配（`generateProductImage`）与管线签名扩展（`resolveFormaImage`）与 media/ 四文件分任务，利于审查 ✅。

## 建议（非阻塞）

1. **HTTP 映射定值**：「NOT_CONFIGURED→409 或 422 取既有惯例」留了二选一。建议 PLAN 前查 `packages/core/src/errors.ts` 既有 code→status 映射定死一个值，避免实现期歧义。
2. **model 来源补一句**：`generate_image` 入参无 `model`，而 SPEC-BEHAVIOR-001 行为序第一步是「校验 model 在目录内且属当前 provider」。建议明确「model 取自 media-config 当前选用模型（即 SPEC-BEHAVIOR-003 的 `model` 字段）」，防止实现期误加入参或语义分叉。
3. **路由计数口径**：「server 路由（6 新增）」表第 6 行合并了 `files/*` 与 `…/export` 两个端点（6 行实为 7 个端点）。建议拆行或在行内注明两条，避免 PLAN 按行漏计。
4. **Trace 补 RISK-PROC-002 行**：映射到「agent 层契约（craft/image-prompts.md 同步 README 索引与 slug 测试）+ Test Matrix M4 slug 测试」，使 R3 闭环推导不依赖传递推断。
5. **M1 可补 mcp `generate_image` 工具层测试**（错误以 `{ error_code, message, details }` 透传、details 不含 key），与 M2/M3（修复阻塞项 1 后）的工具层覆盖对齐；权威文档 M1 验收未硬性要求，故列为建议。
