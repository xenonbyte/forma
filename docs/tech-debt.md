# Tech debt & conventions

Living notes for known, intentional debt and repo conventions that are not
obvious from the code. Keep entries short; remove them when resolved.

## Oversized source files (split candidates)

These files are well-tested but carry high cognitive load. They are deliberately
left intact for now (splitting concurrency/security-sensitive code is high-risk,
low-reward, and was out of scope for the audit-remediation pass). Split only with
the existing test suite as a guardrail, one file at a time.

| File | Lines | Suggested split boundary |
|---|---|---|
| `packages/core/src/schema-normalization.ts` | ~2200 | Separate preflight/dry-run, cutover, and recovery/restore into sibling modules behind a thin facade. |
| `packages/server/src/routes.ts` | ~1350 | Split by route family: artifact serving (bundle/icon/preview/vzi), baseline compat, requirement/design routes. The path-safety helpers (`resolveServedFile`, `setArtifactSecurityHeaders`) belong in a shared `artifact-serving.ts`. |
| `packages/mcp/src/tools.ts` | ~1250 | Group tool handlers by domain (product, requirement, artifact, design, handoff) into per-domain files re-exported from `tools.ts`. |
| `packages/vzi-parser/src/puppeteer-parser.ts` | ~2000 | Extract launch/sandbox handling, snapshot styling, and extraction into helpers. |
| `packages/core/src/product-mutation-lock.ts` | ~770 | Dense cross-process lock logic (sidecar/heartbeat/stale-reclaim). Lowest priority: cohesive and security-sensitive; touch only with full lock-test coverage. |

## Lint/format rollout (Biome)

Biome 2.x is configured (`biome.json`) with the formatter and `recommended`
linter, but the pre-existing codebase carries a backlog (mostly web a11y rules
and a few intentional control-character regexes). Rollout is staged:

1. CI runs Biome **report-only** on changed files (`biome ci --changed`); it does
   not block the gate yet.
2. A dedicated, separately-committed `pnpm format` normalization pass + backlog
   cleanup should land before flipping the CI Biome step to blocking.

Local: `pnpm lint` (full report), `pnpm lint:fix`, `pnpm format`.

## Package publish & versioning policy

Independent semantic versions per package are intentional. The npm publish set
(`publish:npm`) is **only**:

- `@vzi-core/types`, `@vzi-core/format`, `@vzi-core/parser`, `@vzi-core/transformer`
- `@xenonbyte/forma-core`, `@xenonbyte/forma-mcp`, `@xenonbyte/forma-server`, `@xenonbyte/forma-cli`

**Not published** (internal/in-progress), and their versions are independent:

- `@vzi-core/renderer` (internal rendering lib consumed by `web`/`mcp`).
- `@xenonbyte/forma-web`, `@xenonbyte/forma-viewer`, `@xenonbyte/forma-desktop`, `@xenonbyte/forma-agent`.
- `@xenonbyte/od-*` — in-progress subsystem, not yet wired into any shipping
  entry point (see the `od-*` note in `CLAUDE.md`).

When bumping a published package, keep `pack:publish` (dry-run) green; it verifies
the publishable set still packs.
