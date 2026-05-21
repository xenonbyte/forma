# Forma v6 03: Cutover Normalization Spec

## Source Design Scope

- DESIGN v6 sections: `新数据模型` schema normalization, `锁与失败恢复`, `回滚策略`, `实施顺序` step 3.
- DESIGN v6 acceptance IDs: 53, 57, 59, 60.
- Depends on: `2026-05-21-forma-v6-02-async-startup-design.md`.

## Goal

Implement explicit v6 schema cutover with dry-run gating, backups, journals, markers, recovery APIs, recovery CLIs, and rollback. Cutover is destructive to selected YAML fields but must be recoverable from its own manifest and journal.

## Non-Goals

- Do not automatically run cutover from `forma serve`.
- Do not use product, requirement, design, or sync services inside cutover.
- Do not migrate page-level `D-*` design directories into v6 runtime state.
- Do not delete old page-level `D-*` directories.
- Do not register v6 design write tools in this stage.

## CLI Entrypoints

Add these commands:

| Command | Required behavior |
| --- | --- |
| `forma schema-normalization-dry-run` | Writes only preflight report and candidate diagnostics under `$FORMA_HOME/normalization-preflight/v6-{timestamp}/`. |
| `forma v6-schema-cutover` | Validates latest preflight report, creates backup, writes journal, creates active marker, rewrites runtime YAML, validates strict schemas, writes committed marker and report. |
| `forma recover-v6-normalization-journal` | Explicitly recovers a normalization journal under `$FORMA_HOME/normalization-backups/`. |
| `forma restore-v6-normalization-backup` | Explicitly restores backed-up YAML and requires `--confirm restore_v6_backup`. |

All commands accept optional `--home <path>`. Recovery commands require `--backup-dir <path>` under the current `$FORMA_HOME/normalization-backups/`.

## Web Recovery Entrypoints

Add routes:

- `GET /api/recovery/schema-normalization`,
- `POST /api/recovery/schema-normalization/recover-journal`,
- `POST /api/recovery/schema-normalization/restore-backup`.

The two write routes only operate in recovery-only mode. They validate `backup_dir` realpath under the current `$FORMA_HOME/normalization-backups/`.

## Cutover Preconditions

Real cutover must validate the selected preflight report before any backup or runtime YAML rewrite:

- report is the deterministic latest report unless an explicit report path is passed,
- explicit report path is still under `$FORMA_HOME/normalization-preflight/`,
- report `status === "passed"`,
- report `strict_schema_status === "passed"`,
- report `normalizer_version` equals the current normalizer version,
- report `home_hash` equals the current `$FORMA_HOME` manifest hash,
- report `candidate_manifest_hash` equals the candidate manifest hash recomputed during cutover.

Failure returns `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED` with the matching `preflight_status` and `preflight_reason`.

## Runtime YAML Rewrite

Cutover must raw-read legacy YAML and write only the documented v6 changes:

- remove `product.yaml.components_initialized`,
- remove `requirement.yaml.pages[].design_id`,
- remove old page-level design metadata and page-level preview/pen path derived fields,
- add requirement page `semantic_contract` when missing,
- add baseline page `semantic_contract` when missing,
- add `semantic_contract_coverage: "minimal"` for normalizer-generated minimal contracts,
- keep old page-level `D-*` directories untouched as human recovery material.

Generated contracts must use the semantic contract builder from spec 01.

## Backup Contract

Before the first runtime YAML write:

- create `$FORMA_HOME/normalization-backups/v6-{timestamp}/`,
- copy every runtime YAML file that will be rewritten,
- write `manifest.yaml`,
- verify backup file hashes,
- create `normalization-journal.yaml` only after manifest exists and manifest hash is known.

`manifest.yaml` records:

- runtime relative path,
- backup relative path,
- sha256,
- file size,
- backup time,
- normalizer version,
- deleted field counts.

Backup failure aborts before any runtime YAML write.

## Journal Contract

`normalization-journal.yaml` state machine:

```text
created -> backed_up -> writing -> validating -> committed
created/backed_up/writing/validating -> recovery_required
recovery_required -> restored
```

Each `rewritten_files[]` entry must include:

- `runtime_path`,
- `backup_path`,
- `old_hash`,
- `candidate_hash`,
- `write_status`,
- `validation_status`,
- `restore_status`,
- last error.

`candidate_hash` is `null` while `write_status: not_started`; after writing a candidate it must be `sha256:<hash>`.

Any write or strict validation failure must update the journal to `recovery_required` before returning the error.

## Marker Contract

- Cutover creates `$FORMA_HOME/.v6-schema-cutover-active` before runtime writes.
- Successful cutover replaces active marker with `$FORMA_HOME/.v6-schema-cutover-committed`.
- Startup that sees active marker enters recovery-only mode.
- Successful rollback deletes committed marker.

## Recovery Behavior

`recoverV6NormalizationJournal(home, backupDir)`:

- handles `created`, `backed_up`, `writing`, `validating`, and `recovery_required` journals,
- can mark no-runtime-writes journals as `restored`,
- restores modified YAML from manifest when writes happened,
- never runs automatically from status reads.

`restoreV6NormalizationBackup(home, backupDir)`:

- requires explicit confirmation from CLI/API entrypoint,
- copies current runtime YAML to `rollback-capture/`,
- restores files according to manifest,
- validates old schema smoke check,
- deletes committed marker only after success,
- writes `normalization_report.yaml.status: restored`.

## Failure Handling

- Backup hash mismatch aborts cutover before writes.
- Manifest hash mismatch blocks recovery and returns `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`.
- Runtime path escape or symlink escape blocks recovery.
- Partial restore failure leaves recovery-only state active.
- Recovery and rollback must never read backup directories outside the current `$FORMA_HOME`.
- Status reads must not recover, restore, or rewrite YAML.

## Out Of Scope

- Strict runtime service usage of v6 schema belongs to spec 05.
- Public legacy surface removal belongs to spec 04.
- Design session and Pencil recovery belong to spec 06.

## Acceptance Criteria

- Dry-run writes a deterministic report and no runtime YAML.
- Cutover refuses to run without a current passing preflight report.
- Cutover creates backup, manifest, journal, active marker, committed marker, and `normalization_report.yaml`.
- Cutover removes old fields and adds required semantic contracts.
- Cutover does not migrate or delete page-level `D-*` directories.
- Failed cutover enters recovery-only state with actionable `SchemaNormalizationRecoveryState`.
- Recovery API/CLI can restore journals explicitly.
- Rollback API/CLI can restore backup explicitly and preserve v6 design assets as human material.

## Verification

- CLI tests cover dry-run success and stale/missing/ambiguous report failures.
- Core tests cover backup manifest creation, journal state transitions, candidate write, validation failure, and recovery failure.
- Recovery API tests cover status, recover journal, restore backup, path escape rejection, and confirm-token enforcement.
- Rollback tests cover success, missing manifest, backup hash mismatch, runtime path escape, partial write failure, and old schema smoke failure.
- Startup tests confirm active marker enters recovery-only mode and missing committed marker enters preflight-only mode.
