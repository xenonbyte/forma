import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AnnotationCanvas, calculateNodeSpacing, mountAnnotationCanvasScene, type LeaferRuntime } from "./AnnotationCanvas.js";
import type { AnnotationNode } from "../api.js";

const leaferInstances: MockLeafer[] = [];
const rectInstances: MockRect[] = [];

class MockLeafer {
  add = vi.fn();
  destroy = vi.fn();
  lockLayout = vi.fn();
  requestRender = vi.fn();
  unlockLayout = vi.fn();

  constructor(public readonly config: Record<string, unknown>) {
    leaferInstances.push(this);
  }
}

class MockRect {
  handlers: Record<string, () => void> = {};
  on = vi.fn((eventName: string, handler: () => void) => {
    this.handlers[eventName] = handler;
    return this;
  });

  constructor(public readonly config: Record<string, unknown>) {
    rectInstances.push(this);
  }
}

const runtime = {
  Leafer: MockLeafer,
  PointerEvent: { CLICK: "click", ENTER: "pointer.enter", LEAVE: "pointer.leave" },
  Rect: MockRect
} satisfies LeaferRuntime;

const nodes: AnnotationNode[] = [
  { id: "frame", name: "Checkout frame", type: "frame", x: 0, y: 0, width: 400, height: 300 },
  { id: "cta", parent_id: "frame", name: "Pay button", type: "button", x: 24, y: 220, width: 120, height: 44, fill: "#f59e0b" }
];

describe("AnnotationCanvas", () => {
  it("mounts a Leafer scene with hit targets, events, and cleanup", () => {
    leaferInstances.length = 0;
    rectInstances.length = 0;
    const hovered: Array<string | null> = [];
    const selected: string[] = [];
    const container = {} as HTMLElement;

    const scene = mountAnnotationCanvasScene(
      {
        container,
        imageUrl: "/api/designs/D-123/image/file?version=2",
        nodes,
        onHoverNode: (node) => hovered.push(node?.id ?? null),
        onSelectNode: (node) => selected.push(node.id),
        selectedNodeIds: ["frame", "cta"],
        size: { width: 400, height: 300 },
        spacing: calculateNodeSpacing(nodes[0], nodes[1])
      },
      runtime
    );

    expect(leaferInstances).toHaveLength(1);
    expect(leaferInstances[0]?.config).toMatchObject({
      view: container,
      width: 400,
      height: 300,
      wheel: { zoomMode: "mouse", moveSpeed: 0.5, zoomSpeed: 0.5 }
    });
    expect(leaferInstances[0]?.lockLayout).toHaveBeenCalled();
    expect(leaferInstances[0]?.unlockLayout).toHaveBeenCalled();
    expect(leaferInstances[0]?.add).toHaveBeenCalledTimes(5);
    expect(rectInstances.map((rect) => rect.config)).toEqual([
      expect.objectContaining({
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        fill: { type: "image", url: "/api/designs/D-123/image/file?version=2", mode: "fit" },
        hittable: false,
        name: "preview-image"
      }),
      expect.objectContaining({ x: 0, y: 0, width: 400, height: 300, data: { nodeId: "frame" } }),
      expect.objectContaining({ x: 24, y: 220, width: 120, height: 44, data: { nodeId: "cta" }, stroke: "#d97706" }),
      expect.objectContaining({ name: "spacing-horizontal", hittable: false }),
      expect.objectContaining({ name: "spacing-vertical", hittable: false })
    ]);

    const selectedRect = rectInstances[2];
    expect(selectedRect?.on).toHaveBeenCalledWith("pointer.enter", expect.any(Function));
    expect(selectedRect?.on).toHaveBeenCalledWith("pointer.leave", expect.any(Function));
    expect(selectedRect?.on).toHaveBeenCalledWith("click", expect.any(Function));

    selectedRect?.handlers["pointer.enter"]?.();
    selectedRect?.handlers.click?.();
    selectedRect?.handlers["pointer.leave"]?.();

    expect(hovered).toEqual(["cta", null]);
    expect(selected).toEqual(["cta"]);
    expect(leaferInstances[0]?.requestRender).toHaveBeenCalled();

    scene.dispose();

    expect(leaferInstances[0]?.destroy).toHaveBeenCalled();
  });

  it("renders stable empty and selected states", () => {
    const empty = renderToStaticMarkup(<AnnotationCanvas nodes={[]} />);
    const selected = renderToStaticMarkup(<AnnotationCanvas nodes={nodes} selectedNodeIds={["cta"]} imageUrl="/api/designs/D-123/image/file?version=2" />);

    expect(empty).toContain("No annotation nodes");
    expect(selected).toContain("Pay button");
    expect(selected).toContain("2 nodes");
    expect(selected).not.toContain('src="/api/designs/D-123/image/file?version=2"');
  });

  it("computes spacing using edge gaps or center deltas", () => {
    expect(
      calculateNodeSpacing(
        { id: "left", name: "Left", type: "rect", x: 10, y: 10, width: 40, height: 40 },
        { id: "right", name: "Right", type: "rect", x: 70, y: 25, width: 20, height: 20 }
      )
    ).toMatchObject({
      horizontal: { mode: "edge-gap", value: 20 },
      vertical: { mode: "center-delta", value: 5 }
    });
  });
});
