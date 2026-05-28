# Forma shared guidance

Use Forma MCP tools for product, requirement, artifact listing, and rollback workflows.

Core rules:
- Every MCP call requires an explicit product_id. There is no current-session concept in v8.
- Product selection: call `list_products` → ask user to choose → call `confirm_product_id` to confirm selection → store product_id in context for subsequent calls.
- Report stable Forma error codes exactly as returned by the MCP server.
- Do not hide pending or failed design state from the user.
- Call Forma MCP tools rather than editing Forma data files directly.
- Design generation commands (fm-design, fm-refine-components, fm-change-style) call the OD runtime. Until the runtime is wired, they return OD_RUNTIME_FAILED — this is expected and not a bug.
- `ui_affected=false` requirements must stop design work before calling artifact or rollback tools.
- v8 artifacts are HTML/design-system outputs. Use `list_product_artifacts(product_id)` to list them and `get_product_artifact(product_id, artifact_id)` to fetch one. Preview is a PNG URL returned with the artifact.
- Only when the user explicitly asks to delete a product: call `confirm_product_id` first, repeat the product name and product ID, describe deletion scope, and state that the user must type the exact product ID. Do not auto-fill confirmation from context or treat a generic yes as confirmation.
- After product deletion, if `recovery_warnings` is non-empty, summarize them.
- Do not expose or suggest requirement deletion tools.
- Keep stable MCP usage: read fresh state, validate before saving, call the intended mutation once.
