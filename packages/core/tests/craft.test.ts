import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { StyleService } from "../src/styles.js";

function svc() {
  return new StyleService({
    home: "/tmp/forma-craft",
    bundledStylesDir: resolve("styles"),
    bundledCraftDir: resolve("craft"),
  });
}

describe("B1 craft reading", () => {
  it("lists all craft docs by slug", async () => {
    const docs = await svc().listCraftDocs();
    const slugs = docs.map((d) => d.slug);
    expect(slugs).toContain("color");
    expect(slugs).toContain("anti-ai-slop");
    expect(slugs).toContain("design-read");
    expect(slugs).toContain("ai-tells");
    expect(slugs).toContain("image-prompts");
    expect(slugs).toContain("typography-hierarchy");
    expect(slugs.length).toBeGreaterThanOrEqual(11);
  });
  it("reads a craft doc verbatim by slug", async () => {
    const doc = await svc().readCraftDoc("color");
    expect(doc.slug).toBe("color");
    expect(doc.content.length).toBeGreaterThan(0);
  });
  it("throws on unknown craft slug", async () => {
    await expect(svc().readCraftDoc("does-not-exist")).rejects.toThrow();
  });
});
