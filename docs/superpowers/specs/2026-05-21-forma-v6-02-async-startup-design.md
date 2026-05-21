# Forma v6 02: Async Startup Skeleton Spec

## Source Design Scope

- DESIGN v6 sections: `新数据模型` normalization recovery contracts, `锁与失败恢复`, `实施顺序` step 2.
- DESIGN v6 acceptance IDs: 59, 60.
- Depends on: `2026-05-21-forma-v6-01-preflight-normalization-design.md`.

## Goal

Migrate store, server, MCP, CLI, scripts, and tests to async startup while adding non-fatal `normal`, `preflight_only`, and `recovery_only` skeleton modes.

## Non-Goals

- Do not execute real schema cutover.
- Do not enable final strict v6 schema enforcement.
- Do not remove legacy public design tools yet.
- Do not register v6 design write tools.
- Do not change the normal-mode persisted design model beyond async startup plumbing.

## Requirements

- `createFormaStore(options)` becomes async and returns `Promise<FormaStore>`.
- `buildServer(options)` becomes async and awaits the store in normal mode.
- `createFormaMcpServer(options)` supports async store creation.
- CLI commands and workspace scripts that call `createFormaStore` await it before using the store.
- Server tests, MCP tests, CLI tests, and scripts tests must await async factories.
- Startup calls `readSchemaNormalizationRecoveryState(home)` before strict services are created.
- In this transitional stage, normal mode uses the existing runtime model after the raw recovery reader reports `mode: "normal"`.
- Preflight and recovery modes must start a limited server/MCP instead of throwing fatal startup errors.

## Startup Modes

`normal`:

- raw recovery reader returns `mode: "normal"` for this transitional stage,
- full existing runtime API can register,
- no normalizer preflight or cutover write runs automatically.

`preflight_only`:

- raw recovery reader returns `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED`,
- Fastify still listens,
- register `GET /api/status`,
- register static backend entry only when `webAssetsDir` is configured and passes existing static path validation,
- all non-status `/api/*` requests return 409 with preflight details,
- do not instantiate `ProductService`, `RequirementService`, `DesignService`, `SyncService`, or strict store services.

`recovery_only`:

- raw recovery reader returns `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`,
- Fastify still listens,
- register `GET /api/status`,
- register `GET /api/recovery/schema-normalization`,
- register `POST /api/recovery/schema-normalization/recover-journal` as a stub that returns 409 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED` with `details.recovery_actions` until spec 03 implements writes,
- register `POST /api/recovery/schema-normalization/restore-backup` as a stub that returns 409 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED` with `details.recovery_actions` until spec 03 implements writes,
- all non-recovery `/api/*` requests return 409 with recovery details,
- do not instantiate product, requirement, design, sync, or strict store services.

`fatal_startup_error`:

- reserved for Fastify construction failure, listen failure, static asset path violation, or route registration failure.

## Server Contract

Preflight-only 409 payload:

```typescript
{
  error_code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
  message: "Schema normalization preflight required",
  details: SchemaNormalizationRecoveryState
}
```

Recovery-only 409 payload:

```typescript
{
  error_code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
  message: "Schema normalization recovery required",
  details: SchemaNormalizationRecoveryState
}
```

`GET /api/status` must include `schema_normalization: SchemaNormalizationRecoveryState` in preflight-only and recovery-only modes.

## MCP Contract

`createFormaMcpServer(options)` must:

- create the full tool registry only after async store creation succeeds in normal mode,
- enter limited mode when normalization preflight/recovery blocks strict store startup,
- keep `fm-status` available in limited mode using `readSchemaNormalizationRecoveryState(home)`,
- register other existing Forma tool names as handlers that return the same normalization code and `SchemaNormalizationRecoveryState` details,
- avoid instantiating strict runtime services in limited mode.

## Async Migration Requirements

All production and test call sites must stop using a bare synchronous store factory return. The following locations must be covered:

- `packages/server/src/app.ts`,
- `packages/server/src/index.ts`,
- `packages/server/src/routes.ts` types,
- `packages/mcp/src/index.ts`,
- `packages/cli/src/index.ts`,
- `scripts/live-style-sync.ts`,
- `scripts/smoke-pencil.ts`,
- `scripts/smoke-pencil-error.ts`,
- package tests that construct store or server instances.

`packages/server/src/routes.ts` must use an awaited store type, not a `Promise`-typed store hidden behind `ReturnType<typeof createFormaStore>`.

## Failure Handling

- A normalization preflight/recovery state must not prevent HTTP port listening.
- A limited-mode handler must not fall through to normal product, requirement, design, component, or sync routes.
- If route registration for limited mode fails, startup is fatal.
- Async migration must not swallow store startup errors that are unrelated to normalization state.

## Out Of Scope

- Real schema cutover commands belong to spec 03.
- Public legacy removal belongs to spec 04.
- Strict v6 schema enforcement belongs to spec 05.
- Design session recovery jobs belong to spec 06.

## Acceptance Criteria

- Every runtime call site awaits `createFormaStore`.
- Every runtime call site awaits `buildServer` when it constructs a server.
- Preflight-only mode listens and returns `GET /api/status` with raw normalization state.
- Preflight-only mode registers static backend entry only when `webAssetsDir` is configured and validated.
- Recovery-only mode listens and returns `GET /api/status` plus `GET /api/recovery/schema-normalization` with raw normalization state.
- Recovery-only write recovery routes are registered as explicit 409 stubs until spec 03 replaces them with real recovery behavior.
- Preflight/recovery-only modes do not instantiate strict runtime services.
- Limited MCP mode exposes `fm-status` raw normalization state and blocks other Forma tools with the same normalization error details.
- Normal mode remains behaviorally equivalent to the previous runtime model for existing tests.

## Verification

- `rg "createFormaStore\\(" packages scripts` shows all executable call sites are awaited or returned through an explicit promise chain.
- `rg "buildServer\\(" packages scripts` shows all executable call sites are awaited or returned through an explicit promise chain.
- Server tests cover normal, preflight-only, recovery-only, and unrelated fatal startup errors.
- Server tests cover recovery-only stub write routes returning 409 with shared normalization state.
- MCP tests cover normal startup and limited mode error payloads.
- CLI/script tests cover async store creation.
- Existing old-model tests continue to pass until spec 05 replaces the read model.
