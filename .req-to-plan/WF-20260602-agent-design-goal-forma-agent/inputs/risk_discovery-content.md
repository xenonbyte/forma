# Risk & Question Discovery: 设计稿切图导出与开发 agent 定稿访问控制

## Upstream References
| Artifact | Reference | Status |
|---|---|---|
| Raw Requirement | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/00-raw-requirement.md` | available |
| Requirement Brief | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/03-requirement-brief.md` | approved |

## Context Coverage
- Level: repository-and-local-source reviewed for requirement/risk purposes; not full implementation design.
- Sources: approved Requirement Brief v1, raw requirement, r2p workflow docs, verified Forma repository path/branch/commit, verified VZI source path/commit, and verified key code/file anchors listed in the Requirement Brief.
- Not inspected in depth: full VZI source internals, current external docs for Sharp/Puppeteer/CanvasKit/msgpackr/RBush/AJV, exact package dependency graph, generated design fixture data, and runtime browser availability across all deployment environments.
- Subagent policy note: multi-agent tooling is available, but current runtime instructions only allow spawning subagents when the user explicitly requests sub-agents/delegation. No subagent was spawned. This artifact uses a main-agent 12-dimension scan and records the limitation for checkpoint review.

## 12-Dimension Scan
| Dimension | Classification | Findings |
|---|---|---|
| Scope | Covered | Scope is broad but stable: archive-time icons, VZI capture, gated development MCP, manual export, web feedback, vendored packages, and templates. Codex/Gemini template inclusion remains a non-blocking planning choice. |
| Acceptance | Covered | Acceptance is verifiable through file outputs, archive status behavior, MCP errors/responses, and regression checks for unaffected HTTP/design tools. |
| Context | Covered with gaps | Local source provenance is confirmed. Exact VZI implementation details and external package APIs need downstream verification. |
| Data | Risk | Archive writes persistent generated files and requirement status; partial output cleanup and crash windows need explicit design and tests. |
| Interfaces | Risk | MCP schemas, export kinds, archive response shape, and generated manifest/VZI metadata need stable contracts. |
| Permissions | Risk | Development MCP gate is soft isolation; non-gated design tools remain available by deployment convention. |
| Dependencies | Risk | Vendored VZI packages add dependency/build/runtime surface, including browser and optional renderer-related dependencies. |
| Compatibility | Risk | Existing artifact version semantics, HTTP preview, MCP design tools, and current export behavior must be preserved. |
| Execution | Risk | Archive becomes slower and can fail on browser/rasterization/dependency issues; operator retry behavior must be clear. |
| Rollback | Risk | Generated files are additive, but archive status commit must not occur before asset generation; rollback/removal order must be documented. |
| Observability | Risk | Failures must be explicit enough for web users and operators to retry or diagnose generation failures. |
| Scale | Risk | Synchronous archive may become expensive for many pages, many SVGs, or heavy VZI capture; current requirement accepts sync UX but needs performance boundaries. |

## Subagent Discovery Findings
| Dimension / Topic | Source | Finding IDs | Evidence |
|---|---|---|---|
| Subagent discovery | Main-agent policy review | N/A | Subagents were not spawned because runtime tool instructions require explicit user request for delegation. |
| Repository/source provenance | Main-agent local inspection | RISK-ASM-001 [ADDRESSED] | Forma repo path, branch, commit, clean status, VZI path, VZI commit, and key file existence were verified before Requirement Brief approval. |
| 12-dimension scan | Main-agent review | RISK-RIS-001 [ADDRESSED] through RISK-PLAN-006 [ADDRESSED] | Requirement Brief downstream attention items were classified into risks, design triggers, spec inputs, and plan inputs below. |

## Blocking Questions
| ID | Question | Why it blocks | Resolve in | Owner | Needed before |
|---|---|---|---|---|---|
| N/A | No requirement-definition blocker found. | Goal, scope, non-scope, acceptance, source provenance, and finalized-design signal are sufficiently defined. | N/A | N/A | N/A |
| N/A | No pre-DESIGN human decision is required. | Remaining unknowns are design/spec/plan questions, not requirement blockers. | DESIGN/SPEC/PLAN | Main agent and implementer | Before downstream checkpoints as applicable |

## Assumptions
| ID | Assumption | Source | Impact if wrong | Conflict status / handling | Carry to |
|---|---|---|---|---|---|
| RISK-ASM-001 [ADDRESSED] | Requirement IDs can be resolved without `product_id` for development MCP handoff tools. | Requirement Brief assumption. | Tool schema may need `product_id` or a lookup helper. | No conflict with requirement; validate feasibility. | DESIGN |
| RISK-ASM-002 [ADDRESSED] | Product design pointers enumerate all final pages that need archive handoff. | Requirement Brief assumption. | Some pages might miss generated assets. | No conflict; must be proven by tests. | DESIGN/SPEC/PLAN |
| RISK-ASM-003 [ADDRESSED] | `active` status is a sufficient archive precondition for stable design pages. | Requirement Brief and raw requirement. | Archive could capture incomplete pages if state semantics differ. | No conflict; confirm state machine behavior. | DESIGN |
| RISK-ASM-004 [ADDRESSED] | Browser/Puppeteer availability can be treated as an archive-time operational dependency. | VZI requirement. | Archive may fail in environments without a compatible browser. | No conflict; make failure observable. | DESIGN/SPEC/PLAN |
| RISK-ASM-005 [ADDRESSED] | Page-level `icons/` and `vzi/` directories will not interfere with version listing or immutable version directories. | Requirement Brief source provenance. | Artifact listing or cleanup could regress. | No conflict; verify with storage tests. | DESIGN/PLAN |
| RISK-ASM-006 [ADDRESSED] | Soft isolation is acceptable for this requirement if development agents are configured with development templates/tools. | Raw requirement and Requirement Brief. | Untrusted or misconfigured agents can bypass the intended gate through non-gated tools. | Known accepted risk; preserve future hard-profile option. | Risk accepted; DESIGN/SPEC note |

## Risks
| ID | Risk | Impact | Likelihood | Priority | Mitigation direction | Carry to |
|---|---|---|---|---|---|---|
| RISK-RIS-001 [ADDRESSED] | Archive status may be committed after incomplete or failed handoff generation if orchestration is wrong. | Development agents receive finalized status without complete assets; retry semantics break. | Medium | P1 | Design a two-stage archive path; commit status only after all page outputs succeed; test injected failures. | DESIGN/SPEC/PLAN |
| RISK-RIS-002 [ADDRESSED] | Crash or exception during temp output replacement leaves stale, partial, or orphaned `icons/`/`vzi/` directories. | Later handoff reads incorrect assets or users cannot retry cleanly. | Medium | P1 | Use temp directories, cleanup, atomic rename, clear retry semantics, and tests for stale replacement. | DESIGN/PLAN |
| RISK-RIS-003 [ADDRESSED] | VZI resource matching by document order can drift from icon extraction order. | VZI `assetRef` points to the wrong icon or fails to link resources. | Medium | P1 | Define matching contract, preserve content-hash verification where possible, fail loudly on mismatch. | DESIGN/SPEC/PLAN |
| RISK-RIS-004 [ADDRESSED] | Vendored VZI dependencies increase install/build/runtime complexity. | Workspace build can fail; CLI/server bundles may accidentally pull renderer/runtime-heavy dependencies. | Medium | P1 | Design package boundaries, dependency inventory, build checks, and dormant renderer import boundaries. | DESIGN/PLAN |
| RISK-RIS-005 [ADDRESSED] | Puppeteer/browser dependency makes archive fail in headless or misconfigured environments. | Product admins cannot archive until environment is fixed. | Medium | P1 | Specify operational dependency, observable error behavior, and smoke checks using project browser setup. | DESIGN/SPEC/PLAN |
| RISK-RIS-006 [ADDRESSED] | Soft MCP isolation may be mistaken for hard authorization. | A development agent with broader tools could access active designs through existing design tools. | Medium | P1 | Document boundary in templates/spec; keep `REQUIREMENT_NOT_FINALIZED` gate on dev tools; preserve future hard profile as out of scope. | SPEC/PLAN |
| RISK-RIS-007 [ADDRESSED] | Manual export formats could be used as an implicit fallback for archive failure. | Operators may produce inconsistent finalized handoff outside archive semantics. | Low | P2 | SPEC must state manual export is debugging/single-artifact export, not archive success substitute. | SPEC |
| RISK-RIS-008 [ADDRESSED] | Synchronous archive may be slow for large requirements or many SVGs. | Web UX may time out or feel stuck. | Medium | P2 | Keep current sync requirement but define feedback, counts, timeout awareness, and future async boundary. | DESIGN/SPEC |
| RISK-RIS-009 [ADDRESSED] | Generated SVG files may carry unsafe markup if extraction bypasses validation. | Security/static-validation regression. | Low | P1 | Ensure generated SVG assets are scanned or generated from validated safe inline markup; test dangerous input rejection. | DESIGN/SPEC/PLAN |
| RISK-RIS-010 [ADDRESSED] | Existing HTTP routes or design MCP tools may be accidentally gated while adding handoff gate. | Design/admin workflows regress. | Low | P1 | SPEC preserve assertions and regression tests for HTTP/design-tool access to active designs. | SPEC/PLAN |
| RISK-RIS-011 [ADDRESSED] | External library behavior assumptions may be stale. | Incorrect raster dimensions, transparency, viewport, or encoding behavior. | Medium | P1 | Verify version-sensitive docs during SPEC/PLAN before implementation. | SPEC/PLAN |

## Discussion Points
| ID | Topic | Options | Decision owner | Needed before |
|---|---|---|---|---|
| RISK-DISC-001 [ADDRESSED] | First implementation slice for agent templates. | Claude only first; include Codex/Gemini now; defer non-Claude templates. | DESIGN/PLAN owner, with user if scope changes. | PLAN task split |
| RISK-DISC-002 [ADDRESSED] | Depth of vendored renderer integration. | Dormant buildable package only; omit renderer until needed; import but isolate strictly. | DESIGN owner. | DESIGN checkpoint |
| RISK-DISC-003 [ADDRESSED] | Archive UX for long synchronous work. | Existing loading state only; counts/toast; richer progress later. | DESIGN/SPEC owner. | SPEC checkpoint |
| RISK-DISC-004 [ADDRESSED] | VZI/icon mismatch handling. | Fail archive on any mismatch; tolerate missing optional asset refs; add diagnostic manifest. | DESIGN owner, constrained by fail-loud requirement. | DESIGN checkpoint |

## Design Triggers
| Design Trigger ID | Source Artifact | Source Item ID | Trigger | Required design topic | Status |
|---|---|---|---|---|---|
| RISK-DES-001 [ADDRESSED] | Requirement Brief | Scope / archive generation | Cross-package archive orchestration touches core, server, storage, and web UX. | Architecture design for archive asset orchestration and transaction boundary. | Open for DESIGN |
| RISK-DES-002 [ADDRESSED] | Requirement Brief | VZI vendor scope | Vendored packages must preserve imports while avoiding unrelated platform services. | Dependency design for workspace package boundaries and excluded VZI packages. | Open for DESIGN |
| RISK-DES-003 [ADDRESSED] | Requirement Brief | VZI resource refs | VZI must point to generated icon assets. | Design for icon manifest shape, matching keys, resource rewrite, and fail-loud validation. | Open for DESIGN |
| RISK-DES-004 [ADDRESSED] | Requirement Brief | MCP handoff | New dev tools must gate archived status while preserving existing design tools. | Interface and permission-boundary design for MCP tool grouping and schemas. | Open for DESIGN |
| RISK-DES-005 [ADDRESSED] | Requirement Brief | Manual export | Export formats `icons` and `vzi` must not undermine archive semantics. | Design for manual export target paths, response semantics, and non-finalized behavior. | Open for DESIGN |
| RISK-DES-006 [ADDRESSED] | Requirement Brief | Renderer dormant | Renderer package inclusion can affect bundle/runtime size. | Dependency/import boundary and build isolation for dormant renderer. | Open for DESIGN |
| RISK-DES-007 [ADDRESSED] | Requirement Brief | Viewport mapping | Product platform maps to a single VZI viewport with observable default. | Design for platform lookup, metadata recording, and default observability. | Open for DESIGN |

## Spec Inputs
| Spec Input ID | Source Artifact | Source Item ID | Item | Required SPEC Contract | Reason | Status |
|---|---|---|---|---|---|---|
| RISK-SPEC-001 [ADDRESSED] | Requirement Brief | Acceptance | Archive generated output contract. | Exact `icons/` file naming, `icons.json` fields, PNG density keys, and `vzi/page.vzi` metadata. | Tests and consumers need stable files. | Open for SPEC |
| RISK-SPEC-002 [ADDRESSED] | Requirement Brief | Acceptance | Archive failure behavior. | Error behavior: any page failure rejects archive and leaves requirement non-archived. | Prevent finalized state without assets. | Open for SPEC |
| RISK-SPEC-003 [ADDRESSED] | Requirement Brief | MCP tools | Development MCP gate and response schemas. | `get_design_handoff`, `get_page_ui`, `get_ui_node`, optional search inputs/outputs and `REQUIREMENT_NOT_FINALIZED`. | Agent consumers need stable API. | Open for SPEC |
| RISK-SPEC-004 [ADDRESSED] | Requirement Brief | Existing access boundary | Preserve HTTP and design MCP access. | Preserve assertions for web/desktop/viewer HTTP paths and existing design tools. | Avoid accidental permission regression. | Open for SPEC |
| RISK-SPEC-005 [ADDRESSED] | Requirement Brief | VZI resource mapping | Asset reference resolution. | VZI resource refs and MCP `assetRef` absolute-path resolution semantics. | Native consumers need correct assets. | Open for SPEC |
| RISK-SPEC-006 [ADDRESSED] | Requirement Brief | External docs | Dependency/API verification. | External documentation inventory for Sharp, Puppeteer, VZI-derived dependencies, and CanvasKit if renderer is included. | Version-sensitive behavior must not be guessed. | Open for SPEC |
| RISK-SPEC-007 [ADDRESSED] | Requirement Brief | Web UX | Archive response shape. | Response fields for `icons:{pages,totalIcons}` and `vzi:{pages,totalElements}` plus error payload expectations. | Web feedback and tests need stable contract. | Open for SPEC |

## Plan Inputs
| Plan Input ID | Source Artifact | Source Item ID | Item | Required PLAN Constraint | Covers | Status |
|---|---|---|---|---|---|---|
| RISK-PLAN-001 [ADDRESSED] | Risks | RISK-RIS-001 [ADDRESSED] | Archive all-or-nothing verification. | Include tests where one page generation fails and status remains non-archived. | Safety/transaction behavior. | Open for PLAN |
| RISK-PLAN-002 [ADDRESSED] | Risks | RISK-RIS-002 [ADDRESSED] | Temp directory and retry verification. | Include idempotent regeneration and stale-output replacement tests. | Rollback/retry behavior. | Open for PLAN |
| RISK-PLAN-003 [ADDRESSED] | Risks | RISK-RIS-003 [ADDRESSED] | VZI/icon linking verification. | Include tests or smoke checks that VZI refs resolve to existing generated icon files. | Resource correctness. | Open for PLAN |
| RISK-PLAN-004 [ADDRESSED] | Risks | RISK-RIS-004 [ADDRESSED] | Workspace build and dependency verification. | Include package build/typecheck and renderer dormant-import verification. | Dependency/migration safety. | Open for PLAN |
| RISK-PLAN-005 [ADDRESSED] | Risks | RISK-RIS-010 [ADDRESSED] | Access-boundary regression tests. | Include tests that existing design tools and HTTP routes remain ungated for active designs. | Compatibility. | Open for PLAN |
| RISK-PLAN-006 [ADDRESSED] | Risks | RISK-RIS-011 [ADDRESSED] | External-doc verification before code. | Include Context7/official-doc checks in SPEC/PLAN execution notes before implementing version-sensitive APIs. | Dependency correctness. | Open for PLAN |
| RISK-PLAN-007 [ADDRESSED] | Requirement Brief | Acceptance | VZI conformance smoke. | Include parse-transform-encode-decode smoke using real Forma design-page HTML with non-zero element bounds. | VZI integration confidence. | Open for PLAN |

## Requirement Brief Downstream Attention Classification
| Requirement Brief item | Classification | Destination |
|---|---|---|
| Archive atomicity, temp cleanup, retry semantics, crash windows | Risk, Design Trigger, Plan Input | RISK-RIS-001 [ADDRESSED], RISK-RIS-002 [ADDRESSED], RISK-DES-001 [ADDRESSED], RISK-PLAN-001 [ADDRESSED], RISK-PLAN-002 [ADDRESSED] |
| Soft MCP isolation permissions/security risk | Risk, Spec Input | RISK-RIS-006 [ADDRESSED], RISK-SPEC-003 [ADDRESSED], RISK-SPEC-004 [ADDRESSED] |
| Core module boundaries | Design Trigger | RISK-DES-001 [ADDRESSED] |
| Vendored VZI workspace integration | Risk, Design Trigger, Plan Input | RISK-RIS-004 [ADDRESSED], RISK-DES-002 [ADDRESSED], RISK-PLAN-004 [ADDRESSED] |
| Dormant renderer and CanvasKit import boundary | Risk, Design Trigger, Plan Input | RISK-RIS-004 [ADDRESSED], RISK-DES-006 [ADDRESSED], RISK-PLAN-004 [ADDRESSED] |
| MCP schemas and response shapes | Spec Input | RISK-SPEC-003 [ADDRESSED] |
| Manifest and VZI metadata | Spec Input | RISK-SPEC-001 [ADDRESSED], RISK-SPEC-005 [ADDRESSED] |
| Source-version, viewport-source, resource-reference metadata | Design Trigger, Spec Input | RISK-DES-007 [ADDRESSED], RISK-SPEC-001 [ADDRESSED], RISK-SPEC-005 [ADDRESSED] |
| One-page failure test | Plan Input | RISK-PLAN-001 [ADDRESSED] |
| VZI conformance smoke | Plan Input | RISK-PLAN-007 [ADDRESSED] |
| Dependency/build verification | Risk, Spec Input, Plan Input | RISK-RIS-004 [ADDRESSED], RISK-SPEC-006 [ADDRESSED], RISK-PLAN-004 [ADDRESSED], RISK-PLAN-006 [ADDRESSED] |
| Documentation or template updates | Spec Input, Plan Input | RISK-SPEC-003 [ADDRESSED], RISK-PLAN-005 [ADDRESSED] |

## Quality Gate
- Status: ready
- Reason: all 12 scan dimensions are represented; no requirement-definition blocker remains; design/approach unknowns are routed to DESIGN; every assumption has source, impact, conflict handling, and carry target; every risk has impact, likelihood, priority, mitigation direction, and carry target; downstream attention items are classified.
- Safe next node: Risk Discovery Checkpoint, then DESIGN entry.
- All 12 scan dimensions appear in this artifact. No `N/A` dimensions were used because the locked tier includes cross-project, dependency, migration, safety, and scope-expanding modifiers.

## Risk Discovery Checkpoint
- Status: approved pending checkpoint decision
- Review Sources: main-agent review of approved Requirement Brief, raw requirement, local source provenance, and r2p risk workflow.
- Required Changes: none identified before checkpoint.
- User Confirmations:
  - DESIGN Entry Authorization: yes, if checkpoint review accepts this artifact.
