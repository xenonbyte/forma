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

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderBrandAssetHtml, type BrandAssetRenderDeps } from "../src/brand-asset-render.js";
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
