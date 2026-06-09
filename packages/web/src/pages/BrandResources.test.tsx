// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const canvasSpy = vi.hoisted(() => vi.fn());

// Replace Canvas with a stub that records props; keep buildViewerModel and other exports real.
vi.mock("@xenonbyte/forma-viewer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xenonbyte/forma-viewer")>();
  return {
    ...actual,
    Canvas: (props: unknown) => {
      canvasSpy(props);
      return createElement("div", { "data-testid": "canvas" });
    },
  };
});

import { BrandResources, type BrandResourcesClient } from "./BrandResources.js";
import { mapBrandResourcesArtifact } from "../viewer/brandResourcesMapper.js";
import type { ArtifactDetail, Product } from "../api.js";

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
  canvasSpy.mockClear();
});

// ── fixtures ──────────────────────────────────────────────────────────────────

const PRODUCT_ID = "prod-1";
const ARTIFACT_ID = "art-lib-1";
const CURRENT_VERSION = 3;

const productWithPointer: Product = {
  id: PRODUCT_ID,
  name: "My Product",
  description: "desc",
  platform: "web",
  designSystemArtifactId: ARTIFACT_ID,
};

const productNoPointer: Product = {
  id: PRODUCT_ID,
  name: "My Product",
  description: "desc",
  platform: "web",
};

const artifactDetail: ArtifactDetail = {
  manifest: {
    id: ARTIFACT_ID,
    kind: "component-library",
    title: "Component Library",
    entry: "index.html",
    status: "done",
    exports: [],
    forma: {
      productIcon: {
        primary: "assets/icon.svg",
        monochrome: "assets/icon-mono.svg",
        shape: {
          shapeId: "sh1",
          geometry: "<path/>",
          sourceVersion: "1",
        },
      },
    },
  },
  current_version: CURRENT_VERSION,
  versions: [1, 2, 3],
};

const artifactDetailNoIcon: ArtifactDetail = {
  manifest: {
    id: ARTIFACT_ID,
    kind: "component-library",
    title: "Component Library",
    entry: "index.html",
    status: "done",
    exports: [],
  },
  current_version: CURRENT_VERSION,
};

// ── client helpers ────────────────────────────────────────────────────────────

function fakeClient(overrides: Partial<BrandResourcesClient> = {}): BrandResourcesClient {
  return {
    getProduct: async () => productWithPointer,
    getProductArtifact: async () => artifactDetail,
    getArtifactVersionBundleAssetUrl: (productId, artifactId, version, relativePath) =>
      `/api/products/${productId}/artifacts/${artifactId}/versions/${version}/bundle/${relativePath}`,
    ...overrides,
  };
}

// ── test infra ────────────────────────────────────────────────────────────────

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

// ── tests ─────────────────────────────────────────────────────────────────────

describe("BrandResources", () => {
  // TEST-BC3-001: with-pointer → brand-tile (Canvas) + product-icon-tile (img from manifest) present.
  it("renders component-library Canvas and product-icon tile when designSystemArtifactId is set", async () => {
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<BrandResources client={fakeClient()} params={{ productId: PRODUCT_ID }} />);
      await flushPromises();
    });

    // Canvas wrapper must be present
    const brandTile = container.querySelector("[data-testid='brand-tile']");
    expect(brandTile).not.toBeNull();

    // Canvas stub inside brand-tile
    expect(brandTile?.querySelector("[data-testid='canvas']") ?? container.querySelector("[data-testid='canvas']")).not.toBeNull();
    expect(canvasSpy).toHaveBeenCalled();

    // ICON tile: <img data-testid="product-icon-tile"> from manifest.forma.productIcon, NOT HTML parsing
    const iconTile = container.querySelector("[data-testid='product-icon-tile']") as HTMLImageElement | null;
    expect(iconTile).not.toBeNull();
    expect(iconTile?.tagName.toLowerCase()).toBe("img");
    // URL must include the bundle-relative path from manifest.forma.productIcon.primary
    expect(iconTile?.src).toContain("assets/icon.svg");
  });

  // TEST-BC3-002: no-pointer → empty state mentioning fm-refine-components; no Canvas.
  it("renders empty state with fm-refine-components hint when designSystemArtifactId is unset", async () => {
    const client = fakeClient({
      getProduct: async () => productNoPointer,
    });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<BrandResources client={client} params={{ productId: PRODUCT_ID }} />);
      await flushPromises();
    });

    // No Canvas in empty state
    expect(canvasSpy).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='canvas']")).toBeNull();

    // Empty state text must reference fm-refine-components
    expect(container.textContent).toMatch(/fm-refine-components/);
  });

  // TEST-BC3-003: ICON absence tolerance — no productIcon in manifest → no icon tile, no throw.
  it("renders Canvas without product-icon-tile when manifest.forma.productIcon is absent", async () => {
    const client = fakeClient({
      getProductArtifact: async () => artifactDetailNoIcon,
    });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<BrandResources client={client} params={{ productId: PRODUCT_ID }} />);
      await flushPromises();
    });

    expect(container.querySelector("[data-testid='brand-tile']")).not.toBeNull();
    expect(container.querySelector("[data-testid='product-icon-tile']")).toBeNull();
  });

  // TEST-BC3-004: loading state shown while requests are pending.
  it("shows loading state while requests are pending", async () => {
    const never = new Promise<never>(() => {});
    const client = fakeClient({
      getProduct: () => never as unknown as Promise<Product>,
    });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<BrandResources client={client} params={{ productId: PRODUCT_ID }} />);
    });

    expect(container.querySelector("[data-testid='canvas']")).toBeNull();
    // Should show some loading indicator
    expect(container.textContent?.toLowerCase()).toMatch(/load/i);
  });

  // TEST-BC3-005: error state when getProduct fails.
  it("shows error state when loading fails", async () => {
    const client = fakeClient({
      getProduct: async () => {
        throw new Error("network error");
      },
    });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<BrandResources client={client} params={{ productId: PRODUCT_ID }} />);
      await flushPromises();
    });

    expect(canvasSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain("network error");
  });

  // TEST-BC3-006: viewer model entry is "page" and group key is "brand-resources".
  it("passes a viewer model with group pageId brand-resources to Canvas", async () => {
    const { container: _c, root } = createTestRoot();

    await act(async () => {
      root.render(<BrandResources client={fakeClient()} params={{ productId: PRODUCT_ID }} />);
      await flushPromises();
    });

    expect(canvasSpy).toHaveBeenCalled();
    const props = canvasSpy.mock.calls.at(-1)?.[0] as { model: { groups: Array<{ pageId: string }>; entry: string } };
    expect(props.model.groups[0].pageId).toBe("brand-resources");
    expect(props.model.entry).toBe("page");
  });
});

// ── mapper unit tests ─────────────────────────────────────────────────────────

describe("mapBrandResourcesArtifact", () => {
  it("produces a NormalizeArtifactInput with group key brand-resources and kind component-library", () => {
    const input = mapBrandResourcesArtifact({
      artifactId: ARTIFACT_ID,
      title: "Component Library",
      version: CURRENT_VERSION,
      platform: "web",
    });

    expect(input.kind).toBe("component-library");
    expect(input.pageId).toBe("brand-resources");
    expect(input.pageName).toBe("brand-resources");
    expect(input.variant).toBe("default");
    expect(input.artifactId).toBe(ARTIFACT_ID);
    expect(input.version).toBe(CURRENT_VERSION);
    expect(typeof input.width).toBe("number");
    expect(typeof input.height).toBe("number");
    expect(input.width).toBeGreaterThan(0);
    expect(input.height).toBeGreaterThan(0);
  });

  it("uses canvasSizeForPlatform to derive width/height consistently", () => {
    const web = mapBrandResourcesArtifact({ artifactId: "a", title: "T", version: 1, platform: "web" });
    const mobile = mapBrandResourcesArtifact({ artifactId: "a", title: "T", version: 1, platform: "mobile" });

    // mobile platform should have a narrower width than web/desktop
    expect(mobile.width).toBeLessThan(web.width);
  });

  it("falls back to web dimensions when platform is undefined", () => {
    const fallback = mapBrandResourcesArtifact({ artifactId: "a", title: "T", version: 1, platform: undefined });
    const web = mapBrandResourcesArtifact({ artifactId: "a", title: "T", version: 1, platform: "web" });
    expect(fallback.width).toBe(web.width);
    expect(fallback.height).toBe(web.height);
  });
});
