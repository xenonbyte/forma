import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertBuiltInStyles, assertCopiedBuiltInStyles, assertWebAssets, assetCopies, copyAssets } from "../../../scripts/copy-assets.ts";

const formaCommands = [
  "fm-list-product",
  "fm-status",
  "fm-requirement",
  "fm-rollback-design",
  "fm-design"
] as const;

const disabledRuntimeCommands = ["fm-refine-components", "fm-change-style"] as const;
const removedRequirementCommands = ["fm-upload-requirement", "fm-update-requirement"] as const;
const removedLegacyDesignTools = [
  "complete_product_init",
  "generate_page_design",
  "save_designs",
  "generate_and_save_page_design",
  "rollback_design",
  "diff_designs",
  "get_design_annotations",
  "export_design_asset"
] as const;

const codexSkillDescriptions = {
  "fm-list-product": "List and select Forma products, or delete a product on explicit request.",
  "fm-status": "Report Forma product, requirement, and artifact status. Read-only.",
  "fm-requirement": "Add or update a Forma requirement from any granularity of product input.",
  "fm-rollback-design": "Roll back a Forma design artifact to a previous version.",
  "fm-design": "Generate a static-HTML page design for a Forma requirement via MCP, then self-review."
} as const;

type AgentPlatform = "claude" | "codex" | "gemini";

const agentTemplatesDir = new URL("../../../packages/agent/templates/", import.meta.url);

describe("copy-assets asset list", () => {
  it("includes a craft entry in assetCopies", () => {
    expect(assetCopies.some((c) => c.label === "craft")).toBe(true);
  });
});

describe("copy-assets built-in style checks", () => {
  it("requires at least 50 built-in styles", async () => {
    const stylesDir = await mkdtemp(join(tmpdir(), "forma-styles-"));
    const names = Array.from({ length: 49 }, (_, index) => `style-${index}`);
    await writeStylesYaml(stylesDir, names);
    for (const name of names) {
      await writeStyleFiles(stylesDir, name);
    }

    await expect(assertBuiltInStyles(stylesDir)).rejects.toThrow("Expected at least 50 built-in styles, found 49");
  });

  it("validates the repository built-in styles", async () => {
    const styles = await assertBuiltInStyles(new URL("../../../styles", import.meta.url));

    expect(styles.length).toBeGreaterThanOrEqual(50);
    expect(styles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "linear-app", designMdPath: "styles/linear-app/DESIGN.md", tokensCssPath: "styles/linear-app/tokens.css", componentsHtmlPath: "styles/linear-app/components.html" }),
        expect.objectContaining({ name: "claude", designMdPath: "styles/claude/DESIGN.md", tokensCssPath: "styles/claude/tokens.css", componentsHtmlPath: "styles/claude/components.html" })
      ])
    );
  });

  it("fails when a copied style tokens.css is missing", async () => {
    const { sourceStylesDir, copiedStylesDir } = await createCopiedStyleFixture(["style-0", "style-1"]);
    await rm(join(copiedStylesDir, "style-1", "tokens.css"));

    await expect(assertCopiedBuiltInStyles(sourceStylesDir, copiedStylesDir)).rejects.toThrow("tokens.css");
  });

  it("fails when copied style names do not match source styles", async () => {
    const { sourceStylesDir, copiedStylesDir } = await createCopiedStyleFixture(["style-0", "style-1"]);
    await writeStylesYaml(copiedStylesDir, ["style-0", "stale-style"]);
    await writeStyleFiles(copiedStylesDir, "stale-style");

    await expect(assertCopiedBuiltInStyles(sourceStylesDir, copiedStylesDir)).rejects.toThrow(
      "Copied built-in styles do not match source styles"
    );
  });
});

describe("agent template inventory", () => {
  it("keeps the v0.3 command arrays and source templates aligned", async () => {
    const agentIndex = await readFile(new URL("../../../packages/agent/src/index.ts", import.meta.url), "utf8");
    const coreInstall = await readFile(new URL("../../../packages/core/src/install.ts", import.meta.url), "utf8");

    expect(extractConstArray(agentIndex, "formaAgentCommands")).toEqual([...formaCommands]);
    expect(extractConstArray(coreInstall, "formaInstallCommands")).toEqual([...formaCommands]);
    await expect(sourceCommands("claude")).resolves.toEqual([...formaCommands].sort());
    await expect(sourceCommands("codex")).resolves.toEqual([...formaCommands].sort());
    await expect(sourceCommands("gemini")).resolves.toEqual([...formaCommands].sort());

    for (const platform of ["claude", "codex", "gemini"] as const) {
      for (const command of formaCommands) {
        await expect(readFile(templateUrl(platform, command), "utf8")).resolves.toContain(`# Forma route: ${command}`);
      }
      for (const command of removedRequirementCommands) {
        await expect(pathExists(templateUrl(platform, command))).resolves.toBe(false);
      }
      for (const command of disabledRuntimeCommands) {
        await expect(pathExists(templateUrl(platform, command))).resolves.toBe(false);
      }
    }
  });

  it("documents the unified fm-requirement execution contract in every platform template", async () => {
    const requiredSnippets = [
      "save_requirement",
      "change_type",
      "ui_affected",
      "get_requirement",
      "get_product_baseline",
      "get_product",
      "get_product_rules",
      "baseline",
      "language config",
      "rules",
      "page_id",
      "name",
      "baseline_page",
      "navigation references",
      "remove_page_ids",
      "languages.length * page_count > 10",
      "translations"
    ];

    for (const platform of ["claude", "codex", "gemini"] as const) {
      const template = await readFile(templateUrl(platform, "fm-requirement"), "utf8");
      for (const snippet of requiredSnippets) {
        expect(template).toContain(snippet);
      }
    }
  });

  it("keeps every Codex command installable as a skill", async () => {
    for (const command of formaCommands) {
      const template = await readFile(templateUrl("codex", command), "utf8");

      expect(
        template.startsWith(`---\nname: ${command}\ndescription: ${codexSkillDescriptions[command]}\n---\n`)
      ).toBe(true);
      expect(template).toContain(`# Forma route: ${command}`);
      expect(template).toContain(`Codex route: \`$${command}\``);
    }
  });

  it("documents v8 product selection and no-UI behavior in route templates", async () => {
    for (const platform of ["claude", "codex", "gemini"] as const) {
      const listProduct = await readFile(templateUrl(platform, "fm-list-product"), "utf8");
      expect(listProduct).toContain("list_products");
      expect(listProduct).toContain("numbered list");
      expect(listProduct).toContain("product name and product ID");
      expect(listProduct).toContain("choose by number");
      expect(listProduct).toContain("confirm_product_id");
      expect(listProduct).toContain("latest requirement");
      expect(listProduct).not.toContain("set_current_session");

      for (const command of disabledRuntimeCommands) {
        await expect(pathExists(templateUrl(platform, command))).resolves.toBe(false);
      }
    }

    const shared = await readFile(new URL("shared/SKILL.md", agentTemplatesDir), "utf8");
    expect(shared).toContain("ui_affected=false");
    expect(shared).toContain("stable MCP usage");
    expect(shared).toContain("confirm_product_id");
    expect(shared).toContain("recovery_warnings");
    expect(shared).not.toContain("generate_components");
    expect(shared).not.toContain("set_current_session");
  });

  it("documents v8 design artifact workflows and rejects legacy design routes", async () => {
    for (const platform of ["claude", "codex", "gemini"] as const) {
      const rollback = await readFile(templateUrl(platform, "fm-rollback-design"), "utf8");
      const requirement = await readFile(templateUrl(platform, "fm-requirement"), "utf8");
      const allTemplateText = [rollback, requirement].join("\n");

      for (const removedToolName of removedLegacyDesignTools) {
        expect(allTemplateText).not.toContain(removedToolName);
      }

      expect(allTemplateText).not.toContain("generate_requirement_design");
      expect(allTemplateText).not.toContain("refine_requirement_design");
      expect(allTemplateText).not.toContain("change_style");

      expect(rollback).toContain("rollback_requirement_design");
      expect(rollback).toContain("list_product_artifacts");
      expect(rollback).toContain("include_superseded");
      expect(rollback).toContain("page_id");
      expect(rollback).toContain("variant");
      expect(rollback).toContain("target_version");
      expect(rollback).toContain("current_version");
      expect(rollback).toContain("versions");
      expect(rollback).not.toContain("target_artifact_id");
    }

    const shared = await readFile(new URL("shared/SKILL.md", agentTemplatesDir), "utf8");
    expect(shared).toContain("list_products");
    expect(shared).toContain("confirm_product_id");
    expect(shared).toContain("recovery_warnings");
    expect(shared).not.toContain("begin_product_component_session");
  });

  it("copies v8 agent guidance for product selection and deletion", async () => {
    const cliAssetsDir = fileURLToPath(new URL("../../../packages/cli/dist/assets/", import.meta.url));
    await mkdir(cliAssetsDir, { recursive: true });
    const copiedAssetsRoot = await mkdtemp(join(cliAssetsDir, "agent-test-v8-"));
    const copiedTemplatesDir = join(copiedAssetsRoot, "templates");

    try {
      await copyAssets([
        {
          label: "agent templates",
          source: fileURLToPath(agentTemplatesDir),
          target: copiedTemplatesDir
        }
      ]);

      const shared = await readFile(join(copiedTemplatesDir, "shared", "SKILL.md"), "utf8");
      expect(shared).not.toContain("complete_product_init");
      expect(shared).not.toContain("generate_components");
      expect(shared).toContain("Only when the user explicitly asks to delete a product");
      expect(shared).toContain("repeat the product name and product ID");
      expect(shared).toContain("describe deletion scope");
      expect(shared).toContain("user must type the exact product ID");
      expect(shared).toContain("Do not auto-fill confirmation from context");
      expect(shared).toContain("confirm_product_id");
      expect(shared).toContain("recovery_warnings");
      expect(shared).not.toContain("delete_requirement");

      for (const platform of ["claude", "codex", "gemini"] as const) {
        const listProduct = await readCopiedTemplate(copiedTemplatesDir, platform, "fm-list-product");
        expect(listProduct).toContain("Deletion branch");
        expect(listProduct).toContain("Only when the user explicitly asks");
        expect(listProduct).toContain("repeat the product name and product ID");
        expect(listProduct).toContain("describe deletion scope");
        expect(listProduct).toContain("user must type the exact product ID");
        expect(listProduct).toContain("Do not auto-fill confirmation from context");
        expect(listProduct).toContain("recovery_warnings");
        expect(listProduct).not.toContain("delete_requirement");
        expect(listProduct).not.toContain("session_cleared");
      }
    } finally {
      await rm(copiedAssetsRoot, { recursive: true, force: true });
    }
  });
});

describe("copy-assets Web asset checks", () => {
  it("fails when the Web dist source is missing during copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "forma-web-assets-copy-"));
    const missingSource = join(root, "missing-web-dist");
    const target = fileURLToPath(new URL("../../../packages/cli/dist/assets/web-test-missing", import.meta.url));

    await rm(target, { recursive: true, force: true });
    await expect(copyAssets([{ label: "web dist", source: missingSource, target }])).rejects.toThrow(
      "Missing web dist"
    );
  });

  it("requires copied Web assets to include index, JavaScript, and CSS bundles", async () => {
    const webAssetsDir = await mkdtemp(join(tmpdir(), "forma-web-assets-"));
    await mkdir(join(webAssetsDir, "assets"), { recursive: true });
    await writeFile(join(webAssetsDir, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf8");
    await writeFile(join(webAssetsDir, "assets", "index.js"), "console.log('forma');", "utf8");

    await expect(assertWebAssets(webAssetsDir)).rejects.toThrow("CSS bundle");

    await writeFile(join(webAssetsDir, "assets", "index.css"), "body { margin: 0; }", "utf8");
    await expect(assertWebAssets(webAssetsDir)).resolves.toBeUndefined();
  });
});

async function createCopiedStyleFixture(names: string[]) {
  const root = await mkdtemp(join(tmpdir(), "forma-copied-styles-"));
  const sourceStylesDir = join(root, "source");
  const copiedStylesDir = join(root, "copied");

  await writeStylesYaml(sourceStylesDir, names);
  for (const name of names) {
    await writeStyleFiles(sourceStylesDir, name);
  }
  await cp(sourceStylesDir, copiedStylesDir, { recursive: true });

  return { sourceStylesDir, copiedStylesDir };
}

async function writeStylesYaml(stylesDir: string, names: string[]) {
  await mkdir(stylesDir, { recursive: true });
  await writeFile(
    join(stylesDir, "styles.yaml"),
    [
      "styles:",
      ...names.map((name) =>
        [
          `  - name: ${name}`,
          "    description: Test style",
          `    design_md_path: styles/${name}/DESIGN.md`,
          `    tokens_css_path: styles/${name}/tokens.css`,
          `    components_html_path: styles/${name}/components.html`
        ].join("\n")
      )
    ].join("\n"),
    "utf8"
  );
}

async function writeStyleFiles(stylesDir: string, name: string) {
  await mkdir(join(stylesDir, name), { recursive: true });
  await writeFile(join(stylesDir, name, "DESIGN.md"), `# ${name}\n`, "utf8");
  await writeFile(join(stylesDir, name, "tokens.css"), `:root { --color: #000; }\n`, "utf8");
  await writeFile(join(stylesDir, name, "components.html"), `<div class="${name}"></div>\n`, "utf8");
}

function templateUrl(platform: AgentPlatform, command: string): URL {
  if (platform === "claude") {
    return new URL(`claude/${command}.md`, agentTemplatesDir);
  }
  if (platform === "gemini") {
    return new URL(`gemini/${command}.toml`, agentTemplatesDir);
  }
  return new URL(`codex/${command}/SKILL.md`, agentTemplatesDir);
}

function readCopiedTemplate(root: string, platform: AgentPlatform, command: string): Promise<string> {
  if (platform === "claude") {
    return readFile(join(root, "claude", `${command}.md`), "utf8");
  }
  if (platform === "gemini") {
    return readFile(join(root, "gemini", `${command}.toml`), "utf8");
  }
  return readFile(join(root, "codex", command, "SKILL.md"), "utf8");
}

async function pathExists(path: URL): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function sourceCommands(platform: AgentPlatform): Promise<string[]> {
  const entries = await readdir(new URL(`${platform}/`, agentTemplatesDir), { withFileTypes: true });
  return entries
    .filter((entry) => {
      if (platform === "codex") {
        return entry.isDirectory();
      }
      return entry.isFile();
    })
    .map((entry) => {
      if (platform === "claude") {
        return entry.name.replace(/\.md$/, "");
      }
      if (platform === "gemini") {
        return entry.name.replace(/\.toml$/, "");
      }
      return entry.name;
    })
    .sort();
}

function extractConstArray(source: string, constName: string): string[] {
  const match = source.match(new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\] as const;`));
  if (!match) {
    throw new Error(`Missing ${constName} export`);
  }
  return Array.from(match[1].matchAll(/"([^"]+)"/g), ([, command]) => command);
}
