import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getProductComponentLibrary } from "./components.js";
import { parsePenDocument, walkPenNodes, type PenNode } from "./pen-model.js";
import { writeYamlAtomic } from "./yaml.js";

export interface ComponentUsageRecord {
  node_id: string;
  page_id?: string;
  component_key?: string;
  ref_target?: string;
  status: "linked" | "unlinked";
  reason?: "missing_metadata" | "missing_component_key" | "missing_ref_target" | "snapshot_target_missing" | "detached_copy";
}

export interface ComponentUsageIndex {
  schema_version: 1;
  product_id: string;
  requirement_id: string;
  component_library_version?: number;
  usages: ComponentUsageRecord[];
}

export async function indexRequirementComponentUsage(input: {
  home: string;
  product_id: string;
  requirement_id: string;
  write?: boolean;
}): Promise<ComponentUsageIndex> {
  const home = resolve(input.home);
  const canvasPath = join(home, "data", input.product_id, input.requirement_id, "design.pen");
  const document = parsePenDocument(await readFile(canvasPath, "utf8"));
  const index = await indexRequirementComponentUsageDocument({
    home,
    product_id: input.product_id,
    requirement_id: input.requirement_id,
    document
  });
  if (input.write !== false) {
    await writeYamlAtomic(join(home, "data", input.product_id, input.requirement_id, "component-usage.yaml"), index);
  }
  return index;
}

export async function indexRequirementComponentUsageDocument(input: {
  home: string;
  product_id: string;
  requirement_id: string;
  document: ReturnType<typeof parsePenDocument>;
}): Promise<ComponentUsageIndex> {
  const home = resolve(input.home);
  const library = await getProductComponentLibrary(home, input.product_id);
  const componentKeys = new Set(library.status === "complete" ? library.components.map((component) => component.key) : []);
  const usages = walkPenNodes(input.document.children)
    .filter(isComponentUsageCandidate)
    .map((node) => classifyUsage(node, componentKeys, nearestPageId(input.document.children, node.id)));
  const index: ComponentUsageIndex = {
    schema_version: 1,
    product_id: input.product_id,
    requirement_id: input.requirement_id,
    ...(library.current_version ? { component_library_version: library.current_version } : {}),
    usages
  };
  return index;
}

function isComponentUsageCandidate(node: PenNode): boolean {
  return node.metadata?.kind === "component_instance" || node.type === "instance" || node.type === "component_instance";
}

function classifyUsage(node: PenNode, componentKeys: Set<string>, pageId?: string): ComponentUsageRecord {
  if (node.metadata?.type !== "forma") {
    return { node_id: node.id, page_id: pageId, status: "unlinked", reason: "missing_metadata" };
  }
  const componentKey = typeof node.metadata.component_key === "string" ? node.metadata.component_key : undefined;
  const refTarget = typeof node.metadata.ref_target === "string"
    ? node.metadata.ref_target
    : typeof node.ref === "string"
      ? node.ref
      : undefined;
  if (!componentKey) {
    return { node_id: node.id, page_id: pageId, status: "unlinked", reason: "missing_component_key" };
  }
  if (!refTarget) {
    return { node_id: node.id, page_id: pageId, component_key: componentKey, status: "unlinked", reason: "missing_ref_target" };
  }
  if (!componentKeys.has(componentKey)) {
    return { node_id: node.id, page_id: pageId, component_key: componentKey, ref_target: refTarget, status: "unlinked", reason: "snapshot_target_missing" };
  }
  if (!/^Components - Snapshot v\d+\//.test(refTarget)) {
    return { node_id: node.id, page_id: pageId, component_key: componentKey, ref_target: refTarget, status: "unlinked", reason: "detached_copy" };
  }
  return { node_id: node.id, page_id: pageId, component_key: componentKey, ref_target: refTarget, status: "linked" };
}

function nearestPageId(nodes: PenNode[], targetId: string, currentPageId?: string): string | undefined {
  for (const node of nodes) {
    const pageId = typeof node.metadata?.page_id === "string" ? node.metadata.page_id : currentPageId;
    if (node.id === targetId) {
      return pageId;
    }
    const found = nearestPageId(node.children ?? [], targetId, pageId);
    if (found) {
      return found;
    }
  }
  return undefined;
}
