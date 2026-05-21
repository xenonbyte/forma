// @vitest-environment happy-dom

import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductList, ProductListContent } from "./ProductList.js";
import { ApiError, type FormaApiClient, type Product, type RequirementWithDocument, type StyleMetadata } from "../api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const style: StyleMetadata = {
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
};

const configuredProduct: Product = {
  id: "P-123abc",
  name: "Checkout App",
  description: "Mobile checkout workbench",
  platform: "web",
  style,
  languages: ["en"],
  default_language: "en",
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
  vi.unstubAllGlobals();
});

describe("ProductList", () => {
  it("renders skeleton rows while loading instead of plain loading copy", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductList />);
      await flushPromises();
    });

    expect(container.querySelector('[data-skeleton="list"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Loading products, configuration state, and latest requirement status.");
  });

  it("renders cleanup notices from delete navigation state after detail navigation", async () => {
    const client = createListClient();
    const { container, root } = createTestRoot();
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

    await act(async () => {
      root.render(
        <ProductList
          client={client}
          navigationState={{
            productDelete: {
              cleanupPending: true,
              productId: "P-123abc",
              recoveryWarnings: ["Recovered orphaned requirement index"],
              sessionCleared: true
            }
          }}
        />
      );
      await flushPromises();
    });

    expect(container.textContent).toContain("Deleted product P-123abc");
    expect(container.textContent).toContain("Session was cleared.");
    expect(container.textContent).toContain("Cleanup is still pending.");
    expect(container.textContent).toContain("Recovery warnings: Recovered orphaned requirement index");
    expect(window.history.state).toEqual({});
  });
});

describe("ProductListContent", () => {
  it("renders product cards with isolated requirement summaries", () => {
    const html = renderToStaticMarkup(
      <ProductListContent
        products={[{ id: "P-123abc", name: "Checkout App", description: "Mobile checkout workbench" }]}
        requirementSummaries={{
          "P-123abc": {
            count: 2,
            latest: {
              id: "R-12345678",
              product_id: "P-123abc",
              title: "Checkout",
              status: "active",
              created_at: "2026-05-17T00:00:00.000Z",
              updated_at: "2026-05-17T01:00:00.000Z",
              pages: [],
              navigation: [],
              document_md: "# Checkout"
            }
          }
        }}
      />
    );

    expect(html).toContain("Checkout App");
    expect(html).toContain("Mobile checkout workbench");
    expect(html).toContain("2 requirements");
    expect(html).toContain("Active");
    expect(html).toContain('href="/products/P-123abc"');
    expect(html).toContain('data-product-status-stripe="not_loaded"');
    expect(html).toContain('data-product-inline-badge="requirements"');
    expect(html).toContain('data-product-inline-badge="latest-status"');
    expect(html).toContain("Delete");
  });

  it("renders the empty state when no products are loaded", () => {
    const html = renderToStaticMarkup(<ProductListContent products={[]} requirementSummaries={{}} />);

    expect(html).toContain("No products");
    expect(html).toContain('href="/products/new"');
    expect(html).toContain('data-empty-illustration="products"');
    expect(html).toContain('aria-label="Product empty state"');
  });

  it("renders a requirement creation entry when a product has no latest requirement", () => {
    const html = renderToStaticMarkup(
      <ProductListContent
        products={[{ id: "P-123abc", name: "Checkout App", description: "Mobile checkout workbench" }]}
        requirementSummaries={{
          "P-123abc": {
            count: 0
          }
        }}
      />
    );

    expect(html).toContain("Create requirement");
    expect(html).toContain('href="/products/P-123abc#new-requirement"');
  });

  it("marks products with incomplete language configuration as configuration incomplete", () => {
    const html = renderToStaticMarkup(
      <ProductListContent
        productDetails={{
          "P-123abc": {
            product: {
              id: "P-123abc",
              name: "Checkout App",
              description: "Mobile checkout workbench",
              platform: "web",
              style,
            }
          }
        }}
        products={[{ id: "P-123abc", name: "Checkout App", description: "Mobile checkout workbench" }]}
        requirementSummaries={{ "P-123abc": { count: 0 } }}
      />
    );

    expect(html).toContain("Configuration incomplete");
  });

  it("marks products without initialized components as configured when list configuration is complete", () => {
    const html = renderToStaticMarkup(
      <ProductListContent
        productDetails={{
          "P-123abc": {
            product: {
              id: "P-123abc",
              name: "Checkout App",
              description: "Mobile checkout workbench",
              platform: "web",
              style,
              languages: ["en", "zh-CN"],
              default_language: "en",
            }
          }
        }}
        products={[{ id: "P-123abc", name: "Checkout App", description: "Mobile checkout workbench" }]}
        requirementSummaries={{ "P-123abc": { count: 0 } }}
      />
    );

    expect(html).toContain("Configured");
    expect(html).not.toContain("Configuration incomplete");
  });

  it("marks products with missing component initialization state as configured when list configuration is complete", () => {
    const html = renderToStaticMarkup(
      <ProductListContent
        productDetails={{
          "P-123abc": {
            product: {
              id: "P-123abc",
              name: "Checkout App",
              description: "Mobile checkout workbench",
              platform: "web",
              style,
              languages: ["en", "zh-CN"],
              default_language: "en"
            }
          }
        }}
        products={[{ id: "P-123abc", name: "Checkout App", description: "Mobile checkout workbench" }]}
        requirementSummaries={{ "P-123abc": { count: 0 } }}
      />
    );

    expect(html).toContain("Configured");
    expect(html).not.toContain("Configuration incomplete");
  });

  it("deletes a product from local state and shows cleanup notices", async () => {
    const client = createDeleteClient();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <ProductListContent
          client={client}
          products={[
            { id: "P-123abc", name: "Checkout App", description: "Mobile checkout workbench" },
            { id: "P-456def", name: "Admin App", description: "Internal admin" }
          ]}
          requirementSummaries={{ "P-123abc": { count: 0 }, "P-456def": { count: 0 } }}
        />
      );
      await flushPromises();
    });

    expect(container.querySelectorAll('[data-product-card="true"]')).toHaveLength(2);

    await act(async () => {
      required(container.querySelector<HTMLButtonElement>('[data-product-delete="P-123abc"]'), "delete action").click();
      await flushPromises();
    });

    const input = required(container.querySelector<HTMLInputElement>('input[name="confirm_product_id"]'), "confirmation input");
    await act(async () => {
      setInputValue(input, "P-123abc");
      required(container.querySelector<HTMLButtonElement>('[data-confirm-delete-final="true"]'), "final delete button").click();
      await flushPromises();
    });

    expect(client.deleteProduct).toHaveBeenCalledWith("P-123abc", { confirm_product_id: input.value });
    expect(container.textContent).not.toContain("Checkout App");
    expect(container.textContent).toContain("Admin App");
    expect(container.querySelectorAll('[data-product-card="true"]')).toHaveLength(1);
    expect(container.textContent).toContain("Session was cleared.");
    expect(container.textContent).toContain("Cleanup is still pending.");
    expect(container.textContent).toContain("Recovery warnings: Recovered orphaned requirement index");
  });

  it("keeps the product visible and shows delete errors", async () => {
    const client = createDeleteClient();
    client.deleteProduct.mockRejectedValueOnce(new ApiError("DELETE_FAILED", "Deletion denied", {}, 409));
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <ProductListContent
          client={client}
          products={[{ id: "P-123abc", name: "Checkout App", description: "Mobile checkout workbench" }]}
          requirementSummaries={{ "P-123abc": { count: 0 } }}
        />
      );
      await flushPromises();
    });

    await act(async () => {
      required(container.querySelector<HTMLButtonElement>('[data-product-delete="P-123abc"]'), "delete action").click();
      await flushPromises();
    });

    await act(async () => {
      setInputValue(required(container.querySelector<HTMLInputElement>('input[name="confirm_product_id"]'), "confirmation input"), "P-123abc");
      required(container.querySelector<HTMLButtonElement>('[data-confirm-delete-final="true"]'), "final delete button").click();
      await flushPromises();
    });

    expect(container.textContent).toContain("Checkout App");
    expect(container.textContent).toContain("DELETE_FAILED - Deletion denied");
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

function createDeleteClient() {
  return {
    deleteProduct: vi.fn(async () => ({
      product_id: "P-123abc",
      deleted: true as const,
      session_cleared: true,
      cleanup_pending: true,
      recovery_warnings: ["Recovered orphaned requirement index"]
    }))
  } satisfies Pick<FormaApiClient, "deleteProduct">;
}

function createListClient() {
  const products = [{ id: "P-456def", name: "Admin App", description: "Internal admin" }];
  const requirements: RequirementWithDocument[] = [];

  return {
    deleteProduct: vi.fn(),
    getProduct: vi.fn(async (productId: string) => ({ ...configuredProduct, id: productId })),
    listProducts: vi.fn(async () => products),
    listRequirements: vi.fn(async () => requirements)
  } satisfies Pick<FormaApiClient, "deleteProduct" | "getProduct" | "listProducts" | "listRequirements">;
}

function required<T extends Element>(element: T | null, label: string): T {
  if (!element) {
    throw new Error(`Missing ${label}`);
  }
  return element;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
