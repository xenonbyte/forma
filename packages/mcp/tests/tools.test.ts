import { FormaError } from "@xenonbyte/forma-core";
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
});
