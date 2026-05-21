export interface PenDocument {
  schema_version?: number;
  children: PenNode[];
  [key: string]: unknown;
}

export interface PenNode {
  id: string;
  type?: string;
  name?: string;
  metadata?: Record<string, unknown>;
  children?: PenNode[];
  [key: string]: unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePenDocument(raw: string): PenDocument {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value) || !Array.isArray(value.children)) {
    throw new Error("Pencil document must contain children[]");
  }
  return {
    ...value,
    children: value.children.filter(isRecord).map(normalizePenNode)
  };
}

export function normalizePenNode(value: Record<string, unknown>): PenNode {
  const id = typeof value.id === "string" && value.id.length > 0 ? value.id : "";
  if (!id) {
    throw new Error("Pencil node id is required");
  }
  return {
    ...value,
    id,
    ...(typeof value.type === "string" ? { type: value.type } : {}),
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
    ...(Array.isArray(value.children) ? { children: value.children.filter(isRecord).map(normalizePenNode) } : {})
  };
}

export function walkPenNodes(nodes: PenNode[]): PenNode[] {
  const visited: PenNode[] = [];
  const queue = [...nodes];
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited.push(node);
    queue.unshift(...(node.children ?? []));
  }
  return visited;
}

export function nodeMetadataString(node: PenNode, key: string): string | undefined {
  const value = node.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function normalizeDesignName(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
