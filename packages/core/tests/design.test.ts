import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertSemanticScopeCurrent,
  commitRequirementDesignSession,
  deriveAllowedSemanticSurface,
  diffRequirementDesignVersions,
  exportRequirementDesignAsset,
  getRequirementDesignScene,
  indexRequirementComponentUsage,
  indexRequirementDesignCanvas,
  planImportMetadataNormalization,
  planColorRepairOperations,
  readYaml,
  refreshRequirementComponents,
  requirementDesignPaths,
  resolveRequirementPageFrames,
  rollbackRequirementDesign,
  runDesignQualityPipeline,
  validateLayoutSnapshot,
  validateSemanticScope,
  writeYamlAtomic,
  type DesignQualityReport,
  type Requirement
} from "../src/index.js";

const productId = "P-123abc";
const requirementId = "R-c9b123bf";
const sessionId = "S-1234567890abcdef";

describe("stage 07 requirement design frame mapping", () => {
  it("maps by metadata page id, normalized prefix, and normalized name", () => {
    const requirement = requirementFixture([
      { page_id: "checkout", name: "Checkout" },
      { page_id: "settings", name: "Settings" },
      { page_id: "profile", name: "User Profile" }
    ]);
    const result = resolveRequirementPageFrames(requirement, {
      children: [
        { id: "f1", type: "frame", name: "Anything", metadata: { type: "forma", kind: "page_frame", page_id: "checkout" } },
        { id: "f2", type: "frame", name: "settings - desktop" },
        { id: "f3", type: "frame", name: "User Profile" }
      ]
    });

    expect(result.mappings).toEqual([
      { page_id: "checkout", frame_id: "f1", strategy: "metadata_page_id" },
      { page_id: "settings", frame_id: "f2", strategy: "normalized_frame_prefix" },
      { page_id: "profile", frame_id: "f3", strategy: "normalized_name" }
    ]);
  });

  it("returns stable frame mapping errors and classifies unmanaged components", () => {
    const requirement = requirementFixture([{ page_id: "home", name: "Home" }]);
    expect(() => resolveRequirementPageFrames(requirement, {
      children: [
        { id: "f1", type: "frame", name: "home desktop" },
        { id: "f2", type: "frame", name: "home mobile" }
      ]
    })).toThrow(expect.objectContaining({ code: "PAGE_FRAME_AMBIGUOUS" }));

    expect(() => resolveRequirementPageFrames(requirementFixture([
      { page_id: "home", name: "Home" },
      { page_id: "search", name: "Search" }
    ]), {
      children: [{ id: "f1", type: "frame", name: "Search", metadata: { type: "forma", kind: "page_frame", page_id: "home" } }]
    })).toThrow(expect.objectContaining({ code: "PAGE_FRAME_MISMATCH" }));

    expect(() => resolveRequirementPageFrames(requirement, {
      children: [{ id: "other", type: "frame", name: "Other" }]
    })).toThrow(expect.objectContaining({ code: "PAGE_FRAME_NOT_FOUND" }));

    const unmanaged = resolveRequirementPageFrames(requirement, {
      children: [
        { id: "home-frame", type: "frame", name: "home" },
        { id: "divider", type: "component", name: "Divider", reusable: true }
      ]
    });
    expect(unmanaged.unmanaged_components).toEqual([
      { node_id: "divider", name: "Divider", classification: "unmanaged_component_candidate" }
    ]);
  });
});

describe("stage 07 requirement design model", () => {
  it("indexes only requirement-level design.pen and writes relative metadata paths", async () => {
    const home = await createDesignHome();
    await mkdir(join(home, "data", productId, "D-legacy"), { recursive: true });
    await writeFile(join(home, "data", productId, "D-legacy", "design.pen"), "not json");
    await writeFile(join(home, "data", productId, requirementId, "design.pen"), JSON.stringify({
      children: [{ id: "frame-home", type: "frame", name: "Home", metadata: { type: "forma", kind: "page_frame", page_id: "home" } }]
    }));

    const result = await indexRequirementDesignCanvas({ home, product_id: productId, requirement_id: requirementId });
    const paths = requirementDesignPaths(home, productId, requirementId);
    const metadata = await readFile(paths.metadata_file, "utf8");

    expect(result.canvas_version).toBe(1);
    expect(metadata).toContain("canvas_file: design.pen");
    expect(metadata).toContain("preview_file: previews/home@2x.png");
    expect(metadata).toContain("frame_snapshot_file: history/pages/home.p1.pen-fragment");
    expect(metadata).not.toContain(home);
    await expect(exists(join(paths.canvas_history_dir, "canvas.c1.pen"))).resolves.toBe(true);
    await expect(exists(join(paths.page_history_dir, "home.p1.pen-fragment"))).resolves.toBe(true);
  });

  it("keeps indexed pages pending when deterministic quality blocks", async () => {
    const home = await createDesignHome();
    const paths = requirementDesignPaths(home, productId, requirementId);
    await writeFile(paths.canvas_file, JSON.stringify({
      children: [{
        id: "frame-home",
        type: "frame",
        name: "Home",
        fill: "rgb(255, 0, 0)",
        metadata: { type: "forma", kind: "page_frame", page_id: "home" }
      }]
    }));

    const result = await indexRequirementDesignCanvas({
      home,
      product_id: productId,
      requirement_id: requirementId,
      previewExporter: async ({ output_file }) => writeFile(output_file, "preview")
    });
    const requirement = await readYaml<Record<string, unknown>>(join(paths.requirement_dir, "requirement.yaml"));

    expect(result.pages).toEqual([expect.objectContaining({ page_id: "home", status: "pending" })]);
    expect(result).toMatchObject({
      blocked_pages: [expect.objectContaining({ page_id: "home", code: "PENCIL_COLOR_INVALID" })]
    });
    expect(requirement.pages).toEqual([expect.objectContaining({ page_id: "home", design_status: "pending" })]);
    await expect(exists(join(paths.previews_dir, "home@2x.png"))).resolves.toBe(false);
  });

  it("keeps AI visual review warning-only and not_requested neutral", async () => {
    await expect(runDesignQualityPipeline({
      document: { children: [{ id: "n1", fill: "rgb(255, 0, 0)" }] }
    })).resolves.toMatchObject({
      status: "blocked",
      hard_checks: { issues: [expect.objectContaining({ code: "PENCIL_COLOR_INVALID" })] }
    });

    await expect(runDesignQualityPipeline({
      document: { children: [{ id: "n1", fill: "#FF0000" }] },
      ai_visual_review: { status: "skipped", reason: "not_requested" }
    })).resolves.toMatchObject({ status: "passed", warnings: [] });

    await expect(runDesignQualityPipeline({
      document: { children: [{ id: "n1", fill: "#FF0000" }] },
      ai_visual_review: { status: "warning" }
    })).resolves.toMatchObject({ status: "warning", warnings: ["AI_VISUAL_REVIEW_WARNING"] });
  });

  it("plans deterministic color repairs without mutating validation", () => {
    const operations = planColorRepairOperations({ children: [{ id: "n1", fill: "rgba(255, 0, 0, 0.5)" }] });
    expect(operations).toEqual([
      {
        tool: "batch_design",
        args: { node_id: "n1", set: { fill: "#FF000080" } },
        target_node_ids: ["n1"],
        intent: "quality_repair"
      }
    ]);
  });

  it("blocks semantic scope violations before promotion", () => {
    const result = validateSemanticScope({
      document: { children: [{ id: "bad-action", metadata: { action_key: "delete-account" } }] },
      scope: {
        schema_version: 1,
        product_id: productId,
        requirement_id: requirementId,
        language: "default",
        page_ids: ["home"],
        allowed_copy: ["Home"],
        action_keys: ["save"],
        navigation_targets: [],
        field_keys: [],
        component_keys: [],
        visual_states: ["default"],
        existing_node_ids: [],
        baseline_node_ids: [],
        source_contract_hash: "sha256:test"
      }
    });
    expect(result).toMatchObject({
      status: "blocked",
      code: "DESIGN_SCOPE_VIOLATION"
    });
  });

  it("derives scene, component usage, history diff, rollback, and export payloads", async () => {
    const home = await createDesignHome();
    const paths = requirementDesignPaths(home, productId, requirementId);
    await writeFile(paths.canvas_file, JSON.stringify({
      children: [{
        id: "frame-home",
        type: "frame",
        name: "Home",
        metadata: { type: "forma", kind: "page_frame", page_id: "home" },
        children: [
          {
            id: "button-instance",
            type: "instance",
            metadata: {
              type: "forma",
              kind: "component_instance",
              component_key: "button.primary",
              ref_target: "Components - Snapshot v1/button.primary"
            }
          }
        ]
      }]
    }));
    await indexRequirementDesignCanvas({ home, product_id: productId, requirement_id: requirementId });
    await writeFile(join(paths.canvas_history_dir, "canvas.c2.pen"), JSON.stringify({ children: [{ id: "changed" }] }));

    await expect(getRequirementDesignScene({ home, product_id: productId, requirement_id: requirementId })).resolves.toMatchObject({
      canvas: { file: "design.pen", version: 1 },
      pages: [expect.objectContaining({ page_id: "home", frame_id: "frame-home" })]
    });
    await expect(indexRequirementComponentUsage({ home, product_id: productId, requirement_id: requirementId, write: false })).resolves.toMatchObject({
      usages: [expect.objectContaining({ node_id: "button-instance", status: "linked" })]
    });
    await expect(diffRequirementDesignVersions({
      home,
      product_id: productId,
      requirement_id: requirementId,
      from_canvas_version: 1,
      to_canvas_version: 2
    })).resolves.toMatchObject({ changed: true });
    await expect(rollbackRequirementDesign({ home, product_id: productId, requirement_id: requirementId, canvas_version: 1 })).resolves.toMatchObject({
      operation: "rollback"
    });
    await expect(exportRequirementDesignAsset({ home, product_id: productId, requirement_id: requirementId, kind: "canvas" })).resolves.toMatchObject({
      revision: expect.stringMatching(/^sha256:/)
    });
  });

  it("plans metadata-only import normalization and invalidates stale plans", async () => {
    const home = await createDesignHome();
    const paths = requirementDesignPaths(home, productId, requirementId);
    await writeFile(paths.canvas_file, JSON.stringify({ children: [] }));
    await writeRequirementSession(home, JSON.stringify({
      children: [{
        id: "frame-home",
        type: "frame",
        name: "Home",
        children: [{ id: "title", type: "text", text: "Home" }]
      }]
    }));

    await expect(planImportMetadataNormalization({ home, session_id: sessionId, frame_id: "frame-home" })).resolves.toMatchObject({
      status: "planned",
      operations: [{
        tool: "batch_design",
        args: { node_id: "title", metadata: { type: "forma", kind: "text", copy: "Home" } },
        target_node_ids: ["title"],
        intent: "import_metadata_normalization"
      }]
    });

    await writeFile(join(paths.requirement_dir, "sessions", sessionId, "staging.design.pen"), JSON.stringify({
      children: [{ id: "frame-home", type: "frame", name: "Home", children: [{ id: "title", type: "text", text: "Changed" }] }]
    }));
    await expect(planImportMetadataNormalization({ home, session_id: sessionId, frame_id: "frame-home" })).resolves.toMatchObject({
      status: "blocked",
      code: "UNMANAGED_METADATA_NORMALIZATION_REQUIRED",
      unresolved_nodes: ["frame-home"]
    });
  });
});

describe("stage 07 semantic scope derivation", () => {
  it("uses requirement, translations, rules, baseline, product, component library, and current design in allowed surface and hash", async () => {
    const home = await createDesignHome();
    const requirementDir = join(home, "data", productId, requirementId);
    await writeYamlAtomic(join(home, "data", productId, "product.yaml"), {
      id: productId,
      name: "Product",
      description: "Test",
      platform: "web",
      languages: ["en", "zh"],
      default_language: "en"
    });
    await writeYamlAtomic(join(requirementDir, "copy-translations.yaml"), {
      translations: [{ page_id: "home", entries: [{ context: "title", texts: { zh: "首页" } }] }]
    });
    await writeYamlAtomic(join(home, "data", productId, "baseline", "rules.yaml"), {
      rules: [{
        id: `${requirementId}-rule`,
        source_requirement: requirementId,
        given: "copy",
        when: "visible",
        then: "allowed",
        semantic: { allowed_copy: ["规则文案"], actions: [{ key: "rule-action", label: "Rule Action" }], component_keys: ["button.primary"] }
      }]
    });
    await writeYamlAtomic(join(home, "data", productId, "baseline", "baseline.yaml"), {
      product_id: productId,
      pages: [{
        id: "B-home",
        name: "Baseline Home",
        features: "",
        copy: [{ context: "title", text: "Baseline Copy" }],
        fields: "",
        interactions: "",
        source_requirements: [requirementId],
        semantic_contract: {
          fields: [{ key: "baseline-field", label: "Baseline Field" }],
          actions: [],
          navigation: [],
          component_keys: ["button.primary"],
          allowed_copy: ["Baseline Copy"]
        },
        semantic_contract_coverage: "explicit"
      }],
      navigation: []
    });

    const scope = await deriveAllowedSemanticSurface({
      home,
      product_id: productId,
      requirement_id: requirementId,
      language: "zh",
      current_design: { children: [{ id: "existing-node" }] }
    });

    expect(scope.allowed_copy).toEqual(expect.arrayContaining(["Home", "首页", "规则文案", "Baseline Copy"]));
    expect(scope.action_keys).toEqual(expect.arrayContaining(["save", "rule-action"]));
    expect(scope.field_keys).toContain("baseline-field");
    expect(scope.component_keys).toEqual(["button.primary"]);
    expect(scope.baseline_node_ids).toEqual(expect.arrayContaining(["B-home"]));
    expect(scope.existing_node_ids).toContain("existing-node");

    await writeYamlAtomic(join(requirementDir, "copy-translations.yaml"), {
      translations: [{ page_id: "home", entries: [{ context: "title", texts: { zh: "新的首页" } }] }]
    });
    await expect(assertSemanticScopeCurrent({ home, product_id: productId, requirement_id: requirementId, scope })).rejects.toMatchObject({ code: "SEMANTIC_SCOPE_CHANGED" });
    const changedTranslationScope = await deriveAllowedSemanticSurface({ home, product_id: productId, requirement_id: requirementId, language: "zh" });
    expect(changedTranslationScope.source_contract_hash).not.toBe(scope.source_contract_hash);

    await writeYamlAtomic(join(home, "data", productId, "baseline", "rules.yaml"), {
      rules: [{
        id: `${requirementId}-rule`,
        source_requirement: requirementId,
        given: "copy",
        when: "visible",
        then: "allowed",
        semantic: { allowed_copy: ["规则文案已变更"], actions: [{ key: "rule-action", label: "Rule Action" }], component_keys: ["button.primary"] }
      }]
    });
    const changedRulesScope = await deriveAllowedSemanticSurface({ home, product_id: productId, requirement_id: requirementId, language: "zh" });
    expect(changedRulesScope.source_contract_hash).not.toBe(changedTranslationScope.source_contract_hash);

    await writeYamlAtomic(join(home, "data", productId, "baseline", "baseline.yaml"), {
      product_id: productId,
      pages: [],
      navigation: []
    });
    const changedBaselineScope = await deriveAllowedSemanticSurface({ home, product_id: productId, requirement_id: requirementId, language: "zh" });
    expect(changedBaselineScope.source_contract_hash).not.toBe(changedRulesScope.source_contract_hash);

    const requirement = requirementFixture([{ page_id: "home", name: "Home Changed" }]);
    await writeYamlAtomic(join(requirementDir, "requirement.yaml"), requirement);
    const changedRequirementScope = await deriveAllowedSemanticSurface({ home, product_id: productId, requirement_id: requirementId, language: "zh" });
    expect(changedRequirementScope.source_contract_hash).not.toBe(changedBaselineScope.source_contract_hash);
  });

  it("rejects unclassified business semantics and decorative business semantics", () => {
    const baseScope = semanticScopeFixture();
    expect(validateSemanticScope({
      document: { children: [{ id: "action-without-key", metadata: { type: "forma", kind: "action" } }] },
      scope: baseScope
    })).toMatchObject({
      status: "blocked",
      violations: [expect.objectContaining({ code: "UNCLASSIFIED_BUSINESS_SEMANTICS" })]
    });
    expect(validateSemanticScope({
      document: { children: [{ id: "decorative-action", metadata: { decorative: true, action_key: "save" } }] },
      scope: baseScope
    })).toMatchObject({
      status: "blocked",
      violations: [expect.objectContaining({ code: "DECORATIVE_HAS_BUSINESS_SEMANTICS" })]
    });
  });
});

describe("stage 07 layout snapshot quality", () => {
  it("blocks critical overlap, clipped visible area, decorative overlap, unproven decorative coverage, and fixed text overflow", () => {
    expect(validateLayoutSnapshot({
      id: "root",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        { id: "a", x: 0, y: 0, width: 100, height: 100 },
        { id: "b", x: 49, y: 49, width: 100, height: 100 }
      ]
    }).issue).toMatchObject({ code: "DESIGN_LAYOUT_INVALID", message: "Critical layout nodes overlap" });

    expect(validateLayoutSnapshot({
      id: "root",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        { id: "a", x: 0, y: 0, width: 100, height: 100 },
        { id: "b", x: 95, y: 95, width: 100, height: 100 }
      ]
    }).issue).toBeUndefined();

    expect(validateLayoutSnapshot({
      id: "clip",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      clip: true,
      children: [{ id: "child", x: -20, y: 0, width: 100, height: 100 }]
    }).issue).toMatchObject({ code: "DESIGN_LAYOUT_INVALID", message: "Layout node has critical visible area under 95%" });

    expect(validateLayoutSnapshot({
      id: "root",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        { id: "content", x: 0, y: 0, width: 100, height: 100 },
        { id: "decor", x: 0, y: 0, width: 20, height: 20, metadata: { decorative: true } }
      ]
    }).issue).toMatchObject({ message: "Decorative layout overlap exceeds 10%" });

    expect(validateLayoutSnapshot({
      id: "root",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        { id: "content", x: 0, y: 0, width: 100, height: 100 },
        { id: "decor", x: 99, y: 99, width: 10, height: 10, metadata: { decorative: true } }
      ]
    }).issue).toMatchObject({ message: "Decorative overlap cannot be proven safe" });

    expect(validateLayoutSnapshot({
      id: "text",
      x: 0,
      y: 0,
      width: 20,
      height: 14,
      textGrowth: "fixed",
      text: "This text cannot fit"
    }).issue).toMatchObject({ message: "Fixed-size text overflow cannot be proven safe" });
  });

  it("records truncation, node, parent, timeout, and detail metadata", () => {
    const truncated = validateLayoutSnapshot({ id: "root", x: 0, y: 0, width: 1, height: 1, truncated: true });
    expect(truncated).toMatchObject({
      issue: { code: "DESIGN_LAYOUT_INVALID" },
      details: { truncated_parent_count: 1, limit_hit: "incomplete_scan" }
    });

    const tooManyNodes = validateLayoutSnapshot({
      id: "root",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      children: Array.from({ length: 5001 }, (_, index) => ({ id: `n${index}`, x: index, y: 0, width: 1, height: 1 }))
    });
    expect(tooManyNodes.details.limit_hit).toBe("layout_nodes");

    const tooManyParents = validateLayoutSnapshot({
      id: "root",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      children: Array.from({ length: 501 }, (_, index) => ({ id: `p${index}`, x: index * 2, y: 0, width: 1, height: 1, children: [{ id: `c${index}`, x: index * 2, y: 0, width: 1, height: 1 }] }))
    });
    expect(tooManyParents.details.limit_hit).toBe("expanded_parent_nodes");

    const timeout = validateLayoutSnapshot({ id: "root", x: 0, y: 0, width: 1, height: 1 }, { started_at_ms: 0, now_ms: 120_001 });
    expect(timeout.details.limit_hit).toBe("timeout");
  });
});

describe("stage 07 preview integrity and index recovery", () => {
  it("throws PREVIEW_NOT_EXPORTED for committed metadata that references missing preview without regenerating it", async () => {
    const home = await createDesignHome();
    const paths = requirementDesignPaths(home, productId, requirementId);
    await writeFile(paths.canvas_file, JSON.stringify({ children: [{ id: "frame-home", type: "frame", name: "Home" }] }));
    await writeYamlAtomic(paths.metadata_file, {
      schema_version: 1,
      product_id: productId,
      requirement_id: requirementId,
      canvas_file: "design.pen",
      canvas_version: 1,
      canvas_revision: "sha256:abc",
      pages: [{ page_id: "home", status: "done", preview_file: "previews/home@2x.png", page_version: 1, frame_id: "frame-home" }],
      unmanaged_components: [],
      history: []
    });

    await expect(exportRequirementDesignAsset({ home, product_id: productId, requirement_id: requirementId, kind: "preview", page_id: "home" })).rejects.toMatchObject({
      code: "PREVIEW_NOT_EXPORTED",
      details: { page_id: "home", preview_file: "previews/home@2x.png", canvas_revision: "sha256:abc" }
    });
    await expect(access(join(paths.previews_dir, "home@2x.png"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not replace formal preview or requirement status when candidate export fails", async () => {
    const home = await createIndexedHome();
    const paths = requirementDesignPaths(home, productId, requirementId);
    const oldPreview = await readFile(join(paths.previews_dir, "home@2x.png"), "utf8");
    const oldMetadata = await readFile(paths.metadata_file, "utf8");
    await writeFile(paths.canvas_file, JSON.stringify({
      children: [{ id: "frame-home", type: "frame", name: "Home", metadata: { type: "forma", kind: "page_frame", page_id: "home" } }]
    }));

    await expect(indexRequirementDesignCanvas({
      home,
      product_id: productId,
      requirement_id: requirementId,
      previewExporter: async () => {
        throw new Error("export failed");
      }
    })).rejects.toMatchObject({ code: "PREVIEW_EXPORT_FAILED" });

    await expect(readFile(join(paths.previews_dir, "home@2x.png"), "utf8")).resolves.toBe(oldPreview);
    await expect(readFile(paths.metadata_file, "utf8")).resolves.toBe(oldMetadata);
  });

  it("restores old formal artifacts when index promotion fails after partial writes", async () => {
    const home = await createIndexedHome();
    const paths = requirementDesignPaths(home, productId, requirementId);
    const oldPreview = await readFile(join(paths.previews_dir, "home@2x.png"), "utf8");
    const oldMetadata = await readFile(paths.metadata_file, "utf8");
    const oldRequirement = await readFile(join(paths.requirement_dir, "requirement.yaml"), "utf8");
    await writeFile(paths.canvas_file, JSON.stringify({
      children: [{ id: "frame-home", type: "frame", name: "Home", metadata: { type: "forma", kind: "page_frame", page_id: "home" } }]
    }));

    await expect(indexRequirementDesignCanvas({
      home,
      product_id: productId,
      requirement_id: requirementId,
      previewExporter: async ({ output_file }) => writeFile(output_file, "new-preview"),
      testHooks: {
        afterPromote(entry) {
          if (entry.kind === "preview") {
            throw new Error("promotion failed");
          }
        }
      }
    })).rejects.toThrow("promotion failed");

    await expect(readFile(join(paths.previews_dir, "home@2x.png"), "utf8")).resolves.toBe(oldPreview);
    await expect(readFile(paths.metadata_file, "utf8")).resolves.toBe(oldMetadata);
    await expect(readFile(join(paths.requirement_dir, "requirement.yaml"), "utf8")).resolves.toBe(oldRequirement);
  });
});

describe("stage 07 commit candidate builder", () => {
  it("does not call commit substrate when deterministic quality report is missing or blocked", async () => {
    const home = await createSessionHome();
    const substrate = vi.fn();
    await expect(commitRequirementDesignSession({
      home,
      session_id: sessionId,
      page_id: "home",
      frame_id: "frame-home",
      previewExporter: async ({ output_file }) => writeFile(output_file, "preview"),
      commitSubstrate: substrate
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(commitRequirementDesignSession({
      home,
      session_id: sessionId,
      page_id: "home",
      frame_id: "frame-home",
      quality_report: { status: "blocked", hard_checks: { issues: [{ code: "PENCIL_COLOR_INVALID", message: "bad" }] }, warnings: [] },
      previewExporter: async ({ output_file }) => writeFile(output_file, "preview"),
      commitSubstrate: substrate
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(substrate).not.toHaveBeenCalled();
  });

  it("reruns deterministic quality against staging before commit", async () => {
    const home = await createDesignHome();
    const paths = requirementDesignPaths(home, productId, requirementId);
    await writeFile(paths.canvas_file, JSON.stringify({ children: [] }));
    await writeRequirementSession(home, JSON.stringify({
      children: [{
        id: "frame-home",
        type: "frame",
        name: "Home",
        fill: "rgb(255, 0, 0)",
        metadata: { type: "forma", kind: "page_frame", page_id: "home" }
      }]
    }));
    const substrate = vi.fn();

    await expect(commitRequirementDesignSession({
      home,
      session_id: sessionId,
      page_id: "home",
      frame_id: "frame-home",
      quality_report: passedQualityReport(),
      previewExporter: async ({ output_file }) => writeFile(output_file, "preview"),
      commitSubstrate: substrate
    })).rejects.toMatchObject({ code: "PENCIL_COLOR_INVALID" });
    expect(substrate).not.toHaveBeenCalled();
  });

  it("builds all required candidates in fixed promotion order on success", async () => {
    const home = await createSessionHome();
    const substrate = vi.fn().mockResolvedValue({ session_id: sessionId, status: "committed" });

    const result = await commitRequirementDesignSession({
      home,
      session_id: sessionId,
      page_id: "home",
      frame_id: "frame-home",
      quality_report: passedQualityReport(),
      previewExporter: async ({ output_file }) => writeFile(output_file, "preview"),
      commitSubstrate: substrate
    });

    expect(result.status).toBe("committed");
    expect(substrate).toHaveBeenCalledTimes(1);
    const payload = substrate.mock.calls[0]![0] as { candidates: Array<{ replacement_kind: string; restore_order: number; target_file: string }> };
    expect(payload.candidates.map((candidate) => [candidate.restore_order, candidate.replacement_kind])).toEqual([
      [1, "canvas_history"],
      [2, "canvas_history_metadata"],
      [3, "page_fragment"],
      [4, "history_preview"],
      [5, "preview"],
      [6, "design_canvas"],
      [7, "design_metadata"],
      [8, "requirement_metadata"]
    ]);
    expect(payload.candidates.map((candidate) => candidate.target_file)).toEqual(expect.arrayContaining([
      `data/${productId}/${requirementId}/design.pen`,
      `data/${productId}/${requirementId}/design.yaml`,
      `data/${productId}/${requirementId}/requirement.yaml`,
      `data/${productId}/${requirementId}/previews/home@2x.png`
    ]));
  });
});

describe("stage 07 component refresh planning", () => {
  it("rejects non-done explicit pages, unlinked usage, unmapped libraries, semantic contract changes, and override conflicts atomically", async () => {
    await expect(refreshRequirementComponents({
      home: await createRefreshSessionHome({ designStatus: "pending", componentScenario: "linked" }),
      session_id: sessionId,
      page_ids: ["home"]
    })).rejects.toMatchObject({ code: "COMPONENT_REFRESH_PARTIAL_BLOCKED" });

    await expect(refreshRequirementComponents({
      home: await createRefreshSessionHome({ designStatus: "done", componentScenario: "missing_metadata" }),
      session_id: sessionId,
      page_ids: ["home"]
    })).rejects.toMatchObject({ code: "COMPONENT_USAGE_UNLINKED" });

    await expect(refreshRequirementComponents({
      home: await createRefreshSessionHome({ designStatus: "done", componentScenario: "old_snapshot" }),
      session_id: sessionId,
      page_ids: ["home"]
    })).rejects.toMatchObject({ code: "COMPONENT_LIBRARY_UNMAPPED" });

    await expect(refreshRequirementComponents({
      home: await createRefreshSessionHome({ designStatus: "done", componentScenario: "semantic_changed" }),
      session_id: sessionId,
      page_ids: ["home"]
    })).rejects.toMatchObject({ code: "COMPONENT_CONTRACT_CHANGED" });

    await expect(refreshRequirementComponents({
      home: await createRefreshSessionHome({ designStatus: "done", componentScenario: "override_conflict" }),
      session_id: sessionId,
      page_ids: ["home"]
    })).rejects.toMatchObject({ code: "COMPONENT_OVERRIDE_CONFLICT" });
  });

  it("plans all component refresh operations without writing formal design state", async () => {
    const home = await createRefreshSessionHome({ designStatus: "done", componentScenario: "linked" });
    const paths = requirementDesignPaths(home, productId, requirementId);
    const beforeCanvas = await readFile(paths.canvas_file, "utf8");
    const beforeMetadataExists = await exists(paths.metadata_file);

    await expect(refreshRequirementComponents({ home, session_id: sessionId, page_ids: ["home"] })).resolves.toMatchObject({
      status: "planned",
      operations: [expect.objectContaining({ intent: "component_refresh", target_node_ids: ["button-instance"] })]
    });
    await expect(readFile(paths.canvas_file, "utf8")).resolves.toBe(beforeCanvas);
    await expect(exists(paths.metadata_file)).resolves.toBe(beforeMetadataExists);
  });
});

async function createDesignHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "forma-design-model-"));
  const requirementDir = join(home, "data", productId, requirementId);
  await mkdir(requirementDir, { recursive: true });
  await writeYamlAtomic(join(requirementDir, "requirement.yaml"), requirementFixture([{ page_id: "home", name: "Home" }]));
  await writeComponentLibrary(home);
  return home;
}

async function createIndexedHome(): Promise<string> {
  const home = await createDesignHome();
  const paths = requirementDesignPaths(home, productId, requirementId);
  await writeFile(paths.canvas_file, JSON.stringify({
    children: [{ id: "frame-home", type: "frame", name: "Home", metadata: { type: "forma", kind: "page_frame", page_id: "home" } }]
  }));
  await indexRequirementDesignCanvas({
    home,
    product_id: productId,
    requirement_id: requirementId,
    previewExporter: async ({ output_file }) => writeFile(output_file, "old-preview")
  });
  return home;
}

async function createSessionHome(): Promise<string> {
  const home = await createDesignHome();
  const paths = requirementDesignPaths(home, productId, requirementId);
  await writeFile(paths.canvas_file, JSON.stringify({ children: [] }));
  await writeRequirementSession(home, JSON.stringify({
    children: [{
      id: "frame-home",
      type: "frame",
      name: "Home",
      metadata: { type: "forma", kind: "page_frame", page_id: "home" }
    }]
  }));
  return home;
}

async function createRefreshSessionHome(input: {
  designStatus: "pending" | "done";
  componentScenario: "linked" | "missing_metadata" | "old_snapshot" | "semantic_changed" | "override_conflict";
}): Promise<string> {
  const home = await createDesignHome();
  const requirement = requirementFixture([{ page_id: "home", name: "Home" }]);
  await writeYamlAtomic(join(home, "data", productId, requirementId, "requirement.yaml"), {
    ...requirement,
    pages: requirement.pages.map((page) => ({ ...page, design_status: input.designStatus }))
  });
  const paths = requirementDesignPaths(home, productId, requirementId);
  await writeFile(paths.canvas_file, JSON.stringify({ children: [{ id: "formal" }] }));
  await writeRequirementSession(home, JSON.stringify(refreshPenDocument(input.componentScenario)));
  return home;
}

async function writeRequirementSession(home: string, stagingRaw: string): Promise<void> {
  const sessionDir = join(home, "data", productId, requirementId, "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });
  const staging = join(sessionDir, "staging.design.pen");
  await writeFile(staging, stagingRaw);
  await writeYamlAtomic(join(sessionDir, "semantic_scope.yaml"), {
    ...semanticScopeFixture(),
    staging_revision: sha256(stagingRaw)
  });
  await writeYamlAtomic(join(sessionDir, "design_session.yaml"), {
    schema_version: 1,
    session_id: sessionId,
    scope: "requirement_canvas",
    product_id: productId,
    requirement_id: requirementId,
    session_dir_relative: `data/${productId}/${requirementId}/sessions/${sessionId}`,
    session_dir: `data/${productId}/${requirementId}/sessions/${sessionId}`,
    operation: "generate",
    mode: "app",
    canvas_file: `data/${productId}/${requirementId}/design.pen`,
    canvas_path: `data/${productId}/${requirementId}/design.pen`,
    staging_file: `data/${productId}/${requirementId}/sessions/${sessionId}/staging.design.pen`,
    staging_path: `data/${productId}/${requirementId}/sessions/${sessionId}/staging.design.pen`,
    pencil_binding_id: "B-1234567890abcdef",
    pencil_command: "pencil interactive",
    pencil_version: "pencil 1.2.3",
    started_revision: sha256(stagingRaw),
    last_saved_revision: sha256(stagingRaw),
    last_controlled_revision: sha256(stagingRaw),
    operation_log_file_relative: `data/${productId}/${requirementId}/sessions/${sessionId}/operations.jsonl`,
    operation_log_file: `data/${productId}/${requirementId}/sessions/${sessionId}/operations.jsonl`,
    semantic_scope_file_relative: `data/${productId}/${requirementId}/sessions/${sessionId}/semantic_scope.yaml`,
    semantic_scope_file: `data/${productId}/${requirementId}/sessions/${sessionId}/semantic_scope.yaml`,
    started_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:00:00.000Z",
    pid: process.pid,
    status: "running"
  });
  await writeFile(join(sessionDir, "operations.jsonl"), "");
}

function refreshPenDocument(scenario: "linked" | "missing_metadata" | "old_snapshot" | "semantic_changed" | "override_conflict") {
  const metadata: Record<string, unknown> = {
    type: "forma",
    kind: "component_instance",
    component_key: "button.primary",
    ref_target: scenario === "old_snapshot" ? "Components - Snapshot v0/button.primary" : "Components - Snapshot v1/button.primary"
  };
  if (scenario === "semantic_changed") {
    metadata.semantic_contract_hash = "sha256:old";
    metadata.library_semantic_contract_hash = "sha256:new";
  }
  if (scenario === "override_conflict") {
    metadata.overrides = ["semantic"];
  }
  return {
    children: [{
      id: "frame-home",
      type: "frame",
      name: "Home",
      metadata: { type: "forma", kind: "page_frame", page_id: "home" },
      children: [{
        id: "button-instance",
        type: "instance",
        ...(scenario === "missing_metadata" ? {} : { metadata })
      }]
    }]
  };
}

async function writeComponentLibrary(home: string): Promise<void> {
  const lib = JSON.stringify({ children: [{ id: "button.primary", type: "component" }] });
  const checksum = `sha256:${createHash("sha256").update(lib).digest("hex")}`;
  await mkdir(join(home, "library", `${productId}.versions`), { recursive: true });
  await writeFile(join(home, "library", `${productId}.lib.pen`), lib);
  await writeFile(join(home, "library", `${productId}.versions`, "1.lib.pen"), lib);
  await writeYamlAtomic(join(home, "library", `${productId}.components.yaml`), {
    product_id: productId,
    current_version: 1,
    latest_file: `${productId}.lib.pen`,
    versions: [{
      version: 1,
      file: `${productId}.versions/1.lib.pen`,
      checksum,
      components: [{ key: "button.primary", name: "Primary Button" }]
    }]
  });
}

function requirementFixture(pages: Array<{ page_id: string; name: string }>): Requirement {
  return {
    id: requirementId,
    product_id: productId,
    title: "Checkout style",
    status: "submitted",
    ui_affected: true,
    created_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:00:00.000Z",
    pages: pages.map((page) => ({
      page_id: page.page_id,
      name: page.name,
      baseline_page: `B-${page.page_id}`,
      design_status: "pending",
      copy: [{ context: "title", text: page.name }],
      declared_fields: [],
      declared_actions: [{ key: "save", label: "Save" }],
      declared_component_keys: ["button.primary"],
      semantic_contract: {
        fields: [],
        actions: [{ key: "save", label: "Save" }],
        navigation: [],
        allowed_copy: [page.name],
        component_keys: ["button.primary"]
      },
      semantic_contract_coverage: "explicit"
    })),
    navigation: []
  };
}

function semanticScopeFixture() {
  return {
    schema_version: 1 as const,
    product_id: productId,
    requirement_id: requirementId,
    language: "default",
    page_ids: ["home"],
    allowed_copy: ["Home"],
    action_keys: ["save"],
    navigation_targets: [],
    field_keys: [],
    component_keys: ["button.primary"],
    visual_states: ["default"],
    existing_node_ids: [],
    baseline_node_ids: [],
    source_inputs: {
      requirement_hash: "sha256:req",
      translations_hash: "sha256:trans",
      rules_hash: "sha256:rules",
      baseline_hash: "sha256:base",
      product_hash: "sha256:product",
      component_library_hash: "sha256:component",
      current_design_hash: "sha256:design"
    },
    source_contract_hash: "sha256:test"
  };
}

function passedQualityReport(): DesignQualityReport {
  return { status: "passed", hard_checks: { issues: [] }, warnings: [] };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
