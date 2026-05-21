---
description: Add or modify a Forma requirement from any granularity of product input.
---

# Forma route: fm-requirement

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Execution:
1. Gate on current session and the latest non-archived requirement. Reject invalid non-product input.
2. Read current context before AI merge with MCP: `get_requirement` for current document, pages, translations, and semantic coverage; `get_product_baseline` for baseline pages and navigation; `get_product` for language config including `languages` and `default_language`; `get_product_rules` for product rules.
3. Inject current document, baseline, language config, and rules into the AI merge prompt. Do not let AI infer these from memory or prior conversation only.
4. Merge user input into the approved Markdown template without deleting or summarizing away facts. Keep stable section order when useful: Overview, Goals, Users, Pages, Flows, Copy, Data/Rules, Acceptance Criteria, Open Questions. Preserve tables, lists, code blocks, and original user language.
5. If `languages.length * page_count > 10`, split generation into two calls: first output document/pages/navigation/rules/removals (`document_md`, `ui_affected`, `pages`, `navigation`, `rules`, and `remove_page_ids`), then output `translations` using the first call's `pages[].copy`.
6. Otherwise output one JSON object with `document_md`, `ui_affected`, `pages`, `navigation`, `translations`, `rules`, and `remove_page_ids`.
7. Run JSON structure validation before conflict detection or saving. If invalid, ask the AI to `re-emit valid JSON once`.
8. Validate `document_md` is non-empty; every page has `page_id`, `name`, `baseline_page`, `change_type`, and structured `copy` when present; navigation references emitted page ids or known baseline page ids; translation page/context references point at emitted page ids and copy contexts from `pages[].copy`; every rule has non-empty `id`, `given`, `when`, and `then`; `remove_page_ids` is an array of strings.
9. Collect requirement semantics explicitly. Pages may include `declared_fields`, `declared_actions`, and `declared_component_keys`; product rules may include `semantic.fields`, `semantic.actions`, `semantic.component_keys`, and `allowed_copy`. Do not ask design agents to infer semantics from free text.
10. Detect direct contradiction, condition coverage conflict, and missing dependency against product rules after excluding rules whose `source_requirement` is the current requirement id.
11. Show page changes, generated rules, semantic declarations, and conflicts to the user.
12. Convert confirmed conflict overrides into `replaces_rule_id` on the generated rule that replaces the old rule.
13. Convert confirmed deletions into `remove_rule_ids`; also include rules associated with confirmed `remove_page_ids`.
14. Call `save_requirement` with the validated document, `ui_affected`, pages, navigation, translations, rules, `remove_page_ids`, `remove_rule_ids`, and replacement metadata. Report stable error codes when returned.
