// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NavigationGraph, normalizeNavigation } from "./NavigationGraph.js";
import type { BaselinePage } from "../api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const leaferInstances: MockLeafer[] = [];
const elementInstances: MockElement[] = [];
type MockElementKind = "Path" | "Rect" | "Text";

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

class MockPath extends MockElement {
  constructor(config: Record<string, unknown>) {
    super(config, "Path");
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
  Leafer: MockLeafer,
  Path: MockPath,
  PointerEvent: { CLICK: "click", ENTER: "pointer.enter", LEAVE: "pointer.leave" },
  Rect: MockRect,
  Text: MockText
}));

const pages: BaselinePage[] = [
  {
    copy: "Welcome",
    features: "Search products\nFilter results",
    fields: "query",
    id: "home",
    interactions: "submit search",
    name: "Home",
    source_requirements: ["R-12345678"]
  },
  {
    copy: "Pay",
    features: "Collect payment",
    fields: "card",
    id: "checkout",
    interactions: "complete order",
    name: "Checkout",
    source_requirements: []
  }
];

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
});

describe("normalizeNavigation", () => {
  it("uses canonical trigger before legacy label or fallback text", () => {
    expect(
      normalizeNavigation([
        { from: "home", to: "checkout", trigger: "Start checkout", label: "Legacy checkout" },
        { from: "checkout", to: "home", label: "Back" },
        { from: "home", to: "home" }
      ])
    ).toEqual([
      { from: "home", label: "Start checkout", to: "checkout" },
      { from: "checkout", label: "Back", to: "home" },
      { from: "home", label: "No label", to: "home" }
    ]);
  });
});

describe("NavigationGraph", () => {
  it("renders an empty state when no pages are available", async () => {
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<NavigationGraph navigation={[]} pages={[]} />);
      await flushPromises();
    });

    expect(container.textContent).toContain("No baseline pages to graph.");
    expect(leaferInstances).toHaveLength(0);
  });

  it("mounts a Leafer scene and destroys it on unmount", async () => {
    const { root } = createTestRoot();

    await act(async () => {
      root.render(<NavigationGraph navigation={[{ from: "home", to: "checkout", trigger: "Start checkout" }]} pages={pages} />);
      await flushPromises();
    });

    expect(leaferInstances).toHaveLength(1);
    expect(leaferInstances[0]?.config).toMatchObject({
      height: 400,
      view: expect.any(HTMLElement),
      width: 600
    });
    expect(leaferInstances[0]?.add).toHaveBeenCalled();

    act(() => {
      root.unmount();
    });

    expect(leaferInstances[0]?.destroy).toHaveBeenCalledTimes(1);
  });

  it("draws feature counts, trigger labels, and directed edge arrows", async () => {
    const { root } = createTestRoot();

    await act(async () => {
      root.render(
        <NavigationGraph
          navigation={[{ from: "home", to: "checkout", label: "Legacy checkout", trigger: "Start checkout" }]}
          pages={pages}
        />
      );
      await flushPromises();
    });

    expect(findElement("node-label-home")?.config).toMatchObject({
      text: "Home\n(2个功能)"
    });
    expect(findElement("edge-label-home-checkout")?.config).toMatchObject({
      text: "Start checkout"
    });

    const edge = findElement("edge-home-checkout", "Path");
    const arrow = findElement("edge-arrow-home-checkout", "Path");
    const sourceNode = findElement("node-home", "Rect");
    const targetNode = findElement("node-checkout", "Rect");

    expect(edge?.config).toMatchObject({
      stroke: "#a1a1aa"
    });
    expect(arrow?.config).toMatchObject({
      fill: "#a1a1aa"
    });

    const path = edge?.config.path as PathCommand[];
    const arrowPath = arrow?.config.path as PathCommand[];
    expect(path[0]?.[0]).toBe("M");
    expect(path[1]?.[0]).toBe("L");
    expect(pointInsideRect(commandPoint(path[0]), sourceNode?.config)).toBe(false);
    expect(pointInsideRect(commandPoint(path[1]), targetNode?.config)).toBe(false);
    expect(arrowTipSize(arrowPath)).toBeCloseTo(6, 1);
  });

  it("draws self edges around the node without crossing its interior", async () => {
    const { root } = createTestRoot();

    await act(async () => {
      root.render(<NavigationGraph navigation={[{ from: "home", to: "home", trigger: "Stay" }]} pages={pages} />);
      await flushPromises();
    });

    const edge = findElement("edge-home-home", "Path");
    const homeNode = findElement("node-home", "Rect");
    const path = edge?.config.path as PathCommand[];

    expect(path.map((command) => command[0])).toEqual(["M", "L", "L", "L"]);
    expect(pathCrossesRectInterior(path, homeNode?.config)).toBe(false);
  });

  it("selects nodes through real Leafer rect click handlers", async () => {
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<NavigationGraph navigation={[]} pages={pages} />);
      await flushPromises();
    });

    await act(async () => {
      findElement("node-checkout", "Rect")?.handlers.click?.();
      await flushPromises();
    });

    expect(container.textContent).toContain("Collect payment");
    expect(container.textContent).not.toContain("Pay");
    expect(container.textContent).not.toContain("card");
    expect(container.textContent).not.toContain("complete order");
  });

  it("highlights hovered nodes and their related edges", async () => {
    const { root } = createTestRoot();

    await act(async () => {
      root.render(<NavigationGraph navigation={[{ from: "home", to: "checkout", trigger: "Start checkout" }]} pages={pages} />);
      await flushPromises();
    });

    const homeNode = findElement("node-home", "Rect");
    const relatedEdge = findElement("edge-home-checkout", "Path");
    const relatedArrow = findElement("edge-arrow-home-checkout", "Path");

    homeNode?.handlers["pointer.enter"]?.();

    expect(homeNode?.stroke).toBe("#3B82F6");
    expect(relatedEdge?.stroke).toBe("#3B82F6");
    expect(relatedArrow?.fill).toBe("#3B82F6");
    expect(leaferInstances[0]?.requestRender).toHaveBeenCalled();

    homeNode?.handlers["pointer.leave"]?.();

    expect(relatedEdge?.stroke).toBe("#a1a1aa");
    expect(relatedArrow?.fill).toBe("#a1a1aa");
  });

  it("shows nodes and an empty navigation message when pages have no navigation relationships", async () => {
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<NavigationGraph navigation={[]} pages={pages} />);
      await flushPromises();
    });

    expect(container.textContent).toContain("暂无页面间导航关系");
    expect(findElement("node-home")).toBeDefined();
    expect(findElement("node-checkout")).toBeDefined();
  });

  it("shows selected page features from the accessible node controls", async () => {
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<NavigationGraph navigation={[]} pages={pages} />);
      await flushPromises();
    });

    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === "Checkout");
    expect(button).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Collect payment");
    expect(container.textContent).not.toContain("Pay");
    expect(container.textContent).not.toContain("card");
    expect(container.textContent).not.toContain("complete order");
  });
});

type PathCommand = [string, number?, number?];

function findElement(name: string, kind?: MockElementKind) {
  return elementInstances.find((element) => element.config.name === name && (!kind || element.kind === kind));
}

function commandPoint(command: PathCommand | undefined): { x: number; y: number } {
  return { x: Number(command?.[1]), y: Number(command?.[2]) };
}

function arrowTipSize(path: PathCommand[]): number {
  const tip = commandPoint(path[0]);
  const left = commandPoint(path[1]);
  const right = commandPoint(path[2]);
  const baseMidpoint = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  return Math.sqrt((tip.x - baseMidpoint.x) ** 2 + (tip.y - baseMidpoint.y) ** 2);
}

function pathCrossesRectInterior(path: PathCommand[], config: Record<string, unknown> | undefined): boolean {
  for (let index = 1; index < path.length; index += 1) {
    const start = commandPoint(path[index - 1]);
    const end = commandPoint(path[index]);
    for (let step = 1; step < 10; step += 1) {
      const t = step / 10;
      if (pointInsideRect({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }, config)) {
        return true;
      }
    }
  }
  return false;
}

function pointInsideRect(point: { x: number; y: number }, config: Record<string, unknown> | undefined): boolean {
  if (!config) {
    return false;
  }
  const x = Number(config.x);
  const y = Number(config.y);
  const width = Number(config.width);
  const height = Number(config.height);
  return point.x > x && point.x < x + width && point.y > y && point.y < y + height;
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
