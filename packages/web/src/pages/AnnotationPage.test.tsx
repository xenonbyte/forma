// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../LocaleContext.js";
import type { FormaApiClient, RequirementHandoff } from "../api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const canvasKitSurfaceCalls = vi.hoisted(
  () =>
    [] as Array<{
      elements?: unknown[];
      onViewportChange?: (viewport: { offsetX: number; offsetY: number; scale: number }) => void;
      onSelectElement?: (el: { id: string } | null) => void;
      onHoverElement?: (el: { id: string } | null) => void;
    }>,
);

// Mock the WebGL surface — happy-dom has no canvas/WebGL. The adapter pulls
// buildCanvasKitElementTree from the same module, so mock it here too.
vi.mock("@vzi-core/renderer", async () => {
  const React = await import("react");
  return {
    CanvasKitSurface: (props: {
      elements?: unknown[];
      width?: number;
      height?: number;
      viewport?: { offsetX: number; offsetY: number; scale: number };
      onViewportChange?: (viewport: { offsetX: number; offsetY: number; scale: number }) => void;
      onSelectElement?: (el: { id: string } | null) => void;
      onHoverElement?: (el: { id: string } | null) => void;
    }) => {
      canvasKitSurfaceCalls.push({
        elements: props.elements,
        onViewportChange: props.onViewportChange,
        onSelectElement: props.onSelectElement,
        onHoverElement: props.onHoverElement,
      });
      return React.createElement("div", {
        "data-testid": "ck-surface",
        "data-count": (props.elements ?? []).length,
        "data-width": props.width,
        "data-height": props.height,
        "data-viewport-scale": props.viewport ? String(props.viewport.scale) : "",
        "data-viewport-offset-x": props.viewport ? String(props.viewport.offsetX) : "",
        "data-viewport-offset-y": props.viewport ? String(props.viewport.offsetY) : "",
      });
    },
    buildCanvasKitElementTree: (doc: { elements?: Record<string, unknown> }) =>
      Object.values(doc.elements ?? {}).map((e) => ({ ...(e as object), children: [] })),
  };
});

interface DecodedPageContent {
  metadata: Record<string, unknown>;
  elements: Map<string, unknown>;
  images: Map<string, unknown>;
}

function rootContent(): DecodedPageContent {
  return {
    metadata: { formaViewport: { width: 390, height: 800 } },
    elements: new Map([
      [
        "root",
        { id: "root", parentId: null, type: "container", bounds: { x: 0, y: 0, width: 390, height: 800 }, styles: {} },
      ],
    ]),
    images: new Map(),
  };
}

function missingResContent(): DecodedPageContent {
  return {
    metadata: { formaViewport: { width: 64, height: 24 } },
    elements: new Map<string, unknown>([
      [
        "icon",
        {
          id: "icon",
          parentId: null,
          type: "image",
          bounds: { x: 0, y: 0, width: 24, height: 24 },
          styles: {},
          imageData: { src: "icons/missing.svg" },
        },
      ],
      [
        "bundle",
        {
          id: "bundle",
          parentId: null,
          type: "image",
          bounds: { x: 32, y: 0, width: 24, height: 24 },
          styles: {},
          imageData: { src: "assets/missing.png" },
        },
      ],
    ]),
    images: new Map(),
  };
}

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  canvasKitSurfaceCalls.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(
  client: FormaApiClient,
  options: {
    fetchContent?: (url: string) => Promise<DecodedPageContent>;
    checkResourceUrl?: (url: string) => Promise<boolean>;
    onBreadcrumbLabel?: (key: string, label: string) => void;
  } = {},
) {
  const { AnnotationPage } = await import("./AnnotationPage.js");
  const fetchContent = options.fetchContent ?? (async () => rootContent());
  await act(async () => {
    root.render(
      <LocaleProvider>
        <AnnotationPage
          client={client}
          params={{ productId: "P-abc123", reqId: "R-1" }}
          fetchContent={fetchContent}
          checkResourceUrl={options.checkResourceUrl}
          onBreadcrumbLabel={options.onBreadcrumbLabel}
        />
      </LocaleProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function clientWith(handoff: RequirementHandoff, getProduct?: FormaApiClient["getProduct"]): FormaApiClient {
  return {
    getRequirementHandoff: vi.fn(async () => handoff),
    ...(getProduct ? { getProduct } : {}),
  } as unknown as FormaApiClient;
}

function page(over: Partial<RequirementHandoff["pages"][number]> = {}): RequirementHandoff["pages"][number] {
  return {
    pageId: "home",
    artifactId: "A",
    variant: "default",
    version: 1,
    title: "Home",
    iconCount: 0,
    vziUrl: "/v",
    contentUrl: "/c",
    iconBaseUrl: "/api/products/P-abc123/artifacts/A/icons/",
    bundleBaseUrl: "/api/products/P-abc123/artifacts/A/versions/1/bundle/",
    ...over,
  };
}

type TestResizeObserverInstance = {
  callback: (entries: Array<{ contentRect: { width: number; height: number } }>) => void;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

function stubResizeObserver(): TestResizeObserverInstance[] {
  const instances: TestResizeObserverInstance[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: TestResizeObserverInstance["callback"];
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: TestResizeObserverInstance["callback"]) {
        this.callback = callback;
        instances.push(this);
      }
    },
  );
  return instances;
}

describe("AnnotationPage", () => {
  it("annotation canvas is light with WCAG-AA labels, behaviors unchanged", async () => {
    const instances = stubResizeObserver();

    await render(clientWith({ pages: [page()], errors: [] }));

    // 1. Canvas container background must be white / near-white (BC1).
    const canvasContainer = container.querySelector<HTMLElement>('[data-testid="ck-surface"]')?.closest(
      ".relative.flex-1",
    ) as HTMLElement | null;
    expect(canvasContainer).not.toBeNull();
    const bg = canvasContainer!.style.background || canvasContainer!.style.backgroundColor;
    expect(bg).toMatch(/#ffffff|#fafafa/i);

    // 2. Dot-grid must use dark dots (not white) on the light canvas.
    const dotGrid = canvasContainer!.querySelector<HTMLElement>(".pointer-events-none.absolute.inset-0.z-0");
    expect(dotGrid).not.toBeNull();
    // The backgroundImage must use dark dots (rgba(0,0,0,...)), not white dots (255,255,255).
    expect(dotGrid!.style.backgroundImage).toMatch(/rgba\(0,\s*0,\s*0/i);
    expect(dotGrid!.style.backgroundImage).not.toMatch(/rgba\(255,\s*255,\s*255/i);

    // 3. Container border should be light (border-zinc-200), not the old dark zinc-700.
    expect(canvasContainer!.className).toContain("border-zinc-200");
    expect(canvasContainer!.className).not.toContain("border-zinc-700");

    // 4. Behavior: surface still renders after resize (unchanged selection/hover/fit).
    await act(async () => {
      instances[0].callback([{ contentRect: { width: 800, height: 600 } }]);
      await Promise.resolve();
      await Promise.resolve();
    });
    const surface = container.querySelector('[data-testid="ck-surface"]');
    expect(surface).not.toBeNull();
    expect(surface?.getAttribute("data-width")).toBe("800");
    expect(surface?.getAttribute("data-height")).toBe("600");
  });

  it("shows an empty state (no surface) when there are no handoff pages", async () => {
    await render(clientWith({ pages: [], errors: [] }));
    expect(container.querySelector('[data-testid="ck-surface"]')).toBeNull();
    expect(container.textContent && container.textContent.length).toBeTruthy();
  });

  it("renders the CanvasKit surface when pages decode", async () => {
    await render(clientWith({ pages: [page()], errors: [] }));
    expect(container.querySelector('[data-testid="ck-surface"]')).not.toBeNull();
  });

  it("observes the ready canvas container after loading before sizing the surface", async () => {
    const instances = stubResizeObserver();

    await render(clientWith({ pages: [page()], errors: [] }));

    expect(instances).toHaveLength(1);
    expect(instances[0].observe).toHaveBeenCalledWith(expect.any(HTMLDivElement));

    await act(async () => {
      instances[0].callback([{ contentRect: { width: 640, height: 480 } }]);
    });

    const surface = container.querySelector('[data-testid="ck-surface"]');
    expect(surface?.getAttribute("data-width")).toBe("640");
    expect(surface?.getAttribute("data-height")).toBe("480");
  });

  it("waits for a measured canvas size before fitting the initial viewport", async () => {
    const instances = stubResizeObserver();

    await render(clientWith({ pages: [page()], errors: [] }));

    let surface = container.querySelector('[data-testid="ck-surface"]');
    expect(surface?.getAttribute("data-viewport-scale")).toBe("");

    await act(async () => {
      instances[0].callback([{ contentRect: { width: 640, height: 480 } }]);
      await Promise.resolve();
      await Promise.resolve();
    });

    surface = container.querySelector('[data-testid="ck-surface"]');
    expect(Number(surface?.getAttribute("data-viewport-scale"))).toBeCloseTo(0.552, 3);
    expect(Number(surface?.getAttribute("data-viewport-offset-x"))).toBeCloseTo(212.36, 2);
    expect(Number(surface?.getAttribute("data-viewport-offset-y"))).toBe(28);
  });

  it("keeps CanvasKit elements stable across viewport-only updates when no resources are missing", async () => {
    await render(clientWith({ pages: [page()], errors: [] }));

    const initialCall = canvasKitSurfaceCalls.at(-1);
    const initialElements = initialCall?.elements;
    if (!initialElements || !initialCall?.onViewportChange) {
      throw new Error("CanvasKitSurface did not render with viewport callback");
    }

    await act(async () => {
      initialCall.onViewportChange?.({ offsetX: 12, offsetY: 34, scale: 0.75 });
      await Promise.resolve();
    });

    expect(canvasKitSurfaceCalls.at(-1)?.elements).toBe(initialElements);
  });

  it("records missing icon and bundle resources but still renders the page", async () => {
    await render(clientWith({ pages: [page()], errors: [] }), {
      fetchContent: async () => missingResContent(),
      checkResourceUrl: async () => false,
    });
    expect(container.querySelector('[data-testid="ck-surface"]')).not.toBeNull();
    expect(container.textContent).toContain("icons/missing.svg");
    expect(container.textContent).toContain("assets/missing.png");
    expect(container.textContent).toContain("Missing resource");
  });

  // B4: reports product name via onBreadcrumbLabel on successful getProduct.
  it("reports the product name for the canvas shell via onBreadcrumbLabel", async () => {
    const labels: Record<string, string> = {};
    const onBreadcrumbLabel = (k: string, v: string) => {
      labels[k] = v;
    };
    const getProduct: FormaApiClient["getProduct"] = async () => ({
      id: "P-abc123",
      name: "My Annotation Product",
      description: "",
      platform: "web",
    });

    await render(clientWith({ pages: [page()], errors: [] }, getProduct), { onBreadcrumbLabel });

    expect(labels["product:P-abc123"]).toBe("My Annotation Product");
  });

  it("reports the product name for the canvas shell when the handoff has no pages", async () => {
    const labels: Record<string, string> = {};
    const onBreadcrumbLabel = (k: string, v: string) => {
      labels[k] = v;
    };
    const getProduct: FormaApiClient["getProduct"] = async () => ({
      id: "P-abc123",
      name: "Empty Annotation Product",
      description: "",
      platform: "web",
    });

    await render(clientWith({ pages: [], errors: [] }, getProduct), { onBreadcrumbLabel });

    expect(labels["product:P-abc123"]).toBe("Empty Annotation Product");
    expect(container.textContent).toContain("No handoff pages");
  });

  // B4: on getProduct failure, console.warn + reports canvas.productUnavailable label.
  it("warns and reports productUnavailable label when getProduct rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const labels: Record<string, string> = {};
    const onBreadcrumbLabel = (k: string, v: string) => {
      labels[k] = v;
    };
    const getProduct: FormaApiClient["getProduct"] = async () => {
      throw new Error("product fetch failed");
    };

    await render(clientWith({ pages: [page()], errors: [] }, getProduct), { onBreadcrumbLabel });

    expect(warnSpy).toHaveBeenCalled();
    // Label should be the unavailable fallback, not pending/undefined.
    expect(labels["product:P-abc123"]).toBe("Product unavailable");
  });

  // Review fix: the handoff load fails before the product fetch runs — the outer catch
  // must still report the productUnavailable label so the shell top bar doesn't stay on "Loading product".
  it("warns and reports productUnavailable label when the handoff load rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const labels: Record<string, string> = {};
    const onBreadcrumbLabel = (k: string, v: string) => {
      labels[k] = v;
    };
    const client = {
      getRequirementHandoff: vi.fn(async () => {
        throw new Error("handoff load failed");
      }),
      getProduct: vi.fn(async () => {
        throw new Error("getProduct should not run when the handoff load fails");
      }),
    } as unknown as FormaApiClient;

    await render(client, { onBreadcrumbLabel });

    expect(warnSpy).toHaveBeenCalled();
    expect(labels["product:P-abc123"]).toBe("Product unavailable");
  });

  it("keeps a failed content fetch as a marked frame while rendering another page", async () => {
    const instances = stubResizeObserver();

    await render(
      clientWith({
        pages: [
          page({ pageId: "home", artifactId: "A", title: "Home", contentUrl: "/ok" }),
          page({ pageId: "settings", artifactId: "B", title: "Settings", contentUrl: "/missing" }),
        ],
        errors: [],
      }),
      {
        fetchContent: async (url) => {
          if (url === "/missing") throw new Error("HTTP 404");
          return rootContent();
        },
      },
    );
    await act(async () => {
      instances[0].callback([{ contentRect: { width: 640, height: 480 } }]);
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="ck-surface"]')).not.toBeNull();
    expect(container.textContent).toContain("Settings");
    expect(container.textContent).toContain("HTTP 404");
  });

  // C1: focused label shows platform icon (svg[data-platform]) and uses indigo.
  it("focused page label renders the platform icon and uses text-indigo-600", async () => {
    const instances = stubResizeObserver();

    const getProduct: FormaApiClient["getProduct"] = async () => ({
      id: "P-abc123",
      name: "My Product",
      description: "",
      platform: "mobile",
    });

    await render(clientWith({ pages: [page()], errors: [] }, getProduct));

    // Trigger resize so hasMeasuredSize=true, which fires fitViewport → sets viewport.
    await act(async () => {
      instances[0].callback([{ contentRect: { width: 640, height: 480 } }]);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Trigger an element selection so the page becomes focused (focusedKeys gets an entry).
    // "root" is the element id in rootContent(); it matches via content.elements.has("root").
    const lastCall = canvasKitSurfaceCalls.at(-1);
    if (!lastCall?.onSelectElement) throw new Error("onSelectElement not captured in mock");
    await act(async () => {
      lastCall.onSelectElement?.({ id: "root" });
      await Promise.resolve();
    });

    // The focused label div has z-30, truncate, text-xs font-medium, and the color class.
    const labels = container.querySelectorAll<HTMLElement>(
      ".pointer-events-none.absolute.z-30.truncate.text-xs.font-medium",
    );
    // Find the focused one (should contain "text-indigo-600").
    const focused = Array.from(labels).find((el) => el.className.includes("text-indigo-600"));
    expect(focused).not.toBeUndefined();
    expect(focused!.className).toContain("text-indigo-600");
    expect(focused!.querySelector("svg[data-platform='mobile']")).not.toBeNull();
  });

  // Fix: the focused page selection is a 2px indigo (#4f46e5) border hugging the design
  // (border only — no padding ring, no fill, no frosted backdrop).
  it("focused page draws an indigo border-only selection that hugs the design", async () => {
    const instances = stubResizeObserver();
    await render(clientWith({ pages: [page()], errors: [] }));
    await act(async () => {
      instances[0].callback([{ contentRect: { width: 640, height: 480 } }]);
      await Promise.resolve();
      await Promise.resolve();
    });
    const lastCall = canvasKitSurfaceCalls.at(-1);
    if (!lastCall?.onSelectElement) throw new Error("onSelectElement not captured in mock");
    await act(async () => {
      lastCall.onSelectElement?.({ id: "root" });
      await Promise.resolve();
    });
    const frame = container.querySelector<HTMLElement>('[data-testid="annotation-focus-frame"]');
    expect(frame).not.toBeNull();
    // indigo #4f46e5 appears in the border (any form the env normalizes it to).
    const styleText = `${frame!.style.border} ${frame!.style.borderColor} ${frame!.style.cssText}`.toLowerCase();
    expect(styleText).toMatch(/#4f46e5|79,\s?70,\s?229/);
    // frosted backdrop blur is gone.
    expect(frame!.style.backdropFilter || "").toBe("");
    // border only — no fill tinting the design underneath.
    expect(frame!.style.background || frame!.style.backgroundColor || "").toBe("");
  });
});
