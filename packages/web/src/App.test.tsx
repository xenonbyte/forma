// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const containers: HTMLElement[] = [];

beforeEach(() => {
  window.history.replaceState({}, "", "/products");
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
  vi.unstubAllGlobals();
});

describe("App routing", () => {
  it("renders fullscreen canvas routes without the sidebar Layout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error_code: "NOT_FOUND", message: "" }, 404)));

    window.history.pushState({}, "", "/products/P1/brand");
    const { container, root } = createTestRoot();
    await act(async () => {
      root.render(<App />);
      await flushPromises();
    });

    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector("[data-testid='canvas-shell']")).not.toBeNull();
  });

  // B4: canvas shell shows real product name (from getProduct) not just the raw id.
  it("populates breadcrumbLabels from getProduct on the brand route, not the raw product id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = input.toString();
        if (path === "/api/products/P1") {
          return jsonResponse({
            id: "P1",
            name: "Brand Test Product",
            description: "",
            platform: "web",
          });
        }
        // Anything else (artifact, handoff, etc.) → 404 so BrandResources goes empty/error.
        return jsonResponse({ error_code: "NOT_FOUND", message: path }, 404);
      }),
    );

    window.history.pushState({}, "", "/products/P1/brand");
    const { container, root } = createTestRoot();
    await act(async () => {
      root.render(<App />);
      await flushPromises();
    });

    // The canvas shell header must show the product name, not the raw id "P1".
    expect(container.querySelector("[data-testid='canvas-shell']")).not.toBeNull();
    expect(container.textContent).toContain("Brand Test Product");
    expect(container.textContent).not.toContain("Loading product");
  });

  // B4: on getProduct failure, canvas shell shows "Product unavailable" (not "Loading product" forever).
  it("shows productUnavailable label in the canvas shell when getProduct rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error_code: "NOT_FOUND", message: "" }, 404)));

    window.history.pushState({}, "", "/products/P1/brand");
    const { container, root } = createTestRoot();
    await act(async () => {
      root.render(<App />);
      await flushPromises();
    });

    expect(container.querySelector("[data-testid='canvas-shell']")).not.toBeNull();
    // After failure, the shell should NOT stay stuck on "Loading product".
    // It should show "Product unavailable" instead.
    expect(container.textContent).not.toContain("Loading product");
    expect(container.textContent).toContain("Product unavailable");
  });

  it("passes delete navigation state to the product list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = input.toString();
        if (path === "/api/products") {
          return jsonResponse([{ id: "P-456def", name: "Admin App", description: "Internal admin" }]);
        }
        if (path === "/api/products/P-456def") {
          return jsonResponse({
            id: "P-456def",
            name: "Admin App",
            description: "Internal admin",
            platform: "web",
            brand_style: "linear",
            languages: ["en"],
            default_language: "en",
          });
        }
        if (path === "/api/products/P-456def/requirements") {
          return jsonResponse([]);
        }
        return jsonResponse({ error_code: "NOT_FOUND", message: path }, 404);
      }),
    );

    window.history.replaceState(
      {
        productDelete: {
          cleanupPending: true,
          productId: "P-123abc",
          recoveryWarnings: ["Recovered orphaned requirement index"],
          sessionCleared: true,
        },
      },
      "",
      "/products",
    );

    const { container, root } = createTestRoot();
    await act(async () => {
      root.render(<App />);
      await flushPromises();
    });

    expect(container.textContent).toContain("Deleted product P-123abc");
    expect(container.textContent).toContain("Session was cleared.");
    expect(container.textContent).toContain("Cleanup is still pending.");
    expect(container.textContent).toContain("Recovery warnings: Recovered orphaned requirement index");
    expect(window.history.state).toEqual({});
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
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
