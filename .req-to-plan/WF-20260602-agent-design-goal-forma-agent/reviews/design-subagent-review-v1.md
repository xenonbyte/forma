# DESIGN Checkpoint Review

## Status
pass

## Decision Findings
- Pass: `05-design.md` selects one design direction, "Forma-owned archive handoff pipeline", and describes the archive execution order with asset generation before `archiveRequirement` status commit.
- Pass: rejected options and rationale are sufficient for checkpoint scope. The design rejects icon-only, standalone VZI MCP/server, save-time generation, versioned generated directories, and hard MCP profile isolation for this requirement, with reasons tied to R1 VZI coverage, archive-time finalization, page-level output, and the accepted soft-isolation boundary.
- Pass: user-owned tradeoffs are explicitly captured: soft MCP isolation, dormant renderer integration, and synchronous archive remain aligned with the approved Requirement Brief rather than introduced as new unconfirmed scope.
- No decision blocker found.

## Coverage Findings
- Pass: all Risk Discovery `RISK-DES-001` through `RISK-DES-007` are named in the Design Scope Gate and mapped to design levels and topics.
- Pass: Change Point Inventory covers the expected add/modify/preserve surfaces: core icon extraction, archive orchestration, generated output paths, VZI capture, server archive route, web feedback, MCP tools, export formats, existing MCP/HTTP preservation, vendored VZI packages, and dormant renderer.
- Pass: Requirement Trace covers the core acceptance chain: archive-time icon extraction, VZI capture, archive all-or-nothing, page-level output dirs, VZI icon refs, development MCP archived gate, HTTP/design-tool preservation, manual export, VZI vendor integration, and dormant renderer.
- Pass: Boundary Coverage has stable `DES-BND-001` through `DES-BND-005` IDs and includes responsibility, I/O, data/state, errors, compatibility, migration, rollback, SPEC inputs, and PLAN inputs.
- Pass: Integration Boundaries have stable `DES-INT-001` through `DES-INT-003` IDs for Forma archive to VZI backend packages, Forma MCP to VZI read layer, and Forma workspace to dormant VZI renderer.
- Pass: the specific requested topics are handled: soft MCP isolation is explicit and not described as hard authorization; archive all-or-nothing is status-last; VZI vendor/dependency and renderer dormancy are bounded; VZI/icon resource linking is fail-loud and carried to SPEC/PLAN.
- No requirement scope drift found. Candidate Codex/Gemini template breadth remains non-blocking downstream planning scope, not a design expansion.

## Risk Findings
- Pass: P1 archive atomicity risk is mitigated by two-stage archive orchestration, generation failure before status commit, and archive failure/status semantics handoff.
- Pass: P1 temp output/retry risk is addressed in Failure/Rollback and Verification Strategy with retry replacement, temp publish/cleanup, and stale-output replacement tests carried forward.
- Pass: P1 VZI/icon mismatch risk is addressed through icon manifest consumption, document-order/content-hash matching, assetRef resolution, and fail-loud mismatch behavior.
- Pass: P1 vendored dependency and browser-runtime risks are addressed through package boundaries, dependency alignment, explicit archive failures, build/typecheck checks, and current-doc verification requirements.
- Pass: P1 soft MCP isolation and existing access-boundary risks are handled by gating only new development tools, keeping existing HTTP/design MCP surfaces ungated, and requiring SPEC wording that this is soft isolation rather than hard authorization.
- Pass: P1 SVG safety and external-library-drift risks are recognized and routed through validation/static-safety tests plus authoritative/current documentation verification before implementation.
- Residual risks for downstream stages: SPEC/PLAN must preserve the already-recorded current-doc verification requirement, browser availability/operator error behavior, soft-isolation caveat, and temp-output retry semantics. These are not checkpoint-blocking because the DESIGN routes them explicitly.

## Handoff Findings
- Pass: Spec Inputs use stable `DES-SPEC-001` through `DES-SPEC-010` IDs and cover generated files/metadata, archive failure semantics, VZI capture, development MCP schemas/gate, manual export formats, existing access preservation, web feedback, vendored dependency contract, dormant renderer boundary, and VZI `assetRef` resolution.
- Pass: Plan Inputs use stable `DES-PLAN-001` through `DES-PLAN-013` IDs and cover extractor TDD, archive all-or-nothing tests, storage helper tests, VZI conformance smoke, web feedback checks, MCP handoff tests, manual export tests, access-boundary regression tests, vendored package build/typecheck, dormant renderer import boundary, asset resolution tests, rollback notes, and package-by-package sequencing.
- Pass: Risk Discovery Spec Inputs and Plan Inputs are either directly converted into stable DESIGN handoff IDs or preserved in the DESIGN Verification Strategy / Dependency-Safety sections for PLAN to carry forward.
- No SPEC/PLAN handoff gap requiring DESIGN changes found.

## Recommendation
approve
