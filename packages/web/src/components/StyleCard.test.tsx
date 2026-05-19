import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StyleCard } from "./StyleCard.js";

describe("StyleCard", () => {
  it("renders style metadata, compact preview strip, variables, and detail link", () => {
    const html = renderToStaticMarkup(
      <StyleCard
        href="/styles/linear"
        style={{
          name: "linear",
          description: "Focused tool UI",
          design_md_path: "styles/linear/DESIGN.md",
          variables: {
            primary: "#111827",
            background: "#ffffff",
            "text-primary": "#222222",
            "font-heading": "Acme Display",
            "font-body": "Acme Text",
            "border-radius": "14px",
            "spacing-unit": "8px"
          }
        }}
      />
    );

    expect(html).toContain('href="/styles/linear"');
    expect(html).toContain("linear");
    expect(html).toContain("Focused tool UI");
    expect(html).toContain("#111827");
    expect(html).toContain("7 variables");
    expect(html).toContain('data-style-preview-strip="true"');
    expect(html).toContain('data-background="#ffffff"');
    expect(html).toContain('data-primary="#111827"');
    expect(html).toContain('data-text-color="#222222"');
    expect(html).toContain('data-heading-font="Acme Display"');
    expect(html).toContain('data-body-font="Acme Text"');
    expect(html).toContain('data-radius="14px"');
    expect(html).toContain('data-spacing="8px"');
  });

  it("uses radius and spacing fallbacks in the preview strip", () => {
    const html = renderToStaticMarkup(
      <StyleCard
        href="/styles/sparse"
        style={{
          name: "sparse",
          description: "Sparse variables",
          design_md_path: "styles/sparse/DESIGN.md",
          variables: {
            primary: "#5E6AD2",
            background: "#fafafa",
            "text-primary": "#111827",
            "font-heading": "Inter",
            "font-body": "Inter",
            "border-radius": "",
            "spacing-unit": ""
          }
        }}
      />
    );

    expect(html).toContain('data-style-preview-strip="true"');
    expect(html).toContain('data-radius="8px"');
    expect(html).toContain('data-spacing="8px"');
  });
});
