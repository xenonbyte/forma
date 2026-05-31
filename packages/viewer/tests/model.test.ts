import { describe, expect, it } from "vitest";
import { isDesignTile, type ViewerTile } from "@xenonbyte/forma-viewer";

describe("isDesignTile", () => {
  const base: Omit<ViewerTile, "kind"> = {
    id: "a:1:default",
    pageId: "login",
    pageName: "登录页",
    variant: "default",
    title: "登录页",
    version: 1,
    width: 1280,
    height: 800,
    htmlBundle: { artifactId: "a", version: 1, kind: "bundle" },
    previewImages: {
      "1x": { artifactId: "a", version: 1, kind: "preview", density: "1x" },
      "2x": { artifactId: "a", version: 1, kind: "preview", density: "2x" }
    }
  };

  it("returns true for design tiles", () => {
    expect(isDesignTile({ ...base, kind: "design-page" })).toBe(true);
  });

  it("returns false for component-library tiles", () => {
    expect(isDesignTile({ ...base, kind: "component-library" })).toBe(false);
  });
});
