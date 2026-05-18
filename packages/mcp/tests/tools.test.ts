import { FormaError } from "@xenonbyte/forma-core";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFormaTools, formaToolNames, registerFormaTools } from "../src/index.js";

function textPayload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]!.text);
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
    baseline: {
      getProductBaseline: vi.fn(async () => ({ product_id: "P-123abc", pages: [], navigation: [] }))
    },
    designs: {
      saveDesigns: vi.fn(async () => [{ id: "D-12345678" }]),
      rollbackDesign: vi.fn(async () => ({ id: "D-12345678", version: 1 })),
      diffDesigns: vi.fn(async () => ({ added: [], removed: [], changed: [] })),
      getDesignAnnotations: vi.fn(async () => [{ id: "root", type: "frame" }]),
      getDesignMetadata: vi.fn(async (designId: string) => ({
        id: designId,
        pen_path: `/tmp/forma/designs/${designId}/design.pen`,
        preview_path: `/tmp/forma/designs/${designId}/preview@2x.png`,
        version: 1,
        created_at: "2026-05-17T00:00:00.000Z",
        updated_at: "2026-05-17T00:00:00.000Z"
      })),
      exportDesignAsset: vi.fn(async () => ({ design_id: "D-12345678", node_id: "root", format: "png", path: "/tmp/root.png" }))
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
        default_language: "en",
        components_initialized: true
      })),
      initProductConfig: vi.fn(async (_productId, config) => ({ id: "P-123abc", ...config })),
      listProducts: vi.fn(async () => [{ id: "P-123abc", name: "App", description: "Demo" }]),
      markComponentsInitialized: vi.fn(async () => ({ id: "P-123abc", components_initialized: true }))
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

describe("MCP forma tools", () => {
  it("exposes and registers every v0.3 tool contract", () => {
    const tools = createFormaTools(fakeStore());
    const server = { registerTool: vi.fn() };

    registerFormaTools(server, tools);

    expect(Object.keys(tools)).toEqual(formaToolNames);
    expect(server.registerTool).toHaveBeenCalledTimes(26);
    expect(server.registerTool.mock.calls.map((call) => call[0])).toEqual(formaToolNames);
    expect(server.registerTool.mock.calls.map((call) => call[1])).toEqual(
      expect.arrayContaining([expect.objectContaining({ inputSchema: expect.any(Object) })])
    );
    expect(formaToolNames).not.toContain("submit_requirement");
    expect(formaToolNames).not.toContain("update_requirement");
    expect(formaToolNames).toEqual(expect.arrayContaining([
      "save_requirement",
      "get_product_rules",
      "get_page_copy",
      "update_page_copy"
    ]));
    expect(formaToolNames).toContain("diff_designs");
  });

  it("help includes usage guidance", async () => {
    const tools = createFormaTools(fakeStore());

    const result = await tools.help({});

    expect(textPayload(result)).toMatchObject({
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
            "get_design_annotations",
            "export_design_asset",
            "get_product_rules"
          ]
        }
      }
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

  it("gates page design generation on languages and initialized components", async () => {
    const pencil = {
      generatePageDesign: vi.fn(async () => ({ tempDir: "/tmp/page", penPath: "/tmp/page/page.pen", previewPath: "/tmp/page/preview.png" })),
      generateComponents: vi.fn(async () => ({ tempDir: "/tmp/components", penPath: "/tmp/components/components.lib.pen" }))
    };
    const store = fakeStore({
      products: {
        ...fakeStore().products,
        getProduct: vi.fn(async () => ({ id: "P-123abc", name: "App", description: "Demo", platform: "web", style: { name: "linear" } }))
      }
    });
    const tools = createFormaTools(store, { pencil });

    const result = await tools.generate_page_design({ product_id: "P-123abc", prompt: "Create checkout", workspace: "/tmp/workspace" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({
      error_code: "PRODUCT_CONFIG_INCOMPLETE",
      details: { product_id: "P-123abc", missing: ["languages", "components_initialized"] }
    });
    expect(pencil.generatePageDesign).not.toHaveBeenCalled();
  });

  it("gates component generation on languages but not initialized components", async () => {
    const pencil = {
      generatePageDesign: vi.fn(async () => ({ tempDir: "/tmp/page", penPath: "/tmp/page/page.pen", previewPath: "/tmp/page/preview.png" })),
      generateComponents: vi.fn(async () => ({ tempDir: "/tmp/components", penPath: "/tmp/components/components.lib.pen" }))
    };
    const store = fakeStore({
      products: {
        ...fakeStore().products,
        getProduct: vi.fn(async () => ({ id: "P-123abc", name: "App", description: "Demo", platform: "web" }))
      }
    });
    const tools = createFormaTools(store, { pencil });

    const missingLanguages = await tools.generate_components({ product_id: "P-123abc", prompt: "Create controls", workspace: "/tmp/workspace" });

    expect(missingLanguages.isError).toBe(true);
    expect(textPayload(missingLanguages)).toMatchObject({
      error_code: "PRODUCT_CONFIG_INCOMPLETE",
      details: { product_id: "P-123abc", missing: ["style", "languages"] }
    });
    expect(pencil.generateComponents).not.toHaveBeenCalled();

    store.products.getProduct.mockResolvedValueOnce({
      id: "P-123abc",
      name: "App",
      description: "Demo",
      platform: "web",
      style: { name: "linear" },
      languages: ["en"],
      default_language: "en"
    });

    const withoutComponentsInitialized = await tools.generate_components({
      product_id: "P-123abc",
      prompt: "Create controls",
      workspace: "/tmp/workspace"
    });

    expect(withoutComponentsInitialized.isError).toBeUndefined();
    expect(pencil.generateComponents).toHaveBeenCalledWith({
      product_id: "P-123abc",
      prompt: "Create controls",
      workspace: "/tmp/workspace"
    });
  });

  it("complete_product_init fails when no component library was persisted", async () => {
    const store = fakeStore({
      products: {
        ...fakeStore().products,
        markComponentsInitialized: vi.fn(async () => {
          throw new FormaError("PRODUCT_CONFIG_INCOMPLETE", "Product config incomplete", {
            product_id: "P-123abc",
            missing: ["components_library"]
          });
        })
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.complete_product_init({ product_id: "P-123abc" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({
      error_code: "PRODUCT_CONFIG_INCOMPLETE",
      details: { missing: ["components_library"] }
    });
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

  it("get_requirement includes copy translations and page design metadata", async () => {
    const translations = [{
      page_id: "checkout",
      entries: [{ context: "submit", texts: { "zh-CN": "立即支付" } }]
    }];
    const metadata = {
      id: "D-12345678",
      pen_path: "/tmp/design.pen",
      preview_path: "/tmp/preview@2x.png",
      version: 2,
      created_at: "2026-05-17T00:00:00.000Z",
      updated_at: "2026-05-17T01:00:00.000Z"
    };
    const store = fakeStore({
      copy: {
        ...fakeStore().copy,
        getTranslations: vi.fn(async () => translations)
      },
      designs: {
        ...fakeStore().designs,
        getDesignMetadata: vi.fn(async () => metadata)
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-12345678",
          product_id: "P-123abc",
          pages: [
            { page_id: "checkout", baseline_page: "checkout", design_id: "D-12345678" },
            { page_id: "profile", baseline_page: "profile" }
          ]
        }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_requirement({ requirement_id: "R-12345678" });

    expect(store.copy.getTranslations).toHaveBeenCalledWith("P-123abc", "R-12345678");
    expect(store.designs.getDesignMetadata).toHaveBeenCalledWith("D-12345678");
    expect(textPayload(result)).toMatchObject({
      id: "R-12345678",
      copy_translations: translations,
      pages: [
        { page_id: "checkout", design_metadata: metadata },
        { page_id: "profile" }
      ]
    });
  });

  it("get_requirement returns structured errors for unexpected design metadata failures", async () => {
    const store = fakeStore({
      designs: {
        ...fakeStore().designs,
        getDesignMetadata: vi.fn(async () => {
          throw new FormaError("HISTORY_FILE_MISSING", "Design history is missing", { design_id: "D-12345678" });
        })
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-12345678",
          product_id: "P-123abc",
          pages: [{ page_id: "checkout", baseline_page: "checkout", design_id: "D-12345678" }]
        }))
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_requirement({ requirement_id: "R-12345678" });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toEqual({
      error_code: "HISTORY_FILE_MISSING",
      message: "Design history is missing",
      details: { design_id: "D-12345678" }
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
            copy: [],
            fields: "",
            interactions: "",
            source_requirements: ["R-old1111", "R-new2222"]
          }],
          navigation: []
        }))
      },
      designs: {
        ...fakeStore().designs,
        getDesignMetadata: vi.fn(async (designId: string) => ({
          id: designId,
          pen_path: join(dirname(previewPath), "design.pen"),
          preview_path: previewPath,
          version: 1,
          created_at: "2026-05-17T01:00:00.000Z",
          updated_at: "2026-05-17T01:00:00.000Z"
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

  it("get_baseline_image returns existing preview metadata for an expired baseline page design", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-baseline-"));
    const metadataPreviewPath = join(home, "designs", "D-expired", "preview@2x.png");
    await mkdir(dirname(metadataPreviewPath), { recursive: true });
    await writeFile(metadataPreviewPath, "preview");
    const metadata = {
      id: "D-expired",
      pen_path: join(dirname(metadataPreviewPath), "design.pen"),
      preview_path: metadataPreviewPath,
      version: 3,
      created_at: "2026-05-17T00:00:00.000Z",
      updated_at: "2026-05-17T02:00:00.000Z"
    };
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
            source_requirements: ["R-old1111"]
          }],
          navigation: []
        }))
      },
      designs: {
        ...fakeStore().designs,
        getDesignMetadata: vi.fn(async () => metadata)
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirementHistory: vi.fn(async () => [{
          id: "R-old1111",
          created_at: "2026-05-17T01:00:00.000Z",
          updated_at: "2026-05-17T01:00:00.000Z",
          pages: [{ page_id: "checkout-page", baseline_page: "checkout", design_status: "expired", design_id: "D-expired" }]
        }])
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_baseline_image({ product_id: "P-123abc", page_id: "checkout" });

    expect(store.designs.getDesignMetadata).toHaveBeenCalledWith("D-expired");
    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toEqual({
      product_id: "P-123abc",
      baseline_page_id: "checkout",
      requirement_id: "R-old1111",
      requirement_page_id: "checkout-page",
      design_id: "D-expired",
      preview_path: metadata.preview_path
    });
  });

  it("get_baseline_image falls back to deterministic preview when metadata path is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-mcp-baseline-"));
    const legacyPreviewPath = join(home, "data", "P-123abc", "R-old2222", "D-a1b2c3d4", "preview@2x.png");
    await mkdir(dirname(legacyPreviewPath), { recursive: true });
    await writeFile(legacyPreviewPath, "preview");
    const metadataPreviewPath = join(home, "metadata-missing", "preview@2x.png");
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
            source_requirements: ["R-old2222"]
          }],
          navigation: []
        }))
      },
      designs: {
        ...fakeStore().designs,
        getDesignMetadata: vi.fn(async () => ({
          id: "D-a1b2c3d4",
          pen_path: join(dirname(metadataPreviewPath), "design.pen"),
          preview_path: metadataPreviewPath,
          version: 1,
          created_at: "2026-05-17T01:00:00.000Z",
          updated_at: "2026-05-17T01:00:00.000Z"
        }))
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirementHistory: vi.fn(async () => [{
          id: "R-old2222",
          created_at: "2026-05-17T01:00:00.000Z",
          updated_at: "2026-05-17T01:00:00.000Z",
          pages: [{ page_id: "checkout-page", baseline_page: "checkout", design_status: "expired", design_id: "D-a1b2c3d4" }]
        }])
      }
    });
    const tools = createFormaTools(store);

    const result = await tools.get_baseline_image({ product_id: "P-123abc", page_id: "checkout" });

    expect(result.isError).toBeUndefined();
    expect(textPayload(result)).toMatchObject({
      product_id: "P-123abc",
      requirement_id: "R-old2222",
      requirement_page_id: "checkout-page",
      design_id: "D-a1b2c3d4",
      preview_path: legacyPreviewPath
    });
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
            copy: [],
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
