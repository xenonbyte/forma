import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formaAgentCommands, formaAgentPlatformMetadata } from "../src/index.js";

// Resolve templates dir relative to THIS test file: packages/agent/tests/ → packages/agent/templates/
const templatesDir = join(new URL(".", import.meta.url).pathname, "..", "templates");

/**
 * Read a template file for the given platform and command.
 * Resolves the path via formaAgentPlatformMetadata[platform].templateFilePattern.
 */
function readTemplate(platform: "claude" | "codex" | "gemini", command: string): string {
  const pattern = formaAgentPlatformMetadata[platform].templateFilePattern;
  const relativePath = pattern.replace("{command}", command);
  return readFileSync(join(templatesDir, relativePath), "utf8");
}

/**
 * De-shell a raw template string according to its platform format.
 *
 * claude  (markdown-frontmatter):
 *   Strip leading YAML frontmatter block (--- ... ---\n followed by a blank line).
 *   Keep from "# Forma route:" onward.
 *
 * codex   (codex-skill):
 *   Strip YAML frontmatter.
 *   Remove the "Codex route: `$<command>`." line and its trailing blank line.
 *   Replace every `$fm-` occurrence with `fm-` (the `$` prefix only ever
 *   appears on fm-* command names in the codex body).
 *   Keep from "# Forma route:" onward.
 *
 * gemini  (toml-prompt):
 *   Extract the string inside `prompt = """\n ... \n"""`.
 *   That yields the body starting with "# Forma route:".
 */
function deshell(raw: string, platform: "claude" | "codex" | "gemini"): string {
  // Normalize line endings first
  const text = raw.replace(/\r\n/g, "\n");

  switch (formaAgentPlatformMetadata[platform].templateFormat) {
    case "markdown-frontmatter": {
      // Strip the leading YAML frontmatter: starts with "---\n", ends after second "---\n"
      const fmEnd = text.indexOf("\n---\n", 3); // skip past opening ---
      if (fmEnd === -1) throw new Error(`No closing --- found in ${platform} template`);
      const afterFm = text.slice(fmEnd + 5); // skip "\n---\n"
      // afterFm may start with a blank line; find the body starting at "# Forma route:"
      const bodyStart = afterFm.indexOf("# Forma route:");
      if (bodyStart === -1) throw new Error(`No "# Forma route:" found in ${platform} template`);
      return afterFm.slice(bodyStart).trimEnd();
    }

    case "codex-skill": {
      // Strip YAML frontmatter (same rule as above)
      const fmEnd = text.indexOf("\n---\n", 3);
      if (fmEnd === -1) throw new Error(`No closing --- found in codex template`);
      const afterFm = text.slice(fmEnd + 5);

      // Find body start
      const bodyStart = afterFm.indexOf("# Forma route:");
      if (bodyStart === -1) throw new Error(`No "# Forma route:" found in codex template`);
      let body = afterFm.slice(bodyStart);

      // Remove the "Codex route: `$<command>`." line and its following blank line.
      // Guard it exists first (symmetric with the "# Forma route:" anchor check): if the
      // line were silently dropped or its format drifted, no-op removal could mask drift.
      const codexRouteLine = /^Codex route: `\$[^`]+`\.\n\n/m;
      if (!codexRouteLine.test(body)) throw new Error(`No "Codex route: \`$...\`." line found in codex template`);
      body = body.replace(codexRouteLine, "");

      // Replace all `$fm-` occurrences with `fm-` (only fm-* command references are $-prefixed in codex)
      body = body.replace(/\$fm-/g, "fm-");

      return body.trimEnd();
    }

    case "toml-prompt": {
      // Extract the string inside prompt = """\n...\n"""
      // The TOML triple-quoted string: prompt = """\n<body>\n"""
      const promptStart = text.indexOf('prompt = """\n');
      if (promptStart === -1) throw new Error(`No 'prompt = """' found in gemini template`);
      const bodyStart = promptStart + 'prompt = """\n'.length;
      const promptEnd = text.indexOf('\n"""', bodyStart);
      if (promptEnd === -1) throw new Error(`No closing '"""' found in gemini template`);
      const body = text.slice(bodyStart, promptEnd);
      if (!body.startsWith("# Forma route:")) {
        throw new Error(`No "# Forma route:" at start of gemini prompt body`);
      }
      return body.trimEnd();
    }
  }
}

describe("three-platform deshelled parity", () => {
  for (const cmd of formaAgentCommands) {
    it(`${cmd} bodies identical across platforms`, () => {
      const platforms = ["claude", "codex", "gemini"] as const;
      const bodies = platforms.map((p) => deshell(readTemplate(p, cmd), p));

      // All three must be identical after de-shelling
      expect(bodies[1], `codex body must match claude body for ${cmd}`).toBe(bodies[0]);
      expect(bodies[2], `gemini body must match claude body for ${cmd}`).toBe(bodies[0]);
    });
  }
});

describe("palette design-read step present", () => {
  const paletteCommands = ["fm-refine-components", "fm-change-style"] as const;
  const platforms = ["claude", "codex", "gemini"] as const;

  for (const cmd of paletteCommands) {
    for (const platform of platforms) {
      it(`${cmd} on ${platform} contains palette design-read step`, () => {
        const body = readTemplate(platform, cmd);
        expect(body, `${cmd}/${platform} must contain "Palette design-read"`).toContain("Palette design-read");
        expect(body, `${cmd}/${platform} must mention brass/clay/oxblood palette guard`).toContain(
          "brass/clay/oxblood",
        );
      });
    }
  }
});

describe("no-hand-drawn-functional-icons hard rule present (PLAN-TASK-014)", () => {
  const iconCommands = ["fm-design", "fm-refine-components"] as const;
  const platforms = ["claude", "codex", "gemini"] as const;

  for (const cmd of iconCommands) {
    for (const platform of platforms) {
      it(`${cmd} on ${platform} contains the no-hand-drawn-functional-icons hard rule`, () => {
        const body = readTemplate(platform, cmd);
        expect(body, `${cmd}/${platform} must forbid hand-drawing functional icons`).toContain(
          "never hand-draw functional icons",
        );
        expect(body, `${cmd}/${platform} must point at search_icons`).toContain("search_icons");
      });
    }
  }

  it("shared SKILL.md self-review checklist requires icon-library functional icons", () => {
    const sharedSkill = readFileSync(join(templatesDir, "shared", "SKILL.md"), "utf8");
    expect(sharedSkill, "shared SKILL.md must list the functional-icon self-review item").toContain(
      "functional icons all come from the icon library",
    );
    expect(sharedSkill, "shared SKILL.md must reference search_icons in the self-review item").toContain(
      "search_icons",
    );
  });
});

describe("icon unit retired + app-icon brand reference (PLAN-TASK-022)", () => {
  const platforms = ["claude", "codex", "gemini"] as const;

  // fm-refine-components: icon unit + product_icon emission GONE; ICON hard precondition ADDED.
  for (const platform of platforms) {
    it(`fm-refine-components on ${platform} no longer emits an icon unit or product_icon`, () => {
      const body = readTemplate(platform, "fm-refine-components");
      expect(body, `${platform}: icon unit must be gone`).not.toContain(`role: "icon"`);
      expect(body, `${platform}: product_icon save field must be gone`).not.toContain("`product_icon`:");
      // The obsolete T014 carve-out for the product ICON mark in unit b must be removed.
      expect(body, `${platform}: unit-b carve-out must be removed`).not.toContain("product ICON mark in unit b");
    });

    it(`fm-refine-components on ${platform} keeps the no-hand-drawn rule with NO carve-out`, () => {
      const body = readTemplate(platform, "fm-refine-components");
      expect(body, `${platform}: no-hand-drawn rule kept`).toContain("never hand-draw functional icons");
      expect(body, `${platform}: no "This does not apply" exception`).not.toContain("This does not apply");
    });

    it(`fm-refine-components on ${platform} adds the app-icon hard precondition`, () => {
      const body = readTemplate(platform, "fm-refine-components");
      expect(body, `${platform}: must call list_brand_assets`).toContain(
        `list_brand_assets(product_id, kind="app-icon")`,
      );
      expect(body, `${platform}: must guide to fm-app-icon`).toContain("fm-app-icon");
    });
  }

  // fm-design: brand app-icon ref + conditional precondition; legacy productIcon SVG reuse GONE.
  for (const platform of platforms) {
    it(`fm-design on ${platform} references the brand app-icon and adds the conditional precondition`, () => {
      const body = readTemplate(platform, "fm-design");
      expect(body, `${platform}: must reference forma-image://brand/app-icon`).toContain(
        "forma-image://brand/app-icon",
      );
      expect(body, `${platform}: must call list_brand_assets`).toContain(
        `list_brand_assets(product_id, kind="app-icon")`,
      );
      expect(body, `${platform}: legacy productIcon SVG reuse must be gone`).not.toContain(
        "reuse the product ICON SVG from",
      );
    });
  }

  // fm-change-style: stale-asset reminder; shape-reuse/recolor rules GONE.
  for (const platform of platforms) {
    it(`fm-change-style on ${platform} adds the stale-asset reminder and drops shape reuse`, () => {
      const body = readTemplate(platform, "fm-change-style");
      expect(body, `${platform}: must flag stale app icon / marketing assets`).toContain("Stale-asset reminder");
      expect(body, `${platform}: must point to fm-app-icon`).toContain("fm-app-icon");
      expect(body, `${platform}: icon shape geometry reuse rule must be gone`).not.toContain(
        "Reuse that geometry exactly and only recolor",
      );
    });
  }
});

describe("fm-app-icon load-bearing pieces present (PLAN-TASK-021)", () => {
  const platforms = ["claude", "codex", "gemini"] as const;

  // Each entry is a substring that MUST appear in every platform's fm-app-icon
  // template. These pin the load-bearing conventions of the master-image flow:
  // generate 2-3 masters, ONE discriminated-union save, local derivation, the
  // bare-command full-regeneration semantics, and the brand ref resolution.
  const required: ReadonlyArray<readonly [string, string]> = [
    ['purpose="app-icon"', "the generate_image purpose for the launcher mark"],
    ['kind="app-icon"', "the discriminated-union save kind"],
    ["logo_ref", "the transparent-logo master ref (image a)"],
    ["bg_ref", "the opaque-background master ref (image b)"],
    ["safe_logo_ref", "the 666² safe-area master ref (image c, mobile/tablet)"],
    ["get_brand_asset_plan", "the plan reader that reports how many masters to produce"],
    ["save_brand_asset", "the brand-asset persist tool"],
    ["generate_image", "the image generation tool"],
    ["MEDIA_NOT_CONFIGURED", "the image-model precondition error surfaced from generate_image"],
    ["Settings", "the web Settings guidance for the missing image model"],
    ["veto", "the Read-inspection veto step"],
    ["craft/image-prompts.md", "the app-icon master prompt scaffold source"],
    ["forma-image://brand/app-icon", "the brand ref that resolves to the largest standard variant"],
    ["count=3", "the three-candidate generation"],
    ["regeneration", "the bare-command full-regeneration semantics"],
    ["double-confirm", "the execute-time double-confirmation on a bare rerun"],
    ["overwrite", "the existing-icon overwrite semantics"],
    ["/products/<product_id>/brand-assets", "the brand-assets canvas URL"],
  ];
  const forbiddenHashBrandAssetsUrl = "#/products/<product_id>/brand-assets";

  for (const platform of platforms) {
    for (const [needle, why] of required) {
      it(`fm-app-icon on ${platform} contains ${JSON.stringify(needle)} (${why})`, () => {
        const body = readTemplate(platform, "fm-app-icon");
        expect(body, `fm-app-icon/${platform} must contain ${JSON.stringify(needle)} — ${why}`).toContain(needle);
      });
    }

    it(`fm-app-icon on ${platform} reports the real non-hash brand-assets route`, () => {
      const body = readTemplate(platform, "fm-app-icon");
      expect(body, `fm-app-icon/${platform} must not report the old hash-only brand-assets URL`).not.toContain(
        forbiddenHashBrandAssetsUrl,
      );
    });
  }

  // Regression guard: fabricated error codes must never appear (PLAN-TASK-021)
  for (const platform of platforms) {
    it(`fm-app-icon on ${platform} does NOT contain fabricated PRODUCT_NOT_CONFIGURED`, () => {
      const body = readTemplate(platform, "fm-app-icon");
      expect(
        body,
        `fm-app-icon/${platform} must NOT reference the non-existent PRODUCT_NOT_CONFIGURED code`,
      ).not.toContain("PRODUCT_NOT_CONFIGURED");
    });

    it(`fm-app-icon on ${platform} contains real BRAND_ASSET_INVALID_INPUT error code`, () => {
      const body = readTemplate(platform, "fm-app-icon");
      expect(body, `fm-app-icon/${platform} must reference the real BRAND_ASSET_INVALID_INPUT code`).toContain(
        "BRAND_ASSET_INVALID_INPUT",
      );
    });
  }
});

describe("fm-design IMAGERY judgment + explicit model-downgrade (PLAN-TASK-023)", () => {
  const platforms = ["claude", "codex", "gemini"] as const;

  // Each entry is a substring that MUST appear in every platform's fm-design
  // template. These pin the IMAGERY judgment folded into the Design read step
  // and the explicit downgrade-not-stop contract.
  const required: ReadonlyArray<readonly [string, string]> = [
    ["IMAGERY", "the imagery judgment label folded into the Design read step"],
    ["empty state", "the illustration trigger (empty state / onboarding / hero)"],
    ["generate_image(", "the image generation call for illustrations/heroes"],
    ['purpose="illustration"', "the spot/empty-state illustration purpose"],
    ['purpose="hero"', "the marketing hero purpose"],
    ["forma-image://<uuid>", "the staging ref returned by generate_image, referenced in page HTML"],
    ["veto", "the Read-inspection veto step against image-prompts.md"],
    ["craft/image-prompts.md", "the illustration/hero prompt scaffold source"],
    ["MEDIA_NOT_CONFIGURED", "the model-not-configured downgrade trigger"],
    ["CSS/SVG", "the downgrade decorative route"],
    ["not configured", "the explicit-downgrade wording"],
  ];

  for (const platform of platforms) {
    for (const [needle, why] of required) {
      it(`fm-design on ${platform} contains ${JSON.stringify(needle)} (${why})`, () => {
        const body = readTemplate(platform, "fm-design");
        expect(body, `fm-design/${platform} must contain ${JSON.stringify(needle)} — ${why}`).toContain(needle);
      });
    }

    it(`fm-design on ${platform} states the downgrade in the report (downgrade-not-stop)`, () => {
      const body = readTemplate(platform, "fm-design");
      // The downgrade must be reported explicitly, not silently skipped.
      expect(body, `fm-design/${platform} must require stating the downgrade in the report`).toMatch(
        /state the downgrade[\s\S]*report|in the (?:output )?report/i,
      );
    });

    it(`fm-design on ${platform} references the staging uuid ref, NOT the brand app-icon ref, for illustrations`, () => {
      const body = readTemplate(platform, "fm-design");
      // The illustration/hero ref is the per-page staging ref forma-image://<uuid>,
      // distinct from the brand ref forma-image://brand/app-icon (T022).
      expect(body, `fm-design/${platform} must use the staging uuid ref for generated illustrations`).toContain(
        "forma-image://<uuid>",
      );
      // Pin the literal distinction clause: the template must explicitly call out that
      // the staging uuid ref is NOT the brand app-icon ref — presence of both refs is
      // not enough; the instruction must spell out the distinction (T022).
      expect(
        body,
        `fm-design/${platform} must contain the explicit distinction clause "(NOT the brand \`forma-image://brand/app-icon\` ref)"`,
      ).toContain("(NOT the brand `forma-image://brand/app-icon` ref)");
    });
  }

  it("shared SKILL.md self-review checklist requires Read-inspected, on-palette illustrations", () => {
    const sharedSkill = readFileSync(join(templatesDir, "shared", "SKILL.md"), "utf8");
    expect(sharedSkill, "shared SKILL.md must list the generated-illustration self-review item").toContain(
      "generated illustrations were each Read-inspected",
    );
    expect(sharedSkill, "shared SKILL.md illustration item must require on-palette consistency").toContain(
      "on-palette",
    );
  });
});

describe("fm-brand-assets load-bearing pieces present (PLAN-TASK-025)", () => {
  const platforms = ["claude", "codex", "gemini"] as const;

  // Substrings that MUST appear in every platform's fm-brand-assets template.
  // These pin the plan-driven marketing-assets contract: read the plan first,
  // the no-hardcode red line, every asset kind, the discriminated-union save,
  // and the full precondition matrix.
  const required: ReadonlyArray<readonly [string, string]> = [
    ["get_brand_asset_plan", "the desired-state plan reader (sizes/surfaces/counts)"],
    ["save_brand_asset", "the brand-asset persist tool"],
    ["generate_image", "the background/illustration image generator"],
    ["kind=<entry.kind>", "the discriminated-union save keyed off each plan entry's kind"],
    ["store-shot", "the store-shot asset kind"],
    ["banner", "the banner asset kind"],
    ["poster", "the poster asset kind"],
    ["do not hardcode sizes/counts/surfaces", "the USER RED LINE against hardcoded plan values"],
    ["MEDIA_NOT_CONFIGURED", "the image-model HARD precondition surfaced from generate_image"],
    ["Settings", "the web Settings guidance for the missing image model"],
    ['list_brand_assets(product_id, kind="app-icon")', "the app-icon HARD precondition lookup"],
    ["list_product_artifacts", "the store-shot design-preview HARD precondition lookup"],
    ["veto", "the Read-inspection veto step for generated material"],
    ["craft/image-prompts.md", "the bg/illustration prompt scaffold source"],
    ["target={ width: entry.width, height: entry.height }", "the plan-entry-driven render target"],
    ["regeneration", "the bare-command full-regeneration semantics"],
    ["double-confirm", "the execute-time double-confirmation on a bare rerun"],
    ["/products/<product_id>/brand-assets", "the brand-assets canvas URL"],
  ];
  const forbiddenHashBrandAssetsUrl = "#/products/<product_id>/brand-assets";

  for (const platform of platforms) {
    for (const [needle, why] of required) {
      it(`fm-brand-assets on ${platform} contains ${JSON.stringify(needle)} (${why})`, () => {
        const body = readTemplate(platform, "fm-brand-assets");
        expect(body, `fm-brand-assets/${platform} must contain ${JSON.stringify(needle)} — ${why}`).toContain(needle);
      });
    }

    it(`fm-brand-assets on ${platform} reports the real non-hash brand-assets route`, () => {
      const body = readTemplate(platform, "fm-brand-assets");
      expect(body, `fm-brand-assets/${platform} must not report the old hash-only brand-assets URL`).not.toContain(
        forbiddenHashBrandAssetsUrl,
      );
    });

    it(`fm-brand-assets on ${platform} reads get_brand_asset_plan BEFORE save_brand_asset`, () => {
      const body = readTemplate(platform, "fm-brand-assets");
      // The first mention of the plan reader must precede the first save — the
      // plan's per-entry {width,height}/surface/variant is what feeds each save.
      const planAt = body.indexOf("get_brand_asset_plan");
      const saveAt = body.indexOf("save_brand_asset");
      expect(planAt, `fm-brand-assets/${platform} must mention get_brand_asset_plan`).toBeGreaterThan(-1);
      expect(saveAt, `fm-brand-assets/${platform} must mention save_brand_asset`).toBeGreaterThan(-1);
      expect(planAt, `fm-brand-assets/${platform} must call get_brand_asset_plan before save_brand_asset`).toBeLessThan(
        saveAt,
      );
    });

    it(`fm-brand-assets on ${platform} guides to fm-app-icon when the app icon is missing`, () => {
      const body = readTemplate(platform, "fm-brand-assets");
      expect(body, `fm-brand-assets/${platform} must guide to fm-app-icon for the missing app icon`).toContain(
        "fm-app-icon",
      );
    });

    it(`fm-brand-assets on ${platform} guides to fm-design when store-shot previews are missing`, () => {
      const body = readTemplate(platform, "fm-brand-assets");
      expect(body, `fm-brand-assets/${platform} must guide to fm-design for the missing design preview`).toContain(
        "fm-design",
      );
    });

    it(`fm-brand-assets on ${platform} specifies data: URI as the sandbox-allowed page screenshot embedding form (PLAN-TASK-025)`, () => {
      const body = readTemplate(platform, "fm-brand-assets");
      // The store-shot composition step must tell the agent HOW to embed the page preview.
      // The render sandbox rejects remote URLs; there is no forma-image:// namespace for
      // product page previews, so data: URI is the only valid embedding form.
      expect(body, `fm-brand-assets/${platform} must specify data: URI embedding for the page screenshot`).toContain(
        "data:",
      );
      expect(body, `fm-brand-assets/${platform} must state the sandbox rejects remote URLs`).toContain(
        "rejects remote",
      );
    });
  }
});
