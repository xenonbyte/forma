// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import * as baselineView from "./BaselineView.js";
import type { ProductBaseline } from "../api.js";

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

describe("BaselineContent", () => {
  const BaselineContent = (
    baselineView as {
      BaselineContent?: (props: { baseline: ProductBaseline; productId: string }) => ReactNode;
    }
  ).BaselineContent;

  it("renders preview and annotations links for each baseline page", () => {
    expect(BaselineContent).toBeTypeOf("function");
    if (!BaselineContent) {
      return;
    }

    const html = renderToStaticMarkup(
      <BaselineContent
        baseline={{
          product_id: "P-123abc",
          pages: [
            {
              id: "checkout",
              name: "Checkout",
              features: "Checkout flow",
              copy: "",
              fields: "",
              interactions: "",
              source_requirements: ["R-12345678"]
            }
          ],
          navigation: []
        }}
        productId="P-123abc"
      />
    );

    expect(html).toContain("Preview");
    expect(html).toContain("Annotations");
    expect(html).toContain('href="/api/products/P-123abc/baseline/pages/checkout/image"');
    expect(html).toContain('href="/api/products/P-123abc/baseline/pages/checkout/annotations"');
  });

  it("defaults to the list tab with functional page content", () => {
    expect(BaselineContent).toBeTypeOf("function");
    if (!BaselineContent) {
      return;
    }

    const html = renderToStaticMarkup(<BaselineContent baseline={baselineFixture} productId="P-123abc" />);

    expect(html).toContain("Functional pages");
    expect(html).toContain("Checkout flow");
    expect(html).toContain("Payment terms");
    expect(html).toContain("Continue");
    expect(html).toContain("Legacy return");
    expect(html).not.toContain("Navigation graph");
  });

  it("renders the graph tab after tab selection", async () => {
    expect(BaselineContent).toBeTypeOf("function");
    if (!BaselineContent) {
      return;
    }

    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<BaselineContent baseline={baselineFixture} productId="P-123abc" />);
      await flushPromises();
    });

    const graphTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Graph");
    expect(graphTab).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      graphTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    expect(container.textContent).toContain("Navigation graph");
    expect(container.textContent).toContain("Checkout");
  });
});

const baselineFixture: ProductBaseline = {
  product_id: "P-123abc",
  pages: [
    {
      id: "checkout",
      name: "Checkout",
      features: "Checkout flow",
      copy: "Payment terms",
      fields: "card number",
      interactions: "submit payment",
      source_requirements: ["R-12345678"]
    }
  ],
  navigation: [
    { from: "checkout", to: "checkout", trigger: "Continue" } as ProductBaseline["navigation"][number] & { trigger: string },
    { from: "checkout", to: "checkout", label: "Legacy return" }
  ]
};

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
}
