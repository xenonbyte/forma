# Forma

Forma is a local product-design workspace for turning product requirements into Pencil-backed design assets. It keeps product configuration, requirements, structured copy, baselines, requirement-level `.pen` canvases, previews, component libraries, sessions, and history in one local Forma home.

## Install

```bash
npm install -g @xenonbyte/forma-cli
forma version
forma status
```

Install agent commands for your agent platform:

```bash
forma install --platform codex
# or: forma install --platform claude,gemini
```

The published CLI bundles the agent command templates, built-in style assets, and Web admin assets. You only need to install `@xenonbyte/forma-cli`; npm installs its runtime packages automatically.

## Requirements

- Node.js 22 or newer.
- Pencil CLI installed and authenticated for real design generation.
- pnpm 10.33.0 or compatible via Corepack for local development.

## Development Setup

```bash
pnpm install
pnpm build
```

Run commands from the repository root during development. The root `bin/forma.js` entrypoint uses the workspace packages.

## Architecture

| Package | Role |
| --- | --- |
| `@xenonbyte/forma-core` | Persistence, product configuration, requirements, baselines, copy, styles, requirement-level design canvases, component libraries, install manifests, and shared validation gates. |
| `@xenonbyte/forma-mcp` | MCP tool surface used by agents for sessions, products, requirements, baselines, copy, styles, and design workflows. |
| `@xenonbyte/forma-server` | Fastify API and static Web serving layer backed by core services. |
| `@xenonbyte/forma-web` | React Web admin for products, requirements, baselines, multilingual copy, styles, requirement-level design scenes, component/session status, and previews. |
| `@xenonbyte/forma-agent` | Workspace-only Claude, Codex, and Gemini command templates that are bundled into the CLI package. |
| `@xenonbyte/forma-cli` | User-facing `forma` CLI for status, serving, installation, packaging assets, and MCP startup. |

## Common CLI Commands

```bash
forma version
forma status
forma serve
forma install --platform claude,codex,gemini
```

From a development checkout, the same commands are available through the root entrypoint:

```bash
node bin/forma.js version
node bin/forma.js status
node bin/forma.js serve
node bin/forma.js install --platform claude,codex,gemini
```

`forma status` reports the Forma data directory, installed agent platforms, Pencil CLI availability/authentication, and Web server state. `forma serve` starts the local Web admin, defaulting to `127.0.0.1:3000`.

## v6 Strict Read Model

Current v6 startup does not include an in-place compatibility upgrade path. `forma serve`, MCP startup, and Web startup run strict v6 read-model validation. Data that still contains removed legacy fields or misses v6-required contracts fails startup; repair the Forma home out of band before starting normal workflows.

`forma status` remains a read-only status report. It does not rewrite YAML, recover files, validate or repair the Forma home, or provide a reduced compatibility mode.

## Web Admin

Start the local server:

```bash
forma serve
```

Open the local URL to create and configure products, browse styles, manage requirements, inspect baseline pages, and review multilingual copy.

### Network exposure & authentication

`forma serve` binds to `127.0.0.1:3000` by default; on that loopback default the API has **no authentication** unless `FORMA_SERVER_TOKEN` is set (local-first). If you override the bind to a non-loopback address (`FORMA_SERVER_HOST=0.0.0.0`, an empty host value, or a LAN/public IP), the server **refuses to start** unless you also set `FORMA_SERVER_TOKEN`:

```bash
FORMA_SERVER_HOST=0.0.0.0 FORMA_SERVER_TOKEN=$(openssl rand -hex 32) forma serve
```

When `FORMA_SERVER_TOKEN` is set, every `/api/*` request must carry `Authorization: Bearer <token>`; requests without it get `401`, including on loopback binds. The bundled Web SPA shell stays open (static assets), but its browser `/api` calls do not attach this token — so the bundled Web UI is intended for unauthenticated loopback use. For remote access, drive the API programmatically with the bearer token, or front the server with a reverse proxy that injects auth. `FORMA_SERVER_TOKEN` is distinct from the CLI's `FORMA_SERVE_TOKEN` (which only tags the managed `serve` process).

Design artifacts open in the shared `@xenonbyte/forma-viewer` canvas (design / annotation modes toggle in-canvas) via two hash routes:

- by requirement: `#/products/:productId/requirements/:reqId/viewer`
- by page: `#/products/:productId/requirements/:reqId/pages/:pageId/viewer`

Product configuration uses a brand style (required) plus an optional system style; the style library renders the three-file brand format (`DESIGN.md` + `tokens.css` + a sandboxed `components.html` preview).

## Desktop App

The `@xenonbyte/forma-desktop` package ships a read-only Electron renderer with a unified-workspace shell: a sidebar (products / requirements / pages / brand styles) drives a workspace pane that renders the shared `@xenonbyte/forma-viewer` design–annotation canvas or a brand-style detail. The shell is styled with the `clean` brand tokens. Mutation flows stay in the Web admin and agent skills; the desktop app exposes only ten readonly methods via `window.forma`.

Run the desktop app in development mode against a running Forma server:

```bash
# Terminal 1 — start the local Forma server (defaults to 127.0.0.1:3000)
node bin/forma.js serve

# Terminal 2 — start the Electron renderer with hot reload
pnpm desktop:dev
```

The renderer reads `FORMA_SERVER_URL` (or `FORMA_SERVER_HOST` + `FORMA_SERVER_PORT`) to locate the server. Defaults to `http://127.0.0.1:3000`. On launch a `ConnectionGate` checks `formaServerStatus()`; while the server is unreachable it shows a full-screen overlay with a manual retry button, and renders the workspace once connected. Inside the workspace the viewer resolves bundle/preview resources over HTTP against the local server (base URL obtained via the `formaServerBaseUrl` IPC), so no resource fetch is initiated cross-origin from the renderer.

Requirements:
- Electron 41+ (installed automatically via the package's devDependencies)
- Node.js 22+ and pnpm 10.33+ for the workspace

Security model:
- `window.forma` exposes only the ten readonly methods `listProducts`, `getProduct`, `listArtifacts`, `getArtifact`, `listRequirements`, `getRequirement`, `formaServerStatus`, `formaServerBaseUrl`, `listStyles`, and `getStyle`. The three style/base-URL methods are forwarded by the main process (Node `fetch` against the server's existing `GET /api/styles`, `GET /api/styles/:name` read routes); the renderer never fetches `/api/...` cross-origin.
- All HTTP mutations against the local server are rejected from the desktop renderer's origin; only the Web admin origin is whitelisted.
- The `forma-asset://` protocol handler validates paths and rejects traversal attempts.

Known limitations:
- This is dev-mode only. There is no `electron-builder` configuration yet, so the app cannot be packaged into a `.dmg`, `.exe`, or `.AppImage` from this checkout.
- The `serverStatus()` health check probes `/api/products` rather than a dedicated health endpoint.

## Agent Integration

Forma installs command templates for Claude, Codex, and Gemini. Claude and Gemini use `/fm-*` routes; Codex uses `$fm-*` skills. The current command set covers product selection, confirmed product deletion, unified requirement capture, design planning, component refinement, style changes, rollback, and status checks.

## MCP Tools

The MCP server exposes tool families for sessions, products, requirements, baselines, styles, copy, utilities, and structured error reporting. Legacy page-level design MCP tools are no longer registered; requirement-level v6 design session tools replace that surface. Requirement changes remain centered on `save_requirement`; there is no requirement deletion MCP tool. Product rules use `get_product_rules`, and multilingual copy uses `get_page_copy` / `update_page_copy`.

## Data Location

The CLI and Web server use `~/.forma` by default. Override the root with `FORMA_HOME`:

```bash
FORMA_HOME=/path/to/forma-home forma status
```

Runtime data lives under `$FORMA_HOME/data`, including products, requirements, baselines, copy translations, and history. Forma also stores local manifests, shared skills/commands, built-in styles, library files, and server state under the same Forma home.

## Preview rendering (puppeteer)

`@xenonbyte/forma-core` renders design-artifact bundles to PNG via bundled `puppeteer` (ships Chromium).
- First `pnpm install` downloads Chromium (~150MB+). Air-gapped: pre-seed `~/.cache/puppeteer`, or set `PUPPETEER_SKIP_DOWNLOAD=1` and point `PUPPETEER_EXECUTABLE_PATH` at a system Chrome.
- CI: cache `~/.cache/puppeteer`; headless launch uses `--no-sandbox`.

## Verification

Useful release-readiness checks:

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
node bin/forma.js version
node bin/forma.js status
node scripts/copy-assets.ts --check
pnpm pack:publish
```

`pnpm test` runs three Vitest projects: Node unit tests plus two real-Chromium browser projects — the `@xenonbyte/forma-viewer` component tests and the desktop-shell craft-lint dogfood. A fresh checkout needs Chromium once: `pnpm exec playwright install chromium`. Desktop renderer unit tests live in their own Vitest config: `pnpm --filter @xenonbyte/forma-desktop test`.
