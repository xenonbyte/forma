# PLAN: 设计稿切图导出与开发 agent 定稿访问控制

## Upstream References
| Artifact | Reference | Status |
|---|---|---|
| Raw Requirement | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/00-raw-requirement.md` | available |
| Requirement Brief | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/03-requirement-brief.md` | approved |
| Risk & Question Discovery | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/04-risk-discovery.md` | approved |
| DESIGN | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/05-design.md` | approved |
| SPEC | `.req-to-plan/WF-20260602-agent-design-goal-forma-agent/06-spec.md` | approved v2 |

## Goal
Implement archive-time design handoff generation for Forma: page-level icon files and VZI files are generated before archive status commits, development MCP tools can only read archived handoff data, and existing HTTP/design-tool access remains compatible.

## Preconditions
- Work in `/Users/xubo/x-studio/forma` on the existing feature branch; run `git status --short` before implementation and preserve unrelated user changes.
- Confirm `/Users/xubo/x-studio/vzi-core` is available at baseline commit `698942c` before vendoring VZI source.
- Use `FORMA_HOME` under a disposable temp directory for route/integration tests that write product data.
- Do not mutate production Forma data, external services, or remote repositories while executing this plan.
- Treat Sharp/Puppeteer docs checked on 2026-06-02 as valid only while dependency versions remain `sharp ^0.34.5` and `puppeteer ^25.1.0`; if versions change, re-check current official/Context7 docs before implementation.
- Stop if implementation requires changing approved SPEC contracts, generated artifact version directories, artifact manifest schema, or adding hard MCP authorization profiles.

## Contract-to-Task Mapping
| SPEC Contract | Source | Task / Check | Coverage Type | Closure Status | Resolution / Route |
|---|---|---|---|---|---|
| SPEC-FR-001 [ADDRESSED], SPEC-IF-001 [ADDRESSED], SPEC-DATA-006 [ADDRESSED], SPEC-EDGE-001 [ADDRESSED], SPEC-EDGE-002 [ADDRESSED], SPEC-EDGE-003 [ADDRESSED] | SPEC icons contract | PLAN-TASK-003, PLAN-TASK-004 | implementation + unit tests | covered | deterministic icon files, manifest, zero-icon, dedupe, viewBox sizing |
| SPEC-FR-002 [ADDRESSED], SPEC-DATA-004 [ADDRESSED], SPEC-ERR-001 [ADDRESSED], SPEC-ERR-006 [ADDRESSED], SPEC-EDGE-005 [ADDRESSED], SPEC-ACC-001 [ADDRESSED], SPEC-ACC-002 [ADDRESSED], SPEC-ACC-007 [ADDRESSED] | SPEC archive contract | PLAN-TASK-004, PLAN-TASK-005, PLAN-TASK-006 | implementation + integration tests | covered | generation succeeds before archive commit; failure leaves non-archived; stale generated outputs are replaced |
| SPEC-FR-003 [ADDRESSED], SPEC-IF-002 [ADDRESSED], SPEC-DATA-002 [ADDRESSED], SPEC-OBS-003 [ADDRESSED], SPEC-ERR-003 [ADDRESSED], SPEC-EDGE-004 [ADDRESSED] | SPEC VZI capture | PLAN-TASK-001, PLAN-TASK-005 | implementation + smoke tests | covered | vendor VZI path and capture metadata/viewport; default viewportSource remains observable |
| SPEC-DATA-001 [ADDRESSED], SPEC-COMPAT-003 [ADDRESSED] | SPEC storage compatibility | PLAN-TASK-002, PLAN-TASK-004, PLAN-TASK-005 | implementation + compatibility tests | covered | generated sibling dirs; version dirs unchanged |
| SPEC-DATA-003 [ADDRESSED], SPEC-ERR-002 [ADDRESSED], SPEC-ACC-006 [ADDRESSED], SPEC-EDGE-007 [ADDRESSED] | SPEC icon/VZI linking | PLAN-TASK-003, PLAN-TASK-005, PLAN-TASK-008 | implementation + link tests | covered | manifest-driven assetRef and missing-asset errors |
| SPEC-FR-004 [ADDRESSED], SPEC-IF-003 [ADDRESSED], SPEC-IF-004 [ADDRESSED], SPEC-IF-005 [ADDRESSED], SPEC-IF-006 [ADDRESSED], SPEC-DATA-005 [ADDRESSED], SPEC-ERR-004 [ADDRESSED] | SPEC dev MCP handoff | PLAN-TASK-008 | implementation + MCP tests | covered | archived gate and read-only VZI projection |
| SPEC-FR-005 [ADDRESSED], SPEC-FR-006 [ADDRESSED], SPEC-COMPAT-001 [ADDRESSED], SPEC-COMPAT-002 [ADDRESSED], SPEC-ACC-005 [ADDRESSED] | SPEC access preservation | PLAN-TASK-010 | preserve + regression tests | covered | HTTP and design MCP tools stay ungated |
| SPEC-FR-007 [ADDRESSED], SPEC-IF-007 [ADDRESSED], SPEC-ERR-005 [ADDRESSED], SPEC-COMPAT-004 [ADDRESSED], SPEC-EDGE-006 [ADDRESSED] | SPEC manual export | PLAN-TASK-009 | implementation + MCP tests | covered | `icons`/`vzi` export without archive mutation |
| SPEC-IF-008 [ADDRESSED], SPEC-OBS-001 [ADDRESSED], SPEC-OBS-002 [ADDRESSED], SPEC-OBS-004 [ADDRESSED], SPEC-OBS-005 [ADDRESSED] | SPEC responses/observability | PLAN-TASK-006, PLAN-TASK-007, PLAN-TASK-009 | implementation + UI/API tests | covered | response counts and retryable errors |
| SPEC-SAFE-001 [ADDRESSED], SPEC-SAFE-006 [ADDRESSED], RISK-RIS-006 [ADDRESSED] | SPEC soft gate and path safety | PLAN-TASK-008, PLAN-TASK-011 | implementation + template/docs checks | covered | tool descriptions and returned paths stay scoped |
| SPEC-SAFE-002 [ADDRESSED] | SPEC mutation safety | PLAN-TASK-006 | preserve + server tests | covered | archive route keeps mutation-origin and ownership checks |
| SPEC-SAFE-003 [ADDRESSED], SPEC-PLAN-015 [ADDRESSED] | SPEC SVG safety | PLAN-TASK-003 | unit tests | covered | unsafe SVG fails extraction/generation |
| SPEC-SAFE-004 [ADDRESSED], SPEC-COMPAT-005 [ADDRESSED], SPEC-COMPAT-008 [ADDRESSED], SPEC-PLAN-011 [ADDRESSED], SPEC-PLAN-017 [ADDRESSED] | SPEC vendor/dependency boundary | PLAN-TASK-001, PLAN-TASK-012 | implementation + build/import checks | covered | package boundary, docs drift handling, build/typecheck |
| SPEC-SAFE-005 [ADDRESSED], SPEC-COMPAT-006 [ADDRESSED], SPEC-PLAN-012 [ADDRESSED] | SPEC dormant renderer | PLAN-TASK-001, PLAN-TASK-012 | implementation + import-boundary check | covered | renderer buildable and not imported by runtime paths |
| SPEC-COMPAT-007 [ADDRESSED] | SPEC historical archived data | PLAN-TASK-008, PLAN-TASK-009 | explicit preserve | covered | missing generated handoff errors; no automatic backfill |
| SPEC-PLAN-001 [ADDRESSED] through SPEC-PLAN-017 [ADDRESSED] | SPEC Plan Inputs | PLAN-TASK-001 through PLAN-TASK-012 | implementation + verification + safety | covered | all SPEC Plan Inputs have task coverage below |

## Risk Discovery Plan Input Traceability
| Risk Discovery Plan Input | DESIGN Plan Input | SPEC-PLAN ID | PLAN Coverage | Closure Status | Resolution / Route |
|---|---|---|---|---|---|
| RISK-PLAN-001 [ADDRESSED]: archive all-or-nothing verification | DES-PLAN-002 [ADDRESSED] | SPEC-PLAN-002 [ADDRESSED] | PLAN-TASK-005, PLAN-TASK-006 | covered | injected failure tests before archive commit |
| RISK-PLAN-002 [ADDRESSED]: temp directory and retry verification | DES-PLAN-012 [ADDRESSED] | SPEC-PLAN-014 [ADDRESSED] | PLAN-TASK-004, PLAN-TASK-005 | covered | temp publish, stale output replacement, rollback notes |
| RISK-PLAN-003 [ADDRESSED]: VZI/icon linking verification | DES-PLAN-011 [ADDRESSED] | SPEC-PLAN-013 [ADDRESSED], SPEC-PLAN-016 [ADDRESSED] | PLAN-TASK-003, PLAN-TASK-005, PLAN-TASK-008 | covered | manifest occurrences and resolved asset paths |
| RISK-PLAN-004 [ADDRESSED]: workspace build and dependency verification | DES-PLAN-009 [ADDRESSED], DES-PLAN-010 [ADDRESSED] | SPEC-PLAN-011 [ADDRESSED], SPEC-PLAN-012 [ADDRESSED], SPEC-PLAN-017 [ADDRESSED] | PLAN-TASK-001, PLAN-TASK-012 | covered | package build/typecheck and renderer import boundary |
| RISK-PLAN-005 [ADDRESSED]: access-boundary regression tests | DES-PLAN-008 [ADDRESSED] | SPEC-PLAN-009 [ADDRESSED], SPEC-PLAN-010 [ADDRESSED] | PLAN-TASK-010 | covered | HTTP/design MCP ungated regressions |
| RISK-PLAN-006 [ADDRESSED]: external-doc verification before code | DES-PLAN-009 [ADDRESSED] | SPEC-PLAN-011 [ADDRESSED] | PLAN-TASK-001, PLAN-TASK-012 | covered | re-check docs only if dependency versions changed; otherwise use tests |
| RISK-PLAN-007 [ADDRESSED]: VZI conformance smoke | DES-PLAN-004 [ADDRESSED] | SPEC-PLAN-004 [ADDRESSED] | PLAN-TASK-005 | covered | parse/transform/encode/decode with non-zero bounds |

## Task Breakdown

### PLAN-TASK-001: Vendor VZI workspace packages with strict source boundaries

Spec References:
- SPEC-FR-003 [ADDRESSED]: generated VZI output for archived pages.
- SPEC-IF-002 [ADDRESSED]: VZI file metadata and content contract.
- SPEC-COMPAT-005 [ADDRESSED]: exclude VZI platform/Figma/quality-lab/standalone MCP runtime.
- SPEC-COMPAT-006 [ADDRESSED]: dormant renderer does not affect React 19 runtime.
- SPEC-COMPAT-008 [ADDRESSED]: vendored VZI source boundary.
- SPEC-SAFE-004 [ADDRESSED]: dependency behavior must be verified.
- SPEC-SAFE-005 [ADDRESSED]: renderer must not be imported by server/CLI/core/MCP handoff paths.
- SPEC-PLAN-011 [ADDRESSED], SPEC-PLAN-012 [ADDRESSED], SPEC-PLAN-017 [ADDRESSED].

Goal:
Add vendored VZI packages and the read-layer source needed by Forma while keeping excluded VZI surfaces out of runtime and build scope.

Change Type:
add

TDD Applicable: no

Files:
- Create: `packages/vzi-types/package.json`
- Create: `packages/vzi-types/src/**`
- Create: `packages/vzi-parser/package.json`
- Create: `packages/vzi-parser/src/**`
- Create: `packages/vzi-transformer/package.json`
- Create: `packages/vzi-transformer/src/**`
- Create: `packages/vzi-format/package.json`
- Create: `packages/vzi-format/src/**`
- Create: `packages/vzi-renderer/package.json`
- Create: `packages/vzi-renderer/src/**`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/core/package.json`
- Modify: `packages/mcp/package.json`
- Create: `packages/mcp/src/vzi-read-layer.ts`
- Create: `packages/mcp/src/vzi-read-schemas.ts`
- Test: package build/typecheck checks in PLAN-TASK-012

Skeleton:
```bash
test -f /Users/xubo/x-studio/vzi-core/packages/types/package.json
test -f /Users/xubo/x-studio/vzi-core/packages/parser/package.json
test -f /Users/xubo/x-studio/vzi-core/packages/transformer/package.json
test -f /Users/xubo/x-studio/vzi-core/packages/format/package.json
test -f /Users/xubo/x-studio/vzi-core/packages/renderer/package.json
git -C /Users/xubo/x-studio/vzi-core rev-parse --short HEAD
```

Steps:
- [ ] Verify the VZI source tree exists and the short commit is `698942c`.
- [ ] Copy only `packages/types`, `packages/parser`, `packages/transformer`, `packages/format`, and `packages/renderer` into the matching Forma `packages/vzi-*` directories.
- [ ] Preserve package names as `@vzi-core/types`, `@vzi-core/parser`, `@vzi-core/transformer`, `@vzi-core/format`, and `@vzi-core/renderer`.
- [ ] Copy only the VZI MCP transformer/read schemas needed to decode and project `.vzi` data; do not copy the standalone VZI `apps/mcp` server shell as a running service.
- [ ] Remove or make unreachable the parser lightweight sync/JSDOM geometry entry from Forma archive/manual VZI generation paths.
- [ ] Align Puppeteer usage with Forma's `puppeteer ^25.1.0`; if VZI source requires a conflicting version or API, stop and route upstream.
- [ ] Keep renderer buildable but dormant; do not import `@vzi-core/renderer` from `packages/core`, `packages/server`, `packages/cli`, or MCP handoff runtime code.
- [ ] Update package dependencies only where needed by core archive capture or MCP VZI reading.

Verification:
Run `pnpm --filter @vzi-core/types build`, `pnpm --filter @vzi-core/parser build`, `pnpm --filter @vzi-core/transformer build`, `pnpm --filter @vzi-core/format build`, and `pnpm --filter @vzi-core/renderer build`. These checks cover SPEC-COMPAT-008 [ADDRESSED] and SPEC-COMPAT-006 [ADDRESSED].

Rollback / Safety:
Remove the `packages/vzi-*` directories and dependency entries if this task fails before later tasks import them. Stop if vendoring requires including Figma platform packages, quality lab, or a standalone MCP service.

### PLAN-TASK-002: Add generated handoff path helpers and storage compatibility tests

Spec References:
- SPEC-DATA-001 [ADDRESSED]: generated handoff assets are sibling state.
- SPEC-COMPAT-003 [ADDRESSED]: version listing reports only `v{n}` directories.
- SPEC-PLAN-003 [ADDRESSED]: storage helper tests.

Goal:
Create safe path helpers for artifact-level `icons/` and `vzi/page.vzi` outputs without modifying immutable version directories or artifact manifest schema.

Change Type:
modify

TDD Applicable: yes

Files:
- Modify: `packages/core/src/artifact-paths.ts`
- Modify: `packages/core/tests/artifact-paths.test.ts`
- Modify: `packages/core/tests/artifact-store.test.ts`

Skeleton:
```typescript
test("generated handoff directories are artifact siblings and not versions", async () => {
  const iconsDir = getArtifactIconsDir(root, "P-abc123", "A-asset1");
  const vziPath = getArtifactVziPath(root, "P-abc123", "A-asset1");
  expect(iconsDir.endsWith("/od-project/artifacts/A-asset1/icons")).toBe(true);
  expect(vziPath.endsWith("/od-project/artifacts/A-asset1/vzi/page.vzi")).toBe(true);
  await mkdir(iconsDir, { recursive: true });
  await mkdir(dirname(vziPath), { recursive: true });
  expect(await store.listArtifactVersions("P-abc123", "A-asset1")).toEqual([1]);
});
```

Steps:
- [ ] red: Add tests for `getArtifactIconsDir`, `getArtifactIconsManifestPath`, `getArtifactVziDir`, and `getArtifactVziPath`.
- [ ] red: Add a version-list regression where `icons/` and `vzi/` exist next to `v1/`.
- [ ] green: Add the safe helper functions in `artifact-paths.ts` using the existing product/artifact validation and path boundary logic.
- [ ] green: Keep `listArtifactVersions` unchanged except for tests proving its current `^v\\d+$` behavior.
- [ ] verify: Run `pnpm vitest run packages/core/tests/artifact-paths.test.ts packages/core/tests/artifact-store.test.ts`.

Verification:
Targeted tests pass and prove SPEC-DATA-001 [ADDRESSED] and SPEC-COMPAT-003 [ADDRESSED].

Rollback / Safety:
Path helpers are additive. Stop if tests require changing existing `getArtifactVersionDir`, `writeArtifactVersion`, or version listing semantics.

### PLAN-TASK-003: Implement inline SVG icon extraction and manifest generation

Spec References:
- SPEC-FR-001 [ADDRESSED]: archive generates complete `icons/`.
- SPEC-IF-001 [ADDRESSED]: icon output interface.
- SPEC-DATA-006 [ADDRESSED]: `icons.json` manifest state.
- SPEC-SAFE-003 [ADDRESSED]: unsafe generated SVG must not succeed.
- SPEC-EDGE-001 [ADDRESSED], SPEC-EDGE-002 [ADDRESSED], SPEC-EDGE-003 [ADDRESSED].
- SPEC-PLAN-001 [ADDRESSED], SPEC-PLAN-015 [ADDRESSED], SPEC-PLAN-016 [ADDRESSED].

Goal:
Add a tested core extractor that converts inline SVG elements in static HTML into deterministic SVG/PNG files plus `icons.json`.

Change Type:
add

TDD Applicable: yes

Files:
- Create: `packages/core/src/artifact-icon-extraction.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/tests/artifact-icon-extraction.test.ts`

Skeleton:
```typescript
test("extracts deterministic svg/png assets and manifest entries", async () => {
  const html = `<button aria-label="Close"><svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M1 1h22v22H1z"/></svg></button>`;
  const result = await extractIconAssets(html, {
    artifactId: "A-asset1",
    productId: "P-abc123",
    requirementId: "R-12345678",
    pageId: "home",
    version: 3,
    generatedFrom: "requirement-archive"
  });
  expect(result.manifest.icons[0]).toMatchObject({
    id: "close",
    usesCurrentColor: true,
    sourceOrderFirst: 0,
    files: {
      svg: expect.stringMatching(/^icons\\/close-[a-f0-9]{16}\\.svg$/),
      png: {
        "1x": expect.stringMatching(/@1x\\.png$/),
        "2x": expect.stringMatching(/@2x\\.png$/),
        "3x": expect.stringMatching(/@3x\\.png$/)
      }
    }
  });
});
```

Steps:
- [ ] red: Add tests for deterministic names, relative paths, manifest top-level metadata, density keys, `currentColor`, zero-icon pages, duplicate SVG dedupe, width/height from `viewBox`, transparent PNG output, and unsafe SVG rejection.
- [ ] red: Add a test that duplicate SVG content shares one physical file set while preserving occurrence/source order data.
- [ ] green: Implement `extractIconAssets(html, metadata, options?)` using `node-html-parser`, SHA-256 16-character content hashes, `sharp` SVG input to PNG buffers, and existing SVG static safety validation.
- [ ] green: Return a `Map<string, Buffer>` keyed by relative paths under `icons/`, plus a typed manifest object.
- [ ] green: Keep PNG output transparent and do not inject contextual foreground color for `currentColor`.
- [ ] verify: Run `pnpm vitest run packages/core/tests/artifact-icon-extraction.test.ts`.

Verification:
Unit tests prove SPEC-IF-001 [ADDRESSED], SPEC-DATA-006 [ADDRESSED], SPEC-SAFE-003 [ADDRESSED], and edge cases.

Rollback / Safety:
No persistent state is written by this extractor. Stop if unsafe SVG validation cannot be reused or equivalently enforced.

### PLAN-TASK-004: Add requirement icon export with temp publish and retry replacement

Spec References:
- SPEC-FR-001 [ADDRESSED]: complete page-level icons before archive success.
- SPEC-DATA-001 [ADDRESSED]: generated sibling state.
- SPEC-DATA-004 [ADDRESSED]: retry replaces stale outputs.
- SPEC-ERR-001 [ADDRESSED]: icon extraction/write failures fail archive.
- SPEC-EDGE-005 [ADDRESSED]: existing generated `icons/` or `vzi/` from a previous failed attempt are cleared/replaced during retry.
- SPEC-PLAN-002 [ADDRESSED], SPEC-PLAN-014 [ADDRESSED].

Goal:
Generate `icons/` for every design pointer in a requirement using temp directories and atomic publish semantics.

Change Type:
add

TDD Applicable: yes

Files:
- Create: `packages/core/src/requirement-icon-export.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/tests/requirement-icon-export.test.ts`

Skeleton:
```typescript
test("replaces stale icons and fails the whole export on one page failure", async () => {
  const result = await exportRequirementIcons(deps, {
    productId: "P-abc123",
    requirementId: "R-12345678",
    generatedFrom: "requirement-archive"
  });
  expect(result.totalIcons).toBe(2);
  await expect(readFile(join(artifactDir, "icons", "icons.json"), "utf8")).resolves.toContain("\"sourceVersion\": 2");
});
```

Steps:
- [ ] red: Add tests for multi-page filtering by `requirementId`, zero-icon page manifest, stale output replacement, temp directory cleanup on extractor failure, and whole-export failure on one page error.
- [ ] green: Implement `exportRequirementIcons(deps, input)` with narrow dependencies for products root, design pointer listing, version directory resolution, file reads, and file writes.
- [ ] green: Write output to a temp sibling under the artifact dir, remove old `icons/`, and rename temp to `icons/`.
- [ ] green: Return `{ pages:[{pageId, artifactId, version, count, manifest }], totalIcons }` for archive/VZI orchestration.
- [ ] verify: Run `pnpm vitest run packages/core/tests/requirement-icon-export.test.ts`.

Verification:
Tests prove retry, temp publish, stale output replacement, and failure semantics for SPEC-DATA-004 [ADDRESSED], SPEC-EDGE-005 [ADDRESSED], and SPEC-ERR-001 [ADDRESSED].

Rollback / Safety:
Generated `icons/` is additive. Stop if implementation needs to modify `v{n}/index.html` or `v{n}/manifest.json`.

### PLAN-TASK-005: Add VZI capture and combined archive asset orchestration

Spec References:
- SPEC-FR-002 [ADDRESSED], SPEC-FR-003 [ADDRESSED]: archive assets complete before status commit.
- SPEC-IF-002 [ADDRESSED]: VZI output interface.
- SPEC-DATA-002 [ADDRESSED]: viewport mapping.
- SPEC-DATA-003 [ADDRESSED]: VZI resource refs derive from icon manifest.
- SPEC-OBS-003 [ADDRESSED]: default viewport fallback is observable through `viewportSource`.
- SPEC-ERR-001 [ADDRESSED], SPEC-ERR-002 [ADDRESSED], SPEC-ERR-003 [ADDRESSED].
- SPEC-EDGE-004 [ADDRESSED], SPEC-EDGE-005 [ADDRESSED], SPEC-EDGE-007 [ADDRESSED].
- SPEC-PLAN-004 [ADDRESSED], SPEC-PLAN-013 [ADDRESSED], SPEC-PLAN-014 [ADDRESSED].

Goal:
Capture one `vzi/page.vzi` per final page after icon export, with metadata, viewport mapping, and fail-loud icon resource linking.

Change Type:
add

TDD Applicable: yes

Files:
- Create: `packages/core/src/requirement-vzi-capture.ts`
- Create: `packages/core/src/archive-asset-export.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/tests/requirement-vzi-capture.test.ts`
- Create: `packages/core/tests/archive-asset-export.test.ts`

Skeleton:
```typescript
test("captures vzi with viewport metadata and icon asset refs", async () => {
  const result = await exportArchiveAssets(deps, {
    productId: "P-abc123",
    requirementId: "R-12345678"
  });
  expect(result.vzi.pages[0]).toMatchObject({ elementCount: expect.any(Number) });
  const decoded = await decodeVziFromFile(join(artifactDir, "vzi", "page.vzi"));
  expect(decoded.metadata.viewport).toMatchObject({ width: 390, height: 884 });
  expect(await fileExists(resolveAssetRef(decoded, "close"))).toBe(true);
});
```

Steps:
- [ ] red: Add viewport mapping tests for `mobile`, `tablet`, `desktop`, `web`, and missing platform default with observable `viewportSource`.
- [ ] red: Add a parse/transform/encode/decode smoke test using a Forma design-page HTML fixture containing text, layout, inline SVG, and at least one resource.
- [ ] red: Add tests that VZI/icon mapping resolves to generated icon files and mismatch fails before archive commit.
- [ ] green: Implement `captureRequirementVzi(deps, input, iconExportResult)` using the vendored Puppeteer parser, transformer, and encoder.
- [ ] green: Build VZI metadata with product/page/artifact/source version, platform, viewport, viewportSource, and generation source.
- [ ] green: Publish `vzi/page.vzi` through temp directory replace semantics.
- [ ] green: Implement `exportArchiveAssets` so phase 1 runs icons first, then VZI, and returns `{ icons, vzi }`.
- [ ] verify: Run `pnpm vitest run packages/core/tests/requirement-vzi-capture.test.ts packages/core/tests/archive-asset-export.test.ts`.

Verification:
Core tests prove SPEC-IF-002 [ADDRESSED], SPEC-DATA-002 [ADDRESSED], SPEC-DATA-003 [ADDRESSED], SPEC-OBS-003 [ADDRESSED], SPEC-EDGE-005 [ADDRESSED], SPEC-ERR-002 [ADDRESSED], and SPEC-ERR-003 [ADDRESSED].

Rollback / Safety:
Generated VZI is additive. Stop if VZI capture requires a lightweight geometry fallback or changes approved viewport mapping.

### PLAN-TASK-006: Wire archive route to generate assets before committing archived status

Spec References:
- SPEC-FR-002 [ADDRESSED]: status becomes archived only after assets succeed.
- SPEC-IF-008 [ADDRESSED]: archive HTTP response summary.
- SPEC-DATA-004 [ADDRESSED]: archive state transition.
- SPEC-ERR-001 [ADDRESSED], SPEC-ERR-006 [ADDRESSED].
- SPEC-SAFE-002 [ADDRESSED]: mutation origin and ownership checks preserved.
- SPEC-ACC-001 [ADDRESSED], SPEC-ACC-002 [ADDRESSED], SPEC-ACC-007 [ADDRESSED].
- SPEC-PLAN-002 [ADDRESSED], SPEC-PLAN-005 [ADDRESSED].

Goal:
Modify the Fastify archive route so generated handoff outputs are produced before `archiveRequirement` writes status.

Change Type:
modify

TDD Applicable: yes

Files:
- Modify: `packages/server/src/routes.ts`
- Modify: `packages/server/tests/routes.test.ts`
- Modify: `packages/web/src/api.ts`
- Modify: `packages/web/src/api.test.ts`

Skeleton:
```typescript
it("archives only after archive assets are generated", async () => {
  const response = await app.inject({
    method: "PUT",
    url: "/api/products/P-abc123/requirements/R-12345678/archive",
    headers: mutationOriginHeaders
  });
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body)).toMatchObject({
    requirement: { status: "archived" },
    icons: { totalIcons: 2 },
    vzi: { totalElements: expect.any(Number) }
  });
});
```

Steps:
- [ ] red: Add server tests where asset generation succeeds before archive status commit.
- [ ] red: Add server tests where injected icon/VZI generation failure leaves status non-archived and returns a retryable error envelope.
- [ ] red: Add tests preserving mutation origin check, product ownership check, and existing non-`active` rejection behavior.
- [ ] green: Extend `FormaRoutesStore` or route dependency wiring so the archive route can call `exportArchiveAssets`.
- [ ] green: In `PUT /api/products/:id/requirements/:reqId/archive`, keep `checkMutationOrigin` and `getOwnedRequirement`, precheck active through existing requirement status data, run `exportArchiveAssets`, then call `store.requirements.archiveRequirement`.
- [ ] green: Return `{ requirement, icons, vzi }` while preserving server error envelope on failure.
- [ ] green: Update web API response typing to parse the new archive response shape.
- [ ] verify: Run `pnpm vitest run packages/server/tests/routes.test.ts packages/web/src/api.test.ts`.

Verification:
Integration tests prove archive status commit order, response summaries, and preserved mutation safety.

Rollback / Safety:
Reverting this route change restores old archive behavior. Stop if the route needs to weaken ownership or origin checks.

### PLAN-TASK-007: Update web archive feedback for generated asset summaries

Spec References:
- SPEC-IF-008 [ADDRESSED]: archive response includes icons and VZI summaries.
- SPEC-OBS-001 [ADDRESSED]: successful archive responses expose counts.
- SPEC-OBS-002 [ADDRESSED]: archive errors expose retryable context.
- SPEC-ACC-001 [ADDRESSED], SPEC-ACC-007 [ADDRESSED].
- SPEC-PLAN-005 [ADDRESSED].

Goal:
Show archive success/failure feedback that reflects generated page/icon/element counts while preserving existing loading state.

Change Type:
modify

TDD Applicable: yes

Files:
- Modify: `packages/web/src/pages/ProductDetail.tsx`
- Modify: `packages/web/src/pages/ProductDetail.test.tsx`
- Modify: `packages/web/src/i18n.ts`

Skeleton:
```typescript
it("shows archive generated asset counts after successful archive", async () => {
  client.archiveRequirement.mockResolvedValueOnce({
    requirement: archivedRequirement,
    icons: { pages: [{ pageId: "home", artifactId: "A-asset1", count: 2 }], totalIcons: 2 },
    vzi: { pages: [{ pageId: "home", artifactId: "A-asset1", elementCount: 42 }], totalElements: 42 }
  });
  root.render(<ProductDetail client={client} params={{ productId: "P-abc123" }} />);
  await clickArchive();
  expect(screen.getByText(/2/)).toBeTruthy();
  expect(screen.getByText(/42/)).toBeTruthy();
});
```

Steps:
- [ ] red: Add a ProductDetail test for successful archive count feedback.
- [ ] red: Add a ProductDetail test for retryable archive generation errors using the existing `actionError` area.
- [ ] green: Store and render a concise archive completion message using `icons.totalIcons`, `icons.pages.length`, and `vzi.totalElements`.
- [ ] green: Keep `archiving` disabled/loading behavior unchanged while archive is in flight.
- [ ] green: Add English and Simplified Chinese i18n strings for archive asset counts.
- [ ] verify: Run `pnpm vitest run packages/web/src/pages/ProductDetail.test.tsx packages/web/src/i18n.test.ts`.

Verification:
Web tests prove SPEC-OBS-001 [ADDRESSED] and SPEC-OBS-002 [ADDRESSED] without changing existing navigation or requirement reload behavior.

Rollback / Safety:
UI change is additive. Stop if count display requires changing the archive API beyond SPEC-IF-008 [ADDRESSED].

### PLAN-TASK-008: Add gated development MCP handoff and VZI read tools

Spec References:
- SPEC-FR-004 [ADDRESSED]: development MCP handoff serves only archived requirements.
- SPEC-IF-003 [ADDRESSED], SPEC-IF-004 [ADDRESSED], SPEC-IF-005 [ADDRESSED], SPEC-IF-006 [ADDRESSED].
- SPEC-DATA-005 [ADDRESSED]: read-only VZI data.
- SPEC-ERR-004 [ADDRESSED]: missing generated handoff files are explicit errors.
- SPEC-SAFE-001 [ADDRESSED], SPEC-SAFE-006 [ADDRESSED].
- SPEC-COMPAT-007 [ADDRESSED].
- SPEC-ACC-003 [ADDRESSED], SPEC-ACC-004 [ADDRESSED], SPEC-ACC-006 [ADDRESSED].
- SPEC-PLAN-006 [ADDRESSED], SPEC-PLAN-007 [ADDRESSED], SPEC-PLAN-013 [ADDRESSED].

Goal:
Expose `get_design_handoff`, `get_page_ui`, `get_ui_node`, and `search_page_ui` through Forma MCP with archived gate and VZI/icon asset path resolution.

Change Type:
add

TDD Applicable: yes

Files:
- Modify: `packages/mcp/src/tools.ts`
- Create: `packages/mcp/src/design-handoff.ts`
- Modify: `packages/mcp/src/vzi-read-layer.ts`
- Modify: `packages/mcp/src/vzi-read-schemas.ts`
- Modify: `packages/mcp/tests/tools.test.ts`

Skeleton:
```typescript
it("get_design_handoff rejects non-archived requirements", async () => {
  const tools = createFormaTools(storeWithRequirement({ status: "active" }));
  await expect(tools.get_design_handoff({ requirement_id: "R-12345678" }))
    .rejects.toMatchObject({ code: "REQUIREMENT_NOT_FINALIZED" });
});

it("get_page_ui returns resolved icon asset refs for archived VZI data", async () => {
  const result = await tools.get_page_ui({
    requirement_id: "R-12345678",
    page_id: "home",
    depth: 2,
    fields: "all"
  });
  expect(result.tree[0].assetRef).toMatch(/^\\/.*\\/od-project\\/artifacts\\/.*\\/icons\\//);
});
```

Steps:
- [ ] red: Add MCP tests for non-archived rejection, archived handoff success, missing generated files, page UI depth/fields/node root behavior, node detail, search results, and resolved icon `assetRef`.
- [ ] green: Add schemas and tool names for the four dev handoff tools.
- [ ] green: Implement requirement-id lookup through existing requirement APIs; if product lookup without `product_id` is not feasible, stop and route upstream rather than adding `product_id`.
- [ ] green: Gate every new dev tool on `requirement.status === "archived"` and return `REQUIREMENT_NOT_FINALIZED` otherwise.
- [ ] green: Resolve design pointers for the requirement, compute `indexHtmlPath`, `vziPath`, and icon counts from generated manifests.
- [ ] green: Decode VZI through the vendored read layer and project overview/tree/node/search JSON with absolute same-machine asset paths inside artifact/export roots.
- [ ] green: Ensure all new MCP tools are read-only.
- [ ] verify: Run `pnpm vitest run packages/mcp/tests/tools.test.ts`.

Verification:
MCP tests prove gate behavior, read-only handoff, path safety, and VZI asset resolution.

Rollback / Safety:
Remove new tool registrations and templates to rollback. Stop if a generated path would point outside expected Forma roots.

### PLAN-TASK-009: Add manual `export_artifact` formats for `icons` and `vzi`

Spec References:
- SPEC-FR-007 [ADDRESSED]: manual export for debugging.
- SPEC-IF-007 [ADDRESSED]: `icons`/`vzi` export interface.
- SPEC-ERR-005 [ADDRESSED]: manual export failure does not change requirement status.
- SPEC-COMPAT-004 [ADDRESSED]: existing export behavior remains compatible.
- SPEC-EDGE-006 [ADDRESSED].
- SPEC-PLAN-008 [ADDRESSED].

Goal:
Extend existing MCP `export_artifact` with `icons` and `vzi` formats without treating manual export as archive success.

Change Type:
modify

TDD Applicable: yes

Files:
- Modify: `packages/mcp/src/tools.ts`
- Modify: `packages/mcp/tests/tools.test.ts`
- Modify: `packages/od-contracts/src/api/artifacts.ts`

Skeleton:
```typescript
it("export_artifact icons returns generated export path without archiving", async () => {
  const result = await tools.export_artifact({
    product_id: "P-abc123",
    artifact_id: "A-asset1",
    format: "icons"
  });
  expect(result.output_path).toContain("/exports/P-abc123/");
  expect(requirements.archiveRequirement).not.toHaveBeenCalled();
});
```

Steps:
- [ ] red: Add tests for `format: "icons"` and `format: "vzi"` output paths.
- [ ] red: Add regression tests that existing `html`, `svg`, `png`, and `zip` formats still return their prior shapes and unsupported formats still fail.
- [ ] green: Extend the `exportArtifactSchema.format` enum and `ArtifactExportKind`.
- [ ] green: For `icons`, generate or copy icon output for the selected current artifact version into an export directory and return its path.
- [ ] green: For `vzi`, generate or copy VZI output for the selected current artifact version into an export directory and return its path.
- [ ] green: Do not call `archiveRequirement` and do not write requirement status in manual export paths.
- [ ] verify: Run `pnpm vitest run packages/mcp/tests/tools.test.ts`.

Verification:
MCP export tests prove SPEC-IF-007 [ADDRESSED], SPEC-ERR-005 [ADDRESSED], and SPEC-COMPAT-004 [ADDRESSED].

Rollback / Safety:
Remove enum values and export branches to rollback. Stop if manual export requires altering archive status or immutable version directories.

### PLAN-TASK-010: Preserve existing HTTP and design MCP access

Spec References:
- SPEC-FR-005 [ADDRESSED]: HTTP preview/admin clients remain available.
- SPEC-FR-006 [ADDRESSED]: existing MCP design tools remain available.
- SPEC-COMPAT-001 [ADDRESSED], SPEC-COMPAT-002 [ADDRESSED].
- SPEC-ACC-005 [ADDRESSED].
- SPEC-PLAN-009 [ADDRESSED], SPEC-PLAN-010 [ADDRESSED].

Goal:
Protect existing active-design access paths from accidental archived gating.

Change Type:
preserve

TDD Applicable: yes

Files:
- Modify: `packages/server/tests/routes.test.ts`
- Modify: `packages/mcp/tests/tools.test.ts`
- Modify: `packages/web/src/viewer/resolver.test.ts` if HTTP bundle resolver coverage needs extension

Skeleton:
```typescript
it("existing get_product_artifact can still read an active design artifact", async () => {
  const tools = createFormaTools(storeWithRequirement({ status: "active" }));
  await expect(tools.get_product_artifact({
    product_id: "P-abc123",
    artifact_id: "A-asset1"
  })).resolves.toMatchObject({ current_version: 1 });
});
```

Steps:
- [ ] red: Add or strengthen HTTP route tests for active design bundle/preview access after the new dev handoff gate exists.
- [ ] red: Add MCP regression tests proving `get_product_artifact`, `export_artifact` existing formats, `get_design_context`, and design generation/change tools are not gated by archive status.
- [ ] green: Keep archived-status checks scoped only to new development handoff tools from PLAN-TASK-008.
- [ ] verify: Run `pnpm vitest run packages/server/tests/routes.test.ts packages/mcp/tests/tools.test.ts`.

Verification:
Regression tests prove SPEC-COMPAT-001 [ADDRESSED] and SPEC-COMPAT-002 [ADDRESSED].

Rollback / Safety:
This is preserve coverage. Stop if implementation requires gating or removing any existing design creation/inspection tool.

### PLAN-TASK-011: Add development agent template guidance

Spec References:
- SPEC-SAFE-001 [ADDRESSED]: gate is soft isolation and must be documented as a guard, not hard authorization.
- SPEC-FR-004 [ADDRESSED]: development handoff uses archived requirements only.
- SPEC-IF-003 [ADDRESSED], SPEC-IF-004 [ADDRESSED], SPEC-IF-005 [ADDRESSED].

Goal:
Add development-consumption templates that instruct agents to use `get_design_handoff` and VZI page tools instead of active-design creation tools.

Change Type:
add

TDD Applicable: no

Files:
- Create: `packages/agent/templates/claude/fm-develop-design-handoff.md`
- Create: `packages/agent/templates/codex/fm-develop-design-handoff/SKILL.md`
- Create: `packages/agent/templates/gemini/fm-develop-design-handoff.toml`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/cli/tests/design-commands.test.ts`
- Modify: `packages/mcp/src/tools.ts`

Skeleton:
```text
Development handoff workflow:
1. Call get_design_handoff(requirement_id).
2. If REQUIREMENT_NOT_FINALIZED is returned, stop and ask for finalized/archive status.
3. For each page, call get_page_ui(requirement_id, page_id, { fields: "all", depth: 2 }).
4. Use get_ui_node only for deeper node detail.
```

Steps:
- [ ] Add templates for Claude, Codex, and Gemini that describe the development handoff workflow and soft-gate semantics.
- [ ] Update template installation/index code so the new templates are packaged with `packages/agent`.
- [ ] Update MCP `help` guidance so `workflows.develop_frontend` starts with `get_design_handoff` and page UI reads.
- [ ] Add CLI/template tests that the new template names are present and mention `get_design_handoff`.
- [ ] verify: Run `pnpm vitest run packages/cli/tests/design-commands.test.ts packages/mcp/tests/tools.test.ts`.

Verification:
Template and MCP help tests prove the soft-gate workflow is discoverable without changing runtime authorization.

Rollback / Safety:
Remove templates/help additions to rollback. Stop if template wording claims hard security isolation.

### PLAN-TASK-012: Run dependency, import-boundary, and full verification checks

Spec References:
- SPEC-SAFE-004 [ADDRESSED]: dependency behavior verified.
- SPEC-SAFE-005 [ADDRESSED]: renderer no runtime import.
- SPEC-COMPAT-006 [ADDRESSED], SPEC-COMPAT-008 [ADDRESSED].
- SPEC-PLAN-011 [ADDRESSED], SPEC-PLAN-012 [ADDRESSED], SPEC-PLAN-017 [ADDRESSED].

Goal:
Close the cross-package dependency and runtime safety risk with deterministic checks after implementation tasks land.

Change Type:
preserve

TDD Applicable: no

Files:
- Create: `scripts/check-vzi-renderer-boundary.mjs`
- Modify: `package.json`

Skeleton:
```bash
pnpm --filter @vzi-core/types build
pnpm --filter @vzi-core/parser build
pnpm --filter @vzi-core/transformer build
pnpm --filter @vzi-core/format build
pnpm --filter @vzi-core/renderer build
if rg -n '@vzi-core/renderer|canvaskit-wasm' packages/core packages/server packages/cli packages/mcp/src; then
  exit 1
fi
pnpm build
pnpm typecheck
pnpm test
```

Steps:
- [ ] Add `scripts/check-vzi-renderer-boundary.mjs` so it fails if `@vzi-core/renderer` or `canvaskit-wasm` is imported by `packages/core`, `packages/server`, `packages/cli`, or MCP handoff runtime code.
- [ ] Run vendored package builds individually.
- [ ] Run focused test files from PLAN-TASK-002 through PLAN-TASK-011.
- [ ] Run `pnpm build`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] If a dependency version changed from SPEC's checked versions, re-run current official/Context7 documentation checks before fixing code that relies on that dependency.

Verification:
All listed checks pass. Import-boundary check has no matches in forbidden runtime paths.

Rollback / Safety:
If full verification fails after focused tests pass, stop and isolate the failing package/test before continuing. Do not weaken or skip import-boundary checks to get a green build.

## Task Granularity
- Each task is independently executable and independently verifiable at a package or boundary level.
- PLAN-TASK-001 is vendor/build boundary only; it must not wire archive behavior.
- PLAN-TASK-002 through PLAN-TASK-005 build core behavior before server/MCP callers use it.
- PLAN-TASK-006 and PLAN-TASK-007 cover HTTP/web integration after core behavior exists.
- PLAN-TASK-008 through PLAN-TASK-011 cover MCP/templates after generated handoff files exist.
- PLAN-TASK-012 is a final cross-package verification and safety boundary check, not a feature implementation task.

## TDD Decomposition
| Task | SPEC Contract | TDD Applicable | Steps | Alternative Verification |
|---|---|---|---|---|
| PLAN-TASK-001 | SPEC-COMPAT-008 [ADDRESSED], SPEC-SAFE-004 [ADDRESSED], SPEC-SAFE-005 [ADDRESSED] | no | Package vendoring is mechanical source migration. | Individual package builds and import-boundary checks. |
| PLAN-TASK-002 | SPEC-DATA-001 [ADDRESSED], SPEC-COMPAT-003 [ADDRESSED] | yes | red path/listing tests -> green helper functions -> targeted tests. | N/A |
| PLAN-TASK-003 | SPEC-IF-001 [ADDRESSED], SPEC-DATA-006 [ADDRESSED], SPEC-SAFE-003 [ADDRESSED] | yes | red extraction/manifest/safety tests -> green extractor -> targeted tests. | N/A |
| PLAN-TASK-004 | SPEC-DATA-004 [ADDRESSED], SPEC-ERR-001 [ADDRESSED] | yes | red multi-page/temp/retry tests -> green exporter -> targeted tests. | N/A |
| PLAN-TASK-005 | SPEC-IF-002 [ADDRESSED], SPEC-DATA-002 [ADDRESSED], SPEC-DATA-003 [ADDRESSED] | yes | red VZI smoke/mapping tests -> green capture/orchestrator -> targeted tests. | N/A |
| PLAN-TASK-006 | SPEC-FR-002 [ADDRESSED], SPEC-IF-008 [ADDRESSED], SPEC-SAFE-002 [ADDRESSED] | yes | red archive route success/failure tests -> green route orchestration -> targeted tests. | N/A |
| PLAN-TASK-007 | SPEC-OBS-001 [ADDRESSED], SPEC-OBS-002 [ADDRESSED] | yes | red UI feedback tests -> green UI/i18n -> targeted tests. | N/A |
| PLAN-TASK-008 | SPEC-IF-003 [ADDRESSED] through SPEC-IF-006 [ADDRESSED] | yes | red MCP gate/read tests -> green tools/read layer -> targeted tests. | N/A |
| PLAN-TASK-009 | SPEC-IF-007 [ADDRESSED], SPEC-COMPAT-004 [ADDRESSED] | yes | red export format tests -> green export branches -> targeted tests. | N/A |
| PLAN-TASK-010 | SPEC-COMPAT-001 [ADDRESSED], SPEC-COMPAT-002 [ADDRESSED] | yes | red/preserve regression tests -> keep gate scoped -> targeted tests. | N/A |
| PLAN-TASK-011 | SPEC-SAFE-001 [ADDRESSED] | no | Template guidance is documentation/package content. | Template presence tests and MCP help tests. |
| PLAN-TASK-012 | SPEC-SAFE-004 [ADDRESSED], SPEC-COMPAT-006 [ADDRESSED] | no | Final verification task. | Build, typecheck, tests, and import-boundary checks. |

## Execution Sequencing
| Order | Task | Depends On | Why This Order | Safe Checkpoint |
|---|---|---|---|---|
| 1 | PLAN-TASK-001 | none | Vendored VZI packages must exist before VZI capture/read code imports them. | VZI packages build individually. |
| 2 | PLAN-TASK-002 | none | Path helpers are low-risk and unblock generated output writers. | Core path/store targeted tests pass. |
| 3 | PLAN-TASK-003 | PLAN-TASK-002 optional | Icon extractor is pure and should be correct before archive writes files. | Icon extraction targeted tests pass. |
| 4 | PLAN-TASK-004 | PLAN-TASK-002, PLAN-TASK-003 | Requirement icon export depends on extractor and paths. | Requirement icon export tests pass. |
| 5 | PLAN-TASK-005 | PLAN-TASK-001, PLAN-TASK-004 | VZI capture needs VZI packages and icon manifests. | VZI capture and archive asset tests pass. |
| 6 | PLAN-TASK-006 | PLAN-TASK-005 | Server archive route should call the finished combined orchestrator. | Server route/API tests pass. |
| 7 | PLAN-TASK-007 | PLAN-TASK-006 | Web feedback depends on final archive response shape. | Web ProductDetail/API tests pass. |
| 8 | PLAN-TASK-008 | PLAN-TASK-005 | MCP dev handoff reads generated VZI/icon files. | MCP handoff tests pass. |
| 9 | PLAN-TASK-009 | PLAN-TASK-003, PLAN-TASK-005 | Manual export reuses icon/VZI generation or generated output logic. | MCP export tests pass. |
| 10 | PLAN-TASK-010 | PLAN-TASK-006, PLAN-TASK-008, PLAN-TASK-009 | Preserve tests should run after gates/export changes exist. | HTTP/design MCP regression tests pass. |
| 11 | PLAN-TASK-011 | PLAN-TASK-008 | Templates can reference stable MCP tool names and schemas. | Template/help tests pass. |
| 12 | PLAN-TASK-012 | all prior tasks | Final cross-package verification closes dependency/runtime risk. | Full build/typecheck/test and boundary checks pass. |

## Verification Plan
| Check | Purpose | Command / Method | Expected Result | Covers |
|---|---|---|---|---|
| Core path/storage tests | Generated siblings do not affect versions. | `pnpm vitest run packages/core/tests/artifact-paths.test.ts packages/core/tests/artifact-store.test.ts` | Pass | SPEC-DATA-001 [ADDRESSED], SPEC-COMPAT-003 [ADDRESSED] |
| Icon extraction tests | SVG/PNG/manifest/safety correctness. | `pnpm vitest run packages/core/tests/artifact-icon-extraction.test.ts` | Pass | SPEC-IF-001 [ADDRESSED], SPEC-DATA-006 [ADDRESSED], SPEC-SAFE-003 [ADDRESSED] |
| Requirement icon export tests | Multi-page/temp/retry behavior. | `pnpm vitest run packages/core/tests/requirement-icon-export.test.ts` | Pass | SPEC-FR-001 [ADDRESSED], SPEC-DATA-004 [ADDRESSED], SPEC-EDGE-005 [ADDRESSED], SPEC-ERR-001 [ADDRESSED] |
| VZI capture/orchestration tests | Viewport, decode, bounds, asset refs. | `pnpm vitest run packages/core/tests/requirement-vzi-capture.test.ts packages/core/tests/archive-asset-export.test.ts` | Pass | SPEC-IF-002 [ADDRESSED], SPEC-DATA-002 [ADDRESSED], SPEC-DATA-003 [ADDRESSED], SPEC-OBS-003 [ADDRESSED], SPEC-EDGE-005 [ADDRESSED] |
| Server archive tests | Success/failure/status commit order. | `pnpm vitest run packages/server/tests/routes.test.ts` | Pass | SPEC-FR-002 [ADDRESSED], SPEC-IF-008 [ADDRESSED], SPEC-SAFE-002 [ADDRESSED] |
| Web API/UI tests | Response typing and count/error feedback. | `pnpm vitest run packages/web/src/api.test.ts packages/web/src/pages/ProductDetail.test.tsx packages/web/src/i18n.test.ts` | Pass | SPEC-OBS-001 [ADDRESSED], SPEC-OBS-002 [ADDRESSED] |
| MCP tool tests | Dev gate, VZI reads, export formats, preserve old tools. | `pnpm vitest run packages/mcp/tests/tools.test.ts` | Pass | SPEC-IF-003 [ADDRESSED] through SPEC-IF-007 [ADDRESSED], SPEC-COMPAT-002 [ADDRESSED] |
| CLI/template tests | Development template packaging. | `pnpm vitest run packages/cli/tests/design-commands.test.ts` | Pass | SPEC-SAFE-001 [ADDRESSED] |
| Vendored package builds | VZI packages compile independently. | `pnpm --filter @vzi-core/types build && pnpm --filter @vzi-core/parser build && pnpm --filter @vzi-core/transformer build && pnpm --filter @vzi-core/format build && pnpm --filter @vzi-core/renderer build` | Pass | SPEC-COMPAT-008 [ADDRESSED] |
| Renderer import boundary | CanvasKit/renderer not in runtime paths. | `rg -n '@vzi-core/renderer|canvaskit-wasm' packages/core packages/server packages/cli packages/mcp/src` plus an automated test/script if added | No forbidden runtime imports | SPEC-SAFE-005 [ADDRESSED], SPEC-COMPAT-006 [ADDRESSED] |
| Workspace build | Cross-package build integration. | `pnpm build` | Pass | SPEC-SAFE-004 [ADDRESSED] |
| Workspace typecheck | Type safety across packages. | `pnpm typecheck` | Pass | SPEC-SAFE-004 [ADDRESSED] |
| Full tests | Regression coverage. | `pnpm test` | Pass | all acceptance scenarios |

## Rollback / Safety Plan
| Risky Area | Safety Constraint | Rollback Method | Stop Condition | Verification |
|---|---|---|---|---|
| Vendored VZI packages | Include only approved source areas and preserve package names. | Remove `packages/vzi-*`, read-layer files, dependency entries, and lockfile changes. | Need to include Figma/platform/quality-lab/standalone MCP server. | Package-boundary and build checks. |
| Generated `icons/`/`vzi/` output | Never modify `v{n}` or artifact manifests. | Delete generated sibling dirs or remove generator calls; old versions remain intact. | Implementation needs to edit `v{n}/index.html` or `manifest.json`. | Path/store and archive tests. |
| Archive route orchestration | Status commit must be last. | Revert archive route to direct `archiveRequirement` call. | Any test shows `archived` after generation failure. | Server injected-failure tests. |
| VZI/icon resource linking | Fail loud on mismatch. | Regenerate from HTML after fixing mapping; remove VZI capture call if rollback needed. | Mismatch is silently omitted or wrong asset path is returned. | AssetRef and missing-file tests. |
| Development MCP gate | Soft gate only on new dev tools. | Remove new dev tools/templates; existing tools remain. | Existing design MCP tools become gated or templates claim hard authorization. | MCP regression tests. |
| Renderer dormant package | Renderer must not enter server/CLI/core/MCP runtime. | Remove renderer package or dependency if import boundary fails. | `@vzi-core/renderer` or `canvaskit-wasm` appears in forbidden runtime paths. | Import-boundary check. |
| Manual export | Must not imply finalized/archive success. | Remove `icons`/`vzi` export branches. | Manual export mutates requirement status or writes immutable version dirs. | MCP export tests. |

## Stop / Escalation Conditions
| Condition | Stop / Escalate | Responsible Stage | Required Action |
|---|---|---|---|
| Requirement ID cannot be resolved without `product_id` for MCP dev tools. | Stop and route upstream. | SPEC/DESIGN | Decide whether to add `product_id` or implement lookup helper. |
| VZI parser cannot be made Puppeteer-only without losing required VZI output. | Stop and route upstream. | DESIGN/SPEC | Revisit parser boundary or allowed fallback explicitly. |
| Icon/VZI mapping cannot be validated by document order/content hash. | Stop and route upstream. | DESIGN/SPEC | Define a new matching key or allowed omission behavior. |
| Generated files require modifying immutable `v{n}` directories. | Stop. | DESIGN/SPEC | Rework storage approach or route upstream. |
| Archive success can occur after any page generation failure. | Stop. | PLAN execution | Fix orchestration before continuing. |
| Existing HTTP/design MCP access becomes gated. | Stop. | PLAN execution | Restore preserve behavior before adding new dev gate. |
| Dependency versions change from SPEC external-doc inventory. | Stop for docs check. | PLAN execution | Re-check current docs and update tests/plan if behavior changed. |
| Verification requires skipping required tests/build/import boundary. | Stop. | PLAN execution | Fix the failing check or route upstream; do not weaken verification. |
| Any implementation needs destructive git/file operations or remote mutation. | Stop for user approval. | PLAN execution | Request explicit approval before destructive or external-state change. |

## Traceability
| Source | Source Item | PLAN Coverage | Status |
|---|---|---|---|
| Requirement Brief | Archive-time icons | PLAN-TASK-003, PLAN-TASK-004 | covered |
| Requirement Brief | Archive-time VZI | PLAN-TASK-001, PLAN-TASK-005 | covered |
| Requirement Brief | All-or-nothing archive | PLAN-TASK-005, PLAN-TASK-006 | covered |
| Requirement Brief | Development MCP gate | PLAN-TASK-008, PLAN-TASK-011 | covered |
| Requirement Brief | HTTP/design tools unaffected | PLAN-TASK-010 | covered |
| DESIGN | DES-PLAN-001 [ADDRESSED] | PLAN-TASK-003 | covered |
| DESIGN | DES-PLAN-002 [ADDRESSED] | PLAN-TASK-005, PLAN-TASK-006 | covered |
| DESIGN | DES-PLAN-003 [ADDRESSED] | PLAN-TASK-002 | covered |
| DESIGN | DES-PLAN-004 [ADDRESSED] | PLAN-TASK-005 | covered |
| DESIGN | DES-PLAN-005 [ADDRESSED] | PLAN-TASK-006, PLAN-TASK-007 | covered |
| DESIGN | DES-PLAN-006 [ADDRESSED] | PLAN-TASK-008 | covered |
| DESIGN | DES-PLAN-007 [ADDRESSED] | PLAN-TASK-009 | covered |
| DESIGN | DES-PLAN-008 [ADDRESSED] | PLAN-TASK-010 | covered |
| DESIGN | DES-PLAN-009 [ADDRESSED] | PLAN-TASK-001, PLAN-TASK-012 | covered |
| DESIGN | DES-PLAN-010 [ADDRESSED] | PLAN-TASK-001, PLAN-TASK-012 | covered |
| DESIGN | DES-PLAN-011 [ADDRESSED] | PLAN-TASK-005, PLAN-TASK-008 | covered |
| DESIGN | DES-PLAN-012 [ADDRESSED] | PLAN-TASK-004, Rollback / Safety Plan | covered |
| DESIGN | DES-PLAN-013 [ADDRESSED] | Execution Sequencing | covered |
| SPEC | SPEC-PLAN-001 [ADDRESSED] through SPEC-PLAN-017 [ADDRESSED] | PLAN-TASK-001 through PLAN-TASK-012 | covered |

## PLAN Quality Gate
ready

## PLAN Checkpoint
approved pending checkpoint decision
