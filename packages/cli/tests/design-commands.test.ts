import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const agentTemplatesDir = new URL("../../../packages/agent/templates/", import.meta.url);

async function loadCommand(command: string): Promise<{ claude: string; codex: string; gemini: string; blob: string }> {
  const claude = await readFile(new URL(`claude/${command}.md`, agentTemplatesDir), "utf8");
  const codex = await readFile(new URL(`codex/${command}/SKILL.md`, agentTemplatesDir), "utf8");
  const gemini = await readFile(new URL(`gemini/${command}.toml`, agentTemplatesDir), "utf8");
  return { claude, codex, gemini, blob: [claude, codex, gemini].join("\n").toLowerCase() };
}

async function loadShared(): Promise<string> {
  return readFile(new URL("shared/SKILL.md", agentTemplatesDir), "utf8");
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

  it("enforces self-review via craftChecks read-back (protocol in shared SKILL.md)", async () => {
    const t = await loadCommand("fm-design");
    const shared = await loadShared();
    // Each command must reference the shared self-review protocol
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      expect(lc).toContain("self-review");
      expect(lc).toContain("self-review protocol");
    }
    // The canonical craftChecks loop and get_product_artifact call live in shared SKILL.md (T010 sink)
    const sharedLc = shared.toLowerCase();
    expect(sharedLc).toContain("craftchecks");
    expect(sharedLc).toContain("get_product_artifact");
    expect(sharedLc).toContain("self-review protocol");
  });

  it("documents both full and described modes; pure-static contract lives in shared SKILL.md", async () => {
    const t = await loadCommand("fm-design");
    const shared = await loadShared();
    expect(t.blob).toContain("full");
    expect(t.blob).toContain("single");
    // Commands reference the shared pure-static contract section
    for (const body of [t.claude, t.codex, t.gemini]) {
      expect(body.toLowerCase()).toContain("pure-static contract");
    }
    // The canonical prohibition list lives in shared SKILL.md (T010 sink)
    expect(shared).toContain("<script>");
    expect(shared.toLowerCase()).toContain("pure-static contract");
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

  it("enforces self-review via craftChecks read-back (protocol in shared SKILL.md)", async () => {
    const t = await loadCommand("fm-refine-components");
    const shared = await loadShared();
    // Each command must reference the shared self-review protocol
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      expect(lc).toContain("self-review");
      expect(lc).toContain("self-review protocol");
    }
    // The canonical craftChecks loop and get_product_artifact call live in shared SKILL.md (T010 sink)
    const sharedLc = shared.toLowerCase();
    expect(sharedLc).toContain("craftchecks");
    expect(sharedLc).toContain("get_product_artifact");
    expect(sharedLc).toContain("self-review protocol");
  });

  it("loads the existing component library before refining it", async () => {
    const t = await loadCommand("fm-refine-components");
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      expectOrder(lc, "list_product_artifacts", "export_artifact");
      expectOrder(lc, "export_artifact", "generate_components");
    }
  });
});

describe("fm-change-style template", () => {
  it("uses the Forma route header on every platform", async () => {
    const t = await loadCommand("fm-change-style");
    expect(t.claude).toContain("# Forma route: fm-change-style");
    expect(t.codex).toContain("name: fm-change-style");
    expect(t.gemini).toContain("# Forma route: fm-change-style");
  });

  // PLAN-TASK-008: fm-change-style is now a product-level delegate (config → refine flow)
  // change_artifact_style is removed; update_product_config + fm-refine-components flow is used instead
  it("delegates to update_product_config then inlines fm-refine-components generation flow", async () => {
    const t = await loadCommand("fm-change-style");
    expect(t.blob).toContain("update_product_config");
    expect(t.blob).toContain("fm-refine-components");
    // Must NOT reference the removed change_artifact_style tool
    expect(t.blob).not.toContain("change_artifact_style");
  });

  it("persists style config before generation on every platform", async () => {
    const t = await loadCommand("fm-change-style");
    for (const body of [t.claude, t.codex, t.gemini]) {
      expectOrder(body.toLowerCase(), "update_product_config", "generate_components");
    }
  });

  it("enforces self-review via craftChecks read-back", async () => {
    const t = await loadCommand("fm-change-style");
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      expect(lc).toContain("get_product_artifact");
      expect(lc).toContain("craftchecks");
      expect(lc).toContain("self-review");
    }
  });

  it("surfaces partial-failure recovery wording when config saved but generation fails", async () => {
    const t = await loadCommand("fm-change-style");
    // Template must warn that config is updated but component library may be stale
    // and give recovery instructions (re-run fm-refine-components or fm-change-style)
    const lc = t.blob;
    expect(lc).toMatch(/partial|部分|stale|未刷新|重跑/);
    // Must reference fm-refine-components as the recovery action
    expect(lc).toContain("fm-refine-components");
  });
});

// PLAN-TASK-009: fm-design two-stage component-library gate (B4/B6/B5)
describe("fm-design component-library gate and reuse rules (T009)", () => {
  it("gates on designSystemArtifactId pointer (not list-non-empty) and references fm-refine-components", async () => {
    const t = await loadCommand("fm-design");
    // Must check the pointer, not list non-empty
    expect(t.blob).toContain("designsystemartifactid");
    // Must reference fm-refine-components as the remedy
    expect(t.blob).toContain("fm-refine-components");
  });

  it("distinguishes never-refined vs legacy in the stop message on every platform", async () => {
    const t = await loadCommand("fm-design");
    // Legacy wording: 已检测到旧组件库 or the word 'legacy' (case-insensitive)
    expect(t.blob).toMatch(/已检测到旧组件库|legacy/i);
    // Must appear in each platform individually
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      expect(lc).toContain("designsystemartifactid");
      expect(lc).toContain("fm-refine-components");
      expect(body).toMatch(/已检测到旧组件库|legacy/i);
    }
  });

  it("documents on-demand reuse of baseline components and product ICON SVG on every platform", async () => {
    const t = await loadCommand("fm-design");
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      // Must mention baseline component reuse (same tokens/states)
      expect(lc).toMatch(/componentbaseline|componentlibrary|baseline component|按需复用|on-demand reuse/i);
      // Must mention product icon reuse
      expect(lc).toMatch(/icon svg|producticon|product icon/i);
    }
  });

  it("states rule 1: fm-change-style and fm-refine-components do NOT retroactively regenerate existing pages", async () => {
    const t = await loadCommand("fm-design");
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      // rule 1: style/component changes do not retroactively regenerate existing design pages
      expect(lc).toMatch(/rule 1|不回溯|retroactively|not retroactively/i);
      // References fm-change-style in the context of rule 1
      expect(lc).toContain("fm-change-style");
    }
  });
});

// fm-rollback-design and fm-develop-design-handoff templates deleted in R1/R4/R5 (PLAN-TASK-001)
