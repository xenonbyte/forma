# Forma v6 05: Strict Schema And Read Model Spec

## Source Design Scope

- DESIGN v6 sections: `新数据模型`, `需求级主画布`, `页面状态记录`, `已有主画布识别`, `Web / Server API 调整` baseline preview, `当前代码冲突清单`, `实施顺序` step 5.
- DESIGN v6 acceptance IDs: 7, 12, 13, 15, 38, 53, 54, 57, 61, 62.
- Depends on: `2026-05-21-forma-v6-04-legacy-surface-removal-design.md`.

## Goal

Enable strict v6 runtime schemas and read models after committed cutover, without registering new v6 write tools. Runtime reads must stop depending on `components_initialized`, `design_id`, page-level `D-*` design state, and deterministic old preview fallbacks.

## Non-Goals

- Do not implement app-bound `.pen` write sessions.
- Do not implement Design Quality Pipeline.
- Do not register v6 MCP write tools.
- Do not build `DesignSceneCanvas`.
- Do not scan or migrate old page-level `D-*` directories.

## Strict Runtime Startup

Normal startup requires:

- `$FORMA_HOME/.v6-schema-cutover-committed` exists,
- raw recovery reader reports no recovery-required normalization journal,
- strict schemas accept all product, requirement, baseline, copy translation, and v6 read-model files.

If committed marker is missing, startup enters `preflight_only`.
If recovery state blocks strict store, startup enters `recovery_only`.

## Product Schema Requirements

- `product.yaml.components_initialized` is invalid.
- Product component library initialization is derived from `$FORMA_HOME/library/{product_id}.components.yaml`.
- Product rules accept optional `semantic: ProductRuleSemanticInput`.
- `given`, `when`, and `then` remain human-readable rules and must not enter machine semantic contracts.

## Requirement Page Schema Requirements

`requirement.yaml.pages[]` must keep:

- `page_id`,
- `name`,
- `baseline_page`,
- `design_status`,
- `semantic_contract`,
- `semantic_contract_coverage`,
- `declared_fields`,
- `declared_actions`,
- `declared_component_keys`,
- non-design requirement description fields such as `copy`, `fields`, `features`, `interactions`, `change_type`, and `change_summary`.

It must reject:

- `design_id`,
- page-level design metadata,
- page-level `pen_path`,
- page-level preview path derived from `design_id`,
- missing `semantic_contract`.

`SEMANTIC_CONTRACT_REQUIRED` is not used for missing persisted contract. Missing persisted `semantic_contract` is schema validation failure. `SEMANTIC_CONTRACT_REQUIRED` is reserved for later design sessions when `semantic_contract_coverage: "minimal"` cannot cover a requested semantic change.

## Baseline Schema Requirements

- `baseline.yaml.pages[]` must include `semantic_contract`.
- Baseline `semantic_contract` is a derived aggregate from active source requirement page contracts.
- Baseline free-text `fields` and `interactions` remain human-readable and do not generate machine semantic entries.
- Conflicting field/action labels for the same key across source requirements return `BASELINE_SEMANTIC_CONTRACT_CONFLICT` during requirement save.

## Product Component Library Read Model

Add a read model equivalent to `get_product_component_library`:

- reads `$FORMA_HOME/library/{product_id}.components.yaml`,
- reads current version snapshot under `$FORMA_HOME/library/{product_id}.versions/{version}.lib.pen`,
- reads latest library file under `$FORMA_HOME/library/{product_id}.lib.pen`,
- validates checksums, paths, version numbers, and component metadata,
- returns initialized status without writing files.

Statuses:

- `missing`,
- `complete`,
- `metadata_missing`,
- `version_snapshot_missing`,
- `latest_file_missing`,
- `invalid`.

`components: []` is a valid initialized empty component library version when current version, latest file, and metadata are valid.

## Requirement Design Canvas Read Model

The v6 canonical requirement design paths are:

- `$FORMA_HOME/data/{product_id}/{requirement_id}/design.pen`,
- `$FORMA_HOME/data/{product_id}/{requirement_id}/design.yaml`,
- `$FORMA_HOME/data/{product_id}/{requirement_id}/previews/{page_id}@2x.png`,
- `$FORMA_HOME/data/{product_id}/{requirement_id}/history/...`.

`design.yaml` is the only read source for:

- canvas version,
- canvas revision,
- frame mapping,
- page version,
- preview file,
- history file,
- component library pinned version,
- component usage index,
- quality report.

This stage reads and validates an existing `design.yaml` when it is present; it does not create or rewrite it.

## Path Persistence Requirements

Canonical YAML and journals store `$FORMA_HOME` relative paths:

- `pen_file`,
- `preview_file`,
- `preview_dir`,
- `history_dir`,
- `source_file`,
- `canvas_file`,
- `frame_snapshot_file`,
- `version_path`-like fields.

API responses are allowed to resolve absolute paths for display. Absolute paths must not be included in revision hash or manifest hash inputs.

## Baseline Preview Lookup

Baseline image lookup must stop using `design_id`.

Lookup order:

1. Read baseline page `source_requirements[]`.
2. Load active, non-archived requirements for the product.
3. Keep requirements whose page maps to the requested baseline page and has `design_status === "done"`.
4. Sort candidates by `updated_at desc`, then `id desc`.
5. For each candidate, read requirement-level `design.yaml`.
6. Return the first page record with `status === "done"` and readable `preview_file`.

Response payload includes:

- `product_id`,
- `baseline_page_id`,
- `requirement_id`,
- `requirement_page_id`,
- `preview_url`,
- `preview_path`,
- `canvas_path`,
- `page_version`,
- `canvas_version`.

If no v6 preview is available, return `BASELINE_IMAGE_NOT_FOUND`. Do not scan page-level `D-*`.

## Product Deletion Read And Journal Requirements

Product deletion must cover v6 component library paths in the same deletion journal as product runtime data:

- `library/{product_id}.lib.pen`,
- `library/{product_id}.components.yaml`,
- `library/{product_id}.versions/`,
- `library/{product_id}.sessions/`.

Before deletion journal creation, deletion must:

- acquire product mutation lock,
- read `$FORMA_HOME/data/{product_id}/sessions/active-design-session.yaml`,
- validate any lease paths with realpath under current `$FORMA_HOME`,
- validate product-level lease and local active file consistency when a lease exists.

Non-terminal active design sessions return `DESIGN_SESSION_ACTIVE` and no product data or component library files move.

Non-terminal statuses are:

- `running`,
- `recoverable`,
- `failed_operation`,
- `failed_commit`,
- `blocked_manual_edit`,
- `commit_recovery_required`.

`DESIGN_SESSION_ACTIVE.details` must include:

- `session_id`,
- `scope`,
- `owner_path`,
- `local_active_path`,
- `canvas_path`,
- `staging_path`,
- `status`.

Terminal active lease cleanup is allowed only when:

- corresponding `design_session.yaml.status` is `committed` or `discarded`,
- audit link has been written into formal requirement history or component version record,
- product-level lease `session_id` matches local active file `session_id`,
- all referenced paths remain under current `$FORMA_HOME`.

If terminal audit link is missing, deletion returns `DESIGN_SESSION_AUDIT_LINK_MISSING` and moves no files.

If the active lease is malformed, path-escaped, points to a missing local active file, or has a `session_id` mismatch, deletion returns `LOCK_CORRUPT` or `DESIGN_COMMIT_RECOVERY_REQUIRED` according to the detected state and moves no files.

Deletion state must split moved path kinds:

- `component_library_latest`,
- `component_library_metadata`,
- `component_library_versions`,
- `component_library_sessions`.

Deletion recovery must:

- restore or clean all moved component library candidates together with product data,
- list any residual v6 component library paths in `recovery_warnings[]`,
- avoid deleting active session directories,
- leave product-level `active-design-session.yaml` untouched when recovery cannot prove the session is terminal and audited.

## Failure Handling

- Invalid strict schema returns schema validation error and does not fall back to old schema.
- Reappearance of `design_id` or `components_initialized` after cutover is invalid data.
- Missing current component snapshot returns component library read-model blocker, not product config fallback.
- Missing committed marker enters preflight-only mode.
- Recovery-required normalization state enters recovery-only mode.
- Missing requirement-level preview for baseline image returns `BASELINE_IMAGE_NOT_FOUND`, not old preview fallback.
- Product deletion with active, corrupt, or unaudited v6 design lease must return the stable deletion error before moving product data or component library files.

## Out Of Scope

- Creating `design.yaml` from `design.pen` belongs to spec 07.
- App-bound sessions and commit journals belong to spec 06.
- V6 MCP tool registration belongs to spec 08.
- Web route replacement belongs to spec 10.

## Acceptance Criteria

- Strict schemas reject `components_initialized`, `design_id`, page-level design metadata, and missing `semantic_contract`.
- Product component library read model reports all documented statuses.
- Empty component library versions are treated as initialized when metadata and files are valid.
- Requirement design read model uses only requirement-level `design.yaml` and paths.
- Baseline preview lookup returns requirement-level payloads and never scans `D-*`.
- Product deletion detects active v6 design session before moving product data or library files.
- Product deletion journal can represent all v6 component library path kinds.
- Product deletion rejects terminal sessions whose audit link is missing.
- Product deletion rejects corrupt or inconsistent active leases without guessing cleanup.
- Product deletion recovery reports residual component library paths in `recovery_warnings[]`.

## Verification

- Core schema tests cover invalid old fields and missing semantic contracts.
- Product component library tests cover missing, complete, metadata missing, version snapshot missing, latest missing, invalid, and empty initialized states.
- Baseline preview tests cover candidate sort order, same timestamp id tie-break, archived requirements, pending/expired pages, and no `D-*` fallback.
- Product deletion tests cover v6 library paths and active session blocking.
- Product deletion tests cover terminal audited cleanup, terminal audit missing, lease path escape, local active mismatch, corrupt lease, commit recovery required, recovery warnings for residual component library files, and no file movement before stable errors.
- Startup tests cover committed marker required for normal strict mode.
