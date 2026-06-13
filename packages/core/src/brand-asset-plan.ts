/**
 * brand-asset-plan.ts — SPEC-DATA-003 / SPEC-BEHAVIOR-003 / SPEC-DATA-004
 *
 * Pure function `getBrandAssetPlan` converts a Product into the desired-state
 * plan for brand asset generation. No disk I/O — reads product fields only.
 *
 * Resolution tables:
 *   - Poster sizes: CONTROLLED CONSTANTS, fully assertable.
 *   - Desktop icon sizes + Android foreground safe-area: ASSERTABLE constants (DECISION-001).
 *   - Store-shot / banner / app-icon platform pixel values: UNCONFIRMED candidates
 *     (§6.4), marked via undefined `verifiedAt`.
 */

import { type BrandSurface, type Platform, brandSurfacesForPlatform } from "./schemas.js";
import type { BrandAssetKind } from "./brand-assets.js";
import type { Product } from "./product.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface BrandAssetPlanEntry {
  kind: BrandAssetKind;
  /** Omitted for single-surface platforms (web/desktop) and for poster (platform-agnostic). */
  surface?: BrandSurface;
  /** "portrait" | "landscape" | "square" for poster; variant layer name for app-icon. */
  variant?: string;
  width: number;
  height: number;
  count: number;
  /** Official documentation URL or description the dimensions were read from. */
  source?: string;
  /** ISO date (YYYY-MM-DD) the dimensions were verified. Absent = UNCONFIRMED. */
  verifiedAt?: string;
  /** app-icon only — which base images to generate ("a"|"b"|"c"). */
  baseImages?: ("a" | "b" | "c")[];
  /** app-icon only — derived variant names produced during derivation (Task 3). */
  variants?: string[];
}

export interface BrandAssetPlan {
  productId: string;
  platform: Platform;
  surfaces: BrandSurface[];
  entries: BrandAssetPlanEntry[];
}

// ─── Assertable constants (DECISION-001) ─────────────────────────────────────

/**
 * Poster dimensions — CONTROLLED CONSTANTS (SPEC-DATA-004). Fully assertable.
 * Platform-agnostic: same for all platforms.
 */
export const POSTER_SIZES = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
} as const;

/**
 * Desktop icon size set (DECISION-001) — ASSERTABLE.
 * Suspicious 358×358 / 720×72 values from source doc are discarded.
 */
export const DESKTOP_ICON_SIZES = [1024, 512, 256, 128, 64, 32, 16] as const;

/**
 * Android adaptive icon foreground safe-area diameter in px (DECISION-001).
 * Source doc contained a typo (66); the correct value is 666.
 */
export const ANDROID_FOREGROUND_SAFE_AREA = 666;

// ─── Resolution tables (§6.4 UNCONFIRMED candidates) ─────────────────────────

type ResolutionEntry = {
  width: number;
  height: number;
  source: string;
  verifiedAt: string | undefined;
};

/**
 * Store-shot pixel dimensions per (platform, surface).
 * Multi-surface platforms (mobile/tablet) use "android"/"ios" inner keys.
 * Single-surface platforms (web/desktop) use "" as the inner key.
 * ALL values are UNCONFIRMED candidates from requirement §6.4.
 *
 * Typed as Record<Platform, Record<BrandSurface | "", ResolutionEntry>> so that
 * adding a new Platform or BrandSurface becomes a compile error if the table is
 * not updated. For single-surface rows the "android"/"ios" inner keys are filled
 * with the platform's representative size (unreachable at runtime).
 */
const STORE_SHOT_RESOLUTION: Record<Platform, Record<BrandSurface | "", ResolutionEntry>> = {
  mobile: {
    android: { width: 1080, height: 1920, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    ios: { width: 1320, height: 2868, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    "": { width: 1080, height: 1920, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
  },
  tablet: {
    android: { width: 2560, height: 1600, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    ios: { width: 2752, height: 2064, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    "": { width: 2560, height: 1600, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
  },
  web: {
    android: { width: 1920, height: 1080, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    ios: { width: 1920, height: 1080, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    "": { width: 1920, height: 1080, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
  },
  desktop: {
    android: { width: 1920, height: 1080, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    ios: { width: 1920, height: 1080, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    "": { width: 1920, height: 1080, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
  },
};

/**
 * Banner pixel dimensions per (platform, surface). UNCONFIRMED candidates §6.4.
 * Same structure as STORE_SHOT_RESOLUTION — see its comment for key conventions.
 */
const BANNER_RESOLUTION: Record<Platform, Record<BrandSurface | "", ResolutionEntry>> = {
  mobile: {
    android: { width: 1024, height: 500, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    ios: { width: 4320, height: 2160, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    "": { width: 1024, height: 500, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
  },
  tablet: {
    android: { width: 1024, height: 500, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    ios: { width: 2752, height: 2064, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    "": { width: 1024, height: 500, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
  },
  web: {
    android: { width: 1920, height: 450, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    ios: { width: 1920, height: 450, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    "": { width: 1920, height: 450, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
  },
  desktop: {
    android: { width: 1920, height: 1080, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    ios: { width: 1920, height: 1080, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
    "": { width: 1920, height: 1080, source: "requirement §6.4 (candidate)", verifiedAt: undefined },
  },
};

/**
 * App-icon "largest" dimension for single-surface platforms (web/desktop).
 * Mobile/tablet sizes are handled inline in appIconPlanSize via surface.
 * UNCONFIRMED candidates §6.4.
 */
const APP_ICON_PLAN_SIZE: Record<"web" | "desktop", number> = {
  web: 512, // single-surface largest = 512
  desktop: 1024, // single-surface largest = 1024
};

// For single-surface platforms the surface key is empty string; resolve by platform.
function appIconPlanSize(platform: Platform, surface?: BrandSurface): number {
  // Surface-specific sizes for mobile/tablet
  if (surface === "android") return 512;
  if (surface === "ios") return 1024;
  // Single-surface: web or desktop
  return APP_ICON_PLAN_SIZE[platform as "web" | "desktop"];
}

// ─── App-icon variant tables ──────────────────────────────────────────────────

/**
 * Derived variant names per surface (or "" for no-surface platforms).
 * These match the derivation matrix in Task 3.
 */
const APP_ICON_VARIANTS: Record<BrandSurface | "", string[]> = {
  android: ["android-standard", "android-foreground", "android-background", "android-monochrome"],
  ios: ["ios-standard", "ios-dark", "ios-tinted"],
  // web and desktop are single-surface (no surface field)
  "": ["standard"],
};

/**
 * Base images to generate per surface.
 *   mobile/tablet surfaces (android, ios) → ["a","b","c"]
 *   web/desktop (no surface)              → ["a","b"]
 */
function baseImagesForSurface(surface: BrandSurface | undefined): ("a" | "b" | "c")[] {
  return surface !== undefined ? ["a", "b", "c"] : ["a", "b"];
}

// ─── Resolution table lookup helpers ─────────────────────────────────────────

function storeShotResolution(platform: Platform, surface: BrandSurface | undefined): ResolutionEntry {
  return STORE_SHOT_RESOLUTION[platform][surface ?? ""];
}

function bannerResolution(platform: Platform, surface: BrandSurface | undefined): ResolutionEntry {
  return BANNER_RESOLUTION[platform][surface ?? ""];
}

// ─── Surface iteration helper ─────────────────────────────────────────────────

/**
 * Returns the surfaces to iterate over when building per-surface plan entries.
 * Multi-surface platforms (mobile/tablet) → ["android", "ios"].
 * Single-surface platforms (web/desktop)  → [undefined].
 */
function surfaceList(surfaces: BrandSurface[]): (BrandSurface | undefined)[] {
  return surfaces.length > 0 ? surfaces : [undefined];
}

// ─── Default settings values ──────────────────────────────────────────────────

const DEFAULT_STORE_SHOT_COUNT = 3;
const DEFAULT_BANNER = false;
const DEFAULT_POSTER_PORTRAIT = true;
const DEFAULT_POSTER_LANDSCAPE = true;
const DEFAULT_POSTER_SQUARE = true;

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Returns the desired-state brand asset plan for a product (SPEC-BEHAVIOR-003).
 *
 * Pure function — reads product.platform + product.brand_assets, applies schema
 * defaults when absent. Does NOT read disk. The plan is decoupled from the manifest.
 *
 * Platform handling:
 *   mobile / tablet → surfaces = ["android","ios"] (two entries per kind)
 *   web / desktop   → surfaces = []               (one entry, surface omitted)
 *
 * Poster is always platform-agnostic (no surface field, no brandSurfacesForPlatform).
 */
export function getBrandAssetPlan(product: Product): BrandAssetPlan {
  const platform: Platform = (product.platform as Platform) ?? "mobile";
  const surfaces = brandSurfacesForPlatform(platform);
  const settings = product.brand_assets;

  // Effective settings — apply schema defaults when absent
  const storeShotCount = settings?.store_shot_count ?? DEFAULT_STORE_SHOT_COUNT;
  const bannerEnabled = settings?.banner ?? DEFAULT_BANNER;
  const posterPortrait = settings?.poster_portrait ?? DEFAULT_POSTER_PORTRAIT;
  const posterLandscape = settings?.poster_landscape ?? DEFAULT_POSTER_LANDSCAPE;
  const posterSquare = settings?.poster_square ?? DEFAULT_POSTER_SQUARE;

  const entries: BrandAssetPlanEntry[] = [];

  // ── Store-shot ────────────────────────────────────────────────────────────
  // Multi-surface: one entry per surface (android / ios).
  // Single-surface: one entry with no surface field.
  for (const surface of surfaceList(surfaces)) {
    const res = storeShotResolution(platform, surface);
    const entry: BrandAssetPlanEntry = {
      kind: "store-shot",
      width: res.width,
      height: res.height,
      count: storeShotCount,
      source: res.source,
      verifiedAt: res.verifiedAt,
    };
    if (surface !== undefined) entry.surface = surface;
    entries.push(entry);
  }

  // ── Banner ────────────────────────────────────────────────────────────────
  // Produced only when enabled. Same surface split as store-shot.
  if (bannerEnabled) {
    for (const surface of surfaceList(surfaces)) {
      const res = bannerResolution(platform, surface);
      const entry: BrandAssetPlanEntry = {
        kind: "banner",
        width: res.width,
        height: res.height,
        count: 1,
        source: res.source,
        verifiedAt: res.verifiedAt,
      };
      if (surface !== undefined) entry.surface = surface;
      entries.push(entry);
    }
  }

  // ── Poster ────────────────────────────────────────────────────────────────
  // Platform-agnostic: no surface field, no brandSurfacesForPlatform.
  // One entry per enabled switch; variant = style name.
  if (posterPortrait) {
    const { width, height } = POSTER_SIZES.portrait;
    entries.push({ kind: "poster", variant: "portrait", width, height, count: 1 });
  }
  if (posterLandscape) {
    const { width, height } = POSTER_SIZES.landscape;
    entries.push({ kind: "poster", variant: "landscape", width, height, count: 1 });
  }
  if (posterSquare) {
    const { width, height } = POSTER_SIZES.square;
    entries.push({ kind: "poster", variant: "square", width, height, count: 1 });
  }

  // ── App-icon ──────────────────────────────────────────────────────────────
  // Multi-surface: one entry per surface with surface field.
  // Single-surface: one entry with no surface field, variants = ["standard"].
  for (const surface of surfaceList(surfaces)) {
    const size = appIconPlanSize(platform, surface);
    const entry: BrandAssetPlanEntry = {
      kind: "app-icon",
      width: size,
      height: size,
      count: 1,
      baseImages: baseImagesForSurface(surface),
      variants: APP_ICON_VARIANTS[surface ?? ""],
    };
    if (surface !== undefined) entry.surface = surface;
    entries.push(entry);
  }

  return { productId: product.id, platform, surfaces, entries };
}
