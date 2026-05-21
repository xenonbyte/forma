---
description: List Forma products through the Forma MCP route.
---

# Forma route: fm-list-product

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Execution:
1. Call `list_products`.
2. Display a numbered list using only product name and product ID.
3. Ask the user to choose by number.
4. Call `set_current_session` with the chosen product ID.
5. If basic config is incomplete, follow shared config completion guidance: collect missing platform, style, languages, and default_language, call `init_product_config` or `update_product_config`, then retry `set_current_session` once. Basic config does not include legacy component-initialization flags.
6. On success, fetch and summarize the latest requirement for the selected product.

Deletion branch:
- Only when the user explicitly asks to delete a product, repeat the product name and product ID, describe deletion scope, and state that the user must type the exact product ID.
- For confirmed deletion, call `delete_product` with the selected ID as `product_id` and use the typed ID as `confirm_product_id`; the values must match. Do not auto-fill `confirm_product_id` from context or treat a generic yes as confirmation.
- After deletion, if `session_cleared` is true, tell the user to run `fm-list-product` again. If `recovery_warnings` is non-empty, summarize them.
- Do not expose or suggest requirement deletion tools.

7. Call Forma MCP tools and report stable error codes when returned.
