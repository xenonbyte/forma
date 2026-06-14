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

describe("image-prompts scaffolds (T10 — plan-driven brand assets)", () => {
  // The brand-asset templates reference per-purpose scaffolds by section heading.
  // These assertions pin the scaffold slugs (section headings) + their veto blocks
  // so a template/scaffold drift fails here rather than silently at agent runtime.
  const newSections: ReadonlyArray<readonly [string, string]> = [
    ["### `app-icon-logo` — master a (transparent logo)", "transparent-logo master scaffold"],
    ["### `app-icon-bg` — master b (opaque background)", "opaque-background master scaffold"],
    ["### `app-icon-safe` — master c (666² safe-area logo, mobile/tablet only)", "666² safe-area master scaffold"],
    ["## `banner` — plan-driven target", "banner scaffold"],
    ["## `poster` — plan-driven target (portrait / landscape / square)", "poster scaffold (3 orientations)"],
  ];

  it("image-prompts.md contains every new T10 scaffold section", async () => {
    const doc = await svc().readCraftDoc("image-prompts");
    for (const [heading, why] of newSections) {
      expect(doc.content, `image-prompts.md must contain the ${why}`).toContain(heading);
    }
  });

  it("each new scaffold carries a per-purpose veto block", async () => {
    const { content } = await svc().readCraftDoc("image-prompts");
    // Every scaffold section must extend the shared veto checklist with its own
    // per-purpose veto (the Read-inspection criteria). Assert the total count is
    // at least as large as the number of scaffolds overall (new + pre-existing).
    const vetoCount = (content.match(/\*\*Per-purpose veto \(extra\):\*\*/g) ?? []).length;
    expect(vetoCount, "image-prompts.md must carry per-purpose veto blocks for all scaffolds").toBeGreaterThanOrEqual(
      9,
    );
    // The retired preset/primary vocabulary must be gone from the scaffolds.
    expect(content, "no residual store-shot preset language").not.toContain("store-shot preset");
  });

  it("each new T10 scaffold section individually carries a per-purpose veto block", async () => {
    const { content } = await svc().readCraftDoc("image-prompts");
    // For each new scaffold, confirm the veto block appears in the text between
    // this section heading and the next ## section heading.
    for (const [heading, why] of newSections) {
      const sectionStart = content.indexOf(heading);
      expect(sectionStart, `image-prompts.md must contain the ${why}`).toBeGreaterThan(-1);
      // Find the next ## heading after this section (or end of file)
      const nextSection = content.indexOf("\n## ", sectionStart + heading.length);
      const sectionBody = nextSection === -1 ? content.slice(sectionStart) : content.slice(sectionStart, nextSection);
      expect(sectionBody, `${why} must carry a **Per-purpose veto (extra):** block`).toContain(
        "**Per-purpose veto (extra):**",
      );
    }
  });
});
