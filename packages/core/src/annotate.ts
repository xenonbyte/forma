import { readFile } from "node:fs/promises";

export interface AnnotationNode {
  id: string;
  parent_id?: string;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  fontSize?: number;
  fontFamily?: string;
  content?: string;
}

type PenRecord = Record<string, unknown>;

export async function getPenAnnotations(penPath: string): Promise<AnnotationNode[]> {
  return flattenPen(JSON.parse(await readFile(penPath, "utf8")));
}

export function flattenPen(pen: unknown): AnnotationNode[] {
  if (!isRecord(pen)) {
    return [];
  }

  const variables = isRecord(pen.variables) ? pen.variables : {};
  const roots = Array.isArray(pen.children) ? pen.children : [];
  return roots.flatMap((child) => flattenNode(child, undefined, 0, 0, variables));
}

function flattenNode(node: unknown, parentId: string | undefined, parentX: number, parentY: number, variables: PenRecord): AnnotationNode[] {
  if (!isRecord(node) || typeof node.id !== "string" || typeof node.type !== "string") {
    return [];
  }

  const x = parentX + numberValue(node.x);
  const y = parentY + numberValue(node.y);
  const annotation: AnnotationNode = {
    id: node.id,
    name: typeof node.name === "string" ? node.name : node.id,
    type: node.type,
    x,
    y,
    width: numberValue(node.width),
    height: numberValue(node.height)
  };

  if (parentId) {
    annotation.parent_id = parentId;
  }
  copyString(node, annotation, "fill", variables);
  copyString(node, annotation, "stroke", variables);
  copyNumber(node, annotation, "fontSize");
  copyString(node, annotation, "fontFamily", variables);
  copyString(node, annotation, "content", variables);

  const childValues = [
    ...(Array.isArray(node.children) ? node.children : []),
    ...(Array.isArray(node.layers) ? node.layers : [])
  ];
  return [annotation, ...childValues.flatMap((child) => flattenNode(child, annotation.id, x, y, variables))];
}

function copyString(source: PenRecord, target: AnnotationNode, key: "fill" | "stroke" | "fontFamily" | "content", variables: PenRecord): void {
  const value = source[key];
  if (typeof value === "string") {
    target[key] = resolveVariable(value, variables);
  }
}

function copyNumber(source: PenRecord, target: AnnotationNode, key: "fontSize"): void {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    target[key] = value;
  }
}

function resolveVariable(value: string, variables: PenRecord): string {
  if (!value.startsWith("$")) {
    return value;
  }

  const variable = variables[value.slice(1)];
  return typeof variable === "string" ? variable : value;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is PenRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
