---
description: Roll back a Forma design artifact to a previous version.
---

# Forma route: fm-rollback-design

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Cold path scenario:
The user wants to undo a recent design generation by moving one requirement page/variant back to an earlier saved version. Normal `fm-design` re-runs for the same requirement/page/variant append versions to the current design artifact, so the agent lists available design-page artifacts and versions, asks the user to choose the page, variant, and target version on the current artifact, then calls the rollback tool once to flip that page/variant pointer.

Execution:
1. Require product_id from context or ask the user to run `fm-list-product` first.
2. Call `list_product_artifacts` with product_id, `include_superseded: true`, and `kind: "design-page"` to display product-wide available design artifacts. Do not infer a latest requirement from product_id, and do not hide candidates from other requirements unless the user explicitly asked to narrow the list after seeing the product-wide candidates.
3. For each candidate, show artifact_id, requirement_id, page_id, variant (default `default`), current_version, versions, title, preview URL, and whether it is superseded. Superseded artifacts are legacy/orphaned history only; choose `target_version` from the current non-superseded artifact for that page/variant. Do not ask for an artifact id as the rollback target; rollback is by requirement/page/variant pointer plus target_version.
4. Ask the user to choose a candidate and confirm `requirement_id`, `page_id`, `variant` (or `default`), and `target_version`.
5. Using the selected artifact's `requirement_id`, call `rollback_requirement_design` with product_id, requirement_id, page_id, variant, and target_version.
6. Report the restored `page_id`, `variant`, `version`, and stable error codes exactly as returned.
