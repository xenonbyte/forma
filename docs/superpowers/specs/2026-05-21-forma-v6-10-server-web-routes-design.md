# Forma v6 10: Server And Web Routes Spec

## Source Design Scope

- DESIGN v6 sections: `Web / Server API 调整`, `后台 UI 调整` status inputs, `锁与失败恢复`, `实施顺序` step 10.
- DESIGN v6 acceptance IDs: 5, 6, 7, 38, 54, 60.
- Depends on: `2026-05-21-forma-v6-08-mcp-tools-design.md`.

## Goal

Expose v6 requirement-level design and product component library routes through Fastify and Web API clients, replace `design_id` Web routing, update baseline image lookup, and make old design routes default 404.

## Non-Goals

- Do not implement core design behavior beyond calling core services.
- Do not implement `DesignSceneCanvas`; that belongs to spec 11.
- Do not reintroduce old `/api/designs/:designId/*` redirects or compatibility handlers.
- Do not let Web mutation payloads include file paths.

## Requirement Page API Type

`RequirementPage` responses include:

- `page_id`,
- `name`,
- `baseline_page`,
- `design_status`,
- `semantic_contract`,
- `semantic_contract_coverage`,
- optional `change_type`,
- optional `change_summary`,
- optional `copy`,
- optional `declared_fields`,
- optional `declared_actions`,
- optional `declared_component_keys`,
- human-readable `fields`,
- human-readable `features`,
- human-readable `interactions`.

Forbidden fields:

- `design_id`,
- `design_metadata.design_id`,
- `image_url` with design id,
- page-level `pen_path`.

## Requirement-Level Read Routes

Register:

| Route | Method | Source |
| --- | --- | --- |
| `/api/products/:productId/requirements/:requirementId/design/canvas` | `GET` | `get_requirement_design_canvas` |
| `/api/products/:productId/requirements/:requirementId/design/index` | `POST` | `index_requirement_design_canvas` |
| `/api/products/:productId/requirements/:requirementId/design/scene` | `GET` | `get_requirement_design_scene` |
| `/api/products/:productId/requirements/:requirementId/design/history?page_id=` | `GET` | `get_requirement_design_history` |
| `/api/products/:productId/requirements/:requirementId/design/preview/:pageId/file?page_version=` | `GET` | requirement-level preview file or history preview |
| `/api/products/:productId/requirements/:requirementId/design/export?node_id=&format=` | `GET` | `export_requirement_design_asset` |
| `/api/products/:productId/requirements/:requirementId/design/diff?page_id=&from_page_version=&to_page_version=` | `GET` | `diff_requirement_design_versions` |
| `/api/products/:productId/design/session/active` | `GET` | product active lease |
| `/api/products/:productId/requirements/:requirementId/design/session/active` | `GET` | requirement active lease |

## Requirement-Level Mutation Routes

Register:

| Route | Method | Source |
| --- | --- | --- |
| `/api/products/:productId/requirements/:requirementId/design/session/begin` | `POST` | `begin_requirement_design_session` |
| `/api/products/:productId/requirements/:requirementId/design/session/:sessionId/operations` | `POST` | `apply_requirement_design_operations` |
| `/api/products/:productId/requirements/:requirementId/design/session/:sessionId/quality` | `POST` | `validate_requirement_design_quality` |
| `/api/products/:productId/requirements/:requirementId/design/session/:sessionId/component-refresh/plan` | `POST` | `refresh_requirement_components` |
| `/api/products/:productId/requirements/:requirementId/design/session/:sessionId/import-metadata-normalization/plan` | `POST` | `plan_import_metadata_normalization` |
| `/api/products/:productId/requirements/:requirementId/design/session/:sessionId/rollback/plan` | `POST` | `rollback_requirement_design` |
| `/api/products/:productId/requirements/:requirementId/design/session/:sessionId/commit` | `POST` | `commit_requirement_design_session` |
| `/api/products/:productId/requirements/:requirementId/design/session/:sessionId/discard` | `POST` | `discard_requirement_design_session` |

Routes validate path params against body params. Body must not include forbidden path fields.

## Product Component Library Routes

Register:

| Route | Method | Source |
| --- | --- | --- |
| `/api/products/:productId/component-library` | `GET` | `get_product_component_library` |
| `/api/products/:productId/component-library/session/begin` | `POST` | `begin_product_component_session` |
| `/api/products/:productId/component-library/session/:sessionId/operations` | `POST` | `apply_product_component_operations` |
| `/api/products/:productId/component-library/session/:sessionId/commit` | `POST` | `commit_product_component_session` |
| `/api/products/:productId/component-library/session/:sessionId/discard` | `POST` | `discard_product_component_session` |
| `/api/products/:productId/design/session/:sessionId/recover-commit-journal` | `POST` | `recover_design_commit_journal` |

## Strict Startup Boundary

Server/Web routes register only after strict v6 read-model validation succeeds. Legacy or incomplete data fails startup instead of exposing a reduced compatibility UI or API set.

## Baseline Image Route

`get_baseline_image` and `/api/products/:productId/baseline/pages/:pageId/image` use requirement-level previews:

- source requirements only,
- non-archived requirements only,
- matching `baseline_page`,
- requirement page `design_status === "done"`,
- candidate sort `updated_at desc, id desc`,
- read `design.yaml.pages[]`,
- return requirement-level payload.

No old `design_id`, page-level `pen_path`, `/api/designs/:designId/*`, or `D-*` fallback is allowed.

## Old Route Removal

These routes are not registered and return default 404:

- `/api/designs/:designId/annotations`,
- `/api/designs/:designId/image`,
- `/api/designs/:designId/image/file`,
- `/api/designs/:designId/history`,
- `/api/designs/:designId/diff`,
- `/api/designs/:designId/export`,
- `/products/:productId/requirements/:requirementId/designs/:designId`.

SPA fallback must exclude old Web design detail paths.

## Web Route And API Client Changes

- `RequirementDetail` links pages to `/products/{productId}/requirements/{requirementId}/design?page_id={page_id}`.
- `DesignView` route params are `productId`, `requirementId`, and optional `page_id`.
- `DesignView` first calls `design/canvas`.
- If `index_status` is `missing` or `incomplete`, show index action and do not call scene during render.
- If `index_status` is `recovery_required`, show recovery state and do not index automatically.
- If `index_status` is `complete`, call scene.
- If `index_status` is `stale` and existing `design.yaml` and preview are readable, allow scene read with stale marker.
- `DiffViewer` uses requirement-level diff params.
- `PropertyPanel` export links use requirement-level design export with `node_id` and `format`.
- Web API types and fixtures remove `design_id`.

## Session Status Data

Active session route responses must expose structured fields needed by UI:

- `session_id`,
- `scope`,
- `operation`,
- `page_id`,
- `pencil_binding_id`,
- `pid`,
- `elapsed_ms`,
- `status`,
- lock details,
- `canvas_path`,
- `staging_path`.

UI is allowed to display paths returned by APIs but must not send them into mutation payloads.

## Failure Handling

- Forbidden path payloads return `FORBIDDEN_PATH_PARAMETER`.
- Missing preview in committed read state returns or records `PREVIEW_NOT_EXPORTED`.
- Index recovery-required state blocks scene reads.
- Old routes do not return custom deprecation handlers.
- Baseline image missing returns `BASELINE_IMAGE_NOT_FOUND`.

## Out Of Scope

- Visual canvas rendering belongs to spec 11.
- Agent prompts belong to spec 09.
- Core quality behavior belongs to spec 07.

## Acceptance Criteria

- Server registers all v6 requirement-level and product component library routes.
- Server does not register old design routes.
- Web API client no longer exposes `design_id`.
- Baseline image route uses v6 requirement-level preview lookup.
- `DesignView` route no longer uses `designId`.
- Mutation routes reject path-like fields.

## Verification

- Server route tests cover each new route's schema, path/body product and requirement checks, and core service call.
- Server negative tests cover old route default 404 and SPA fallback exclusion.
- Baseline route tests cover sort order, archived filtering, pending/expired filtering, preview integrity, and no `D-*` fallback.
- Web API tests cover v6 response shapes and absence of `design_id`.
- Web route tests cover new design URL and old design detail 404.
