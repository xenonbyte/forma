# Forma Agent Commands

Forma installs Claude, Codex, and Gemini command templates through:

```bash
forma install --platform claude,codex,gemini
```

The installer also writes shared Forma guidance and MCP configuration for the selected platforms.

Claude and Gemini expose routes as `/fm-*`. Codex exposes each route as a skill and uses `$fm-*`.

## Commands

| Command | Purpose |
| --- | --- |
| `fm-list-product` | List products, select the current product, complete basic product config, and guide confirmed product deletion. |
| `fm-requirement` | Add or modify a requirement from product input, merge with current context, validate pages/copy/navigation/rules, resolve conflicts, and save through `save_requirement`. |
| `fm-design` | Generate or update page designs from the latest UI-affecting requirement using exact structured copy. |
| `fm-refine-design` | Refine current designs while preserving requirement copy and design context. |
| `fm-refine-components` | Refine generated product components when style or product UI conventions need adjustment. |
| `fm-change-style` | Change product style and update product configuration through Forma MCP tools. |
| `fm-rollback-design` | Roll back a design version through Forma MCP tools. |
| `fm-status` | Report product, requirement, language, component, and design status. |

## First-Time Setup Flow

1. Install templates for the agent platform:

   ```bash
   forma install --platform claude,codex,gemini
   ```

2. Use `fm-list-product` or the Web admin to select/create a product.
3. Configure the product with platform, style, `languages`, and `default_language`.
4. Product selection is complete after platform, style, `languages`, and `default_language`; it does not require `components_initialized`.
5. Generate components through the agent/MCP flow when page design needs them, then call `complete_product_init` through the MCP/agent route after components are generated.
6. Use `fm-status` to confirm platform, style, language config, default language, and component initialization.

## Iterative Requirement Flow

1. Run `fm-requirement` with the product input, from a short note through a full spec.
2. The command reads current requirement content, baseline pages/navigation, product language config, and product rules before AI merge.
3. Review generated pages, structured copy, translations, navigation, rules, removals, and conflicts.
4. Confirm conflict overrides or deletions. Confirmed overrides become `replaces_rule_id`; confirmed deletions become `remove_rule_ids`.
5. Save through `save_requirement`.
6. Run `fm-design` for new/rebuild work or `fm-refine-design` for patch/refinement work as applicable.

`fm-design` must call `generate_and_save_page_design` with `product_id`, `requirement_id`, `page_id`, `prompt`, and `workspace` for each target page. It must report the returned `design_id`, `version`, `pen_path`, and `preview_path`. `generate_page_design` is a low-level temporary-output tool only; low-level callers must pass the returned paths to `save_designs`, otherwise the generated `.pen` can remain temporary and be lost.

If `fm-design` reaches page design and the product is missing `components_initialized`, confirm the default language, call `generate_components`, call `complete_product_init`, then retry the original `generate_and_save_page_design` call once.

## Product Deletion

Agents must only enter product deletion when the user explicitly asks to delete a product. Show the product name, product ID, and deletion scope, then require the user to type the exact product ID. Call `delete_product` with the selected ID as `product_id` and use the typed ID as `confirm_product_id`; the values must match. Do not auto-fill `confirm_product_id` from context or treat a generic yes as confirmation.

After deletion, surface `session_cleared` and `recovery_warnings`: if `session_cleared` is true, tell the user to run `fm-list-product` again; if warnings are present, summarize them.

Agents must not suggest `delete_requirement`; requirement removals are expressed through `save_requirement` inputs such as `remove_page_ids` and `remove_rule_ids`.

## No-UI Requirements

Requirements can set `ui_affected=false` for documentation, rules, or logic-only changes.

When `ui_affected === false`, `fm-design` and `fm-refine-design` stop before design/refine MCP calls and show this exact message:

```text
当前需求无 UI 调整，无需设计
```

Document and rule content remain part of the requirement; only design actions are skipped.

## Language And Structured Copy

- Product setup must include `languages` and `default_language`.
- `fm-list-product` and `fm-status` show language configuration and call out old products with missing language config.
- `fm-list-product` completes only basic config: platform, style, `languages`, and `default_language`.
- Requirement pages use structured copy arrays such as `{ context, text }`.
- `fm-design` and `fm-refine-design` prompts use exact copy from the requirement and must not improvise UI text.
- Translators and localization agents can use `get_page_copy` and `update_page_copy` to read source copy and update translations without rewriting the requirement document.
