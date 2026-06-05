import { describe, expect, it } from "vitest";

import * as styleLibrary from "./StyleLibrary.js";
import type { StyleMetadata } from "../api.js";

const styles: StyleMetadata[] = [
  {
    name: "linear",
    description: "Focused tool UI",
    design_md_path: "styles/linear/DESIGN.md",
    tokens_css_path: "styles/linear/tokens.css",
    components_html_path: "styles/linear/components.html",
  },
  {
    name: "retail mobile",
    description: "Retail app UI",
    design_md_path: "styles/retail/DESIGN.md",
    tokens_css_path: "styles/retail/tokens.css",
    components_html_path: "styles/retail/components.html",
  },
];

describe("style search helpers", () => {
  it("filters styles by name", () => {
    const filterStyles = (
      styleLibrary as {
        filterStylesByControls?: (items: StyleMetadata[], controls: { query: string }) => StyleMetadata[];
      }
    ).filterStylesByControls;

    expect(filterStyles).toBeTypeOf("function");
    expect(filterStyles?.(styles, { query: "retail" }).map((style) => style.name)).toEqual(["retail mobile"]);
  });

  it("filters styles by description", () => {
    const filterStyles = (
      styleLibrary as {
        filterStylesByControls?: (items: StyleMetadata[], controls: { query: string }) => StyleMetadata[];
      }
    ).filterStylesByControls;

    expect(filterStyles?.(styles, { query: "tool" }).map((style) => style.name)).toEqual(["linear"]);
  });
});
