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
linter. Rollout is staged by concern:

- **Formatter — BLOCKING.** The whole repo was normalized once with `pnpm format`,
  so CI runs `biome format .` as a blocking gate; any formatting drift fails CI.
- **Linter — report-only.** CI runs `biome lint --changed` (non-blocking) because
  `recommended` still flags a backlog of ~33 rules / ~1000 findings across the
  pre-existing code. Promoting the linter to blocking is future work.

Local: `pnpm lint` (full report), `pnpm lint:fix`, `pnpm format`.

### Lint backlog — promote linter to blocking after clearing these

Work down per rule, then flip the CI `Biome lint` step to blocking (drop
`continue-on-error`, use `biome ci .`). Many are auto-fixable with
`biome check --write` / `--unsafe`; some are intentional (e.g.
`noControlCharactersInRegex` guards NUL-handling) and should be suppressed inline
rather than globally.

- **Auto-fixable (run `biome check --write --unsafe`, then review):** `useLiteralKeys`,
  `useOptionalChain`, `useNodejsImportProtocol`, `useParseIntRadix`, `noGlobalIsNan`,
  `noUselessSwitchCase`, `noUnusedImports`, `noUnusedVariables`.
- **Needs judgement:** `noNonNullAssertion` (~200), `noExplicitAny`,
  `noAssignInExpressions`, `noImplicitAnyLet`, `noConfusingVoidType`,
  `noShadowRestrictedNames`, `noThenProperty`, `useIterableCallbackReturn`,
  `noUnusedFunctionParameters`, `noUnusedPrivateClassMembers`, `useUniqueElementIds`,
  `useTemplate`, `noImportantStyles`, `noControlCharactersInRegex` (intentional).
- **a11y (web):** `useSemanticElements`, `useKeyWithClickEvents`, `useButtonType`,
  `noSvgWithoutTitle`, `noRedundantRoles`, `noNoninteractiveTabindex`,
  `noStaticElementInteractions`, `useAriaPropsSupportedByRole`.
- **React correctness (fix, don't suppress):** `useHookAtTopLevel`,
  `useExhaustiveDependencies`, `noArrayIndexKey`.

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
