import { describe, expect, it } from "vitest";

import * as styleLibrary from "./StyleLibrary.js";
import type { StyleMetadata } from "../api.js";

const styles: StyleMetadata[] = [
  {
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
  },
  {
    name: "retail mobile",
    description: "Retail app UI",
    design_md_path: "styles/retail/DESIGN.md",
    variables: {
      primary: "#0f766e",
      background: "#ffffff",
      "text-primary": "#111827",
      "font-heading": "Inter",
      "font-body": "Inter",
      "border-radius": "8px",
      "spacing-unit": "8px"
    }
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
        filterStylesByControls?: (items: StyleMetadata[], controls: { category: string; query: string; variableFilter: string }) => StyleMetadata[];
      }
    ).filterStylesByControls;

    expect(filterStyles).toBeTypeOf("function");
    expect(filterStyles?.(styles, { category: "retail", query: "", variableFilter: "all" }).map((style) => style.name)).toEqual(["retail mobile"]);
  });
});

