# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # install workspace dependencies (pnpm 10.33.2, Node ≥22)
pnpm build            # build all packages (CLI last, for asset bundling)
pnpm test             # run full Vitest suite
pnpm typecheck        # build then run per-package tsc checks (+ scripts/)
pnpm lint             # Biome 2.2.4 check (lint + format verify) across the repo
pnpm lint:fix         # Biome check --write (auto-fix); pnpm format = format-only write
pnpm lint:changed     # Biome ci on files changed since origin/main (used in CI)
pnpm check:vzi-boundary  # assert @vzi-core/renderer + canvaskit-wasm stay out of the backend runtime
pnpm dev:web          # Vite dev server for @xenonbyte/forma-web
pnpm desktop:dev      # run the Electron desktop app against the dev build
node bin/forma.js serve         # start Forma server from checkout
node bin/forma.js status        # report Forma home, Pencil state, server state
```

Biome (`biome.json`) is the linter + formatter (2-space indent, double quotes, 120-col). It does **not** scan `styles/`, `craft/`, `spikes/`, `design-version/`, or the vendored `packages/core/assets/lucide-icons.json`.

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

Store methods (`packages/core/src/store.ts` `FormaStore`): the six services above plus `generateRequirementDesign`, `generateComponents`, `changeArtifactStyle`, `deleteProduct`, `recoverPendingProductDeletes`, and `runProductMutation`. The image-generation feature adds `generateProductImage`, `readMediaConfig`, `writeMediaConfig`, `saveBrandAsset`, `listBrandAssets`, `deleteBrandAsset`, `exportBrandAssetsZip`, and `resolveBrandImageRef`; the desired-state plan comes from the pure `getBrandAssetPlan(product)` (see **Image generation / media subsystem**).

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
| `vzi-types`/`vzi-format`/`vzi-parser`/`vzi-transformer` | The `.vzi` design-interchange format, published as `@vzi-core/*`. Pure-TS; consumed by `core`/`mcp`/`server`/`web` for design-handoff capture/read (see **Design handoff**). |
| `vzi-renderer` | `@vzi-core/renderer` (`private`, CanvasKit/WASM). Vendored for future web/desktop only; **must never be imported by the Node backend runtime** (`core`/`server`/`cli`/`mcp`) — enforced by `pnpm check:vzi-boundary`. |
| `od-contracts` | Shared pure-TS contracts for the Open Design web/daemon boundary. |
| `od-*` | Open Design renderer/plugin subsystem: `od-host` (renderer host bridge), `od-plugin-runtime` (pure-TS plugin runtime, no `node:fs`), `od-platform`, `od-sidecar`/`od-sidecar-proto` (sidecar + protocol), `od-diagnostics` (log export/redaction). |

> **`od-*` status (in progress, not yet wired):** The `@xenonbyte/od-*` packages (version `0.0.1`) form a parallel subsystem that, as of now, is **imported only by each other** — no shipping entry point (`core`/`server`/`mcp`/`cli`/`web`/`desktop`/`viewer`) depends on them, and they are **not** in the npm publish set (`publish:npm`). They are still built and typechecked by the default `pnpm build`/`pnpm typecheck` (their tests resolve sibling packages through the built `dist`, e.g. `od-contracts/tests/package-runtime.test.ts`). Use `pnpm build:od` / `pnpm typecheck:od` to work on them in isolation. Treat them as work-in-progress until a shipping package imports them.

> **Publish set (`publish:npm`):** only `@vzi-core/{types,format,parser,transformer}` + `@xenonbyte/forma-{core,mcp,server,cli}` are published to npm. `web`, `desktop`, `viewer`, `agent`, `od-*`, and `@vzi-core/renderer` are **not** published standalone — the Web admin assets and agent command templates are bundled **into the CLI** at build time (hence CLI builds last). End users install only `@xenonbyte/forma-cli`.

### Key patterns

- **Product mutation lock**: Any write that mutates product state must go through `runProductMutation`. This serializes concurrent operations under a per-product file lock at `$FORMA_HOME/data/<productId>/locks/product-mutation.lock`. See `packages/core/src/product-mutation-lock.ts`.
- **Design versioning**: Each design save creates a new immutable version directory under `$FORMA_HOME/data/products/<productId>/od-project/artifacts/<artifactId>/v{n}/`. Rollback restores the previous version pointer. The `v{n}/` dirs are immutable (`listArtifactVersions` matches `^v\d+$`); sibling dirs like `preview/` are not versions.
- **Requirement state machine**: Requirements progress through `empty → submitted → active → archived`. `save_requirement` is the only mutation path (no delete tool).
- **Generated design lifecycle**: the MCP tools `generate_requirement_design` (page design) and `generate_components` (component library) run through `design-save.ts`: generate into a temp dir → validate → atomically persist a new `v{n}/` → clean up the temp dir on both success and failure.

### Image generation / media subsystem

A self-contained `packages/core/src/media/` subsystem (`image-models.ts` provider+model catalogue, `image-config.ts` masked credential store, `image-generate.ts` scheduler + renderer registry, `image-staging.ts` staging area) plus `brand-assets.ts` (app-icon: full per-platform/surface variant set derived LOCALLY via sharp from master images, atomically replaced; store-shot/banner/poster HTML→PNG persistence; zip export), `brand-asset-plan.ts` (pure `getBrandAssetPlan(product)` → the desired-state plan: per-kind entries with dimensions/count/surface/variant), and `brand-asset-render.ts` (puppeteer HTML→PNG sandbox). Key facts:

- **Provider**: volcengine Seedream first (catalogue is extensible: add a catalogue entry + register a renderer); a hidden `stub` renderer is used by all automated tests (no network, no real key). Real provider calls are billable and occur only in user manual acceptance, never in CI.
- **`forma-image://` references** flow generated/brand images through the existing asset pipeline (no base64 through the LLM). Two namespaces: `forma-image://<uuid>` (staging) and `forma-image://brand/app-icon[@<size>]` (brand assets). The bare `forma-image://brand/app-icon` resolves to the largest standard-variant app-icon file; variant selection is automatic (Forma no longer looks up an asset by a fixed name). `@<size>` selects the standard-variant file of that exact width. `localizeArtifactAssets` resolves them at design-save time; brand-asset render HTML may additionally embed a product page screenshot as a `data:` URI.
- **Credentials**: `media-config.yaml` (mode 0600; env vars `FORMA_VOLCENGINE_API_KEY` > `ARK_API_KEY` > `VOLCENGINE_API_KEY` override the file). Masked reads only return `configured/source/model/base_url/api_key_tail` (env source omits even the tail). The file is never exposed via static serving, artifact/brand-asset zip exports, od-diagnostics, logs, or `FormaError` details.
- **Render sandbox**: store-shot/banner/poster HTML is localized first, then rendered with puppeteer scripts disabled + request interception (allowlist = bundle-child `file://` only; remote/out-of-bundle refs fail loud).
- **Brand-asset kinds + product settings**: `app-icon`, `store-shot`, `banner`, `poster` (`BRAND_ASSET_KINDS`). `save_brand_asset` is a **discriminated union on `kind`**: app-icon takes master refs (`logo_ref`/`bg_ref`/`safe_logo_ref?`) + optional `colors`, derives the variant set locally and atomically replaces; media kinds take `source.html` + `target={width,height}` (+ optional `surface`/`variant`) rendered to one PNG. `BrandAssetRecord` carries optional `surface` (android/ios) + `variant`. The per-product `brand_assets` settings block (`store_shot_count`, `banner`, `poster_{portrait,landscape,square}`) drives `getBrandAssetPlan`.
- **New MCP tools (6)**: `generate_image`, `search_icons` (vendored Lucide library at `packages/core/assets/lucide-icons.json`, regenerated by `scripts/vendor-lucide.mjs`), `save_brand_asset`, `list_brand_assets`, `get_brand_asset_plan`, `delete_brand_asset`.
- **New server routes (8)**: `GET /api/media/models`, `GET`/`PUT /api/media/config`, `POST /api/media/test`; `PUT /api/products/:pid/brand-asset-settings`; `GET /api/products/:pid/brand-assets`, `…/brand-assets/files/*` (path-boundary file serving), `…/brand-assets/export` (zip).
- **New agent commands**: `fm-app-icon` (generates 2-3 master images, then ONE discriminated-union `save_brand_asset` that derives the full variant set locally and atomically replaces the app-icon set) and `fm-brand-assets` (reads `get_brand_asset_plan` first, then one save per plan entry for store-shots/banner/posters). The LLM-hand-drawn icon unit is retired; functional icons must come from `search_icons` (no hand-drawing). Per-purpose prompt scaffolds live in `craft/image-prompts.md`.

### Testing

Vitest with `environment: "node"` and workspace aliases (vitest.config.ts resolves `@xenonbyte/forma-*` to source). Tests live at `packages/*/tests/**/*.test.ts` and `packages/web/src/**/*.test.ts(x)`. Normal tests never require the Pencil CLI (it is not needed for the suite). Run a single file with `npx vitest run <path>`.

### Web routing

The SPA uses a custom History-API (pushState) router (packages/web/src/routes.tsx) with `RouteDefinition[]`; routes match on `window.location.pathname` (the URL `#…` part is treated as an in-page fragment, not the route). Navigation dispatches `forma:navigation` custom events and listens for `popstate`. No React Router dependency.

### Design handoff

- Archive-time handoff assets are implemented: final design HTML is converted to page-level icons and `.vzi` files under `<artifactId>/icons/` and `<artifactId>/vzi/page.vzi`. Core implementation lives in `packages/core/src/archive-asset-export.ts`, `packages/core/src/requirement-icon-export.ts`, and `packages/core/src/requirement-vzi-capture.ts`. MCP exposes `get_design_handoff`, `get_page_ui`, `get_ui_node`, and `search_page_ui` for archived requirements.

### Brand assets canvas (web)

The web SPA renders generated brand assets at `/products/<product_id>/brand-assets` (`packages/web/src/pages/BrandAssets.tsx` + viewer `AssetTile`). It groups assets by manifest `kind` dynamically (app-icon / store-shot / banner / poster appear as their data lands — no per-kind code), then by `surface` (Android / iOS) within a kind for mobile/tablet, shows a "may be stale" badge when `asset.brand_style !== product.brand_style` (D11: flagged, never auto-regenerated), and offers per-file download + "export all" (zip).
