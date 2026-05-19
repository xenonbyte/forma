---
name: fm-design
description: Generate or update Forma page designs from UI-affecting requirements.
---

# Forma route: fm-design

Codex route: `$fm-design`.

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Execution:
1. Read current session through MCP.
2. Fetch latest requirement.
3. If `ui_affected === false`, print `当前需求无 UI 调整，无需设计` and stop. Do not call design/refine MCP tools for no-UI requirements.
4. Inject exact structured page copy into design prompts. Pencil/design generation must use exact structured page copy and must not improvise text.
5. Map `change_type` as `new -> generate`, `patch -> refine`, and `rebuild -> update`.
6. Confirm operation with product, requirement, and pending or expired pages, then call the original design generation MCP tool.
7. If design generation returns `PRODUCT_CONFIG_INCOMPLETE` with missing `components_initialized`, confirm default language, call `generate_components` with product config and default language in prompt, call `complete_product_init`, and Retry original design generation once.
8. Report stable error codes when returned.
