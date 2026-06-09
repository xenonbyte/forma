---
name: fm-requirement
description: Add or update a Forma requirement from any granularity of product input.
---

# Forma route: fm-requirement

Codex route: `$fm-requirement`.

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Preconditions (tier 1):
- 档1: a product must exist and be selected. This command is the path that creates or populates requirement content, so no un-archived requirement is required as a precondition.
If the core tool returns `REQUIREMENT_NOT_FOUND` or `REQUIREMENT_STATUS_INVALID`, report the error faithfully.

Cold path scenario:
The user describes a new feature or change. The agent reads the current requirement, product baseline, language config, and product rules, merges the user input into the requirement document, validates the result, then saves it with one call to `save_requirement`.

Execution:
1. Require product_id from context or ask the user to run `$fm-list-product` first.
2. Call `get_requirement`, `get_product_baseline`, `get_product` (for language config), and `get_product_rules` to gather current context.
3. Merge user input into the requirement document. Preserve section order: Overview, Goals, Users, Pages, Flows, Copy, Data/Rules, Acceptance Criteria, Open Questions. Do not delete or summarize away existing facts.
4. Produce a JSON object with `document_md`, `ui_affected`, `pages`, `navigation`, `translations`, `rules`, and `remove_page_ids`. If `languages.length * page_count > 10`, split into two calls: structure first, then translations.
5. Validate structure: `document_md` non-empty; every page has `page_id`, `name`, `baseline_page`, `change_type`; navigation references valid page ids; every rule has non-empty `id`, `given`, `when`, and `then`.
6. Show the user a summary of page changes, rules, and any detected conflicts before saving.
7. Call `save_requirement` with the validated payload. Report stable error codes when returned.
