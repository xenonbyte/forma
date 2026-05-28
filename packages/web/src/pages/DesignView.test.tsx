// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesignView } from "./DesignView.js";
import type { ArtifactSummary, DesignViewClientDep } from "./DesignView.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  it("shows empty state when no artifacts returned", async () => {
    const client: DesignViewClientDep = {
      listProductArtifacts: vi.fn(async () => ({ artifacts: [] }))
    };
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<DesignView client={client} params={{ productId: "P-123abc", reqId: "R-12345678" }} />);
      await flushPromises();
    });

    expect(client.listProductArtifacts).toHaveBeenCalledWith("P-123abc");
    expect(container.textContent).toContain("No designs yet");
  });

  it("renders PNG grid when artifacts are available", async () => {
    const artifacts: ArtifactSummary[] = [
      { id: "A-111", kind: "html", requirement_id: "R-12345678", title: "Home Page", updated_at: "2026-05-28T00:00:00Z" },
      { id: "A-222", kind: "html", requirement_id: "R-12345678", title: "Checkout Page", updated_at: "2026-05-28T00:00:00Z" },
      { id: "A-333", kind: "html", requirement_id: "R-87654321", title: "Profile Page", updated_at: "2026-05-28T00:00:00Z" },
      { id: "A-444", kind: "design-system", title: "Design System", updated_at: "2026-05-28T00:00:00Z" }
    ];
    const client: DesignViewClientDep = {
      listProductArtifacts: vi.fn(async () => ({ artifacts }))
    };
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<DesignView client={client} params={{ productId: "P-123abc", reqId: "R-12345678" }} />);
      await flushPromises();
    });

    const images = container.querySelectorAll("img");
    expect(images.length).toBe(2);
    const srcs = Array.from(images).map((img) => img.getAttribute("src") ?? "");
    expect(srcs).toEqual([
      "/api/products/P-123abc/artifacts/A-111/preview/1x",
      "/api/products/P-123abc/artifacts/A-222/preview/1x"
    ]);
  });

  it("opens lightbox on artifact click", async () => {
    const artifacts: ArtifactSummary[] = [
      { id: "A-111", kind: "html", requirement_id: "R-12345678", title: "Home Page", updated_at: "2026-05-28T00:00:00Z" }
    ];
    const client: DesignViewClientDep = {
      listProductArtifacts: vi.fn(async () => ({ artifacts }))
    };
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<DesignView client={client} params={{ productId: "P-123abc", reqId: "R-12345678" }} />);
      await flushPromises();
    });

    // Click the artifact button to open the lightbox
    const button = container.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    // A 2x preview image should now be visible in the lightbox
    const allImages = container.querySelectorAll("img");
    const lightboxImg = Array.from(allImages).find((img) =>
      (img.getAttribute("src") ?? "").includes("/preview/2x")
    );
    expect(lightboxImg).not.toBeUndefined();
    expect(lightboxImg?.getAttribute("src")).toBe("/api/products/P-123abc/artifacts/A-111/preview/2x");
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
