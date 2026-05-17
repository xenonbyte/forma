import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StyleCard } from "./StyleCard.js";

describe("StyleCard", () => {
  it("renders style metadata, swatch, variables, and detail link", () => {
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
            "text-primary": "#111827",
            "font-heading": "Inter",
            "font-body": "Inter",
            "border-radius": "8px",
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
  });
});
