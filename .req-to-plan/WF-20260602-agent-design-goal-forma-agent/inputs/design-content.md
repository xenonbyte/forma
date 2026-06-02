# DESIGN: 设计稿切图导出与开发 agent 定稿访问控制

## Upstream References
| Artifact | Reference | Status |
|---|---|---|
| Raw Requirement | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/00-raw-requirement.md` | available |
| Requirement Brief | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/03-requirement-brief.md` | approved |
| Risk & Question Discovery | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/04-risk-discovery.md` | approved |

## Design Level
`standard_design` + `architecture_design` + `migration_design` + `safety_design` + `dependency_design`

## Design Entry Gate
- Status: pass
- Requirement Brief Checkpoint: approved.
- Risk Discovery Checkpoint: approved.
- Missing / Invalid Inputs: none.
- Failure Routing: none.
- Safe next step: Design Scope Gate.

## Design Scope Gate
- Design Levels: `standard_design`, `architecture_design`, `migration_design`, `safety_design`, `dependency_design`.
- Required Design Topics: archive asset orchestration, page-level storage, VZI vendoring, VZI capture, icon/VZI resource linking, MCP handoff/read tools, manual export formats, HTTP/design-tool preservation, web archive feedback, dependency/runtime isolation, failure/retry semantics.
- Source Triggers: RISK-DES-001 [ADDRESSED], RISK-DES-002 [ADDRESSED], RISK-DES-003 [ADDRESSED], RISK-DES-004 [ADDRESSED], RISK-DES-005 [ADDRESSED], RISK-DES-006 [ADDRESSED], RISK-DES-007 [ADDRESSED].
- Trigger-to-Level Mapping:
  - RISK-DES-001 [ADDRESSED] -> architecture_design + safety_design.
  - RISK-DES-002 [ADDRESSED] -> migration_design + dependency_design + architecture_design.
  - RISK-DES-003 [ADDRESSED] -> architecture_design + safety_design.
  - RISK-DES-004 [ADDRESSED] -> architecture_design + dependency_design + safety_design.
  - RISK-DES-005 [ADDRESSED] -> architecture_design + compatibility.
  - RISK-DES-006 [ADDRESSED] -> dependency_design.
  - RISK-DES-007 [ADDRESSED] -> standard_design + dependency_design.
- Safe next step: selected design below.

## Inputs
- Requirement: archive-time generation of icon assets and VZI handoff outputs, with development MCP gate on archived requirements only.
- Risks: all-or-nothing archive semantics, temp output cleanup, VZI/icon mapping correctness, vendored dependency complexity, browser/runtime dependency, soft MCP isolation, manual export semantics, synchronous archive cost, SVG safety, access-boundary compatibility, and external docs drift.
- Confirmed source facts: existing archive HTTP route calls `store.requirements.archiveRequirement`; `archiveRequirement` resolves product and runs a product mutation lock; `archiveRequirementLocked` enforces `status === "active"` and writes archived status; design pointers are available through `listDesignPointers`; artifact version directories are immutable `v{n}` directories; `listArtifactVersions` only matches `^v\d+$`; MCP `export_artifact` currently supports `html`, `svg`, `png`, `zip`; Forma already has `puppeteer@25.1.0`, `sharp`, and `node-html-parser`; VZI source has parser/transformer/format/renderer packages and MCP transformer/read tools.

## Problem
The current archive path commits only requirement state. It does not generate native-consumable design resources, and existing MCP artifact tools expose design artifacts regardless of finalized status. The new capability must add generated handoff artifacts and a finalized development channel without breaking existing design creation/preview flows.

The hard part is not just extracting files. The design must preserve artifact immutability, keep archive status safe under failures, keep VZI resource references aligned with generated icon assets, vendor a cross-project dependency without accidental runtime bloat, and expose a small MCP API that is useful to development agents but does not gate design workflows.

## Goals
- Archive status must never be committed unless all required icon and VZI handoff outputs are generated successfully.
- Generated outputs must live beside artifact version directories and never modify immutable `v{n}` content.
- Icon extraction and VZI capture must be reusable from archive orchestration and manual export paths.
- VZI resources must resolve to generated icon files through a deterministic, fail-loud linking strategy.
- Development MCP tools must provide finalized handoff data only for archived requirements.
- Existing HTTP preview/admin clients and existing MCP design tools must remain unchanged except for additive help/export capabilities.
- Vendored VZI packages must be buildable in the Forma workspace without importing dormant renderer dependencies into server/CLI runtime paths.

## Non-goals
- No async archive job system.
- No platform-specific mobile package generation.
- No unarchive/stale-detection lifecycle.
- No hard runtime MCP profile isolation.
- No `index.html` rewrite.
- No existing artifact manifest schema change.
- No standalone VZI MCP server.

## Context
- Current archive route: `PUT /api/products/:id/requirements/:reqId/archive` verifies mutation origin and ownership, then archives immediately.
- Current archive state transition: `archiveRequirementLocked` rejects non-`active` requirements and writes only requirement YAML.
- Current design pointer source: `ProductService.listDesignPointers(productId)` returns pointers containing `requirementId`, `pageId`, `variant`, `artifactId`, `version`, and `designStatus`.
- Current artifact storage: `getArtifactDir` points to `$productsRoot/<productId>/od-project/artifacts/<artifactId>`; version directories are `v{n}`; the version lister ignores sibling directories that do not match `v\d+`.
- Current MCP surface: tools are centrally listed in `formaToolInputSchemas`, `descriptions`, and `createFormaTools`; `export_artifact` currently picks current/pointer version and writes to `$FORMA_HOME/exports/<productId>/`.
- VZI source: parser exposes `parseAsync` and viewport presets; transformer exposes `VZITransformer`; format exposes `VZIEncoder`/`VZIDecoder`; MCP read layer exposes `MCPTransformer` over `VZIContent`.
- Dependency mismatch to handle: local VZI parser currently declares `puppeteer@24` and `jsdom`; Forma core has `puppeteer@25.1.0`. VZI renderer declares React 18 peers and `canvaskit-wasm`; Forma uses React 19. Therefore renderer must remain build-only/dormant and parser dependency must be aligned.

## Options
| Option | Summary | Benefits | Costs / Risks | Decision |
|---|---|---|---|---|
| Recommended: Forma-owned archive handoff pipeline with vendored VZI backend packages and internal VZI read layer | Add core icon extraction, archive asset orchestration, VZI capture, page-level storage, archive route orchestration, MCP handoff/read tools, and dormant renderer package. | Satisfies all requirements; keeps archive state safe; preserves HTTP/design tools; avoids separate VZI server; makes generated outputs local and testable. | Larger package/dependency surface; needs careful module boundaries and tests. | Selected |
| Minimal: icon export only, no VZI capture | Generate `icons/` on archive and add gated `get_design_handoff` with HTML/icon paths. | Smaller, lower dependency cost. | Fails R1 requirement for element bounds/text/tokens/annotations. | Rejected |
| Separate VZI MCP/server integration | Run or vendor the full VZI MCP server and have Forma point agents to it. | Less read-layer adaptation in Forma. | Violates single-Forma-MCP requirement; adds operational boundary and duplicate auth/gate surface. | Rejected |
| Save-time generation | Generate icons/VZI when design artifacts are saved. | Faster archive later. | Violates archive-time finalized semantics; creates stale-output lifecycle. | Rejected |
| Versioned generated output directories | Write `icons/v{n}/` and `vzi/v{n}/`. | Keeps multiple generated versions. | Superseded by page-level requirement; unnecessary for archived-final state; more cleanup complexity. | Rejected |

## Decision
Select the Forma-owned archive handoff pipeline.

The selected design adds a small archive asset subsystem in `packages/core`, wires it into the server archive route before status commit, vendors selected VZI backend packages into `packages/vzi-*`, and extends Forma MCP with a gated development handoff/read surface. Generated icon and VZI outputs are page-level artifact siblings: `<artifactDir>/icons/` and `<artifactDir>/vzi/page.vzi`.

Archive execution is:

```text
HTTP archive request
  -> ownership and active precheck
  -> exportArchiveAssets(productId, requirementId)
       -> enumerate requirement design pointers
       -> for each page: extract icons to temp + publish icons/
       -> for each page: capture VZI to temp + publish vzi/
       -> fail on any page or mapping error
  -> store.requirements.archiveRequirement(reqId)
  -> return archived requirement plus icons/vzi summary
```

The status commit remains the last step. Existing `archiveRequirementLocked` continues to be the authoritative lock-protected state transition.

## User Decision Gate
| Decision | Options | Recommendation | User Choice | Reason | Impact |
|---|---|---|---|---|---|
| Whether to accept soft MCP isolation for this requirement | Soft template/tool convention; hard runtime MCP profile now | Soft isolation now | Confirmed by requirement | Hard profile is explicitly future work. | SPEC must not describe this as hard authorization. |
| Whether renderer is runtime-connected | Dormant buildable package; no renderer package; runtime UI integration | Dormant buildable package | Confirmed by requirement | User asked to integrate renderer but not connect UI. | Dependency boundary must prove no server/CLI runtime import. |
| Whether archive remains synchronous | Synchronous; async job queue | Synchronous | Confirmed by requirement | User explicitly chose sync UX. | Web UX must show loading/errors; scale risk carried. |

## Rationale
- The selected design is the only option that satisfies both the original icon handoff requirement and the R1 VZI annotation expansion.
- Keeping generation in core and orchestration in the server route preserves one authoritative archive state transition while avoiding a database-like distributed transaction.
- Page-level generated directories match the archived-final lifecycle and avoid modifying immutable version content.
- Vendoring only the needed VZI backend packages and read layer gives Forma control over bug fixes and dependency alignment.
- Exposing VZI through Forma MCP keeps the archived gate in one service and prevents a second MCP server from becoming an ungated bypass.

## Rejected Options
- Icon-only implementation is insufficient because R1 requires element bounds, hierarchy, text, tokens, and annotations.
- Full standalone VZI MCP is rejected because it duplicates the server boundary and does not naturally enforce Forma requirement archive state.
- Save-time generation is rejected because the finalized signal is archive and active designs can change.
- Versioned generated output directories are rejected because archive captures only the final page version and page-level outputs are simpler to retry/consume.
- Hard MCP profile isolation is rejected for this requirement because it is explicitly out of scope; the design preserves a future route to add it.

## Impact
- `packages/core`: add icon extraction, archive asset orchestration, VZI capture, generated-output path helpers, and tests.
- `packages/server`: modify archive route to run archive assets before state commit and return generation summary.
- `packages/web`: update archive success/failure feedback only; no HTTP access gate.
- `packages/mcp`: add schemas/descriptions/handlers for development handoff/page/node/search tools; add export formats; add VZI read-layer code.
- `packages/od-contracts`: extend artifact export kind contract for `icons` and `vzi`.
- `packages/agent`: add/update development template guidance.
- `packages/vzi-*`: add vendored VZI packages with dependency alignment and build scripts.
- Existing artifact storage: preserve immutable `v{n}` directories and version listing behavior.
- Existing design tools and HTTP routes: preserve behavior.

## Change Point Inventory
| Area | Current State | Change Type | Target State | Reason | Spec Input | Plan Input |
|---|---|---|---|---|---|---|
| Core icon extraction | Inline SVG stays in HTML. | add | Pure extractor returns SVG/PNG files and icon manifest. | Native/resource handoff. | DES-SPEC-001 [ADDRESSED] | DES-PLAN-001 [ADDRESSED] |
| Core archive asset orchestration | Archive does not generate assets. | add | `exportArchiveAssets` coordinates icons then VZI for all requirement pages. | All-or-nothing generation. | DES-SPEC-002 [ADDRESSED] | DES-PLAN-002 [ADDRESSED] |
| Core generated output paths | Only version dirs and previews are first-class. | add | Safe helpers for `<artifactDir>/icons/` and `<artifactDir>/vzi/page.vzi`. | Page-level outputs. | DES-SPEC-001 [ADDRESSED] | DES-PLAN-003 [ADDRESSED] |
| Core VZI capture | No VZI output. | add | Puppeteer parse -> transform -> encode -> `vzi/page.vzi`. | R1 annotation handoff. | DES-SPEC-003 [ADDRESSED] | DES-PLAN-004 [ADDRESSED] |
| Server archive route | Calls `archiveRequirement` directly. | modify | Precheck active, generate assets, then commit archive. | Prevent archived-without-assets. | DES-SPEC-002 [ADDRESSED] | DES-PLAN-002 [ADDRESSED] |
| Web archive feedback | Existing archive loading state. | modify | Show generated icon/page/element counts and retryable errors. | Operator observability. | DES-SPEC-007 [ADDRESSED] | DES-PLAN-005 [ADDRESSED] |
| MCP tool schemas | No development handoff tools. | add | `get_design_handoff`, `get_page_ui`, `get_ui_node`, optional `search_page_ui`. | Finalized development consumption. | DES-SPEC-004 [ADDRESSED] | DES-PLAN-006 [ADDRESSED] |
| MCP export formats | `html`, `svg`, `png`, `zip`. | modify | Add `icons` and `vzi`. | Manual handoff export/debug. | DES-SPEC-005 [ADDRESSED] | DES-PLAN-007 [ADDRESSED] |
| Existing MCP design tools | Ungated. | preserve | Remain ungated for design workflows. | Requirement says design creation needs active access. | DES-SPEC-006 [ADDRESSED] | DES-PLAN-008 [ADDRESSED] |
| HTTP web/desktop/viewer access | Ungated preview/creation access. | preserve | Remains ungated by archive status. | Requirement explicitly excludes HTTP from dev gate. | DES-SPEC-006 [ADDRESSED] | DES-PLAN-008 [ADDRESSED] |
| VZI vendored packages | External local source only. | add | Workspace packages `packages/vzi-*` with aligned deps. | R1 vendor strategy. | DES-SPEC-008 [ADDRESSED] | DES-PLAN-009 [ADDRESSED] |
| Dormant renderer | Not present in Forma. | add/preserve boundary | Buildable package, no runtime import from server/CLI/MCP handoff path. | Future renderer path without runtime bloat. | DES-SPEC-009 [ADDRESSED] | DES-PLAN-010 [ADDRESSED] |

## Requirement Trace Check
| Requirement / Scope Item | Source | Design Handling | Status | Spec Input | Plan Input |
|---|---|---|---|---|---|
| Archive-time SVG icon extraction | Requirement Brief Acceptance | Core extractor + archive orchestration. | Covered | DES-SPEC-001 [ADDRESSED] | DES-PLAN-001 [ADDRESSED] |
| VZI annotation capture | Requirement Brief Acceptance | Core VZI capture after icon generation. | Covered | DES-SPEC-003 [ADDRESSED] | DES-PLAN-004 [ADDRESSED] |
| All-or-nothing archive | RISK-RIS-001 [ADDRESSED] | Status commit remains last and lock-protected. | Covered | DES-SPEC-002 [ADDRESSED] | DES-PLAN-002 [ADDRESSED] |
| Page-level output dirs | Requirement Brief Constraint | Generated directories are siblings of `v{n}`. | Covered | DES-SPEC-001 [ADDRESSED] | DES-PLAN-003 [ADDRESSED] |
| VZI refs point to icons | RISK-RIS-003 [ADDRESSED] | VZI build consumes icon manifest and fails on mismatch. | Covered | DES-SPEC-010 [ADDRESSED] | DES-PLAN-011 [ADDRESSED] |
| Development MCP archived gate | Requirement Brief Acceptance | New dev tools check requirement status. | Covered | DES-SPEC-004 [ADDRESSED] | DES-PLAN-006 [ADDRESSED] |
| HTTP/design tools unaffected | Requirement Brief Acceptance | Gate applies only to new dev tools. | Covered | DES-SPEC-006 [ADDRESSED] | DES-PLAN-008 [ADDRESSED] |
| Manual export formats | Requirement Brief Scope | Add `icons`/`vzi` export branches; not archive fallback. | Covered | DES-SPEC-005 [ADDRESSED] | DES-PLAN-007 [ADDRESSED] |
| VZI vendor from local fork | Requirement Brief Scope | Add selected workspace packages and internal read layer. | Covered | DES-SPEC-008 [ADDRESSED] | DES-PLAN-009 [ADDRESSED] |
| Renderer dormant | Requirement Brief Scope | Buildable package with no runtime import path. | Covered | DES-SPEC-009 [ADDRESSED] | DES-PLAN-010 [ADDRESSED] |

## Boundary Coverage / Integration Boundary Check
| Boundary ID | Boundary | Current Side | Target Side | Responsibility | Input / Output | Data / State | Errors | Compatibility | Migration | Rollback | Spec Inputs | Plan Inputs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DES-BND-001 [ADDRESSED] | Archive state boundary | HTTP route + requirement service | Archive asset generation + existing `archiveRequirement` | Server orchestrates; requirement service owns state commit. | reqId/productId -> assets summary + archived requirement. | Writes generated files before YAML status update. | Any generation error aborts before status commit. | Existing status validation preserved. | Additive workflow migration. | Remove route orchestration to restore old archive behavior. | DES-SPEC-002 [ADDRESSED] | DES-PLAN-002 [ADDRESSED] |
| DES-BND-002 [ADDRESSED] | Artifact storage boundary | Immutable `v{n}` directories | Generated `icons/` and `vzi/` siblings | Core path helpers own safe paths. | artifactId/version/index.html -> generated sibling dirs. | Metadata records source version. | Path/IO errors fail generation. | `listArtifactVersions` remains `v\d+` only. | No old data migration. | Delete generated dirs or remove generator. | DES-SPEC-001 [ADDRESSED] | DES-PLAN-003 [ADDRESSED] |
| DES-BND-003 [ADDRESSED] | Icon/VZI resource boundary | HTML inline SVG | VZI element resource refs | Icon extractor emits manifest; VZI capture links refs. | HTML document order/content hash -> icon file refs. | No HTML mutation. | Mismatch fails loud. | HTML remains source of truth. | Additive generated data. | Regenerate or delete generated output. | DES-SPEC-010 [ADDRESSED] | DES-PLAN-011 [ADDRESSED] |
| DES-BND-004 [ADDRESSED] | MCP access boundary | Existing broad design tools | New gated dev tools | New tools enforce archived status; old tools preserved. | requirement_id/page_id -> handoff UI data. | Reads generated files; no mutation. | Non-archived -> `REQUIREMENT_NOT_FINALIZED`. | Existing design agent workflows unchanged. | Additive tool migration. | Remove new tools/templates. | DES-SPEC-004 [ADDRESSED], DES-SPEC-006 [ADDRESSED] | DES-PLAN-006 [ADDRESSED], DES-PLAN-008 [ADDRESSED] |
| DES-BND-005 [ADDRESSED] | Dependency/runtime boundary | Forma workspace packages | Vendored VZI packages | Workspace owns build; runtime imports only needed packages. | HTML/VZI buffers -> IR/VZI/MCP JSON. | No production external service. | Dependency/browser errors are explicit. | Existing package builds must still pass. | Vendor source migration. | Remove packages and imports. | DES-SPEC-008 [ADDRESSED], DES-SPEC-009 [ADDRESSED] | DES-PLAN-009 [ADDRESSED], DES-PLAN-010 [ADDRESSED] |

## Integration Boundaries
| Integration Boundary ID | Integration Boundary | Current Project / Module | Target Project / Module | Current Operation | Target Capability | Responsibility Split | Input / Output | Data / State Mapping | Error Handling | Compatibility | Migration | Rollback | Spec Inputs | Plan Inputs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DES-INT-001 [ADDRESSED] | Forma archive -> VZI parser/transformer/format | `packages/core` archive assets | `packages/vzi-parser`, `packages/vzi-transformer`, `packages/vzi-format` | Archive currently writes requirement status only. | Capture `.vzi` from final HTML. | Core owns product/artifact paths; VZI packages own parse/transform/encode. | HTML + viewport + metadata -> `page.vzi`. | Source version, platform, viewport metadata added around VZI content. | Any parse/transform/encode failure fails archive. | No existing archive success semantics change except new precondition. | Additive generated output. | Remove VZI capture call and packages if rolled back. | DES-SPEC-003 [ADDRESSED] | DES-PLAN-004 [ADDRESSED] |
| DES-INT-002 [ADDRESSED] | Forma MCP -> VZI read layer | `packages/mcp` | Vendored MCPTransformer/read schemas | MCP currently reads artifact manifests/bundles. | Read `.vzi` and expose overview/tree/node/search. | Forma MCP owns gate and path resolution; VZI read layer owns VZI-to-JSON projection. | requirement/page/node inputs -> JSON handoff data. | VZI logical refs resolved to absolute generated asset paths in Forma layer. | Missing VZI/assets -> explicit tool error. | Existing tools preserved. | Additive tool migration. | Remove new tools/read layer. | DES-SPEC-004 [ADDRESSED], DES-SPEC-010 [ADDRESSED] | DES-PLAN-006 [ADDRESSED] |
| DES-INT-003 [ADDRESSED] | Forma workspace -> VZI renderer package | Workspace build | `packages/vzi-renderer` | Renderer absent. | Buildable dormant package only. | Renderer owns its build; no server/CLI runtime import. | package source -> dist output. | No product data mapping. | Build failure blocks package integration. | Runtime behavior unchanged. | Additive package migration. | Remove dormant package. | DES-SPEC-009 [ADDRESSED] | DES-PLAN-010 [ADDRESSED] |

## Migration / Compatibility
- Migration strategy: additive migration. No existing artifact data is rewritten. New generated directories are created only during archive/manual export.
- Compatibility: existing `v{n}` directories, manifests, previews, HTTP routes, and design MCP tools remain readable and ungated.
- Package migration: VZI source is vendored into workspace packages with package names preserved. Parser dependency must be adjusted to Forma's Puppeteer version and lightweight sync/JSDOM path removed or made unreachable for Forma use.
- Data migration: none for existing requirements. Previously archived requirements will not have generated outputs unless a later explicit backfill/export path is introduced; this requirement only defines generation at archive/manual export time.
- Behavior compatibility: archive now has additional failure modes before status commit. This is intentional and must be specified.

## Failure / Rollback
- Generation failure before status commit: return error, leave requirement status unchanged, preserve enough diagnostics for retry.
- Failure after generated files publish but before status commit: safe side is non-archived with extra generated files; retry cleans/replaces outputs.
- Status commit failure after generation: existing requirement service snapshot/restore behavior applies to requirement file; generated outputs may remain and are safe to replace.
- Rollback of feature code: remove MCP tools/templates/export formats, remove route orchestration, remove core generators, remove vendored VZI packages. Existing generated `icons/`/`vzi/` directories are additive and can remain unused or be cleaned by a separate operator script if desired.

## Dependency / Safety
- Dependency handling:
  - Keep VZI backend packages as workspace packages.
  - Align parser `puppeteer` with Forma core's `puppeteer@25.1.0`.
  - Remove or isolate lightweight parser dependencies that are not used by the Puppeteer-only path, especially `jsdom` if no longer required.
  - Keep renderer imports out of server/core/MCP runtime paths unless a future requirement connects rendering.
  - Treat Sharp/Puppeteer/VZI behavior as version-sensitive and require current-doc verification in SPEC/PLAN.
- Safety handling:
  - Generated SVG output must be validated or generated from already-safe inline markup.
  - The archived gate is a soft MCP tool gate, not hard authorization; templates/spec must say this plainly.
  - All archive mutation paths must pass existing mutation-origin checks and ownership checks.
  - No remote or production external data mutation is introduced by VZI capture.

## Risk / Attack Gate
| Attack Dimension | Depth | Risk / Failure Mode | Mitigation / Design Response | Verification or SPEC/PLAN Input | Status |
|---|---|---|---|---|---|
| Dependency failure | dependency_design | Puppeteer/Sharp/VZI dependency unavailable or API drift. | Explicit archive failure; docs verification; package build tests; conformance smoke. | DES-SPEC-008 [ADDRESSED], DES-PLAN-009 [ADDRESSED] | Mitigated |
| Scale explosion | architecture_design | Many pages/SVGs make synchronous archive slow. | Keep sync requirement; summarize counts; design clean failure; carry future async as out of scope. | DES-SPEC-007 [ADDRESSED], DES-PLAN-005 [ADDRESSED] | Mitigated |
| Rollback cost | migration_design | Generated dirs and vendored packages add rollback surface. | Additive outputs; status commit last; feature removal order clear. | DES-PLAN-012 [ADDRESSED] | Mitigated |
| Data safety | safety_design | Archived status without assets or unsafe generated SVG. | Two-stage orchestration and SVG validation/static-safety tests. | DES-SPEC-002 [ADDRESSED], DES-PLAN-002 [ADDRESSED] | Mitigated |
| Compatibility | architecture_design | Existing HTTP/design tools accidentally gated or artifact listing regresses. | Gate only new dev tools; page-level sibling dirs; regression tests. | DES-SPEC-006 [ADDRESSED], DES-PLAN-008 [ADDRESSED] | Mitigated |
| Execution safety | safety_design | Agent implementation might modify unrelated package surfaces. | PLAN must split by package boundary and run targeted tests before broad checks. | DES-PLAN-013 [ADDRESSED] | Mitigated |

## Verification Strategy / Test Architecture
- Unit tests for icon extraction: naming, density outputs, `currentColor`, transparent PNG, content-hash dedupe, manifest content, unsafe SVG handling.
- Core orchestration tests: multi-page enumeration, active requirement pointer filtering, temp publish/cleanup, retry replacement, injected one-page failure, source-version metadata.
- VZI capture tests: viewport mapping, parse/transform/encode/decode smoke, non-zero bounds, annotations/tokens present, resource refs resolve to generated icons.
- Server integration tests: archive route precheck, failure leaves status non-archived, success returns archived requirement plus summaries, existing status validation preserved.
- MCP tests: non-archived handoff rejection, archived handoff success, page UI/tree/node/search read behavior, manual `icons`/`vzi` export behavior, existing design tools ungated.
- Web tests or targeted UI checks: archive loading/error/success count display.
- Workspace dependency/build checks: vendored packages build, Forma build/typecheck, renderer dormant import boundary.

## Resolved Blockers
- RISK-RIS-001 [ADDRESSED]: resolved by selected archive orchestration with status commit last.
- RISK-RIS-003 [ADDRESSED]: resolved by VZI capture consuming icon manifest and failing on mismatch.
- RISK-RIS-004 [ADDRESSED]: resolved by vendored package boundary and dependency alignment requirements.
- RISK-RIS-006 [ADDRESSED]: resolved as accepted soft-isolation boundary with explicit SPEC wording.
- RISK-RIS-010 [ADDRESSED]: resolved by gating only new development tools and preserving HTTP/design tool surfaces.

## Remaining Assumptions
| Assumption | Handling |
|---|---|
| Requirement ID without product ID lookup is feasible. | SPEC/DESIGN must define helper lookup or add `product_id` only if feasibility fails and routes upstream. |
| Active status fully implies stable final design pointers. | Confirm in implementation against requirement state machine and tests. |
| VZI parser can be trimmed to Puppeteer path without breaking needed transformer/format behavior. | Validate while vendoring; if not, keep unused dependency only with explicit reason. |
| Real Forma design-page HTML is representative enough for conformance smoke. | PLAN must select or create a fixture that exercises text, layout, inline SVG, and at least one annotation path. |

## Spec Inputs
| Spec Input ID | Source Artifact | Source Item ID | Item | Required SPEC Contract | Reason | Status |
|---|---|---|---|---|---|---|
| DES-SPEC-001 [ADDRESSED] | DESIGN | DES-BND-002 [ADDRESSED] | Generated output files and metadata. | Define `icons/` file naming, `icons.json`, PNG density keys, source version, generated source, and `vzi/page.vzi` metadata. | Consumers/tests need stable files. | Open for SPEC |
| DES-SPEC-002 [ADDRESSED] | DESIGN | DES-BND-001 [ADDRESSED] | Archive failure and status semantics. | Define active precheck, generation failure response, commit ordering, retry semantics, and success response summary. | Prevent archived-without-assets. | Open for SPEC |
| DES-SPEC-003 [ADDRESSED] | DESIGN | DES-INT-001 [ADDRESSED] | VZI capture contract. | Define viewport mapping, metadata fields, annotations/tokens expectations, and decode validity. | Native handoff needs reliable VZI. | Open for SPEC |
| DES-SPEC-004 [ADDRESSED] | DESIGN | DES-BND-004 [ADDRESSED] | Development MCP schemas and gate. | Define tool inputs/outputs, `REQUIREMENT_NOT_FINALIZED`, page/node/search semantics, depth/fields behavior. | Agent consumers need stable API. | Open for SPEC |
| DES-SPEC-005 [ADDRESSED] | DESIGN | Change Point Inventory | Manual export formats. | Define `export_artifact(format=\"icons\"|\"vzi\")` output paths, allowed status/version behavior, and non-fallback semantics. | Debug export must not replace archive. | Open for SPEC |
| DES-SPEC-006 [ADDRESSED] | DESIGN | DES-BND-004 [ADDRESSED] | Preservation of existing access. | Define preserve assertions for HTTP preview/admin routes and existing MCP design tools. | Avoid regressions. | Open for SPEC |
| DES-SPEC-007 [ADDRESSED] | DESIGN | Web archive feedback | Archive route/web response. | Define response counts and error message expectations for web feedback. | Operator observability. | Open for SPEC |
| DES-SPEC-008 [ADDRESSED] | DESIGN | DES-BND-005 [ADDRESSED] | Vendored package dependency contract. | Define package names, dependency alignment, included/excluded VZI source areas, and external docs inventory. | Build/runtime stability. | Open for SPEC |
| DES-SPEC-009 [ADDRESSED] | DESIGN | DES-INT-003 [ADDRESSED] | Dormant renderer boundary. | Define that renderer is buildable but not imported by server/CLI/MCP handoff runtime. | Prevent runtime bloat/conflict. | Open for SPEC |
| DES-SPEC-010 [ADDRESSED] | DESIGN | DES-BND-003 [ADDRESSED] | VZI assetRef resolution. | Define document-order/content-hash matching, fail-loud mismatch behavior, and absolute path resolution in MCP. | Correct native assets. | Open for SPEC |

## Plan Inputs
| Plan Input ID | Source Artifact | Source Item ID | Item | Required PLAN Constraint | Covers | Status |
|---|---|---|---|---|---|---|
| DES-PLAN-001 [ADDRESSED] | DESIGN | Core icon extraction | Build extractor with unit tests first. | TDD for icon extraction before archive wiring. | Icon correctness. | Open for PLAN |
| DES-PLAN-002 [ADDRESSED] | DESIGN | DES-BND-001 [ADDRESSED] | Archive all-or-nothing tests. | Include injected generation failure before success path. | Safety/transaction behavior. | Open for PLAN |
| DES-PLAN-003 [ADDRESSED] | DESIGN | DES-BND-002 [ADDRESSED] | Storage helper tests. | Verify `icons/`/`vzi/` siblings do not affect version listing. | Artifact compatibility. | Open for PLAN |
| DES-PLAN-004 [ADDRESSED] | DESIGN | DES-INT-001 [ADDRESSED] | VZI conformance smoke. | Add parse-transform-encode-decode fixture smoke with non-zero bounds. | VZI confidence. | Open for PLAN |
| DES-PLAN-005 [ADDRESSED] | DESIGN | Web feedback | Web/server response verification. | Test or inspect archive feedback for counts and retryable errors. | Observability. | Open for PLAN |
| DES-PLAN-006 [ADDRESSED] | DESIGN | DES-BND-004 [ADDRESSED] | MCP handoff tests. | Test archived gate, page UI, node read, optional search. | Agent API behavior. | Open for PLAN |
| DES-PLAN-007 [ADDRESSED] | DESIGN | Manual export | Export tests. | Test `icons`/`vzi` manual export without treating it as archive fallback. | Export compatibility. | Open for PLAN |
| DES-PLAN-008 [ADDRESSED] | DESIGN | Preserve access | Regression tests for existing HTTP/design MCP access. | Verify active designs remain available through intended non-dev paths. | Compatibility. | Open for PLAN |
| DES-PLAN-009 [ADDRESSED] | DESIGN | Vendored packages | Workspace build/typecheck verification. | Verify new packages and dependent packages build. | Dependency integration. | Open for PLAN |
| DES-PLAN-010 [ADDRESSED] | DESIGN | Dormant renderer | Runtime import boundary check. | Verify server/CLI/MCP handoff paths do not import renderer/CanvasKit. | Runtime safety. | Open for PLAN |
| DES-PLAN-011 [ADDRESSED] | DESIGN | VZI asset refs | Asset resolution tests. | Assert VZI/MCP asset refs resolve to generated files. | Handoff correctness. | Open for PLAN |
| DES-PLAN-012 [ADDRESSED] | DESIGN | Rollback | Rollback notes in implementation plan. | Document removal order and generated-output safety. | Rollback. | Open for PLAN |
| DES-PLAN-013 [ADDRESSED] | DESIGN | Execution safety | Package-by-package sequencing. | Avoid broad refactors; sequence vendor, core, server, MCP, web, templates. | Safe execution. | Open for PLAN |

## Design Quality Gate
- Status: ready
- No design/approach blocker remains.
- One design direction is selected and rejected options are recorded.
- User-owned decisions are confirmed by the raw requirement and captured above.
- Change Point Inventory is complete at design level.
- Requirement Trace Check maps scope/acceptance/risk inputs to design handling.
- Boundary and Integration Boundary rows have stable IDs and cover responsibility, I/O, data/state, errors, compatibility, migration, rollback, SPEC inputs, and PLAN inputs.
- P1 risks from Risk Discovery have selected mitigations and downstream coverage.
- Spec Inputs and Plan Inputs use stable IDs and shared schemas.
- Requirement scope was not changed.

## DESIGN Checkpoint
- Status: approved pending checkpoint decision
- Review Sources: approved Requirement Brief, approved Risk Discovery, local source inspection, VZI source/package inspection, and design workflow.
- Required Changes: none identified before checkpoint.
- User Confirmations: design choices are traceable to the raw requirement; no extra human design choice is required before SPEC.
- SPEC Authorization: yes, if checkpoint review accepts this artifact.
