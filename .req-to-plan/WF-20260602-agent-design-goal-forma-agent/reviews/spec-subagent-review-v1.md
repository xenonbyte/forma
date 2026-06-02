# SPEC Checkpoint Review
status: issues
recommendation: request_changes

## Coverage
- SPEC covers the main DESIGN boundaries needed for PLAN: archive status commit remains after generation, page-level `icons/` and `vzi/page.vzi` outputs are required, VZI capture/read behavior is scoped, VZI/icon resource mismatch fails loudly, new development MCP tools enforce the archived gate, existing HTTP and design MCP surfaces stay ungated, and renderer/runtime isolation is called out.
- Archive transaction behavior is covered well enough at the product-state level: generation failures keep the requirement non-archived, retry replaces stale outputs, and archive success cannot be returned after a per-page failure.
- `UNCONFIRMED` external dependency items are handled acceptably where they remain: CanvasKit is constrained to dormant/no-runtime import, and msgpackr/rbush/parser-side dependency behavior is routed to vendored VZI encode/decode, transformer, build, and import-boundary tests rather than assumed runtime API behavior.

## Findings
1. `06-spec.md` claims coverage for exact generated icon output naming and metadata, but the actual contract is still too loose for PLAN.
   - Evidence: `SPEC-IF-001` only requires "one `.svg` file and PNG files" plus manifest entry fields "at least" `name`, `contentHash`, `size`, `usesCurrentColor`, and file paths. `SPEC-DATA-001` says source version is recorded in generated metadata, but does not pin whether this is in `icons.json`, what page/artifact/version identity fields exist, or the deterministic file naming convention for SVG/PNG density files.
   - Why it matters: DESIGN's `DES-SPEC-001` asks SPEC to define file naming, `icons.json`, PNG density keys, source version, and generated source. Without a stable icon manifest/file contract, PLAN cannot write precise tests for archive output completeness, dedupe behavior, retry replacement, or VZI/resource path expectations.

2. `06-spec.md` does not fully materialize the vendored VZI package/source boundary required by DESIGN.
   - Evidence: `SPEC-COMPAT-005`, `SPEC-COMPAT-006`, `SPEC-SAFE-004`, `SPEC-SAFE-005`, and the External Documentation table cover runtime exclusions and verification, but they do not enumerate the in-scope workspace packages/source areas, package-name preservation, read-layer inclusion, excluded VZI areas, or the parser dependency alignment/removal expectations.
   - Why it matters: DESIGN's `DES-SPEC-008` requires package names, dependency alignment, included/excluded VZI source areas, and external docs inventory. PLAN needs that contract to decompose vendor/build tasks and verify that platform/Figma services, quality lab, standalone VZI MCP shell, and renderer runtime dependencies did not leak into Forma runtime paths.

## Required Changes
- Add a concrete `icons.json` and icon file naming contract. It should define deterministic SVG/PNG filenames, relative path fields, density keys, dedupe mapping fields, source page/artifact/version identity, generation source/metadata, and how zero-icon pages are represented.
- Add a vendored VZI boundary contract listing the included Forma workspace packages/source areas, excluded VZI areas, dependency alignment expectations such as Puppeteer alignment and lightweight parser path isolation/removal, and renderer build-only/no-runtime import constraints.

## Residual Risks
- Synchronous archive performance remains an accepted requirement risk and is routed to PLAN through response/error feedback and targeted checks.
- The MCP archived gate remains soft isolation by design; SPEC correctly avoids presenting it as hard authorization.
- External dependency details not confirmed in SPEC are acceptable only if PLAN preserves the listed build, smoke, and import-boundary verification gates.
