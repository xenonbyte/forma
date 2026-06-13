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

describe("fm-app-icon load-bearing pieces present (PLAN-TASK-021)", () => {
  const platforms = ["claude", "codex", "gemini"] as const;

  // Each entry is a substring that MUST appear in every platform's fm-app-icon
  // template. These pin the load-bearing conventions tying T015↔T021↔T022.
  const required: ReadonlyArray<readonly [string, string]> = [
    ['name="primary"', "the canonical app-icon name the brand/ ref resolves to"],
    ['purpose="app-icon"', "the generate_image purpose for the launcher mark"],
    ["save_brand_asset", "the brand-asset persist tool"],
    ["generate_image", "the image generation tool"],
    ["MEDIA_NOT_CONFIGURED", "the image-model precondition error surfaced from generate_image"],
    ["Settings", "the web Settings guidance for the missing image model"],
    ["veto", "the Read-inspection veto step"],
    ["craft/image-prompts.md", "the app-icon prompt scaffold source"],
    ["forma-image://brand/app-icon", "the brand ref that resolves to the primary record"],
    ["count=3", "the three-candidate generation"],
    ["overwrite", "the existing-icon overwrite semantics"],
  ];

  for (const platform of platforms) {
    for (const [needle, why] of required) {
      it(`fm-app-icon on ${platform} contains ${JSON.stringify(needle)} (${why})`, () => {
        const body = readTemplate(platform, "fm-app-icon");
        expect(body, `fm-app-icon/${platform} must contain ${JSON.stringify(needle)} — ${why}`).toContain(needle);
      });
    }
  }

  // Regression guard: fabricated error codes must never appear (PLAN-TASK-021)
  for (const platform of platforms) {
    it(`fm-app-icon on ${platform} does NOT contain fabricated PRODUCT_NOT_CONFIGURED`, () => {
      const body = readTemplate(platform, "fm-app-icon");
      expect(body, `fm-app-icon/${platform} must NOT reference the non-existent PRODUCT_NOT_CONFIGURED code`).not.toContain(
        "PRODUCT_NOT_CONFIGURED",
      );
    });

    it(`fm-app-icon on ${platform} contains real BRAND_ASSET_INVALID_INPUT error code`, () => {
      const body = readTemplate(platform, "fm-app-icon");
      expect(body, `fm-app-icon/${platform} must reference the real BRAND_ASSET_INVALID_INPUT code`).toContain(
        "BRAND_ASSET_INVALID_INPUT",
      );
    });
  }
});
