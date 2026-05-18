# Forma

Forma is a local product-design asset management tool for turning requirement documents into Pencil-backed design artifacts. It keeps product requirements, functional baselines, generated `.pen` files, previews, annotations, history, and design diffs together so agents can move from product intent to inspectable design assets without losing provenance.

Forma v0.1 runs as a pnpm workspace with a CLI, MCP server, Fastify Web admin, React UI, core persistence/services, and installable agent commands for Claude, Codex, and Gemini.

## What It Solves

- Stores product requirements, baselines, designs, previews, and annotations in one local Forma home.
- Uses real Pencil CLI generation and export instead of a mock design engine.
- Exposes deterministic backend gates through core services, MCP tools, and the Web API.
- Provides a Web admin for products, requirements, baselines, styles, design previews, history, annotations, and diffs.
- Installs `fm-*` agent commands and MCP configuration for supported agent platforms.

## Requirements

- Node.js 22 or newer.
- pnpm 10.33.0 or compatible via Corepack.
- Pencil CLI installed and authenticated for real design generation and `pnpm smoke:pencil`.

## Setup

```bash
pnpm install
pnpm build
```

During development, run commands from the repository root. The root `bin/forma.js` entrypoint uses the workspace packages.

## Common CLI Commands

```bash
node bin/forma.js version
node bin/forma.js status
node bin/forma.js serve
node bin/forma.js install --platform claude,codex,gemini
```

After packaging or installing the CLI, the same commands are available as:

```bash
forma version
forma status
forma serve
forma install --platform claude,codex,gemini
```

`forma status` reports the Forma data directory, installed agent platforms, Pencil CLI availability/authentication, and Web server state. `forma serve` starts the Web admin on the configured local host/port, defaulting to `127.0.0.1:3000`.

## Web Admin

Start the local server:

```bash
node bin/forma.js serve
```

Open the local URL, then use the Web admin to inspect products, create products, browse styles, open requirement/design detail pages, and compare design versions through the diff view.

## Data Location

The CLI and Web server use `~/.forma` by default. Override the root with `FORMA_HOME`:

```bash
FORMA_HOME=/path/to/forma-home node bin/forma.js status
```

Runtime data lives under `$FORMA_HOME/data`, including products, requirements, design metadata, `.pen` files, preview PNGs, and history. Forma also stores local manifests, shared skills/commands, built-in styles, library files, and server state under the same Forma home.

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
pnpm pack:cli --dry-run
```

The v0.1 verification record is documented in [docs/verification/2026-05-18-v0.1.md](docs/verification/2026-05-18-v0.1.md).

## v0.1 Scope

Included in v0.1:

- Local product, requirement, baseline, style, design, annotation, history, and diff workflows.
- Real Pencil CLI integration for generation, validation, export, rollback, and smoke testing.
- Built-in offline style resources copied into Forma-managed storage.
- Web admin and MCP tools backed by the same core gates.
- Agent command installation for Claude, Codex, and Gemini.

Not included in v0.1:

- Automatic online style sync.
- Multi-user permissions.
- Project-management integrations.
- Advanced visual navigation graph rendering.
- Code generation from designs.
- A custom vector design engine.

These deferred areas are candidates for v0.2 or later. Design diff support is already part of v0.1.
