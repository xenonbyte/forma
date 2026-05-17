export const idKinds = ["product", "requirement", "design"] as const;
export type FormaIdKind = (typeof idKinds)[number];

export const platforms = ["web", "ios", "android", "desktop"] as const;
export type Platform = (typeof platforms)[number];

export const requirementStatuses = ["draft", "ready", "in_progress", "done"] as const;
export type RequirementStatus = (typeof requirementStatuses)[number];

export const designStatuses = ["draft", "in_progress", "done"] as const;
export type DesignStatus = (typeof designStatuses)[number];
