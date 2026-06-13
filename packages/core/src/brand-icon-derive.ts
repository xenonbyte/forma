/**
 * brand-icon-derive.ts — SPEC-DATA-005 / SPEC-BEHAVIOR-004 (Task 3)
 *
 * Pure sharp derivation: given master images a/b/c, produces the full variant
 * matrix for each target surface (android / ios / web / desktop). No disk I/O,
 * no network, no stub renderer — pure image processing.
 *
 * Called by Task 4's save_brand_asset(app-icon) which runs this derivation then
 * atomically replaces manifest records.
 *
 * Working canvas: all master inputs are normalized to 1080² before derivation.
 *
 * DECISION-001 constants (assertable):
 *   - DESKTOP_ICON_SIZES  — imported from brand-asset-plan.ts
 *   - ANDROID_FOREGROUND_SAFE_AREA = 666 — from brand-asset-plan.ts (used in tests / T4)
 *
 * iOS small sizes (mobile: 1024/180/120, tablet: 1024/167/152) are UNCONFIRMED
 * platform candidates — defined as local constants with a provenance comment.
 */

import sharp from "sharp";
import { DESKTOP_ICON_SIZES } from "./brand-asset-plan.js";
import { FormaError } from "./errors.js";
import type { BrandSurface, Platform } from "./schemas.js";

// ─── Public interface ─────────────────────────────────────────────────────────

export interface DeriveIconInput {
  /** undefined ⇒ web/desktop single-surface derivation. */
  surface?: BrandSurface;
  platform: Platform;
  /** Master image a — transparent-background logo (PNG with alpha). */
  logo: Buffer;
  /** Master image b — opaque background (no alpha channel). */
  background: Buffer;
  /**
   * Master image c — logo pre-positioned inside the 666² safe area on a 1080²
   * transparent canvas. REQUIRED for mobile/tablet (android/ios surfaces).
   */
  safeLogo?: Buffer;
  /** Optional colour overrides for tinted/monochrome variants. */
  colors?: {
    /** Tint colour for monochrome (android) and ios-tinted. Defaults to pure black. */
    mono?: string;
    /** Tint colour for ios-tinted. Falls back to colors.mono then "#000000". */
    tint?: string;
    /** Dark background colour for ios-dark. Defaults to "#1c1c1e". */
    dark_bg?: string;
  };
}

export interface DerivedIconVariant {
  /** Variant label, e.g. "android-standard", "ios-dark", "standard". */
  variant: string;
  width: number;
  height: number;
  /** PNG bytes. */
  png: Buffer;
}

// ─── Internal constants ───────────────────────────────────────────────────────

/** Working canvas size — all masters are normalised here before derivation. */
const WORKING_SIZE = 1080;

/** sharp decode ceiling — keeps in sync with the rest of the core package. */
const SHARP_PIXEL_LIMIT = 64_000_000;

/**
 * iOS app-icon sizes — UNCONFIRMED platform candidates (§6.4).
 * Source: Apple HIG "App icons" (reviewed 2026-06-14) — exact device matrix
 * is subject to Xcode asset catalogue version. Treat as best-effort until a
 * verifiedAt date is recorded here.
 */
const IOS_SIZES_MOBILE = [1024, 180, 120] as const;
const IOS_SIZES_TABLET = [1024, 167, 152] as const;

/** Web sizes for web/desktop single-surface. */
const WEB_SIZES = [512, 48, 32] as const;

/** Rounded-corner radius for web/desktop icons (as a fraction of canvas size). */
const ROUND_RADIUS_FRACTION = 0.2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise a master image to a square working canvas via cover-fit. */
async function normalise(src: Buffer, size: number): Promise<Buffer> {
  return sharp(src, { limitInputPixels: SHARP_PIXEL_LIMIT })
    .resize({ width: size, height: size, fit: "cover", position: "centre" })
    .ensureAlpha()
    .png()
    .toBuffer();
}

/** Normalise an opaque background (no alpha needed). */
async function normaliseOpaque(src: Buffer, size: number): Promise<Buffer> {
  return sharp(src, { limitInputPixels: SHARP_PIXEL_LIMIT })
    .resize({ width: size, height: size, fit: "cover", position: "centre" })
    .removeAlpha()
    .png()
    .toBuffer();
}

/** Composite logo (a) over background (b), both already at `size²`. */
async function compositeOver(logo: Buffer, bg: Buffer): Promise<Buffer> {
  return sharp(bg, { limitInputPixels: SHARP_PIXEL_LIMIT })
    .composite([{ input: logo, blend: "over" }])
    .png()
    .toBuffer();
}

/** Resize a square PNG to `size²`. */
async function resizeTo(src: Buffer, size: number): Promise<Buffer> {
  return sharp(src, { limitInputPixels: SHARP_PIXEL_LIMIT })
    .resize({ width: size, height: size, fit: "fill" })
    .png()
    .toBuffer();
}

/**
 * Apply greyscale + tint to `src`, preserving the alpha channel from `src`.
 * The tint colour replaces luminance; alpha is restored via dest-in masking.
 *
 * Implementation:
 *   1. greyscale(src) → grey (alpha may be reset to opaque by downstream ops)
 *   2. composite a solid tint colour with "multiply" blend (affects RGB only,
 *      but the multiply composite resets alpha to 255 — a known sharp/libvips
 *      side-effect when the overlay is opaque)
 *   3. re-apply the original src as a dest-in mask to restore the alpha shape.
 *      dest-in uses src.alpha to clip dest — since `src` has the correct alpha
 *      shape, this restores transparency without touching the tinted RGB values.
 *
 * Spike finding: extractChannel("alpha") returns a 1-ch (no-alpha) PNG;
 * dest-in on a no-alpha mask is a no-op in sharp/libvips. The fix is to use
 * the full original `src` (with its RGBA) as the dest-in mask instead.
 */
async function greyscaleWithTint(src: Buffer, tintHex: string): Promise<Buffer> {
  // 1. Greyscale → RGBA (alpha from src is preserved by greyscale here).
  const grey = await sharp(src, { limitInputPixels: SHARP_PIXEL_LIMIT }).greyscale().ensureAlpha().png().toBuffer();

  // 2. Tint: multiply a solid-colour overlay (opaque) over the grey layer.
  //    Side-effect: multiply composite resets alpha to 255 for all pixels.
  const meta = await sharp(grey, { limitInputPixels: SHARP_PIXEL_LIMIT }).metadata();
  const w = meta.width ?? WORKING_SIZE;
  const h = meta.height ?? WORKING_SIZE;
  const tintBuf = Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${tintHex}"/></svg>`,
  );
  const tinted = await sharp(grey, { limitInputPixels: SHARP_PIXEL_LIMIT })
    .composite([{ input: tintBuf, blend: "multiply" }])
    .ensureAlpha()
    .png()
    .toBuffer();

  // 3. Restore alpha shape: dest-in clips `tinted` to the alpha of `src`.
  //    dest-in uses src.alpha; RGB comes from tinted (the current dest).
  //    Using the full original `src` (RGBA) as the mask works correctly;
  //    extractChannel("alpha") is NOT used because its output lacks an alpha
  //    channel, making dest-in a no-op in libvips.
  return sharp(tinted, { limitInputPixels: SHARP_PIXEL_LIMIT })
    .composite([{ input: src, blend: "dest-in" }])
    .ensureAlpha()
    .png()
    .toBuffer();
}

/**
 * Apply rounded-corner mask to `src` at the given radius.
 * Produces a PNG with transparent corners.
 */
async function applyRoundedCorners(src: Buffer, radius: number): Promise<Buffer> {
  const meta = await sharp(src, { limitInputPixels: SHARP_PIXEL_LIMIT }).metadata();
  const w = meta.width ?? WORKING_SIZE;
  const h = meta.height ?? WORKING_SIZE;
  const r = Math.round(radius);

  const maskSvg = Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="white"/></svg>`,
  );

  // Rasterise SVG mask to greyscale PNG, then use dest-in to clip src.
  const mask = await sharp(maskSvg, { limitInputPixels: SHARP_PIXEL_LIMIT })
    .resize(w, h)
    .ensureAlpha()
    .png()
    .toBuffer();

  return sharp(src, { limitInputPixels: SHARP_PIXEL_LIMIT })
    .ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

// ─── Surface derivation functions ─────────────────────────────────────────────

async function deriveAndroid(logo: Buffer, bg: Buffer, safe: Buffer, monoHex: string): Promise<DerivedIconVariant[]> {
  const variants: DerivedIconVariant[] = [];

  // android-standard at 512 — a composited over b, resized.
  const standard1080 = await compositeOver(logo, bg);
  const standard512 = await resizeTo(standard1080, 512);
  variants.push({ variant: "android-standard", width: 512, height: 512, png: standard512 });

  // android-foreground at 1080 — = master c (transparent, 666² safe-area logo).
  // safe is already at WORKING_SIZE (1080²) per normalisation contract.
  variants.push({ variant: "android-foreground", width: WORKING_SIZE, height: WORKING_SIZE, png: safe });

  // android-background at 1080 — = master b (opaque).
  variants.push({ variant: "android-background", width: WORKING_SIZE, height: WORKING_SIZE, png: bg });

  // android-monochrome at 1080 — a → greyscale + tint + alpha preserved.
  const mono = await greyscaleWithTint(logo, monoHex);
  variants.push({ variant: "android-monochrome", width: WORKING_SIZE, height: WORKING_SIZE, png: mono });

  return variants;
}

async function deriveIos(
  logo: Buffer,
  bg: Buffer,
  safe: Buffer,
  platform: Platform,
  tintHex: string,
  darkBgHex: string,
): Promise<DerivedIconVariant[]> {
  const variants: DerivedIconVariant[] = [];

  // ios-standard at multiple sizes — a composited over b, resized.
  // UNCONFIRMED: size lists reflect Apple HIG best-effort (see module header).
  const iosSizes = platform === "tablet" ? IOS_SIZES_TABLET : IOS_SIZES_MOBILE;
  const standardBase = await compositeOver(logo, bg);
  for (const size of iosSizes) {
    const resized = await resizeTo(standardBase, size);
    variants.push({ variant: "ios-standard", width: size, height: size, png: resized });
  }

  // ios-dark at 1024 — a + tint + dark background.
  const darkBgSvg = Buffer.from(
    `<svg width="${WORKING_SIZE}" height="${WORKING_SIZE}"><rect width="${WORKING_SIZE}" height="${WORKING_SIZE}" fill="${darkBgHex}"/></svg>`,
  );
  const darkBgBuf = await sharp(darkBgSvg, { limitInputPixels: SHARP_PIXEL_LIMIT })
    .resize(WORKING_SIZE, WORKING_SIZE)
    .removeAlpha()
    .png()
    .toBuffer();
  const tintedLogo = await greyscaleWithTint(logo, tintHex);
  const darkComposite = await compositeOver(tintedLogo, darkBgBuf);
  const dark1024 = await resizeTo(darkComposite, 1024);
  variants.push({ variant: "ios-dark", width: 1024, height: 1024, png: dark1024 });

  // ios-tinted at 1024 — safe-area logo (c) + tint + transparent background.
  const tintedSafe = await greyscaleWithTint(safe, tintHex);
  const iosTinted = await resizeTo(tintedSafe, 1024);
  variants.push({ variant: "ios-tinted", width: 1024, height: 1024, png: iosTinted });

  return variants;
}

async function deriveWebDesktop(logo: Buffer, bg: Buffer, platform: Platform): Promise<DerivedIconVariant[]> {
  const variants: DerivedIconVariant[] = [];

  // Sizes: web = [512, 48, 32]; desktop = DESKTOP_ICON_SIZES ([1024,512,256,128,64,32,16]).
  const sizes: readonly number[] = platform === "desktop" ? DESKTOP_ICON_SIZES : WEB_SIZES;

  // Build the rounded master at the largest size then resize down.
  const largestSize = sizes[0];
  const composite = await compositeOver(logo, bg);
  const atLargest = await resizeTo(composite, largestSize);
  const radius = Math.round(largestSize * ROUND_RADIUS_FRACTION);
  const roundedMaster = await applyRoundedCorners(atLargest, radius);

  for (const size of sizes) {
    const png = size === largestSize ? roundedMaster : await resizeTo(roundedMaster, size);
    variants.push({ variant: "standard", width: size, height: size, png });
  }

  return variants;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Derive the full app-icon variant matrix from master images.
 *
 * All masters are normalised to a 1080² working canvas before derivation.
 * Output sizes are derived from the surface/platform constants in this module;
 * callers should record the returned width/height rather than hard-coding them.
 *
 * @throws {FormaError} MEDIA_INVALID_INPUT when safeLogo is missing for mobile/tablet surfaces.
 */
export async function deriveAppIconVariants(input: DeriveIconInput): Promise<DerivedIconVariant[]> {
  const { surface, platform, logo, background, safeLogo, colors = {} } = input;

  /** Assert safeLogo is present for a surface and return it (fail-loud). */
  function requireSafeLogo(): Buffer {
    if (safeLogo === undefined) {
      throw new FormaError(
        "MEDIA_INVALID_INPUT",
        `deriveAppIconVariants: surface="${surface}" requires safeLogo (master c)`,
        { surface, platform },
      );
    }
    return safeLogo;
  }

  // Normalise master images to the working canvas.
  const normLogo = await normalise(logo, WORKING_SIZE);
  const normBg = await normaliseOpaque(background, WORKING_SIZE);

  // Colour defaults.
  const monoHex = colors.mono ?? "#000000";
  const tintHex = colors.tint ?? colors.mono ?? "#000000";
  const darkBgHex = colors.dark_bg ?? "#1c1c1e";

  if (surface === "android") {
    const normSafe = await normalise(requireSafeLogo(), WORKING_SIZE);
    return deriveAndroid(normLogo, normBg, normSafe, monoHex);
  }

  if (surface === "ios") {
    const normSafe = await normalise(requireSafeLogo(), WORKING_SIZE);
    return deriveIos(normLogo, normBg, normSafe, platform, tintHex, darkBgHex);
  }

  // web / desktop — single surface (surface undefined). safeLogo not required.
  return deriveWebDesktop(normLogo, normBg, platform);
}
