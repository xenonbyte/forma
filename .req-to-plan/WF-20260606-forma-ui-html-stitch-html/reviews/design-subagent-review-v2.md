# Design Subagent Review (v2)

Reviewer: read-only review subagent (general-purpose, agentId aea3f7f3e7bcc8168), 2026-06-06
Artifact: 05-design.md (version 2)

## Verdict
FAIL

## Findings

- [major] DES-LINT-001 的 `platform` 门控在生产路径上永远不会触发。`SaveDesignInput.forma.platform`（design-save.ts:50）存在但从未被填充：`generateRequirementDesignSchema` 为 `.strict()` 且无 `platform` 字段（packages/mcp/src/tools.ts:234-245），handler 不传 platform（tools.ts:448-457）；`generate_components`、`change_artifact_style` 同样没有。结果 `forma.platform === undefined`，`screen-edge-radius` 永远输出 "skipped"——DEC-004 双重防线静默空转。应在 `saveDesignArtifact` 内经 `deps.products`（SaveDesignDeps 已含，design-save.ts:74-78）从产品记录读取 platform。
- [major] `rootCorners` 的"覆盖视口 ≥98% 宽"启发式锚定在错误视口。design-save.ts:147 调用 `renderArtifactPreview` 不传 viewport，默认 1280×800（preview-renderer.ts:33），与移动端 390 宽不匹配；固定宽 ~390px 居中圆角"屏幕剪影"容器在 1280 视口下永远达不到 98% 阈值，检查系统性漏报。需按平台视口渲染快照或改用视口无关判定。
- [minor] 死键清单含仍在使用的 `requirement.navigation`（BaselineView.tsx:213 在用）。
- [minor] DES-PROMPT-001 的 system.ts 落点无锚：system.ts 无 "device shell" 字样；最接近条目为 cross-platform deliverable rule（system.ts:416）与 product-realism rule（system.ts:424）。SPEC 前需点名条目或显式收窄为 discovery.ts-only。
- [note] routes.test.ts 无 viewer 路由引用（更新为 no-op）；需删除的测试是 ViewerPage.test.tsx。
- [note] RequirementDetail 仅 import `ArtifactSummary` 类型（未用 filterDesignArtifacts）；设计的处置（保留导出或上移 api.ts）正确。
- [note] 既有 mobile de-shell 测试（system-prompt.test.ts:111-120）是否定式断言；新增"固定语句逐字出现"为不同模式，可行。
- [note] 其余 Current Code Evidence 全部核实无误（discovery.ts 行号、craft-lint 结构、Canvas props、DesignTile sandbox、buildViewerModel 形状、server 字段、Layout WorkSurface、PlatformTemplatePreview 手机壳 mock、desktop 依赖面、fm-design 自审机制）。

## Coverage check
- AC-001: DES-PROMPT-001 覆盖；DES-LINT-001 按 v2 设计空转（major #1/#2），修订后成立。
- AC-002: DES-WEB-001 + DES-ROUTE-001 覆盖。
- AC-003 / AC-004: DES-WEB-002 覆盖。
- AC-005: DES-WEB-001 + DES-WEB-002 覆盖。
- AC-006: DES-TEST-001 覆盖。
- 一致性：与 MIT-001/MIT-002/MIT-006 无矛盾；不动 desktop 三栏 Viewer 的承诺成立。

## Recommendations
1. DES-LINT-001：platform 在 `saveDesignArtifact` 内经 `deps.products` 读取；补"mobile 保存产生非 skipped 的 screen-edge-radius 结果"的集成测试。
2. DES-LINT-001：mobile 按平台视口渲染快照（core 已有先例：requirement-vzi-capture 的 VIEWPORT_PRESETS，mobile→390×884），或视口无关判定。
3. 死键清单去掉 `requirement.navigation`。
4. DES-PROMPT-001：点名 system.ts:416/424 追加直角句式，或显式 discovery.ts-only 并标注偏离。

## Disposition
按 1-4 修订 05-design.md 后重新过门。
