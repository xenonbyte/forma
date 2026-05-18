---
name: fm-list-product
description: List and select Forma products, including setup status and language fallback.
---

# Forma route: fm-list-product

Codex route: `$fm-list-product`.

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Execution:
1. Read current session through MCP.
2. Fetch latest requirement when a current product is available.
3. Display each product with platform, style, languages and default_language. If old products have missing languages, show `missing languages` instead of hiding the gap.
4. When the user selects a product for component generation, confirm default language before continuing.
5. Use default language in component-generation prompt so generated components and labels match product language config.
6. Call Forma MCP tools and report stable error codes when returned.
