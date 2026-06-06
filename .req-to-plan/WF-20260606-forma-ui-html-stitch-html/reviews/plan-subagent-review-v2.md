# Plan Subagent Review (v2)

Reviewer: read-only review subagent (general-purpose, agentId adebd2d9222278911), 2026-06-06
Artifact: 07-plan.md (version 2)

## Verdict
PASS-WITH-NOTES

## Findings
- [minor] i18n 文件归属缺口：TASK-005/007 的测试需要新 i18n 键，但 `packages/web/src/i18n.ts` 仅在 TASK-009 Files 中；009 步骤自认"随 005/007 同步落键"，与文件清单矛盾。非阻断（t() 缺键回退键名；009 终验收口）。→ 修订：005/007 Files 补 i18n.ts。
- [minor] TASK-005 验证命令 rg 护栏 `… || true` 永不失败，仅供目检。→ 修订：改断言式 `! rg -n "ViewerPage" packages/web/src`。
- [note] TASK-004 不并存断言在现状下为同义反复，但正是 MIT-001/RISK-SEC-002 要求的契约固化，非缺陷。
- [note] ViewerPage.test.tsx 现 mock `Viewer`+`buildViewerModel`；迁入 DesignView.test.tsx 时需换为 mock `Canvas`。→ 修订：TASK-005 步骤注明。
- [note] `ArtifactSummary` 已在 api.ts:233 有同形导出，TASK-005 步骤 4 两条路均零成本。
- [note] od-contracts 测试直 import src，TASK-003 验证无需先 build:od。

## Coverage check
- SPEC-BEHAVIOR-001..010 全部被任务消费，无缺口；测试矩阵（TEST-PROMPT/CORE/WEB/VIEWER/ALL）全部落入任务步骤；spec 评审 carry-over 两项均在 TASK-005 步骤 1/2。
- 顺序核查通过（001→002 依赖、006→007 依赖、003/004 独立、009 收口）。
- 文件真实性：9 任务 25 文件全部存在，行锚点逐一核实；待删 i18n 键存在、待增键无碰撞。
- 骨架 vs SPEC 无矛盾（四态语义、DEFAULTS 收窄、390×884/844 区分、签名逐字一致）。
- 验证命令可运行（viewer 浏览器测试经 vitest list 实测由 chromium 项目拾取）。

## Recommendations（已采纳，修订 v3）
1. TASK-005/007 Files 增补 `packages/web/src/i18n.ts`。
2. TASK-005 验证命令 rg 护栏改断言式。
3. TASK-005 步骤 1 注明 mock 迁移把 `Viewer` 换成 `Canvas`。
