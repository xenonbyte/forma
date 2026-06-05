import { existsSync, statSync } from "node:fs";
import { describe, it, expect } from "vitest";

const ROOT = new URL("../public/runtime-assets/", import.meta.url);

function present(rel: string): boolean {
  const url = new URL(rel, ROOT);
  return existsSync(url) && statSync(url).size > 0;
}

describe("web runtime-assets are committed for zero-remote CanvasKit", () => {
  it("ships the CanvasKit wasm binary", () => {
    expect(present("canvaskit/canvaskit.wasm")).toBe(true);
  });

  for (const font of [
    "NotoSansCJKsc-Regular.otf",
    "NotoSans-Variable.ttf",
    "Inter-Variable.ttf",
    "SpaceGrotesk-Variable.ttf",
    "NotoSansMono-Variable.ttf",
    "MaterialIcons-Regular.ttf",
    "MaterialSymbolsOutlined-Variable.ttf",
    "MaterialSymbolsRounded-Variable.ttf",
    "MaterialSymbolsSharp-Variable.ttf",
  ]) {
    it(`ships font ${font}`, () => {
      expect(present(`fonts/${font}`)).toBe(true);
    });
  }
});
