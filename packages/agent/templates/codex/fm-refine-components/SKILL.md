---
name: fm-refine-components
description: Refine a generated Forma design artifact with targeted instructions.
---

# Forma route: fm-refine-components

Codex route: `$fm-refine-components`.

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Cold path scenario:
The user wants to adjust a previously generated design artifact — changing layout, component styling, or visual details. The agent fetches the artifact, applies the user's refinement instructions with one call to `refine_requirement_design`, then reports the updated preview.

Execution:
1. Require product_id from context or ask the user to run `$fm-list-product` first.
2. Call `list_product_artifacts` with product_id to identify available artifacts, then call `get_product_artifact` with the target artifact_id.
3. Check that the current requirement has `ui_affected === true`; if false, stop and inform the user.
4. Collect refinement instructions from the user. Visual design adjustments only — new capability or copy changes belong in `$fm-requirement`.
5. Call `refine_requirement_design(product_id, requirement_id, artifact_id, instructions)`.
6. Report the updated artifact_id, preview URL (PNG), and stable error codes exactly as returned.
