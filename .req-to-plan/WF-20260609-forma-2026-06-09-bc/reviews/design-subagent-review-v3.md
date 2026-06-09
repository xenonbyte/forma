# Design Subagent Review (v3)

## Verdict
APPROVE_WITH_NITS — Central premise (pointer field exists but has zero writers) is CONFIRMED; all 9 code claims hold. One factual imprecision (`get_product_baseline` does NOT read the pointer) and a few SPEC-actionability gaps, none premise-breaking.

## Code-claim verification

1. **CONFIRMED** — `productSchema.designSystemArtifactId?: string` at `packages/core/src/product.ts:61`; writer `setDesignSystemArtifactPointerLocked(productId, artifactId)` at `product.ts:270-274` (parses `{...product, designSystemArtifactId: artifactId}` and atomically writes). Both exist exactly as claimed.

2. **CONFIRMED (the load-bearing one)** — `grep -rn "setDesignSystemArtifactPointerLocked" packages/*/src` returns exactly ONE hit: the definition at `product.ts:270`. ZERO callers. The pointer is never written today. Central premise holds — the design's "activate existing pointer" framing is correct.

3. **CONFIRMED** — `generateComponents` (`packages/core/src/store.ts:220-238`) calls `saveDesignArtifact` with `kind: "component-library"`, passes NO `artifactId`, and does NOT call `setDesignSystemArtifactPointerLocked`. Each run therefore mints a fresh artifactId (parallel artifacts). Exactly the B2 problem.

4. **CONFIRMED** — `design-save.ts:207`: `const artifactId = input.artifactId ?? generateArtifactId();`. `setDesignPointerLocked` is called in the `afterWriteLocked` hook (`design-save.ts:260-266`) gated by `if (kind !== "design-page" || !forma.requirementId || !forma.pageId) return;` — design-page only. Matches the claim.

5. **CONFIRMED** — `rollbackDesignPointerLocked` (`product.ts:302`) has exactly ONE caller: `packages/mcp/src/tools.ts:1017` (inside the `rollback_requirement_design` handler). Once R5 removes that tool, it is genuinely dead. The design (DES-ARCH-001) correctly commits to grep-reconfirming before deletion.

6. **CONFIRMED with a naming caveat (see Findings #1)** — `get_product_baseline` IS in the MCP tool list (`tools.ts:41`) and the design keeps it distinct from the NEW `get_component_baseline` (which does NOT exist yet — `grep` returns nothing for `get_component_baseline`/`component-baseline`/`componentBaseline` across `packages/*/src`). The distinction (existing "product's generated DS" vs. new "Forma built-in spec") is preserved (OPT-D, line 51). BUT the design's *evidence* for "reads the pointer" is misattributed — see Finding #1.

7. **CONFIRMED** — `ArtifactFormaExtension` (`artifact-manifest.ts:73-86`) has fields `requirementId, pageId, variant, brandStyle, systemStyle, platform, language, provenance, quality, preview, assets` — NO `productIcon`. `validateFormaExtension` exists at `:104`; `normalizeKind` at `:93` already maps legacy `design-system`→`component-library`. The new field is genuinely absent today.

8. **CONFIRMED** — `buildDesignContext` (`design-context.ts:30`) returns `{ craft, brandStyle, systemStyle, page, rules, platform, language }` (`:69`) — no `componentBaseline`/`componentLibrary`. Matches exactly.

9. **CONFIRMED** — `formaToolNames` (`tools.ts:35-65`) contains `delete_product` (:40), `change_artifact_style` (:59), `rollback_requirement_design` (:56), all three removal targets. `create_product`/`createProduct` is absent from all of `packages/mcp/src/` (grep: NONE). The 4 read tools (`get_design_handoff`/`get_page_ui`/`get_ui_node`/`search_page_ui`) are present and untouched.

## Coverage & consistency

- **SCOPE-IN coverage**: All 16 SCOPE-IN-001..016 map to a DES-ARCH unit (Requirements Coverage table lines 28-45 + Trace lines 125-135). No orphan scope item. All 10 DES-ARCH units trace back to ≥1 SCOPE-IN (no orphan design unit). Cross-check is internally consistent.
- **AC-001/AC-002 alignment**: Final command set of 6 and MCP net change +1/−3 are consistent with DES-ARCH-001 (removes delete_product, rollback_requirement_design), DES-ARCH-007 (removes change_artifact_style), DES-ARCH-006 (adds get_component_baseline). Arithmetic checks out.
- **B7 systemStyle**: Design line 73 says `systemStyle` is delivered structurally "既有，非 bug" — matches raw-requirement B7 item5 (`get_style(system_style)` returns metadata, not a bug). Consistent.
- **No scope creep detected**: Design explicitly honors SCOPE-OUT-003 (底层版本机制 zero-change, DES-ARCH-009 line 82), SCOPE-OUT-002 (后台删除路径 retained, DES-ARCH-001), SCOPE-OUT-001 (4 read tools untouched), SCOPE-OUT-006 (ICON mark only, no VI/icon-library, DES-ARCH-004), SCOPE-OUT-007 (no engine swap, OPT-E/DES-ARCH-010). ICON reuse-geometry-only-recolor is repeatedly constrained.

## Risk handling

All high-severity risks are addressed:
- **RISK-SAFETY-001** → MIT-001 / DES-ARCH-001 (MCP shell only; `store.deleteProduct`/HTTP/web retained). Verified `store.deleteProduct` is shared by `delete_product` handler at `tools.ts:419` and is preserved.
- **RISK-MIG-001** → DES-ARCH-001 + Rollback section + Observability (CHANGELOG breaking-change note; git-revert, not runtime downgrade). Adequate.
- **RISK-MIG-002** → DECISION-001 = Option B (no migration). See DECISION assessment below.
- **RISK-MIG-003** → DES-ARCH-004 + Rollback (additive optional `forma.productIcon`; missing field → no ICON tile, no throw). Sound; matches the additive-field reality verified in claim #7.
- **RISK-CONTRACT-001** → DES-ARCH-005 single-source-of-truth收口 across `list_product_artifacts`/`get_product_artifact`/`get_design_context`/web BrandResources + contract tests. Sound.
- **RISK-DEP-001/002/003** → MIT-004 + SPEC Handoff sequencing (R1/R4/R5→B1–B7→R3→R2; BC3 after B2/B7; DesignView W2/BC2 serialized). DesignView.tsx confirmed at `packages/web/src/pages/DesignView.tsx`; both `version_count` (api.ts:249) and the canvas host exist, so the collision is real and correctly flagged.
- **RISK-REG-002** → DES-ARCH-009 retains `current_version` internal pointer + test for non-max current_version. Sound.
No unmitigated high-severity risk found.

## Findings

1. **(minor) — Design "Current Code Evidence" line 17 misattributes the pointer-read to `get_product_baseline`.**
   Location: `05-design.md:12` and `:17` ("`getBaselinePage`/`getBaselineImage`/`get_product_baseline`（:420）读它 → 现网恒 `ARTIFACT_NOT_FOUND`").
   Issue: `getProductBaseline` (`tools.ts:1126`, wired to tool `get_product_baseline` at `:420`) does NOT read `designSystemArtifactId` at all — it builds the baseline from *requirement history* (`getRequirementHistory` + page aggregation, `tools.ts:1126-1160`) and never throws ARTIFACT_NOT_FOUND for a missing pointer. The tools that actually read the pointer and throw are `get_baseline_page` (`getBaselinePage`, `tools.ts:1225`) and `get_baseline_image` (`getBaselineImage`, `tools.ts:1244`) — distinct tool names from `get_product_baseline`. So the "≥3 read surfaces consume the pointer" / "these baseline tools always throw ARTIFACT_NOT_FOUND" claim over-counts by one and names the wrong tool.
   Impact: Does not break the central premise (pointer still has zero writers; `get_baseline_page`/`get_baseline_image` genuinely throw today). But it muddies the DES-ARCH-005 side-effect claim ("既有 baseline 读取工具随之恢复可用") — only the two `get_baseline_*` tools recover; `get_product_baseline` was never broken and is unaffected.
   Suggested fix: In DES-ARCH-005 and Current Code Evidence, replace `get_product_baseline` with `get_baseline_page` + `get_baseline_image` as the pointer-dependent read surfaces, and drop `get_product_baseline` from the "恢复可用" side-effect list.

2. **(minor) — `componentLibrary` delivery contract under-specified for SPEC.**
   Location: DES-ARCH-006 (`:73`) + OPT-C (`:50`).
   Issue: The design picks "structured reference (artifact_id/version/bundle·preview/manifest productIcon) + on-demand read; HTML optional/truncatable." But the exact shape — which on-demand read surface serves the current-library HTML, whether a new tool or reuse of `get_product_artifact`/`export_artifact`, and the truncation threshold — is left as "按需/可截断" without a concrete decision. RISK-CONTRACT-002 demands a bounded delivery form.
   Suggested fix: In SPEC Handoff, require the spec to name the concrete read surface for component HTML (reuse existing `get_product_artifact`/`export_artifact` vs. new field) and a definite truncation policy, so the spec author isn't re-deciding OPT-C.

3. **(minor) — DECISION-001 Option B leaves an observability gap for legacy products hitting B4 stop.**
   Location: DECISION-001 (`:88-96`) + DES-ARCH-008 (`:78`).
   Issue: Option B (no migration) is internally consistent and sound — it is the only option that doesn't violate the "禁止用 updated_at/顺序/superseded 推断" constraint, and it self-aligns with B4 "先有设计系统" semantics. No objection to the decision. The gap: for an EXISTING product that already ran `fm-refine-components` (has a parallel `component-library` artifact but unset pointer), `fm-design` will now stop with "no component library" even though a library visibly exists in `list_product_artifacts`. The two-stage stop message must distinguish "never refined" from "refined-but-no-pointer (legacy)" or the user will be confused ("I already have one"). Design doesn't spell this out.
   Suggested fix: DES-ARCH-008's stop message should explicitly cover the legacy case (artifact exists but no pointer → "re-run fm-refine-components once to adopt it"), matching DECISION-001's rationale.

4. **(nit) — Claim that ICON `shape` reuse is "稳定" relies on a manifest field that does not yet exist.**
   Location: DES-ARCH-004 (`:67`), `productIcon.shape: { geometryId/shapeId/sourceVersion }`.
   Issue: This is net-new (confirmed: no `productIcon` in `ArtifactFormaExtension`). The design says "已有当前 ICON 时复用 shape geometry、只按新 tokens 重新着色" but the actual reuse mechanism (re-render same SVG path data vs. re-derive from a stored geometry id) is not pinned. For SPEC this is the difference between "store the SVG path string" and "store a geometry id resolvable to path data."
   Suggested fix: SPEC should pin whether `shape` carries reusable geometry (the SVG path/markup) or merely an identifier, since "复用 geometry 只套色" is only achievable if the actual path data is recoverable from the manifest/bundle.

5. **(nit) — `get_baseline_page`/`get_baseline_image` are NOT in the design's SCOPE-OUT-001 read-tool list, yet DES-ARCH-005 changes their behavior (they start succeeding).**
   Location: DES-ARCH-005 side-effect (`:70`) vs. SCOPE-OUT-001 (the 4 named read tools).
   Issue: SCOPE-OUT-001 protects only `get_design_handoff`/`get_page_ui`/`get_ui_node`/`search_page_ui`. `get_baseline_page`/`get_baseline_image` are a separate pair whose runtime behavior flips from "always throw" to "return data" once the pointer is written. This is an intended, benign behavior change, but it is not called out as a consequence anywhere, and there appear to be no existing tests asserting their current throwing behavior that would need updating. Low risk, but the spec should add coverage for these two tools post-pointer-activation.
   Suggested fix: Add `get_baseline_page`/`get_baseline_image` success-path tests to the DES-ARCH-005 contract-test matrix in SPEC Handoff.

## Notes for SPEC stage

- The central premise is solid: the pointer field + writer exist and the writer is unused, so B2/B7 is genuinely "wire the existing writer + read it back," not a new data contract. SPEC can trust this.
- Fix the `get_product_baseline` vs. `get_baseline_page`/`get_baseline_image` naming throughout (Finding #1) before deriving the DES-ARCH-005 test matrix, or the spec will write a test against the wrong tool. The pointer-dependent tools are `get_baseline_page` (`get_baseline_page`→`getBaselinePage`, throws on unset pointer) and `get_baseline_image` (`getBaselineImage`, throws on unset pointer). `get_product_baseline` is history-driven and orthogonal.
- `change_artifact_style` removal (DES-ARCH-007) touches more core than the others: `store.ts` interface (`:84`), `changeArtifactStyle` (`:240`), `changeArtifactStyleWithManifest` (the only caller of which is `changeArtifactStyle`), and export (`:307`). Confirmed `changeArtifactStyleWithManifest` is reachable only via `changeArtifactStyle` in the snippet read — SPEC must grep-reconfirm no other caller before deleting, as the design states.
- DesignView.tsx W2/BC2 serialization is a real concern: `version_count` filtering lives in the web layer (api.ts:249 type + DesignView.test.tsx:78/90 fixtures) and the canvas host is the same file. Treat as a single change batch.
- `get_component_baseline` and `packages/core/src/component-baseline.ts` are genuinely greenfield (zero existing references). SPEC owns defining the full web (~28 components / 6 groups) and mobile spec field-by-field — the raw requirement (B2 lines 474-486) gives the authoritative list; mirror it into `component-baseline.ts` verbatim, not paraphrased.
- The `/rollback/plan` residual in `packages/web/src/api.ts:747` (plus `api.test.ts:547`) is intentionally left untouched per SCOPE-OUT-004 and DES-ARCH-009; do not "clean it up."
