# Forma Agent Commands

Forma installs Claude, Codex, and Gemini command templates through:

```bash
forma install --platform claude,codex,gemini
```

The installer also writes shared Forma guidance and MCP configuration for the selected platforms.

Claude and Gemini expose routes as `/fm-*`. Codex exposes each route as a skill and uses `$fm-*`.

## v6 Schema Normalization

If `fm-status` reports `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED`, do not continue product or design work. Ask the operator to run `forma schema-normalization-dry-run --home <path>` and then `forma v6-schema-cutover --home <path>` after reviewing the report.

If `fm-status` reports `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`, do not retry normal tools. Use the explicit operator recovery commands: `forma recover-v6-normalization-journal --home <path> --backup-dir <path>` or `forma restore-v6-normalization-backup --home <path> --backup-dir <path> --confirm restore_v6_backup`.

## Commands

| Command | Purpose |
| --- | --- |
| `fm-list-product` | List products, select the current product, complete basic product config, and guide confirmed product deletion. |
| `fm-requirement` | Add or modify a requirement from product input, merge with current context, validate pages/copy/navigation/rules, resolve conflicts, and save through `save_requirement`. |
| `fm-design` | Run v6 requirement-level app-bound design sessions, quality validation, unmanaged import normalization, and explicit component refresh. |
| `fm-refine-components` | Refine product component library versions without mutating existing requirement canvases. |
| `fm-change-style` | Change product style, publish a new product component library version, and leave existing requirement canvases unchanged. |
| `fm-rollback-design` | Roll back a requirement page through v6 requirement-level history and session tools. |
| `fm-status` | Report product, requirement, language, component, and design status. |

## First-Time Setup Flow

1. Install templates for the agent platform:

   ```bash
   forma install --platform claude,codex,gemini
   ```

2. Use `fm-list-product` or the Web admin to select/create a product.
3. Configure the product with platform, style, `languages`, and `default_language`.
4. Product selection is complete after platform, style, `languages`, and `default_language`; it does not require legacy component-initialization flags.
5. Use `fm-status` to confirm platform, style, language config, and default language.

## Iterative Requirement Flow

1. Run `fm-requirement` with the product input, from a short note through a full spec.
2. The command reads current requirement content, baseline pages/navigation, product language config, and product rules before AI merge.
3. Review generated pages, structured copy, translations, navigation, rules, removals, and conflicts.
4. Confirm conflict overrides or deletions. Confirmed overrides become `replaces_rule_id`; confirmed deletions become `remove_rule_ids`.
5. Save through `save_requirement`.
6. Run `fm-design` for UI-affecting design planning. Do not call removed page-level design MCP tools; use `get_requirement_design_canvas`, `begin_requirement_design_session`, `apply_requirement_design_operations`, `validate_requirement_design_quality`, and `commit_requirement_design_session`.

## Design Flow

`fm-design` changes visual design only. New product capability, page, entry, field, action, navigation, component, or business copy belongs in `fm-requirement`; design agents return `REQUIREMENT_UPDATE_REQUIRED` or `SEMANTIC_CONTRACT_REQUIRED` instead of inventing semantics from free text.

Before a write session, `fm-design` reads requirement design state, indexes stale/incomplete canvases, checks the product component library, and runs the route-level `generate_components` macro when the library is missing. The macro calls product component session tools (`begin_product_component_session`, `apply_product_component_operations`, `commit_product_component_session`) and can publish an empty `components: []` version.

During design, agents use only session-scoped Pencil wrappers and submit writes through `apply_requirement_design_operations`. `PENCIL_APP_REQUIRED` is a hard stop with no headless fallback. `validate_requirement_design_quality` runs before commit; at most one bounded `quality_repair` retry is allowed.

Component refresh is explicit: run `index_component_usages`, stop on stable usage/library/contract/override/non-done page errors, then use `begin_requirement_design_session(operation: "component_refresh")`, `refresh_requirement_components`, `apply_requirement_design_operations`, and `commit_requirement_design_session`.

Unmanaged import pages must run `plan_import_metadata_normalization` before visual changes, apply metadata-only operations, rerun quality, and stop on stable blockers.

`fm-rollback-design` requires product, requirement, page, and target version context; old `design_id` alone is not enough and returns `REQUIREMENT_DESIGN_CONTEXT_REQUIRED`.

## Product Deletion

Agents must only enter product deletion when the user explicitly asks to delete a product. Show the product name, product ID, and deletion scope, then require the user to type the exact product ID. Call `delete_product` with the selected ID as `product_id` and use the typed ID as `confirm_product_id`; the values must match. Do not auto-fill `confirm_product_id` from context or treat a generic yes as confirmation.

After deletion, surface `session_cleared` and `recovery_warnings`: if `session_cleared` is true, tell the user to run `fm-list-product` again; if warnings are present, summarize them.

Agents must not suggest `delete_requirement`; requirement removals are expressed through `save_requirement` inputs such as `remove_page_ids` and `remove_rule_ids`.

## No-UI Requirements

Requirements can set `ui_affected=false` for documentation, rules, or logic-only changes.

When `ui_affected === false`, `fm-design` stops before design MCP calls and shows this exact message:

```text
当前需求无 UI 调整，无需设计
```

Document and rule content remain part of the requirement; only design actions are skipped.

## Language And Structured Copy

- Product setup must include `languages` and `default_language`.
- `fm-list-product` and `fm-status` show language configuration and call out old products with missing language config.
- `fm-list-product` completes only basic config: platform, style, `languages`, and `default_language`.
- Requirement pages use structured copy arrays such as `{ context, text }`.
- `fm-design` prompts use exact copy from the requirement and must not improvise UI text.
- Translators and localization agents can use `get_page_copy` and `update_page_copy` to read source copy and update translations without rewriting the requirement document.
