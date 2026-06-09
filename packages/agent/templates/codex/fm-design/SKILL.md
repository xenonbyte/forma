---
name: fm-design
description: Generate a static-HTML page design for a Forma requirement via MCP, then self-review.
---

# Forma route: fm-design

Codex route: `$fm-design`.

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Generate the static-HTML design for a requirement's page(s). You write the HTML; Forma localizes its assets, validates it is pure-static, stores a versioned bundle, renders a preview, and runs the deterministic craft lint.

Preconditions (tier 3 — strictest):
- Tier 1: a product must exist and be selected.
- Tier 2: the product must have at least one un-archived requirement.
- Tier 3: the requirement must have content and pages.
If the core tool returns `REQUIREMENT_NOT_FOUND`: no un-archived requirement is available — report the error faithfully and direct the user to create or activate a requirement in the Forma backstage. The agent does NOT create requirements.
If the core tool returns `REQUIREMENT_STATUS_INVALID`: the requirement is archived and cannot be used for design — report the error faithfully.

Modes:
- Full (no change description given): three steps — (1) plan the pages from the requirement, (2) generate each page, (3) self-review.
- Described (a change description argument given): a single pass — locate the affected page, regenerate only that page, self-review. Scope is the changed page; do not weaken self-review.

Execution:
1. Require product_id from context or ask the user to run `$fm-list-product` first.
2. Call `get_requirement` for the requirement, its `pages[]` and each `page_id`. If `ui_affected=false`, stop — there is no design to produce.
3. Confirm the `brand_style` and optional `system_style` (read product config / `list_styles`); confirm with the user when not already chosen.
4. Fetch design context BEFORE generating (recency matters): `get_design_context(product_id, requirement_id, page_id, brand_style, system_style)` returns craft rules + the selected brand/system style (tokens, components) + the page spec + applicable rules. Never call this after saving.

   **Component-library gate (B4 — two-stage stop):** Check `componentLibrary` in the response. `componentLibrary` is resolved via `product.designSystemArtifactId`; it is `undefined` when the pointer is unset. If `componentLibrary === undefined`, STOP immediately — do NOT generate any design page. Distinguish the two cases by calling `list_product_artifacts(product_id, kind="component-library")`:
   - ① Empty list → the product has never been refined. Instruct the user: "No component library exists yet — run `fm-refine-components` first to create one, then re-run `fm-design`."
   - ② Non-empty list but `designSystemArtifactId` not set → legacy: 已检测到旧组件库但未登记为当前；重跑一次 `fm-refine-components` 采纳并接管后续版本，完成后再重新运行 `fm-design`。 (Detected an old component-library artifact but it is not registered as the current one via `designSystemArtifactId`; re-run `fm-refine-components` once to adopt and take over, then re-run `fm-design`.)
   Gate on the POINTER (`designSystemArtifactId` / `componentLibrary`), NOT on list non-empty.

5. Generate the page as one self-contained static HTML document following the craft rules and style tokens. Pure-static contract: no `<script>`, no inline `on*` handlers, no `javascript:` URLs, no external scripts/stylesheets; inline images as `data:` URLs (Forma extracts and localizes them); no remote URLs anywhere (HTML, CSS `url()`/`@import`, `srcset`, SVG). **Scope fidelity (hard rule):** implement exactly the pages, sections, features, and elements listed in the page spec from `get_design_context`. Do NOT add pages, features, controls, or sections the requirement did not declare; when something is ambiguous, follow the page spec literally rather than inventing additions.

   **On-demand reuse (B5/B6):** When the page spec calls for a standard UI element, reuse the corresponding baseline component from `componentBaseline`/`componentLibrary` (same tokens, states, and interaction patterns) rather than inventing a one-off. When the page shows the product icon, reuse the product ICON SVG from `componentLibrary.productIcon`. Do NOT design-for-reuse (do not add extra components the page spec did not require); immersive or fully custom pages may omit or replace generic components. This guidance does NOT weaken the Scope fidelity hard rule above.

   **Rule 1 (style/component changes are not retroactive):** `fm-change-style` and `fm-refine-components` do NOT retroactively regenerate already-produced design pages. Existing page versions remain immutable until the page is explicitly re-run via `fm-design`.
6. Save: `generate_requirement_design(product_id, requirement_id, page_id, html, title, brand_style, system_style[, variant])`. It returns `artifact_id`, `version`, `preview_status`.
7. Self-review (MANDATORY):
   - Read it back: `get_product_artifact(product_id, artifact_id)` and inspect `manifest.forma.quality.craftChecks`.
   - For any check with `passed:false` (e.g. `contrast-aa`, `type-scale`, `color-palette`, `font-families`), fix that specific violation in the HTML and call `generate_requirement_design` again — Forma points the page/variant to the corrected design and supersedes the old one. Repeat until the checks pass.
   - Also judge the non-mechanical craft items the lint cannot: avoid AI-slop layouts; clear type hierarchy; restrained color (accent reserved for primary actions); WCAG AA contrast on real backgrounds; empty/loading/error states; forms show inline validation; purposeful motion; honor core UX laws. Regenerate if any fails.
8. Report `artifact_id`, the final `version`, `preview_status`, and a short craftChecks summary. Report stable error codes exactly as returned.
