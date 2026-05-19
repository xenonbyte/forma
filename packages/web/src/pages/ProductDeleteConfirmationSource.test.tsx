// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FormaApiClient, Product, ProductBaseline, RequirementWithDocument, StyleMetadata } from "../api.js";

vi.mock("../components/ConfirmDeleteDialog.js", () => ({
  ConfirmDeleteDialog: ({
    onConfirm,
    open,
    product
  }: {
    onConfirm(confirmProductId: string): void;
    open: boolean;
    product: { id: string };
  }) =>
    open ? (
      <button data-mock-confirm-delete={product.id} onClick={() => onConfirm("typed-confirmation")} type="button">
        confirm typed ID
      </button>
    ) : null
}));

import { ProductDetail } from "./ProductDetail.js";
import { ProductListContent } from "./ProductList.js";

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

const product: Product = {
  id: "P-123abc",
  name: "Checkout App",
  description: "Mobile checkout workbench",
  platform: "web",
  style,
  languages: ["en"],
  default_language: "en",
  components_initialized: true
};

const baseline: ProductBaseline = {
  product_id: product.id,
  navigation: [],
  pages: []
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
  vi.restoreAllMocks();
});

describe("product delete confirmation source", () => {
  it("uses the selected list product for the URL and the typed confirmation for the request body", async () => {
    const client = createDeleteClient();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <ProductListContent
          client={client}
          products={[product]}
          requirementSummaries={{ [product.id]: { count: 0 } }}
        />
      );
      await flushPromises();
    });

    await act(async () => {
      required(container.querySelector<HTMLButtonElement>(`[data-product-delete="${product.id}"]`), "delete action").click();
      await flushPromises();
    });

    await act(async () => {
      required(container.querySelector<HTMLButtonElement>(`[data-mock-confirm-delete="${product.id}"]`), "mock confirm").click();
      await flushPromises();
    });

    expect(client.deleteProduct).toHaveBeenCalledWith(product.id, { confirm_product_id: "typed-confirmation" });
  });

  it("uses the route product for the detail URL and the typed confirmation for the request body", async () => {
    const client = createDetailClient();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductDetail client={client} params={{ productId: product.id }} />);
      await flushPromises();
    });

    await act(async () => {
      required(container.querySelector<HTMLButtonElement>('[data-product-detail-delete="true"]'), "detail delete action").click();
      await flushPromises();
    });

    await act(async () => {
      required(container.querySelector<HTMLButtonElement>(`[data-mock-confirm-delete="${product.id}"]`), "mock confirm").click();
      await flushPromises();
    });

    expect(client.deleteProduct).toHaveBeenCalledWith(product.id, { confirm_product_id: "typed-confirmation" });
  });
});

function createDeleteClient() {
  return {
    deleteProduct: vi.fn(async () => ({
      product_id: product.id,
      deleted: true as const,
      session_cleared: false,
      cleanup_pending: false,
      recovery_warnings: []
    }))
  } satisfies Pick<FormaApiClient, "deleteProduct">;
}

function createDetailClient() {
  return {
    archiveRequirement: vi.fn(),
    configureProduct: vi.fn(),
    createEmptyRequirement: vi.fn(),
    deleteProduct: vi.fn(async () => ({
      product_id: product.id,
      deleted: true as const,
      session_cleared: false,
      cleanup_pending: false,
      recovery_warnings: []
    })),
    getBaseline: vi.fn(async () => baseline),
    getProduct: vi.fn(async () => product),
    listRequirements: vi.fn(async () => [] as RequirementWithDocument[]),
    listStyles: vi.fn(async () => [style])
  } satisfies Pick<
    FormaApiClient,
    | "archiveRequirement"
    | "configureProduct"
    | "createEmptyRequirement"
    | "deleteProduct"
    | "getBaseline"
    | "getProduct"
    | "listRequirements"
    | "listStyles"
  >;
}

function createTestRoot() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}

function required<T extends Element>(element: T | null, label: string): T {
  if (!element) {
    throw new Error(`Missing ${label}`);
  }
  return element;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
