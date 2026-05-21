# Forma v6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Forma v6 end to end from the indexed split specs, replacing the old page-level design runtime with strict v6 normalization, requirement-level design canvases, app-bound Pencil sessions, v6 MCP/API/Web/agent surfaces, and final release verification.

**Architecture:** Execute the 12 stage specs in numeric order from the total index spec. The plan keeps destructive schema rewrite work behind explicit preflight/cutover/recovery commands, removes old public design surfaces before exposing new v6 write surfaces, and gates every `.pen` write behind visible Pencil App sessions and deterministic validation. SPEC files define requirements and acceptance; `design-version/DESIGN-v6.md` defines architecture, boundaries, data flow, recovery, interaction, and naming.

**Tech Stack:** TypeScript ESM, Node.js 22+, Zod v4, Fastify, React 19, Vite, Leafer UI, Vitest, pnpm workspace scripts, Pencil CLI/App integration, existing `@xenonbyte/forma-*` workspace packages.

---

## Governing Sources

- Total index spec: `docs/superpowers/specs/2026-05-21-forma-v6-index-design.md`
- Stage specs: `docs/superpowers/specs/2026-05-21-forma-v6-01-preflight-normalization-design.md` through `docs/superpowers/specs/2026-05-21-forma-v6-12-verification-design.md`
- Upstream design: `design-version/DESIGN-v6.md`
- Plan audit rule: `/Users/xubo/Desktop/PLAN-RULE.md`
- Spec audit rule: `/Users/xubo/Desktop/SPEC-RULE.md`

## Non-Negotiable Execution Rules

- Do stages in order: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12.
- Before each stage, re-read that stage spec and the referenced DESIGN v6 sections.
- If a stage spec conflicts with `design-version/DESIGN-v6.md`, stop and record the conflict as a blocking issue; do not choose one side silently.
- Do not add compatibility layers that make old page-level `D-*`, `design_id`, or `components_initialized` valid v6 runtime state.
- Do not expose v6 write tools, routes, templates, or UI buttons before the dependency stage that owns the required core behavior.
- Do not run schema cutover automatically from `forma serve`, server startup, MCP startup, Web render, or status reads.
- Do not commit unless the user explicitly authorizes a commit.
- Before modifying files in each stage, run `git status --short` and preserve unrelated user changes.
- `docs/superpowers/` and `CONTINUITY.md` can be ignored by global gitignore; if a future commit is requested, force-add these docs explicitly.

## Current Code Baseline

- `packages/core/src/store.ts` currently exports synchronous `createFormaStore` and constructs `ProductService`, `RequirementService`, `DesignService`, `SyncService`, `SessionService`, `BaselineService`, `CopyService`, and `StyleService`.
- `packages/server/src/app.ts` currently exports synchronous `buildServer`, constructs a store when one is not supplied, registers full routes, starts product deletion recovery, and runs sync recovery.
- `packages/server/src/routes.ts` owns current REST routes, including old design routes.
- `packages/mcp/src/index.ts` already exports async `createFormaMcpServer`, but it currently calls synchronous `createFormaStore`.
- `packages/mcp/src/tools.ts` owns MCP tool names, input schemas, handlers, success/error wrappers, and old design tools.
- `packages/cli/src/index.ts` owns CLI dispatch and must receive all normalization CLI commands.
- `packages/web/src/api.ts`, `packages/web/src/routes.tsx`, `packages/web/src/pages/DesignView.tsx`, `packages/web/src/pages/RequirementDetail.tsx`, `packages/web/src/components/AnnotationCanvas.tsx`, and `packages/web/src/components/PropertyPanel.tsx` own current Web API and design UI behavior.
- `packages/agent/src/index.ts` currently lists `fm-refine-design`; templates exist for Claude, Codex, and Gemini under `packages/agent/templates/`.
- `packages/core/src/pencil.ts`, `packages/core/src/sync.ts`, `packages/core/src/product-mutation-lock.ts`, and `packages/core/src/session.ts` are the existing Pencil, style sync, lock, and session roots that v6 must reshape rather than bypass.

## Planned File Map

### Core Normalization And Schemas

- Create or extend `packages/core/src/semantic-contract.ts`: semantic contract builders and deterministic conflict detection.
- Create or extend `packages/core/src/schema-normalization.ts`: raw preflight, report selection, cutover, backup, journal, markers, recovery, rollback, and startup recovery-state reader.
- Modify `packages/core/src/schemas.ts`: strict v6 schemas for product, requirement pages, baselines, component metadata, and requirement design metadata.
- Modify `packages/core/src/store.ts`: async startup and strict-store construction gates.
- Modify `packages/core/src/product.ts`: remove `components_initialized`, add component library read model and product config checks.
- Modify `packages/core/src/requirement.ts`: persist semantic contracts, reject old design keys, update requirement save and baseline aggregation behavior.
- Modify `packages/core/src/baseline.ts`: v6 baseline semantic aggregate and preview lookup inputs.
- Modify `packages/core/src/product-deletion.ts`: v6 component library path journaling and active design session blocking.

### Core Pencil And Design Model

- Create `packages/core/src/pencil-adapter.ts`: app-bound `PencilAppSessionAdapter`, read/export-only `PencilReadExportAdapter`, timeout constants, capability probes, and session wrapper helpers.
- Modify `packages/core/src/pencil.ts`: keep low-level availability/read/export helpers, remove public headless runtime write usage.
- Modify `packages/core/src/product-mutation-lock.ts`: add v6 lock content, TTL, heartbeat, stale reclaim, corrupt lock detection, and release mismatch warnings.
- Modify `packages/core/src/session.ts`: session status/read helpers shared by CLI/API/MCP/UI.
- Create `packages/core/src/design-session.ts`: begin/apply/commit/discard/recover requirement sessions and product component sessions.
- Create `packages/core/src/component-session.ts`: product component library session helpers, version snapshots, metadata checks, and component library commit journal.
- Create `packages/core/src/requirement-design.ts`: requirement-level `design.pen`/`design.yaml` read model, index, history, rollback, diff, export, commit candidate builder.
- Create `packages/core/src/design-scene.ts`: scene payload and unsupported property extraction.
- Create `packages/core/src/design-quality.ts`: deterministic Design Quality Pipeline, repair plan, preview export gate, and AI warning merge.
- Create `packages/core/src/semantic-scope.ts`: allowed semantic surface and strict scope guard.
- Create `packages/core/src/component-usage.ts`: component usage index and component refresh planning.
- Modify `packages/core/src/sync.ts` and `scripts/live-style-sync.ts`: remove headless Pencil-backed preview generation.

### Server, MCP, CLI, Agent, Web

- Modify `packages/server/src/app.ts`: async `buildServer`, limited preflight/recovery modes, old SPA fallback exclusion.
- Modify `packages/server/src/routes.ts`: v6 REST routes, old route removal, forbidden path-field rejection, baseline preview route.
- Modify `packages/server/src/index.ts`: await async server creation.
- Modify `packages/mcp/src/index.ts`: async store startup and limited MCP mode.
- Modify `packages/mcp/src/tools.ts`: v6 MCP registry, schemas, handlers, path rejection, stable errors, removed tool absence.
- Modify `packages/cli/src/index.ts`: normalization dry-run, cutover, recover journal, restore backup commands.
- Modify `packages/agent/src/index.ts`: remove `fm-refine-design`, keep v6 route list.
- Modify `packages/agent/templates/claude/*`, `packages/agent/templates/codex/*/SKILL.md`, `packages/agent/templates/gemini/*.toml`, and `packages/agent/templates/shared/SKILL.md`: v6 workflows.
- Modify `packages/web/src/api.ts`: v6 API types and client functions, old `design_id` removal.
- Modify `packages/web/src/routes.tsx`: requirement-level design route and old design route exclusion.
- Modify `packages/web/src/pages/RequirementDetail.tsx`: v6 design entry and session/status panels.
- Replace `packages/web/src/pages/DesignView.tsx`: requirement-level canvas flow.
- Create `packages/web/src/components/DesignSceneCanvas.tsx`: Leafer UI scene renderer and interactions.
- Create `packages/web/src/components/DesignSessionPanel.tsx`: structured session and lock status.
- Modify `packages/web/src/components/PropertyPanel.tsx`: v6 node property inspection and export links.
- Modify `packages/web/src/components/NavigationGraph.tsx`: pan/zoom controls and keyboard parity for graph interactions.
- Modify `packages/web/src/i18n.ts`: all new `en` and `zh` UI strings.
- Modify `docs/MCP.md`, `docs/AGENT.md`, and `README.md`: v6 current behavior and removal notes.

## Cross-Cutting Contracts

### Normalization Recovery State

Use the shared state from Stage 01:

```typescript
type SchemaNormalizationMode = "normal" | "preflight_only" | "recovery_only";
type SchemaNormalizationStatus = "committed" | "preflight_required" | "recovery_required" | "restored";
```

The reader `readSchemaNormalizationRecoveryState(home)` remains side-effect-free for every stage. Only explicit dry-run, cutover, recover, or restore functions may write normalization files.

### Forbidden Runtime/Public Fields

After strict cutover, these fields and public names must not appear in runtime schemas, public APIs, MCP payloads, Web types, or agent templates except negative tests and historical docs:

- `design_id`
- `components_initialized`
- page-level `D-*` design state
- old `/api/designs/:designId/*` routes
- old MCP design tools removed by Stage 04
- `fm-refine-design`

### Path Rules

- Canonical YAML, journals, and manifests store `$FORMA_HOME` relative paths.
- API and MCP responses may include absolute paths only for display or audit.
- Any caller-supplied mutation payload containing `filePath`, `file_path`, `canvas_path`, `staging_path`, `outputDir`, `output_dir`, `path`, `pen_path`, `preview_path`, or `history_path` must return `FORBIDDEN_PATH_PARAMETER`.

### Pencil Write Boundary

- Requirement design writes and product component library writes go through visible Pencil App sessions only.
- Read/export operations may run through a read/export adapter, but must not mutate committed `.pen` files.
- No headless prompt generation path may replace app-bound writes.

---

## Task 0: Baseline And Audit Gates

**Trace:** index spec, PLAN-RULE PASS standards, writing-plans workflow.

**Files:**
- Read: `docs/superpowers/specs/2026-05-21-forma-v6-index-design.md`
- Read: `docs/superpowers/specs/2026-05-21-forma-v6-*.md`
- Read: `design-version/DESIGN-v6.md`
- Inspect: repository root
- Update as work progresses: `CONTINUITY.md`

- [ ] **Step 0.1: Confirm worktree and ignored docs**

Run:

```bash
git status --short --ignored docs/superpowers CONTINUITY.md
```

Completion standard: record ignored docs and unrelated user changes; do not revert or reformat unrelated files.

- [ ] **Step 0.2: Confirm all spec inputs exist**

Run:

```bash
find docs/superpowers/specs -maxdepth 1 -type f -name '2026-05-21-forma-v6-*-design.md' | sort
```

Completion standard: output contains one index spec plus 12 stage specs.

- [ ] **Step 0.3: Confirm specs are free of unresolved markers**

Run:

```bash
rg -n "[T]BD|[T]ODO|[U]NCONFIRMED|\\?\\?\\?" docs/superpowers/specs/2026-05-21-forma-v6-*.md
```

Completion standard: no output.

- [ ] **Step 0.4: Establish baseline checks**

Run:

```bash
pnpm test
pnpm typecheck
```

Completion standard: both pass, or pre-existing failures are recorded with command output before Stage 01 code execution starts.

- [ ] **Step 0.5: Keep handoff current**

Update `CONTINUITY.md` after any completed stage or blocked verification.

Completion standard: ledger states current stage, completed verification, known blockers, and working files without recording secrets or transient logs.

---

## Task 1: Stage 01 Preflight Normalization

**Trace:** `2026-05-21-forma-v6-01-preflight-normalization-design.md`, DESIGN v6 `新数据模型`, acceptance IDs 53, 57, 59.

**Files:**
- Create: `packages/core/src/semantic-contract.ts`
- Create: `packages/core/src/schema-normalization.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/semantic-contract.test.ts`
- Test: `packages/core/tests/schema-normalization.test.ts`

**Contracts:**
- Stage 01 is read-only except explicit preflight report writes under `$FORMA_HOME/normalization-preflight/v6-{timestamp}/report.yaml`.
- `semantic-contract.ts` exports `buildSemanticContractForPage(input)` and minimal-mode helpers used by normalization.
- `schema-normalization.ts` exports `normalizeFormaHomeForV6(home, { mode: "preflight" })` and `readSchemaNormalizationRecoveryState(home)`.
- In Stage 01, calling `normalizeFormaHomeForV6(home, { mode: "cutover" })` returns a stable unsupported-mode error; real cutover is Stage 03.
- `readSchemaNormalizationRecoveryState(home)` never writes files and never constructs runtime services.
- Preflight raw-reads YAML and filesystem state directly; it does not call `createFormaStore`, `ProductService`, `RequirementService`, `DesignService`, or `SyncService`.
- Preflight validates legacy input, candidate v6 shape, candidate manifest hash, strict schema status, semantic contract coverage, and known old-field blockers.
- Reports use `strict_schema_status: "passed" | "failed"` and record candidate validator identity separately from status.
- Recovery state reader scans `.v6-schema-cutover-active`, `.v6-schema-cutover-committed`, and `normalization-backups/v6-*/normalization-journal.yaml`.

- [ ] **Step 1.1: Add semantic contract tests**

In `packages/core/tests/semantic-contract.test.ts`, add failing tests for:

- preserving explicit page `semantic_contract`,
- deriving minimal page contracts only from allowed structured page input,
- marking generated contracts with `semantic_contract_coverage: "minimal"`,
- excluding free-text baseline `fields` and `interactions` from machine contracts,
- detecting field/action key label conflicts with `BASELINE_SEMANTIC_CONTRACT_CONFLICT`.

Run:

```bash
pnpm vitest run packages/core/tests/semantic-contract.test.ts
```

Expected before implementation: tests fail because the semantic contract module does not exist.

- [ ] **Step 1.2: Implement `semantic-contract.ts`**

Create `packages/core/src/semantic-contract.ts` with pure builders:

- `buildSemanticContractForPage(input)`,
- minimal-mode helpers used by normalization for baseline aggregate candidate construction,
- exported types for fields, actions, navigation targets, component keys, allowed copy, coverage, generated source, and conflict details.

Completion standard: builders are deterministic, do not touch the filesystem, and return stable conflict codes/details instead of guessing labels.

- [ ] **Step 1.3: Add schema-normalization report tests**

In `packages/core/tests/schema-normalization.test.ts`, add failing tests for:

- report path `$FORMA_HOME/normalization-preflight/v6-{timestamp}/report.yaml`,
- no runtime YAML writes during preflight,
- old `components_initialized` candidate blocker,
- old `design_id` candidate blocker,
- product/baseline semantic aggregate conflict blocker,
- `strict_schema_status: "passed"` on valid candidate,
- `strict_schema_status: "failed"` on invalid candidate,
- candidate validator identity stored outside `strict_schema_status`,
- deterministic latest report selection from YAML content fields, never filesystem mtime,
- preflight report selection ambiguity,
- journal selection ambiguity and no-runtime-writes recovery state.

Run:

```bash
pnpm vitest run packages/core/tests/schema-normalization.test.ts
```

Expected before implementation: tests fail because normalization helpers are missing.

- [ ] **Step 1.4: Implement normalization contracts and types**

Create `packages/core/src/schema-normalization.ts` with exported types and constants for:

- `normalizeFormaHomeForV6(home, options)`,
- `readSchemaNormalizationRecoveryState(home)`,
- `SchemaNormalizationMode = "normal" | "preflight_only" | "recovery_only"`,
- `SchemaNormalizationStatus = "committed" | "preflight_required" | "recovery_required" | "restored"`,
- `SchemaNormalizationRecoveryState`,
- preflight report structure,
- candidate manifest structure,
- recovery action structure,
- normalizer version string.

Completion standard: exported state shape matches the Stage 01 spec and is reused by later server/MCP limited modes.

- [ ] **Step 1.5: Implement read-only preflight scanner**

Implement `normalizeFormaHomeForV6(home, { mode: "preflight", createdAt })` to:

- raw-read product, requirement, baseline, copy translation, and known design metadata YAML,
- compute `$FORMA_HOME` manifest hash,
- build candidate v6 YAML objects in memory,
- use `semantic-contract.ts` to fill missing contracts where allowed,
- reject old-field and semantic conflict blockers,
- compute candidate manifest hash,
- validate candidate shape with Stage 01 candidate schemas,
- write only the preflight report.

Completion standard: no runtime YAML file is modified and no runtime service is instantiated; `normalizeFormaHomeForV6(home, { mode: "cutover" })` returns the Stage 01 stable unsupported-mode error until Stage 03 replaces it.

- [ ] **Step 1.6: Implement deterministic report selection**

Add helpers:

- `listV6NormalizationPreflightReports(home)`,
- `readLatestV6NormalizationPreflightReport(home)`,
- `readV6NormalizationPreflightReport(home, reportPath)`.

Selection rules:

- parse each candidate `report.yaml` and use YAML content fields, not filesystem mtime,
- require `created_at` to equal the timestamp encoded in `v6-{timestamp}`,
- require `report_dir` and `report_file` to be `$FORMA_HOME` relative and realpath under `$FORMA_HOME/normalization-preflight/`,
- sort by YAML `created_at`, then canonical relative `report_file` only as a deterministic tie-breaker,
- if the latest selectable reports conflict on status, `home_hash`, `candidate_manifest_hash`, or validator identity at the same content timestamp, return `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED` with `preflight_status: "stale"` and `preflight_reason: "report_selection_ambiguous"`,
- explicit report paths must pass the same realpath and YAML self-consistency checks.

Completion standard: latest report selection is deterministic from report YAML content, never mtime; ambiguous latest reports return the Stage 01 stable ambiguity error.

- [ ] **Step 1.7: Implement side-effect-free recovery state reader**

Implement `readSchemaNormalizationRecoveryState(home)`:

- read `.v6-schema-cutover-active`,
- read `.v6-schema-cutover-committed`,
- scan `normalization-preflight/v6-*/report.yaml` through the Stage 01 report selection helpers,
- scan `normalization-backups/v6-*/normalization-journal.yaml`,
- select the latest journal from journal YAML content fields, never filesystem mtime,
- return `normal`, `preflight_only`, or `recovery_only`,
- include `failed_files`, `recovery_actions`, latest report metadata, and marker/journal paths,
- never recover, restore, create, delete, or rewrite files.

Completion standard: active marker or recovery-required journal returns recovery-only; ambiguous journal selection returns `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED` with `restore_status: "journal_selection_ambiguous"`; `created` or `backed_up` journals with no runtime writes return `restore_status: "no_runtime_writes"`; missing committed marker returns preflight-only when required by Stage 01/02 expectations.

- [ ] **Step 1.8: Export Stage 01 modules**

Update `packages/core/src/index.ts` to export `semantic-contract.ts` and `schema-normalization.ts` public types/functions required by Stage 02 and Stage 03.

Completion standard: downstream packages can import recovery-state types without deep internal paths.

- [ ] **Step 1.9: Verify raw reader side effects**

Run:

```bash
pnpm vitest run packages/core/tests/schema-normalization.test.ts
```

Completion standard: a filesystem test proves `readSchemaNormalizationRecoveryState(home)` does not create, modify, or delete files.

- [ ] **Step 1.10: Verify semantic conflict behavior**

Run:

```bash
pnpm vitest run packages/core/tests/semantic-contract.test.ts
```

Completion standard: contract builders preserve explicit semantics, create minimal contracts only where allowed, and return `BASELINE_SEMANTIC_CONTRACT_CONFLICT` for aggregate key/label conflicts.

- [ ] **Step 1.11: Verify Stage 01 does not instantiate runtime services**

Run:

```bash
rg -n "new (ProductService|RequirementService|DesignService|SyncService)|createFormaStore" packages/core/src/schema-normalization.ts
rg -n "writeYamlAtomic" packages/core/src/schema-normalization.ts
```

Completion standard: no service/store instantiation; the only Stage 01 write path is the explicit preflight report.

---

## Task 2: Stage 02 Async Startup Skeleton

**Trace:** `2026-05-21-forma-v6-02-async-startup-design.md`, DESIGN v6 `新数据模型`, `锁与失败恢复`, acceptance IDs 59, 60.

**Files:**
- Modify: `packages/core/src/store.ts`
- Modify: `packages/core/src/schema-normalization.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/routes.ts`
- Modify: `packages/mcp/src/index.ts`
- Modify: `packages/mcp/src/tools.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `scripts/live-style-sync.ts`
- Modify: `scripts/smoke-pencil.ts`
- Modify: `scripts/smoke-pencil-error.ts`
- Test: `packages/core/tests/schema-normalization.test.ts`
- Test: `packages/server/tests/routes.test.ts`
- Test: `packages/mcp/tests/tools.test.ts`
- Test: CLI and script tests that construct stores or servers

**Contracts:**
- `createFormaStore(options)` returns `Promise<FormaStore>`.
- `buildServer(options)` returns `Promise<FormaServer>`.
- Normal mode awaits strict store construction after raw recovery reader returns `mode: "normal"`.
- Preflight-only and recovery-only modes must listen without constructing product, requirement, design, sync, or strict store services.
- Limited-mode error payloads use `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED` or `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED` and include the exact `SchemaNormalizationRecoveryState` in `details`.

- [ ] **Step 2.1: Add failing async-store tests**

Add tests that call `createFormaStore` with a normal home and assert:

- return value is awaited before accessing `products`,
- normal startup does not run preflight/cutover writes,
- raw recovery state is read before service construction.

Run:

```bash
pnpm vitest run packages/core/tests/schema-normalization.test.ts
```

Expected before implementation: tests fail because `createFormaStore` is still synchronous or recovery gates are missing.

- [ ] **Step 2.2: Convert `createFormaStore` to async**

In `packages/core/src/store.ts`, change the factory to:

```typescript
export async function createFormaStore(options: FormaStoreOptions): Promise<FormaStore> {
  const normalization = await readSchemaNormalizationRecoveryState(options.home);
  if (normalization.mode !== "normal") {
    throw new SchemaNormalizationStartupError(normalization);
  }
  // existing service construction remains inside the normal-mode branch
}
```

Completion standard: the thrown normalization startup error preserves the full recovery state and does not construct strict runtime services in limited modes.

- [ ] **Step 2.3: Export explicit store types**

In `packages/core/src/store.ts`, define and export an explicit `FormaStore` interface for the normal-mode store object before the factory, then type the factory as `Promise<FormaStore>`.

Completion standard: `packages/server/src/routes.ts`, `packages/mcp/src/tools.ts`, and tests import `type FormaStore` from core or their package boundary; no production or test code uses `ReturnType<typeof createFormaStore>` as a store type, and no type hides `Promise<FormaStore>` behind a synchronous store.

- [ ] **Step 2.4: Convert server startup to async**

In `packages/server/src/app.ts`, change `buildServer` to async, await `createFormaStore`, and add a limited-mode branch that registers only:

- `GET /api/status`,
- static asset fallback only when `webAssetsDir` is configured and passes existing path checks,
- recovery status and recovery stub routes for recovery-only mode.

Completion standard: `recoverPendingProductDeletesInBackground`, `store.sync.recoverFromCrash()`, and `registerRoutes(app, store)` run only in normal mode.

- [ ] **Step 2.5: Add limited server route helpers**

In `packages/server/src/routes.ts`, add helpers for limited-mode status and normalization 409 responses:

- `registerPreflightOnlyRoutes(app, state)`,
- `registerRecoveryOnlyRoutes(app, state)`,
- shared `sendNormalizationBlocked(reply, state)`.

Completion standard: non-status `/api/*` requests in limited mode cannot reach normal route handlers.

- [ ] **Step 2.6: Convert server entrypoint and callers**

In `packages/server/src/index.ts`, `packages/cli/src/index.ts`, and tests, await `buildServer`.

Run:

```bash
rg "buildServer\\(" packages scripts
```

Completion standard: every executable call site awaits, returns, or explicitly chains the promise.

- [ ] **Step 2.7: Convert MCP startup to limited mode**

In `packages/mcp/src/index.ts`, await `createFormaStore`. If normalization startup throws, create an MCP server with limited tool handlers from `packages/mcp/src/tools.ts`.

Completion standard: normal mode registers full tools after store creation; limited mode registers `fm-status` raw state and blocks all other current Forma tool names with shared normalization details.

- [ ] **Step 2.8: Migrate CLI and scripts**

Update `packages/cli/src/index.ts`, `scripts/live-style-sync.ts`, `scripts/smoke-pencil.ts`, and `scripts/smoke-pencil-error.ts` to await store/server factories.

Run:

```bash
rg "createFormaStore\\(" packages scripts
```

Completion standard: every executable call site awaits, returns, or explicitly chains the promise.

- [ ] **Step 2.9: Add limited-mode tests**

Add server tests for:

- normal startup,
- preflight-only `GET /api/status`,
- preflight-only non-status 409,
- recovery-only `GET /api/status`,
- recovery-only `GET /api/recovery/schema-normalization`,
- recovery-only write stubs returning 409,
- unrelated fatal startup errors still failing startup.

Add MCP tests for:

- normal tool registration,
- limited `fm-status`,
- blocked non-status tools with exact details.

Run:

```bash
pnpm vitest run packages/server/tests packages/mcp/tests packages/core/tests/schema-normalization.test.ts
pnpm typecheck
```

Completion standard: tests and typecheck pass; old runtime behavior remains equivalent in normal mode.

---

## Task 3: Stage 03 Cutover Normalization

**Trace:** `2026-05-21-forma-v6-03-cutover-normalization-design.md`, DESIGN v6 `新数据模型`, `锁与失败恢复`, `回滚策略`, acceptance IDs 53, 57, 59, 60.

**Files:**
- Modify: `packages/core/src/schema-normalization.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/core/tests/schema-normalization.test.ts`
- Test: `packages/server/tests/routes.test.ts`
- Test: CLI tests for `runCli`
- Docs: `docs/MCP.md`
- Docs: `docs/AGENT.md`
- Docs: `README.md`

**Contracts:**
- Dry-run writes only `$FORMA_HOME/normalization-preflight/v6-{timestamp}/report.yaml`.
- Cutover requires a current passing preflight report before backup or runtime YAML writes.
- Backup directory is `$FORMA_HOME/normalization-backups/v6-{timestamp}/`.
- Markers are `$FORMA_HOME/.v6-schema-cutover-active` and `$FORMA_HOME/.v6-schema-cutover-committed`.
- Journal state machine is `created -> backed_up -> writing -> validating -> committed`, with failure transition to `recovery_required` and explicit restore to `restored`.
- Recovery and rollback never read backup directories outside current `$FORMA_HOME`.

- [ ] **Step 3.1: Add CLI command tests**

Add `runCli` tests for:

- `forma schema-normalization-dry-run --home <path>`,
- `forma v6-schema-cutover --home <path>`,
- `forma recover-v6-normalization-journal --home <path> --backup-dir <path>`,
- `forma restore-v6-normalization-backup --home <path> --backup-dir <path> --confirm restore_v6_backup`,
- missing confirm token,
- unknown backup path outside current home.

Expected before implementation: commands are unknown.

- [ ] **Step 3.2: Implement dry-run command**

In `packages/cli/src/index.ts`, add command parsing that calls `normalizeFormaHomeForV6(home, { mode: "preflight" })` from `packages/core/src/schema-normalization.ts`.

Completion standard: command prints report path and exits `0` only when report status is available; dry-run does not rewrite runtime YAML.

- [ ] **Step 3.3: Implement preflight report selection gate**

In `schema-normalization.ts`, implement latest deterministic report selection and explicit report path checks:

- report selection uses the Stage 01 YAML-content helper and never filesystem mtime,
- selected report under `$FORMA_HOME/normalization-preflight/`,
- `status === "passed"`,
- `strict_schema_status === "passed"`,
- matching `normalizer_version`,
- matching `home_hash`,
- matching recomputed `candidate_manifest_hash`.

Completion standard: missing, stale, failed, ambiguous, version-mismatched, home-hash-mismatched, and candidate-manifest-mismatched reports return `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED` with the matching `preflight_status` and `preflight_reason`.

- [ ] **Step 3.4: Implement backup manifest**

Before any runtime YAML write, create backup directory, copy every YAML file that will be rewritten, write `manifest.yaml`, and verify backup hashes.

Completion standard: backup failure aborts before runtime writes and does not create committed marker.

- [ ] **Step 3.5: Implement cutover rewrite**

Raw-read legacy YAML and rewrite only documented fields:

- remove `product.yaml.components_initialized`,
- remove `requirement.yaml.pages[].design_id`,
- remove old page-level design metadata and derived preview/pen path fields,
- add missing page and baseline `semantic_contract`,
- add `semantic_contract_coverage: "minimal"` for normalizer-generated minimal contracts,
- leave page-level `D-*` directories untouched.

Completion standard: rewritten YAML validates under strict candidate schemas; old directories remain as human recovery material.

- [ ] **Step 3.6: Implement journal and markers**

Write `normalization-journal.yaml` after backup manifest exists. Create active marker before runtime writes. Replace active marker with committed marker only after strict validation and `normalization_report.yaml` success.

Completion standard: every `rewritten_files[]` entry has runtime path, backup path, old hash, candidate hash, write status, validation status, restore status, and last error.

- [ ] **Step 3.7: Implement explicit journal recovery**

Export `recoverV6NormalizationJournal(home, backupDir)` from core and wire it to CLI and recovery API.

Completion standard: no-runtime-writes journals can be marked restored; modified YAML restores from manifest; status reads do not trigger recovery.

- [ ] **Step 3.8: Implement explicit backup restore**

Export `restoreV6NormalizationBackup(home, backupDir)` and require confirmation in CLI/API.

Completion standard: current runtime YAML is copied to `rollback-capture/`, old schema smoke check passes, committed marker is deleted only after successful restore, and `normalization_report.yaml.status` becomes `restored`.

- [ ] **Step 3.9: Replace recovery-only stubs with real routes**

In `packages/server/src/routes.ts`, wire:

- `GET /api/recovery/schema-normalization`,
- `POST /api/recovery/schema-normalization/recover-journal`,
- `POST /api/recovery/schema-normalization/restore-backup`.

Completion standard: write routes operate only in recovery-only mode and reject realpath escapes under backup directory.

- [ ] **Step 3.10: Verify cutover and recovery**

Run:

```bash
pnpm vitest run packages/core/tests/schema-normalization.test.ts packages/server/tests/routes.test.ts
pnpm typecheck
```

Completion standard: tests cover dry-run success, no runtime writes, missing/stale/failed report, cutover success, backup failure, strict validation failure, active marker recovery-only mode, journal recovery, restore success, path escape, confirm-token enforcement, and partial restore failure.

---

## Task 4: Stage 04 Legacy Surface Removal

**Trace:** `2026-05-21-forma-v6-04-legacy-surface-removal-design.md`, DESIGN v6 `MCP / Agent 工具调整`, `Web / Server API 调整`, `Agent 模板要求`, acceptance IDs 6, 13, 21, 38, 56.

**Files:**
- Modify: `packages/mcp/src/tools.ts`
- Modify: `packages/mcp/tests/tools.test.ts`
- Modify: `packages/server/src/routes.ts`
- Modify: `packages/server/tests/routes.test.ts`
- Modify: `packages/web/src/api.ts`
- Modify: `packages/web/src/routes.tsx`
- Modify: `packages/web/src/pages/DesignView.tsx`
- Modify: `packages/agent/src/index.ts`
- Delete managed source templates: `packages/agent/templates/claude/fm-refine-design.md`
- Delete managed source templates: `packages/agent/templates/codex/fm-refine-design/SKILL.md`
- Delete managed source templates: `packages/agent/templates/gemini/fm-refine-design.toml`
- Modify: `packages/core/src/install.ts`
- Test: `packages/core/tests/install.test.ts`
- Docs: `docs/MCP.md`, `docs/AGENT.md`, `README.md`

**Contracts:**
- Removed MCP tools are absent from registry and help output.
- Removed agent route `fm-refine-design` is absent from route list, templates, managed manifest, and generated help.
- Removed server routes return default 404, not custom deprecation payloads.
- SPA fallback does not mask old Web design detail route.
- Replacement names may be documented as future/v6 alternatives only when not advertised as already usable before their owning stage.

- [ ] **Step 4.1: Add negative registry tests**

In MCP tests, assert these names are absent from `formaToolNames` and help output:

- `complete_product_init`,
- one-shot `generate_components`,
- `generate_page_design`,
- `save_designs`,
- `generate_and_save_page_design`,
- `rollback_design`,
- `diff_designs`,
- `get_design_annotations`,
- `export_design_asset`.

Expected before removal: tests fail because old names still exist.

- [ ] **Step 4.2: Remove old MCP tools**

In `packages/mcp/src/tools.ts`, delete old tool names, input schemas, descriptions, and handlers for the removed names.

Completion standard: explicit calls to removed names hit the MCP platform's unknown tool behavior and do not enter Forma handlers.

- [ ] **Step 4.3: Remove old server routes**

In `packages/server/src/routes.ts`, remove handlers for:

- `/api/designs/:designId/annotations`,
- `/api/designs/:designId/image`,
- `/api/designs/:designId/image/file`,
- `/api/designs/:designId/history`,
- `/api/designs/:designId/diff`,
- `/api/designs/:designId/export`.

Completion standard: server tests receive default 404 for each old API route.

- [ ] **Step 4.4: Remove old Web route entry**

In `packages/web/src/routes.tsx`, remove `/products/:productId/requirements/:reqId/designs/:designId`.

Completion standard: old route is not matched by SPA route table and cannot render `DesignView`.

- [ ] **Step 4.5: Remove `fm-refine-design` route and managed templates**

In `packages/agent/src/index.ts`, remove `fm-refine-design` from `formaAgentCommands`. Remove the three source template files and update install logic so managed installed targets are deleted on upgrade while non-managed user files remain.

Completion standard: installer tests prove managed cleanup and non-managed preservation.

- [ ] **Step 4.6: Update docs and help**

Update `docs/MCP.md`, `docs/AGENT.md`, and `README.md` so current instructions do not tell users to call removed tools or routes.

Completion standard: old names appear only in removal notes, historical design docs, or negative tests.

- [ ] **Step 4.7: Verify removal boundaries**

Run:

```bash
rg -n "complete_product_init|generate_page_design|generate_and_save_page_design|save_designs|rollback_design|diff_designs|get_design_annotations|export_design_asset|fm-refine-design|/api/designs|designs/:designId" packages docs README.md
pnpm vitest run packages/mcp/tests packages/server/tests packages/core/tests/install.test.ts packages/web/src/routes.test.ts
pnpm typecheck
```

Completion standard: remaining search hits are allowed negative tests, removal notes, or `design-version/` references; tests and typecheck pass.

---

## Task 5: Stage 05 Strict Schema And Read Model

**Trace:** `2026-05-21-forma-v6-05-strict-schema-read-model-design.md`, DESIGN v6 `新数据模型`, `需求级主画布`, `页面状态记录`, `已有主画布识别`, acceptance IDs 7, 12, 13, 15, 38, 53, 54, 57, 61, 62.

**Files:**
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/core/src/store.ts`
- Modify: `packages/core/src/product.ts`
- Modify: `packages/core/src/requirement.ts`
- Modify: `packages/core/src/baseline.ts`
- Modify: `packages/core/src/product-deletion.ts`
- Create: `packages/core/src/components.ts`
- Create: `packages/core/src/requirement-design.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/server/src/routes.ts`
- Modify: `packages/web/src/api.ts`
- Test: `packages/core/tests/foundation.test.ts`
- Test: `packages/core/tests/requirement-baseline.test.ts`
- Test: `packages/core/tests/product-mutation-lock.test.ts`
- Test: new component library and requirement design read-model tests
- Test: `packages/server/tests/routes.test.ts`
- Test: `packages/web/src/api.test.ts`

**Contracts:**
- Normal strict startup requires committed marker and no recovery-required normalization journal.
- Missing committed marker enters preflight-only.
- `product.yaml.components_initialized` is invalid.
- `requirement.yaml.pages[].design_id`, page-level design metadata, page-level `pen_path`, derived page preview path, and missing `semantic_contract` are invalid.
- Baseline pages include derived aggregate `semantic_contract`.
- Component library initialization derives from `$FORMA_HOME/library/{product_id}.components.yaml`, version snapshots, and latest `.lib.pen`.
- Baseline image lookup reads requirement-level `design.yaml` and never scans `D-*`.

- [ ] **Step 5.1: Add strict schema rejection tests**

Add core schema tests for invalid:

- `components_initialized`,
- `design_id`,
- page-level design metadata,
- page-level `pen_path`,
- missing page `semantic_contract`,
- missing baseline `semantic_contract`.

Expected before implementation: old fixtures parse or missing contract is tolerated.

- [ ] **Step 5.2: Enable committed-marker startup gate**

In `packages/core/src/store.ts`, after Stage 02 async migration, require `$FORMA_HOME/.v6-schema-cutover-committed` for normal strict mode.

Completion standard: missing committed marker enters preflight-only without constructing strict services; recovery-required state enters recovery-only.

- [ ] **Step 5.3: Implement product strict schema**

In `packages/core/src/schemas.ts` and `packages/core/src/product.ts`, remove runtime acceptance of `components_initialized`. Keep product rules `given`, `when`, and `then` as human-readable text and add optional `semantic: ProductRuleSemanticInput`.

Completion standard: product config checks no longer depend on a product YAML boolean.

- [ ] **Step 5.4: Implement product component library read model**

Create `packages/core/src/components.ts` with `getProductComponentLibrary(productId)` behavior:

- read `$FORMA_HOME/library/{product_id}.components.yaml`,
- read `$FORMA_HOME/library/{product_id}.versions/{version}.lib.pen`,
- read `$FORMA_HOME/library/{product_id}.lib.pen`,
- validate checksums, relative paths, version number, and component metadata,
- return status `missing`, `complete`, `metadata_missing`, `version_snapshot_missing`, `latest_file_missing`, or `invalid`.

Completion standard: `components: []` is a valid initialized empty library when metadata and files are valid.

- [ ] **Step 5.5: Implement requirement page strict schema**

In `schemas.ts` and `requirement.ts`, require page fields:

- `page_id`,
- `name`,
- `baseline_page`,
- `design_status`,
- `semantic_contract`,
- `semantic_contract_coverage`,
- declared semantic arrays where present,
- human-readable page fields.

Completion standard: persisted old design keys fail schema parsing and are not silently stripped.

- [ ] **Step 5.6: Implement baseline semantic aggregation**

In `baseline.ts` and `requirement.ts`, derive baseline page `semantic_contract` from active source requirement page contracts. During requirement save, detect field/action key label conflicts across source requirements and return `BASELINE_SEMANTIC_CONTRACT_CONFLICT`.

Completion standard: conflicting save fails before partial writes.

- [ ] **Step 5.7: Implement requirement design read model**

In `packages/core/src/requirement-design.ts`, read existing requirement-level:

- `data/{product_id}/{requirement_id}/design.pen`,
- `data/{product_id}/{requirement_id}/design.yaml`,
- `previews/{page_id}@2x.png`,
- `history/...`.

Completion standard: this stage validates existing `design.yaml` when present and never creates or rewrites it.

- [ ] **Step 5.8: Replace baseline preview lookup**

In `baseline.ts`, server route helpers, and Web API types, implement lookup order:

1. read baseline page `source_requirements[]`,
2. load active non-archived requirements,
3. match `baseline_page` and `design_status === "done"`,
4. sort by `updated_at desc`, then `id desc`,
5. read requirement-level `design.yaml`,
6. return first done page with readable `preview_file`.

Completion standard: missing preview returns `BASELINE_IMAGE_NOT_FOUND`; no old preview fallback exists.

- [ ] **Step 5.9: Extend product deletion journal**

In `product-deletion.ts`, add v6 component library path kinds:

- `component_library_latest`,
- `component_library_metadata`,
- `component_library_versions`,
- `component_library_sessions`.

Before deletion journal creation:

- acquire the product mutation lock,
- read `$FORMA_HOME/data/{product_id}/sessions/active-design-session.yaml`,
- validate every lease path realpath under the current `$FORMA_HOME`,
- validate product-level lease and local active file consistency when a lease exists.

Treat these statuses as non-terminal and return `DESIGN_SESSION_ACTIVE` without moving product data or component library files:

- `running`,
- `recoverable`,
- `failed_operation`,
- `failed_commit`,
- `blocked_manual_edit`,
- `commit_recovery_required`.

`DESIGN_SESSION_ACTIVE.details` must include `session_id`, `scope`, `owner_path`, `local_active_path`, `canvas_path`, `staging_path`, and `status`.

Allow terminal active lease cleanup only when:

- `design_session.yaml.status` is `committed` or `discarded`,
- the formal requirement history or component version record contains the audit link,
- product-level lease `session_id` matches the local active file `session_id`,
- all referenced paths remain under current `$FORMA_HOME`.

Return `DESIGN_SESSION_AUDIT_LINK_MISSING` when a terminal session has no audit link. Return `LOCK_CORRUPT` or `DESIGN_COMMIT_RECOVERY_REQUIRED` for malformed leases, path escapes, missing local active files, or `session_id` mismatches according to the detected state. Deletion recovery must restore or clean v6 component library candidates together with product data, report residual v6 component library paths in `recovery_warnings[]`, avoid deleting active session directories, and leave product-level `active-design-session.yaml` untouched unless terminal audited cleanup is proven.

Completion standard: no product data or library file moves before these stable session and audit validations pass.

- [ ] **Step 5.10: Verify strict read model**

Run:

```bash
pnpm vitest run packages/core/tests packages/server/tests/routes.test.ts packages/web/src/api.test.ts
pnpm typecheck
rg -n "components_initialized|design_id|/api/designs|D-\\*" packages/core packages/server packages/web
```

Completion standard: tests pass; remaining old-field matches are only negative tests or removal docs.

---

## Task 6: Stage 06 Pencil Session Orchestration

**Trace:** `2026-05-21-forma-v6-06-pencil-session-orchestration-design.md`, DESIGN v6 `Pencil App 可视化工作流`, `组件库版本策略`, `Pencil App 强制要求`, `受控 Pencil 写操作边界`, `锁与失败恢复`, acceptance IDs 4, 5, 6, 8, 10, 11, 17, 20, 31, 49, 50, 52, 55, 61, 63.

**Files:**
- Create: `packages/core/src/pencil-adapter.ts`
- Create: `packages/core/src/design-session.ts`
- Create: `packages/core/src/component-session.ts`
- Modify: `packages/core/src/pencil.ts`
- Modify: `packages/core/src/product-mutation-lock.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/store.ts`
- Modify: `packages/core/src/sync.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `scripts/live-style-sync.ts`
- Test: `packages/core/tests/pencil.test.ts`
- Test: `packages/core/tests/product-mutation-lock.test.ts`
- Test: `packages/core/tests/product-session-style.test.ts`
- Test: new session and commit journal tests
- Test: startup recovery tests
- Test: `packages/core/tests/sync.test.ts`

**Contracts:**
- `PencilAppSessionAdapter` owns app-bound interactive processes and write operations.
- `PencilReadExportAdapter` performs read/export-only operations and cannot save or mutate committed sources.
- Preflight probe runs before leases, session directories, or staging files are created.
- Begin/apply/commit/discard acquire short transaction locks and release them before returning.
- Locks are product mutation lock and global Pencil lock; process-local locks are not enough.
- Requirement commit substrate accepts only complete candidate sets until Stage 07 supplies public candidate builders.
- Existing headless runtime design generation and style preview write paths become unreachable.

- [x] **Step 6.1: Add adapter probe tests**

Add tests for:

- version/status/help timeout constants,
- desktop preflight success,
- CLI missing returns `PENCIL_CLI_NOT_FOUND`,
- unauthenticated Pencil returns `PENCIL_NOT_AUTHENTICATED`,
- unavailable `pencil interactive --help`, editor schema, controlled save, or desktop capability returns `PENCIL_CAPABILITY_UNAVAILABLE`,
- visible app/open failure returns `PENCIL_APP_REQUIRED`,
- cleanup warning after probe success.

Expected before implementation: adapter module is missing.

- [x] **Step 6.2: Create `pencil-adapter.ts`**

Implement exported timeout constants and two adapters:

- `PencilAppSessionAdapter` starts `pencil interactive --app desktop --in <staging.pen>`, tracks pid, command, version, capabilities, `pencil_binding_id`, and staging realpath.
- `PencilReadExportAdapter` opens committed or staging `.pen` only for validation, scene parsing support, layout checks, screenshots, and export candidates.

Completion standard: read/export adapter rejects any mutation or save operation.

- [x] **Step 6.3: Implement capability probes**

Implement:

- preflight probe before lease/session/staging writes,
- open probe after session-owned staging file exists,
- failed open probe rollback.

Completion standard: preflight failures leave no active leases or session directories and preserve `PENCIL_CLI_NOT_FOUND`, `PENCIL_NOT_AUTHENTICATED`, `PENCIL_CAPABILITY_UNAVAILABLE`, or `PENCIL_APP_REQUIRED` exactly; open failures record failed-begin summaries, execute begin rollback, and return `PENCIL_APP_REQUIRED`.

- [x] **Step 6.4: Implement v6 lock content**

In `product-mutation-lock.ts`, add lock fields:

- `lock_id`,
- `owner_pid`,
- `owner_process_start_time`,
- `hostname`,
- `command`,
- `scope`,
- optional `product_id`,
- optional `session_id`,
- `acquired_at`,
- `expires_at`,
- `heartbeat_at`.

Completion standard: live lock returns `PRODUCT_MUTATION_LOCKED` or `PENCIL_LOCK_HELD`; corrupt lock returns `LOCK_CORRUPT`; release mismatch records `LOCK_RELEASE_MISMATCH`.

- [x] **Step 6.5: Implement requirement session begin**

In `design-session.ts`, implement internal `beginRequirementDesignSession`:

- run Pencil preflight first,
- verify product component library initialized,
- acquire product mutation and Pencil locks,
- create product and local leases,
- create session directory,
- copy formal `design.pen` or create minimal legal empty staging,
- open Pencil App with staging,
- controlled-save staging,
- compute `started_revision`, `last_saved_revision`, and `last_controlled_revision`,
- write `design_session.yaml` with `running`,
- release locks.

Completion standard: begin does not create page frames, embed snapshots, write metadata, set variables, or mutate business content.

- [x] **Step 6.6: Implement product component session begin**

In `component-session.ts`, implement product component begin using `staging.lib.pen`. Enforce required `seed_components[]` for `operation: "generate"` and explicit seed for any newly required component key.

Completion standard: product component sessions share the same lease and lock model as requirement sessions.

- [x] **Step 6.7: Implement apply operations**

Implement `applyRequirementDesignOperations` and `applyProductComponentOperations`:

- controlled save before mutation,
- compare staging hash to `last_controlled_revision`,
- reject caller path-like fields,
- append pending operation log,
- execute allowed Pencil write tool through app adapter,
- controlled save after mutation,
- record `after_revision`,
- update `last_controlled_revision`.

Completion standard: manual changes return `MANUAL_EDIT_DETECTED`, set `blocked_manual_edit`, and block commit.

- [x] **Step 6.8: Implement commit journal substrate**

Implement internal commit substrate for requirement sessions with synthetic candidate tests only:

- validate session `running`,
- controlled-save and revision-check staging,
- verify formal hash against base revision and return `DESIGN_CANVAS_CHANGED` when formal `design.pen` changed since begin,
- reject missing or incomplete candidate set with `INVALID_INPUT`,
- write commit journal,
- promote candidates in fixed order,
- verify formal files,
- write `committed`,
- clear leases.

Completion standard: no public requirement commit path is exposed before Stage 07 supplies complete candidates; synthetic commit tests cover `DESIGN_CANVAS_CHANGED`, restore success, restore failure, orphan journal recovery, and `INVALID_INPUT`.

- [x] **Step 6.9: Implement product component commit**

In `component-session.ts`, validate component metadata, unique component keys, semantic contract hashes, version snapshot, latest library, and `components.yaml`; write through commit journal and restore old files on failure.

Completion standard: failures mark `failed_commit` or `commit_recovery_required` according to recovery outcome.

- [x] **Step 6.10: Implement discard and journal recovery**

Implement discard and `recoverDesignCommitJournal`:

- discard deletes staging file, keeps audit files, and clears matching leases only,
- recovery restores formal files in reverse order,
- orphan journal recovery is supported,
- leases remain when retry or discard is required.

Completion standard: discard never deletes formal `design.pen` or formal component library files.

- [x] **Step 6.11: Implement startup recovery scan**

Add a non-blocking startup recovery scanner in core and call it from server/store startup without preventing Fastify from listening.

The scanner reads only DESIGN v6 listed paths:

- product active design leases,
- requirement index journals,
- requirement active sessions,
- requirement commit journals,
- requirement session files,
- product component active sessions,
- product component commit journals,
- product component session files.

Commit journal scan has priority over session status scan. The scanner must not read page-level `D-*` directories. It must surface recoverable session/journal state through status data and logs, not by auto-restoring formal files during startup.

Completion standard: startup recovery tests prove Fastify can still listen, commit journals are prioritized over session status, recoverable/orphan journal state is reported, and no `D-*` path is scanned.

- [x] **Step 6.12: Remove headless runtime write paths**

In `pencil.ts`, `sync.ts`, and `scripts/live-style-sync.ts`, remove runtime reachability of:

- headless page design generation,
- headless component generation as runtime write surface,
- Pencil-backed style preview generation.

Completion standard: style sync imports style metadata, variables, and `DESIGN.md`; Web preview renders deterministically from variables.

- [x] **Step 6.13: Verify sessions and locks**

Run:

```bash
pnpm vitest run packages/core/tests/pencil.test.ts packages/core/tests/product-mutation-lock.test.ts packages/core/tests/product-session-style.test.ts packages/core/tests/sync.test.ts packages/core/tests
rg -n "\"--prompt\"|previewPencilModel|renderStylePreview|preview@2x\\.png" packages/core/src/sync.ts scripts/live-style-sync.ts
pnpm typecheck
```

Completion standard: adapter, timeout-code, probe, lock, begin/apply/discard, journal recovery, startup recovery, manual edit, process loss, formal canvas changed, synthetic commit, product component commit, and headless-removal tests pass.

---

## Task 7: Stage 07 Core Design Quality Model

**Trace:** `2026-05-21-forma-v6-07-core-design-quality-model-design.md`, DESIGN v6 `需求级主画布`, `通用组件关联模型`, `页面状态记录`, `Design Quality Pipeline`, `Semantic Scope Guard`, acceptance IDs 1, 2, 3, 9, 12, 16, 18, 19, 22-37, 39, 40, 51, 58, 63.

**Files:**
- Create or extend: `packages/core/src/requirement-design.ts`
- Create: `packages/core/src/design-scene.ts`
- Create: `packages/core/src/design-quality.ts`
- Create: `packages/core/src/semantic-scope.ts`
- Create: `packages/core/src/component-usage.ts`
- Modify: `packages/core/src/design-session.ts`
- Modify: `packages/core/src/component-session.ts`
- Modify: `packages/core/src/baseline.ts`
- Modify: `packages/core/src/requirement.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/design.test.ts`
- Test: new frame mapping, index, quality, semantic, component usage, history, rollback, diff, export tests

**Contracts:**
- Requirement-level `design.pen` and `design.yaml` are canonical.
- Page version increments only for changed pages; canvas version increments on each committed session or first successful index.
- Existing main canvas indexing reads only requirement-level `design.pen`.
- Semantic Scope Guard uses backend-derived allowed surface, not agent inference.
- Deterministic quality gates are hard blockers; AI screenshot review is warning metadata only.
- Preview candidates are promoted only by index/commit journals.
- Component refresh has no partial success.

- [x] **Step 7.1: Add frame mapping fixture tests**

Add tests for P-907011/R-c9b123bf-style main canvas mapping:

- metadata page id match,
- normalized frame prefix match,
- normalized name match,
- ambiguous frame returns `PAGE_FRAME_AMBIGUOUS`,
- metadata/name conflict returns `PAGE_FRAME_MISMATCH`,
- missing frame returns `PAGE_FRAME_NOT_FOUND`,
- unmanaged component candidate classification.

Expected before implementation: mapping helpers are missing.

- [x] **Step 7.2: Implement requirement design persistence helpers**

In `requirement-design.ts`, implement path helpers and `design.yaml` model for:

- `design.pen`,
- `design.yaml`,
- current previews,
- canvas history,
- page fragments,
- historical previews.

Completion standard: canonical YAML stores relative paths and revision hashes exclude absolute display paths.

- [x] **Step 7.3: Implement existing main canvas index**

Implement `indexRequirementDesignCanvas`:

- read only requirement-level `design.pen`,
- validate Pencil structure,
- map pages deterministically,
- classify unmanaged components,
- run index-mode quality checks,
- export preview candidates to index staging,
- write `design.yaml`, previews, history, and requirement page statuses through an index journal,
- restore old index state on journal failure.

Completion standard: no page-level `D-*` read or write happens.

- [x] **Step 7.4: Implement unmanaged import adoption**

For first-time user-placed `design.pen`, allow missing Forma metadata while recording:

- page semantic mode `unmanaged_import`,
- `contract_copy`,
- `system_text`,
- `imported_unverified_copy`,
- `UNMANAGED_COPY_UNVERIFIED` warning.

Completion standard: interactions, actions, fields, navigation, and component semantics are not inferred from missing metadata.

- [x] **Step 7.5: Implement import metadata normalization planning**

Implement `planImportMetadataNormalization`:

- read active session staging `.pen`,
- read `semantic_scope.yaml`,
- scan target frame with `resolveInstances: false`,
- return metadata-only `batch_design` operations when semantic nodes map uniquely,
- return `UNMANAGED_METADATA_NORMALIZATION_REQUIRED` with unresolved nodes when not unique,
- invalidate old plans when staging revision changes.

Completion standard: geometry, style, layer order, copy, ref target, and children do not change.

- [x] **Step 7.6: Implement Semantic Scope Guard**

In `semantic-scope.ts`, derive `AllowedSemanticSurface` from requirement, translations, product rules, baseline, component library, current design, and selected language.

Enforce:

- business text matches allowed copy unless decorative,
- action nodes have allowed `action_key`,
- navigation nodes have allowed `navigation_target`,
- field nodes have allowed `field_key`,
- component instances have allowed `component_key`,
- decorative nodes contain no business semantics,
- changed source contract returns `SEMANTIC_SCOPE_CHANGED`.

Completion standard: violation returns `DESIGN_SCOPE_VIOLATION` before preview export or page status advancement.

- [x] **Step 7.7: Implement deterministic quality pipeline**

In `design-quality.ts`, implement hard checks:

- Pencil schema,
- color format,
- property compatibility,
- layout snapshot,
- preview export,
- semantic scope.

Stable hard-blocker codes:

- invalid Pencil schema returns `PENCIL_SCHEMA_INVALID`,
- invalid color format returns `PENCIL_COLOR_INVALID`,
- invalid property type returns `PENCIL_PROPERTY_INVALID`,
- layout failure returns `DESIGN_LAYOUT_INVALID`,
- semantic scope violation returns `DESIGN_SCOPE_VIOLATION`,
- preview candidate export failure returns `PREVIEW_EXPORT_FAILED`.

Before any `generate`, `refine`, `rebuild`, `rollback`, `component_refresh`, or quality repair prompt is accepted, require the active session workflow to load Pencil context through session-scoped wrappers:

- `session_get_editor_state(session_id, include_schema: true)`,
- `session_get_guidelines(session_id, category: "guide", name: "Design System")`,
- the platform guide mapped from the product platform,
- `session_get_guidelines(..., name: "Table")` when structured page metadata marks the page table-heavy,
- `session_get_variables(session_id)`.

Guide loading failure returns `PENCIL_CAPABILITY_UNAVAILABLE` with `failed_phase: "guideline_load"` and `missing_guidelines[]`. It is not a warning and cannot be skipped.

Implement fixed color constraints:

- allowed colors are `$--variable`, `#RRGGBB`, or `#RRGGBBAA`,
- `rgb()`, `rgba()`, `hsl()`, named colors, and CSS shorthand are invalid before repair,
- fill, stroke fill, effect color, text color, and icon color follow the same rule.

Implement fixed property constraints:

- `letterSpacing`, `padding`, `gap`, `cornerRadius`, and similar Pencil schema fields must use schema-accepted scalar/object types,
- array values for scalar fields return `PENCIL_PROPERTY_INVALID`.

Implement report summary:

- any hard blocked check means `blocked`,
- warnings after hard pass mean `warning`,
- clean hard pass means `passed`,
- `ai_visual_review.status: "warning"` writes warning metadata and makes overall status `warning`,
- `ai_visual_review.status: "skipped"` writes `AI_VISUAL_REVIEW_SKIPPED` only for `model_has_no_vision`, `screenshot_failed`, or `timeout`,
- `ai_visual_review.status: "skipped"` with `reason: "not_requested"` does not add a warning and does not change overall status.

Completion standard: hard blockers use the exact stable codes above and forbid commit; skipped AI review with `not_requested` does not add warning.

- [x] **Step 7.8: Implement layout snapshot rules**

Use session-scoped snapshot and batch-get wrappers only. Scan descendants when truncation markers or omitted descendants appear. Enforce limits:

- layout phase total timeout 120 seconds,
- max expanded parent nodes 500,
- max layout nodes 5000.

The quality gate must call `session_snapshot_layout(problemsOnly: false, parentId: frame_id, maxDepth: 8)`. It may use only currently verified Pencil output: layout tree `id`, `x`, `y`, `width`, `height`, `children`, and `session_batch_get` node type, metadata, `clip`, `rotation`, `textGrowth`, ref/component information, and visibility.

The quality gate must not read unprobed `absoluteBounds`, `visibleBounds`, `clipBounds`, `problemCode`, parent id, or layout node type. Future use of those fields requires a probed capability and tests.

Completion standard: incomplete scan, unsupported critical geometry, critical overlap, critical visible area under 95%, decorative overlap over 10%, decorative overlap that cannot prove safe coverage, fixed-size text overflow uncertainty, queue/node limits, and timeout block with `DESIGN_LAYOUT_INVALID`; `quality_report.hard_checks.layout_snapshot_details` records scanned node count, expanded parent count, truncated parent count, elapsed time, fixed limits, and limit hit.

- [x] **Step 7.9: Implement preview export and integrity behavior**

Export preview candidates to session or index staging only. Promote formal previews only through journal promotion. Return:

- `PREVIEW_EXPORT_FAILED` for candidate export failure,
- `PREVIEW_NOT_EXPORTED` for committed data that references missing/unreadable preview.

Completion standard: read paths never regenerate previews.

- [x] **Step 7.10: Implement color repair plan**

Return repair operations for deterministic conversion:

- `rgb(...)` to `#RRGGBB`,
- `rgba(...)` to `#RRGGBBAA`.

Completion standard: quality validation does not write repairs; repairs go through `applyRequirementDesignOperations` with `quality_repair`.

- [x] **Step 7.11: Implement component usage index**

In `component-usage.ts`, scan committed requirement canvas for `metadata.type === "forma"` and `metadata.kind === "component_instance"`, verify ref target in `Components - Snapshot v{version}`, and write linked/unlinked usage records.

Completion standard: detached copy or missing metadata becomes unlinked usage with stable reason.

- [x] **Step 7.12: Implement component refresh planning**

Implement `refreshRequirementComponents` inside active requirement sessions:

- validate current pinned library and target version,
- reject unmapped libraries, unlinked usage, semantic contract changes, override conflicts, and explicit non-done pages,
- produce operations only when entire requested scope can refresh safely,
- use staging snapshot frame before promotion.

Completion standard: no partial success payload; formal `.pen` and `design.yaml` are not directly modified by the planner.

- [x] **Step 7.13: Implement scene payload**

In `design-scene.ts`, derive `RequirementDesignScene` from requirement-level `design.pen` and `design.yaml`:

- canvas metadata,
- page records with preview state,
- structured nodes,
- unsupported properties.

Completion standard: scene payload is not a raw `.pen` dump and not screenshot OCR.

- [x] **Step 7.14: Implement history, rollback, diff, and export core**

Implement:

- `getRequirementDesignHistory`,
- `rollbackRequirementDesign` operation plan,
- `diffRequirementDesignVersions`,
- `exportRequirementDesignAsset`.

Completion standard: rollback returns operations, creates new page/canvas versions on commit, and does not overwrite restored-from versions.

- [x] **Step 7.15: Complete requirement commit candidate builder**

Connect Stage 07 builder to Stage 06 commit substrate:

- require `page_id` and `frame_id` for page operations,
- revision-check staging,
- verify target frame,
- run deterministic quality,
- merge optional AI warning metadata,
- export preview candidate,
- compute next versions,
- write history, `design.yaml`, `design.pen`, and `requirement.yaml` candidates,
- call commit journal substrate in fixed replacement order.

For component refresh, validate every affected page and fail whole commit on any quality or preview failure.

Completion standard: commit without successful deterministic quality report and preview candidate returns `INVALID_INPUT` and does not call journal replacement.

- [x] **Step 7.16: Verify core design model**

Run:

```bash
pnpm vitest run packages/core/tests
pnpm --filter @xenonbyte/forma-core typecheck
```

Completion standard: tests cover frame mapping, index success and recovery, unmanaged import, metadata normalization, Semantic Scope Guard, quality checks, layout limits, preview export, usage index, refresh stable errors, history, rollback, diff, export, and no page-level `D-*` runtime state.

---

## Task 8: Stage 08 MCP Tools

**Trace:** `2026-05-21-forma-v6-08-mcp-tools-design.md`, DESIGN v6 `MCP / Agent 工具调整`, `Session-scoped Pencil wrapper tools`, `受控 Pencil 写操作边界`, acceptance IDs 6, 30, 31, 38, 49, 50, 56.

**Files:**
- Modify: `packages/mcp/src/tools.ts`
- Modify: `packages/mcp/src/index.ts`
- Modify: `packages/mcp/tests/tools.test.ts`
- Docs: `docs/MCP.md`

**Contracts:**
- Register all v6 session, design, component, quality, wrapper, history, diff, export, usage, and refresh tools from Stage 08 spec.
- Removed old tool names remain unregistered.
- Session wrapper inputs require `session_id`, may include `pencil_binding_id`, and reject caller-supplied file/path/output fields.
- Core stable errors propagate without renaming.
- Limited normalization mode keeps only `fm-status` raw status available and blocks other current Forma tools.

- [x] **Step 8.1: Add v6 tool list tests**

Assert `formaToolNames` contains:

- requirement session tools,
- product component session tools,
- canvas/index/scene/history/diff/export tools,
- component usage and refresh tools,
- metadata normalization and quality tools,
- session-scoped Pencil wrappers.

Assert removed old names remain absent.

Expected before implementation: new names are missing.

- [x] **Step 8.2: Define input schemas**

In `packages/mcp/src/tools.ts`, define strict input schemas for each v6 tool. Add a shared forbidden path-field checker for mutation and wrapper payloads.

Lock these schema rules in tests:

- every wrapper rejects `filePath`, `file_path`, `canvas_path`, `staging_path`, `outputDir`, `output_dir`, `path`, `pen_path`, `preview_path`, and `history_path`,
- `begin_requirement_design_session` accepts `operation: "generate" | "refine" | "rebuild" | "rollback" | "component_refresh"` and optional `design_language` / `component_refresh`,
- `apply_requirement_design_operations` accepts only `tool: "batch_design"` and intents `generate`, `refine`, `rebuild`, `rollback`, `component_refresh`, `quality_repair`, and `import_metadata_normalization`,
- `commit_requirement_design_session` enforces page commit versus component refresh result/input unions exactly as DESIGN v6 defines,
- `ai_visual_review` and `ai_visual_reviews[]` are mutually exclusive,
- missing page review inside component refresh is represented as skipped `not_requested` without adding a warning,
- `begin_product_component_session(operation: "generate")` requires `seed_components[]`,
- `begin_product_component_session(operation: "refine" | "change_style")` permits optional `seed_components[]`,
- `plan_import_metadata_normalization` requires `session_id`, `product_id`, `requirement_id`, `page_id`, and `frame_id`, and rejects file paths.

Completion standard: schema tests cover every rule above and every forbidden path field.

- [x] **Step 8.3: Register requirement session tools**

Wire handlers to core services:

- `begin_requirement_design_session`,
- `apply_requirement_design_operations`,
- `commit_requirement_design_session`,
- `discard_requirement_design_session`,
- `recover_design_commit_journal`.

Completion standard: inputs use product, requirement, page, operation, session, and review fields only; no raw paths reach core.

- [x] **Step 8.4: Register product component tools**

Wire:

- `begin_product_component_session`,
- `apply_product_component_operations`,
- `commit_product_component_session`,
- `discard_product_component_session`,
- `get_product_component_library`.

Completion standard: `generate` requires seed components; `refine` and `change_style` preserve explicit component key rules.

- [x] **Step 8.5: Register read/model tools**

Wire:

- `get_requirement_design_canvas`,
- `index_requirement_design_canvas`,
- `get_requirement_design_scene`,
- `get_requirement_design_history`,
- `rollback_requirement_design`,
- `diff_requirement_design_versions`,
- `export_requirement_design_asset`,
- `index_component_usages`,
- `refresh_requirement_components`,
- `plan_import_metadata_normalization`,
- `validate_requirement_design_quality`.

Add `ComponentRefreshScope` schema and stable error behavior:

- scope may be `"all_pages"`,
- or object with `page_ids`,
- or object with `component_keys`,
- or object with both as an intersection,
- empty `page_ids`, empty `component_keys`, missing explicit page, missing component key, and explicit non-done page are invalid,
- stable errors are `COMPONENT_USAGE_UNLINKED`, `COMPONENT_LIBRARY_UNMAPPED`, `COMPONENT_CONTRACT_CHANGED`, `COMPONENT_OVERRIDE_CONFLICT`, and `COMPONENT_REFRESH_PARTIAL_BLOCKED`,
- stable error details include `blocked_pages[]`, `blocked_usages[]`, `candidate_pages[]`, and `scope`, with operations absent.

Completion standard: read/model tools return v6 requirement-level payloads and no old `design_id` keys; component refresh schema and stable error tests cover every valid and invalid scope.

- [x] **Step 8.6: Register session-scoped Pencil wrappers**

Wire:

- `session_get_editor_state`,
- `session_get_guidelines`,
- `session_get_variables`,
- `session_batch_get`,
- `session_snapshot_layout`,
- `session_get_screenshot`,
- `session_export_nodes`.

Completion standard: wrappers validate lease/session ownership and inject staging paths internally.

- [x] **Step 8.7: Preserve limited MCP mode**

Update limited registry so `fm-status` returns raw `SchemaNormalizationRecoveryState`; all other current Forma tools return normalization error with exact `details`.

Completion standard: limited mode does not instantiate strict store or mutation services.

- [x] **Step 8.8: Verify MCP tools**

Run:

```bash
pnpm vitest run packages/mcp/tests/tools.test.ts
pnpm --filter @xenonbyte/forma-mcp typecheck
```

Completion standard: registry, schema rejection, handler dispatch, stable errors, limited mode, and removed-tool negative tests pass.

---

## Task 9: Stage 09 Agent Templates

**Trace:** `2026-05-21-forma-v6-09-agent-templates-design.md`, DESIGN v6 `Agent 模板要求`, `组件库版本策略`, `Semantic Scope Guard`, `Design Quality Pipeline`, acceptance IDs 13, 14, 16, 21, 22, 28, 31, 32, 33, 39, 40, 56, 62.

**Files:**
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/templates/shared/SKILL.md`
- Modify: `packages/agent/templates/codex/fm-design/SKILL.md`
- Modify: `packages/agent/templates/codex/fm-requirement/SKILL.md`
- Modify: `packages/agent/templates/codex/fm-change-style/SKILL.md`
- Modify: `packages/agent/templates/codex/fm-refine-components/SKILL.md`
- Modify: `packages/agent/templates/codex/fm-rollback-design/SKILL.md`
- Modify: `packages/agent/templates/claude/fm-design.md`
- Modify: `packages/agent/templates/claude/fm-requirement.md`
- Modify: `packages/agent/templates/claude/fm-change-style.md`
- Modify: `packages/agent/templates/claude/fm-refine-components.md`
- Modify: `packages/agent/templates/claude/fm-rollback-design.md`
- Modify: `packages/agent/templates/gemini/fm-design.toml`
- Modify: `packages/agent/templates/gemini/fm-requirement.toml`
- Modify: `packages/agent/templates/gemini/fm-change-style.toml`
- Modify: `packages/agent/templates/gemini/fm-refine-components.toml`
- Modify: `packages/agent/templates/gemini/fm-rollback-design.toml`
- Modify: `packages/core/src/install.ts`
- Test: `packages/core/tests/install.test.ts`
- Test: new agent/template snapshot or text checks
- Docs: `docs/AGENT.md`

**Contracts:**
- `fm-design` changes visual design only.
- Any new product capability, page, entry, field, action, navigation, component, or business copy requires `fm-requirement`.
- `generate_components` is an agent macro over product component sessions, not an MCP one-shot write tool.
- `fm-change-style` and `fm-refine-components` update only product component library versions and do not mutate existing requirement canvases.
- `fm-rollback-design` uses requirement-level history and session flow; old `design_id` alone is insufficient.
- Templates must never call raw Pencil write tools or pass file paths into tools.

- [x] **Step 9.1: Add template text checks**

Add tests or snapshot checks that assert:

- old MCP tool names are absent,
- `fm-design` includes `begin_requirement_design_session`, `apply_requirement_design_operations`, `validate_requirement_design_quality`, and `commit_requirement_design_session`,
- `fm-rollback-design` rejects old `design_id`-only context,
- `fm-design` maps semantic coverage blockers to `SEMANTIC_CONTRACT_REQUIRED` with user guidance to run `fm-requirement`,
- `fm-design` maps semantic expansion requests to `REQUIREMENT_UPDATE_REQUIRED`,
- `fm-design` maps `PENCIL_APP_REQUIRED` to a hard stop with no headless fallback request,
- `fm-refine-design` is absent from route lists and manifests.

Expected before update: old templates still reference removed flows.

- [x] **Step 9.2: Update `fm-requirement` templates**

Ensure templates collect:

- pages,
- copy,
- navigation,
- declared fields,
- declared actions,
- declared component keys,
- product rule semantic data.

Completion standard: design agents are not asked to infer semantics from free text.

- [x] **Step 9.3: Rewrite `fm-design` workflow**

Update Codex, Claude, and Gemini `fm-design` templates to:

1. read product and requirement context,
2. call `get_requirement_design_canvas`,
3. handle `index_status` with spec-defined rules,
4. call `get_product_component_library`,
5. run agent macro `generate_components` when required,
6. return `SEMANTIC_CONTRACT_REQUIRED` and instruct the user to run `fm-requirement` when current `semantic_contract_coverage` cannot cover the requested semantic change,
7. reject semantic expansion with `REQUIREMENT_UPDATE_REQUIRED`,
8. show target page/action/component scope/semantic coverage/quality strategy,
9. begin app-bound session,
10. stop on `PENCIL_APP_REQUIRED` without requesting or suggesting a headless fallback,
11. use session-scoped read wrappers,
12. apply operations,
13. validate quality,
14. apply one bounded `quality_repair` retry when provided,
15. commit,
16. report returned formal paths, preview paths, affected pages, quality status, and usage changes.

Completion standard: templates do not use `design_id`, raw paths, `outputDir`, `canvas_path`, or `staging_path`.

- [x] **Step 9.4: Add route-level `generate_components` macro guidance**

In shared and design/component templates, define macro behavior:

- build seed manifest from backend-derived component keys,
- preserve `component_key`,
- set new seed `name` to component key,
- sort `required_by` by requirement id then page id,
- call product component session begin/apply/commit,
- support valid empty `components: []` version.

Completion standard: no one-shot MCP write tool is referenced.

- [x] **Step 9.5: Update component refresh workflow**

Document workflow:

- call `index_component_usages`,
- stop on unlinked usage, missing metadata, unmapped library, contract change, override conflict, or explicit non-done page,
- begin requirement session with `component_refresh`,
- call `refresh_requirement_components`,
- apply returned operations,
- commit with `ai_visual_reviews[]` when available.

Completion standard: component refresh cannot become redesign or add business capability.

- [x] **Step 9.6: Update unmanaged import workflow**

Templates must call `plan_import_metadata_normalization` before visual changes for unmanaged import pages, apply returned metadata-only operations, rerun quality, and stop on stable blockers.

Completion standard: template text does not instruct agents to manually invent metadata mappings.

- [x] **Step 9.7: Update rollback, change-style, and refine-components routes**

Update:

- `fm-rollback-design`: requirement/page/version inputs, history, begin rollback session, rollback plan, apply, commit.
- `fm-change-style`: update product style, run product component session `change_style`, do not mutate existing requirement canvases.
- `fm-refine-components`: run product component session `refine`, do not mutate existing requirement canvases.

Completion standard: `fm-rollback-design` with only old `design_id` returns `REQUIREMENT_DESIGN_CONTEXT_REQUIRED`; current requirement sync is directed to `fm-design component_refresh`.

- [x] **Step 9.8: Remove managed `fm-refine-design` leftovers**

Ensure `packages/agent/src/index.ts`, source templates, help output, and installer managed manifest exclude `fm-refine-design`.

Completion standard: explicit command follows platform unknown command behavior.

- [x] **Step 9.9: Verify agent templates**

Run:

```bash
rg -n "design_id|complete_product_init|rollback_design|canvas_path|staging_path|outputDir|D-\\*|generate_page_design|save_designs|generate_and_save_page_design|fm-refine-design" packages/agent docs/AGENT.md
pnpm vitest run packages/core/tests/install.test.ts
pnpm test
pnpm typecheck
```

Completion standard: remaining matches are allowed negative tests or removal notes; installer/template tests, full tests, and typecheck pass.

---

## Task 10: Stage 10 Server And Web Routes

**Trace:** `2026-05-21-forma-v6-10-server-web-routes-design.md`, DESIGN v6 `Web / Server API 调整`, `后台 UI 调整`, `锁与失败恢复`, acceptance IDs 5, 6, 7, 38, 54, 59, 60.

**Files:**
- Modify: `packages/server/src/routes.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/tests/routes.test.ts`
- Modify: `packages/web/src/api.ts`
- Modify: `packages/web/src/api.test.ts`
- Modify: `packages/web/src/routes.tsx`
- Modify: `packages/web/src/routes.test.ts`
- Modify: `packages/web/src/pages/RequirementDetail.tsx`
- Modify: `packages/web/src/pages/DesignView.tsx`
- Test: `packages/web/src/**/*.test.tsx`

**Contracts:**
- Server exposes requirement-level design read/mutation routes and product component library routes.
- Old design routes are default 404.
- Web API types do not expose `design_id`.
- Mutation routes reject path-like fields.
- Limited modes block normal design/component routes with normalization errors.
- Baseline image route uses requirement-level previews only.

- [x] **Step 10.1: Add server route tests**

Add tests for every route in Stage 10 spec:

- canvas read,
- index,
- scene,
- history,
- preview file,
- export,
- diff,
- active product session,
- active requirement session,
- begin/apply/quality/refresh/metadata-normalization/rollback/commit/discard,
- component library read/begin/apply/commit/discard,
- recover commit journal.

Expected before implementation: routes are missing.

- [x] **Step 10.2: Add forbidden path payload tests**

For mutation routes, assert request bodies with `canvas_path`, `staging_path`, `path`, `outputDir`, `pen_path`, or `preview_path` return `FORBIDDEN_PATH_PARAMETER`.

Completion standard: body/path product and requirement ids are cross-checked and mismatches fail before core calls.

- [x] **Step 10.3: Register requirement-level read routes**

In `packages/server/src/routes.ts`, add GET/POST routes listed in the spec and call core services from `store`.

Completion standard: route params are `productId`, `requirementId`, `pageId`, `sessionId`, `node_id`, and version query fields; no `designId`.

- [x] **Step 10.4: Register requirement-level mutation routes**

Wire begin/apply/quality/refresh/metadata-normalization/rollback/commit/discard routes.

Completion standard: all mutation payloads are path-field checked before core service calls.

- [x] **Step 10.5: Register product component library routes**

Wire component library read, begin, apply, commit, discard, and recover commit journal routes.

Completion standard: routes use product and session ids, not raw library file paths.

- [x] **Step 10.6: Preserve limited server modes**

Ensure preflight-only and recovery-only modes from Stage 02/03 do not register normal product/requirement/design/component mutation routes.

Completion standard: blocked routes return shared normalization details and do not instantiate strict store.

- [x] **Step 10.7: Replace baseline image route behavior**

Update `/api/products/:productId/baseline/pages/:pageId/image` to use the Stage 05 v6 preview lookup.

Completion standard: archived requirements, pending pages, expired pages, and missing previews do not fall back to `D-*`.

- [x] **Step 10.8: Rewrite Web API types and client functions**

In `packages/web/src/api.ts`, define v6 types for:

- semantic contracts,
- requirement pages without `design_id`,
- design canvas,
- design scene,
- design history,
- session begin/apply/quality/commit/discard,
- component library,
- component refresh,
- active session status.

Completion standard: API fixtures and tests contain no public `design_id`.

- [x] **Step 10.9: Change Web routes**

In `packages/web/src/routes.tsx`, route design view as:

```text
/products/:productId/requirements/:reqId/design
```

Use optional query `page_id`. Remove old `/designs/:designId`.

Completion standard: old route returns NotFound in route tests and SPA fallback exclusion still works at server level.

- [x] **Step 10.10: Update RequirementDetail and DesignView data flow**

Requirement detail links pages to the new requirement-level design URL. `DesignView` first calls `design/canvas`; it calls scene only when index state allows:

- `missing`: show index action, no scene call,
- `incomplete`: show index action and blocked/unmatched pages, no scene call unless user acts,
- `recovery_required`: show recovery state, no index or scene call,
- `complete`: call scene,
- `stale`: call scene only when existing `design.yaml` and preview are readable and show stale marker.

Completion standard: render does not trigger write routes automatically.

- [x] **Step 10.11: Verify server and Web route layer**

Run:

```bash
pnpm vitest run packages/server/tests/routes.test.ts packages/web/src/api.test.ts packages/web/src/routes.test.ts packages/web/src
pnpm typecheck
rg -n "design_id|/api/designs|designs/:designId" packages/server packages/web
```

Completion standard: tests and typecheck pass; remaining old-route matches are only negative tests.

---

## Task 11: Stage 11 UI Canvas

**Trace:** `2026-05-21-forma-v6-11-ui-canvas-design.md`, DESIGN v6 `后台 UI 调整`, `后台图谱画布交互模型`, `后台设计页画布渲染模型`, acceptance IDs 5, 41, 42, 43, 44, 45, 46, 47, 48, 52.

**Files:**
- Modify: `packages/web/src/pages/RequirementDetail.tsx`
- Replace: `packages/web/src/pages/DesignView.tsx`
- Create: `packages/web/src/components/DesignSceneCanvas.tsx`
- Create: `packages/web/src/components/DesignSessionPanel.tsx`
- Modify: `packages/web/src/components/PropertyPanel.tsx`
- Modify: `packages/web/src/components/NavigationGraph.tsx`
- Modify: `packages/web/src/i18n.ts`
- Modify: `packages/web/src/api.ts`
- Test: `packages/web/src/pages/RequirementDetail.test.tsx`
- Test: `packages/web/src/pages/DesignView.test.tsx`
- Test: new `DesignSceneCanvas` tests
- Test: `packages/web/src/components/PropertyPanel.test.tsx`
- Test: `packages/web/src/i18n.test.ts`

**Contracts:**
- Main design interaction uses scene payload and Pencil `node_id`, not screenshot overlay.
- Web canvas never edits or saves `.pen` files.
- Real screenshot/preview entry is read-only and never re-exports.
- Unsupported scene properties are visible.
- Canvas and graph interactions have pointer and keyboard alternatives.
- New UI strings are localized through `useT()`.
- Production `AnnotationCanvas` is no longer imported by design runtime.

- [x] **Step 11.1: Add UI tests before component rewrite**

Add tests for:

- scene rendering from `RequirementDesignScene`,
- hit testing by `node_id`,
- click and box selection,
- hover state,
- PropertyPanel content,
- export link URL,
- preview entry state,
- unsupported property display,
- keyboard pan/zoom/reset,
- responsive layout below and above 768px,
- localized labels.

Expected before implementation: tests fail because scene canvas does not exist or old screenshot overlay is still used.

- [x] **Step 11.2: Build `DesignSceneCanvas` with Leafer UI**

Create `packages/web/src/components/DesignSceneCanvas.tsx` using `leafer-ui`. Render supported node features:

- frame,
- rect,
- text,
- image,
- base fill,
- stroke,
- corner radius,
- opacity,
- z-order,
- absolute coordinates,
- supported basic transforms.

Completion standard: hit testing, hover, selection, and box selection bind to `node_id`; screenshot coordinates are not used.

- [x] **Step 11.3: Implement infinite canvas controls**

Add controls for:

- drag pan,
- wheel zoom,
- fit page,
- fit selection,
- 100% zoom,
- reset view,
- page frame location,
- clear selection.

Completion standard: controls have localized tooltips and `aria-label`s; dimensions are stable and do not shift layout.

- [x] **Step 11.4: Add keyboard interactions**

Implement:

- arrow keys pan 48px,
- `Shift + arrow` pans 240px,
- `+` and `-` zoom one step,
- `0` returns to 100%,
- `F` fits selection or current page,
- `Esc` clears selection.

Completion standard: canvas container exposes accessible application region with page, zoom, selected count, and warning summary.

- [x] **Step 11.5: Update `PropertyPanel`**

Show selected node:

- Pencil path,
- `node_id`,
- geometry,
- text,
- image,
- fill/stroke,
- component/ref details,
- usage index details,
- unsupported properties,
- export actions.

Completion standard: multi-select shows spacing measurement from `.pen` coordinates and readable text; export uses requirement-level route.

- [x] **Step 11.6: Implement real screenshot entry**

For each page:

- done page with preview opens current preview URL,
- pending page hides or disables entry,
- expired page opens last exported expired snapshot and marks it expired,
- missing preview shows `PREVIEW_NOT_EXPORTED` details.

Completion standard: opening preview does not re-export, mutate `.pen`, or change page status.

- [x] **Step 11.7: Display unsupported properties and difference classification**

Expose unsupported properties and classify differences as:

- `scene_unsupported_property`,
- `preview_expired`,
- `preview_export_failed`,
- `possible_renderer_bug`.

Completion standard: unsupported-property differences do not change design status.

- [x] **Step 11.8: Update RequirementDetail status surface**

Show:

- main design canvas entry,
- formal `design.pen` display path,
- pinned and latest component library versions,
- active design session state,
- page/operation being drawn,
- elapsed time,
- Pencil process/session status,
- lock owner details,
- latest index result,
- component usage index result,
- component refresh preflight result,
- quality result,
- AI screenshot review status.

Completion standard: buttons with active locks/sessions do not silently do nothing; state is assembled from structured API fields.

- [x] **Step 11.9: Replace `DesignView` runtime**

Use Stage 10 canvas/scene/session APIs. Render usable design workspace as the first screen with page selector, canvas, status, PropertyPanel, quality panel, and screenshot entry.

Completion standard: no landing-page copy and no screenshot overlay runtime entry.

- [x] **Step 11.10: Update NavigationGraph interactions**

Align graph controls with canvas behavior:

- pan,
- zoom,
- fit graph,
- fit selection,
- 100% zoom,
- reset view,
- keyboard alternatives.

Completion standard: graph data remains Forma layout data and does not come from previews or screenshots.

- [x] **Step 11.11: Localize all new UI text**

Add all labels, tooltips, status text, error explanations, and aria strings to `packages/web/src/i18n.ts` for `en` and `zh`.

Completion standard: new components read text through existing translation hook; technical error codes remain literals but are not the only user-facing explanation.

- [x] **Step 11.12: Verify UI canvas**

Run:

```bash
pnpm vitest run packages/web/src
pnpm --filter @xenonbyte/forma-web typecheck
rg -n "AnnotationCanvas|design_id|hardcoded" packages/web/src/pages packages/web/src/components packages/web/src/i18n.ts
pnpm dev:web
```

Completion standard: tests and typecheck pass; production design route does not import `AnnotationCanvas`. After dev server starts, verify desktop and mobile browser screenshots for no overlap and visible nonblank canvas when scene data exists.

---

## Task 12: Stage 12 Final Verification

**Trace:** `2026-05-21-forma-v6-12-verification-design.md`, DESIGN v6 `验收标准`, `当前代码冲突清单`, all acceptance IDs 1 through 63.

**Files:**
- Modify if needed: `docs/MCP.md`
- Modify if needed: `docs/AGENT.md`
- Modify if needed: `README.md`
- Modify if needed: `packages/*/tests/**/*.test.ts`
- Modify if needed: `packages/web/src/**/*.test.tsx`
- Modify if needed: `scripts/**/*.ts`
- Update: `CONTINUITY.md`

**Contracts:**
- Earlier targeted verification does not replace the final gate.
- `pnpm smoke:pencil` is required for release verification on an authenticated desktop environment.
- Any failed required command blocks release readiness.
- Negative scans must prove old public design model is gone from runtime and user-visible current surfaces.

- [x] **Step 12.1: Run verification in spec order**

Run targeted suites in this order:

```bash
pnpm vitest run packages/core/tests/semantic-contract.test.ts packages/core/tests/schema-normalization.test.ts
pnpm vitest run packages/server/tests packages/mcp/tests
pnpm vitest run packages/core/tests
pnpm vitest run packages/mcp/tests/tools.test.ts
pnpm vitest run packages/core/tests/install.test.ts
pnpm vitest run packages/server/tests/routes.test.ts packages/web/src
```

Required evidence checklist, in spec order:

1. Schema normalization and semantic contract tests prove dry-run success, no runtime writes, YAML-content latest report selection with no mtime use, report missing/stale/failed/ambiguous states, journal ambiguity, and no-runtime-writes recovery state.
2. Async startup and limited-mode tests prove every executable `createFormaStore(` and `buildServer(` call is awaited, returned, or explicitly chained; preflight/recovery limited modes listen and do not instantiate strict services.
3. Cutover, recovery, and rollback tests prove cutover success, backup failure, strict schema failure, explicit journal recovery success/failure, rollback success, manifest missing, backup hash mismatch, runtime path escape, partial restore failure, and old schema smoke failure.
4. Legacy surface negative tests prove removed MCP tools, agent command, server routes, Web route, help, docs, and managed templates are absent or only present in allowed negative/historical contexts.
5. Strict schema and read-model tests prove `design_id`, page-level design metadata, page-level `pen_path`, derived preview paths, and `components_initialized` are rejected and no old fallback path remains.
6. Pencil adapter, lock, session, manual edit, and journal tests prove timeout codes/phases, `PENCIL_CLI_NOT_FOUND`, `PENCIL_NOT_AUTHENTICATED`, `PENCIL_CAPABILITY_UNAVAILABLE`, `PENCIL_APP_REQUIRED`, stale/corrupt/live locks, failed-operation retry, formal canvas changed detection, commit journal restore success/failure, orphan journal recovery, and product component rollback.
7. Core design model tests prove the P-907011/R-c9b123bf-style fixture, 25 matched pages, unmanaged component candidate including reusable non-frame node, blocked page quality behavior, unmanaged import unverified copy warning, metadata normalization success/unresolved nodes, Semantic Scope Guard allow/deny cases, quality repair plus second validation, layout limits/incomplete scan, preview candidate export/integrity, linked/unlinked component usage, component refresh stable errors/success, and rollback new page/canvas versions.
8. MCP tests prove registry, strict schemas, forbidden path rejection, AI review mutual exclusion, component refresh scope errors, handler dispatch, stable error propagation, limited mode, and removed-tool unknown behavior.
9. Agent template and installer tests prove v6 session flow, `REQUIREMENT_UPDATE_REQUIRED`, `SEMANTIC_CONTRACT_REQUIRED`, `PENCIL_APP_REQUIRED` no-fallback behavior, `generate_components` macro behavior, `fm-change-style` and `fm-refine-components` no requirement-canvas mutation, `REQUIREMENT_DESIGN_CONTEXT_REQUIRED` for old rollback context, and `fm-refine-design` removal.
10. Server route and Web API tests prove all v6 routes, old route default 404, SPA fallback exclusion, baseline image requirement-level lookup, absence of `design_id`, canvas-before-scene loading, no render-time writes for missing/incomplete/recovery index states, stale readable scene behavior, and structured active-session status.
11. Web UI tests prove scene hit testing by `node_id`, read-only screenshot preview, pan/zoom/fit/reset, keyboard controls, page and node list alternatives, mobile/desktop no-overlap layouts, i18n maps, and no production `AnnotationCanvas` import.
12. Repository gates are reserved for Step 12.2.
13. Live Pencil interactive smoke is reserved for Step 12.3.
14. Negative runtime surface checks are reserved for Step 12.4.

Completion standard: every checklist item has a passing test or deterministic scan receipt; no earlier failure is skipped before later release claims.

Receipt (2026-05-22): all spec-order suites passed:
`pnpm vitest run packages/core/tests/semantic-contract.test.ts packages/core/tests/schema-normalization.test.ts`;
`pnpm vitest run packages/server/tests packages/mcp/tests`;
`pnpm vitest run packages/core/tests`;
`pnpm vitest run packages/mcp/tests/tools.test.ts`;
`pnpm vitest run packages/core/tests/install.test.ts`;
`pnpm vitest run packages/server/tests/routes.test.ts packages/web/src`.

- [x] **Step 12.2: Run workspace gates**

Run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Completion standard: all pass with zero failures.

Receipt (2026-05-22): `pnpm typecheck`, `pnpm test`, and `pnpm build` passed after final Task 12 edits. `pnpm test` passed 45 files / 696 tests.

- [x] **Step 12.3: Run live Pencil smoke**

On a workstation with Pencil CLI on `PATH`, authenticated status, and desktop app capability, run:

```bash
pnpm smoke:pencil
```

Completion standard: smoke passes. If this environment is unavailable, record that v6 is not release verified until this command passes on a suitable workstation.

Receipt (2026-05-22T01:53:32+08:00): `pnpm smoke:pencil` passed after fixing the Pencil interactive adapter to send `tool({...})` function-call syntax and complete on the returned Pencil prompt. Pencil CLI status was Active and the smoke created product `P-d07995`, requirement `R-8e90a89f`, and component session `S-0828dc51a9c832d0`.

- [x] **Step 12.4: Run negative runtime surface checks**

Run:

```bash
rg -n "complete_product_init|generate_page_design|save_designs|generate_and_save_page_design|rollback_design|diff_designs|get_design_annotations|export_design_asset|fm-refine-design|/api/designs|designs/:designId" packages docs README.md
rg -n "design_id|components_initialized|D-\\*" packages/core packages/server packages/mcp packages/web packages/agent
rg -n "\"--prompt\"|previewPencilModel|renderStylePreview|preview@2x\\.png" packages/core/src/sync.ts scripts/live-style-sync.ts
rg "createFormaStore\\(" packages scripts
rg "buildServer\\(" packages scripts
```

Completion standard: old names are absent from runtime/user-visible current surfaces; any remaining matches are documented as negative tests or historical/removal docs.

Receipt (2026-05-22): negative scans found old public design tool/API names only in negative tests/removal tests; `design_id`, `components_initialized`, and `D-*` only in strict rejection/normalization code, old-context rollback errors, and tests; headless preview/sync scan had no hits.

- [x] **Step 12.5: Verify data-model behavior**

Confirm tests prove:

- no runtime write creates page-level `D-*`,
- no runtime read uses page-level `D-*` as design state, preview source, history source, or rollback source,
- strict schemas reject `design_id`,
- strict schemas reject `components_initialized`,
- canonical YAML paths are relative,
- API/MCP absolute paths are display-only.

Additional receipts required:

- `design.yaml`, normalization manifests, journals, and session recovery files store canonical `$FORMA_HOME` relative paths,
- API/MCP absolute paths are labeled display/audit only and are rejected if echoed into mutation payloads,
- no runtime design write path calls old headless `generatePageDesign()` or `generateComponents()` flows,
- no baseline preview, history, rollback, scene, or export code reads page-level `D-*` as authoritative state.

Completion standard: evidence comes from tests or deterministic scans, not manual inspection alone.

Receipt (2026-05-22): deterministic scans confirmed no runtime call sites for old headless `generatePageDesign()` / `generateComponents()` flows, no `designsDir` runtime path remains, and path-bearing API/MCP fields are covered by forbidden-path schemas plus tests.

- [x] **Step 12.6: Review docs and receipts**

Review `README.md`, `docs/MCP.md`, `docs/AGENT.md`, recovery runbooks, and UI screenshots against Stage 12 spec.

Completion standard: docs describe implemented v6 behavior, removed surfaces are not advertised as current commands, and final verification commands plus pass/fail status are recorded.

Receipt (2026-05-22): `README.md`, `docs/AGENT.md`, managed agent templates, and Task 12 receipts were reviewed/updated so current docs describe v6 requirement-level design sessions and no longer advertise removed headless/page-level surfaces as current behavior.

- [x] **Step 12.7: Update continuity ledger**

Update `CONTINUITY.md` with:

- completed stage,
- exact verification commands,
- pass/fail result,
- live Pencil smoke status,
- remaining risk if any.

Completion standard: future agents can continue without reconstructing state from the transcript.

Receipt (2026-05-22): `CONTINUITY.md` records final verification evidence, the live smoke blocker, and remaining release risk.

---

## Final Completion Criteria

- All 12 stage specs are implemented in index order.
- This plan remains traceable to the index spec, each stage spec, and `design-version/DESIGN-v6.md`.
- No PLAN-RULE High or Medium findings remain.
- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- `pnpm smoke:pencil` passes on an authenticated desktop environment before release verification is claimed.
- Negative scans prove old public design surfaces, page-level runtime design state, `design_id`, `components_initialized`, and headless write fallback are gone from runtime/user-visible current surfaces.
- `CONTINUITY.md` records final verification evidence and residual risk.

## PLAN-RULE Self-Audit Checklist

- Source trace is explicit: index spec, stage specs, and DESIGN v6 are named at the top and in every task.
- Scope is not redefined: each task implements its stage spec and defers out-of-scope work to the owning stage.
- Steps are ordered by dependency: normalization, async limited modes, cutover, removal, strict reads, sessions, quality model, MCP, agents, server/Web, UI, verification.
- Files and modules are named for each task.
- Completion standards and verification commands are included for each task.
- Failure, rollback, migration, compatibility, and recovery behavior are stated in the stage tasks that introduce those behaviors.
- Executor does not need to choose product, design, architecture, route, data model, or recovery semantics outside the upstream specs.
