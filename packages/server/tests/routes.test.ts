import { createHash } from "node:crypto";
import { createFormaStore, FormaError, normalizeFormaHomeForV6, readYamlUnknown, writeYamlAtomic, type FormaStore, type ProductDeletionState } from "@xenonbyte/forma-core";
import { access, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer, type FormaServer, type FormaServerStore } from "../src/app.js";
import type { ArtifactManifest } from "@xenonbyte/forma-core";

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
          kind: "page_design",
          title: "Checkout Design",
          updatedAt: "2026-05-17T00:00:00.000Z",
          sourceSkillId: "design-skill-1",
          requirementId: "R-12345678",
          supportingFiles: []
        } as ArtifactManifest,
        etag: `"${createHash("sha256").update(artifactId).digest("hex")}"`
      })),
      listArtifacts: vi.fn(async () => [{ artifactId: "A-abcdef1234567890" }])
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
              design_status: "done"
            }
          ]
        }
      ]),
      saveRequirement: vi.fn(async (input: { requirement_id: string }) => ({ id: input.requirement_id, status: "submitted", ...input })),
      submitRequirement: vi.fn(async () => ({ id: "R-12345678", status: "submitted" }))
    },
    sessions: {
      getCurrentSession: vi.fn(async () => ({ current_product: "P-123abc" }))
    },
    recoverPendingProductDeletes: vi.fn(async () => ({ recovered: 0, cleaned: 0, warnings: [] })),
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
    style: {
      name: "linear",
      description: "Focused tool UI",
      design_md_path: "styles/linear/DESIGN.md",
      variables: store.styles.withDefaultVariables({ primary: "#5E6AD2" })
    }
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

async function seedLegacyRuntime(
  home: string,
  options: { productPatch?: Record<string, unknown>; pagePatch?: Record<string, unknown> } = {}
): Promise<void> {
  const createdAt = "2026-05-21T00:00:00.000Z";
  await writeYamlAtomic(join(home, "data", "products.yaml"), {
    products: [{ id: "P-123abc", name: "Shop", description: "Shop app" }]
  });
  await writeYamlAtomic(join(home, "data", "P-123abc", "product.yaml"), {
    id: "P-123abc",
    name: "Shop",
    description: "Shop app",
    ...options.productPatch
  });
  await writeYamlAtomic(join(home, "data", "P-123abc", "R-11111111", "requirement.yaml"), {
    id: "R-11111111",
    product_id: "P-123abc",
    title: "Login",
    status: "submitted",
    ui_affected: true,
    created_at: createdAt,
    updated_at: createdAt,
    pages: [
      {
        page_id: "login",
        name: "Login",
        baseline_page: "login",
        design_status: "pending",
        copy: [{ context: "cta", text: "Sign in" }],
        ...options.pagePatch
      }
    ],
    navigation: []
  });
  await writeYamlAtomic(join(home, "data", "P-123abc", "baseline", "baseline.yaml"), {
    product_id: "P-123abc",
    pages: [
      {
        id: "login",
        name: "Login",
        features: "",
        copy: [{ context: "cta", text: "Sign in" }],
        fields: "free-text field notes",
        interactions: "free-text interaction notes",
        source_requirements: ["R-11111111"]
      }
    ],
    navigation: []
  });
}

async function rewriteManifestEntryHash(home: string, backupDir: string, runtimePath: string, content: string): Promise<void> {
  const manifestFile = join(backupDir, "manifest.yaml");
  const manifest = await readYamlUnknown(manifestFile) as Record<string, unknown>;
  const files = manifest.files as Array<Record<string, unknown>>;
  for (const file of files) {
    if (file.runtime_path === runtimePath) {
      file.sha256 = sha256Text(content);
      file.file_size = Buffer.byteLength(content);
    }
  }
  manifest.manifest_hash = hashUnknownForTest({ files, normalizer_version: manifest.normalizer_version });
  await writeYamlAtomic(manifestFile, manifest);
  const journalFile = join(backupDir, "normalization-journal.yaml");
  const journal = await readYamlUnknown(journalFile) as Record<string, unknown>;
  journal.manifest_hash = manifest.manifest_hash;
  await writeYamlAtomic(journalFile, journal);
}

function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hashUnknownForTest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringifyForTest(value)).digest("hex")}`;
}

function stableStringifyForTest(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyForTest(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringifyForTest(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
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

async function homeWithPreview(files: string[] = ["preview@2x.png", "preview.v1@2x.png"]) {
  const home = await mkdtemp(join(tmpdir(), "forma-server-routes-"));
  await mkdir(join(home, "data", "P-123abc", "R-12345678", "previews"), { recursive: true });
  await writeFile(join(home, "data", "P-123abc", "R-12345678", "design.pen"), "canvas");
  await writeFile(
    join(home, "data", "P-123abc", "R-12345678", "design.yaml"),
    [
      "schema_version: 1",
      "product_id: P-123abc",
      "requirement_id: R-12345678",
      "canvas_file: design.pen",
      "canvas_version: 1",
      "pages:",
      "  - page_id: checkout-page",
      "    status: done",
      "    preview_file: previews/checkout-page@2x.png",
      "    page_version: 1",
      "history: []",
      ""
    ].join("\n")
  );
  for (const file of files) {
    const previewPath = join(home, "data", "P-123abc", "R-12345678", "previews", file === "preview@2x.png" ? "checkout-page@2x.png" : file);
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

  it("initializes product config with style metadata, platform, languages, and default language", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({
      method: "POST",
      url: "/api/products/P-123abc/config",
      payload: {
        platform: "web",
        style: "linear",
        languages: ["zh-CN", "en"],
        default_language: "zh-CN"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(store.styles.getStyle).toHaveBeenCalledWith("linear");
    expect(store.products.initProductConfig).toHaveBeenCalledWith("P-123abc", {
      platform: "web",
      style: {
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
      submitRequirement: vi.fn(async () => ({ id: "R-12345678", status: "submitted" }))
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
    expect(requirements.submitRequirement).not.toHaveBeenCalled();
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
    expect(response.json()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "linear" })]));
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
      kind: "page_design",
      title: "Checkout Design",
      updated_at: "2026-05-17T00:00:00.000Z"
    });
    expect(body.artifacts[0].preview_url).toContain("P-123abc");
    expect(body.artifacts[0].preview_url).toContain("A-abcdef1234567890");
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
    expect(body).toHaveProperty("preview_url");
    expect(body.manifest.kind).toBe("page_design");
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
      app.inject({ method: "GET", url: "/api/products/P-123abc/baseline" }),
      app.inject({ method: "POST", url: "/api/styles/sync" }),
      app.inject({ method: "GET", url: "/api/styles/linear/preview" })
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
    }
  });
});
