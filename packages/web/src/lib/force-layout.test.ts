import { describe, expect, it } from "vitest";

import { countFeatures, layoutNavigationGraph } from "./force-layout.js";

describe("countFeatures", () => {
  it("counts no features for empty or whitespace-only text", () => {
    expect(countFeatures("")).toBe(0);
    expect(countFeatures("  \n\t\n ")).toBe(0);
  });

  it("counts plus-separated feature items as the primary format", () => {
    expect(countFeatures("Search products + Filter results + Export report")).toBe(3);
    expect(countFeatures(" + Search products +  + Export report + ")).toBe(2);
  });

  it("counts non-empty lines and bullet items for compatibility", () => {
    expect(countFeatures("Search\nFilters\nExport")).toBe(3);
    expect(countFeatures("- Search\n- Filters\n- Export")).toBe(3);
  });
});

describe("layoutNavigationGraph", () => {
  it("returns identical layout results for identical input", () => {
    const input = {
      nodes: [
        { id: "home", label: "Home", featureCount: 2 },
        { id: "settings", label: "Settings", featureCount: 6 },
        { id: "billing", label: "Billing", featureCount: 4 },
      ],
      edges: [
        { from: "home", to: "settings", label: "configure" },
        { from: "settings", to: "billing", label: "upgrade" },
      ],
    };

    expect(layoutNavigationGraph(input)).toEqual(layoutNavigationGraph(input));
  });

  it("preserves node order from the input", () => {
    const input = {
      nodes: [
        { id: "settings", label: "Settings" },
        { id: "home", label: "Home" },
        { id: "billing", label: "Billing" },
      ],
      edges: [
        { from: "home", to: "billing", label: "upgrade" },
        { from: "settings", to: "home", label: "back" },
      ],
    };

    expect(layoutNavigationGraph(input).nodes.map((node) => node.id)).toEqual(["settings", "home", "billing"]);
  });

  it("filters invalid edges while preserving valid edge order", () => {
    const result = layoutNavigationGraph({
      nodes: [
        { id: "home", label: "Home" },
        { id: "settings", label: "Settings" },
        { id: "billing", label: "Billing" },
      ],
      edges: [
        { from: "missing", to: "home", label: "invalid source" },
        { from: "home", to: "settings", label: "first" },
        { from: "settings", to: "missing", label: "invalid target" },
        { from: "billing", to: "billing", label: "self" },
        { from: "settings", to: "billing", label: "second" },
      ],
    });

    expect(result.edges.map((edge) => edge.label)).toEqual(["first", "self", "second"]);
    expect(result.edges[1]?.source).toBe(result.nodes[2]);
    expect(result.edges[1]?.target).toBe(result.nodes[2]);
  });

  it("keeps positions within bounds and grows radius with feature count", () => {
    const result = layoutNavigationGraph({
      nodes: [
        { id: "small", label: "Small", featureCount: 0 },
        { id: "large", label: "Large", featureCount: 12 },
        { id: "medium", label: "Medium", featureCount: 4 },
      ],
      edges: [{ from: "small", to: "large", label: "open" }],
    });

    expect(result.width).toBe(600);
    expect(result.height).toBe(400);
    expect(result.nodes[1]?.radius).toBeGreaterThan(result.nodes[0]?.radius ?? 0);

    for (const node of result.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(node.radius);
      expect(node.x).toBeLessThanOrEqual(result.width - node.radius);
      expect(node.y).toBeGreaterThanOrEqual(node.radius);
      expect(node.y).toBeLessThanOrEqual(result.height - node.radius);
    }
  });

  it("bounds node radius between 24 and 44 from feature count", () => {
    const result = layoutNavigationGraph({
      nodes: [
        { id: "none", label: "No features", featureCount: 0 },
        { id: "many", label: "Many features", featureCount: 100 },
      ],
      edges: [],
    });

    expect(result.nodes[0]?.radius).toBeGreaterThanOrEqual(24);
    expect(result.nodes[0]?.radius).toBe(24);
    expect(result.nodes[1]?.radius).toBeLessThanOrEqual(44);
    expect(result.nodes[1]?.radius).toBe(44);
  });

  it("returns an empty fixed-size graph for empty input", () => {
    expect(layoutNavigationGraph({ nodes: [], edges: [] })).toEqual({
      width: 600,
      height: 400,
      nodes: [],
      edges: [],
    });
  });

  it("grows graph size every five nodes up to the maximum", () => {
    expect(layoutNavigationGraph({ nodes: createNodes(5), edges: [] })).toMatchObject({
      width: 600,
      height: 400,
    });
    expect(layoutNavigationGraph({ nodes: createNodes(6), edges: [] })).toMatchObject({
      width: 800,
      height: 600,
    });
    expect(layoutNavigationGraph({ nodes: createNodes(30), edges: [] })).toMatchObject({
      width: 1600,
      height: 1200,
    });
  });
});

function createNodes(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `page-${index}`,
    label: `Page ${index}`,
  }));
}
