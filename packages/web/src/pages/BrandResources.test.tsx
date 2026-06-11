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

const productMobile: Product = {
  id: PRODUCT_ID,
  name: "计算器",
  description: "desc",
  platform: "mobile",
  designSystemArtifactId: "lib",
};

const productNoPointer: Product = {
  id: PRODUCT_ID,
  name: "My Product",
  description: "desc",
  platform: "web",
};

/** Artifact with two units — used by E2 unit-rendering tests. */
const artifactDetailWithUnits: ArtifactDetail = {
  manifest: {
    id: ARTIFACT_ID,
    kind: "component-library",
    title: "Component Library",
    entry: "index.html",
    status: "done",
    exports: [],
    forma: {
      platform: "mobile",
      units: [
        { id: "foundations", title: "Foundations", role: "foundations", entry: "unit-foundations.html" },
        { id: "button", title: "Button", role: "component", entry: "unit-button.html" },
      ],
    },
  },
  current_version: CURRENT_VERSION,
  versions: [1, 2, 3],
};

/** Artifact with no units — library exists but forma.units is absent. */
const artifactDetailNoUnits: ArtifactDetail = {
  manifest: {
    id: ARTIFACT_ID,
    kind: "component-library",
    title: "Component Library",
    entry: "index.html",
    status: "done",
    exports: [],
    forma: {},
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
    forma: {
      units: [
        { id: "foundations", title: "Foundations", role: "foundations", entry: "unit-foundations.html" },
      ],
    },
  },
  current_version: CURRENT_VERSION,
};

// ── client helpers ────────────────────────────────────────────────────────────

function fakeClient(overrides: Partial<BrandResourcesClient> = {}): BrandResourcesClient {
  return {
    getProduct: async () => productWithPointer,
    getProductArtifact: async () => artifactDetailWithUnits,
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
  // E2: renders one tile (iframe) per component-library unit.
  it("renders one tile per component-library unit", async () => {
    const client = fakeClient({
      getProduct: async () => productMobile,
      getProductArtifact: async () => artifactDetailWithUnits,
    });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<BrandResources client={client} params={{ productId: PRODUCT_ID }} />);
      await flushPromises();
    });

    // Canvas stub must be rendered (ready state)
    expect(canvasSpy).toHaveBeenCalled();
    const brandTile = container.querySelector("[data-testid='brand-tile']");
    expect(brandTile).not.toBeNull();

    // The viewer model passed to Canvas must have 2 tiles (one per unit)
    const props = canvasSpy.mock.calls.at(-1)?.[0] as {
      model: { groups: Array<{ tileIds: string[] }> };
    };
    expect(props.model.groups[0].tileIds.length).toBe(2);
  });

  // E2: shows explicit empty state when library has no units.
  it("shows an empty state when the library has no units", async () => {
    const client = fakeClient({
      getProductArtifact: async () => artifactDetailNoUnits,
    });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<BrandResources client={client} params={{ productId: PRODUCT_ID }} />);
      await flushPromises();
    });

    // No Canvas rendered
    expect(canvasSpy).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='canvas']")).toBeNull();

    // Must show the no-units help message
    expect(container.textContent).toContain(
      "This component library has no units yet. Run fm-refine-components to regenerate it.",
    );
  });

  // TEST-BC3-001: with-pointer + units → brand-tile (Canvas) present; standalone icon img removed in B4.
  it("renders component-library Canvas when designSystemArtifactId is set", async () => {
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

    // B4: standalone product-icon-tile img removed; it becomes a canvas tile in E2.
    expect(container.querySelector("[data-testid='product-icon-tile']")).toBeNull();
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

  // B4: reports the product name via onBreadcrumbLabel; no standalone icon img.
  it("reports the product name for the canvas shell and renders no standalone icon img", async () => {
    const labels: Record<string, string> = {};
    const onBreadcrumbLabel = (k: string, v: string) => {
      labels[k] = v;
    };
    const { container: _c, root } = createTestRoot();

    await act(async () => {
      root.render(
        <BrandResources
          client={fakeClient()}
          onBreadcrumbLabel={onBreadcrumbLabel}
          params={{ productId: PRODUCT_ID }}
        />,
      );
      await flushPromises();
    });

    expect(labels[`product:${PRODUCT_ID}`]).toBe("My Product");
    // Standalone product-icon tile removed in B4 (becomes canvas tile in E2).
    expect(_c.querySelector("[data-testid='product-icon-tile']")).toBeNull();
  });

  // B4: on getProduct failure, console.warn + reports canvas.productUnavailable label.
  it("warns and reports productUnavailable label when getProduct rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const labels: Record<string, string> = {};
    const onBreadcrumbLabel = (k: string, v: string) => {
      labels[k] = v;
    };
    const client = fakeClient({
      getProduct: async () => {
        throw new Error("product fetch failed");
      },
    });
    const { root } = createTestRoot();

    await act(async () => {
      root.render(
        <BrandResources
          client={client}
          onBreadcrumbLabel={onBreadcrumbLabel}
          params={{ productId: PRODUCT_ID }}
        />,
      );
      await flushPromises();
    });

    expect(warnSpy).toHaveBeenCalled();
    expect(labels[`product:${PRODUCT_ID}`]).toBe("Product unavailable");
  });

  it("preserves loaded product label when component-library artifact load rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const labels: Record<string, string> = {};
    const onBreadcrumbLabel = (k: string, v: string) => {
      labels[k] = v;
    };
    const client = fakeClient({
      getProductArtifact: async () => {
        throw new Error("artifact fetch failed");
      },
    });
    const { root } = createTestRoot();

    await act(async () => {
      root.render(
        <BrandResources
          client={client}
          onBreadcrumbLabel={onBreadcrumbLabel}
          params={{ productId: PRODUCT_ID }}
        />,
      );
      await flushPromises();
    });

    expect(warnSpy).toHaveBeenCalled();
    expect(labels[`product:${PRODUCT_ID}`]).toBe("My Product");
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
