export const idKinds = ["product", "requirement"] as const;
export type FormaIdKind = (typeof idKinds)[number];

export const platforms = ["mobile", "desktop", "tablet", "web"] as const;
export type Platform = (typeof platforms)[number];

export const languages = ["zh-CN", "zh-TW", "en", "ja", "ko", "pt", "fr", "de", "ru"] as const;
export type Language = (typeof languages)[number];

export const requirementStatuses = ["empty", "submitted", "active", "archived"] as const;
export type RequirementStatus = (typeof requirementStatuses)[number];
