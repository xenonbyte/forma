# Design Subagent Review (v3)

Reviewer: read-only review subagent (general-purpose, agentId a127600551554084b), 2026-06-06
Artifact: 05-design.md (version 3)
Prior review: design-subagent-review-v2.md (FAIL, 2 major + 2 minor)

## Verdict
PASS-WITH-NOTES

## Findings
- [note] system.ts 两个锚点均为条件分支：cross-platform deliverable rule 仅在 `platformTargets.length > 1` 时注入（system.ts:414-417），product-realism rule 仅在 `kind ∈ {prototype, template, other}` 时注入（system.ts:419-425）。单一 mobile 目标 + 非 prototype kind 流程只靠 discovery.ts:216/260-261/268 + 确定性 lint 兜底——覆盖成立，但 prompt 逐字断言需构造满足分支条件的 metadata。
- [note] `product.platform` 为可选字段（product.ts:55 optional）；解析后仍可能 undefined → 检查 skipped。设计已使 skipped 可观测，防空转测试覆盖已配置 mobile 产品，可接受；SPEC 注明未配置 platform 产品的行为。
- [note] 05-design.md "ProductDetail 卡片" 消费方例子不准确（ProductDetail 不消费 preview PNG，grep 零命中）；真实消费方（server 流式回传、desktop URL 改写、viewer AnnotationTile 显式 width/height）均不依赖固定尺寸——支持设计结论，仅措辞瑕疵。
- [note] mobile 截图 390×884 与 viewer mobile tile 390×844 高度差 40px：AnnotationTile 显式缩放 `<img>`，约 4.5% 纵向压缩，相比现状（1280×800 压进 390×844）大幅改善，非破坏性。`page.screenshot` 无 fullPage（preview-renderer.ts:65），mobile 预览只含首屏，与现行为一致。

## Resolved findings check
- v2 finding 1（platform 门控空转）: resolved — saveDesignArtifact 内经 deps.products 解析 platform 并回写 manifest（依赖逐项代码核实成立）；防空转集成测试已写入设计。
- v2 finding 2（视口锚定错误）: resolved — mobile 传 viewport 390×884（与 VIEWPORT_PRESETS.mobile 一致）；预览 PNG 尺寸变化经消费方核查无破坏。
- v2 finding 3（requirement.navigation 误入死键清单）: resolved — 已显式排除并加 grep-before-delete 门槛。
- v2 finding 4（system.ts 落点无锚）: resolved — 点名 system.ts:416/424 两条目并限定不再扩散。

## Recommendations（带入 SPEC，非阻断）
1. system.ts 两句的条件性（multi-target / kind 门控）写进 prompt 测试构造说明。
2. 设计文中 "ProductDetail 卡片" 例子在 SPEC 中改述为真实消费方（viewer AnnotationTile / desktop preview_url）。
3. SPEC 注明 platform 未配置产品的 screen-edge-radius 行为（skipped 且可观测）。
