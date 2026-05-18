import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DesignContent, selectAnnotationNode } from "./DesignView.js";
import type { AnnotationNode, DesignHistoryPayload } from "../api.js";

const annotations: AnnotationNode[] = [
  { id: "frame", name: "Checkout frame", type: "frame", x: 0, y: 0, width: 400, height: 300 },
  { id: "cta", parent_id: "frame", name: "Pay button", type: "button", x: 40, y: 220, width: 120, height: 44 },
  { id: "summary", parent_id: "frame", name: "Summary panel", type: "panel", x: 220, y: 40, width: 140, height: 120 }
];

const history: DesignHistoryPayload = {
  design_id: "D-12345678",
  product_id: "P-123abc",
  requirement_id: "R-12345678",
  page_id: "checkout",
  current_version: 2,
  versions: [
    {
      version: 1,
      file: "design.v1.pen",
      preview_file: "preview.v1@2x.png",
      created_at: "2026-05-17T01:00:00.000Z",
      current: false,
      image_url: "/api/designs/D-12345678/image/file?version=1"
    },
    {
      version: 2,
      file: "design.pen",
      preview_file: "preview@2x.png",
      created_at: "2026-05-17T02:00:00.000Z",
      current: true,
      image_url: "/api/designs/D-12345678/image/file?version=2"
    }
  ]
};

describe("DesignView selection", () => {
  it("keeps up to two selected nodes and toggles an existing selection", () => {
    expect(selectAnnotationNode([], "frame")).toEqual(["frame"]);
    expect(selectAnnotationNode(["frame"], "cta")).toEqual(["frame", "cta"]);
    expect(selectAnnotationNode(["frame", "cta"], "summary")).toEqual(["cta", "summary"]);
    expect(selectAnnotationNode(["cta", "summary"], "cta")).toEqual(["summary"]);
  });

  it("passes two selected nodes through to the property panel", () => {
    const html = renderToStaticMarkup(
      <DesignContent
        annotations={annotations}
        designId="D-12345678"
        history={history}
        hoveredNode={null}
        onHoverNode={() => undefined}
        onSelectNode={() => undefined}
        onVersionSelectionChange={() => undefined}
        productId="P-123abc"
        requirementId="R-12345678"
        selectedNodeIds={["cta", "summary"]}
        versionSelection={{ fromVersion: 1, toVersion: 2 }}
      />
    );

    expect(html).toContain("Spacing");
    expect(html).toContain("Pay button");
    expect(html).toContain("Summary panel");
    expect(html).toContain("Checkout frame / Pay button");
  });
});
