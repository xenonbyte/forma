# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # install workspace dependencies (pnpm 10.33.2, Node ≥22)
pnpm build            # build all packages (CLI last, for asset bundling)
pnpm test             # run full Vitest suite
pnpm typecheck        # build then run per-package tsc checks
pnpm dev:web          # Vite dev server for @xenonbyte/forma-web
pnpm desktop:dev      # run the Electron desktop app against the dev build
node bin/forma.js serve         # start Forma server from checkout
node bin/forma.js status        # report Forma home, Pencil state, server state
```

Run a single test file:
```bash
npx vitest run packages/core/tests/design.test.ts
```

## Architecture

Forma is a pnpm monorepo (`packages/*`). The data flow:

```
bin/forma.js  ──►  @xenonbyte/forma-cli
                        │
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
  HTTP server      MCP server       CLI status/install
  (Fastify)        (Stdio MCP)
       │                │
       └────────┬───────┘
                ▼
       createFormaStore(home)   ← single DI container for all services
                │
    ┌──────────┬┴─────────┬───────────┬──────────┬──────────┐
    ▼          ▼          ▼           ▼          ▼          ▼
 products  requirements artifacts    copy     sessions   styles
```

Store methods (`packages/core/src/store.ts` `FormaStore`): the six services above plus `generateRequirementDesign`, `generateComponents`, `changeArtifactStyle`, `deleteProduct`, `recoverPendingProductDeletes`, and `runProductMutation`.

**`createFormaStore`** (packages/core/src/store.ts) is the central factory. All services receive `{ home }` and share the same `$FORMA_HOME` on-disk layout. The server and MCP server each create their own store instance. The store exposes `runProductMutation` which serializes writes under a **per-product** file lock at `$FORMA_HOME/data/<productId>/locks/product-mutation.lock` (`product-mutation-lock.ts`).

**`FormaError`** (packages/core/src/errors.ts) is the unified error type with a `code` enum and JSON-serializable `details`. All layers (core → server routes → MCP tools) throw and catch `FormaError`. The HTTP server maps codes to status codes; the MCP server returns them as `{ error_code, message, details }`.

**On-disk layout** (`packages/core/src/paths.ts`, `artifact-paths.ts`) — note the **two per-product trees**: design artifacts live under `data/products/`, while requirement docs + locks + baselines live under `data/<productId>/`:

```
$FORMA_HOME/                       (defaults to ~/.forma, override with FORMA_HOME)
├── config.yaml  session.yaml  styles/
└── data/
    ├── products/<productId>/od-project/
    │   ├── manifest.json
    │   └── artifacts/<artifactId>/   v{n}/ (index.html, assets/, preview/) · manifest.json · preview/
    └── <productId>/
        ├── <requirementId>/          requirement.yaml · document.md · copy-translations.yaml
        ├── locks/product-mutation.lock
        └── baseline/
```

### Package roles

| Package | Role |
|---|---|
| `core` | All persistence, business logic, validation, and on-disk I/O. No network layer. |
| `server` | Fastify HTTP API + static web asset serving. Thin wrapper over core store. |
| `mcp` | MCP stdio server. Wraps the same core store with MCP tool schemas. |
| `web` | React SPA (Vite). Hash-based client-side router, no server rendering. |
| `cli` | User-facing `forma` CLI. Entrypoint: `bin/forma.js` → `@xenonbyte/forma-cli`. |
| `agent` | Command templates installed into Claude/Codex/Gemini platforms. |
| `desktop` | Electron desktop app; renders artifact bundles via `viewer` over the HTTP API. |
| `viewer` | Pure design-bundle rendering library (no data fetching of its own). |
| `od-contracts` | Shared pure-TS contracts for the Open Design web/daemon boundary. |
| `od-*` | Open Design renderer/plugin subsystem: `od-host` (renderer host bridge), `od-plugin-runtime` (pure-TS plugin runtime, no `node:fs`), `od-platform`, `od-sidecar`/`od-sidecar-proto` (sidecar + protocol), `od-diagnostics` (log export/redaction). |

### Key patterns

- **Product mutation lock**: Any write that mutates product state must go through `runProductMutation`. This serializes concurrent operations under a per-product file lock at `$FORMA_HOME/data/<productId>/locks/product-mutation.lock`. See `packages/core/src/product-mutation-lock.ts`.
- **Design versioning**: Each design save creates a new immutable version directory under `$FORMA_HOME/data/products/<productId>/od-project/artifacts/<artifactId>/v{n}/`. Rollback restores the previous version pointer. The `v{n}/` dirs are immutable (`listArtifactVersions` matches `^v\d+$`); sibling dirs like `preview/` are not versions.
- **Requirement state machine**: Requirements progress through `empty → submitted → active → archived`. `save_requirement` is the only mutation path (no delete tool).
- **Generated design lifecycle**: the MCP tools `generate_requirement_design` (page design) and `generate_components` (component library) run through `design-save.ts`: generate into a temp dir → validate → atomically persist a new `v{n}/` → clean up the temp dir on both success and failure.

### Testing

Vitest with `environment: "node"` and workspace aliases (vitest.config.ts resolves `@xenonbyte/forma-*` to source). Tests live at `packages/*/tests/**/*.test.ts` and `packages/web/src/**/*.test.ts(x)`. Normal tests never require the Pencil CLI (it is not needed for the suite). Run a single file with `npx vitest run <path>`.

### Web routing

The SPA uses a custom hash-based router (packages/web/src/routes.tsx) with `RouteDefinition[]`. Navigation dispatches `forma:navigation` custom events and listens for `popstate`. No React Router dependency.

### Design handoff

- Archive-time handoff assets are implemented: final design HTML is converted to page-level icons and `.vzi` files under `<artifactId>/icons/` and `<artifactId>/vzi/page.vzi`. Core implementation lives in `packages/core/src/archive-asset-export.ts`, `packages/core/src/requirement-icon-export.ts`, and `packages/core/src/requirement-vzi-capture.ts`. MCP exposes `get_design_handoff`, `get_page_ui`, `get_ui_node`, and `search_page_ui` for archived requirements.
