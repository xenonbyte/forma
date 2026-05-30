# Forma shared guidance

Use Forma MCP tools for product, requirement, artifact listing, and rollback workflows.

Core rules:
- Every MCP call requires an explicit product_id. There is no current-session concept in v8.
- Product selection: call `list_products` → ask user to choose → call `confirm_product_id` to confirm selection → store product_id in context for subsequent calls.
- Report stable Forma error codes exactly as returned by the MCP server.
- Do not hide pending or failed design state from the user.
- Call Forma MCP tools rather than editing Forma data files directly.
- Design generation commands (fm-design, fm-refine-components, fm-change-style) save an AI-generated static HTML design artifact: the model produces the HTML, Forma localizes its assets, validates it is pure-static (no JS, local-only resources), stores it as a versioned bundle, and renders a preview. Call `get_design_context` before generating to fetch craft rules + the selected brand/system style + the page spec.
- `ui_affected=false` requirements must stop design work before calling artifact or rollback tools.
- Artifacts are static-HTML `design-page` (page designs) or `component-library` outputs. Use `list_product_artifacts(product_id)` to list them and `get_product_artifact(product_id, artifact_id)` to fetch one — it returns a served `bundle_url`, per-asset `urls` (with densities), `versions`, and a `preview_url`. Use `export_artifact` for html/svg single-file or a complete zip bundle.
- Only when the user explicitly asks to delete a product: call `confirm_product_id` first, repeat the product name and product ID, describe deletion scope, and state that the user must type the exact product ID. Do not auto-fill confirmation from context or treat a generic yes as confirmation.
- After product deletion, if `recovery_warnings` is non-empty, summarize them.
- Do not expose or suggest requirement deletion tools.
- Keep stable MCP usage: read fresh state, validate before saving, call the intended mutation once.
