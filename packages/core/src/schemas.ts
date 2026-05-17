export const idKinds = ["product", "requirement", "design"] as const;
export type FormaIdKind = (typeof idKinds)[number];

export const platforms = ["mobile", "desktop", "tablet", "web"] as const;
export type Platform = (typeof platforms)[number];

export const requirementStatuses = ["empty", "submitted", "active", "archived"] as const;
export type RequirementStatus = (typeof requirementStatuses)[number];

export const designStatuses = ["pending", "done", "expired"] as const;
export type DesignStatus = (typeof designStatuses)[number];
