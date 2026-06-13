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

Store methods (`packages/core/src/store.ts` `FormaStore`): the six services above plus `generateRequirementDesign`, `generateComponents`, `changeArtifactStyle`, `deleteProduct`, `recoverPendingProductDeletes`, and `runProductMutation`. The image-generation feature adds `generateProductImage`, `readMediaConfig`, `writeMediaConfig`, `saveBrandAsset`, `listBrandAssets`, `exportBrandAssetsZip`, `resolveBrandImageRef`, and `listStoreShotPresets` (see **Image generation / media subsystem**).

**`createFormaStore`** (packages/core/src/store.ts) is the central factory. All services receive `{ home }` and share the same `$FORMA_HOME` on-disk layout. The server and MCP server each create their own store instance. The store exposes `runProductMutation` which serializes writes under a **per-product** file lock at `$FORMA_HOME/data/<productId>/locks/product-mutation.lock` (`product-mutation-lock.ts`).

**`FormaError`** (packages/core/src/errors.ts) is the unified error type with a `code` enum and JSON-serializable `details`. All layers (core → server routes → MCP tools) throw and catch `FormaError`. The HTTP server maps codes to status codes; the MCP server returns them as `{ error_code, message, details }`.

**On-disk layout** (`packages/core/src/paths.ts`, `artifact-paths.ts`) — note the **two per-product trees**: design artifacts live under `data/products/`, while requirement docs + locks + baselines live under `data/<productId>/`:

```
$FORMA_HOME/                       (defaults to ~/.forma, override with FORMA_HOME)
├── config.yaml  session.yaml  styles/
├── media-config.yaml              # image provider credentials (mode 0600; env overrides; never served/zipped/logged)
└── data/
    ├── products/<productId>/od-project/
    │   ├── manifest.json
    │   ├── artifacts/<artifactId>/   v{n}/ (index.html, assets/, preview/) · manifest.json · preview/
    │   └── brand-assets/             manifest.json · app-icon/ · store-shots/ · posters/
    └── <productId>/
        ├── <requirementId>/          requirement.yaml · document.md · copy-translations.yaml
        ├── image-staging/            <uuid>.png + <uuid>.json (generated-image staging, 24h TTL)
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

> **`od-*` status (in progress, not yet wired):** The `@xenonbyte/od-*` packages (version `0.0.1`) form a parallel subsystem that, as of now, is **imported only by each other** — no shipping entry point (`core`/`server`/`mcp`/`cli`/`web`/`desktop`/`viewer`) depends on them, and they are **not** in the npm publish set (`publish:npm`). They are still built and typechecked by the default `pnpm build`/`pnpm typecheck` (their tests resolve sibling packages through the built `dist`, e.g. `od-contracts/tests/package-runtime.test.ts`). Use `pnpm build:od` / `pnpm typecheck:od` to work on them in isolation. Treat them as work-in-progress until a shipping package imports them.

### Key patterns

- **Product mutation lock**: Any write that mutates product state must go through `runProductMutation`. This serializes concurrent operations under a per-product file lock at `$FORMA_HOME/data/<productId>/locks/product-mutation.lock`. See `packages/core/src/product-mutation-lock.ts`.
- **Design versioning**: Each design save creates a new immutable version directory under `$FORMA_HOME/data/products/<productId>/od-project/artifacts/<artifactId>/v{n}/`. Rollback restores the previous version pointer. The `v{n}/` dirs are immutable (`listArtifactVersions` matches `^v\d+$`); sibling dirs like `preview/` are not versions.
- **Requirement state machine**: Requirements progress through `empty → submitted → active → archived`. `save_requirement` is the only mutation path (no delete tool).
- **Generated design lifecycle**: the MCP tools `generate_requirement_design` (page design) and `generate_components` (component library) run through `design-save.ts`: generate into a temp dir → validate → atomically persist a new `v{n}/` → clean up the temp dir on both success and failure.

### Image generation / media subsystem

A self-contained `packages/core/src/media/` subsystem (`image-models.ts` provider+model catalogue, `image-config.ts` masked credential store, `image-generate.ts` scheduler + renderer registry, `image-staging.ts` staging area) plus `brand-assets.ts` (platform-derived app-icon sizing via sharp, store-shot/poster persistence, zip export, preset table) and `brand-asset-render.ts` (puppeteer HTML→PNG sandbox). Key facts:

- **Provider**: volcengine Seedream first (catalogue is extensible: add a catalogue entry + register a renderer); a hidden `stub` renderer is used by all automated tests (no network, no real key). Real provider calls are billable and occur only in user manual acceptance, never in CI.
- **`forma-image://` references** flow generated/brand images through the existing asset pipeline (no base64 through the LLM). Two namespaces: `forma-image://<uuid>` (staging) and `forma-image://brand/app-icon[@<size>]` (brand assets). `localizeArtifactAssets` resolves them at design-save time; brand-asset render HTML may additionally embed a product page screenshot as a `data:` URI.
- **Credentials**: `media-config.yaml` (mode 0600; env vars `FORMA_VOLCENGINE_API_KEY` > `ARK_API_KEY` > `VOLCENGINE_API_KEY` override the file). Masked reads only return `configured/source/model/base_url/api_key_tail` (env source omits even the tail). The file is never exposed via static serving, artifact/brand-asset zip exports, od-diagnostics, logs, or `FormaError` details.
- **Render sandbox**: store-shot/poster HTML is localized first, then rendered with puppeteer scripts disabled + request interception (allowlist = bundle-child `file://` only; remote/out-of-bundle refs fail loud).
- **New MCP tools (5)**: `generate_image`, `search_icons` (vendored Lucide library at `packages/core/assets/lucide-icons.json`, regenerated by `scripts/vendor-lucide.mjs`), `save_brand_asset`, `list_brand_assets`, `list_store_shot_presets`.
- **New server routes (7)**: `GET /api/media/models`, `GET`/`PUT /api/media/config`, `POST /api/media/test`; `GET /api/products/:pid/brand-assets`, `…/brand-assets/files/*` (path-boundary file serving), `…/brand-assets/export` (zip).
- **New agent commands**: `fm-app-icon` (generates the app icon, saved as `name="primary"`) and `fm-brand-assets` (store-shots + posters). The LLM-hand-drawn icon unit is retired; functional icons must come from `search_icons` (no hand-drawing). Per-purpose prompt scaffolds live in `craft/image-prompts.md`.

### Testing

Vitest with `environment: "node"` and workspace aliases (vitest.config.ts resolves `@xenonbyte/forma-*` to source). Tests live at `packages/*/tests/**/*.test.ts` and `packages/web/src/**/*.test.ts(x)`. Normal tests never require the Pencil CLI (it is not needed for the suite). Run a single file with `npx vitest run <path>`.

### Web routing

The SPA uses a custom hash-based router (packages/web/src/routes.tsx) with `RouteDefinition[]`. Navigation dispatches `forma:navigation` custom events and listens for `popstate`. No React Router dependency.

### Design handoff

- Archive-time handoff assets are implemented: final design HTML is converted to page-level icons and `.vzi` files under `<artifactId>/icons/` and `<artifactId>/vzi/page.vzi`. Core implementation lives in `packages/core/src/archive-asset-export.ts`, `packages/core/src/requirement-icon-export.ts`, and `packages/core/src/requirement-vzi-capture.ts`. MCP exposes `get_design_handoff`, `get_page_ui`, `get_ui_node`, and `search_page_ui` for archived requirements.

### Brand assets canvas (web)

The web SPA renders generated brand assets at `#/products/:pid/brand-assets` (`packages/web/src/pages/BrandAssets.tsx` + viewer `AssetTile`). It groups assets by manifest `kind` dynamically (app-icon / store-shot / poster appear as their data lands — no per-kind code), shows a "may be stale" badge when `asset.brand_style !== product.brand_style` (D11: flagged, never auto-regenerated), and offers per-file download + "export all" (zip).
