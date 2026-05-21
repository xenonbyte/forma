// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesignView } from "./DesignView.js";
import type { FormaApiClient, RequirementDesignCanvas, RequirementDesignScene } from "../api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const completeCanvas: RequirementDesignCanvas = {
  index_status: "complete",
  product_id: "P-123abc",
  requirement_id: "R-12345678",
  canvas_version: 1,
  pages: [{ page_id: "checkout-page", status: "done", frame_id: "frame-1" }]
};

const missingCanvas: RequirementDesignCanvas = {
  index_status: "missing",
  product_id: "P-123abc",
  requirement_id: "R-12345678",
  pages: []
};

const scene: RequirementDesignScene = {
  schema_version: 1,
  product_id: "P-123abc",
  requirement_id: "R-12345678",
  canvas: { file: "design.pen", version: 1 },
  pages: [
    {
      page_id: "checkout-page",
      frame_id: "frame-1",
      preview: { status: "exported", file: "previews/checkout-page@2x.png" },
      nodes: [{ id: "frame-1", name: "Checkout", type: "frame", unsupported_properties: [] }]
    }
  ],
  unsupported_properties: []
};

const roots: Root[] = [];
const containers: HTMLElement[] = [];

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
  window.history.replaceState({}, "", "/products");
});

describe("DesignView", () => {
  it("loads scene only after a complete requirement design canvas is available", async () => {
    const client = {
      getRequirementDesignCanvas: vi.fn(async () => completeCanvas),
      getRequirementDesignScene: vi.fn(async () => scene)
    } satisfies Pick<FormaApiClient, "getRequirementDesignCanvas" | "getRequirementDesignScene">;
    const { container, root } = createTestRoot();

    window.history.replaceState({}, "", "/products/P-123abc/requirements/R-12345678/design?page_id=checkout-page");
    await act(async () => {
      root.render(<DesignView client={client} params={{ productId: "P-123abc", reqId: "R-12345678" }} />);
      await flushPromises();
    });

    expect(client.getRequirementDesignCanvas).toHaveBeenCalledWith("P-123abc", "R-12345678");
    expect(client.getRequirementDesignScene).toHaveBeenCalledWith("P-123abc", "R-12345678");
    expect(container.textContent).toContain("checkout-page");
    expect(container.textContent).toContain("frame-1");
    expect(container.textContent).toContain("Complete");
    expect(container.querySelector('[role="application"]')).not.toBeNull();
    expect(container.querySelector("[data-design-view-layout]")?.className).toContain("md:grid-cols");
    expect(container.textContent).toContain("Properties");
    expect(container.textContent).toContain("Preview");
    expect(container.innerHTML).not.toContain("Annotation canvas");
  });

  it("shows index action state for missing canvases without reading scene", async () => {
    const client = {
      getRequirementDesignCanvas: vi.fn(async () => missingCanvas),
      getRequirementDesignScene: vi.fn(async () => scene)
    } satisfies Pick<FormaApiClient, "getRequirementDesignCanvas" | "getRequirementDesignScene">;
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<DesignView client={client} params={{ productId: "P-123abc", reqId: "R-12345678" }} />);
      await flushPromises();
    });

    expect(client.getRequirementDesignCanvas).toHaveBeenCalledWith("P-123abc", "R-12345678");
    expect(client.getRequirementDesignScene).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Index required");
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
