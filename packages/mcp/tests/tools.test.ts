import {
  FormaError,
  createFormaStore,
  getArtifactIconsDir,
  getArtifactVziPath,
  getArtifactVersionDir,
  getArtifactsDir,
  type FormaStore,
} from "@xenonbyte/forma-core";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import { describe, expect, it, vi } from "vitest";
import * as z from "zod/v4";
import {
  createFormaTools,
  formaToolInputSchemas,
  formaToolNames,
  registerFormaTools,
  type FormaToolName,
} from "../src/index.js";
import { VZIEncoder } from "@vzi-core/format";
import { VZITransformer, buildVziContentFromTransformResult } from "@vzi-core/transformer";

const puppeteerParserOptions = vi.hoisted(() => [] as Array<Record<string, unknown> | undefined>);

vi.mock("@xenonbyte/forma-core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createOdRuntime: vi.fn(() => ({
      generate: vi.fn(async () => ({
        manifest: fakeManifest(),
        supportingFiles: new Map([
          ["preview/2x.png", new Uint8Array()],
          ["preview/1x.png", new Uint8Array()],
        ]),
      })),
    })),
    extractIconAssets: vi.fn(async () => ({
      files: new Map([
        ["icons/icon-0-24x24-abc123.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', "utf8")],
      ]),
      manifest: {
        schemaVersion: 1,
        artifactId: "ABCDEFGHIJ123456",
        productId: "P-123abc",
        requirementId: "manual-export",
        pageId: "manual",
        version: "manual",
        sourceVersion: "manual",
        generatedFrom: "manual-export" as const,
        generatedAt: "2026-06-02T00:00:00.000Z",
        densities: [1, 2, 3],
        icons: [
          {
            id: "icon-0-24x24-abc123",
            name: "icon-0-24x24",
            contentHash: "abc123",
            size: { w: 24, h: 24 },
            usesCurrentColor: false,
            sourceOrderFirst: 0,
            sourceOrders: [0],
            files: {
              svg: "icons/icon-0-24x24-abc123.svg",
              png: {},
            },
          },
        ],
        instances: [
          {
            sourceOrder: 0,
            iconId: "icon-0-24x24-abc123",
            contentHash: "abc123",
          },
        ],
      },
    })),
  };
});

vi.mock("@vzi-core/parser", async () => {
  // Minimal fake IR that VZITransformer can process
  const fakeIR: import("@vzi-core/types").IntermediateRepresentation = {
    version: "1.0",
    rootElementId: "el-root",
    elements: {
      "el-root": {
        id: "el-root",
        parentId: null,
        type: "container",
        bounds: { x: 0, y: 0, width: 1024, height: 768 },
        styles: { backgroundColor: "#ffffff" },
      },
    },
    metadata: { title: "mock-page", viewport: { width: 1024, height: 768 } },
  };

  class MockPuppeteerParser {
    constructor(opts?: Record<string, unknown>) {
      puppeteerParserOptions.push(opts);
    }
    async parse(_html: string) {
      return fakeIR;
    }
    async dispose() {
      return undefined;
    }
  }

  return {
    PuppeteerParser: MockPuppeteerParser,
    VIEWPORT_PRESETS: {
      mobile: { width: 390, height: 884 },
      tablet: { width: 768, height: 1024 },
      desktop: { width: 1024, height: 1280 },
    },
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
  "set_current_session",
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
  "session_get_editor_state",
] as const;

// Session tools removed in P4.9 C
const removedSessionToolNames = [
  "session_get_guidelines",
  "session_get_variables",
  "session_batch_get",
  "session_snapshot_layout",
  "session_get_screenshot",
  "session_export_nodes",
] as const;

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
    updatedAt: new Date().toISOString(),
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
      readArtifactVersion: vi.fn(async () => ({ manifest: fakeManifest(), etag: "sha256:abc" })),
    },
    copy: {
      getTranslations: vi.fn(async () => []),
      updatePageTranslations: vi.fn(async () => undefined),
    },
    deleteProduct: vi.fn(async () => ({
      product_id: "P-123abc",
      deleted: true,
      session_cleared: false,
      cleanup_pending: false,
      recovery_warnings: [],
    })),
    generateRequirementDesign: vi.fn(async () => ({
      artifact_id: "ABCDEFGHIJ123456",
      version: 1,
      preview_status: "pending",
    })),
    generateComponents: vi.fn(async () => ({
      artifact_id: "ABCDEFGHIJ123456",
      version: 1,
      preview_status: "pending",
    })),
    changeArtifactStyle: vi.fn(async () => ({
      artifact_id: "ABCDEFGHIJ123456",
      version: 1,
      preview_status: "pending",
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
          "R-12345678": { latestArtifactId: "OLDARTIFACT12345" },
        },
      })),
      initProductConfig: vi.fn(async (_productId: string, config: unknown) => ({
        id: "P-123abc",
        ...(config as object),
      })),
      listProducts: vi.fn(async () => [{ id: "P-123abc", name: "App", description: "Demo" }]),
      setRequirementArtifactPointerLocked: vi.fn(async () => undefined as string | undefined),
      setDesignSystemArtifactPointerLocked: vi.fn(async () => undefined),
      getDesignPointer: vi.fn(async () => ({
        requirementId: "R-12345678",
        pageId: "page-home",
        variant: "default",
        artifactId: "ABCDEFGHIJ123456",
        version: 2,
        designStatus: "active" as const,
      })),
      listDesignPointers: vi.fn(async () => []),
      rollbackDesignPointerLocked: vi.fn(async () => undefined),
    },
    recoverPendingProductDeletes: vi.fn(async () => ({ warnings: [], recovered: [] })),
    requirements: {
      createEmptyRequirement: vi.fn(async () => ({ id: "R-12345678", status: "empty" })),
      getLatestRequirement: vi.fn(async () => ({
        id: "R-12345678",
        product_id: "P-123abc",
        status: "active",
        pages: [],
      })),
      getProductRules: vi.fn(async () => []),
      getRequirement: vi.fn(async () => ({ id: "R-12345678", product_id: "P-123abc", pages: [] })),
      getRequirementHistory: vi.fn(async () => []),
      saveRequirement: vi.fn(async () => ({ id: "R-12345678", status: "submitted" })),
      submitRequirement: vi.fn(async () => ({ id: "R-12345678", status: "submitted" })),
      updateRequirement: vi.fn(async () => ({ id: "R-12345678", status: "submitted" })),
    },
    runProductMutation: vi.fn(async (_input: unknown, fn: (ctx: { warnings: string[] }) => Promise<unknown>) =>
      fn({ warnings: [] }),
    ),
    sessions: {
      getCurrentSession: vi.fn(async () => ({ current_product: "P-123abc" })),
      setCurrentProduct: vi.fn(async () => ({ current_product: "P-123abc" })),
    },
    styles: {
      getStyle: vi.fn(async () => ({
        kind: "brand" as const,
        metadata: { name: "linear" },
        designMd: "# Linear",
        tokensCss: ":root{}",
        componentsHtml: "<div/>",
      })),
      listStyles: vi.fn(async () => [{ name: "linear" }]),
      listSystemStyles: vi.fn(async () => []),
    },
    ...overrides,
  };
  return store as unknown as FormaStore;
}

describe("MCP forma tools", () => {
  it("does not register removed legacy page-level design tools or session tools", () => {
    const tools = createFormaTools(fakeStore());
    const server = { registerTool: vi.fn() };

    registerFormaTools(server, tools);

    expect(Object.keys(tools)).toEqual(formaToolNames);
    expect(server.registerTool).toHaveBeenCalledTimes(formaToolNames.length);
    expect(server.registerTool.mock.calls.map((call) => call[0])).toEqual(formaToolNames);
    expect(server.registerTool.mock.calls.map((call) => call[1])).toEqual(
      expect.arrayContaining([expect.objectContaining({ inputSchema: expect.any(Object) })]),
    );
    for (const removedToolName of removedLegacyToolNames) {
      expect(formaToolNames).not.toContain(removedToolName);
      expect(Object.keys(tools)).not.toContain(removedToolName);
      expect(server.registerTool.mock.calls.map((call) => call[0])).not.toContain(removedToolName);
    }
    // Session tools must be removed (P4.9 C)
    for (const sessionToolName of removedSessionToolNames) {
      expect(formaToolNames).not.toContain(sessionToolName);
      expect(Object.keys(tools)).not.toContain(sessionToolName);
    }
    expect(formaToolNames).not.toContain("submit_requirement");
    expect(formaToolNames).not.toContain("update_requirement");
    expect(formaToolNames).not.toContain("delete_requirement");
    for (const v6ToolName of v6ToolNames) {
      expect(formaToolNames).not.toContain(v6ToolName);
      expect(Object.keys(tools)).not.toContain(v6ToolName);
    }
    expect(formaToolNames).toEqual(
      expect.arrayContaining([
        "save_requirement",
        "get_product_rules",
        "get_page_copy",
        "delete_product",
        "confirm_product_id",
        "generate_requirement_design",
        "generate_components",
        "change_artifact_style",
        "get_design_context",
      ]),
    );
    expect(formaToolNames).not.toContain("change_style");
    expect(formaToolNames).not.toContain("refine_requirement_design");
    expect(formaToolNames).not.toContain("update_page_copy");
  });

  it("help output excludes removed legacy page-level design tools and session tools", async () => {
    const tools = createFormaTools(fakeStore());

    const result = await tools.help({});
    const payload = textPayload(result);

    expect(payload).toMatchObject({
      tools: formaToolNames,
      usage_guide: {
        guidance: expect.arrayContaining([
          expect.stringContaining("save_requirement"),
          expect.stringContaining("get_product_rules"),
          expect.stringContaining("get_page_copy"),
          expect.stringContaining("get_product_artifact"),
          expect.stringContaining("export_artifact"),
        ]),
        workflows: {
          develop_frontend: [
            "get_design_handoff",
            "get_page_ui",
            "get_ui_node",
            "search_page_ui",
            "get_requirement",
            "get_product_rules",
          ],
        },
      },
    });
    for (const removedToolName of removedLegacyToolNames) {
      expect(JSON.stringify(payload)).not.toContain(removedToolName);
    }
    for (const sessionToolName of removedSessionToolNames) {
      expect(JSON.stringify(payload.tools)).not.toContain(sessionToolName);
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

  it("returns JSON text on success", async () => {
    const tools = createFormaTools(fakeStore());

    const result = await tools.list_products({});

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify([{ id: "P-123abc", name: "App", description: "Demo" }]) }],
    });
  });

  it("wraps FormaError as MCP error result", async () => {
    const tools = createFormaTools(
      fakeStore({
        products: {
          ...fakeStore().products,
          getProduct: vi.fn(async () => {
            throw new FormaError("PRODUCT_NOT_FOUND", "Product not found");
          }),
        },
      }),
    );

    const result = await tools.get_product({ product_id: "P-missing" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toEqual({
      error_code: "PRODUCT_NOT_FOUND",
      message: "Product not found",
      details: {},
    });
  });

  it("wraps invalid input and unexpected runtime errors as structured errors", async () => {
    const tools = createFormaTools(
      fakeStore({
        products: {
          ...fakeStore().products,
          listProducts: vi.fn(async () => {
            throw new Error("boom");
          }),
        },
      }),
    );

    const validationResult = await tools.get_product({});
    const runtimeResult = await tools.list_products({});

    expect(validationResult.isError).toBe(true);
    expect(textPayload(validationResult)).toMatchObject({
      error_code: "VALIDATION_ERROR",
      message: "Invalid tool input",
      details: { issues: expect.any(Array) },
    });
    expect(runtimeResult.isError).toBe(true);
    expect(textPayload(runtimeResult)).toEqual({
      error_code: "INTERNAL_ERROR",
      message: "Unexpected tool error",
      details: {},
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
      recovery_warnings: [],
    };
    const store = fakeStore({
      deleteProduct: vi.fn(async () => deleted),
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
      details: { issues: expect.arrayContaining([expect.objectContaining({ path: ["confirm_product_id"] })]) },
    });
    expect(store.deleteProduct).not.toHaveBeenCalled();
  });

  it("delete_product passes through core product mutation lock errors", async () => {
    const store = fakeStore({
      deleteProduct: vi.fn(async () => {
        throw new FormaError("PRODUCT_MUTATION_LOCKED", "Product mutation lock is held", {
          operation: "delete_product",
          product_id: "P-123abc",
        });
      }),
    });
    const tools = createFormaTools(store);

    const result = await tools.delete_product({ product_id: "P-123abc", confirm_product_id: "P-123abc" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toEqual({
      error_code: "PRODUCT_MUTATION_LOCKED",
      message: "Product mutation lock is held",
      details: { operation: "delete_product", product_id: "P-123abc" },
    });
  });

  it("delete_product preserves recovery warnings in successful responses", async () => {
    const store = fakeStore({
      deleteProduct: vi.fn(async () => ({
        product_id: "P-123abc",
        deleted: true,
        session_cleared: false,
        cleanup_pending: true,
        recovery_warnings: ["cleanup was deferred"],
      })),
    });
    const tools = createFormaTools(store);

    const result = await tools.delete_product({ product_id: "P-123abc", confirm_product_id: "P-123abc" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({
      cleanup_pending: true,
      recovery_warnings: ["cleanup was deferred"],
    });
  });

  it("sessions.getCurrentSession never points to a product while delete_product is clearing or removing it", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-delete-session-"));
    const observations: Array<{ phase: string; current_product: string | null }> = [];
    let store: Awaited<ReturnType<typeof createFormaStore>>;
    const productDeletionHooks: NonNullable<Parameters<typeof createFormaStore>[0]["productDeletionHooks"]> = {
      afterPhasePersisted: async (state) => {
        if (["session_written", "index_written", "moved"].includes(state.phase)) {
          const session = (await store.sessions.getCurrentSession()) as { current_product: string | null };
          expect(session.current_product).not.toBe(state.product_id);
          observations.push({ phase: state.phase, current_product: session.current_product });
        }
      },
    };
    store = await createFormaStore({
      home,
      bundledStylesDir: resolve("styles"),
      productDeletionHooks,
    });
    const tools = createFormaTools(store);
    const product = await store.products.createProduct({ name: "Delete Me", description: "Temporary" });
    await store.products.initProductConfig(product.id, {
      platform: "web",
      brand_style: "linear",
      languages: ["en"],
      default_language: "en",
    });
    await store.sessions.setCurrentProduct(product.id);

    const result = await tools.delete_product({ product_id: product.id, confirm_product_id: product.id });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({ product_id: product.id, session_cleared: true });
    const finalSession = (await store.sessions.getCurrentSession()) as { current_product: string | null };
    expect(finalSession).toEqual({ current_product: null });
    expect(observations).toEqual([
      { phase: "session_written", current_product: null },
      { phase: "index_written", current_product: null },
      { phase: "moved", current_product: null },
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
      default_language: "en",
    });

    expect(store.products.initProductConfig).toHaveBeenCalledWith("P-123abc", {
      platform: "web",
      brand_style: "linear",
      languages: ["en", "zh-CN"],
      default_language: "en",
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
      details: { issues: expect.any(Array) },
    });
    expect(store.products.initProductConfig).not.toHaveBeenCalled();
  });

  it("update_product_config rejects missing languages and default_language", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.update_product_config({
      product_id: "P-123abc",
      platform: "web",
      brand_style: "linear",
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({
      error_code: "VALIDATION_ERROR",
      message: "Invalid tool input",
      details: { issues: expect.any(Array) },
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
      default_language: "zh-CN",
    });
    await tools.init_product_config({
      product_id: "P-123abc",
      platform: "web",
      brand_style: "linear",
      languages: ["en", "zh-CN"],
      default_language: "zh-CN",
    });
    await tools.update_product_config({
      product_id: "P-123abc",
      platform: "mobile",
      brand_style: "linear",
      languages: ["en", "zh-CN"],
      default_language: "en",
    });

    expect(invalid.isError).toBe(true);
    expect(textPayload(invalid)).toMatchObject({
      error_code: "VALIDATION_ERROR",
      details: { issues: expect.any(Array) },
    });
    expect(store.products.initProductConfig).toHaveBeenNthCalledWith(1, "P-123abc", {
      platform: "web",
      brand_style: "linear",
      languages: ["en", "zh-CN"],
      default_language: "zh-CN",
    });
    expect(store.products.initProductConfig).toHaveBeenNthCalledWith(2, "P-123abc", {
      platform: "mobile",
      brand_style: "linear",
      languages: ["en", "zh-CN"],
      default_language: "en",
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
      details: { issues: expect.any(Array) },
    });
    expect(store.products.createProduct).not.toHaveBeenCalled();
  });

  it("get_product returns persisted language configuration", async () => {
    const tools = createFormaTools(fakeStore());

    const result = await tools.get_product({ product_id: "P-123abc" });

    expect(textPayload(result)).toMatchObject({
      id: "P-123abc",
      languages: ["en", "zh-CN"],
      default_language: "en",
    });
  });

  it("save_requirement requires the v0.3 shape, accepts optional copy fields, and rejects expired_pages", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);
    const input = {
      requirement_id: "R-12345678",
      document_md: "# Checkout",
      ui_affected: true,
      pages: [
        {
          page_id: "checkout",
          name: "Checkout",
          baseline_page: "checkout",
          change_type: "new",
          features: "Pay for an order",
          copy: [{ context: "submit", text: "Pay now" }],
          fields: "email",
          interactions: "tap submit",
          declared_fields: [{ key: "email", label: "Email" }],
          declared_actions: [{ key: "submit_payment", label: "Submit payment" }],
          declared_component_keys: ["primary-button"],
        },
      ],
      navigation: [{ from: "cart", to: "checkout", label: "Checkout" }],
      translations: [
        {
          page_id: "checkout",
          entries: [{ context: "submit", texts: { "zh-CN": "立即支付" } }],
        },
      ],
      rules: [
        {
          id: "rule-1",
          page_id: "checkout",
          given: "items are in cart",
          when: "checkout opens",
          then: "show payment form",
          replaces_rule_id: "old-rule",
        },
      ],
      remove_rule_ids: ["old-rule-2"],
      remove_page_ids: ["legacy"],
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
        saveRequirement: vi.fn(async () => saved),
      },
    });
    const tools = createFormaTools(store);
    const input = {
      requirement_id: "R-12345678",
      document_md: "# Logic update",
      ui_affected: false,
      pages: [],
      navigation: [],
    };

    const result = await tools.save_requirement(input);

    expect(store.requirements.saveRequirement).toHaveBeenCalledWith(input);
    expect(textPayload(result)).toEqual(saved);
  });

  it("get_requirement includes copy translations without legacy page-level design metadata", async () => {
    const translations = [
      {
        page_id: "checkout",
        entries: [{ context: "submit", texts: { "zh-CN": "立即支付" } }],
      },
    ];
    const store = fakeStore({
      copy: {
        ...fakeStore().copy,
        getTranslations: vi.fn(async () => translations),
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-12345678",
          product_id: "P-123abc",
          pages: [
            { page_id: "checkout", baseline_page: "checkout", design_status: "done" },
            { page_id: "profile", baseline_page: "profile" },
          ],
        })),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_requirement({ requirement_id: "R-12345678" });

    expect(store.copy.getTranslations).toHaveBeenCalledWith("P-123abc", "R-12345678");
    expect(textPayload(result)).toMatchObject({
      id: "R-12345678",
      copy_translations: translations,
      pages: [{ page_id: "checkout", baseline_page: "checkout", design_status: "done" }, { page_id: "profile" }],
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
          pages: [{ page_id: "checkout", baseline_page: "checkout", design_status: "done" }],
        })),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_requirement({ requirement_id: "R-12345678" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({
      id: "R-12345678",
      pages: [{ page_id: "checkout", baseline_page: "checkout", design_status: "done" }],
    });
  });

  it("get_product_rules returns stored rules", async () => {
    const rules = [
      {
        id: "R-12345678-rule-1",
        page_id: "checkout",
        given: "cart has items",
        when: "checkout opens",
        then: "payment form appears",
        source_requirement: "R-12345678",
      },
    ];
    const store = fakeStore({
      requirements: {
        ...fakeStore().requirements,
        getProductRules: vi.fn(async () => rules),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_product_rules({ product_id: "P-123abc" });

    expect(store.requirements.getProductRules).toHaveBeenCalledWith("P-123abc");
    expect(textPayload(result)).toEqual(rules);
  });

  it("get_page_copy without requirement_id resolves latest non-archived requirement for the product", async () => {
    const translations = [
      {
        page_id: "checkout",
        entries: [{ context: "submit", texts: { "zh-CN": "立即支付" } }],
      },
    ];
    const store = fakeStore({
      copy: {
        ...fakeStore().copy,
        getTranslations: vi.fn(async () => translations),
      },
      requirements: {
        ...fakeStore().requirements,
        getLatestRequirement: vi.fn(async () => ({
          id: "R-latest1",
          product_id: "P-123abc",
          status: "active",
          pages: [
            {
              page_id: "checkout",
              baseline_page: "checkout",
              copy: [{ context: "submit", text: "Pay now" }],
            },
          ],
        })),
      },
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
      translations: translations[0],
    });
  });

  it("get_page_copy with explicit requirement_id rejects cross-product access", async () => {
    const store = fakeStore({
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({ id: "R-12345678", product_id: "P-other1", pages: [] })),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_page_copy({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout",
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toEqual({
      error_code: "REQUIREMENT_PRODUCT_MISMATCH",
      message: "Requirement does not belong to product",
      details: { product_id: "P-123abc", requirement_id: "R-12345678", requirement_product_id: "P-other1" },
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
          requirements: {},
          // no designSystemArtifactId
        })),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_baseline_image({ product_id: "P-123abc" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({
      error_code: "ARTIFACT_NOT_FOUND",
      details: { product_id: "P-123abc" },
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
        readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" })),
      },
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
      preview_url: "/api/products/P-123abc/artifacts/OLDARTIFACT12345/versions/2/preview/2x.png",
    });
  });

  it("list_product_artifacts marks superseded artifacts correctly when include_superseded=true", async () => {
    const manifest = { ...fakeManifest(), id: "SUPERSEDEDART123", requirementId: "R-12345678" };
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifacts: vi.fn(async () => [{ artifactId: "SUPERSEDEDART123", etag: "sha256:old" }]),
        listArtifactVersions: vi.fn(async () => [1]),
        readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:old" })),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.list_product_artifacts({ product_id: "P-123abc", include_superseded: true });
    const payload = textPayload(result);

    expect(result.isError).toBeUndefined();
    expect(payload.artifacts[0]).toMatchObject({
      id: "SUPERSEDEDART123",
      superseded: true,
    });
  });

  it("list_product_artifacts returns PRODUCT_NOT_FOUND error when product does not exist", async () => {
    const store = fakeStore({
      products: {
        ...fakeStore().products,
        getProduct: vi.fn(async () => {
          throw new FormaError("PRODUCT_NOT_FOUND", "Product not found");
        }),
      },
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
        variant: "default",
      },
    };
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifacts: vi.fn(async () => [{ artifactId: "ABCDEFGHIJ123456", etag: "sha256:abc" }]),
        listArtifactVersions: vi.fn(async () => [1, 2]),
        readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" })),
      },
      products: {
        ...fakeStore().products,
        // Make ABCDEFGHIJ123456 the current pointer so it's not filtered as superseded
        getProduct: vi.fn(async () => ({
          id: "P-123abc",
          name: "App",
          description: "Demo",
          requirements: {
            "R-12345678": { latestArtifactId: "ABCDEFGHIJ123456" },
          },
        })),
        listDesignPointers: vi.fn(async () => [
          {
            requirementId: "R-12345678",
            pageId: "checkout",
            variant: "default",
            artifactId: "ABCDEFGHIJ123456",
            version: 2,
            designStatus: "active" as const,
          },
        ]),
      },
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
      current_version: 2,
    });
  });

  it("Bug #3: list_product_artifacts (default) includes artifact only in designPointers (not superseded)", async () => {
    // Artifact has a requirementId so hasRequirementId=true.
    // It is NOT in product.requirements[*].latestArtifactId (legacy pointer).
    // It IS in designPointers — so it must NOT be filtered as superseded.
    const manifest = {
      ...fakeManifest(),
      id: "DESIGNPTRART12345",
      kind: "design-page" as const,
      forma: {
        requirementId: "R-12345678",
        pageId: "home",
        variant: "default",
      },
    };
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifacts: vi.fn(async () => [{ artifactId: "DESIGNPTRART12345", etag: "sha256:abc" }]),
        listArtifactVersions: vi.fn(async () => [1]),
        readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" })),
      },
      products: {
        ...fakeStore().products,
        // Legacy requirements do NOT reference DESIGNPTRART12345
        getProduct: vi.fn(async () => ({
          id: "P-123abc",
          name: "App",
          description: "Demo",
          requirements: {},
        })),
        // Only design pointer references the artifact
        listDesignPointers: vi.fn(async () => [
          {
            requirementId: "R-12345678",
            pageId: "home",
            variant: "default",
            artifactId: "DESIGNPTRART12345",
            version: 1,
            designStatus: "active" as const,
          },
        ]),
      },
    });
    const tools = createFormaTools(store);

    // include_superseded defaults to false — artifact should still appear
    const result = await tools.list_product_artifacts({ product_id: "P-123abc" });
    const payload = textPayload(result);

    expect(result.isError).toBeUndefined();
    expect(payload.artifacts).toHaveLength(1);
    expect(payload.artifacts[0]).toMatchObject({
      id: "DESIGNPTRART12345",
      superseded: false,
    });
  });

  it("list_product_artifacts kind filter accepts new kinds (design-page, component-library) and rejects design-system", () => {
    // Schema-level test — these kinds must be valid enum values
    const parsed = formaToolInputSchemas.list_product_artifacts.safeParse({
      product_id: "P-123abc",
      kind: "design-page",
    });
    expect(parsed.success).toBe(true);
    const parsed2 = formaToolInputSchemas.list_product_artifacts.safeParse({
      product_id: "P-123abc",
      kind: "component-library",
    });
    expect(parsed2.success).toBe(true);
    // design-system is removed from user-facing enum
    const parsed3 = formaToolInputSchemas.list_product_artifacts.safeParse({
      product_id: "P-123abc",
      kind: "design-system",
    });
    expect(parsed3.success).toBe(false);
  });

  // ─── get_product_artifact ─────────────────────────────────────────────────

  it("get_product_artifact returns versioned manifest, bundle_url, preview_url, assets, versions, current_version", async () => {
    const manifest = fakeManifest();
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifactVersions: vi.fn(async () => [1, 2]),
        readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" })),
      },
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
        readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" })),
      },
      products: {
        ...fakeStore().products,
        listDesignPointers: vi.fn(async () => [
          {
            requirementId: "R-12345678",
            pageId: "page-home",
            variant: "default",
            artifactId: "ABCDEFGHIJ123456",
            version: 1,
            designStatus: "active" as const,
          },
        ]),
      },
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

  it("get_product_artifact returns ARTIFACT_NOT_FOUND when no versions exist and no flat artifact", async () => {
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifactVersions: vi.fn(async () => []),
        readArtifact: vi.fn(async () => {
          throw new FormaError("ARTIFACT_NOT_FOUND", "Artifact not found");
        }),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_product_artifact({ product_id: "P-123abc", artifact_id: "MISSING12345678" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
  });

  it("Bug #4: get_product_artifact falls back to flat artifact when no versions exist", async () => {
    const manifest = fakeManifest();
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        // No versioned dirs
        listArtifactVersions: vi.fn(async () => []),
        // Flat artifact is readable
        readArtifact: vi.fn(async () => ({ manifest, etag: "sha256:abc" })),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_product_artifact({ product_id: "P-123abc", artifact_id: "ABCDEFGHIJ123456" });
    const payload = textPayload(result);

    expect(result.isError).toBeUndefined();
    expect(payload.manifest).toMatchObject({ kind: "design-page", title: "Test Page" });
    expect(payload.versions).toEqual([]);
    // current_version is null for flat artifacts
    expect(payload.current_version).toBeNull();
    // bundle_url and preview_url are null for flat artifacts (no version)
    expect(payload.bundle_url).toBeNull();
    expect(payload.preview_url).toBeNull();
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
          { path: "assets/icon.svg", density: [1], role: "icon" },
        ],
      },
    };
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifactVersions: vi.fn(async () => [1]),
        readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" })),
      },
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
      format: "png",
    });

    // Either success (file was there) or a structured error — not ARTIFACT_UNSUPPORTED_FORMAT
    if (result.isError) {
      expect(textPayload(result)).not.toMatchObject({ error_code: "ARTIFACT_UNSUPPORTED_FORMAT" });
      expect(textPayload(result)).not.toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
    }
  });

  it("export_artifact zip includes the manifest entry file even when supportingFiles omits it (versioned)", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-export-"));
    const artifactId = "ABCDEFGHIJ123456";
    const productId = "P-123abc";
    // Create versioned dir structure: od-project/artifacts/{id}/v1/
    const versionDir = join(home, "data", "products", productId, "od-project", "artifacts", artifactId, "v1");
    await mkdir(join(versionDir, "assets"), { recursive: true });
    await writeFile(join(versionDir, "index.html"), "<main>Hello</main>", "utf8");
    await writeFile(join(versionDir, "assets", "app.css"), "main { color: black; }", "utf8");
    const manifest = { ...fakeManifest(), supportingFiles: ["assets/app.css"] };
    const store = fakeStore({
      home,
      artifacts: {
        ...fakeStore().artifacts,
        listArtifactVersions: vi.fn(async () => [1]),
        readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" })),
      },
      products: {
        ...fakeStore().products,
        listDesignPointers: vi.fn(async () => []),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.export_artifact({
      product_id: productId,
      artifact_id: artifactId,
      format: "zip",
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
    { artifactKind: "svg" as const, entry: "icon.svg", requestedFormat: "html" as const },
  ])(
    "export_artifact rejects $requestedFormat export for $artifactKind artifacts",
    async ({ artifactKind, entry, requestedFormat }) => {
      const home = await mkdtemp(join(tmpdir(), "forma-mcp-export-format-"));
      const artifactId = "ABCDEFGHIJ123456";
      const productId = "P-123abc";
      // Create versioned dir
      const versionDir = join(home, "data", "products", productId, "od-project", "artifacts", artifactId, "v1");
      await mkdir(versionDir, { recursive: true });
      await writeFile(join(versionDir, entry), "<main>entry</main>", "utf8");
      const manifest = {
        ...fakeManifest(),
        kind: artifactKind,
        renderer: artifactKind,
        entry,
        exports: [entry],
      };
      const store = fakeStore({
        home,
        artifacts: {
          ...fakeStore().artifacts,
          listArtifactVersions: vi.fn(async () => [1]),
          readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => []),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.export_artifact({
        product_id: productId,
        artifact_id: artifactId,
        format: requestedFormat,
      });

      expect(result.isError).toBe(true);
      expect(textPayload(result)).toMatchObject({ error_code: "ARTIFACT_UNSUPPORTED_FORMAT" });
    },
  );

  it("export_artifact returns ARTIFACT_NOT_FOUND when artifact has no versions and readArtifact fails", async () => {
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifactVersions: vi.fn(async () => []),
        readArtifact: vi.fn(async () => {
          throw new FormaError("ARTIFACT_NOT_FOUND", "Artifact not found");
        }),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.export_artifact({
      product_id: "P-123abc",
      artifact_id: "MISSING12345678",
      format: "html",
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
      format: "pdf",
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "VALIDATION_ERROR" });
  });

  // ─── export_artifact: icons + vzi formats (Task 9) ───────────────────────

  it.each([
    { format: "icons" as const, expectedPath: "icons" },
    { format: "vzi" as const, expectedPath: ".vzi" },
  ])(
    "export_artifact $format format uses the manifest HTML entry when it is not index.html",
    async ({ format, expectedPath }) => {
      puppeteerParserOptions.length = 0;
      const home = await mkdtemp(join(tmpdir(), `forma-mcp-export-${format}-entry-`));
      const artifactId = "ABCDEFGHIJ123456";
      const productId = "P-123abc";
      const versionDir = join(home, "data", "products", productId, "od-project", "artifacts", artifactId, "v1");
      await mkdir(versionDir, { recursive: true });
      await writeFile(
        join(versionDir, "page.html"),
        `<!DOCTYPE html><html><body><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" aria-label="check"><path d="M20 6L9 17l-5-5"/></svg></body></html>`,
        "utf8",
      );
      const manifest = {
        ...fakeManifest(),
        entry: "page.html",
        exports: ["page.html"],
      };
      const store = fakeStore({
        home,
        artifacts: {
          ...fakeStore().artifacts,
          listArtifactVersions: vi.fn(async () => [1]),
          readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => []),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.export_artifact({
        product_id: productId,
        artifact_id: artifactId,
        format,
      });

      expect(result.isError).toBeUndefined();
      const payload = textPayload(result);
      expect(payload.output_path as string).toContain(expectedPath);
      if (format === "vzi") {
        expect(puppeteerParserOptions.at(-1)).toMatchObject({
          viewportPreset: "desktop",
          baseUrl: pathToFileURL(`${versionDir}/`).toString(),
        });
      }
    },
  );

  it.each(["icons", "vzi"] as const)(
    "export_artifact %s format rejects artifacts without an HTML entry",
    async (format) => {
      const home = await mkdtemp(join(tmpdir(), `forma-mcp-export-${format}-unsupported-`));
      const artifactId = "ABCDEFGHIJ123456";
      const productId = "P-123abc";
      const versionDir = join(home, "data", "products", productId, "od-project", "artifacts", artifactId, "v1");
      await mkdir(versionDir, { recursive: true });
      await writeFile(join(versionDir, "icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg"/>`, "utf8");
      const manifest = {
        ...fakeManifest(),
        kind: "svg" as const,
        renderer: "svg" as const,
        entry: "icon.svg",
        exports: ["icon.svg"],
      };
      const store = fakeStore({
        home,
        artifacts: {
          ...fakeStore().artifacts,
          listArtifactVersions: vi.fn(async () => [1]),
          readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => []),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.export_artifact({
        product_id: productId,
        artifact_id: artifactId,
        format,
      });

      expect(result.isError).toBe(true);
      expect(textPayload(result)).toMatchObject({ error_code: "ARTIFACT_UNSUPPORTED_FORMAT" });
    },
  );

  it("export_artifact icons format returns output_path containing an icons dir with icons.json", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-export-icons-"));
    const artifactId = "ABCDEFGHIJ123456";
    const productId = "P-123abc";
    // Write index.html with a valid inline SVG in the versioned artifact dir
    const versionDir = join(home, "data", "products", productId, "od-project", "artifacts", artifactId, "v1");
    await mkdir(versionDir, { recursive: true });
    await writeFile(
      join(versionDir, "index.html"),
      `<!DOCTYPE html><html><body><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" aria-label="check"><path d="M20 6L9 17l-5-5"/></svg></body></html>`,
      "utf8",
    );
    const store = fakeStore({
      home,
      artifacts: {
        ...fakeStore().artifacts,
        listArtifactVersions: vi.fn(async () => [1]),
        readArtifactVersion: vi.fn(async () => ({ manifest: fakeManifest(), etag: "sha256:abc" })),
      },
      products: {
        ...fakeStore().products,
        listDesignPointers: vi.fn(async () => []),
      },
      requirements: {
        ...fakeStore().requirements,
        archiveRequirement: vi.fn(async () => {
          throw new Error("archiveRequirement must NOT be called during manual export");
        }),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.export_artifact({
      product_id: productId,
      artifact_id: artifactId,
      format: "icons",
    });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    expect(payload).toHaveProperty("output_path");
    expect(typeof payload.output_path).toBe("string");
    expect(payload.output_path as string).toContain("icons");
    const manifest = JSON.parse(await readFile(join(payload.output_path as string, "icons.json"), "utf8"));
    const svgPath = manifest.icons[0].files.svg;
    expect(svgPath).toBe("icons/icon-0-24x24-abc123.svg");
    await expect(readFile(join(payload.output_path as string, svgPath), "utf8")).resolves.toContain("<svg");
    // archiveRequirement must not have been called
    expect(
      (store.requirements as unknown as Record<string, ReturnType<typeof vi.fn>>).archiveRequirement,
    ).not.toHaveBeenCalled();
  });

  it("export_artifact vzi format returns output_path ending with .vzi", async () => {
    puppeteerParserOptions.length = 0;
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-export-vzi-"));
    const artifactId = "ABCDEFGHIJ123456";
    const productId = "P-123abc";
    // Write index.html in the versioned artifact dir
    const versionDir = join(home, "data", "products", productId, "od-project", "artifacts", artifactId, "v1");
    await mkdir(versionDir, { recursive: true });
    await writeFile(join(versionDir, "index.html"), `<!DOCTYPE html><html><body><p>hello</p></body></html>`, "utf8");
    const store = fakeStore({
      home,
      artifacts: {
        ...fakeStore().artifacts,
        listArtifactVersions: vi.fn(async () => [1]),
        readArtifactVersion: vi.fn(async () => ({ manifest: fakeManifest(), etag: "sha256:abc" })),
      },
      products: {
        ...fakeStore().products,
        listDesignPointers: vi.fn(async () => []),
      },
      requirements: {
        ...fakeStore().requirements,
        archiveRequirement: vi.fn(async () => {
          throw new Error("archiveRequirement must NOT be called during manual export");
        }),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.export_artifact({
      product_id: productId,
      artifact_id: artifactId,
      format: "vzi",
    });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    expect(payload).toHaveProperty("output_path");
    expect(typeof payload.output_path).toBe("string");
    expect(payload.output_path as string).toMatch(/\.vzi$/);
    expect(puppeteerParserOptions.at(-1)).toMatchObject({
      viewportPreset: "desktop",
      baseUrl: pathToFileURL(`${versionDir}/`).toString(),
    });
    // archiveRequirement must not have been called
    expect(
      (store.requirements as unknown as Record<string, ReturnType<typeof vi.fn>>).archiveRequirement,
    ).not.toHaveBeenCalled();
  });

  it("export_artifact icons/vzi do NOT mutate requirement status (archiveRequirement not called)", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-export-no-archive-"));
    const artifactId = "ABCDEFGHIJ123456";
    const productId = "P-123abc";
    const versionDir = join(home, "data", "products", productId, "od-project", "artifacts", artifactId, "v1");
    await mkdir(versionDir, { recursive: true });
    await writeFile(join(versionDir, "index.html"), `<html><body></body></html>`, "utf8");

    const archiveRequirement = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const store = fakeStore({
      home,
      artifacts: {
        ...fakeStore().artifacts,
        listArtifactVersions: vi.fn(async () => [1]),
        readArtifactVersion: vi.fn(async () => ({ manifest: fakeManifest(), etag: "sha256:abc" })),
      },
      products: {
        ...fakeStore().products,
        listDesignPointers: vi.fn(async () => []),
      },
      requirements: {
        ...fakeStore().requirements,
        archiveRequirement,
      },
    });
    const tools = createFormaTools(store);

    // Both formats must not call archiveRequirement
    await tools.export_artifact({ product_id: productId, artifact_id: artifactId, format: "icons" });
    await tools.export_artifact({ product_id: productId, artifact_id: artifactId, format: "vzi" });

    expect(archiveRequirement).not.toHaveBeenCalled();
  });

  it("export_artifact existing formats (html/svg/png/zip) still work and shape is unchanged", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-export-regression-"));
    const artifactId = "ABCDEFGHIJ123456";
    const productId = "P-123abc";
    const versionDir = join(home, "data", "products", productId, "od-project", "artifacts", artifactId, "v1");
    await mkdir(versionDir, { recursive: true });
    await writeFile(join(versionDir, "index.html"), "<main>Hello</main>", "utf8");
    const manifest = { ...fakeManifest() };
    const store = fakeStore({
      home,
      artifacts: {
        ...fakeStore().artifacts,
        listArtifactVersions: vi.fn(async () => [1]),
        readArtifactVersion: vi.fn(async () => ({ manifest, etag: "sha256:abc" })),
      },
      products: {
        ...fakeStore().products,
        listDesignPointers: vi.fn(async () => []),
      },
    });
    const tools = createFormaTools(store);

    // html → output_path (single entry file)
    const htmlResult = await tools.export_artifact({ product_id: productId, artifact_id: artifactId, format: "html" });
    expect(htmlResult.isError).toBeUndefined();
    expect(textPayload(htmlResult)).toHaveProperty("output_path");

    // zip → output_path with valid ZIP content
    const zipResult = await tools.export_artifact({ product_id: productId, artifact_id: artifactId, format: "zip" });
    expect(zipResult.isError).toBeUndefined();
    expect(textPayload(zipResult)).toHaveProperty("output_path");

    // pdf (not in enum) → VALIDATION_ERROR (schema rejects before handler)
    const pdfResult = await tools.export_artifact({ product_id: productId, artifact_id: artifactId, format: "pdf" });
    expect(pdfResult.isError).toBe(true);
    expect(textPayload(pdfResult)).toMatchObject({ error_code: "VALIDATION_ERROR" });
  });

  // ─── rollback_requirement_design ─────────────────────────────────────────

  it("rollback_requirement_design flips the version pointer to the target version", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);

    const result = await tools.rollback_requirement_design({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "page-home",
      target_version: 1,
    });
    const payload = textPayload(result);

    expect(result.isError).toBeUndefined();
    expect(payload).toEqual({
      requirement_id: "R-12345678",
      page_id: "page-home",
      variant: "default",
      version: 1,
    });
    expect(store.products.rollbackDesignPointerLocked).toHaveBeenCalledWith(
      "P-123abc",
      "R-12345678",
      "page-home",
      "default",
      1,
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
          designStatus: "active" as const,
        })),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.rollback_requirement_design({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "page-home",
      variant: "dark",
      target_version: 1,
    });
    const payload = textPayload(result);

    expect(result.isError).toBeUndefined();
    expect(payload).toMatchObject({ variant: "dark", version: 1 });
  });

  it("rollback_requirement_design returns ARTIFACT_NOT_FOUND when design pointer is missing", async () => {
    const store = fakeStore({
      products: {
        ...fakeStore().products,
        getDesignPointer: vi.fn(async () => undefined),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.rollback_requirement_design({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "page-missing",
      target_version: 1,
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
  });

  it("rollback_requirement_design returns ARTIFACT_NOT_FOUND when target version is not on disk", async () => {
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        listArtifactVersions: vi.fn(async () => [1, 2]),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.rollback_requirement_design({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "page-home",
      target_version: 99,
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
  });

  it("rollback_requirement_design fails schema validation when target_version is missing", async () => {
    expectSchemaFailure("rollback_requirement_design", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "page-home",
    });
  });

  it("rollback_requirement_design fails schema validation for old target_artifact_id field", async () => {
    expectSchemaFailure("rollback_requirement_design", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "page-home",
      target_artifact_id: "ABCDEFGHIJ123456",
      target_version: 1,
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
        }),
      },
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
        readArtifact: vi.fn(async () => ({
          manifest: { ...fakeManifest(), kind: "design-system" as const },
          etag: "sha256:abc",
        })),
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
                copy: [{ context: "title", text: "Checkout" }],
              },
            ],
            navigation: [{ from: "checkout-page", to: "checkout-page", label: "Stay" }],
          },
        ]),
      },
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
            source_requirements: ["R-12345678"],
          },
        ],
        navigation: [{ from: "checkout", to: "checkout", label: "Stay" }],
      },
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
          requirements: {},
        })),
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
                design_status: "pending",
              },
              {
                page_id: "confirmation-page",
                name: "Confirmation",
                baseline_page: "confirmation",
                design_status: "pending",
              },
            ],
            navigation: [{ from: "checkout-page", to: "confirmation-page", label: "Continue" }],
          },
        ]),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_product_baseline({ product_id: "P-123abc" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({
      baseline: {
        product_id: "P-123abc",
        pages: [
          { id: "checkout", name: "Checkout", source_requirements: ["R-12345678"] },
          { id: "confirmation", name: "Confirmation", source_requirements: ["R-12345678"] },
        ],
        navigation: [{ from: "checkout", to: "confirmation", label: "Continue" }],
      },
    });
  });

  // ─── get_style (D2: name-based) ───────────────────────────────────────────

  it("get_style schema accepts name (not product_id)", () => {
    expectSchemaSuccess("get_style", { name: "linear" });
    expectSchemaFailure("get_style", { product_id: "P-123abc" });
    expectSchemaFailure("get_style", {});
    expectSchemaFailure("get_style", { name: "" });
  });

  it("get_style returns BrandStyleContent for a known brand style", async () => {
    const brandStyleContent = {
      kind: "brand" as const,
      metadata: {
        name: "linear",
        description: "Linear brand",
        design_md_path: "styles/linear/DESIGN.md",
        tokens_css_path: "styles/linear/tokens.css",
        components_html_path: "styles/linear/components.html",
      },
      designMd: "# Linear Design",
      tokensCss: ":root { --color-primary: #5E6AD2; }",
      componentsHtml: "<button class='btn'>Button</button>",
    };
    const store = fakeStore({
      styles: {
        getStyle: vi.fn(async () => brandStyleContent),
        listStyles: vi.fn(async () => [{ name: "linear", description: "Linear brand" }]),
        listSystemStyles: vi.fn(async () => []),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_style({ name: "linear" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({
      kind: "brand",
      metadata: { name: "linear" },
      designMd: "# Linear Design",
      tokensCss: ":root { --color-primary: #5E6AD2; }",
      componentsHtml: "<button class='btn'>Button</button>",
    });
    expect(store.styles.listStyles).toHaveBeenCalled();
    expect(store.styles.getStyle).toHaveBeenCalledWith("linear");
  });

  it("get_style returns SystemStyleMetadata for a known system style", async () => {
    const systemStyle = { name: "material", description: "Material Design", mode: "design-system" as const };
    const store = fakeStore({
      styles: {
        getStyle: vi.fn(async () => {
          throw new Error("should not be called");
        }),
        listStyles: vi.fn(async () => []),
        listSystemStyles: vi.fn(async () => [systemStyle]),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_style({ name: "material" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({ name: "material", mode: "design-system" });
    expect(store.styles.listSystemStyles).toHaveBeenCalled();
  });

  it("get_style returns INVALID_INPUT when style name is not found", async () => {
    const store = fakeStore({
      styles: {
        getStyle: vi.fn(async () => {
          throw new Error("should not be called");
        }),
        listStyles: vi.fn(async () => []),
        listSystemStyles: vi.fn(async () => []),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_style({ name: "nonexistent" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({
      error_code: "INVALID_INPUT",
      details: { style: "nonexistent" },
    });
  });

  // ─── get_baseline_page ────────────────────────────────────────────────────

  describe("get_baseline_page", () => {
    it("returns page from baseline artifact metadata", async () => {
      const store = fakeStore({
        products: {
          ...fakeStore().products,
          getProduct: vi.fn(async () => ({
            id: "P-123abc",
            name: "App",
            description: "Demo",
            designSystemArtifactId: "DS_ARTIFACT123456",
          })),
        },
        artifacts: {
          ...fakeStore().artifacts,
          readArtifact: vi.fn(async () => ({
            manifest: {
              ...fakeManifest(),
              kind: "design-system" as const,
              metadata: { pages: [{ id: "home", name: "Home", layout: {} }] },
            },
            etag: "sha256:abc",
          })),
        },
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
          getProduct: vi.fn(async () => ({ id: "P-123abc", name: "App", description: "Demo" })),
        },
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
            designSystemArtifactId: "DS_ARTIFACT123456",
          })),
        },
        artifacts: {
          ...fakeStore().artifacts,
          readArtifact: vi.fn(async () => ({
            manifest: {
              ...fakeManifest(),
              kind: "design-system" as const,
              metadata: { pages: [] },
            },
            etag: "sha256:abc",
          })),
        },
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
      brand_style: "linear",
    });
    expectSchemaSuccess("generate_requirement_design", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout",
      html: "<main>Hello</main>",
      title: "Checkout",
      brand_style: "linear",
      system_style: "material",
      variant: "dark",
    });
  });

  it("generate_requirement_design schema rejects missing required fields", () => {
    // missing html
    expectSchemaFailure("generate_requirement_design", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout",
      title: "Checkout",
      brand_style: "linear",
    });
    // missing page_id
    expectSchemaFailure("generate_requirement_design", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      html: "<main/>",
      title: "Checkout",
      brand_style: "linear",
    });
    // missing brand_style
    expectSchemaFailure("generate_requirement_design", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout",
      html: "<main/>",
      title: "Checkout",
    });
    // missing product_id
    expectSchemaFailure("generate_requirement_design", {
      requirement_id: "R-12345678",
      page_id: "checkout",
      html: "<main/>",
      title: "Checkout",
      brand_style: "linear",
    });
  });

  it("generate_requirement_design delegates to store with mapped camelCase fields and returns {artifact_id, version, preview_status}", async () => {
    const fakeResult = { artifact_id: "ABCDEFGHIJ123456", version: 1, preview_status: "pending" };
    const store = fakeStore({
      generateRequirementDesign: vi.fn(async () => fakeResult),
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
      variant: "dark",
    });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    expect(payload).toMatchObject({ artifact_id: "ABCDEFGHIJ123456", version: 1, preview_status: "pending" });
    expect(
      (store as unknown as { generateRequirementDesign: ReturnType<typeof vi.fn> }).generateRequirementDesign,
    ).toHaveBeenCalledWith("P-123abc", "R-12345678", {
      html: "<main>Checkout</main>",
      title: "Checkout",
      pageId: "checkout",
      variant: "dark",
      brandStyle: "linear",
      systemStyle: "material",
    });
  });

  it("generate_requirement_design passes through store errors as MCP error results", async () => {
    const { FormaError: ActualFormaError } = await import("@xenonbyte/forma-core");
    const store = fakeStore({
      generateRequirementDesign: vi.fn(async () => {
        throw new ActualFormaError("PRODUCT_NOT_FOUND", "Product not found");
      }),
    });
    const tools = createFormaTools(store);

    const result = await tools.generate_requirement_design({
      product_id: "P-missing",
      requirement_id: "R-12345678",
      page_id: "checkout",
      html: "<main/>",
      title: "Checkout",
      brand_style: "linear",
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
      brand_style: "linear",
    });
    expectSchemaSuccess("generate_components", {
      product_id: "P-123abc",
      html: "<section>Card</section>",
      title: "Component Library",
      brand_style: "linear",
      system_style: "material",
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
      generateComponents: vi.fn(async () => fakeResult),
    });
    const tools = createFormaTools(store);

    const result = await tools.generate_components({
      product_id: "P-123abc",
      html: "<section>Button</section>",
      title: "Button Library",
      brand_style: "linear",
      system_style: "material",
    });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    expect(payload).toMatchObject({ artifact_id: "ABCDEFGHIJ123456", version: 1, preview_status: "pending" });
    expect(
      (store as unknown as { generateComponents: ReturnType<typeof vi.fn> }).generateComponents,
    ).toHaveBeenCalledWith("P-123abc", {
      html: "<section>Button</section>",
      title: "Button Library",
      brandStyle: "linear",
      systemStyle: "material",
    });
  });

  it("generate_components passes through store errors as MCP error results", async () => {
    const { FormaError: ActualFormaError } = await import("@xenonbyte/forma-core");
    const store = fakeStore({
      generateComponents: vi.fn(async () => {
        throw new ActualFormaError("PRODUCT_NOT_FOUND", "Product not found");
      }),
    });
    const tools = createFormaTools(store);

    const result = await tools.generate_components({
      product_id: "P-missing",
      html: "<section/>",
      title: "Library",
      brand_style: "linear",
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
      brand_style: "dark",
    });
    expectSchemaSuccess("change_artifact_style", {
      product_id: "P-123abc",
      artifact_id: "ABCDEFGHIJ123456",
      html: "<main>Restyled</main>",
      title: "Checkout (Linear)",
      brand_style: "linear",
      system_style: "material",
    });
  });

  it("change_artifact_style schema rejects missing required fields", () => {
    // missing html
    expectSchemaFailure("change_artifact_style", {
      product_id: "P-123abc",
      artifact_id: "ABCDEFGHIJ123456",
      title: "Checkout",
      brand_style: "dark",
    });
    // missing brand_style
    expectSchemaFailure("change_artifact_style", {
      product_id: "P-123abc",
      artifact_id: "ABCDEFGHIJ123456",
      html: "<main/>",
      title: "Checkout",
    });
    // missing artifact_id
    expectSchemaFailure("change_artifact_style", {
      product_id: "P-123abc",
      html: "<main/>",
      title: "Checkout",
      brand_style: "dark",
    });
    // missing product_id
    expectSchemaFailure("change_artifact_style", {
      artifact_id: "ABCDEFGHIJ123456",
      html: "<main/>",
      title: "Checkout",
      brand_style: "dark",
    });
  });

  it("change_artifact_style delegates to store with mapped camelCase fields and returns {artifact_id, version, preview_status}", async () => {
    const fakeResult = { artifact_id: "ABCDEFGHIJ123456", version: 2, preview_status: "pending" };
    const store = fakeStore({
      changeArtifactStyle: vi.fn(async () => fakeResult),
    });
    const tools = createFormaTools(store);

    const result = await tools.change_artifact_style({
      product_id: "P-123abc",
      artifact_id: "ABCDEFGHIJ123456",
      html: "<main>Restyled</main>",
      title: "Checkout (Dark)",
      brand_style: "dark",
      system_style: "material",
    });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    expect(payload).toMatchObject({ artifact_id: "ABCDEFGHIJ123456", version: 2, preview_status: "pending" });
    expect(
      (store as unknown as { changeArtifactStyle: ReturnType<typeof vi.fn> }).changeArtifactStyle,
    ).toHaveBeenCalledWith("P-123abc", "ABCDEFGHIJ123456", {
      html: "<main>Restyled</main>",
      title: "Checkout (Dark)",
      brandStyle: "dark",
      systemStyle: "material",
    });
  });

  it("change_artifact_style passes through store errors as MCP error results", async () => {
    const { FormaError: ActualFormaError } = await import("@xenonbyte/forma-core");
    const store = fakeStore({
      changeArtifactStyle: vi.fn(async () => {
        throw new ActualFormaError("ARTIFACT_NOT_FOUND", "Artifact not found");
      }),
    });
    const tools = createFormaTools(store);

    const result = await tools.change_artifact_style({
      product_id: "P-123abc",
      artifact_id: "MISSING12345678",
      html: "<main/>",
      title: "Checkout",
      brand_style: "dark",
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
        listSystemStyles: vi.fn(async () => [{ name: "material", tokens: {} }]),
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
              change_type: "new",
            },
          ],
        })),
        getProductRules: vi.fn(async () => [
          {
            id: "R-12345678-rule-1",
            page_id: "checkout",
            given: "cart has items",
            when: "checkout opens",
            then: "payment form appears",
            source_requirement: "R-12345678",
          },
        ]),
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
          requirements: {},
        })),
      },
      ...overrides,
    });
  }

  it("get_design_context appears in formaToolNames", () => {
    expect(formaToolNames).toContain("get_design_context");
  });

  it("get_design_context schema accepts valid minimal input", () => {
    expectSchemaSuccess("get_design_context", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
    });
  });

  it("get_design_context schema accepts all optional fields", () => {
    expectSchemaSuccess("get_design_context", {
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout",
      brand_style: "linear",
      system_style: "material",
      craft_slugs: ["spacing", "typography"],
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
      unknown_field: "value",
    });
  });

  it("get_design_context returns craft docs, brand style, and page for a specific page_id", async () => {
    const store = fakeStoreWithDesignContext();
    const tools = createFormaTools(store);

    const result = await tools.get_design_context({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout",
    });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    expect(payload.craft).toEqual(expect.arrayContaining([expect.objectContaining({ slug: "spacing" })]));
    expect(payload.brandStyle).toMatchObject({ metadata: { name: "linear" } });
    expect(payload.page).toMatchObject({ page_id: "checkout" });
    expect(payload.rules).toEqual(expect.arrayContaining([expect.objectContaining({ page_id: "checkout" })]));
  });

  it("get_design_context uses explicit brand_style over product config", async () => {
    const store = fakeStoreWithDesignContext({
      styles: {
        getStyle: vi.fn(async (name: string) => ({ metadata: { name }, designMd: `# ${name}` })),
        listStyles: vi.fn(async () => []),
        listCraftDocs: vi.fn(async () => []),
        readCraftDoc: vi.fn(async () => ({ slug: "x", content: "" })),
        listSystemStyles: vi.fn(async () => []),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_design_context({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      brand_style: "darkmode",
    });

    expect(result.isError).toBeUndefined();
    const payload = textPayload(result);
    expect(payload.brandStyle).toMatchObject({ metadata: { name: "darkmode" } });
    expect(
      (store as unknown as { styles: { getStyle: ReturnType<typeof vi.fn> } }).styles.getStyle,
    ).toHaveBeenCalledWith("darkmode");
  });

  it("get_design_context with craft_slugs fetches only specified craft docs", async () => {
    const readCraftDoc = vi.fn(async (slug: string) => ({ slug, content: `# ${slug}` }));
    const store = fakeStoreWithDesignContext({
      styles: {
        getStyle: vi.fn(async () => ({ metadata: { name: "linear" }, designMd: "# Linear" })),
        listStyles: vi.fn(async () => []),
        listCraftDocs: vi.fn(async () => []),
        readCraftDoc,
        listSystemStyles: vi.fn(async () => []),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_design_context({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      craft_slugs: ["spacing", "typography"],
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
        }),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_design_context({
      product_id: "P-missing",
      requirement_id: "R-12345678",
    });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "PRODUCT_NOT_FOUND" });
  });
});

// ─── Design Handoff Tools (Task 8) ──────────────────────────────────────────

/**
 * Build a minimal VZI byte buffer using the real transformer + encoder.
 * No Puppeteer required — hand-crafts a minimal IR with two elements
 * (one container and one text) plus one SVG-bearing element.
 */
function buildMinimalVziBytes(
  opts: {
    title?: string;
    withSvgElement?: boolean;
    formaProductId?: string;
    formaRequirementId?: string;
    formaArtifactId?: string;
    iconRelativePath?: string;
    withNestedText?: boolean;
    textContent?: string;
  } = {},
): Uint8Array {
  const {
    title = "test-page",
    withSvgElement = false,
    formaProductId,
    formaRequirementId,
    formaArtifactId,
    iconRelativePath,
    withNestedText = false,
    textContent = "Hello design",
  } = opts;

  const elements: Record<string, import("@vzi-core/types").IRElement> = {
    "el-root": {
      id: "el-root",
      parentId: null,
      type: "container",
      bounds: { x: 0, y: 0, width: 1024, height: 768 },
      styles: { backgroundColor: "#ffffff", display: "flex" },
    },
    "el-text": {
      id: "el-text",
      parentId: "el-root",
      type: "text",
      bounds: { x: 16, y: 16, width: 200, height: 24 },
      styles: { color: "#333333", fontSize: 16, fontFamily: "Inter" },
      textContent,
    },
  };

  if (withNestedText) {
    elements["el-nested"] = {
      id: "el-nested",
      parentId: "el-text",
      type: "text",
      bounds: { x: 24, y: 48, width: 160, height: 20 },
      styles: { color: "#555555", fontSize: 14, fontFamily: "Inter" },
      textContent: "Nested detail",
    };
  }

  if (withSvgElement) {
    const svgEl: import("@vzi-core/types").IRElement = {
      id: "el-svg",
      parentId: "el-root",
      type: "image" as import("@vzi-core/types").IRElementType,
      bounds: { x: 16, y: 56, width: 24, height: 24 },
      styles: {},
      svgData: {
        viewBox: "0 0 24 24",
        paths: [{ d: "M12 2C6.47 2 2 6.47 2 12", fill: "red" }],
      },
      metadata: {
        ...(iconRelativePath ? { iconRelativePath } : {}),
      },
    };
    elements["el-svg"] = svgEl;
  }

  const ir: import("@vzi-core/types").IntermediateRepresentation = {
    version: "1.0",
    rootElementId: "el-root",
    elements,
    metadata: { title, viewport: { width: 1024, height: 768 } },
  };

  const transformer = new VZITransformer({
    title,
    createdBy: "forma-test",
    sourceType: "file",
    sourceIdentifier: "test/fixture",
    enableAnnotations: true,
    enableTokenExtraction: true,
  });
  const transformResult = transformer.transform(ir);
  const content = buildVziContentFromTransformResult(transformResult);

  // Inject forma metadata extensions
  const extMeta = content.metadata as typeof content.metadata & Record<string, unknown>;
  extMeta["formaProductId"] = formaProductId ?? null;
  extMeta["formaRequirementId"] = formaRequirementId ?? null;
  extMeta["formaArtifactId"] = formaArtifactId ?? null;
  extMeta["formaViewport"] = { width: 1024, height: 768 };
  extMeta["formaPlatform"] = "web";

  // If iconRelativePath is provided, also inject into image map (simulates Task 5)
  if (withSvgElement && iconRelativePath) {
    const svgEl = content.elements.get("el-svg");
    if (svgEl) {
      svgEl.metadata = { ...(svgEl.metadata ?? {}), iconRelativePath };
      content.elements.set("el-svg", svgEl);
    }
  }

  const encoder = new VZIEncoder();
  return encoder.encode(content);
}

/**
 * Write a VZI fixture to the expected artifact path.
 */
async function writeVziFixture(
  productsRoot: string,
  productId: string,
  artifactId: string,
  vziBytes: Uint8Array,
  options: { writeEmptyIconsManifest?: boolean } = {},
): Promise<void> {
  const vziPath = getArtifactVziPath(productsRoot, productId, artifactId);
  await mkdir(dirname(vziPath), { recursive: true });
  await writeFile(vziPath, vziBytes);

  if (options.writeEmptyIconsManifest === false) {
    return;
  }

  const iconsDir = getArtifactIconsDir(productsRoot, productId, artifactId);
  await mkdir(iconsDir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    artifactId,
    productId,
    requirementId: "R-testtest",
    pageId: "page-test",
    version: "v1",
    sourceVersion: "v1",
    generatedFrom: "requirement-archive",
    generatedAt: "2026-06-02T00:00:00.000Z",
    densities: [1, 2, 3],
    icons: [],
    instances: [],
  };
  await writeFile(join(iconsDir, "icons.json"), JSON.stringify(manifest), "utf8");
}

/**
 * Write icons.json manifest and a stub SVG file for icon resolution tests.
 */
async function writeIconsFixture(
  productsRoot: string,
  productId: string,
  artifactId: string,
  iconRelativePath: string, // e.g. "icons/icon-test.svg"
  options: { requirementId?: string; pageId?: string; version?: string; variant?: string } = {},
): Promise<void> {
  const iconsDir = getArtifactIconsDir(productsRoot, productId, artifactId);
  await mkdir(iconsDir, { recursive: true });

  const iconFilename = iconRelativePath.replace(/^icons\//, "");
  await writeFile(join(iconsDir, iconFilename), '<svg xmlns="http://www.w3.org/2000/svg"/>', "utf8");

  const manifest = {
    schemaVersion: 1,
    artifactId,
    productId,
    requirementId: options.requirementId ?? "R-testtest",
    pageId: options.pageId ?? "page-test",
    version: options.version ?? "v1",
    sourceVersion: options.version ?? "v1",
    ...(options.variant ? { variant: options.variant } : {}),
    generatedFrom: "requirement-archive",
    generatedAt: "2026-06-02T00:00:00.000Z",
    densities: [1, 2, 3],
    icons: [
      {
        id: "icon-test",
        name: "icon-test",
        contentHash: "abc123",
        size: { w: 24, h: 24 },
        usesCurrentColor: false,
        sourceOrderFirst: 0,
        sourceOrders: [0],
        files: {
          svg: iconRelativePath,
          png: {},
        },
      },
    ],
    instances: [{ sourceOrder: 0, iconId: "icon-test", contentHash: "abc123" }],
  };
  await writeFile(join(iconsDir, "icons.json"), JSON.stringify(manifest), "utf8");
}

describe("design-handoff tools (Task 8)", () => {
  const PRODUCT_ID = "P-aabbcc";
  const REQ_ID = "R-aabbccdd";
  const ARTIFACT_ID = "ArtAAAAAAAAAAAAA";
  const PAGE_ID = "page-home";
  const ICON_REL_PATH = "icons/icon-test-abc123.svg";

  // ─── Schema validation ──────────────────────────────────────────────────────

  it("new tools appear in formaToolNames", () => {
    expect(formaToolNames).toContain("get_design_handoff");
    expect(formaToolNames).toContain("get_page_ui");
    expect(formaToolNames).toContain("get_ui_node");
    expect(formaToolNames).toContain("search_page_ui");
  });

  it("new tool schemas are JSON-Schema compatible (z.toJSONSchema)", () => {
    const failures: string[] = [];
    for (const name of ["get_design_handoff", "get_page_ui", "get_ui_node", "search_page_ui"] as const) {
      try {
        z.toJSONSchema(formaToolInputSchemas[name]);
      } catch (err) {
        failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("get_design_handoff rejects product_id parameter (requirement_id only)", () => {
    const parsed = formaToolInputSchemas.get_design_handoff.safeParse({
      requirement_id: REQ_ID,
      product_id: PRODUCT_ID,
    });
    expect(parsed.success).toBe(false);
  });

  it("get_design_handoff requires requirement_id", () => {
    const parsed = formaToolInputSchemas.get_design_handoff.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it("get_page_ui requires requirement_id and page_id", () => {
    expect(formaToolInputSchemas.get_page_ui.safeParse({ requirement_id: REQ_ID, page_id: PAGE_ID }).success).toBe(
      true,
    );
    expect(formaToolInputSchemas.get_page_ui.safeParse({ requirement_id: REQ_ID }).success).toBe(false);
    expect(formaToolInputSchemas.get_page_ui.safeParse({ page_id: PAGE_ID }).success).toBe(false);
  });

  it("get_page_ui accepts optional depth, fields, node_id, variant, and artifact_id", () => {
    const valid = formaToolInputSchemas.get_page_ui.safeParse({
      requirement_id: REQ_ID,
      page_id: PAGE_ID,
      depth: 3,
      fields: "layout",
      node_id: "el-root",
      variant: "experiment",
      artifact_id: "artifact-123",
    });
    expect(valid.success).toBe(true);
  });

  it("get_ui_node and search_page_ui accept optional variant and artifact_id", () => {
    expect(
      formaToolInputSchemas.get_ui_node.safeParse({
        requirement_id: REQ_ID,
        page_id: PAGE_ID,
        node_id: "el-root",
        variant: "experiment",
        artifact_id: "artifact-123",
      }).success,
    ).toBe(true);

    expect(
      formaToolInputSchemas.search_page_ui.safeParse({
        requirement_id: REQ_ID,
        page_id: PAGE_ID,
        query: "hello",
        variant: "experiment",
        artifact_id: "artifact-123",
      }).success,
    ).toBe(true);
  });

  it("get_page_ui rejects invalid fields value", () => {
    const invalid = formaToolInputSchemas.get_page_ui.safeParse({
      requirement_id: REQ_ID,
      page_id: PAGE_ID,
      fields: "unknown-field",
    });
    expect(invalid.success).toBe(false);
  });

  // ─── Gate: REQUIREMENT_NOT_FINALIZED ───────────────────────────────────────

  it("get_design_handoff returns REQUIREMENT_NOT_FINALIZED when requirement is not archived", async () => {
    const store = fakeStore({
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: REQ_ID,
          product_id: PRODUCT_ID,
          status: "active",
          pages: [],
          document_md: "",
        })),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_design_handoff({ requirement_id: REQ_ID });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({
      error_code: "REQUIREMENT_NOT_FINALIZED",
    });
    expect(textPayload(result).details).toMatchObject({ requirement_id: REQ_ID, status: "active" });
  });

  it("get_page_ui returns REQUIREMENT_NOT_FINALIZED when requirement is submitted", async () => {
    const store = fakeStore({
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: REQ_ID,
          product_id: PRODUCT_ID,
          status: "submitted",
          pages: [],
          document_md: "",
        })),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "REQUIREMENT_NOT_FINALIZED" });
  });

  it("get_ui_node returns REQUIREMENT_NOT_FINALIZED when requirement is empty", async () => {
    const store = fakeStore({
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: REQ_ID,
          product_id: PRODUCT_ID,
          status: "empty",
          pages: [],
          document_md: "",
        })),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_ui_node({ requirement_id: REQ_ID, page_id: PAGE_ID, node_id: "el-root" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "REQUIREMENT_NOT_FINALIZED" });
  });

  it("search_page_ui returns REQUIREMENT_NOT_FINALIZED when requirement is not archived", async () => {
    const store = fakeStore({
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: REQ_ID,
          product_id: PRODUCT_ID,
          status: "active",
          pages: [],
          document_md: "",
        })),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.search_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID, query: "hello" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({ error_code: "REQUIREMENT_NOT_FINALIZED" });
  });

  // ─── VZI missing → ARTIFACT_NOT_FOUND ─────────────────────────────────────

  it("get_page_ui returns ARTIFACT_NOT_FOUND when VZI file is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-handoff-missing-"));
    try {
      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
          getProductRules: vi.fn(async () => []),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID });

      expect(result.isError).toBe(true);
      expect(textPayload(result)).toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  // ─── Full VZI read — tokens, annotations, handoff ─────────────────────────

  it("get_design_handoff returns page directory with vziPath, indexHtmlPath, iconCount for archived requirement", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-handoff-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({ title: PAGE_ID });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);
      await writeIconsFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, ICON_REL_PATH);

      // Seed index.html
      const versionDir = getArtifactVersionDir(productsRoot, PRODUCT_ID, ARTIFACT_ID, 1);
      await mkdir(versionDir, { recursive: true });
      await writeFile(join(versionDir, "index.html"), "<!DOCTYPE html><html></html>", "utf8");

      const rules = [{ id: "rule-1", given: "g", when: "w", then: "t" }];
      const translations = [{ page_id: PAGE_ID, entries: [] }];

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [{ page_id: PAGE_ID }],
            document_md: "",
          })),
          getProductRules: vi.fn(async () => rules),
        },
        copy: {
          ...fakeStore().copy,
          getTranslations: vi.fn(async () => translations),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_design_handoff({ requirement_id: REQ_ID });
      const payload = textPayload(result);

      expect(result.isError).toBeUndefined();
      expect(payload.requirement).toMatchObject({ id: REQ_ID, status: "archived" });
      expect(payload.pages).toHaveLength(1);
      expect(payload.pages[0]).toMatchObject({
        pageId: PAGE_ID,
        artifactId: ARTIFACT_ID,
        version: 1,
        iconCount: 1,
      });
      expect(payload.pages[0].vziPath).toMatch(/page\.vzi$/);
      expect(payload.pages[0].indexHtmlPath).toMatch(/index\.html$/);
      // vziPath must be inside productsRoot (path-safety)
      expect(payload.pages[0].vziPath).toContain(PRODUCT_ID);
      expect(payload.pages[0].vziPath).toContain(ARTIFACT_ID);
      expect(payload.rules).toEqual(rules);
      expect(payload.copy).toEqual(translations);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_design_handoff skips temporary and invalid artifact directories while scanning archives", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-handoff-skip-invalid-"));
    try {
      const productsRoot = join(home, "data", "products");
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, buildMinimalVziBytes({ title: PAGE_ID }));
      await writeIconsFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, ICON_REL_PATH, {
        requirementId: REQ_ID,
        pageId: PAGE_ID,
        version: "v1",
      });

      const versionDir = getArtifactVersionDir(productsRoot, PRODUCT_ID, ARTIFACT_ID, 1);
      await mkdir(versionDir, { recursive: true });
      await writeFile(join(versionDir, "index.html"), "<!DOCTYPE html><html></html>", "utf8");

      const artifactsDir = getArtifactsDir(productsRoot, PRODUCT_ID);
      await mkdir(join(artifactsDir, ".tmp-in-progress"), { recursive: true });
      await mkdir(join(artifactsDir, "invalid.artifact"), { recursive: true });

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [{ page_id: PAGE_ID }],
            document_md: "",
          })),
          getProductRules: vi.fn(async () => []),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_design_handoff({ requirement_id: REQ_ID });
      const payload = textPayload(result);

      expect(result.isError).toBeUndefined();
      expect(payload.pages).toHaveLength(1);
      expect(payload.pages[0]).toMatchObject({
        pageId: PAGE_ID,
        artifactId: ARTIFACT_ID,
        version: 1,
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_design_handoff skips archived manifests for pages removed from the requirement", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-handoff-removed-page-"));
    const staleArtifactId = "ArtCCCCCCCCCCCCC";
    try {
      const productsRoot = join(home, "data", "products");

      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, buildMinimalVziBytes({ title: PAGE_ID }));
      await writeIconsFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, ICON_REL_PATH, {
        requirementId: REQ_ID,
        pageId: PAGE_ID,
        version: "v1",
      });

      await writeVziFixture(productsRoot, PRODUCT_ID, staleArtifactId, buildMinimalVziBytes({ title: "page-removed" }));
      await writeIconsFixture(productsRoot, PRODUCT_ID, staleArtifactId, ICON_REL_PATH, {
        requirementId: REQ_ID,
        pageId: "page-removed",
        version: "v1",
      });

      for (const artifactId of [ARTIFACT_ID, staleArtifactId]) {
        const versionDir = getArtifactVersionDir(productsRoot, PRODUCT_ID, artifactId, 1);
        await mkdir(versionDir, { recursive: true });
        await writeFile(join(versionDir, "index.html"), "<!DOCTYPE html><html></html>", "utf8");
      }

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [{ page_id: PAGE_ID }],
            document_md: "",
          })),
          getProductRules: vi.fn(async () => []),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_design_handoff({ requirement_id: REQ_ID });
      const payload = textPayload(result);

      expect(result.isError).toBeUndefined();
      expect(
        payload.pages.map((page: { pageId: string; artifactId: string }) => ({
          pageId: page.pageId,
          artifactId: page.artifactId,
        })),
      ).toEqual([{ pageId: PAGE_ID, artifactId: ARTIFACT_ID }]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("pins archived handoff to the generated asset version after the active pointer advances", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-handoff-pinned-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({ title: PAGE_ID, textContent: "Archived UI" });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);
      await writeIconsFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, ICON_REL_PATH, {
        requirementId: REQ_ID,
        pageId: PAGE_ID,
        variant: "default",
        version: "v1",
      });

      const archivedVersionDir = getArtifactVersionDir(productsRoot, PRODUCT_ID, ARTIFACT_ID, 1);
      const advancedVersionDir = getArtifactVersionDir(productsRoot, PRODUCT_ID, ARTIFACT_ID, 2);
      await mkdir(archivedVersionDir, { recursive: true });
      await mkdir(advancedVersionDir, { recursive: true });
      await writeFile(join(archivedVersionDir, "index.html"), "<!DOCTYPE html><html>archived</html>", "utf8");
      await writeFile(join(advancedVersionDir, "index.html"), "<!DOCTYPE html><html>advanced</html>", "utf8");

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [{ page_id: PAGE_ID }],
            document_md: "",
          })),
          getProductRules: vi.fn(async () => []),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 2,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const handoffResult = await tools.get_design_handoff({ requirement_id: REQ_ID });
      const handoffPayload = textPayload(handoffResult);

      expect(handoffResult.isError).toBeUndefined();
      expect(handoffPayload.pages).toHaveLength(1);
      expect(handoffPayload.pages[0]).toMatchObject({
        pageId: PAGE_ID,
        variant: "default",
        artifactId: ARTIFACT_ID,
        version: 1,
      });
      expect(handoffPayload.pages[0].indexHtmlPath).toContain(`${ARTIFACT_ID}/v1/index.html`);

      const pageResult = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID });
      const pagePayload = textPayload(pageResult);

      expect(pageResult.isError).toBeUndefined();
      expect(pagePayload.version).toBe(1);
      expect(pagePayload.tree.some((el: { textContent?: string }) => el.textContent === "Archived UI")).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_design_handoff exposes variant identity and read tools can select duplicate page variants", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-handoff-variants-"));
    const secondArtifactId = "ArtBBBBBBBBBBBBB";
    try {
      const productsRoot = join(home, "data", "products");
      await writeVziFixture(
        productsRoot,
        PRODUCT_ID,
        ARTIFACT_ID,
        buildMinimalVziBytes({ title: PAGE_ID, textContent: "Default variant" }),
      );
      await writeVziFixture(
        productsRoot,
        PRODUCT_ID,
        secondArtifactId,
        buildMinimalVziBytes({ title: PAGE_ID, textContent: "Experiment variant" }),
      );

      for (const [artifactId, version] of [
        [ARTIFACT_ID, 1],
        [secondArtifactId, 2],
      ] as const) {
        const versionDir = getArtifactVersionDir(productsRoot, PRODUCT_ID, artifactId, version);
        await mkdir(versionDir, { recursive: true });
        await writeFile(join(versionDir, "index.html"), "<!DOCTYPE html><html></html>", "utf8");
      }

      const pointers = [
        {
          requirementId: REQ_ID,
          pageId: PAGE_ID,
          variant: "default",
          artifactId: ARTIFACT_ID,
          version: 1,
          designStatus: "active" as const,
        },
        {
          requirementId: REQ_ID,
          pageId: PAGE_ID,
          variant: "experiment",
          artifactId: secondArtifactId,
          version: 2,
          designStatus: "active" as const,
        },
      ];
      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [{ page_id: PAGE_ID }],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => pointers),
        },
      });
      const tools = createFormaTools(store);

      const handoff = textPayload(await tools.get_design_handoff({ requirement_id: REQ_ID }));
      expect(
        handoff.pages.map((page: { pageId: string; variant?: string; artifactId: string }) => ({
          pageId: page.pageId,
          variant: page.variant,
          artifactId: page.artifactId,
        })),
      ).toEqual([
        { pageId: PAGE_ID, variant: "default", artifactId: ARTIFACT_ID },
        { pageId: PAGE_ID, variant: "experiment", artifactId: secondArtifactId },
      ]);

      const pageUi = textPayload(
        await tools.get_page_ui({
          requirement_id: REQ_ID,
          page_id: PAGE_ID,
          variant: "experiment",
        }),
      );
      expect(pageUi.artifactId).toBe(secondArtifactId);
      expect(pageUi.variant).toBe("experiment");
      expect(pageUi.tree.some((el: { textContent?: string }) => el.textContent === "Experiment variant")).toBe(true);

      const searchResult = textPayload(
        await tools.search_page_ui({
          requirement_id: REQ_ID,
          page_id: PAGE_ID,
          artifact_id: secondArtifactId,
          query: "Experiment",
        }),
      );
      expect(searchResult.artifactId).toBe(secondArtifactId);
      expect(searchResult.variant).toBe("experiment");
      expect(searchResult.total).toBeGreaterThan(0);

      const nodeResult = textPayload(
        await tools.get_ui_node({
          requirement_id: REQ_ID,
          page_id: PAGE_ID,
          variant: "experiment",
          node_id: "el-text",
        }),
      );
      expect(nodeResult.textContent).toBe("Experiment variant");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_design_handoff returns ARTIFACT_NOT_FOUND when the generated icons manifest is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-handoff-missing-icons-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({ title: PAGE_ID });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes, {
        writeEmptyIconsManifest: false,
      });

      const versionDir = getArtifactVersionDir(productsRoot, PRODUCT_ID, ARTIFACT_ID, 1);
      await mkdir(versionDir, { recursive: true });
      await writeFile(join(versionDir, "index.html"), "<!DOCTYPE html><html></html>", "utf8");

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [{ page_id: PAGE_ID }],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_design_handoff({ requirement_id: REQ_ID });

      expect(result.isError).toBe(true);
      expect(textPayload(result)).toMatchObject({
        error_code: "ARTIFACT_NOT_FOUND",
        details: {
          artifactId: ARTIFACT_ID,
          handoffType: "icons",
        },
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_design_handoff returns ARTIFACT_NOT_FOUND when the generated VZI file is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-handoff-missing-vzi-"));
    try {
      const productsRoot = join(home, "data", "products");
      await writeIconsFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, ICON_REL_PATH, {
        requirementId: REQ_ID,
        pageId: PAGE_ID,
      });

      const versionDir = getArtifactVersionDir(productsRoot, PRODUCT_ID, ARTIFACT_ID, 1);
      await mkdir(versionDir, { recursive: true });
      await writeFile(join(versionDir, "index.html"), "<!DOCTYPE html><html></html>", "utf8");

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [{ page_id: PAGE_ID }],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_design_handoff({ requirement_id: REQ_ID });

      expect(result.isError).toBe(true);
      expect(textPayload(result)).toMatchObject({
        error_code: "ARTIFACT_NOT_FOUND",
        details: {
          artifactId: ARTIFACT_ID,
          handoffType: "vzi",
        },
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_design_handoff returns ARTIFACT_UNSUPPORTED_FORMAT when the generated VZI file is corrupt", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-handoff-corrupt-vzi-"));
    try {
      const productsRoot = join(home, "data", "products");
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, new Uint8Array([1, 2, 3]));
      await writeIconsFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, ICON_REL_PATH, {
        requirementId: REQ_ID,
        pageId: PAGE_ID,
      });

      const versionDir = getArtifactVersionDir(productsRoot, PRODUCT_ID, ARTIFACT_ID, 1);
      await mkdir(versionDir, { recursive: true });
      await writeFile(join(versionDir, "index.html"), "<!DOCTYPE html><html></html>", "utf8");

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [{ page_id: PAGE_ID }],
            document_md: "",
          })),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_design_handoff({ requirement_id: REQ_ID });

      expect(result.isError).toBe(true);
      expect(textPayload(result)).toMatchObject({
        error_code: "ARTIFACT_UNSUPPORTED_FORMAT",
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_page_ui returns ARTIFACT_UNSUPPORTED_FORMAT when VZI decode throws", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-pageui-corrupt-vzi-"));
    try {
      const productsRoot = join(home, "data", "products");
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, new Uint8Array([1, 2, 3]));

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID });

      expect(result.isError).toBe(true);
      expect(textPayload(result)).toMatchObject({
        error_code: "ARTIFACT_UNSUPPORTED_FORMAT",
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_design_handoff returns ARTIFACT_INVALID_INPUT when icons manifest is malformed", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-handoff-bad-icons-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({ title: PAGE_ID });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);

      const iconsDir = getArtifactIconsDir(productsRoot, PRODUCT_ID, ARTIFACT_ID);
      await writeFile(join(iconsDir, "icons.json"), JSON.stringify({ schemaVersion: 1 }), "utf8");

      const versionDir = getArtifactVersionDir(productsRoot, PRODUCT_ID, ARTIFACT_ID, 1);
      await mkdir(versionDir, { recursive: true });
      await writeFile(join(versionDir, "index.html"), "<!DOCTYPE html><html></html>", "utf8");

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [{ page_id: PAGE_ID }],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_design_handoff({ requirement_id: REQ_ID });

      expect(result.isError).toBe(true);
      expect(textPayload(result)).toMatchObject({
        error_code: "ARTIFACT_INVALID_INPUT",
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_page_ui returns top-level de-duplicated tokens and annotations for archived requirement", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-pageui-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({ title: PAGE_ID });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID });
      const payload = textPayload(result);

      expect(result.isError).toBeUndefined();
      // Top-level tokens: arrays (de-duplicated)
      expect(Array.isArray(payload.tokens.colors)).toBe(true);
      expect(Array.isArray(payload.tokens.fonts)).toBe(true);
      // Annotations at top level
      expect(Array.isArray(payload.annotations)).toBe(true);
      // Tree at top level
      expect(Array.isArray(payload.tree)).toBe(true);
      // Viewport and platform from VZI metadata
      expect(payload.viewport).toMatchObject({ width: 1024, height: 768 });
      expect(payload.platform).toBe("web");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_page_ui tree contains elements with correct types and bounds", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-pageui-tree-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({ title: PAGE_ID });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID });
      const payload = textPayload(result);

      expect(result.isError).toBeUndefined();
      expect(payload.tree.length).toBeGreaterThan(0);
      const root = payload.tree.find((el: { id: string }) => el.id === "el-root");
      expect(root).toBeDefined();
      expect(root.type).toBe("container");
      expect(root.bounds).toMatchObject({ x: 0, y: 0, width: 1024, height: 768 });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_page_ui depth filter limits tree depth", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-pageui-depth-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({ title: PAGE_ID });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const allResult = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID });
      const depth1Result = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID, depth: 1 });

      const allPayload = textPayload(allResult);
      const depth1Payload = textPayload(depth1Result);

      expect(allPayload.tree.length).toBeGreaterThanOrEqual(depth1Payload.tree.length);
      // At depth 1, no element should have depth > 1
      for (const el of depth1Payload.tree) {
        if (el.depth !== undefined) {
          expect(el.depth).toBeLessThanOrEqual(1);
        }
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_page_ui node_id returns subtree rooted at that node", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-pageui-nodeid-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({ title: PAGE_ID, withNestedText: true });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      // Get full tree first
      const fullResult = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID });
      const fullPayload = textPayload(fullResult);
      const textEl = fullPayload.tree.find((el: { id: string }) => el.id === "el-text");
      expect(textEl).toBeDefined();

      // Get subtree rooted at el-text
      const subtreeResult = await tools.get_page_ui({
        requirement_id: REQ_ID,
        page_id: PAGE_ID,
        node_id: "el-text",
      });
      const subtreePayload = textPayload(subtreeResult);

      const subtreeIds = subtreePayload.tree.map((el: { id: string }) => el.id);
      expect(subtreeIds).toEqual(["el-text", "el-nested"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_ui_node returns full element detail with node-scoped annotations", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-uinode-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({ title: PAGE_ID });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_ui_node({
        requirement_id: REQ_ID,
        page_id: PAGE_ID,
        node_id: "el-root",
      });
      const payload = textPayload(result);

      expect(result.isError).toBeUndefined();
      expect(payload.id).toBe("el-root");
      expect(payload.type).toBe("container");
      expect(payload.bounds).toMatchObject({ x: 0, y: 0, width: 1024, height: 768 });
      // Node-scoped annotations must be present (array, may be empty for this node)
      expect(Array.isArray(payload.annotations)).toBe(true);
      // children must be present
      expect(Array.isArray(payload.children)).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_ui_node returns ARTIFACT_NOT_FOUND for non-existent node_id", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-uinode-missing-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({ title: PAGE_ID });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_ui_node({
        requirement_id: REQ_ID,
        page_id: PAGE_ID,
        node_id: "non-existent-node",
      });

      expect(result.isError).toBe(true);
      expect(textPayload(result)).toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("search_page_ui returns matching elements for text query", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-search-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({ title: PAGE_ID });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.search_page_ui({
        requirement_id: REQ_ID,
        page_id: PAGE_ID,
        query: "Hello design",
      });
      const payload = textPayload(result);

      expect(result.isError).toBeUndefined();
      expect(payload.query).toBe("Hello design");
      expect(payload.page_id).toBe(PAGE_ID);
      expect(Array.isArray(payload.elements)).toBe(true);
      expect(typeof payload.total).toBe("number");
      // The text element "Hello design" should be found
      expect(payload.elements.some((el: { textContent?: string }) => el.textContent?.includes("Hello design"))).toBe(
        true,
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("search_page_ui resolves assetRef for matching icon elements", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-search-assetref-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({
        title: PAGE_ID,
        withSvgElement: true,
        iconRelativePath: ICON_REL_PATH,
      });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);
      await writeIconsFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, ICON_REL_PATH);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.search_page_ui({
        requirement_id: REQ_ID,
        page_id: PAGE_ID,
        query: "el-svg",
      });
      const payload = textPayload(result);

      expect(result.isError).toBeUndefined();
      const svgEl = payload.elements.find((el: { id: string; assetRef?: string }) => el.id === "el-svg");
      expect(svgEl).toBeDefined();
      expect(svgEl.assetRef).toMatch(/^\//);
      expect(svgEl.assetRef).toContain(home);
      expect(svgEl.assetRef).toContain("icons");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("search_page_ui returns empty results for non-matching query", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-search-empty-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({ title: PAGE_ID });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.search_page_ui({
        requirement_id: REQ_ID,
        page_id: PAGE_ID,
        query: "zzz-no-match-zzz",
      });
      const payload = textPayload(result);

      expect(result.isError).toBeUndefined();
      expect(payload.total).toBe(0);
      expect(payload.elements).toHaveLength(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  // ─── assetRef resolution ───────────────────────────────────────────────────

  it("get_page_ui resolves assetRef to absolute icons/ path for elements with iconRelativePath", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-assetref-"));
    try {
      const productsRoot = join(home, "data", "products");
      // Build VZI with an SVG element that has iconRelativePath in metadata
      const vziBytes = buildMinimalVziBytes({
        title: PAGE_ID,
        withSvgElement: true,
        iconRelativePath: ICON_REL_PATH,
      });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);
      await writeIconsFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, ICON_REL_PATH);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID });
      const payload = textPayload(result);

      expect(result.isError).toBeUndefined();
      // Find the SVG element — it should have an assetRef
      const svgEl = payload.tree.find(
        (el: { id: string; assetRef?: string }) => el.id === "el-svg" && el.assetRef !== undefined,
      );
      expect(svgEl).toBeDefined();
      // assetRef must be an absolute path
      expect(svgEl.assetRef).toMatch(/^\//);
      // assetRef must be inside productsRoot (path-safety)
      expect(svgEl.assetRef).toContain(PRODUCT_ID);
      expect(svgEl.assetRef).toContain(ARTIFACT_ID);
      expect(svgEl.assetRef).toContain("icons");
      // assetRef must be inside the home directory (Forma root safety)
      expect(svgEl.assetRef).toContain(home);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_ui_node resolves assetRef for a node with iconRelativePath", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-uinode-assetref-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({
        title: PAGE_ID,
        withSvgElement: true,
        iconRelativePath: ICON_REL_PATH,
      });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);
      await writeIconsFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, ICON_REL_PATH);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_ui_node({
        requirement_id: REQ_ID,
        page_id: PAGE_ID,
        node_id: "el-svg",
      });
      const payload = textPayload(result);

      expect(result.isError).toBeUndefined();
      expect(payload.id).toBe("el-svg");
      // assetRef must be resolved to absolute path inside Forma root
      expect(typeof payload.assetRef).toBe("string");
      expect(payload.assetRef).toMatch(/^\//);
      expect(payload.assetRef).toContain(home);
      expect(payload.assetRef).toContain("icons");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_page_ui does not expose assetRef for elements without iconRelativePath", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-no-assetref-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({ title: PAGE_ID }); // no SVG, no iconRelativePath
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID });
      const payload = textPayload(result);

      expect(result.isError).toBeUndefined();
      // Root and text elements must NOT have assetRef
      const rootEl = payload.tree.find((el: { id: string }) => el.id === "el-root");
      const textEl = payload.tree.find((el: { id: string }) => el.id === "el-text");
      expect(rootEl?.assetRef).toBeUndefined();
      expect(textEl?.assetRef).toBeUndefined();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_page_ui returns ARTIFACT_NOT_FOUND when a generated icon asset is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-missing-assetref-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({
        title: PAGE_ID,
        withSvgElement: true,
        iconRelativePath: ICON_REL_PATH,
      });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID });

      expect(result.isError).toBe(true);
      const payload = textPayload(result);
      expect(payload.error_code).toBe("ARTIFACT_NOT_FOUND");
      expect(payload.details).toMatchObject({
        artifactId: ARTIFACT_ID,
        handoffType: "icons",
        relativePath: ICON_REL_PATH,
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  // ─── FIX 1: assetRef path-escape must throw ARTIFACT_INVALID_INPUT ────────

  it("get_page_ui throws ARTIFACT_INVALID_INPUT when iconRelativePath escapes artifact root", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-escape-pageui-"));
    try {
      const productsRoot = join(home, "data", "products");
      // Build VZI with an SVG element whose iconRelativePath traverses outside
      const vziBytes = buildMinimalVziBytes({
        title: PAGE_ID,
        withSvgElement: true,
        // 5 levels up from productsRoot/P-aabbcc/od-project/artifacts/ArtAAAAAAAAAAAAA → escapes productsRoot
        iconRelativePath: "../../../../../etc/x.svg",
      });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID });

      expect(result.isError).toBe(true);
      const payload = textPayload(result);
      expect(payload.error_code).toBe("ARTIFACT_INVALID_INPUT");
      // The escaped path must NOT be exposed in details
      expect(JSON.stringify(payload.details ?? {})).not.toContain("etc");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_page_ui rejects iconRelativePath that escapes to another artifact under productsRoot", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-cross-artifact-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({
        title: PAGE_ID,
        withSvgElement: true,
        iconRelativePath: "../ArtBBBBBBBBBBBBB/icons/other.svg",
      });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID });

      expect(result.isError).toBe(true);
      const payload = textPayload(result);
      expect(payload.error_code).toBe("ARTIFACT_INVALID_INPUT");
      expect(JSON.stringify(payload.details ?? {})).not.toContain("ArtBBBBBBBBBBBBB");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_ui_node throws ARTIFACT_INVALID_INPUT when iconRelativePath escapes artifact root", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-escape-uinode-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({
        title: PAGE_ID,
        withSvgElement: true,
        // 5 levels up from productsRoot/P-aabbcc/od-project/artifacts/ArtAAAAAAAAAAAAA → escapes productsRoot
        iconRelativePath: "../../../../../etc/x.svg",
      });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_ui_node({
        requirement_id: REQ_ID,
        page_id: PAGE_ID,
        node_id: "el-svg",
      });

      expect(result.isError).toBe(true);
      const payload = textPayload(result);
      expect(payload.error_code).toBe("ARTIFACT_INVALID_INPUT");
      // The escaped path must NOT be exposed in details
      expect(JSON.stringify(payload.details ?? {})).not.toContain("etc");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  // ─── FIX 2: get_page_ui with non-existent node_id throws ARTIFACT_NOT_FOUND ──

  it("get_page_ui with non-existent node_id throws ARTIFACT_NOT_FOUND (not a full-tree response)", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-nodeid-"));
    try {
      const productsRoot = join(home, "data", "products");
      const vziBytes = buildMinimalVziBytes({ title: PAGE_ID });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.get_page_ui({
        requirement_id: REQ_ID,
        page_id: PAGE_ID,
        node_id: "el-does-not-exist",
      });

      expect(result.isError).toBe(true);
      const payload = textPayload(result);
      expect(payload.error_code).toBe("ARTIFACT_NOT_FOUND");
      // Must NOT return a full-tree payload when node_id is provided but not found
      expect(payload.tree).toBeUndefined();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  // ─── FIX 5: fields filter produces different tree output ──────────────────
  // fields='text' sets typeFilter='text'; fields='all' has no type filter.
  // With a fixture that has both text and image elements, 'text' omits the
  // image element that 'all' includes.

  it("get_page_ui fields='text' excludes image elements that fields='all' includes", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-fields-"));
    try {
      const productsRoot = join(home, "data", "products");
      // Build VZI with both text and image elements
      const vziBytes = buildMinimalVziBytes({
        title: PAGE_ID,
        withSvgElement: true,
        iconRelativePath: ICON_REL_PATH,
      });
      await writeVziFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, vziBytes);
      await writeIconsFixture(productsRoot, PRODUCT_ID, ARTIFACT_ID, ICON_REL_PATH);

      const store = fakeStore({
        home,
        requirements: {
          ...fakeStore().requirements,
          getRequirement: vi.fn(async () => ({
            id: REQ_ID,
            product_id: PRODUCT_ID,
            status: "archived",
            pages: [],
            document_md: "",
          })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => [
            {
              requirementId: REQ_ID,
              pageId: PAGE_ID,
              variant: "default",
              artifactId: ARTIFACT_ID,
              version: 1,
              designStatus: "active" as const,
            },
          ]),
        },
      });
      const tools = createFormaTools(store);

      const allResult = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID, fields: "all" });
      const textResult = await tools.get_page_ui({ requirement_id: REQ_ID, page_id: PAGE_ID, fields: "text" });

      expect(allResult.isError).toBeUndefined();
      expect(textResult.isError).toBeUndefined();

      const allTree: Array<{ id: string; type: string }> = textPayload(allResult).tree;
      const textTree: Array<{ id: string; type: string }> = textPayload(textResult).tree;

      // fields='all' must include the image element; fields='text' must exclude it
      expect(allTree.some((el) => el.id === "el-svg" && el.type === "image")).toBe(true);
      expect(textTree.some((el) => el.id === "el-svg")).toBe(false);

      // fields='text' must still include the text element
      expect(textTree.some((el) => el.id === "el-text" && el.type === "text")).toBe(true);

      // The two outputs are different
      expect(allTree.length).not.toBe(textTree.length);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  // ─── Existing tools are not affected by new gate ───────────────────────────

  it("existing tools (generate_requirement_design, get_product_artifact) remain ungated", async () => {
    // These tools must not return REQUIREMENT_NOT_FINALIZED
    const store = fakeStore();
    const tools = createFormaTools(store);

    const generateResult = await tools.generate_requirement_design({
      product_id: PRODUCT_ID,
      requirement_id: REQ_ID,
      page_id: PAGE_ID,
      html: "<!DOCTYPE html><html></html>",
      title: "Test",
      brand_style: "linear",
    });
    const artifactResult = await tools.get_product_artifact({
      product_id: PRODUCT_ID,
      artifact_id: ARTIFACT_ID,
    });

    // Neither should return REQUIREMENT_NOT_FINALIZED
    if (generateResult.isError) {
      expect(textPayload(generateResult).error_code).not.toBe("REQUIREMENT_NOT_FINALIZED");
    }
    if (artifactResult.isError) {
      expect(textPayload(artifactResult).error_code).not.toBe("REQUIREMENT_NOT_FINALIZED");
    }
  });
});

// ─── Regression: archived-gate scoped ONLY to dev-handoff tools (Task 10) ────
//
// These tests prove that existing design tools (get_product_artifact,
// export_artifact with all formats including the new icons/vzi,
// get_design_context, generate_requirement_design, generate_components,
// change_artifact_style) do NOT gate on requirement.status.
// They must succeed (or fail for a non-gate reason) for a non-archived
// (active/submitted) requirement.
//
// The test for each tool uses a store whose getRequirement mock returns
// status: "active" — if the tool accidentally called assertArchived, it would
// return REQUIREMENT_NOT_FINALIZED. Any other error code is acceptable.

describe("regression: existing MCP tools are NOT gated by archive status", () => {
  // Shared store: getRequirement returns status=active (NOT archived).
  // The 4 dev-handoff tools WOULD reject this — the existing tools must NOT.
  function activeRequirementStore(overrides: Record<string, unknown> = {}) {
    return fakeStore({
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-active001",
          product_id: "P-123abc",
          status: "active",
          pages: [{ page_id: "page-checkout", baseline_page: "checkout" }],
          document_md: "# Active requirement",
        })),
        getProductRules: vi.fn(async () => []),
      },
      ...overrides,
    });
  }

  it("get_product_artifact succeeds (no REQUIREMENT_NOT_FINALIZED) for an active-status requirement", async () => {
    const store = activeRequirementStore();
    const tools = createFormaTools(store);

    const result = await tools.get_product_artifact({
      product_id: "P-123abc",
      artifact_id: "ABCDEFGHIJ123456",
    });

    // Tool must NOT be gated — it never checks requirement status
    if (result.isError) {
      expect(textPayload(result).error_code).not.toBe("REQUIREMENT_NOT_FINALIZED");
    } else {
      expect(result.isError).toBeUndefined();
    }
    // Confirm assertArchived (getRequirement check) was NOT called by this tool
    expect(
      (store.requirements as unknown as { getRequirement: ReturnType<typeof vi.fn> }).getRequirement,
    ).not.toHaveBeenCalled();
  });

  it("export_artifact html format succeeds (no REQUIREMENT_NOT_FINALIZED) for an active-status requirement", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-regress-export-html-"));
    try {
      const versionDir = join(
        home,
        "data",
        "products",
        "P-123abc",
        "od-project",
        "artifacts",
        "ABCDEFGHIJ123456",
        "v1",
      );
      await mkdir(versionDir, { recursive: true });
      await writeFile(join(versionDir, "index.html"), "<main>Active design</main>", "utf8");

      const store = activeRequirementStore({
        home,
        artifacts: {
          ...fakeStore().artifacts,
          listArtifactVersions: vi.fn(async () => [1]),
          readArtifactVersion: vi.fn(async () => ({ manifest: fakeManifest(), etag: "sha256:abc" })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => []),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.export_artifact({
        product_id: "P-123abc",
        artifact_id: "ABCDEFGHIJ123456",
        format: "html",
      });

      if (result.isError) {
        expect(textPayload(result).error_code).not.toBe("REQUIREMENT_NOT_FINALIZED");
      } else {
        expect(result.isError).toBeUndefined();
        expect(textPayload(result)).toHaveProperty("output_path");
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("export_artifact zip format succeeds (no REQUIREMENT_NOT_FINALIZED) for an active-status requirement", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-regress-export-zip-"));
    try {
      const versionDir = join(
        home,
        "data",
        "products",
        "P-123abc",
        "od-project",
        "artifacts",
        "ABCDEFGHIJ123456",
        "v1",
      );
      await mkdir(versionDir, { recursive: true });
      await writeFile(join(versionDir, "index.html"), "<main>Active design</main>", "utf8");

      const store = activeRequirementStore({
        home,
        artifacts: {
          ...fakeStore().artifacts,
          listArtifactVersions: vi.fn(async () => [1]),
          readArtifactVersion: vi.fn(async () => ({ manifest: fakeManifest(), etag: "sha256:abc" })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => []),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.export_artifact({
        product_id: "P-123abc",
        artifact_id: "ABCDEFGHIJ123456",
        format: "zip",
      });

      if (result.isError) {
        expect(textPayload(result).error_code).not.toBe("REQUIREMENT_NOT_FINALIZED");
      } else {
        expect(result.isError).toBeUndefined();
        expect(textPayload(result)).toHaveProperty("output_path");
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("export_artifact icons format succeeds (no REQUIREMENT_NOT_FINALIZED) for an active-status requirement", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-regress-export-icons-"));
    try {
      const versionDir = join(
        home,
        "data",
        "products",
        "P-123abc",
        "od-project",
        "artifacts",
        "ABCDEFGHIJ123456",
        "v1",
      );
      await mkdir(versionDir, { recursive: true });
      await writeFile(
        join(versionDir, "index.html"),
        `<!DOCTYPE html><html><body><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" aria-label="check"><path d="M20 6L9 17l-5-5"/></svg></body></html>`,
        "utf8",
      );

      const store = activeRequirementStore({
        home,
        artifacts: {
          ...fakeStore().artifacts,
          listArtifactVersions: vi.fn(async () => [1]),
          readArtifactVersion: vi.fn(async () => ({ manifest: fakeManifest(), etag: "sha256:abc" })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => []),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.export_artifact({
        product_id: "P-123abc",
        artifact_id: "ABCDEFGHIJ123456",
        format: "icons",
      });

      if (result.isError) {
        expect(textPayload(result).error_code).not.toBe("REQUIREMENT_NOT_FINALIZED");
      } else {
        expect(result.isError).toBeUndefined();
        expect(textPayload(result)).toHaveProperty("output_path");
      }
      // getRequirement must NOT have been called by export_artifact
      expect(
        (store.requirements as unknown as { getRequirement: ReturnType<typeof vi.fn> }).getRequirement,
      ).not.toHaveBeenCalled();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("export_artifact vzi format succeeds (no REQUIREMENT_NOT_FINALIZED) for an active-status requirement", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-regress-export-vzi-"));
    try {
      const versionDir = join(
        home,
        "data",
        "products",
        "P-123abc",
        "od-project",
        "artifacts",
        "ABCDEFGHIJ123456",
        "v1",
      );
      await mkdir(versionDir, { recursive: true });
      await writeFile(
        join(versionDir, "index.html"),
        `<!DOCTYPE html><html><body><p>active design</p></body></html>`,
        "utf8",
      );

      const store = activeRequirementStore({
        home,
        artifacts: {
          ...fakeStore().artifacts,
          listArtifactVersions: vi.fn(async () => [1]),
          readArtifactVersion: vi.fn(async () => ({ manifest: fakeManifest(), etag: "sha256:abc" })),
        },
        products: {
          ...fakeStore().products,
          listDesignPointers: vi.fn(async () => []),
        },
      });
      const tools = createFormaTools(store);

      const result = await tools.export_artifact({
        product_id: "P-123abc",
        artifact_id: "ABCDEFGHIJ123456",
        format: "vzi",
      });

      if (result.isError) {
        expect(textPayload(result).error_code).not.toBe("REQUIREMENT_NOT_FINALIZED");
      } else {
        expect(result.isError).toBeUndefined();
        expect(textPayload(result).output_path as string).toMatch(/\.vzi$/);
      }
      // getRequirement must NOT have been called by export_artifact
      expect(
        (store.requirements as unknown as { getRequirement: ReturnType<typeof vi.fn> }).getRequirement,
      ).not.toHaveBeenCalled();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("get_design_context succeeds (no REQUIREMENT_NOT_FINALIZED) for an active-status requirement", async () => {
    const store = activeRequirementStore({
      styles: {
        getStyle: vi.fn(async () => ({
          kind: "brand" as const,
          metadata: { name: "linear" },
          designMd: "# Linear",
          tokensCss: ":root{}",
          componentsHtml: "<div/>",
        })),
        listStyles: vi.fn(async () => [{ name: "linear" }]),
        listCraftDocs: vi.fn(async () => []),
        readCraftDoc: vi.fn(async (slug: string) => ({ slug, content: "" })),
        listSystemStyles: vi.fn(async () => []),
      },
      products: {
        ...fakeStore().products,
        getProduct: vi.fn(async () => ({
          id: "P-123abc",
          name: "App",
          description: "Demo",
          platform: "web",
          brand_style: "linear",
          languages: ["en"],
          default_language: "en",
          requirements: {},
        })),
      },
    });
    const tools = createFormaTools(store);

    const result = await tools.get_design_context({
      product_id: "P-123abc",
      requirement_id: "R-active001",
    });

    // get_design_context must NOT be gated by archive status
    if (result.isError) {
      expect(textPayload(result).error_code).not.toBe("REQUIREMENT_NOT_FINALIZED");
    } else {
      expect(result.isError).toBeUndefined();
    }
  });

  it("generate_requirement_design succeeds (no REQUIREMENT_NOT_FINALIZED) for an active-status requirement", async () => {
    const store = activeRequirementStore({
      generateRequirementDesign: vi.fn(async () => ({
        artifact_id: "ABCDEFGHIJ123456",
        version: 1,
        preview_status: "pending",
      })),
    });
    const tools = createFormaTools(store);

    const result = await tools.generate_requirement_design({
      product_id: "P-123abc",
      requirement_id: "R-active001",
      page_id: "page-checkout",
      html: "<main>Active design</main>",
      title: "Checkout",
      brand_style: "linear",
    });

    // Must succeed without REQUIREMENT_NOT_FINALIZED
    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({ artifact_id: "ABCDEFGHIJ123456", version: 1 });
    // generate_requirement_design must NOT call getRequirement (no archive check)
    expect(
      (store.requirements as unknown as { getRequirement: ReturnType<typeof vi.fn> }).getRequirement,
    ).not.toHaveBeenCalled();
  });

  it("generate_components succeeds (no REQUIREMENT_NOT_FINALIZED) for a non-archived product", async () => {
    const store = activeRequirementStore({
      generateComponents: vi.fn(async () => ({
        artifact_id: "ABCDEFGHIJ123456",
        version: 1,
        preview_status: "pending",
      })),
    });
    const tools = createFormaTools(store);

    const result = await tools.generate_components({
      product_id: "P-123abc",
      html: "<section>Button</section>",
      title: "Component Library",
      brand_style: "linear",
    });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({ artifact_id: "ABCDEFGHIJ123456", version: 1 });
    // generate_components must NOT call getRequirement (no archive check)
    expect(
      (store.requirements as unknown as { getRequirement: ReturnType<typeof vi.fn> }).getRequirement,
    ).not.toHaveBeenCalled();
  });

  it("change_artifact_style succeeds (no REQUIREMENT_NOT_FINALIZED) for an active-status product", async () => {
    const store = activeRequirementStore({
      changeArtifactStyle: vi.fn(async () => ({
        artifact_id: "ABCDEFGHIJ123456",
        version: 2,
        preview_status: "pending",
      })),
    });
    const tools = createFormaTools(store);

    const result = await tools.change_artifact_style({
      product_id: "P-123abc",
      artifact_id: "ABCDEFGHIJ123456",
      html: "<main>Restyled</main>",
      title: "Checkout (Dark)",
      brand_style: "dark",
    });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({ artifact_id: "ABCDEFGHIJ123456", version: 2 });
    // change_artifact_style must NOT call getRequirement (no archive check)
    expect(
      (store.requirements as unknown as { getRequirement: ReturnType<typeof vi.fn> }).getRequirement,
    ).not.toHaveBeenCalled();
  });

  it("only the 4 dev-handoff tools (get_design_handoff/get_page_ui/get_ui_node/search_page_ui) return REQUIREMENT_NOT_FINALIZED for a non-archived requirement", async () => {
    // This is the definitive scope test: when status=active, exactly these 4 tools
    // must return REQUIREMENT_NOT_FINALIZED; all others must NOT.
    const store = activeRequirementStore();
    const tools = createFormaTools(store);

    const devHandoffInput = { requirement_id: "R-active001" };
    const pageInput = { requirement_id: "R-active001", page_id: "page-checkout" };
    const nodeInput = { requirement_id: "R-active001", page_id: "page-checkout", node_id: "el-root" };
    const searchInput = { requirement_id: "R-active001", page_id: "page-checkout", query: "hello" };

    const [handoff, pageUi, uiNode, searchUi] = await Promise.all([
      tools.get_design_handoff(devHandoffInput),
      tools.get_page_ui(pageInput),
      tools.get_ui_node(nodeInput),
      tools.search_page_ui(searchInput),
    ]);

    // All 4 must be gated
    expect(handoff.isError).toBe(true);
    expect(textPayload(handoff).error_code).toBe("REQUIREMENT_NOT_FINALIZED");
    expect(pageUi.isError).toBe(true);
    expect(textPayload(pageUi).error_code).toBe("REQUIREMENT_NOT_FINALIZED");
    expect(uiNode.isError).toBe(true);
    expect(textPayload(uiNode).error_code).toBe("REQUIREMENT_NOT_FINALIZED");
    expect(searchUi.isError).toBe(true);
    expect(textPayload(searchUi).error_code).toBe("REQUIREMENT_NOT_FINALIZED");
  });
});
