import type { AnnotationNode } from "./annotate.js";

export interface DesignDiff {
  added: AnnotationNode[];
  removed: AnnotationNode[];
  modified: Array<{ before: AnnotationNode; after: AnnotationNode; id: string }>;
}

export function diffAnnotations(before: AnnotationNode[], after: AnnotationNode[]): DesignDiff {
  const beforeById = new Map(before.map((node) => [node.id, node]));
  const afterById = new Map(after.map((node) => [node.id, node]));

  const added = after.filter((node) => !beforeById.has(node.id));
  const removed = before.filter((node) => !afterById.has(node.id));
  const modified = after.flatMap((node) => {
    const previous = beforeById.get(node.id);
    if (!previous || stableStringify(previous) === stableStringify(node)) {
      return [];
    }
    return [{ id: node.id, before: previous, after: node }];
  });

  return { added, removed, modified };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortValue(nested)])
  );
}
