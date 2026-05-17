import { FormaError } from "@xenonbyte/forma-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer, type FormaServer } from "../src/app.js";

const apps: FormaServer[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function fakeStore(overrides: Record<string, unknown> = {}) {
  const baseStore = {
    home: "/tmp/forma",
    baseline: {
      getProductBaseline: vi.fn(async () => ({
        product_id: "P-123abc",
        pages: [
          {
            id: "checkout",
            name: "Checkout",
            features: "Checkout flow",
            copy: "",
            fields: "",
            interactions: "",
            source_requirements: ["R-12345678"]
          }
        ],
        navigation: []
      }))
    },
    designs: {
      diffDesigns: vi.fn(async () => ({ added: [], removed: [], modified: [] })),
      exportDesignAsset: vi.fn(async () => ({
        design_id: "D-12345678",
        node_id: "root",
        format: "png",
        path: "/tmp/root.png",
        source: "preview"
      })),
      getDesignAnnotations: vi.fn(async () => [{ id: "root", name: "Root", type: "frame", x: 0, y: 0, width: 100, height: 100 }])
    },
    products: {
      createProduct: vi.fn(async () => ({ id: "P-123abc", name: "App", description: "Demo" })),
      getProduct: vi.fn(async () => ({ id: "P-123abc", name: "App", description: "Demo" })),
      listProducts: vi.fn(async () => [{ id: "P-123abc", name: "App", description: "Demo" }])
    },
    requirements: {
      archiveRequirement: vi.fn(async () => ({ id: "R-12345678", status: "archived" })),
      createEmptyRequirement: vi.fn(async () => ({ id: "R-12345678", status: "empty" })),
      getRequirement: vi.fn(async () => ({ id: "R-12345678", product_id: "P-123abc", pages: [], document_md: "# Requirement" })),
      getRequirementHistory: vi.fn(async () => [
        {
          id: "R-12345678",
          product_id: "P-123abc",
          created_at: "2026-05-17T00:00:00.000Z",
          updated_at: "2026-05-17T00:00:00.000Z",
          pages: [
            {
              page_id: "checkout-page",
              baseline_page: "checkout",
              design_status: "done",
              design_id: "D-12345678"
            }
          ]
        }
      ]),
      submitRequirement: vi.fn(async () => ({ id: "R-12345678", status: "submitted" }))
    },
    sessions: {
      getCurrentSession: vi.fn(async () => ({ current_product: "P-123abc" }))
    },
    styles: {
      getStyle: vi.fn(async () => ({
        metadata: {
          name: "linear",
          description: "Focused tool UI",
          design_md_path: "styles/linear/DESIGN.md",
          variables: {
            primary: "#111827",
            background: "#ffffff",
            "text-primary": "#111827",
            "font-heading": "Inter",
            "font-body": "Inter",
            "border-radius": "8px",
            "spacing-unit": "8px"
          }
        },
        designMd: "# Linear"
      })),
      listStyles: vi.fn(async () => [{ name: "linear", description: "Focused tool UI" }])
    }
  };

  return {
    ...baseStore,
    ...overrides
  };
}

async function appWith(store = fakeStore()) {
  const app = buildServer({ store: store as never });
  apps.push(app);
  await app.ready();
  return app;
}

describe("Fastify API routes", () => {
  it("registers representative product, style, annotation, and diff routes", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const products = await app.inject({ method: "GET", url: "/api/products" });
    const created = await app.inject({
      method: "POST",
      url: "/api/products",
      payload: { name: "App", description: "Demo" }
    });
    const style = await app.inject({ method: "GET", url: "/api/styles/linear" });
    const annotations = await app.inject({ method: "GET", url: "/api/designs/D-12345678/annotations" });
    const diff = await app.inject({ method: "GET", url: "/api/designs/D-12345678/diff?v1=1&v2=2" });

    expect(products.statusCode).toBe(200);
    expect(products.json()).toEqual([{ id: "P-123abc", name: "App", description: "Demo" }]);
    expect(created.statusCode).toBe(200);
    expect(style.statusCode).toBe(200);
    expect(annotations.statusCode).toBe(200);
    expect(diff.statusCode).toBe(200);
    expect(diff.json()).toMatchObject({
      added: [],
      removed: [],
      modified: [],
      visual: {
        from_image_url: "/api/designs/D-12345678/image?version=1",
        to_image_url: "/api/designs/D-12345678/image?version=2"
      }
    });
    expect(store.products.createProduct).toHaveBeenCalledWith({ name: "App", description: "Demo" });
    expect(store.designs.diffDesigns).toHaveBeenCalledWith("D-12345678", 1, 2);
  });

  it("exposes all required route families and keeps style sync absent", async () => {
    const app = await appWith();

    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/api/products/P-123abc" }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/requirements" }),
      app.inject({
        method: "POST",
        url: "/api/products/P-123abc/requirements",
        payload: { title: "Checkout", document_md: "# Checkout", pages: [{ page_id: "checkout-page", name: "Checkout", baseline_page: "checkout" }], navigation: [] }
      }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/requirements/R-12345678" }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/baseline" }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/baseline/pages/checkout/image" }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/baseline/pages/checkout/annotations" }),
      app.inject({ method: "GET", url: "/api/designs/D-12345678/image?version=1" }),
      app.inject({ method: "GET", url: "/api/designs/D-12345678/history" }),
      app.inject({ method: "GET", url: "/api/designs/D-12345678/export?node_id=root&format=png" }),
      app.inject({ method: "GET", url: "/api/styles" }),
      app.inject({ method: "GET", url: "/api/styles/linear/preview" })
    ]);
    const styleSync = await app.inject({ method: "POST", url: "/api/styles/sync" });

    expect(responses.map((response) => response.statusCode)).toEqual(Array(responses.length).fill(200));
    expect(styleSync.statusCode).toBe(404);
  });

  it("maps requirement archive invalid status to 409", async () => {
    const app = await appWith(
      fakeStore({
        requirements: {
          ...fakeStore().requirements,
          archiveRequirement: vi.fn(async () => {
            throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
              requirement_id: "R-12345678",
              status: "submitted"
            });
          })
        }
      })
    );

    const response = await app.inject({ method: "PUT", url: "/api/products/P-123abc/requirements/R-12345678/archive" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error_code: "REQUIREMENT_STATUS_INVALID",
      message: "Requirement status invalid",
      details: { requirement_id: "R-12345678", status: "submitted" }
    });
  });

  it("maps not found, invalid input, and Pencil unavailable errors", async () => {
    const store = fakeStore({
      products: {
        ...fakeStore().products,
        getProduct: vi.fn(async () => {
          throw new FormaError("PRODUCT_NOT_FOUND", "Product not found", { product_id: "P-missing" });
        })
      },
      designs: {
        ...fakeStore().designs,
        getDesignAnnotations: vi.fn(async () => {
          throw new FormaError("PENCIL_CLI_NOT_FOUND", "Pencil CLI not found");
        })
      }
    });
    const app = await appWith(store);

    const notFound = await app.inject({ method: "GET", url: "/api/products/P-missing" });
    const invalidBody = await app.inject({ method: "POST", url: "/api/products", payload: { name: "Missing description" } });
    const invalidQuery = await app.inject({ method: "GET", url: "/api/designs/D-12345678/diff?v1=1" });
    const pencilUnavailable = await app.inject({ method: "GET", url: "/api/designs/D-12345678/annotations" });

    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toMatchObject({ error_code: "PRODUCT_NOT_FOUND" });
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.json()).toMatchObject({ error_code: "INVALID_INPUT" });
    expect(invalidQuery.statusCode).toBe(400);
    expect(invalidQuery.json()).toMatchObject({ error_code: "INVALID_INPUT" });
    expect(pencilUnavailable.statusCode).toBe(503);
    expect(pencilUnavailable.json()).toMatchObject({ error_code: "PENCIL_CLI_NOT_FOUND" });
  });

  it("hides unexpected errors behind a safe 500 payload", async () => {
    const app = await appWith(
      fakeStore({
        products: {
          ...fakeStore().products,
          listProducts: vi.fn(async () => {
            throw new Error("database path with private details");
          })
        }
      })
    );

    const response = await app.inject({ method: "GET", url: "/api/products" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error_code: "INTERNAL_ERROR",
      message: "Unexpected server error",
      details: {}
    });
  });
});
