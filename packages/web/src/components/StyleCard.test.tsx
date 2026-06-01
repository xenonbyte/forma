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
    expect(html).not.toContain("productivity");
  });

  it("does not derive a category badge from the style path", () => {
    const html = renderToStaticMarkup(
      <StyleCard
        href="/styles/plain"
        style={{
          name: "plain",
          description: "Sparse style",
          design_md_path: "styles/custom/DESIGN.md",
          tokens_css_path: "styles/custom/tokens.css",
          components_html_path: "styles/custom/components.html"
        }}
      />
    );

    expect(html).toContain("plain");
    expect(html).toContain("Sparse style");
    expect(html).not.toContain(">custom<");
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

  it("renders visual tokens as card preview styles and color bars", () => {
    const html = renderToStaticMarkup(
      <StyleCard
        href="/styles/agentic"
        style={{
          name: "agentic",
          description: "Agentic style",
          design_md_path: "styles/agentic/DESIGN.md",
          tokens_css_path: "styles/agentic/tokens.css",
          components_html_path: "styles/agentic/components.html"
        }}
        visualTokens={{
          backgroundColor: "#111827",
          fontFamily: "Acme Sans",
          primaryColor: "#3b82f6",
          secondaryColor: "#f97316",
          textColor: "#ffffff"
        }}
      />
    );

    expect(html).toContain("background-color:#111827");
    expect(html).toContain("font-family:Acme Sans");
    expect(html).toContain("color:#ffffff");
    expect(html).toContain('data-style-primary-color="true"');
    expect(html).toContain('background-color:#3b82f6');
    expect(html).toContain('data-style-secondary-color="true"');
    expect(html).toContain('background-color:#f97316');
  });
});
