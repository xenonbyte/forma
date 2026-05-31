import { describe, expect, it } from "vitest";
import { mapArtifactsToViewerInputs, canvasSizeForPlatform, type FormaArtifact } from "./mapArtifacts.js";

const artifacts: FormaArtifact[] = [
  { id: "a", kind: "design-page", title: "登录页", updated_at: "", page_id: "login", variant: "default", current_version: 2 },
  { id: "b", kind: "design-page", title: "登录页 宽屏", updated_at: "", page_id: "login", variant: "wide", current_version: 2 },
  { id: "c", kind: "component-library", title: "组件库", updated_at: "" }
];
const pages = [{ page_id: "login", name: "登录页" }];

describe("mapArtifactsToViewerInputs", () => {
  it("maps design-page artifacts to NormalizeArtifactInput, dropping non-design-page and incomplete", () => {
    const out = mapArtifactsToViewerInputs({ artifacts, pages, platform: "web" });
    expect(out.map((x) => x.artifactId)).toEqual(["a", "b"]);
    expect(out[0]).toEqual({
      artifactId: "a", kind: "design-page", pageId: "login", pageName: "登录页",
      variant: "default", title: "登录页", version: 2, width: 1280, height: 800
    });
  });

  it("falls back to pageId when page name is unknown, and uses platform canvas size", () => {
    const { width, height } = canvasSizeForPlatform("mobile");
    const out = mapArtifactsToViewerInputs({ artifacts: [artifacts[0]], pages: [], platform: "mobile" });
    expect(out[0].pageName).toBe("login");
    expect({ w: out[0].width, h: out[0].height }).toEqual({ w: width, h: height });
    expect({ w: width, h: height }).toEqual({ w: 390, h: 844 });
  });

  it("drops design-page artifacts missing page_id/variant/current_version (must come from read surface, not inferred)", () => {
    const incomplete: FormaArtifact = { id: "x", kind: "design-page", title: "x", updated_at: "" };
    expect(mapArtifactsToViewerInputs({ artifacts: [incomplete], pages, platform: "web" })).toEqual([]);
  });
});
