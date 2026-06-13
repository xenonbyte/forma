# DESIGN Subagent Review — v3 (brand-assets-optimization)
Reviewer: read-only subagent · Date: 2026-06-14

## Verdict
APPROVE WITH CHANGES — the architecture is sound, feasible, and the breaking-removal scope is correctly identified; sharp 0.34.5 supports every needed op; but the deletion checklist the PLAN inherits is materially incomplete (the design's prose misses several real call sites), and a few code-evidence line numbers are stale. Tighten the deletion sweep and fix the stale anchors before SPEC.

## Blocking Findings

1. **Deletion checklist is incomplete — MCP wiring sites the design's §6.3 prose omits.** The design (05-design.md §6.3, lines 567-568) lists removing `listStoreShotPresetsSchema`, the handler, and the `verifiedAt→verified_at` map. But the actual `list_store_shot_presets` removal also touches sites it never names: `packages/mcp/src/tools.ts:69` (the `FORMA_TOOL_NAMES` array entry), `:522` (the tool-description map entry), and `:482` (schema map) and `:668` (registration). All four must be in the PLAN's checklist or `template-parity`/tool-name tests fail. Evidence: tools.ts lines 69, 393, 482, 522, 668, 1255-1268. Fix: PLAN deletion task must enumerate all five tools.ts sites, not just the three the design mentions.

2. **`store.ts` removal surface is broader than design states.** Design §6.3 (line 574) says "以 getBrandAssetPlan 绑定取代 listStoreShotPresets". The actual removal must touch FOUR lines in `packages/core/src/store.ts`, not one: `:11` (import), `:18` (`type StoreShotPreset` import), `:110` (interface method signature), `:350` (binding). The `StoreShotPreset` type import at store.ts:18 is a separate dangling reference the design's prose does not call out. Fix: add store.ts:18 to the checklist.

3. **Three full TEST files must be deleted/rewritten, not just "updated".** `packages/core/tests/store-shot-presets.test.ts` (95 lines) imports `STORE_SHOT_PRESETS`, `listStoreShotPresets`, and `StoreShotPreset` — its entire reason to exist is removed. The MCP suite has a dedicated `describe("list_store_shot_presets tool (PLAN-TASK-025)")` block at `packages/mcp/tests/tools.test.ts:6668-6790` plus the store mock at `:277` and assertions at `:6711`/`:6732`. The design's test section (§8) names `store-shot-presets.test.ts → brand-asset-plan.test.ts` but does NOT mention the tools.test.ts preset block or the mock. Fix: PLAN must delete the tools.test.ts:6668-6790 block + mock + the two `toHaveBeenCalled` assertions.

4. **`resolveRenderTarget` + `BrandAssetTarget` `{preset}` form removal cascades into the MCP source pairing.** The design §6.2 step 5 says drop `{preset}` from `target`. The actual coupling: `resolveRenderTarget` (brand-assets.ts:480-518) has a whole `"preset" in target` branch using `STORE_SHOT_PRESETS`; AND the MCP `save_brand_asset` schema (`tools.ts:341-380`) currently enforces `source = image_ref XOR html` with a `.refine` and a `superRefine` that forces `app-icon → image_ref`. The discriminated-union rewrite (design §6.2 step 2) must REPLACE that entire `brandAssetSourceSchema` refine block (tools.ts:345-380) and the `target={preset}` description at tools.ts:519/523. The design does not name these MCP schema lines. Fix: PLAN must list tools.ts:345-380 (source refine) + the save_brand_asset description rewrite as part of the discriminated-union task.

## Advisory Findings

1. **Stale anchor: `product.ts:55,116` for "productSchema (.strict())".** Line 55 is the `platform:` field inside `productSchema` (which opens at :53); line 116 is inside the *separate* `productConfigSchema` (opens :114), not `productSchema`. The `productSchema` `.strict()` is at :64 and it is followed by a `.superRefine(...)` (lines 65-112). Adding the `brand_assets` block must go inside `.extend({...})` (before `.strict()`), and the new optional block does not interact with the existing `superRefine`. Not blocking, but the PLAN should anchor on :53-64 and note the superRefine chain.

2. **`ProductConfigField` extension is likely unnecessary.** Design §6.4-style text (line 76, DES-ARCH-004) says "ProductConfigField 视需要扩展". `ProductConfigField = "platform"|"brand_style"|"languages"` (product.ts:136) drives the *one-time config form*, but D9 explicitly puts brand-asset settings on a SEPARATE always-editable panel with its own `PUT /api/products/:id/brand-asset-settings` route and `updateBrandAssetSettings`. So `ProductConfigField` should NOT be extended. The design's "视需要" hedge is fine but SPEC should resolve it to "not extended" to avoid a wrong-altitude change.

3. **i18n key namespace already established — design is right but be precise.** `brandAssets.kind.{app-icon,store-shot,poster}` exist (i18n.ts:92-94) in both `en` (block @ :6) and `zh` (block @ :367). The additions are `brandAssets.kind.banner` + surface labels (Android/iOS) + poster-style labels + settings-panel copy. Confirmed exactly two locale blocks — design's "实测仅 en/zh" claim is accurate.

4. **`forma-image://brand/app-icon` master-size note.** Current `resolveBrandImageRef` (brand-assets.ts:747) defaults no-size refs to `MASTER_SIZE = 2048`. The new app-icon pipeline normalizes to a 1080 working canvas and the largest standard variant is 1024 (iOS) / 1024 (desktop) / 512 (web). The §5.3 "取最大主图" rewrite must drop the hard-coded 2048 master assumption (there will be no 2048 file). SPEC should specify the new "largest standard file" selection explicitly so the `@<size>` and bare-ref paths both resolve against the standard variant's actual file set.

## Code-Evidence Accuracy

Verified TRUE:
- `schemas.ts:4` `platforms = ["mobile","desktop","tablet","web"]` — exact (schemas.ts:4). `android`/`ios` are NOT in the enum, so `surface` is genuinely new.
- `brand-assets.ts` `APP_ICON_SIZES` @ :55 (ios[1024,180,120]/android[512,192,144,96,72,48]/web[512,192,32,16]) — exact.
- `STORE_SHOT_PRESETS` @ :87 (ios-6.9 / android-phone / web-og, each with source+verifiedAt) — exact. `PLATFORM_PRESET_MAP` @ :121, tablet/desktop → web-og — exact.
- `BRAND_ASSET_KINDS` @ :144 = ["app-icon","store-shot","poster"]; `KIND_SUBDIR` @ :136 (3 entries) — exact.
- `BrandAssetRecord` @ :156 = {kind,name,files,brand_style,model?,generated_at} — exact, no surface/variant.
- `SaveBrandAssetInput` @ :195 — exact; `source` is `image_ref` XOR `html` (BrandAssetSource @ :167); `target?: {width,height}|{preset}` @ :175.
- `listStoreShotPresets` @ :692; `resolveBrandImageRef` @ :710; `name==="primary"` fallback @ :741 (`records.find((r)=>r.name==="primary") ?? records.at(-1)`) — exact.
- `SHARP_PIXEL_LIMIT` @ :133 (64_000_000); `MASTER_SIZE` @ :129 (2048) — exact.
- `image-models.ts`: providers volcengine/openai/gemini/stub; openai default = `gpt-image-1` (:115), gemini default = `gemini-2.5-flash-image` (:118) — exact. (Note: volcengine catalogue is richer than the design's brief implies — 5 Seedream models, default `doubao-seedream-5-0` — but that is untouched, so not an issue.)
- `image-generate.ts`: `RENDERERS.gemini = (input,cfg) => renderOpenAICompatibleImage(input,cfg,"gemini")` @ :169 — exact. Gemini goes through the OpenAI-compat `/images/generations` path; the DECISION-002 "verify-then-switch" premise is correct.
- `BrandAssets.tsx` `groupByKind` @ :177 (kind-only, order-preserving) — exact; no surface subgroup today.
- `i18n.ts` only `en` (:6) / `zh` (:367) — exact.
- agent templates: claude has 8 commands incl fm-app-icon/fm-brand-assets/fm-design; NO `fm-rollback-design` in any of claude/codex/gemini source templates — exact (confirms D11: only stale *installed* copies remain). `template-parity.test.ts` enforces parity AND a `list_store_shot_presets`-before-`save_brand_asset` ordering check (:335, :367-377).
- `MAX_RENDER_DIMENSION = 16384` (brand-asset-render.ts:80) — exact; RISK-SEC-003 boundary claim correct.
- Server: `brand-assets/files/*` reuses lexical+realpath `isSameOrChildPath` boundary (routes.ts:902-924); `brand-assets/export` zip @ :943; NO `brand-asset-settings` route exists today (correct, design adds it). Existing media/brand routes: `/api/media/{models,config,test}` + `/api/products/:pid/brand-assets`, `…/files/*`, `…/export` = 6 brand-asset-related routes already; design adds the 7th (settings PUT).
- `exportBrandAssetsZip` (brand-assets.ts:790) is manifest-driven (iterates `manifest.assets[].files[]`), so the new `banner` kind / `banners/` subdir need NO walker change — design's "banner 复用既有路径" claim holds.

Found WRONG / STALE:
- `product.ts:55,116` mis-anchored (see Advisory 1). Both numbers point at the wrong schema boundary.
- Design's CLAUDE.md sync note (§6.10) says "New MCP tools (5)" at ~L110 → change to 6. Verified: CLAUDE.md:110 currently lists 5 tools ending in `list_store_shot_presets`. Correct target. (Not wrong — just confirming the anchor is live.)

## Breaking-Removal Reference Sweep
(Deliverable for the PLAN deletion checklist. `/dist/` artifacts excluded — they regenerate on build.)

**`listStoreShotPresets` (core symbol):**
- `packages/core/src/brand-assets.ts:85` (comment), `:682` (banner comment), `:692` (definition)
- `packages/core/src/store.ts:11` (import), `:110` (interface sig), `:350` (binding)
- `packages/core/tests/store-shot-presets.test.ts:9,24,62-90` (DELETE whole file or rewrite to brand-asset-plan.test.ts)
- `packages/mcp/src/tools.ts:1255` (handler), `:1268` (`.map`)
- `packages/mcp/tests/tools.test.ts:277` (store mock), `:6711`, `:6732` (assertions)

**`list_store_shot_presets` (MCP tool / wire name):**
- `packages/mcp/src/tools.ts:69` (FORMA_TOOL_NAMES), `:391` (comment), `:393` (schema), `:482` (schema map), `:522` (description map), `:668` (registration)
- `packages/mcp/tests/tools.test.ts:6668-6790` (entire describe block)
- `packages/agent/templates/claude/fm-brand-assets.md:22,24,26,28`
- `packages/agent/templates/codex/fm-brand-assets/SKILL.md:25,27,29,31`
- `packages/agent/templates/gemini/fm-brand-assets.toml:20,22,24,26`
- `packages/agent/tests/template-parity.test.ts:335,367,371,373,377` (the preset-query parity + ordering assertions — must be rewritten to `get_brand_asset_plan`)
- `CLAUDE.md:110`
- `docs/brand-assets-optimization-requirements.md` (source doc — :38,64,90,212,338,370,422; out of scope to edit but flagged)

**`STORE_SHOT_PRESETS`:**
- `packages/core/src/brand-assets.ts:87` (def), `:126` (PLATFORM_PRESET_MAP satisfies), `:476,498,504` (resolveRenderTarget preset branch), `:687,694` (listStoreShotPresets)
- `packages/core/tests/store-shot-presets.test.ts:4,24,28-95`
- `packages/core/tests/brand-assets.test.ts:31` (import), `:630` (`STORE_SHOT_PRESETS["web-og"]`)
- `packages/mcp/src/tools.ts:355` (comment)

**`PLATFORM_PRESET_MAP`:**
- `packages/core/src/brand-assets.ts:85,121,689,693`

**`StoreShotPreset` (type):**
- `packages/core/src/brand-assets.ts:109,182,498` (def @ :182)
- `packages/core/src/store.ts:18` (import), `:110` (return type)
- `packages/core/tests/store-shot-presets.test.ts:24,95`

**`BrandAssetTarget {preset}` form (cascade):**
- `packages/core/src/brand-assets.ts:175` (type), `:476-507` (resolveRenderTarget preset branch)
- `packages/mcp/src/tools.ts:519,523` (descriptions referencing `target={preset}`)

**`name==="primary"` fallback:**
- `packages/core/src/brand-assets.ts:737-741` (the resolver fallback — the actual behavior change)
- Heavy TEST fixture usage (must be rewritten to `variant==="standard"` model): `packages/core/tests/brand-assets.test.ts` (~16 occurrences incl :92 `expect(saved.name).toBe("primary")`, :264 `r.name==="primary"`, :502 orphan dir), `packages/core/tests/brand-assets-atomic-overwrite.test.ts:73,93,101`, `packages/core/tests/artifact-asset-pipeline.test.ts:686`, `packages/mcp/tests/tools.test.ts` (~13 occurrences incl :6427,:6589,:6602), `packages/server/tests/routes.test.ts:3118,3142`. NOTE: `component-baseline.ts`, `artifact-manifest.ts`, `styleVisualTokens.ts`, `StylePreviewPanel.tsx` "primary" hits are UNRELATED (color tokens / component variants) — do NOT touch.

## sharp Feasibility
Installed: **sharp ^0.34.5** (packages/core/package.json:50; lockfile + node_modules both resolve 0.34.5). DES-ARCH-007 is feasible — every required op exists in 0.34.x:
- `.greyscale()` — present (already used in the codebase for icon extraction).
- `.tint({r,g,b})` — present; tints toward a color while preserving luminance/alpha. For "fill alpha mask with solid color" (monochrome variant) the design correctly proposes the `composite(blend:"dest-in")` mask approach rather than tint, which is the robust path.
- `.composite([{input, blend:"dest-in"}])` — present; `dest-in` is a supported `blend` value (libvips), and is exactly the rounded-corner SVG-mask + alpha-mask-fill technique the design specifies.
- Alpha preservation through composite/resize — sharp preserves the alpha channel by default; `.png()` output keeps RGBA. Correct.
- `.resize()` to multiple sizes — present, deterministic.
- SVG rounded-rect / squircle mask as a `composite` input buffer — supported (sharp rasterizes SVG via librsvg/resvg).
No version gap. The design's RISK-DEP-003 "first do a minimal spike + non-stub unit test for tint/greyscale/dest-in/alpha" is the right discipline; nothing in 0.34.5 blocks it. One caveat to carry into SPEC (already noted as a §10 leftover): the stub provider returns no real alpha, so derivation unit tests must construct synthetic RGBA PNG fixtures — the design already states this.

## Coverage Gaps
- **AC↔DES mapping is complete.** Every AC-001..AC-012 maps to a DES-ARCH block (design Requirements Coverage table, lines 42-55) and the mapping is accurate. No AC is left uncovered.
- **Minor gap — `image-staging.ts` brand-ref forwarding.** `media/image-staging.ts:300-301` late-imports `resolveBrandImageRef`; the §5.3 resolver behavior change (drop 2048 master, select standard variant) flows through this forward but no DES-ARCH block names image-staging. Low risk (it just forwards), but SPEC should note the staging→brand forward is exercised by the resolver-behavior test.
- **Minor gap — `MASTER_SIZE`/2048 master file.** Removing the always-stored 2048 master (implied by the new normalize-to-1080 pipeline) is not explicitly stated. `resolveBrandImageRef` currently keys the bare ref to width 2048 (brand-assets.ts:747). SPEC must either keep a defined "largest standard" sentinel or the bare `forma-image://brand/app-icon` ref breaks. Covered in spirit by §5.3 but needs an explicit pixel-selection rule.
- **No gap on banner zip/export/canvas:** manifest-driven zip walker + dynamic `groupByKind` mean banner needs no new export/walker code — correctly relied upon, not a gap.
- **Decision consistency:** DECISION-001 (sizes option A: 666² safe-area, desktop standard .ico/.icns set, posters all-on-default) is internally consistent with §6.4 app-icon table and §6.6 yaml defaults (poster_portrait/landscape/square... NOTE: §6.6 yaml shows `poster_portrait:true, poster_landscape:false, poster_square:false` which CONTRADICTS DECISION-001's "3 个海报开关默认全开"). **This is a real inconsistency** — DECISION-001 selected "海报默认全开" but the §6.6 schema example (05-design.md:669-671) defaults landscape/square to false. SPEC must reconcile: per the selected DECISION-001, all three poster defaults should be `true`. Flagging as the one substantive decision↔design contradiction.
- DECISION-002 (verify-then-switch Gemini default): consistent with §6.1 and OVERFLOW-001 control. No downstream inconsistency.
