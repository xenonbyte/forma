// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { VersionCompare, type VersionCompareClient } from "./VersionCompare.js";
import { LocaleProvider } from "../LocaleContext.js";

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
});

function previewUrl(productId: string, artifactId: string, version: number, resolution: "1x" | "2x"): string {
  return `/api/products/${productId}/artifacts/${artifactId}/versions/${version}/preview/${resolution}.png`;
}

function fakeClient(versions: number[], currentVersion?: number): VersionCompareClient {
  return {
    getProductArtifact: async () => ({
      manifest: {
        id: "A1",
        kind: "design-page",
        title: "Checkout",
        entry: "index.html",
        status: "complete",
        exports: [],
      },
      versions,
      current_version: currentVersion ?? versions[versions.length - 1],
    }),
    getArtifactVersionPreviewUrl: previewUrl,
  };
}

async function render(client: VersionCompareClient) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        null,
        createElement(VersionCompare, {
          client,
          params: { productId: "P-0abc12", artifactId: "A1" },
        }),
      ),
    );
  });
  return container;
}

describe("VersionCompare (F3)", () => {
  it("renders two preview panes defaulting to previous vs latest", async () => {
    const container = await render(fakeClient([1, 2, 3]));
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.map((img) => img.getAttribute("src"))).toEqual([
      previewUrl("P-0abc12", "A1", 2, "2x"),
      previewUrl("P-0abc12", "A1", 3, "2x"),
    ]);
  });

  it("switching a selector updates the corresponding pane", async () => {
    const container = await render(fakeClient([1, 2, 3]));
    const selects = [...container.querySelectorAll("select")];
    expect(selects).toHaveLength(2);
    await act(async () => {
      selects[0].value = "1";
      selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    });
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs[0].getAttribute("src")).toBe(previewUrl("P-0abc12", "A1", 1, "2x"));
  });

  it("defaults to current vs next when the pointer is rolled back to the oldest version", async () => {
    const container = await render(fakeClient([1, 2, 3], 1));
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.map((img) => img.getAttribute("src"))).toEqual([
      previewUrl("P-0abc12", "A1", 1, "2x"),
      previewUrl("P-0abc12", "A1", 2, "2x"),
    ]);
  });

  it("shows an empty state when fewer than two versions exist", async () => {
    const container = await render(fakeClient([1]));
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.textContent).toContain("fewer than two versions");
  });
});
