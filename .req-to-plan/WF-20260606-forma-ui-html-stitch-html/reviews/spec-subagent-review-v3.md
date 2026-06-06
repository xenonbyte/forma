# Spec Subagent Review (v3)

Reviewer: read-only review subagent (general-purpose, agentId a74898d95e700cf72), 2026-06-06
Artifact: 06-spec.md (version 3)

## Verdict
PASS-WITH-NOTES（major 项为测试落点修正，已决定按建议修订 SPEC 后再过门）

## Findings
- [major] TEST-WEB-001 的 sandbox 断言按规定位置无法落地：web 组件测试惯例整体 mock viewer 包（ViewerPage.test.tsx:8），happy-dom 下真实 iframe 不会出现；且 `onlyRenderVisibleElements` 开启时零尺寸容器裁剪所有 tile。该契约实际由 `packages/viewer/src/tiles/DesignTile.browser.test.tsx:55-59`（真实 chromium）守住。应把 sandbox/不并存断言指向该文件，DesignView.test.tsx 改为经 viewer mock 断言 Canvas 收到模型、无 PNG 网格。
- [minor] TEST-CORE-003 "mock 渲染器或注入 deps" 中"注入 deps"路径不存在（renderArtifactPreview 为模块级 import，不在 SaveDesignDeps）。可行路径：vi.mock preview-renderer 或沿用 design-save.test.ts 真实渲染惯例。需钉死。
- [minor] SPEC-BEHAVIOR-003 页内提取逻辑无专属测试：body 恒采集使 TEST-CORE-003 的"非 skipped"无法抓住全幅子元素启发式/radius 解析的假阴性。应在 quality-rendered-dom.test.ts 补真实渲染 rootCorners 用例。
- [minor] `LintOptions` 加 `platform?` 会撞 `Required<LintOptions>` DEFAULTS 结构（craft-lint.ts:16），需注明 platform 不进 DEFAULTS。
- [note] SPEC-BEHAVIOR-007 "排除 design-system/component-library" 子句冗余（服务端 kind=html 归一过滤已仅返回 design-page，routes.ts:596）。
- [note] 390×884（渲染视口）与 390×844（画布 tile）刻意不同，SPEC 应点明防"统一"。
- [note] TEST-WEB-007 未点名落点（实际锚点测试在 StylePickerDialog.test.tsx:240-254、ProductNew.test.tsx:163-330）。
- [note] 隐藏依赖核查全部通过（Canvas 导出、resolver、api client 形状、ui_affected、StatePanel、WorkSurface、i18n 键无碰撞、manifest.platform、SaveDesignDeps.products、system.ts 条件分支等）；与已批准 design 无矛盾。

## AC coverage
AC-001..AC-006 全部覆盖（明细见评审输出；AC-002 的 sandbox 子断言落点按 major 项修正后成立）。

## Recommendations（已采纳，修订 SPEC v4）
1. TEST-WEB-001 拆分：sandbox+不并存断言 → DesignTile.browser.test.tsx；DesignView.test.tsx 经 mock 验证 Canvas props 与无 PNG 网格。
2. TEST-CORE-003 钉死为 design-save.test.ts 真实渲染惯例（断言 1x.png 宽 390 + 非 skipped screen-edge-radius）。
3. 测试矩阵补 TEST-CORE-004：quality-rendered-dom.test.ts 真实渲染 rootCorners 提取（圆角/直角/百分比）。
4. TEST-WEB-007 点名 StylePickerDialog.test.tsx / ProductNew.test.tsx。
5. SPEC-BEHAVIOR-007 删冗余子句；SPEC-BEHAVIOR-004 注明 platform 不进 DEFAULTS；SPEC-BEHAVIOR-002 点明双视口数值刻意不同。
