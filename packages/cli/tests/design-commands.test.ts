import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const agentTemplatesDir = new URL("../../../packages/agent/templates/", import.meta.url);

async function loadCommand(command: string): Promise<{ claude: string; codex: string; gemini: string; blob: string }> {
  const claude = await readFile(new URL(`claude/${command}.md`, agentTemplatesDir), "utf8");
  const codex = await readFile(new URL(`codex/${command}/SKILL.md`, agentTemplatesDir), "utf8");
  const gemini = await readFile(new URL(`gemini/${command}.toml`, agentTemplatesDir), "utf8");
  return { claude, codex, gemini, blob: [claude, codex, gemini].join("\n").toLowerCase() };
}

function expectOrder(text: string, before: string, after: string): void {
  const a = text.indexOf(before);
  const b = text.indexOf(after);
  expect(a, `${before} must appear`).toBeGreaterThanOrEqual(0);
  expect(b, `${after} must appear`).toBeGreaterThanOrEqual(0);
  expect(a, `${before} must precede ${after}`).toBeLessThan(b);
}

describe("fm-design template", () => {
  it("uses the Forma route header on every platform", async () => {
    const t = await loadCommand("fm-design");
    expect(t.claude).toContain("# Forma route: fm-design");
    expect(t.codex).toContain("name: fm-design");
    expect(t.gemini).toContain("# Forma route: fm-design");
  });

  it("fetches design context BEFORE saving on every platform", async () => {
    const t = await loadCommand("fm-design");
    for (const body of [t.claude, t.codex, t.gemini]) {
      expectOrder(body.toLowerCase(), "get_design_context", "generate_requirement_design");
    }
  });

  it("uses brand_style + system_style and the page save tool", async () => {
    const t = await loadCommand("fm-design");
    expect(t.blob).toContain("brand_style");
    expect(t.blob).toContain("system_style");
    expect(t.blob).toContain("generate_requirement_design");
  });

  it("enforces self-review via craftChecks read-back", async () => {
    const t = await loadCommand("fm-design");
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      expect(lc).toContain("get_product_artifact");
      expect(lc).toContain("craftchecks");
      expect(lc).toContain("self-review");
    }
  });

  it("documents both full and described modes and the static contract", async () => {
    const t = await loadCommand("fm-design");
    expect(t.blob).toContain("full");
    expect(t.blob).toContain("single");
    expect(t.blob).toContain("<script>");
  });
});

describe("fm-refine-components template", () => {
  it("uses the Forma route header on every platform", async () => {
    const t = await loadCommand("fm-refine-components");
    expect(t.claude).toContain("# Forma route: fm-refine-components");
    expect(t.codex).toContain("name: fm-refine-components");
    expect(t.gemini).toContain("# Forma route: fm-refine-components");
  });

  it("uses get_style for knowledge (no get_design_context) before the component save tool", async () => {
    const t = await loadCommand("fm-refine-components");
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      expect(lc).toContain("get_style");
      expect(lc).not.toContain("get_design_context");
      expectOrder(lc, "get_style", "generate_components");
    }
  });

  it("uses brand_style + system_style and the component save tool", async () => {
    const t = await loadCommand("fm-refine-components");
    expect(t.blob).toContain("brand_style");
    expect(t.blob).toContain("system_style");
    expect(t.blob).toContain("generate_components");
  });

  it("enforces self-review via craftChecks read-back", async () => {
    const t = await loadCommand("fm-refine-components");
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      expect(lc).toContain("get_product_artifact");
      expect(lc).toContain("craftchecks");
      expect(lc).toContain("self-review");
    }
  });
});
