# Forma v7: Pencil Foreground Session Convergence Spec

## Source Design Scope

- Source: `design-version/DESIGN-v7.md`.
- User-approved scope on 2026-05-22: full v7 implementation.
- This spec supersedes the partial guard-only spike described in `CONTINUITY.md`; v7 must ship foreground open, active editor convergence, drift detection, sanitized commit candidates, tests, and live smoke together.

## Goal

Ensure every design-editing session uses a session-owned staging `.pen` that is visible in the foreground Pencil App and proven to be the active editor before any write, save, read/export, commit, or normal discard proceeds.

v7 must prevent Forma from writing the user's previously open Pencil document when `pencil interactive --app desktop --in <staging.pen>` does not switch the active desktop editor to the requested staging file.

## Non-Goals

- Do not change the v6 requirement-level `design.pen` data model.
- Do not change the product-level component library model.
- Do not introduce headless drawing fallback.
- Do not use Pencil MCP tools from runtime code.
- Do not close, migrate, or modify the user's unrelated open Pencil document.
- Do not allow callers to override session-owned files through `filePath`, `path`, `staging_path`, or similar parameters.

## Design Summary

Implement v7 through three internal boundaries:

1. `PencilAppSessionAdapter` owns Pencil capabilities, foreground open, app-bound interactive process lifecycle, path/guard convergence checks, and runtime drift assertions.
2. Requirement and component session modules own business state: begin/apply/commit/discard transactions, leases, journals, status transitions, and cleanup records.
3. Structured `.pen` helpers insert transient session binding guards and generate no-guard offline commit candidates so guards never enter formal `design.pen` or `{product_id}.lib.pen`.

## Capability Preflight

`PencilAppSessionAdapter.preflight()` must become capability-only:

- run `pencil version`,
- run `pencil status`,
- run `pencil interactive --help`,
- require `get_editor_state`, `get_guidelines`, `get_variables`, `batch_get`, `batch_design`, `set_variables`, `export_nodes`, `snapshot_layout`, `get_screenshot`, and `save`.

Preflight must not:

- create `.pencil-preflight`,
- create a probe `.pen`,
- start `pencil interactive --app desktop`,
- call `save()`,
- change the active Pencil document.

This keeps front-end UI failures and business precondition failures from disturbing the user's current Pencil canvas.

## Begin Ordering

`beginRequirementDesignSession()` order is fixed:

1. resolve `home`, `product_id`, and `requirement_id`;
2. read product component library metadata;
3. if the component library is not `complete`, throw the existing component-library error with `required_action: generate_components`;
4. only after the component library is complete, run Pencil capability preflight;
5. acquire product and Pencil mutation locks;
6. create leases, session directory, operation log, semantic scope, and `staging.design.pen`;
7. call `openSession()` to foreground-open and verify staging convergence;
8. write the running session record.

`beginProductComponentSession()` keeps component seed validation first, then reads the component version plan, runs capability preflight, creates `staging.lib.pen`, calls `openSession()`, and writes the component session record.

Missing components, invalid seeds, schema errors, active lease conflicts, and semantic scope failures must not foreground-open Pencil.

## Foreground Open

Add an internal helper:

```text
openPencilDocumentInForeground({
  stagingPath,
  expectedSessionDir
})
```

Behavior:

- resolve `stagingPath` with `realpath()`;
- resolve `expectedSessionDir` with `realpath()`;
- require `.pen` extension;
- require the staging realpath to be inside the expected session directory;
- on macOS, run `open -a Pencil <stagingPath>` with a 10 second timeout;
- on non-macOS, fail with `PENCIL_APP_REQUIRED` / `failed_phase: foreground_open`;
- treat `open -a Pencil` success only as a request to the desktop app, not proof of active editor convergence.

The trusted proof is the subsequent path/guard convergence check.

## Session Binding Guard

Before foreground open, `openSession()` inserts one top-level binding guard into the session staging file:

```json
{
  "id": "formaSessionBindingGuard<session_id>_<random>",
  "type": "frame",
  "name": "__forma_session_binding_guard__",
  "x": -100000,
  "y": -100000,
  "width": 1,
  "height": 1,
  "visible": false,
  "metadata": {
    "type": "forma",
    "kind": "session_binding_guard",
    "session_id": "<session_id>"
  },
  "children": []
}
```

Rules:

- `id` only uses `[A-Za-z0-9_-]`;
- random suffix has at least 96 bits of entropy;
- insert through structured JSON parsing, not string concatenation;
- require top-level `children[]`;
- reject duplicate guard id;
- reject an existing guard for the same session;
- append only as a top-level child;
- keep the guard in staging until terminal session cleanup.

The guard is transient runtime evidence, not user design content.

## Open Session Verification

`PencilAppSessionAdapter.openSession()` must:

1. resolve and validate staging realpath against the session module's `expected_session_dir`;
2. insert the session binding guard;
3. run foreground open;
4. start `pencil interactive --app desktop --in <stagingPath>`;
5. confirm process liveness;
6. call `get_editor_state({"include_schema":true})`;
7. extract active editor path by priority: `activeEditorPath`, `activeEditor`, `filePath`, `editor.filePath`;
8. if a readable active path exists, require its realpath to equal staging realpath;
9. call `batch_get({"nodeIds":["<binding_guard_id>"],"readDepth":0})`;
10. require the guard to be returned.

If the guard is missing, close the process, wait 750 ms, then retry foreground open and interactive start. Use exactly 8 attempts.

If the path channel clearly mismatches, fail closed with `PENCIL_APP_REQUIRED` / `failed_phase: staging_document_check`.

If all attempts fail to read the guard, fail closed with `PENCIL_APP_REQUIRED` / `failed_phase: staging_document_check`.

On success, register the binding with:

- `pencil_binding_id`,
- `session_id`,
- `pid`,
- `command`,
- `version`,
- `capabilities`,
- `staging_path`,
- `binding_guard_id`.

## Runtime Drift Detection

Add:

```text
assertActiveStagingBinding({
  bindingId,
  expectedStagingPath
})
```

It must:

- require a live binding and live process;
- resolve `expectedStagingPath` from the session record;
- require the binding staging realpath to match the expected staging realpath;
- call `get_editor_state({"include_schema":false})`;
- if path channel is present, require it to resolve to the binding staging path;
- call `batch_get({"nodeIds":["<binding_guard_id>"],"readDepth":0})`;
- require the guard to be present in the active editor.

Use `PENCIL_APP_REQUIRED` / `failed_phase: active_editor_drift` when an already-open session no longer points at the staging document.

The adapter must call the drift assertion:

- before and after `controlledSave()`;
- before and after `executeWriteTool()`;
- before all session read/export tools: `sessionGetEditorState`, `sessionGetGuidelines`, `sessionGetVariables`, `sessionBatchGet`, `sessionSnapshotLayout`, `sessionGetScreenshot`, `sessionExportNodes`;
- before requirement/component commit;
- before normal requirement/component discard.

Disconnected discard remains allowed only for sessions already marked `failed_commit` or `recoverable`, matching v6 recovery behavior.

## Apply Operations

Requirement and component apply flows must keep existing path-like-argument rejection.

Before checking manual edit hashes, they must assert active staging binding and perform controlled save. If assertion or save fails with `PENCIL_APP_REQUIRED`, mark the session `recoverable`.

During each write operation:

- append pending operation log entry;
- execute the Pencil write through the binding;
- controlled-save through the binding;
- compute new staging hash;
- write applied operation log entry;
- update `last_saved_revision` and `last_controlled_revision`.

If a write or post-write drift assertion fails, record the operation as failed, mark the session `failed_operation`, and do not continue to later operations.

## Sanitized Commit Candidate

Commit must not delete the guard from active staging. Instead add:

```text
createSanitizedCommitCandidate({
  source_staging_path,
  candidate_path,
  binding_guard_id,
  expected_source_hash
})
```

Behavior:

- require source staging and candidate path to stay inside the session directory;
- compute source hash and require it to equal `expected_source_hash`;
- parse the `.pen` structurally;
- remove exactly one top-level node whose id equals `binding_guard_id`;
- reject if the target guard is missing;
- reject if any remaining node id starts with `formaSessionBindingGuard`;
- reject if any remaining node has `metadata.kind === "session_binding_guard"`;
- write `commit-candidates/staging.no-guard.pen`;
- return the candidate hash.

The active staging file remains unchanged and continues to contain the guard until terminal cleanup.

## Commit Flow

Requirement commit:

1. reload the session record under product and Pencil locks;
2. require status `running`;
3. assert active staging binding;
4. controlled-save, which asserts before and after save;
5. compute staging hash and require it to match `last_controlled_revision`;
6. build sanitized no-guard staging candidate;
7. validate user-provided commit candidates as before, but require the formal design canvas candidate to be the sanitized no-guard candidate;
8. promote validated candidates through the existing commit journal;
9. close the binding and clear leases after journal success.

Component commit:

1. reload the session record under product and Pencil locks;
2. require status `running`;
3. assert active staging binding;
4. controlled-save;
5. compute staging hash and require it to match `last_controlled_revision`;
6. build sanitized no-guard component library candidate;
7. use the sanitized candidate hash for component metadata checksum;
8. promote version, latest library, and metadata through the existing component commit journal;
9. close the binding and clear leases after journal success.

Formal `design.pen`, `{product_id}.lib.pen`, versioned component `.pen`, and component metadata checksums must never include the transient guard.

## Discard and Cleanup

Normal discard must assert active staging binding before deleting staging.

Failed begin rollback should delete leases, staging, and session directory. If cleanup cannot remove a staging file that contains a transient guard, write a cleanup warning that marks the retained staging as non-promotable diagnostic state.

Recovered discard for `failed_commit` and `recoverable` may clear leases without a live binding, preserving existing recovery behavior.

## Error Contract

Keep outer code `PENCIL_APP_REQUIRED` for Pencil App runtime failures.

Stable `failed_phase` values:

- `foreground_open`: OS could not foreground-open the target staging file.
- `open_app`: app-bound interactive process could not start or was not alive.
- `editor_state_schema`: editor state/schema was unavailable.
- `staging_document_check`: open-stage path or guard convergence failed.
- `active_editor_drift`: a running session later drifted away from its staging file.
- `session_check`: binding is missing, dead, or not the requested staging path.

Begin failure records must include:

- `session_id`,
- `status: failed_begin`,
- `error_code`,
- `failed_phase`,
- `staging_path`,
- `command`,
- `reason`,
- `cleanup_status`.

## Tests

Add or update unit coverage for:

- requirement begin with missing component library does not call preflight, process factory, or foreground open;
- capability preflight calls only `version`, `status`, and `interactive --help`;
- `openSession()` calls foreground open before app-bound process startup;
- foreground open failure maps to `failed_phase: foreground_open`;
- active editor path mismatch maps to `failed_phase: staging_document_check`;
- missing guard retries and eventually succeeds when the active editor converges;
- retry exhaustion fails closed with `failed_phase: staging_document_check`;
- `assertActiveStagingBinding()` catches path mismatch and guard missing as `active_editor_drift`;
- `controlledSave()` and `executeWriteTool()` assert before and after;
- session read/export tools assert before execution;
- component and requirement apply mark sessions correctly on drift;
- component and requirement commit use no-guard candidates;
- formal `.pen` files and component metadata do not contain `formaSessionBindingGuard` or `metadata.kind=session_binding_guard`;
- discard asserts live binding unless the session is `failed_commit` or `recoverable`;
- component generation followed by requirement design opens `staging.lib.pen` and then `staging.design.pen`, while the previously open user `.pen` is not written.

Keep the focused check:

```text
pnpm test packages/core/tests/pencil.test.ts packages/core/tests/design-session.test.ts
```

The broader completion check remains:

```text
pnpm typecheck
```

## Live Smoke

Add:

```text
pnpm smoke:pencil:foreground
```

The smoke should:

1. require local Pencil App and authenticated Pencil CLI;
2. instruct the operator to open a non-Forma `.pen` before running;
3. create a temporary `FORMA_HOME`;
4. call requirement begin before components exist and verify Pencil is not opened by Forma;
5. call component begin and verify active editor convergence to `staging.lib.pen`;
6. commit the component session so the product component library becomes `complete`;
7. call requirement begin and verify active editor convergence to `staging.design.pen`;
8. clean up temporary session state.

If OS-level foreground-window assertion is unavailable, the script must print an explicit manual confirmation step for the operator while still automatically verifying active editor path/guard convergence.

## Acceptance Criteria

- With an unrelated `.pen` already open, requirement begin without components returns `required_action: generate_components` and does not change Pencil UI.
- Component begin foreground-opens `staging.lib.pen` and proves active editor convergence.
- Requirement begin after components foreground-opens `staging.design.pen` and proves active editor convergence.
- If the user switches Pencil to another `.pen`, the next read, write, save, export, commit, or normal discard fails with `active_editor_drift`.
- Formal component and requirement files never contain session binding guards.
- If Pencil cannot open or converge to staging, the flow fails closed and does not write the user's previously open canvas.
- Targeted unit tests pass.
- `pnpm typecheck` passes.
- `pnpm smoke:pencil:foreground` passes in a local live Pencil environment, with manual foreground visibility confirmation when automation cannot inspect the OS window.
