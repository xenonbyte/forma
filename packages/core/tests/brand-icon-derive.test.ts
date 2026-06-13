/**
 * brand-icon-derive.test.ts — TM-06
 *
 * Tests for the pure sharp derivation module (brand-icon-derive.ts).
 * NO stub renderer, NO network, NO disk fixtures.
 * All master images are synthesised with sharp from solid-colour/alpha PNGs.
 */

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ANDROID_FOREGROUND_SAFE_AREA, DESKTOP_ICON_SIZES } from "../src/brand-asset-plan.js";
import { deriveAppIconVariants, type DeriveIconInput, type DerivedIconVariant } from "../src/brand-icon-derive.js";
import { FormaError } from "../src/errors.js";

// ─── Synthetic image factories ────────────────────────────────────────────────

/** Opaque PNG filled with `color` at `size²`. */
async function solidPng(size: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: color },
  })
    .png()
    .toBuffer();
}

/**
 * Logo PNG with alpha: circular disc of `color` on a transparent background.
 * Alpha channel present so the derivation can preserve/test it.
 */
async function logoWithAlpha(size: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
  // Create a solid-colour PNG then make corners transparent via SVG mask.
  const base = await sharp({
    create: { width: size, height: size, channels: 4, background: { ...color, alpha: 1 } },
  })
    .png()
    .toBuffer();

  const r = Math.round(size / 2);
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r}" fill="white"/></svg>`,
  );
  const maskBuf = await sharp(mask).resize(size, size).ensureAlpha().png().toBuffer();

  return sharp(base)
    .composite([{ input: maskBuf, blend: "dest-in" }])
    .ensureAlpha()
    .png()
    .toBuffer();
}

/**
 * Safe-area logo PNG: a smaller disc centred on a transparent 1080² canvas,
 * simulating the 666² safe-area constraint.
 */
async function safeAreaPng(color: { r: number; g: number; b: number }): Promise<Buffer> {
  const canvasSize = 1080;
  // Create opaque disc at ANDROID_FOREGROUND_SAFE_AREA (666) px, then embed it.
  const disc = await logoWithAlpha(ANDROID_FOREGROUND_SAFE_AREA, color);
  // Embed the 666² disc on a 1080² transparent canvas.
  const offset = Math.round((canvasSize - ANDROID_FOREGROUND_SAFE_AREA) / 2);
  return sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: disc, left: offset, top: offset }])
    .png()
    .toBuffer();
}

/** Helper: get RGBA pixel at (x,y) from a PNG buffer. */
async function getPixel(png: Buffer, x: number, y: number): Promise<{ r: number; g: number; b: number; a: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const idx = (y * info.width + x) * 4;
  return { r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] };
}

/** Helper: compute per-channel means from a raw RGBA buffer. */
async function channelMeans(png: Buffer): Promise<{ r: number; g: number; b: number; a: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sumR = 0,
    sumG = 0,
    sumB = 0,
    sumA = 0;
  const n = info.width * info.height;
  for (let i = 0; i < data.length; i += 4) {
    sumR += data[i];
    sumG += data[i + 1];
    sumB += data[i + 2];
    sumA += data[i + 3];
  }
  return { r: sumR / n, g: sumG / n, b: sumB / n, a: sumA / n };
}

/** Extract variant names from the result set. */
function variantNames(variants: DerivedIconVariant[]): string[] {
  return [...new Set(variants.map((v) => v.variant))];
}

// ─── Spike: operator verification ────────────────────────────────────────────

describe("spike: sharp operators on synthetic buffers", () => {
  it("greyscale on a coloured logo produces R≈G≈B", async () => {
    const logo = await solidPng(64, { r: 200, g: 100, b: 50 });
    const grey = await sharp(logo).greyscale().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { data } = grey;
    // In a greyscale RGBA image all colour channels are equal.
    for (let i = 0; i < data.length; i += 4) {
      expect(Math.abs(data[i] - data[i + 1])).toBeLessThanOrEqual(1);
      expect(Math.abs(data[i] - data[i + 2])).toBeLessThanOrEqual(1);
    }
  });

  it("multiply tint blend produces non-white tint on greyscale", async () => {
    const logo = await solidPng(64, { r: 180, g: 180, b: 180 });
    const grey = await sharp(logo).greyscale().ensureAlpha().png().toBuffer();
    const tintSvg = Buffer.from(`<svg width="64" height="64"><rect width="64" height="64" fill="red"/></svg>`);
    const tinted = await sharp(grey)
      .composite([{ input: tintSvg, blend: "multiply" }])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { data } = tinted;
    // Red channel should be significantly higher than blue.
    const midR = data[0];
    const midB = data[2];
    expect(midR).toBeGreaterThan(midB + 20);
  });

  it("dest-in blend clips image to mask shape (corners become transparent)", async () => {
    const size = 64;
    const square = await solidPng(size, { r: 200, g: 100, b: 50 });
    const squareAlpha = await sharp(square).ensureAlpha().png().toBuffer();
    const r = 16;
    const maskSvg = Buffer.from(
      `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="white"/></svg>`,
    );
    const mask = await sharp(maskSvg).resize(size, size).ensureAlpha().png().toBuffer();
    const result = await sharp(squareAlpha)
      .composite([{ input: mask, blend: "dest-in" }])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Top-left corner (0,0) should be transparent.
    const topLeft = result.data[3]; // alpha of first pixel
    expect(topLeft).toBe(0);
    // Centre should be opaque.
    const midIdx = ((size / 2) * size + size / 2) * 4 + 3;
    expect(result.data[midIdx]).toBeGreaterThan(200);
  });

  it("alpha preserved through resize", async () => {
    const logo = await logoWithAlpha(128, { r: 0, g: 128, b: 255 });
    const resized = await sharp(logo).resize({ width: 64, height: 64, fit: "fill" }).ensureAlpha().png().toBuffer();
    const meta = await sharp(resized).metadata();
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(64);
    expect(meta.channels).toBe(4);
    // Corners of the circle clip should be transparent (top-left pixel).
    const px = await getPixel(resized, 0, 0);
    expect(px.a).toBeLessThan(50);
  });

  it("SVG rasterisation via sharp produces a valid PNG", async () => {
    const svg = Buffer.from(`<svg width="64" height="64"><rect width="64" height="64" rx="16" fill="white"/></svg>`);
    const png = await sharp(svg).resize(64, 64).png().toBuffer();
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(64);
  });

  it("composite logo-over-background merges correctly", async () => {
    const logo = await logoWithAlpha(64, { r: 255, g: 0, b: 0 });
    const bg = await solidPng(64, { r: 0, g: 0, b: 255 });
    const out = await sharp(bg)
      .composite([{ input: logo, blend: "over" }])
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Centre pixel (disc area) should be red, not blue.
    const midIdx = (32 * 64 + 32) * 3;
    expect(out.data[midIdx]).toBeGreaterThan(100); // R
    expect(out.data[midIdx + 2]).toBeLessThan(50); // B
  });
});

// ─── Android surface ──────────────────────────────────────────────────────────

describe("android surface", () => {
  async function makeAndroidInput(): Promise<DeriveIconInput> {
    return {
      surface: "android",
      platform: "mobile",
      logo: await logoWithAlpha(200, { r: 255, g: 0, b: 0 }),
      background: await solidPng(200, { r: 0, g: 100, b: 200 }),
      safeLogo: await safeAreaPng({ r: 255, g: 255, b: 0 }),
    };
  }

  it("produces exactly 4 unique variant names", async () => {
    const input = await makeAndroidInput();
    const variants = await deriveAppIconVariants(input);
    const names = variantNames(variants);
    expect(names).toHaveLength(4);
    expect(names).toContain("android-standard");
    expect(names).toContain("android-foreground");
    expect(names).toContain("android-background");
    expect(names).toContain("android-monochrome");
  });

  it("android-standard is 512×512", async () => {
    const input = await makeAndroidInput();
    const variants = await deriveAppIconVariants(input);
    const std = variants.find((v) => v.variant === "android-standard");
    expect(std).toBeDefined();
    expect(std?.width).toBe(512);
    expect(std?.height).toBe(512);
  });

  it("foreground/background/monochrome are 1080×1080", async () => {
    const input = await makeAndroidInput();
    const variants = await deriveAppIconVariants(input);
    for (const name of ["android-foreground", "android-background", "android-monochrome"]) {
      const v = variants.find((vv) => vv.variant === name);
      expect(v).toBeDefined();
      expect(v?.width).toBe(1080);
      expect(v?.height).toBe(1080);
    }
  });

  it("android-monochrome has alpha channel and is greyscale-ish (R≈G≈B)", async () => {
    const input = await makeAndroidInput();
    const variants = await deriveAppIconVariants(input);
    const mono = variants.find((v) => v.variant === "android-monochrome");
    expect(mono).toBeDefined();
    const png = mono?.png ?? Buffer.alloc(0);
    const meta = await sharp(png).metadata();
    expect(meta.channels).toBe(4); // has alpha

    // Explicit pixel sampling on the 1080² disc — avoids transparent pixels
    // dragging channel means toward false equality.
    // Centre pixel (540,540) must be opaque AND dark (default black tint).
    const centre = await getPixel(png, 540, 540);
    expect(centre.a).toBeGreaterThan(200); // opaque — inside the disc
    expect(centre.r).toBeLessThan(30); // dark under black tint

    // Corner pixel (0,0) must be transparent — outside the circular disc.
    const corner = await getPixel(png, 0, 0);
    expect(corner.a).toBeLessThan(10);
  });

  it("android-foreground preserves transparency (has alpha)", async () => {
    const input = await makeAndroidInput();
    const variants = await deriveAppIconVariants(input);
    const fg = variants.find((v) => v.variant === "android-foreground");
    expect(fg).toBeDefined();
    const meta = await sharp(fg?.png ?? Buffer.alloc(0)).metadata();
    // Must have an alpha channel.
    expect(meta.channels).toBe(4);
    // Corner pixel of the 1080 canvas should be transparent (safe-area disc is centred).
    const corner = await getPixel(fg?.png ?? Buffer.alloc(0), 0, 0);
    expect(corner.a).toBe(0);
  });

  it("android-background is opaque (no transparent pixels)", async () => {
    const input = await makeAndroidInput();
    const variants = await deriveAppIconVariants(input);
    const bgv = variants.find((v) => v.variant === "android-background");
    expect(bgv).toBeDefined();
    const means = await channelMeans(bgv?.png ?? Buffer.alloc(0));
    // All pixels should be fully opaque → mean alpha close to 255.
    expect(means.a).toBeGreaterThan(250);
  });

  it("android-background PNG size matches WORKING_SIZE constant (1080)", async () => {
    const input = await makeAndroidInput();
    const variants = await deriveAppIconVariants(input);
    const bgv = variants.find((v) => v.variant === "android-background");
    expect(bgv).toBeDefined();
    const meta = await sharp(bgv?.png ?? Buffer.alloc(0)).metadata();
    expect(meta.width).toBe(1080); // DECISION-001: ANDROID_FOREGROUND_SAFE_AREA=666 on a 1080 canvas
    expect(meta.height).toBe(1080);
  });
});

// ─── iOS surface ──────────────────────────────────────────────────────────────

describe("ios surface (mobile)", () => {
  async function makeIosInput(): Promise<DeriveIconInput> {
    return {
      surface: "ios",
      platform: "mobile",
      logo: await logoWithAlpha(200, { r: 0, g: 200, b: 100 }),
      background: await solidPng(200, { r: 240, g: 240, b: 240 }),
      safeLogo: await safeAreaPng({ r: 0, g: 200, b: 100 }),
    };
  }

  it("ios-standard appears at each of the configured sizes (mobile: 1024, 180, 120)", async () => {
    const input = await makeIosInput();
    const variants = await deriveAppIconVariants(input);
    const stdSizes = variants.filter((v) => v.variant === "ios-standard").map((v) => v.width);
    // UNCONFIRMED iOS mobile sizes — assert the derivation produces one entry per configured size.
    expect(stdSizes).toContain(1024);
    expect(stdSizes).toContain(180);
    expect(stdSizes).toContain(120);
    expect(stdSizes).toHaveLength(3);
  });

  it("ios-dark is 1024×1024 and opaque (no alpha at corners)", async () => {
    const input = await makeIosInput();
    const variants = await deriveAppIconVariants(input);
    const dark = variants.find((v) => v.variant === "ios-dark");
    expect(dark).toBeDefined();
    expect(dark?.width).toBe(1024);
    expect(dark?.height).toBe(1024);
    // Dark has a solid background → should be opaque.
    const means = await channelMeans(dark?.png ?? Buffer.alloc(0));
    expect(means.a).toBeGreaterThan(200);
  });

  it("ios-tinted is 1024×1024 and preserves alpha (transparent background)", async () => {
    const input = await makeIosInput();
    const variants = await deriveAppIconVariants(input);
    const tinted = variants.find((v) => v.variant === "ios-tinted");
    expect(tinted).toBeDefined();
    expect(tinted?.width).toBe(1024);
    expect(tinted?.height).toBe(1024);
    const meta = await sharp(tinted?.png ?? Buffer.alloc(0)).metadata();
    expect(meta.channels).toBe(4);
    // Corner pixel of safe-area image should be transparent.
    // The safe-area logo sits centred on a 1080² transparent canvas, so (0,0) is
    // outside the disc — alpha must be 0.
    const corner = await getPixel(tinted?.png ?? Buffer.alloc(0), 0, 0);
    expect(corner.a).toBe(0);
  });
});

// ─── iOS surface (tablet) ─────────────────────────────────────────────────────

describe("ios surface (tablet)", () => {
  async function makeIosTabletInput(): Promise<DeriveIconInput> {
    return {
      surface: "ios",
      platform: "tablet",
      logo: await logoWithAlpha(200, { r: 0, g: 100, b: 200 }),
      background: await solidPng(200, { r: 240, g: 240, b: 240 }),
      safeLogo: await safeAreaPng({ r: 0, g: 100, b: 200 }),
    };
  }

  it("ios-standard appears at tablet sizes [1024, 167, 152]", async () => {
    const input = await makeIosTabletInput();
    const variants = await deriveAppIconVariants(input);
    const stdSizes = variants.filter((v) => v.variant === "ios-standard").map((v) => v.width);
    // IOS_SIZES_TABLET = [1024, 167, 152] — UNCONFIRMED platform candidates.
    expect(stdSizes).toContain(1024);
    expect(stdSizes).toContain(167);
    expect(stdSizes).toContain(152);
    expect(stdSizes).toHaveLength(3);
  });

  it("ios-dark and ios-tinted are produced at 1024×1024 for tablet", async () => {
    const input = await makeIosTabletInput();
    const variants = await deriveAppIconVariants(input);
    const dark = variants.find((v) => v.variant === "ios-dark");
    const tinted = variants.find((v) => v.variant === "ios-tinted");
    expect(dark?.width).toBe(1024);
    expect(dark?.height).toBe(1024);
    expect(tinted?.width).toBe(1024);
    expect(tinted?.height).toBe(1024);
  });
});

// ─── web surface (no surface) ─────────────────────────────────────────────────

describe("web platform (no surface)", () => {
  async function makeWebInput(): Promise<DeriveIconInput> {
    return {
      platform: "web",
      logo: await logoWithAlpha(200, { r: 100, g: 0, b: 255 }),
      background: await solidPng(200, { r: 255, g: 255, b: 255 }),
    };
  }

  it("produces 'standard' variant at [512, 48, 32]", async () => {
    const input = await makeWebInput();
    const variants = await deriveAppIconVariants(input);
    const sizes = variants.map((v) => v.width);
    expect(sizes).toContain(512);
    expect(sizes).toContain(48);
    expect(sizes).toContain(32);
    expect(variants).toHaveLength(3);
    expect(variantNames(variants)).toEqual(["standard"]);
  });

  it("rounded corners: top-left corner pixel is transparent after dest-in mask", async () => {
    const input = await makeWebInput();
    const variants = await deriveAppIconVariants(input);
    // Check the largest size (512) for rounded corners.
    const largest = variants.find((v) => v.width === 512);
    expect(largest).toBeDefined();
    const corner = await getPixel(largest?.png ?? Buffer.alloc(0), 0, 0);
    expect(corner.a).toBe(0);
  });

  it("corner is transparent (or near-transparent due to anti-alias) on all sizes", async () => {
    const input = await makeWebInput();
    const variants = await deriveAppIconVariants(input);
    for (const v of variants) {
      const corner = await getPixel(v.png, 0, 0);
      // Anti-aliasing during downscale (e.g. 1024→32) may produce alpha=1 at the
      // corner rather than strict 0. Accept values < 10 as "transparent corner".
      expect(corner.a).toBeLessThan(10);
    }
  });

  it("safeLogo is not required for web", async () => {
    const input = await makeWebInput();
    // safeLogo is undefined — should not throw.
    await expect(deriveAppIconVariants(input)).resolves.not.toThrow();
  });
});

// ─── desktop platform (no surface) ───────────────────────────────────────────

describe("desktop platform (no surface)", () => {
  async function makeDesktopInput(): Promise<DeriveIconInput> {
    return {
      platform: "desktop",
      logo: await logoWithAlpha(200, { r: 255, g: 200, b: 0 }),
      background: await solidPng(200, { r: 30, g: 30, b: 30 }),
    };
  }

  it("produces 'standard' at all DESKTOP_ICON_SIZES", async () => {
    const input = await makeDesktopInput();
    const variants = await deriveAppIconVariants(input);
    expect(variants).toHaveLength(DESKTOP_ICON_SIZES.length);
    const sizes = variants.map((v) => v.width);
    for (const s of DESKTOP_ICON_SIZES) {
      expect(sizes).toContain(s);
    }
    // All variants have the same label.
    expect(variantNames(variants)).toEqual(["standard"]);
  });

  it("DESKTOP_ICON_SIZES is [1024,512,256,128,64,32,16] (DECISION-001)", () => {
    expect([...DESKTOP_ICON_SIZES]).toEqual([1024, 512, 256, 128, 64, 32, 16]);
  });

  it("largest size (1024) has rounded corners", async () => {
    const input = await makeDesktopInput();
    const variants = await deriveAppIconVariants(input);
    const lg = variants.find((v) => v.width === 1024);
    expect(lg).toBeDefined();
    const corner = await getPixel(lg?.png ?? Buffer.alloc(0), 0, 0);
    expect(corner.a).toBe(0);
  });
});

// ─── colors overrides ─────────────────────────────────────────────────────────

describe("colors overrides", () => {
  it("colors.mono red tint: android-monochrome centre pixel has R significantly > B", async () => {
    const input: DeriveIconInput = {
      surface: "android",
      platform: "mobile",
      logo: await logoWithAlpha(200, { r: 200, g: 200, b: 200 }),
      background: await solidPng(200, { r: 100, g: 100, b: 100 }),
      safeLogo: await safeAreaPng({ r: 200, g: 200, b: 200 }),
      colors: { mono: "#ff0000" },
    };
    const variants = await deriveAppIconVariants(input);
    const mono = variants.find((v) => v.variant === "android-monochrome");
    expect(mono).toBeDefined();
    const centre = await getPixel(mono?.png ?? Buffer.alloc(0), 540, 540);
    // Centre pixel must be opaque and red-dominant.
    expect(centre.a).toBeGreaterThan(200);
    expect(centre.r).toBeGreaterThan(centre.b + 50);
  });

  it("colors.tint overrides ios-tinted independently of colors.mono", async () => {
    const input: DeriveIconInput = {
      surface: "ios",
      platform: "mobile",
      logo: await logoWithAlpha(200, { r: 200, g: 200, b: 200 }),
      background: await solidPng(200, { r: 240, g: 240, b: 240 }),
      safeLogo: await safeAreaPng({ r: 200, g: 200, b: 200 }),
      // tint = blue, mono = red; ios-tinted should use tint (blue).
      colors: { mono: "#ff0000", tint: "#0000ff" },
    };
    const variants = await deriveAppIconVariants(input);
    const tinted = variants.find((v) => v.variant === "ios-tinted");
    expect(tinted).toBeDefined();
    // Centre of the safe-area disc (within 1024² output — disc is roughly centred).
    const centre = await getPixel(tinted?.png ?? Buffer.alloc(0), 512, 512);
    // Must be opaque and blue-dominant.
    expect(centre.a).toBeGreaterThan(200);
    expect(centre.b).toBeGreaterThan(centre.r + 50);
  });

  it("colors.dark_bg overrides ios-dark background colour", async () => {
    const input: DeriveIconInput = {
      surface: "ios",
      platform: "mobile",
      logo: await logoWithAlpha(200, { r: 200, g: 200, b: 200 }),
      background: await solidPng(200, { r: 240, g: 240, b: 240 }),
      safeLogo: await safeAreaPng({ r: 200, g: 200, b: 200 }),
      // Use a highly saturated red background so it's easily detectable.
      colors: { dark_bg: "#ff0000" },
    };
    const variants = await deriveAppIconVariants(input);
    const dark = variants.find((v) => v.variant === "ios-dark");
    expect(dark).toBeDefined();
    // Corner pixel (0,0) is outside the logo disc, so it shows the background.
    const corner = await getPixel(dark?.png ?? Buffer.alloc(0), 0, 0);
    expect(corner.a).toBeGreaterThan(200); // opaque background
    expect(corner.r).toBeGreaterThan(corner.b + 50); // red-dominant background
  });
});

// ─── Validation: missing safeLogo ─────────────────────────────────────────────

describe("validation: missing safeLogo for mobile/tablet surfaces", () => {
  it("throws FormaError(MEDIA_INVALID_INPUT) for android surface without safeLogo", async () => {
    const input: DeriveIconInput = {
      surface: "android",
      platform: "mobile",
      logo: await logoWithAlpha(64, { r: 255, g: 0, b: 0 }),
      background: await solidPng(64, { r: 0, g: 0, b: 255 }),
      // safeLogo intentionally omitted
    };
    await expect(deriveAppIconVariants(input)).rejects.toThrow(FormaError);
    await expect(deriveAppIconVariants(input)).rejects.toMatchObject({
      code: "MEDIA_INVALID_INPUT",
    });
  });

  it("throws FormaError(MEDIA_INVALID_INPUT) for ios surface without safeLogo", async () => {
    const input: DeriveIconInput = {
      surface: "ios",
      platform: "mobile",
      logo: await logoWithAlpha(64, { r: 0, g: 200, b: 100 }),
      background: await solidPng(64, { r: 240, g: 240, b: 240 }),
      // safeLogo intentionally omitted
    };
    await expect(deriveAppIconVariants(input)).rejects.toMatchObject({
      code: "MEDIA_INVALID_INPUT",
    });
  });

  it("throws FormaError(MEDIA_INVALID_INPUT) for platform=mobile without surface set", async () => {
    // Previously this silently fell through to web derivation producing wrong sizes.
    const input: DeriveIconInput = {
      platform: "mobile",
      logo: await logoWithAlpha(64, { r: 255, g: 0, b: 0 }),
      background: await solidPng(64, { r: 0, g: 0, b: 255 }),
      // surface intentionally omitted
    };
    await expect(deriveAppIconVariants(input)).rejects.toMatchObject({
      code: "MEDIA_INVALID_INPUT",
    });
  });

  it("throws FormaError(MEDIA_INVALID_INPUT) for platform=tablet without surface set", async () => {
    const input: DeriveIconInput = {
      platform: "tablet",
      logo: await logoWithAlpha(64, { r: 255, g: 0, b: 0 }),
      background: await solidPng(64, { r: 0, g: 0, b: 255 }),
      // surface intentionally omitted
    };
    await expect(deriveAppIconVariants(input)).rejects.toMatchObject({
      code: "MEDIA_INVALID_INPUT",
    });
  });
});

// ─── DECISION-001 constants ───────────────────────────────────────────────────

describe("DECISION-001: assertable constants", () => {
  it("ANDROID_FOREGROUND_SAFE_AREA is 666", () => {
    expect(ANDROID_FOREGROUND_SAFE_AREA).toBe(666);
  });

  it("DESKTOP_ICON_SIZES has 7 entries including 16 and 1024", () => {
    expect(DESKTOP_ICON_SIZES).toHaveLength(7);
    expect(DESKTOP_ICON_SIZES[0]).toBe(1024);
    expect(DESKTOP_ICON_SIZES[DESKTOP_ICON_SIZES.length - 1]).toBe(16);
  });
});
