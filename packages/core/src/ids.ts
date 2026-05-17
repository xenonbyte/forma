import { randomBytes } from "node:crypto";

export type IdKind = "product" | "requirement" | "design";

const idSpecs = {
  product: { prefix: "P", hexLength: 6 },
  requirement: { prefix: "R", hexLength: 8 },
  design: { prefix: "D", hexLength: 8 }
} as const satisfies Record<IdKind, { prefix: string; hexLength: number }>;

export function createId(kind: IdKind): string {
  const spec = idSpecs[kind];
  return `${spec.prefix}-${randomBytes(spec.hexLength / 2).toString("hex")}`;
}
