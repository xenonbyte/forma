import { describe, expect, it } from "vitest";
import { createWebResourceResolver } from "./resolver.js";
import type { ResourceRef } from "@xenonbyte/forma-viewer";

describe("createWebResourceResolver", () => {
  const r = createWebResourceResolver("p1");
  const base = "/api/products/p1/artifacts/a/versions/3";

  it("resolves the html bundle entry", () => {
    const ref: ResourceRef = { artifactId: "a", version: 3, kind: "bundle" };
    expect(r.resolve(ref)).toBe(`${base}/bundle/index.html`);
  });

  it("resolves a versioned preview png by density", () => {
    expect(r.resolve({ artifactId: "a", version: 3, kind: "preview", density: "2x" })).toBe(`${base}/preview/2x.png`);
  });

  it("resolves a bundle asset by path", () => {
    expect(r.resolve({ artifactId: "a", version: 3, kind: "asset", path: "assets/logo.png" })).toBe(`${base}/bundle/assets/logo.png`);
  });

  it("url-encodes product and artifact ids", () => {
    const enc = createWebResourceResolver("p/1");
    expect(enc.resolve({ artifactId: "a b", version: 1, kind: "bundle" })).toBe(
      "/api/products/p%2F1/artifacts/a%20b/versions/1/bundle/index.html"
    );
  });
});
