---
description: List and select Forma products.
---

# Forma route: fm-list-product

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Cold path scenario:
The user wants to switch to a different product or see what products exist. The agent calls `list_products`, shows a numbered list, asks the user to pick, calls `confirm_product_id` with the chosen product ID, then fetches and summarizes the latest requirement for the selected product.

Execution:
1. Call `list_products`.
2. Display a numbered list using only product name and product ID.
3. Ask the user to choose by number.
4. Call `confirm_product_id` with the chosen product ID to confirm selection.
5. On success, call `get_requirement` with product_id and summarize the latest requirement.
6. Report stable error codes when returned.

- Do not expose or suggest requirement deletion tools.
