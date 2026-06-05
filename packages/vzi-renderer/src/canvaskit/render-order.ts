import type { IRElement } from "./renderers/types";

function parseOrderNumber(value: string | number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

export function sortCanvasKitElements(elements: IRElement[]): IRElement[] {
  return [...elements].sort((a, b) => {
    const aZ = parseOrderNumber(a.styles.zIndex);
    const bZ = parseOrderNumber(b.styles.zIndex);
    if (aZ !== bZ) {
      return aZ - bZ;
    }
    if (a.bounds.y !== b.bounds.y) {
      return a.bounds.y - b.bounds.y;
    }
    if (a.bounds.x !== b.bounds.x) {
      return a.bounds.x - b.bounds.x;
    }
    return a.id.localeCompare(b.id);
  });
}

export function sortCanvasKitTree(elements: IRElement[]): IRElement[] {
  const sorted = sortCanvasKitElements(elements);
  return sorted.map((element) => ({
    ...element,
    ...(element.children && element.children.length > 0 ? { children: sortCanvasKitTree(element.children) } : {}),
  }));
}
