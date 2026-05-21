# Forma v6 01: Preflight Normalization Spec

## Source Design Scope

- DESIGN v6 sections: `新数据模型`, `页面状态记录`, `Semantic Scope Guard`, `锁与失败恢复`, `实施顺序` step 1.
- DESIGN v6 acceptance IDs: 53, 57, 59.
- Depends on: `2026-05-21-forma-v6-index-design.md`.

## Goal

Add read-only v6 normalization infrastructure and deterministic semantic contract building without changing runtime YAML, runtime schemas, store startup shape, or public v6 write tools.

## Non-Goals

- Do not rewrite `$FORMA_HOME` runtime YAML.
- Do not create cutover markers.
- Do not make `createFormaStore` async in this stage.
- Do not enable v6 strict schemas for normal runtime reads.
- Do not remove public legacy tools or routes in this stage.

## Requirements

- Add `packages/core/src/semantic-contract.ts`.
- Add `packages/core/src/schema-normalization.ts`.
- Implement a side-effect-free raw YAML reader for normalization state.
- Implement a dry-run candidate builder that can enumerate old fields and candidate v6 YAML without writing candidate YAML into runtime locations.
- Implement deterministic latest preflight report and latest journal selection helpers using fields from YAML content, not filesystem mtime.
- Implement minimal semantic contract builder mode for legacy pages and baseline pages.
- Keep normal application runtime behavior unchanged except for new private exports and tests.

## Semantic Contract Builder

`semantic-contract.ts` must export `buildSemanticContractForPage(input)` and minimal-mode helpers used by normalization.

Allowed sources for generated requirement page contracts:

- page `copy[].text`,
- page `name`,
- requirement `navigation[]` edges from the same `page_id`,
- explicit `declared_fields[]`,
- explicit `declared_actions[]`,
- explicit `declared_component_keys[]`,
- product rules `semantic`,
- current page baseline equivalent label.

Forbidden sources:

- `copy-translations.yaml`,
- baseline aggregate `semantic_contract`,
- free-text `features`,
- free-text `fields`,
- free-text `interactions`,
- product rule `given`, `when`, or `then`.

When minimal mode cannot prove full semantic coverage, it still emits a valid minimal `semantic_contract` and records coverage as `minimal`.

## Schema Normalization Preflight

`schema-normalization.ts` must export:

```typescript
normalizeFormaHomeForV6(home, { mode: "preflight" })
readSchemaNormalizationRecoveryState(home)
```

In this stage, `normalizeFormaHomeForV6` accepts only `mode: "preflight"`. Calling it with `mode: "cutover"` must return a stable unsupported-mode error until spec 03 implements cutover.

Preflight mode must:

- raw-read legacy YAML as plain objects,
- detect `product.yaml.components_initialized`,
- detect `requirement.yaml.pages[].design_id`,
- detect old page-level design metadata and page-level preview/pen fields,
- detect missing requirement page `semantic_contract`,
- detect missing baseline page `semantic_contract`,
- build in-memory candidate objects,
- validate every candidate object listed below with the same field rules planned for v6 strict runtime schemas,
- write only preflight report output under `$FORMA_HOME/normalization-preflight/v6-{timestamp}/`.

Candidate validation coverage is fixed in this stage:

- every rewritten `product.yaml` candidate rejects `components_initialized` and validates product rule `semantic` shape when present,
- every rewritten `requirement.yaml` candidate rejects `pages[].design_id`, rejects page-level design metadata, requires `pages[].semantic_contract`, validates `semantic_contract_coverage`, `declared_fields`, `declared_actions`, and `declared_component_keys`,
- every rewritten `baseline/baseline.yaml` candidate requires `pages[].semantic_contract` and validates aggregate field/action conflict shape,
- every copied or inspected `copy-translations.yaml` candidate validates enough structure to compute translation entry hashes later, but preflight does not require complete non-default language translations,
- candidate manifest records each candidate relative path, candidate hash, old hash, old field removal counts, generated contract coverage, and validation status.

If a full runtime Zod schema for one of these files already exists in code, the preflight validator must call it. If the final strict schema will only be introduced in spec 05, this stage must provide a local candidate validator with the same fields above and tests that lock its behavior. The report must identify which validator type was used per file as `validator_source: "runtime_schema" | "preflight_candidate_validator"`.

Preflight mode must not:

- write `product.yaml`, `requirement.yaml`, `baseline.yaml`, or `copy-translations.yaml`,
- create normalization backup directories,
- write active or committed cutover markers,
- delete page-level `D-*` directories,
- instantiate `ProductService`, `RequirementService`, `DesignService`, or `SyncService`.

## Report Contract

`report.yaml` must include:

- `created_at`,
- `report_dir`,
- `report_file`,
- `normalizer_version`,
- `home_hash`,
- `status`,
- `strict_schema_status`,
- `candidate_manifest_hash`,
- `candidates[]` with relative path, old hash, candidate hash, validator source, validation status, deleted field counts, generated contract coverage,
- field removal counts,
- generated requirement contract count,
- generated baseline contract count,
- coverage summaries,
- schema validation diagnostics.

`created_at` must equal the timestamp encoded in `v6-{timestamp}`.
`report_dir` and `report_file` must be `$FORMA_HOME` relative paths and must realpath under `$FORMA_HOME/normalization-preflight/`.

## Recovery State Reader

`readSchemaNormalizationRecoveryState(home)` must:

- raw-read cutover markers,
- raw-read `normalization_report.yaml`,
- scan candidate preflight reports,
- scan normalization journals,
- return a `SchemaNormalizationRecoveryState`,
- never write files,
- never repair journals,
- never call `normalizeFormaHomeForV6`,
- never instantiate strict runtime services.

The returned state must use the shared fields from DESIGN v6, including `mode`, `status`, `code`, `home`, `restore_status`, `failed_files`, `recovery_actions`, and optional `report`.

## Failure Handling

- Missing committed marker with no valid preflight report returns `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED` with `preflight_status: "missing"` and `preflight_reason: "report_missing"`.
- Ambiguous preflight report selection returns `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED` with `preflight_status: "stale"` and `preflight_reason: "report_selection_ambiguous"`.
- Ambiguous journal selection returns `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED` with `restore_status: "journal_selection_ambiguous"`.
- A journal in `created` or `backed_up` with no runtime writes returns `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED` with `restore_status: "no_runtime_writes"`.
- Missing manifest or manifest hash mismatch returns `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED` with `restore_status: "manifest_unavailable"`.
- Backup hash mismatch returns `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED` with `restore_status: "backup_hash_mismatch"`.

## Out Of Scope

- Real backup creation and runtime YAML rewrite belong to spec 03.
- Preflight-only server and MCP limited mode belong to spec 02.
- Strict runtime schema enforcement belongs to spec 05.
- Requirement design sessions and Pencil behavior belong to spec 06 and later.

## Acceptance Criteria

- `semantic-contract.ts` exists and exports deterministic contract builders.
- `schema-normalization.ts` exists and exports preflight normalization plus side-effect-free recovery state reading.
- Preflight report selection is deterministic and does not use mtime.
- Minimal semantic contracts are generated only from allowed structured sources.
- Every candidate file type has fixed validation coverage and records validator source in report output.
- Preflight mode writes only under `$FORMA_HOME/normalization-preflight/`.
- `readSchemaNormalizationRecoveryState(home)` produces the shared recovery state without writing files.
- No runtime YAML changes occur during this stage.

## Verification

- Unit tests cover minimal semantic contract generation for requirement pages and baseline pages.
- Unit tests cover forbidden free-text sources not entering machine semantic fields.
- Unit tests cover preflight report selection, missing report, stale report, failed report, and ambiguous report.
- Unit tests cover journal selection ambiguity and no-runtime-writes recovery state.
- A filesystem side-effect test asserts `readSchemaNormalizationRecoveryState(home)` does not create, modify, or delete files.
- Existing tests continue to pass under the old runtime model.
