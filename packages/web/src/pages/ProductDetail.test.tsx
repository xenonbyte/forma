import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import * as productDetail from "./ProductDetail.js";
import type { ProductBaseline } from "../api.js";

describe("ProductDetailSummaryPanels", () => {
  it("renders baseline page and navigation counts without requiring the whole page", () => {
    const ProductDetailSummaryPanels = (
      productDetail as {
        ProductDetailSummaryPanels?: (props: {
          actionError: null;
          baselineState: { baseline: ProductBaseline; status: "ready" };
          productId: string;
          requirementCount: number;
        }) => ReactNode;
      }
    ).ProductDetailSummaryPanels;

    expect(ProductDetailSummaryPanels).toBeTypeOf("function");
    if (!ProductDetailSummaryPanels) {
      return;
    }

    const html = renderToStaticMarkup(
      <ProductDetailSummaryPanels
        actionError={null}
        baselineState={{
          baseline: {
            product_id: "P-123abc",
            pages: [
              { id: "home", name: "Home", features: "", copy: "", fields: "", interactions: "", source_requirements: ["R-12345678"] },
              { id: "checkout", name: "Checkout", features: "", copy: "", fields: "", interactions: "", source_requirements: ["R-12345678"] }
            ],
            navigation: [{ from: "home", to: "checkout" }]
          },
          status: "ready"
        }}
        productId="P-123abc"
        requirementCount={1}
      />
    );

    expect(html).toContain("2 pages");
    expect(html).toContain("1 navigation");
    expect(html).toContain('href="/products/P-123abc/baseline"');
  });
});
