---
description: Refine the current Forma design through MCP.
---

# Forma route: fm-refine-design

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Execution:
1. Read current session through MCP.
2. Fetch latest requirement.
3. If `ui_affected === false`, print `当前需求无 UI 调整，无需设计` and stop. Do not call design/refine MCP tools for no-UI requirements.
4. Inject exact structured page copy into refinement prompts. Pencil/design refinement must use exact structured page copy and must not improvise text.
5. Confirm operation with product, requirement, and pending or expired pages.
6. Call Forma MCP tools and report stable error codes when returned.
