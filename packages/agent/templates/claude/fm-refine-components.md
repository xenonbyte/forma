---
description: Generate or refine a Forma product component library (static HTML) via MCP, then self-review.
---

# Forma route: fm-refine-components

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Generate or refine a product's static-HTML component library. You write the HTML; Forma localizes assets, validates it is pure-static, stores a versioned bundle, renders a preview, and runs the deterministic craft lint. A component library is product-level — it has no requirement or page.

Preconditions (tier 1):
- 档1: a product must exist and be selected. No requirement is needed for this command.
If the core tool returns `REQUIREMENT_NOT_FOUND` or `REQUIREMENT_STATUS_INVALID` in an unexpected context, report the error faithfully.

Execution:
1. Require product_id from context or ask the user to run `fm-list-product` first.
2. Determine whether this is initial generation or refinement:
   - For refinement of an existing library: `list_product_artifacts(product_id, kind="component-library")`, choose the current/target library, `get_product_artifact(product_id, artifact_id)` to read its manifest, then `export_artifact(product_id, artifact_id, format="html")` and read the returned `output_path` as `source_html`. If the export response notes omitted assets, also call `export_artifact(product_id, artifact_id, format="zip")` and inspect the bundle so existing local assets can be preserved or inlined. If no component-library exists, ask whether to do initial generation instead; do not fabricate a "refined" library without source HTML.
   - For a clearly new component library: proceed without `source_html`.
3. Confirm the `brand_style` and optional `system_style` (read product config / `list_styles`); confirm with the user when not already chosen.
4. Fetch the style knowledge BEFORE generating: `get_style(brand_style)` returns DESIGN.md (design principles), tokens.css (design tokens), components.html (reference components). If a `system_style` is set, `get_style(system_style)` too. Component libraries have no requirement, so requirement page context does not apply here.
5. Generate or refine the component library as one self-contained static HTML document. When `source_html` exists, modify that HTML in place, preserving existing components, states, content, and layout unless the user explicitly asked to change them. Follow the style tokens and these craft principles: avoid generic AI-slop; clear type hierarchy on a small type scale; restrained color with accent reserved for primary actions; WCAG AA contrast; cover component states (default/hover/disabled/empty/error); accessible form controls; purposeful motion; honor core UX laws. Pure-static contract: no `<script>`, no inline `on*` handlers, no `javascript:` URLs, no external scripts/stylesheets; inline images as `data:` URLs; no remote URLs anywhere.
6. Save the component library with the component save tool, passing product_id, html, title, brand_style, and system_style. It returns `artifact_id`, `version`, `preview_status`.
7. Self-review (MANDATORY):
   - Read it back: `get_product_artifact(product_id, artifact_id)` and inspect `manifest.forma.quality.craftChecks`.
   - For any check with `passed:false`, fix that specific violation and save again until the checks pass.
   - Also judge the non-mechanical craft items above that the lint cannot; regenerate if any fails.
8. Report `artifact_id`, the final `version`, `preview_status`, and a short craftChecks summary. Report stable error codes exactly as returned.

The component save tool is `generate_components`.
