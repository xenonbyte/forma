结论：通过

审查对象：`07-plan.md`（r2p_version: 2，25 任务，M0→M5）。基线：HEAD=bd04fc7，工作树 clean，2026-06-13。上游：`06-spec.md`（SPEC-BEHAVIOR-001..010 + Test Matrix + PLAN Handoff 六项）、`docs/image-generation-requirements.md` §5/§6。无阻塞项；非阻塞建议见末节。

## PLAN Handoff 六项核查

1. **M0→M5 排序 + 逐里程碑收口 — 满足。** 任务分布：M0=001-002、M1=003-012、M2=013-014、M3=015-022、M4=023、M5=024-025，严格递增无交叉。六条收口线齐全：PLAN-TASK-002（M0）、012（M1）、014（M2）、022（M3）、023（M4）、025（M5）的 Verification 均含 `pnpm test && pnpm typecheck，绿后请用户运行 /check`。
2. **文件级清单含 component-baseline.ts — 满足。** PLAN-TASK-022 的 Files 明确列出 `packages/core/src/component-baseline.ts` + `packages/core/tests/component-baseline.test.ts`，且五连改其余四项齐备：fm-refine-components ×3、fm-change-style ×3、fm-design ×3、manifest 零迁移回归（`packages/core/tests/artifact-manifest.test.ts`，manifest 代码零改动）。
3. **两个 UNCONFIRMED 核定任务为强制第一步 — 满足。** PLAN-TASK-004 第一步标注「**第一步（强制）**」复核火山文档 82379/1330310、1541523、1824121 并落 aspect→size 表（来源 URL + 核实日期入测试）；PLAN-TASK-024 第一步同样「**第一步（强制）**」核定 App Store Connect / Google Play / Open Graph 商店图尺寸，「此前任何示例值禁止落表」。备注：handoff 措辞为「排进对应里程碑首位」，M5 侧 024 确为首任务；M1 侧首任务是 003（错误码，不依赖 UNCONFIRMED 数据），核定排在首个依赖该数据的任务（004）的强制第一步，实质满足意图，不构成阻塞。
4. **手动计费验收为用户步骤 — 满足。** 四处均标「手动验收（用户）」且注明真实 key：PLAN-TASK-012（真实 ARK key 测试连接）、022（真实 key 跑 fm-app-icon 全流程）、023（真实 key 含插图页 fm-design）、025（真实 key 商店图+海报+zip）。Verification 命令均不含真实 provider 调用。
5. **模板 ×3 平台逐文件列出 — 满足。** 抽查全部通过：PLAN-TASK-002（fm-refine-components/fm-change-style 各 3 平台共 6 文件）、014（fm-design/fm-refine-components 各 3 + shared/SKILL.md）、021（fm-app-icon 3 文件）、022（三命令 ×3 共 9 文件）、023（fm-design ×3 + shared）、025（fm-brand-assets 3 文件）。涉模板任务均带 `packages/agent/tests/template-parity.test.ts` 同步。
6. **store 接线与管线接线独立成任务 — 满足。** PLAN-TASK-008 仅 `packages/core/src/store.ts`（generateProductImage，不走产品锁），PLAN-TASK-009 仅管线三文件（resolveFormaImage 可选解析器），均与 media/ 四文件任务（004-007）分离。

## SPEC 消费核查

SPEC-BEHAVIOR-001..010 全部被至少一个任务引用，且引用实质相关（非装饰）：

| SPEC | 消费任务 | 抽查结论 |
|---|---|---|
| 001 | 003/004/006/007/008/010/011/020/021/023 | 007 的 purpose 默认 aspect（app-icon=1:1…store-shot-bg=9:16）、count 默认 1 上限 4 与 SPEC-001 逐字一致 |
| 002 | 004/007 | 007 移植 od renderVolcengineImage、`b64_json`、非 2xx 抛 `MEDIA_PROVIDER_ERROR`（details 无 key），一致 |
| 003 | 005/011/012 | env 三级优先链、脱敏（env 不回尾号）、preserve_api_key、409 防清空、0600/win32 全部落任务步骤 |
| 004 | 003/006/009/015 | 006 步骤 3 的 `brand/` M1 预留位 + 015 步骤 3 的 M3 接通替换，与 SPEC-004「M1 期未接线」段精确对应 |
| 005 | 013/014 | 前缀/子串/tag、limit 默认 10、空命中空数组，一致 |
| 006 | 003/015/017/018/021/022/024/025 | source 恰好一个、kind-source 形态匹配、平台尺寸组、覆盖语义均落任务 |
| 007 | 016/025 | 016 两层沙箱 + 四类测试；025 的 html 源经沙箱渲染引用合理 |
| 008 | 015/017/018/019 | stale 判定在 web 层（019 步骤 1），与 SPEC-008 一致 |
| 009 | 001/002 | craft_rules 同源 + palette design-read，一致 |
| 010 | 020/021/022/023/025 | 5.2 前置矩阵逐命令落到对应模板任务（硬前置/条件前置/显式降级文案） |

Trace 表 25 行与任务 Spec References 一致，无悬空引用。

## 仓库实况抽查

modify 型（应存在）：

- `packages/agent/templates/codex/fm-design/SKILL.md` — **确认**存在
- `packages/agent/templates/gemini/fm-change-style.toml` — **确认**存在
- `packages/core/tests/artifact-manifest.test.ts` — **确认**存在
- `packages/server/tests/routes.test.ts` — **确认**存在
- `packages/web/src/pages/Settings.test.tsx` — **确认**存在；`Settings.tsx` 实测 15 行空壳，与计划「纯新增节」前提一致
- `packages/mcp/src/tools.ts:461` — **确认**：`get_component_baseline` handler 正位于 461 行，现返回 `{ platform, baseline }`，`craft_rules` 为纯增量
- `packages/server/src/app.ts:245` — **确认**：`statusForError` 起于 245 行；`*_NOT_FOUND` 后缀→404 规则与 `PRODUCT_CONFIG_INCOMPLETE`→409 先例均实存，004/006 两 NOT_FOUND 码自动 404、409/502 显式分支的设计成立
- `packages/core/tests/design-context.test.ts` — **确认**存在且含 craft 文档全集断言（`ctx.craft.length >= 11`、按 slug 取单文档），PLAN-TASK-020 的 Verification 指向正确
- 其余 modify 涉及文件（design-context.ts、errors.ts、store.ts、artifact-asset-pipeline.ts、design-save.ts、component-baseline.ts、routes.ts、shared/SKILL.md、template-parity.test.ts、craft/README.md、web/routes.tsx 等）— **确认**全部存在

create 型（应不存在）：

- `packages/core/src/media/`（含 image-models/config/staging/generate 四文件及 tests/media）— **确认**不存在
- `packages/viewer/src/AssetTile.tsx` + `AssetTile.browser.test.tsx` — **确认**不存在；viewer 现有 `*.browser.test.tsx` 命名惯例（AnnotationSlot/Canvas 等）成立
- `packages/agent/templates/claude/fm-app-icon.md`（及 codex/gemini 对应）— **确认**不存在
- `craft/image-prompts.md` — **确认**不存在
- `scripts/vendor-lucide.mjs`、`packages/core/assets/lucide-icons.json`、`packages/core/src/icon-search.ts`、`packages/core/src/brand-assets.ts`、`brand-asset-render.ts`、`packages/web/src/pages/BrandAssets.tsx`、`fm-brand-assets` 三件 — **确认**均不存在

辅助事实核验：lucide 当前在任何 package.json 中无依赖（新增 devDependency 属实）；`@xyflow/react` 已是 viewer 依赖（019 的 React Flow 画布不引新依赖）；`pnpm --filter @xenonbyte/forma-viewer test` 脚本实存（019 Verification 可执行）；fm-design.md「reuse the product ICON SVG from `componentLibrary.productIcon`」段与 fm-refine-components.md icon unit（role: "icon"）段实存，022 的替换/删除目标真实；shipping 包（core/server/cli）grep 无诊断面，od-diagnostics 未接线。

## 顺序依赖核查

依赖全部前向，无回边：

- M1 内：007（调度器）用 004 目录 + 005 凭证 + 006 暂存，序 4<5<6<7 ✓；008（store）用 007 ✓；009（管线）用 006 的 resolve ✓；010（MCP）用 008 ✓；011（server）用 005/007 ✓；012（web）用 011 ✓。
- `brand/` 预留位接力：006 步骤 3 在 M1 显式抛 `MEDIA_IMAGE_NOT_FOUND`（details 注明 brand 不存在）并「预留 M3 转发位」；015 步骤 3 明确「image-staging.ts 的 brand/ 前缀转发接到本函数（替换 M1 预留位）」，且 015 Verification 同时跑管线测试补 brand/ 用例。闭环清晰。
- **image-prompts.md 的 M4→M3 前移**：020 步骤 1 明确记录原因——「需求文档将本文件排在 M4，因 fm-app-icon（M3）依赖 app-icon 脚手架，计划将创建提前到 M3 一次到位，M4 不再二次创建」。核对需求文档属实：§6 M3b 写明 fm-app-icon「按 craft/image-prompts.md 的 app-icon 脚手架构造 prompt」，而该文件原排 §6 M4 第 1 条，原文档存在顺序倒挂，计划修正合理且 020(M3)<021(M3)<023(M4) 序正确。
- 019 的动态分组（「数据有则组现——M5 商店图/海报组无需再改代码」）与 025 步骤 3（「画布分组验证…无代码改动」）首尾呼应，覆盖需求 §6 M5 第 2 条。
- 024（preset 核定）在 025（fm-brand-assets 模板）之前，M5 内序正确；017（M3）的「未知 preset 拒绝」在 preset 表为空时平凡成立，024 接通后语义不变，无前向冲突。

## 验证命令与收口

- 每任务 Verification 均为真实可执行命令：指向既存测试文件（如 001/003/011/018 的 mcp/server/design-context 测试）或本任务创建的测试文件（004-007 的 `packages/core/tests/media/*.test.ts`，落在 vitest 既有 `packages/*/tests/**/*.test.ts` 匹配域内；019 的 `packages/web/src/pages/BrandAssets.test.tsx` 符合 web 测试位置约定）。
- 013 的幂等验证 `node scripts/vendor-lucide.mjs && git diff --quiet packages/core/assets/lucide-icons.json && npx vitest run …` 直接执行 SPEC「再生成 diff 干净」断言，是可执行检查而非口头要求。
- 六条里程碑收口线（002/012/014/022/023/025）全部为 `pnpm test && pnpm typecheck` + 用户 `/check`，与 SPEC Test Matrix「收口」行及需求 §7 一致。
- 自动化测试不打外网约束被任务步骤显式承接（007「测试全程不打网络」、mock fetch；011/017 stub 全链路）。

## 安全任务核查

对照 SPEC-BEHAVIOR-003 / 007（RISK-SEC-001/002/003），无弱化：

- **PLAN-TASK-005**（凭证）：env 三级优先、脱敏读（env 不回尾号）、preserve_api_key、空清空 409/force、0600 新建+收紧、win32 `process.platform` 跳过、无 key 抛 `MEDIA_NOT_CONFIGURED` —— SPEC-003 条目逐项在 Steps 中，无缺失。
- **PLAN-TASK-011**（排除测试）：静态服务与导出端点取不到 media-config.yaml 内容、错误 details 不含 key、脱敏形态（env 不回尾号）均独立成步骤。SPEC-003 还列「诊断包/日志」，shipping 包当前无诊断面（od-diagnostics 未接线），既有导出端点覆盖现实暴露面，可接受（见建议 3）。
- **PLAN-TASK-016**（沙箱）：两层结构（先 localize 再渲染，浏览器层不出现 `forma-image://` + 拦截白名单）与 SPEC-007 一致；四类测试逐条列出（脚本拦截、远程请求拒绝、file 越界拒绝、白名单内预览可用），Skeleton 并保留「http(s): / 协议相对 / 白名单外 file:// / 越界路径一律中止并抛错」全集，无降级图。
- 计费控制（RISK-DEP-002）：count 上限 4 在 core（007）、测试连接最小尺寸单张（011）、真实调用仅手动验收（4 处用户步骤），齐备。

## 无范围蔓延核查

- 25 个任务全部可回溯到需求文档 §3 范围与 §6 里程碑设计；未发现需求外功能（无 Web 生图界面、无多 provider、无版本树、无 monochrome、无标注画布改动）。
- 新依赖仅 `lucide-static`（devDependency，013，锁版本入脚本头注释）——与需求 §6 M2 第 1 条一致；React Flow 复用 viewer 既有 `@xyflow/react`，无新增。
- stub provider 不进设置 UI（004/011 均有约束），与 Non-goals 一致。
- 021 skeleton 的 `count=3` 在需求 §6 M3b「count=3..4」范围内，无越界。

## 建议（非阻塞）

1. **PLAN-TASK-024 Files 清单缺 `packages/core/src/brand-assets.ts`**：Steps 与 Skeleton 都写明 preset 表写入该文件（015 已创建，024 为 modify），但 Files 只列了新测试文件。建议补入并标注 modify，避免执行期文件清单对不上。
2. **PLAN-TASK-020 Files 清单缺 `craft/README.md` 与 slug 断言测试文件**：步骤 2 要求「README 索引同步 + slug 全集断言测试同步」，Files 仅列 `craft/image-prompts.md`。建议补 `craft/README.md` 和 `packages/core/tests/design-context.test.ts`（即其 Verification 指向的测试）。
3. **PLAN-TASK-011 排除面措辞**：步骤写「静态服务与既有导出端点」，SPEC Test Matrix 写「静态服务/zip 导出/诊断」。当前 shipping 包无诊断面，实质等价；建议在任务步骤加一句「诊断面当前不存在（od-diagnostics 未接线），如后续接线需同步排除测试」留痕，防止 M1 后接线时遗漏。
4. **PLAN-TASK-002 插入位置措辞**：「在 `get_style` 步骤之后、生成 brand tokens 之前」较宽——fm-refine-components 现行步骤 5 是 `get_component_baseline`（craft_rules 来源），palette design-read 应插在其后（需求 §6 M0 原文为「步骤 5 之后」）。Skeleton 已让该步骤自行调用 get_component_baseline，语义可达成，但建议执行时与需求原文对齐为「get_component_baseline 之后」。
