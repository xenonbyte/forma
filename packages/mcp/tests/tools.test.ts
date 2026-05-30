import { FormaError, createFormaStore, type FormaStore } from "@xenonbyte/forma-core";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import AdmZip from "adm-zip";
import { describe, expect, it, vi } from "vitest";
import * as z from "zod/v4";
import { createFormaTools, formaToolInputSchemas, formaToolNames, registerFormaTools, type FormaToolName } from "../src/index.js";

vi.mock("@xenonbyte/forma-core", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    createOdRuntime: vi.fn(() => ({
      generate: vi.fn(async () => ({
        manifest: fakeManifest(),
        supportingFiles: new Map([
          ["preview/2x.png", new Uint8Array()],
          ["preview/1x.png", new Uint8Array()]
        ])
      }))
    }))
  };
});

const removedLegacyToolNames = [
  "complete_product_init",
  "generate_page_design",
  "save_designs",
  "generate_and_save_page_design",
  "rollback_design",
  "diff_designs",
  "get_design_annotations",
  "export_design_asset",
  "get_current_session",
  "set_current_session"
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
  // rollback_requirement_design is intentionally NOT listed here:
  // it was a v6 legacy name but is re-added as a C-03 artifact tool
  "diff_requirement_design_versions",
  "export_requirement_design_asset",
  "get_product_component_library",
  "index_component_usages",
  "refresh_requirement_components",
  "plan_import_metadata_normalization",
  "validate_requirement_design_quality",
  "session_get_editor_state"
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

function fakeManifest() {
  return {
    version: 1 as const,
    id: "ABCDEFGHIJ123456",
    kind: "html" as const,
    renderer: "html" as const,
    title: "Test Page",
    entry: "index.html",
    status: "complete" as const,
    exports: ["index.html"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function fakeStore(overrides: Record<string, unknown> = {}) {
  const store = {
    home: "/tmp/forma",
    artifacts: {
      writeArtifact: vi.fn(async () => ({ artifactId: "ABCDEFGHIJ123456", etag: "sha256:abc" })),
      readArtifact: vi.fn(async () => ({ manifest: fakeManifest(), etag: "sha256:abc" })),
      listArtifacts: vi.fn(async () => []),
      deleteArtifact: vi.fn(async () => undefined),
      listArtifactVersions: vi.fn(async () => [1, 2]),
      writeArtifactVersion: vi.fn(async () => ({ etag: "sha256:abc" })),
      readArtifactVersion: vi.fn(async () => ({ manifest: fakeManifest(), etag: "sha256:abc" }))
    },
    copy: {
      getTranslations: vi.fn(async () => []),
      updatePageTranslations: vi.fn(async () => undefined)
    },
    deleteProduct: vi.fn(async () => ({
      product_id: "P-123abc",
      deleted: true,
      session_cleared: false,
      cleanup_pending: false,
      recovery_warnings: []
    })),
    generateRequirementDesign: vi.fn(async () => ({
      artifact_id: "ABCDEFGHIJ123456",
      version: 1,
      preview_status: "pending"
    })),
    generateComponents: vi.fn(async () => ({
      artifact_id: "ABCDEFGHIJ123456",
      version: 1,
      preview_status: "pending"
    })),
    changeArtifactStyle: vi.fn(async () => ({
      artifact_id: "ABCDEFGHIJ123456",
      version: 1,
      preview_status: "pending"
    })),
    products: {
      createProduct: vi.fn(async () => ({ id: "P-123abc", name: "App", description: "Demo" })),
      getProduct: vi.fn(async () => ({
        id: "P-123abc",
        name: "App",
        description: "Demo",
        platform: "web",
        style: { name: "linear" },
        languages: ["en", "zh-CN"],
        default_language: "en",
        designSystemArtifactId: "DS_ARTIFACT123456",
        requirements: {
          "R-12345678": { latestArtifactId: "OLDARTIFACT12345" }
        }
      })),
      initProductConfig: vi.fn(async (_productId: string, config: unknown) => ({ id: "P-123abc", ...config as object })),
      listProducts: vi.fn(async () => [{ id: "P-123abc", name: "App", description: "Demo" }]),
      setRequirementArtifactPointerLocked: vi.fn(async () => undefined as string | undefined),
      setDesignSystemArtifactPointerLocked: vi.fn(async () => undefined),
      getDesignPointer: vi.fn(async () => ({
        requirementId: "R-12345678",
        pageId: "page-home",
        variant: "default",
        artifactId: "ABCDEFGHIJ123456",
        version: 2,
        designStatus: "active" as const
      })),
      listDesignPointers: vi.fn(async () => []),
      rollbackDesignPointerLocked: vi.fn(async () => undefined)
    },
    recoverPendingProductDeletes: vi.fn(async () => ({ warnings: [], recovered: [] })),
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
    runProductMutation: vi.fn(async (_input: unknown, fn: (ctx: { warnings: string[] }) => Promise<unknown>) => fn({ warnings: [] })),
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
  return store as unknown as FormaStore;
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
    for (const v6ToolName of v6ToolNames) {
      expect(formaToolNames).not.toContain(v6ToolName);
      expect(Object.keys(tools)).not.toContain(v6ToolName);
    }
    expect(formaToolNames).toEqual(expect.arrayContaining([
      "save_requirement",
      "get_product_rules",
      "get_page_copy",
      "delete_product",
      "confirm_product_id",
      "generate_requirement_design",
      "generate_components",
      "change_artifact_style",
      "get_design_context",
      "session_get_guidelines",
      "session_get_variables",
      "session_batch_get",
      "session_snapshot_layout",
      "session_get_screenshot",
      "session_export_nodes"
    ]));
    expect(formaToolNames).not.toContain("change_style");
    expect(formaToolNames).not.toContain("refine_requirement_design");
    expect(formaToolNames).not.toContain("update_page_copy");
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

  it("v6 session wrapper schemas reject caller path fields", () => {
    for (const [toolName, validInput] of Object.entries(wrapperToolInputs) as Array<[FormaToolName, Record<string, unknown>]>) {
      expectSchemaSuccess(toolName, validInput);
      for (const field of forbiddenPathFields) {
        expectSchemaFailure(toolName, { ...validInput, [field]: "/tmp/agent-owned" }, "FORBIDDEN_PATH_PARAMETER");
      }
    }
  });

  it("rejects malformed session ids for session-owned tools", () => {
    const malformedSessionId = "S-1234567890abcdef/../S-fedcba0987654321";
    const sessionInputs: Array<[FormaToolName, Record<string, unknown>]> = [
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

  it("returns stable FORBIDDEN_PATH_PARAMETER errors for v6 path payloads", async () => {
    const tools = createFormaTools(fakeStore());

    const wrapperResult = await tools.session_export_nodes({
      session_id: "S-1234567890abcdef",
      nodeIds: ["frame-1"],
      output_dir: "/tmp/out"
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

  it("sessions.getCurrentSession never points to a product while delete_product is clearing or removing it", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-delete-session-"));
    await writeFile(join(home, ".v6-schema-cutover-committed"), "committed\n", "utf8");
    const observations: Array<{ phase: string; current_product: string | null }> = [];
    let store: Awaited<ReturnType<typeof createFormaStore>>;
    const productDeletionHooks: NonNullable<Parameters<typeof createFormaStore>[0]["productDeletionHooks"]> = {
      afterPhasePersisted: async (state) => {
        if (["session_written", "index_written", "moved"].includes(state.phase)) {
          const session = await store.sessions.getCurrentSession() as { current_product: string | null };
          expect(session.current_product).not.toBe(state.product_id);
          observations.push({ phase: state.phase, current_product: session.current_product });
        }
      }
    };
    store = await createFormaStore({
      home,
      bundledStylesDir: resolve("styles"),
      productDeletionHooks
    });
    const tools = createFormaTools(store);
    const product = await store.products.createProduct({ name: "Delete Me", description: "Temporary" });
    await store.products.initProductConfig(product.id, {
      platform: "web",
      brand_style: "linear",
      languages: ["en"],
      default_language: "en"
    });
    await store.sessions.setCurrentProduct(product.id);

    const result = await tools.delete_product({ product_id: product.id, confirm_product_id: product.id });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({ product_id: product.id, session_cleared: true });
    const finalSession = await store.sessions.getCurrentSession() as { current_product: string | null };
    expect(finalSession).toEqual({ current_product: null });
    expect(observations).toEqual([
      { phase: "session_written", current_product: null },
      { phase: "index_written", current_product: null },
      { phase: "moved", current_product: null }
    ]);
  });

  it("init_product_config updates config for an existing product and does not create products", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    await tools.init_product_config({
      product_id: "P-123abc",
      platform: "web",
      brand_style: "linear",
      languages: ["en", "zh-CN"],
      default_language: "en"
    });

    expect(store.products.initProductConfig).toHaveBeenCalledWith("P-123abc", {
      platform: "web",
      brand_style: "linear",
      languages: ["en", "zh-CN"],
      default_language: "en"
    });
    expect(store.products.createProduct).not.toHaveBeenCalled();
  });

  it("init_product_config rejects missing languages and default_language", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.init_product_config({ product_id: "P-123abc", platform: "web", brand_style: "linear" });

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

    const result = await tools.update_product_config({ product_id: "P-123abc", platform: "web", brand_style: "linear" });

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

    const invalid = await tools.update_product_config({
      product_id: "P-123abc",
      platform: "web",
      brand_style: "linear",
      languages: ["en"],
      default_language: "zh-CN"
    });
    await tools.init_product_config({
      product_id: "P-123abc",
      platform: "web",
      brand_style: "linear",
      languages: ["en", "zh-CN"],
      default_language: "zh-CN"
    });
    await tools.update_product_config({
      product_id: "P-123abc",
      platform: "mobile",
      brand_style: "linear",
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
      brand_style: "linear",
      languages: ["en", "zh-CN"],
      default_language: "zh-CN"
    });
    expect(store.products.initProductConfig).toHaveBeenNthCalledWith(2, "P-123abc", {
      platform: "mobile",
      brand_style: "linear",
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

  it("get_baseline_image returns path pointing to artifact preview PNG (artifact store path)", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.get_baseline_image({ product_id: "P-123abc" });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    // Path should include the artifact id and point to preview/2x.png
    expect(payload.path).toMatch(/DS_ARTIFACT123456/);
    expect(payload.path).toMatch(/preview[/\\]2x\.png$/);
  });

  it("get_baseline_image returns only product_id in schema (no page_id parameter)", () => {
    // Verify that the schema for get_baseline_image only accepts product_id
    expectSchemaSuccess("get_baseline_image", { product_id: "P-123abc" });
    expectSchemaFailure("get_baseline_image", { product_id: "P-123abc", page_id: "checkout" });
  });

  it("get_baseline_image returns preview path for product with designSystemArtifactId", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.get_baseline_image({ product_id: "P-123abc" });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    expect(typeof payload.path).toBe("string");
    expect(payload.path).toContain("DS_ARTIFACT123456");
    expect(payload.path).toContain("preview");
    expect(payload.path).toContain("2x.png");
  });

  it("artifact tools appear in formaToolNames", () => {
    expect(formaToolNames).toContain("list_product_artifacts");
    expect(formaToolNames).toContain("get_product_artifact");
    expect(formaToolNames).toContain("export_artifact");
    expect(formaToolNames).toContain("rollback_requirement_design");
    expect(formaToolNames).toContain("generate_requirement_design");
    expect(formaToolNames).toContain("generate_components");
    expect(formaToolNames).toContain("change_artifact_style");
    expect(formaToolNames).not.toContain("refine_requirement_design");
    expect(formaToolNames).not.toContain("change_style");
  });

  it("get_baseline_image returns ARTIFACT_NOT_FOUND when product has no designSystemArtifactId", async () => {
    const store = fakeStore({
      products: {
        ...fakeStore().products,
        getProduct: vi.fn(async () => ({
          id: "P-123abc",
          name: "App",
          description: "Demo",
          platform: "web",
          requirements: {}
          // no designSystemArtifactId
        }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_baseline_image({ product_id: "P-123abc" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({
      error_code: "ARTIFACT_NOT_FOUND",
      details: { product_id: "P-123abc" }
    });
  });
});

describe("artifact tools (C-03)", () => {
  // ─── list_product_artifacts ───────────────────────────────────────────────

  it("list_product_artifacts returns empty list when no artifacts exist", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.list_product_artifacts({ product_id: "P-123abc" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toEqual({ artifacts: [] });
    expect(store.artifacts.listArtifacts).toHaveBeenCalledWith("P-123abc");
  });

  it("list_product_artifacts returns artifact summaries with superseded=false for current pointer", async () => {
    // "OLDARTIFACT12345" is the current pointer in fakeStore (requirements["R-12345678"].latestArtifactId)
    const manifest = { ...fakeManifest(), id: "OLDARTIFACT12345", requirementId: "R-12345678" };
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifacts: vi.fn(async () => [{ artifactId: "OLDARTIFACT12345", etag: "sha256:abc" }]),
        listArtifactVersions: vi.fn(async () => [1, 2]),
        readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.list_product_artifacts({ product_id: "P-123abc" });
    const payload = textPayload(result);

    expect(result.isError).toBeUndefined();
    expect(payload.artifacts).toHaveLength(1);
    expect(payload.artifacts[0]).toMatchObject({
      id: "OLDARTIFACT12345",
      // legacy html kind is normalized to design-page
      kind: "design-page",
      title: "Test Page",
      superseded: false,
      versions: [1, 2],
      current_version: 2,
      preview_url: "/api/products/P-123abc/artifacts/OLDARTIFACT12345/versions/2/preview/2x.png"
    });
  });

  it("list_product_artifacts marks superseded artifacts correctly when include_superseded=true", async () => {
    const manifest = { ...fakeManifest(), id: "SUPERSEDEDART123", requirementId: "R-12345678" };
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifacts: vi.fn(async () => [{ artifactId: "SUPERSEDEDART123", etag: "sha256:old" }]),
        listArtifactVersions: vi.fn(async () => [1]),
        readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:old" }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.list_product_artifacts({ product_id: "P-123abc", include_superseded: true });
    const payload = textPayload(result);

    expect(result.isError).toBeUndefined();
    expect(payload.artifacts[0]).toMatchObject({
      id: "SUPERSEDEDART123",
      superseded: true
    });
  });

  it("list_product_artifacts returns PRODUCT_NOT_FOUND error when product does not exist", async () => {
    const store = fakeStore({
      products: {
        ...fakeStore().products,
        getProduct: vi.fn(async () => {
          throw new FormaError("PRODUCT_NOT_FOUND", "Product not found");
        })
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.list_product_artifacts({ product_id: "P-missing" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "PRODUCT_NOT_FOUND" });
  });

  it("list_product_artifacts returns page_id, variant, versions, current_version per artifact", async () => {
    const manifest = {
      ...fakeManifest(),
      id: "ABCDEFGHIJ123456",
      kind: "design-page" as const,
      forma: {
        requirementId: "R-12345678",
        pageId: "checkout",
        variant: "default"
      }
    };
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifacts: vi.fn(async () => [{ artifactId: "ABCDEFGHIJ123456", etag: "sha256:abc" }]),
        listArtifactVersions: vi.fn(async () => [1, 2]),
        readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" }))
      },
      products: {
        ...fakeStore().products,
        // Make ABCDEFGHIJ123456 the current pointer so it's not filtered as superseded
        getProduct: vi.fn(async () => ({
          id: "P-123abc",
          name: "App",
          description: "Demo",
          requirements: {
            "R-12345678": { latestArtifactId: "ABCDEFGHIJ123456" }
          }
        })),
        listDesignPointers: vi.fn(async () => [{
          requirementId: "R-12345678",
          pageId: "checkout",
          variant: "default",
          artifactId: "ABCDEFGHIJ123456",
          version: 2,
          designStatus: "active" as const
        }])
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.list_product_artifacts({ product_id: "P-123abc" });
    const payload = textPayload(result);

    expect(result.isError).toBeUndefined();
    expect(payload.artifacts).toHaveLength(1);
    expect(payload.artifacts[0]).toMatchObject({
      id: "ABCDEFGHIJ123456",
      kind: "design-page",
      page_id: "checkout",
      variant: "default",
      requirement_id: "R-12345678",
      versions: [1, 2],
      current_version: 2
    });
  });

  it("list_product_artifacts kind filter accepts new kinds (design-page, component-library)", () => {
    // Schema-level test — these kinds must be valid enum values
    const parsed = formaToolInputSchemas.list_product_artifacts.safeParse({ product_id: "P-123abc", kind: "design-page" });
    expect(parsed.success).toBe(true);
    const parsed2 = formaToolInputSchemas.list_product_artifacts.safeParse({ product_id: "P-123abc", kind: "component-library" });
    expect(parsed2.success).toBe(true);
  });

  // ─── get_product_artifact ─────────────────────────────────────────────────

  it("get_product_artifact returns versioned manifest, bundle_url, preview_url, assets, versions, current_version", async () => {
    const manifest = fakeManifest();
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifactVersions: vi.fn(async () => [1, 2]),
        readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_product_artifact({ product_id: "P-123abc", artifact_id: "ABCDEFGHIJ123456" });
    const payload = textPayload(result);

    expect(result.isError).toBeUndefined();
    // versions and current_version
    expect(payload.versions).toEqual([1, 2]);
    expect(payload.current_version).toBe(2);
    // bundle_url and preview_url use versioned path
    expect(payload.bundle_url).toBe("/api/products/P-123abc/artifacts/ABCDEFGHIJ123456/versions/2/bundle/index.html");
    expect(payload.preview_url).toBe("/api/products/P-123abc/artifacts/ABCDEFGHIJ123456/versions/2/preview/2x.png");
    // assets is empty (no forma.assets on this manifest)
    expect(payload.assets).toEqual([]);
    // kind is normalized (html → design-page)
    expect(payload.manifest.kind).toBe("design-page");
    expect(store.artifacts.readArtifactVersion).toHaveBeenCalledWith("P-123abc", "ABCDEFGHIJ123456", 2);
  });

  it("get_product_artifact uses design pointer version when available", async () => {
    const manifest = fakeManifest();
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifactVersions: vi.fn(async () => [1, 2, 3]),
        readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" }))
      },
      products: {
        ...fakeStore().products,
        listDesignPointers: vi.fn(async () => [{
          requirementId: "R-12345678",
          pageId: "page-home",
          variant: "default",
          artifactId: "ABCDEFGHIJ123456",
          version: 1,
          designStatus: "active" as const
        }])
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_product_artifact({ product_id: "P-123abc", artifact_id: "ABCDEFGHIJ123456" });
    const payload = textPayload(result);

    expect(result.isError).toBeUndefined();
    expect(payload.current_version).toBe(1);
    expect(payload.bundle_url).toContain("/versions/1/bundle/");
    expect(payload.preview_url).toContain("/versions/1/preview/2x.png");
    expect(store.artifacts.readArtifactVersion).toHaveBeenCalledWith("P-123abc", "ABCDEFGHIJ123456", 1);
  });

  it("get_product_artifact returns ARTIFACT_NOT_FOUND when no versions exist", async () => {
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifactVersions: vi.fn(async () => [])
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_product_artifact({ product_id: "P-123abc", artifact_id: "MISSING12345678" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
  });

  it("get_product_artifact builds density URLs for raster assets", async () => {
    const manifest = {
      ...fakeManifest(),
      forma: {
        requirementId: "R-12345678",
        pageId: "checkout",
        variant: "default",
        assets: [
          { path: "assets/logo@1x.png", density: [1, 2, 3], role: "image" },
          { path: "assets/icon.svg", density: [1], role: "icon" }
        ]
      }
    };
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifactVersions: vi.fn(async () => [1]),
        readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_product_artifact({ product_id: "P-123abc", artifact_id: "ABCDEFGHIJ123456" });
    const payload = textPayload(result);

    expect(result.isError).toBeUndefined();
    // Raster asset: @1x → @2x/@3x replacement
    const raster = payload.assets.find((a: { path: string }) => a.path === "assets/logo@1x.png");
    expect(raster.urls["1x"]).toContain("assets/logo%401x.png");
    expect(raster.urls["2x"]).toContain("assets/logo%402x.png");
    expect(raster.urls["3x"]).toContain("assets/logo%403x.png");
    // SVG asset: single density, path unchanged
    const svg = payload.assets.find((a: { path: string }) => a.path === "assets/icon.svg");
    expect(svg.urls["1x"]).toContain("assets/icon.svg");
  });

  // ─── export_artifact ──────────────────────────────────────────────────────

  it("export_artifact returns output_path for png format", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    // Note: since this copies a real file, it will fail at the fs level — we test error shape
    const result = await tools.export_artifact({
      product_id: "P-123abc",
      artifact_id: "ABCDEFGHIJ123456",
      format: "png"
    });

    // Either success (file was there) or a structured error — not ARTIFACT_UNSUPPORTED_FORMAT
    if (result.isError) {
      expect(textPayload(result)).not.toMatchObject({ error_code: "ARTIFACT_UNSUPPORTED_FORMAT" });
      expect(textPayload(result)).not.toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
    }
  });

  it("export_artifact zip includes the manifest entry file even when supportingFiles omits it", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-export-"));
    const artifactDir = join(home, "data", "products", "P-123abc", "od-project", "artifacts", "ABCDEFGHIJ123456");
    await mkdir(join(artifactDir, "assets"), { recursive: true });
    await writeFile(join(artifactDir, "index.html"), "<main>Hello</main>", "utf8");
    await writeFile(join(artifactDir, "assets", "app.css"), "main { color: black; }", "utf8");
    const manifest = { ...fakeManifest(), supportingFiles: ["assets/app.css"] };
    const store = fakeStore({
      home,
      artifacts: {
        ...fakeStore().artifacts,
        readArtifact: vi.fn(async () => ({ manifest, etag: "sha256:abc" }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.export_artifact({
      product_id: "P-123abc",
      artifact_id: "ABCDEFGHIJ123456",
      format: "zip"
    });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    const zip = new AdmZip(payload.output_path as string);
    expect(zip.getEntry("manifest.json")).toBeTruthy();
    expect(zip.getEntry("index.html")?.getData().toString("utf8")).toBe("<main>Hello</main>");
    expect(zip.getEntry("assets/app.css")?.getData().toString("utf8")).toBe("main { color: black; }");
  });

  it.each([
    { artifactKind: "html" as const, entry: "index.html", requestedFormat: "svg" as const },
    { artifactKind: "svg" as const, entry: "icon.svg", requestedFormat: "html" as const }
  ])("export_artifact rejects $requestedFormat export for $artifactKind artifacts", async ({ artifactKind, entry, requestedFormat }) => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-export-format-"));
    const artifactDir = join(home, "data", "products", "P-123abc", "od-project", "artifacts", "ABCDEFGHIJ123456");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, entry), "<main>entry</main>", "utf8");
    const manifest = {
      ...fakeManifest(),
      kind: artifactKind,
      renderer: artifactKind,
      entry,
      exports: [entry]
    };
    const store = fakeStore({
      home,
      artifacts: {
        ...fakeStore().artifacts,
        readArtifact: vi.fn(async () => ({ manifest, etag: "sha256:abc" }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.export_artifact({
      product_id: "P-123abc",
      artifact_id: "ABCDEFGHIJ123456",
      format: requestedFormat
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "ARTIFACT_UNSUPPORTED_FORMAT" });
  });

  it("export_artifact returns ARTIFACT_NOT_FOUND when artifact is missing", async () => {
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        readArtifact: vi.fn(async () => {
          throw new FormaError("ARTIFACT_NOT_FOUND", "Artifact not found");
        })
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.export_artifact({
      product_id: "P-123abc",
      artifact_id: "MISSING12345678",
      format: "html"
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
  });

  it("export_artifact returns ARTIFACT_UNSUPPORTED_FORMAT for unknown format", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.export_artifact({
      product_id: "P-123abc",
      artifact_id: "ABCDEFGHIJ123456",
      format: "pdf"
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "VALIDATION_ERROR" });
  });

  // ─── rollback_requirement_design ─────────────────────────────────────────

  it("rollback_requirement_design flips the version pointer to the target version", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.rollback_requirement_design({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "page-home",
      target_version: 1
    });
    const payload = textPayload(result);

    expect(result.isError).toBeUndefined();
    expect(payload).toEqual({
      requirement_id: "R-12345678",
      page_id: "page-home",
      variant: "default",
      version: 1
    });
    expect(store.products.rollbackDesignPointerLocked).toHaveBeenCalledWith(
      "P-123abc",
      "R-12345678",
      "page-home",
      "default",
      1
    );
  });

  it("rollback_requirement_design uses the provided variant", async () => {
    const store = fakeStore({
      products: {
        ...fakeStore().products,
        getDesignPointer: vi.fn(async () => ({
          requirementId: "R-12345678",
          pageId: "page-home",
          variant: "dark",
          artifactId: "ABCDEFGHIJ123456",
          version: 2,
          designStatus: "active" as const
        }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.rollback_requirement_design({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "page-home",
      variant: "dark",
      target_version: 1
    });
    const payload = textPayload(result);

    expect(result.isError).toBeUndefined();
    expect(payload).toMatchObject({ variant: "dark", version: 1 });
  });

  it("rollback_requirement_design returns ARTIFACT_NOT_FOUND when design pointer is missing", async () => {
    const store = fakeStore({
      products: {
        ...fakeStore().products,
        getDesignPointer: vi.fn(async () => undefined)
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.rollback_requirement_design({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "page-missing",
      target_version: 1
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
  });

  it("rollback_requirement_design returns ARTIFACT_NOT_FOUND when target version is not on disk", async () => {
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifactVersions: vi.fn(async () => [1, 2])
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.rollback_requirement_design({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "page-home",
      target_version: 99
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
  });

  it("rollback_requirement_design fails schema validation when target_version is missing", async () => {
    expectSchemaFailure("rollback_requirement_design", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "page-home"
    });
  });

  it("rollback_requirement_design fails schema validation for old target_artifact_id field", async () => {
    expectSchemaFailure("rollback_requirement_design", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "page-home",
      target_artifact_id: "ABCDEFGHIJ123456",
      target_version: 1
    });
  });
});

describe("C-04 retained tools", () => {
  // ─── confirm_product_id ───────────────────────────────────────────────────

  it("confirm_product_id returns confirmed=true when no expected_name provided", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.confirm_product_id({ product_id: "P-123abc" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toEqual({ confirmed: true, name: "App" });
  });

  it("confirm_product_id returns confirmed=true when expected_name matches", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.confirm_product_id({ product_id: "P-123abc", expected_name: "App" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toEqual({ confirmed: true, name: "App" });
  });

  it("confirm_product_id returns confirmed=false when expected_name mismatches", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.confirm_product_id({ product_id: "P-123abc", expected_name: "Other App" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toEqual({ confirmed: false, name: "App" });
  });

  it("confirm_product_id returns PRODUCT_NOT_FOUND for unknown product_id", async () => {
    const store = fakeStore({
      products: {
        ...fakeStore().products,
        getProduct: vi.fn(async () => {
          throw new FormaError("PRODUCT_NOT_FOUND", "Product not found");
        })
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.confirm_product_id({ product_id: "P-missing" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "PRODUCT_NOT_FOUND" });
  });

  // ─── get_product_baseline ─────────────────────────────────────────────────

  it("get_product_baseline returns functional baseline even when a design-system artifact exists", async () => {
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        readArtifact: vi.fn(async () => ({ manifest: { ...fakeManifest(), kind: "design-system" as const }, etag: "sha256:abc" }))
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirementHistory: vi.fn(async () => [
          {
            id: "R-12345678",
            product_id: "P-123abc",
            status: "active",
            created_at: "2026-05-17T00:00:00.000Z",
            updated_at: "2026-05-18T00:00:00.000Z",
            pages: [
              {
                page_id: "checkout-page",
                name: "Checkout",
                baseline_page: "checkout",
                design_status: "done",
                features: "Pay for an order",
                fields: "Card number",
                interactions: "Submit payment",
                copy: [{ context: "title", text: "Checkout" }]
              }
            ],
            navigation: [{ from: "checkout-page", to: "checkout-page", label: "Stay" }]
          }
        ])
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_product_baseline({ product_id: "P-123abc" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({
      baseline: {
        product_id: "P-123abc",
        pages: [
          {
            id: "checkout",
            name: "Checkout",
            features: "Pay for an order",
            fields: "Card number",
            interactions: "Submit payment",
            copy: [{ context: "title", text: "Checkout" }],
            source_requirements: ["R-12345678"]
          }
        ],
        navigation: [{ from: "checkout", to: "checkout", label: "Stay" }]
      }
    });
    expect(store.artifacts.readArtifact).not.toHaveBeenCalled();
  });

  it("get_product_baseline derives functional baseline when product has no designSystemArtifactId", async () => {
    const store = fakeStore({
      products: {
        ...fakeStore().products,
        getProduct: vi.fn(async () => ({
          id: "P-123abc",
          name: "App",
          description: "Demo",
          requirements: {}
        }))
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirementHistory: vi.fn(async () => [
          {
            id: "R-12345678",
            product_id: "P-123abc",
            status: "submitted",
            created_at: "2026-05-17T00:00:00.000Z",
            updated_at: "2026-05-18T00:00:00.000Z",
            pages: [
              {
                page_id: "checkout-page",
                name: "Checkout",
                baseline_page: "checkout",
                design_status: "pending"
              },
              {
                page_id: "confirmation-page",
                name: "Confirmation",
                baseline_page: "confirmation",
                design_status: "pending"
              }
            ],
            navigation: [{ from: "checkout-page", to: "confirmation-page", label: "Continue" }]
          }
        ])
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_product_baseline({ product_id: "P-123abc" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({
      baseline: {
        product_id: "P-123abc",
        pages: [
          { id: "checkout", name: "Checkout", source_requirements: ["R-12345678"] },
          { id: "confirmation", name: "Confirmation", source_requirements: ["R-12345678"] }
        ],
        navigation: [{ from: "checkout", to: "confirmation", label: "Continue" }]
      }
    });
  });

  // ─── get_style ────────────────────────────────────────────────────────────

  it("get_style returns tokens from design-system artifact metadata", async () => {
    const manifest = {
      ...fakeManifest(),
      kind: "design-system" as const,
      metadata: { tokens: { primary: "#5E6AD2", "font-body": "Inter" } }
    };
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        readArtifact: vi.fn(async () => ({ manifest, etag: "sha256:abc" }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_style({ product_id: "P-123abc" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({
      tokens: { primary: "#5E6AD2", "font-body": "Inter" }
    });
  });

  it("get_style returns STYLE_NOT_FOUND when product has no designSystemArtifactId", async () => {
    const store = fakeStore({
      products: {
        ...fakeStore().products,
        getProduct: vi.fn(async () => ({
          id: "P-123abc",
          name: "App",
          description: "Demo",
          requirements: {}
        }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_style({ product_id: "P-123abc" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "STYLE_NOT_FOUND" });
  });

  // ─── session_* fallback ───────────────────────────────────────────────────

  it("session_get_guidelines without v6 override throws FORMA_DESKTOP_CONFIG_UNSUPPORTED", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.session_get_guidelines({
      session_id: "S-1234567890abcdef",
      category: "guide",
      name: "Design System"
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({
      error_code: "FORMA_DESKTOP_CONFIG_UNSUPPORTED",
      details: { tool: "session_get_guidelines" }
    });
  });

  it("session_export_nodes without v6 override throws FORMA_DESKTOP_CONFIG_UNSUPPORTED", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.session_export_nodes({
      session_id: "S-1234567890abcdef",
      nodeIds: ["frame-1"],
      format: "png"
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "FORMA_DESKTOP_CONFIG_UNSUPPORTED" });
  });

  it("session_get_guidelines with v6 override delegates to the override", async () => {
    const v6Guidelines = { guidelines: [{ name: "Design System", content: "Use our tokens." }] };
    const sessionGetGuidelines = vi.fn(async () => v6Guidelines);
    const store = Object.assign(fakeStore(), { v6: { sessionGetGuidelines } });
    const tools = createFormaTools(store);

    const result = await tools.session_get_guidelines({
      session_id: "S-1234567890abcdef",
      category: "guide",
      name: "Design System"
    });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toEqual(v6Guidelines);
    expect(sessionGetGuidelines).toHaveBeenCalled();
  });

  // ─── get_baseline_page ────────────────────────────────────────────────────

  describe("get_baseline_page", () => {
    it("returns page from design-system artifact metadata", async () => {
      const store = fakeStore({
        products: {
          ...fakeStore().products,
          getProduct: vi.fn(async () => ({
            id: "P-123abc",
            name: "App",
            description: "Demo",
            designSystemArtifactId: "DS_ARTIFACT123456"
          }))
        },
        artifacts: {
          ...fakeStore().artifacts,
          readArtifact: vi.fn(async () => ({
            manifest: {
              ...fakeManifest(),
              kind: "design-system" as const,
              metadata: { pages: [{ id: "home", name: "Home", layout: {} }] }
            },
            etag: "sha256:abc"
          }))
        }
      });
      const tools = createFormaTools(store);
      const result = await tools.get_baseline_page({ product_id: "P-123abc", page_id: "home" });
      const payload = textPayload(result);
      expect(result.isError).toBeFalsy();
      expect(payload).toMatchObject({ id: "home" });
    });

    it("returns ARTIFACT_NOT_FOUND when product has no designSystemArtifactId", async () => {
      const store = fakeStore({
        products: {
          ...fakeStore().products,
          getProduct: vi.fn(async () => ({ id: "P-123abc", name: "App", description: "Demo" }))
        }
      });
      const tools = createFormaTools(store);
      const result = await tools.get_baseline_page({ product_id: "P-123abc", page_id: "home" });
      const payload = textPayload(result);
      expect(result.isError).toBe(true);
      expect(payload.error_code).toBe("ARTIFACT_NOT_FOUND");
    });

    it("returns ARTIFACT_NOT_FOUND when page not found in metadata", async () => {
      const store = fakeStore({
        products: {
          ...fakeStore().products,
          getProduct: vi.fn(async () => ({
            id: "P-123abc",
            name: "App",
            description: "Demo",
            designSystemArtifactId: "DS_ARTIFACT123456"
          }))
        },
        artifacts: {
          ...fakeStore().artifacts,
          readArtifact: vi.fn(async () => ({
            manifest: {
              ...fakeManifest(),
              kind: "design-system" as const,
              metadata: { pages: [] }
            },
            etag: "sha256:abc"
          }))
        }
      });
      const tools = createFormaTools(store);
      const result = await tools.get_baseline_page({ product_id: "P-123abc", page_id: "missing" });
      const payload = textPayload(result);
      expect(result.isError).toBe(true);
      expect(payload.error_code).toBe("ARTIFACT_NOT_FOUND");
    });
  });
});

describe("generate tools (P4.5 save-AI-HTML semantics)", () => {
  // ─── generate_requirement_design ─────────────────────────────────────────

  it("generate_requirement_design schema accepts valid input", () => {
    expectSchemaSuccess("generate_requirement_design", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout",
      html: "<main>Hello</main>",
      title: "Checkout",
      brand_style: "linear"
    });
    expectSchemaSuccess("generate_requirement_design", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout",
      html: "<main>Hello</main>",
      title: "Checkout",
      brand_style: "linear",
      system_style: "material",
      variant: "dark"
    });
  });

  it("generate_requirement_design schema rejects missing required fields", () => {
    // missing html
    expectSchemaFailure("generate_requirement_design", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout",
      title: "Checkout",
      brand_style: "linear"
    });
    // missing page_id
    expectSchemaFailure("generate_requirement_design", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      html: "<main/>",
      title: "Checkout",
      brand_style: "linear"
    });
    // missing brand_style
    expectSchemaFailure("generate_requirement_design", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout",
      html: "<main/>",
      title: "Checkout"
    });
    // missing product_id
    expectSchemaFailure("generate_requirement_design", {
      requirement_id: "R-12345678",
      page_id: "checkout",
      html: "<main/>",
      title: "Checkout",
      brand_style: "linear"
    });
  });

  it("generate_requirement_design delegates to store with mapped camelCase fields and returns {artifact_id, version, preview_status}", async () => {
    const fakeResult = { artifact_id: "ABCDEFGHIJ123456", version: 1, preview_status: "pending" };
    const store = fakeStore({
      generateRequirementDesign: vi.fn(async () => fakeResult)
    });
    const tools = createFormaTools(store);

    const result = await tools.generate_requirement_design({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout",
      html: "<main>Checkout</main>",
      title: "Checkout",
      brand_style: "linear",
      system_style: "material",
      variant: "dark"
    });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    expect(payload).toMatchObject({ artifact_id: "ABCDEFGHIJ123456", version: 1, preview_status: "pending" });
    expect((store as unknown as { generateRequirementDesign: ReturnType<typeof vi.fn> }).generateRequirementDesign)
      .toHaveBeenCalledWith("P-123abc", "R-12345678", {
        html: "<main>Checkout</main>",
        title: "Checkout",
        pageId: "checkout",
        variant: "dark",
        brandStyle: "linear",
        systemStyle: "material"
      });
  });

  it("generate_requirement_design passes through store errors as MCP error results", async () => {
    const { FormaError: ActualFormaError } = await import("@xenonbyte/forma-core");
    const store = fakeStore({
      generateRequirementDesign: vi.fn(async () => {
        throw new ActualFormaError("PRODUCT_NOT_FOUND", "Product not found");
      })
    });
    const tools = createFormaTools(store);

    const result = await tools.generate_requirement_design({
      product_id: "P-missing",
      requirement_id: "R-12345678",
      page_id: "checkout",
      html: "<main/>",
      title: "Checkout",
      brand_style: "linear"
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "PRODUCT_NOT_FOUND" });
  });

  // ─── generate_components ─────────────────────────────────────────────────

  it("generate_components schema accepts valid input", () => {
    expectSchemaSuccess("generate_components", {
      product_id: "P-123abc",
      html: "<section>Button</section>",
      title: "Button Library",
      brand_style: "linear"
    });
    expectSchemaSuccess("generate_components", {
      product_id: "P-123abc",
      html: "<section>Card</section>",
      title: "Component Library",
      brand_style: "linear",
      system_style: "material"
    });
  });

  it("generate_components schema rejects missing required fields", () => {
    // missing html
    expectSchemaFailure("generate_components", { product_id: "P-123abc", title: "Library", brand_style: "linear" });
    // missing brand_style
    expectSchemaFailure("generate_components", { product_id: "P-123abc", html: "<section/>", title: "Library" });
    // missing product_id
    expectSchemaFailure("generate_components", { html: "<section/>", title: "Library", brand_style: "linear" });
  });

  it("generate_components delegates to store with mapped camelCase fields and returns {artifact_id, version, preview_status}", async () => {
    const fakeResult = { artifact_id: "ABCDEFGHIJ123456", version: 1, preview_status: "pending" };
    const store = fakeStore({
      generateComponents: vi.fn(async () => fakeResult)
    });
    const tools = createFormaTools(store);

    const result = await tools.generate_components({
      product_id: "P-123abc",
      html: "<section>Button</section>",
      title: "Button Library",
      brand_style: "linear",
      system_style: "material"
    });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    expect(payload).toMatchObject({ artifact_id: "ABCDEFGHIJ123456", version: 1, preview_status: "pending" });
    expect((store as unknown as { generateComponents: ReturnType<typeof vi.fn> }).generateComponents)
      .toHaveBeenCalledWith("P-123abc", {
        html: "<section>Button</section>",
        title: "Button Library",
        brandStyle: "linear",
        systemStyle: "material"
      });
  });

  it("generate_components passes through store errors as MCP error results", async () => {
    const { FormaError: ActualFormaError } = await import("@xenonbyte/forma-core");
    const store = fakeStore({
      generateComponents: vi.fn(async () => {
        throw new ActualFormaError("PRODUCT_NOT_FOUND", "Product not found");
      })
    });
    const tools = createFormaTools(store);

    const result = await tools.generate_components({
      product_id: "P-missing",
      html: "<section/>",
      title: "Library",
      brand_style: "linear"
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "PRODUCT_NOT_FOUND" });
  });

  // ─── change_artifact_style ───────────────────────────────────────────────

  it("change_artifact_style schema accepts valid input", () => {
    expectSchemaSuccess("change_artifact_style", {
      product_id: "P-123abc",
      artifact_id: "ABCDEFGHIJ123456",
      html: "<main>Restyled</main>",
      title: "Checkout (Dark)",
      brand_style: "dark"
    });
    expectSchemaSuccess("change_artifact_style", {
      product_id: "P-123abc",
      artifact_id: "ABCDEFGHIJ123456",
      html: "<main>Restyled</main>",
      title: "Checkout (Linear)",
      brand_style: "linear",
      system_style: "material"
    });
  });

  it("change_artifact_style schema rejects missing required fields", () => {
    // missing html
    expectSchemaFailure("change_artifact_style", {
      product_id: "P-123abc",
      artifact_id: "ABCDEFGHIJ123456",
      title: "Checkout",
      brand_style: "dark"
    });
    // missing brand_style
    expectSchemaFailure("change_artifact_style", {
      product_id: "P-123abc",
      artifact_id: "ABCDEFGHIJ123456",
      html: "<main/>",
      title: "Checkout"
    });
    // missing artifact_id
    expectSchemaFailure("change_artifact_style", {
      product_id: "P-123abc",
      html: "<main/>",
      title: "Checkout",
      brand_style: "dark"
    });
    // missing product_id
    expectSchemaFailure("change_artifact_style", {
      artifact_id: "ABCDEFGHIJ123456",
      html: "<main/>",
      title: "Checkout",
      brand_style: "dark"
    });
  });

  it("change_artifact_style delegates to store with mapped camelCase fields and returns {artifact_id, version, preview_status}", async () => {
    const fakeResult = { artifact_id: "ABCDEFGHIJ123456", version: 2, preview_status: "pending" };
    const store = fakeStore({
      changeArtifactStyle: vi.fn(async () => fakeResult)
    });
    const tools = createFormaTools(store);

    const result = await tools.change_artifact_style({
      product_id: "P-123abc",
      artifact_id: "ABCDEFGHIJ123456",
      html: "<main>Restyled</main>",
      title: "Checkout (Dark)",
      brand_style: "dark",
      system_style: "material"
    });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    expect(payload).toMatchObject({ artifact_id: "ABCDEFGHIJ123456", version: 2, preview_status: "pending" });
    expect((store as unknown as { changeArtifactStyle: ReturnType<typeof vi.fn> }).changeArtifactStyle)
      .toHaveBeenCalledWith("P-123abc", "ABCDEFGHIJ123456", {
        html: "<main>Restyled</main>",
        title: "Checkout (Dark)",
        brandStyle: "dark",
        systemStyle: "material"
      });
  });

  it("change_artifact_style passes through store errors as MCP error results", async () => {
    const { FormaError: ActualFormaError } = await import("@xenonbyte/forma-core");
    const store = fakeStore({
      changeArtifactStyle: vi.fn(async () => {
        throw new ActualFormaError("ARTIFACT_NOT_FOUND", "Artifact not found");
      })
    });
    const tools = createFormaTools(store);

    const result = await tools.change_artifact_style({
      product_id: "P-123abc",
      artifact_id: "MISSING12345678",
      html: "<main/>",
      title: "Checkout",
      brand_style: "dark"
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
  });
});

describe("get_design_context (P4.6 pre-generation knowledge delivery)", () => {
  function fakeStoreWithDesignContext(overrides: Record<string, unknown> = {}) {
    return fakeStore({
      styles: {
        getStyle: vi.fn(async () => ({ metadata: { name: "linear" }, designMd: "# Linear Design" })),
        listStyles: vi.fn(async () => [{ name: "linear" }]),
        listCraftDocs: vi.fn(async () => [{ slug: "spacing", content: "# Spacing rules" }]),
        readCraftDoc: vi.fn(async () => ({ slug: "spacing", content: "# Spacing rules" })),
        listSystemStyles: vi.fn(async () => [{ name: "material", tokens: {} }])
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-12345678",
          product_id: "P-123abc",
          status: "active",
          pages: [
            {
              page_id: "checkout",
              name: "Checkout",
              baseline_page: "checkout",
              features: "Pay for an order",
              change_type: "new"
            }
          ]
        })),
        getProductRules: vi.fn(async () => [
          {
            id: "R-12345678-rule-1",
            page_id: "checkout",
            given: "cart has items",
            when: "checkout opens",
            then: "payment form appears",
            source_requirement: "R-12345678"
          }
        ])
      },
      products: {
        ...fakeStore().products,
        getProduct: vi.fn(async () => ({
          id: "P-123abc",
          name: "App",
          description: "Demo",
          platform: "web",
          brand_style: "linear",
          system_style: "material",
          languages: ["en"],
          default_language: "en",
          requirements: {}
        }))
      },
      ...overrides
    });
  }

  it("get_design_context appears in formaToolNames", () => {
    expect(formaToolNames).toContain("get_design_context");
  });

  it("get_design_context schema accepts valid minimal input", () => {
    expectSchemaSuccess("get_design_context", {
      product_id: "P-123abc",
      requirement_id: "R-12345678"
    });
  });

  it("get_design_context schema accepts all optional fields", () => {
    expectSchemaSuccess("get_design_context", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout",
      brand_style: "linear",
      system_style: "material",
      craft_slugs: ["spacing", "typography"]
    });
  });

  it("get_design_context schema rejects missing required fields", () => {
    expectSchemaFailure("get_design_context", { requirement_id: "R-12345678" });
    expectSchemaFailure("get_design_context", { product_id: "P-123abc" });
    expectSchemaFailure("get_design_context", {});
  });

  it("get_design_context schema rejects unknown fields (strict)", () => {
    expectSchemaFailure("get_design_context", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      unknown_field: "value"
    });
  });

  it("get_design_context returns craft docs, brand style, and page for a specific page_id", async () => {
    const store = fakeStoreWithDesignContext();
    const tools = createFormaTools(store);

    const result = await tools.get_design_context({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout"
    });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    expect(payload.craft).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: "spacing" })
    ]));
    expect(payload.brandStyle).toMatchObject({ metadata: { name: "linear" } });
    expect(payload.page).toMatchObject({ page_id: "checkout" });
    expect(payload.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ page_id: "checkout" })
    ]));
  });

  it("get_design_context uses explicit brand_style over product config", async () => {
    const store = fakeStoreWithDesignContext({
      styles: {
        getStyle: vi.fn(async (name: string) => ({ metadata: { name }, designMd: `# ${name}` })),
        listStyles: vi.fn(async () => []),
        listCraftDocs: vi.fn(async () => []),
        readCraftDoc: vi.fn(async () => ({ slug: "x", content: "" })),
        listSystemStyles: vi.fn(async () => [])
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_design_context({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      brand_style: "darkmode"
    });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    expect(payload.brandStyle).toMatchObject({ metadata: { name: "darkmode" } });
    expect((store as unknown as { styles: { getStyle: ReturnType<typeof vi.fn> } }).styles.getStyle)
      .toHaveBeenCalledWith("darkmode");
  });

  it("get_design_context with craft_slugs fetches only specified craft docs", async () => {
    const readCraftDoc = vi.fn(async (slug: string) => ({ slug, content: `# ${slug}` }));
    const store = fakeStoreWithDesignContext({
      styles: {
        getStyle: vi.fn(async () => ({ metadata: { name: "linear" }, designMd: "# Linear" })),
        listStyles: vi.fn(async () => []),
        listCraftDocs: vi.fn(async () => []),
        readCraftDoc,
        listSystemStyles: vi.fn(async () => [])
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_design_context({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      craft_slugs: ["spacing", "typography"]
    });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    expect(payload.craft).toHaveLength(2);
    expect(readCraftDoc).toHaveBeenCalledWith("spacing");
    expect(readCraftDoc).toHaveBeenCalledWith("typography");
  });

  it("get_design_context passes through PRODUCT_NOT_FOUND as MCP error result", async () => {
    const { FormaError: ActualFormaError } = await import("@xenonbyte/forma-core");
    const store = fakeStoreWithDesignContext({
      products: {
        ...fakeStore().products,
        getProduct: vi.fn(async () => {
          throw new ActualFormaError("PRODUCT_NOT_FOUND", "Product not found");
        })
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_design_context({
      product_id: "P-missing",
      requirement_id: "R-12345678"
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "PRODUCT_NOT_FOUND" });
  });
});
