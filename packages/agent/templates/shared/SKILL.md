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
- v0.3 structured copy is authoritative: pass page `copy` arrays and translations exactly, preserving context keys and text.
- v0.3 `ui_affected=false` requirements must stop design/refine routes before calling design tools.
- Keep stable MCP usage: read fresh MCP state, validate generated JSON before saving, then call the intended MCP mutation once.
