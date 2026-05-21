# Forma v6 06: Pencil Session Orchestration Spec

## Source Design Scope

- DESIGN v6 sections: `Pencil App 可视化工作流`, `组件库版本策略`, `Pencil App 强制要求`, `受控 Pencil 写操作边界`, `锁与失败恢复`, `当前代码冲突清单`, `实施顺序` step 6.
- DESIGN v6 acceptance IDs: 4, 5, 6, 8, 10, 11, 17, 20, 31, 49, 50, 52, 55, 61, 63.
- Depends on: `2026-05-21-forma-v6-05-strict-schema-read-model-design.md`.

## Goal

Implement the app-bound Pencil session substrate used by all later v6 `.pen` writes: adapters, capability probes, short locks, active leases, staging files, operation logs, controlled saves, manual edit detection, commit journal recovery, and removal of headless write paths.

## Non-Goals

- Do not implement full Design Quality Pipeline.
- Do not implement component refresh planning.
- Do not register public MCP tools beyond private/internal service contracts needed for later specs.
- Do not build Web UI canvas.
- Do not allow background drawing as fallback.

## Adapters

Add `packages/core/src/pencil-adapter.ts`.

`PencilAppSessionAdapter`:

- owns app-bound interactive processes,
- starts `pencil interactive --app desktop --in <staging.pen>`,
- supports requirement canvas and product component library sessions,
- executes controlled `save()`,
- executes Pencil write operations only through apply gateways,
- tracks `pencil_binding_id`, child process pid, command, capabilities, version, and staging realpath.

`PencilReadExportAdapter`:

- performs read-only validation, scene parsing support, layout checks, screenshots, and export candidates,
- opens committed `.pen` or staging `.pen` for read/export,
- must not call `batch_design`, `set_variables`, `save()` on committed design sources, or any mutation tool.

Existing `PencilService` must no longer expose runtime design generation through `generatePageDesign()` or `generateComponents()` write paths. It remains only as low-level availability, validation, and read/export helper code behind the adapters.

## Capability Probes

Preflight probe runs before creating any product lease, local active file, session directory, or staging file:

- `pencil version`, timeout 10 seconds,
- `pencil status`, timeout 10 seconds,
- `pencil interactive --help`, timeout 10 seconds,
- desktop adapter probe using `$FORMA_HOME/.pencil-preflight/{probe_id}/probe.pen`, timeout 45 seconds,
- probe calls `get_editor_state({ include_schema: true })` and shell `save()`,
- successful probe deletes probe directory or records `preflight_cleanup_warning` if cleanup fails.

Open probe runs after session-owned staging file exists:

- starts `pencil interactive --app desktop --in <staging.pen>`,
- timeout 60 seconds,
- confirms process alive, editor state with schema available, controlled save succeeds, staging file remains valid.

Preflight failures return `PENCIL_CLI_NOT_FOUND`, `PENCIL_NOT_AUTHENTICATED`, `PENCIL_CAPABILITY_UNAVAILABLE`, or `PENCIL_APP_REQUIRED` without creating leases.
Open probe failures execute begin rollback and return `PENCIL_APP_REQUIRED`.

## Timeout Constants

All timeout values must live in `pencil-adapter.ts` and be testable:

- version/status/help: 10 seconds each,
- desktop preflight probe: 45 seconds,
- open probe: 60 seconds,
- process liveness check: 5 seconds,
- controlled save: 30 seconds,
- session export: 60 seconds,
- editor state: 15 seconds,
- variables: 15 seconds,
- guidelines: 20 seconds,
- batch get: 15 seconds,
- snapshot layout subcall: 15 seconds,
- screenshot: 60 seconds.

## Locks

Implement cross-process locks:

- product mutation lock: `$FORMA_HOME/data/{product_id}/locks/product-mutation.lock`,
- Pencil lock: `$FORMA_HOME/locks/pencil.lock`.

Lock acquire uses atomic create-directory or exclusive file create.
Lock content includes `lock_id`, `owner_pid`, `owner_process_start_time`, `hostname`, `command`, `scope`, optional `product_id`, optional `session_id`, `acquired_at`, `expires_at`, and `heartbeat_at`.

Transaction lock TTL is 120 seconds, heartbeat interval is 15 seconds.
Lock release only deletes a lock whose `lock_id` matches the current transaction.

Lock errors:

- live product lock returns `PRODUCT_MUTATION_LOCKED`,
- live Pencil lock returns `PENCIL_LOCK_HELD`,
- corrupt lock returns `LOCK_CORRUPT`,
- release mismatch records `LOCK_RELEASE_MISMATCH` warning.

## Lease Files

Product-level lease:

```text
$FORMA_HOME/data/{product_id}/sessions/active-design-session.yaml
```

Requirement local lease:

```text
$FORMA_HOME/data/{product_id}/{requirement_id}/sessions/active.yaml
```

Product component local lease:

```text
$FORMA_HOME/library/{product_id}.sessions/active.yaml
```

Leases store `session_id`, `scope`, `owner_path`, `local_active_path`, `canvas_path`, `staging_path`, `status`, and `updated_at`. Product-level leases also store `owner_path` and `local_active_path`; local leases omit only fields that have no local equivalent.

Begin, apply, commit, and discard each acquire short transaction locks, validate leases, perform their transaction, and release locks. Locks are not held across MCP/API calls.

## Session Files

Requirement session directory:

```text
$FORMA_HOME/data/{product_id}/{requirement_id}/sessions/{session_id}/
```

Includes:

- `design_session.yaml`,
- `operations.jsonl`,
- `staging.design.pen`,
- `semantic_scope.yaml`,
- `commit-journal.yaml`,
- `backup/`.

Product component session directory:

```text
$FORMA_HOME/library/{product_id}.sessions/{session_id}/
```

Includes:

- `design_session.yaml`,
- `operations.jsonl`,
- `staging.lib.pen`,
- `commit-journal.yaml`,
- `backup/`.

Session YAML stores both relative and absolute paths. Relative paths are authoritative for recovery and hashes.

## Begin Requirement Session

`begin_requirement_design_session` internal service behavior:

- runs Pencil preflight before any lease/session write,
- verifies product component library initialized before creating leases,
- acquires product mutation and Pencil locks for the begin transaction,
- creates product lease and local active file,
- creates session directory,
- copies existing formal `design.pen` to `staging.design.pen`, or writes minimal legal empty staging if no formal canvas exists,
- opens Pencil App with staging file,
- controlled-save staging,
- computes `started_revision`, `last_saved_revision`, and `last_controlled_revision`,
- records `base_canvas_revision` when formal canvas exists,
- writes `design_session.yaml` with status `running`,
- releases locks,
- returns `session_id`, `pencil_binding_id`, formal `canvas_path`, session `staging_path`, `canvas_state`, and mode `app`.

Begin must not create page frames, embed component snapshots, write node metadata, set variables, or mutate business design content.

## Begin Product Component Session

`begin_product_component_session` follows the same transaction model using `staging.lib.pen`.

For `operation: "generate"`, seed components are required and written into `design_session.yaml.seed_components`.
For `operation: "refine"` or `"change_style"`, seed components are optional but any newly required component key must still come from an explicit seed.

## Apply Operations

`apply_requirement_design_operations`:

- accepts only `tool: "batch_design"`,
- rejects path-like fields in operation args,
- performs controlled save before mutation,
- compares current staging hash to `last_controlled_revision`,
- returns `MANUAL_EDIT_DETECTED` on mismatch,
- writes pending operation log entry,
- calls Pencil write tool through the app session adapter,
- controlled-saves after mutation,
- writes `after_revision`,
- updates `last_controlled_revision`.

`apply_product_component_operations`:

- accepts `tool: "batch_design"` and `tool: "set_variables"`,
- follows the same revision and operation log rules.

Failed apply writes session status `failed_operation`. Only another apply retry or discard may recover that state.

## Commit Sessions

This stage implements commit journal mechanics and recovery substrate. It must not expose a public successful `commit_requirement_design_session` path for page, rollback, or component-refresh commits until spec 07 provides the required quality gate, preview candidate, history, `design.yaml`, and `requirement.yaml` candidate builders.

Internal requirement commit substrate:

- validates session `running`,
- controlled-saves staging,
- verifies staging hash equals `last_controlled_revision`,
- verifies formal `design.pen` hash equals `base_canvas_revision` when base exists,
- accepts an explicit already-built candidate set from spec 07 only,
- writes commit journal,
- promotes candidates in DESIGN-defined order,
- verifies formal files after replacement,
- writes session status `committed`,
- clears product and local leases.

Before spec 07 is implemented, attempts to commit a requirement page, rollback, or component refresh through public MCP/Web/agent paths must remain unavailable because spec 08/10/09 have not registered those public paths yet. Internal tests for this stage use a synthetic candidate set only to verify journal replacement and recovery mechanics.

The candidate set interface used by internal tests must include:

- formal target path relative to `$FORMA_HOME`,
- old hash or explicit old-file-missing marker,
- candidate path under the same session directory,
- candidate hash,
- replacement kind,
- restore order.

The internal substrate must not invent or skip page quality checks. If called without a complete candidate set, it returns `INVALID_INPUT`.

Commit product component session:

- validates component metadata, unique component keys, and semantic contract hashes,
- writes version snapshot, latest library, and `components.yaml` through product component commit journal,
- restores old files on failure,
- marks `failed_commit` or `commit_recovery_required` as appropriate.

## Discard Sessions

Discard:

- validates product and local leases,
- closes associated app session if still alive,
- deletes staging file,
- keeps `design_session.yaml`, `operations.jsonl`, failed summaries, and commit journals,
- clears leases only when the session id matches,
- never deletes formal `design.pen` or formal component library files.

## Manual Edit Detection

Revision hash input includes document root, node tree, metadata, variables, themes, components/ref relations, styles, assets, image fills, and Forma metadata.

Revision hash ignores only fixed volatile app metadata:

- save timestamp,
- recent file/window state,
- current selection/cursor,
- view zoom/pan,
- other explicitly documented Pencil UI-only fields.

Any non-controlled semantic staging change returns `MANUAL_EDIT_DETECTED`, writes status `blocked_manual_edit`, and blocks commit. v6 does not provide an "accept current manual edit" path.

## Commit Journal Recovery

Add `recover_design_commit_journal` core service for both requirement canvas and product component library sessions.

It:

- accepts sessions in `commit_recovery_required` or orphan commit journals found by startup recovery,
- reads journal and backups,
- restores replaced formal files in reverse journal order,
- records `restored` or `already_restored`,
- writes session status `failed_commit` after successful restore when session file is readable,
- keeps leases for retry or discard unless orphan cleanup rules allow lease cleanup.

## Startup Recovery

Startup recovery must not block Fastify listening.
It scans only DESIGN v6 listed paths:

- product active design leases,
- requirement index journals,
- requirement active sessions,
- requirement commit journals,
- requirement session files,
- product component active sessions,
- product component commit journals,
- product component session files.

Commit journal scan has priority over session status scan.
No recovery scan reads page-level `D-*`.

## Style Preview Headless Removal

`SyncService` must stop generating Pencil-backed style preview files through headless prompt paths.

Style sync only imports:

- style metadata,
- variables,
- `DESIGN.md`.

Web token preview is rendered deterministically from structured variables.
`scripts/live-style-sync.ts` must stop requiring `$FORMA_HOME/styles/{style}/preview@2x.png`.

## Failure Handling

- Pencil unavailable returns `PENCIL_APP_REQUIRED`; no headless drawing starts.
- Session process exit during later calls moves session to `recoverable` and returns `PENCIL_APP_REQUIRED`.
- Manual edit blocks apply or commit.
- Formal canvas changed since begin returns `DESIGN_CANVAS_CHANGED`.
- Commit restore failure returns `DESIGN_COMMIT_RECOVERY_REQUIRED` and keeps leases.
- Agent-supplied path-like parameters return `FORBIDDEN_PATH_PARAMETER`.

## Out Of Scope

- Quality gate internals belong to spec 07.
- MCP tool schemas belong to spec 08.
- Agent workflows belong to spec 09.
- Web session status UI belongs to specs 10 and 11.

## Acceptance Criteria

- All `.pen` write sessions open visible Pencil App staging files.
- Preflight probe failures leave no active leases or session directories.
- Open probe failures execute begin rollback and record failed-begin summaries.
- Begin returns formal `canvas_path` and session `staging_path`.
- Apply operations are logged and revision-checked.
- Manual staging edits are detected and cannot commit.
- Requirement and product component commit journals can restore failed replacements.
- Requirement commit substrate is not publicly reachable before spec 07 supplies complete quality and state candidates.
- Existing headless design generation and style preview write paths are no longer reachable from runtime design workflows.
- Locks are short transaction locks and are not held across calls.

## Verification

- Unit tests cover preflight success/failure, open probe rollback, timeout constants, and path parameter rejection.
- Unit tests cover lock acquire, heartbeat, stale reclaim, corrupt lock, live lock errors, and release mismatch.
- Session tests cover begin, apply success, apply failure, retry after failed operation, discard, manual edit detection, and app process loss.
- Commit journal tests cover synthetic candidate success, restore success, restore failure, orphan journal recovery, formal canvas changed, and `INVALID_INPUT` when no complete candidate set is supplied.
- Sync tests assert `SyncService` and `scripts/live-style-sync.ts` do not call headless prompt preview generation.
