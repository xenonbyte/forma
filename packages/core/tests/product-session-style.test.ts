import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  FormaError,
  ProductService,
  SessionService,
  createFormaStore,
  getProductMutationLock,
  readYaml,
  type GeneratedDesign,
  type GeneratePageDesignInput,
  type ProductMutationContext,
  type ProductMutationLock
} from "../src/index.js";

type ProductDeletionPhase = "created" | "backed_up" | "session_written" | "index_written" | "moved" | "committed";

interface ProductDeletionStateForTest {
  schema_version: 1;
  operation_id: string;
  product_id: string;
  created_at: string;
  updated_at: string;
  committed: boolean;
  phase: ProductDeletionPhase;
  backups: { products_yaml: "backups/products.yaml"; session_yaml?: "backups/session.yaml" };
  moved_paths: Array<{
    kind: "product_data" | "component_library";
    original_path: string;
    staged_path: string;
    required: boolean;
  }>;
  missing_paths: string[];
  session_was_current: boolean;
  warnings: string[];
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function nextTick(): Promise<void> {
  await new Promise((resolveTick) => setTimeout(resolveTick, 0));
}

async function lockProbeDelay(): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
}

async function seedStaleProductMutationLock(home: string): Promise<void> {
  const lockDir = join(home, "tmp", "locks", "product-mutations.lock");
  await mkdir(lockDir, { recursive: true });
  const staleTime = new Date(Date.now() - 130_000).toISOString();
  await writeFile(
    join(lockDir, "owner.json"),
    JSON.stringify(
      {
        owner_id: "owner-stale",
        pid: process.pid,
        operation: "existing-operation",
        product_id: "P-existing",
        acquired_at: staleTime,
        updated_at: staleTime
      },
      null,
      2
    ),
    "utf8"
  );
}

function createRecordingLock(warning?: string): ProductMutationLock & { calls: Array<{ operation: string; product_id?: string }> } {
  const calls: Array<{ operation: string; product_id?: string }> = [];
  return {
    calls,
    async run<T>(
      input: { operation: string; product_id?: string },
      fn: (context: ProductMutationContext) => Promise<T>
    ): Promise<T> {
      calls.push(input);
      const context = { ...input, warnings: warning ? [warning] : [] };
      return fn(context);
    }
  };
}

function createLateWarningLock(lateWarning: string): ProductMutationLock {
  return {
    async run<T>(
      input: { operation: string; product_id?: string },
      fn: (context: ProductMutationContext) => Promise<T>
    ): Promise<T> {
      const context = { operation: input.operation, product_id: input.product_id, warnings: [] };
      const result = await fn(context);
      context.warnings.push(lateWarning);
      return result;
    }
  };
}

async function createTestStore() {
  const home = await mkdtemp(join(tmpdir(), "forma-store-"));
  return createFormaStore({ home, bundledStylesDir: resolve("styles") });
}

async function createStoreWithStyle() {
  const store = await createTestStore();
  return {
    store,
    style: {
      name: "linear",
      description: "Focused tool UI",
      design_md_path: "styles/linear/DESIGN.md",
      variables: store.styles.withDefaultVariables({ primary: "#5E6AD2" })
    }
  };
}

function createStoreWithDeletionHooks(home: string, productDeletionHooks: Record<string, unknown>) {
  return createFormaStore({
    home,
    bundledStylesDir: resolve("styles"),
    productDeletionHooks
  } as Parameters<typeof createFormaStore>[0] & { productDeletionHooks: Record<string, unknown> });
}

async function seedReadyProduct(store: Awaited<ReturnType<typeof createTestStore>>, name = "Shop App") {
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

async function writeComponentLibrary(home: string, productId: string, contents = { children: [{ id: "button", type: "component" }] }) {
  await mkdir(join(home, "library"), { recursive: true });
  await writeFile(join(home, "library", `${productId}.lib.pen`), JSON.stringify(contents), "utf8");
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

function deletionState(input: {
  operationId: string;
  productId: string;
  phase: ProductDeletionPhase;
  committed?: boolean;
  sessionWasCurrent?: boolean;
  movedPaths?: ProductDeletionStateForTest["moved_paths"];
  missingPaths?: string[];
  backups?: ProductDeletionStateForTest["backups"];
  warnings?: string[];
}): ProductDeletionStateForTest {
  return {
    schema_version: 1,
    operation_id: input.operationId,
    product_id: input.productId,
    created_at: "2026-05-20T00:00:00.000Z",
    updated_at: "2026-05-20T00:00:00.000Z",
    committed: input.committed ?? false,
    phase: input.phase,
    backups: input.backups ?? { products_yaml: "backups/products.yaml", session_yaml: "backups/session.yaml" },
    moved_paths: input.movedPaths ?? [
      {
        kind: "product_data",
        original_path: `data/${input.productId}`,
        staged_path: `staged/data/${input.productId}`,
        required: true
      },
      {
        kind: "component_library",
        original_path: `library/${input.productId}.lib.pen`,
        staged_path: `staged/library/${input.productId}.lib.pen`,
        required: false
      }
    ],
    missing_paths: input.missingPaths ?? [],
    session_was_current: input.sessionWasCurrent ?? true,
    warnings: input.warnings ?? []
  };
}

async function writeDeletionState(home: string, state: ProductDeletionStateForTest): Promise<string> {
  const operationDir = join(home, "tmp", "deletions", state.operation_id);
  await mkdir(operationDir, { recursive: true });
  await writeFile(join(operationDir, "state.json"), JSON.stringify(state, null, 2), "utf8");
  return operationDir;
}

async function writeGeneratedComponentCandidate(name: string): Promise<{ tempDir: string; penPath: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), `forma-generated-components-${name}-`));
  const penPath = join(tempDir, "components.lib.pen");
  await writeFile(penPath, JSON.stringify({ children: [{ id: "button", type: "component" }] }));
  return { tempDir, penPath };
}

const minimalPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
  0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
  0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
  0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

async function writeGeneratedPageDesignCandidate(name: string): Promise<GeneratedDesign> {
  const tempDir = await mkdtemp(join(tmpdir(), `forma-generated-page-${name}-`));
  const penPath = join(tempDir, "page.pen");
  const previewPath = join(tempDir, "preview.png");
  await writeFile(
    penPath,
    JSON.stringify({
      children: [{ id: `root-${name}`, type: "frame", name: "Root", children: [] }]
    }),
    "utf8"
  );
  await writeFile(previewPath, minimalPng);
  return { tempDir, penPath, previewPath };
}

async function seedDesignReadyProduct(store: Awaited<ReturnType<typeof createTestStore>>, name = "Shop App") {
  const product = await seedReadyProduct(store, name);
  await writeComponentLibrary(store.home, product.id);
  await store.products.markComponentsInitialized(product.id);
  return product;
}

async function submitSinglePageRequirement(
  store: Awaited<ReturnType<typeof createTestStore>>,
  productId: string,
  pageId = "checkout"
) {
  const empty = await store.requirements.createEmptyRequirement(productId, "Checkout");
  return store.requirements.saveRequirement({
    requirement_id: empty.id,
    document_md: "# Checkout\nCart checkout",
    ui_affected: true,
    pages: [{ page_id: pageId, name: "Checkout", baseline_page: pageId, change_type: "new" }],
    navigation: []
  });
}

describe("product session and style services", () => {
  it("serializes direct product writes with the default home lock", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-product-lock-"));
    const products = new ProductService({ home });
    const release = deferred();
    const events: string[] = [];
    const hold = getProductMutationLock(home).run({ operation: "test_hold" }, async () => {
      events.push("hold-enter");
      await release.promise;
      events.push("hold-exit");
    });
    while (!events.includes("hold-enter")) {
      await nextTick();
    }

    let created = false;
    const create = products.createProduct({ name: "Locked", description: "Product" }).then(() => {
      created = true;
    });
    await lockProbeDelay();

    expect(created).toBe(false);
    release.resolve();
    await Promise.all([hold, create]);
    expect(events).toEqual(["hold-enter", "hold-exit"]);
    expect(created).toBe(true);
  });

  it("serializes direct session writes with the default home lock", async () => {
    const { store, style } = await createStoreWithStyle();
    const products = new ProductService({ home: store.home });
    const sessions = new SessionService({ home: store.home, products });
    const product = await products.createProduct({ name: "Shop App", description: "Mobile shop" });
    await products.initProductConfig(product.id, { platform: "mobile", languages: ["en"], default_language: "en", style });
    const release = deferred();
    const events: string[] = [];
    const hold = getProductMutationLock(store.home).run({ operation: "test_hold" }, async () => {
      events.push("hold-enter");
      await release.promise;
      events.push("hold-exit");
    });
    while (!events.includes("hold-enter")) {
      await nextTick();
    }

    let completed = false;
    const setCurrent = sessions.setCurrentProduct(product.id).then(() => {
      completed = true;
    });
    await lockProbeDelay();

    expect(completed).toBe(false);
    release.resolve();
    await Promise.all([hold, setCurrent]);
    expect(events).toEqual(["hold-enter", "hold-exit"]);
    expect(completed).toBe(true);
  });

  it("uses stable operation names for direct product and session mutations", async () => {
    const { store, style } = await createStoreWithStyle();
    const productMutationLock = createRecordingLock();
    const products = new ProductService({ home: store.home, productMutationLock });
    const sessions = new SessionService({ home: store.home, products, productMutationLock });

    const product = await products.createProduct({ name: "Shop App", description: "Mobile shop" });
    await products.initProductConfig(product.id, {
      platform: "mobile",
      languages: ["en"],
      default_language: "en",
      style
    });
    await mkdir(join(store.home, "library"), { recursive: true });
    await writeFile(join(store.home, "library", `${product.id}.lib.pen`), JSON.stringify({ children: [{ id: "button" }] }));
    await products.markComponentsInitialized(product.id);
    await sessions.setCurrentProduct(product.id);

    expect(productMutationLock.calls).toEqual([
      { operation: "create_product" },
      { operation: "init_product_config", product_id: product.id },
      { operation: "mark_components_initialized", product_id: product.id },
      { operation: "set_current_product", product_id: product.id }
    ]);
  });

  it("passes a shared product mutation lock and warning sink through the store", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-store-lock-"));
    const productMutationLock = createRecordingLock("lock warning");
    const warnings: string[] = [];
    const store = createFormaStore({
      home,
      bundledStylesDir: resolve("styles"),
      productMutationLock,
      onProductMutationWarning: (warning) => warnings.push(warning)
    });

    await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });
    await expect(
      store.runProductMutation({ operation: "manual_operation", product_id: "P-123abc" }, async (context) => {
        context.warnings.push("manual warning");
        return "ok";
      })
    ).resolves.toBe("ok");

    expect(productMutationLock.calls).toEqual([
      { operation: "create_product" },
      { operation: "manual_operation", product_id: "P-123abc" }
    ]);
    expect(warnings).toEqual(["lock warning", "lock warning", "manual warning"]);
  });

  it("flushes lock acquisition warnings to a custom sink when product mutation lock rejects", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-product-lock-"));
    const warnings: string[] = [];
    const productMutationLock: ProductMutationLock = {
      async run(): Promise<never> {
        throw new FormaError("PRODUCT_MUTATION_LOCKED", "Product mutation lock is held", { warnings: ["stale lock removed"] });
      }
    };
    const products = new ProductService({
      home,
      productMutationLock,
      onProductMutationWarning: (warning) => warnings.push(warning)
    });

    await expect(products.createProduct({ name: "Shop App", description: "Mobile shop" })).rejects.toMatchObject({
      code: "PRODUCT_MUTATION_LOCKED"
    });
    expect(warnings).toEqual(["stale lock removed"]);
  });

  it("flushes real lock cleanup warnings to a custom sink", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-product-lock-"));
    await seedStaleProductMutationLock(home);
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const warnings: string[] = [];
    const products = new ProductService({ home, onProductMutationWarning: (warning) => warnings.push(warning) });

    try {
      await products.createProduct({ name: "Shop App", description: "Mobile shop" });
      expect(warnings).toEqual([expect.stringContaining("stale")]);
      expect(emitWarning).toHaveBeenCalledTimes(1);
    } finally {
      emitWarning.mockRestore();
    }
  });

  it("does not duplicate real lock cleanup warnings with the default warning sink", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-product-lock-"));
    await seedStaleProductMutationLock(home);
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const products = new ProductService({ home });

    try {
      await products.createProduct({ name: "Shop App", description: "Mobile shop" });
      expect(emitWarning).toHaveBeenCalledTimes(1);
      expect(emitWarning).toHaveBeenCalledWith(expect.stringContaining("stale"));
    } finally {
      emitWarning.mockRestore();
    }
  });

  it("flushes injected lock context warnings to the default warning sink", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-product-lock-"));
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const products = new ProductService({ home, productMutationLock: createRecordingLock("default service warning") });

    try {
      await products.createProduct({ name: "Shop App", description: "Mobile shop" });
      expect(emitWarning).toHaveBeenCalledWith("default service warning");
    } finally {
      emitWarning.mockRestore();
    }
  });

  it("flushes service late lock warnings after the mutation callback resolves", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-product-lock-"));
    const warnings: string[] = [];
    const products = new ProductService({
      home,
      productMutationLock: createLateWarningLock("late service warning"),
      onProductMutationWarning: (warning) => warnings.push(warning)
    });

    await products.createProduct({ name: "Shop App", description: "Mobile shop" });

    expect(warnings).toEqual(["late service warning"]);
  });

  it("flushes store runProductMutation callback warnings to the default warning sink", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-store-lock-"));
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const store = createFormaStore({ home, bundledStylesDir: resolve("styles"), productMutationLock: createRecordingLock() });

    try {
      await store.runProductMutation({ operation: "manual_warning" }, async (context) => {
        context.warnings.push("default store warning");
        return "ok";
      });
      expect(emitWarning).toHaveBeenCalledWith("default store warning");
    } finally {
      emitWarning.mockRestore();
    }
  });

  it("flushes store late lock warnings after the mutation callback resolves", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-store-lock-"));
    const warnings: string[] = [];
    const store = createFormaStore({
      home,
      bundledStylesDir: resolve("styles"),
      productMutationLock: createLateWarningLock("late store warning"),
      onProductMutationWarning: (warning) => warnings.push(warning)
    });

    await store.runProductMutation({ operation: "manual_late_warning" }, async () => "ok");

    expect(warnings).toEqual(["late store warning"]);
  });

  it("generateComponents uses a structural generator, validates config, locks, and persists the final library", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-store-components-"));
    const productMutationLock = createRecordingLock();
    const candidate = await writeGeneratedComponentCandidate("store");
    const generator = {
      generateComponents: vi.fn(async () => candidate)
    };
    const store = createFormaStore({
      home,
      bundledStylesDir: resolve("styles"),
      productMutationLock,
      pencilService: generator
    });
    const style = {
      name: "linear",
      description: "Focused tool UI",
      design_md_path: "styles/linear/DESIGN.md",
      variables: store.styles.withDefaultVariables({ primary: "#5E6AD2" })
    };
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });
    await store.products.initProductConfig(product.id, {
      platform: "mobile",
      languages: ["en"],
      default_language: "en",
      style
    });
    productMutationLock.calls.length = 0;

    const result = await store.generateComponents({
      product_id: product.id,
      prompt: "Create controls",
      workspace: "/tmp/workspace"
    });

    const libraryPath = store.products.componentLibraryFile(product.id);
    expect(productMutationLock.calls).toEqual([{ operation: "generate_components", product_id: product.id }]);
    expect(generator.generateComponents).toHaveBeenCalledWith({
      product_id: product.id,
      prompt: "Create controls",
      workspace: "/tmp/workspace"
    });
    expect(result).toEqual({ ...candidate, libraryPath });
    expect(await readFile(libraryPath, "utf8")).toBe(await readFile(candidate.penPath, "utf8"));
    await expect(store.products.getProduct(product.id)).resolves.toMatchObject({ components_initialized: false });
  });

  it("generateAndSavePageDesign persists generated output, returns stable paths, locks, and cleans temp output", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-store-page-design-"));
    const productMutationLock = createRecordingLock();
    const generated = await writeGeneratedPageDesignCandidate("success");
    const pageDesignGenerator = {
      generatePageDesign: vi.fn(async (_input: GeneratePageDesignInput) => generated)
    };
    const store = createFormaStore({
      home,
      bundledStylesDir: resolve("styles"),
      productMutationLock,
      pageDesignGenerator
    });
    const product = await seedDesignReadyProduct(store);
    const requirement = await submitSinglePageRequirement(store, product.id, "checkout");
    productMutationLock.calls.length = 0;
    const saveDesignsLocked = vi.spyOn(store.designs, "saveDesignsLocked");

    const result = await store.generateAndSavePageDesign({
      product_id: product.id,
      requirement_id: requirement.id,
      page_id: "checkout",
      prompt: "Create checkout page",
      workspace: "/tmp/workspace"
    });

    expect(saveDesignsLocked).toHaveBeenCalledWith(requirement.id, [{
      page_id: "checkout",
      mode: "generate",
      penPath: generated.penPath,
      previewPath: generated.previewPath
    }]);
    expect(productMutationLock.calls).toEqual([{ operation: "generate_and_save_page_design", product_id: product.id }]);
    expect(pageDesignGenerator.generatePageDesign).toHaveBeenCalledWith({
      product_id: product.id,
      prompt: "Create checkout page",
      workspace: "/tmp/workspace"
    });
    expect(result).toMatchObject({
      product_id: product.id,
      requirement_id: requirement.id,
      page_id: "checkout",
      version: 1
    });
    expect(result.pen_path).toBe(join(home, "data", product.id, requirement.id, result.design_id, "design.pen"));
    expect(result.preview_path).toBe(join(home, "data", product.id, requirement.id, result.design_id, "preview@2x.png"));
    await expect(access(result.pen_path)).resolves.toBeUndefined();
    await expect(access(result.preview_path)).resolves.toBeUndefined();
    await expect(access(generated.tempDir)).rejects.toThrow();
    await expect(store.requirements.getRequirement({ requirement_id: requirement.id })).resolves.toMatchObject({
      status: "active",
      pages: [expect.objectContaining({ page_id: "checkout", design_status: "done", design_id: result.design_id })]
    });
  });

  it("generateComponents rejects incomplete product config before calling the generator", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-store-components-"));
    const productMutationLock = createRecordingLock();
    const generator = {
      generateComponents: vi.fn(async () => writeGeneratedComponentCandidate("unused"))
    };
    const store = createFormaStore({
      home,
      bundledStylesDir: resolve("styles"),
      productMutationLock,
      pencilService: generator
    });
    const product = await store.products.createProduct({ name: "Incomplete", description: "Demo" });
    productMutationLock.calls.length = 0;

    await expect(
      store.generateComponents({
        product_id: product.id,
        prompt: "Create controls",
        workspace: "/tmp/workspace"
      })
    ).rejects.toMatchObject({
      code: "PRODUCT_CONFIG_INCOMPLETE",
      details: { product_id: product.id, missing: ["platform", "style", "languages"] }
    });

    expect(productMutationLock.calls).toEqual([{ operation: "generate_components", product_id: product.id }]);
    expect(generator.generateComponents).not.toHaveBeenCalled();
  });

  it("generateComponents cleans up the candidate temp dir when final copy fails", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-store-components-"));
    const candidate = {
      tempDir: await mkdtemp(join(tmpdir(), "forma-generated-components-missing-")),
      penPath: ""
    };
    candidate.penPath = join(candidate.tempDir, "missing.lib.pen");
    const generator = {
      generateComponents: vi.fn(async () => candidate)
    };
    const store = createFormaStore({ home, bundledStylesDir: resolve("styles"), pencilService: generator });
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });
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

    await expect(
      store.generateComponents({
        product_id: product.id,
        prompt: "Create controls",
        workspace: "/tmp/workspace"
      })
    ).rejects.toThrow();

    await expect(access(candidate.tempDir)).rejects.toThrow();
    await expect(access(store.products.componentLibraryFile(product.id))).rejects.toThrow();
  });

  it("generateComponents serializes with the default home lock", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-store-components-lock-"));
    const candidate = await writeGeneratedComponentCandidate("locked");
    const generator = {
      generateComponents: vi.fn(async () => candidate)
    };
    const store = createFormaStore({ home, bundledStylesDir: resolve("styles"), pencilService: generator });
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });
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
    const release = deferred();
    const events: string[] = [];
    const hold = getProductMutationLock(home).run({ operation: "test_hold" }, async () => {
      events.push("hold-enter");
      await release.promise;
      events.push("hold-exit");
    });
    while (!events.includes("hold-enter")) {
      await nextTick();
    }

    let completed = false;
    const generate = store.generateComponents({
      product_id: product.id,
      prompt: "Create controls",
      workspace: "/tmp/workspace"
    }).then(() => {
      completed = true;
    });
    await lockProbeDelay();

    expect(completed).toBe(false);
    expect(generator.generateComponents).not.toHaveBeenCalled();
    release.resolve();
    await Promise.all([hold, generate]);
    expect(events).toEqual(["hold-enter", "hold-exit"]);
    expect(completed).toBe(true);
  });

  it("creates products and blocks incomplete session", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });

    await expect(store.sessions.setCurrentProduct(product.id)).rejects.toMatchObject({
      code: "PRODUCT_CONFIG_INCOMPLETE",
      details: {
        missing: ["platform", "style", "languages"]
      }
    });
  });

  it("stores product language config and rejects invalid defaults", async () => {
    const { store, style } = await createStoreWithStyle();
    const product = await store.products.createProduct({ name: "App", description: "Demo" });

    await expect(
      store.products.initProductConfig(product.id, {
        platform: "web",
        style,
        languages: ["zh-CN", "en"],
        default_language: "en"
      })
    ).resolves.toMatchObject({
      languages: ["zh-CN", "en"],
      default_language: "en"
    });
    await expect(store.products.getProduct(product.id)).resolves.toMatchObject({
      languages: ["zh-CN", "en"],
      default_language: "en"
    });

    await expect(
      store.products.initProductConfig(product.id, {
        platform: "web",
        style,
        languages: ["zh-CN"],
        default_language: "en"
      })
    ).rejects.toThrow();
  });

  it("rejects seeded product language config with only one language field", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });

    await writeFile(
      join(store.home, "data", product.id, "product.yaml"),
      [
        `id: ${product.id}`,
        "name: Shop App",
        "description: Mobile shop",
        "languages:",
        "  - en",
        ""
      ].join("\n")
    );
    await expect(store.products.getProduct(product.id)).rejects.toThrow();

    await writeFile(
      join(store.home, "data", product.id, "product.yaml"),
      [`id: ${product.id}`, "name: Shop App", "description: Mobile shop", "default_language: en", ""].join("\n")
    );
    await expect(store.products.getProduct(product.id)).rejects.toThrow();
  });

  it("sets session after platform style and components exist", async () => {
    const store = await createTestStore();
    await store.styles.installBuiltInStyles();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });
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
    await mkdir(join(store.home, "library"), { recursive: true });
    await writeFile(join(store.home, "library", `${product.id}.lib.pen`), JSON.stringify({ children: [{ id: "button", type: "component" }] }));
    await store.products.markComponentsInitialized(product.id);
    await store.sessions.setCurrentProduct(product.id);

    expect(await store.sessions.getCurrentSession()).toEqual({ current_product: product.id });
  });

  it("sets session after platform style languages and default language exist without initialized components", async () => {
    const { store, style } = await createStoreWithStyle();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });
    await store.products.initProductConfig(product.id, {
      platform: "mobile",
      languages: ["en"],
      default_language: "en",
      style
    });

    await store.sessions.setCurrentProduct(product.id);

    await expect(store.products.getProduct(product.id)).resolves.toMatchObject({ components_initialized: false });
    expect(await store.sessions.getCurrentSession()).toEqual({ current_product: product.id });
  });

  it("rejects session when required base product config fields are incomplete", async () => {
    const { store, style } = await createStoreWithStyle();
    const missingPlatform = await store.products.createProduct({ name: "Missing Platform", description: "Demo" });
    const missingStyle = await store.products.createProduct({ name: "Missing Style", description: "Demo" });
    const missingLanguages = await store.products.createProduct({ name: "Missing Languages", description: "Demo" });
    const missingDefaultLanguage = await store.products.createProduct({ name: "Missing Default", description: "Demo" });
    const invalidDefaultLanguage = await store.products.createProduct({ name: "Invalid Default", description: "Demo" });

    await writeFile(
      join(store.home, "data", missingPlatform.id, "product.yaml"),
      [
        `id: ${missingPlatform.id}`,
        "name: Missing Platform",
        "description: Demo",
        "languages:",
        "  - en",
        "default_language: en",
        "style:",
        "  name: linear",
        "  description: Focused tool UI",
        "  design_md_path: styles/linear/DESIGN.md",
        "  variables:",
        ...Object.entries(style.variables).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`),
        "components_initialized: false",
        ""
      ].join("\n")
    );
    await writeFile(
      join(store.home, "data", missingStyle.id, "product.yaml"),
      [
        `id: ${missingStyle.id}`,
        "name: Missing Style",
        "description: Demo",
        "platform: web",
        "languages:",
        "  - en",
        "default_language: en",
        "components_initialized: false",
        ""
      ].join("\n")
    );
    await writeFile(
      join(store.home, "data", missingLanguages.id, "product.yaml"),
      [
        `id: ${missingLanguages.id}`,
        "name: Missing Languages",
        "description: Demo",
        "platform: web",
        "style:",
        "  name: linear",
        "  description: Focused tool UI",
        "  design_md_path: styles/linear/DESIGN.md",
        "  variables:",
        ...Object.entries(style.variables).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`),
        "components_initialized: false",
        ""
      ].join("\n")
    );
    await writeFile(
      join(store.home, "data", missingDefaultLanguage.id, "product.yaml"),
      [
        `id: ${missingDefaultLanguage.id}`,
        "name: Missing Default",
        "description: Demo",
        "platform: web",
        "languages:",
        "  - en",
        "style:",
        "  name: linear",
        "  description: Focused tool UI",
        "  design_md_path: styles/linear/DESIGN.md",
        "  variables:",
        ...Object.entries(style.variables).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`),
        "components_initialized: false",
        ""
      ].join("\n")
    );
    await writeFile(
      join(store.home, "data", invalidDefaultLanguage.id, "product.yaml"),
      [
        `id: ${invalidDefaultLanguage.id}`,
        "name: Invalid Default",
        "description: Demo",
        "platform: web",
        "languages:",
        "  - zh-CN",
        "default_language: en",
        "style:",
        "  name: linear",
        "  description: Focused tool UI",
        "  design_md_path: styles/linear/DESIGN.md",
        "  variables:",
        ...Object.entries(style.variables).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`),
        "components_initialized: false",
        ""
      ].join("\n")
    );

    await expect(store.sessions.setCurrentProduct(missingPlatform.id)).rejects.toMatchObject({
      code: "PRODUCT_CONFIG_INCOMPLETE",
      details: { missing: ["platform"] }
    });
    await expect(store.sessions.setCurrentProduct(missingStyle.id)).rejects.toMatchObject({
      code: "PRODUCT_CONFIG_INCOMPLETE",
      details: { missing: ["style"] }
    });
    await expect(store.sessions.setCurrentProduct(missingLanguages.id)).rejects.toMatchObject({
      code: "PRODUCT_CONFIG_INCOMPLETE",
      details: { missing: ["languages"] }
    });
    await expect(store.sessions.setCurrentProduct(missingDefaultLanguage.id)).rejects.toThrow(
      "languages and default_language must be configured together"
    );
    await expect(store.sessions.setCurrentProduct(invalidDefaultLanguage.id)).rejects.toThrow(
      "default_language must be included in languages"
    );
  });

  it("writes product index and product yaml", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });

    expect(await store.products.getProduct(product.id)).toMatchObject({
      id: product.id,
      name: "Shop App",
      description: "Mobile shop"
    });
    expect(await store.products.listProducts()).toEqual([
      { id: product.id, name: "Shop App", description: "Mobile shop" }
    ]);

    await expect(readYaml(join(store.home, "data", "products.yaml"))).resolves.toEqual({
      products: [{ id: product.id, name: "Shop App", description: "Mobile shop" }]
    });
    await expect(readYaml(join(store.home, "data", product.id, "product.yaml"))).resolves.toMatchObject({
      id: product.id,
      name: "Shop App",
      description: "Mobile shop"
    });
  });

  it("deleteProduct removes the product index entry, product data, and component library", async () => {
    const store = await createTestStore();
    const product = await seedReadyProduct(store);
    await writeComponentLibrary(store.home, product.id);

    await expect(store.deleteProduct({ product_id: product.id, confirm_product_id: product.id })).resolves.toEqual({
      product_id: product.id,
      deleted: true,
      session_cleared: false,
      cleanup_pending: false,
      recovery_warnings: []
    });

    expect(await store.products.listProducts()).toEqual([]);
    await expect(access(join(store.home, "data", product.id))).rejects.toThrow();
    await expect(access(join(store.home, "library", `${product.id}.lib.pen`))).rejects.toThrow();
  });

  it("rejects mismatched delete confirmation before lock, recovery, reads, or writes", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-delete-invalid-"));
    const productMutationLock = createRecordingLock();
    const store = createFormaStore({ home, bundledStylesDir: resolve("styles"), productMutationLock });
    await mkdir(join(home, "tmp", "deletions", "unsafe", "staged"), { recursive: true });
    await writeFile(join(home, "tmp", "deletions", "unsafe", "note.txt"), "unsafe", "utf8");

    await expect(store.deleteProduct({ product_id: "P-123abc", confirm_product_id: "P-456def" })).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });

    expect(productMutationLock.calls).toEqual([]);
    expect(await pathExists(join(home, "tmp", "deletions", "unsafe", "note.txt"))).toBe(true);
    await expect(access(join(home, "data", "products.yaml"))).rejects.toThrow();
  });

  it("rejects missing delete confirmation before lock, recovery, reads, or writes", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-delete-invalid-"));
    const productMutationLock = createRecordingLock();
    const store = createFormaStore({ home, bundledStylesDir: resolve("styles"), productMutationLock });
    await mkdir(join(home, "tmp", "deletions", "unsafe", "staged"), { recursive: true });
    await writeFile(join(home, "tmp", "deletions", "unsafe", "note.txt"), "unsafe", "utf8");

    await expect(
      store.deleteProduct({ product_id: "P-123abc" } as { product_id: string; confirm_product_id: string })
    ).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });

    expect(productMutationLock.calls).toEqual([]);
    expect(await pathExists(join(home, "tmp", "deletions", "unsafe", "note.txt"))).toBe(true);
    await expect(access(join(home, "data", "products.yaml"))).rejects.toThrow();
  });

  it("rejects empty delete confirmation before lock, recovery, reads, or writes", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-delete-invalid-"));
    const productMutationLock = createRecordingLock();
    const store = createFormaStore({ home, bundledStylesDir: resolve("styles"), productMutationLock });
    await mkdir(join(home, "tmp", "deletions", "unsafe", "staged"), { recursive: true });
    await writeFile(join(home, "tmp", "deletions", "unsafe", "note.txt"), "unsafe", "utf8");

    await expect(store.deleteProduct({ product_id: "P-123abc", confirm_product_id: "" })).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });

    expect(productMutationLock.calls).toEqual([]);
    expect(await pathExists(join(home, "tmp", "deletions", "unsafe", "note.txt"))).toBe(true);
    await expect(access(join(home, "data", "products.yaml"))).rejects.toThrow();
  });

  it("rejects invalid product ids before lock, recovery, reads, or writes", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-delete-invalid-"));
    const productMutationLock = createRecordingLock();
    const store = createFormaStore({ home, bundledStylesDir: resolve("styles"), productMutationLock });
    await mkdir(join(home, "tmp", "deletions", "unsafe", "staged"), { recursive: true });
    await writeFile(join(home, "tmp", "deletions", "unsafe", "note.txt"), "unsafe", "utf8");

    await expect(
      store.deleteProduct({ product_id: "not-a-product", confirm_product_id: "not-a-product" })
    ).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });

    expect(productMutationLock.calls).toEqual([]);
    expect(await pathExists(join(home, "tmp", "deletions", "unsafe", "note.txt"))).toBe(true);
    await expect(access(join(home, "data", "products.yaml"))).rejects.toThrow();
  });

  it("returns product mutation lock context warnings from deleteProduct", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-delete-warning-"));
    const productMutationLock = createRecordingLock("lock warning");
    const store = createFormaStore({ home, bundledStylesDir: resolve("styles"), productMutationLock });
    const product = await seedReadyProduct(store);
    productMutationLock.calls.length = 0;

    await expect(store.deleteProduct({ product_id: product.id, confirm_product_id: product.id })).resolves.toMatchObject({
      product_id: product.id,
      recovery_warnings: ["lock warning"]
    });
    expect(productMutationLock.calls).toEqual([{ operation: "delete_product", product_id: product.id }]);
  });

  it("throws PRODUCT_NOT_FOUND without new staging when the product is missing after recovery", async () => {
    const store = await createTestStore();

    await expect(store.deleteProduct({ product_id: "P-123abc", confirm_product_id: "P-123abc" })).rejects.toMatchObject({
      code: "PRODUCT_NOT_FOUND"
    });

    const deletionsDir = join(store.home, "tmp", "deletions");
    const operations = (await readdir(deletionsDir).catch(() => [])) as string[];
    expect(operations).toEqual([]);
  });

  it("clears the current session when deleting the current product and preserves non-current sessions", async () => {
    const store = await createTestStore();
    const current = await seedReadyProduct(store, "Current");
    const other = await seedReadyProduct(store, "Other");
    await store.sessions.setCurrentProduct(current.id);

    await expect(store.deleteProduct({ product_id: current.id, confirm_product_id: current.id })).resolves.toMatchObject({
      product_id: current.id,
      session_cleared: true
    });
    expect(await store.sessions.getCurrentSession()).toEqual({ current_product: null });

    await store.sessions.setCurrentProduct(other.id);
    const stale = await seedReadyProduct(store, "Stale");
    await expect(store.deleteProduct({ product_id: stale.id, confirm_product_id: stale.id })).resolves.toMatchObject({
      product_id: stale.id,
      session_cleared: false
    });
    expect(await store.sessions.getCurrentSession()).toEqual({ current_product: other.id });
  });

  it("returns cleanup_pending after committed cleanup failure and recovery later removes committed staging", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-delete-cleanup-"));
    let failCleanup = true;
    let cleanupOperationDir = "";
    const store = createStoreWithDeletionHooks(home, {
      beforeCleanupOperationDir: async (operationDir: string) => {
        cleanupOperationDir = operationDir;
        if (failCleanup) {
          failCleanup = false;
          throw new Error(`cleanup unavailable for ${home} at ${operationDir}`);
        }
      }
    });
    const product = await seedReadyProduct(store);
    await writeComponentLibrary(store.home, product.id);

    const result = await store.deleteProduct({ product_id: product.id, confirm_product_id: product.id });
    expect(result).toMatchObject({
      product_id: product.id,
      deleted: true,
      cleanup_pending: true,
      recovery_warnings: [expect.stringContaining("cleanup unavailable")]
    });
    expect(result.recovery_warnings.join("\n")).not.toContain(home);
    expect(result.recovery_warnings.join("\n")).not.toContain(cleanupOperationDir);
    expect(await readdir(join(home, "tmp", "deletions"))).toHaveLength(1);

    await expect(store.recoverPendingProductDeletes()).resolves.toMatchObject({
      recovered: 0,
      cleaned: 1,
      warnings: []
    });
    expect(await readdir(join(home, "tmp", "deletions"))).toEqual([]);
  });

  it("reports both original deletion error and rollback error when rollback fails", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-delete-rollback-failure-"));
    const store = createStoreWithDeletionHooks(home, {
      afterPhasePersisted: async (state: ProductDeletionStateForTest) => {
        if (state.phase === "index_written") {
          await rm(join(home, "tmp", "deletions", state.operation_id, "backups", "products.yaml"), { force: true });
          throw new FormaError("INVALID_INPUT", "delete side failed", { cause: "original failure" });
        }
      }
    });
    const product = await seedReadyProduct(store);

    await expect(store.deleteProduct({ product_id: product.id, confirm_product_id: product.id })).rejects.toMatchObject({
      code: "PRODUCT_DELETION_RECOVERY_FAILED",
      details: {
        operation_id: expect.any(String),
        product_id: product.id,
        error_code: "INVALID_INPUT",
        message: "delete side failed",
        cause: { cause: "original failure" },
        rollback_error: expect.stringContaining("backup is missing")
      }
    });
  });

  it("rolls back uncommitted staging by restoring products index, session, product data, and component library", async () => {
    const store = await createTestStore();
    const product = await seedReadyProduct(store);
    await writeComponentLibrary(store.home, product.id, { children: [{ id: "original" }] });
    await store.sessions.setCurrentProduct(product.id);
    const operationId = "op-uncommitted";
    const operationDir = await writeDeletionState(
      store.home,
      deletionState({ operationId, productId: product.id, phase: "index_written" })
    );
    await mkdir(join(operationDir, "backups"), { recursive: true });
    await writeFile(join(operationDir, "backups", "products.yaml"), await readFile(join(store.home, "data", "products.yaml"), "utf8"));
    await writeFile(join(operationDir, "backups", "session.yaml"), await readFile(join(store.home, "session.yaml"), "utf8"));
    await writeFile(join(store.home, "data", "products.yaml"), "products: []\n", "utf8");
    await writeFile(join(store.home, "session.yaml"), "current_product: null\n", "utf8");
    await mkdir(join(operationDir, "staged", "data"), { recursive: true });
    await mkdir(join(operationDir, "staged", "library"), { recursive: true });
    await rename(join(store.home, "data", product.id), join(operationDir, "staged", "data", product.id));
    await rename(join(store.home, "library", `${product.id}.lib.pen`), join(operationDir, "staged", "library", `${product.id}.lib.pen`));

    await expect(store.recoverPendingProductDeletes()).resolves.toMatchObject({ recovered: 1, cleaned: 0, warnings: [] });

    await expect(store.products.getProduct(product.id)).resolves.toMatchObject({ id: product.id });
    expect(await store.sessions.getCurrentSession()).toEqual({ current_product: product.id });
    expect(JSON.parse(await readFile(join(store.home, "library", `${product.id}.lib.pen`), "utf8"))).toEqual({
      children: [{ id: "original" }]
    });
    await expect(access(operationDir)).rejects.toThrow();
  });

  it("recovers an initial created deletion state without requiring backups", async () => {
    const store = await createTestStore();
    const product = await seedReadyProduct(store);
    const operationDir = await writeDeletionState(
      store.home,
      deletionState({
        operationId: "op-created-only",
        productId: product.id,
        phase: "created",
        backups: { products_yaml: "backups/products.yaml" },
        movedPaths: [],
        missingPaths: [],
        sessionWasCurrent: false
      })
    );

    await expect(store.recoverPendingProductDeletes()).resolves.toMatchObject({
      recovered: 1,
      cleaned: 0,
      warnings: []
    });

    await expect(store.products.getProduct(product.id)).resolves.toMatchObject({ id: product.id });
    await expect(access(operationDir)).rejects.toThrow();
  });

  it("returns product mutation lock context warnings from recoverPendingProductDeletes", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-delete-recover-warning-"));
    const productMutationLock = createRecordingLock("recover lock warning");
    const store = createFormaStore({ home, bundledStylesDir: resolve("styles"), productMutationLock });
    await mkdir(join(home, "tmp", "deletions", "missing-state"), { recursive: true });
    productMutationLock.calls.length = 0;

    await expect(store.recoverPendingProductDeletes()).resolves.toMatchObject({
      recovered: 0,
      cleaned: 1,
      warnings: [expect.stringContaining("missing or corrupt state"), "recover lock warning"]
    });
    expect(productMutationLock.calls).toEqual([{ operation: "recover_product_deletes" }]);
  });

  it("cleans a safe empty operation dir with missing or corrupt state and returns warnings", async () => {
    const store = await createTestStore();
    await mkdir(join(store.home, "tmp", "deletions", "missing-state"), { recursive: true });
    await mkdir(join(store.home, "tmp", "deletions", "corrupt-state"), { recursive: true });
    await writeFile(join(store.home, "tmp", "deletions", "corrupt-state", ".state.json.tmp"), "{", "utf8");

    const result = await store.recoverPendingProductDeletes();

    expect(result.cleaned).toBe(2);
    expect(result.recovered).toBe(0);
    expect(result.warnings).toHaveLength(2);
    expect(await readdir(join(store.home, "tmp", "deletions"))).toEqual([]);
  });

  it("fails closed for an unsafe missing or corrupt state without active mutation", async () => {
    const store = await createTestStore();
    const product = await seedReadyProduct(store);
    await mkdir(join(store.home, "tmp", "deletions", "unsafe", "staged"), { recursive: true });
    await writeFile(join(store.home, "tmp", "deletions", "unsafe", "staged", "payload"), "unknown", "utf8");

    await expect(store.recoverPendingProductDeletes()).rejects.toMatchObject({
      code: "PRODUCT_DELETION_RECOVERY_FAILED"
    });

    await expect(store.products.getProduct(product.id)).resolves.toMatchObject({ id: product.id });
    expect(await pathExists(join(store.home, "tmp", "deletions", "unsafe", "staged", "payload"))).toBe(true);
  });

  it("fails closed for committed states whose phase is not committed without active mutation", async () => {
    const store = await createTestStore();
    const product = await seedReadyProduct(store);
    const operationDir = await writeDeletionState(
      store.home,
      deletionState({
        operationId: "op-committed-phase-mismatch",
        productId: product.id,
        phase: "index_written",
        committed: true
      })
    );
    await mkdir(join(operationDir, "backups"), { recursive: true });
    await writeFile(
      join(operationDir, "backups", "products.yaml"),
      await readFile(join(store.home, "data", "products.yaml"), "utf8")
    );

    await expect(store.recoverPendingProductDeletes()).rejects.toMatchObject({
      code: "PRODUCT_DELETION_RECOVERY_FAILED"
    });

    await expect(store.products.getProduct(product.id)).resolves.toMatchObject({ id: product.id });
    expect(await pathExists(operationDir)).toBe(true);
  });

  it("persists full moved_paths and missing_paths while phase is backed_up before moving active paths", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-delete-plan-"));
    const snapshots: ProductDeletionStateForTest[] = [];
    const store = createStoreWithDeletionHooks(home, {
      afterPhasePersisted: async (state: ProductDeletionStateForTest) => {
        if (state.phase === "backed_up") {
          snapshots.push(JSON.parse(JSON.stringify(state)) as ProductDeletionStateForTest);
          expect(await pathExists(join(home, "data", state.product_id))).toBe(true);
          expect(await pathExists(join(home, "library", `${state.product_id}.lib.pen`))).toBe(true);
          expect(await pathExists(join(home, "tmp", "deletions", state.operation_id, "staged", "data", state.product_id))).toBe(false);
        }
      }
    });
    const product = await seedReadyProduct(store);
    await writeComponentLibrary(home, product.id);

    await store.deleteProduct({ product_id: product.id, confirm_product_id: product.id });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.moved_paths).toEqual([
      {
        kind: "product_data",
        original_path: `data/${product.id}`,
        staged_path: `staged/data/${product.id}`,
        required: true
      },
      {
        kind: "component_library",
        original_path: `library/${product.id}.lib.pen`,
        staged_path: `staged/library/${product.id}.lib.pen`,
        required: false
      }
    ]);
    expect(snapshots[0]!.missing_paths).toEqual([]);
  });

  it("does not return products removed from products.yaml even if product.yaml remains", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });
    await writeFile(join(store.home, "data", "products.yaml"), "products: []\n", "utf8");

    await expect(store.products.getProduct(product.id)).rejects.toMatchObject({
      code: "PRODUCT_NOT_FOUND",
      details: { product_id: product.id }
    });
  });

  it("keeps product reads consistent after backed_up, session_written, index_written, and before first move", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-delete-consistency-"));
    const observations: string[] = [];
    const assertConsistent = async (label: string, productId: string) => {
      const session = await readYaml<{ current_product: string | null }>(join(home, "session.yaml"));
      const index = await readYaml<{ products: Array<{ id: string }> }>(join(home, "data", "products.yaml"));
      const productDirExists = await pathExists(join(home, "data", productId));
      const indexHasProduct = index.products.some((entry) => entry.id === productId);
      expect(!(indexHasProduct && !productDirExists)).toBe(true);
      expect(!(session.current_product === productId && !productDirExists)).toBe(true);
      observations.push(`${label}:${session.current_product ?? "null"}:${indexHasProduct}:${productDirExists}`);
    };
    const store = createStoreWithDeletionHooks(home, {
      afterPhasePersisted: async (state: ProductDeletionStateForTest) => {
        if (["backed_up", "session_written", "index_written"].includes(state.phase)) {
          await assertConsistent(state.phase, state.product_id);
        }
      },
      beforeMovePath: async (entry: ProductDeletionStateForTest["moved_paths"][number], state: ProductDeletionStateForTest) => {
        if (entry.kind === "product_data") {
          await assertConsistent("before_first_move", state.product_id);
        }
      }
    });
    const product = await seedReadyProduct(store);
    await store.sessions.setCurrentProduct(product.id);
    await writeComponentLibrary(home, product.id);

    await store.deleteProduct({ product_id: product.id, confirm_product_id: product.id });

    expect(observations).toEqual([
      `backed_up:${product.id}:true:true`,
      "session_written:null:true:true",
      "index_written:null:false:true",
      "before_first_move:null:false:true"
    ]);
  });

  it("recovers idempotently after the first moved path before phase moved", async () => {
    const store = await createTestStore();
    const product = await seedReadyProduct(store);
    await writeComponentLibrary(store.home, product.id);
    await store.sessions.setCurrentProduct(product.id);
    const operationId = "op-after-first-move";
    const operationDir = await writeDeletionState(
      store.home,
      deletionState({ operationId, productId: product.id, phase: "index_written" })
    );
    await mkdir(join(operationDir, "backups"), { recursive: true });
    await writeFile(join(operationDir, "backups", "products.yaml"), `products:\n  - id: ${product.id}\n    name: Shop App\n    description: Mobile shop\n`, "utf8");
    await writeFile(join(operationDir, "backups", "session.yaml"), `current_product: ${product.id}\n`, "utf8");
    await writeFile(join(store.home, "data", "products.yaml"), "products: []\n", "utf8");
    await writeFile(join(store.home, "session.yaml"), "current_product: null\n", "utf8");
    await mkdir(join(operationDir, "staged", "data"), { recursive: true });
    await rename(join(store.home, "data", product.id), join(operationDir, "staged", "data", product.id));

    await expect(store.recoverPendingProductDeletes()).resolves.toMatchObject({ recovered: 1, cleaned: 0 });

    await expect(store.products.getProduct(product.id)).resolves.toMatchObject({ id: product.id });
    expect(await store.sessions.getCurrentSession()).toEqual({ current_product: product.id });
    expect(await pathExists(join(store.home, "library", `${product.id}.lib.pen`))).toBe(true);
  });

  it("recovers idempotently after index and session writes before phase update", async () => {
    const store = await createTestStore();
    const product = await seedReadyProduct(store);
    await store.sessions.setCurrentProduct(product.id);
    const operationId = "op-before-phase-update";
    const operationDir = await writeDeletionState(
      store.home,
      deletionState({ operationId, productId: product.id, phase: "backed_up" })
    );
    await mkdir(join(operationDir, "backups"), { recursive: true });
    await writeFile(join(operationDir, "backups", "products.yaml"), `products:\n  - id: ${product.id}\n    name: Shop App\n    description: Mobile shop\n`, "utf8");
    await writeFile(join(operationDir, "backups", "session.yaml"), `current_product: ${product.id}\n`, "utf8");
    await writeFile(join(store.home, "data", "products.yaml"), "products: []\n", "utf8");
    await writeFile(join(store.home, "session.yaml"), "current_product: null\n", "utf8");

    await expect(store.recoverPendingProductDeletes()).resolves.toMatchObject({ recovered: 1, cleaned: 0 });

    await expect(store.products.getProduct(product.id)).resolves.toMatchObject({ id: product.id });
    expect(await store.sessions.getCurrentSession()).toEqual({ current_product: product.id });
  });

  it("preserves original files and records a warning when rollback sees duplicate original and staged paths", async () => {
    const store = await createTestStore();
    const product = await seedReadyProduct(store);
    await writeComponentLibrary(store.home, product.id, { children: [{ id: "original" }] });
    const operationId = "op-duplicate";
    const operationDir = await writeDeletionState(
      store.home,
      deletionState({
        operationId,
        productId: product.id,
        phase: "index_written",
        movedPaths: [
          {
            kind: "component_library",
            original_path: `library/${product.id}.lib.pen`,
            staged_path: `staged/library/${product.id}.lib.pen`,
            required: false
          }
        ],
        backups: { products_yaml: "backups/products.yaml" },
        sessionWasCurrent: false
      })
    );
    await mkdir(join(operationDir, "backups"), { recursive: true });
    await mkdir(join(operationDir, "staged", "library"), { recursive: true });
    await writeFile(join(operationDir, "backups", "products.yaml"), await readFile(join(store.home, "data", "products.yaml"), "utf8"));
    await writeFile(join(operationDir, "staged", "library", `${product.id}.lib.pen`), JSON.stringify({ children: [{ id: "staged" }] }), "utf8");

    const result = await store.recoverPendingProductDeletes();

    expect(result.recovered).toBe(1);
    expect(result.warnings).toEqual([expect.stringContaining("duplicate staged path")]);
    expect(JSON.parse(await readFile(join(store.home, "library", `${product.id}.lib.pen`), "utf8"))).toEqual({
      children: [{ id: "original" }]
    });
  });

  it("fails recovery when a required moved path is missing from both original and staged paths", async () => {
    const store = await createTestStore();
    const product = await seedReadyProduct(store);
    const operationId = "op-missing-required";
    const operationDir = await writeDeletionState(
      store.home,
      deletionState({ operationId, productId: product.id, phase: "index_written" })
    );
    await mkdir(join(operationDir, "backups"), { recursive: true });
    await writeFile(join(operationDir, "backups", "products.yaml"), await readFile(join(store.home, "data", "products.yaml"), "utf8"));
    await writeFile(join(operationDir, "backups", "session.yaml"), "current_product: null\n", "utf8");
    await writeFile(join(store.home, "data", "products.yaml"), "products: []\n", "utf8");
    await rename(join(store.home, "data", product.id), join(operationDir, "lost-product-data"));

    await expect(store.recoverPendingProductDeletes()).rejects.toMatchObject({
      code: "PRODUCT_DELETION_RECOVERY_FAILED"
    });
  });

  it("does not read outside data dir for invalid product ids", async () => {
    const store = await createTestStore();
    await mkdir(join(store.home, "outside"), { recursive: true });
    await writeFile(join(store.home, "outside", "product.yaml"), "id: P-123456\nname: Escape\ndescription: Outside\n");

    await expect(store.products.getProduct("../outside")).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
  });

  it("reports missing products with stable error codes", async () => {
    const store = await createTestStore();

    await expect(store.products.getProduct("P-missing")).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
  });

  it("rejects unsafe style design paths in product config", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });
    const baseConfig = {
      platform: "mobile" as const,
      languages: ["en"] as ["en"],
      default_language: "en" as const,
      style: {
        name: "linear",
        description: "Focused tool UI",
        design_md_path: "styles/linear/DESIGN.md",
        variables: store.styles.withDefaultVariables({})
      }
    };

    await expect(
      store.products.initProductConfig(product.id, {
        ...baseConfig,
        style: { ...baseConfig.style, design_md_path: "../outside.md" }
      })
    ).rejects.toThrow();
    await expect(
      store.products.initProductConfig(product.id, {
        ...baseConfig,
        style: { ...baseConfig.style, design_md_path: "/tmp/outside.md" }
      })
    ).rejects.toThrow();
  });

  it("rejects incomplete style variables in product config", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });

    await expect(
      store.products.initProductConfig(product.id, {
        platform: "mobile",
        languages: ["en"],
        default_language: "en",
        style: {
          name: "linear",
          description: "Focused tool UI",
          design_md_path: "styles/linear/DESIGN.md",
          variables: {
            primary: "#5E6AD2"
          }
        }
      })
    ).rejects.toThrow();
  });

  it("installs and reads built-in styles", async () => {
    const store = await createTestStore();

    await store.styles.installBuiltInStyles();

    const styles = await store.styles.listStyles();
    expect(styles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "linear",
          description: "Focused tool UI",
          design_md_path: "styles/linear/DESIGN.md"
        }),
        expect.objectContaining({
          name: "claude",
          design_md_path: "styles/claude/DESIGN.md"
        })
      ])
    );
    expect(await readFile(join(store.home, "styles", "_preview-template.pen"), "utf8")).toContain("Forma Style Preview");

    const linear = await store.styles.getStyle("linear");
    expect(linear.metadata).toMatchObject({ name: "linear", description: "Focused tool UI" });
    expect(linear.designMd).toContain("# Linear");

    await expect(store.styles.getStyle("missing")).rejects.toMatchObject({ code: "STYLE_NOT_FOUND" });
  });

  it("auto-installs built-in styles when listing styles in a fresh home", async () => {
    const store = await createTestStore();

    const styles = await store.styles.listStyles();

    expect(styles).toEqual(expect.arrayContaining([expect.objectContaining({ name: "linear" })]));
    await expect(access(join(store.home, "styles", "styles.yaml"))).resolves.toBeUndefined();
    await expect(access(join(store.home, "styles", "linear", "DESIGN.md"))).resolves.toBeUndefined();
  });

  it("does not overwrite existing home styles on reinstall", async () => {
    const store = await createTestStore();
    await store.styles.installBuiltInStyles();
    await writeFile(join(store.home, "styles", "linear", "DESIGN.md"), "# Local Linear\n");

    await store.styles.installBuiltInStyles();

    expect(await readFile(join(store.home, "styles", "linear", "DESIGN.md"), "utf8")).toBe("# Local Linear\n");
  });

  it("does not mark components initialized until a persisted component library exists", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });

    await expect(store.products.markComponentsInitialized(product.id)).rejects.toMatchObject({
      code: "PRODUCT_CONFIG_INCOMPLETE",
      details: { missing: ["components_library"] }
    });

    await mkdir(join(store.home, "library"), { recursive: true });
    await writeFile(join(store.home, "library", `${product.id}.lib.pen`), JSON.stringify({ children: [{ id: "button", type: "component" }] }));

    await expect(store.products.markComponentsInitialized(product.id)).resolves.toMatchObject({
      id: product.id,
      components_initialized: true
    });
  });

  it("rejects invalid persisted component libraries", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });
    await mkdir(join(store.home, "library"), { recursive: true });
    await writeFile(join(store.home, "library", `${product.id}.lib.pen`), "not json");

    await expect(store.products.markComponentsInitialized(product.id)).rejects.toMatchObject({
      code: "PEN_FILE_INVALID"
    });
  });

  it("fills default style variables", async () => {
    const store = await createTestStore();

    expect(store.styles.withDefaultVariables({ primary: "#5E6AD2" })).toEqual({
      primary: "#5E6AD2",
      background: "#FFFFFF",
      "text-primary": "#111827",
      "font-heading": "Inter",
      "font-body": "Inter",
      "border-radius": "8px",
      "spacing-unit": "8px"
    });
  });
});
