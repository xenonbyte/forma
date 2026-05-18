import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as baselineView from "./BaselineView.js";
import type { ProductBaseline } from "../api.js";

describe("BaselineContent", () => {
  it("renders preview and annotations links for each baseline page", () => {
    const BaselineContent = (
      baselineView as {
        BaselineContent?: (props: { baseline: ProductBaseline; productId: string }) => ReactNode;
      }
    ).BaselineContent;

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
});
