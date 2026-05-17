import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductListContent } from "./ProductList.js";

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
});
