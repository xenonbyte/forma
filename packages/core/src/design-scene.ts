import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parsePenDocument, walkPenNodes, type PenNode } from "./pen-model.js";
import { readRequirementDesignMetadata } from "./requirement-design.js";

export interface RequirementDesignSceneNode {
  id: string;
  type?: string;
  name?: string;
  kind?: string;
  semantic?: Record<string, unknown>;
  unsupported_properties: string[];
}

export interface RequirementDesignScenePage {
  page_id: string;
  frame_id?: string;
  preview: { status: "exported" | "missing"; file?: string };
  nodes: RequirementDesignSceneNode[];
}

export interface RequirementDesignScene {
  schema_version: 1;
  product_id: string;
  requirement_id: string;
  canvas: {
    file: "design.pen";
    version: number;
    revision?: string;
  };
  pages: RequirementDesignScenePage[];
  unsupported_properties: Array<{ node_id: string; property: string }>;
}

export async function getRequirementDesignScene(input: {
  home: string;
  product_id: string;
  requirement_id: string;
}): Promise<RequirementDesignScene> {
  const home = resolve(input.home);
  const metadata = await readRequirementDesignMetadata(home, input.product_id, input.requirement_id);
  const document = parsePenDocument(await readFile(join(home, "data", input.product_id, input.requirement_id, metadata.canvas_file), "utf8"));
  const allUnsupported: Array<{ node_id: string; property: string }> = [];
  const pages = metadata.pages.map((page) => {
    const frame = document.children.find((node) => node.id === page.frame_id);
    const nodes = walkPenNodes(frame ? [frame] : []).map((node) => {
      const unsupported = unsupportedProperties(node);
      allUnsupported.push(...unsupported.map((property) => ({ node_id: node.id, property })));
      return {
        id: node.id,
        ...(node.type ? { type: node.type } : {}),
        ...(node.name ? { name: node.name } : {}),
        ...(typeof node.metadata?.kind === "string" ? { kind: node.metadata.kind } : {}),
        ...(node.metadata ? { semantic: semanticMetadata(node.metadata) } : {}),
        unsupported_properties: unsupported
      };
    });
    return {
      page_id: page.page_id,
      ...(page.frame_id ? { frame_id: page.frame_id } : {}),
      preview: page.preview_file ? { status: "exported" as const, file: page.preview_file } : { status: "missing" as const },
      nodes
    };
  });
  return {
    schema_version: 1,
    product_id: input.product_id,
    requirement_id: input.requirement_id,
    canvas: {
      file: "design.pen",
      version: metadata.canvas_version,
      ...(metadata.canvas_revision ? { revision: metadata.canvas_revision } : {})
    },
    pages,
    unsupported_properties: allUnsupported
  };
}

function unsupportedProperties(node: PenNode): string[] {
  return Object.entries(node)
    .filter(([key, value]) => key.startsWith("absolute") || key === "visibleBounds" || key === "clipBounds" || typeof value === "function")
    .map(([key]) => key)
    .sort();
}

function semanticMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) =>
      ["type", "kind", "page_id", "action_key", "navigation_target", "field_key", "component_key", "copy", "decorative"].includes(key)
    )
  );
}
