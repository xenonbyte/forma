# Forma v6 07: Core Design Quality Model Spec

## Source Design Scope

- DESIGN v6 sections: `需求级主画布`, `通用组件关联模型`, `页面状态记录`, `Design Quality Pipeline`, `Semantic Scope Guard`, `页面 frame 映射规则`, `已有主画布识别`, `MCP / Agent 工具调整` core tool contracts, `实施顺序` step 7.
- DESIGN v6 acceptance IDs: 1, 2, 3, 9, 12, 16, 18, 19, 22-37, 39, 40, 51, 58, 63.
- Depends on: `2026-05-21-forma-v6-06-pencil-session-orchestration-design.md`.

## Goal

Implement the core requirement-level design model: `design.yaml` writes, existing main canvas indexing, page/frame mapping, history, scene payload, unmanaged import adoption, metadata normalization planning, component usage indexing, component refresh planning, deterministic Design Quality Pipeline, and Semantic Scope Guard.

## Non-Goals

- Do not expose public MCP tools until spec 08.
- Do not implement agent template workflows until spec 09.
- Do not implement Web routes until spec 10.
- Do not implement LeaferJS UI rendering until spec 11.

## Requirement Design Persistence

The formal requirement design files are:

- `data/{product_id}/{requirement_id}/design.pen`,
- `data/{product_id}/{requirement_id}/design.yaml`,
- `data/{product_id}/{requirement_id}/previews/{page_id}@2x.png`,
- `data/{product_id}/{requirement_id}/history/canvas/canvas.c{canvas_version}.pen`,
- `data/{product_id}/{requirement_id}/history/canvas/canvas.c{canvas_version}.yaml`,
- `data/{product_id}/{requirement_id}/history/pages/{page_id}.p{page_version}.pen-fragment`,
- `data/{product_id}/{requirement_id}/history/previews/{page_id}.p{page_version}@2x.png`.

`canvas_version` is global to the requirement canvas and increments on each committed session or first successful index.
`page_version` is per page and increments only when that page changes through index, generate, refine, rebuild, rollback, or component refresh affecting that page.

`design.yaml.last_commit.source` is `index` or `session_commit`.

## Existing Main Canvas Index

`index_requirement_design_canvas` core behavior:

- reads only `data/{product_id}/{requirement_id}/design.pen`,
- validates the `.pen` structure,
- scans top-level nodes,
- matches requirement pages deterministically,
- classifies unmanaged component candidate nodes,
- runs index-mode deterministic quality checks for matched pages,
- exports preview candidates to index staging,
- writes `design.yaml`, previews, history, and requirement page `design_status` through index journal,
- restores old index state on journal failure.

It must not read page-level `D-*` directories.

## Page Frame Mapping

Page match priority:

1. `metadata.type === "forma"` + `metadata.kind === "requirement_page"` + `metadata.page_id`,
2. normalized English frame-name prefix equals page `page_id`,
3. normalized frame name equals requirement page `name`.

Ambiguity returns `PAGE_FRAME_AMBIGUOUS`.
Metadata/name conflict returns `PAGE_FRAME_MISMATCH`.
Missing frame on commit/export returns `PAGE_FRAME_NOT_FOUND`.

Top-level component candidate nodes are not pages. The fixed unmanaged allowlist includes the names from DESIGN v6, including `Divider` when `reusable: true`.

## Unmanaged Import Adoption

First-time indexing of a user-placed `design.pen` uses unmanaged import semantic mode when required Forma metadata is missing.

Rules:

- missing Forma metadata on imported page frames does not block first index,
- page semantic mode records `unmanaged_import`,
- page text is classified into `contract_copy`, `system_text`, or `imported_unverified_copy`,
- system text allowlist uses only DESIGN v6 deterministic rules,
- `imported_unverified_copy` writes `UNMANAGED_COPY_UNVERIFIED` warning and does not enter allowed copy,
- interaction/action/field/navigation/component semantics are not inferred from missing metadata,
- unmanaged import pages can be marked `done` only after hard quality checks pass.

Subsequent active session modification of an unmanaged page must first run metadata normalization planning and strict Semantic Scope Guard.

## Import Metadata Normalization Plan

`plan_import_metadata_normalization`:

- reads active session staging `.pen`,
- reads session `semantic_scope.yaml`,
- scans target frame with `resolveInstances: false`,
- produces metadata-only `batch_design` operations when every semantic node maps uniquely,
- returns `UNMANAGED_METADATA_NORMALIZATION_REQUIRED` with unresolved nodes when mapping is not unique,
- never changes geometry, style, layer order, copy, ref target, or children,
- invalidates old plans when staging revision changes.

## Semantic Scope Guard

`begin_requirement_design_session` writes `semantic_scope.yaml` using backend-derived `AllowedSemanticSurface`.

Allowed surface includes:

- allowed copy in selected design language,
- allowed page ids,
- allowed navigation targets,
- allowed fields,
- allowed actions,
- allowed component keys intersected with current requirement snapshot,
- allowed visual states,
- existing node ids,
- baseline node ids,
- `source_contract_hash`.

Strict checks:

- business text must match allowed copy unless decorative,
- action nodes need allowed `action_key`,
- navigation nodes need allowed `navigation_target`,
- field nodes need allowed `field_key`,
- component instances need allowed `component_key`,
- decorative nodes cannot contain business semantics,
- unclassified semantic nodes return `DESIGN_SCOPE_VIOLATION`.

Requirement or translation changes after begin return `SEMANTIC_SCOPE_CHANGED`.

## Design Quality Pipeline

Hard checks:

- `pencil_schema`,
- `color_format`,
- `property_compatibility`,
- `layout_snapshot`,
- `preview_export`,
- `semantic_scope`.

Hard blockers:

- `PENCIL_SCHEMA_INVALID`,
- `PENCIL_COLOR_INVALID`,
- `PENCIL_PROPERTY_INVALID`,
- `DESIGN_LAYOUT_INVALID`,
- `DESIGN_SCOPE_VIOLATION`,
- `PREVIEW_EXPORT_FAILED`.

Warnings:

- non-blocking guide suggestions,
- spacing or title consistency suggestions,
- AI screenshot review warnings,
- skipped AI review for no vision, screenshot failure, or timeout.

AI screenshot review runs only after deterministic hard checks pass and never blocks commit.

Before any `generate`, `refine`, `rebuild`, `rollback`, `component_refresh`, or quality repair prompt is accepted, the active session workflow must load Pencil context through session-scoped wrappers:

- `session_get_editor_state(session_id, include_schema: true)`,
- `session_get_guidelines(session_id, category: "guide", name: "Design System")`,
- platform guide mapped from product platform,
- `session_get_guidelines(..., name: "Table")` when structured page metadata marks the page table-heavy,
- `session_get_variables(session_id)`.

Guide loading failure is `PENCIL_CAPABILITY_UNAVAILABLE` with `failed_phase: "guideline_load"` and `missing_guidelines[]`. It is not a warning and cannot be skipped.

Color constraints are fixed:

- allowed colors are `$--variable`, `#RRGGBB`, or `#RRGGBBAA`,
- `rgb()`, `rgba()`, `hsl()`, named colors, and CSS shorthand are invalid before repair,
- fill, stroke fill, effect color, text color, and icon color follow the same rule.

Property constraints are fixed:

- `letterSpacing`, `padding`, `gap`, `cornerRadius`, and similar Pencil schema fields must use schema-accepted scalar/object types,
- array values for scalar fields return `PENCIL_PROPERTY_INVALID`.

`DesignQualityReport.status` summary rules:

- any hard check `blocked` means `status: "blocked"` and commit is forbidden,
- all hard checks passed or fixed plus warnings means `status: "warning"` and commit is allowed,
- all hard checks passed or fixed and no warnings means `status: "passed"`,
- `ai_visual_review.status: "warning"` always writes a warning and makes overall status `warning`,
- `ai_visual_review.status: "skipped"` writes `AI_VISUAL_REVIEW_SKIPPED` only for `model_has_no_vision`, `screenshot_failed`, or `timeout`,
- `ai_visual_review.status: "skipped"` with `reason: "not_requested"` does not add warning and does not change overall status.

## Layout Snapshot Rules

Quality gate must call `session_snapshot_layout(problemsOnly: false, parentId: frame_id, maxDepth: 8)`.

It must continue scanning descendants when truncation markers or omitted descendants appear. It blocks when scan completeness cannot be proven.

Required layout inputs are limited to currently verified Pencil output:

- layout tree fields `id`, `x`, `y`, `width`, `height`, `children`,
- `session_batch_get` node type, metadata, `clip`, `rotation`, `textGrowth`, ref/component information, and visibility.

The quality gate must not read unprobed `absoluteBounds`, `visibleBounds`, `clipBounds`, `problemCode`, parent id, or layout node type. Future use requires a probed capability and tests.

Critical nodes are nodes satisfying any of:

- non-empty text,
- Forma metadata `action_key`,
- Forma metadata `navigation_target`,
- Forma metadata `field_key`,
- Forma metadata `kind: component_instance`,
- Pencil/scene semantic form, input, or button type,
- visible non-decorative node with area greater than zero.

Blocking thresholds:

- target frame missing `id/x/y/width/height`, zero size, or negative size blocks,
- critical node outside page frame blocks,
- critical node visible area under nearest clipping ancestor or page frame below 95% blocks,
- overlap between two critical nodes above 25% of the smaller node area blocks,
- decorative node overlap over 10% of a critical node blocks,
- decorative overlap where the adapter cannot prove coverage below 10% blocks with `decorative_overlap_unproven`,
- unsupported geometry on a critical node blocks with `layout_geometry_unsupported`,
- fixed-width-height text whose overflow safety cannot be proven blocks with `text_overflow_unverified`,
- incomplete scan blocks with `layout_scan_incomplete`.

Limits:

- layout phase total timeout: 120 seconds,
- max expanded parent nodes: 500,
- max layout nodes: 5000.

Unsupported geometry on critical nodes returns `DESIGN_LAYOUT_INVALID`.
Decorative overlap with critical nodes blocks when safe overlap cannot be proven.

`quality_report.hard_checks.layout_snapshot_details` records scanned node count, expanded parent count, truncated parent count, elapsed time, fixed limits, and limit hit.

If the parent queue exceeds 500, node count exceeds 5000, or total layout phase exceeds 120 seconds, the blocker is `DESIGN_LAYOUT_INVALID` with `reason: "layout_scan_limit_exceeded"` or `reason: "timeout"` as applicable.

## Preview Export Rules

Quality gate exports preview candidates to session or index staging directories.
Formal `previews/{page_id}@2x.png` is replaced only by commit/index journal promotion.

`PREVIEW_EXPORT_FAILED` means candidate export failed during a write/index workflow. It is a quality gate error for the current candidate, HTTP status 422 in Web/API routes, and must not replace formal preview or advance `design_status`.

`PREVIEW_NOT_EXPORTED` means committed data claims a preview should exist but read path cannot find or verify it. It is a read integrity error, HTTP status 409 in Web/API routes, and must include `page_id`, `preview_file`, and `canvas_revision` details.

Read paths must not regenerate previews.

## Color Repair

`validate_requirement_design_quality` returns `repair_plan.operations[]` for deterministic color conversion when invalid colors are convertible:

- `rgb(...)` to `#RRGGBB`,
- `rgba(...)` to `#RRGGBBAA`.

It does not write repairs. Repairs must be applied through `apply_requirement_design_operations(intent: "quality_repair")`, followed by a second validation.

## Component Usage Index

`index_component_usages` scans committed requirement canvas:

- finds `metadata.type === "forma"` and `metadata.kind === "component_instance"`,
- verifies node is a ref instance,
- verifies ref target is in current `Components - Snapshot v{version}`,
- verifies `component_key` exists in `design.yaml.component_library.components`,
- writes linked usage records.

Detached copy or missing metadata returns unlinked usage with stable reasons.

## Component Refresh Plan

`refresh_requirement_components`:

- runs only inside active requirement session,
- rescans staging usage graph,
- validates current pinned component library and target version,
- rejects unmapped libraries, unlinked usage, semantic contract changes, override conflicts, and non-done explicit pages,
- returns operations only when the entire requested scope can refresh safely,
- uses staging snapshot frame `Components - Snapshot v{version} (staging)` before promotion,
- never directly modifies `.pen` or advances `design.yaml`.

Successful commit updates component snapshot, affected pages, previews, page versions, and `design.yaml.component_library.version`.

## Scene Payload

`get_requirement_design_scene` core payload must derive from requirement-level `design.pen` and `design.yaml`.

It returns:

- canvas metadata,
- page records with preview state,
- structured nodes,
- unsupported properties.

It is not a raw `.pen` dump and not screenshot OCR.

## History, Rollback, Diff, Export Core

Core services must support:

- `get_requirement_design_history`,
- `rollback_requirement_design` operation plan from `history/pages/{page_id}.p{page_version}.pen-fragment`,
- `diff_requirement_design_versions`,
- `export_requirement_design_asset`.

Rollback only returns operations. Actual write happens through apply and commit.
Rollback creates a new page version and canvas version; it does not overwrite the restored-from version.

## Requirement Commit Candidate Builder

Spec 07 completes the public `commit_requirement_design_session` behavior by supplying the full candidate set required by the spec 06 commit journal substrate.

For `operation: "generate" | "refine" | "rebuild" | "rollback"`, commit must:

- require `page_id` and `frame_id`,
- controlled-save and revision-check staging through spec 06 substrate,
- verify target frame by `page_id + frame_id`,
- run deterministic Design Quality Pipeline for the target frame,
- merge optional AI review as warning-only metadata,
- export preview candidate to session staging,
- compute next `canvas_version`,
- compute next page `page_version`,
- write history candidates,
- build final `design.yaml` candidate with canvas revision, preview hashes, history hashes, quality report, and `last_commit.source: "session_commit"`,
- build final `requirement.yaml` candidate with target page `design_status: "done"`,
- call the spec 06 commit journal substrate with all formal file candidates.

For `operation: "component_refresh"`, commit must:

- use `planned_affected_pages[]` from `refresh_requirement_components`,
- verify each affected page by `page_id + frame_id`,
- run deterministic quality checks for every affected page,
- fail the entire commit if any affected page fails quality or preview export,
- compute one new `canvas_version`,
- compute new `page_version` for every affected page,
- update `design.yaml.component_library.version`,
- update affected pages' `component_usages`,
- export only affected previews,
- call the same commit journal substrate.

Commit replacement order is fixed:

1. preview and history candidates,
2. `design.yaml` candidate,
3. `design.pen` candidate,
4. `requirement.yaml` candidate.

Any failure restores by journal through spec 06. Recovery failure returns `DESIGN_COMMIT_RECOVERY_REQUIRED` and keeps leases.

## Failure Handling

- Index journal failure restores old `design.yaml`, previews, and requirement status.
- Matched page quality failure enters `blocked_pages[]` and does not mark the page done.
- Unmatched pages stay pending or existing status by DESIGN v6 index rules.
- Component refresh has no partial success payload.
- Semantic scope violation blocks formal preview export and page status advancement.
- Preview read integrity failure returns or records `PREVIEW_NOT_EXPORTED`.
- Commit without successful deterministic quality report and preview candidate is invalid and must not call the journal substrate.

## Out Of Scope

- MCP schemas and registry belong to spec 08.
- Agent flow belongs to spec 09.
- Server/Web routes belong to spec 10.
- UI canvas belongs to spec 11.

## Acceptance Criteria

- P-907011 / R-c9b123bf style main canvas can index matched pages and unmanaged component candidates deterministically.
- Only pages passing hard quality checks become `design_status: done`.
- Runtime never creates page-level `D-*` directories.
- Every generated page frame uses Forma metadata with `page_id`.
- Component usages are indexed only from valid ref instances to requirement snapshots.
- Component refresh plans fail atomically on blocked usage or contract problems.
- Design Quality Pipeline writes complete quality reports and blocks hard failures.
- AI screenshot review only changes warning status.
- Rollback uses requirement-level history fragments and creates new versions.

## Verification

- Core tests cover frame mapping, ambiguous frames, metadata/name mismatch, unmanaged component candidates, and skipped nodes.
- Index tests cover successful pages, blocked pages, unmatched pages, stale hash, journal recovery, and preview candidate promotion.
- Quality tests cover color repair, invalid color, invalid property type, layout overlap, clipping, unsupported geometry, truncation expansion, limits, and preview export failure.
- Semantic tests cover allowed copy, action, field, navigation, component, decorative nodes, missing metadata, and changed source contract.
- Component tests cover usage index, unlinked usage, refresh plan success, each refresh stable error, and no partial success payload.
- History tests cover rollback plan, diff, export source selection, and preview integrity failure.
