import { describe, expect, it } from "vitest";

import { extractStyleVisualTokens } from "./styleVisualTokens.js";

describe("extractStyleVisualTokens", () => {
  it("combines DESIGN.md frontmatter and tokens.css variables for list previews", () => {
    expect(
      extractStyleVisualTokens({
        designMd: `---
colors:
  background: "{--surface}"
  primary: "#3b82f6"
  text-primary: "{--ink}"
typography:
  body-md:
    fontFamily: "Acme Sans"
---
`,
        tokensCss: ":root { --surface: #fff7ed; --ink: #111827; --secondary: #f97316; }",
      }),
    ).toEqual({
      backgroundColor: "#fff7ed",
      fontFamily: "Acme Sans",
      primaryColor: "#3b82f6",
      secondaryColor: "#f97316",
      textColor: "#111827",
    });
  });

  it("drops unsafe or unsupported CSS values instead of guessing", () => {
    expect(
      extractStyleVisualTokens({
        designMd: `---
colors:
  background: "url(https://example.invalid/bg.png)"
  text-primary: "var(--missing)"
typography:
  body: "Bad;Font"
---
`,
        tokensCss: ":root { --primary: #111827; --secondary: #ffffff; }",
      }),
    ).toEqual({
      primaryColor: "#111827",
      secondaryColor: "#ffffff",
    });
  });
});
