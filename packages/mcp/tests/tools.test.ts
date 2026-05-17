import { FormaError } from "@xenonbyte/forma-core";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFormaTools, formaToolNames, registerFormaTools } from "../src/index.js";

function textPayload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]!.text);
}

function fakeStore(overrides: Record<string, unknown> = {}) {
  const store = {
    home: "/tmp/forma",
    baseline: {
      getProductBaseline: vi.fn(async () => ({ product_id: "P-123abc", pages: [], navigation: [] }))
    },
    designs: {
      saveDesigns: vi.fn(async () => [{ id: "D-12345678" }]),
      rollbackDesign: vi.fn(async () => ({ id: "D-12345678", version: 1 })),
      diffDesigns: vi.fn(async () => ({ added: [], removed: [], changed: [] })),
      getDesignAnnotations: vi.fn(async () => [{ id: "root", type: "frame" }]),
      exportDesignAsset: vi.fn(async () => ({ design_id: "D-12345678", node_id: "root", format: "png", path: "/tmp/root.png" }))
    },
    products: {
      createProduct: vi.fn(async () => ({ id: "P-123abc", name: "App", description: "Demo" })),
      getProduct: vi.fn(async () => ({ id: "P-123abc", name: "App", description: "Demo" })),
      initProductConfig: vi.fn(async () => ({ id: "P-123abc", platform: "web" })),
      listProducts: vi.fn(async () => [{ id: "P-123abc", name: "App", description: "Demo" }]),
      markComponentsInitialized: vi.fn(async () => ({ id: "P-123abc", components_initialized: true }))
    },
    requirements: {
      createEmptyRequirement: vi.fn(async () => ({ id: "R-12345678", status: "empty" })),
      getRequirement: vi.fn(async () => ({ id: "R-12345678", pages: [] })),
      getRequirementHistory: vi.fn(async () => []),
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

describe("MCP forma tools", () => {
  it("exposes and registers every v0.1 tool", () => {
    const tools = createFormaTools(fakeStore());
    const server = { registerTool: vi.fn() };

    registerFormaTools(server, tools);

    expect(Object.keys(tools)).toEqual(formaToolNames);
    expect(server.registerTool).toHaveBeenCalledTimes(24);
    expect(server.registerTool.mock.calls.map((call) => call[0])).toEqual(formaToolNames);
    expect(server.registerTool.mock.calls.map((call) => call[1])).toEqual(
      expect.arrayContaining([expect.objectContaining({ inputSchema: expect.any(Object) })])
    );
    expect(formaToolNames).toContain("diff_designs");
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

  it("delegates representative tools to core and injected services", async () => {
    const store = fakeStore();
    const pencil = {
      generatePageDesign: vi.fn(async () => ({ tempDir: "/tmp/page", penPath: "/tmp/page/page.pen", previewPath: "/tmp/page/preview.png" })),
      generateComponents: vi.fn(async () => ({ tempDir: "/tmp/components", penPath: "/tmp/components/components.lib.pen" }))
    };
    const tools = createFormaTools(store, { pencil });

    await tools.save_designs({
      requirement_id: "R-12345678",
      designs: [{ page_id: "page-1", pen_path: "/tmp/page.pen", preview_path: "/tmp/preview.png", mode: "generate" }]
    });
    await tools.rollback_design({ design_id: "D-12345678" });
    await tools.diff_designs({ design_id: "D-12345678", v1: 1, v2: 2 });
    await tools.generate_page_design({ product_id: "P-123abc", prompt: "Create checkout", workspace: "/tmp/workspace" });
    await tools.get_design_annotations({ design_id: "D-12345678" });

    expect(store.designs.saveDesigns).toHaveBeenCalledWith("R-12345678", [
      { page_id: "page-1", penPath: "/tmp/page.pen", previewPath: "/tmp/preview.png", mode: "generate" }
    ]);
    expect(store.designs.rollbackDesign).toHaveBeenCalledWith("D-12345678");
    expect(store.designs.diffDesigns).toHaveBeenCalledWith("D-12345678", 1, 2);
    expect(pencil.generatePageDesign).toHaveBeenCalledWith({
      product_id: "P-123abc",
      prompt: "Create checkout",
      workspace: "/tmp/workspace"
    });
    expect(store.designs.getDesignAnnotations).toHaveBeenCalledWith("D-12345678");
  });

  it("init_product_config updates config for an existing product and does not create products", async () => {
    const store = fakeStore();
    const tools = createFormaTools(store);
    const style = {
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

    await tools.init_product_config({ product_id: "P-123abc", platform: "web", style });

    expect(store.products.initProductConfig).toHaveBeenCalledWith("P-123abc", { platform: "web", style });
    expect(store.products.createProduct).not.toHaveBeenCalled();
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

  it("get_baseline_image finds a preview from a non-latest source requirement", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-baseline-"));
    const previewPath = join(home, "data", "P-123abc", "R-old1111", "D-old1111", "preview@2x.png");
    await mkdir(dirname(previewPath), { recursive: true });
    await writeFile(previewPath, "preview");
    const store = fakeStore({
      home,
      baseline: {
        getProductBaseline: vi.fn(async () => ({
          product_id: "P-123abc",
          pages: [{
            id: "checkout",
            name: "Checkout",
            features: "",
            copy: "",
            fields: "",
            interactions: "",
            source_requirements: ["R-old1111", "R-new2222"]
          }],
          navigation: []
        }))
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-latest1",
          created_at: "2026-05-17T03:00:00.000Z",
          pages: [{ page_id: "latest-page", baseline_page: "profile", design_status: "done", design_id: "D-latest1" }]
        })),
        getRequirementHistory: vi.fn(async () => [
          {
            id: "R-old1111",
            created_at: "2026-05-17T01:00:00.000Z",
            updated_at: "2026-05-17T01:00:00.000Z",
            pages: [{ page_id: "old-page", baseline_page: "checkout", design_status: "done", design_id: "D-old1111" }]
          },
          {
            id: "R-new2222",
            created_at: "2026-05-17T02:00:00.000Z",
            updated_at: "2026-05-17T02:00:00.000Z",
            pages: [{ page_id: "new-page", baseline_page: "checkout", design_status: "pending" }]
          },
          {
            id: "R-latest1",
            created_at: "2026-05-17T03:00:00.000Z",
            updated_at: "2026-05-17T03:00:00.000Z",
            pages: [{ page_id: "latest-page", baseline_page: "profile", design_status: "done", design_id: "D-latest1" }]
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
      requirement_id: "R-old1111",
      requirement_page_id: "old-page",
      design_id: "D-old1111",
      preview_path: previewPath
    });
    expect(store.requirements.getRequirement).not.toHaveBeenCalled();
  });

  it("get_baseline_image does not use unrelated latest requirement page_id collisions", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-baseline-"));
    const collidingPreviewPath = join(home, "data", "P-123abc", "R-latest1", "D-wrong11", "preview@2x.png");
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
            copy: "",
            fields: "",
            interactions: "",
            source_requirements: ["R-old1111"]
          }],
          navigation: []
        }))
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-latest1",
          created_at: "2026-05-17T03:00:00.000Z",
          pages: [{ page_id: "checkout", baseline_page: "profile", design_status: "done", design_id: "D-wrong11" }]
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
            pages: [{ page_id: "checkout", baseline_page: "profile", design_status: "done", design_id: "D-wrong11" }]
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
