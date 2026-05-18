import { FormaError } from "@xenonbyte/forma-core";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

async function webAssetsDir() {
  const root = await mkdtemp(join(tmpdir(), "forma-web-assets-"));
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), "<!doctype html><main id=\"root\">Forma Web</main>", "utf8");
  await writeFile(join(root, "assets", "app.js"), "console.log('forma');", "utf8");
  return root;
}

async function homeWithPreview(files: string[] = ["preview@2x.png", "preview.v1@2x.png"]) {
  const home = await mkdtemp(join(tmpdir(), "forma-server-routes-"));
  await writeDesignYaml(home, { version: 1, history: [] });
  for (const file of files) {
    const previewPath = join(home, "data", "P-123abc", "R-12345678", "D-12345678", file);
    await mkdir(dirname(previewPath), { recursive: true });
    await writeFile(previewPath, "preview");
  }
  return home;
}

async function homeWithStylePreview() {
  const home = await mkdtemp(join(tmpdir(), "forma-server-routes-"));
  const previewPath = join(home, "styles", "linear", "preview@2x.png");
  await mkdir(dirname(previewPath), { recursive: true });
  await writeFile(previewPath, "style preview");
  return home;
}

async function homeWithTwoVersionDesign() {
  const home = await mkdtemp(join(tmpdir(), "forma-server-routes-"));
  await writeDesignYaml(home, {
    version: 2,
    history: [
      {
        version: 1,
        file: "design.v1.pen",
        preview_file: "preview.v1@2x.png",
        created_at: "2026-05-17T01:00:00.000Z"
      }
    ]
  });
  await writeDesignFile(home, "preview.v1@2x.png", "old preview");
  await writeDesignFile(home, "preview@2x.png", "current preview");
  return home;
}

async function writeDesignYaml(home: string, input: { version: number; history: unknown[] }) {
  await writeDesignFile(
    home,
    "design.yaml",
    JSON.stringify({
      id: "D-12345678",
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout-page",
      version: input.version,
      created_at: "2026-05-17T00:00:00.000Z",
      updated_at: "2026-05-17T02:00:00.000Z",
      history: input.history
    })
  );
}

async function writeDesignFile(home: string, file: string, content: string) {
  const filePath = join(home, "data", "P-123abc", "R-12345678", "D-12345678", file);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

describe("Fastify API routes", () => {
  it("serves packaged Web assets and falls back to the SPA for app routes", async () => {
    const app = buildServer({ store: fakeStore() as never, webAssetsDir: await webAssetsDir() });
    apps.push(app);
    await app.ready();

    const appRoute = await app.inject({ method: "GET", url: "/products" });
    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    const assetHead = await app.inject({ method: "HEAD", url: "/assets/app.js" });
    const missingAssetWithoutExtension = await app.inject({ method: "GET", url: "/assets/missing" });
    const missingAsset = await app.inject({ method: "GET", url: "/assets/missing.js" });
    const traversalAsset = await app.inject({ method: "GET", url: "/..%2Fsecret.txt" });
    const favicon = await app.inject({ method: "GET", url: "/favicon.ico" });
    const apiRootNotFound = await app.inject({ method: "GET", url: "/api" });
    const apiRootWithQueryNotFound = await app.inject({ method: "GET", url: "/api?x=1" });
    const apiRootHeadNotFound = await app.inject({ method: "HEAD", url: "/api" });
    const apiNotFound = await app.inject({ method: "GET", url: "/api/missing" });

    expect(appRoute.statusCode).toBe(200);
    expect(appRoute.headers["content-type"]).toContain("text/html");
    expect(appRoute.body).toContain("Forma Web");
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("text/javascript");
    expect(asset.body).toContain("forma");
    expect(assetHead.statusCode).toBe(200);
    expect(assetHead.headers["content-type"]).toContain("text/javascript");
    expect(assetHead.body).toBe("");
    expect(missingAsset.statusCode).toBe(404);
    expect(missingAsset.headers["content-type"]).toContain("application/json");
    expect(missingAsset.json()).toMatchObject({ error_code: "NOT_FOUND" });
    expect(missingAssetWithoutExtension.statusCode).toBe(404);
    expect(missingAssetWithoutExtension.headers["content-type"]).toContain("application/json");
    expect(missingAssetWithoutExtension.json()).toMatchObject({ error_code: "NOT_FOUND" });
    expect(traversalAsset.statusCode).toBe(404);
    expect(traversalAsset.headers["content-type"]).toContain("application/json");
    expect(traversalAsset.json()).toMatchObject({ error_code: "NOT_FOUND" });
    expect(favicon.statusCode).toBe(204);
    expect(apiRootNotFound.statusCode).toBe(404);
    expect(apiRootNotFound.headers["content-type"]).toContain("application/json");
    expect(apiRootNotFound.json()).toMatchObject({ error_code: "NOT_FOUND" });
    expect(apiRootWithQueryNotFound.statusCode).toBe(404);
    expect(apiRootWithQueryNotFound.headers["content-type"]).toContain("application/json");
    expect(apiRootWithQueryNotFound.json()).toMatchObject({ error_code: "NOT_FOUND" });
    expect(apiRootHeadNotFound.statusCode).toBe(404);
    expect(apiRootHeadNotFound.headers["content-type"]).toContain("application/json");
    expect(apiNotFound.statusCode).toBe(404);
    expect(apiNotFound.json()).toMatchObject({ error_code: "NOT_FOUND" });
  });

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
        from_image_url: "/api/designs/D-12345678/image/file?version=1",
        to_image_url: "/api/designs/D-12345678/image/file?version=2"
      }
    });
    expect(store.products.createProduct).toHaveBeenCalledWith({ name: "App", description: "Demo" });
    expect(store.designs.diffDesigns).toHaveBeenCalledWith("D-12345678", 1, 2);
  });

  it("exposes all required route families and keeps style sync absent", async () => {
    const home = await homeWithPreview();
    const app = await appWith(fakeStore({ home }));

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
      app.inject({ method: "GET", url: "/api/designs/D-12345678/image/file?version=1" }),
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

  it("returns submitted requirement with document from create requirement route", async () => {
    const requirements = {
      ...fakeStore().requirements,
      createEmptyRequirement: vi.fn(async () => ({ id: "R-12345678", status: "empty" })),
      getRequirement: vi.fn(async () => ({
        id: "R-12345678",
        product_id: "P-123abc",
        title: "Checkout",
        status: "submitted",
        created_at: "2026-05-17T00:00:00.000Z",
        updated_at: "2026-05-17T00:00:00.000Z",
        pages: [],
        navigation: [],
        document_md: "# Checkout"
      })),
      submitRequirement: vi.fn(async () => ({ id: "R-12345678", status: "submitted" }))
    };
    const app = await appWith(fakeStore({ requirements }));

    const response = await app.inject({
      method: "POST",
      url: "/api/products/P-123abc/requirements",
      payload: { title: "Checkout", document_md: "# Checkout", pages: [{ page_id: "checkout-page", name: "Checkout", baseline_page: "checkout" }], navigation: [] }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: "R-12345678", status: "submitted", document_md: "# Checkout" });
    expect(requirements.getRequirement).toHaveBeenCalledWith({ requirement_id: "R-12345678" });
  });

  it("returns archived requirement with document from archive route", async () => {
    const requirements = {
      ...fakeStore().requirements,
      archiveRequirement: vi.fn(async () => ({ id: "R-12345678", status: "archived" })),
      getRequirement: vi
        .fn()
        .mockResolvedValueOnce({
          id: "R-12345678",
          product_id: "P-123abc",
          title: "Checkout",
          status: "active",
          created_at: "2026-05-17T00:00:00.000Z",
          updated_at: "2026-05-17T00:00:00.000Z",
          pages: [],
          navigation: [],
          document_md: "# Checkout"
        })
        .mockResolvedValueOnce({
          id: "R-12345678",
          product_id: "P-123abc",
          title: "Checkout",
          status: "archived",
          created_at: "2026-05-17T00:00:00.000Z",
          updated_at: "2026-05-17T00:00:00.000Z",
          pages: [],
          navigation: [],
          document_md: "# Checkout"
        })
    };
    const app = await appWith(fakeStore({ requirements }));

    const response = await app.inject({ method: "PUT", url: "/api/products/P-123abc/requirements/R-12345678/archive" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: "R-12345678", status: "archived", document_md: "# Checkout" });
    expect(requirements.archiveRequirement).toHaveBeenCalledWith("R-12345678");
    expect(requirements.getRequirement).toHaveBeenLastCalledWith({ requirement_id: "R-12345678" });
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

  it("returns 404 for cross-product requirement read and archive routes", async () => {
    const requirements = {
      ...fakeStore().requirements,
      archiveRequirement: vi.fn(async () => ({ id: "R-12345678", product_id: "P-other1", status: "archived" })),
      getRequirement: vi.fn(async () => ({ id: "R-12345678", product_id: "P-other1", pages: [], document_md: "# Other" }))
    };
    const app = await appWith(fakeStore({ requirements }));

    const read = await app.inject({ method: "GET", url: "/api/products/P-123abc/requirements/R-12345678" });
    const archive = await app.inject({ method: "PUT", url: "/api/products/P-123abc/requirements/R-12345678/archive" });

    expect(read.statusCode).toBe(404);
    expect(read.json()).toMatchObject({ error_code: "REQUIREMENT_NOT_FOUND" });
    expect(archive.statusCode).toBe(404);
    expect(archive.json()).toMatchObject({ error_code: "REQUIREMENT_NOT_FOUND" });
    expect(requirements.archiveRequirement).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown design image and history routes", async () => {
    const app = await appWith(
      fakeStore({
        requirements: {
          ...fakeStore().requirements,
          getRequirementHistory: vi.fn(async () => [])
        }
      })
    );

    const image = await app.inject({ method: "GET", url: "/api/designs/D-missing1/image" });
    const history = await app.inject({ method: "GET", url: "/api/designs/D-missing1/history" });

    expect(image.statusCode).toBe(404);
    expect(image.json()).toMatchObject({ error_code: "DESIGN_NOT_FOUND" });
    expect(history.statusCode).toBe(404);
    expect(history.json()).toMatchObject({ error_code: "DESIGN_NOT_FOUND" });
  });

  it("returns 404 when no baseline source design has an existing preview", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-routes-"));
    const app = await appWith(fakeStore({ home }));

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/baseline/pages/checkout/image" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error_code: "BASELINE_IMAGE_NOT_FOUND" });
  });

  it("returns 404 when a requested historical design preview is missing", async () => {
    const home = await homeWithPreview(["preview@2x.png"]);
    const app = await appWith(fakeStore({ home }));

    const response = await app.inject({ method: "GET", url: "/api/designs/D-12345678/image?version=2" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error_code: "HISTORY_FILE_MISSING" });
  });

  it("uses design metadata for current image, history, and diff visual URLs", async () => {
    const home = await homeWithTwoVersionDesign();
    const app = await appWith(fakeStore({ home }));

    const history = await app.inject({ method: "GET", url: "/api/designs/D-12345678/history" });
    const currentImage = await app.inject({ method: "GET", url: "/api/designs/D-12345678/image?version=2" });
    const currentImageFile = await app.inject({ method: "GET", url: "/api/designs/D-12345678/image/file?version=2" });
    const diff = await app.inject({ method: "GET", url: "/api/designs/D-12345678/diff?v1=1&v2=2" });
    const diffBody = diff.json();
    const fromImage = await app.inject({ method: "GET", url: diffBody.visual.from_image_url });
    const toImage = await app.inject({ method: "GET", url: diffBody.visual.to_image_url });

    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      design_id: "D-12345678",
      versions: [
        { version: 1, image_url: "/api/designs/D-12345678/image/file?version=1", current: false },
        { version: 2, image_url: "/api/designs/D-12345678/image/file?version=2", current: true }
      ]
    });
    expect(currentImage.statusCode).toBe(200);
    expect(currentImage.json()).toMatchObject({
      design_id: "D-12345678",
      version: 2,
      image_url: "/api/designs/D-12345678/image/file?version=2",
      preview_path: join(home, "data", "P-123abc", "R-12345678", "D-12345678", "preview@2x.png")
    });
    expect(currentImageFile.statusCode).toBe(200);
    expect(currentImageFile.headers["content-type"]).toContain("image/png");
    expect(currentImageFile.body).toBe("current preview");
    expect(diff.statusCode).toBe(200);
    expect(fromImage.statusCode).toBe(200);
    expect(fromImage.headers["content-type"]).toContain("image/png");
    expect(fromImage.body).toBe("old preview");
    expect(toImage.statusCode).toBe(200);
    expect(toImage.headers["content-type"]).toContain("image/png");
    expect(toImage.body).toBe("current preview");
  });

  it("exposes style preview metadata and image through separate endpoints", async () => {
    const home = await homeWithStylePreview();
    const app = await appWith(fakeStore({ home }));

    const metadata = await app.inject({ method: "GET", url: "/api/styles/linear/preview" });
    const image = await app.inject({ method: "GET", url: "/api/styles/linear/preview/image" });

    expect(metadata.statusCode).toBe(200);
    expect(metadata.json()).toMatchObject({
      name: "linear",
      image_url: "/api/styles/linear/preview/image",
      preview_path: join(home, "styles", "linear", "preview@2x.png")
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toContain("image/png");
    expect(image.body).toBe("style preview");
  });

  it("auto-installs built-in styles for GET /api/styles on a fresh home", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-styles-"));
    const app = buildServer({ home, bundledStylesDir: resolve("styles") });
    apps.push(app);
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/api/styles" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "linear" })]));
  });

  it("returns 404 when a style preview image file is missing", async () => {
    const app = await appWith(fakeStore({ home: await mkdtemp(join(tmpdir(), "forma-server-routes-")) }));

    const image = await app.inject({ method: "GET", url: "/api/styles/linear/preview/image" });

    expect(image.statusCode).toBe(404);
    expect(image.json()).toMatchObject({ error_code: "STYLE_PREVIEW_NOT_FOUND" });
  });
});
