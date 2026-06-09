# Design Subagent Review (v4 — diff verification)

## Verdict
APPROVE — All 5 v3 findings landed correctly in v4; the central premise still holds, the `get_product_baseline` history-driven correction is factually verified against source, and no new error or contradiction was introduced.

## v3 findings disposition
1. **RESOLVED** — Pointer-read now correctly attributed to `get_baseline_page`/`get_baseline_image`, with explicit "`get_product_baseline` is history-driven / unaffected" notes in all three required places:
   - Design Summary: `05-design.md:12` — "已被 2 个读取面消费（`get_baseline_page`/`getBaselinePage:1225`、`get_baseline_image`/`getBaselineImage:1244`）… 故这两个 baseline 工具当前恒抛 `ARTIFACT_NOT_FOUND`。（注：另有 `get_product_baseline` 工具是 history-driven、与该指针无关、不受影响。）"
   - Current Code Evidence: `05-design.md:17` — "`getBaselinePage`（`tools.ts:1225`…）/`getBaselineImage`（:1244…）读它 → 现网恒 `ARTIFACT_NOT_FOUND`。**注**：`get_product_baseline`（handler `getProductBaseline`，:420）**不读该指针**——它由需求历史聚合（history-driven），与本指针正交、不受影响（评审 v3 修正）。"
   - DES-ARCH-005 side-effect: `05-design.md:70` — "副作用：既有 `get_baseline_page` / `get_baseline_image` 随之从"恒抛 ARTIFACT_NOT_FOUND"恢复可用（`get_product_baseline` 为 history-driven、与指针无关、不受影响）"
   Verified against source: `designSystemArtifactId` is referenced only inside `getBaselinePage`/`getBaselineImage` (tools.ts:1225,1228,1244,1248); `getProductBaseline` (1126–1222) builds from `getRequirementHistory` + page aggregation and never reads the pointer.

2. **RESOLVED** — SPEC Handoff now requires the spec to name the concrete read surface + truncation policy: `05-design.md:119` — "componentLibrary 交付形态定型（评审 v3 #2 / RISK-CONTRACT-002）：SPEC 须明确"当前组件库 HTML"的具体读取面——复用既有 `get_product_artifact`/`export_artifact` 还是新增字段——并给出确定的截断/体量策略，不把 OPT-C 的"按需/可截断"留给 spec 再决策。"

3. **RESOLVED** — DES-ARCH-008 stop message now distinguishes "never refined" vs "legacy: has parallel artifact but no pointer": `05-design.md:79` — "停下提示须区分两种缺指针情形（落实 DECISION-001 选项 B 的可用性）：①从未精修过组件 → "先跑 fm-refine-components 生成设计系统"；②存量产品已有并列 component-library artifact 但指针未设（legacy）→ "已检测到旧组件库但未登记为当前；重跑一次 fm-refine-components 以采纳并接管后续版本"，避免用户困惑"我明明已经有组件库"。"

4. **RESOLVED** — SPEC Handoff now requires the spec to pin geometry-vs-id for `shape`: `05-design.md:120` — "产品 ICON shape 可复用性定型（评审 v3 #4）：SPEC 须钉死 `forma.productIcon.shape` 携带的是**可复用 geometry（SVG path/markup 本体）**还是仅标识符——"复用 geometry 只套色"只有在 path 数据可从 manifest/bundle 恢复时才成立。"

5. **RESOLVED** — SPEC Handoff now adds the two baseline tools' success-path tests to the contract-test matrix: `05-design.md:121` — "baseline 工具行为翻转测试（评审 v3 #5）：DES-ARCH-005 指针激活后 `get_baseline_page` / `get_baseline_image` 由"恒抛"变"返回数据"，属预期良性变化但当前无断言其抛错的测试；SPEC 须把这两个工具的成功路径纳入契约测试矩阵。" Also reinforced in DES-ARCH-005 itself (`:70`: "二者的成功路径须补测试（见 SPEC Handoff）").

## Premise re-check
- **Zero-writers still true**: `grep -rn "setDesignSystemArtifactPointerLocked" packages/*/src` returns exactly ONE hit — the definition at `product.ts:270`. No callers. B2/B7 remains "wire the existing pointer." CONFIRMED.
- **get_product_baseline history-driven**: CONFIRMED at source. `getProductBaseline` (tools.ts:1126) calls `getRequirementHistory` + aggregates pages; its body contains no `designSystemArtifactId` reference. The only `designSystemArtifactId` reads in tools.ts are in `getBaselinePage` (1225/1228) and `getBaselineImage` (1244/1248). The v4 attribution matches reality exactly.
- **New error introduced?** None. The edits are additive corrections; line-number anchors (1225/1244, :420, :270, :206-207, :302, :1017) remain consistent with prior verification. DES-ARCH-005's "已被 2 个读取面消费" count is now correct (was over-counted as 3 in v3).
- **DECISION-001**: Status still `selected` (`:96`), `Selected: B` (`:95`), Decision/Decided By intact (`:93-94`); Trace table intact with `DECISION-001 | RISK-MIG-002, SCOPE-IN-007, SCOPE-IN-012 | selected` (`:138`) and all 10 DES-ARCH rows present (`:128-137`).

## Residual findings
None. The v4 corrections are precise, the source-of-truth (zero writers, history-driven `get_product_baseline`) is reconfirmed against code, and no regression or contradiction was introduced.
