---
description: Generate or refine a Forma product component library (static HTML) via MCP, then self-review.
---

# Forma route: fm-refine-components

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Generate or refine a product's static-HTML component library. You write the HTML; Forma localizes assets, validates it is pure-static, stores a versioned bundle, renders a preview, and runs the deterministic craft lint. A component library is product-level — it has no requirement or page.

Preconditions (tier 1):
- Tier 1: a product must exist and be selected. No requirement is needed for this command.
If the core tool returns `REQUIREMENT_NOT_FOUND` or `REQUIREMENT_STATUS_INVALID` in an unexpected context, report the error faithfully.

Execution:
1. Require product_id from context or ask the user to run `fm-list-product` first.
2. Determine whether this is initial generation or refinement:
   - For refinement of an existing library: `list_product_artifacts(product_id, kind="component-library", include_superseded=true)`, choose the current/target library, `get_product_artifact(product_id, artifact_id)` to read its manifest, then `export_artifact(product_id, artifact_id, format="html")` and read the returned `output_path` as `source_html`. If the export response notes omitted assets, also call `export_artifact(product_id, artifact_id, format="zip")` and inspect the bundle so existing local assets can be preserved or inlined. If no component-library exists, ask whether to do initial generation instead; do not fabricate a "refined" library without source HTML.
   - For a clearly new component library: proceed without `source_html`.
3. Confirm the `brand_style` and optional `system_style` (read product config / `list_styles`); confirm with the user when not already chosen.
4. Fetch the style knowledge BEFORE generating: `get_style(brand_style)` returns DESIGN.md (design principles), tokens.css (design tokens), components.html (reference components). If a `system_style` is set, `get_style(system_style)` too. Component libraries have no requirement, so requirement page context does not apply here.
5. Call `get_component_baseline(product_id)` to obtain the authoritative spec: `{ platform, baseline: { foundations, productIcon, components } }`. Use this as the sole source of WHAT to produce — the foundations category list, the productIcon spec, and the platform's component list with states/variants. Do NOT transcribe or hardcode the component list from any other source; use the tool's return value.
6. Generate or refine the component library as one self-contained static HTML document. The document must contain three sections in order:
   a. **Foundations area** — token visualization for every category in `baseline.foundations` (color, typography, spacing, radius, elevation, motion, functionalIconStyle), derived from brand_style tokens.
   b. **Product ICON** — primary (full-color) and monochrome variants, derived from the product name and brand_style. ICON rules:
      - Do NOT generate a generic functional icon library, wordmark, or full brand VI.
      - Favicon is derived from the ICON; do not create a separate favicon design.
      - For REFINEMENT: read `manifest.forma.productIcon` (already fetched in step 2) to recover the existing persisted `shape` (`shapeId` + `geometry` + `sourceVersion`). Reuse that geometry exactly and only recolor per new brand tokens. Keep `shapeId` stable. When saving with `generate_components`, convert the persisted camelCase fields to the tool's snake_case input fields. Do NOT redraw the mark from scratch on a re-skin.
      - For INITIAL generation: create a new SVG mark; assign a stable `shape_id` (a short slug, e.g. `<productName>-mark`).
      - Render both variants inline in the HTML AND prepare them as separate SVG files for `supporting_files` (see step 7).
   c. **Baseline component set** — every component in `baseline.components` for the product's platform, with all listed states and variants. Cover state-coverage (default/hover/focus/disabled/loading/empty/error as applicable per component). When `source_html` exists, modify that HTML in place, preserving existing components, states, content, and layout unless the user explicitly asked to change them.
   Follow the style tokens and these craft principles: avoid generic AI-slop; clear type hierarchy on a small type scale; restrained color with accent reserved for primary actions; WCAG AA contrast; accessible form controls; purposeful motion; honor core UX laws. Follow the **Pure-static contract** in shared SKILL.md.
7. Save the component library with `generate_components`, passing:
   - `product_id`, `html`, `title`, `brand_style`, `system_style` (as before)
   - `product_icon`: `{ primary: "assets/icon.svg", monochrome: "assets/icon-mono.svg", shape: { shape_id: <stable-id>, geometry: <reusable SVG inner markup / path-data string>, source_version: <string> } }`
   - `supporting_files`: `[ { path: "assets/icon.svg", content_type: "image/svg+xml", content_base64: <base64 of primary SVG> }, { path: "assets/icon-mono.svg", content_type: "image/svg+xml", content_base64: <base64 of monochrome SVG> } ]`
   The `primary` and `monochrome` paths in `product_icon` MUST appear in `supporting_files`. These persist into the bundle AND into manifest `forma.productIcon` (role: icon) — the ICON is NOT merely embedded in the library HTML; it is submitted as real SVG files plus structured metadata. Path rules: relative bundle paths only (e.g. `assets/icon.svg`); no absolute paths, no `..` traversal; content_type must be `image/svg+xml`; ≤256KB each.
   The tool returns `artifact_id`, `version`, `preview_status`.
8. Self-review (MANDATORY): run the **Self-review protocol** in shared SKILL.md. The save tool here is `generate_components`.
9. Report `artifact_id`, the final `version`, `preview_status`, and a short craftChecks summary. Report stable error codes exactly as returned.

The component save tool is `generate_components`.
