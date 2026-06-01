# Repository Guidelines

## Project Structure & Module Organization

Forma is a pnpm workspace for a local Pencil-backed design workspace. Source code is split by package under `packages/`: `core` holds persistence, schemas, requirements, designs (artifacts), styles, and validation; `mcp` exposes agent tools; `server` provides the Fastify API and static Web serving; `web` is the React/Vite admin UI; `desktop`/`viewer` render artifact bundles (Electron app + pure renderer); `agent` contains command templates; `cli` provides the `forma` binary. The `od-*` packages (`od-contracts`, `od-host`, `od-plugin-runtime`, `od-platform`, `od-sidecar`/`od-sidecar-proto`, `od-diagnostics`) are the Open Design renderer/plugin subsystem. Tests live in `packages/*/tests/**/*.test.ts` and `packages/web/src/**/*.test.ts(x)`. Supporting files are in `scripts/`, `docs/`, `styles/`, `design-version/`, and `bin/`.

## Build, Test, and Development Commands

- `pnpm install`: install workspace dependencies using pnpm 10.33.2.
- `pnpm build`: build all packages, with the CLI built last so bundled assets are copied.
- `pnpm test`: run the Vitest suite.
- `pnpm typecheck`: build and run package TypeScript checks.
- `pnpm dev:web`: start the Vite dev server for `@xenonbyte/forma-web`.
- `node bin/forma.js serve`: run the local Forma server from the checkout.
- `pnpm desktop:dev`: run the Electron desktop app against the dev build.

## Coding Style & Naming Conventions

Use TypeScript ESM with Node.js 22 or newer. Keep strict TypeScript clean; package builds use `tsc -p tsconfig.json`. Follow the existing style: two-space indentation, semicolons, double quotes, and explicit exported types where helpful. Use `PascalCase` for React components and classes, `camelCase` for functions and variables, and kebab-case for route-like or command names such as `fm-refine-components`. Preserve package boundaries and import workspace packages through `@xenonbyte/forma-*` aliases where appropriate.

## Testing Guidelines

Vitest is the test runner. Name tests `*.test.ts` or `*.test.tsx`, colocated with Web source or under package `tests/` directories. Prefer focused unit tests for schema, service, route, and UI behavior. Do not require live Pencil access in normal tests.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit prefixes such as `fix:` and `chore:`. Keep subjects imperative and specific, for example `fix: preserve design preview metadata`. PRs should include a short problem statement, implementation summary, verification commands run, linked issues, and screenshots or screen recordings for Web UI changes.

## Security & Configuration Tips

Runtime data defaults to `~/.forma`; use `FORMA_HOME=/tmp/forma-dev` for isolated development. Do not commit generated `.pen` files, local Forma data, credentials, Pencil auth state, or environment-specific logs unless a fixture is explicitly intended for tests.
