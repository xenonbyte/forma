# Forma shared guidance

Use Forma MCP tools for product, requirement, and artifact listing workflows.

Core rules:
- Every MCP call requires an explicit product_id. There is no current-session concept in v8.
- Product selection: call `list_products` → ask user to choose → call `confirm_product_id` to confirm selection → store product_id in context for subsequent calls.
- Report stable Forma error codes exactly as returned by the MCP server.
- Do not hide pending or failed design state from the user.
- Call Forma MCP tools rather than editing Forma data files directly.
- Design-generating commands save AI-generated static HTML artifacts: the model produces the HTML, Forma localizes assets, validates pure-static output (no JS, local-only resources), stores a versioned bundle, and renders a preview. fm-design generates requirement page designs; fm-refine-components generates the product component library; fm-change-style persists product config then regenerates the component library through the fm-refine-components flow (it does not save a page design itself). Call `get_design_context` before generating a requirement page artifact to fetch craft rules + selected brand/system style + the page spec.
- Component-library work (fm-refine-components) has no requirement page; fetch knowledge before generating with `get_style` for the selected brand style and optional system style. When refining an existing component library, first list/select the `component-library` artifact, read its manifest, export/read its HTML, and use that source HTML as the edit baseline.
- After saving a design, follow the **Self-review protocol** below (mandatory for both fm-design and fm-refine-components).
- `ui_affected=false` requirements must stop design work before calling artifact tools.
- Artifacts are static-HTML `design-page` (page designs) or `component-library` outputs. Use `list_product_artifacts(product_id)` to list them and `get_product_artifact(product_id, artifact_id)` to fetch one — it returns a served `bundle_url`, per-asset `urls` (with densities), `versions`, and a `preview_url`, but not the source HTML body. Before regenerating/restyling an existing artifact, call `export_artifact` and read the exported HTML (or zip bundle when assets matter) so existing DOM/content is preserved.
- Do not expose or suggest requirement deletion tools.
- The agent does NOT create requirements. When a core tool returns `REQUIREMENT_NOT_FOUND`, report the error faithfully and direct the user to create or activate a requirement in the Forma backstage. When a core tool returns `REQUIREMENT_STATUS_INVALID`, report the error faithfully (the requirement is archived and cannot be used). Do not build your own status determination logic in the agent layer.
- Keep stable MCP usage: read fresh state, validate before saving, call the intended mutation once.
- Rule 1 (style/component changes are not retroactive): `fm-change-style` and `fm-refine-components` do NOT retroactively regenerate already-produced design pages. Existing page versions remain immutable until the page is explicitly re-run via `fm-design`.

## Pure-static contract

All AI-generated design HTML (page designs and component libraries) must be pure-static:
- No `<script>` tags anywhere in the document.
- No inline `on*` event handlers (e.g. `onclick`, `onload`).
- No `javascript:` URLs.
- No external scripts or stylesheets (no `<link rel="stylesheet" href="https://...">`, no `<script src="...">`).
- Inline images as `data:` URLs — Forma extracts and localizes them; do not reference external image URLs.
- No remote URLs anywhere: not in HTML attributes, CSS `url()`/`@import`, `srcset`, or SVG `href`/`xlink:href`.

This contract applies to all AI-generated design HTML — both page designs and component libraries.

## Self-review protocol

After every save, self-review is MANDATORY. The protocol is the same for both fm-design and fm-refine-components (each command names its own save tool):

1. Read the saved artifact back: `get_product_artifact(product_id, artifact_id)`.
2. Inspect `manifest.forma.quality.craftChecks`. For any check with `passed:false` (e.g. `contrast-aa`, `type-scale`, `color-palette`, `font-families`): fix that specific violation in the HTML, call the appropriate save tool again — Forma points the artifact to the corrected design and supersedes the old version. Repeat until all checks pass.
3. Also judge the non-mechanical craft items the lint cannot catch: avoid AI-slop layouts; clear type hierarchy; restrained color (accent reserved for primary actions); WCAG AA contrast on real backgrounds; empty/loading/error states present; forms show inline validation; purposeful motion; honor core UX laws. Regenerate if any fails.

**Pre-save confirmation asymmetry (存前确认不对称):** The fetch direction before generation and after saving are NOT interchangeable:
- **Before generating**: call `get_design_context` (for page designs) or `get_style` (for component libraries) — recency matters; never call these after saving.
- **After saving**: read the SAVED artifact back via `get_product_artifact` to run self-review — do NOT re-fetch design context or style knowledge at this stage.

The two directions serve different purposes and must not be swapped.
