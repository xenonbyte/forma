# Forma MCP Tools

Forma MCP tools return JSON text content. Tool failures use a stable payload shape:

```json
{ "error_code": "VALIDATION_ERROR", "message": "Invalid tool input", "details": {} }
```

## Session

- `get_current_session`: reads the current product session.
- `set_current_session`: sets the current product session by `product_id`.

Agents should read session state before route-specific work and should not infer the active product from chat history alone.

## Products

- `list_products`: lists products.
- `get_product`: reads a product, including v0.3 config fields when present.
- `init_product_config`: writes platform, style, `languages`, and `default_language` for an existing product. v0.3 requires `languages` and `default_language`; `default_language` must be included in `languages`.
- `update_product_config`: updates platform, style, `languages`, and `default_language`. v0.3 requires `languages` and `default_language`.
- `complete_product_init`: marks product components as initialized after component generation.

Product configuration is complete only when platform, style, languages/default language, and component initialization are present.

## Requirements

- `get_requirement_history`: lists requirement history for a product.
- `get_requirement`: reads a requirement by `requirement_id` or the latest product requirement by `product_id`. v0.3 returns structured page `copy`, `copy_translations`, and page `design_metadata` when available.
- `save_requirement`: creates or updates a requirement through the unified state machine.
- `get_product_rules`: reads persisted product-level behavioral rules.

`save_requirement` accepts `document_md`, `ui_affected`, pages, navigation, translations, rules, `remove_page_ids`, and `remove_rule_ids`. Pages use structured copy arrays with `{ context, text }`; page changes use `change_type` values `new`, `patch`, or `rebuild`.

## Baseline

- `get_product_baseline`: reads the product functional baseline.
- `get_baseline_page`: reads one baseline page.
- `get_baseline_image`: returns deterministic preview metadata for the latest preview backing a baseline page.

v0.3 `get_baseline_image` can resolve expired baseline pages when an existing preview metadata path or deterministic preview file is still available from a source requirement.

## Designs

- `generate_page_design`: generates a page design through Pencil.
- `generate_components`: generates product components through Pencil.
- `save_designs`: persists validated design outputs.
- `rollback_design`: rolls a design back to the previous version.
- `diff_designs`: compares annotations between two design versions.
- `get_design_annotations`: reads design annotations.
- `export_design_asset`: exports a design node as `png`, `svg`, or `pdf`.

Design generation checks product configuration. Page design requires initialized components; component generation requires product platform, style, and languages.

## Styles

- `list_styles`: lists installed styles.
- `get_style`: reads style metadata and design guidance by name.

Style metadata includes variables used by prompts and UI configuration.

## Copy

- `get_page_copy`: reads source copy and translations for a requirement page. Without `requirement_id`, it resolves the latest non-archived requirement for the product.
- `update_page_copy`: updates translations for a requirement page and returns the updated translation set.

Translation entries use `{ context, texts, outdated }`, where `texts` maps language code to translated text. Keep `context` aligned with the source page copy.

## Utilities

- `help`: lists tool names and usage guidance.

`help.usage_guide.workflows.develop_frontend` documents this four-step data path for implementation agents:

1. `get_requirement`
2. `get_design_annotations`
3. `export_design_asset`
4. `get_product_rules`

Use that order to load requirement intent, inspect the generated design, export required assets, and apply behavioral rules before frontend implementation.

## Error Codes

Core Forma errors include:

- `PRODUCT_CONFIG_INCOMPLETE`
- `REQUIREMENT_STATUS_INVALID`
- `DOCUMENT_EMPTY`
- `PAGES_EMPTY`
- `PAGE_NOT_OWNED`
- `PEN_FILE_INVALID`
- `PAGE_NOT_DONE`
- `DESIGN_MODE_INVALID`
- `NODE_NOT_FOUND`
- `EXPORT_FORMAT_UNSUPPORTED`
- `VERSION_TOO_LOW`
- `HISTORY_FILE_MISSING`
- `PRODUCT_NOT_FOUND`
- `REQUIREMENT_NOT_FOUND`
- `DESIGN_NOT_FOUND`
- `STYLE_NOT_FOUND`
- `SYNC_ALREADY_RUNNING`
- `SYNC_GIT_NOT_FOUND`
- `PENCIL_CLI_NOT_FOUND`
- `PENCIL_NOT_AUTHENTICATED`
- `PENCIL_LOCK_HELD`

MCP wrapper errors include:

- `VALIDATION_ERROR`: input failed schema validation.
- `INTERNAL_ERROR`: unexpected tool failure.
- `REQUIREMENT_PAGE_NOT_FOUND`: requested page is not in the requirement.
- `REQUIREMENT_PRODUCT_MISMATCH`: explicit requirement does not belong to the requested product.
- `BASELINE_PAGE_NOT_FOUND`: requested baseline page is missing.
- `BASELINE_IMAGE_NOT_FOUND`: no preview is available for the baseline page.
