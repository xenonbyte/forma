import { createHash } from "node:crypto";
import { createFormaStore, FormaError, normalizeFormaHomeForV6, readYamlUnknown, writeYamlAtomic, type FormaStore, type ProductDeletionState } from "@xenonbyte/forma-core";
import { access, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer, type FormaServer, type FormaServerStore } from "../src/app.js";

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

type V6RouteMocks = Record<string, ReturnType<typeof vi.fn>>;

function fakeStore(overrides: Partial<FormaServerStore> = {}): FormaServerStore {
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
      getProduct: vi.fn(async () => ({ id: "P-123abc", name: "App", description: "Demo" })),
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
    sync: {
      recoverFromCrash: vi.fn(async () => undefined),
      startSync: vi.fn(async () => ({
        task_id: "sync-test",
        status: "running",
        started_at: "2026-05-18T00:00:00.000Z",
        progress: { phase: "git_clone", current: 0, total: 4 }
      })),
      getStatus: vi.fn(async () => ({ status: "idle" }))
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

async function appWithV6(v6: V6RouteMocks, home = "/tmp/forma") {
  const store = fakeStore({ home }) as FormaServerStore & { v6: V6RouteMocks };
  store.v6 = v6;
  return appWith(store);
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

  it("recovery routes recover journals, restore backups, and reject path escapes", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-recovery-routes-"));
    await seedLegacyRuntime(home, { productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt: "2026-05-21T00:00:00.000Z" });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
    await writeFile(join(home, ".v6-schema-cutover-active"), "active\n", "utf8");
    const backupRoot = join(home, "normalization-backups");
    const backupDir = join(backupRoot, (await readdir(backupRoot))[0]!);
    const app = await buildServer({ home, bundledStylesDir: resolve("styles") });
    apps.push(app);
    await app.ready();

    const escape = await app.inject({
      method: "POST",
      url: "/api/recovery/schema-normalization/recover-journal",
      payload: { backup_dir: join(home, "normalization-backups", "..") }
    });
    const recover = await app.inject({
      method: "POST",
      url: "/api/recovery/schema-normalization/recover-journal",
      payload: { backup_dir: backupDir }
    });
    const missingConfirm = await app.inject({
      method: "POST",
      url: "/api/recovery/schema-normalization/restore-backup",
      payload: { backup_dir: backupDir }
    });
    const restore = await app.inject({
      method: "POST",
      url: "/api/recovery/schema-normalization/restore-backup",
      payload: { backup_dir: backupDir, confirm: "restore_v6_backup" }
    });

    expect(escape.statusCode).toBe(400);
    expect(escape.json()).toMatchObject({ error_code: "INVALID_INPUT" });
    expect(recover.statusCode).toBe(200);
    expect(recover.json()).toMatchObject({ status: "restored" });
    expect(missingConfirm.statusCode).toBe(400);
    expect(missingConfirm.json()).toMatchObject({ error_code: "INVALID_INPUT" });
    expect(restore.statusCode).toBe(200);
    expect(restore.json()).toMatchObject({ status: "restored" });
    const product = await readYamlUnknown(join(home, "data", "P-123abc", "product.yaml")) as Record<string, unknown>;
    expect(product).toHaveProperty("components_initialized", true);
  });

  it("resolves relative backup_dir payloads from the current Forma home", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-recovery-relative-backup-"));
    await seedLegacyRuntime(home, { productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt: "2026-05-21T00:00:00.000Z" });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
    await writeFile(join(home, ".v6-schema-cutover-active"), "active\n", "utf8");
    const backupRoot = join(home, "normalization-backups");
    const relativeBackupDir = `normalization-backups/${(await readdir(backupRoot))[0]!}`;
    const app = await buildServer({ home, bundledStylesDir: resolve("styles") });
    apps.push(app);
    await app.ready();

    const recover = await app.inject({
      method: "POST",
      url: "/api/recovery/schema-normalization/recover-journal",
      payload: { backup_dir: relativeBackupDir }
    });
    const rejected = await app.inject({
      method: "POST",
      url: "/api/recovery/schema-normalization/recover-journal",
      payload: { backup_dir: "../normalization-backups/v6-2026-05-21T01:00:00.000Z" }
    });

    expect(recover.statusCode).toBe(200);
    expect(recover.json()).toMatchObject({ status: "restored", backup_dir: relativeBackupDir });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ error_code: "INVALID_INPUT" });
  });

  it("serves requirement and baseline routes after cutover adds semantic contracts", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-post-cutover-read-"));
    await seedLegacyRuntime(home, { productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt: "2026-05-21T00:00:00.000Z" });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
    const app = await buildServer({ home, bundledStylesDir: resolve("styles") });
    apps.push(app);
    await app.ready();

    const requirement = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/requirements/R-11111111"
    });
    const baseline = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/baseline"
    });

    expect(requirement.statusCode).toBe(200);
    expect(requirement.json()).toMatchObject({
      pages: [
        expect.objectContaining({
          page_id: "login",
          semantic_contract_coverage: "minimal",
          semantic_contract: expect.objectContaining({ fields: [], actions: [], navigation: [], component_keys: [] })
        })
      ]
    });
    expect(baseline.statusCode).toBe(200);
    expect(baseline.json()).toMatchObject({
      pages: [
        expect.objectContaining({
          id: "login",
          semantic_contract_coverage: "minimal",
          semantic_contract: expect.objectContaining({ fields: [], actions: [], navigation: [], component_keys: [] })
        })
      ]
    });
  });

  it("recovery route returns recovery-required details for manifest hash mismatch", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-recovery-manifest-mismatch-"));
    await seedLegacyRuntime(home, { productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt: "2026-05-21T00:00:00.000Z" });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
    await writeFile(join(home, ".v6-schema-cutover-active"), "active\n", "utf8");
    const backupRoot = join(home, "normalization-backups");
    const backupDir = join(backupRoot, (await readdir(backupRoot))[0]!);
    await writeYamlAtomic(join(backupDir, "manifest.yaml"), {
      manifest_hash: "sha256:wrong",
      normalizer_version: "v6-stage-01",
      files: []
    });
    const app = await buildServer({ home, bundledStylesDir: resolve("styles") });
    apps.push(app);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/recovery/schema-normalization/recover-journal",
      payload: { backup_dir: backupDir }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error_code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
      details: {
        restore_status: "manifest_unavailable",
        failed_files: [
          expect.objectContaining({
            reason: expect.stringContaining("manifest hash mismatch")
          })
        ]
      }
    });
  });

  it("restore route returns recovery-required details for old-schema smoke failures", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-recovery-old-schema-smoke-"));
    await seedLegacyRuntime(home, { productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt: "2026-05-21T00:00:00.000Z" });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
    await writeFile(join(home, ".v6-schema-cutover-active"), "active\n", "utf8");
    const backupRoot = join(home, "normalization-backups");
    const backupDir = join(backupRoot, (await readdir(backupRoot))[0]!);
    const backupProduct = join(backupDir, "data", "P-123abc", "product.yaml");
    await writeFile(backupProduct, "id: 123\nname: false\n", "utf8");
    await rewriteManifestEntryHash(home, backupDir, "data/P-123abc/product.yaml", "id: 123\nname: false\n");
    const app = await buildServer({ home, bundledStylesDir: resolve("styles") });
    apps.push(app);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/recovery/schema-normalization/restore-backup",
      payload: { backup_dir: backupDir, confirm: "restore_v6_backup" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error_code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
      details: {
        restore_status: "restore_failed",
        failed_files: [
          expect.objectContaining({
            reason: expect.stringContaining("old schema smoke")
          })
        ]
      }
    });
  });

  it("recovery route returns recovery-required details for corrupt journals", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-recovery-corrupt-journal-"));
    await seedLegacyRuntime(home, { productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt: "2026-05-21T00:00:00.000Z" });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
    await writeFile(join(home, ".v6-schema-cutover-active"), "active\n", "utf8");
    const backupRoot = join(home, "normalization-backups");
    const backupDir = join(backupRoot, (await readdir(backupRoot))[0]!);
    await writeFile(join(backupDir, "normalization-journal.yaml"), "[\n", "utf8");
    const app = await buildServer({ home, bundledStylesDir: resolve("styles") });
    apps.push(app);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/recovery/schema-normalization/recover-journal",
      payload: { backup_dir: backupDir }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error_code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
      details: {
        restore_status: "manifest_unavailable",
        failed_files: [
          expect.objectContaining({
            reason: expect.stringContaining("journal")
          })
        ]
      }
    });
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
    const home = await homeWithPreview();
    const app = await appWith(fakeStore({ home }));

    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/api/products/P-123abc" }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/requirements" }),
      app.inject({
        method: "POST",
        url: "/api/products/P-123abc/requirements",
        payload: { title: "Checkout" }
      }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/requirements/R-12345678" }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/baseline" }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/baseline/pages/checkout/image" }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/baseline/pages/checkout/annotations" }),
      app.inject({ method: "GET", url: "/api/styles" }),
      app.inject({ method: "GET", url: "/api/styles/linear/preview" })
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual(Array(responses.length).fill(200));
  });

  it("registers v6 requirement design and product component route families", async () => {
    const v6: V6RouteMocks = {
      getRequirementDesign: vi.fn(async (home, productId, requirementId) => ({ service: "getRequirementDesign", home, productId, requirementId })),
      indexRequirementDesignCanvas: vi.fn(async (input) => ({ service: "indexRequirementDesignCanvas", input })),
      getRequirementDesignScene: vi.fn(async (input) => ({ service: "getRequirementDesignScene", input })),
      getRequirementDesignHistory: vi.fn(async (input) => ({ service: "getRequirementDesignHistory", input })),
      exportRequirementDesignAsset: vi.fn(async (input) => ({ service: "exportRequirementDesignAsset", input })),
      diffRequirementDesignVersions: vi.fn(async (input) => ({ service: "diffRequirementDesignVersions", input })),
      beginRequirementDesignSession: vi.fn(async (input) => ({ service: "beginRequirementDesignSession", input })),
      applyRequirementDesignOperations: vi.fn(async (input) => ({ service: "applyRequirementDesignOperations", input })),
      runDesignQualityPipeline: vi.fn(async (input) => ({ service: "runDesignQualityPipeline", input })),
      refreshRequirementComponents: vi.fn(async (input) => ({ service: "refreshRequirementComponents", input })),
      planImportMetadataNormalization: vi.fn(async (input) => ({ service: "planImportMetadataNormalization", input })),
      rollbackRequirementDesign: vi.fn(async (input) => ({ service: "rollbackRequirementDesign", input })),
      commitRequirementDesignSession: vi.fn(async (input) => ({ service: "commitRequirementDesignSession", input })),
      discardRequirementDesignSession: vi.fn(async (input) => ({ service: "discardRequirementDesignSession", input })),
      getProductComponentLibrary: vi.fn(async (home, productId) => ({ service: "getProductComponentLibrary", home, productId })),
      beginProductComponentSession: vi.fn(async (input) => ({ service: "beginProductComponentSession", input })),
      applyProductComponentOperations: vi.fn(async (input) => ({ service: "applyProductComponentOperations", input })),
      commitProductComponentSession: vi.fn(async (input) => ({ service: "commitProductComponentSession", input })),
      discardProductComponentSession: vi.fn(async (input) => ({ service: "discardProductComponentSession", input })),
      recoverDesignCommitJournal: vi.fn(async (input) => ({ service: "recoverDesignCommitJournal", input }))
    };
    const app = await appWithV6(v6);
    const sessionId = "S-1234567890abcdef";

    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/api/products/P-123abc/requirements/R-12345678/design/canvas" }),
      app.inject({ method: "POST", url: "/api/products/P-123abc/requirements/R-12345678/design/index" }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/requirements/R-12345678/design/scene" }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/requirements/R-12345678/design/history?page_id=checkout-page" }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/requirements/R-12345678/design/export?node_id=frame-1&format=png" }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/requirements/R-12345678/design/diff?page_id=checkout-page&from_page_version=1&to_page_version=2" }),
      app.inject({
        method: "POST",
        url: "/api/products/P-123abc/requirements/R-12345678/design/session/begin",
        payload: { operation: "generate", page_id: "checkout-page" }
      }),
      app.inject({
        method: "POST",
        url: `/api/products/P-123abc/requirements/R-12345678/design/session/${sessionId}/operations`,
        payload: { operations: [{ tool: "batch_design", args: { node_id: "frame-1" }, intent: "generate" }] }
      }),
      app.inject({
        method: "POST",
        url: `/api/products/P-123abc/requirements/R-12345678/design/session/${sessionId}/quality`,
        payload: { page_id: "checkout-page", frame_id: "frame-1" }
      }),
      app.inject({
        method: "POST",
        url: `/api/products/P-123abc/requirements/R-12345678/design/session/${sessionId}/component-refresh/plan`,
        payload: { version: "latest", scope: "all_pages" }
      }),
      app.inject({
        method: "POST",
        url: `/api/products/P-123abc/requirements/R-12345678/design/session/${sessionId}/import-metadata-normalization/plan`,
        payload: { page_id: "checkout-page", frame_id: "frame-1" }
      }),
      app.inject({
        method: "POST",
        url: `/api/products/P-123abc/requirements/R-12345678/design/session/${sessionId}/rollback/plan`,
        payload: { canvas_version: 1 }
      }),
      app.inject({
        method: "POST",
        url: `/api/products/P-123abc/requirements/R-12345678/design/session/${sessionId}/commit`,
        payload: {
          page_id: "checkout-page",
          frame_id: "frame-1",
          quality_report: { status: "passed", hard_checks: { issues: [] }, warnings: [] }
        }
      }),
      app.inject({ method: "POST", url: `/api/products/P-123abc/requirements/R-12345678/design/session/${sessionId}/discard` }),
      app.inject({ method: "GET", url: "/api/products/P-123abc/component-library" }),
      app.inject({
        method: "POST",
        url: "/api/products/P-123abc/component-library/session/begin",
        payload: { operation: "generate", seed_components: [{ component_key: "button-primary" }] }
      }),
      app.inject({
        method: "POST",
        url: `/api/products/P-123abc/component-library/session/${sessionId}/operations`,
        payload: { operations: [{ tool: "set_variables", args: { primary: "#111111" }, intent: "change_style" }] }
      }),
      app.inject({ method: "POST", url: `/api/products/P-123abc/component-library/session/${sessionId}/commit` }),
      app.inject({ method: "POST", url: `/api/products/P-123abc/component-library/session/${sessionId}/discard` }),
      app.inject({
        method: "POST",
        url: `/api/products/P-123abc/design/session/${sessionId}/recover-commit-journal`,
        payload: { scope: "requirement_canvas" }
      })
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual(Array(responses.length).fill(200));
    expect(v6.getRequirementDesign).toHaveBeenCalledWith("/tmp/forma", "P-123abc", "R-12345678");
    expect(v6.indexRequirementDesignCanvas).toHaveBeenCalledWith({ home: "/tmp/forma", product_id: "P-123abc", requirement_id: "R-12345678" });
    expect(v6.getRequirementDesignHistory).toHaveBeenCalledWith({
      home: "/tmp/forma",
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout-page"
    });
    expect(v6.exportRequirementDesignAsset).toHaveBeenCalledWith({
      home: "/tmp/forma",
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      node_id: "frame-1",
      format: "png"
    });
    expect(v6.diffRequirementDesignVersions).toHaveBeenCalledWith({
      home: "/tmp/forma",
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      page_id: "checkout-page",
      from_page_version: 1,
      to_page_version: 2
    });
    expect(v6.beginRequirementDesignSession).toHaveBeenCalledWith({
      home: "/tmp/forma",
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      operation: "generate",
      page_id: "checkout-page"
    });
    expect(v6.applyRequirementDesignOperations).toHaveBeenCalledWith({
      home: "/tmp/forma",
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      session_id: sessionId,
      operations: [{ tool: "batch_design", args: { node_id: "frame-1" }, intent: "generate" }]
    });
    expect(v6.runDesignQualityPipeline).toHaveBeenCalledWith({
      home: "/tmp/forma",
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      session_id: sessionId,
      page_id: "checkout-page",
      frame_id: "frame-1"
    });
    expect(v6.refreshRequirementComponents).toHaveBeenCalledWith({
      home: "/tmp/forma",
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      session_id: sessionId,
      version: "latest",
      scope: "all_pages"
    });
    expect(v6.planImportMetadataNormalization).toHaveBeenCalledWith({
      home: "/tmp/forma",
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      session_id: sessionId,
      page_id: "checkout-page",
      frame_id: "frame-1"
    });
    expect(v6.rollbackRequirementDesign).toHaveBeenCalledWith({
      home: "/tmp/forma",
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      session_id: sessionId,
      canvas_version: 1
    });
    expect(v6.commitRequirementDesignSession).toHaveBeenCalledWith({
      home: "/tmp/forma",
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      session_id: sessionId,
      page_id: "checkout-page",
      frame_id: "frame-1",
      quality_report: { status: "passed", hard_checks: { issues: [] }, warnings: [] }
    });
    expect(v6.discardRequirementDesignSession).toHaveBeenCalledWith({
      home: "/tmp/forma",
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      session_id: sessionId
    });
    expect(v6.getProductComponentLibrary).toHaveBeenCalledWith("/tmp/forma", "P-123abc");
    expect(v6.beginProductComponentSession).toHaveBeenCalledWith({
      home: "/tmp/forma",
      product_id: "P-123abc",
      operation: "generate",
      seed_components: [{ component_key: "button-primary" }]
    });
    expect(v6.applyProductComponentOperations).toHaveBeenCalledWith({
      home: "/tmp/forma",
      product_id: "P-123abc",
      session_id: sessionId,
      operations: [{ tool: "set_variables", args: { primary: "#111111" }, intent: "change_style" }]
    });
    expect(v6.commitProductComponentSession).toHaveBeenCalledWith({ home: "/tmp/forma", product_id: "P-123abc", session_id: sessionId });
    expect(v6.discardProductComponentSession).toHaveBeenCalledWith({ home: "/tmp/forma", product_id: "P-123abc", session_id: sessionId });
    expect(v6.recoverDesignCommitJournal).toHaveBeenCalledWith({
      home: "/tmp/forma",
      product_id: "P-123abc",
      session_id: sessionId,
      scope: "requirement_canvas"
    });
  });

  it("serves requirement-level design preview files from v6 metadata", async () => {
    const home = await homeWithPreview();
    const app = await appWith(fakeStore({ home }));

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/requirements/R-12345678/design/preview/checkout-page/file"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.body).toBe("preview");
  });

  it("returns active product and requirement design session leases", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-v6-active-session-"));
    await mkdir(join(home, "data", "P-123abc", "sessions"), { recursive: true });
    await mkdir(join(home, "data", "P-123abc", "R-12345678", "sessions"), { recursive: true });
    await writeYamlAtomic(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"), {
      session_id: "S-1234567890abcdef",
      scope: "requirement_canvas",
      owner_path: "data/P-123abc/R-12345678/sessions/active.yaml",
      local_active_path: "data/P-123abc/R-12345678/sessions/active.yaml",
      canvas_path: "data/P-123abc/R-12345678/design.pen",
      staging_path: "data/P-123abc/R-12345678/sessions/S-1234567890abcdef/staging.design.pen",
      operation: "generate",
      page_id: "checkout-page",
      pencil_binding_id: "binding-1",
      pid: 12345,
      status: "running",
      updated_at: "2026-05-21T00:00:00.000Z"
    });
    await writeYamlAtomic(join(home, "data", "P-123abc", "R-12345678", "sessions", "active.yaml"), {
      session_id: "S-1234567890abcdef",
      scope: "requirement_canvas",
      canvas_path: "data/P-123abc/R-12345678/design.pen",
      staging_path: "data/P-123abc/R-12345678/sessions/S-1234567890abcdef/staging.design.pen",
      operation: "generate",
      page_id: "checkout-page",
      status: "running",
      updated_at: "2026-05-21T00:00:00.000Z"
    });
    const app = await appWith(fakeStore({ home }));

    const productLease = await app.inject({ method: "GET", url: "/api/products/P-123abc/design/session/active" });
    const requirementLease = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/requirements/R-12345678/design/session/active"
    });

    expect(productLease.statusCode).toBe(200);
    expect(productLease.json()).toMatchObject({
      product_id: "P-123abc",
      session_id: "S-1234567890abcdef",
      scope: "requirement_canvas",
      status: "running",
      canvas_path: "data/P-123abc/R-12345678/design.pen",
      staging_path: "data/P-123abc/R-12345678/sessions/S-1234567890abcdef/staging.design.pen"
    });
    expect(productLease.json().elapsed_ms).toEqual(expect.any(Number));
    expect(requirementLease.statusCode).toBe(200);
    expect(requirementLease.json()).toMatchObject({
      product_id: "P-123abc",
      requirement_id: "R-12345678",
      session_id: "S-1234567890abcdef",
      status: "running"
    });
  });

  it("rejects forbidden path fields in v6 mutation payloads before calling services", async () => {
    const forbiddenPathFields = ["canvas_path", "staging_path", "path", "outputDir", "pen_path", "preview_path"];
    const v6: V6RouteMocks = {
      applyRequirementDesignOperations: vi.fn(async (input) => ({ service: "applyRequirementDesignOperations", input }))
    };
    const app = await appWithV6(v6);

    for (const field of forbiddenPathFields) {
      const response = await app.inject({
        method: "POST",
        url: "/api/products/P-123abc/requirements/R-12345678/design/session/S-1234567890abcdef/operations",
        payload: {
          operations: [
            {
              tool: "batch_design",
              args: { node_id: "frame-1", [field]: "/tmp/agent-owned" },
              intent: "generate"
            }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error_code: "FORBIDDEN_PATH_PARAMETER",
        details: { parameter: `operations.0.args.${field}` }
      });
    }
    expect(v6.applyRequirementDesignOperations).not.toHaveBeenCalled();
  });

  it("rejects v6 body and path id mismatches before calling services", async () => {
    const v6: V6RouteMocks = {
      beginRequirementDesignSession: vi.fn(async (input) => ({ service: "beginRequirementDesignSession", input })),
      applyRequirementDesignOperations: vi.fn(async (input) => ({ service: "applyRequirementDesignOperations", input }))
    };
    const app = await appWithV6(v6);

    const productMismatch = await app.inject({
      method: "POST",
      url: "/api/products/P-123abc/requirements/R-12345678/design/session/begin",
      payload: { product_id: "P-other1", requirement_id: "R-12345678", operation: "generate" }
    });
    const requirementMismatch = await app.inject({
      method: "POST",
      url: "/api/products/P-123abc/requirements/R-12345678/design/session/begin",
      payload: { product_id: "P-123abc", requirement_id: "R-deadbeef", operation: "generate" }
    });
    const sessionMismatch = await app.inject({
      method: "POST",
      url: "/api/products/P-123abc/requirements/R-12345678/design/session/S-1234567890abcdef/operations",
      payload: {
        session_id: "S-fedcba0987654321",
        operations: [{ tool: "batch_design", args: { node_id: "frame-1" }, intent: "generate" }]
      }
    });

    for (const response of [productMismatch, requirementMismatch, sessionMismatch]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error_code: "INVALID_INPUT" });
    }
    expect(v6.beginRequirementDesignSession).not.toHaveBeenCalled();
    expect(v6.applyRequirementDesignOperations).not.toHaveBeenCalled();
  });

  it("starts style sync and returns an accepted task response", async () => {
    const store = fakeStore();
    const app = await appWith(store);

    const response = await app.inject({ method: "POST", url: "/api/styles/sync" });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      task_id: "sync-test",
      status: "running",
      message: "Style sync started"
    });
    expect(store.sync.startSync).toHaveBeenCalledTimes(1);
  });

  it("returns style sync status", async () => {
    const store = fakeStore({
      sync: {
        ...fakeStore().sync,
        getStatus: vi.fn(async () => ({
          status: "running",
          task_id: "sync-test",
          started_at: "2026-05-18T00:00:00.000Z",
          progress: { phase: "git_clone", current: 0, total: 4 }
        }))
      }
    });
    const app = await appWith(store);

    const response = await app.inject({ method: "GET", url: "/api/styles/sync/status" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "running",
      task_id: "sync-test",
      started_at: "2026-05-18T00:00:00.000Z",
      progress: { phase: "git_clone", current: 0, total: 4 }
    });
    expect(store.sync.getStatus).toHaveBeenCalledTimes(1);
  });

  it("maps duplicate style sync starts to 409", async () => {
    const store = fakeStore({
      sync: {
        ...fakeStore().sync,
        startSync: vi.fn(async () => {
          throw new FormaError("SYNC_ALREADY_RUNNING", "Style sync is already running", { task_id: "sync-running" });
        })
      }
    });
    const app = await appWith(store);

    const response = await app.inject({ method: "POST", url: "/api/styles/sync" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error_code: "SYNC_ALREADY_RUNNING" });
  });

  it("maps missing Git during style sync start to 503", async () => {
    const store = fakeStore({
      sync: {
        ...fakeStore().sync,
        startSync: vi.fn(async () => {
          throw new FormaError("SYNC_GIT_NOT_FOUND", "Git executable not found");
        })
      }
    });
    const app = await appWith(store);

    const response = await app.inject({ method: "POST", url: "/api/styles/sync" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error_code: "SYNC_GIT_NOT_FOUND" });
  });

  it("triggers async sync crash recovery when building the server", async () => {
    const store = fakeStore();

    const app = await buildServer({ store });
    apps.push(app);
    await Promise.resolve();

    expect(store.sync.recoverFromCrash).toHaveBeenCalledTimes(1);
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

  it("returns baseline page copy for an explicit owned requirement", async () => {
    const requirements = {
      ...fakeStore().requirements,
      getRequirement: vi.fn(async () => ({
        id: "R-12345678",
        product_id: "P-123abc",
        pages: [
          {
            page_id: "checkout",
            baseline_page: "checkout",
            copy: [{ context: "title", text: "结账" }]
          }
        ],
        document_md: "# Checkout"
      }))
    };
    const copy = {
      getTranslations: vi.fn(async () => [
        {
          page_id: "checkout",
          entries: [{ context: "title", texts: { en: "Checkout" } }]
        }
      ])
    };
    const app = await appWith(fakeStore({ requirements, copy }));

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/baseline/pages/checkout/copy?requirement_id=R-12345678"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      page_id: "checkout",
      default_language_copy: [{ context: "title", text: "结账" }],
      translations: [{ context: "title", texts: { en: "Checkout" } }]
    });
    expect(requirements.getRequirement).toHaveBeenCalledWith({ requirement_id: "R-12345678" });
    expect(copy.getTranslations).toHaveBeenCalledWith("P-123abc", "R-12345678");
  });

  it("rejects baseline page copy for an explicit cross-product requirement", async () => {
    const requirements = {
      ...fakeStore().requirements,
      getRequirement: vi.fn(async () => ({
        id: "R-12345678",
        product_id: "P-other1",
        pages: [{ page_id: "checkout", baseline_page: "checkout", copy: [{ context: "title", text: "结账" }] }],
        document_md: "# Checkout"
      }))
    };
    const copy = {
      getTranslations: vi.fn(async () => [
        {
          page_id: "checkout",
          entries: [{ context: "title", texts: { en: "Checkout" } }]
        }
      ])
    };
    const app = await appWith(fakeStore({ requirements, copy }));

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-123abc/baseline/pages/checkout/copy?requirement_id=R-12345678"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error_code: "REQUIREMENT_NOT_FOUND" });
    expect(copy.getTranslations).not.toHaveBeenCalled();
  });

  it("resolves baseline page copy from the newest source requirement when no requirement id is provided", async () => {
    const requirements = {
      ...fakeStore().requirements,
      getRequirementHistory: vi.fn(async () => [
        {
          id: "R-bbb2222",
          product_id: "P-123abc",
          created_at: "2026-05-16T00:00:00.000Z",
          updated_at: "2026-05-18T00:00:00.000Z",
          pages: [
            {
              page_id: "bbb-checkout",
              baseline_page: "checkout",
              copy: [{ context: "title", text: "BBB 结账" }]
            }
          ]
        },
        {
          id: "R-old1111",
          product_id: "P-123abc",
          created_at: "2026-05-15T00:00:00.000Z",
          updated_at: "2026-05-17T00:00:00.000Z",
          pages: [
            {
              page_id: "old-checkout",
              baseline_page: "checkout",
              copy: [{ context: "title", text: "旧结账" }]
            }
          ]
        },
        {
          id: "R-aaa1111",
          product_id: "P-123abc",
          created_at: "2026-05-16T00:00:00.000Z",
          updated_at: "2026-05-18T00:00:00.000Z",
          pages: [
            {
              page_id: "latest-checkout",
              baseline_page: "checkout",
              copy: [{ context: "title", text: "结账" }]
            }
          ]
        }
      ])
    };
    const baseline = {
      getProductBaseline: vi.fn(async () => ({
        product_id: "P-123abc",
        pages: [
          {
            id: "checkout",
            name: "Checkout",
            features: "",
            copy: "",
            fields: "",
            interactions: "",
            source_requirements: ["R-old1111", "R-bbb2222", "R-aaa1111"]
          }
        ],
        navigation: []
      }))
    };
    const copy = {
      getTranslations: vi.fn(async () => [
        {
          page_id: "latest-checkout",
          entries: [{ context: "title", texts: { en: "Checkout" } }]
        }
      ])
    };
    const app = await appWith(fakeStore({ baseline, requirements, copy }));

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/baseline/pages/checkout/copy" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      page_id: "checkout",
      default_language_copy: [{ context: "title", text: "BBB 结账" }],
      translations: []
    });
    expect(copy.getTranslations).toHaveBeenCalledWith("P-123abc", "R-bbb2222");
  });

  it("does not match baseline page copy by a requirement page id that points to another baseline page", async () => {
    const requirements = {
      ...fakeStore().requirements,
      getRequirementHistory: vi.fn(async () => [
        {
          id: "R-12345678",
          product_id: "P-123abc",
          created_at: "2026-05-17T00:00:00.000Z",
          updated_at: "2026-05-17T00:00:00.000Z",
          pages: [
            {
              page_id: "checkout",
              baseline_page: "profile",
              copy: [{ context: "title", text: "WRONG" }]
            }
          ]
        }
      ])
    };
    const copy = {
      getTranslations: vi.fn(async () => [
        {
          page_id: "checkout",
          entries: [{ context: "title", texts: { en: "WRONG" } }]
        }
      ])
    };
    const app = await appWith(fakeStore({ requirements, copy }));

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/baseline/pages/checkout/copy" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      page_id: "checkout",
      default_language_copy: [],
      translations: []
    });
    expect(response.body).not.toContain("WRONG");
    expect(copy.getTranslations).not.toHaveBeenCalled();
  });

  it("returns empty baseline page copy arrays when the selected source requirement has no page copy", async () => {
    const requirements = {
      ...fakeStore().requirements,
      getRequirementHistory: vi.fn(async () => [
        {
          id: "R-12345678",
          product_id: "P-123abc",
          created_at: "2026-05-17T00:00:00.000Z",
          updated_at: "2026-05-17T00:00:00.000Z",
          pages: [{ page_id: "checkout-page", baseline_page: "checkout" }]
        }
      ])
    };
    const baseline = {
      getProductBaseline: vi.fn(async () => ({
        product_id: "P-123abc",
        pages: [
          {
            id: "checkout",
            name: "Checkout",
            features: "",
            copy: [{ context: "title", text: "Baseline 结账" }],
            fields: "",
            interactions: "",
            source_requirements: ["R-12345678"]
          }
        ],
        navigation: []
      }))
    };
    const copy = {
      getTranslations: vi.fn(async () => [
        {
          page_id: "checkout-page",
          entries: [{ context: "title", texts: { en: "Stale Checkout" } }]
        }
      ])
    };
    const app = await appWith(fakeStore({ baseline, requirements, copy }));

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/baseline/pages/checkout/copy" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      page_id: "checkout",
      default_language_copy: [],
      translations: []
    });
    expect(copy.getTranslations).not.toHaveBeenCalled();
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

  it("returns 404 when no baseline source design has an existing preview", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-server-routes-"));
    const app = await appWith(fakeStore({ home }));

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/baseline/pages/checkout/image" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error_code: "BASELINE_IMAGE_NOT_FOUND" });
  });

  it("returns baseline image metadata from requirement-level design metadata", async () => {
    const home = await homeWithPreview();
    const requirements = {
      ...fakeStore().requirements,
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
      ])
    };
    const app = await appWith(fakeStore({ home, requirements }));

    const response = await app.inject({ method: "GET", url: "/api/products/P-123abc/baseline/pages/checkout/image" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      product_id: "P-123abc",
      baseline_page_id: "checkout",
      requirement_id: "R-12345678",
      requirement_page_id: "checkout-page",
      preview_url: "/api/products/P-123abc/baseline/pages/checkout/image",
      preview_path: join(home, "data", "P-123abc", "R-12345678", "previews", "checkout-page@2x.png"),
      canvas_path: join(home, "data", "P-123abc", "R-12345678", "design.pen"),
      page_version: 1,
      canvas_version: 1
    });
    expect(response.json()).not.toHaveProperty("design_id");
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
    await markNormalizationCommitted(home);
    const store = {
      ...(await createFormaStore({ home, bundledStylesDir: resolve("styles") })),
      sync: fakeStore().sync
    };
    const app = await buildServer({ store });
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
