/**
 * brand-asset-render.test.ts — PLAN-TASK-016 (M3)
 *
 * The security-critical render sandbox for store-shot/poster HTML
 * (SPEC-BEHAVIOR-007, RISK-SEC-002). Two layers:
 *
 *  ① Pre-render localize: forma-image:// refs (staging uuid OR brand/) and any
 *     data:/local refs are rewritten into a temp bundle dir by the same resolver
 *     design-save uses, BEFORE the browser ever loads. The browser layer never
 *     sees a forma-image:// request.
 *  ② puppeteer interception: scripts disabled; subresources allowed ONLY when
 *     they are file:// children of the rewritten bundle dir. http(s):,
 *     protocol-relative //, file:// outside the bundle, any out-of-boundary path
 *     → ABORT and THROW (fail loud — never a partial/downgraded PNG).
 *
 * These tests launch a real Chromium (matching preview-renderer.test.ts) and
 * never touch the network: the remote-rejection case asserts the THROW happens
 * via request interception before any real fetch.
 */

import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  classifyBrandAssetRequest,
  renderBrandAssetHtml,
  type BrandAssetRenderDeps,
} from "../src/brand-asset-render.js";
import { putStagedImage } from "../src/media/image-staging.js";
import { resolveFormaImageRef } from "../src/media/image-staging.js";
import { FormaError } from "../src/errors.js";

const PRODUCT_ID = "P-7e5701";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "forma-brand-render-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function makeDeps(): BrandAssetRenderDeps {
  return {
    resolveFormaImage: (ref) => resolveFormaImageRef(home, PRODUCT_ID, ref),
  };
}

async function makeSquarePng(size: number, color = "#3366cc"): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 4, background: color } })
    .png()
    .toBuffer();
}

// ─── 1. script interception ────────────────────────────────────────────────────

describe("renderBrandAssetHtml — scripts are disabled", () => {
  it("does not execute author <script> (DOM mutation never happens)", async () => {
    // The script would (if executed) paint the whole page red. With JS disabled
    // the page stays the inline-styled green and the centre pixel is green.
    const html = [
      "<!doctype html><html><head><style>html,body{margin:0;padding:0}",
      "body{background:#00ff00}</style></head><body>",
      "<script>document.body.style.background='#ff0000';</script>",
      "</body></html>",
    ].join("");
    const png = await renderBrandAssetHtml(makeDeps(), {
      html,
      width: 64,
      height: 64,
      productId: PRODUCT_ID,
    });
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    // Sample the centre pixel.
    const cx = Math.floor(info.width / 2);
    const cy = Math.floor(info.height / 2);
    const idx = (cy * info.width + cx) * info.channels;
    const [r, g, b] = [data[idx], data[idx + 1], data[idx + 2]];
    expect(g).toBeGreaterThan(200); // green channel dominant → script did NOT run
    expect(r).toBeLessThan(100);
    expect(b).toBeLessThan(100);
  }, 60000);
});

// ─── 2. remote request rejection (fail loud, no network) ─────────────────────────

describe("renderBrandAssetHtml — remote requests are rejected", () => {
  it("THROWS when the HTML references a remote image (https)", async () => {
    const html = '<!doctype html><html><body><img src="https://evil.example.com/x.png"></body></html>';
    await expect(
      renderBrandAssetHtml(makeDeps(), { html, width: 64, height: 64, productId: PRODUCT_ID }),
    ).rejects.toSatisfy((err: unknown) => err instanceof FormaError);
  }, 60000);

  it("THROWS on a protocol-relative reference", async () => {
    const html = '<!doctype html><html><body><img src="//evil.example.com/x.png"></body></html>';
    await expect(
      renderBrandAssetHtml(makeDeps(), { html, width: 64, height: 64, productId: PRODUCT_ID }),
    ).rejects.toSatisfy((err: unknown) => err instanceof FormaError);
  }, 60000);

  it("THROWS on a remote stylesheet (link)", async () => {
    const html =
      '<!doctype html><html><head><link rel="stylesheet" href="http://evil.example.com/a.css"></head><body></body></html>';
    await expect(
      renderBrandAssetHtml(makeDeps(), { html, width: 64, height: 64, productId: PRODUCT_ID }),
    ).rejects.toSatisfy((err: unknown) => err instanceof FormaError);
  }, 60000);
});

// ─── 3. file out-of-bounds rejection ────────────────────────────────────────────

describe("renderBrandAssetHtml — out-of-bounds file refs are rejected", () => {
  it("THROWS when the HTML references an absolute file outside the bundle (file:///etc/passwd)", async () => {
    const html = '<!doctype html><html><body><img src="file:///etc/passwd"></body></html>';
    await expect(
      renderBrandAssetHtml(makeDeps(), { html, width: 64, height: 64, productId: PRODUCT_ID }),
    ).rejects.toSatisfy((err: unknown) => err instanceof FormaError);
  }, 60000);

  it("THROWS when the HTML references a relative path that escapes the bundle (../../)", async () => {
    // A bare relative ../../outside.png is left untouched by the localizer; once
    // resolved against the bundle file:// base it points OUTSIDE the bundle dir,
    // so interception aborts + the render fails loud.
    const html = '<!doctype html><html><body><img src="../../../../../../etc/passwd"></body></html>';
    await expect(
      renderBrandAssetHtml(makeDeps(), { html, width: 64, height: 64, productId: PRODUCT_ID }),
    ).rejects.toSatisfy((err: unknown) => err instanceof FormaError);
  }, 60000);
});

// ─── 4. whitelist-inside allowed (localized forma-image renders) ─────────────────

describe("renderBrandAssetHtml — localized forma-image refs render successfully", () => {
  it("renders a forma-image:// (staged) ref to a PNG of the requested dimensions", async () => {
    const staged = await putStagedImage(home, PRODUCT_ID, await makeSquarePng(256, "#ff8800"), {
      purpose: "store-shot",
      prompt: "shot",
      model: "stub",
      width: 256,
      height: 256,
    });
    const html = [
      "<!doctype html><html><head><style>html,body{margin:0;padding:0}</style></head>",
      `<body><img src="${staged.ref}" style="width:100%"></body></html>`,
    ].join("");
    const png = await renderBrandAssetHtml(makeDeps(), {
      html,
      width: 320,
      height: 200,
      productId: PRODUCT_ID,
    });
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(200);
  }, 60000);

  it("renders plain HTML (no external refs) to a PNG of the requested dimensions", async () => {
    const html =
      "<!doctype html><html><head><style>html,body{margin:0;padding:0}body{background:#123456}</style></head><body><h1>Hello</h1></body></html>";
    const png = await renderBrandAssetHtml(makeDeps(), {
      html,
      width: 800,
      height: 600,
      productId: PRODUCT_ID,
    });
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  }, 60000);
});

// ─── 5. classifier unit coverage (Layer ②, NO browser) ──────────────────────────
//
// The integration tests above all THROW in Layer ① (the localizer rejects remote
// refs before Chromium launches), so the classifier's remote/data/non_file
// branches get zero coverage there. These tests call classifyBrandAssetRequest
// directly against a real temp bundle dir to lock the defense-in-depth verdict
// independently of Layer ①. Category strings are asserted EXACTLY: a regression
// flipping any branch to "allow" (null) fails here.

describe("classifyBrandAssetRequest — defense-in-depth verdicts (no browser)", () => {
  let bundleRoot: string;
  let bundleRealDir: string;
  let insideFileUrl: string;

  beforeEach(async () => {
    bundleRoot = await mkdtemp(join(tmpdir(), "forma-classify-"));
    const bundleDir = join(bundleRoot, "bundle");
    await mkdir(join(bundleDir, "assets"), { recursive: true });
    // realpath the bundle root the same way the renderer does (macOS tmpdir is a
    // symlink: /var → /private/var), so the boundary check compares like-with-like.
    bundleRealDir = await realpath(bundleDir);
    const insideFile = join(bundleDir, "assets", "logo.png");
    await writeFile(insideFile, Buffer.from("\x89PNG\r\n\x1a\n"));
    insideFileUrl = pathToFileURL(insideFile).href;
  });

  afterEach(async () => {
    await rm(bundleRoot, { recursive: true, force: true });
  });

  it("ALLOWS (null) a file:// inside the bundle", async () => {
    expect(await classifyBrandAssetRequest(insideFileUrl, bundleRealDir)).toBeNull();
  });

  it("ALLOWS (null) the bundle dir itself", async () => {
    expect(await classifyBrandAssetRequest(pathToFileURL(bundleRealDir).href, bundleRealDir)).toBeNull();
  });

  it("ALLOWS (null) a not-yet-written file inside the bundle (missing leaf)", async () => {
    const missing = pathToFileURL(join(bundleRealDir, "assets", "not-written-yet.png")).href;
    expect(await classifyBrandAssetRequest(missing, bundleRealDir)).toBeNull();
  });

  it("rejects https:// → 'remote'", async () => {
    expect(await classifyBrandAssetRequest("https://evil.example.com/x.png", bundleRealDir)).toBe("remote");
  });

  it("rejects http:// → 'remote'", async () => {
    expect(await classifyBrandAssetRequest("http://evil.example.com/x.png", bundleRealDir)).toBe("remote");
  });

  it("rejects protocol-relative //host → 'remote'", async () => {
    expect(await classifyBrandAssetRequest("//evil.example.com/x.png", bundleRealDir)).toBe("remote");
  });

  it("rejects data: → 'data'", async () => {
    expect(await classifyBrandAssetRequest("data:image/png;base64,iVBORw0KGgo=", bundleRealDir)).toBe("data");
  });

  it("rejects a non-file non-http scheme (ftp:) → 'non_file'", async () => {
    expect(await classifyBrandAssetRequest("ftp://host/x.png", bundleRealDir)).toBe("non_file");
  });

  it("rejects a file:// OUTSIDE the bundle (/etc/passwd) → 'out_of_bundle'", async () => {
    expect(await classifyBrandAssetRequest("file:///etc/passwd", bundleRealDir)).toBe("out_of_bundle");
  });

  it("rejects a sibling-of-bundle file (prefix not a real child) → 'out_of_bundle'", async () => {
    // bundleRoot/bundle-evil shares the bundleRealDir string prefix but is not a
    // child; isSameOrChildPath must reject it.
    const sibling = pathToFileURL(join(bundleRoot, "bundle-evil", "x.png")).href;
    expect(await classifyBrandAssetRequest(sibling, bundleRealDir)).toBe("out_of_bundle");
  });

  it("rejects a file:// URL fileURLToPath can't parse → 'unparseable_file'", async () => {
    // Starts with file:// (so it passes the scheme guards) but has invalid
    // percent-encoding, so fileURLToPath throws → fail-closed 'unparseable_file'.
    expect(await classifyBrandAssetRequest("file://%ZZ", bundleRealDir)).toBe("unparseable_file");
  });
});
