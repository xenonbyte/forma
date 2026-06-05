import { readFileSync } from "node:fs";
import { afterEach, describe, it, expect, vi } from "vitest";
import { FontManager } from "../src/canvaskit/FontManager";

const SOURCE = readFileSync(new URL("../src/canvaskit/FontManager.ts", import.meta.url), "utf8");

type FontManagerInternals = {
  fetchFontDataByUrl(url: string): Promise<ArrayBuffer>;
};

function fetchFontDataByUrl(url: string): Promise<ArrayBuffer> {
  return (FontManager.getInstance() as unknown as FontManagerInternals).fetchFontDataByUrl(url);
}

function installBrowserFontEnvironment(baseURI: string): void {
  vi.stubGlobal("process", undefined);
  vi.stubGlobal("document", { baseURI });
}

afterEach(() => {
  FontManager.getInstance().reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FontManager is local-only", () => {
  for (const host of ["raw.githubusercontent.com", "fonts.googleapis.com", "cdn.jsdelivr.net"]) {
    it(`does not reference ${host}`, () => {
      expect(SOURCE).not.toContain(host);
    });
  }

  it("maps every required family to a bundled local file name", () => {
    for (const file of [
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
      expect(SOURCE).toContain(file);
    }
  });

  it("checks the web public runtime-assets font directory in Node", () => {
    expect(SOURCE).toContain("packages/web/public/runtime-assets/fonts");
  });

  it("allows same-origin browser font asset URLs but rejects remote origins", () => {
    expect(SOURCE).toContain("isAllowedBrowserFontUrl");
    expect(SOURCE).toContain("document.baseURI");
    expect(SOURCE).toContain("Remote font URL is not allowed in local-only FontManager");
  });

  it("rejects protocol-relative remote browser font URLs before fetch", async () => {
    installBrowserFontEnvironment("https://app.example/product/page");
    const fetchSpy = vi.fn(
      async () =>
        ({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(1),
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchFontDataByUrl("//cdn.example/runtime-assets/fonts/Inter-Variable.ttf")).rejects.toThrow(
      "Remote font URL is not allowed in local-only FontManager",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("normalizes same-origin browser font URLs before fetch", async () => {
    installBrowserFontEnvironment("https://app.example/product/page");
    const fontData = new ArrayBuffer(1);
    const fetchSpy = vi.fn(
      async () =>
        ({
          ok: true,
          arrayBuffer: async () => fontData,
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchFontDataByUrl("//app.example/runtime-assets/fonts/Inter-Variable.ttf")).resolves.toBe(fontData);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://app.example/runtime-assets/fonts/Inter-Variable.ttf");
  });
});
