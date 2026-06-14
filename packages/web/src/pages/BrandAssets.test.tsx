// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale, messages } from "../i18n.js";
import { LocaleProvider } from "../LocaleContext.js";
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

// Mobile product: store-shot assets with android + ios surfaces → surface sub-groups.
const mobileSurfaceList: BrandAssetsList = {
  assets: [
    {
      kind: "store-shot",
      name: "home-android",
      brand_style: "aurora",
      surface: "android",
      generated_at: "2026-06-14T00:00:00.000Z",
      files: [{ path: "store-shots/home-android/shot.png", width: 1080, height: 1920 }],
    },
    {
      kind: "store-shot",
      name: "home-ios",
      brand_style: "aurora",
      surface: "ios",
      generated_at: "2026-06-14T00:00:00.000Z",
      files: [{ path: "store-shots/home-ios/shot.png", width: 1290, height: 2796 }],
    },
  ],
};

// Banner kind with android + ios surfaces.
const bannerList: BrandAssetsList = {
  assets: [
    {
      kind: "banner",
      name: "promo-android",
      brand_style: "aurora",
      surface: "android",
      generated_at: "2026-06-14T00:00:00.000Z",
      files: [{ path: "banners/promo-android/banner.png", width: 1024, height: 500 }],
    },
    {
      kind: "banner",
      name: "promo-ios",
      brand_style: "aurora",
      surface: "ios",
      generated_at: "2026-06-14T00:00:00.000Z",
      files: [{ path: "banners/promo-ios/banner.png", width: 1024, height: 500 }],
    },
  ],
};

// Web product: store-shot without surface → single group, no surface sub-label.
const webNoSurfaceList: BrandAssetsList = {
  assets: [
    {
      kind: "store-shot",
      name: "web-shot",
      brand_style: "aurora",
      generated_at: "2026-06-14T00:00:00.000Z",
      files: [{ path: "store-shots/web-shot/shot.png", width: 1440, height: 900 }],
    },
  ],
};

// Poster with no surface (platform-agnostic).
const posterList: BrandAssetsList = {
  assets: [
    {
      kind: "poster",
      name: "promo-portrait",
      brand_style: "aurora",
      variant: "portrait",
      generated_at: "2026-06-14T00:00:00.000Z",
      files: [{ path: "posters/promo-portrait/poster.png", width: 1080, height: 1920 }],
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

async function renderPage(client: BrandAssetsClient, locale?: "en" | "zh") {
  if (locale) setLocale(locale);
  const { container, root } = createTestRoot();
  await act(async () => {
    root.render(
      <LocaleProvider>
        <BrandAssets client={client} params={{ productId: PRODUCT_ID }} />
      </LocaleProvider>,
    );
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
    expect(exportLink?.getAttribute("href")).toBe("/api/products/prod-1/brand-assets/export");
    expect(exportLink?.textContent).toContain("Export all");
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

  // ── T9: surface sub-grouping (SPEC-BEHAVIOR-008 canvas half) ─────────────────

  it("mobile/tablet: store-shot assets with surface render Android + iOS sub-groups (T9)", async () => {
    const { container } = await renderPage(fakeClient({ getBrandAssets: async () => mobileSurfaceList }));

    // Both composed labels present.
    expect(container.textContent).toContain("Android Store screenshots");
    expect(container.textContent).toContain("iOS Store screenshots");

    // The kind group is present.
    const groups = container.querySelectorAll("[data-testid='asset-group']");
    expect(groups.length).toBe(1);

    // Two surface sub-groups within the kind group.
    const surfaceGroups = container.querySelectorAll("[data-testid='asset-surface-group']");
    expect(surfaceGroups.length).toBe(2);
    expect(surfaceGroups[0].getAttribute("data-surface")).toBe("android");
    expect(surfaceGroups[1].getAttribute("data-surface")).toBe("ios");
  });

  it("web/desktop: store-shot assets WITHOUT surface render a single group with no surface sub-label (T9)", async () => {
    const { container } = await renderPage(fakeClient({ getBrandAssets: async () => webNoSurfaceList }));

    // Plain kind label present.
    expect(container.textContent).toContain("Store screenshots");

    // No Android/iOS prefix in the heading.
    expect(container.textContent).not.toContain("Android Store screenshots");
    expect(container.textContent).not.toContain("iOS Store screenshots");

    // No surface sub-groups rendered.
    const surfaceGroups = container.querySelectorAll("[data-testid='asset-surface-group']");
    expect(surfaceGroups.length).toBe(0);
  });

  it("banner kind renders as its own group (T9)", async () => {
    const { container } = await renderPage(fakeClient({ getBrandAssets: async () => bannerList }));

    // Banner group heading present (localized).
    expect(container.textContent).toContain("Banners");

    const groups = container.querySelectorAll("[data-testid='asset-group']");
    expect(groups.length).toBe(1);
    expect(groups[0].getAttribute("data-kind")).toBe("banner");

    // Android + iOS sub-groups within the banner kind.
    const surfaceGroups = container.querySelectorAll("[data-testid='asset-surface-group']");
    expect(surfaceGroups.length).toBe(2);
    expect(container.textContent).toContain("Android Banners");
    expect(container.textContent).toContain("iOS Banners");
  });

  it("poster kind renders with kind label only, no surface sub-group (T9)", async () => {
    const { container } = await renderPage(fakeClient({ getBrandAssets: async () => posterList }));

    expect(container.textContent).toContain("Posters");

    // No surface sub-groups for poster.
    const surfaceGroups = container.querySelectorAll("[data-testid='asset-surface-group']");
    expect(surfaceGroups.length).toBe(0);
  });

  it("stale badge still shows when brand_style differs (T9 regression guard)", async () => {
    // Use a stale mobile surface asset to confirm stale detection survives sub-grouping.
    const staleMobileList: BrandAssetsList = {
      assets: [
        {
          kind: "store-shot",
          name: "home-android",
          brand_style: "legacy", // differs from product.brand_style = "aurora"
          surface: "android",
          generated_at: "2026-06-14T00:00:00.000Z",
          files: [{ path: "store-shots/home-android/shot.png", width: 1080, height: 1920 }],
        },
      ],
    };
    const { container } = await renderPage(fakeClient({ getBrandAssets: async () => staleMobileList }));
    expect(container.querySelector("[data-testid='asset-tile-stale']")).not.toBeNull();
  });

  it("i18n keys resolve in zh locale — no missing-key fallback (T9)", async () => {
    const { container } = await renderPage(fakeClient({ getBrandAssets: async () => mobileSurfaceList }), "zh");

    // zh kind label from messages.zh["brandAssets.kind.store-shot"] = "商店截图"
    // zh surface labels: "Android" stays "Android", "iOS" stays "iOS"
    expect(container.textContent).toContain("Android 商店截图");
    expect(container.textContent).toContain("iOS 商店截图");

    // Raw key must NOT appear in the DOM (would indicate a missing translation).
    expect(container.textContent).not.toContain("brandAssets.kind.");
    expect(container.textContent).not.toContain("brandAssets.surface.");
  });

  it("i18n keys resolve in en locale — no missing-key fallback (T9)", async () => {
    const { container } = await renderPage(fakeClient({ getBrandAssets: async () => bannerList }), "en");

    expect(container.textContent).toContain("Android Banners");
    expect(container.textContent).toContain("iOS Banners");

    expect(container.textContent).not.toContain("brandAssets.kind.");
    expect(container.textContent).not.toContain("brandAssets.surface.");
  });

  it("i18n: all T9 keys exist in both en and zh messages (T9)", () => {
    const keys = [
      "brandAssets.kind.app-icon",
      "brandAssets.kind.store-shot",
      "brandAssets.kind.banner",
      "brandAssets.kind.poster",
      "brandAssets.surface.android",
      "brandAssets.surface.ios",
    ];
    for (const key of keys) {
      expect(messages.en[key], `en missing key: ${key}`).toBeDefined();
      expect(messages.zh[key], `zh missing key: ${key}`).toBeDefined();
    }
  });

  it("a11y: surface-grouped section carries aria-label with the kind label (T9)", async () => {
    const { container } = await renderPage(fakeClient({ getBrandAssets: async () => mobileSurfaceList }));

    // The outer <section data-kind="store-shot"> must have aria-label = localized kind label.
    const section = container.querySelector("[data-testid='asset-group'][data-kind='store-shot']");
    expect(section).not.toBeNull();
    expect(section?.getAttribute("aria-label")).toBe("Store screenshots");
  });

  it("a11y: non-surface section has NO aria-label (already has visible h3) (T9)", async () => {
    const { container } = await renderPage(fakeClient({ getBrandAssets: async () => webNoSurfaceList }));

    const section = container.querySelector("[data-testid='asset-group'][data-kind='store-shot']");
    expect(section).not.toBeNull();
    // Non-surface path: visible h3 is present so aria-label is not added.
    expect(section?.getAttribute("aria-label")).toBeNull();
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
