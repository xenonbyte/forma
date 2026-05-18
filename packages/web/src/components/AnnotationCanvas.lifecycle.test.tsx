// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnnotationCanvas, setAnnotationCanvasRuntimeLoaderForTest, type LeaferRuntime } from "./AnnotationCanvas.js";
import type { AnnotationNode } from "../api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nodes: AnnotationNode[] = [
  { id: "frame", name: "Checkout frame", type: "frame", x: 0, y: 0, width: 400, height: 300 },
  { id: "cta", parent_id: "frame", name: "Pay button", type: "button", x: 24, y: 220, width: 120, height: 44 }
];

const leaferInstances: MockLeafer[] = [];
const rectInstances: MockRect[] = [];
const cleanups: Array<() => void> = [];
const roots: Root[] = [];
const containers: HTMLElement[] = [];

class MockLeafer {
  add = vi.fn();
  destroy = vi.fn();
  lockLayout = vi.fn();
  unlockLayout = vi.fn();

  constructor(public readonly config: Record<string, unknown>) {
    leaferInstances.push(this);
  }
}

class MockRect {
  on = vi.fn();

  constructor(public readonly config: Record<string, unknown>) {
    rectInstances.push(this);
  }
}

const runtime = {
  Leafer: MockLeafer,
  PointerEvent: { CLICK: "click", ENTER: "pointer.enter", LEAVE: "pointer.leave" },
  Rect: MockRect
} satisfies LeaferRuntime;

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  for (const container of containers.splice(0)) {
    container.remove();
  }
  leaferInstances.length = 0;
  rectInstances.length = 0;
  vi.restoreAllMocks();
});

describe("AnnotationCanvas lifecycle", () => {
  it("mounts, remounts on prop change, cleans up on unmount, and ignores late runtime resolution", async () => {
    const runtimeLoads = [deferred<LeaferRuntime>(), deferred<LeaferRuntime>(), deferred<LeaferRuntime>()];
    let loadIndex = 0;
    const loader = vi.fn(() => {
      const next = runtimeLoads[loadIndex];
      loadIndex += 1;
      if (!next) {
        throw new Error("Unexpected runtime load");
      }
      return next.promise;
    });
    cleanups.push(setAnnotationCanvasRuntimeLoaderForTest(loader));
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<AnnotationCanvas imageUrl="/api/designs/D-123/image/file?version=1" nodes={nodes} selectedNodeIds={["cta"]} />);
    });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(leaferInstances).toHaveLength(0);

    await act(async () => {
      runtimeLoads[0]?.resolve(runtime);
      await flushPromises();
    });
    expect(leaferInstances).toHaveLength(1);

    await act(async () => {
      root.render(<AnnotationCanvas imageUrl="/api/designs/D-123/image/file?version=2" nodes={nodes} selectedNodeIds={["frame", "cta"]} />);
    });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(leaferInstances[0]?.destroy).toHaveBeenCalledTimes(1);

    await act(async () => {
      runtimeLoads[1]?.resolve(runtime);
      await flushPromises();
    });
    expect(leaferInstances).toHaveLength(2);

    await act(async () => {
      root.unmount();
    });
    roots.pop();
    expect(leaferInstances[1]?.destroy).toHaveBeenCalledTimes(1);

    const lateRoot = createTestRoot();
    await act(async () => {
      lateRoot.root.render(<AnnotationCanvas imageUrl="/api/designs/D-123/image/file?version=3" nodes={nodes} selectedNodeIds={["cta"]} />);
    });
    expect(loader).toHaveBeenCalledTimes(3);

    await act(async () => {
      lateRoot.root.unmount();
    });
    roots.pop();
    await act(async () => {
      runtimeLoads[2]?.resolve(runtime);
      await flushPromises();
    });
    expect(leaferInstances).toHaveLength(2);
    expect(container.textContent).not.toContain("Annotation runtime unavailable");
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
