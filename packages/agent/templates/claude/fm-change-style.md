---
description: Change the brand/system style of a Forma product's design system by persisting config then fully regenerating the component library via MCP, then self-review.
---

# Forma route: fm-change-style

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Change the `brand_style` / `system_style` for an entire product. This command: (1) persists the new style config with `update_product_config`, then (2) fully regenerates the component library (design system) using the same generation flow as fm-refine-components — inlined here. Design-page artifacts are NOT touched.

Preconditions (tier 1):
- Tier 1: a product must exist and be selected.
If the core tool returns `REQUIREMENT_NOT_FOUND` or `REQUIREMENT_STATUS_INVALID` in an unexpected context, report the error faithfully.

Execution:
1. Require product_id from context or ask the user to run `fm-list-product` first.
2. Confirm the new `brand_style` and optional `system_style`. If not already chosen, call `list_styles` and confirm with the user.
3. Persist the style config: first call `get_product(product_id)` to read the existing `platform`, `languages`, and `default_language`; then call `update_product_config(product_id, platform, brand_style, system_style, languages, default_language)` carrying those existing values forward with the new style. This is the authoritative config write. If this step fails, stop and report the error — do not continue.

   **Partial-failure boundary**: if `update_product_config` succeeds but any subsequent step (export, generation, save, or self-review) fails, STOP immediately and report:
   > "产品配置已更新但当前组件库可能仍是旧版本/未刷新（partial update: product config saved but component library may be stale）。请重跑 fm-refine-components 或 fm-change-style 以刷新组件库指针版本。"
   Do NOT continue to trigger fm-design or claim the style change is fully applied.

4. Load the existing component library for re-skin (inlined fm-refine-components flow):
   - Call `list_product_artifacts(product_id, kind="component-library")` to find the current library.
   - Call `get_product_artifact(product_id, artifact_id)` to read its manifest (recover `forma.productIcon.shape` for ICON geometry reuse).
   - Call `export_artifact(product_id, artifact_id, format="html")` and read the returned `output_path` as `source_html`. If the export response notes omitted assets, also call `export_artifact(product_id, artifact_id, format="zip")` and inspect the bundle. Stop and report the partial-failure message (step 3 boundary) if the source HTML cannot be loaded.
5. Fetch style knowledge BEFORE generating: call `get_style(brand_style)` (returns DESIGN.md, tokens.css, components.html). If `system_style` is set, call `get_style(system_style)` too.
6. Call `get_component_baseline(product_id)` to obtain the authoritative spec: `{ platform, baseline: { foundations, productIcon, components } }`. Use this as the sole source of WHAT to produce.
7. Regenerate the component library as one self-contained static HTML document, applying the new style tokens. The document must contain three sections in order:
   a. **Foundations area** — token visualization for every category in `baseline.foundations`, derived from the new brand_style tokens.
   b. **Product ICON** — read `manifest.forma.productIcon` (from step 4) to recover the existing `shape` (`shape_id` + `geometry`). Reuse that geometry exactly and only recolor per the new brand tokens. Keep `shape_id` stable. Do NOT redraw the mark from scratch. Render both primary and monochrome variants inline AND prepare them as separate SVG files for `supporting_files`.
   c. **Baseline component set** — every component in `baseline.components` for the product's platform with all listed states/variants. Modify `source_html` in place, preserving existing structure and content, applying only new tokens.
   Pure-static contract: no `<script>`, no inline `on*` handlers, no `javascript:` URLs, no external scripts/stylesheets; inline images as `data:` URLs; no remote URLs anywhere.
8. Save the component library with `generate_components`, passing:
   - `product_id`, `html`, `title`, `brand_style`, `system_style`
   - `product_icon`: `{ primary: "assets/icon.svg", monochrome: "assets/icon-mono.svg", shape: { shape_id: <stable-id>, geometry: <reusable SVG inner markup>, source_version: <string> } }`
   - `supporting_files`: `[ { path: "assets/icon.svg", content_type: "image/svg+xml", content_base64: <base64 of primary SVG> }, { path: "assets/icon-mono.svg", content_type: "image/svg+xml", content_base64: <base64 of monochrome SVG> } ]`
   If this step fails, stop and report the partial-failure message from step 3.
   The tool returns `artifact_id`, `version`, `preview_status`.
9. Self-review (MANDATORY):
   - Read it back: `get_product_artifact(product_id, artifact_id)` and inspect `manifest.forma.quality.craftChecks`.
   - For any check with `passed:false`, fix that specific violation and call `generate_components` again until the checks pass.
   - Also judge the non-mechanical craft items the lint cannot (type hierarchy, color restraint, contrast, state coverage, form validation, motion, UX laws); regenerate if any fails.
   - If self-review fails after repeated attempts, stop and report the partial-failure message from step 3.
10. Report `artifact_id`, the final `version`, `preview_status`, and a short craftChecks summary. End here — do NOT trigger fm-design or any follow-up commands.
