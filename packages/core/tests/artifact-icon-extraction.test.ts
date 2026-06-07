/**
 * artifact-icon-extraction.test.ts
 *
 * TDD tests for extractIconAssets — written before the implementation.
 *
 * Cases covered:
 *   1.  Deterministic names: aria-label slug + 16-char content hash
 *   2.  Relative paths under icons/ only
 *   3.  Manifest top-level metadata fields
 *   4.  Density keys 1x/2x/3x in manifest files.png
 *   5.  currentColor flag (usesCurrentColor=true, no injected foreground)
 *   6.  Zero-icon pages → empty files Map + manifest.icons = []
 *   7.  Duplicate SVG dedupe: same content → one physical file set, occurrence/source order preserved
 *   8.  width/height from attrs; fallback to viewBox
 *   9.  Transparent PNG output (no flatten)
 *  10.  Unsafe SVG rejection (script element)
 *  11.  Unsafe SVG rejection (on* event handler)
 *  12.  Unsafe SVG rejection (data: href/xlink:href)
 *  13.  Fallback name: icon-<index>-<WxH> when no aria-label
 *  14.  parseSvgSize ignores unit-bearing width/height, falls back to viewBox
 *  15.  Empty aria-label slug falls back to icon-<index> name (no leading hyphen)
 *  16.  Parent aria-label is used when SVG has no own label
 *  17.  Non-renderable SVGs are skipped instead of blocking archive
 */

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { extractIconAssets } from "../src/artifact-icon-extraction.js";
import { FormaError } from "../src/errors.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const METADATA = {
  artifactId: "art-001",
  productId: "prod-001",
  requirementId: "req-001",
  pageId: "page-001",
  version: "v3",
  generatedFrom: "requirement-archive" as const,
};

/** Minimal safe SVG with explicit width/height and aria-label on container */
function makeSvg(width: number, height: number, label?: string, extraContent = ""): string {
  const labelAttr = label ? ` aria-label="${label}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"${labelAttr}><rect width="${width}" height="${height}"/>${extraContent}</svg>`;
}

/** SVG with currentColor fill */
const SVG_CURRENT_COLOR = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" aria-label="Close"><path fill="currentColor" d="M0 0h24v24H0z"/></svg>`;

/** SVG using viewBox only, no width/height attrs */
function makeSvgViewBox(vbW: number, vbH: number, label?: string): string {
  const labelAttr = label ? ` aria-label="${label}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}"${labelAttr}><rect width="${vbW}" height="${vbH}"/></svg>`;
}

/** Unsafe SVG containing a <script> element */
const SVG_UNSAFE_SCRIPT = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><script>alert(1)</script></svg>`;

/** Unsafe SVG with on* event handler */
const SVG_UNSAFE_EVENT = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect onclick="alert(1)"/></svg>`;

function wrapInHtml(svgs: string[]): string {
  return `<!DOCTYPE html><html><body>${svgs.join("\n")}</body></html>`;
}

// ─── Case 1: Deterministic names ─────────────────────────────────────────────

describe("Case 1: deterministic names", () => {
  it("uses aria-label slug + 16-char content hash as file basename", async () => {
    const svg = makeSvg(24, 24, "Close Icon");
    const html = wrapInHtml([svg]);
    const { files, manifest } = await extractIconAssets(html, METADATA);

    // id must be: slug + 16-char hex hash
    expect(manifest.icons[0].id).toMatch(/^close-icon-[0-9a-f]{16}$/);
    // SVG file path must match id
    const id = manifest.icons[0].id;
    expect(files.has(`icons/${id}.svg`)).toBe(true);
    // Running twice with same input must produce same id (deterministic)
    const { manifest: m2 } = await extractIconAssets(html, METADATA);
    expect(m2.icons[0].id).toBe(id);
  });

  it("falls back to icon-<index>-<WxH>-<hash> when no aria-label present", async () => {
    const svg = makeSvg(32, 32);
    const html = wrapInHtml([svg]);
    const { files, manifest } = await extractIconAssets(html, METADATA);

    expect(manifest.icons[0].id).toMatch(/^icon-0-32x32-[0-9a-f]{16}$/);
    const id = manifest.icons[0].id;
    expect(files.has(`icons/${id}.svg`)).toBe(true);
  });

  it("uses the direct parent aria-label when the SVG has no own label", async () => {
    const svg = makeSvg(24, 24);
    const html = wrapInHtml([`<button aria-label="Open Menu">${svg}</button>`]);
    const { files, manifest } = await extractIconAssets(html, METADATA);

    expect(manifest.icons[0].id).toMatch(/^open-menu-[0-9a-f]{16}$/);
    expect(files.has(`icons/${manifest.icons[0].id}.svg`)).toBe(true);
  });
});

// ─── Case 2: Relative paths under icons/ ────────────────────────────────────

describe("Case 2: relative paths under icons/", () => {
  it("all keys in files start with icons/", async () => {
    const svg = makeSvg(24, 24, "Arrow");
    const html = wrapInHtml([svg]);
    const { files } = await extractIconAssets(html, METADATA);

    for (const key of files.keys()) {
      expect(key).toMatch(/^icons\//);
    }
  });
});

// ─── Case 3: Manifest top-level metadata ─────────────────────────────────────

describe("Case 3: manifest top-level metadata", () => {
  it("includes all required metadata fields + sourceVersion = version", async () => {
    const svg = makeSvg(24, 24, "Star");
    const html = wrapInHtml([svg]);
    const { manifest } = await extractIconAssets(html, METADATA);

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.artifactId).toBe(METADATA.artifactId);
    expect(manifest.productId).toBe(METADATA.productId);
    expect(manifest.requirementId).toBe(METADATA.requirementId);
    expect(manifest.pageId).toBe(METADATA.pageId);
    expect(manifest.version).toBe(METADATA.version);
    expect(manifest.sourceVersion).toBe(METADATA.version);
    expect(manifest.generatedFrom).toBe(METADATA.generatedFrom);
    expect(Date.parse(manifest.generatedAt)).not.toBeNaN();
    expect(manifest.densities).toEqual([1, 2, 3]);
    expect(manifest.instances).toHaveLength(1);
    expect(manifest.icons[0]).toMatchObject({
      name: "star",
      contentHash: expect.stringMatching(/^[0-9a-f]{16}$/),
      sourceOrderFirst: 0,
      sourceOrders: [0],
    });
  });
});

// ─── Case 4: Density keys 1x/2x/3x ──────────────────────────────────────────

describe("Case 4: density keys 1x/2x/3x", () => {
  it("manifest.icons[0].files.png has 1x, 2x, 3x keys", async () => {
    const svg = makeSvg(24, 24, "Check");
    const html = wrapInHtml([svg]);
    const { manifest } = await extractIconAssets(html, METADATA);

    const icon = manifest.icons[0];
    expect(icon.files.png).toHaveProperty("1x");
    expect(icon.files.png).toHaveProperty("2x");
    expect(icon.files.png).toHaveProperty("3x");
  });

  it("all three PNG density files exist in files Map", async () => {
    const svg = makeSvg(24, 24, "Check");
    const html = wrapInHtml([svg]);
    const { files, manifest } = await extractIconAssets(html, METADATA);

    const icon = manifest.icons[0];
    expect(files.has(icon.files.png["1x"])).toBe(true);
    expect(files.has(icon.files.png["2x"])).toBe(true);
    expect(files.has(icon.files.png["3x"])).toBe(true);
  });

  it("default densities are [1, 2, 3]", async () => {
    const svg = makeSvg(24, 24, "Check");
    const html = wrapInHtml([svg]);
    const { files } = await extractIconAssets(html, METADATA);

    // Default: three density tiers
    const pngCount = [...files.keys()].filter((k) => k.endsWith(".png")).length;
    expect(pngCount).toBe(3);
  });

  it("respects custom densities option", async () => {
    const svg = makeSvg(24, 24, "Check");
    const html = wrapInHtml([svg]);
    const { files, manifest } = await extractIconAssets(html, METADATA, { densities: [1, 2] });

    const pngCount = [...files.keys()].filter((k) => k.endsWith(".png")).length;
    expect(pngCount).toBe(2);
    expect(manifest.densities).toEqual([1, 2]);
  });
});

// ─── Case 5: currentColor ────────────────────────────────────────────────────

describe("Case 5: currentColor flag", () => {
  it("sets usesCurrentColor=true when fill=currentColor is present", async () => {
    const html = wrapInHtml([SVG_CURRENT_COLOR]);
    const { manifest } = await extractIconAssets(html, METADATA);

    const icon = manifest.icons[0];
    expect(icon.usesCurrentColor).toBe(true);
  });

  it("sets usesCurrentColor=false when no currentColor", async () => {
    const svg = makeSvg(24, 24, "Solid");
    const html = wrapInHtml([svg]);
    const { manifest } = await extractIconAssets(html, METADATA);

    const icon = manifest.icons[0];
    expect(icon.usesCurrentColor).toBe(false);
  });
});

// ─── Case 6: Zero-icon pages ─────────────────────────────────────────────────

describe("Case 6: zero-icon pages", () => {
  it("returns empty files Map when no inline SVGs present", async () => {
    const html = `<!DOCTYPE html><html><body><p>Hello world</p></body></html>`;
    const { files, manifest } = await extractIconAssets(html, METADATA);

    expect(files.size).toBe(0);
    expect(manifest.icons).toEqual([]);
  });
});

// ─── Case 7: Duplicate SVG dedupe ────────────────────────────────────────────

describe("Case 7: duplicate SVG dedupe", () => {
  it("same content → one physical file set and occurrence mapping", async () => {
    const svgA = makeSvg(24, 24, "Home");
    const svgB = makeSvg(24, 24, "Home"); // identical content
    const html = wrapInHtml([svgA, svgB]);
    const { files, manifest } = await extractIconAssets(html, METADATA);

    // One physical SVG file only
    const svgFiles = [...files.keys()].filter((k) => k.endsWith(".svg"));
    expect(svgFiles).toHaveLength(1);

    // One physical PNG set: 3 files
    const pngFiles = [...files.keys()].filter((k) => k.endsWith(".png"));
    expect(pngFiles).toHaveLength(3);

    // Manifest has 1 unique icon plus 2 source occurrences.
    expect(manifest.icons).toHaveLength(1);
    expect(manifest.icons[0].sourceOrderFirst).toBe(0);
    expect(manifest.icons[0].sourceOrders).toEqual([0, 1]);
    expect(manifest.instances).toEqual([
      { sourceOrder: 0, iconId: manifest.icons[0].id, contentHash: manifest.icons[0].contentHash },
      { sourceOrder: 1, iconId: manifest.icons[0].id, contentHash: manifest.icons[0].contentHash },
    ]);
  });
});

// ─── Case 8: width/height from attrs vs viewBox ───────────────────────────────

describe("Case 8: size from attrs vs viewBox", () => {
  it("reads size from SVG width/height attributes", async () => {
    const svg = makeSvg(48, 32, "Rect");
    const html = wrapInHtml([svg]);
    const { manifest } = await extractIconAssets(html, METADATA);

    expect(manifest.icons[0].size).toEqual({ w: 48, h: 32 });
  });

  it("falls back to viewBox dimensions when width/height attrs absent", async () => {
    const svg = makeSvgViewBox(64, 64, "Square");
    const html = wrapInHtml([svg]);
    const { manifest } = await extractIconAssets(html, METADATA);

    expect(manifest.icons[0].size).toEqual({ w: 64, h: 64 });
  });
});

// ─── Case 9: Transparent PNG output ──────────────────────────────────────────

describe("Case 9: transparent PNG output", () => {
  it("produced PNG has alpha channel (no flatten)", async () => {
    const svg = makeSvg(24, 24, "Transparent");
    const html = wrapInHtml([svg]);
    const { files, manifest } = await extractIconAssets(html, METADATA);

    const pngPath = manifest.icons[0].files.png["1x"];
    const pngBuf = files.get(pngPath);
    expect(pngBuf).toBeDefined();

    const meta = await sharp(pngBuf!).metadata();
    // PNG with alpha channel: channels=4 or hasAlpha=true
    expect(meta.hasAlpha).toBe(true);
  });
});

// ─── Case 10: Unsafe SVG rejection — script element ──────────────────────────

describe("Case 10: unsafe SVG rejection — script element", () => {
  it("throws FormaError for SVG containing <script>", async () => {
    const html = wrapInHtml([SVG_UNSAFE_SCRIPT]);
    await expect(extractIconAssets(html, METADATA)).rejects.toBeInstanceOf(FormaError);
  });

  it("error code is ARTIFACT_NOT_STATIC or ARTIFACT_INVALID_INPUT", async () => {
    const html = wrapInHtml([SVG_UNSAFE_SCRIPT]);
    try {
      await extractIconAssets(html, METADATA);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FormaError);
      const err = e as FormaError;
      expect(["ARTIFACT_NOT_STATIC", "ARTIFACT_INVALID_INPUT"]).toContain(err.code);
    }
  });
});

// ─── Case 11: Unsafe SVG rejection — on* event handler ───────────────────────

describe("Case 11: unsafe SVG rejection — on* event handler", () => {
  it("throws FormaError for SVG with onclick attribute", async () => {
    const html = wrapInHtml([SVG_UNSAFE_EVENT]);
    await expect(extractIconAssets(html, METADATA)).rejects.toBeInstanceOf(FormaError);
  });
});

// ─── Case 12: Unsafe SVG rejection — data: href/xlink:href ──────────────────

describe("Case 12: unsafe SVG rejection — data: href/xlink:href", () => {
  it("throws FormaError for SVG with data: URL in href attribute", async () => {
    const svgWithDataHref = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><image href="data:image/png;base64,abc123"/></svg>`;
    const html = wrapInHtml([svgWithDataHref]);
    await expect(extractIconAssets(html, METADATA)).rejects.toBeInstanceOf(FormaError);
  });

  it("throws FormaError for SVG with data: URL in xlink:href attribute", async () => {
    const svgWithDataXlinkHref = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="24" height="24"><image xlink:href="data:image/png;base64,abc123"/></svg>`;
    const html = wrapInHtml([svgWithDataXlinkHref]);
    await expect(extractIconAssets(html, METADATA)).rejects.toBeInstanceOf(FormaError);
  });

  it("error code is ARTIFACT_NOT_STATIC for data: href violation", async () => {
    const svgWithDataHref = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><image href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>`;
    const html = wrapInHtml([svgWithDataHref]);
    try {
      await extractIconAssets(html, METADATA);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FormaError);
      expect((e as FormaError).code).toBe("ARTIFACT_NOT_STATIC");
    }
  });
});

// ─── Case 13: Fallback name icon-<index>-<WxH> ───────────────────────────────

describe("Case 13: fallback name", () => {
  it("uses icon-<index>-<WxH> format for zero-label SVGs", async () => {
    const svg1 = makeSvg(16, 16); // no label
    const svg2 = makeSvg(32, 32); // no label
    const html = wrapInHtml([svg1, svg2]);
    const { manifest } = await extractIconAssets(html, METADATA);

    expect(manifest.icons[0].id).toMatch(/^icon-0-16x16-[0-9a-f]{16}$/);
    expect(manifest.icons[1].id).toMatch(/^icon-1-32x32-[0-9a-f]{16}$/);
  });
});

// ─── Case 14: parseSvgSize ignores unit-bearing attrs ────────────────────────

describe("Case 14: parseSvgSize ignores unit-bearing width/height", () => {
  it("falls back to viewBox when width attr has em units", async () => {
    // width="2em" must be ignored; viewBox gives the real dimensions
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2em" height="2em" viewBox="0 0 48 48" aria-label="Unit Test"><rect width="48" height="48"/></svg>`;
    const html = wrapInHtml([svg]);
    const { manifest } = await extractIconAssets(html, METADATA);

    expect(manifest.icons[0].size).toEqual({ w: 48, h: 48 });
  });

  it("falls back to viewBox when width attr has percent units", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 32 32" aria-label="Percent"><rect width="32" height="32"/></svg>`;
    const html = wrapInHtml([svg]);
    const { manifest } = await extractIconAssets(html, METADATA);

    expect(manifest.icons[0].size).toEqual({ w: 32, h: 32 });
  });
});

// ─── Case 15: Empty aria-label slug must not produce a leading-hyphen name ───

describe("Case 15: empty slug falls back to icon-<index> name", () => {
  it("uses icon-<index>-<WxH> when aria-label slugifies to empty string", async () => {
    // aria-label="!!!" slugifies to "" — must NOT produce "-<hash>"
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" aria-label="!!!"><rect width="24" height="24"/></svg>`;
    const html = wrapInHtml([svg]);
    const { manifest } = await extractIconAssets(html, METADATA);

    const id = manifest.icons[0].id;
    // Must not start with a hyphen
    expect(id).not.toMatch(/^-/);
    // Must follow the fallback pattern
    expect(id).toMatch(/^icon-0-24x24-[0-9a-f]{16}$/);
  });
});

// ─── Case 17: non-renderable SVG skip ────────────────────────────────────────

describe("Case 17: non-renderable SVGs are skipped", () => {
  it("returns a zero-icon manifest for an empty SVG that VZI will not materialize", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
    const html = wrapInHtml([svg]);

    const { files, manifest } = await extractIconAssets(html, METADATA);

    expect(files.size).toBe(0);
    expect(manifest.icons).toEqual([]);
    expect(manifest.instances).toEqual([]);
  });
});

// ─── R3: icon raster pixel-limit ─────────────────────────────────────────────

describe("icon raster pixel-limit (R3)", () => {
  it("wraps icon SVG raster pixel-limit rejection as ARTIFACT_INVALID_INPUT", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="9000" aria-label="Huge"><rect width="9000" height="9000"/></svg>`;

    await expect(extractIconAssets(wrapInHtml([svg]), METADATA, { densities: [1] })).rejects.toMatchObject({
      code: "ARTIFACT_INVALID_INPUT",
      details: expect.objectContaining({ budget: "SHARP_PIXEL_LIMIT" }),
    });
  });
});

describe("Case 18: non-rendered or unsupported SVGs are not icon occurrences", () => {
  it("skips template, hidden, zero-size, and unsupported <use>-only SVGs while preserving visible source order", async () => {
    const hiddenSprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" width="24" height="24"><symbol id="sprite-check"><path d="M20 6L9 17l-5-5"/></symbol></svg>`;
    const templateSvg = `<template><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" aria-label="Template"><path d="M0 0h24v24H0z"/></svg></template>`;
    const zeroSizeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-label="Zero"><path d="M0 0h24v24H0z"/></svg>`;
    const useOnlySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" aria-label="Use Only"><use href="#sprite-check"/></svg>`;
    const visibleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" aria-label="Visible Check"><path d="M20 6L9 17l-5-5"/></svg>`;

    const { manifest } = await extractIconAssets(
      wrapInHtml([hiddenSprite, templateSvg, zeroSizeSvg, useOnlySvg, visibleSvg]),
      METADATA,
    );

    expect(manifest.icons).toHaveLength(1);
    expect(manifest.icons[0].name).toBe("visible-check");
    expect(manifest.icons[0].sourceOrders).toEqual([4]);
    expect(manifest.instances).toEqual([
      {
        sourceOrder: 4,
        iconId: manifest.icons[0].id,
        contentHash: manifest.icons[0].contentHash,
      },
    ]);
  });

  it("skips CSS-computed hidden SVGs at the archive viewport", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    .invisible { visibility: hidden; }
    @media (min-width: 768px) {
      .md\\:hidden { display: none; }
    }
  </style>
</head>
<body>
  <svg class="invisible" xmlns="http://www.w3.org/2000/svg" width="24" height="24" aria-label="Invisible">
    <path d="M0 0h24v24H0z" />
  </svg>
  <svg class="md:hidden" xmlns="http://www.w3.org/2000/svg" width="24" height="24" aria-label="Desktop Hidden">
    <path d="M1 1h22v22H1z" />
  </svg>
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" aria-label="Visible">
    <path d="M20 6L9 17l-5-5" />
  </svg>
</body>
</html>`;

    const { manifest } = await extractIconAssets(html, METADATA, {
      densities: [1],
      computedVisibility: {
        viewportWidth: 1024,
        viewportHeight: 1280,
        baseUrl: "http://localhost/",
      },
    });

    expect(manifest.icons).toHaveLength(1);
    expect(manifest.icons[0].name).toBe("visible");
    expect(manifest.icons[0].sourceOrders).toEqual([2]);
    expect(manifest.instances).toEqual([
      {
        sourceOrder: 2,
        iconId: manifest.icons[0].id,
        contentHash: manifest.icons[0].contentHash,
      },
    ]);
  });
});
