import { describe, expect, it } from "vitest";
import { createDesktopResourceResolver } from "./resolver.js";
import type { ResourceRef } from "@xenonbyte/forma-viewer";

describe("createDesktopResourceResolver", () => {
  const base = "http://127.0.0.1:3000";
  const r = createDesktopResourceResolver(base, "p1");
  const root = `${base}/api/products/p1/artifacts/a/versions/3`;

  it("resolves the html bundle entry", () => {
    const ref: ResourceRef = { artifactId: "a", version: 3, kind: "bundle" };
    expect(r.resolve(ref)).toBe(`${root}/bundle/index.html`);
  });

  it("resolves a versioned preview png by density", () => {
    const ref: ResourceRef = { artifactId: "a", version: 3, kind: "preview", density: "2x" };
    expect(r.resolve(ref)).toBe(`${root}/preview/2x.png`);
  });

  it("resolves a preview with no density defaults to 1x", () => {
    const ref: ResourceRef = { artifactId: "a", version: 3, kind: "preview" };
    expect(r.resolve(ref)).toBe(`${root}/preview/1x.png`);
  });

  it("resolves a bundle asset by path", () => {
    const ref: ResourceRef = { artifactId: "a", version: 3, kind: "asset", path: "assets/logo.png" };
    expect(r.resolve(ref)).toBe(`${root}/bundle/assets/logo.png`);
  });

  it("normalizes trailing slash on baseUrl", () => {
    const rSlash = createDesktopResourceResolver("http://127.0.0.1:3000/", "p1");
    const ref: ResourceRef = { artifactId: "a", version: 3, kind: "bundle" };
    expect(rSlash.resolve(ref)).toBe(`${root}/bundle/index.html`);
  });

  it("url-encodes product and artifact ids", () => {
    const rEnc = createDesktopResourceResolver(base, "p/1");
    const ref: ResourceRef = { artifactId: "a b", version: 1, kind: "bundle" };
    expect(rEnc.resolve(ref)).toBe(
      `${base}/api/products/p%2F1/artifacts/a%20b/versions/1/bundle/index.html`
    );
  });
});
