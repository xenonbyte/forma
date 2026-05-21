---
name: fm-change-style
description: Change a Forma product design style.
---

# Forma route: fm-change-style

Codex route: `$fm-change-style`.

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Execution:
1. Read current session, product config, and style request through MCP.
2. Update product style configuration with the config tools when needed.
3. Start a product component library session with `begin_product_component_session` and `operation: "change_style"`.
4. Use session-scoped read wrappers, then submit component library writes through `apply_product_component_operations`.
5. Call `commit_product_component_session` and report the component library version and library file.
6. This route must do not mutate existing requirement canvases. If the user asks to sync a current requirement, direct them to `$fm-design component_refresh`.
7. Report stable error codes when returned.
