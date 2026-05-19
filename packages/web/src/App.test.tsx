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
            style: {
              name: "linear",
              description: "Focused tool UI",
              design_md_path: "styles/linear/DESIGN.md",
              variables: {
                primary: "#111827",
                background: "#ffffff",
                "text-primary": "#111827",
                "font-heading": "Inter",
                "font-body": "Inter",
                "border-radius": "8px",
                "spacing-unit": "8px"
              }
            },
            languages: ["en"],
            default_language: "en",
            components_initialized: true
          });
        }
        if (path === "/api/products/P-456def/requirements") {
          return jsonResponse([]);
        }
        return jsonResponse({ error_code: "NOT_FOUND", message: path }, 404);
      })
    );

    window.history.replaceState(
      {
        productDelete: {
          cleanupPending: true,
          productId: "P-123abc",
          recoveryWarnings: ["Recovered orphaned requirement index"],
          sessionCleared: true
        }
      },
      "",
      "/products"
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
    status
  });
}
