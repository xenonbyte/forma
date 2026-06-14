# PLAN Subagent Review — v2 (brand-assets-optimization)
Reviewer: read-only subagent · Date: 2026-06-14

## Verdict
APPROVE WITH CHANGES — the 11 tasks are a valid topological order, every SPEC id is covered, the deletion sweep and prior-review concerns are honored, and all create/modify file refs resolve; one real coverage gap (the `PUT …/brand-asset-settings` server route + its test belong to no task's `Files:` block) and one filename inconsistency (`brand-icon-derive.ts` vs `icon-derive.ts`) must be fixed before execution.

## Blocking Findings

1. **Server route `PUT /api/products/:id/brand-asset-settings` + its test are required but unassigned to any task.** The PLAN body mandates this route in three places — §6 (07-plan.md:1183 "`packages/server/src/routes.ts`：新增 `PUT /api/products/:id/brand-asset-settings`"), the CLAUDE.md route-count bump (:1236 "7 → 8"), and the §8 verification list (:1276 "server 路由测试（brand-asset-settings PUT）") — and it is the wire that lets T8's settings UI actually persist (`save → updateBrandAssetSettings`, T8 skeleton :201). But scanning every PLAN-TASK `Files:` block (07-plan.md:13-283) shows **no task lists `packages/server/src/routes.ts` or `packages/server/tests/routes.test.ts`** (confirmed: zero `server` hits in the task definitions). T1 owns the core `updateBrandAssetSettings` method (:38) and T8 owns the web client, but the HTTP endpoint between them has no owner. Fix: add `packages/server/src/routes.ts` + `packages/server/tests/routes.test.ts` (both exist today) to T8's `Files:` (or split a dedicated server task), with a step to register the route → `store.updateBrandAssetSettings` (partial write, product lock) and a route test for the PUT. Without this, AC-008 (settings save changes the plan) is unimplementable as the tasks are written.

## Advisory Findings

1. **Icon-derive filename is inconsistent within the PLAN — `brand-icon-derive.ts` vs `icon-derive.ts`.** T3's `Files:` block + verification (07-plan.md:90-91, :111) and SPEC-DATA-005 (:399) name the new module `packages/core/src/brand-icon-derive.ts` (+ `brand-icon-derive.test.ts`). But the PLAN's lower body names it `icon-derive.ts`: design prose (:1150, :1166), §8 test list (:1276 "`icon-derive.test.ts`"), and Appendix B (:1317 "`packages/core/src/icon-derive.ts`(+`icon-derive.test.ts`)"). Both are "create" so neither pre-exists (verified absent), but an executor following Appendix B vs the task block would create divergent paths and the §8 `npx vitest run …/brand-asset-plan.test.ts …/brand-assets.test.ts …/media/` command never names the icon test at all under either name. Fix: pick one name (recommend `brand-icon-derive.ts` per the task block + SPEC) and make Appendix B / §8 / §6 prose match; ensure the §8 vitest invocation includes the icon-derive test file.

2. **`save_brand_asset` discriminated-union RETURN type is specified in prose but not pinned as a type in any skeleton.** SPEC-DATA-006 / SPEC-BEHAVIOR-005 define a union return (`{kind:"app-icon"; assets: BrandAssetRecord[]}` vs `{kind:…; asset: SavedBrandAsset}`); T4's skeleton (07-plan.md:125) does declare `SaveBrandAssetResult` as that union, and T7 step asserts `{assets:[...]}`. This is honored — flagging only that the html-kind branch return shape (`{asset: SavedBrandAsset}`) should get an explicit TM-07/TM-10 assertion so the union is pinned on both arms (matches spec-review-v2 Advisory-1, which is otherwise absorbed).

3. **store.ts deletion under-itemization is already corrected in this PLAN.** spec-review-v2 noted SPEC-DATA-008 named only :18 + "转发"; the embedded SPEC-DATA-008 here (07-plan.md:437) explicitly says "value-import(:11) 与 type-import(:18)…逐处清理" and the design-review-v3 sweep (:110 interface, :350 binding) is reflected in T5's skeleton (:153 "接口方法:110+impl"). All four store.ts sites (:11/:18/:110/:350) confirmed present in code and accounted for. No action.

## SPEC Coverage

Every SPEC id maps to at least one task's Spec References (cross-checked against 06-spec.md's id set, SPEC-BEHAVIOR-001..009 + SPEC-DATA-001..008 — 17 ids):

- SPEC-BEHAVIOR-001 → T6 · 002 → T1 · 003 → T2 · 004 → T3 · 005 → T4 · 006 → T4 · 007 → T5 (+ T11 verification) · 008 → T8 & T9 · 009 → T10
- SPEC-DATA-001 → T1 · 002 → T1 · 003 → T2 · 004 → T2 · 005 → T3 · 006 → T4 · 007 → T7 · 008 → T5

No SPEC id is orphaned. TM-01..13 each have a task verification: TM-01→T6, TM-02/04/05→T1, TM-03→T2, TM-06→T3, TM-07/08→T4, TM-09→T5, TM-10→T7, TM-11→T8+T9, TM-12→T10, TM-13→T11. Note SPEC-DATA-008's doc bullet (root `CLAUDE.md` `list_store_shot_presets`/`name="primary"` removal) is delivered by T10 (CLAUDE.md sync) rather than T5 — acceptable since both are in scope, but T5's grep-zero verification (07-plan.md:160) runs before T10, so the CLAUDE.md doc lines are not caught by T5's grep (it greps `packages/`, not root `CLAUDE.md`). Minor: ensure T10 or T11 greps root CLAUDE.md too.

## File-Ref & Ordering

**File refs — all accurate.** Create files for T2/T3 (`brand-asset-plan.ts`/`.test.ts`, `brand-icon-derive.ts`/`.test.ts`) confirmed absent. Every modify/delete file in all task `Files:` blocks confirmed to exist: schemas.ts, brand-assets.ts, product.ts, brand-assets.test.ts, product-config.test.ts, store.ts, tools.ts, tools.test.ts, store-shot-presets.test.ts, media/image-models.ts, media/image-generate.ts, media/image-models.test.ts, ProductDetail.tsx, i18n.ts, ProductDetail.test.tsx, BrandAssets.tsx, BrandAssets.test.tsx, template-parity.test.ts, craft/image-prompts.md, CLAUDE.md, and all 7 agent templates (claude/codex/gemini fm-app-icon, fm-brand-assets, fm-design). Only gap is the unlisted server route file (BLOCKING-1) and the filename inconsistency (Advisory-1).

**Ordering — valid topological order, no backward dependency.** Confirmed each task only consumes symbols/files produced earlier:
- T1 produces `BrandSurface`/`brandSurfacesForPlatform` + types + `BrandAssetRecord.surface/variant` + settings schema → consumed by T2 (surface mapping, types), T3 (BrandSurface/Platform), T4 (BrandAssetRecord, settings).
- T2 produces `getBrandAssetPlan` + plan types → consumed by T4 (target sizes from plan), T7 (MCP `get_brand_asset_plan`).
- T3 produces `deriveAppIconVariants` → consumed by T4 (app-icon branch calls it). Correctly ordered T3 before T4.
- T4 produces save-union + delete + bare-ref rule → consumed by T7 (MCP wires save/delete).
- T5 (removal) after T4: sound — T4 still uses `saveBrandAsset`/`resolveBrandImageRef`, and T5 only removes the preset system + `name==="primary"` (which T4 already replaced with the standard-largest rule at T4 step 3). No symbol T5 deletes is reintroduced by a later task.
- T6 (catalogue) independent; T7 after T2/T4/T6 (wires all three); T8/T9 after T1 (settings/record shape); T10/T11 last. All forward-only.

## Breaking-Removal Completeness (T5)

T5 covers SPEC-DATA-008 fully — every authoritative deletion point is in T5's skeleton (07-plan.md:151-154) and/or the embedded SPEC-DATA-008 (:436-443), and I confirmed each anchor against current code:

- **brand-assets.ts**: `STORE_SHOT_PRESETS` (def :87), `PLATFORM_PRESET_MAP` (:121/:126), `interface StoreShotPreset` (:182), `listStoreShotPresets` (:692), `{preset}` target branch in `resolveRenderTarget` (:498/:504), `name==="primary"` fallback (:741) — all present, all listed. ✅
- **store.ts**: value-import :11, type-import :18, interface method :110, binding :350 — all present, all listed (:153). ✅
- **mcp/tools.ts**: FORMA_TOOL_NAMES :69, schema map :482, description map :522, registration :668, + save_brand_asset source-refine block — listed (:153). ✅
- **Tests**: `store-shot-presets.test.ts` whole-file delete; `tools.test.ts:6668-6790` block + `:277` mock; **`brand-assets.test.ts:31` import + `:630` usage** — all listed (:154 and SPEC-DATA-008 :439). I confirmed `brand-assets.test.ts:31` (`STORE_SHOT_PRESETS,` import) and `:630` (`const preset = STORE_SHOT_PRESETS["web-og"]`) exist; **this is the exact omission spec-review-v2 raised as BLOCKING-2, and it IS present in this PLAN** — honored. ✅
- **MASTER_SIZE / bare-ref**: T4 step 3 (07-plan.md:134) replaces the `name==="primary"`+`MASTER_SIZE=2048` selection with the standard-largest rule; confirmed `resolveBrandImageRef` keys bare ref to `MASTER_SIZE` (brand-assets.ts:747) and `name==="primary"` at :741. Both design-review-v3 Advisory-4 and spec-review-v2 Advisory-2 are absorbed into T4. ✅

**T5 shape (no_code TDD + typecheck/grep)** is the right shape. Doing removal AFTER T4 is achievable because T4 already migrates `saveBrandAsset`/`resolveBrandImageRef` off the preset system before T5 deletes it — no interleave needed. T5's verification (`pnpm typecheck` + grep-zero + `pnpm test`, :160) is the correct gate for a deletion-only task; the only refinement is to also grep root `CLAUDE.md` (T5 greps `packages/` only — see SPEC Coverage note), though T10 covers the CLAUDE.md doc removal regardless.

## Decisions & Risks

**DECISION-001 honored.** T1 skeleton defaults all 3 posters `true` (07-plan.md:40-42 + step :38 "3 poster 默认 true"); T2 encodes poster 1080×1920/1920×1080/1080×1080, desktop {1024,512,256,128,64,32,16}, Android safe-area 666 as assertable constants (:71-73). This is the design-review-v3 §6.6 contradiction (landscape/square=false) correctly reconciled to all-true. ✅

**DECISION-002 honored.** T6 gates the gemini default switch on implementation-time verification of OpenAI-compat `/images/generations` support (07-plan.md:174 "仅核实…后切 gemini-3.1-flash-image；否则保 gemini-2.5-flash-image") and openai→gpt-image-1.5 unconditionally. Confirmed against code: current openai default `gpt-image-1` (image-models.ts:115), gemini default `gemini-2.5-flash-image` (:122), `RENDERERS.gemini` routes through `renderOpenAICompatibleImage(...,"gemini")`. ✅

**Risks — each deferred/mitigated risk has a task step:**
- RISK-DEP-001 (Gemini renderer compat) → T6 step (:178), gated per DECISION-002. ✅
- RISK-DEP-002 (model id/size UNCONFIRMED) → T6 step (:178-180), §10 leftover (:1295), provenance + "未核实值不进断言". ✅
- RISK-DEP-003 (sharp ops feasibility) → T3 step "最小 spike + 不依赖 stub 单测" (:108). sharp 0.34.5 support reconfirmed by design-review-v3. ✅
- RISK-CORR-003 (size typos 66²/720×72) → resolved by DECISION-001 constants in T2 (666 safe-area, desktop standard set dropping 358²/720×72). ✅
- RISK-DATA-003 (fixtures invalidated, no migration) → T1 step "更新失配的既有 fixtures（RISK-DATA-003：更新而非迁移）" (:51). ✅
- RISK-SEC-001 (credential leak via new tools) → T7 step "无凭证字段外泄断言" (:199). RISK-SEC-002 (delete path boundary) → T4 step path-boundary + lock (:134). RISK-DATA-001 (removal residue) → T5 codegraph_impact + grep-zero (:157-159). All mitigated with task steps. ✅

**Skeleton & icon-derivation realism:** T1 schema placement (inside `.extend` before `.strict`, not on the ZodEffects chain) is correct — confirmed `productSchema` = `…extend({…}).strict().superRefine(…)` (product.ts:53-65); this is the exact spec-review-v2 BLOCKING-1, and T1 step :38 explicitly encodes the correct placement. T3 variant→base-image mapping is fully derivable: android-monochrome from a (greyscale+tint+alpha), android-foreground from c, android-background from b, ios-tinted from c, ios-dark from a, standards from a∘b; web/desktop need only a/b (no surface) — every variant has a source base image, no orphan. T4 discriminated union (input + `SaveBrandAssetResult` return) is consistent with SPEC-DATA-006. No placeholder text or contradictions found in the skeletons.
