# Forma

Forma is a local product-design workspace for turning product requirements into Pencil-backed design assets. It keeps product configuration, requirements, structured copy, baselines, generated `.pen` files, previews, annotations, history, and design diffs in one local Forma home.

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
| `@xenonbyte/forma-core` | Persistence, product configuration, requirements, baselines, copy, styles, designs, diffs, install manifests, and shared validation gates. |
| `@xenonbyte/forma-mcp` | MCP tool surface used by agents for sessions, products, requirements, baselines, copy, styles, and design workflows. |
| `@xenonbyte/forma-server` | Fastify API and static Web serving layer backed by core services. |
| `@xenonbyte/forma-web` | React Web admin for products, requirements, baselines, multilingual copy, styles, designs, annotations, and diffs. |
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

## Web Admin

Start the local server:

```bash
forma serve
```

Open the local URL to create and configure products, browse styles, manage requirements, inspect baseline pages, review multilingual copy, open design previews, view annotations, and compare design versions.

## Agent Integration

Forma installs command templates for Claude, Codex, and Gemini. Claude and Gemini use `/fm-*` routes; Codex uses `$fm-*` skills. The current command set covers product selection, confirmed product deletion, unified requirement capture, design generation/refinement, component refinement, style changes, rollback, and status checks.

See [docs/AGENT.md](docs/AGENT.md) for the command table and recommended first-time and iterative workflows.

## MCP Tools

The MCP server exposes tool families for sessions, products, requirements, baselines, designs, styles, copy, utilities, and structured error reporting. v0.4 adds confirmed `delete_product` and runs store-orchestrated `generate_components` under the product mutation lock. Requirement changes remain centered on `save_requirement`; there is no requirement deletion MCP tool. Product rules use `get_product_rules`, and multilingual copy uses `get_page_copy` / `update_page_copy`.

See [docs/MCP.md](docs/MCP.md) for tool groups, v0.4 behavior changes, and the frontend development data path.

## Data Location

The CLI and Web server use `~/.forma` by default. Override the root with `FORMA_HOME`:

```bash
FORMA_HOME=/path/to/forma-home forma status
```

Runtime data lives under `$FORMA_HOME/data`, including products, requirements, baselines, design metadata, `.pen` files, preview PNGs, copy translations, and history. Forma also stores local manifests, shared skills/commands, built-in styles, library files, and server state under the same Forma home.

## Pencil Smoke Test

```bash
pnpm smoke:pencil
```

This runs a real end-to-end Pencil smoke: installs built-in styles into a temporary Forma home, creates a product and requirement, generates components and a page design with the Pencil CLI, persists `design.pen` and `preview@2x.png`, reads annotations, and fetches the preview through the Web API.

Run it only when the Pencil CLI is installed, on `PATH`, and authenticated. The default `pnpm test` suite does not require live Pencil access.

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
