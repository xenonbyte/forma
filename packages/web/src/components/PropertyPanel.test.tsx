import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildSceneNodePath, calculateSceneNodeSpacing, PropertyPanel } from "./PropertyPanel.js";
import type { RequirementDesignSceneNode } from "../api.js";

const nodes: RequirementDesignSceneNode[] = [
  { id: "frame", name: "Checkout frame", type: "frame", x: 0, y: 0, width: 400, height: 300, unsupported_properties: [] },
  { id: "group", name: "Payment group", parent_id: "frame", type: "group", x: 20, y: 20, width: 300, height: 200, unsupported_properties: [] },
  {
    id: "cta",
    component_key: "button.primary",
    fill: "#111827",
    height: 44,
    name: "Pay button",
    parent_id: "group",
    stroke: "#d97706",
    text: "Pay now",
    type: "text",
    unsupported_properties: ["shadow"],
    width: 120,
    x: 40,
    y: 80
  }
];

describe("PropertyPanel", () => {
  it("builds a Pencil node path from scene parent ids", () => {
    expect(buildSceneNodePath(nodes[2], nodes)).toBe("Checkout frame / Payment group / Pay button");
  });

  it("calculates readable two-node spacing from scene coordinates", () => {
    expect(calculateSceneNodeSpacing(nodes[2], nodes[1])).toMatchObject({
      horizontal: { mode: "center-delta", value: 70 },
      vertical: { mode: "center-delta", value: 18 }
    });
  });

  it("renders structured node properties and requirement-level export links", () => {
    const html = renderToStaticMarkup(
      <PropertyPanel
        nodes={nodes}
        productId="P-123abc"
        requirementId="R-12345678"
        selectedNodeIds={["cta", "group"]}
      />
    );

    expect(html).toContain("Pencil path");
    expect(html).toContain("Checkout frame / Payment group / Pay button");
    expect(html).toContain("node_id");
    expect(html).toContain("cta");
    expect(html).toContain("Geometry");
    expect(html).toContain("40, 80 / 120 x 44");
    expect(html).toContain("Pay now");
    expect(html).toContain("#111827");
    expect(html).toContain("button.primary");
    expect(html).toContain("shadow");
    expect(html).toContain("Horizontal");
    expect(html).toContain("70px center delta");
    expect(html).toContain("/api/products/P-123abc/requirements/R-12345678/design/export?node_id=cta&amp;format=png");
  });
});
