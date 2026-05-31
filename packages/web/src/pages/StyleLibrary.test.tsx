import { describe, expect, it } from "vitest";

import * as styleLibrary from "./StyleLibrary.js";
import type { StyleMetadata } from "../api.js";

const styles: StyleMetadata[] = [
  {
    name: "linear",
    description: "Focused tool UI",
    design_md_path: "styles/linear/DESIGN.md",
    tokens_css_path: "styles/linear/tokens.css",
    components_html_path: "styles/linear/components.html"
  },
  {
    name: "retail mobile",
    description: "Retail app UI",
    design_md_path: "styles/retail/DESIGN.md",
    tokens_css_path: "styles/retail/tokens.css",
    components_html_path: "styles/retail/components.html"
  }
];

describe("style category helpers", () => {
  it("derives category options from style design paths", () => {
    const getStyleCategories = (styleLibrary as { getStyleCategories?: (items: StyleMetadata[]) => string[] }).getStyleCategories;

    expect(getStyleCategories).toBeTypeOf("function");
    expect(getStyleCategories?.(styles)).toEqual(["all", "linear", "retail"]);
  });

  it("filters styles by derived category", () => {
    const filterStyles = (
      styleLibrary as {
        filterStylesByControls?: (items: StyleMetadata[], controls: { category: string; query: string }) => StyleMetadata[];
      }
    ).filterStylesByControls;

    expect(filterStyles).toBeTypeOf("function");
    expect(filterStyles?.(styles, { category: "retail", query: "" }).map((style) => style.name)).toEqual(["retail mobile"]);
  });
});
