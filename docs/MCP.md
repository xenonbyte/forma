# Forma MCP Tools

Forma MCP tools return JSON text content. Tool failures use a stable payload shape:

```json
{ "error_code": "VALIDATION_ERROR", "message": "Invalid tool input", "details": {} }
```

## Session

- `get_current_session`: reads the current product session.
- `set_current_session`: sets the current product session by `product_id`.

Agents should read session state before route-specific work and should not infer the active product from chat history alone.

## Strict Startup Validation

The MCP server starts only after the Forma home passes strict v6 read-model validation. There is no reduced compatibility tool set for legacy data. If validation fails, the server reports the failure instead of registering normal tools, and status reads do not rewrite YAML or recover files.

## Products

- `list_products`: lists products.
- `get_product`: reads a product, including v0.3 config fields when present.
- `delete_product`: deletes a product after explicit ID confirmation.
- `init_product_config`: writes platform, style, `languages`, and `default_language` for an existing product. v0.3 requires `languages` and `default_language`; `default_language` must be included in `languages`.
- `update_product_config`: updates platform, style, `languages`, and `default_language`. v0.3 requires `languages` and `default_language`.

Product selection/basic configuration is complete when platform, style, languages, and default language are present. This completeness check excludes component initialization.

`delete_product` input is:

```json
{ "product_id": "P-123abc", "confirm_product_id": "P-123abc" }
```

`confirm_product_id` must match `product_id`; otherwise the tool returns a validation error and does not call the store. A successful response includes:

```json
{
  "product_id": "P-123abc",
  "deleted": true,
  "session_cleared": true,
  "cleanup_pending": false,
  "recovery_warnings": []
}
```

If `session_cleared` is true, agents should ask the user to select a product again. If `recovery_warnings` is non-empty, agents should summarize the warnings. Product deletion is lock-protected and can return `PRODUCT_MUTATION_LOCKED`; rollback/recovery failure returns `PRODUCT_DELETION_RECOVERY_FAILED`.

There is no `delete_requirement` MCP tool. Requirement changes and removals remain part of the `save_requirement` state-machine contract.

## Requirements

- `get_requirement_history`: lists requirement history for a product.
- `get_requirement`: reads a requirement by `requirement_id` or the latest product requirement by `product_id`. It returns structured page `copy` and `copy_translations` without legacy page-level design metadata.
- `save_requirement`: creates or updates a requirement through the unified state machine.
- `get_product_rules`: reads persisted product-level behavioral rules.

MCP `save_requirement` requires `requirement_id`, `document_md`, `ui_affected`, `pages`, and `navigation`. It accepts optional `translations`, `rules`, `remove_page_ids`, and `remove_rule_ids`. Pages use structured copy arrays with `{ context, text }`; page changes use `change_type` values `new`, `patch`, or `rebuild`.

## Baseline

- `get_product_baseline`: reads the product functional baseline.
- `get_baseline_page`: reads one baseline page.
- `get_baseline_image`: returns deterministic preview metadata for the latest preview backing a baseline page.

v0.3 `get_baseline_image` can resolve expired baseline pages when an existing preview metadata path or deterministic preview file is still available from a source requirement.

## Designs

Legacy page-level design MCP tools are no longer registered. Explicit calls to removed tool names should receive the MCP platform's unknown tool response, not a Forma compatibility handler.

Requirement-level v6 tools are registered in these groups:

- Session: `begin_requirement_design_session`, `apply_requirement_design_operations`, `commit_requirement_design_session`, `discard_requirement_design_session`, `recover_design_commit_journal`.
- Product components: `begin_product_component_session`, `apply_product_component_operations`, `commit_product_component_session`, `discard_product_component_session`, `get_product_component_library`.
- Read/model: `get_requirement_design_canvas`, `index_requirement_design_canvas`, `get_requirement_design_scene`, `get_requirement_design_history`, `rollback_requirement_design`, `diff_requirement_design_versions`, `export_requirement_design_asset`.
- Component/quality: `index_component_usages`, `refresh_requirement_components`, `plan_import_metadata_normalization`, `validate_requirement_design_quality`.
- Session-scoped Pencil wrappers: `session_get_editor_state`, `session_get_guidelines`, `session_get_variables`, `session_batch_get`, `session_snapshot_layout`, `session_get_screenshot`, `session_export_nodes`.

Session wrapper inputs require `session_id`, may include `pencil_binding_id`, and reject caller-supplied path/output fields such as `filePath`, `file_path`, `canvas_path`, `staging_path`, `outputDir`, `output_dir`, `path`, `pen_path`, `preview_path`, and `history_path`. Requirement design mutations must go through `apply_requirement_design_operations`; requirement sessions accept only `batch_design` operations with v6 intents.

`refresh_requirement_components` accepts `scope: "all_pages"` or an object containing `page_ids`, `component_keys`, or both. Empty arrays and blank page/component keys are validation errors. Stable component refresh errors from core are returned without renaming.

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
2. `get_product_rules`
3. `get_page_copy`

Use that order to load requirement intent, apply behavioral rules, and read source copy before frontend implementation.

## Error Codes

Core Forma errors include:

- `PRODUCT_MUTATION_LOCKED`
- `PRODUCT_DELETION_RECOVERY_FAILED`
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
- `PENCIL_APP_REQUIRED`
- `PENCIL_CAPABILITY_UNAVAILABLE`
- `PENCIL_LOCK_HELD`
- `FORBIDDEN_PATH_PARAMETER`
- `DESIGN_SESSION_ACTIVE`
- `MANUAL_EDIT_DETECTED`
- `COMPONENT_USAGE_UNLINKED`
- `COMPONENT_LIBRARY_UNMAPPED`
- `COMPONENT_CONTRACT_CHANGED`
- `COMPONENT_OVERRIDE_CONFLICT`
- `COMPONENT_REFRESH_PARTIAL_BLOCKED`

MCP wrapper errors include:

- `VALIDATION_ERROR`: input failed schema validation.
- `INTERNAL_ERROR`: unexpected tool failure.
- `REQUIREMENT_PAGE_NOT_FOUND`: requested page is not in the requirement.
- `REQUIREMENT_PRODUCT_MISMATCH`: explicit requirement does not belong to the requested product.
- `BASELINE_PAGE_NOT_FOUND`: requested baseline page is missing.
- `BASELINE_IMAGE_NOT_FOUND`: no preview is available for the baseline page.
