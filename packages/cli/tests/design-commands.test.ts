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

  it("uses only the current component library when finding an existing library", async () => {
    const t = await loadCommand("fm-refine-components");
    for (const body of [t.claude, t.codex, t.gemini]) {
      expect(body).toContain('list_product_artifacts(product_id, kind="component-library")');
      expect(body).not.toContain("include_superseded=true");
      expect(body).toMatch(/current non-superseded component library/i);
    }
  });

  it("requires an app icon as a hard precondition instead of producing a product ICON unit (D6)", async () => {
    const t = await loadCommand("fm-refine-components");
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      // App-icon hard precondition: gate on list_brand_assets(kind="app-icon"), STOP + guide fm-app-icon
      expect(lc).toContain('list_brand_assets(product_id, kind="app-icon")');
      expect(lc).toContain("fm-app-icon");
      // The icon unit is retired and must not be emitted
      expect(body).toContain("NO icon unit");
      expect(body).toMatch(/Do NOT submit `product_icon`/);
    }
  });

  it("treats a legacy library without productIcon metadata as a valid refinement source without re-emitting an icon", async () => {
    const t = await loadCommand("fm-refine-components");
    for (const body of [t.claude, t.codex, t.gemini]) {
      // Legacy intent preserved: a library lacking productIcon metadata is still a valid refinement source
      expect(body).toMatch(/valid refinement source regardless.*legacy `forma\.productIcon` metadata/i);
      // source_html is preserved
      expect(body).toMatch(/preserve the exported `source_html`/i);
      // The product ICON unit is never re-emitted (icon unit retired — D6)
      expect(body).toMatch(/never re-emit a product ICON unit/i);
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

  it("loads only the current component library and supports first-time generation", async () => {
    const t = await loadCommand("fm-change-style");
    for (const body of [t.claude, t.codex, t.gemini]) {
      expect(body).toContain('list_product_artifacts(product_id, kind="component-library")');
      expect(body).not.toContain("include_superseded=true");
      expect(body).toMatch(/no current component library is returned, continue with initial generation/i);
      expect(body).toMatch(/not a partial failure/i);
    }
  });

  it("does not re-emit a product ICON unit and flags the app icon as stale after a style change (D6/D11)", async () => {
    const t = await loadCommand("fm-change-style");
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      // The icon unit is retired (D6): no icon unit, and product_icon must not be submitted
      expect(body).toContain("NO icon unit");
      expect(body).toMatch(/Do NOT submit `product_icon`/);
      // Stale-asset reminder (D11): a style change does not auto-regenerate the app icon; point at fm-app-icon
      expect(lc).toContain("fm-app-icon");
      expect(body).toMatch(/stale-asset reminder/i);
    }
  });

  it("persists style config before generation on every platform", async () => {
    const t = await loadCommand("fm-change-style");
    for (const body of [t.claude, t.codex, t.gemini]) {
      expectOrder(body.toLowerCase(), "update_product_config", "generate_components");
    }
  });

  it("requires concrete product config fields before update_product_config", async () => {
    const t = await loadCommand("fm-change-style");
    for (const body of [t.claude, t.codex, t.gemini]) {
      expect(body).toMatch(/platform.*languages.*default_language/i);
      expect(body).toMatch(/missing.*product config/i);
      expect(body).toMatch(/Do NOT pass undefined, null, or empty values to `update_product_config`/);
    }
  });

  it("keeps existing source_html as a valid re-skin source for legacy libraries without productIcon (no icon re-emit)", async () => {
    const t = await loadCommand("fm-change-style");
    for (const body of [t.claude, t.codex, t.gemini]) {
      // Legacy intent preserved: a library lacking productIcon metadata is still a valid re-skin source
      expect(body).toMatch(/valid re-skin source regardless.*legacy `forma\.productIcon` metadata/i);
      // The icon unit is retired (D6) and is never re-emitted here
      expect(body).toMatch(/the icon unit is retired \(D6\) and is never re-emitted here/i);
      // Existing component markup (source_html) is preserved and only re-themed via tokens_css
      expect(body).toMatch(/PRESERVE each component's existing structure\/markup/);
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
    // The legacy branch must include superseded component-library artifacts because
    // pointer-unset libraries are hidden by default.
    expect(t.blob).toContain("include_superseded=true");
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
