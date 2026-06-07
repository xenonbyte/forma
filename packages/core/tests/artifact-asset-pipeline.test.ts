/**
 * artifact-asset-pipeline.test.ts
 * TDD tests for localizeArtifactAssets — written BEFORE the implementation.
 *
 * Acceptance cases:
 *   1. data: raster PNG → 3 density files in `files`, srcset rewrite, assets[0].density=[1,2,3]
 *   2. data: SVG → single .svg file, density [1]
 *   3. data: text/css via <link> → single .css file, role 'stylesheet'
 *   4. remote <img src="https://..."> → throws ARTIFACT_REMOTE_RESOURCE
 *   5. remote url(...) inside inline <style> → throws ARTIFACT_REMOTE_RESOURCE
 */

import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { localizeArtifactAssets } from "../src/artifact-asset-pipeline.js";
import { FormaError } from "../src/errors.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let pngBuffer: Buffer;
let pngBase64: string;

/** Minimal valid SVG */
const SVG_SRC = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
const SVG_BASE64 = Buffer.from(SVG_SRC, "utf8").toString("base64");

/** Minimal CSS */
const CSS_SRC = "body { margin: 0; }";
const CSS_BASE64 = Buffer.from(CSS_SRC, "utf8").toString("base64");

/** Helper: sha256 first 16 hex chars */
function shortHash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

beforeAll(async () => {
  // Generate a 9×9 solid PNG — wide enough for 3x/2x/1x downscaling (widths: 9, 6, 3)
  pngBuffer = await sharp({
    create: { width: 9, height: 9, channels: 3, background: "#888888" },
  })
    .png()
    .toBuffer();
  pngBase64 = pngBuffer.toString("base64");
});

// ─── Case 1: data: raster PNG → 3 density files ───────────────────────────────

describe("Case 1: data: PNG in <img src>", () => {
  it("writes 3 density files and rewrites to srcset", async () => {
    const html = `<img src="data:image/png;base64,${pngBase64}" alt="test">`;
    const result = await localizeArtifactAssets({ html });

    // exactly one asset entry
    expect(result.assets).toHaveLength(1);
    const asset = result.assets[0];

    // density should be [1, 2, 3]
    expect(asset.density).toEqual([1, 2, 3]);
    expect(asset.role).toBe("image");
    expect(asset.degraded).toBeFalsy();

    // path ends with @1x.png
    expect(asset.path).toMatch(/@1x\.png$/);
    expect(asset.path).toMatch(/^assets\//);

    // all 3 density files present in `files`
    const hash = shortHash(pngBuffer);
    const path1x = `assets/${hash}@1x.png`;
    const path2x = `assets/${hash}@2x.png`;
    const path3x = `assets/${hash}@3x.png`;
    expect(result.files.has(path1x)).toBe(true);
    expect(result.files.has(path2x)).toBe(true);
    expect(result.files.has(path3x)).toBe(true);

    // canonical path = @1x
    expect(asset.path).toBe(path1x);

    // every assets[].path is a key in files
    for (const a of result.assets) {
      expect(result.files.has(a.path)).toBe(true);
    }

    // rewritten HTML has srcset with 3 entries
    expect(result.html).toContain("srcset=");
    expect(result.html).toContain("1x");
    expect(result.html).toContain("2x");
    expect(result.html).toContain("3x");
    // original data: URL must not appear in output
    expect(result.html).not.toContain("data:image/png");

    // src fallback set to @1x
    expect(result.html).toContain(`src="${path1x}"`);
  });

  it("@3x file has the same bytes as the master PNG", async () => {
    const html = `<img src="data:image/png;base64,${pngBase64}">`;
    const result = await localizeArtifactAssets({ html });
    const hash = shortHash(pngBuffer);
    const buf3x = result.files.get(`assets/${hash}@3x.png`);
    expect(buf3x).toBeDefined();
    // master bytes == @3x bytes
    expect(buf3x!.equals(pngBuffer)).toBe(true);
  });

  it("@2x width is Math.round(masterWidth * 2/3)", async () => {
    const html = `<img src="data:image/png;base64,${pngBase64}">`;
    const result = await localizeArtifactAssets({ html });
    const hash = shortHash(pngBuffer);
    const buf2x = result.files.get(`assets/${hash}@2x.png`);
    expect(buf2x).toBeDefined();
    const meta2x = await sharp(buf2x!).metadata();
    expect(meta2x.width).toBe(Math.round((9 * 2) / 3)); // = 6
  });

  it("@1x width is Math.round(masterWidth * 1/3)", async () => {
    const html = `<img src="data:image/png;base64,${pngBase64}">`;
    const result = await localizeArtifactAssets({ html });
    const hash = shortHash(pngBuffer);
    const buf1x = result.files.get(`assets/${hash}@1x.png`);
    expect(buf1x).toBeDefined();
    const meta1x = await sharp(buf1x!).metadata();
    expect(meta1x.width).toBe(Math.round((9 * 1) / 3)); // = 3
  });
});

// ─── Case 2: data: SVG ────────────────────────────────────────────────────────

describe("Case 2: data: SVG in <img src>", () => {
  it("writes single .svg file with density [1]", async () => {
    const html = `<img src="data:image/svg+xml;base64,${SVG_BASE64}" alt="icon">`;
    const result = await localizeArtifactAssets({ html });

    expect(result.assets).toHaveLength(1);
    const asset = result.assets[0];
    expect(asset.density).toEqual([1]);
    expect(asset.role).toBe("image");
    expect(asset.path).toMatch(/^assets\/.+\.svg$/);

    // present in files
    expect(result.files.has(asset.path)).toBe(true);

    // file contents match original SVG
    const written = result.files.get(asset.path)!;
    expect(written.toString("utf8")).toBe(SVG_SRC);

    // HTML rewritten to local relative path, no data: URL
    expect(result.html).not.toContain("data:image/svg+xml");
    expect(result.html).toContain(asset.path);
  });
});

// ─── Case 3: data: text/css via <link> ───────────────────────────────────────

describe('Case 3: data:text/css via <link rel="stylesheet">', () => {
  it("writes single .css file, role=stylesheet, reference rewritten", async () => {
    const html = `<link rel="stylesheet" href="data:text/css;base64,${CSS_BASE64}">`;
    const result = await localizeArtifactAssets({ html });

    expect(result.assets).toHaveLength(1);
    const asset = result.assets[0];
    expect(asset.role).toBe("stylesheet");
    expect(asset.density).toEqual([1]);
    expect(asset.path).toMatch(/^assets\/.+\.css$/);

    // present in files
    expect(result.files.has(asset.path)).toBe(true);

    // file contents match original CSS
    const written = result.files.get(asset.path)!;
    expect(written.toString("utf8")).toBe(CSS_SRC);

    // HTML rewritten to local path, no data: URL
    expect(result.html).not.toContain("data:text/css");
    expect(result.html).toContain(asset.path);
  });
});

// ─── Case 4: remote <img src="https://..."> → reject ─────────────────────────

describe("Case 4: remote img src", () => {
  it("throws FormaError with code ARTIFACT_REMOTE_RESOURCE", async () => {
    const html = `<img src="https://example.com/image.png" alt="remote">`;
    await expect(localizeArtifactAssets({ html })).rejects.toSatisfy(
      (e: unknown) => e instanceof FormaError && e.code === "ARTIFACT_REMOTE_RESOURCE",
    );
  });

  it("error details contain the remote url", async () => {
    const remoteUrl = "https://example.com/image.png";
    const html = `<img src="${remoteUrl}">`;
    try {
      await localizeArtifactAssets({ html });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FormaError);
      expect((e as FormaError).details.url).toBe(remoteUrl);
    }
  });
});

// ─── Case 5: remote url() inside inline <style> → reject ─────────────────────

describe("Case 5: remote url() in inline <style>", () => {
  it("throws FormaError ARTIFACT_REMOTE_RESOURCE for url(https://...)", async () => {
    const html = `<style>body { background: url('https://cdn.example.com/bg.jpg'); }</style>`;
    await expect(localizeArtifactAssets({ html })).rejects.toSatisfy(
      (e: unknown) => e instanceof FormaError && e.code === "ARTIFACT_REMOTE_RESOURCE",
    );
  });

  it("throws for @import url(https://...)", async () => {
    const html = `<style>@import url('https://fonts.googleapis.com/css2?family=Roboto');</style>`;
    await expect(localizeArtifactAssets({ html })).rejects.toSatisfy(
      (e: unknown) => e instanceof FormaError && e.code === "ARTIFACT_REMOTE_RESOURCE",
    );
  });
});

// ─── Bug #5: tiny raster (1×1) — every referenced file must be in files ──────

describe("Bug #5: tiny raster srcset invariant (1×1 PNG)", () => {
  it("every url in src and srcset of a 1×1 PNG is a key in result.files", async () => {
    const tiny1x1 = await sharp({
      create: { width: 1, height: 1, channels: 3, background: "#888888" },
    })
      .png()
      .toBuffer();
    const tinyBase64 = tiny1x1.toString("base64");

    const html = `<img src="data:image/png;base64,${tinyBase64}" alt="tiny">`;
    const result = await localizeArtifactAssets({ html });

    // Parse out all referenced file paths from the rewritten HTML
    const imgMatch = result.html.match(/<img([^>]*)>/);
    const attrs = imgMatch ? imgMatch[1] : "";

    // Extract src
    const srcMatch = attrs.match(/src="([^"]+)"/);
    if (srcMatch) {
      const src = srcMatch[1];
      expect(result.files.has(src), `src="${src}" not in files`).toBe(true);
    }

    // Extract srcset candidates
    const srcsetMatch = attrs.match(/srcset="([^"]+)"/);
    if (srcsetMatch) {
      const srcset = srcsetMatch[1];
      const candidates = srcset
        .split(",")
        .map((part: string) => part.trim().split(/\s+/)[0])
        .filter(Boolean);
      for (const url of candidates) {
        expect(result.files.has(url), `srcset candidate "${url}" not in files`).toBe(true);
      }
    }
  });
});

// ─── Bug #6: protocol-relative URLs ──────────────────────────────────────────

describe("Bug #6: protocol-relative URL rejection", () => {
  it('<img src="//cdn.example.com/x.png"> → throws ARTIFACT_REMOTE_RESOURCE', async () => {
    const html = `<img src="//cdn.example.com/x.png" alt="remote">`;
    await expect(localizeArtifactAssets({ html })).rejects.toSatisfy(
      (e: unknown) => e instanceof FormaError && e.code === "ARTIFACT_REMOTE_RESOURCE",
    );
  });

  it("url(//cdn.example.com/x.png) in inline <style> → throws ARTIFACT_REMOTE_RESOURCE", async () => {
    const html = `<style>body { background: url(//cdn.example.com/x.png); }</style>`;
    await expect(localizeArtifactAssets({ html })).rejects.toSatisfy(
      (e: unknown) => e instanceof FormaError && e.code === "ARTIFACT_REMOTE_RESOURCE",
    );
  });

  it('bare @import "//cdn/x.css" (protocol-relative, no url()) → throws ARTIFACT_REMOTE_RESOURCE', async () => {
    const html = `<style>@import "//cdn.example.com/theme.css";</style>`;
    await expect(localizeArtifactAssets({ html })).rejects.toSatisfy(
      (e: unknown) => e instanceof FormaError && e.code === "ARTIFACT_REMOTE_RESOURCE",
    );
  });

  it('bare local @import "theme.css" is NOT rejected', async () => {
    const html = `<style>@import "theme.css";</style>`;
    await expect(localizeArtifactAssets({ html })).resolves.toBeDefined();
  });

  it("local absolute path /foo/bar.png is NOT rejected", async () => {
    const html = `<img src="/abs/path/image.png" alt="local">`;
    // Should not throw — just not a data: URL so no rewrite
    await expect(localizeArtifactAssets({ html })).resolves.toBeDefined();
  });

  it("relative path assets/x.png is NOT rejected", async () => {
    const html = `<img src="assets/x.png" alt="local">`;
    await expect(localizeArtifactAssets({ html })).resolves.toBeDefined();
  });
});

// ─── Review #6: collapsed density tiers are marked degraded ──────────────────

describe("Review #6: tiny raster marks degraded when density tiers collapse", () => {
  it("1×1 PNG → degraded=true (all tiers reuse the master pixel)", async () => {
    const tiny = await sharp({
      create: { width: 1, height: 1, channels: 3, background: "#777777" },
    })
      .png()
      .toBuffer();
    const html = `<img src="data:image/png;base64,${tiny.toString("base64")}" alt="tiny">`;
    const result = await localizeArtifactAssets({ html });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].degraded).toBe(true);
  });

  it("9×9 PNG → degraded is falsy (genuine @1x/@2x/@3x downsamples)", async () => {
    const html = `<img src="data:image/png;base64,${pngBase64}" alt="big">`;
    const result = await localizeArtifactAssets({ html });
    expect(result.assets[0].degraded).toBeFalsy();
  });
});

// ─── Review #2: data: URLs in srcset attribute are not corrupted by commas ────

describe("Review #2: data: URL inside srcset attribute", () => {
  it("localizes both data: candidates without splitting on the data-URL comma", async () => {
    const png1 = await sharp({ create: { width: 9, height: 9, channels: 3, background: "#abcdef" } })
      .png()
      .toBuffer();
    const png2 = await sharp({ create: { width: 9, height: 9, channels: 3, background: "#123456" } })
      .png()
      .toBuffer();
    const html =
      `<img src="assets/placeholder.png" ` +
      `srcset="data:image/png;base64,${png1.toString("base64")} 1x, ` +
      `data:image/png;base64,${png2.toString("base64")} 2x">`;

    const result = await localizeArtifactAssets({ html });

    const m = result.html.match(/srcset="([^"]+)"/);
    expect(m).toBeTruthy();
    const srcsetVal = m![1];
    // No residual data: URL survived localization
    expect(srcsetVal).not.toContain("data:");

    // Two distinct candidates, each pointing at a file that exists
    const candidates = srcsetVal
      .split(",")
      .map((p: string) => p.trim().split(/\s+/)[0])
      .filter(Boolean);
    expect(candidates).toHaveLength(2);
    for (const url of candidates) {
      expect(result.files.has(url), `srcset candidate "${url}" not in files`).toBe(true);
    }
  });

  it("single data: URL in srcset with no descriptor is localized", async () => {
    const html = `<img srcset="data:image/png;base64,${pngBase64}">`;
    const result = await localizeArtifactAssets({ html });
    const m = result.html.match(/srcset="([^"]+)"/);
    expect(m).toBeTruthy();
    expect(m![1]).not.toContain("data:");
    const url = m![1].trim().split(/\s+/)[0];
    expect(result.files.has(url)).toBe(true);
  });

  it("remote URL inside srcset still throws ARTIFACT_REMOTE_RESOURCE", async () => {
    const html = `<img srcset="//cdn.example.com/a.png 1x, assets/b.png 2x">`;
    await expect(localizeArtifactAssets({ html })).rejects.toSatisfy(
      (e: unknown) => e instanceof FormaError && e.code === "ARTIFACT_REMOTE_RESOURCE",
    );
  });
});

// ─── Review #4: srcset descriptor density is honored (no @1x mislabel) ────────

describe("Review #4: srcset candidate keeps its declared density", () => {
  it('a "2x" candidate references the original image bytes and keeps the 2x descriptor', async () => {
    const png = await sharp({ create: { width: 9, height: 9, channels: 3, background: "#0a0b0c" } })
      .png()
      .toBuffer();
    const html = `<img srcset="data:image/png;base64,${png.toString("base64")} 2x">`;
    const result = await localizeArtifactAssets({ html });

    const m = result.html.match(/srcset="([^"]+)"/);
    expect(m).toBeTruthy();
    const value = m![1].trim();
    // descriptor preserved as 2x (not coerced to 1x)
    expect(value).toMatch(/\s2x$/);

    const url = value.split(/\s+/)[0];
    // the referenced file holds the ORIGINAL bytes — no down-sample, no @1x mislabel
    const buf = result.files.get(url);
    expect(buf).toBeDefined();
    expect(buf!.equals(png)).toBe(true);

    // asset density reflects the declared 2x
    const asset = result.assets.find((a: { path: string; density: number[] }) => a.path === url);
    expect(asset?.density).toContain(2);
  });
});

// ─── dedup: same data: used twice gets same hash ─────────────────────────────

describe("Deduplication", () => {
  it("same data: URL twice → one asset entry, files contain it once", async () => {
    const html = `<img src="data:image/svg+xml;base64,${SVG_BASE64}"><img src="data:image/svg+xml;base64,${SVG_BASE64}">`;
    const result = await localizeArtifactAssets({ html });
    // Both assets entries point at same path → deduped
    expect(result.assets).toHaveLength(1);
    expect(result.files.size).toBe(1);
  });
});

// ─── custom assetDirName ──────────────────────────────────────────────────────

describe("Custom assetDirName", () => {
  it("uses the provided directory name", async () => {
    const html = `<img src="data:image/svg+xml;base64,${SVG_BASE64}">`;
    const result = await localizeArtifactAssets({ html, assetDirName: "static" });
    expect(result.assets[0].path).toMatch(/^static\//);
    expect([...result.files.keys()][0]).toMatch(/^static\//);
  });
});

// ─── R4: parseDataUrl error classification ───────────────────────────────────

describe("parseDataUrl error classification (R4)", () => {
  it("rejects malformed url-encoded data URLs with ARTIFACT_INVALID_INPUT", async () => {
    // %E0%A4%A is a truncated percent-escape — decodeURIComponent throws URIError
    const html = `<img src="data:image/svg+xml,%E0%A4%A">`;
    await expect(localizeArtifactAssets({ html })).rejects.toMatchObject({
      code: "ARTIFACT_INVALID_INPUT",
    });
  });
});
