# SPEC: 设计稿切图导出与开发 agent 定稿访问控制

## Upstream References
| Artifact | Reference | Status |
|---|---|---|
| Raw Requirement | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/00-raw-requirement.md` | available |
| Requirement Brief | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/03-requirement-brief.md` | approved |
| Risk & Question Discovery | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/04-risk-discovery.md` | approved |
| DESIGN | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/05-design.md` | approved |

## Summary
After implementation, archiving a finalized requirement must synchronously generate page-level design handoff assets for every final design page before the requirement status becomes `archived`. The generated handoff consists of standalone icon assets under `icons/`, one VZI file under `vzi/page.vzi`, and metadata sufficient for development agents and native consumers to locate and verify those assets.

Development-facing MCP handoff tools must reject non-archived requirements and read generated VZI/icon data for archived requirements. Existing HTTP preview/admin clients and existing MCP design-creation tools must remain available for active design workflows and must not be gated by the new development handoff gate.

## Design Coverage Import
| Design Source | Source ID | Item | Required SPEC Contract | Closure Status | Resolution / Route |
|---|---|---|---|---|---|
| DESIGN Spec Input | DES-SPEC-001 [ADDRESSED] | Generated output files and metadata. | File naming, `icons.json`, PNG density keys, source version, and VZI metadata contracts. | covered | SPEC-FR-001 [ADDRESSED], SPEC-IF-001 [ADDRESSED], SPEC-DATA-001 [ADDRESSED], SPEC-DATA-006 [ADDRESSED] |
| DESIGN Spec Input | DES-SPEC-002 [ADDRESSED] | Archive failure and status semantics. | Active precheck, generation failure, commit ordering, retry, success response. | covered | SPEC-FR-002 [ADDRESSED], SPEC-ERR-001 [ADDRESSED], SPEC-DATA-004 [ADDRESSED] |
| DESIGN Spec Input | DES-SPEC-003 [ADDRESSED] | VZI capture contract. | Viewport mapping, metadata, annotations/tokens expectations, decode validity. | covered | SPEC-FR-003 [ADDRESSED], SPEC-DATA-002 [ADDRESSED], SPEC-IF-002 [ADDRESSED] |
| DESIGN Spec Input | DES-SPEC-004 [ADDRESSED] | Development MCP schemas and gate. | Tool inputs/outputs, archived gate, page/node/search semantics, depth/fields behavior. | covered | SPEC-IF-003 [ADDRESSED], SPEC-IF-004 [ADDRESSED], SPEC-IF-005 [ADDRESSED], SPEC-IF-006 [ADDRESSED] |
| DESIGN Spec Input | DES-SPEC-005 [ADDRESSED] | Manual export formats. | `export_artifact` behavior for `icons` and `vzi`; non-fallback semantics. | covered | SPEC-IF-007 [ADDRESSED], SPEC-COMPAT-004 [ADDRESSED] |
| DESIGN Spec Input | DES-SPEC-006 [ADDRESSED] | Existing access preservation. | HTTP and design MCP access preserve contracts. | covered | SPEC-COMPAT-001 [ADDRESSED], SPEC-COMPAT-002 [ADDRESSED] |
| DESIGN Spec Input | DES-SPEC-007 [ADDRESSED] | Archive route/web response. | Archive response counts and retryable failure visibility. | covered | SPEC-IF-008 [ADDRESSED], SPEC-OBS-001 [ADDRESSED] |
| DESIGN Spec Input | DES-SPEC-008 [ADDRESSED] | Vendored package dependency contract. | Included/excluded VZI package boundary and docs/dependency inventory. | covered | SPEC-COMPAT-005 [ADDRESSED], SPEC-COMPAT-008 [ADDRESSED], SPEC-SAFE-004 [ADDRESSED] |
| DESIGN Spec Input | DES-SPEC-009 [ADDRESSED] | Dormant renderer boundary. | Renderer build-only contract and runtime import exclusion. | covered | SPEC-COMPAT-006 [ADDRESSED], SPEC-SAFE-005 [ADDRESSED] |
| DESIGN Spec Input | DES-SPEC-010 [ADDRESSED] | VZI assetRef resolution. | Document-order/content-hash matching, fail-loud mismatch, absolute path resolution. | covered | SPEC-DATA-003 [ADDRESSED], SPEC-ERR-002 [ADDRESSED], SPEC-IF-004 [ADDRESSED] |
| DESIGN Boundary | DES-BND-001 [ADDRESSED] | Archive state boundary. | Status commit order and failure semantics. | covered | SPEC-DATA-004 [ADDRESSED], SPEC-ERR-001 [ADDRESSED] |
| DESIGN Boundary | DES-BND-002 [ADDRESSED] | Artifact storage boundary. | Generated output sibling directories and version-list compatibility. | covered | SPEC-DATA-001 [ADDRESSED], SPEC-COMPAT-003 [ADDRESSED] |
| DESIGN Boundary | DES-BND-003 [ADDRESSED] | Icon/VZI resource boundary. | Resource mapping and mismatch behavior. | covered | SPEC-DATA-003 [ADDRESSED], SPEC-ERR-002 [ADDRESSED] |
| DESIGN Boundary | DES-BND-004 [ADDRESSED] | MCP access boundary. | New dev tools gated; existing tools preserved. | covered | SPEC-IF-003 [ADDRESSED], SPEC-COMPAT-002 [ADDRESSED] |
| DESIGN Boundary | DES-BND-005 [ADDRESSED] | Dependency/runtime boundary. | Build/runtime import and dependency error semantics. | covered | SPEC-SAFE-004 [ADDRESSED], SPEC-COMPAT-006 [ADDRESSED] |
| DESIGN Integration Boundary | DES-INT-001 [ADDRESSED] | Forma archive to VZI parser/transformer/format. | VZI capture input/output and failure behavior. | covered | SPEC-IF-002 [ADDRESSED], SPEC-DATA-002 [ADDRESSED], SPEC-ERR-003 [ADDRESSED] |
| DESIGN Integration Boundary | DES-INT-002 [ADDRESSED] | Forma MCP to VZI read layer. | VZI decode/read projection and asset path resolution. | covered | SPEC-IF-004 [ADDRESSED], SPEC-IF-005 [ADDRESSED], SPEC-IF-006 [ADDRESSED] |
| DESIGN Integration Boundary | DES-INT-003 [ADDRESSED] | Forma workspace to VZI renderer package. | Dormant renderer package boundary. | covered | SPEC-COMPAT-006 [ADDRESSED] |

## Functional Requirements
- SPEC-FR-001 [ADDRESSED]: Archiving an active requirement with one or more final design-page pointers must generate a complete page-level `icons/` directory for each page artifact before the archive response reports success.
- SPEC-FR-002 [ADDRESSED]: A requirement must become `archived` only after all required icon and VZI handoff outputs for all final pages have been generated without error.
- SPEC-FR-003 [ADDRESSED]: Each archived design page must have a generated `vzi/page.vzi` file that can be decoded and read by the development MCP page/node tools.
- SPEC-FR-004 [ADDRESSED]: Development MCP handoff tools must serve only archived requirements; non-archived requirements must be rejected with `REQUIREMENT_NOT_FINALIZED`.
- SPEC-FR-005 [ADDRESSED]: Existing HTTP web/desktop/viewer preview and bundle access must remain available for non-archived design workflows.
- SPEC-FR-006 [ADDRESSED]: Existing MCP design creation and artifact inspection tools must remain available for non-archived design workflows.
- SPEC-FR-007 [ADDRESSED]: Manual export of `icons` and `vzi` must be available for artifact debugging or single-artifact handoff inspection without changing requirement archive status.

## Interfaces
- SPEC-IF-001 [ADDRESSED]: Generated icon output interface:
  - Directory: `<artifactDir>/icons/`.
  - Required manifest: `<artifactDir>/icons/icons.json`.
  - Required files for each unique inline SVG content: one `.svg` file and PNG files for density keys `1x`, `2x`, and `3x`.
  - Physical file names must be deterministic for a fixed source HTML: the file stem is `<iconId>-<contentHash>`, SVG path is `icons/<iconId>-<contentHash>.svg`, and PNG paths are `icons/<iconId>-<contentHash>@1x.png`, `icons/<iconId>-<contentHash>@2x.png`, and `icons/<iconId>-<contentHash>@3x.png`.
  - `iconId` must be derived from the first occurrence's accessible label (`aria-label` on the SVG or parent) when present, otherwise `icon-<sourceOrder>-<width>x<height>`; the derived value must be slug-safe and stable enough for tests to assert.
  - Manifest file paths must be relative to `<artifactDir>`; MCP tools may resolve them to same-machine absolute paths in responses.
  - SVG output must preserve `currentColor` values in the serialized SVG markup.
  - PNG output must be transparent-background output and must not inject a contextual foreground color.
  - Manifest icon entries must expose at least `id`, `name`, `contentHash`, `size`, `usesCurrentColor`, `sourceOrderFirst`, `sourceOrders`, `files.svg`, `files.png["1x"]`, `files.png["2x"]`, and `files.png["3x"]`.
  - Duplicate inline SVG content must share one physical file set and one icon entry keyed by `contentHash`; each source occurrence must remain discoverable through `sourceOrders` or an equivalent occurrence/instance list.
- SPEC-IF-002 [ADDRESSED]: Generated VZI output interface:
  - File: `<artifactDir>/vzi/page.vzi`.
  - Metadata must include `sourceVersion`, product `platform` when present, `viewport`, `viewportSource`, generation source, and enough page/artifact identity to trace the VZI file back to the final design page.
  - The VZI content must contain element data with bounds, text where present, hierarchy, token information where available, annotations where generated, and resource references for image/icon elements.
- SPEC-IF-003 [ADDRESSED]: `get_design_handoff(requirement_id)` MCP interface:
  - Input: `requirement_id` string.
  - On non-archived requirement: throw/return `REQUIREMENT_NOT_FINALIZED` with requirement id and current status in non-secret details.
  - On archived requirement: return requirement id/title/status and a page list containing `pageId`, optional page title/name when available, `artifactId`, `version`, `indexHtmlPath`, `vziPath`, and `iconCount`.
  - Response must include or make available product rules and page copy context consistent with existing design/dev handoff behavior.
- SPEC-IF-004 [ADDRESSED]: `get_page_ui(requirement_id, page_id, options)` MCP interface:
  - Inputs: `requirement_id`, `page_id`, optional `depth`, optional `fields` in `layout|text|visuals|all`, and optional `node_id`.
  - Gate: same archived requirement check as `get_design_handoff`.
  - Output: page viewport/platform metadata, top-level de-duplicated color/font tokens, a depth-limited tree rooted at page or `node_id`, and annotations relevant to the returned tree.
  - Returned tree nodes must expose stable `id`, `type`, `bounds`, text when present, style/token reference when present, and `assetRef` when the node has an image/icon resource.
  - `assetRef` must resolve to a same-machine absolute path for generated icon resources when the resource is generated by the handoff pipeline.
- SPEC-IF-005 [ADDRESSED]: `get_ui_node(requirement_id, page_id, node_id)` MCP interface:
  - Inputs: `requirement_id`, `page_id`, `node_id`.
  - Gate: same archived requirement check as `get_design_handoff`.
  - Output: full node detail including bounds, type, text, full style data, parent/child ids, resolved asset path when applicable, and annotations tied to the node.
- SPEC-IF-006 [ADDRESSED]: `search_page_ui(requirement_id, page_id, query)` MCP interface:
  - This tool is optional but, if implemented, must use the same archived gate and search only the target archived page's VZI data.
  - Output must identify matched element ids, type, text snippet or matched property, bounds, and enough page context for a later `get_ui_node` call.
- SPEC-IF-007 [ADDRESSED]: `export_artifact` manual export interface:
  - Accepted `format` values must include existing `html`, `svg`, `png`, `zip` plus new `icons` and `vzi`.
  - `icons` export must return a directory or archive path containing the generated icon files and manifest for the selected current artifact version.
  - `vzi` export must return a file or directory path containing the generated VZI output for the selected current artifact version.
  - Manual export must not mark a requirement archived and must not be treated as a successful archive substitute.
- SPEC-IF-008 [ADDRESSED]: Archive HTTP response interface:
  - On success, response must include the archived requirement plus `icons:{pages,totalIcons}` and `vzi:{pages,totalElements}` summaries.
  - `icons.pages` must identify page id/artifact id and icon count.
  - `vzi.pages` must identify page id/artifact id and element count.
  - On failure, response must preserve the normal server error envelope and include enough non-secret details for retry/debugging.

## Data / State
- SPEC-DATA-001 [ADDRESSED]: Generated handoff assets are page-level artifact sibling state:
  - Existing immutable `v{n}` directories must not be modified.
  - Existing `manifest.json` files inside version directories must not be modified.
  - Existing artifact manifest schema must not be changed.
  - Source version is recorded in generated metadata instead of encoded in a generated version subdirectory.
- SPEC-DATA-002 [ADDRESSED]: VZI viewport state:
  - Product platform `mobile` maps to viewport `390x884`.
  - Product platform `tablet` maps to viewport `768x1024`.
  - Product platform `desktop` maps to viewport `1024x1280`.
  - Product platform `web` maps to viewport `1024x1280`.
  - Missing product platform maps to viewport `1024x1280` and must record `viewportSource` as a default desktop fallback.
- SPEC-DATA-003 [ADDRESSED]: Icon-to-VZI resource mapping:
  - VZI image/icon element resource refs must be derived from the generated icon manifest for the same page artifact.
  - Document order may be used as the primary matching key only if mismatch detection is present.
  - Content hash must be used as a validation or fallback signal where the available VZI/HTML data permits it.
  - If mapping cannot be made consistently, archive generation must fail before status commit.
- SPEC-DATA-004 [ADDRESSED]: Archive state transition:
  - The archive request must precheck that the requirement belongs to the requested product.
  - The archive request must reject non-`active` requirements through existing status validation semantics.
  - Generated files may be created before status commit, but `archived` status must not be written before all required outputs succeed.
  - Retrying after a failed archive attempt must replace stale generated outputs rather than appending partial outputs.
- SPEC-DATA-005 [ADDRESSED]: VZI decoded data exposed through MCP must be read-only. Development MCP tools must not mutate VZI files, icon files, artifact versions, requirements, or product data.
- SPEC-DATA-006 [ADDRESSED]: `icons.json` manifest state:
  - Top-level metadata must include `schemaVersion`, `generatedFrom`, `generatedAt`, `requirementId`, `productId`, `pageId`, `artifactId`, `version`, `sourceVersion`, and `densities`.
  - `version` and `sourceVersion` must identify the source artifact version used for generation and must not create a generated `v{n}` subdirectory.
  - The manifest must include an `icons` array for unique SVG contents and an occurrence mapping, either through per-icon `sourceOrders` or a separate `instances` array containing `sourceOrder`, `iconId`, and `contentHash`.
  - A zero-icon page must still write a valid manifest with the same top-level metadata, `icons: []`, and an empty occurrence mapping.

## Error Behavior
- SPEC-ERR-001 [ADDRESSED]: Any archive-time failure in icon extraction, PNG generation, VZI parsing, VZI transform/encoding, file write, temp publish, or resource mapping must fail the archive request and leave the requirement non-archived.
- SPEC-ERR-002 [ADDRESSED]: VZI/icon mapping mismatch must be a fail-loud error and must not silently omit `assetRef` for an inline SVG that was expected to become a generated icon.
- SPEC-ERR-003 [ADDRESSED]: Puppeteer/browser unavailability during VZI capture must produce an explicit archive failure rather than fallback to a lightweight geometry path.
- SPEC-ERR-004 [ADDRESSED]: If a development MCP tool is called for an archived requirement whose generated files are missing or unreadable, the tool must return an explicit generated-handoff-missing/read error rather than serving stale active HTML as a substitute.
- SPEC-ERR-005 [ADDRESSED]: Manual export failure must not change requirement status and must not delete immutable version directories.
- SPEC-ERR-006 [ADDRESSED]: Archive success response must not be returned when any page in the requirement failed generation.

## Permissions / Safety
- SPEC-SAFE-001 [ADDRESSED]: The development MCP archive gate is a tool-level soft gate. It must be documented in tool descriptions/templates as a development handoff guard, not as hard authorization against a hostile tool caller.
- SPEC-SAFE-002 [ADDRESSED]: Existing mutation-origin and ownership checks on HTTP archive mutation must remain in force.
- SPEC-SAFE-003 [ADDRESSED]: Generated SVG assets must be validated against Forma's static SVG safety rules or produced only from SVG markup that has passed equivalent checks. SVG containing script, event handlers, or unsafe remote/data references must not become a successful generated SVG output.
- SPEC-SAFE-004 [ADDRESSED]: Vendored dependency behavior that affects rasterization, viewport capture, VZI encoding, or runtime bundling must be verified by tests and external documentation before implementation is considered complete.
- SPEC-SAFE-005 [ADDRESSED]: `packages/vzi-renderer` must not be imported by server, CLI, core archive generation, or MCP handoff read paths in this requirement.
- SPEC-SAFE-006 [ADDRESSED]: Generated output paths returned by MCP must be local filesystem paths within the expected Forma artifact/export roots and must not expose credentials, cookies, or arbitrary host paths.

## Compatibility
- SPEC-COMPAT-001 [ADDRESSED]: Existing HTTP web, desktop, and viewer routes for design preview/bundle access must remain usable for non-archived design workflows.
- SPEC-COMPAT-002 [ADDRESSED]: Existing MCP tools used by design agents, including artifact read/export/design-context/style-change/generation tools, must remain able to access non-archived design artifacts unless this SPEC explicitly names a new development handoff tool.
- SPEC-COMPAT-003 [ADDRESSED]: Existing artifact version listing must continue to report only `v{n}` directories; generated `icons/` and `vzi/` siblings must not appear as artifact versions.
- SPEC-COMPAT-004 [ADDRESSED]: Existing `export_artifact` behavior for `html`, `svg`, `png`, and `zip` must remain compatible except for additive enum support and updated descriptions.
- SPEC-COMPAT-005 [ADDRESSED]: VZI platform/Figma packages, VZI quality lab, and standalone VZI MCP server shell must not become Forma runtime dependencies for this requirement.
- SPEC-COMPAT-006 [ADDRESSED]: Dormant renderer integration must not require React 18 at Forma runtime and must not change existing React 19 web/desktop/viewer runtime behavior.
- SPEC-COMPAT-007 [ADDRESSED]: Previously archived requirements that lack generated handoff outputs are not implicitly backfilled by this requirement. Their behavior is unchanged unless a manual export or explicit future backfill is run.
- SPEC-COMPAT-008 [ADDRESSED]: Vendored VZI source boundary:
  - Forma must vendor only the approved VZI source areas from baseline commit `698942c`: backend packages for `types`, `parser`, `transformer`, and `format`; the dormant `renderer` package; and the VZI read-layer logic needed to project decoded `.vzi` files into MCP-friendly JSON.
  - Vendored workspace packages must preserve the `@vzi-core/*` package names while living under Forma package directories such as `packages/vzi-types`, `packages/vzi-parser`, `packages/vzi-transformer`, `packages/vzi-format`, and `packages/vzi-renderer`.
  - The read layer may live inside `packages/mcp` or a narrow internal read package, but the standalone VZI `apps/mcp` server shell must not be vendored as a running server or separate MCP endpoint.
  - The parser package must use the Puppeteer layout path for archive/manual VZI generation; sync/JSDOM lightweight geometry paths must be removed or made unreachable from Forma generation code, and Puppeteer dependency usage must align with Forma's Puppeteer version.
  - VZI platform/Figma extractors, platform client/contracts, quality lab, and any Figma-specific services must remain excluded from Forma runtime and workspace build scope for this requirement.
  - Renderer code may be vendored and built, but it must stay dormant: no server, CLI, core archive generation, or MCP handoff read path may import renderer or CanvasKit runtime APIs.

## Observability
- SPEC-OBS-001 [ADDRESSED]: Successful archive responses must expose page/icon/element counts sufficient for web UI feedback.
- SPEC-OBS-002 [ADDRESSED]: Archive errors must expose a retryable, non-secret failure reason and page/artifact context when available.
- SPEC-OBS-003 [ADDRESSED]: Default viewport fallback must be observable in VZI metadata through `viewportSource`.
- SPEC-OBS-004 [ADDRESSED]: Manual export responses must return output paths and any limitation note when applicable.
- SPEC-OBS-005 [ADDRESSED]: MCP handoff missing-file errors must name the missing handoff type (`icons` or `vzi`) and page/artifact context without dumping raw sensitive logs.

## Boundary Contract Check
| Boundary | Contract Area | Input / Output | Data / State | Error Behavior | Compatibility | Migration-visible Behavior | Rollback / Recovery | Required Behavior | Trace | Testability |
|---|---|---|---|---|---|---|---|---|---|---|
| DES-BND-001 [ADDRESSED] | Archive state | reqId/productId -> archived requirement + summaries | Generated files before status commit | Failure leaves non-archived | Existing active-status validation preserved | Archive gains new precommit failure modes | Retry replaces generated outputs | Status commit last | SPEC-DATA-004 [ADDRESSED] | Integration failure/success tests |
| DES-BND-002 [ADDRESSED] | Artifact storage | artifactId/version/index.html -> `icons/`, `vzi/` siblings | Version dirs unchanged; source version recorded in generated metadata | Path/write errors fail generation | `v{n}` listing unchanged | Additive generated output | Remove generated dirs or regenerate | Sibling dirs only | SPEC-COMPAT-003 [ADDRESSED], SPEC-DATA-006 [ADDRESSED] | Version-list and manifest metadata tests |
| DES-BND-003 [ADDRESSED] | Icon/VZI resources | HTML inline SVG -> deterministic icon files + VZI refs | Manifest records unique icons and occurrences | Mapping mismatch fails | HTML unchanged | Additive generated refs | Regenerate from HTML | Fail-loud linking | SPEC-DATA-003 [ADDRESSED], SPEC-DATA-006 [ADDRESSED] | AssetRef resolution and naming tests |
| DES-BND-004 [ADDRESSED] | MCP access | requirement/page/node inputs -> handoff JSON | Read-only generated files | Non-archived rejected | Existing tools preserved | Additive tools | Remove new tools/templates | Gate only dev handoff tools | SPEC-IF-003 [ADDRESSED] | MCP tests |
| DES-BND-005 [ADDRESSED] | Dependency/runtime | HTML/VZI buffers -> generated data | No remote service state | Dependency failure explicit | Existing builds/runtimes preserved | Vendored package migration with explicit source boundary | Remove packages/imports | Renderer dormant, parser aligned, excluded VZI areas absent | SPEC-SAFE-004 [ADDRESSED], SPEC-COMPAT-008 [ADDRESSED] | Build/import-boundary and package-boundary checks |
| DES-INT-001 [ADDRESSED] | VZI backend integration | HTML + viewport -> `page.vzi` | Metadata records source/platform/viewport | Browser/parser/encoder error fails archive | Existing archive preserved except precondition | Additive output | Remove VZI capture | Puppeteer path only | SPEC-IF-002 [ADDRESSED] | VZI smoke |
| DES-INT-002 [ADDRESSED] | VZI read layer | VZI path -> tree/node/search JSON | Read-only | Missing VZI/assets explicit | Existing MCP tools preserved | Additive tool surface | Remove read layer/tools | Decode and project VZI data | SPEC-IF-004 [ADDRESSED] | MCP read tests |
| DES-INT-003 [ADDRESSED] | Dormant renderer | package source -> build output | No product state | Build failure blocks integration | Runtime unchanged | Additive package | Remove package | No runtime import | SPEC-COMPAT-006 [ADDRESSED] | Import boundary check |

## Acceptance Scenarios
- SPEC-ACC-001 [ADDRESSED]: Given an active requirement with two final design pages containing inline SVG icons, when the web archive route is called, then both page artifacts have generated `icons/` and `vzi/page.vzi` outputs and the returned requirement status is `archived`.
- SPEC-ACC-002 [ADDRESSED]: Given one final design page fails VZI capture, when archive is called, then the archive request fails and the requirement status remains non-archived.
- SPEC-ACC-003 [ADDRESSED]: Given an archived requirement with generated handoff files, when `get_design_handoff(requirement_id)` is called, then it returns page entries with `indexHtmlPath`, `vziPath`, and icon counts.
- SPEC-ACC-004 [ADDRESSED]: Given a non-archived requirement, when `get_design_handoff(requirement_id)` is called, then it returns `REQUIREMENT_NOT_FINALIZED`.
- SPEC-ACC-005 [ADDRESSED]: Given an active design workflow, when existing HTTP preview/bundle or existing MCP design tools are used, then access is not denied because of the new development handoff gate.
- SPEC-ACC-006 [ADDRESSED]: Given a page VZI element with an inline SVG resource, when the page UI/node MCP tool returns that element, then the element's `assetRef` resolves to an existing generated icon asset path.
- SPEC-ACC-007 [ADDRESSED]: Given a repeated archive attempt after a failed attempt, when generation succeeds, then stale generated outputs are replaced and the final output set is complete.

## Edge Cases
- SPEC-EDGE-001 [ADDRESSED]: A page with no inline SVG must still be eligible for archive if VZI capture succeeds; its `icons.json` may report zero icons and archive summary must count zero icons for that page.
- SPEC-EDGE-002 [ADDRESSED]: Duplicate inline SVG content must not require duplicate physical icon files, but manifest data must remain sufficient for VZI/resource mapping and consumer lookup.
- SPEC-EDGE-003 [ADDRESSED]: SVG width/height missing but `viewBox` present must produce density outputs based on viewBox dimensions.
- SPEC-EDGE-004 [ADDRESSED]: Missing product platform must use desktop viewport and record the default fallback in metadata.
- SPEC-EDGE-005 [ADDRESSED]: Existing generated `icons/` or `vzi/` from a previous failed attempt must be cleared/replaced during retry.
- SPEC-EDGE-006 [ADDRESSED]: If manual `vzi` export is requested before archive for a valid artifact version, it may generate/export VZI for debugging but must not change requirement status.
- SPEC-EDGE-007 [ADDRESSED]: If VZI decode succeeds but MCP asset path resolution finds a missing generated icon file, the MCP tool must return an explicit missing asset error.

## Traceability
| Source | Source Item | SPEC Coverage | Status |
|---|---|---|---|
| Requirement Brief | Archive-time icons | SPEC-FR-001 [ADDRESSED], SPEC-IF-001 [ADDRESSED] | covered |
| Requirement Brief | Archive-time VZI | SPEC-FR-003 [ADDRESSED], SPEC-IF-002 [ADDRESSED] | covered |
| Requirement Brief | All-or-nothing archive | SPEC-FR-002 [ADDRESSED], SPEC-ERR-001 [ADDRESSED] | covered |
| Requirement Brief | Development MCP gate | SPEC-FR-004 [ADDRESSED], SPEC-IF-003 [ADDRESSED] | covered |
| Requirement Brief | HTTP/design tools unaffected | SPEC-COMPAT-001 [ADDRESSED], SPEC-COMPAT-002 [ADDRESSED] | covered |
| DESIGN | DES-BND-001 [ADDRESSED] | SPEC-DATA-004 [ADDRESSED] | covered |
| DESIGN | DES-BND-002 [ADDRESSED] | SPEC-DATA-001 [ADDRESSED], SPEC-DATA-006 [ADDRESSED], SPEC-COMPAT-003 [ADDRESSED] | covered |
| DESIGN | DES-BND-003 [ADDRESSED] | SPEC-DATA-003 [ADDRESSED], SPEC-DATA-006 [ADDRESSED] | covered |
| DESIGN | DES-BND-004 [ADDRESSED] | SPEC-IF-003 [ADDRESSED], SPEC-COMPAT-002 [ADDRESSED] | covered |
| DESIGN | DES-BND-005 [ADDRESSED] | SPEC-SAFE-004 [ADDRESSED], SPEC-COMPAT-006 [ADDRESSED], SPEC-COMPAT-008 [ADDRESSED] | covered |

## External Documentation Checked
| dependency | version | check date | conclusion |
|---|---|---|---|
| sharp | `^0.34.5` | 2026-06-02 | Context7 `/lovell/sharp` checked: docs confirm PNG output via `.png().toBuffer()` and buffer output metadata; SPEC still requires implementation tests for SVG raster dimensions and transparency. |
| puppeteer | `^25.1.0` | 2026-06-02 | Context7 `/puppeteer/puppeteer` checked: docs confirm default headless launch and `page.setViewport({width,height,deviceScaleFactor})`, with viewport recommended before navigation/loading. |
| canvaskit-wasm | `0.40.0` | 2026-06-02 | Context7 did not resolve an authoritative CanvasKit entry; UNCONFIRMED for API behavior. SPEC only requires dormant build boundary and no runtime import. |
| msgpackr | `^1.2.0` from VZI format package | 2026-06-02 | UNCONFIRMED external API docs in this SPEC pass; behavior must be covered by vendored VZI encode/decode tests rather than assumed. |
| rbush | `^3.0.0` from VZI transformer/renderer packages | 2026-06-02 | UNCONFIRMED external API docs in this SPEC pass; behavior must be covered by vendored VZI transformer tests/build checks. |
| cheerio/postcss/tailwindcss/autoprefixer/jsdom | VZI parser package declarations | 2026-06-02 | UNCONFIRMED external API docs in this SPEC pass; parser integration must remove or isolate unused lightweight path dependencies and verify workspace build. |

## Plan Inputs
| Plan Input ID | Source Artifact | Source Item ID | Item | Required PLAN Constraint | Covers | Status |
|---|---|---|---|---|---|---|
| SPEC-PLAN-001 [ADDRESSED] | SPEC | SPEC-IF-001 [ADDRESSED] | Icon extraction contract. | Implement with tests for SVG output, PNG densities, currentColor preservation, transparency, naming, dedupe, and manifest. | DES-PLAN-001 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-002 [ADDRESSED] | SPEC | SPEC-DATA-004 [ADDRESSED] | Archive all-or-nothing contract. | Test failure before status commit and success after full generation. | DES-PLAN-002 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-003 [ADDRESSED] | SPEC | SPEC-DATA-001 [ADDRESSED] | Generated output storage contract. | Test sibling output dirs and version listing compatibility. | DES-PLAN-003 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-004 [ADDRESSED] | SPEC | SPEC-IF-002 [ADDRESSED] | VZI capture contract. | Add conformance smoke for parse/transform/encode/decode, bounds, tokens/annotations, viewport metadata. | DES-PLAN-004 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-005 [ADDRESSED] | SPEC | SPEC-IF-008 [ADDRESSED] | Archive response and web feedback. | Verify success counts and retryable failure display. | DES-PLAN-005 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-006 [ADDRESSED] | SPEC | SPEC-IF-003 [ADDRESSED] | Development MCP handoff gate. | Test non-archived rejection and archived success. | DES-PLAN-006 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-007 [ADDRESSED] | SPEC | SPEC-IF-004 [ADDRESSED] | Page UI/node/search MCP reads. | Test depth/fields/node behavior, tokens, annotations, and assetRef resolution. | DES-PLAN-006 [ADDRESSED], DES-PLAN-011 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-008 [ADDRESSED] | SPEC | SPEC-IF-007 [ADDRESSED] | Manual export formats. | Test `icons` and `vzi` export output without archive-status mutation. | DES-PLAN-007 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-009 [ADDRESSED] | SPEC | SPEC-COMPAT-001 [ADDRESSED] | Existing HTTP access preserved. | Regression test active design HTTP preview/bundle access. | DES-PLAN-008 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-010 [ADDRESSED] | SPEC | SPEC-COMPAT-002 [ADDRESSED] | Existing design MCP access preserved. | Regression test non-archived artifact/design-context/design generation access. | DES-PLAN-008 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-011 [ADDRESSED] | SPEC | SPEC-SAFE-004 [ADDRESSED] | Dependency and docs verification. | Verify external docs assumptions, workspace build, and VZI package tests. | DES-PLAN-009 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-012 [ADDRESSED] | SPEC | SPEC-COMPAT-006 [ADDRESSED] | Dormant renderer boundary. | Verify server/CLI/core/MCP handoff paths do not import renderer/CanvasKit. | DES-PLAN-010 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-013 [ADDRESSED] | SPEC | SPEC-DATA-003 [ADDRESSED] | VZI/icon resource linking. | Assert generated VZI/MCP refs resolve to existing icon files and mismatch fails. | DES-PLAN-011 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-014 [ADDRESSED] | SPEC | SPEC-ERR-001 [ADDRESSED] | Retry and stale output replacement. | Test retry after partial generated output replaces stale output. | DES-PLAN-002 [ADDRESSED], DES-PLAN-012 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-015 [ADDRESSED] | SPEC | SPEC-SAFE-003 [ADDRESSED] | SVG safety. | Test unsafe SVG does not become successful generated output. | DES-PLAN-013 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-016 [ADDRESSED] | SPEC | SPEC-DATA-006 [ADDRESSED] | Concrete `icons.json` manifest and deterministic file naming. | Test top-level metadata, zero-icon manifest, relative file paths, filename stems, density keys, and duplicate occurrence mapping. | DES-PLAN-001 [ADDRESSED], DES-PLAN-011 [ADDRESSED] | Open for PLAN |
| SPEC-PLAN-017 [ADDRESSED] | SPEC | SPEC-COMPAT-008 [ADDRESSED] | Vendored VZI package/source boundary. | Verify package names/locations, included/excluded source areas, Puppeteer-only parser path, read-layer-only MCP integration, and renderer no-runtime import boundary. | DES-PLAN-009 [ADDRESSED], DES-PLAN-010 [ADDRESSED] | Open for PLAN |

## Spec Quality Gate
ready

## SPEC Checkpoint
approved pending checkpoint decision
