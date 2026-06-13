import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formaAgentCommands,
  formaAgentPlatformMetadata,
} from "../src/index.js";

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
        expect(body, `${cmd}/${platform} must contain "Palette design-read"`).toContain(
          "Palette design-read"
        );
        expect(body, `${cmd}/${platform} must mention brass/clay/oxblood palette guard`).toContain(
          "brass/clay/oxblood"
        );
      });
    }
  }
});
