import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildNodePath, PropertyPanel } from "./PropertyPanel.js";
import type { AnnotationNode } from "../api.js";

const nodes: AnnotationNode[] = [
  { id: "frame", name: "Checkout frame", type: "frame", x: 0, y: 0, width: 400, height: 300 },
  { id: "group", parent_id: "frame", name: "Payment group", type: "group", x: 20, y: 20, width: 240, height: 160 },
  { id: "cta", parent_id: "group", name: "Pay button", type: "button", x: 40, y: 80, width: 120, height: 44 }
];

describe("PropertyPanel", () => {
  it("builds a node path from parent annotations", () => {
    expect(buildNodePath(nodes[2], nodes)).toBe("Checkout frame / Payment group / Pay button");
  });

  it("renders copyable path and two-node spacing values", () => {
    const html = renderToStaticMarkup(
      <PropertyPanel
        designId="D-12345678"
        nodes={nodes}
        selectedNodes={[nodes[2], nodes[1]]}
        spacing={{
          fromCenter: { x: 100, y: 102 },
          fromId: "cta",
          toCenter: { x: 170, y: 120 },
          toId: "group",
          horizontal: { mode: "center-delta", value: 70 },
          vertical: { mode: "center-delta", value: 18 }
        }}
      />
    );

    expect(html).toContain("Path");
    expect(html).toContain("Checkout frame / Payment group / Pay button");
    expect(html).toContain("Copy Path");
    expect(html).toContain("Spacing");
    expect(html).toContain("Horizontal");
    expect(html).toContain("70px center delta");
    expect(html).toContain("Vertical");
    expect(html).toContain("18px center delta");
    expect(html).toContain("/api/designs/D-12345678/export?node_id=cta&amp;format=png");
  });
});
