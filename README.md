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
forma schema-normalization-dry-run --home /path/to/forma-home
forma v6-schema-cutover --home /path/to/forma-home
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

## v6 Schema Normalization

Existing runtime YAML is not rewritten automatically by `forma serve`, MCP startup, Web startup, or status reads. Use `forma schema-normalization-dry-run --home <path>` first; it writes only `$FORMA_HOME/normalization-preflight/v6-{timestamp}/report.yaml`. Then run `forma v6-schema-cutover --home <path>` to require the current passing preflight report, create `$FORMA_HOME/normalization-backups/v6-{timestamp}/`, write a journal, rewrite documented legacy YAML fields, and commit `.v6-schema-cutover-committed`.

If startup enters recovery-only mode, use `forma recover-v6-normalization-journal --home <path> --backup-dir <path>` or `forma restore-v6-normalization-backup --home <path> --backup-dir <path> --confirm restore_v6_backup`. Backup directories must stay under the current `$FORMA_HOME/normalization-backups/`.

## Web Admin

Start the local server:

```bash
forma serve
```

Open the local URL to create and configure products, browse styles, manage requirements, inspect baseline pages, and review multilingual copy.

## Desktop App

The `@xenonbyte/forma-desktop` package ships a read-only Electron renderer for browsing products, requirements, and design artifacts. Mutation flows stay in the Web admin and agent skills; the desktop app exposes only seven readonly methods via `window.forma`.

Run the desktop app in development mode against a running Forma server:

```bash
# Terminal 1 — start the local Forma server (defaults to 127.0.0.1:3000)
node bin/forma.js serve

# Terminal 2 — start the Electron renderer with hot reload
pnpm desktop:dev
```

The renderer reads `FORMA_SERVER_URL` (or `FORMA_SERVER_HOST` + `FORMA_SERVER_PORT`) to locate the server. Defaults to `http://127.0.0.1:3000`. Until the server is reachable, the renderer shows a placeholder page and retries every 5 seconds for up to 5 attempts.

Requirements:
- Electron 41+ (installed automatically via the package's devDependencies)
- Node.js 22+ and pnpm 10.33+ for the workspace

Security model:
- `window.forma` exposes only `listProducts`, `getProduct`, `listArtifacts`, `getArtifact`, `listRequirements`, `getRequirement`, and `formaServerStatus`.
- All HTTP mutations against the local server are rejected from the desktop renderer's origin; only the Web admin origin is whitelisted.
- The `forma-asset://` protocol handler validates paths and rejects traversal attempts.

Known limitations:
- This is dev-mode only. There is no `electron-builder` configuration yet, so the app cannot be packaged into a `.dmg`, `.exe`, or `.AppImage` from this checkout.
- The `serverStatus()` health check probes `/api/products` rather than a dedicated health endpoint.

## Agent Integration

Forma installs command templates for Claude, Codex, and Gemini. Claude and Gemini use `/fm-*` routes; Codex uses `$fm-*` skills. The current command set covers product selection, confirmed product deletion, unified requirement capture, design planning, component refinement, style changes, rollback, and status checks.

See [docs/AGENT.md](docs/AGENT.md) for the command table and recommended first-time and iterative workflows.

## MCP Tools

The MCP server exposes tool families for sessions, products, requirements, baselines, styles, copy, utilities, and structured error reporting. Legacy page-level design MCP tools are no longer registered; requirement-level v6 design session tools replace that surface. Requirement changes remain centered on `save_requirement`; there is no requirement deletion MCP tool. Product rules use `get_product_rules`, and multilingual copy uses `get_page_copy` / `update_page_copy`.

See [docs/MCP.md](docs/MCP.md) for tool groups, current behavior, and the frontend development data path.

## Data Location

The CLI and Web server use `~/.forma` by default. Override the root with `FORMA_HOME`:

```bash
FORMA_HOME=/path/to/forma-home forma status
```

Runtime data lives under `$FORMA_HOME/data`, including products, requirements, baselines, copy translations, and history. Forma also stores local manifests, shared skills/commands, built-in styles, library files, and server state under the same Forma home.

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
