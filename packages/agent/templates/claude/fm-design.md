---
description: Generate a Forma design from the latest requirement.
---

# Forma route: fm-design

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Execution:
1. Read current session through MCP.
2. Fetch latest requirement.
3. If `ui_affected === false`, print `当前需求无 UI 调整，无需设计` and stop. Do not call design/refine MCP tools for no-UI requirements.
4. Inject exact structured page copy into design prompts. Pencil/design generation must use exact structured page copy and must not improvise text.
5. Confirm operation with product, requirement, and pending or expired pages.
6. For each target page, call `generate_and_save_page_design` with `product_id`, `requirement_id`, `page_id`, `prompt`, and `workspace`.
7. Treat `generate_page_design` as a low-level temporary-output tool only. Do not use it as the normal `fm-design` workflow entrypoint. If a debugging or compatibility workflow uses it, immediately pass the returned `pen_path` and `preview_path` to `save_designs`; otherwise the generated `.pen` can be lost.
8. If design generation returns `PRODUCT_CONFIG_INCOMPLETE` with missing `components_initialized`, confirm default language, call `generate_components` with product config and default language in prompt, call `complete_product_init`, and retry the original `generate_and_save_page_design` call once.
9. Report persisted `design_id`, `version`, `pen_path`, and `preview_path` from `generate_and_save_page_design`.
10. Report stable error codes when returned.
