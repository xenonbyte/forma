结论：通过

> 评审对象：`06-spec.md`（r2p_stage: spec, version 4）
> 评审人：SPEC 只读复验子代理 · 2026-06-13
> 复验基线：`reviews/spec-subagent-review-v3.md`（需修改，阻塞 2 项 + 建议 5 项）
> 差异核实方式：`inputs/spec-content.md`（v3 正文）与 `inputs/spec-repair.md`（v4 正文）逐行 diff；已确认 `06-spec.md` 去 frontmatter 后与 repair 内容完全一致（IDENTICAL）。v3→v4 共 6 处定点改动，无其他改动。

## 阻塞项复验

1. **M3 缺 MCP 工具测试行 —— 已修复。** Test Matrix 新增一行（`06-spec.md:122`）：「M3 | mcp 工具测试（`save_brand_asset` / `list_brand_assets`）| schema 校验（source 恰好一个、未知 kind/preset 拒绝）；`BRAND_ASSET_*` 错误经 MCP `{ error_code, message, details }` 形态返回」。覆盖面与 v3 阻塞项要求逐点对应：入参 schema 校验（呼应 SPEC-BEHAVIOR-006 的「恰好一个」与非法 kind/preset 语义）+ 两个 `BRAND_ASSET_*` 错误码经 MCP 错误形态透传，与 M2 既有「mcp `search_icons` 测试」行口径对齐，满足权威文档 §6 M3 验收的「MCP 工具测试」项。
2. **RISK-DATA-001 缺 manifest 层回归测试、Trace 错位 —— 已修复。** （a）Test Matrix 新增一行（`06-spec.md:123`）：「M3 | manifest 零迁移回归测试（artifact-manifest 层）| 含 icon unit / `forma.productIcon` 的旧 manifest 仍可加载与校验通过（present 时 SVG 约束保留），新生成不再产出该字段」——断言落在数据加载/校验层而非模板文本层，直接承接 RISK-DATA-001 缓解「回归测试覆盖旧数据加载」，且追加「新生成不再产出该字段」的正向断言。（b）Trace 行（`06-spec.md:158`）由「Test Matrix M3 模板断言」改为「Test Matrix M3 manifest 零迁移回归 | RISK-DATA-001（旧 artifact 零迁移回归）| covered」，映射对位正确。

## HTTP 映射核对

v4 段落（`06-spec.md:87`）已将「NOT_CONFIGURED→409 或 422」二选一消除，改为定值并声明依据 `statusForError` 既有惯例。对照 `packages/server/src/app.ts:245-266` 逐条核实：

- `MEDIA_IMAGE_NOT_FOUND` / `BRAND_ASSET_NOT_FOUND` 走 `*_NOT_FOUND` 后缀规则自动 404 —— 与 `app.ts:259-261`（`error.code.endsWith("_NOT_FOUND") → 404`）一致，且无需改 server 代码，属实。
- `MEDIA_NOT_CONFIGURED` 加显式 409 分支，引用 `PRODUCT_CONFIG_INCOMPLETE` 先例 —— `app.ts:262-264` 确有该显式 409 分支（`REQUIREMENT_STATUS_INVALID` / `PRODUCT_CONFIG_INCOMPLETE`），先例属实，惯例匹配。
- 两个 `*_INVALID_INPUT` 走默认 400 —— 与 `app.ts:265`（FormaError 兜底 `return 400`）一致。
- `MEDIA_PROVIDER_ERROR` 加显式 502 分支 —— 当前 `statusForError` 无 502 分支，但已有逐码显式分支先例（`FORMA_LOCK_TIMEOUT→503`、`FORMA_DESKTOP_CONFIG_UNSUPPORTED→500`），「加显式分支」的表述准确（明示需要改代码，而非声称既有规则覆盖），语义（上游 provider 故障→502）合理。

结论：映射全部定值、与既有惯例一致、表述区分了「自动命中既有规则」与「需新增显式分支」，核对通过。

## 回归扫查

v3→v4 diff 共 6 处，逐一确认无意外回归：

1. SPEC-BEHAVIOR-001 增补一句「model 不是工具入参：取当前配置（env/media-config.yaml）所选 model」（采纳 v3 建议 2），纯增量澄清，与 SPEC-BEHAVIOR-003 的 `model` 字段闭环，无契约语义变化。
2. server 路由标题「6 新增」→「新增 7 端点」（采纳 v3 建议 3），表格行内已注明第 6 行含 `files/*` 与 `…/export` 两端点，计数口径修正。
3. HTTP 映射定值（见上节）。
4. External Documentation Checked 由条目列表改为四列表格：5 行逐一比对，URL、页面更新日期、核实日期（2026-06-13）、M1/M5 复核 owner、UNCONFIRMED 禁则（商店图像素禁落表/落测试）、lucide-static M2 锁版本全部保留，仅信息增强（如「SeedEdit i2i 排除”），无丢失、无弱化。
5. + 6. 即两个阻塞项修复（Test Matrix 两新行 + Trace 一行改写）。

其余全部未动：SPEC-BEHAVIOR-002..010 逐字未变；Test Matrix 其他行未变；PLAN Handoff 六条未变；Non-goals、Trace 其余行、Upstream Summary（design/risk/brief/原始文档）未变。v3 已通过的内容无任何被改坏的迹象。

## 备注（非阻塞）

1. Test Matrix M1 行「server 路由测试 … 6 条路由形态」（`06-spec.md:117`）为 v3 既有表述（v3 评审已放行）：M1 实际仅新增 4 个媒体端点（models / config GET / config PUT / test），brand-assets 3 路由在 M3 行另测。路由总数口径改为 7 端点后，该「6 条」与新口径不完全对齐，建议 PLAN 拆任务时按 M1=4 媒体端点、M3=3 brand-assets 端点核计，避免照抄字面数。
2. v3 建议 4（Trace 显式补 RISK-PROC-002 行）与建议 5（M1 补 mcp `generate_image` 工具层测试）未采纳——两项原本即为非阻塞建议，RISK-PROC-002 经 DES-ARCH-007 传递闭环成立，不影响通过结论；PLAN 阶段可自行斟酌。
