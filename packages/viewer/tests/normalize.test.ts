import { describe, expect, it } from "vitest";
import { buildViewerModel, type NormalizeArtifactInput } from "@xenonbyte/forma-viewer";

const inputs: NormalizeArtifactInput[] = [
  {
    artifactId: "art-login",
    kind: "design-page",
    pageId: "login",
    pageName: "登录页",
    variant: "default",
    title: "登录页 默认",
    version: 2,
    width: 1280,
    height: 800,
  },
  {
    artifactId: "art-login",
    kind: "design-page",
    pageId: "login",
    pageName: "登录页",
    variant: "wide",
    title: "登录页 宽屏",
    version: 2,
    width: 1440,
    height: 900,
  },
  {
    artifactId: "art-home",
    kind: "design-page",
    pageId: "home",
    pageName: "首页",
    variant: "default",
    title: "首页",
    version: 1,
    width: 1280,
    height: 800,
  },
];

describe("buildViewerModel", () => {
  it("groups tiles by page and orders variants within a group", () => {
    const model = buildViewerModel({ entry: "requirement", artifacts: inputs });
    expect(model.groups.map((g) => g.pageId)).toEqual(["login", "home"]);
    const login = model.groups.find((g) => g.pageId === "login");
    expect(login?.tileIds).toEqual(["art-login:2:default", "art-login:2:wide"]);
  });

  it("builds opaque resource refs for html bundle and preview 1x/2x LOD", () => {
    const model = buildViewerModel({ entry: "requirement", artifacts: inputs });
    const tile = model.tiles.find((t) => t.id === "art-home:1:default");
    expect(tile?.htmlBundle).toEqual({ artifactId: "art-home", version: 1, kind: "bundle" });
    expect(tile?.previewImages).toEqual({
      "1x": { artifactId: "art-home", version: 1, kind: "preview", density: "1x" },
      "2x": { artifactId: "art-home", version: 1, kind: "preview", density: "2x" },
    });
  });

  it("assigns non-overlapping canvas positions", () => {
    const model = buildViewerModel({ entry: "requirement", artifacts: inputs });
    const positions = model.tiles.map((t) => `${t.x},${t.y}`);
    expect(new Set(positions).size).toBe(model.tiles.length);
  });

  it("carries the entry scope through", () => {
    const model = buildViewerModel({ entry: "page", artifacts: [inputs[0]] });
    expect(model.entry).toBe("page");
    expect(model.tiles).toHaveLength(1);
  });
});

describe("buildViewerModel platform + bundlePath", () => {
  it("carries platform onto tiles and uses bundlePath as an asset htmlBundle ref", () => {
    const model = buildViewerModel({
      entry: "page",
      artifacts: [
        {
          artifactId: "lib", kind: "component-library", pageId: "brand", pageName: "brand",
          variant: "default", title: "Button", version: 2, width: 320, height: 420,
          platform: "mobile", bundlePath: "unit-button.html",
        },
      ],
    });
    const tile = model.tiles[0]!;
    expect(tile.platform).toBe("mobile");
    expect(tile.htmlBundle).toEqual({ artifactId: "lib", version: 2, kind: "asset", path: "unit-button.html" });
  });

  it("defaults htmlBundle to the bundle entry when bundlePath is absent", () => {
    const model = buildViewerModel({
      entry: "requirement",
      artifacts: [
        { artifactId: "a", kind: "design-page", pageId: "p", pageName: "P", variant: "default",
          title: "P", version: 1, width: 390, height: 844 },
      ],
    });
    expect(model.tiles[0]!.htmlBundle).toEqual({ artifactId: "a", version: 1, kind: "bundle" });
  });
});
