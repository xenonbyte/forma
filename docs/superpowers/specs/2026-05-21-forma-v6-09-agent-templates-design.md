# Forma v6 09: Agent Templates Spec

## Source Design Scope

- DESIGN v6 sections: `Agent 模板要求`, `组件库版本策略`, `Semantic Scope Guard`, `Design Quality Pipeline`, `MCP / Agent 工具调整`, `实施顺序` step 9.
- DESIGN v6 acceptance IDs: 13, 14, 16, 21, 22, 28, 31, 32, 33, 39, 40, 56, 62.
- Depends on: `2026-05-21-forma-v6-08-mcp-tools-design.md`.

## Goal

Update installed agent workflows to use v6 app-bound sessions, requirement-level design state, product component library sessions, semantic scope enforcement, deterministic quality validation, and explicit component refresh. Remove `fm-refine-design` as a route/template.

## Non-Goals

- Do not add new core behavior beyond tool orchestration.
- Do not reintroduce legacy MCP tools through templates.
- Do not let templates call raw Pencil write tools.
- Do not automatically mutate existing requirement canvases after style or component library changes.

## Templates To Update

Update Codex, Claude, and Gemini templates for:

- `fm-design`,
- `fm-change-style`,
- `fm-refine-components`,
- `fm-rollback-design`,
- shared agent guidance,
- installer manifests and copied assets.

Delete source templates and managed installed targets for:

- `fm-refine-design`.

## `fm-design` Workflow

`fm-design` must:

1. Read current product and requirement context.
2. Call `get_requirement_design_canvas`.
3. Handle `index_status` with the fixed rules below before design work.
4. Call `get_product_component_library`.
5. If product component library is missing or invalid and design work needs to start, run the `generate_components` agent macro before `begin_requirement_design_session`.
6. Determine target page actions from page `design_status`, `change_type`, and user intent.
7. Reject user requests that add components, pages, entries, fields, interactions, navigation, or business copy with `REQUIREMENT_UPDATE_REQUIRED`.
8. Show target page, action type, component refresh scope when relevant, semantic contract coverage, and quality strategy to the user before beginning a Pencil session.
9. Call `begin_requirement_design_session`.
10. Use only session-scoped read wrappers for Pencil context.
11. Submit all writes through `apply_requirement_design_operations`.
12. Run `validate_requirement_design_quality` before commit.
13. Apply one bounded `quality_repair` retry when a repair plan exists.
14. Merge optional AI screenshot review as non-blocking commit metadata.
15. Call `commit_requirement_design_session`.
16. Report the returned kind, formal canvas path, preview path or affected pages, quality status, and component usage changes.

`index_status` handling is fixed:

- `missing`: if `design.pen` exists at the requirement-level canonical path, call `index_requirement_design_canvas`; if no `design.pen` exists, proceed to component library check and begin generate session for target pages.
- `incomplete`: call `index_requirement_design_canvas`; if it remains incomplete, report blocked/unmatched pages and stop unless the requested target page is absent and the user explicitly asked to generate that pending page.
- `stale`: call `index_requirement_design_canvas` before any write session. If reindex fails, stop with the returned stable error.
- `recovery_required`: stop and report index recovery details; do not call scene, begin, apply, quality, or commit tools.
- `complete`: proceed without reindex.

Render-time Web behavior for stale-but-readable scenes belongs to spec 10. Agent write workflows must reindex stale canvases before starting an app-bound write session.

## Action Decision Table

| Page state | Change type | User intent | Action |
| --- | --- | --- | --- |
| `pending` | `new` | default | `generate` |
| `expired` | `patch` | default | `refine` |
| `expired` | `rebuild` | default | `rebuild` |
| `done` | any | explicit adjustment | `refine` |
| `done` | any | explicit redo | `rebuild` |
| any | any | explicit component update | `component_refresh` |

Action meanings:

- `generate`: create or complete target page frame.
- `refine`: preserve page structure and requirement copy while making local visual changes.
- `rebuild`: preserve `page_id` metadata and requirement copy while rebuilding visual structure.
- `component_refresh`: update component snapshot and linked instances only.

## Product Component Generation Macro

The agent route-level `generate_components` macro is not an MCP one-shot write tool.

It must:

- build a backend-derived seed manifest from requirement `semantic_contract.component_keys[]`, `declared_component_keys[]`, product rules `semantic.component_keys[]`, and existing component metadata,
- preserve `component_key` exactly,
- set `name` to the component key for new seed components,
- use backend-determined `source`,
- sort `required_by` deterministically by `requirement_id`, then `page_id`,
- call `begin_product_component_session`,
- use session-scoped Pencil read wrappers,
- call `apply_product_component_operations`,
- call `commit_product_component_session`,
- report the commit result without renaming fields.

If no component keys exist, the macro still creates a valid empty component library version with `components: []`.

## Component Refresh Workflow

When the user asks to update current requirement components:

1. Interpret "update all related/common components" as `component_refresh(scope: "all_pages", version: "latest")`.
2. Call `index_component_usages` before opening Pencil App.
3. If preflight finds unlinked usage, missing metadata, unmapped library, contract change, override conflict, or explicit non-done page, return the stable error and do not begin a session.
4. Call `begin_requirement_design_session(operation: "component_refresh")`.
5. Call `refresh_requirement_components` inside the active session.
6. Pass returned operations to `apply_requirement_design_operations`.
7. Commit with `commit_requirement_design_session` and `ai_visual_reviews[]` when available.

Component refresh must not become page redesign and must not add new business capability.

## Unmanaged Import Workflow

If a target page has `quality_report.import_adoption.mode === "unmanaged_import"`:

- call `plan_import_metadata_normalization` before visual changes,
- apply returned operations with `intent: "import_metadata_normalization"`,
- rerun strict quality validation,
- stop on `UNMANAGED_METADATA_NORMALIZATION_REQUIRED` or `REQUIREMENT_UPDATE_REQUIRED`.

## `fm-rollback-design`

Retain `fm-rollback-design` as a v6 route.

Inputs:

- `product_id`,
- `requirement_id`,
- `page_id`,
- `target_page_version`.

If a user only provides old `design_id`, return `REQUIREMENT_DESIGN_CONTEXT_REQUIRED`.

Flow:

1. `get_requirement_design_history`,
2. `begin_requirement_design_session(operation: "rollback")`,
3. `rollback_requirement_design`,
4. `apply_requirement_design_operations`,
5. `commit_requirement_design_session`.

Report:

- `page_version`,
- `canvas_version`,
- `restored_from_page_version`,
- `preview_path`,
- `canvas_path`.

Do not report `design_id`.

## `fm-change-style`

Flow:

1. Update product style configuration.
2. Run product component library app-bound session with `operation: "change_style"`.
3. Commit new component library version.
4. Report `component_library_version` and `library_path`.
5. Do not modify existing requirement `design.pen`.
6. If user requests current requirement sync, tell them to run `fm-design component_refresh`.

## `fm-refine-components`

Flow:

1. Read current product configuration and user component feedback.
2. Run product component library app-bound session with `operation: "refine"`.
3. Commit new component library version.
4. Report `component_library_version` and `library_path`.
5. Do not modify existing requirement `design.pen`.
6. If user requests current requirement sync, tell them to run `fm-design component_refresh`.

## Removed Route Handling

`fm-refine-design`:

- removed from `packages/agent/src/index.ts`,
- removed from template manifests,
- removed from generated help,
- removed from installer managed manifest,
- removed from source templates,
- managed installed target is deleted on upgrade,
- non-managed user files are left alone.

Explicit `fm-refine-design` input follows platform unknown command behavior.

## Prompt Safety Requirements

Templates must state:

- `fm-design` does not modify requirement semantics,
- allowed semantic surface is backend-derived,
- agent must not infer fields/actions/components from free text,
- agent must not call raw Pencil write tools,
- agent must not pass file paths into tools,
- Pencil App must be visible for write actions,
- AI screenshot review is warning-only.

## Failure Handling

- `PENCIL_APP_REQUIRED` stops design and does not request headless fallback.
- `SEMANTIC_CONTRACT_REQUIRED` instructs user to run `fm-requirement`.
- `REQUIREMENT_UPDATE_REQUIRED` instructs user to update requirement before design.
- Component library missing before begin triggers `generate_components` macro; begin API itself does not auto-run macro.
- Quality hard failure after bounded repair returns the stable blocker and keeps formal files unchanged.

## Out Of Scope

- MCP schema implementation belongs to spec 08.
- Web route implementation belongs to spec 10.
- UI status panels belong to spec 11.

## Acceptance Criteria

- `fm-design` templates use v6 session tools and no legacy page-level tools.
- `generate_components` is an agent macro over product component sessions and not an MCP write handler.
- `fm-refine-design` is absent from routes, templates, help, and managed install manifest.
- `fm-change-style` and `fm-refine-components` update only product component library versions.
- `fm-rollback-design` uses requirement-level history and session flow.
- Agent templates reject semantic expansion through `fm-design`.
- Agent templates document quality repair and AI warning-only behavior.

## Verification

- Installer tests cover template copying, removed managed files, and manifest updates.
- Template tests or snapshot checks assert old MCP tool names are not used.
- Agent route tests assert `fm-refine-design` is unknown.
- Template checks assert `fm-design` includes `begin_requirement_design_session`, `apply_requirement_design_operations`, `validate_requirement_design_quality`, and `commit_requirement_design_session`.
- Template checks assert `fm-rollback-design` no longer accepts `design_id` as sufficient context.
