---
description: Change the style of a Forma product design system.
---

# Forma route: fm-change-style

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Cold path scenario:
The user wants to switch the design system style for a product (e.g., from a default theme to a compact or branded one). The agent lists available styles, shows the current style, asks the user to confirm the target, then calls `change_style` once.

Execution:
1. Require product_id from context or ask the user to run `fm-list-product` first.
2. Call `list_styles` (no arguments) and display available style options with their names and descriptions.
3. Call `get_style` with product_id to show the currently active style.
4. Ask the user to confirm the target style by id (the style name serves as its id).
5. Call `change_style(product_id, style_id)` with the confirmed style id.
6. Report the updated style and stable error codes exactly as returned.
