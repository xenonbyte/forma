import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { StyleMetadata } from "../api.js";
import { StylePreviewPanel } from "./StylePreviewPanel.js";

const metadata: StyleMetadata = {
  name: "linear",
  description: "Focused tool UI",
  design_md_path: "styles/linear/DESIGN.md",
  tokens_css_path: "styles/linear/tokens.css",
  components_html_path: "styles/linear/components.html"
};

describe("StylePreviewPanel", () => {
  it("renders a distinct compact mock for every preview type", () => {
    for (const previewType of ["mobile", "desktop", "tablet", "web"] as const) {
      const html = renderToStaticMarkup(<StylePreviewPanel metadata={metadata} previewType={previewType} />);

      expect(html).toContain('data-style-preview-panel="true"');
      expect(html).toContain(`data-preview-type="${previewType}"`);
      expect(html).toContain(`data-preview-mock="${previewType}"`);
    }
  });

  it("prefers structured DESIGN.md tokens over fallbacks and resolves references in component styles", () => {
    const html = renderToStaticMarkup(
      <StylePreviewPanel
        designMd={`---
colors:
  background: "#fff7ed"
  primary: "#5E6AD2"
  canvas: "#f8fafc"
  ink: "#171717"
  on-primary: "#ffffff"
  text-primary: "#18181b"
typography:
  display-lg:
    fontFamily: "Acme Display"
    fontSize: 36px
  body-md:
    fontFamily: "Acme Text"
    fontSize: 16px
rounded:
  lg: 16px
spacing:
  md: 12px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.lg}"
  top-nav:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
---
`}
        metadata={metadata}
        previewType="web"
      />
    );

    expect(html).toContain('data-background="#fff7ed"');
    expect(html).toContain('data-primary="#5E6AD2"');
    expect(html).toContain('data-text-color="#18181b"');
    expect(html).toContain('data-heading-font="Acme Display"');
    expect(html).toContain('data-body-font="Acme Text"');
    expect(html).toContain('data-radius="16px"');
    expect(html).toContain('data-spacing="12px"');
    expect(html).toContain('data-button-background="#5E6AD2"');
    expect(html).toContain('data-button-color="#ffffff"');
    expect(html).toContain('data-nav-background="#f8fafc"');
  });

  it("uses hardcoded fallback tokens when DESIGN.md values are absent", () => {
    const html = renderToStaticMarkup(<StylePreviewPanel designMd="" metadata={metadata} previewType="desktop" />);

    expect(html).toContain('data-background="#ffffff"');
    expect(html).toContain('data-primary="#3b82f6"');
    expect(html).toContain('data-text-color="#111827"');
    expect(html).toContain('data-heading-font="Inter"');
    expect(html).toContain('data-body-font="Inter"');
    expect(html).toContain('data-radius="8px"');
    expect(html).toContain('data-spacing="8px"');
  });

  it("displays parser warnings without blocking preview rendering", () => {
    const html = renderToStaticMarkup(
      <StylePreviewPanel
        designMd={`---
colors:
  primary: "#5E6AD2"
  gradient: |
    linear-gradient(red, blue)
---
`}
        metadata={metadata}
        previewType="mobile"
      />
    );

    expect(html).toContain('data-style-preview-panel="true"');
    expect(html).toContain('data-primary="#5E6AD2"');
    expect(html).toContain("DESIGN.md warnings");
    expect(html).toContain("gradient");
  });

  it("uses button-primary and nav component heuristics before generic fallbacks", () => {
    const html = renderToStaticMarkup(
      <StylePreviewPanel
        designMd={`---
colors:
  primary: "#2255ff"
components:
  secondary-button:
    backgroundColor: "#00aa00"
  button-primary-large:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
  top-nav:
    backgroundColor: "#f4f4f5"
    textColor: "#18181b"
rounded:
  md: 10px
---
`}
        metadata={metadata}
        previewType="tablet"
      />
    );

    expect(html).toContain('data-button-source="button-primary-large"');
    expect(html).toContain('data-button-background="#2255ff"');
    expect(html).toContain('data-button-color="#ffffff"');
    expect(html).toContain('data-nav-source="top-nav"');
    expect(html).toContain('data-nav-background="#f4f4f5"');
  });
});
