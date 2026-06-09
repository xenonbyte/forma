---
description: Re-skin a Forma artifact under a new brand and system style via MCP, then self-review.
---

# Forma route: fm-change-style

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Re-skin an existing artifact under a new `brand_style` / `system_style`. You regenerate the HTML in the new style; Forma localizes assets, validates pure-static, stores it as a new version of the same artifact, renders a preview, and runs the craft lint.

Preconditions (tier 1):
- 档1: a product must exist and be selected. No un-archived requirement is required; this command operates on existing artifacts.
If the core tool returns `REQUIREMENT_NOT_FOUND` or `REQUIREMENT_STATUS_INVALID` in an unexpected context, report the error faithfully.

Execution:
1. Require product_id from context or ask the user to run `fm-list-product` first.
2. Pick the source artifact: `list_product_artifacts(product_id)` then choose the target; `get_product_artifact(product_id, artifact_id)` to read its `manifest` (its `kind`, and for a `design-page` its `forma.requirementId` / `forma.pageId` / `forma.variant`).
3. Load the source HTML BEFORE generating: call `export_artifact(product_id, artifact_id, format="html")`, read the returned `output_path` as `source_html`, and keep it with the manifest. If the export response notes omitted assets, also call `export_artifact(product_id, artifact_id, format="zip")` and inspect the bundle so existing local assets can be preserved or inlined. Stop and report the stable error code if the source HTML cannot be loaded.
4. Confirm the new `brand_style` and optional `system_style`. If not chosen, `list_styles` and confirm with the user.
5. Fetch context BEFORE generating:
   - For a `design-page` artifact: `get_design_context(product_id, requirement_id, page_id, brand_style, system_style)` (the new styles) returns craft rules + style + page spec.
   - For a `component-library` artifact (no requirement/page): `get_style(brand_style)` (and `get_style(system_style)` if set).
6. Regenerate from `source_html` in the new style, preserving the existing DOM/content/structure unless the user explicitly asked for structural changes. Apply the new tokens and keep the pure-static contract: no `<script>`, no inline `on*` handlers, no `javascript:` URLs, no external scripts/stylesheets; inline images as `data:` URLs; no remote URLs anywhere.
7. Save: `change_artifact_style(product_id, artifact_id, html, title, brand_style, system_style)`. It returns `artifact_id`, `version`, `preview_status`.
8. Self-review (MANDATORY):
   - Read it back: `get_product_artifact(product_id, artifact_id)` and inspect `manifest.forma.quality.craftChecks`.
   - For any check with `passed:false`, fix that specific violation and call `change_artifact_style` again until the checks pass.
   - Also judge the non-mechanical craft items the lint cannot (type hierarchy, color restraint, contrast, state coverage, form validation, motion, UX laws); regenerate if any fails.
9. Report `artifact_id`, the final `version`, `preview_status`, and a short craftChecks summary. Report stable error codes exactly as returned. `change_artifact_style` only applies to `design-page` / `component-library` artifacts.
