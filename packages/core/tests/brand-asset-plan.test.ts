/**
 * brand-asset-plan.test.ts — TM-03 (Task 2)
 *
 * Tests for getBrandAssetPlan (SPEC-BEHAVIOR-003) and resolution tables (SPEC-DATA-004).
 *
 * Assertion scope:
 *   - Entry counts, surface-sets, count field, variant names, baseImages, aspect direction.
 *   - Poster pixel values ARE asserted (controlled constants).
 *   - Desktop icon size set + Android foreground safe area ARE asserted (DECISION-001).
 *   - Store-shot / banner / app-icon platform pixel values are NOT asserted (UNCONFIRMED).
 */

import { describe, expect, it } from "vitest";
import {
  getBrandAssetPlan,
  POSTER_SIZES,
  DESKTOP_ICON_SIZES,
  ANDROID_FOREGROUND_SAFE_AREA,
  type BrandAssetPlan,
  type BrandAssetPlanEntry,
} from "../src/brand-asset-plan.js";
import type { Product } from "../src/product.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Build a minimal valid Product stub. brand_assets defaults to undefined (schema defaults apply). */
function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "P-aabbcc",
    name: "Test Product",
    description: "",
    platform: "mobile",
    ...overrides,
  } as Product;
}

function entriesOfKind(plan: BrandAssetPlan, kind: string): BrandAssetPlanEntry[] {
  return plan.entries.filter((e) => e.kind === kind);
}

/** Find an entry by kind + predicate; throws if not found (avoids non-null assertion). */
function findEntry(
  plan: BrandAssetPlan,
  kind: string,
  predicate: (e: BrandAssetPlanEntry) => boolean,
): BrandAssetPlanEntry {
  const entry = plan.entries.find((e) => e.kind === kind && predicate(e));
  if (!entry) throw new Error(`No ${kind} entry matching predicate`);
  return entry;
}

// ─── Assertable constants ─────────────────────────────────────────────────────

describe("POSTER_SIZES — controlled constants", () => {
  it("portrait = 1080×1920", () => {
    expect(POSTER_SIZES.portrait).toEqual({ width: 1080, height: 1920 });
  });
  it("landscape = 1920×1080", () => {
    expect(POSTER_SIZES.landscape).toEqual({ width: 1920, height: 1080 });
  });
  it("square = 1080×1080", () => {
    expect(POSTER_SIZES.square).toEqual({ width: 1080, height: 1080 });
  });
});

describe("DESKTOP_ICON_SIZES — DECISION-001 assertable", () => {
  it("contains exactly {1024,512,256,128,64,32,16}", () => {
    expect([...DESKTOP_ICON_SIZES].sort((a, b) => b - a)).toEqual([1024, 512, 256, 128, 64, 32, 16]);
  });
  it("does NOT include 358 (source-doc typo)", () => {
    expect(DESKTOP_ICON_SIZES).not.toContain(358);
  });
});

describe("ANDROID_FOREGROUND_SAFE_AREA — DECISION-001 assertable", () => {
  it("equals 666 (not 66 — source typo)", () => {
    expect(ANDROID_FOREGROUND_SAFE_AREA).toBe(666);
  });
});

// ─── Default settings path ────────────────────────────────────────────────────

describe("getBrandAssetPlan — default settings (no brand_assets)", () => {
  it("mobile: store_shot_count defaults to 3", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    const shots = entriesOfKind(plan, "store-shot");
    expect(shots.every((e) => e.count === 3)).toBe(true);
  });

  it("mobile: banner defaults to off → 0 banner entries", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    expect(entriesOfKind(plan, "banner")).toHaveLength(0);
  });

  it("mobile: all 3 poster variants on by default", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    const posters = entriesOfKind(plan, "poster");
    const variants = posters.map((e) => e.variant).sort();
    expect(variants).toEqual(["landscape", "portrait", "square"]);
  });
});

// ─── Store-shot: surface split per platform ───────────────────────────────────

describe("getBrandAssetPlan — store-shot surface split", () => {
  it("mobile: 2 store-shot entries (android + ios)", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    const shots = entriesOfKind(plan, "store-shot");
    expect(shots).toHaveLength(2);
    const surfaces = shots.map((e) => e.surface).sort();
    expect(surfaces).toEqual(["android", "ios"]);
  });

  it("tablet: 2 store-shot entries (android + ios)", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "tablet" }));
    const shots = entriesOfKind(plan, "store-shot");
    expect(shots).toHaveLength(2);
    const surfaces = shots.map((e) => e.surface).sort();
    expect(surfaces).toEqual(["android", "ios"]);
  });

  it("web: 1 store-shot entry with NO surface field", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "web" }));
    const shots = entriesOfKind(plan, "store-shot");
    expect(shots).toHaveLength(1);
    expect(shots[0].surface).toBeUndefined();
  });

  it("desktop: 1 store-shot entry with NO surface field", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "desktop" }));
    const shots = entriesOfKind(plan, "store-shot");
    expect(shots).toHaveLength(1);
    expect(shots[0].surface).toBeUndefined();
  });

  it("store-shot count matches brand_assets.store_shot_count", () => {
    const plan = getBrandAssetPlan(
      makeProduct({
        platform: "mobile",
        brand_assets: {
          store_shot_count: 6,
          banner: false,
          poster_portrait: true,
          poster_landscape: true,
          poster_square: true,
        },
      }),
    );
    const shots = entriesOfKind(plan, "store-shot");
    expect(shots.every((e) => e.count === 6)).toBe(true);
  });
});

// ─── Banner ───────────────────────────────────────────────────────────────────

describe("getBrandAssetPlan — banner", () => {
  function withBanner(platform: Product["platform"]) {
    return makeProduct({
      platform,
      brand_assets: {
        store_shot_count: 3,
        banner: true,
        poster_portrait: true,
        poster_landscape: true,
        poster_square: true,
      },
    });
  }

  it("mobile: banner on → 2 banner entries (android + ios)", () => {
    const plan = getBrandAssetPlan(withBanner("mobile"));
    const banners = entriesOfKind(plan, "banner");
    expect(banners).toHaveLength(2);
    const surfaces = banners.map((e) => e.surface).sort();
    expect(surfaces).toEqual(["android", "ios"]);
  });

  it("tablet: banner on → 2 banner entries (android + ios)", () => {
    const plan = getBrandAssetPlan(withBanner("tablet"));
    const banners = entriesOfKind(plan, "banner");
    expect(banners).toHaveLength(2);
    const surfaces = banners.map((e) => e.surface).sort();
    expect(surfaces).toEqual(["android", "ios"]);
  });

  it("web: banner on → 1 banner entry with NO surface", () => {
    const plan = getBrandAssetPlan(withBanner("web"));
    const banners = entriesOfKind(plan, "banner");
    expect(banners).toHaveLength(1);
    expect(banners[0].surface).toBeUndefined();
  });

  it("desktop: banner on → 1 banner entry with NO surface", () => {
    const plan = getBrandAssetPlan(withBanner("desktop"));
    const banners = entriesOfKind(plan, "banner");
    expect(banners).toHaveLength(1);
    expect(banners[0].surface).toBeUndefined();
  });

  it("mobile: banner off → 0 banner entries", () => {
    const plan = getBrandAssetPlan(
      makeProduct({
        platform: "mobile",
        brand_assets: {
          store_shot_count: 3,
          banner: false,
          poster_portrait: true,
          poster_landscape: true,
          poster_square: true,
        },
      }),
    );
    expect(entriesOfKind(plan, "banner")).toHaveLength(0);
  });

  it("banner entries have count=1", () => {
    const plan = getBrandAssetPlan(withBanner("mobile"));
    const banners = entriesOfKind(plan, "banner");
    expect(banners.every((e) => e.count === 1)).toBe(true);
  });
});

// ─── Poster ───────────────────────────────────────────────────────────────────

describe("getBrandAssetPlan — poster", () => {
  it("all 3 switches on → 3 poster entries", () => {
    const plan = getBrandAssetPlan(
      makeProduct({
        platform: "mobile",
        brand_assets: {
          store_shot_count: 3,
          banner: false,
          poster_portrait: true,
          poster_landscape: true,
          poster_square: true,
        },
      }),
    );
    expect(entriesOfKind(plan, "poster")).toHaveLength(3);
  });

  it("only portrait on → 1 poster entry with variant='portrait'", () => {
    const plan = getBrandAssetPlan(
      makeProduct({
        platform: "mobile",
        brand_assets: {
          store_shot_count: 3,
          banner: false,
          poster_portrait: true,
          poster_landscape: false,
          poster_square: false,
        },
      }),
    );
    const posters = entriesOfKind(plan, "poster");
    expect(posters).toHaveLength(1);
    expect(posters[0].variant).toBe("portrait");
  });

  it("only landscape on → 1 poster entry with variant='landscape'", () => {
    const plan = getBrandAssetPlan(
      makeProduct({
        platform: "mobile",
        brand_assets: {
          store_shot_count: 3,
          banner: false,
          poster_portrait: false,
          poster_landscape: true,
          poster_square: false,
        },
      }),
    );
    const posters = entriesOfKind(plan, "poster");
    expect(posters).toHaveLength(1);
    expect(posters[0].variant).toBe("landscape");
  });

  it("only square on → 1 poster entry with variant='square'", () => {
    const plan = getBrandAssetPlan(
      makeProduct({
        platform: "mobile",
        brand_assets: {
          store_shot_count: 3,
          banner: false,
          poster_portrait: false,
          poster_landscape: false,
          poster_square: true,
        },
      }),
    );
    const posters = entriesOfKind(plan, "poster");
    expect(posters).toHaveLength(1);
    expect(posters[0].variant).toBe("square");
  });

  it("all switches off → 0 poster entries", () => {
    const plan = getBrandAssetPlan(
      makeProduct({
        platform: "mobile",
        brand_assets: {
          store_shot_count: 3,
          banner: false,
          poster_portrait: false,
          poster_landscape: false,
          poster_square: false,
        },
      }),
    );
    expect(entriesOfKind(plan, "poster")).toHaveLength(0);
  });

  it("poster has NO surface field (platform-agnostic)", () => {
    for (const platform of ["mobile", "tablet", "web", "desktop"] as const) {
      const plan = getBrandAssetPlan(makeProduct({ platform }));
      const posters = entriesOfKind(plan, "poster");
      expect(posters.every((e) => e.surface === undefined)).toBe(true);
    }
  });

  it("poster count is always 1 per entry", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    const posters = entriesOfKind(plan, "poster");
    expect(posters.every((e) => e.count === 1)).toBe(true);
  });

  // ── Assertable poster pixel values ──
  it("portrait poster: 1080×1920 (taller than wide)", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    const portrait = findEntry(plan, "poster", (e) => e.variant === "portrait");
    expect(portrait.width).toBe(1080);
    expect(portrait.height).toBe(1920);
    expect(portrait.height).toBeGreaterThan(portrait.width); // portrait aspect
  });

  it("landscape poster: 1920×1080 (wider than tall)", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    const landscape = findEntry(plan, "poster", (e) => e.variant === "landscape");
    expect(landscape.width).toBe(1920);
    expect(landscape.height).toBe(1080);
    expect(landscape.width).toBeGreaterThan(landscape.height); // landscape aspect
  });

  it("square poster: 1080×1080", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    const square = findEntry(plan, "poster", (e) => e.variant === "square");
    expect(square.width).toBe(1080);
    expect(square.height).toBe(1080);
    expect(square.width).toBe(square.height); // square aspect
  });

  it("poster platform-agnosticism: same poster sizes across all platforms", () => {
    const plans = (["mobile", "tablet", "web", "desktop"] as const).map((p) =>
      getBrandAssetPlan(makeProduct({ platform: p })),
    );
    // All should produce the same poster variant set with the same dimensions
    for (const plan of plans) {
      const portrait = entriesOfKind(plan, "poster").find((e) => e.variant === "portrait");
      const landscape = entriesOfKind(plan, "poster").find((e) => e.variant === "landscape");
      const square = entriesOfKind(plan, "poster").find((e) => e.variant === "square");
      if (portrait) {
        expect(portrait.width).toBe(1080);
        expect(portrait.height).toBe(1920);
      }
      if (landscape) {
        expect(landscape.width).toBe(1920);
        expect(landscape.height).toBe(1080);
      }
      if (square) {
        expect(square.width).toBe(1080);
        expect(square.height).toBe(1080);
      }
    }
  });
});

// ─── App-icon ─────────────────────────────────────────────────────────────────

describe("getBrandAssetPlan — app-icon", () => {
  it("mobile: 2 app-icon entries (android + ios surfaces)", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    const icons = entriesOfKind(plan, "app-icon");
    expect(icons).toHaveLength(2);
    const surfaces = icons.map((e) => e.surface).sort();
    expect(surfaces).toEqual(["android", "ios"]);
  });

  it("tablet: 2 app-icon entries (android + ios surfaces)", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "tablet" }));
    const icons = entriesOfKind(plan, "app-icon");
    expect(icons).toHaveLength(2);
    const surfaces = icons.map((e) => e.surface).sort();
    expect(surfaces).toEqual(["android", "ios"]);
  });

  it("web: 1 app-icon entry with NO surface field", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "web" }));
    const icons = entriesOfKind(plan, "app-icon");
    expect(icons).toHaveLength(1);
    expect(icons[0].surface).toBeUndefined();
  });

  it("desktop: 1 app-icon entry with NO surface field", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "desktop" }));
    const icons = entriesOfKind(plan, "app-icon");
    expect(icons).toHaveLength(1);
    expect(icons[0].surface).toBeUndefined();
  });

  it("app-icon count is always 1", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    const icons = entriesOfKind(plan, "app-icon");
    expect(icons.every((e) => e.count === 1)).toBe(true);
  });

  // baseImages
  it("mobile android surface: baseImages = ['a','b','c']", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    const android = findEntry(plan, "app-icon", (e) => e.surface === "android");
    expect(android.baseImages).toEqual(["a", "b", "c"]);
  });

  it("mobile ios surface: baseImages = ['a','b','c']", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    const ios = findEntry(plan, "app-icon", (e) => e.surface === "ios");
    expect(ios.baseImages).toEqual(["a", "b", "c"]);
  });

  it("tablet surfaces: baseImages = ['a','b','c']", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "tablet" }));
    const icons = entriesOfKind(plan, "app-icon");
    expect(icons.every((e) => JSON.stringify(e.baseImages) === JSON.stringify(["a", "b", "c"]))).toBe(true);
  });

  it("web: baseImages = ['a','b'] (no surface → 2 base images)", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "web" }));
    const icon = entriesOfKind(plan, "app-icon")[0];
    expect(icon.baseImages).toEqual(["a", "b"]);
  });

  it("desktop: baseImages = ['a','b']", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "desktop" }));
    const icon = entriesOfKind(plan, "app-icon")[0];
    expect(icon.baseImages).toEqual(["a", "b"]);
  });

  // variants
  it("android surface: variants contain android-specific names", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    const android = findEntry(plan, "app-icon", (e) => e.surface === "android");
    expect(android.variants).toEqual([
      "android-standard",
      "android-foreground",
      "android-background",
      "android-monochrome",
    ]);
  });

  it("ios surface: variants contain ios-specific names", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    const ios = findEntry(plan, "app-icon", (e) => e.surface === "ios");
    expect(ios.variants).toEqual(["ios-standard", "ios-dark", "ios-tinted"]);
  });

  it("web: variants = ['standard']", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "web" }));
    const icon = entriesOfKind(plan, "app-icon")[0];
    expect(icon.variants).toEqual(["standard"]);
  });

  it("desktop: variants = ['standard']", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "desktop" }));
    const icon = entriesOfKind(plan, "app-icon")[0];
    expect(icon.variants).toEqual(["standard"]);
  });
});

// ─── Plan-level fields ────────────────────────────────────────────────────────

describe("getBrandAssetPlan — plan-level fields", () => {
  it("productId matches product.id", () => {
    const product = makeProduct({ id: "P-123abc", platform: "mobile" });
    const plan = getBrandAssetPlan(product);
    expect(plan.productId).toBe("P-123abc");
  });

  it("mobile: surfaces = ['android','ios']", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    expect([...plan.surfaces].sort()).toEqual(["android", "ios"]);
  });

  it("tablet: surfaces = ['android','ios']", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "tablet" }));
    expect([...plan.surfaces].sort()).toEqual(["android", "ios"]);
  });

  it("web: surfaces = []", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "web" }));
    expect(plan.surfaces).toEqual([]);
  });

  it("desktop: surfaces = []", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "desktop" }));
    expect(plan.surfaces).toEqual([]);
  });

  it("platform matches product.platform", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "tablet" }));
    expect(plan.platform).toBe("tablet");
  });
});

// ─── UNCONFIRMED platform values — only structure/direction is asserted ───────

describe("getBrandAssetPlan — store-shot (structure only, NOT pixel values)", () => {
  it("all entries have positive width and height", () => {
    for (const platform of ["mobile", "tablet", "web", "desktop"] as const) {
      const plan = getBrandAssetPlan(makeProduct({ platform }));
      const shots = entriesOfKind(plan, "store-shot");
      expect(shots.every((e) => e.width > 0 && e.height > 0)).toBe(true);
    }
  });

  it("mobile ios store-shot is portrait (height > width) — candidate direction", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    const ios = findEntry(plan, "store-shot", (e) => e.surface === "ios");
    expect(ios.height).toBeGreaterThan(ios.width);
  });

  it("mobile android store-shot is portrait (height > width) — candidate direction", () => {
    const plan = getBrandAssetPlan(makeProduct({ platform: "mobile" }));
    const android = findEntry(plan, "store-shot", (e) => e.surface === "android");
    expect(android.height).toBeGreaterThan(android.width);
  });
});
