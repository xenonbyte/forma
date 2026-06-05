import { randomBytes } from "node:crypto";
import type { FormaIdKind } from "./schemas.js";

export type IdKind = FormaIdKind;

const idSpecs = {
  product: { prefix: "P", hexLength: 6 },
  requirement: { prefix: "R", hexLength: 8 },
} as const satisfies Record<FormaIdKind, { prefix: string; hexLength: number }>;

export function createId(kind: FormaIdKind): string {
  const spec = idSpecs[kind];
  return `${spec.prefix}-${randomBytes(spec.hexLength / 2).toString("hex")}`;
}
