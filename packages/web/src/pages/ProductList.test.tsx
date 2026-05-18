import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductListContent } from "./ProductList.js";
import type { StyleMetadata } from "../api.js";

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
  });

  it("renders the empty state when no products are loaded", () => {
    const html = renderToStaticMarkup(<ProductListContent products={[]} requirementSummaries={{}} />);

    expect(html).toContain("No products");
    expect(html).toContain('href="/products/new"');
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
              components_initialized: true
            }
          }
        }}
        products={[{ id: "P-123abc", name: "Checkout App", description: "Mobile checkout workbench" }]}
        requirementSummaries={{ "P-123abc": { count: 0 } }}
      />
    );

    expect(html).toContain("Configuration incomplete");
  });

  it("marks products without initialized components as configuration incomplete", () => {
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
              components_initialized: false
            }
          }
        }}
        products={[{ id: "P-123abc", name: "Checkout App", description: "Mobile checkout workbench" }]}
        requirementSummaries={{ "P-123abc": { count: 0 } }}
      />
    );

    expect(html).toContain("Configuration incomplete");
  });

  it("marks products with missing component initialization state as configuration incomplete", () => {
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

    expect(html).toContain("Configuration incomplete");
  });
});
