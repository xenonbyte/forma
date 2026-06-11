import { describe, expect, it } from "vitest";
import { layoutTiles, TILE_GAP } from "@xenonbyte/forma-viewer";
import type { ViewerGroup, ViewerTile } from "@xenonbyte/forma-viewer";

function tile(id: string, pageId: string, variant: string, width = 1000, height = 600): ViewerTile {
  return {
    id,
    kind: "design-page",
    pageId,
    pageName: pageId,
    variant,
    title: id,
    version: 1,
    width,
    height,
    htmlBundle: { artifactId: id, version: 1, kind: "bundle" },
    previewImages: {
      "1x": { artifactId: id, version: 1, kind: "preview", density: "1x" },
      "2x": { artifactId: id, version: 1, kind: "preview", density: "2x" },
    },
  };
}

describe("layoutTiles", () => {
  const tiles: ViewerTile[] = [tile("a", "login", "default"), tile("b", "login", "wide"), tile("c", "home", "default")];
  const groups: ViewerGroup[] = [
    { pageId: "login", pageName: "login", tileIds: ["a", "b"] },
    { pageId: "home", pageName: "home", tileIds: ["c"] },
  ];

  it("places each group on its own row", () => {
    const positioned = layoutTiles(tiles, groups);
    const a = positioned.find((t) => t.id === "a")!;
    const b = positioned.find((t) => t.id === "b")!;
    const c = positioned.find((t) => t.id === "c")!;
    expect(a.y).toBe(b.y);
    expect(c.y).toBeGreaterThan(a.y);
  });

  it("lays out variants left-to-right within a group with a gap", () => {
    const positioned = layoutTiles(tiles, groups);
    const a = positioned.find((t) => t.id === "a")!;
    const b = positioned.find((t) => t.id === "b")!;
    expect(a.x).toBe(0);
    expect(b.x).toBe(a.width + TILE_GAP);
  });

  it("returns one positioned tile per input tile", () => {
    expect(layoutTiles(tiles, groups)).toHaveLength(3);
  });

  it("single-row lays every tile in one horizontal row across groups", () => {
    const positioned = layoutTiles(tiles, groups, true);
    const a = positioned.find((t) => t.id === "a")!;
    const b = positioned.find((t) => t.id === "b")!;
    const c = positioned.find((t) => t.id === "c")!;
    // All tiles share the same row (y = 0) regardless of page group.
    expect(a.y).toBe(0);
    expect(b.y).toBe(0);
    expect(c.y).toBe(0);
    // x advances left-to-right across the group boundary (login a,b then home c).
    expect(a.x).toBe(0);
    expect(b.x).toBe(a.width + TILE_GAP);
    expect(c.x).toBe(b.x + b.width + TILE_GAP);
  });
});
