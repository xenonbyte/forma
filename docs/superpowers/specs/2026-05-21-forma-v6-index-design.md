# Forma v6 Split Spec Index

## Source Design Scope

- Upstream design: `design-version/DESIGN-v6.md`.
- Governing spec rule: `/Users/xubo/Desktop/SPEC-RULE.md`.
- Scope model: this index is the authoritative map from DESIGN v6 to the split implementation specs in this directory.
- This index does not replace `DESIGN-v6.md`; it records how the design is decomposed into implementation-ready specs.

## Goal

Split DESIGN v6 into ordered, independently plannable specs that can each pass the SPEC rule:

- every requirement traces to DESIGN v6,
- every stage has clear scope and non-scope,
- behavior, inputs, outputs, errors, persistence, and verification are explicit,
- later `superpowers:writing-plans` work can target either this index or one stage spec.

## Non-Goals

- Do not redefine DESIGN v6 decisions.
- Do not add implementation scope beyond DESIGN v6.
- Do not replace the stage specs with a single monolithic plan.
- Do not commit or push documentation changes.

## Spec Set

| Order | Spec file | Primary implementation boundary | Depends on | DESIGN v6 acceptance coverage |
| --- | --- | --- | --- | --- |
| 00 | `2026-05-21-forma-v6-index-design.md` | Index, sequencing, global invariants, coverage map | none | all acceptance items by reference |
| 01 | `2026-05-21-forma-v6-01-preflight-normalization-design.md` | Read-only normalization preflight and semantic contract builder | 00 | 53, 57, 59 |
| 02 | `2026-05-21-forma-v6-02-async-startup-design.md` | Async store/server/MCP startup skeleton and limited modes | 01 | 59, 60 |
| 03 | `2026-05-21-forma-v6-03-cutover-normalization-design.md` | Real v6 schema cutover, backup, journal, recovery, rollback | 02 | 53, 57, 59, 60 |
| 04 | `2026-05-21-forma-v6-04-legacy-surface-removal-design.md` | Removal of old public tools, routes, templates, and docs surface | 03 | 6, 13, 21, 38, 56 |
| 05 | `2026-05-21-forma-v6-05-strict-schema-read-model-design.md` | Strict v6 schemas and read models before write tools | 04 | 7, 12, 13, 15, 38, 53, 54, 57, 61, 62 |
| 06 | `2026-05-21-forma-v6-06-pencil-session-orchestration-design.md` | App-bound Pencil adapters, sessions, locks, commits, recovery | 05 | 4, 5, 6, 8, 10, 11, 17, 20, 31, 49, 50, 52, 55, 61, 63 |
| 07 | `2026-05-21-forma-v6-07-core-design-quality-model-design.md` | Requirement canvas index, scene, history, quality, semantic scope, components | 06 | 1, 2, 3, 9, 12, 16, 18, 19, 22-37, 39, 40, 51, 58, 63 |
| 08 | `2026-05-21-forma-v6-08-mcp-tools-design.md` | v6 MCP tools and session-scoped Pencil wrappers | 07 | 6, 30, 31, 38, 49, 50, 56 |
| 09 | `2026-05-21-forma-v6-09-agent-templates-design.md` | Agent route templates and macro workflows | 08 | 13, 14, 16, 21, 22, 28, 31, 32, 33, 39, 40, 56, 62 |
| 10 | `2026-05-21-forma-v6-10-server-web-routes-design.md` | Requirement-level Server/Web APIs and Web route model | 08 | 5, 6, 7, 38, 54, 59, 60 |
| 11 | `2026-05-21-forma-v6-11-ui-canvas-design.md` | LeaferJS scene canvas, UI state, accessibility, i18n | 10 | 5, 41-48, 52 |
| 12 | `2026-05-21-forma-v6-12-verification-design.md` | Final verification matrix and release gate checks | 01-11 | all acceptance items |

## Global Invariants

- DESIGN v6 replaces the page-level `D-*` design model. Runtime code must not create, read, migrate, or use page-level `D-*` directories as design state.
- `design_id` is not a v6 public or runtime design key. After strict schema cutover, it is invalid in runtime schemas, API payloads, MCP payloads, Web types, and agent prompts.
- All `.pen` writes for product component libraries and requirement designs are app-bound through a visible Pencil App session. No headless drawing fallback is allowed.
- Background/headless Pencil access is read/export only and must not call mutation tools or save modified source files.
- Canonical YAML, manifest, and journal paths store `$FORMA_HOME` relative paths. API and MCP responses may include absolute paths for display only.
- Cross-call concurrency is represented by product-level and local active session lease files, session status, `pencil_binding_id`, staging paths, and revision hashes. Process-local locks are never the only guard.
- `product.yaml.components_initialized` is removed. Product component library initialization is derived from `components.yaml` plus current version snapshots.
- Product-level component libraries are canonical. Requirement canvases pin embedded component snapshots and do not update automatically after product component changes.
- `fm-design` changes visual design only. Any new product capability, page, field, action, navigation, component, or business copy requires `fm-requirement` first.
- AI screenshot review is non-blocking warning metadata. Hard blockers only come from deterministic quality gates and semantic scope checks.
- Preflight/recovery status readers are side-effect-free. Only explicit recovery/cutover commands and recovery APIs may write normalization recovery state.

## Dependency Rules

- Stage specs must be implemented in numeric order unless a later plan proves a change is pure test/documentation work and does not expose runtime surface early.
- A stage may add private helpers for a later stage only when they are not reachable from public MCP, Web, CLI, or agent routes.
- A stage must not leave public behavior in a mixed state where old and v6 design write models are both advertised as available.
- Public surface removal happens before new write tools are registered.
- Strict schema activation happens only after cutover tooling and recovery paths exist.
- New v6 write routes, MCP tools, and agent workflows depend on the session orchestration and core v6 design model.

## Out Of Scope

- This spec set does not add a compatibility layer that converts old page-level `D-*` outputs into v6 runtime state.
- This spec set does not make screenshot/preview files authoritative design sources.
- This spec set does not allow Pencil App unavailability to fall back to background drawing.
- This spec set does not define product features beyond DESIGN v6.

## Acceptance Criteria

- The 12 stage specs and this index exist under `docs/superpowers/specs/`.
- Every stage spec names its upstream DESIGN v6 sections and acceptance IDs.
- Every stage spec names its direct prerequisites and explicit non-scope.
- No stage spec uses unresolved placeholder markers.
- A later implementation plan can target a single stage spec without needing to infer scope from another stage, except for listed prerequisites.
- A total v6 implementation plan can use this index as its top-level dependency map.

## Verification

- Run `rg -n "[T]BD|[T]ODO|[U]NCONFIRMED|\\?\\?\\?" docs/superpowers/specs/2026-05-21-forma-v6-*.md` and resolve all matches unless the match appears in a quoted source rule.
- Run `rg -n "Source Design Scope|Acceptance Criteria|Verification|Out Of Scope" docs/superpowers/specs/2026-05-21-forma-v6-*.md` to confirm each stage has the required sections.
- Review each stage against `/Users/xubo/Desktop/SPEC-RULE.md` before writing implementation plans.
