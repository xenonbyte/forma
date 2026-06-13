// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "../i18n.js";
import { BrandAssets, type BrandAssetsClient } from "./BrandAssets.js";
import type { BrandAssetsList, Product } from "../api.js";

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
  setLocale("en");
});

// ── fixtures ────────────────────────────────────────────────────────────────

const PRODUCT_ID = "prod-1";

const product: Product = {
  id: PRODUCT_ID,
  name: "My Product",
  description: "desc",
  platform: "mobile",
  brand_style: "aurora",
};

const assetsList: BrandAssetsList = {
  assets: [
    {
      kind: "app-icon",
      name: "icon",
      brand_style: "aurora",
      generated_at: "2026-06-13T00:00:00.000Z",
      files: [
        { path: "app-icon/icon/ios-1024.png", width: 1024, height: 1024 },
        { path: "app-icon/icon/android-512.png", width: 512, height: 512 },
      ],
    },
  ],
};

// app-icon generated against a different brand_style than the product → stale.
const staleAssetsList: BrandAssetsList = {
  assets: [
    {
      kind: "app-icon",
      name: "icon",
      brand_style: "legacy",
      generated_at: "2026-06-13T00:00:00.000Z",
      files: [{ path: "app-icon/icon/ios-1024.png", width: 1024, height: 1024 }],
    },
  ],
};

// Two kinds present (M5 store-shot appears with NO page code change) → dynamic grouping.
const multiKindList: BrandAssetsList = {
  assets: [
    {
      kind: "app-icon",
      name: "icon",
      brand_style: "aurora",
      generated_at: "2026-06-13T00:00:00.000Z",
      files: [{ path: "app-icon/icon/ios-1024.png", width: 1024, height: 1024 }],
    },
    {
      kind: "store-shot",
      name: "home",
      brand_style: "aurora",
      generated_at: "2026-06-13T00:00:00.000Z",
      files: [{ path: "store-shots/home/shot-1.png", width: 1290, height: 2796 }],
    },
  ],
};

function fakeClient(overrides: Partial<BrandAssetsClient> = {}): BrandAssetsClient {
  return {
    getProduct: async () => product,
    getBrandAssets: async () => assetsList,
    getBrandAssetFileUrl: (productId, relativePath) => `/api/products/${productId}/brand-assets/files/${relativePath}`,
    getBrandAssetsExportUrl: (productId) => `/api/products/${productId}/brand-assets/export`,
    ...overrides,
  };
}

// ── test infra ──────────────────────────────────────────────────────────────

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
  await Promise.resolve();
}

async function renderPage(client: BrandAssetsClient) {
  const { container, root } = createTestRoot();
  await act(async () => {
    root.render(<BrandAssets client={client} params={{ productId: PRODUCT_ID }} />);
    await flushPromises();
  });
  return { container, root };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("BrandAssets", () => {
  it("renders one group per kind with a tile per file", async () => {
    const { container } = await renderPage(fakeClient());

    // app-icon group heading present (localized label).
    expect(container.textContent).toContain("App icon");

    // One AssetTile per file → 2 tiles for the single app-icon asset.
    const tiles = container.querySelectorAll("[data-testid='asset-tile']");
    expect(tiles.length).toBe(2);

    // Each tile carries its own file src + size label.
    expect(
      container.querySelector("img[src='/api/products/prod-1/brand-assets/files/app-icon/icon/ios-1024.png']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("1024×1024");
    expect(container.textContent).toContain("512×512");
  });

  it("dynamically renders every present kind group (M5 store-shot needs no code change)", async () => {
    const { container } = await renderPage(fakeClient({ getBrandAssets: async () => multiKindList }));

    expect(container.textContent).toContain("App icon");
    // store-shot group appears purely from data — page does not hardcode app-icon.
    expect(container.textContent).toContain("Store screenshots");

    const groups = container.querySelectorAll("[data-testid='asset-group']");
    expect(groups.length).toBe(2);
  });

  it("flags an asset as stale when its brand_style differs from the product brand_style", async () => {
    const { container } = await renderPage(fakeClient({ getBrandAssets: async () => staleAssetsList }));

    // brand_style mismatch (legacy != aurora) → stale badge on its tile.
    expect(container.querySelector("[data-testid='asset-tile-stale']")).not.toBeNull();
  });

  it("does not flag assets whose brand_style matches the product", async () => {
    const { container } = await renderPage(fakeClient());
    expect(container.querySelector("[data-testid='asset-tile-stale']")).toBeNull();
  });

  it("renders an Export all link pointing at the export endpoint", async () => {
    const { container } = await renderPage(fakeClient());

    const exportLink = container.querySelector("[data-testid='brand-assets-export']") as HTMLAnchorElement | null;
    expect(exportLink).not.toBeNull();
    expect(exportLink!.getAttribute("href")).toBe("/api/products/prod-1/brand-assets/export");
    expect(exportLink!.textContent).toContain("Export all");
  });

  it("triggers a file download when a tile download button is clicked", async () => {
    const clickedHrefs: string[] = [];
    // Capture programmatic anchor clicks (the download trigger).
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "a") {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          clickedHrefs.push((el as HTMLAnchorElement).getAttribute("href") ?? "");
        });
      }
      return el;
    });

    const { container } = await renderPage(fakeClient());
    const button = container.querySelector("[data-testid='asset-tile-download']") as HTMLButtonElement;
    expect(button).not.toBeNull();
    act(() => button.click());

    expect(clickedHrefs).toContain("/api/products/prod-1/brand-assets/files/app-icon/icon/ios-1024.png");
  });

  it("shows an empty state when the product has no brand assets", async () => {
    const { container } = await renderPage(fakeClient({ getBrandAssets: async () => ({ assets: [] }) }));

    expect(container.querySelector("[data-testid='asset-tile']")).toBeNull();
    expect(container.textContent).toMatch(/fm-brand-assets/);
  });

  it("shows an error state when loading fails", async () => {
    const client = fakeClient({
      getBrandAssets: async () => {
        throw new Error("network error");
      },
    });
    const { container } = await renderPage(client);
    expect(container.querySelector("[data-testid='asset-tile']")).toBeNull();
    expect(container.textContent).toContain("network error");
  });

  it("reports the product name via onBreadcrumbLabel", async () => {
    const labels: Record<string, string> = {};
    const { container: _c, root } = createTestRoot();
    await act(async () => {
      root.render(
        <BrandAssets
          client={fakeClient()}
          onBreadcrumbLabel={(k, v) => {
            labels[k] = v;
          }}
          params={{ productId: PRODUCT_ID }}
        />,
      );
      await flushPromises();
    });
    expect(labels[`product:${PRODUCT_ID}`]).toBe("My Product");
  });
});
