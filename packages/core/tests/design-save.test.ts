/**
 * design-save.test.ts — TDD for saveDesignArtifact (P4.3)
 *
 * Uses a real tmp $FORMA_HOME + createFormaStore for integration tests.
 * Preview rendering uses headless browser — may need dangerouslyDisableSandbox.
 */

import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createFormaStore } from "../src/store.js";
import { saveDesignArtifact, type SaveDesignInput } from "../src/design-save.js";
import { FormaError } from "../src/errors.js";
import { getFormaPaths } from "../src/paths.js";
import { validateStaticArtifact } from "../src/artifact-static-validation.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeHome(): string {
  return join(tmpdir(), `forma-design-save-test-${randomBytes(6).toString("hex")}`);
}

/**
 * Generate a small 3x3 PNG as a Buffer (real valid PNG via sharp),
 * then base64-encode it as a data: URL suitable for use in HTML.
 */
async function makeDataPng(): Promise<string> {
  const buf = await sharp({
    create: { width: 3, height: 3, channels: 3, background: { r: 100, g: 150, b: 200 } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

/**
 * Generate a small SVG with an embedded <script> as a data: URL.
 * After localizeArtifactAssets, this SVG becomes a .svg file in assets/,
 * and validateStaticArtifact should catch the <script> in the SVG.
 */
function makeScriptSvgDataUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// ─── Test state ───────────────────────────────────────────────────────────────

let home: string;
let store: Awaited<ReturnType<typeof createFormaStore>>;
let productId: string;

const homes: string[] = [];

beforeEach(async () => {
  home = makeHome();
  homes.push(home);
  await mkdir(home, { recursive: true });
  store = await createFormaStore({ home });
  // Create a product to write artifacts under
  const product = await store.products.createProduct({ name: "Test Product", description: "desc" });
  productId = product.id;
}, 30000);

afterEach(async () => {
  await Promise.all(homes.splice(0).map((h) => rm(h, { recursive: true, force: true })));
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function makeCleanInput(overrides: Partial<SaveDesignInput> = {}): Promise<SaveDesignInput> {
  const dataPng = await makeDataPng();
  const html = `<!doctype html><html><body style="margin:0"><img src="${dataPng}" alt="test"></body></html>`;
  return {
    productId,
    kind: "design-page" as const,
    html,
    title: "Test Design Page",
    forma: {
      requirementId: "req-001",
      pageId: "page-001",
      variant: "default",
    },
    ...overrides,
  };
}

function makeDeps() {
  const productsDir = getFormaPaths(home).productsDir;
  return {
    artifacts: store.artifacts,
    products: store.products,
    runProductMutation: store.runProductMutation.bind(store),
    productsRoot: productsDir,
  };
}

function artifactVersionDir(
  deps: ReturnType<typeof makeDeps>,
  artifactProductId: string,
  artifactId: string,
  version: number,
): string {
  return join(deps.productsRoot, artifactProductId, "od-project", "artifacts", artifactId, `v${version}`);
}

async function readManifest(productsRoot: string, artifactId: string, version = 1) {
  const manifestJson = await readFile(
    join(productsRoot, productId, "od-project", "artifacts", artifactId, `v${version}`, "manifest.json"),
    "utf8",
  );
  return JSON.parse(manifestJson);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("saveDesignArtifact", () => {
  it('clean HTML + data:image/png → returns {artifactId, version:1, previewStatus:"ready"}, bundle on disk has index.html + assets/* + preview/1x.png + 2x.png, forma fields correct, design pointer created', async () => {
    const input = await makeCleanInput();
    const deps = makeDeps();

    const result = await saveDesignArtifact(deps, input);

    // Result shape
    expect(result.artifactId).toBeTruthy();
    expect(result.version).toBe(1);
    expect(result.previewStatus).toBe("ready");

    // Bundle on disk: version dir has index.html
    const { productsRoot } = deps;
    const versionDir = join(productsRoot, productId, "od-project", "artifacts", result.artifactId, "v1");
    const indexHtml = await readFile(join(versionDir, "index.html"), "utf8");
    expect(indexHtml).toBeTruthy();
    // index.html should not have data: URLs anymore (localized)
    expect(indexHtml).not.toContain("data:image/png;base64,");

    // assets/ dir has at least one file
    const assetsDir = join(versionDir, "assets");
    const { readdir } = await import("node:fs/promises");
    const assetFiles = await readdir(assetsDir);
    expect(assetFiles.length).toBeGreaterThan(0);

    // preview pngs exist
    expect(await readFile(join(versionDir, "preview", "1x.png"))).toBeTruthy();
    expect(await readFile(join(versionDir, "preview", "2x.png"))).toBeTruthy();

    // manifest has correct forma fields
    const manifestJson = await readFile(join(versionDir, "manifest.json"), "utf8");
    const manifest = JSON.parse(manifestJson);
    expect(manifest.kind).toBe("design-page");
    expect(manifest.forma.variant).toBe("default");
    expect(manifest.forma.requirementId).toBe("req-001");
    expect(manifest.forma.preview.status).toBe("ready");
    expect(Array.isArray(manifest.forma.assets)).toBe(true);
    expect(manifest.forma.assets.length).toBeGreaterThan(0);

    // Design pointer was created
    const pointer = await store.products.getDesignPointer(productId, "req-001", "page-001", "default");
    expect(pointer).toBeTruthy();
    expect(pointer!.artifactId).toBe(result.artifactId);
    expect(pointer!.version).toBe(1);
    expect(pointer!.designStatus).toBe("active");
  }, 90000);

  it("rolls back a newly-created design pointer when afterPointerLocked fails", async () => {
    const input = await makeCleanInput({
      commitHooks: {
        afterPointerLocked: () => {
          throw new FormaError("ARTIFACT_WRITE_FAIL", "injected post-pointer failure");
        },
      },
    });
    const deps = makeDeps();

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "ARTIFACT_WRITE_FAIL",
    );

    await expect(
      store.products.getDesignPointer(productId, "req-001", "page-001", "default"),
    ).resolves.toBeUndefined();
    await expect(store.artifacts.listArtifacts(productId)).resolves.toEqual([]);
  }, 90000);

  it("restores the previous design pointer when a later version's afterPointerLocked fails", async () => {
    const deps = makeDeps();
    const first = await saveDesignArtifact(deps, await makeCleanInput());
    const secondInput = await makeCleanInput({
      artifactId: first.artifactId,
      title: "Second Design Page",
      commitHooks: {
        afterPointerLocked: () => {
          throw new FormaError("ARTIFACT_WRITE_FAIL", "injected post-pointer failure");
        },
      },
    });

    await expect(saveDesignArtifact(deps, secondInput)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "ARTIFACT_WRITE_FAIL",
    );

    await expect(store.artifacts.listArtifactVersions(productId, first.artifactId)).resolves.toEqual([1]);
    await expect(
      store.products.getDesignPointer(productId, "req-001", "page-001", "default"),
    ).resolves.toMatchObject({ artifactId: first.artifactId, version: 1 });
  }, 90000);

  it("HTML with <script> → throws ARTIFACT_NOT_STATIC", async () => {
    const deps = makeDeps();
    const input: SaveDesignInput = {
      productId,
      kind: "design-page" as const,
      html: "<!doctype html><html><body><script>alert(1)</script></body></html>",
      title: "Bad Design",
      forma: { requirementId: "req-002", pageId: "page-002", variant: "default" },
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof FormaError)) return false;
      return err.code === "ARTIFACT_NOT_STATIC";
    });
  }, 30000);

  it("HTML with remote <img src=https://...> → throws ARTIFACT_REMOTE_RESOURCE", async () => {
    const deps = makeDeps();
    const input: SaveDesignInput = {
      productId,
      kind: "design-page" as const,
      html: '<!doctype html><html><body><img src="https://example.com/img.png"></body></html>',
      title: "Remote Design",
      forma: { requirementId: "req-003", pageId: "page-003", variant: "default" },
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof FormaError)) return false;
      return err.code === "ARTIFACT_REMOTE_RESOURCE";
    });
  }, 30000);

  it("data:SVG containing <script> inlined in HTML → localize makes it a .svg file → saveDesignArtifact throws ARTIFACT_NOT_STATIC", async () => {
    const deps = makeDeps();
    const svgDataUrl = makeScriptSvgDataUrl();
    const html = `<!doctype html><html><body><img src="${svgDataUrl}"></body></html>`;
    const input: SaveDesignInput = {
      productId,
      kind: "design-page" as const,
      html,
      title: "SVG Script Design",
      forma: { requirementId: "req-004", pageId: "page-004", variant: "default" },
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof FormaError)) return false;
      return err.code === "ARTIFACT_NOT_STATIC";
    });
  }, 30000);

  it("same artifactId saved twice → second result is version 2; pointer now points to v2", async () => {
    const deps = makeDeps();
    const input1 = await makeCleanInput({
      forma: { requirementId: "req-005", pageId: "page-005", variant: "default" },
    });

    const result1 = await saveDesignArtifact(deps, input1);
    expect(result1.version).toBe(1);

    const input2 = await makeCleanInput({
      artifactId: result1.artifactId,
      forma: { requirementId: "req-005", pageId: "page-005", variant: "default" },
    });

    const result2 = await saveDesignArtifact(deps, input2);
    expect(result2.artifactId).toBe(result1.artifactId);
    expect(result2.version).toBe(2);

    // Pointer now points to v2
    const pointer = await store.products.getDesignPointer(productId, "req-005", "page-005", "default");
    expect(pointer!.version).toBe(2);
    expect(pointer!.artifactId).toBe(result1.artifactId);
  }, 120000);

  it("component-library kind → no design pointer created; form has no requirementId/pageId/variant in pointer", async () => {
    const dataPng = await makeDataPng();
    const html = `<!doctype html><html><body><img src="${dataPng}" alt="comp"></body></html>`;
    const deps = makeDeps();
    const input: SaveDesignInput = {
      productId,
      kind: "component-library" as const,
      html,
      title: "My Components",
      forma: { brandStyle: "light" },
    };

    const result = await saveDesignArtifact(deps, input);
    expect(result.artifactId).toBeTruthy();
    expect(result.version).toBe(1);

    // No pointer should be created (no requirementId/pageId)
    const product = await store.products.getProduct(productId);
    expect((product.designPointers ?? []).length).toBe(0);
  }, 90000);

  it('design-page without variant → variant defaults to "default" in manifest', async () => {
    const input = await makeCleanInput({
      forma: { requirementId: "req-006", pageId: "page-006" }, // no variant
    });
    const deps = makeDeps();

    const result = await saveDesignArtifact(deps, input);
    const { productsRoot } = deps;
    const manifestJson = await readFile(
      join(productsRoot, productId, "od-project", "artifacts", result.artifactId, "v1", "manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(manifestJson);
    expect(manifest.forma.variant).toBe("default");

    // Pointer should be created with variant='default'
    const pointer = await store.products.getDesignPointer(productId, "req-006", "page-006", "default");
    expect(pointer).toBeTruthy();
  }, 90000);

  it("persists deterministic craft checks into manifest.forma.quality.craftChecks", async () => {
    const input = await makeCleanInput({
      html: `<!doctype html><html><body style="margin:0;background:#ffffff">
        <h1 style="color:#111111;font-size:32px;font-family:Inter">Quality Title</h1>
        <p style="color:#222222;font-size:16px;font-family:Inter">Readable body text</p>
      </body></html>`,
      forma: { requirementId: "req-q1", pageId: "page-q1", variant: "default" },
    });
    const deps = makeDeps();
    const result = await saveDesignArtifact(deps, input);
    expect(result.previewStatus).toBe("ready");

    const { productsRoot } = deps;
    const manifestJson = await readFile(
      join(productsRoot, productId, "od-project", "artifacts", result.artifactId, "v1", "manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(manifestJson);
    const checks = manifest.forma.quality?.craftChecks;
    expect(Array.isArray(checks)).toBe(true);
    const ids = checks.map((c: { id: string }) => c.id).sort();
    expect(ids).toEqual(["color-palette", "contrast-aa", "font-families", "screen-edge-radius", "type-scale"]);
    const contrast = checks.find((c: { id: string }) => c.id === "contrast-aa");
    expect(contrast?.detail).toMatch(/\d+ text node/);
    for (const c of checks) {
      expect(typeof c.id).toBe("string");
      expect(typeof c.passed).toBe("boolean");
    }
  }, 90000);

  // TEST-CORE-002: forma.platform omitted → resolved from product config; manifest forma.platform filled
  it("forma.platform omitted → falls back to product config; manifest.forma.platform filled; screen-edge-radius skipped for non-mobile", async () => {
    await store.products.initProductConfig(productId, {
      platform: "web",
      brand_style: "minimal",
      languages: ["zh-CN"],
      default_language: "zh-CN",
    });
    const input = await makeCleanInput({
      forma: { requirementId: "req-p1", pageId: "page-p1", variant: "default" }, // no platform
    });
    const deps = makeDeps();

    const result = await saveDesignArtifact(deps, input);
    expect(result.previewStatus).toBe("ready");

    const manifest = await readManifest(deps.productsRoot, result.artifactId);
    expect(manifest.forma.platform).toBe("web");
    const check = manifest.forma.quality.craftChecks.find((c: { id: string }) => c.id === "screen-edge-radius");
    expect(check).toBeTruthy();
    expect(check.passed).toBe(true);
    expect(check.detail).toContain("skipped (platform=web)");
  }, 90000);

  // TEST-CORE-002: unconfigured product → platform=undefined, observable in screen-edge-radius detail
  it("unconfigured product → screen-edge-radius detail shows skipped (platform=undefined); manifest.forma.platform absent", async () => {
    const input = await makeCleanInput({
      forma: { requirementId: "req-p2", pageId: "page-p2", variant: "default" },
    });
    const deps = makeDeps();

    const result = await saveDesignArtifact(deps, input);
    expect(result.previewStatus).toBe("ready");

    const manifest = await readManifest(deps.productsRoot, result.artifactId);
    expect(manifest.forma.platform).toBeUndefined();
    const check = manifest.forma.quality.craftChecks.find((c: { id: string }) => c.id === "screen-edge-radius");
    expect(check).toBeTruthy();
    expect(check.passed).toBe(true);
    expect(check.detail).toContain("skipped (platform=undefined)");
  }, 90000);

  // TEST-CORE-002b: getProduct throws during platform resolution → save still succeeds; platform treated as undefined
  it("getProduct throws during platform resolution → save succeeds; screen-edge-radius detail shows skipped (platform=undefined)", async () => {
    const baseDeps = makeDeps();
    // Wrap the real products service so only getProduct throws; all other methods
    // delegate to the original (prototype-based) instance.
    const realProducts = baseDeps.products;
    const throwingProducts = new Proxy(realProducts, {
      get(target, prop) {
        if (prop === "getProduct") {
          return async () => {
            throw new Error("boom");
          };
        }
        const val: unknown = Reflect.get(target, prop);
        return typeof val === "function" ? val.bind(target) : val;
      },
    });
    const deps: typeof baseDeps = { ...baseDeps, products: throwingProducts };
    const input = await makeCleanInput({
      forma: { requirementId: "req-pt", pageId: "page-pt", variant: "default" }, // no platform
    });

    // Save must not throw despite getProduct failing
    const result = await saveDesignArtifact(deps, input);
    expect(result.previewStatus).toBe("ready");

    // platform must be absent from manifest (treated as undefined)
    const manifest = await readManifest(baseDeps.productsRoot, result.artifactId);
    expect(manifest.forma.platform).toBeUndefined();

    // screen-edge-radius must report skipped (platform=undefined) — proving the catch branch ran
    const check = manifest.forma.quality.craftChecks.find((c: { id: string }) => c.id === "screen-edge-radius");
    expect(check).toBeTruthy();
    expect(check.passed).toBe(true);
    expect(check.detail).toContain("skipped (platform=undefined)");
  }, 90000);

  // SPEC-DATA-001: productIcon SVG supporting files persist into bundle + manifest
  it("component-library with productIcon → bundle has SVG files + manifest has forma.productIcon + assets with role icon", async () => {
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>`;
    const monoText = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8" fill="currentColor"/></svg>`;
    const svgBase64 = Buffer.from(svgText).toString("base64");
    const monoBase64 = Buffer.from(monoText).toString("base64");

    const dataPng = await makeDataPng();
    const html = `<!doctype html><html><body><img src="${dataPng}" alt="comp"></body></html>`;
    const deps = makeDeps();

    const input: SaveDesignInput = {
      productId,
      kind: "component-library" as const,
      html,
      title: "Icon Library",
      forma: {
        brandStyle: "ant",
        productIcon: {
          primary: "assets/icon.svg",
          monochrome: "assets/icon-mono.svg",
          shape: { shapeId: "s1", geometry: "<path d='M0 0h8v8H0z'/>", sourceVersion: "1" },
        },
      },
      supportingFiles: [
        { path: "assets/icon.svg", contentType: "image/svg+xml", contentBase64: svgBase64 },
        { path: "assets/icon-mono.svg", contentType: "image/svg+xml", contentBase64: monoBase64 },
      ],
    };

    const result = await saveDesignArtifact(deps, input);
    expect(result.artifactId).toBeTruthy();
    expect(result.version).toBe(1);

    // Bundle files: SVG files must be present with matching content
    const { productsRoot } = deps;
    const versionDir = join(productsRoot, productId, "od-project", "artifacts", result.artifactId, "v1");
    const primaryContent = await readFile(join(versionDir, "assets", "icon.svg"), "utf8");
    expect(primaryContent).toBe(svgText);
    const monoContent = await readFile(join(versionDir, "assets", "icon-mono.svg"), "utf8");
    expect(monoContent).toBe(monoText);

    // Manifest: productIcon fields set, assets registered with role "icon"
    const manifestJson = await readFile(join(versionDir, "manifest.json"), "utf8");
    const manifest = JSON.parse(manifestJson);
    expect(manifest.forma.productIcon?.primary).toBe("assets/icon.svg");
    expect(manifest.forma.productIcon?.monochrome).toBe("assets/icon-mono.svg");
    expect(manifest.forma.productIcon?.shape?.shapeId).toBe("s1");
    expect(manifest.forma.productIcon?.shape?.geometry).toBe("<path d='M0 0h8v8H0z'/>");
    expect(manifest.forma.productIcon?.shape?.sourceVersion).toBe("1");

    // assets array must contain both icon entries with role "icon"
    const assets = manifest.forma.assets as Array<{ path: string; role: string; density: number[] }>;
    expect(Array.isArray(assets)).toBe(true);
    const iconAsset = assets.find((a) => a.path === "assets/icon.svg");
    expect(iconAsset).toBeTruthy();
    expect(iconAsset!.role).toBe("icon");
    expect(iconAsset!.density).toEqual([1]);
    const monoAsset = assets.find((a) => a.path === "assets/icon-mono.svg");
    expect(monoAsset).toBeTruthy();
    expect(monoAsset!.role).toBe("icon");
  }, 90000);

  it("component-library HTML can reference caller-supplied supporting files during preview rendering", async () => {
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" fill="#2563eb"/></svg>`;
    const html = `<!doctype html><html><body style="margin:0"><img src="assets/icon.svg" alt="icon" width="16" height="16"></body></html>`;
    const deps = makeDeps();

    const result = await saveDesignArtifact(deps, {
      productId,
      kind: "component-library" as const,
      html,
      title: "Library With Referenced Asset",
      forma: { brandStyle: "ant" },
      supportingFiles: [
        { path: "assets/icon.svg", contentType: "image/svg+xml", contentBase64: Buffer.from(svgText).toString("base64") },
      ],
    });

    expect(result.previewStatus).toBe("ready");
    const manifest = await readManifest(deps.productsRoot, result.artifactId);
    expect(manifest.forma.preview.status).toBe("ready");
  }, 90000);

  it("productIcon with absolute path in supportingFiles.path → throws INVALID_INPUT", async () => {
    const svgBase64 = Buffer.from("<svg/>").toString("base64");
    const dataPng = await makeDataPng();
    const html = `<!doctype html><html><body><img src="${dataPng}" alt="comp"></body></html>`;
    const deps = makeDeps();

    const input: SaveDesignInput = {
      productId,
      kind: "component-library" as const,
      html,
      title: "Bad Path",
      forma: {
        productIcon: {
          primary: "/abs/icon.svg",
          monochrome: "assets/icon-mono.svg",
          shape: { shapeId: "s1", geometry: "<path/>", sourceVersion: "1" },
        },
      },
      supportingFiles: [{ path: "/abs/icon.svg", contentType: "image/svg+xml", contentBase64: svgBase64 }],
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "INVALID_INPUT",
    );
  }, 30000);

  it("productIcon references path not in supportingFiles → throws INVALID_INPUT", async () => {
    const dataPng = await makeDataPng();
    const html = `<!doctype html><html><body><img src="${dataPng}" alt="comp"></body></html>`;
    const deps = makeDeps();

    const input: SaveDesignInput = {
      productId,
      kind: "component-library" as const,
      html,
      title: "Missing File",
      forma: {
        productIcon: {
          primary: "assets/icon.svg",
          monochrome: "assets/icon-mono.svg",
          shape: { shapeId: "s1", geometry: "<path/>", sourceVersion: "1" },
        },
      },
      // supportingFiles entirely absent
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "INVALID_INPUT",
    );
  }, 30000);

  it("supportingFile with non-SVG content_type → throws INVALID_INPUT", async () => {
    const dataPng = await makeDataPng();
    const html = `<!doctype html><html><body><img src="${dataPng}" alt="comp"></body></html>`;
    const deps = makeDeps();

    const input: SaveDesignInput = {
      productId,
      kind: "component-library" as const,
      html,
      title: "Non-SVG",
      forma: {
        productIcon: {
          primary: "assets/icon.png",
          monochrome: "assets/icon-mono.svg",
          shape: { shapeId: "s1", geometry: "<path/>", sourceVersion: "1" },
        },
      },
      supportingFiles: [
        { path: "assets/icon.png", contentType: "image/png", contentBase64: Buffer.from("x").toString("base64") },
        {
          path: "assets/icon-mono.svg",
          contentType: "image/svg+xml",
          contentBase64: Buffer.from("<svg/>").toString("base64"),
        },
      ],
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "INVALID_INPUT",
    );
  }, 30000);

  it("supportingFile with SVG content_type but non-.svg path → throws INVALID_INPUT", async () => {
    const dataPng = await makeDataPng();
    const html = `<!doctype html><html><body><img src="${dataPng}" alt="comp"></body></html>`;
    const deps = makeDeps();
    const svgBase64 = Buffer.from("<svg/>").toString("base64");

    const input: SaveDesignInput = {
      productId,
      kind: "component-library" as const,
      html,
      title: "Wrong Extension",
      forma: {
        productIcon: {
          primary: "assets/icon.png",
          monochrome: "assets/icon-mono.svg",
          shape: { shapeId: "s1", geometry: "<path/>", sourceVersion: "1" },
        },
      },
      supportingFiles: [
        { path: "assets/icon.png", contentType: "image/svg+xml", contentBase64: svgBase64 },
        { path: "assets/icon-mono.svg", contentType: "image/svg+xml", contentBase64: svgBase64 },
      ],
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "INVALID_INPUT",
    );
  }, 30000);

  it("supportingFile with SVG content_type but non-SVG text → throws INVALID_INPUT", async () => {
    const html = `<!doctype html><html><body><p>comp</p></body></html>`;
    const deps = makeDeps();

    const input: SaveDesignInput = {
      productId,
      kind: "component-library" as const,
      html,
      title: "Not SVG",
      forma: {
        productIcon: {
          primary: "assets/icon.svg",
          monochrome: "assets/icon-mono.svg",
          shape: { shapeId: "s1", geometry: "<path/>", sourceVersion: "1" },
        },
      },
      supportingFiles: [
        { path: "assets/icon.svg", contentType: "image/svg+xml", contentBase64: Buffer.from("not svg").toString("base64") },
        {
          path: "assets/icon-mono.svg",
          contentType: "image/svg+xml",
          contentBase64: Buffer.from("<svg/>").toString("base64"),
        },
      ],
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "INVALID_INPUT",
    );
  }, 30000);

  it("supportingFile exceeding the 256KB size cap → throws INVALID_INPUT", async () => {
    const html = `<!doctype html><html><body><p>comp</p></body></html>`;
    const deps = makeDeps();
    // 256KB cap is on decoded bytes; build an SVG payload just over the limit.
    const oversized = `<svg>${"a".repeat(256 * 1024 + 1)}</svg>`;

    const input: SaveDesignInput = {
      productId,
      kind: "component-library" as const,
      html,
      title: "Oversized icon",
      forma: {
        productIcon: {
          primary: "assets/icon.svg",
          monochrome: "assets/icon-mono.svg",
          shape: { shapeId: "s1", geometry: "<path/>", sourceVersion: "1" },
        },
      },
      supportingFiles: [
        { path: "assets/icon.svg", contentType: "image/svg+xml", contentBase64: Buffer.from(oversized).toString("base64") },
        {
          path: "assets/icon-mono.svg",
          contentType: "image/svg+xml",
          contentBase64: Buffer.from("<svg/>").toString("base64"),
        },
      ],
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "INVALID_INPUT",
    );
  }, 30000);

  it("supportingFile with empty/garbage content_base64 → throws INVALID_INPUT (no silent empty asset)", async () => {
    const html = `<!doctype html><html><body><p>comp</p></body></html>`;
    const deps = makeDeps();

    const input: SaveDesignInput = {
      productId,
      kind: "component-library" as const,
      html,
      title: "Empty icon content",
      forma: {
        productIcon: {
          primary: "assets/icon.svg",
          monochrome: "assets/icon-mono.svg",
          shape: { shapeId: "s1", geometry: "<path/>", sourceVersion: "1" },
        },
      },
      supportingFiles: [
        // "!!!" decodes to zero bytes via Buffer.from(...,"base64"); must be rejected, not written empty.
        { path: "assets/icon.svg", contentType: "image/svg+xml", contentBase64: "!!!" },
        {
          path: "assets/icon-mono.svg",
          contentType: "image/svg+xml",
          contentBase64: Buffer.from("<svg/>").toString("base64"),
        },
      ],
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "INVALID_INPUT",
    );
  }, 30000);

  it("supportingFile using reserved bundle entry path → throws INVALID_INPUT", async () => {
    const html = `<!doctype html><html><body><p>comp</p></body></html>`;
    const deps = makeDeps();

    const input: SaveDesignInput = {
      productId,
      kind: "component-library" as const,
      html,
      title: "Reserved supporting path",
      forma: { brandStyle: "ant" },
      supportingFiles: [
        {
          path: "index.html",
          contentType: "image/svg+xml",
          contentBase64: Buffer.from("<svg/>").toString("base64"),
        },
      ],
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "INVALID_INPUT",
    );
  }, 30000);

  it("supportingFile using normalized reserved bundle entry path → throws INVALID_INPUT", async () => {
    const html = `<!doctype html><html><body><p>comp</p></body></html>`;
    const deps = makeDeps();

    const input: SaveDesignInput = {
      productId,
      kind: "component-library" as const,
      html,
      title: "Normalized reserved supporting path",
      forma: { brandStyle: "ant" },
      supportingFiles: [
        {
          path: "./index.html",
          contentType: "image/svg+xml",
          contentBase64: Buffer.from("<svg/>").toString("base64"),
        },
      ],
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "INVALID_INPUT",
    );
  }, 30000);

  it("supportingFile equivalent slash and backslash paths → throws INVALID_INPUT", async () => {
    const html = `<!doctype html><html><body><p>comp</p></body></html>`;
    const deps = makeDeps();
    const svgBase64 = Buffer.from("<svg/>").toString("base64");

    const input: SaveDesignInput = {
      productId,
      kind: "component-library" as const,
      html,
      title: "Duplicate normalized supporting paths",
      forma: { brandStyle: "ant" },
      supportingFiles: [
        { path: "assets/icon.svg", contentType: "image/svg+xml", contentBase64: svgBase64 },
        { path: "assets\\icon.svg", contentType: "image/svg+xml", contentBase64: svgBase64 },
      ],
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "INVALID_INPUT",
    );
  }, 30000);

  it("supportingFile SVG with script → throws ARTIFACT_NOT_STATIC", async () => {
    const html = `<!doctype html><html><body><img src="assets/icon.svg" alt="icon"></body></html>`;
    const deps = makeDeps();
    const svgWithScript = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="8" height="8"/></svg>`;

    const input: SaveDesignInput = {
      productId,
      kind: "component-library" as const,
      html,
      title: "Unsafe supporting SVG",
      forma: { brandStyle: "ant" },
      supportingFiles: [
        { path: "assets/icon.svg", contentType: "image/svg+xml", contentBase64: Buffer.from(svgWithScript).toString("base64") },
      ],
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "ARTIFACT_NOT_STATIC",
    );
  }, 30000);

  // TEST-CORE-003: mobile product → 390×884 render viewport (NOT the 390×844 web canvas tile) + active screen-edge-radius
  it("mobile product → renders at 390×884 viewport and screen-edge-radius check is active (not skipped)", async () => {
    await store.products.initProductConfig(productId, {
      platform: "mobile",
      brand_style: "minimal",
      languages: ["zh-CN"],
      default_language: "zh-CN",
    });
    const input = await makeCleanInput({
      forma: { requirementId: "req-p3", pageId: "page-p3", variant: "default" },
    });
    const deps = makeDeps();

    const result = await saveDesignArtifact(deps, input);
    expect(result.previewStatus).toBe("ready");

    const manifest = await readManifest(deps.productsRoot, result.artifactId);
    expect(manifest.forma.platform).toBe("mobile");
    const check = manifest.forma.quality.craftChecks.find((c: { id: string }) => c.id === "screen-edge-radius");
    expect(check).toBeTruthy();
    expect(check.detail).not.toMatch(/^skipped/);
    // makeCleanInput HTML has square root corners → the active check passes
    expect(check.passed).toBe(true);

    const png = await readFile(
      join(deps.productsRoot, productId, "od-project", "artifacts", result.artifactId, "v1", "preview", "1x.png"),
    );
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(390);
    expect(meta.height).toBe(884);
  }, 90000);

  // ─── D2: units decomposition ──────────────────────────────────────────────

  it("composes a combined index.html + per-unit files and records forma.units", async () => {
    const deps = makeDeps();
    const result = await saveDesignArtifact(deps, {
      productId,
      kind: "component-library",
      title: "Lib",
      tokensCss: ":root{--fg:#111}\n.btn{color:var(--fg)}",
      units: [
        { id: "foundations", title: "Foundations", role: "foundations", bodyHtml: "<section data-od-id=\"foundations\"><h2>Color</h2></section>" },
        { id: "button", title: "Button", role: "component", bodyHtml: "<section data-od-id=\"components\"><button class=\"btn\">A</button></section>" },
      ],
      forma: { brandStyle: "apple", platform: "mobile" },
    });
    const dir = artifactVersionDir(deps, productId, result.artifactId, result.version);
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    expect(manifest.entry).toBe("index.html");
    expect(manifest.forma.units.map((u: { entry: string }) => u.entry)).toEqual(["unit-foundations.html", "unit-button.html"]);
    const tokens = await readFile(join(dir, "tokens.css"), "utf8");
    expect(tokens).toContain("--fg:#111");
    const indexHtml = await readFile(join(dir, "index.html"), "utf8");
    expect(indexHtml).toContain("Color");
    expect(indexHtml).toContain("class=\"btn\"");
    expect(indexHtml).toContain("href=\"tokens.css\"");
    const unitBtn = await readFile(join(dir, "unit-button.html"), "utf8");
    expect(unitBtn).toContain("class=\"btn\"");
    expect(unitBtn).not.toContain("Color");
  }, 90000);

  it("rejects unsafe urls in tokensCss before writing unit files", async () => {
    const deps = makeDeps();
    await expect(
      saveDesignArtifact(deps, {
        productId,
        kind: "component-library",
        title: "Lib",
        tokensCss: ".card{background:url(https://example.com/card.png)}",
        units: [{ id: "button", title: "Button", role: "component", bodyHtml: "<section>Button</section>" }],
        forma: { brandStyle: "apple", platform: "mobile" },
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_NOT_STATIC" });
  }, 30000);

  it("localizes data assets inside each generated unit document", async () => {
    const deps = makeDeps();
    const dataPng = await makeDataPng();
    const result = await saveDesignArtifact(deps, {
      productId,
      kind: "component-library",
      title: "Lib",
      tokensCss: ":root{--fg:#111}",
      units: [{ id: "button", title: "Button", role: "component", bodyHtml: `<section><img src="${dataPng}" alt="Button"></section>` }],
      forma: { brandStyle: "apple", platform: "mobile" },
    });
    const dir = artifactVersionDir(deps, productId, result.artifactId, result.version);
    const tokens = await readFile(join(dir, "tokens.css"), "utf8");
    const unitBtn = await readFile(join(dir, "unit-button.html"), "utf8");
    expect(unitBtn).not.toContain("data:image/png;base64,");
    expect(unitBtn).toMatch(/src="assets\/[^"]+\.png"/);
    expect(validateStaticArtifact({ html: unitBtn, cssFiles: new Map([["tokens.css", tokens]]) })).toEqual({ ok: true });
  }, 90000);

  it("rejects remote refs in generated unit bodies", async () => {
    const deps = makeDeps();
    await expect(
      saveDesignArtifact(deps, {
        productId,
        kind: "component-library",
        title: "Lib",
        tokensCss: ":root{--fg:#111}",
        units: [{ id: "button", title: "Button", role: "component", bodyHtml: "<img src=\"https://example.com/bad.png\">" }],
        forma: { brandStyle: "apple", platform: "mobile" },
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_REMOTE_RESOURCE" });
  }, 30000);
});
