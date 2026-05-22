import { FormaError, PencilAppSessionAdapter, createFormaStore, writeYamlAtomic } from "@xenonbyte/forma-core";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as z from "zod/v4";
import { createFormaTools, formaToolInputSchemas, formaToolNames, registerFormaTools, type FormaToolName } from "../src/index.js";

const removedLegacyToolNames = [
  "complete_product_init",
  "generate_components",
  "generate_page_design",
  "save_designs",
  "generate_and_save_page_design",
  "rollback_design",
  "diff_designs",
  "get_design_annotations",
  "export_design_asset"
] as const;

const v6ToolNames = [
  "begin_requirement_design_session",
  "apply_requirement_design_operations",
  "commit_requirement_design_session",
  "discard_requirement_design_session",
  "recover_design_commit_journal",
  "begin_product_component_session",
  "apply_product_component_operations",
  "commit_product_component_session",
  "discard_product_component_session",
  "get_requirement_design_canvas",
  "index_requirement_design_canvas",
  "get_requirement_design_scene",
  "get_requirement_design_history",
  "rollback_requirement_design",
  "diff_requirement_design_versions",
  "export_requirement_design_asset",
  "get_product_component_library",
  "index_component_usages",
  "refresh_requirement_components",
  "plan_import_metadata_normalization",
  "validate_requirement_design_quality",
  "session_get_editor_state",
  "session_get_guidelines",
  "session_get_variables",
  "session_batch_get",
  "session_snapshot_layout",
  "session_get_screenshot",
  "session_export_nodes"
] as const;

const forbiddenPathFields = [
  "filePath",
  "file_path",
  "canvas_path",
  "staging_path",
  "outputDir",
  "output_dir",
  "path",
  "pen_path",
  "preview_path",
  "history_path"
] as const;

const wrapperToolInputs = {
  session_get_editor_state: { session_id: "S-1234567890abcdef", include_schema: true },
  session_get_guidelines: { session_id: "S-1234567890abcdef", category: "guide", name: "Design System" },
  session_get_variables: { session_id: "S-1234567890abcdef" },
  session_batch_get: { session_id: "S-1234567890abcdef", nodeIds: ["frame-1"], resolveInstances: false },
  session_snapshot_layout: { session_id: "S-1234567890abcdef", parentId: "frame-1", problemsOnly: false, maxDepth: 8 },
  session_get_screenshot: { session_id: "S-1234567890abcdef", nodeId: "frame-1" },
  session_export_nodes: { session_id: "S-1234567890abcdef", nodeIds: ["frame-1"], format: "png", scale: 2 }
} satisfies Partial<Record<FormaToolName, Record<string, unknown>>>;

function textPayload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]!.text);
}

function expectSchemaSuccess(toolName: FormaToolName, input: unknown) {
  const parsed = formaToolInputSchemas[toolName].safeParse(input);
  expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
}

function expectSchemaFailure(toolName: FormaToolName, input: unknown, message?: string) {
  const parsed = formaToolInputSchemas[toolName].safeParse(input);
  expect(parsed.success).toBe(false);
  if (message && !parsed.success) {
    expect(parsed.error.issues.map((issue) => issue.message)).toContain(message);
  }
}

function sampleStyle() {
  return {
    name: "linear",
    description: "Focused tool UI",
    design_md_path: "styles/linear/DESIGN.md",
    variables: {
      primary: "#5E6AD2",
      background: "#FFFFFF",
      "text-primary": "#111827",
      "font-heading": "Inter",
      "font-body": "Inter",
      "border-radius": "8px",
      "spacing-unit": "8px"
    }
  };
}

function fakeStore(overrides: Record<string, unknown> = {}) {
  const store = {
    home: "/tmp/forma",
    deleteProduct: vi.fn(async () => ({
      product_id: "P-123abc",
      deleted: true,
      session_cleared: false,
      cleanup_pending: false,
      recovery_warnings: []
    })),
    generateComponents: vi.fn(async () => ({
      tempDir: "/tmp/components",
      penPath: "/tmp/components/components.lib.pen",
      libraryPath: "/tmp/forma/library/P-123abc.lib.pen"
    })),
    baseline: {
      getProductBaseline: vi.fn(async () => ({ product_id: "P-123abc", pages: [], navigation: [] }))
    },
    copy: {
      getTranslations: vi.fn(async () => []),
      updatePageTranslations: vi.fn(async () => undefined)
    },
    products: {
      createProduct: vi.fn(async () => ({ id: "P-123abc", name: "App", description: "Demo" })),
      getProduct: vi.fn(async () => ({
        id: "P-123abc",
        name: "App",
        description: "Demo",
        platform: "web",
        style: { name: "linear" },
        languages: ["en", "zh-CN"],
        default_language: "en"
      })),
      initProductConfig: vi.fn(async (_productId, config) => ({ id: "P-123abc", ...config })),
      listProducts: vi.fn(async () => [{ id: "P-123abc", name: "App", description: "Demo" }])
    },
    requirements: {
      createEmptyRequirement: vi.fn(async () => ({ id: "R-12345678", status: "empty" })),
      getLatestRequirement: vi.fn(async () => ({ id: "R-12345678", product_id: "P-123abc", status: "active", pages: [] })),
      getProductRules: vi.fn(async () => []),
      getRequirement: vi.fn(async () => ({ id: "R-12345678", product_id: "P-123abc", pages: [] })),
      getRequirementHistory: vi.fn(async () => []),
      saveRequirement: vi.fn(async () => ({ id: "R-12345678", status: "submitted" })),
      submitRequirement: vi.fn(async () => ({ id: "R-12345678", status: "submitted" })),
      updateRequirement: vi.fn(async () => ({ id: "R-12345678", status: "submitted" }))
    },
    sessions: {
      getCurrentSession: vi.fn(async () => ({ current_product: "P-123abc" })),
      setCurrentProduct: vi.fn(async () => ({ current_product: "P-123abc" }))
    },
    styles: {
      getStyle: vi.fn(async () => ({ metadata: { name: "linear" }, designMd: "# Linear" })),
      listStyles: vi.fn(async () => [{ name: "linear" }])
    },
    ...overrides
  };
  return store;
}

async function writeMinimalMcpSessionRecord(home: string, sessionId: string): Promise<string> {
  const stagingRelativePath = `data/P-123abc/R-1234abcd/sessions/${sessionId}/staging.design.pen`;
  const sessionDir = join(home, "data", "P-123abc", "R-1234abcd", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeYamlAtomic(join(sessionDir, "design_session.yaml"), {
    session_id: sessionId,
    pencil_binding_id: "B-binding",
    staging_path: stagingRelativePath
  });
  return join(home, stagingRelativePath);
}

async function writeCommitSessionRecord(home: string, sessionId: string): Promise<string> {
  const productId = "P-123abc";
  const requirementId = "R-1234abcd";
  const requirementDir = join(home, "data", productId, requirementId);
  const sessionDir = join(requirementDir, "sessions", sessionId);
  const stagingRelativePath = `data/${productId}/${requirementId}/sessions/${sessionId}/staging.design.pen`;
  const semanticScopeRelativePath = `data/${productId}/${requirementId}/sessions/${sessionId}/semantic_scope.yaml`;
  const operationLogRelativePath = `data/${productId}/${requirementId}/sessions/${sessionId}/operations.jsonl`;
  const stagingPath = join(home, stagingRelativePath);
  const stagingRaw = JSON.stringify({
    children: [{
      id: "frame-home",
      type: "frame",
      name: "Home",
      metadata: { type: "forma", kind: "page_frame", page_id: "home" },
      children: [{
        id: "button-instance",
        type: "instance",
        metadata: {
          type: "forma",
          kind: "component_instance",
          component_key: "button.primary",
          ref_target: "Components - Snapshot v1/button.primary"
        }
      }]
    }]
  });
  const stagingRevision = sha256(stagingRaw);

  await mkdir(sessionDir, { recursive: true });
  await writeYamlAtomic(join(requirementDir, "requirement.yaml"), {
    id: requirementId,
    product_id: productId,
    title: "Checkout style",
    status: "submitted",
    ui_affected: true,
    created_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:00:00.000Z",
    pages: [{
      page_id: "home",
      name: "Home",
      baseline_page: "B-home",
      design_status: "pending",
      copy: [{ context: "title", text: "Home" }],
      declared_fields: [],
      declared_actions: [{ key: "save", label: "Save" }],
      declared_component_keys: ["button.primary"],
      semantic_contract: {
        fields: [],
        actions: [{ key: "save", label: "Save" }],
        navigation: [],
        allowed_copy: ["Home"],
        component_keys: ["button.primary"]
      },
      semantic_contract_coverage: "explicit"
    }],
    navigation: []
  });
  await writeFile(stagingPath, stagingRaw);
  await writeYamlAtomic(join(sessionDir, "semantic_scope.yaml"), {
    schema_version: 1,
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
    source_contract_hash: "sha256:test",
    staging_revision: stagingRevision
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
    staging_file: stagingRelativePath,
    staging_path: stagingRelativePath,
    pencil_binding_id: "B-binding",
    pencil_command: "pencil interactive",
    pencil_version: "pencil 1.2.3",
    started_revision: stagingRevision,
    last_saved_revision: stagingRevision,
    last_controlled_revision: stagingRevision,
    operation_log_file_relative: operationLogRelativePath,
    operation_log_file: operationLogRelativePath,
    semantic_scope_file_relative: semanticScopeRelativePath,
    semantic_scope_file: semanticScopeRelativePath,
    started_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:00:00.000Z",
    pid: process.pid,
    status: "running"
  });
  await writeFile(join(home, operationLogRelativePath), "");
  return stagingPath;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

describe("MCP forma tools", () => {
  it("does not register removed legacy page-level design tools", () => {
    const tools = createFormaTools(fakeStore());
    const server = { registerTool: vi.fn() };

    registerFormaTools(server, tools);

    expect(Object.keys(tools)).toEqual(formaToolNames);
    expect(server.registerTool).toHaveBeenCalledTimes(formaToolNames.length);
    expect(server.registerTool.mock.calls.map((call) => call[0])).toEqual(formaToolNames);
    expect(server.registerTool.mock.calls.map((call) => call[1])).toEqual(
      expect.arrayContaining([expect.objectContaining({ inputSchema: expect.any(Object) })])
    );
    for (const removedToolName of removedLegacyToolNames) {
      expect(formaToolNames).not.toContain(removedToolName);
      expect(Object.keys(tools)).not.toContain(removedToolName);
      expect(server.registerTool.mock.calls.map((call) => call[0])).not.toContain(removedToolName);
    }
    expect(formaToolNames).not.toContain("submit_requirement");
    expect(formaToolNames).not.toContain("update_requirement");
    expect(formaToolNames).not.toContain("delete_requirement");
    expect(formaToolNames).toEqual(expect.arrayContaining([
      "save_requirement",
      "get_product_rules",
      "get_page_copy",
      "update_page_copy",
      "delete_product",
      ...v6ToolNames
    ]));
  });

  it("help output excludes removed legacy page-level design tools", async () => {
    const tools = createFormaTools(fakeStore());

    const result = await tools.help({});
    const payload = textPayload(result);

    expect(payload).toMatchObject({
      tools: formaToolNames,
      usage_guide: {
        guidance: expect.arrayContaining([
          expect.stringContaining("save_requirement"),
          expect.stringContaining("get_product_rules"),
          expect.stringContaining("get_page_copy")
        ]),
        workflows: {
          develop_frontend: [
            "get_requirement",
            "get_product_rules"
          ]
        }
      }
    });
    for (const removedToolName of removedLegacyToolNames) {
      expect(JSON.stringify(payload)).not.toContain(removedToolName);
    }
  });

  it("exposes JSON-Schema-compatible MCP input schemas", () => {
    const failures: Array<{ tool: string; message: string }> = [];

    for (const [tool, schema] of Object.entries(formaToolInputSchemas)) {
      try {
        z.toJSONSchema(schema);
      } catch (error) {
        failures.push({ tool, message: error instanceof Error ? error.message : String(error) });
      }
    }

    expect(failures).toEqual([]);
  });

  it("v6 session wrapper schemas accept scoped inputs and reject caller path fields", () => {
    for (const [toolName, validInput] of Object.entries(wrapperToolInputs) as Array<[FormaToolName, Record<string, unknown>]>) {
      expectSchemaSuccess(toolName, validInput);
      expectSchemaSuccess(toolName, { ...validInput, pencil_binding_id: "PB-123" });
      for (const field of forbiddenPathFields) {
        expectSchemaFailure(toolName, { ...validInput, [field]: "/tmp/agent-owned" }, "FORBIDDEN_PATH_PARAMETER");
      }
    }
  });

  it("passes session record staging path to adapter-backed session read tools", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-session-staging-"));
    const sessionId = "S-1234567890abcdef";
    const expectedStagingPath = await writeMinimalMcpSessionRecord(home, sessionId);
    const store = fakeStore({ home });
    const editorSpy = vi.spyOn(PencilAppSessionAdapter.prototype, "sessionGetEditorState").mockResolvedValue({ ok: "editor" });
    const guidelinesSpy = vi.spyOn(PencilAppSessionAdapter.prototype, "sessionGetGuidelines").mockResolvedValue({ ok: "guidelines" });
    const variablesSpy = vi.spyOn(PencilAppSessionAdapter.prototype, "sessionGetVariables").mockResolvedValue({ ok: "variables" });
    const batchGetSpy = vi.spyOn(PencilAppSessionAdapter.prototype, "sessionBatchGet").mockResolvedValue({ ok: "batch" });
    const snapshotSpy = vi.spyOn(PencilAppSessionAdapter.prototype, "sessionSnapshotLayout").mockResolvedValue({ ok: "snapshot" });
    const screenshotSpy = vi.spyOn(PencilAppSessionAdapter.prototype, "sessionGetScreenshot").mockResolvedValue({ ok: "screenshot" });
    const exportSpy = vi.spyOn(PencilAppSessionAdapter.prototype, "sessionExportNodes").mockResolvedValue({ ok: "export" });
    const tools = createFormaTools(store);

    try {
      await tools.session_get_editor_state({ session_id: sessionId, include_schema: true });
      await tools.session_get_guidelines({ session_id: sessionId, category: "guide", name: "Design System" });
      await tools.session_get_variables({ session_id: sessionId });
      await tools.session_batch_get({ session_id: sessionId, nodeIds: ["frame-1"], resolveInstances: false });
      await tools.session_snapshot_layout({ session_id: sessionId, parentId: "frame-1", problemsOnly: false, maxDepth: 8 });
      await tools.session_get_screenshot({ session_id: sessionId, nodeId: "frame-1" });
      await tools.session_export_nodes({ session_id: sessionId, nodeIds: ["frame-1"], format: "png", scale: 2 });

      expect(editorSpy).toHaveBeenCalledWith(
        "B-binding",
        { include_schema: true },
        expectedStagingPath
      );
      expect(guidelinesSpy).toHaveBeenCalledWith(
        "B-binding",
        { category: "guide", name: "Design System" },
        expectedStagingPath
      );
      expect(variablesSpy).toHaveBeenCalledWith("B-binding", expectedStagingPath);
      expect(batchGetSpy).toHaveBeenCalledWith(
        "B-binding",
        { nodeIds: ["frame-1"], resolveInstances: false },
        expectedStagingPath
      );
      expect(snapshotSpy).toHaveBeenCalledWith(
        "B-binding",
        { problemsOnly: false, parentId: "frame-1", maxDepth: 8 },
        expectedStagingPath
      );
      expect(screenshotSpy).toHaveBeenCalledWith(
        "B-binding",
        { nodeId: "frame-1" },
        expectedStagingPath
      );
      expect(exportSpy).toHaveBeenCalledWith(
        "B-binding",
        { nodeIds: ["frame-1"], format: "png", scale: 2 },
        expectedStagingPath
      );
    } finally {
      editorSpy.mockRestore();
      guidelinesSpy.mockRestore();
      variablesSpy.mockRestore();
      batchGetSpy.mockRestore();
      snapshotSpy.mockRestore();
      screenshotSpy.mockRestore();
      exportSpy.mockRestore();
    }
  });

  it("passes session record staging path to preview export fallback during commit", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-preview-staging-"));
    const sessionId = "S-1234567890abcdef";
    const expectedStagingPath = await writeCommitSessionRecord(home, sessionId);
    const exportedPreview = join(home, "preview-export.png");
    await writeFile(exportedPreview, "preview");
    const assertBindingSpy = vi.spyOn(PencilAppSessionAdapter.prototype, "assertActiveStagingBinding").mockResolvedValue({
      session_id: sessionId,
      pencil_binding_id: "B-binding",
      mode: "app",
      pid: process.pid,
      command: "pencil interactive",
      capabilities: [],
      version: "pencil 1.2.3",
      staging_path: expectedStagingPath,
      binding_guard_id: "formaSessionBindingGuardTest",
      stdin: "interactive-shell",
      stdout: "interactive-shell"
    });
    const exportSpy = vi.spyOn(PencilAppSessionAdapter.prototype, "sessionExportNodes").mockResolvedValue({
      files: [{ path: exportedPreview }]
    });
    const tools = createFormaTools(fakeStore({ home }));

    try {
      const result = await tools.commit_requirement_design_session({
        session_id: sessionId,
        page_id: "home",
        frame_id: "frame-home"
      });

      expect(exportSpy).toHaveBeenCalledWith(
        "B-binding",
        { nodeIds: ["frame-home"], format: "png", scale: 2 },
        expectedStagingPath
      );
      expect(result.isError).toBe(true);
      expect(textPayload(result)).toMatchObject({ error_code: "PENCIL_APP_REQUIRED" });
    } finally {
      assertBindingSpy.mockRestore();
      exportSpy.mockRestore();
    }
  });

  it("requirement design session schemas enforce operations, intents, and forbidden operation paths", () => {
    for (const operation of ["generate", "refine", "rebuild", "rollback", "component_refresh"] as const) {
      expectSchemaSuccess("begin_requirement_design_session", {
        product_id: "P-123abc",
        requirement_id: "R-12345678",
        page_id: "checkout",
        operation,
        design_language: "zh-CN",
        component_refresh: { version: "latest", scope: "all_pages" }
      });
    }

    for (const intent of ["generate", "refine", "rebuild", "rollback", "component_refresh", "quality_repair", "import_metadata_normalization"] as const) {
      expectSchemaSuccess("apply_requirement_design_operations", {
        session_id: "S-1234567890abcdef",
        operations: [{ tool: "batch_design", args: { node_id: "frame-1" }, target_node_ids: ["frame-1"], intent }]
      });
    }

    expectSchemaFailure("apply_requirement_design_operations", {
      session_id: "S-1234567890abcdef",
      operations: [{ tool: "set_variables", args: {}, intent: "generate" }]
    });
    expectSchemaFailure("apply_requirement_design_operations", {
      session_id: "S-1234567890abcdef",
      operations: [{ tool: "batch_design", args: {}, intent: "unknown" }]
    });
    for (const field of forbiddenPathFields) {
      expectSchemaFailure("apply_requirement_design_operations", {
        session_id: "S-1234567890abcdef",
        operations: [{ tool: "batch_design", args: { [field]: "/tmp/agent-owned" }, intent: "generate" }]
      }, "FORBIDDEN_PATH_PARAMETER");
    }
  });

  it("commit_requirement_design_session schema separates page and component refresh AI review inputs", () => {
    expectSchemaSuccess("commit_requirement_design_session", {
      session_id: "S-1234567890abcdef",
      page_id: "checkout",
      frame_id: "frame-1",
      ai_visual_review: { status: "passed", screenshot_path: "session-export.png" }
    });
    expectSchemaSuccess("commit_requirement_design_session", {
      session_id: "S-1234567890abcdef",
      ai_visual_reviews: [
        { page_id: "checkout", result: { status: "skipped", reason: "not_requested" } }
      ]
    });
    expectSchemaSuccess("commit_requirement_design_session", {
      session_id: "S-1234567890abcdef"
    });
    expectSchemaFailure("commit_requirement_design_session", {
      session_id: "S-1234567890abcdef",
      page_id: "checkout",
      frame_id: "frame-1",
      ai_visual_review: { status: "passed" },
      ai_visual_reviews: [{ page_id: "checkout", result: { status: "passed" } }]
    });
    expectSchemaFailure("commit_requirement_design_session", {
      session_id: "S-1234567890abcdef",
      page_id: "checkout",
      frame_id: "frame-1",
      ai_visual_reviews: [{ page_id: "checkout", result: { status: "passed" } }]
    });
  });

  it("rejects malformed session ids for session-owned tools", () => {
    const malformedSessionId = "S-1234567890abcdef/../S-fedcba0987654321";
    const sessionInputs: Array<[FormaToolName, Record<string, unknown>]> = [
      ["apply_requirement_design_operations", { session_id: malformedSessionId, operations: [{ tool: "batch_design", args: {}, intent: "generate" }] }],
      ["commit_requirement_design_session", { session_id: malformedSessionId }],
      ["discard_requirement_design_session", { session_id: malformedSessionId }],
      ["recover_design_commit_journal", { session_id: malformedSessionId, scope: "requirement_canvas" }],
      ["apply_product_component_operations", { session_id: malformedSessionId, operations: [{ tool: "set_variables", args: {}, intent: "change_style" }] }],
      ["commit_product_component_session", { session_id: malformedSessionId }],
      ["discard_product_component_session", { session_id: malformedSessionId }],
      ["refresh_requirement_components", { session_id: malformedSessionId, product_id: "P-123abc", requirement_id: "R-12345678" }],
      ["plan_import_metadata_normalization", { session_id: malformedSessionId, product_id: "P-123abc", requirement_id: "R-12345678", page_id: "checkout", frame_id: "frame-1" }],
      ["validate_requirement_design_quality", { session_id: malformedSessionId, product_id: "P-123abc", requirement_id: "R-12345678", page_id: "checkout", frame_id: "frame-1" }],
      ["session_get_editor_state", { session_id: malformedSessionId, include_schema: true }],
      ["session_get_guidelines", { session_id: malformedSessionId, category: "guide", name: "Design System" }],
      ["session_get_variables", { session_id: malformedSessionId }],
      ["session_batch_get", { session_id: malformedSessionId, nodeIds: ["frame-1"] }],
      ["session_snapshot_layout", { session_id: malformedSessionId, parentId: "frame-1" }],
      ["session_get_screenshot", { session_id: malformedSessionId, nodeId: "frame-1" }],
      ["session_export_nodes", { session_id: malformedSessionId, nodeIds: ["frame-1"] }]
    ];

    for (const [toolName, input] of sessionInputs) {
      expectSchemaFailure(toolName, input);
    }
  });

  it("product component session schemas enforce seed requirements and operation tools", () => {
    expectSchemaFailure("begin_product_component_session", {
      product_id: "P-123abc",
      operation: "generate"
    });
    expectSchemaSuccess("begin_product_component_session", {
      product_id: "P-123abc",
      operation: "generate",
      seed_components: [{ component_key: "button-primary", name: "Button" }]
    });
    expectSchemaSuccess("begin_product_component_session", {
      product_id: "P-123abc",
      operation: "refine"
    });
    expectSchemaSuccess("begin_product_component_session", {
      product_id: "P-123abc",
      operation: "change_style",
      seed_components: [{ component_key: "button-primary" }]
    });
    expectSchemaSuccess("apply_product_component_operations", {
      session_id: "S-1234567890abcdef",
      operations: [{ tool: "set_variables", args: { primary: "#111111" }, intent: "change_style" }]
    });
    expectSchemaFailure("apply_product_component_operations", {
      session_id: "S-1234567890abcdef",
      operations: [{ tool: "delete_page", args: {}, intent: "change_style" }]
    });
  });

  it("component refresh and metadata normalization schemas enforce scoped inputs", () => {
    for (const scope of [
      "all_pages",
      { page_ids: ["checkout"] },
      { component_keys: ["button-primary"] },
      { page_ids: ["checkout"], component_keys: ["button-primary"] }
    ]) {
      expectSchemaSuccess("refresh_requirement_components", {
        session_id: "S-1234567890abcdef",
        product_id: "P-123abc",
        requirement_id: "R-12345678",
        version: "latest",
        scope
      });
    }
    for (const invalidScope of [
      { page_ids: [] },
      { component_keys: [] },
      { page_ids: [""] },
      { component_keys: [""] }
    ]) {
      expectSchemaFailure("refresh_requirement_components", {
        session_id: "S-1234567890abcdef",
        product_id: "P-123abc",
        requirement_id: "R-12345678",
        version: 3,
        scope: invalidScope
      });
    }

    expectSchemaSuccess("plan_import_metadata_normalization", {
      session_id: "S-1234567890abcdef",
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout",
      frame_id: "frame-1"
    });
    expectSchemaSuccess("validate_requirement_design_quality", {
      session_id: "S-1234567890abcdef",
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout",
      frame_id: "frame-1"
    });
    for (const field of forbiddenPathFields) {
      expectSchemaFailure("plan_import_metadata_normalization", {
        session_id: "S-1234567890abcdef",
        product_id: "P-123abc",
        requirement_id: "R-12345678",
        page_id: "checkout",
        frame_id: "frame-1",
        [field]: "/tmp/agent-owned"
      }, "FORBIDDEN_PATH_PARAMETER");
    }
  });

  it("delegates v6 requirement session tools to core services with store home injected", async () => {
    const v6 = {
      beginRequirementDesignSession: vi.fn(async (input) => ({ service: "beginRequirementDesignSession", input })),
      applyRequirementDesignOperations: vi.fn(async (input) => ({ service: "applyRequirementDesignOperations", input })),
      commitRequirementDesignSession: vi.fn(async (input) => ({ service: "commitRequirementDesignSession", input })),
      discardRequirementDesignSession: vi.fn(async (input) => ({ service: "discardRequirementDesignSession", input })),
      recoverDesignCommitJournal: vi.fn(async (input) => ({ service: "recoverDesignCommitJournal", input }))
    };
    const tools = createFormaTools(fakeStore({ v6 }));
    const beginInput = { product_id: "P-123abc", requirement_id: "R-12345678", page_id: "checkout", operation: "generate" as const };
    const applyInput = {
      session_id: "S-1234567890abcdef",
      operations: [{ tool: "batch_design" as const, args: { node_id: "frame-1" }, intent: "generate" as const }]
    };
    const commitInput = {
      session_id: "S-1234567890abcdef",
      page_id: "checkout",
      frame_id: "frame-1",
      ai_visual_review: { status: "skipped" as const, reason: "not_requested" as const }
    };

    await tools.begin_requirement_design_session(beginInput);
    await tools.apply_requirement_design_operations(applyInput);
    await tools.commit_requirement_design_session(commitInput);
    await tools.discard_requirement_design_session({ session_id: "S-1234567890abcdef" });
    await tools.recover_design_commit_journal({ session_id: "S-1234567890abcdef", scope: "requirement_canvas" });

    expect(v6.beginRequirementDesignSession).toHaveBeenCalledWith({ home: "/tmp/forma", ...beginInput });
    expect(v6.applyRequirementDesignOperations).toHaveBeenCalledWith({ home: "/tmp/forma", ...applyInput });
    expect(v6.commitRequirementDesignSession).toHaveBeenCalledWith({ home: "/tmp/forma", ...commitInput });
    expect(v6.discardRequirementDesignSession).toHaveBeenCalledWith({ home: "/tmp/forma", session_id: "S-1234567890abcdef" });
    expect(v6.recoverDesignCommitJournal).toHaveBeenCalledWith({ home: "/tmp/forma", session_id: "S-1234567890abcdef", scope: "requirement_canvas" });
  });

  it("delegates v6 component session tools to core services", async () => {
    const v6 = {
      beginProductComponentSession: vi.fn(async (input) => ({ service: "beginProductComponentSession", input })),
      applyProductComponentOperations: vi.fn(async (input) => ({ service: "applyProductComponentOperations", input })),
      commitProductComponentSession: vi.fn(async (input) => ({ service: "commitProductComponentSession", input })),
      discardProductComponentSession: vi.fn(async (input) => ({ service: "discardProductComponentSession", input })),
      getProductComponentLibrary: vi.fn(async (home, productId) => ({ service: "getProductComponentLibrary", home, productId }))
    };
    const tools = createFormaTools(fakeStore({ v6 }));
    const beginInput = {
      product_id: "P-123abc",
      operation: "generate" as const,
      seed_components: [{ component_key: "button-primary" }]
    };
    const applyInput = {
      session_id: "S-1234567890abcdef",
      operations: [{ tool: "set_variables" as const, args: { primary: "#111111" }, intent: "change_style" }]
    };

    await tools.begin_product_component_session(beginInput);
    await tools.apply_product_component_operations(applyInput);
    await tools.commit_product_component_session({ session_id: "S-1234567890abcdef" });
    await tools.discard_product_component_session({ session_id: "S-1234567890abcdef" });
    await tools.get_product_component_library({ product_id: "P-123abc" });

    expect(v6.beginProductComponentSession).toHaveBeenCalledWith({ home: "/tmp/forma", ...beginInput });
    expect(v6.applyProductComponentOperations).toHaveBeenCalledWith({ home: "/tmp/forma", ...applyInput });
    expect(v6.commitProductComponentSession).toHaveBeenCalledWith({ home: "/tmp/forma", session_id: "S-1234567890abcdef" });
    expect(v6.discardProductComponentSession).toHaveBeenCalledWith({ home: "/tmp/forma", session_id: "S-1234567890abcdef" });
    expect(v6.getProductComponentLibrary).toHaveBeenCalledWith("/tmp/forma", "P-123abc");
  });

  it("delegates v6 read, model, quality, and wrapper tools to services", async () => {
    const v6 = {
      getRequirementDesign: vi.fn(async (home, productId, requirementId) => ({ service: "getRequirementDesign", home, productId, requirementId })),
      indexRequirementDesignCanvas: vi.fn(async (input) => ({ service: "indexRequirementDesignCanvas", input })),
      getRequirementDesignScene: vi.fn(async (input) => ({ service: "getRequirementDesignScene", input })),
      getRequirementDesignHistory: vi.fn(async (input) => ({ service: "getRequirementDesignHistory", input })),
      rollbackRequirementDesign: vi.fn(async (input) => ({ service: "rollbackRequirementDesign", input })),
      diffRequirementDesignVersions: vi.fn(async (input) => ({ service: "diffRequirementDesignVersions", input })),
      exportRequirementDesignAsset: vi.fn(async (input) => ({ service: "exportRequirementDesignAsset", input })),
      indexRequirementComponentUsage: vi.fn(async (input) => ({ service: "indexRequirementComponentUsage", input })),
      refreshRequirementComponents: vi.fn(async (input) => ({ service: "refreshRequirementComponents", input })),
      planImportMetadataNormalization: vi.fn(async (input) => ({ service: "planImportMetadataNormalization", input })),
      runDesignQualityPipeline: vi.fn(async (input) => ({ service: "runDesignQualityPipeline", input })),
      sessionGetEditorState: vi.fn(async (input) => ({ service: "sessionGetEditorState", input })),
      sessionGetGuidelines: vi.fn(async (input) => ({ service: "sessionGetGuidelines", input })),
      sessionGetVariables: vi.fn(async (input) => ({ service: "sessionGetVariables", input })),
      sessionBatchGet: vi.fn(async (input) => ({ service: "sessionBatchGet", input })),
      sessionSnapshotLayout: vi.fn(async (input) => ({ service: "sessionSnapshotLayout", input })),
      sessionGetScreenshot: vi.fn(async (input) => ({ service: "sessionGetScreenshot", input })),
      sessionExportNodes: vi.fn(async (input) => ({ service: "sessionExportNodes", input }))
    };
    const tools = createFormaTools(fakeStore({ v6 }));
    const scopedInput = {
      session_id: "S-1234567890abcdef",
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout",
      frame_id: "frame-1"
    };

    await tools.get_requirement_design_canvas({ product_id: "P-123abc", requirement_id: "R-12345678" });
    await tools.index_requirement_design_canvas({ product_id: "P-123abc", requirement_id: "R-12345678" });
    await tools.get_requirement_design_scene({ product_id: "P-123abc", requirement_id: "R-12345678" });
    await tools.get_requirement_design_history({ product_id: "P-123abc", requirement_id: "R-12345678" });
    await tools.rollback_requirement_design({ product_id: "P-123abc", requirement_id: "R-12345678", canvas_version: 2 });
    await tools.diff_requirement_design_versions({ product_id: "P-123abc", requirement_id: "R-12345678", from_canvas_version: 1, to_canvas_version: 2 });
    await tools.export_requirement_design_asset({ product_id: "P-123abc", requirement_id: "R-12345678", kind: "canvas" });
    await tools.index_component_usages({ product_id: "P-123abc", requirement_id: "R-12345678", write: false });
    await tools.refresh_requirement_components({ session_id: "S-1234567890abcdef", product_id: "P-123abc", requirement_id: "R-12345678", version: "latest", scope: "all_pages" });
    await tools.plan_import_metadata_normalization(scopedInput);
    await tools.validate_requirement_design_quality(scopedInput);
    await tools.session_get_editor_state({ session_id: "S-1234567890abcdef", include_schema: true });
    await tools.session_get_guidelines({ session_id: "S-1234567890abcdef", category: "guide", name: "Design System" });
    await tools.session_get_variables({ session_id: "S-1234567890abcdef" });
    await tools.session_batch_get({ session_id: "S-1234567890abcdef", nodeIds: ["frame-1"] });
    await tools.session_snapshot_layout({ session_id: "S-1234567890abcdef", parentId: "frame-1", problemsOnly: false, maxDepth: 8 });
    await tools.session_get_screenshot({ session_id: "S-1234567890abcdef", nodeId: "frame-1" });
    await tools.session_export_nodes({ session_id: "S-1234567890abcdef", nodeIds: ["frame-1"], format: "png" });

    expect(v6.getRequirementDesign).toHaveBeenCalledWith("/tmp/forma", "P-123abc", "R-12345678");
    expect(v6.indexRequirementDesignCanvas).toHaveBeenCalledWith({ home: "/tmp/forma", product_id: "P-123abc", requirement_id: "R-12345678" });
    expect(v6.getRequirementDesignScene).toHaveBeenCalledWith({ home: "/tmp/forma", product_id: "P-123abc", requirement_id: "R-12345678" });
    expect(v6.getRequirementDesignHistory).toHaveBeenCalledWith({ home: "/tmp/forma", product_id: "P-123abc", requirement_id: "R-12345678" });
    expect(v6.rollbackRequirementDesign).toHaveBeenCalledWith({ home: "/tmp/forma", product_id: "P-123abc", requirement_id: "R-12345678", canvas_version: 2 });
    expect(v6.diffRequirementDesignVersions).toHaveBeenCalledWith({ home: "/tmp/forma", product_id: "P-123abc", requirement_id: "R-12345678", from_canvas_version: 1, to_canvas_version: 2 });
    expect(v6.exportRequirementDesignAsset).toHaveBeenCalledWith({ home: "/tmp/forma", product_id: "P-123abc", requirement_id: "R-12345678", kind: "canvas" });
    expect(v6.indexRequirementComponentUsage).toHaveBeenCalledWith({ home: "/tmp/forma", product_id: "P-123abc", requirement_id: "R-12345678", write: false });
    expect(v6.refreshRequirementComponents).toHaveBeenCalledWith({ home: "/tmp/forma", session_id: "S-1234567890abcdef", product_id: "P-123abc", requirement_id: "R-12345678", version: "latest", scope: "all_pages" });
    expect(v6.planImportMetadataNormalization).toHaveBeenCalledWith({ home: "/tmp/forma", ...scopedInput });
    expect(v6.runDesignQualityPipeline).toHaveBeenCalledWith({ home: "/tmp/forma", ...scopedInput });
    expect(v6.sessionGetEditorState).toHaveBeenCalledWith({ home: "/tmp/forma", session_id: "S-1234567890abcdef", include_schema: true });
    expect(v6.sessionGetGuidelines).toHaveBeenCalledWith({ home: "/tmp/forma", session_id: "S-1234567890abcdef", category: "guide", name: "Design System" });
    expect(v6.sessionGetVariables).toHaveBeenCalledWith({ home: "/tmp/forma", session_id: "S-1234567890abcdef" });
    expect(v6.sessionBatchGet).toHaveBeenCalledWith({ home: "/tmp/forma", session_id: "S-1234567890abcdef", nodeIds: ["frame-1"] });
    expect(v6.sessionSnapshotLayout).toHaveBeenCalledWith({ home: "/tmp/forma", session_id: "S-1234567890abcdef", parentId: "frame-1", problemsOnly: false, maxDepth: 8 });
    expect(v6.sessionGetScreenshot).toHaveBeenCalledWith({ home: "/tmp/forma", session_id: "S-1234567890abcdef", nodeId: "frame-1" });
    expect(v6.sessionExportNodes).toHaveBeenCalledWith({ home: "/tmp/forma", session_id: "S-1234567890abcdef", nodeIds: ["frame-1"], format: "png" });
  });

  it("returns stable FORBIDDEN_PATH_PARAMETER errors for v6 path payloads", async () => {
    const tools = createFormaTools(fakeStore());

    const mutationResult = await tools.apply_requirement_design_operations({
      session_id: "S-1234567890abcdef",
      operations: [{ tool: "batch_design", args: { outputDir: "/tmp/out" }, intent: "generate" }]
    });
    const wrapperResult = await tools.session_export_nodes({
      session_id: "S-1234567890abcdef",
      nodeIds: ["frame-1"],
      output_dir: "/tmp/out"
    });

    expect(mutationResult.isError).toBe(true);
    expect(textPayload(mutationResult)).toMatchObject({
      error_code: "FORBIDDEN_PATH_PARAMETER",
      details: { parameter: "operations.0.args.outputDir" }
    });
    expect(wrapperResult.isError).toBe(true);
    expect(textPayload(wrapperResult)).toMatchObject({
      error_code: "FORBIDDEN_PATH_PARAMETER",
      details: { parameter: "output_dir" }
    });
  });

  it("returns JSON text on success", async () => {
    const tools = createFormaTools(fakeStore());

    const result = await tools.list_products({});

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify([{ id: "P-123abc", name: "App", description: "Demo" }]) }]
    });
  });

  it("wraps FormaError as MCP error result", async () => {
    const tools = createFormaTools(
      fakeStore({
        products: {
          ...fakeStore().products,
          getProduct: vi.fn(async () => {
            throw new FormaError("PRODUCT_NOT_FOUND", "Product not found");
          })
        }
      })
    );

    const result = await tools.get_product({ product_id: "P-missing" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toEqual({
      error_code: "PRODUCT_NOT_FOUND",
      message: "Product not found",
      details: {}
    });
  });

  it("wraps invalid input and unexpected runtime errors as structured errors", async () => {
    const tools = createFormaTools(
      fakeStore({
        products: {
          ...fakeStore().products,
          listProducts: vi.fn(async () => {
            throw new Error("boom");
          })
        }
      })
    );

    const validationResult = await tools.get_product({});
    const runtimeResult = await tools.list_products({});

    expect(validationResult.isError).toBe(true);
    expect(textPayload(validationResult)).toMatchObject({
      error_code: "VALIDATION_ERROR",
      message: "Invalid tool input",
      details: { issues: expect.any(Array) }
    });
    expect(runtimeResult.isError).toBe(true);
    expect(textPayload(runtimeResult)).toEqual({
      error_code: "INTERNAL_ERROR",
      message: "Unexpected tool error",
      details: {}
    });
  });

  it("delegates representative non-legacy tools to core", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    await tools.get_product({ product_id: "P-123abc" });
    await tools.get_product_rules({ product_id: "P-123abc" });
    await tools.get_requirement({ requirement_id: "R-12345678" });

    expect(store.products.getProduct).toHaveBeenCalledWith("P-123abc");
    expect(store.requirements.getProductRules).toHaveBeenCalledWith("P-123abc");
    expect(store.copy.getTranslations).toHaveBeenCalledWith("P-123abc", "R-12345678");
  });

  it("delete_product returns the core result and delegates to store.deleteProduct", async () => {
    const deleted = {
      product_id: "P-123abc",
      deleted: true,
      session_cleared: true,
      cleanup_pending: false,
      recovery_warnings: []
    };
    const store = fakeStore({
      deleteProduct: vi.fn(async () => deleted)
    });
    const tools = createFormaTools(store);

    const result = await tools.delete_product({ product_id: "P-123abc", confirm_product_id: "P-123abc" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toEqual(deleted);
    expect(store.deleteProduct).toHaveBeenCalledWith({ product_id: "P-123abc", confirm_product_id: "P-123abc" });
  });

  it("delete_product rejects missing or mismatched confirmation without calling the store", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const missing = await tools.delete_product({ product_id: "P-123abc" });
    const mismatch = await tools.delete_product({ product_id: "P-123abc", confirm_product_id: "P-other" });

    expect(missing.isError).toBe(true);
    expect(textPayload(missing)).toMatchObject({ error_code: "VALIDATION_ERROR" });
    expect(mismatch.isError).toBe(true);
    expect(textPayload(mismatch)).toMatchObject({
      error_code: "VALIDATION_ERROR",
      details: { issues: expect.arrayContaining([expect.objectContaining({ path: ["confirm_product_id"] })]) }
    });
    expect(store.deleteProduct).not.toHaveBeenCalled();
  });

  it("delete_product passes through core product mutation lock errors", async () => {
    const store = fakeStore({
      deleteProduct: vi.fn(async () => {
        throw new FormaError("PRODUCT_MUTATION_LOCKED", "Product mutation lock is held", {
          operation: "delete_product",
          product_id: "P-123abc"
        });
      })
    });
    const tools = createFormaTools(store);

    const result = await tools.delete_product({ product_id: "P-123abc", confirm_product_id: "P-123abc" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toEqual({
      error_code: "PRODUCT_MUTATION_LOCKED",
      message: "Product mutation lock is held",
      details: { operation: "delete_product", product_id: "P-123abc" }
    });
  });

  it("delete_product preserves recovery warnings in successful responses", async () => {
    const store = fakeStore({
      deleteProduct: vi.fn(async () => ({
        product_id: "P-123abc",
        deleted: true,
        session_cleared: false,
        cleanup_pending: true,
        recovery_warnings: ["cleanup was deferred"]
      }))
    });
    const tools = createFormaTools(store);

    const result = await tools.delete_product({ product_id: "P-123abc", confirm_product_id: "P-123abc" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({
      cleanup_pending: true,
      recovery_warnings: ["cleanup was deferred"]
    });
  });

  it("get_current_session never points to a product while delete_product is clearing or removing it", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-delete-session-"));
    await writeFile(join(home, ".v6-schema-cutover-committed"), "committed\n", "utf8");
    const observations: Array<{ phase: string; current_product: string | null }> = [];
    let tools: ReturnType<typeof createFormaTools>;
    const productDeletionHooks: NonNullable<Parameters<typeof createFormaStore>[0]["productDeletionHooks"]> = {
      afterPhasePersisted: async (state) => {
        if (["session_written", "index_written", "moved"].includes(state.phase)) {
          const session = textPayload(await tools.get_current_session({})) as { current_product: string | null };
          expect(session.current_product).not.toBe(state.product_id);
          observations.push({ phase: state.phase, current_product: session.current_product });
        }
      }
    };
    const store = await createFormaStore({
      home,
      bundledStylesDir: resolve("styles"),
      productDeletionHooks
    });
    tools = createFormaTools(store);
    const product = await store.products.createProduct({ name: "Delete Me", description: "Temporary" });
    await store.products.initProductConfig(product.id, {
      platform: "web",
      languages: ["en"],
      default_language: "en",
      style: {
        name: "linear",
        description: "Focused tool UI",
        design_md_path: "styles/linear/DESIGN.md",
        variables: store.styles.withDefaultVariables({ primary: "#5E6AD2" })
      }
    });
    await store.sessions.setCurrentProduct(product.id);

    const result = await tools.delete_product({ product_id: product.id, confirm_product_id: product.id });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({ product_id: product.id, session_cleared: true });
    expect(textPayload(await tools.get_current_session({}))).toEqual({ current_product: null });
    expect(observations).toEqual([
      { phase: "session_written", current_product: null },
      { phase: "index_written", current_product: null },
      { phase: "moved", current_product: null }
    ]);
  });

  it("init_product_config updates config for an existing product and does not create products", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);
    const style = sampleStyle();

    await tools.init_product_config({
      product_id: "P-123abc",
      platform: "web",
      style,
      languages: ["en", "zh-CN"],
      default_language: "en"
    });

    expect(store.products.initProductConfig).toHaveBeenCalledWith("P-123abc", {
      platform: "web",
      style,
      languages: ["en", "zh-CN"],
      default_language: "en"
    });
    expect(store.products.createProduct).not.toHaveBeenCalled();
  });

  it("init_product_config rejects missing languages and default_language", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.init_product_config({ product_id: "P-123abc", platform: "web", style: sampleStyle() });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({
      error_code: "VALIDATION_ERROR",
      message: "Invalid tool input",
      details: { issues: expect.any(Array) }
    });
    expect(store.products.initProductConfig).not.toHaveBeenCalled();
  });

  it("update_product_config rejects missing languages and default_language", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.update_product_config({ product_id: "P-123abc", platform: "web", style: sampleStyle() });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({
      error_code: "VALIDATION_ERROR",
      message: "Invalid tool input",
      details: { issues: expect.any(Array) }
    });
    expect(store.products.initProductConfig).not.toHaveBeenCalled();
  });

  it("config tools share the language-aware schema and validate default_language membership", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);
    const style = sampleStyle();

    const invalid = await tools.update_product_config({
      product_id: "P-123abc",
      platform: "web",
      style,
      languages: ["en"],
      default_language: "zh-CN"
    });
    await tools.init_product_config({
      product_id: "P-123abc",
      platform: "web",
      style,
      languages: ["en", "zh-CN"],
      default_language: "zh-CN"
    });
    await tools.update_product_config({
      product_id: "P-123abc",
      platform: "mobile",
      style,
      languages: ["en", "zh-CN"],
      default_language: "en"
    });

    expect(invalid.isError).toBe(true);
    expect(textPayload(invalid)).toMatchObject({
      error_code: "VALIDATION_ERROR",
      details: { issues: expect.any(Array) }
    });
    expect(store.products.initProductConfig).toHaveBeenNthCalledWith(1, "P-123abc", {
      platform: "web",
      style,
      languages: ["en", "zh-CN"],
      default_language: "zh-CN"
    });
    expect(store.products.initProductConfig).toHaveBeenNthCalledWith(2, "P-123abc", {
      platform: "mobile",
      style,
      languages: ["en", "zh-CN"],
      default_language: "en"
    });
  });

  it("init_product_config rejects product creation input shape as structured validation error", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.init_product_config({ name: "App", description: "Demo" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({
      error_code: "VALIDATION_ERROR",
      message: "Invalid tool input",
      details: { issues: expect.any(Array) }
    });
    expect(store.products.createProduct).not.toHaveBeenCalled();
  });

  it("get_product returns persisted language configuration", async () => {
    const tools = createFormaTools(fakeStore());

    const result = await tools.get_product({ product_id: "P-123abc" });

    expect(textPayload(result)).toMatchObject({
      id: "P-123abc",
      languages: ["en", "zh-CN"],
      default_language: "en"
    });
  });

  it("save_requirement requires the v0.3 shape, accepts optional copy fields, and rejects expired_pages", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);
    const input = {
      requirement_id: "R-12345678",
      document_md: "# Checkout",
      ui_affected: true,
      pages: [{
        page_id: "checkout",
        name: "Checkout",
        baseline_page: "checkout",
        change_type: "new",
        features: "Pay for an order",
        copy: [{ context: "submit", text: "Pay now" }],
        fields: "email",
        interactions: "tap submit"
      }],
      navigation: [{ from: "cart", to: "checkout", label: "Checkout" }],
      translations: [{
        page_id: "checkout",
        entries: [{ context: "submit", texts: { "zh-CN": "立即支付" } }]
      }],
      rules: [{
        id: "rule-1",
        page_id: "checkout",
        given: "items are in cart",
        when: "checkout opens",
        then: "show payment form",
        replaces_rule_id: "old-rule"
      }],
      remove_rule_ids: ["old-rule-2"],
      remove_page_ids: ["legacy"]
    };

    const result = await tools.save_requirement(input);
    const invalid = await tools.save_requirement({ ...input, expired_pages: ["checkout"] });
    for (const requiredField of ["requirement_id", "document_md", "ui_affected", "pages", "navigation"] as const) {
      const missing = { ...input };
      delete missing[requiredField];
      const missingResult = await tools.save_requirement(missing);
      expect(missingResult.isError).toBe(true);
      expect(textPayload(missingResult)).toMatchObject({ error_code: "VALIDATION_ERROR" });
    }

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toEqual({ id: "R-12345678", status: "submitted" });
    expect(store.requirements.saveRequirement).toHaveBeenCalledWith(input);
    expect(invalid.isError).toBe(true);
    expect(textPayload(invalid)).toMatchObject({ error_code: "VALIDATION_ERROR" });
  });

  it("save_requirement delegates to the unified requirement state machine", async () => {
    const saved = { id: "R-12345678", product_id: "P-123abc", status: "active", pages: [] };
    const store = fakeStore({
      requirements: {
        ...fakeStore().requirements,
        saveRequirement: vi.fn(async () => saved)
      }
    });
    const tools = createFormaTools(store);
    const input = {
      requirement_id: "R-12345678",
      document_md: "# Logic update",
      ui_affected: false,
      pages: [],
      navigation: []
    };

    const result = await tools.save_requirement(input);

    expect(store.requirements.saveRequirement).toHaveBeenCalledWith(input);
    expect(textPayload(result)).toEqual(saved);
  });

  it("get_requirement includes copy translations without legacy page-level design metadata", async () => {
    const translations = [{
      page_id: "checkout",
      entries: [{ context: "submit", texts: { "zh-CN": "立即支付" } }]
    }];
    const store = fakeStore({
      copy: {
        ...fakeStore().copy,
        getTranslations: vi.fn(async () => translations)
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-12345678",
          product_id: "P-123abc",
          pages: [
            { page_id: "checkout", baseline_page: "checkout", design_status: "done" },
            { page_id: "profile", baseline_page: "profile" }
          ]
        }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_requirement({ requirement_id: "R-12345678" });

    expect(store.copy.getTranslations).toHaveBeenCalledWith("P-123abc", "R-12345678");
    expect(textPayload(result)).toMatchObject({
      id: "R-12345678",
      copy_translations: translations,
      pages: [
        { page_id: "checkout", baseline_page: "checkout", design_status: "done" },
        { page_id: "profile" }
      ]
    });
    expect(JSON.stringify(textPayload(result))).not.toContain("design_metadata");
    expect(JSON.stringify(textPayload(result))).not.toContain("pen_path");
    expect(JSON.stringify(textPayload(result))).not.toContain("preview_path");
  });

  it("get_requirement does not touch removed legacy design metadata", async () => {
    const store = fakeStore({
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-12345678",
          product_id: "P-123abc",
          pages: [{ page_id: "checkout", baseline_page: "checkout", design_status: "done" }]
        }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_requirement({ requirement_id: "R-12345678" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({
      id: "R-12345678",
      pages: [{ page_id: "checkout", baseline_page: "checkout", design_status: "done" }]
    });
  });

  it("get_product_rules returns stored rules", async () => {
    const rules = [{
      id: "R-12345678-rule-1",
      page_id: "checkout",
      given: "cart has items",
      when: "checkout opens",
      then: "payment form appears",
      source_requirement: "R-12345678"
    }];
    const store = fakeStore({
      requirements: {
        ...fakeStore().requirements,
        getProductRules: vi.fn(async () => rules)
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_product_rules({ product_id: "P-123abc" });

    expect(store.requirements.getProductRules).toHaveBeenCalledWith("P-123abc");
    expect(textPayload(result)).toEqual(rules);
  });

  it("get_page_copy without requirement_id resolves latest non-archived requirement for the product", async () => {
    const translations = [{
      page_id: "checkout",
      entries: [{ context: "submit", texts: { "zh-CN": "立即支付" } }]
    }];
    const store = fakeStore({
      copy: {
        ...fakeStore().copy,
        getTranslations: vi.fn(async () => translations)
      },
      requirements: {
        ...fakeStore().requirements,
        getLatestRequirement: vi.fn(async () => ({
          id: "R-latest1",
          product_id: "P-123abc",
          status: "active",
          pages: [{
            page_id: "checkout",
            baseline_page: "checkout",
            copy: [{ context: "submit", text: "Pay now" }]
          }]
        }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_page_copy({ product_id: "P-123abc", page_id: "checkout" });

    expect(store.requirements.getLatestRequirement).toHaveBeenCalledWith("P-123abc");
    expect(store.copy.getTranslations).toHaveBeenCalledWith("P-123abc", "R-latest1");
    expect(textPayload(result)).toEqual({
      product_id: "P-123abc",
      requirement_id: "R-latest1",
      page_id: "checkout",
      copy: [{ context: "submit", text: "Pay now" }],
      translations: translations[0]
    });
  });

  it("get_page_copy with explicit requirement_id rejects cross-product access", async () => {
    const store = fakeStore({
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({ id: "R-12345678", product_id: "P-other1", pages: [] }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_page_copy({ product_id: "P-123abc", requirement_id: "R-12345678", page_id: "checkout" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toEqual({
      error_code: "REQUIREMENT_PRODUCT_MISMATCH",
      message: "Requirement does not belong to product",
      details: { product_id: "P-123abc", requirement_id: "R-12345678", requirement_product_id: "P-other1" }
    });
  });

  it("update_page_copy updates selected page translations and returns the updated translation set", async () => {
    const updatedTranslations = [{
      page_id: "checkout",
      entries: [
        { context: "submit", texts: { "zh-CN": "现在支付" } },
        { context: "headline", texts: { "zh-CN": "结账" } }
      ]
    }];
    const store = fakeStore({
      copy: {
        ...fakeStore().copy,
        updatePageTranslations: vi.fn(async () => undefined),
        getTranslations: vi.fn(async () => updatedTranslations)
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-12345678",
          product_id: "P-123abc",
          pages: [{ page_id: "checkout", baseline_page: "checkout" }]
        }))
      }
    });
    const tools = createFormaTools(store);
    const translations = [
      { context: "submit", texts: { "zh-CN": "现在支付" }, outdated: true },
      { context: "headline", texts: { "zh-CN": "结账" } }
    ];

    const result = await tools.update_page_copy({ requirement_id: "R-12345678", page_id: "checkout", translations });

    expect(store.copy.updatePageTranslations).toHaveBeenCalledWith("P-123abc", "R-12345678", "checkout", translations);
    expect(store.copy.getTranslations).toHaveBeenCalledWith("P-123abc", "R-12345678");
    expect(textPayload(result)).toEqual(updatedTranslations);
  });

  it("update_page_copy rejects pages that do not belong to the requirement", async () => {
    const store = fakeStore({
      copy: {
        ...fakeStore().copy,
        updatePageTranslations: vi.fn(async () => undefined)
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-12345678",
          product_id: "P-123abc",
          pages: [{ page_id: "profile", baseline_page: "profile" }]
        }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.update_page_copy({
      requirement_id: "R-12345678",
      page_id: "checkout",
      translations: [{ context: "submit", texts: { "zh-CN": "现在支付" } }]
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toEqual({
      error_code: "REQUIREMENT_PAGE_NOT_FOUND",
      message: "Requirement page not found",
      details: { product_id: "P-123abc", requirement_id: "R-12345678", page_id: "checkout" }
    });
    expect(store.copy.updatePageTranslations).not.toHaveBeenCalled();
  });

  it("get_baseline_image reads v6 requirement-level design metadata", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-baseline-"));
    const requirementDir = join(home, "data", "P-123abc", "R-a1111111");
    const previewPath = join(requirementDir, "previews", "old-page@2x.png");
    const canvasPath = join(requirementDir, "design.pen");
    await mkdir(dirname(previewPath), { recursive: true });
    await writeFile(previewPath, "preview");
    await writeFile(canvasPath, "pen");
    await writeFile(join(requirementDir, "design.yaml"), [
      "schema_version: 1",
      "product_id: P-123abc",
      "requirement_id: R-a1111111",
      "canvas_file: design.pen",
      "canvas_version: 7",
      "pages:",
      "  - page_id: old-page",
      "    status: done",
      "    preview_file: previews/old-page@2x.png",
      "    page_version: 3",
      "history: []",
      ""
    ].join("\n"));
    const store = fakeStore({
      home,
      baseline: {
        getProductBaseline: vi.fn(async () => ({
          product_id: "P-123abc",
          pages: [{
            id: "checkout",
            name: "Checkout",
            features: "",
            copy: [],
            fields: "",
            interactions: "",
            semantic_contract: { fields: [], actions: [], navigation: [], component_keys: [], allowed_copy: [] },
            source_requirements: ["R-a1111111", "R-b2222222"]
          }],
          navigation: []
        }))
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-latest1",
          created_at: "2026-05-17T03:00:00.000Z",
          pages: [{ page_id: "latest-page", baseline_page: "profile", design_status: "done" }]
        })),
        getRequirementHistory: vi.fn(async () => [
          {
            id: "R-a1111111",
            created_at: "2026-05-17T01:00:00.000Z",
            updated_at: "2026-05-17T01:00:00.000Z",
            pages: [{ page_id: "old-page", baseline_page: "checkout", design_status: "done" }]
          },
          {
            id: "R-b2222222",
            created_at: "2026-05-17T02:00:00.000Z",
            updated_at: "2026-05-17T02:00:00.000Z",
            pages: [{ page_id: "new-page", baseline_page: "checkout", design_status: "pending" }]
          },
          {
            id: "R-latest1",
            created_at: "2026-05-17T03:00:00.000Z",
            updated_at: "2026-05-17T03:00:00.000Z",
            pages: [{ page_id: "latest-page", baseline_page: "profile", design_status: "done" }]
          }
        ])
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_baseline_image({ product_id: "P-123abc", page_id: "checkout" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toEqual({
      product_id: "P-123abc",
      baseline_page_id: "checkout",
      requirement_id: "R-a1111111",
      requirement_page_id: "old-page",
      preview_url: "/api/products/P-123abc/baseline/pages/checkout/image",
      preview_path: previewPath,
      canvas_path: canvasPath,
      page_version: 3,
      canvas_version: 7
    });
    expect(store.requirements.getRequirement).not.toHaveBeenCalled();
  });

  it("get_baseline_image breaks updated_at ties by newest requirement id", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-baseline-"));
    for (const id of ["R-aaaa1111", "R-bbbb2222"]) {
      const requirementDir = join(home, "data", "P-123abc", id);
      await mkdir(join(requirementDir, "previews"), { recursive: true });
      await writeFile(join(requirementDir, "design.pen"), "pen");
      await writeFile(join(requirementDir, "previews", "checkout@2x.png"), id);
      await writeFile(join(requirementDir, "design.yaml"), [
        "schema_version: 1",
        "product_id: P-123abc",
        `requirement_id: ${id}`,
        "canvas_file: design.pen",
        "canvas_version: 1",
        "pages:",
        "  - page_id: checkout",
        "    status: done",
        "    preview_file: previews/checkout@2x.png",
        "    page_version: 1",
        "history: []",
        ""
      ].join("\n"));
    }
    const store = fakeStore({
      home,
      baseline: {
        getProductBaseline: vi.fn(async () => ({
          product_id: "P-123abc",
          pages: [{
            id: "checkout",
            name: "Checkout",
            features: "",
            copy: [],
            fields: "",
            interactions: "",
            semantic_contract: { fields: [], actions: [], navigation: [], component_keys: [], allowed_copy: [] },
            source_requirements: ["R-aaaa1111", "R-bbbb2222"]
          }],
          navigation: []
        }))
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirementHistory: vi.fn(async () => [
          {
            id: "R-aaaa1111",
            created_at: "2026-05-17T01:00:00.000Z",
            updated_at: "2026-05-17T01:00:00.000Z",
            pages: [{ page_id: "checkout", baseline_page: "checkout", design_status: "done" }]
          },
          {
            id: "R-bbbb2222",
            created_at: "2026-05-17T01:00:00.000Z",
            updated_at: "2026-05-17T01:00:00.000Z",
            pages: [{ page_id: "checkout", baseline_page: "checkout", design_status: "done" }]
          }
        ])
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_baseline_image({ product_id: "P-123abc", page_id: "checkout" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({ requirement_id: "R-bbbb2222" });
  });

  it("get_baseline_image does not scan old page-level design directories", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-baseline-"));
    const legacyPreviewPath = join(home, "data", "P-123abc", "R-c3333333", "D-a1b2c3d4", "preview@2x.png");
    await mkdir(dirname(legacyPreviewPath), { recursive: true });
    await writeFile(legacyPreviewPath, "preview");
    const store = fakeStore({
      home,
      baseline: {
        getProductBaseline: vi.fn(async () => ({
          product_id: "P-123abc",
          pages: [{
            id: "checkout",
            name: "Checkout",
            features: "",
            copy: [],
            fields: "",
            interactions: "",
            semantic_contract: { fields: [], actions: [], navigation: [], component_keys: [], allowed_copy: [] },
            source_requirements: ["R-c3333333"]
          }],
          navigation: []
        }))
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirementHistory: vi.fn(async () => [{
          id: "R-c3333333",
          created_at: "2026-05-17T01:00:00.000Z",
          updated_at: "2026-05-17T01:00:00.000Z",
          pages: [{ page_id: "checkout-page", baseline_page: "checkout", design_status: "done" }]
        }])
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_baseline_image({ product_id: "P-123abc", page_id: "checkout" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({
      error_code: "BASELINE_IMAGE_NOT_FOUND",
      details: { product_id: "P-123abc", page_id: "checkout" }
    });
  });

  it("get_baseline_image does not use unrelated latest requirement page_id collisions", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-baseline-"));
    const collidingPreviewPath = join(home, "data", "P-123abc", "R-d4444444", "D-wrong11", "preview@2x.png");
    await mkdir(dirname(collidingPreviewPath), { recursive: true });
    await writeFile(collidingPreviewPath, "preview");
    const store = fakeStore({
      home,
      baseline: {
        getProductBaseline: vi.fn(async () => ({
          product_id: "P-123abc",
          pages: [{
            id: "checkout",
            name: "Checkout",
            features: "",
            copy: [],
            fields: "",
            interactions: "",
            semantic_contract: { fields: [], actions: [], navigation: [], component_keys: [], allowed_copy: [] },
            source_requirements: ["R-old1111"]
          }],
          navigation: []
        }))
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-d4444444",
          created_at: "2026-05-17T03:00:00.000Z",
          pages: [{ page_id: "checkout", baseline_page: "profile", design_status: "done" }]
        })),
        getRequirementHistory: vi.fn(async () => [
          {
            id: "R-old1111",
            created_at: "2026-05-17T01:00:00.000Z",
            updated_at: "2026-05-17T01:00:00.000Z",
            pages: [{ page_id: "old-page", baseline_page: "checkout", design_status: "pending" }]
          },
          {
            id: "R-latest1",
            created_at: "2026-05-17T03:00:00.000Z",
            updated_at: "2026-05-17T03:00:00.000Z",
            pages: [{ page_id: "checkout", baseline_page: "profile", design_status: "done" }]
          }
        ])
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_baseline_image({ product_id: "P-123abc", page_id: "checkout" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({
      error_code: "BASELINE_IMAGE_NOT_FOUND",
      message: "Baseline image not found",
      details: { product_id: "P-123abc", page_id: "checkout" }
    });
    expect(store.requirements.getRequirement).not.toHaveBeenCalled();
  });
});
