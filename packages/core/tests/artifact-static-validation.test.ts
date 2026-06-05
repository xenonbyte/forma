import { describe, it, expect } from "vitest";
import {
  validateStaticArtifact,
  type StaticValidationInput,
  type StaticValidationResult,
} from "../src/artifact-static-validation.js";

// Helper: assert ok
function assertOk(result: StaticValidationResult): void {
  if (!result.ok) {
    throw new Error(`Expected ok:true but got violations: ${result.violations.join("; ")}`);
  }
}

// Helper: assert not ok
function assertNotOk(result: StaticValidationResult): string[] {
  if (result.ok) {
    throw new Error("Expected ok:false but got ok:true");
  }
  return result.violations;
}

describe("validateStaticArtifact", () => {
  // ── Clean baseline ──────────────────────────────────────────────────────────
  it("clean static HTML with relative img and inline style → ok:true", () => {
    const input: StaticValidationInput = {
      html: `<!DOCTYPE html><html><head>
        <style>body { background: url(assets/y.png); }</style>
      </head><body>
        <div class="container">
          <img src="assets/x@1x.png" alt="logo" />
        </div>
      </body></html>`,
    };
    const result = validateStaticArtifact(input);
    assertOk(result);
  });

  // ── Rule 1: <script> element ────────────────────────────────────────────────
  it("<script>alert(1)</script> → ok:false, violation mentions script", () => {
    const input: StaticValidationInput = {
      html: `<html><body><script>alert(1)</script></body></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("script"))).toBe(true);
  });

  it("<script src='...'> external script → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><head><script src="https://evil.com/x.js"></script></head></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("script"))).toBe(true);
  });

  // ── Rule 2: inline on* event handlers ──────────────────────────────────────
  it("<div onclick='x()'> → ok:false (on* attr)", () => {
    const input: StaticValidationInput = {
      html: `<html><body><div onclick="x()">click me</div></body></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("onclick") || v.toLowerCase().includes("event"))).toBe(true);
  });

  it("<img onload='x'> → ok:false (on* attr)", () => {
    const input: StaticValidationInput = {
      html: `<html><body><img src="a.png" onload="x()" /></body></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("onload") || v.toLowerCase().includes("event"))).toBe(true);
  });

  // ── Rule 3: javascript: URL ─────────────────────────────────────────────────
  it("<a href='javascript:alert(1)'> → ok:false (javascript:)", () => {
    const input: StaticValidationInput = {
      html: `<html><body><a href="javascript:alert(1)">click</a></body></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("javascript:"))).toBe(true);
  });

  // ── Rule 4: external stylesheet <link> ──────────────────────────────────────
  it("<link rel='stylesheet' href='https://cdn/x.css'> → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><head><link rel="stylesheet" href="https://cdn.example.com/x.css"></head></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("stylesheet") || v.toLowerCase().includes("link"))).toBe(
      true,
    );
  });

  it("<link rel='stylesheet' href='styles/main.css'> (relative) → ok:true", () => {
    const input: StaticValidationInput = {
      html: `<html><head><link rel="stylesheet" href="styles/main.css"></head></html>`,
    };
    assertOk(validateStaticArtifact(input));
  });

  // ── Rule 5: <iframe> / <object> / <embed> ──────────────────────────────────
  it("<iframe src='...'> → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><body><iframe src="https://evil.com"></iframe></body></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("iframe"))).toBe(true);
  });

  it("<object> → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><body><object data="x.swf"></object></body></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("object"))).toBe(true);
  });

  it("<embed> → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><body><embed src="x.swf"></body></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("embed"))).toBe(true);
  });

  // ── Rule 6: remote http(s) refs in resource entry points ───────────────────
  it("<img src='https://x/y.png'> → ok:false (remote img)", () => {
    const input: StaticValidationInput = {
      html: `<html><body><img src="https://x.com/y.png" /></body></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("remote") || v.toLowerCase().includes("http"))).toBe(true);
  });

  it("<img src='assets/local.png'> (relative) → ok:true", () => {
    const input: StaticValidationInput = {
      html: `<html><body><img src="assets/local.png" /></body></html>`,
    };
    assertOk(validateStaticArtifact(input));
  });

  it("<source src='https://x/v.mp4'> → ok:false (remote source)", () => {
    const input: StaticValidationInput = {
      html: `<html><body><video><source src="https://x.com/v.mp4"></video></body></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.length).toBeGreaterThan(0);
  });

  // ── Rule 7: CSS remote refs (style blocks, style attrs, cssFiles) ───────────
  it("inline <style> with @import url(https://...) → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><head><style>@import url(https://x.com/y.css);</style></head></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(
      violations.some(
        (v) =>
          v.toLowerCase().includes("css") || v.toLowerCase().includes("remote") || v.toLowerCase().includes("import"),
      ),
    ).toBe(true);
  });

  it("inline <style> with background:url(https://...) → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><head><style>body{background:url(https://x.com/z.png)}</style></head></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("style attribute with url(https://...) → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><body><div style="background:url(https://x.com/img.png)">hi</div></body></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("cssFiles with @import url(https://...) → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><body></body></html>`,
      cssFiles: new Map([["styles/main.css", `@import url(https://fonts.googleapis.com/css2?family=Inter);`]]),
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("cssFiles with only local refs → ok:true", () => {
    const input: StaticValidationInput = {
      html: `<html><body></body></html>`,
      cssFiles: new Map([["styles/main.css", `body { background: url(assets/bg.png); color: red; }`]]),
    };
    assertOk(validateStaticArtifact(input));
  });

  // ── Rule 8: residual data: URLs ─────────────────────────────────────────────
  it("residual <img src='data:image/png;base64,...'> → ok:false (un-localized data:)", () => {
    const input: StaticValidationInput = {
      html: `<html><body><img src="data:image/png;base64,iVBORw0KGgo=" /></body></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("data:"))).toBe(true);
  });

  it("CSS url(data:...) in style block → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><head><style>body{background:url(data:image/png;base64,abc)}</style></head></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("data:"))).toBe(true);
  });

  // ── Rule 9: SVG files ────────────────────────────────────────────────────────
  it("svgFiles with <script> inside → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><body></body></html>`,
      svgFiles: new Map([
        ["icons/logo.svg", `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`],
      ]),
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("script"))).toBe(true);
  });

  it("svgFiles with xlink:href to external URL → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><body></body></html>`,
      svgFiles: new Map([
        [
          "icons/link.svg",
          `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="https://evil.com"><rect width="10" height="10"/></a></svg>`,
        ],
      ]),
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("svgFiles with on* event attr → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><body></body></html>`,
      svgFiles: new Map([
        [
          "icons/ev.svg",
          `<svg xmlns="http://www.w3.org/2000/svg"><rect onmouseover="x()" width="10" height="10"/></svg>`,
        ],
      ]),
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("event") || v.toLowerCase().includes("onmouseover"))).toBe(
      true,
    );
  });

  it("clean svgFiles (<svg><rect/></svg>) → ok:true", () => {
    const input: StaticValidationInput = {
      html: `<html><body></body></html>`,
      svgFiles: new Map([
        ["icons/clean.svg", `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="blue"/></svg>`],
      ]),
    };
    assertOk(validateStaticArtifact(input));
  });

  // Review #3: SVG hrefs must reject javascript: and residual data:, not just remote
  it("svgFiles with <a href='javascript:...'> → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><body></body></html>`,
      svgFiles: new Map([
        [
          "icons/js.svg",
          `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="10" height="10"/></a></svg>`,
        ],
      ]),
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("javascript"))).toBe(true);
  });

  it("svgFiles with <image href='data:...'> (residual data:) → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><body></body></html>`,
      svgFiles: new Map([
        [
          "icons/data.svg",
          `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA" width="10" height="10"/></svg>`,
        ],
      ]),
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("data:"))).toBe(true);
  });

  it("svgFiles with a local href (#gradient) → ok:true", () => {
    const input: StaticValidationInput = {
      html: `<html><body></body></html>`,
      svgFiles: new Map([
        [
          "icons/local.svg",
          `<svg xmlns="http://www.w3.org/2000/svg"><use href="#sprite"/><rect fill="url(#grad)" width="10" height="10"/></svg>`,
        ],
      ]),
    };
    assertOk(validateStaticArtifact(input));
  });

  // ── Bug #6: protocol-relative URL detection ─────────────────────────────────
  it("Bug #6: <img src='//cdn/x.png'> → ok:false (protocol-relative remote img)", () => {
    const input: StaticValidationInput = {
      html: `<html><body><img src="//cdn.example.com/x.png" /></body></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.toLowerCase().includes("remote") || v.includes("//cdn"))).toBe(true);
  });

  it("Bug #6: CSS url(//cdn/x.png) in style block → ok:false (protocol-relative)", () => {
    const input: StaticValidationInput = {
      html: `<html><head><style>body { background: url(//cdn.example.com/x.png); }</style></head></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("Bug #6: bare @import '//cdn/x.css' (protocol-relative, no url()) → ok:false", () => {
    const input: StaticValidationInput = {
      html: `<html><head><style>@import "//cdn.example.com/theme.css";</style></head></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.some((v) => v.includes("@import"))).toBe(true);
  });

  it("Bug #6: bare @import 'data:text/css,...' → ok:false (residual data:)", () => {
    const input: StaticValidationInput = {
      html: `<html><head><style>@import "data:text/css,body{color:red}";</style></head></html>`,
    };
    assertNotOk(validateStaticArtifact(input));
  });

  it("Bug #6: bare local @import 'theme.css' is NOT flagged", () => {
    const input: StaticValidationInput = {
      html: `<html><head><style>@import "theme.css";</style></head></html>`,
    };
    assertOk(validateStaticArtifact(input));
  });

  it("Bug #6: local absolute path /abs/path.png is NOT flagged as remote", () => {
    const input: StaticValidationInput = {
      html: `<html><body><img src="/abs/path/image.png" /></body></html>`,
    };
    assertOk(validateStaticArtifact(input));
  });

  it("Bug #6: relative path assets/x.png is NOT flagged as remote", () => {
    const input: StaticValidationInput = {
      html: `<html><body><img src="assets/x.png" /></body></html>`,
    };
    assertOk(validateStaticArtifact(input));
  });

  // ── Multiple violations collected ────────────────────────────────────────────
  it("HTML with <script> AND onclick → both violations collected (>= 2)", () => {
    const input: StaticValidationInput = {
      html: `<html><body>
        <script>alert(1)</script>
        <div onclick="x()">click</div>
      </body></html>`,
    };
    const violations = assertNotOk(validateStaticArtifact(input));
    expect(violations.length).toBeGreaterThanOrEqual(2);
  });
});
