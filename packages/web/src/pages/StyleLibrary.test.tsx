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

describe("style sync helpers", () => {
  it("formats sync button labels by status", () => {
    expect(styleLibrary.syncButtonLabel(undefined)).toBe("一键同步");
    expect(styleLibrary.syncButtonLabel({ status: "idle" })).toBe("一键同步");
    expect(
      styleLibrary.syncButtonLabel({
        status: "running",
        task_id: "sync-123",
        started_at: "2026-05-18T00:00:00.000Z",
        progress: { phase: "rendering_previews", current: 3, total: 8 }
      })
    ).toBe("同步中... (3/8)");
    expect(
      styleLibrary.syncButtonLabel({
        status: "failed",
        task_id: "sync-123",
        error: { phase: "cleanup", message: "Workspace cleanup failed" }
      })
    ).toBe("同步失败，重试");
  });

  it("formats compact completion summaries", () => {
    expect(styleLibrary.syncSummary(undefined)).toBeUndefined();
    expect(styleLibrary.syncSummary({ status: "idle" })).toBeUndefined();
    expect(
      styleLibrary.syncSummary({
        status: "idle",
        last_sync: {
          completed_at: "2026-05-18T00:00:02.000Z",
          styles_total: 12,
          styles_added: 2,
          styles_updated: 3,
          styles_failed: 1,
          duration_ms: 2200
        }
      })
    ).toBe("total 12, added 2, updated 3, failed 1");
  });
});
