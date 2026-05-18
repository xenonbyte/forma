// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NavigationGraph, normalizeNavigation } from "./NavigationGraph.js";
import type { BaselinePage } from "../api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const leaferInstances: MockLeafer[] = [];

class MockLeafer {
  add = vi.fn();
  destroy = vi.fn();
  lockLayout = vi.fn();
  unlockLayout = vi.fn();

  constructor(public readonly config: Record<string, unknown>) {
    leaferInstances.push(this);
  }
}

class MockElement {
  on = vi.fn();

  constructor(public readonly config: Record<string, unknown>) {}
}

vi.mock("leafer-ui", () => ({
  Leafer: MockLeafer,
  Path: MockElement,
  PointerEvent: { CLICK: "click", ENTER: "pointer.enter", LEAVE: "pointer.leave" },
  Rect: MockElement,
  Text: MockElement
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
      height: 560,
      view: expect.any(HTMLElement),
      width: 960
    });
    expect(leaferInstances[0]?.add).toHaveBeenCalled();

    act(() => {
      root.unmount();
    });

    expect(leaferInstances[0]?.destroy).toHaveBeenCalledTimes(1);
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
