import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StyleCard } from "./StyleCard.js";

describe("StyleCard", () => {
  it("renders style metadata with name, description, and detail link", () => {
    const html = renderToStaticMarkup(
      <StyleCard
        href="/styles/linear"
        style={{
          name: "linear",
          description: "Focused tool UI",
          design_md_path: "styles/linear/DESIGN.md",
          tokens_css_path: "styles/linear/tokens.css",
          components_html_path: "styles/linear/components.html",
          category: "productivity"
        }}
      />
    );

    expect(html).toContain('href="/styles/linear"');
    expect(html).toContain("linear");
    expect(html).toContain("Focused tool UI");
    expect(html).toContain("productivity");
  });

  it("renders without category badge when category is absent", () => {
    const html = renderToStaticMarkup(
      <StyleCard
        href="/styles/sparse"
        style={{
          name: "sparse",
          description: "Sparse style",
          design_md_path: "styles/sparse/DESIGN.md",
          tokens_css_path: "styles/sparse/tokens.css",
          components_html_path: "styles/sparse/components.html"
        }}
      />
    );

    expect(html).toContain("sparse");
    expect(html).toContain("Sparse style");
    // derives category from path
    expect(html).toContain("tokens.css");
  });

  it("shows upstream when present", () => {
    const html = renderToStaticMarkup(
      <StyleCard
        href="/styles/material"
        style={{
          name: "material",
          description: "Material style",
          design_md_path: "styles/material/DESIGN.md",
          tokens_css_path: "styles/material/tokens.css",
          components_html_path: "styles/material/components.html",
          upstream: "google/material-design"
        }}
      />
    );

    expect(html).toContain("google/material-design");
  });
});
