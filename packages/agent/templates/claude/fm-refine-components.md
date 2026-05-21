---
description: Refine generated Forma components through MCP.
---

# Forma route: fm-refine-components

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Execution:
1. Read current session, product config, component library, and user component feedback through MCP.
2. Start a product component library session with `begin_product_component_session` and `operation: "refine"`. Preserve explicit `component_key` values.
3. Use session-scoped read wrappers, then submit component library writes through `apply_product_component_operations`.
4. Call `commit_product_component_session` and report the component library version and library file.
5. This route must do not mutate existing requirement canvases. If the user asks to sync a current requirement, direct them to `fm-design component_refresh`.
6. Report stable error codes when returned.
