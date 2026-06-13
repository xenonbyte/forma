export const idKinds = ["product", "requirement"] as const;
export type FormaIdKind = (typeof idKinds)[number];

export const platforms = ["mobile", "desktop", "tablet", "web"] as const;
export type Platform = (typeof platforms)[number];

/**
 * Platform surfaces for brand assets (SPEC-BEHAVIOR-002).
 *
 * "android" and "ios" are the two surfaces. An empty surfaces array means the
 * platform has a single surface (omit the `surface` field on the record).
 */
export type BrandSurface = "android" | "ios";

/**
 * Returns the brand surfaces applicable to a platform (SPEC-BEHAVIOR-002).
 *
 *   mobile  → ["android", "ios"]   (native app store surfaces)
 *   tablet  → ["android", "ios"]   (native tablet store surfaces)
 *   web     → []                   (single surface — no surface field)
 *   desktop → []                   (single surface — no surface field)
 *
 * An empty array means single-surface: callers should omit the `surface` field
 * on BrandAssetRecord (do not store a surface for web/desktop assets).
 * Poster is platform-agnostic and does NOT use this function.
 */
export function brandSurfacesForPlatform(platform: Platform): BrandSurface[] {
  switch (platform) {
    case "mobile":
    case "tablet":
      return ["android", "ios"];
    case "web":
    case "desktop":
      return [];
  }
}

export const languages = ["zh-CN", "zh-TW", "en", "ja", "ko", "pt", "fr", "de", "ru"] as const;
export type Language = (typeof languages)[number];

export const requirementStatuses = ["empty", "submitted", "active", "archived"] as const;
export type RequirementStatus = (typeof requirementStatuses)[number];
