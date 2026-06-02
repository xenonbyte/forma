# Requirement Brief: 设计稿切图导出与开发 agent 定稿访问控制

## Upstream References
| Artifact | Reference | Status |
|---|---|---|
| Raw Requirement | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/00-raw-requirement.md` | available |
| Intake Brief | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/01-intake-brief.md` | available |
| Forma repository | `/Users/xubo/x-studio/forma` | available; branch `feat/icon-export-vzi-handoff`; commit `1c7d0f755115462b515800322b690cf94300ae54`; clean at requirement review |
| VZI source repository | `/Users/xubo/x-studio/vzi-core` | available; commit `698942cb7ce824b87e5f86be464a29a3f21c97ac` |

## Goal
Add a finalized-design handoff capability to Forma so that, when a requirement is archived, Forma synchronously generates durable per-page design handoff assets from the requirement's final design pages.

The finalized handoff must include extracted inline SVG icon resources as standalone SVG and PNG assets, VZI element annotation data for each page, and a gated MCP development-consumption channel that only serves archived requirements. Existing HTTP-based creation and preview clients must continue to access non-archived designs without the development gate.

## Background
Forma design artifacts are pure static HTML. Iconography is currently represented as inline `<svg>` elements, commonly using `currentColor`, and no independent SVG/PNG icon files are produced for native Android/iOS consumers.

The existing asset localization path extracts inline `data:` bitmap assets but leaves inline SVG elements inside HTML. That is sufficient for web preview, but it leaves development agents and native app developers without reusable vector or raster icon assets. The user also wants development agents to consume only finalized design work because active design pages can still change. In this product workflow, the finalized signal is requirement archive.

The requirement was later expanded to include VZI-based element annotation capture at archive time. That expansion supersedes the earlier non-scope statements that excluded element-level coordinates and new dependencies.

## Scope
- Generate icon handoff assets from inline SVG elements in final design-page HTML during requirement archive.
- Generate one page-level VZI artifact per final design page during the same archive operation.
- Treat archive as a two-stage operation: first generate all handoff assets successfully; only then commit the requirement status to `archived`.
- Store generated icons and VZI outputs beside each artifact's immutable version directories, without mutating existing `v{n}` directories or `index.html`.
- Provide a development MCP handoff surface that rejects non-archived requirements and returns page directories, VZI paths, and UI tree/node data for archived requirements.
- Preserve existing HTTP-based web, desktop, and viewer behavior for active or draft design creation and preview.
- Preserve existing MCP design-creation tools that need access to non-archived artifacts.
- Provide manual export formats for icon and VZI handoff debugging or single-artifact regeneration through existing MCP export surfaces.
- Vendor the selected VZI backend packages and MCP read-layer logic from the local `vzi-core` source into the Forma workspace, keeping the relevant package names and excluding unrelated platform/Figma services.
- Add focused tests and smoke checks that prove archive atomicity, generated asset completeness, archived-gate behavior, VZI read behavior, and existing creation/preview access boundaries.

## Non-scope
- Do not generate handoff assets at design-save time.
- Do not rewrite saved `index.html`.
- Do not mutate immutable `v{n}` artifact version directories.
- Do not change the existing artifact manifest schema as part of this requirement.
- Do not build platform-specific packages such as Android `VectorDrawable`, Android density-bucket directories, iOS `.xcassets`, Compose code, SwiftUI code, or XML layouts.
- Do not introduce an async queue or background job UX for archive; archive remains synchronous for this requirement.
- Do not implement unarchive/edit-after-archive paths or stale-detection logic.
- Do not add hard runtime MCP profile isolation; development/design tool separation remains soft unless a later requirement changes that.
- Do not make best-effort partial handoff generation acceptable on archive.
- Do not replace HTTP access controls for web, desktop, or viewer clients.
- Do not vendor VZI platform extractors, platform client/contracts, quality lab, or the standalone VZI MCP server shell.
- Do not connect the vendored VZI renderer into runtime UI in this requirement; it may be included as a dormant buildable package only.
- Do not add a separate CLI export command in this requirement.

## Scope Inventory
| Item | Status | Requirement-stage classification |
|---|---|---|
| `packages/core` artifact asset extraction, artifact storage, product pointers, requirement archive state | In Scope | Core persistence and handoff generation live here. |
| `packages/core/src/artifact-asset-pipeline.ts` | Referenced Only | Existing behavior reference for data asset extraction and content hashing. |
| `packages/core/src/artifact-store.ts` and artifact path helpers | In Scope | Generated `icons/` and `vzi/` directories must not violate version immutability. |
| `packages/core/src/product.ts` design pointers | In Scope | Archive handoff must enumerate final pages by requirement and page pointers. |
| `packages/core/src/requirement.ts` archive state | In Scope | Archive status remains the finalized signal and transaction commit point. |
| New core icon extraction and archive handoff orchestration modules | In Scope | Required by the archive-time asset generation capability. |
| New core VZI capture module | In Scope | Required by the archive-time element annotation capability. |
| `packages/server/src/routes.ts` archive HTTP route | In Scope | Archive route must call handoff generation before committing `archived`. |
| `packages/web/src/pages/ProductDetail.tsx` archive UX | In Scope | Archive feedback should surface generated page/icon/element counts and retryable failures. |
| `packages/mcp/src/tools.ts` | In Scope | Development handoff and manual export tools are exposed through Forma MCP. |
| `packages/od-contracts/src/api/artifacts.ts` | In Scope | Export kind contract must include new handoff export formats. |
| `packages/agent/templates/claude/` | In Scope | Development-agent template should steer agents toward gated handoff tools. |
| Codex/Gemini agent templates | Candidate | User called them later/follow-up after Claude first; downstream should decide if included in the same implementation slice. |
| `packages/desktop` and `packages/viewer` | Referenced Only | Their HTTP access must remain unaffected; no direct behavior change required. |
| `packages/web/src/api.ts` | Referenced Only | Confirms web uses HTTP; no requirement to gate this path. |
| `packages/vzi-types`, `packages/vzi-parser`, `packages/vzi-transformer`, `packages/vzi-format`, `packages/vzi-renderer` | In Scope | New vendored workspace packages from `vzi-core`. |
| VZI MCP read-layer transformer/schemas | In Scope | Forma MCP needs VZI-to-JSON read behavior without a separate VZI MCP server. |
| VZI platform/Figma packages | Out of Scope | Forma uses existing HTML artifacts as source for this requirement. |
| CLI `forma export-icons` | Out of Scope | Explicitly future work. |
| Runtime hard MCP profile isolation | Out of Scope | Explicitly future work. |

## Users / Operators
- Design authors and design agents need to keep creating, previewing, self-checking, and restyling non-archived designs.
- Product/admin users archive requirements from the web UI and need a clear success/failure signal.
- Development agents need a single finalized handoff path that refuses active requirements.
- Native mobile developers need standalone SVG and PNG icon assets plus structured layout/annotation data.
- Forma maintainers need deterministic, retryable, testable archive behavior that does not corrupt immutable artifact versions.

## Acceptance
- Archiving an active requirement with final design pages generates per-page `icons/` output containing standalone `.svg`, PNG density outputs for configured densities including `1x`, `2x`, and `3x`, and an `icons.json` manifest that records source version and generation metadata.
- Generated SVG files preserve `currentColor`; generated PNG files are transparent-background rasters and do not inject a contextual foreground color.
- Duplicate inline SVG content is deduplicated by content hash while keeping manifest entries sufficient for page-resource mapping.
- Archiving the same requirement after a failed attempt is retryable and regenerates a clean full output set rather than appending to stale handoff assets.
- Archiving generates a page-level `vzi/page.vzi` output for each final design page, with metadata that records source version, platform, viewport, and whether the viewport came from a product platform mapping or default desktop fallback.
- VZI capture uses the final page HTML and records element-level layout, text, hierarchy, tokens, annotations, and resource references sufficient for the development MCP read tools.
- VZI resource references for inline SVG/image elements resolve through the generated `icons/` files, and archive fails loudly if VZI/resource mapping cannot be made consistently.
- If icon or VZI generation fails for any page, the archive request fails, the requirement remains non-archived, and the failure can be retried.
- If all handoff generation succeeds, the requirement archive status is committed only after generation completes.
- Development MCP `get_design_handoff(requirement_id)` rejects non-archived requirements with a recognizable `REQUIREMENT_NOT_FINALIZED` error.
- Development MCP `get_design_handoff(requirement_id)` returns archived requirement metadata and page handoff directories including `vziPath`, `indexHtmlPath`, and icon counts.
- Development MCP page/node tools return depth-limited UI tree data, token summaries, bounds/text/style/resource references, and annotations from VZI for archived pages.
- Existing MCP design-creation tools remain able to access active design artifacts for design workflows.
- Existing HTTP web, desktop, and viewer routes remain able to access non-archived designs for creation and preview workflows.
- Manual MCP export supports icon handoff and VZI handoff formats for a selected artifact/version without becoming the fallback for archive failure.
- Vendored VZI packages build inside the Forma pnpm workspace, and dormant renderer inclusion does not become an accidental server/CLI runtime dependency.
- Tests or smoke checks cover icon extraction, archive transaction behavior, VZI capture/read behavior, MCP archive gate behavior, and the unaffected HTTP/design-tool access boundary.

## Constraints
- Requirement archive is the finalized-design signal for this requirement.
- Archive-time handoff generation is synchronous.
- Archive must be all-or-nothing from the product-state perspective: no `archived` status may be committed unless all required page handoff assets have been generated successfully.
- Generated handoff assets are page-level outputs under each artifact, not version-subdirectory outputs. Source version is recorded in metadata instead of encoded in the generated directory path.
- `index.html` and existing immutable `v{n}` directories must not be modified.
- The development gate belongs to the new development MCP handoff tools, not to HTTP preview/creation routes.
- Existing design MCP tools are not gated by archive status in this requirement.
- VZI integration is vendored from local source rather than pulled as a tarball dependency.
- VZI parsing for Forma handoff uses the Puppeteer-backed path; lightweight JSDOM/sync parsing is not acceptable for geometry fidelity.
- Product platform maps to a single VZI viewport preset: `mobile` to mobile, `tablet` to tablet, `desktop` and `web` to desktop, unset platform to observable default desktop.
- Failures should be explicit and observable; no silent fallback or best-effort partial output.
- New dependencies introduced by vendored VZI packages must be surfaced to downstream risk/design work, including install/build/runtime impact.
- External library behavior that affects implementation, such as Sharp SVG rasterization and Puppeteer viewport behavior, must be verified from authoritative/current docs during later SPEC/PLAN work before coding against version-specific assumptions.

## Assumptions
| Assumption | Source | Impact if wrong | Conflict status | Carry target |
|---|---|---|---|---|
| Requirement IDs can be resolved globally enough for development MCP tools to omit `product_id`. | Raw requirement references `productIdForRequirement`/`readRequirementById` and existing code anchors. | MCP tool inputs may need `product_id` or an additional lookup contract. | No known conflict. | DESIGN |
| Final design-page pointers for a requirement can be enumerated through product design pointers at archive time. | Raw requirement and verified presence of `packages/core/src/product.ts`. | Archive handoff enumeration may miss pages or need a different pointer source. | No known conflict. | DESIGN |
| Existing `active` requirement status already implies all pages are stable enough for archive. | Raw requirement cites existing requirement state machine behavior. | Archive might generate handoff from incomplete pages. | No known conflict; verify in DESIGN/SPEC. | DESIGN |
| Chrome/Puppeteer availability is acceptable as an archive-time dependency because preview/rendering already depends on browser-like rendering. | Raw requirement and VZI decision. | Archive can fail in environments without Chrome; operator documentation or dependency setup may be required. | No known conflict. | Risk Discovery |
| Page-level `icons/` and `vzi/` directories will not be treated as artifact versions by existing version listing logic. | Raw requirement references `^v\d+$` version filtering and verified file presence. | Generated directories could interfere with artifact listing or cleanup if assumptions about paths are wrong. | No known conflict; verify in tests. | DESIGN |
| Development-agent soft isolation is acceptable for this requirement. | Raw requirement explicitly chooses soft isolation and defers hard profiles. | Untrusted agents could still call non-gated tools if configured with them. | Known risk accepted for this requirement. | Risk Discovery |

## Downstream Attention
- Risk Discovery must classify archive atomicity, temporary directory cleanup, retry semantics, and crash windows.
- Risk Discovery must classify soft MCP isolation as a permissions/security risk and preserve the future hard-profile option.
- DESIGN must decide exact core module boundaries for icon extraction, archive asset orchestration, VZI capture, and VZI read-layer integration.
- DESIGN must validate how to vendor VZI packages while preserving internal imports and workspace build order.
- DESIGN must validate whether `packages/vzi-renderer` can remain dormant without pulling `canvaskit-wasm` into server/CLI runtime bundles.
- SPEC must define exact MCP tool schemas, error codes, response shapes, and field/depth semantics for handoff/page/node/search tools.
- SPEC must define manifest shapes for `icons.json` and VZI metadata without changing existing artifact manifest schema.
- SPEC must define source-version, viewport-source, and resource-reference metadata precisely enough for tests.
- PLAN must include tests that inject one-page generation failure and prove the requirement remains non-archived.
- PLAN must include conformance smoke coverage for VZI parse/transform/encode/decode on real Forma design-page HTML.
- PLAN must include dependency/build verification for vendored VZI packages and new external dependencies.
- Documentation or agent-template updates are required where operator or agent behavior materially changes.

## Stated Technical Direction
| Direction | Classification | Requirement interpretation |
|---|---|---|
| Inline SVG to standalone SVG plus PNG density assets through Sharp | Hard Constraint | User explicitly requires these generated assets; implementation details still need validation. |
| Preserve `currentColor` in SVG and avoid foreground injection in PNG | Hard Constraint | Required output semantics. |
| Generate assets only at requirement archive time | Hard Constraint | Save-time generation is out of scope. |
| Two-stage archive: generate outside status commit, then commit `archived` | Hard Constraint | Required safety semantics. |
| Page-level `icons/` and `vzi/page.vzi` outputs beside version dirs | Hard Constraint | Supersedes earlier versioned output path. |
| Vendor selected `vzi-core` packages from local fork | Hard Constraint | User-selected integration source and dependency strategy. |
| Puppeteer-only VZI parsing | Hard Constraint | Geometry fidelity requirement. |
| Forma MCP exposes VZI read data directly instead of running a separate VZI MCP server | Hard Constraint | Required integration boundary. |
| 3+1 development MCP tools and no `product_id` input | Hard Constraint with downstream validation | User specified final tool shape; DESIGN/SPEC must verify lookup feasibility. |
| Manual `export_artifact` formats for `icons` and `vzi` | Hard Constraint | Required optional/debug handoff entry. |
| Development/design agent templates for soft isolation | Preference/Constraint mix | Development template is required; exact breadth beyond Claude has a candidate/follow-up aspect. |

## Source Provenance
- Forma repository: `/Users/xubo/x-studio/forma`, branch `feat/icon-export-vzi-handoff`, commit `1c7d0f755115462b515800322b690cf94300ae54`, worktree clean when reviewed for this brief.
- Forma package/workspace context: repository-local `AGENTS.md` describes a pnpm workspace with packages under `packages/` and Node.js/TypeScript conventions.
- Verified Forma code anchors exist: `packages/core/src/artifact-asset-pipeline.ts`, `packages/core/src/design-save.ts`, `packages/core/src/artifact-static-validation.ts`, `packages/core/src/artifact-store.ts`, `packages/core/src/requirement.ts`, `packages/core/src/product.ts`, `packages/server/src/routes.ts`, `packages/mcp/src/tools.ts`, `packages/od-contracts/src/api/artifacts.ts`, `packages/web/src/api.ts`, `packages/web/src/pages/ProductDetail.tsx`, `packages/desktop/src/renderer/viewer/resolver.ts`, `packages/core/src/quality/rendered-dom.ts`, `packages/core/src/preview-renderer.ts`, and `packages/core/src/schemas.ts`.
- VZI source repository: `/Users/xubo/x-studio/vzi-core`, commit `698942cb7ce824b87e5f86be464a29a3f21c97ac`.
- Verified VZI docs exist: `README.md`, `docs/vzi-format-spec.md`, `docs/api-reference.md`, `docs/transformation-flows.md`, and `docs/dependency-boundaries.md`.
- Verified VZI package sources exist for `types`, `parser`, `transformer`, `format`, `renderer`, plus excluded packages including platform and quality-lab packages.

## Deferred
- Exact implementation architecture, module interfaces, and dependency wiring are deferred to DESIGN.
- Exact contract schemas, manifest fields, MCP response shapes, and error payload details are deferred to SPEC.
- Exact implementation task decomposition, test-first sequencing, and verification commands are deferred to PLAN.
- Hard MCP runtime profile isolation is deferred to a future requirement.
- Platform-specific mobile packaging outputs are deferred to future requirements.
- CLI export commands are deferred to future requirements.
- Multi-viewport VZI capture and stale detection for unarchive/edit flows are deferred to future requirements.

## Open Inputs
- Exact VZI fork bug fixes are not enumerated in the requirement; downstream design/spec work must inspect the local VZI source and define the minimal patch set.
- Exact external dependency versions and current API guarantees are not confirmed in this brief; downstream SPEC/PLAN must verify them with authoritative/current documentation before implementation.
- Whether Codex/Gemini development-agent templates are part of the first implementation slice remains a non-blocking planning choice because the raw requirement names Claude first and later for others.
- Exact UI wording for archive success/failure toast is not fixed; it only needs to report useful page/icon/element counts and retryable failure information.

## Raw Notes
- "需求归档时,同步把该需求所有页面设计稿里的内联图标(`<svg>`)切成 SVG + PNG@{1,2,3}x 资源落盘。"
- "切图全部成功才提交归档状态。"
- "开发 agent 经一条带定稿 gate 的新 MCP 通道 `get_design_handoff` 消费。"
- "后台管理(web)、设计稿客户端(desktop/viewer)走 HTTP 不受限。"
- "R1 以 vendor(fork)`vzi-core` 的方式,在归档时采集元素级坐标/大小/文本/层级标注。"
- "切图同改 page 级 `…/<artifactId>/icons/`; `vzi/page.vzi` 一页一份。"
- "阶段1 实际为切图 → vzi; 两者全成功才阶段2提交 `archived`。"
- "开发工具改为 3+1 套、去 `product_id`。"

## Tier Estimation Evidence Block
| Field | Value |
|---|---|
| Tier base | `standard` |
| Modifiers | `cross_project`, `dependency`, `migration`, `safety`, `scope_expanding` |
| Confirmation | Locked by `r2p-tier-lock` for work ID `WF-20260602-agent-design-goal-forma-agent` |
| Evidence keywords | `mcp`, `依赖`, `迁移/替换`, `鉴权/角色/token`, `全部/所有`, `集成/接入`, `wasm`, `fastify`, `react` |
| Scope signals | Multiple packages and two local repositories are involved. |
| Escalation candidates | Migration, cross-project, safety, dependency, scope expansion. |
