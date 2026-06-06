# Spec Subagent Review (v4, delta)

Reviewer: read-only review subagent (general-purpose, agentId a2f8ae24c00d61362), 2026-06-06
Artifact: 06-spec.md (version 4)
Prior review: spec-subagent-review-v3.md (PASS-WITH-NOTES, 1 major + 3 minor + notes)

## Verdict
PASS-WITH-NOTES

## Resolved items check
- v3 item 1（TEST-WEB-001 拆分）: resolved — TEST-WEB-001 改为 viewer mock 断言（ViewerPage.test.tsx:8 惯例核实）；新增 TEST-VIEWER-001 落在 DesignTile.browser.test.tsx（既有断言 :55-60，vitest.config.ts:64-69 chromium 项目核实）。
- v3 item 2（TEST-CORE-003 钉死）: resolved — design-save.test.ts 真实渲染惯例核实（零 vi.mock、已 import sharp，宽 390 断言可行；renderArtifactPreview 模块级 import 无注入缝）。
- v3 item 3（rootCorners 专属测试）: resolved — TEST-CORE-004 落 quality-rendered-dom.test.ts（真实渲染 + extractDom: true 核实）。
- v3 item 4（DEFAULTS 冲突）: resolved — SPEC-BEHAVIOR-004 注明 `Required<Omit<LintOptions, "platform">>` 收窄（craft-lint.ts:16 核实）。
- v3 item 5（三个 note）: resolved — TEST-WEB-007 点名两文件（锚点断言核实）；SPEC-BEHAVIOR-007 冗余子句已删且替换论据正确（artifact-manifest.ts:87-95、routes.ts:596）；SPEC-BEHAVIOR-002 双视口"刻意不同"注记已加（两侧数值核实）。

## New findings
- [minor] TEST-WEB-002 文件列 "同上" 因 TEST-VIEWER-001 行插入而悬空指向 viewer 浏览器测试文件；实际应为 `web/src/pages/DesignView.test.tsx`。**处置：PLAN 阶段任务中显式点名该文件，不再回改 SPEC（避免空转评审循环）。**
- [note] TEST-WEB-001 引用的惯例样板 ViewerPage.test.tsx 在同一 PR 的步骤③被删除——PLAN 中提示实现者先迁移 mock 模式再删文件。
- [note] 只读上游区仍含旧 DES-TEST-001 措辞（sandbox 断言在 DesignView.test.tsx）——上游为不可变副本，PLAN 以 Test Matrix 为准。

## Recommendations（带入 PLAN）
1. PLAN 任务中 TEST-WEB-002 显式落 `web/src/pages/DesignView.test.tsx`。
2. PLAN 步骤③注明：先把 ViewerPage.test.tsx 的 viewer mock 模式迁入 DesignView.test.tsx，再删除 ViewerPage 文件对。
