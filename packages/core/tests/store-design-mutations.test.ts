/**
 * store-design-mutations.test.ts — review regressions for store-level guards.
 *
 *   #4: generateRequirementDesign validates requirement ownership + page existence
 *       before writing an artifact / design pointer.
 *   #5: changeArtifactStyle rejects source artifacts whose kind does not support
 *       style changes (markdown-document / svg / image / preview-only).
 *
 * Both guards run before the save pipeline, so these tests never start a browser.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFormaStore } from "../src/store.js";
import { createArtifactStore, type ArtifactStore } from "../src/artifact-store.js";
import { FormaError } from "../src/errors.js";
import type { ArtifactManifest } from "../src/artifact-manifest.js";
import { getFormaPaths } from "../src/paths.js";
import { getProductMutationLock } from "../src/product-mutation-lock.js";

async function createTestStore() {
  const home = await mkdtemp(join(tmpdir(), "forma-store-mut-"));
  return createFormaStore({
    home,
    bundledStylesDir: resolve("styles"),
    bundledCraftDir: resolve("craft"),
  });
}

function createDeferred<T = void>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

interface SeedPageInput {
  page_id: string;
  name: string;
  baseline_page: string;
  features: string;
}

async function seedProductWithPages(store: Awaited<ReturnType<typeof createTestStore>>, pages: SeedPageInput[]) {
  const product = await store.products.createProduct({
    name: "Checkout App",
    description: "Mobile checkout workbench",
  });
  await store.products.initProductConfig(product.id, {
    platform: "web",
    brand_style: "ant",
    languages: ["en"],
    default_language: "en",
  });
  const req = await store.requirements.createEmptyRequirement(product.id, "Checkout flow");
  await store.requirements.saveRequirement({
    requirement_id: req.id,
    document_md: "# Checkout flow\nUsers can checkout items.",
    ui_affected: true,
    pages: pages.map((page) => ({ ...page, change_type: "new" })),
    navigation: [],
    translations: [],
    rules: [],
    remove_rule_ids: [],
    remove_page_ids: [],
  });
  return { product, requirementId: req.id, pageIds: pages.map((page) => page.page_id) };
}

async function seedProductWithPage(store: Awaited<ReturnType<typeof createTestStore>>) {
  const seeded = await seedProductWithPages(store, [
    { page_id: "page-cart-01", name: "Cart Page", baseline_page: "cart", features: "Cart" },
  ]);
  return { product: seeded.product, requirementId: seeded.requirementId, pageId: seeded.pageIds[0] };
}

const DESIGN_HTML = "<!doctype html><html><body><h1>x</h1></body></html>";

describe("Review #4: generateRequirementDesign validates requirement + page", () => {
  it("throws REQUIREMENT_NOT_FOUND for an unknown requirement and writes nothing", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "P", description: "d" });

    await expect(
      store.generateRequirementDesign(product.id, "R-deadbeef", {
        html: DESIGN_HTML,
        title: "T",
        pageId: "page-x",
        brandStyle: "ant",
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof FormaError && e.code === "REQUIREMENT_NOT_FOUND");

    expect(await store.artifacts.listArtifacts(product.id)).toEqual([]);
  });

  it("throws REQUIREMENT_PAGE_NOT_FOUND for a typo page_id and writes nothing", async () => {
    const store = await createTestStore();
    const { product, requirementId } = await seedProductWithPage(store);

    await expect(
      store.generateRequirementDesign(product.id, requirementId, {
        html: DESIGN_HTML,
        title: "T",
        pageId: "page-typo",
        brandStyle: "ant",
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof FormaError && e.code === "REQUIREMENT_PAGE_NOT_FOUND");

    expect(await store.artifacts.listArtifacts(product.id)).toEqual([]);
  });

  it("throws REQUIREMENT_PRODUCT_MISMATCH when the requirement belongs to another product", async () => {
    const store = await createTestStore();
    const { requirementId, pageId } = await seedProductWithPage(store);
    const other = await store.products.createProduct({ name: "Other", description: "d" });

    await expect(
      store.generateRequirementDesign(other.id, requirementId, {
        html: DESIGN_HTML,
        title: "T",
        pageId,
        brandStyle: "ant",
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof FormaError && e.code === "REQUIREMENT_PRODUCT_MISMATCH");

    expect(await store.artifacts.listArtifacts(other.id)).toEqual([]);
  });

  it("marks a generated page done and activates a single-page requirement", async () => {
    const store = await createTestStore();
    const { product, requirementId, pageId } = await seedProductWithPage(store);

    await expect(store.requirements.getRequirement({ requirement_id: requirementId })).resolves.toMatchObject({
      status: "submitted",
      pages: [expect.objectContaining({ page_id: pageId, design_status: "pending" })],
    });

    await store.generateRequirementDesign(product.id, requirementId, {
      html: DESIGN_HTML,
      title: "Cart design",
      pageId,
      brandStyle: "ant",
    });

    await expect(store.requirements.getRequirement({ requirement_id: requirementId })).resolves.toMatchObject({
      status: "active",
      pages: [expect.objectContaining({ page_id: pageId, design_status: "done" })],
    });
  });

  it("keeps the requirement submitted until every page has a generated design", async () => {
    const store = await createTestStore();
    const { product, requirementId, pageIds } = await seedProductWithPages(store, [
      { page_id: "page-cart-01", name: "Cart Page", baseline_page: "cart", features: "Cart" },
      { page_id: "page-summary-01", name: "Summary Page", baseline_page: "summary", features: "Summary" },
    ]);

    await store.generateRequirementDesign(product.id, requirementId, {
      html: DESIGN_HTML,
      title: "Cart design",
      pageId: pageIds[0],
      brandStyle: "ant",
    });
    const afterFirstDesign = await store.requirements.getRequirement({ requirement_id: requirementId });
    expect(afterFirstDesign.status).toBe("submitted");
    expect(Object.fromEntries(afterFirstDesign.pages.map((page) => [page.page_id, page.design_status]))).toEqual({
      "page-cart-01": "done",
      "page-summary-01": "pending",
    });

    await store.generateRequirementDesign(product.id, requirementId, {
      html: DESIGN_HTML,
      title: "Summary design",
      pageId: pageIds[1],
      brandStyle: "ant",
    });

    const afterSecondDesign = await store.requirements.getRequirement({ requirement_id: requirementId });
    expect(afterSecondDesign.status).toBe("active");
    expect(Object.fromEntries(afterSecondDesign.pages.map((page) => [page.page_id, page.design_status]))).toEqual({
      "page-cart-01": "done",
      "page-summary-01": "done",
    });
  });

  it("appends repeated page generations to the current artifact so rollback can target prior versions", async () => {
    const store = await createTestStore();
    const { product, requirementId, pageId } = await seedProductWithPage(store);

    const first = await store.generateRequirementDesign(product.id, requirementId, {
      html: "<!doctype html><html><body><h1>First</h1></body></html>",
      title: "First design",
      pageId,
      brandStyle: "ant",
    });
    const second = await store.generateRequirementDesign(product.id, requirementId, {
      html: "<!doctype html><html><body><h1>Second</h1></body></html>",
      title: "Second design",
      pageId,
      brandStyle: "ant",
    });

    expect(second.artifact_id).toBe(first.artifact_id);
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    await expect(store.artifacts.listArtifactVersions(product.id, first.artifact_id)).resolves.toEqual([1, 2]);
    await expect(store.products.getDesignPointer(product.id, requirementId, pageId, "default")).resolves.toMatchObject({
      artifactId: first.artifact_id,
      version: 2,
    });
  });

  it("rejects stale page revisions before writing an artifact or pointer", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-store-mut-stale-"));
    const lock = getProductMutationLock(home);
    const realArtifacts = createArtifactStore(getFormaPaths(home).productsDir, lock);
    const writeStarted = createDeferred();
    const releaseWrite = createDeferred();
    const artifactStore: ArtifactStore = {
      writeArtifact: realArtifacts.writeArtifact.bind(realArtifacts),
      readArtifact: realArtifacts.readArtifact.bind(realArtifacts),
      listArtifacts: realArtifacts.listArtifacts.bind(realArtifacts),
      deleteArtifact: realArtifacts.deleteArtifact.bind(realArtifacts),
      readArtifactVersion: realArtifacts.readArtifactVersion.bind(realArtifacts),
      listArtifactVersions: realArtifacts.listArtifactVersions.bind(realArtifacts),
      async writeArtifactVersion(input) {
        writeStarted.resolve();
        await releaseWrite.promise;
        return realArtifacts.writeArtifactVersion(input);
      },
    };
    const store = await createFormaStore({
      home,
      productMutationLock: lock,
      artifactStore,
      bundledStylesDir: resolve("styles"),
      bundledCraftDir: resolve("craft"),
    });
    const { product, requirementId, pageId } = await seedProductWithPage(store);

    const savePromise = store.generateRequirementDesign(product.id, requirementId, {
      html: DESIGN_HTML,
      title: "Stale cart design",
      pageId,
      brandStyle: "ant",
    });
    await writeStarted.promise;

    await store.requirements.updateRequirement({
      requirement_id: requirementId,
      document_md: "# Checkout flow\nUsers can checkout items with updated cart behavior.",
      pages: [{ page_id: pageId, name: "Cart Page", baseline_page: "cart", features: "Cart v2" }],
      navigation: [],
      expired_pages: [pageId],
    });
    releaseWrite.resolve();

    await expect(savePromise).rejects.toSatisfy(
      (e: unknown) => e instanceof FormaError && e.code === "REQUIREMENT_REVISION_CONFLICT",
    );
    await expect(store.products.getDesignPointer(product.id, requirementId, pageId, "default")).resolves.toBeUndefined();
    await expect(store.artifacts.listArtifacts(product.id)).resolves.toEqual([]);
    await expect(store.requirements.getRequirement({ requirement_id: requirementId })).resolves.toMatchObject({
      status: "submitted",
      pages: [expect.objectContaining({ page_id: pageId, design_status: "expired" })],
    });
  }, 90000);

  it("allows concurrent saves for different pages in the same requirement", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-store-mut-parallel-"));
    const lock = getProductMutationLock(home);
    const realArtifacts = createArtifactStore(getFormaPaths(home).productsDir, lock);
    const writesQueued = createDeferred();
    const writeQueue: Array<{ pageId?: string; release: ReturnType<typeof createDeferred> }> = [];
    const artifactStore: ArtifactStore = {
      writeArtifact: realArtifacts.writeArtifact.bind(realArtifacts),
      readArtifact: realArtifacts.readArtifact.bind(realArtifacts),
      listArtifacts: realArtifacts.listArtifacts.bind(realArtifacts),
      deleteArtifact: realArtifacts.deleteArtifact.bind(realArtifacts),
      readArtifactVersion: realArtifacts.readArtifactVersion.bind(realArtifacts),
      listArtifactVersions: realArtifacts.listArtifactVersions.bind(realArtifacts),
      async writeArtifactVersion(input) {
        const release = createDeferred();
        writeQueue.push({ pageId: input.manifest.forma?.pageId, release });
        if (writeQueue.length === 2) {
          writesQueued.resolve();
        }
        await release.promise;
        return realArtifacts.writeArtifactVersion(input);
      },
    };
    const store = await createFormaStore({
      home,
      productMutationLock: lock,
      artifactStore,
      bundledStylesDir: resolve("styles"),
      bundledCraftDir: resolve("craft"),
    });
    const { product, requirementId, pageIds } = await seedProductWithPages(store, [
      { page_id: "page-cart-01", name: "Cart Page", baseline_page: "cart", features: "Cart" },
      { page_id: "page-summary-01", name: "Summary Page", baseline_page: "summary", features: "Summary" },
    ]);

    const cartSave = store.generateRequirementDesign(product.id, requirementId, {
      html: DESIGN_HTML,
      title: "Cart design",
      pageId: pageIds[0],
      brandStyle: "ant",
    });
    const summarySave = store.generateRequirementDesign(product.id, requirementId, {
      html: DESIGN_HTML,
      title: "Summary design",
      pageId: pageIds[1],
      brandStyle: "ant",
    });
    await writesQueued.promise;

    const cartWrite = writeQueue.find((entry) => entry.pageId === pageIds[0]);
    const summaryWrite = writeQueue.find((entry) => entry.pageId === pageIds[1]);
    expect(cartWrite).toBeDefined();
    expect(summaryWrite).toBeDefined();

    cartWrite?.release.resolve();
    await expect(cartSave).resolves.toMatchObject({ version: 1 });
    await expect(store.requirements.getRequirement({ requirement_id: requirementId })).resolves.toMatchObject({
      status: "submitted",
      pages: [
        expect.objectContaining({ page_id: pageIds[0], design_status: "done" }),
        expect.objectContaining({ page_id: pageIds[1], design_status: "pending" }),
      ],
    });

    summaryWrite?.release.resolve();
    await expect(summarySave).resolves.toMatchObject({ version: 1 });
    await expect(store.requirements.getRequirement({ requirement_id: requirementId })).resolves.toMatchObject({
      status: "active",
      pages: [
        expect.objectContaining({ page_id: pageIds[0], design_status: "done" }),
        expect.objectContaining({ page_id: pageIds[1], design_status: "done" }),
      ],
    });
  }, 90000);

  it("rejects stale rule revisions before marking a generated page done", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-store-mut-rules-"));
    const lock = getProductMutationLock(home);
    const realArtifacts = createArtifactStore(getFormaPaths(home).productsDir, lock);
    const writeStarted = createDeferred();
    const releaseWrite = createDeferred();
    const artifactStore: ArtifactStore = {
      writeArtifact: realArtifacts.writeArtifact.bind(realArtifacts),
      readArtifact: realArtifacts.readArtifact.bind(realArtifacts),
      listArtifacts: realArtifacts.listArtifacts.bind(realArtifacts),
      deleteArtifact: realArtifacts.deleteArtifact.bind(realArtifacts),
      readArtifactVersion: realArtifacts.readArtifactVersion.bind(realArtifacts),
      listArtifactVersions: realArtifacts.listArtifactVersions.bind(realArtifacts),
      async writeArtifactVersion(input) {
        writeStarted.resolve();
        await releaseWrite.promise;
        return realArtifacts.writeArtifactVersion(input);
      },
    };
    const store = await createFormaStore({
      home,
      productMutationLock: lock,
      artifactStore,
      bundledStylesDir: resolve("styles"),
      bundledCraftDir: resolve("craft"),
    });
    const { product, requirementId, pageId } = await seedProductWithPage(store);

    const savePromise = store.generateRequirementDesign(product.id, requirementId, {
      html: DESIGN_HTML,
      title: "Rule-stale cart design",
      pageId,
      brandStyle: "ant",
    });
    await writeStarted.promise;

    await store.requirements.saveRequirement({
      requirement_id: requirementId,
      document_md: "# Checkout flow\nUsers can checkout items.",
      ui_affected: true,
      pages: [
        {
          page_id: pageId,
          name: "Cart Page",
          baseline_page: "cart",
          features: "Cart",
          change_type: "new",
        },
      ],
      navigation: [],
      translations: [],
      rules: [
        {
          id: "target-page-rule",
          page_id: pageId,
          given: "The cart has discounted items",
          when: "The design renders totals",
          then: "Show discount rows before the final total",
        },
      ],
      remove_rule_ids: [],
      remove_page_ids: [],
    });
    releaseWrite.resolve();

    await expect(savePromise).rejects.toSatisfy(
      (e: unknown) => e instanceof FormaError && e.code === "REQUIREMENT_REVISION_CONFLICT",
    );
    await expect(store.products.getDesignPointer(product.id, requirementId, pageId, "default")).resolves.toBeUndefined();
    await expect(store.artifacts.listArtifacts(product.id)).resolves.toEqual([]);
    await expect(store.requirements.getRequirement({ requirement_id: requirementId })).resolves.toMatchObject({
      status: "submitted",
      pages: [expect.objectContaining({ page_id: pageId, design_status: "pending" })],
    });
  }, 90000);
});

describe("SPEC-DATA-001: generateComponents with productIcon (store-level)", () => {
  const COMPONENT_HTML = "<!doctype html><html><body><h2>Buttons</h2></body></html>";

  it("generateComponents with productIcon → manifest has productIcon and assets with role icon; bundle has SVG files", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "IconApp", description: "d" });

    const svgText = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>`;
    const monoText = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8" fill="currentColor"/></svg>`;

    const result = await store.generateComponents(product.id, {
      html: COMPONENT_HTML,
      title: "Icon Library",
      brandStyle: "ant",
      productIcon: {
        primary: "assets/icon.svg",
        monochrome: "assets/icon-mono.svg",
        shape: { shapeId: "s1", geometry: "<path d='M0 0h8v8H0z'/>", sourceVersion: "1" },
      },
      supportingFiles: [
        { path: "assets/icon.svg", contentType: "image/svg+xml", contentBase64: Buffer.from(svgText).toString("base64") },
        { path: "assets/icon-mono.svg", contentType: "image/svg+xml", contentBase64: Buffer.from(monoText).toString("base64") },
      ],
    });

    expect(result.artifact_id).toBeTruthy();
    expect(result.version).toBe(1);

    // Read the manifest from disk
    const paths = getFormaPaths(store.home);
    const versionDir = join(paths.productsDir, product.id, "od-project", "artifacts", result.artifact_id, `v${result.version}`);
    const manifestRaw = await import("node:fs/promises").then((fs) =>
      fs.readFile(join(versionDir, "manifest.json"), "utf8"),
    );
    const manifest = JSON.parse(manifestRaw);

    // productIcon fields
    expect(manifest.forma.productIcon?.primary).toBe("assets/icon.svg");
    expect(manifest.forma.productIcon?.monochrome).toBe("assets/icon-mono.svg");
    expect(manifest.forma.productIcon?.shape?.shapeId).toBe("s1");
    expect(manifest.forma.productIcon?.shape?.geometry).toBe("<path d='M0 0h8v8H0z'/>");

    // assets: both SVG files registered with role "icon"
    const assets = manifest.forma.assets as Array<{ path: string; role: string }>;
    const iconAsset = assets.find((a) => a.path === "assets/icon.svg");
    expect(iconAsset?.role).toBe("icon");
    const monoAsset = assets.find((a) => a.path === "assets/icon-mono.svg");
    expect(monoAsset?.role).toBe("icon");

    // Bundle files: SVG content matches input
    const primaryContent = await import("node:fs/promises").then((fs) =>
      fs.readFile(join(versionDir, "assets", "icon.svg"), "utf8"),
    );
    expect(primaryContent).toBe(svgText);
    const monoContent = await import("node:fs/promises").then((fs) =>
      fs.readFile(join(versionDir, "assets", "icon-mono.svg"), "utf8"),
    );
    expect(monoContent).toBe(monoText);
  });
});

describe("SPEC-BEHAVIOR-008 / SPEC-DATA-002: component-library pointer activation (B2/B7)", () => {
  const COMPONENT_HTML_V1 = "<!doctype html><html><body><h2>Buttons v1</h2></body></html>";
  const COMPONENT_HTML_V2 = "<!doctype html><html><body><h2>Buttons v2</h2></body></html>";

  /**
   * Build a store whose component-library pointer commit (the afterWriteLocked
   * hook that runs INSIDE writeArtifactVersion's lock) is forced to throw, so we
   * can verify the just-written version dir is genuinely rolled back on disk.
   *
   * The failing hook throws BEFORE delegating to the real hook, so the real
   * pointer write never runs — modelling "pointer commit failed".
   */
  async function createPointerFailingStore() {
    const home = await mkdtemp(join(tmpdir(), "forma-store-mut-ptr-fail-"));
    const lock = getProductMutationLock(home);
    const realArtifacts = createArtifactStore(getFormaPaths(home).productsDir, lock);
    const artifactStore: ArtifactStore = {
      writeArtifact: realArtifacts.writeArtifact.bind(realArtifacts),
      readArtifact: realArtifacts.readArtifact.bind(realArtifacts),
      listArtifacts: realArtifacts.listArtifacts.bind(realArtifacts),
      deleteArtifact: realArtifacts.deleteArtifact.bind(realArtifacts),
      readArtifactVersion: realArtifacts.readArtifactVersion.bind(realArtifacts),
      listArtifactVersions: realArtifacts.listArtifactVersions.bind(realArtifacts),
      async writeArtifactVersion(input) {
        // Only sabotage the pointer commit for component libraries.
        if (input.manifest.kind !== "component-library") {
          return realArtifacts.writeArtifactVersion(input);
        }
        return realArtifacts.writeArtifactVersion({
          ...input,
          afterWriteLocked: async () => {
            throw new FormaError("ARTIFACT_WRITE_FAIL", "injected pointer commit failure", {});
          },
        });
      },
    };
    const store = await createFormaStore({
      home,
      productMutationLock: lock,
      artifactStore,
      bundledStylesDir: resolve("styles"),
      bundledCraftDir: resolve("craft"),
    });
    return store;
  }

  async function listComponentLibraries(
    store: Awaited<ReturnType<typeof createTestStore>>,
    productId: string,
  ): Promise<string[]> {
    const all = await store.artifacts.listArtifacts(productId);
    const libs: string[] = [];
    for (const { artifactId } of all) {
      const versions = await store.artifacts.listArtifactVersions(productId, artifactId);
      if (versions.length === 0) continue;
      const { manifest } = await store.artifacts.readArtifactVersion(productId, artifactId, Math.max(...versions));
      if (manifest.kind === "component-library") libs.push(artifactId);
    }
    return libs;
  }

  async function currentComponentLibrary(
    store: Awaited<ReturnType<typeof createTestStore>>,
    productId: string,
  ): Promise<{ artifactId: string; version: number } | undefined> {
    const product = await store.products.getProduct(productId);
    const artifactId = product.designSystemArtifactId;
    if (artifactId === undefined) return undefined;
    const versions = await store.artifacts.listArtifactVersions(productId, artifactId);
    if (versions.length === 0) return undefined;
    return { artifactId, version: Math.max(...versions) };
  }

  it("first refine sets pointer; subsequent appends same artifact version", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "CompApp", description: "d" });

    const a = await store.generateComponents(product.id, {
      html: COMPONENT_HTML_V1,
      title: "Component Library",
      brandStyle: "ant",
    });
    const p1 = await store.products.getProduct(product.id);
    expect(p1.designSystemArtifactId).toBe(a.artifact_id);

    const b = await store.generateComponents(product.id, {
      html: COMPONENT_HTML_V2,
      title: "Component Library",
      brandStyle: "ant",
    });
    expect(b.artifact_id).toBe(a.artifact_id); // same artifact
    expect(b.version).toBe(a.version + 1); // appended version

    // Pointer unchanged; current = max(listArtifactVersions)
    const p2 = await store.products.getProduct(product.id);
    expect(p2.designSystemArtifactId).toBe(a.artifact_id);
    await expect(store.artifacts.listArtifactVersions(product.id, a.artifact_id)).resolves.toEqual([1, 2]);
  });

  it("does not leave a component-library without a current pointer when pointer commit fails", async () => {
    const store = await createPointerFailingStore();
    const product = await store.products.createProduct({ name: "CompFail", description: "d" });

    await expect(
      store.generateComponents(product.id, {
        html: COMPONENT_HTML_V1,
        title: "Component Library",
        brandStyle: "ant",
      }),
    ).rejects.toBeDefined();

    expect(await listComponentLibraries(store, product.id)).toHaveLength(0);
    expect((await store.products.getProduct(product.id)).designSystemArtifactId).toBeUndefined();
  });

  it("does not expose an unintended latest component-library version when append pointer commit fails", async () => {
    // First create succeeds with a real store, then the SAME home is reopened
    // with a pointer-failing store to sabotage the append's pointer commit.
    const home = await mkdtemp(join(tmpdir(), "forma-store-mut-ptr-append-"));
    const lock = getProductMutationLock(home);
    const realArtifacts = createArtifactStore(getFormaPaths(home).productsDir, lock);

    const goodStore = await createFormaStore({
      home,
      productMutationLock: lock,
      bundledStylesDir: resolve("styles"),
      bundledCraftDir: resolve("craft"),
    });
    const product = await goodStore.products.createProduct({ name: "CompAppend", description: "d" });
    const first = await goodStore.generateComponents(product.id, {
      html: COMPONENT_HTML_V1,
      title: "Component Library",
      brandStyle: "ant",
    });

    let sabotage = false;
    const artifactStore: ArtifactStore = {
      writeArtifact: realArtifacts.writeArtifact.bind(realArtifacts),
      readArtifact: realArtifacts.readArtifact.bind(realArtifacts),
      listArtifacts: realArtifacts.listArtifacts.bind(realArtifacts),
      deleteArtifact: realArtifacts.deleteArtifact.bind(realArtifacts),
      readArtifactVersion: realArtifacts.readArtifactVersion.bind(realArtifacts),
      listArtifactVersions: realArtifacts.listArtifactVersions.bind(realArtifacts),
      async writeArtifactVersion(input) {
        if (!sabotage || input.manifest.kind !== "component-library") {
          return realArtifacts.writeArtifactVersion(input);
        }
        return realArtifacts.writeArtifactVersion({
          ...input,
          afterWriteLocked: async () => {
            throw new FormaError("ARTIFACT_WRITE_FAIL", "injected append pointer commit failure", {});
          },
        });
      },
    };
    const failStore = await createFormaStore({
      home,
      productMutationLock: lock,
      artifactStore,
      bundledStylesDir: resolve("styles"),
      bundledCraftDir: resolve("craft"),
    });

    sabotage = true;
    await expect(
      failStore.generateComponents(product.id, {
        html: COMPONENT_HTML_V2,
        title: "Component Library",
        brandStyle: "ant",
      }),
    ).rejects.toBeDefined();

    // The failed append did not become max/current; pointer still resolves v1.
    await expect(failStore.artifacts.listArtifactVersions(product.id, first.artifact_id)).resolves.toEqual([1]);
    expect(await currentComponentLibrary(failStore, product.id)).toMatchObject({
      artifactId: first.artifact_id,
      version: first.version,
    });
  });
});

describe("Review #5: changeArtifactStyle rejects unsupported source kinds", () => {
  it("throws ARTIFACT_INVALID_INPUT for a markdown-document source artifact", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "P", description: "d" });

    const manifest: ArtifactManifest = {
      version: 1,
      id: "MarkdownDoc1234A",
      kind: "markdown-document",
      renderer: "markdown",
      title: "Doc",
      entry: "index.md",
      status: "complete",
      exports: ["index.md"],
      createdAt: "2026-05-30T00:00:00.000Z",
      updatedAt: "2026-05-30T00:00:00.000Z",
    };
    const { artifactId } = await store.artifacts.writeArtifact({
      productId: product.id,
      manifest,
      files: new Map([["index.md", Buffer.from("# Doc")]]),
    });

    await expect(
      store.changeArtifactStyle(product.id, artifactId, {
        html: DESIGN_HTML,
        title: "Restyled",
        brandStyle: "ant",
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof FormaError && e.code === "ARTIFACT_INVALID_INPUT");

    // No new version was appended to the markdown artifact
    expect(await store.artifacts.listArtifactVersions(product.id, artifactId)).toEqual([]);
  });
});
