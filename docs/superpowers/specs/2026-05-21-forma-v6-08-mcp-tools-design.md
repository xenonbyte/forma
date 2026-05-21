# Forma v6 08: MCP Tools Spec

## Source Design Scope

- DESIGN v6 sections: `MCP / Agent 工具调整`, `Session-scoped Pencil wrapper tools`, `受控 Pencil 写操作边界`, `Design Quality Pipeline`, `实施顺序` step 8.
- DESIGN v6 acceptance IDs: 6, 30, 31, 38, 49, 50, 56.
- Depends on: `2026-05-21-forma-v6-07-core-design-quality-model-design.md`.

## Goal

Expose the v6 requirement-level and product component library workflows through MCP tools with strict schemas, stable errors, path-parameter rejection, and session-scoped Pencil wrappers. Removed v5 tools remain unknown.

## Non-Goals

- Do not reintroduce page-level `design_id` tools.
- Do not expose raw Pencil write tools.
- Do not let agent-provided file paths reach Pencil.
- Do not implement agent route templates; that belongs to spec 09.
- Do not implement Web routes; that belongs to spec 10.

## Tool Registry

Register these v6 tools:

- `begin_requirement_design_session`,
- `apply_requirement_design_operations`,
- `commit_requirement_design_session`,
- `discard_requirement_design_session`,
- `recover_design_commit_journal`,
- `begin_product_component_session`,
- `apply_product_component_operations`,
- `commit_product_component_session`,
- `discard_product_component_session`,
- `get_requirement_design_canvas`,
- `index_requirement_design_canvas`,
- `get_requirement_design_scene`,
- `get_requirement_design_history`,
- `rollback_requirement_design`,
- `diff_requirement_design_versions`,
- `export_requirement_design_asset`,
- `get_product_component_library`,
- `index_component_usages`,
- `refresh_requirement_components`,
- `plan_import_metadata_normalization`,
- `validate_requirement_design_quality`,
- `session_get_editor_state`,
- `session_get_guidelines`,
- `session_get_variables`,
- `session_batch_get`,
- `session_snapshot_layout`,
- `session_get_screenshot`,
- `session_export_nodes`.

The removed tool names from spec 04 must remain absent.

## Session-Scoped Wrapper Rules

All session wrapper inputs:

- require `session_id`,
- may include `pencil_binding_id`,
- reject any file path or output path parameter from the caller.

Forbidden parameter names include:

- `filePath`,
- `file_path`,
- `canvas_path`,
- `staging_path`,
- `outputDir`,
- `output_dir`,
- `path`,
- `pen_path`,
- `preview_path`,
- `history_path`.

The backend adapter injects necessary staging path and session-owned output directory.

Wrapper execution validates:

- session status is `running` or allowed `failed_operation` read state,
- product-level lease points to the same session,
- local active file points to the same session,
- `pencil_binding_id` is owned by current Forma process,
- interactive shell process is alive,
- staging path realpath is under the current `$FORMA_HOME`.

## Read/Export Wrapper Contracts

Expose:

- `session_get_editor_state`,
- `session_get_guidelines`,
- `session_get_variables`,
- `session_batch_get`,
- `session_snapshot_layout`,
- `session_get_screenshot`,
- `session_export_nodes`.

`session_export_nodes` writes only to a session-owned output directory and returns paths for display/audit only.

Read wrappers do not update `last_controlled_revision`.
If a wrapper would trigger mutation or save, it must reject the operation.

## Requirement Session Tool Contracts

`begin_requirement_design_session` input includes:

- `product_id`,
- `requirement_id`,
- optional `page_id`,
- `operation: "generate" | "refine" | "rebuild" | "rollback" | "component_refresh"`,
- optional `design_language`,
- optional `component_refresh`.

Return includes:

- `product_id`,
- `requirement_id`,
- `session_id`,
- `pencil_binding_id`,
- formal `canvas_path`,
- session `staging_path`,
- optional `base_canvas_revision`,
- `canvas_state`,
- optional `component_library_version`,
- `requires_component_snapshot`,
- optional `target_page`,
- `mode: "app"`.

`apply_requirement_design_operations` accepts only `tool: "batch_design"` operations with allowed intents:

- `generate`,
- `refine`,
- `rebuild`,
- `rollback`,
- `component_refresh`,
- `quality_repair`,
- `import_metadata_normalization`.

`commit_requirement_design_session` supports page commit and component refresh commit result unions exactly as DESIGN v6 defines.

AI review inputs:

- `ai_visual_review` for page commit,
- `ai_visual_reviews[]` for component refresh,
- two fields are mutually exclusive,
- missing page review in component refresh means skipped `not_requested` without warning.

## Product Component Tool Contracts

`begin_product_component_session` accepts:

- `operation: "generate"` with required `seed_components[]`,
- `operation: "refine" | "change_style"` with optional `seed_components[]`.

`apply_product_component_operations` accepts:

- `batch_design`,
- `set_variables`.

`commit_product_component_session` returns:

- `product_id`,
- `session_id`,
- `pencil_binding_id`,
- `library_path`,
- `version`,
- `version_path`,
- `operation_log_file`,
- `mode: "app"`.

`discard_product_component_session` returns discarded status.

## Component Refresh Contracts

`ComponentRefreshScope`:

- `"all_pages"`,
- object with optional `page_ids`,
- object with optional `component_keys`,
- object with both, interpreted as intersection.

Invalid:

- empty `page_ids`,
- empty `component_keys`,
- missing explicit page,
- missing component key,
- explicit non-done page.

`refresh_requirement_components` returns operations only for fully valid scope. Stable errors include:

- `COMPONENT_USAGE_UNLINKED`,
- `COMPONENT_LIBRARY_UNMAPPED`,
- `COMPONENT_CONTRACT_CHANGED`,
- `COMPONENT_OVERRIDE_CONFLICT`,
- `COMPONENT_REFRESH_PARTIAL_BLOCKED`.

Error details include `blocked_pages[]`, `blocked_usages[]`, `candidate_pages[]`, and `scope`; operations are absent.

## Import Metadata Normalization Contract

`plan_import_metadata_normalization` returns metadata-only operations or throws `UNMANAGED_METADATA_NORMALIZATION_REQUIRED`.

The MCP schema must require:

- `session_id`,
- `product_id`,
- `requirement_id`,
- `page_id`,
- `frame_id`.

It must not accept a file path.

## Stable Error Payloads

MCP handler failures must use `isError: true` and preserve stable error code details from core.

Normalization limited mode:

- keeps only `fm-status` raw status available,
- other Forma tool handlers return `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED` or `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`,
- details are exactly `SchemaNormalizationRecoveryState`.

## Removed Tool Behavior

These names remain unregistered:

- `complete_product_init`,
- one-shot MCP `generate_components`,
- `generate_page_design`,
- `save_designs`,
- `generate_and_save_page_design`,
- `rollback_design`,
- `diff_designs`,
- `get_design_annotations`,
- `export_design_asset`.

Explicit calls must not enter Forma handlers.

## Out Of Scope

- Agent macro named `generate_components` belongs to spec 09.
- Server routes belong to spec 10.
- UI behavior belongs to spec 11.

## Acceptance Criteria

- MCP registry lists all v6 tools and no removed tools.
- All v6 write tools use core session adapters and reject caller-supplied paths.
- Session-scoped wrapper tools inject paths internally and export only to session-owned directories.
- Commit and component refresh schemas enforce AI review input rules.
- Stable core errors propagate through MCP without being renamed.
- Limited normalization mode returns shared normalization details.

## Verification

- MCP tool list tests cover new and removed tools.
- Schema tests reject forbidden path parameters for every wrapper and apply operation payload.
- Handler tests confirm each MCP tool calls the corresponding core service.
- Error tests cover `FORBIDDEN_PATH_PARAMETER`, `DESIGN_SESSION_ACTIVE`, component refresh stable errors, normalization limited mode, and store method unavailable only where transitional test doubles omit a method.
- Negative tests confirm old tool names are unknown.
