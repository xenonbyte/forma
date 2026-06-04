import { createHash } from "node:crypto";
import { createFormaStore, FormaError, getArtifactVersionDir, getArtifactVziPath, type FormaStore, type ProductDeletionState } from "@xenonbyte/forma-core";
import { SpatialIndexBuilder, VZIEncoder } from "@vzi-core/format";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer, isLoopbackHost, type FormaServer, type FormaServerStore } from "../src/app.js";
import { requireAuthTokenForHost } from "../src/index.js";
import type { ArtifactManifest, ExportArchiveAssetsResult } from "@xenonbyte/forma-core";

const apps: FormaServer[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function fakeStore(overrides: Partial<FormaServerStore> = {}): FormaServerStore {
  const baseStore = {
    home: "/tmp/forma",
    artifacts: {
      readArtifact: vi.fn(async (_productId: string, artifactId: string) => ({
        manifest: {
          version: 1,
          id: artifactId,
          kind: "html",
          renderer: "html",
          title: "Checkout Design",
          entry: "index.html",
          status: "complete",
          exports: [],
          sourceSkillId: "design-skill-1",
          requirementId: "R-12345678",
          supportingFiles: [],
          createdAt: "2026-05-17T00:00:00.000Z",
          updatedAt: "2026-05-17T00:00:00.000Z"
        } satisfies ArtifactManifest,
        etag: `"${createHash("sha256").update(artifactId).digest("hex")}"`
      })),
      readArtifactVersion: vi.fn(async (_productId: string, artifactId: string, version: number) => ({
        manifest: {
          version: 1,
          id: artifactId,
          kind: "design-page",
          renderer: "html",
          title: "Checkout Design",
          entry: "index.html",
          status: "complete",
          exports: ["index.html"],
          sourceSkillId: "design-skill-1",
          supportingFiles: ["index.html"],
          createdAt: "2026-05-17T00:00:00.000Z",
          updatedAt: "2026-05-17T00:00:00.000Z",
          forma: { requirementId: "R-12345678", pageId: "checkout-page", variant: "default" }
        } satisfies ArtifactManifest,
        etag: `"${createHash("sha256").update(`${artifactId}-v${version}`).digest("hex")}"`
      })),
      listArtifacts: vi.fn(async () => [{ artifactId: "A-abcdef1234567890" }]),
      listArtifactVersions: vi.fn(async () => [])
    },
    copy: {
      getTranslations: vi.fn(async () => [])
    },
    deleteProduct: vi.fn(async (input: { product_id: string; confirm_product_id: string }) => ({
      product_id: input.product_id,
      deleted: true,
      session_cleared: true,
      cleanup_pending: false,
      recovery_warnings: []
    })),
    products: {
      createProduct: vi.fn(async () => ({ id: "P-123abc", name: "App", description: "Demo" })),
      getProduct: vi.fn(async () => ({
        id: "P-123abc",
        name: "App",
        description: "Demo",
        requirements: { "R-12345678": { latestArtifactId: "A-abcdef1234567890" } }
      })),
      initProductConfig: vi.fn(async (_productId, config) => ({ id: "P-123abc", name: "App", description: "Demo", ...config })),
      listProducts: vi.fn(async () => [{ id: "P-123abc", name: "App", description: "Demo" }]),
      listDesignPointers: vi.fn(async () => [])
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
              design_status: "done"
            }
          ]
        }
      ]),
      saveRequirement: vi.fn(async (input: { requirement_id: string }) => ({ id: input.requirement_id, status: "submitted", ...input }))
    },
    exportArchiveAssets: vi.fn(async (): Promise<ExportArchiveAssetsResult> => ({
      icons: { pages: [], totalIcons: 0 },
      vzi: { pages: [], totalElements: 0 }
    })),
    recoverPendingProductDeletes: vi.fn(async () => ({ recovered: 0, cleaned: 0, warnings: [] })),
    styles: {
      getStyle: vi.fn(async () => ({
        kind: "brand" as const,
        metadata: {
          name: "linear-app",
          description: "Focused tool UI",
          design_md_path: "styles/linear-app/DESIGN.md",
          tokens_css_path: "styles/linear-app/tokens.css",
          components_html_path: "styles/linear-app/components.html"
        },
        designMd: "# Linear App",
        tokensCss: ":root {}",
        componentsHtml: "<div></div>"
      })),
      listStyles: vi.fn(async () => [{ name: "linear-app", description: "Focused tool UI", design_md_path: "styles/linear-app/DESIGN.md", tokens_css_path: "styles/linear-app/tokens.css", components_html_path: "styles/linear-app/components.html" }]),
      listSystemStyles: vi.fn(async () => [{ name: "material", description: "Material Design", mode: "design-system" as const }])
    }
  } satisfies FormaServerStore;

  return {
    ...baseStore,
    ...overrides
  };
}

async function appWith(store = fakeStore()) {
  const app = await buildServer({ store });
  apps.push(app);
  await app.ready();
  return app;
}

async function createStoreWithDeletionHooks(
  home: string,
  productDeletionHooks: NonNullable<Parameters<typeof createFormaStore>[0]["productDeletionHooks"]>
) {
  await markNormalizationCommitted(home);
  return createFormaStore({
    home,
    bundledStylesDir: resolve("styles"),
    productDeletionHooks
  });
}

async function seedReadyProduct(store: FormaStore, name = "Shop App") {
  const product = await store.products.createProduct({ name, description: "Mobile shop" });
  await store.products.initProductConfig(product.id, {
    platform: "mobile",
    languages: ["en"],
    default_language: "en",
    brand_style: "linear-app"
  });
  return product;
}

async function writeComponentLibrary(home: string, productId: string) {
  await mkdir(join(home, "library"), { recursive: true });
  await writeFile(join(home, "library", `${productId}.lib.pen`), JSON.stringify({ children: [{ id: "button", type: "component" }] }), "utf8");
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function webAssetsDir() {
  const root = await mkdtemp(join(tmpdir(), "forma-web-assets-"));
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), "<!doctype html><main id=\"root\">Forma Web</main>", "utf8");
  await writeFile(join(root, "assets", "app.js"), "console.log('forma');", "utf8");
  return root;
}

async function markNormalizationCommitted(home: string): Promise<void> {
  await writeFile(join(home, ".v6-schema-cutover-committed"), "committed\n", "utf8");
}

async function writeLegacyRuntimeYaml(home: string): Promise<void> {
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "data", "products.yaml"), "products: []\n", "utf8");
}

describe("schema normalization limited startup", () => {
  it("starts normally after explicit committed normalization state", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-normal-startup-"));
    await markNormalizationCommitted(home);
    const app = await buildServer({ home, bundledStylesDir: resolve("styles") });
    apps.push(app);
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/api/products" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("preflight-only startup serves status without constructing normal route handlers", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-preflight-startup-"));
    await writeLegacyRuntimeYaml(home);
    const app = await buildServer({ home, bundledStylesDir: resolve("styles") });
    apps.push(app);
    await app.ready();

    const status = await app.inject({ method: "GET", url: "/api/status" });
    const blocked = await app.inject({ method: "GET", url: "/api/products" });
    const blockedDesignMutation = await app.inject({
      method: "POST",
      url: "/api/products/P-123abc/requirements/R-12345678/design/session/begin",
      payload: { operation: "generate" }
    });

    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      schema_normalization: {
        mode: "preflight_only",
        code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
        preflight_status: "missing",
        preflight_reason: "report_missing"
      }
    });
    for (const response of [blocked, blockedDesignMutation]) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error_code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
        message: "Schema normalization preflight required",
        details: status.json().schema_normalization
      });
    }
  });

  it("recovery-only startup serves status and validates recovery write payloads", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-recovery-startup-"));
    await writeFile(join(home, ".v6-schema-cutover-active"), "active\n", "utf8");
    const app = await buildServer({ home, bundledStylesDir: resolve("styles") });
    apps.push(app);
    await app.ready();

    const status = await app.inject({ method: "GET", url: "/api/status" });
    const recovery = await app.inject({ method: "GET", url: "/api/recovery/schema-normalization" });
    const recoverJournal = await app.inject({ method: "POST", url: "/api/recovery/schema-normalization/recover-journal", payload: {} });
    const restoreBackup = await app.inject({ method: "POST", url: "/api/recovery/schema-normalization/restore-backup", payload: {} });
    const blocked = await app.inject({ method: "GET", url: "/api/products" });
    const blockedComponentMutation = await app.inject({
      method: "POST",
      url: "/api/products/P-123abc/component-library/session/begin",
      payload: { operation: "generate", seed_components: [{ component_key: "button-primary" }] }
    });

    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      schema_normalization: {
        mode: "recovery_only",
        code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
        active_marker_file: ".v6-schema-cutover-active",
        recovery_actions: ["recover_v6_normalization_journal", "restore_v6_normalization_backup"]
      }
    });
    expect(recovery.statusCode).toBe(200);
    expect(recovery.json()).toEqual(status.json().schema_normalization);
    for (const response of [recoverJournal, restoreBackup]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error_code: "INVALID_INPUT" });
    }
    for (const response of [blocked, blockedComponentMutation]) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error_code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
        message: "Schema normalization recovery required",
        details: status.json().schema_normalization
      });
    }
  });

  it("does not swallow unrelated fatal startup errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "forma-server-fatal-startup-"));
    const home = join(root, "home-file");
    await writeFile(home, "not a directory", "utf8");

    await expect(buildServer({ home, bundledStylesDir: resolve("styles") })).rejects.toThrow();
  });
});

describe("Fastify API routes", () => {
  it("serves packaged Web assets and falls back to the SPA for app routes", async () => {
    const app = await buildServer({ store: fakeStore(), webAssetsDir: await webAssetsDir() });
    apps.push(app);
    await app.ready();

    const appRoute = await app.inject({ method: "GET", url: "/products" });
    const removedDesignDetailRoute = await app.inject({
      method: "GET",
      url: "/products/P-123abc/requirements/R-12345678/designs/D-12345678"
    });
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
    expect(removedDesignDetailRoute.statusCode).toBe(404);
    expect(removedDesignDetailRoute.headers["content-type"]).toContain("application/json");
    expect(removedDesignDetailRoute.json()).toEqual({
      error_code: "NOT_FOUND",
      message: "Route not found",
      details: {}
    });
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

  it("registers representative product and style routes", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const products = await app.inject({ method: "GET", url: "/api/products" });
    const created = await app.inject({
      method: "POST",
      url: "/api/products",
      payload: { name: "App", description: "Demo" }
    });
    const style = await app.inject({ method: "GET", url: "/api/styles/linear" });

    expect(products.statusCode).toBe(200);
    expect(products.json()).toEqual([{ id: "P-123abc", name: "App", description: "Demo" }]);
    expect(created.statusCode).toBe(200);
    expect(style.statusCode).toBe(200);
    expect(store.products.createProduct).toHaveBeenCalledWith({ name: "App", description: "Demo" });
  });

  it("deletes a product with confirmation and returns the core result", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/products/P-123abc",
      payload: { confirm_product_id: "P-123abc" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      product_id: "P-123abc",
      deleted: true,
      session_cleared: true,
      cleanup_pending: false,
      recovery_warnings: []
    });
    expect(store.deleteProduct).toHaveBeenCalledWith({ product_id: "P-123abc", confirm_product_id: "P-123abc" });
  });

  it("rejects missing delete confirmation without calling core delete", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/products/P-123abc",
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "INVALID_INPUT" });
    expect(store.deleteProduct).not.toHaveBeenCalled();
  });

  it("maps mismatched delete confirmations from core INVALID_INPUT to 400", async () => {
    const store = fakeStore({
      deleteProduct: vi.fn(async () => {
        throw new FormaError("INVALID_INPUT", "confirm_product_id must match product_id", {
          product_id: "P-123abc",
          confirm_product_id: "P-other1"
        });
      })
    });
    const app = await appWith(store);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/products/P-123abc",
      payload: { confirm_product_id: "P-other1" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "INVALID_INPUT" });
    expect(store.deleteProduct).toHaveBeenCalledWith({ product_id: "P-123abc", confirm_product_id: "P-other1" });
  });

  it("maps product mutation locks from deleteProduct to 409", async () => {
    const store = fakeStore({
      deleteProduct: vi.fn(async () => {
        throw new FormaError("PRODUCT_MUTATION_LOCKED", "Product mutation lock is held");
      })
    });
    const app = await appWith(store);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/products/P-123abc",
      payload: { confirm_product_id: "P-123abc" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error_code: "PRODUCT_MUTATION_LOCKED" });
  });

  it("maps product deletion recovery failures from deleteProduct to 409", async () => {
    const store = fakeStore({
      deleteProduct: vi.fn(async () => {
        throw new FormaError("PRODUCT_DELETION_RECOVERY_FAILED", "Product deletion recovery failed");
      })
    });
    const app = await appWith(store);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/products/P-123abc",
      payload: { confirm_product_id: "P-123abc" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error_code: "PRODUCT_DELETION_RECOVERY_FAILED" });
  });

  it("initializes product config with brand_style name, platform, languages, and default language", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({
      method: "POST",
      url: "/api/products/P-123abc/config",
      payload: {
        platform: "web",
        brand_style: "linear-app",
        languages: ["zh-CN", "en"],
        default_language: "zh-CN"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(store.styles.getStyle).not.toHaveBeenCalled();
    expect(store.products.initProductConfig).toHaveBeenCalledWith("P-123abc", {
      platform: "web",
      brand_style: "linear-app",
      languages: ["zh-CN", "en"],
      default_language: "zh-CN"
    });
    expect(response.json()).toMatchObject({
      id: "P-123abc",
      platform: "web",
      languages: ["zh-CN", "en"],
      default_language: "zh-CN"
    });
  });

  it("initializes product config with optional system_style", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({
      method: "POST",
      url: "/api/products/P-123abc/config",
      payload: {
        platform: "mobile",
        brand_style: "linear-app",
        system_style: "material",
        languages: ["en"],
        default_language: "en"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(store.products.initProductConfig).toHaveBeenCalledWith("P-123abc", {
      platform: "mobile",
      brand_style: "linear-app",
      system_style: "material",
      languages: ["en"],
      default_language: "en"
    });
  });

  it("exposes all required route families", async () => {
    const app = await appWith(fakeStore());

    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/api/products/P-123abc" }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/requirements" }),
      app.inject({
        method: "POST",
        url: "/api/products/P-123abc/requirements",
        payload: { title: "Checkout" }
      }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/requirements/R-12345678" }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/artifacts" }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/artifacts/A-abcdef1234567890" }),
      app.inject({ method: "GET", url: "/api/styles" }),
      app.inject({ method: "GET", url: "/api/styles/linear" })
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual(Array(responses.length).fill(200));
  });

  it("GET /api/system-styles returns 200 with an array", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({ method: "GET", url: "/api/system-styles" });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json())).toBe(true);
    expect(store.styles.listSystemStyles).toHaveBeenCalledTimes(1);
  });

  it("waits for pending product delete recovery before buildServer resolves", async () => {
    const recovery = deferred<{ recovered: number; cleaned: number; warnings: string[] }>();
    let serverResolved = false;
    const store = fakeStore({
      recoverPendingProductDeletes: vi.fn(() => recovery.promise)
    });
    const server = buildServer({ store }).then((app) => {
      serverResolved = true;
      return app;
    });

    await flushMicrotasks();

    expect(store.recoverPendingProductDeletes).toHaveBeenCalledTimes(1);
    expect(serverResolved).toBe(false);

    recovery.resolve({ recovered: 0, cleaned: 0, warnings: [] });
    const app = await server;
    apps.push(app);
    await app.ready();
    expect(serverResolved).toBe(true);
  });

  it("logs pending product delete recovery warnings before serving normal routes", async () => {
    const recovery = deferred<{ recovered: number; cleaned: number; warnings: string[] }>();
    const store = fakeStore({
      recoverPendingProductDeletes: vi.fn(() => recovery.promise)
    });
    const server = buildServer({ store });

    await flushMicrotasks();

    recovery.resolve({
      recovered: 1,
      cleaned: 0,
      warnings: ["rolled back pending delete", "cleaned stale operation"]
    });
    const app = await server;
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/products" });

    expect(response.statusCode).toBe(200);
    expect(store.products.listProducts).toHaveBeenCalledTimes(1);
  });

  it("rejects buildServer when pending product delete recovery fails", async () => {
    const recovery = deferred<{ recovered: number; cleaned: number; warnings: string[] }>();
    const store = fakeStore({
      recoverPendingProductDeletes: vi.fn(() => recovery.promise)
    });
    const error = new FormaError("PRODUCT_DELETION_RECOVERY_FAILED", "Product deletion recovery failed");
    const server = buildServer({ store });

    await flushMicrotasks();
    recovery.reject(error);

    await expect(server).rejects.toBe(error);
  });

  it("maps requirement archive invalid status to 409 (non-active requirement is rejected before asset generation)", async () => {
    const exportArchiveAssets = vi.fn(async (): Promise<ExportArchiveAssetsResult> => ({
      icons: { pages: [], totalIcons: 0 },
      vzi: { pages: [], totalElements: 0 }
    }));
    const app = await appWith(
      fakeStore({
        exportArchiveAssets,
        requirements: {
          ...fakeStore().requirements,
          archiveRequirement: vi.fn(async () => {
            throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
              requirement_id: "R-12345678",
              status: "submitted"
            });
          }),
          getRequirement: vi.fn(async () => ({
            id: "R-12345678",
            product_id: "P-123abc",
            pages: [],
            status: "submitted",
            document_md: ""
          }))
        }
      })
    );

    const response = await app.inject({ method: "PUT", url: "/api/products/P-123abc/requirements/R-12345678/archive" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error_code: "REQUIREMENT_STATUS_INVALID"
    });
    expect(exportArchiveAssets).not.toHaveBeenCalled();
  });

  it("creates an empty requirement from title only without submitting requirement content", async () => {
    const requirements = {
      ...fakeStore().requirements,
      createEmptyRequirement: vi.fn(async () => ({
        id: "R-12345678",
        product_id: "P-123abc",
        title: "Checkout",
        status: "empty",
        created_at: "2026-05-17T00:00:00.000Z",
        updated_at: "2026-05-17T00:00:00.000Z",
        pages: [],
        navigation: []
      })),
    };
    const app = await appWith(fakeStore({ requirements }));

    const response = await app.inject({
      method: "POST",
      url: "/api/products/P-123abc/requirements",
      payload: { title: "Checkout" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: "R-12345678", status: "empty" });
    expect(response.json()).not.toHaveProperty("document_md");
    expect(requirements.createEmptyRequirement).toHaveBeenCalledWith("P-123abc", "Checkout");
  });

  it("rejects legacy submit payload fields on the title-only create requirement route", async () => {
    const requirements = {
      ...fakeStore().requirements,
      createEmptyRequirement: vi.fn(async () => ({ id: "R-12345678", status: "empty" }))
    };
    const app = await appWith(fakeStore({ requirements }));

    const response = await app.inject({
      method: "POST",
      url: "/api/products/P-123abc/requirements",
      payload: {
        title: "Checkout",
        document_md: "# Checkout",
        pages: [{ page_id: "checkout-page", name: "Checkout", baseline_page: "checkout" }],
        navigation: []
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "INVALID_INPUT" });
    expect(requirements.createEmptyRequirement).not.toHaveBeenCalled();
  });

  it("saves requirement content after checking product ownership", async () => {
    const body = {
      document_md: "# Checkout",
      pages: [
        {
          page_id: "checkout-page",
          name: "Checkout",
          baseline_page: "checkout",
          copy: [{ context: "title", text: "结账" }],
          change_type: "patch"
        }
      ],
      navigation: []
    };
    const requirements = {
      ...fakeStore().requirements,
      getRequirement: vi.fn(async () => ({ id: "R-12345678", product_id: "P-123abc", pages: [], document_md: "" })),
      saveRequirement: vi.fn(async (input: { requirement_id: string }) => ({ id: input.requirement_id, status: "submitted", ...input }))
    };
    const app = await appWith(fakeStore({ requirements }));

    const response = await app.inject({
      method: "POST",
      url: "/api/products/P-123abc/requirements/R-12345678/save",
      payload: body
    });

    expect(response.statusCode).toBe(200);
    expect(requirements.getRequirement).toHaveBeenCalledWith({ requirement_id: "R-12345678" });
    expect(requirements.saveRequirement).toHaveBeenCalledWith({ requirement_id: "R-12345678", ...body });
    expect(response.json()).toMatchObject({ id: "R-12345678", status: "submitted", document_md: "# Checkout" });
  });

  it("uses the path requirement id when saving even if the body contains another requirement id", async () => {
    const requirements = {
      ...fakeStore().requirements,
      getRequirement: vi.fn(async () => ({ id: "R-12345678", product_id: "P-123abc", pages: [], document_md: "" })),
      saveRequirement: vi.fn(async (input: { requirement_id: string }) => ({ id: input.requirement_id, status: "submitted", ...input }))
    };
    const app = await appWith(fakeStore({ requirements }));

    const response = await app.inject({
      method: "POST",
      url: "/api/products/P-123abc/requirements/R-12345678/save",
      payload: {
        requirement_id: "R-deadbeef",
        document_md: "# Checkout",
        pages: [],
        navigation: []
      }
    });

    expect(response.statusCode).toBe(200);
    expect(requirements.getRequirement).toHaveBeenCalledWith({ requirement_id: "R-12345678" });
    expect(requirements.saveRequirement).toHaveBeenCalledWith({
      requirement_id: "R-12345678",
      document_md: "# Checkout",
      pages: [],
      navigation: []
    });
    expect(response.json()).toMatchObject({ id: "R-12345678", requirement_id: "R-12345678" });
  });

  it("rejects saving a requirement owned by another product before persisting content", async () => {
    const requirements = {
      ...fakeStore().requirements,
      getRequirement: vi.fn(async () => ({ id: "R-12345678", product_id: "P-other1", pages: [], document_md: "" })),
      saveRequirement: vi.fn(async (input: { requirement_id: string }) => ({ id: input.requirement_id, status: "submitted" }))
    };
    const app = await appWith(fakeStore({ requirements }));

    const response = await app.inject({
      method: "POST",
      url: "/api/products/P-123abc/requirements/R-12345678/save",
      payload: { document_md: "# Other", pages: [], navigation: [] }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error_code: "REQUIREMENT_NOT_FOUND" });
    expect(requirements.saveRequirement).not.toHaveBeenCalled();
  });

  it("returns { requirement, icons, vzi } from archive route and runs asset generation before status commit", async () => {
    const callOrder: string[] = [];
    const exportArchiveAssets = vi.fn(async (): Promise<ExportArchiveAssetsResult> => {
      callOrder.push("exportArchiveAssets");
      return { icons: { pages: [], totalIcons: 3 }, vzi: { pages: [], totalElements: 42 } };
    });
    const archiveRequirement = vi.fn(async () => {
      callOrder.push("archiveRequirement");
      return { id: "R-12345678", status: "archived" };
    });
    const getRequirement = vi
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
      });
    const requirements = { ...fakeStore().requirements, archiveRequirement, getRequirement };
    const app = await appWith(fakeStore({ exportArchiveAssets, requirements }));

    const response = await app.inject({ method: "PUT", url: "/api/products/P-123abc/requirements/R-12345678/archive" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      requirement: { id: "R-12345678", status: "archived", document_md: "# Checkout" },
      icons: { totalIcons: 3 },
      vzi: { pages: [], totalElements: 42 }
    });
    expect(archiveRequirement).toHaveBeenCalledWith("R-12345678");
    expect(getRequirement).toHaveBeenLastCalledWith({ requirement_id: "R-12345678" });
    // Asset generation MUST run before status is committed
    expect(callOrder).toEqual(["exportArchiveAssets", "archiveRequirement"]);
  });

  it("runs archive asset generation and archived status commit inside one product mutation lock", async () => {
    const callOrder: string[] = [];
    let lockActive = false;
    const exportArchiveAssets = vi.fn(async (): Promise<ExportArchiveAssetsResult> => {
      expect(lockActive).toBe(true);
      callOrder.push("exportArchiveAssets");
      return { icons: { pages: [], totalIcons: 3 }, vzi: { pages: [], totalElements: 42 } };
    });
    const archiveRequirement = vi.fn(async () => {
      throw new Error("archiveRequirement must not be called while the route already owns the lock");
    });
    const archiveRequirementLocked = vi.fn(async () => {
      expect(lockActive).toBe(true);
      callOrder.push("archiveRequirementLocked");
      return { id: "R-12345678", status: "archived" };
    });
    const runProductMutation = vi.fn(async (
      input: { operation: string; product_id?: string },
      fn: (ctx: { warnings: string[] }) => Promise<unknown>
    ) => {
      expect(input).toEqual({ operation: "archive_requirement", product_id: "P-123abc" });
      callOrder.push("lock:start");
      lockActive = true;
      try {
        return await fn({ warnings: [] });
      } finally {
        lockActive = false;
        callOrder.push("lock:end");
      }
    });
    const getRequirement = vi
      .fn()
      .mockResolvedValueOnce({
        id: "R-12345678",
        product_id: "P-123abc",
        title: "Checkout",
        status: "active",
        pages: [],
        navigation: [],
        document_md: "# Checkout"
      })
      .mockResolvedValueOnce({
        id: "R-12345678",
        product_id: "P-123abc",
        title: "Checkout",
        status: "active",
        pages: [],
        navigation: [],
        document_md: "# Checkout"
      })
      .mockResolvedValueOnce({
        id: "R-12345678",
        product_id: "P-123abc",
        title: "Checkout",
        status: "archived",
        pages: [],
        navigation: [],
        document_md: "# Checkout"
      });
    const requirements = {
      ...fakeStore().requirements,
      archiveRequirement,
      archiveRequirementLocked,
      getRequirement
    };
    const app = await appWith(fakeStore({
      exportArchiveAssets,
      requirements,
      runProductMutation
    } as unknown as Partial<FormaServerStore>));

    const response = await app.inject({ method: "PUT", url: "/api/products/P-123abc/requirements/R-12345678/archive" });

    expect(response.statusCode).toBe(200);
    expect(archiveRequirement).not.toHaveBeenCalled();
    expect(archiveRequirementLocked).toHaveBeenCalledWith("R-12345678");
    expect(runProductMutation).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["lock:start", "exportArchiveAssets", "archiveRequirementLocked", "lock:end"]);
  });

  it("default archive asset generation backfills narrow design pointers from artifact manifests", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-archive-pointer-backfill-"));
    const productId = "P-123abc";
    const requirementId = "R-12345678";
    const artifactId = "A-abcdef1234567890";
    const version = 1;
    const versionDir = getArtifactVersionDir(join(home, "data", "products"), productId, artifactId, version);
    await mkdir(versionDir, { recursive: true });
    await writeFile(
      join(versionDir, "index.html"),
      `<!DOCTYPE html><html><body><main style="width:1024px;height:768px">Archive</main></body></html>`,
      "utf8"
    );

    const archiveRequirement = vi.fn(async () => ({ id: requirementId, status: "archived" }));
    const getRequirement = vi
      .fn()
      .mockResolvedValueOnce({
        id: requirementId,
        product_id: productId,
        title: "Checkout",
        status: "active",
        pages: [{ page_id: "checkout-page" }],
        navigation: [],
        document_md: "# Checkout"
      })
      .mockResolvedValueOnce({
        id: requirementId,
        product_id: productId,
        title: "Checkout",
        status: "archived",
        pages: [{ page_id: "checkout-page" }],
        navigation: [],
        document_md: "# Checkout"
      })
      .mockResolvedValueOnce({
        id: requirementId,
        product_id: productId,
        title: "Checkout",
        status: "archived",
        pages: [{ page_id: "checkout-page" }],
        navigation: [],
        document_md: "# Checkout"
      });
    const base = fakeStore({ home });
    const store = fakeStore({
      home,
      exportArchiveAssets: undefined,
      artifacts: {
        ...base.artifacts,
        listArtifactVersions: vi.fn(async () => [version]),
        readArtifactVersion: vi.fn(async () => ({
          manifest: {
            version: 1,
            id: artifactId,
            kind: "design-page",
            renderer: "html",
            title: "Checkout Design",
            entry: "index.html",
            status: "complete",
            exports: ["index.html"],
            supportingFiles: ["index.html"],
            createdAt: "2026-05-17T00:00:00.000Z",
            updatedAt: "2026-05-17T00:00:00.000Z",
            forma: { requirementId, pageId: "checkout-page", variant: "default" }
          } satisfies ArtifactManifest,
          etag: "etag"
        })),
      },
      products: {
        ...base.products,
        getProduct: vi.fn(async () => ({
          id: productId,
          name: "App",
          description: "Demo",
          platform: "web",
        })),
        listDesignPointers: vi.fn(async () => [{ artifactId, version }] as unknown as Awaited<ReturnType<FormaServerStore["products"]["listDesignPointers"]>>)
      },
      requirements: {
        ...base.requirements,
        archiveRequirement,
        getRequirement
      }
    });
    const app = await appWith(store);

    const response = await app.inject({ method: "PUT", url: `/api/products/${productId}/requirements/${requirementId}/archive` });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.icons.pages).toHaveLength(1);
    expect(body.vzi.pages).toHaveLength(1);
    expect(body.vzi.pages[0]).toMatchObject({
      pageId: "checkout-page",
      artifactId,
      version,
    });
    await expect(readFile(getArtifactVziPath(join(home, "data", "products"), productId, artifactId))).resolves.toBeInstanceOf(Buffer);
    expect(archiveRequirement).toHaveBeenCalledWith(requirementId);
  }, 90_000);

  it("maps not found and invalid input errors", async () => {
    const store = fakeStore({
      products: {
        ...fakeStore().products,
        getProduct: vi.fn(async () => {
          throw new FormaError("PRODUCT_NOT_FOUND", "Product not found", { product_id: "P-missing" });
        })
      }
    });
    const app = await appWith(store);

    const notFound = await app.inject({ method: "GET", url: "/api/products/P-missing" });
    const invalidBody = await app.inject({ method: "POST", url: "/api/products", payload: { name: "Missing description" } });

    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toMatchObject({ error_code: "PRODUCT_NOT_FOUND" });
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.json()).toMatchObject({ error_code: "INVALID_INPUT" });
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

  it("returns retryable error and keeps status non-archived when exportArchiveAssets fails", async () => {
    const archiveRequirement = vi.fn(async () => ({ id: "R-12345678", status: "archived" }));
    const exportArchiveAssets = vi.fn(async (): Promise<ExportArchiveAssetsResult> => {
      throw new FormaError("ARTIFACT_WRITE_FAIL", "Icon export failed", { phase: "icons" });
    });
    const getRequirement = vi.fn(async () => ({
      id: "R-12345678",
      product_id: "P-123abc",
      title: "Checkout",
      status: "active",
      pages: [],
      navigation: [],
      document_md: "# Checkout"
    }));
    const requirements = { ...fakeStore().requirements, archiveRequirement, getRequirement };
    const app = await appWith(fakeStore({ exportArchiveAssets, requirements }));

    const response = await app.inject({ method: "PUT", url: "/api/products/P-123abc/requirements/R-12345678/archive" });

    // Generation failure → non-2xx (retryable error envelope)
    expect(response.statusCode).not.toBe(200);
    expect(response.json()).toMatchObject({ error_code: "ARTIFACT_WRITE_FAIL" });
    // Status commit must NOT have happened
    expect(archiveRequirement).not.toHaveBeenCalled();
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


  it("returns default 404 for removed legacy design API routes without calling design handlers", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/api/designs/D-12345678/annotations" }),
      app.inject({ method: "GET", url: "/api/designs/D-12345678/image" }),
      app.inject({ method: "GET", url: "/api/designs/D-12345678/image/file" }),
      app.inject({ method: "GET", url: "/api/designs/D-12345678/history" }),
      app.inject({ method: "GET", url: "/api/designs/D-12345678/diff?v1=1&v2=2" }),
      app.inject({ method: "GET", url: "/api/designs/D-12345678/export?node_id=root&format=png" })
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error_code: "NOT_FOUND",
        message: "Route not found",
        details: {}
      });
    }
  });

  it("keeps product route reads and session visibility consistent while deletion progresses", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-delete-consistency-"));
    const observations: Array<{
      label: string;
      listIds: string[];
      detailStatus: number;
      detailError?: string;
      currentProduct: string | null;
      productFileExists: boolean;
    }> = [];
    let app!: FormaServer;
    let productId = "";
    const capture = async (label: string, state: ProductDeletionState) => {
      if (state.product_id !== productId) {
        return;
      }

      const [list, detail, session, productFileExists] = await Promise.all([
        app.inject({ method: "GET", url: "/api/products" }),
        app.inject({ method: "GET", url: `/api/products/${productId}` }),
        store.sessions.getCurrentSession(),
        pathExists(join(home, "data", productId, "product.yaml"))
      ]);
      observations.push({
        label,
        listIds: list.json().map((product: { id: string }) => product.id),
        detailStatus: detail.statusCode,
        detailError: detail.statusCode === 200 ? undefined : detail.json().error_code,
        currentProduct: session.current_product,
        productFileExists
      });
    };
    const store = await createStoreWithDeletionHooks(home, {
      afterPhasePersisted: async (state) => {
        if (state.phase === "backed_up" || state.phase === "session_written" || state.phase === "index_written" || state.phase === "moved") {
          await capture(state.phase, state);
        }
      },
      beforeMovePath: async (entry, state) => {
        if (entry.kind === "product_data") {
          await capture("before_first_move", state);
        }
      }
    });
    const product = await seedReadyProduct(store);
    productId = product.id;
    await store.sessions.setCurrentProduct(product.id);
    await writeComponentLibrary(home, product.id);
    app = await buildServer({ store });
    apps.push(app);
    await app.ready();

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/products/${product.id}`,
      payload: { confirm_product_id: product.id }
    });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ product_id: product.id, deleted: true, session_cleared: true });
    expect(observations).toEqual([
      {
        label: "backed_up",
        listIds: [product.id],
        detailStatus: 200,
        detailError: undefined,
        currentProduct: product.id,
        productFileExists: true
      },
      {
        label: "session_written",
        listIds: [product.id],
        detailStatus: 200,
        detailError: undefined,
        currentProduct: null,
        productFileExists: true
      },
      {
        label: "index_written",
        listIds: [],
        detailStatus: 404,
        detailError: "PRODUCT_NOT_FOUND",
        currentProduct: null,
        productFileExists: true
      },
      {
        label: "before_first_move",
        listIds: [],
        detailStatus: 404,
        detailError: "PRODUCT_NOT_FOUND",
        currentProduct: null,
        productFileExists: true
      },
      {
        label: "moved",
        listIds: [],
        detailStatus: 404,
        detailError: "PRODUCT_NOT_FOUND",
        currentProduct: null,
        productFileExists: false
      }
    ]);
  });

  it("auto-installs built-in styles for GET /api/styles on a fresh home", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-styles-"));
    await markNormalizationCommitted(home);
    const store = await createFormaStore({ home, bundledStylesDir: resolve("styles") });
    const app = await buildServer({ store });
    apps.push(app);
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/api/styles" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "linear-app",
        description: expect.any(String),
        design_md_path: expect.any(String),
        tokens_css_path: expect.any(String),
        components_html_path: expect.any(String)
      })
    ]));
  });
});

describe("artifact routes", () => {
  it("GET /api/products/:pid/artifacts returns artifact list", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/artifacts" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty("artifacts");
    expect(body.artifacts).toHaveLength(1);
    expect(body.artifacts[0]).toMatchObject({
      id: "A-abcdef1234567890",
      kind: "design-page",
      title: "Checkout Design",
      updated_at: "2026-05-17T00:00:00.000Z",
      preview_url: "/api/products/P-123abc/artifacts/A-abcdef1234567890/preview/2x"
    });
  });

  it("GET /api/products/:pid/artifacts returns 404 for unknown product", async () => {
    const store = fakeStore({
      products: {
        ...fakeStore().products,
        getProduct: vi.fn(async () => {
          throw new FormaError("PRODUCT_NOT_FOUND", "Product not found", { product_id: "P-missing" });
        })
      }
    });
    const app = await appWith(store);

    const response = await app.inject({ method: "GET", url: "/api/products/P-missing/artifacts" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error_code: "PRODUCT_NOT_FOUND" });
  });

  it("GET /api/products/:pid/artifacts/:aid returns manifest with ETag and Cache-Control", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/artifacts/A-abcdef1234567890" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["etag"]).toBeTruthy();
    expect(response.headers["cache-control"]).toBe("private, max-age=300");
    const body = response.json();
    expect(body).toHaveProperty("manifest");
    expect(body).toHaveProperty("supportingFiles");
    expect(body.preview_url).toBe("/api/products/P-123abc/artifacts/A-abcdef1234567890/preview/2x");
    expect(body.manifest.kind).toBe("html");
  });

  it("GET /api/products/:pid/artifacts/:aid returns 404 for unknown artifact", async () => {
    const store = fakeStore({
      artifacts: {
        ...fakeStore().artifacts,
        readArtifact: vi.fn(async () => {
          throw new FormaError("ARTIFACT_NOT_FOUND", "Artifact not found", { artifact_id: "A-missing" });
        })
      }
    });
    const app = await appWith(store);

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/artifacts/A-missing" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
  });

  it("GET /api/products/:pid/artifacts/:aid/preview/:res returns 404 for unknown resolution", async () => {
    const app = await appWith(fakeStore());

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/artifacts/A-abcdef1234567890/preview/3x" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
  });

  it("GET /api/products/:pid/artifacts/:aid/preview/:res returns 404 when preview file missing", async () => {
    const app = await appWith(fakeStore({ home: await mkdtemp(join(tmpdir(), "forma-artifact-preview-")) }));

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/artifacts/A-abcdef1234567890/preview/2x" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
  });

  // Review #1: server read routes must handle versioned-only artifacts (no flat manifest)
  function versionedOnlyStore(home?: string): FormaServerStore {
    const base = fakeStore(home ? { home } : {});
    return fakeStore({
      ...(home ? { home } : {}),
      artifacts: {
        ...base.artifacts,
        readArtifact: vi.fn(async () => {
          throw new FormaError("ARTIFACT_NOT_FOUND", "Artifact not found", { artifact_id: "A-abcdef1234567890" });
        }),
        listArtifactVersions: vi.fn(async () => [1])
      },
      products: {
        ...base.products,
        listDesignPointers: vi.fn(async () => [{
          requirementId: "R-12345678",
          pageId: "checkout-page",
          variant: "default",
          artifactId: "A-abcdef1234567890",
          version: 1,
          designStatus: "active" as const
        }])
      }
    });
  }

  it("GET /api/products/:pid/artifacts lists a versioned-only artifact without crashing", async () => {
    const app = await appWith(versionedOnlyStore());

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/artifacts" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.artifacts).toHaveLength(1);
    expect(body.artifacts[0]).toMatchObject({
      id: "A-abcdef1234567890",
      kind: "design-page",
      requirement_id: "R-12345678",
      superseded: false
    });
  });

  it("GET /api/products/:pid/artifacts?kind=html surfaces new design-page artifacts (alias-aware filter)", async () => {
    const app = await appWith(versionedOnlyStore());

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/artifacts?kind=html" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.artifacts).toHaveLength(1);
    expect(body.artifacts[0].id).toBe("A-abcdef1234567890");
  });

  it("GET /api/products/:pid/artifacts/:aid returns the current version manifest for a versioned-only artifact", async () => {
    const app = await appWith(versionedOnlyStore());

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/artifacts/A-abcdef1234567890" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.manifest.kind).toBe("design-page");
    expect(body.manifest.forma.requirementId).toBe("R-12345678");
  });

  it("GET /api/products/:pid/artifacts/:aid/preview/:res falls back to the current version preview", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-preview-fallback-"));
    const previewDir = join(home, "data", "products", "P-123abc", "od-project", "artifacts", "A-abcdef1234567890", "v1", "preview");
    await mkdir(previewDir, { recursive: true });
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(join(previewDir, "2x.png"), pngBytes);

    const app = await appWith(versionedOnlyStore(home));

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/artifacts/A-abcdef1234567890/preview/2x" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.rawPayload).toEqual(pngBytes);
  });

  it("GET /api/products/:pid/artifacts/:aid/versions/:v/bundle/* serves index.html from versioned bundle", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-bundle-route-"));
    const versionDir = join(home, "data", "products", "P-123abc", "od-project", "artifacts", "A-abcdef1234567890", "v1");
    await mkdir(versionDir, { recursive: true });
    await writeFile(join(versionDir, "index.html"), "<!doctype html><body>Bundle</body>", "utf8");

    const app = await appWith(fakeStore({ home }));

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/artifacts/A-abcdef1234567890/versions/1/bundle/index.html"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    // Defense-in-depth: served artifact HTML must not be MIME-sniffed.
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.body).toContain("Bundle");
  });

  it("GET /api/products/:pid/artifacts/:aid/versions/:v/bundle/* serves nested asset file", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-bundle-asset-"));
    const assetsDir = join(home, "data", "products", "P-123abc", "od-project", "artifacts", "A-abcdef1234567890", "v2", "assets");
    await mkdir(assetsDir, { recursive: true });
    await writeFile(join(assetsDir, "style.css"), "body { color: red; }", "utf8");

    const app = await appWith(fakeStore({ home }));

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/artifacts/A-abcdef1234567890/versions/2/bundle/assets/style.css"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/css");
    expect(response.body).toContain("color: red");
  });

  it("GET /api/products/:pid/artifacts/:aid/versions/:v/bundle/* rejects path traversal", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-bundle-traversal-"));
    const versionDir = join(home, "data", "products", "P-123abc", "od-project", "artifacts", "A-abcdef1234567890", "v1");
    await mkdir(versionDir, { recursive: true });

    const app = await appWith(fakeStore({ home }));

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/artifacts/A-abcdef1234567890/versions/1/bundle/..%2F..%2Fsecret"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "ARTIFACT_INVALID_INPUT" });
  });

  it("GET /api/products/:pid/artifacts/:aid/versions/:v/bundle/* rejects NUL bytes", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-bundle-nul-"));
    const versionDir = join(home, "data", "products", "P-123abc", "od-project", "artifacts", "A-abcdef1234567890", "v1");
    await mkdir(versionDir, { recursive: true });

    const app = await appWith(fakeStore({ home }));

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/artifacts/A-abcdef1234567890/versions/1/bundle/index%00.html"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "ARTIFACT_INVALID_INPUT" });
  });

  it("artifact file-serving routes reject symlinks that escape artifact subdirectories", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-file-symlink-"));
    const productId = "P-123abc";
    const artifactId = "A-abcdef1234567890";
    const productArtifactDir = join(home, "data", "products", productId, "od-project", "artifacts", artifactId);
    const versionDir = join(productArtifactDir, "v1");
    const iconsDir = join(productArtifactDir, "icons");
    const vziDir = join(productArtifactDir, "vzi");
    const previewDir = join(versionDir, "preview");
    await mkdir(join(versionDir, "assets"), { recursive: true });
    await mkdir(iconsDir, { recursive: true });
    await mkdir(vziDir, { recursive: true });
    await mkdir(previewDir, { recursive: true });
    const outside = join(home, "outside.txt");
    await writeFile(outside, "outside", "utf8");
    await symlink(outside, join(versionDir, "assets", "leak.txt"));
    await symlink(outside, join(iconsDir, "leak.svg"));
    await symlink(outside, join(vziDir, "page.vzi"));
    await symlink(outside, join(previewDir, "2x.png"));

    const app = await appWith(versionedOnlyStore(home));

    const [bundle, icon, vzi, preview] = await Promise.all([
      app.inject({ method: "GET", url: `/api/products/${productId}/artifacts/${artifactId}/versions/1/bundle/assets/leak.txt` }),
      app.inject({ method: "GET", url: `/api/products/${productId}/artifacts/${artifactId}/icons/leak.svg` }),
      app.inject({ method: "GET", url: `/api/products/${productId}/artifacts/${artifactId}/vzi/page.vzi` }),
      app.inject({ method: "GET", url: `/api/products/${productId}/artifacts/${artifactId}/versions/1/preview/2x.png` })
    ]);

    for (const response of [bundle, icon, vzi, preview]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error_code: "ARTIFACT_INVALID_INPUT" });
    }
  });

  it("artifact file-serving routes reject symlinked service roots", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-root-symlink-"));
    const productId = "P-123abc";
    const artifactId = "A-abcdef1234567890";
    const productArtifactDir = join(home, "data", "products", productId, "od-project", "artifacts", artifactId);
    const outsideVersionDir = join(home, "outside-version");
    await mkdir(join(outsideVersionDir, "assets"), { recursive: true });
    await mkdir(productArtifactDir, { recursive: true });
    await writeFile(join(outsideVersionDir, "assets", "leak.txt"), "outside", "utf8");
    await symlink(outsideVersionDir, join(productArtifactDir, "v1"));

    const app = await appWith(versionedOnlyStore(home));

    const response = await app.inject({
      method: "GET",
      url: `/api/products/${productId}/artifacts/${artifactId}/versions/1/bundle/assets/leak.txt`
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "ARTIFACT_INVALID_INPUT" });
  });

  it("GET /api/products/:pid/artifacts/:aid/versions/:v/bundle/* returns 404 for missing file", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-bundle-missing-"));
    const versionDir = join(home, "data", "products", "P-123abc", "od-project", "artifacts", "A-abcdef1234567890", "v1");
    await mkdir(versionDir, { recursive: true });

    const app = await appWith(fakeStore({ home }));

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/artifacts/A-abcdef1234567890/versions/1/bundle/missing.html"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
  });

  it("GET /api/products/:pid/artifacts/:aid/versions/:v/preview/:res serves 2x.png", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-vpreview-"));
    const previewDir = join(home, "data", "products", "P-123abc", "od-project", "artifacts", "A-abcdef1234567890", "v1", "preview");
    await mkdir(previewDir, { recursive: true });
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(join(previewDir, "2x.png"), pngBytes);

    const app = await appWith(fakeStore({ home }));

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/artifacts/A-abcdef1234567890/versions/1/preview/2x.png"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.rawPayload).toEqual(pngBytes);
  });

  it("serves artifact bytes with private no-store cache headers when bearer auth is enabled", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-auth-cache-"));
    const productId = "P-123abc";
    const artifactId = "A-abcdef1234567890";
    const productsRoot = join(home, "data", "products");
    const artifactDir = join(productsRoot, productId, "od-project", "artifacts", artifactId);
    const versionDir = join(artifactDir, "v1");
    const flatPreviewDir = join(artifactDir, "preview");
    const versionPreviewDir = join(versionDir, "preview");
    const iconsDir = join(artifactDir, "icons");
    await mkdir(flatPreviewDir, { recursive: true });
    await mkdir(versionPreviewDir, { recursive: true });
    await mkdir(iconsDir, { recursive: true });
    await writeFile(join(versionDir, "index.html"), "<!doctype html><body>Bundle</body>", "utf8");
    await writeFile(join(flatPreviewDir, "2x.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(join(versionPreviewDir, "2x.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(join(iconsDir, "logo.svg"), "<svg/>", "utf8");
    const elements = new Map<string, unknown>([
      ["root", { id: "root", parentId: null, type: "container", bounds: { x: 0, y: 0, width: 320, height: 640 }, styles: {} }]
    ]);
    await mkdir(join(getArtifactVziPath(productsRoot, productId, artifactId), ".."), { recursive: true });
    await writeFile(getArtifactVziPath(productsRoot, productId, artifactId), Buffer.from(new VZIEncoder().encode({
      header: {},
      metadata: { formaViewport: { width: 320, height: 640 } },
      elements,
      sharedStyles: new Map(),
      spatialIndex: new SpatialIndexBuilder().build(elements as never),
      colorTokens: [],
      fontTokens: [],
      annotations: [],
      images: new Map(),
      layers: [],
      compatibility: { minReaderVersion: "2.0.0", formatVersion: "2.0.0", features: [] }
    } as never)));

    const app = await buildServer({ store: fakeStore({ home }), authToken: "s3cret" });
    apps.push(app);
    await app.ready();
    const headers = { authorization: "Bearer s3cret" };

    const responses = await Promise.all([
      app.inject({ method: "GET", url: `/api/products/${productId}/artifacts/${artifactId}/preview/2x`, headers }),
      app.inject({ method: "GET", url: `/api/products/${productId}/artifacts/${artifactId}/versions/1/bundle/index.html`, headers }),
      app.inject({ method: "GET", url: `/api/products/${productId}/artifacts/${artifactId}/versions/1/preview/2x.png`, headers }),
      app.inject({ method: "GET", url: `/api/products/${productId}/artifacts/${artifactId}/icons/logo.svg`, headers }),
      app.inject({ method: "GET", url: `/api/products/${productId}/artifacts/${artifactId}/vzi/page.vzi`, headers }),
      app.inject({ method: "GET", url: `/api/products/${productId}/artifacts/${artifactId}/vzi/content`, headers })
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers.vary).toBe("Authorization");
    }
  });

  it("GET /api/products/:pid/artifacts/:aid/versions/:v/preview/:res returns 400 for invalid resolution", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-vpreview-bad-res-"));
    const app = await appWith(fakeStore({ home }));

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/artifacts/A-abcdef1234567890/versions/1/preview/3x.png"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "ARTIFACT_INVALID_INPUT" });
  });

  it("GET /api/products/:pid/artifacts/:aid/versions/:v/preview/:res returns 404 when preview file missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-vpreview-missing-"));
    const versionDir = join(home, "data", "products", "P-123abc", "od-project", "artifacts", "A-abcdef1234567890", "v1");
    await mkdir(versionDir, { recursive: true });

    const app = await appWith(fakeStore({ home }));

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/artifacts/A-abcdef1234567890/versions/1/preview/1x.png"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error_code: "ARTIFACT_NOT_FOUND" });
  });

  it("exposes page_id, variant and current_version for versioned design-page artifacts", async () => {
    const app = await appWith(versionedOnlyStore());

    const res = await app.inject({ method: "GET", url: "/api/products/P-123abc/artifacts" });
    expect(res.statusCode).toBe(200);
    const { artifacts } = res.json() as {
      artifacts: Array<{ id: string; kind: string; page_id?: string; variant?: string; current_version?: number }>;
    };
    const dp = artifacts.find((a) => a.kind === "design-page");
    expect(dp).toBeDefined();
    expect(typeof dp!.page_id).toBe("string");
    expect(dp!.variant).toBe("default");
    expect(typeof dp!.current_version).toBe("number");
  });

  it("flat (legacy) artifacts do NOT expose current_version", async () => {
    // fakeStore's default listArtifactVersions returns [] (flat artifact)
    const app = await appWith(fakeStore());

    const res = await app.inject({ method: "GET", url: "/api/products/P-123abc/artifacts" });
    expect(res.statusCode).toBe(200);
    const { artifacts } = res.json() as {
      artifacts: Array<{ id: string; kind: string; current_version?: number }>;
    };
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].current_version).toBeUndefined();
  });
});

describe("baseline compatibility routes", () => {
  it("GET /api/products/:id/baseline returns a derived baseline for existing Web UI callers", async () => {
    const store = fakeStore({
      requirements: {
        ...fakeStore().requirements,
        getRequirementHistory: vi.fn(async () => [
          {
            id: "R-12345678",
            product_id: "P-123abc",
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
            navigation: [{ from: "home", to: "checkout", label: "Buy" }]
          }
        ])
      }
    });
    const app = await appWith(store);

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/baseline" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      product_id: "P-123abc",
      pages: [
        {
          id: "checkout",
          name: "Checkout",
          features: "Pay for an order",
          fields: "Card number",
          interactions: "Submit payment",
          source_requirements: ["R-12345678"]
        }
      ],
      navigation: [{ from: "home", to: "checkout", label: "Buy" }]
    });
  });

  it("GET /api/products/:id/baseline maps requirement navigation page_id values to baseline page ids", async () => {
    const store = fakeStore({
      requirements: {
        ...fakeStore().requirements,
        getRequirementHistory: vi.fn(async () => [
          {
            id: "R-12345678",
            product_id: "P-123abc",
            created_at: "2026-05-17T00:00:00.000Z",
            updated_at: "2026-05-18T00:00:00.000Z",
            pages: [
              { page_id: "checkout-page", name: "Checkout", baseline_page: "checkout", design_status: "done" },
              { page_id: "confirmation-page", name: "Confirmation", baseline_page: "confirmation", design_status: "done" }
            ],
            navigation: [{ from: "checkout-page", to: "confirmation-page", label: "Continue" }]
          }
        ])
      }
    });
    const app = await appWith(store);

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/baseline" });

    expect(response.statusCode).toBe(200);
    expect(response.json().navigation).toEqual([{ from: "checkout", to: "confirmation", label: "Continue" }]);
  });

  it("GET /api/products/:id/baseline/pages/:pageId/copy returns requirement page copy and translations", async () => {
    const store = fakeStore({
      copy: {
        getTranslations: vi.fn(async () => [
          {
            page_id: "checkout-page",
            entries: [{ context: "title", texts: { "zh-CN": "结账" } }]
          }
        ])
      },
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-12345678",
          product_id: "P-123abc",
          pages: [
            {
              page_id: "checkout-page",
              name: "Checkout",
              baseline_page: "checkout",
              design_status: "done",
              copy: [{ context: "title", text: "Checkout" }]
            }
          ]
        })),
        getRequirementHistory: vi.fn(async () => [
          {
            id: "R-12345678",
            product_id: "P-123abc",
            created_at: "2026-05-17T00:00:00.000Z",
            updated_at: "2026-05-18T00:00:00.000Z",
            pages: [
              {
                page_id: "checkout-page",
                name: "Checkout",
                baseline_page: "checkout",
                design_status: "done",
                copy: [{ context: "title", text: "Checkout" }]
              }
            ],
            navigation: []
          }
        ])
      }
    });
    const app = await appWith(store);

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/baseline/pages/checkout/copy?requirement_id=R-12345678"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      page_id: "checkout",
      default_language_copy: [{ context: "title", text: "Checkout" }],
      translations: [{ context: "title", texts: { "zh-CN": "结账" } }]
    });
    expect(store.copy.getTranslations).toHaveBeenCalledWith("P-123abc", "R-12345678");
  });
});

describe("origin middleware (SPEC-IF-HTTP-004)", () => {
  it("allows mutation requests from whitelisted origin", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({
      method: "POST",
      url: "/api/products",
      payload: { name: "App", description: "Demo" },
      headers: { Origin: "http://localhost:5173" }
    });

    expect(response.statusCode).not.toBe(403);
    expect(store.products.createProduct).toHaveBeenCalled();
  });

  it("allows mutation requests from second whitelisted origin", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({
      method: "POST",
      url: "/api/products",
      payload: { name: "App", description: "Demo" },
      headers: { Origin: "http://localhost:4173" }
    });

    expect(response.statusCode).not.toBe(403);
    expect(store.products.createProduct).toHaveBeenCalled();
  });

  it("allows mutation requests from the served Web origin", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({
      method: "POST",
      url: "/api/products",
      payload: { name: "App", description: "Demo" },
      headers: {
        Host: "127.0.0.1:3000",
        Origin: "http://127.0.0.1:3000"
      }
    });

    expect(response.statusCode).not.toBe(403);
    expect(store.products.createProduct).toHaveBeenCalled();
  });

  it("blocks mutation requests from non-whitelisted origin", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({
      method: "POST",
      url: "/api/products",
      payload: { name: "App", description: "Demo" },
      headers: { Origin: "https://evil.com" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error_code: "ARTIFACT_FORBIDDEN_ORIGIN" });
    expect(store.products.createProduct).not.toHaveBeenCalled();
  });

  it("blocks mutation requests with null origin (desktop)", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({
      method: "POST",
      url: "/api/products",
      payload: { name: "App", description: "Demo" },
      headers: { Origin: "null" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error_code: "ARTIFACT_FORBIDDEN_ORIGIN" });
    expect(store.products.createProduct).not.toHaveBeenCalled();
  });

  it("allows mutation requests with no Origin header (CLI/server-side calls)", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({
      method: "POST",
      url: "/api/products",
      payload: { name: "App", description: "Demo" }
    });

    expect(response.statusCode).not.toBe(403);
    expect(store.products.createProduct).toHaveBeenCalled();
  });

  it("allows GET requests without origin check", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({
      method: "GET",
      url: "/api/products",
      headers: { Origin: "https://evil.com" }
    });

    expect(response.statusCode).toBe(200);
    expect(store.products.listProducts).toHaveBeenCalled();
  });
});

describe("audit log (SPEC-OBS-004)", () => {
  it("logs audit line for mutation route with required fields", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const store = fakeStore();
    const app = await appWith(store);

    await app.inject({
      method: "POST",
      url: "/api/products",
      payload: { name: "App", description: "Demo" },
      headers: { Origin: "http://localhost:5173", "x-forma-client": "web-admin" }
    });

    const logCalls = consoleSpy.mock.calls.map((args) => {
      try { return JSON.parse(args[0] as string); } catch { return null; }
    }).filter(Boolean);
    const auditEntry = logCalls.find((entry) => entry && "timestamp" in entry && "route" in entry);

    expect(auditEntry).toBeTruthy();
    expect(auditEntry).toHaveProperty("timestamp");
    expect(auditEntry).toHaveProperty("route");
    expect(auditEntry).toHaveProperty("origin");
    expect(auditEntry).toHaveProperty("x-forma-client");
    expect(auditEntry).toHaveProperty("allowed");
    expect(auditEntry.origin).toBe("http://localhost:5173");
    expect(auditEntry["x-forma-client"]).toBe("web-admin");
    expect(auditEntry.allowed).toBe(true);

    consoleSpy.mockRestore();
  });

  it("logs allowed: false for blocked mutation request", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const store = fakeStore();
    const app = await appWith(store);

    await app.inject({
      method: "POST",
      url: "/api/products",
      payload: { name: "App", description: "Demo" },
      headers: { Origin: "https://evil.com" }
    });

    const logCalls = consoleSpy.mock.calls.map((args) => {
      try { return JSON.parse(args[0] as string); } catch { return null; }
    }).filter(Boolean);
    const auditEntry = logCalls.find((entry) => entry && "timestamp" in entry && "route" in entry);

    expect(auditEntry).toBeTruthy();
    expect(auditEntry.allowed).toBe(false);
    expect(auditEntry.origin).toBe("https://evil.com");

    consoleSpy.mockRestore();
  });
});

describe("SPEC-IF-HTTP-005: removed routes return 404", () => {
  it("returns 404 for removed design session routes", async () => {
    const app = await appWith(fakeStore());

    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/api/products/P-123abc/requirements/R-12345678/design/canvas" }),
      app.inject({ method: "POST", url: "/api/products/P-123abc/requirements/R-12345678/design/session/begin", payload: {} }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/design/session/active" }),
      app.inject({ method: "POST", url: "/api/products/P-123abc/component-library/session/begin", payload: {} }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/component-library" }),
      app.inject({ method: "POST", url: "/api/styles/sync" }),
      app.inject({ method: "GET", url: "/api/styles/linear/preview" })
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
    }
  });
});

describe("regression: HTTP bundle + preview routes are NOT gated by archive status (Task 10)", () => {
  // These tests verify that the new archived-gate added to dev-handoff MCP tools
  // does NOT affect the HTTP routes that serve artifact bundles and previews.
  // Active (non-archived) products must always serve bundles and previews over HTTP.

  it("GET versioned bundle returns 200 for an ACTIVE product artifact (no archive gate)", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-http-regress-bundle-"));
    const productId = "P-123abc";
    const artifactId = "A-abcdef1234567890";
    const versionDir = join(home, "data", "products", productId, "od-project", "artifacts", artifactId, "v1");
    await mkdir(versionDir, { recursive: true });
    await writeFile(join(versionDir, "index.html"), "<!doctype html><body>Active Design</body>", "utf8");

    // Store returns an active (non-archived) requirement when queried.
    // The HTTP route must NOT check requirement status — bundle is always served.
    const store = fakeStore({
      home,
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-12345678",
          product_id: productId,
          status: "active",  // NOT archived
          pages: [],
          document_md: ""
        }))
      }
    });
    const app = await appWith(store);

    const response = await app.inject({
      method: "GET",
      url: `/api/products/${productId}/artifacts/${artifactId}/versions/1/bundle/index.html`
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Active Design");
    // The route must NOT have called getRequirement (archive gate does not belong here)
    expect(store.requirements.getRequirement).not.toHaveBeenCalled();
  });

  it("GET versioned preview returns 200 for an ACTIVE product artifact (no archive gate)", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-http-regress-preview-"));
    const productId = "P-123abc";
    const artifactId = "A-abcdef1234567890";
    const previewDir = join(home, "data", "products", productId, "od-project", "artifacts", artifactId, "v1", "preview");
    await mkdir(previewDir, { recursive: true });
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await writeFile(join(previewDir, "2x.png"), pngBytes);

    const store = fakeStore({
      home,
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-12345678",
          product_id: productId,
          status: "active",  // NOT archived
          pages: [],
          document_md: ""
        }))
      }
    });
    const app = await appWith(store);

    const response = await app.inject({
      method: "GET",
      url: `/api/products/${productId}/artifacts/${artifactId}/versions/1/preview/2x.png`
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.rawPayload).toEqual(pngBytes);
    // The route must NOT have called getRequirement (archive gate does not belong here)
    expect(store.requirements.getRequirement).not.toHaveBeenCalled();
  });

  it("GET artifact manifest returns 200 for an ACTIVE product artifact (no archive gate)", async () => {
    const store = fakeStore({
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-12345678",
          product_id: "P-123abc",
          status: "active",  // NOT archived
          pages: [],
          document_md: ""
        }))
      }
    });
    const app = await appWith(store);

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/artifacts/A-abcdef1234567890"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty("manifest");
    // getRequirement must NOT have been called by the artifact manifest route
    expect(store.requirements.getRequirement).not.toHaveBeenCalled();
  });

  it("GET artifact list returns 200 for a product with only ACTIVE requirements (no archive gate)", async () => {
    const store = fakeStore({
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-12345678",
          product_id: "P-123abc",
          status: "active",
          pages: [],
          document_md: ""
        }))
      }
    });
    const app = await appWith(store);

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/artifacts"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty("artifacts");
    expect(Array.isArray(body.artifacts)).toBe(true);
    // getRequirement must NOT have been called by the artifact list route
    expect(store.requirements.getRequirement).not.toHaveBeenCalled();
  });

  it("GET bundle + preview both return 200 after serving an active design (gate isolation)", async () => {
    // Composite regression: both file-serving routes succeed without calling
    // any archive/requirement check on the same active product.
    const home = await mkdtemp(join(tmpdir(), "forma-http-regress-composite-"));
    const productId = "P-123abc";
    const artifactId = "A-abcdef1234567890";
    const versionDir = join(home, "data", "products", productId, "od-project", "artifacts", artifactId, "v1");
    const previewDir = join(versionDir, "preview");
    await mkdir(previewDir, { recursive: true });
    await writeFile(join(versionDir, "index.html"), "<!doctype html><body>Ungated</body>", "utf8");
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(join(previewDir, "2x.png"), pngBytes);

    const requirementGetMock = vi.fn(async () => ({
      id: "R-12345678",
      product_id: productId,
      status: "active",
      pages: [],
      document_md: ""
    }));
    const store = fakeStore({
      home,
      requirements: {
        ...fakeStore().requirements,
        getRequirement: requirementGetMock
      }
    });
    const app = await appWith(store);

    const [bundleRes, previewRes] = await Promise.all([
      app.inject({ method: "GET", url: `/api/products/${productId}/artifacts/${artifactId}/versions/1/bundle/index.html` }),
      app.inject({ method: "GET", url: `/api/products/${productId}/artifacts/${artifactId}/versions/1/preview/2x.png` })
    ]);

    expect(bundleRes.statusCode).toBe(200);
    expect(previewRes.statusCode).toBe(200);
    // Neither route should have touched getRequirement
    expect(requirementGetMock).not.toHaveBeenCalled();
  });
});

describe("annotation handoff routes", () => {
  async function seedArchived(home: string) {
    const productsRoot = join(home, "data", "products");
    const PID = "P-abc123";
    const AID = "A-home";
    const iconsDir = join(productsRoot, PID, "od-project", "artifacts", AID, "icons");
    await mkdir(iconsDir, { recursive: true });
    await writeFile(
      join(iconsDir, "icons.json"),
      JSON.stringify({
        requirementId: "R-1", generatedFrom: "requirement-archive",
        pageId: "home", variant: "default", sourceVersion: 1, icons: [{}],
      }),
    );
    await writeFile(join(iconsDir, "logo.svg"), "<svg/>");
    const vziPath = getArtifactVziPath(productsRoot, PID, AID);
    await mkdir(join(vziPath, ".."), { recursive: true });
    await writeFile(vziPath, Buffer.from([7, 8, 9]));
    await mkdir(join(productsRoot, PID, "od-project", "artifacts", AID, "v1"), { recursive: true });
    await writeFile(join(productsRoot, PID, "od-project", "artifacts", AID, "v1", "index.html"), "<html/>");
    return { PID, AID };
  }

  function archivedStore(home: string, PID: string) {
    return fakeStore({
      home,
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({
          id: "R-1", product_id: PID, status: "archived",
          pages: [{ page_id: "home", name: "Home" }],
        })),
      },
    } as Partial<FormaServerStore>);
  }

  it("GET /handoff lists archived pages with resource URLs", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-srv-"));
    const { PID } = await seedArchived(home);
    const app = await buildServer({ store: archivedStore(home, PID) });
    apps.push(app);
    await app.ready();
    const res = await app.inject({ method: "GET", url: `/api/products/${PID}/requirements/R-1/handoff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0]).toMatchObject({
      pageId: "home", artifactId: "A-home", variant: "default", version: 1,
      vziUrl: `/api/products/${PID}/artifacts/A-home/vzi/page.vzi`,
      iconBaseUrl: `/api/products/${PID}/artifacts/A-home/icons/`,
      bundleBaseUrl: `/api/products/${PID}/artifacts/A-home/versions/1/bundle/`,
    });
    expect(body.errors).toEqual([]);
  });

  it("GET /handoff still lists a page whose VZI is missing so the page can fail independently", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-srv-"));
    const { PID, AID } = await seedArchived(home);
    await rm(getArtifactVziPath(join(home, "data", "products"), PID, AID), { force: true });
    const app = await buildServer({ store: archivedStore(home, PID) });
    apps.push(app);
    await app.ready();

    const list = await app.inject({ method: "GET", url: `/api/products/${PID}/requirements/R-1/handoff` });
    expect(list.statusCode).toBe(200);
    expect(list.json().pages).toHaveLength(1);
    expect(list.json().errors).toEqual([]);

    const missingVzi = await app.inject({ method: "GET", url: `/api/products/${PID}/artifacts/${AID}/vzi/page.vzi` });
    expect(missingVzi.statusCode).toBe(404);
  });

  it("GET /handoff 409s when the requirement is not archived", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-srv-"));
    const PID = "P-abc123";
    const app = await buildServer({ store: fakeStore({
      home,
      requirements: {
        ...fakeStore().requirements,
        getRequirement: vi.fn(async () => ({ id: "R-1", product_id: PID, status: "active", pages: [] })),
      },
    } as Partial<FormaServerStore>) });
    apps.push(app);
    await app.ready();
    const res = await app.inject({ method: "GET", url: `/api/products/${PID}/requirements/R-1/handoff` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error_code).toBe("REQUIREMENT_NOT_FINALIZED");
  });

  it("GET vzi binary returns octet-stream bytes", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-srv-"));
    const { PID, AID } = await seedArchived(home);
    const app = await buildServer({ store: archivedStore(home, PID) });
    apps.push(app);
    await app.ready();
    const res = await app.inject({ method: "GET", url: `/api/products/${PID}/artifacts/${AID}/vzi/page.vzi` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/octet-stream");
    expect(res.rawPayload).toEqual(Buffer.from([7, 8, 9]));
  });

  it("GET icons/* serves an svg and rejects traversal", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-srv-"));
    const { PID, AID } = await seedArchived(home);
    const app = await buildServer({ store: archivedStore(home, PID) });
    apps.push(app);
    await app.ready();
    const ok = await app.inject({ method: "GET", url: `/api/products/${PID}/artifacts/${AID}/icons/logo.svg` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toContain("image/svg+xml");

    const escape = await app.inject({ method: "GET", url: `/api/products/${PID}/artifacts/${AID}/icons/..%2f..%2fmanifest.json` });
    expect(escape.statusCode).toBe(400);

    const missing = await app.inject({ method: "GET", url: `/api/products/${PID}/artifacts/${AID}/icons/nope.svg` });
    expect(missing.statusCode).toBe(404);
  });

  it("GET /handoff exposes a decoded-content URL per page", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-srv-"));
    const { PID } = await seedArchived(home);
    const app = await buildServer({ store: archivedStore(home, PID) });
    apps.push(app);
    await app.ready();
    const res = await app.inject({ method: "GET", url: `/api/products/${PID}/requirements/R-1/handoff` });
    expect(res.json().pages[0].contentUrl).toBe(`/api/products/${PID}/artifacts/A-home/vzi/content`);
  });

  it("GET vzi/content returns decoded JSON (metadata + element/image entries)", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-srv-"));
    const productsRoot = join(home, "data", "products");
    const PID = "P-abc123";
    const AID = "A-home";
    await seedArchived(home);
    const map = new Map<string, unknown>([
      ["root", { id: "root", parentId: null, type: "container", bounds: { x: 0, y: 0, width: 320, height: 640 }, styles: {} }],
    ]);
    const source = {
      header: {}, metadata: { formaViewport: { width: 320, height: 640 } }, elements: map, sharedStyles: new Map(),
      spatialIndex: new SpatialIndexBuilder().build(map as never), colorTokens: [], fontTokens: [], annotations: [],
      images: new Map(), layers: [], compatibility: { minReaderVersion: "2.0.0", formatVersion: "2.0.0", features: [] },
    };
    await writeFile(getArtifactVziPath(productsRoot, PID, AID), Buffer.from(new VZIEncoder().encode(source as never)));
    const app = await buildServer({ store: archivedStore(home, PID) });
    apps.push(app);
    await app.ready();
    const res = await app.inject({ method: "GET", url: `/api/products/${PID}/artifacts/${AID}/vzi/content` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metadata.formaViewport.width).toBe(320);
    expect(body.elements.map((e: [string, unknown]) => e[0])).toContain("root");
  });

  it("GET vzi/content 404s when the file is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-srv-"));
    const { PID, AID } = await seedArchived(home);
    await rm(getArtifactVziPath(join(home, "data", "products"), PID, AID), { force: true });
    const app = await buildServer({ store: archivedStore(home, PID) });
    apps.push(app);
    await app.ready();
    const res = await app.inject({ method: "GET", url: `/api/products/${PID}/artifacts/${AID}/vzi/content` });
    expect(res.statusCode).toBe(404);
  });

  it("GET vzi/content 400s on an invalid product/artifact id", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-srv-"));
    const { PID } = await seedArchived(home);
    const app = await buildServer({ store: archivedStore(home, PID) });
    apps.push(app);
    await app.ready();
    // artifact id containing '!' fails ARTIFACT_ID_PATTERN validation in getArtifactVziPath → 400
    const res = await app.inject({ method: "GET", url: `/api/products/${PID}/artifacts/A-home%21/vzi/content` });
    expect(res.statusCode).toBe(400);
  });
});

describe("api bearer auth (non-loopback protection)", () => {
  it("rejects /api requests without a bearer token when authToken is set", async () => {
    const app = await buildServer({ store: fakeStore(), authToken: "s3cret" });
    apps.push(app);
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/products" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error_code).toBe("UNAUTHORIZED");
  });

  it("rejects an incorrect bearer token", async () => {
    const app = await buildServer({ store: fakeStore(), authToken: "s3cret" });
    apps.push(app);
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/products",
      headers: { authorization: "Bearer wrong" }
    });
    expect(res.statusCode).toBe(401);
  });

  it("allows /api requests carrying the correct bearer token", async () => {
    const app = await buildServer({ store: fakeStore(), authToken: "s3cret" });
    apps.push(app);
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/products",
      headers: { authorization: "Bearer s3cret" }
    });
    expect(res.statusCode).not.toBe(401);
  });

  it("leaves non-api routes open even when authToken is set", async () => {
    const app = await buildServer({ store: fakeStore(), authToken: "s3cret" });
    apps.push(app);
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).not.toBe(401);
  });

  it("serves /api unauthenticated when no authToken is configured (loopback default)", async () => {
    const app = await buildServer({ store: fakeStore() });
    apps.push(app);
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/products" });
    expect(res.statusCode).not.toBe(401);
  });
});

describe("requireAuthTokenForHost / isLoopbackHost", () => {
  it("treats loopback hosts as safe (no token required)", () => {
    for (const host of ["127.0.0.1", "::1", "localhost", "127.5.0.1", "::ffff:127.0.0.1"]) {
      expect(isLoopbackHost(host)).toBe(true);
      expect(requireAuthTokenForHost(host, undefined)).toBeUndefined();
    }
  });

  it("respects a configured token on loopback hosts", () => {
    expect(requireAuthTokenForHost("127.0.0.1", "  tok  ")).toBe("tok");
  });

  it("requires a non-empty token for exposed hosts and fails loud otherwise", () => {
    for (const host of ["", "0.0.0.0", "::", "192.168.1.10", "10.0.0.5"]) {
      expect(isLoopbackHost(host)).toBe(false);
      expect(() => requireAuthTokenForHost(host, undefined)).toThrow(/FORMA_SERVER_TOKEN/);
      expect(() => requireAuthTokenForHost(host, "   ")).toThrow();
      expect(requireAuthTokenForHost(host, "tok")).toBe("tok");
    }
  });
});
