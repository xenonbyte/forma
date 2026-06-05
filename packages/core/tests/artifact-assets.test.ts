import { describe, expect, it } from "vitest";
import { validateAssetsAgainstSupportingFiles } from "../src/artifact-assets.js";

describe("A4 assets ⊆ supportingFiles", () => {
  it("passes when every asset path is in supportingFiles", () => {
    const r = validateAssetsAgainstSupportingFiles(
      { assets: [{ path: "assets/a@1x.png", density: [1], role: "image" }] },
      ["index.html", "assets/a@1x.png"],
    );
    expect(r.ok).toBe(true);
  });
  it("fails when an asset path is missing from supportingFiles", () => {
    const r = validateAssetsAgainstSupportingFiles(
      { assets: [{ path: "assets/missing@1x.png", density: [1], role: "image" }] },
      ["index.html"],
    );
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/missing/);
  });
  it("passes when forma has no assets", () => {
    expect(validateAssetsAgainstSupportingFiles({}, ["index.html"]).ok).toBe(true);
  });
});
