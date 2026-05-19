import { describe, expect, it } from "vitest";

import { parseDesignMd } from "./parseDesignMd.js";

describe("parseDesignMd", () => {
  it("returns empty sections when the file does not start with frontmatter", () => {
    expect(parseDesignMd("# Linear\n---\ncolors:\n  primary: #111827\n---")).toEqual({
      colors: {},
      typography: {},
      rounded: {},
      spacing: {},
      components: {},
      warnings: []
    });
  });

  it("parses supported sections, component maps, key characters, and scalar values", () => {
    const parsed = parseDesignMd(`---
colors:
  background: "#ffffff"
  primary-1: '#111827'
  text_primary.2: {colors.primary-1}
  overlay: transparent
typography:
  heading-lg: "Acme Display"
  body_md.1: system-ui
rounded:
  lg: 12px
spacing:
  0: 0
  unit_2: 8
components:
  button-primary:
    background: "{colors.primary-1}"
    color: "{colors.text_primary.2}"
  nav.main:
    height: 48px
---
# Linear
`);

    expect(parsed.colors).toEqual({
      background: "#ffffff",
      "primary-1": "#111827",
      "text_primary.2": "{colors.primary-1}",
      overlay: "transparent"
    });
    expect(parsed.typography).toEqual({
      "heading-lg": "Acme Display",
      "body_md.1": "system-ui"
    });
    expect(parsed.rounded).toEqual({ lg: "12px" });
    expect(parsed.spacing).toEqual({ "0": "0", unit_2: "8" });
    expect(parsed.components).toEqual({
      "button-primary": {
        background: "{colors.primary-1}",
        color: "{colors.text_primary.2}"
      },
      "nav.main": {
        height: "48px"
      }
    });
    expect(parsed.warnings).toEqual([]);
  });

  it("flattens nested typography fontFamily values without warning on ordinary type fields", () => {
    const parsed = parseDesignMd(`---
typography:
  display-lg:
    fontFamily: "'CursorGothic', sans-serif"
    fontSize: 36px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: -0.28px
  body-md:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 16px
---
`);

    expect(parsed.typography).toEqual({
      "display-lg": "'CursorGothic', sans-serif",
      "body-md": "Inter, system-ui, sans-serif"
    });
    expect(parsed.warnings).toEqual([]);
  });

  it("parses realistic component aliases used by bundled DESIGN.md frontmatter", () => {
    const parsed = parseDesignMd(`---
colors:
  primary: "#f54e00"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
  top-nav:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
---
`);

    expect(parsed.components["button-primary"]).toMatchObject({
      backgroundColor: "{colors.primary}",
      textColor: "{colors.on-primary}",
      typography: "{typography.button}",
      rounded: "{rounded.md}"
    });
    expect(parsed.components["top-nav"]).toMatchObject({
      backgroundColor: "{colors.canvas}",
      textColor: "{colors.ink}"
    });
    expect(parsed.warnings).toEqual([]);
  });

  it("ignores unknown top-level sections", () => {
    const parsed = parseDesignMd(`---
colors:
  primary: "#111827"
unknown:
  primary: "#ff0000"
  nested:
    value: "#00ff00"
typography:
  body: Inter
---
`);

    expect(parsed.colors).toEqual({ primary: "#111827" });
    expect(parsed.typography).toEqual({ body: "Inter" });
    expect(parsed.warnings).toEqual([]);
  });

  it("skips block scalars, arrays, multiline strings, and complex structures with warnings", () => {
    const parsed = parseDesignMd(`---
colors:
  primary: "#111827"
  gradient: |
    linear-gradient(red, blue)
  palette:
    - "#ffffff"
  complex:
    base: "#222222"
typography:
  body: "Inter
    Sans"
spacing:
  sm: 8px
  scale: [4px, 8px]
components:
  button:
    background: "{colors.primary}"
    variants:
      quiet: true
---
`);

    expect(parsed.colors).toEqual({ primary: "#111827" });
    expect(parsed.spacing).toEqual({ sm: "8px" });
    expect(parsed.components.button).toEqual({ background: "{colors.primary}" });
    expect(parsed.warnings.join("\n")).toContain("gradient");
    expect(parsed.warnings.join("\n")).toContain("palette");
    expect(parsed.warnings.join("\n")).toContain("complex");
    expect(parsed.warnings.join("\n")).toContain("body");
    expect(parsed.warnings.join("\n")).toContain("scale");
    expect(parsed.warnings.join("\n")).toContain("variants");
  });

  it("warns on unsupported indentation while preserving already parsed values", () => {
    const parsed = parseDesignMd(`---
colors:
  primary: "#111827"
   broken: "#ff0000"
  background: "#ffffff"
components:
  nav:
    background: "{colors.background}"
      tooDeep: true
---
`);

    expect(parsed.colors).toEqual({ primary: "#111827", background: "#ffffff" });
    expect(parsed.components.nav).toEqual({ background: "{colors.background}" });
    expect(parsed.warnings.join("\n")).toContain("indentation");
    expect(parsed.warnings.join("\n")).toContain("tooDeep");
  });

  it("warns on tab indentation without losing the active section", () => {
    const parsed = parseDesignMd(`---
colors:
\tprimary: "#ff0000"
  background: "#ffffff"
---
`);

    expect(parsed.colors).toEqual({ background: "#ffffff" });
    expect(parsed.warnings.join("\n")).toContain("indentation");
    expect(parsed.warnings.join("\n")).toContain("primary");
  });
});
