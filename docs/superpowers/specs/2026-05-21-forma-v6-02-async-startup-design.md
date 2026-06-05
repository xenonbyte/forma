# Forma v6 02: Async Startup Spec

## Source Design Scope

- DESIGN v6 sections: `锁与失败恢复`, `实施顺序` step 2.
- DESIGN v6 acceptance IDs: 60.
- Depends on: `2026-05-21-forma-v6-index-design.md`.
- Supersedes earlier legacy compatibility startup drafts removed by the 2026-06-05 removal spec.

## Goal

Migrate store, server, MCP, CLI, scripts, and tests to async startup while preserving strict v6 read-model validation as the runtime entry gate.

## Non-Goals

- Do not implement an automatic compatibility upgrade path.
- Do not add reduced server or MCP modes for legacy data.
- Do not remove legacy public design tools yet.
- Do not register v6 design write tools.
- Do not change the normal-mode persisted design model beyond async startup plumbing.

## Requirements

- `createFormaStore(options)` becomes async and returns `Promise<FormaStore>`.
- `buildServer(options)` becomes async and awaits the store in normal mode.
- `createFormaMcpServer(options)` supports async store creation.
- CLI commands and workspace scripts that call `createFormaStore` await it before using the store.
- Server tests, MCP tests, CLI tests, and scripts tests must await async factories.
- Runtime startup constructs strict services directly. If the Forma home fails v6 read-model validation, startup fails with the validation error.
- Background recovery tasks run only after strict store creation succeeds.

## Startup Behavior

`normal`:

- strict store creation succeeds,
- full runtime API and MCP tool registry can register,
- startup does not rewrite persisted YAML.

`fatal_startup_error`:

- Fastify construction failure, listen failure, static asset path violation, route registration failure, or strict read-model validation failure.

## Server Contract

`buildServer(options)` awaits strict store creation before registering normal routes. A validation failure prevents route registration instead of starting a reduced compatibility server.

## MCP Contract

`createFormaMcpServer(options)` must:

- create the full tool registry only after async store creation succeeds,
- fail startup when strict read-model validation fails,
- avoid registering partial compatibility handlers.

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

- Async startup must not swallow store startup errors.
- Validation failures must preserve their stable error code and details through CLI/server/MCP startup logs or returned errors.
- A background recovery task must never be required before the strict store exists.

## Out Of Scope

- Public legacy removal belongs to spec 04.
- Strict v6 schema enforcement belongs to spec 05.
- Design session recovery jobs belong to spec 06.

## Acceptance Criteria

- Every runtime call site awaits `createFormaStore`.
- Every runtime call site awaits `buildServer` when it constructs a server.
- Server and MCP startup fail loudly when strict read-model validation fails.
- Normal mode remains behaviorally equivalent after all call sites are awaited.

## Verification

- `rg "createFormaStore\\(" packages scripts` shows all executable call sites are awaited or returned through an explicit promise chain.
- `rg "buildServer\\(" packages scripts` shows all executable call sites are awaited or returned through an explicit promise chain.
- Server tests cover normal startup and validation-failure startup.
- MCP tests cover normal startup and validation-failure startup.
- CLI/script tests cover async store creation.
