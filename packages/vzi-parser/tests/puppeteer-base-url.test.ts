import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { withDocumentBaseUrl } from "../src/puppeteer-parser.js";

describe("withDocumentBaseUrl", () => {
  it("injects a base href before relative assets are loaded by setContent", () => {
    const html = `<!DOCTYPE html><html><head><title>Page</title></head><body><img src="assets/logo.png"></body></html>`;
    const parsed = cheerio.load(withDocumentBaseUrl(html, "file:///tmp/forma-artifact/index.html"));
    const baseHref = parsed("head base").attr("href");

    expect(baseHref).toBe("file:///tmp/forma-artifact/index.html");
    expect(new URL("assets/logo.png", baseHref).toString()).toBe("file:///tmp/forma-artifact/assets/logo.png");
    expect(parsed("head").children().first().prop("tagName")?.toLowerCase()).toBe("base");
  });

  it("keeps an existing base href unchanged", () => {
    const html = `<!DOCTYPE html><html><head><base href="https://example.test/app/"><title>Page</title></head><body></body></html>`;
    const parsed = cheerio.load(withDocumentBaseUrl(html, "file:///tmp/forma-artifact/index.html"));

    expect(parsed("base")).toHaveLength(1);
    expect(parsed("base").attr("href")).toBe("https://example.test/app/");
  });
});
