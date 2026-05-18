import { describe, expect, it } from "vitest";

import { countFeatures, layoutNavigationGraph } from "./force-layout.js";

describe("countFeatures", () => {
  it("counts no features for empty or whitespace-only text", () => {
    expect(countFeatures("")).toBe(0);
    expect(countFeatures("  \n\t\n ")).toBe(0);
  });

  it("counts non-empty lines and bullet items", () => {
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

    expect(result.width).toBe(960);
    expect(result.height).toBe(560);
    expect(result.nodes[1]?.radius).toBeGreaterThan(result.nodes[0]?.radius ?? 0);

    for (const node of result.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(node.radius);
      expect(node.x).toBeLessThanOrEqual(result.width - node.radius);
      expect(node.y).toBeGreaterThanOrEqual(node.radius);
      expect(node.y).toBeLessThanOrEqual(result.height - node.radius);
    }
  });

  it("returns an empty fixed-size graph for empty input", () => {
    expect(layoutNavigationGraph({ nodes: [], edges: [] })).toEqual({
      width: 960,
      height: 560,
      nodes: [],
      edges: [],
    });
  });
});
