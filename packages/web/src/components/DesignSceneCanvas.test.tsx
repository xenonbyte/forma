// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesignSceneCanvas } from "./DesignSceneCanvas.js";
import type { RequirementDesignCanvasPage, RequirementDesignScene } from "../api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const leaferInstances: MockLeafer[] = [];
const elementInstances: MockElement[] = [];
type MockElementKind = "Frame" | "Rect" | "Text";

class MockLeafer {
  elements: MockElement[] = [];
  add = vi.fn();
  destroy = vi.fn();
  lockLayout = vi.fn();
  requestRender = vi.fn();
  unlockLayout = vi.fn();

  constructor(public readonly config: Record<string, unknown>) {
    leaferInstances.push(this);
    this.add = vi.fn((element: MockElement) => {
      this.elements.push(element);
    });
  }
}

class MockElement {
  handlers: Record<string, () => void> = {};
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  on = vi.fn((eventName: string, handler: () => void) => {
    this.handlers[eventName] = handler;
    return this;
  });

  constructor(
    public readonly config: Record<string, unknown>,
    public readonly kind: MockElementKind
  ) {
    this.fill = typeof config.fill === "string" ? config.fill : undefined;
    this.stroke = typeof config.stroke === "string" ? config.stroke : undefined;
    this.strokeWidth = typeof config.strokeWidth === "number" ? config.strokeWidth : undefined;
    elementInstances.push(this);
  }
}

class MockFrame extends MockElement {
  constructor(config: Record<string, unknown>) {
    super(config, "Frame");
  }
}

class MockRect extends MockElement {
  constructor(config: Record<string, unknown>) {
    super(config, "Rect");
  }
}

class MockText extends MockElement {
  constructor(config: Record<string, unknown>) {
    super(config, "Text");
  }
}

vi.mock("leafer-ui", () => ({
  Frame: MockFrame,
  Leafer: MockLeafer,
  PointerEvent: { CLICK: "click", ENTER: "pointer.enter", LEAVE: "pointer.leave" },
  Rect: MockRect,
  Text: MockText
}));

const scene: RequirementDesignScene = {
  schema_version: 1,
  product_id: "P-123abc",
  requirement_id: "R-12345678",
  canvas: { file: "design.pen", version: 4 },
  pages: [
    {
      page_id: "checkout",
      frame_id: "frame-1",
      preview: { status: "exported", file: "previews/checkout@2x.png" },
      nodes: [
        {
          id: "frame-1",
          kind: "page",
          name: "Checkout",
          type: "frame",
          x: 0,
          y: 0,
          width: 390,
          height: 844,
          fill: "#ffffff",
          unsupported_properties: []
        },
        {
          id: "cta",
          component_key: "button.primary",
          fill: "#111827",
          height: 48,
          kind: "action",
          name: "Pay button",
          parent_id: "frame-1",
          stroke: "#d97706",
          text: "Pay now",
          type: "text",
          unsupported_properties: ["shadow"],
          width: 294,
          x: 48,
          y: 720
        },
        {
          id: "hero",
          height: 180,
          image: "assets/hero.png",
          name: "Hero image",
          parent_id: "frame-1",
          type: "image",
          unsupported_properties: [],
          width: 294,
          x: 48,
          y: 96
        }
      ]
    }
  ],
  unsupported_properties: [{ node_id: "cta", property: "shadow" }]
};

const canvasPages: RequirementDesignCanvasPage[] = [{ page_id: "checkout", frame_id: "frame-1", page_version: 3, status: "done" }];

const roots: Root[] = [];
const containers: HTMLElement[] = [];

beforeEach(() => {
  leaferInstances.length = 0;
  elementInstances.length = 0;
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  for (const container of containers.splice(0)) {
    container.remove();
  }
  vi.restoreAllMocks();
});

describe("DesignSceneCanvas", () => {
  it("renders a Leafer scene and accessible node alternatives from Pencil node ids", async () => {
    const onSelectionChange = vi.fn();
    const onHoverNodeId = vi.fn();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <DesignSceneCanvas
          canvasPages={canvasPages}
          onHoverNodeId={onHoverNodeId}
          onSelectionChange={onSelectionChange}
          productId="P-123abc"
          requirementId="R-12345678"
          scene={scene}
          selectedPageId="checkout"
        />
      );
      await flushPromises();
    });

    expect(leaferInstances[0]?.config).toMatchObject({
      height: 844,
      view: expect.any(HTMLElement),
      width: 390
    });
    expect(findElement("node-cta", "Text")?.config).toMatchObject({
      data: { nodeId: "cta" },
      text: "Pay now",
      x: 48,
      y: 720
    });
    expect(container.querySelector('[role="application"]')?.getAttribute("aria-describedby")).toContain("scene-canvas-status");
    expect(container.querySelector('[data-node-id="cta"]')?.textContent).toContain("Pay button");
    expect(container.querySelector('a[href="/api/products/P-123abc/requirements/R-12345678/design/preview/checkout/file"]')).not.toBeNull();
    expect(container.textContent).toContain("shadow");
    expect(container.textContent).toContain("scene_unsupported_property");

    await act(async () => {
      findElement("node-cta", "Text")?.handlers.click?.();
      await flushPromises();
    });
    expect(onSelectionChange).toHaveBeenCalledWith(["cta"]);

    await act(async () => {
      findElement("node-cta", "Text")?.handlers["pointer.enter"]?.();
      await flushPromises();
    });
    expect(onHoverNodeId).toHaveBeenCalledWith("cta");
  });

  it("supports box selection and keyboard pan zoom shortcuts without screenshot coordinates", async () => {
    const onSelectionChange = vi.fn();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <DesignSceneCanvas
          canvasPages={canvasPages}
          onSelectionChange={onSelectionChange}
          productId="P-123abc"
          requirementId="R-12345678"
          scene={scene}
          selectedNodeIds={["hero"]}
          selectedPageId="checkout"
        />
      );
      await flushPromises();
    });

    const region = container.querySelector('[role="application"]') as HTMLElement;
    region.getBoundingClientRect = () =>
      ({ bottom: 844, height: 844, left: 0, right: 390, top: 0, width: 390, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    await act(async () => {
      region.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 40, clientY: 700 }));
      region.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 360, clientY: 790 }));
      region.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 360, clientY: 790 }));
      await flushPromises();
    });
    expect(onSelectionChange).toHaveBeenLastCalledWith(["cta"]);

    await act(async () => {
      region.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
      region.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", shiftKey: true }));
      region.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "+" }));
      await flushPromises();
    });
    expect(container.textContent).toContain("Pan 48, 240");
    expect(container.textContent).toContain("Zoom 125%");

    await act(async () => {
      region.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "0" }));
      region.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "f" }));
      region.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      await flushPromises();
    });
    expect(container.textContent).toContain("Zoom 115%");
    expect(container.textContent).toContain("Fit selection");
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it("surfaces missing preview integrity details instead of re-exporting", async () => {
    const { container, root } = createTestRoot();
    const missingPreviewScene: RequirementDesignScene = {
      ...scene,
      pages: [{ ...scene.pages[0], preview: { status: "missing" } }]
    };

    await act(async () => {
      root.render(
        <DesignSceneCanvas
          canvasPages={[{ page_id: "checkout", frame_id: "frame-1", status: "done" }]}
          productId="P-123abc"
          requirementId="R-12345678"
          scene={missingPreviewScene}
          selectedPageId="checkout"
        />
      );
      await flushPromises();
    });

    expect(container.textContent).toContain("PREVIEW_NOT_EXPORTED");
    expect(container.querySelector('a[href*="/design/preview/checkout/file"]')).toBeNull();
  });
});

function findElement(name: string, kind?: MockElementKind) {
  return elementInstances.find((element) => element.config.name === name && (!kind || element.kind === kind));
}

function createTestRoot() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
