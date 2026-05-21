# Forma v6 12: Verification Spec

## Source Design Scope

- DESIGN v6 sections: `验收标准`, `当前代码冲突清单`, `实施顺序` step 12, all prior implementation sections.
- DESIGN v6 acceptance IDs: all acceptance items 1 through 63.
- Depends on: specs 01 through 11.

## Goal

Define the final verification gate for a v6 implementation branch. This gate proves that schema cutover, strict read model, app-bound Pencil sessions, requirement-level design model, MCP tools, agent templates, Server/Web routes, UI canvas, and removal of old surfaces all satisfy DESIGN v6.

## Non-Goals

- Do not add new product scope during verification.
- Do not accept unverified runtime behavior as done.
- Do not use production or billing external systems.
- Do not mark release ready without the live Pencil smoke on an authenticated workstation.

## Verification

### Order

Run verification in this order:

1. Schema normalization and semantic contract unit tests.
2. Async startup and limited-mode tests.
3. Cutover, recovery, and rollback tests.
4. Legacy public surface negative tests.
5. Strict schema and read-model tests.
6. Pencil adapter, lock, session, manual edit, and journal recovery tests.
7. Core design model, index, quality, semantic, component, history tests.
8. MCP tool schema and handler tests.
9. Agent template and installer tests.
10. Server route and Web API client tests.
11. Web UI canvas, accessibility, responsive, and i18n tests.
12. Repository-wide typecheck and full test suite.
13. Live Pencil interactive smoke.
14. Negative `rg` runtime-surface checks.

Earlier failures block later release claims.

## Required Commands

At final gate, run:

```bash
pnpm typecheck
pnpm test
pnpm smoke:pencil
```

`pnpm smoke:pencil` requires Pencil CLI on `PATH`, authenticated Pencil status, and desktop app capability. If this environment is unavailable, v6 is not release verified.

Targeted commands are useful before the full gate, but they do not replace the full gate.

## Negative Runtime Surface Checks

Run checks that fail if old runtime surfaces remain in production code, user-visible docs, templates, or generated help.

Old design public names:

- `complete_product_init`,
- MCP one-shot `generate_components`,
- `generate_page_design`,
- `save_designs`,
- `generate_and_save_page_design`,
- `rollback_design`,
- `diff_designs`,
- `get_design_annotations`,
- `export_design_asset`,
- `fm-refine-design`,
- `/api/designs/:designId`,
- `/products/:productId/requirements/:requirementId/designs/:designId`.

Allowed locations for these old names:

- `design-version/`,
- migration or removal docs,
- changelog entries,
- negative tests that assert unknown tool, unknown command, or default 404,
- this spec set where old names are described as removed.

Runtime code, agent templates, install manifests, API clients, help output fixtures, and user-facing current docs must not advertise old names as usable.

## Async Store Check

Run:

```bash
rg "createFormaStore\\(" packages scripts
rg "buildServer\\(" packages scripts
```

Every executable call site must await, return, or explicitly chain the promise.
Type declarations must not hide `Promise<Store>` behind a synchronous store type.

## Headless Write Removal Check

Run checks against runtime code and scripts:

```bash
rg "\"--prompt\"|previewPencilModel|renderStylePreview|preview@2x\\.png" packages/core/src/sync.ts scripts/live-style-sync.ts
```

The command must return no matches for runtime Pencil-backed style preview generation.

Also check that runtime design write paths no longer call old headless `generatePageDesign()` or `generateComponents()` flows.

## Design Data Model Checks

Tests and static checks must prove:

- no runtime write creates page-level `D-*` design directories,
- no runtime read uses page-level `D-*` as design state, preview source, history source, or rollback source,
- strict schemas reject `design_id`,
- strict schemas reject `components_initialized`,
- `design.yaml` paths are `$FORMA_HOME` relative in canonical fields,
- API/MCP are allowed to return absolute paths only for display.

## Normalization Verification

Required tests:

- dry-run report success,
- dry-run no runtime writes,
- latest report selection,
- report missing/stale/failed/ambiguous,
- cutover success,
- cutover backup failure,
- cutover strict schema failure,
- explicit journal recovery success,
- explicit journal recovery failure,
- rollback success,
- manifest missing,
- backup hash mismatch,
- runtime path escape,
- partial restore failure,
- old schema smoke failure.

## Session Verification

Required tests:

- preflight failure leaves no leases,
- open probe failure begins rollback,
- timeout codes and phases,
- product and Pencil lock stale/corrupt/live-owner cases,
- begin/apply/commit/discard happy paths,
- `failed_operation` retry path,
- manual edit detection,
- formal canvas changed detection,
- commit journal restore success,
- commit journal restore failure,
- orphan journal recovery,
- product component library commit failure rollback.

## Core Design Verification

Required tests:

- P-907011/R-c9b123bf style frame mapping fixture,
- 25 matched pages scenario,
- unmanaged component candidate classification including reusable non-frame node,
- blocked page quality behavior,
- unmanaged import unverified copy warning behavior,
- metadata normalization plan success and unresolved nodes,
- Semantic Scope Guard allowed and denied cases,
- quality repair plan and second validation,
- layout scan limits and incomplete scan blocker,
- preview candidate export and committed preview integrity,
- component usage linked/unlinked scan,
- component refresh stable errors and success,
- rollback creates new page/canvas versions.

## API And UI Verification

Server/Web tests must prove:

- v6 routes exist,
- old routes default 404,
- SPA fallback excludes old design detail route,
- baseline image uses requirement-level preview only,
- Web client types have no `design_id`,
- DesignView reads canvas before scene,
- missing/incomplete/recovery-required index does not trigger writes during render,
- active session status displays structured lock/session data.

UI tests must prove:

- scene canvas hit testing uses node ids,
- screenshot preview is read-only contrast,
- pan/zoom/fit/reset work,
- keyboard controls work,
- page and node lists are usable alternatives,
- mobile and desktop layouts do not overlap,
- i18n maps contain new strings,
- production `AnnotationCanvas` is not imported.

## Agent Verification

Template and installer tests must prove:

- `fm-design` uses v6 session flow,
- `fm-design` rejects semantic expansion with `REQUIREMENT_UPDATE_REQUIRED`,
- `generate_components` is a macro over product component sessions,
- `fm-change-style` and `fm-refine-components` do not update existing requirement canvases,
- `fm-rollback-design` uses requirement-level history and session flow,
- `fm-refine-design` is removed from templates, route lists, help, and managed install manifest.

## Acceptance Criteria

- All required targeted tests pass.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm smoke:pencil` passes on an authenticated desktop environment.
- Negative surface checks confirm old public design model is gone from runtime/user-visible current surface.
- No page-level `D-*`, `design_id`, `components_initialized`, or headless write fallback remains in v6 runtime behavior.
- Verification output is recorded in the final implementation PR or release notes with exact commands and pass/fail status.

## Failure Handling

- Any failed required command blocks release.
- If `pnpm smoke:pencil` cannot run because Pencil CLI or authentication is unavailable, the release is not verified until it runs successfully on a suitable workstation.
- If negative checks find allowed historical references, the implementation must document the allowlist path and prove it is not runtime/user-visible current surface.
- If any check requires a fixture not yet present, add the fixture or test as part of the implementation stage that introduced the behavior.

## Out Of Scope

- This verification spec does not define implementation order; the index and stage specs do.
- This verification spec does not replace targeted acceptance criteria in earlier specs.
