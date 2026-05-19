# Forma shared guidance

Use Forma MCP tools for product, requirement, design, style, and rollback workflows.

Core rules:
- Read the current session before taking route-specific action.
- Fetch the latest requirement when the route needs requirement context.
- Construct a prompt from current product, current requirement, and route intent.
- Call Forma MCP tools rather than editing Forma data files directly.
- Report stable Forma error codes exactly as returned by the MCP server.
- Do not hide pending or expired design state from the user.
- v0.3 language config is product context: surface `languages` and `default_language`, and clearly call out old products with missing languages.
- Product selection completeness excludes `components_initialized`; selected products only need platform, style, languages, and default_language.
- If product selection returns `PRODUCT_CONFIG_INCOMPLETE` for basic config, collect missing platform, style, languages, and default_language, call `init_product_config` or `update_product_config`, then retry `set_current_session` once. Do not generate components during product selection.
- Design routes own missing component initialization: if design generation reports missing `components_initialized`, confirm the default language, call `generate_components`, call `complete_product_init`, then retry design once.
- Only when the user explicitly asks to delete a product, require explicit confirmation: repeat the product name and product ID, describe deletion scope, and state that the user must type the exact product ID.
- For product deletion, pass the selected ID as `product_id` and use the typed ID as `confirm_product_id`; the values must match. Do not auto-fill `confirm_product_id` from context or treat a generic yes as confirmation.
- After product deletion, if `session_cleared` is true, tell the user to run `fm-list-product` again; if `recovery_warnings` is non-empty, summarize them.
- Do not expose or suggest requirement deletion tools.
- v0.3 structured copy is authoritative: pass page `copy` arrays and translations exactly, preserving context keys and text.
- v0.3 `ui_affected=false` requirements must stop design/refine routes before calling design tools.
- Keep stable MCP usage: read fresh MCP state, validate generated JSON before saving, then call the intended MCP mutation once.
