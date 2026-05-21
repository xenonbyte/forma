import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertBuiltInStyles, assertCopiedBuiltInStyles, assertWebAssets, copyAssets } from "../../../scripts/copy-assets.ts";

const minimalPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00,
  0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

const formaCommands = [
  "fm-list-product",
  "fm-status",
  "fm-requirement",
  "fm-design",
  "fm-refine-components",
  "fm-change-style",
  "fm-rollback-design"
] as const;

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
  "fm-list-product": "List and select Forma products, including setup status and language fallback.",
  "fm-status": "Report current Forma product, requirement, language, component, and design status.",
  "fm-requirement": "Add or modify a Forma requirement from any granularity of product input.",
  "fm-design": "Generate or update Forma page designs from UI-affecting requirements.",
  "fm-refine-components": "Refine Forma product component libraries.",
  "fm-change-style": "Change a Forma product design style.",
  "fm-rollback-design": "Roll back a Forma design version."
} as const;

type AgentPlatform = "claude" | "codex" | "gemini";

const agentTemplatesDir = new URL("../../../packages/agent/templates/", import.meta.url);

describe("copy-assets built-in style checks", () => {
  it("requires at least 50 built-in styles", async () => {
    const stylesDir = await mkdtemp(join(tmpdir(), "forma-styles-"));
    await writeFile(
      join(stylesDir, "styles.yaml"),
      [
        "styles:",
        ...Array.from({ length: 49 }, (_, index) => {
          const name = `style-${index}`;
          return [
            `  - name: ${name}`,
            "    description: Test style",
            `    design_md_path: styles/${name}/DESIGN.md`,
            "    variables:",
            "      primary: '#111827'",
            "      background: '#FFFFFF'",
            "      text-primary: '#111827'",
            "      font-heading: Inter",
            "      font-body: Inter",
            "      border-radius: 8px",
            "      spacing-unit: 8px"
          ].join("\n");
        })
      ].join("\n"),
      "utf8"
    );

    await expect(assertBuiltInStyles(stylesDir)).rejects.toThrow("Expected at least 50 built-in styles, found 49");
  });

  it("validates the repository built-in styles", async () => {
    const styles = await assertBuiltInStyles(new URL("../../../styles", import.meta.url));
    const previewTemplate = JSON.parse(await readFile(new URL("../../../styles/_preview-template.pen", import.meta.url), "utf8")) as {
      children?: unknown[];
      variables?: Record<string, unknown>;
    };

    expect(styles.length).toBeGreaterThanOrEqual(50);
    expect(previewTemplate.children?.length).toBeGreaterThan(0);
    expect(previewTemplate.variables).toHaveProperty("--primary");
    expect(styles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "linear", designMdPath: "styles/linear/DESIGN.md" }),
        expect.objectContaining({ name: "claude", designMdPath: "styles/claude/DESIGN.md" })
      ])
    );
  });

  it("fails when a copied style preview is missing", async () => {
    const { sourceStylesDir, copiedStylesDir } = await createCopiedStyleFixture(["style-0", "style-1"]);
    await rm(join(copiedStylesDir, "style-1", "preview@2x.png"));

    await expect(assertCopiedBuiltInStyles(sourceStylesDir, copiedStylesDir)).rejects.toThrow("preview@2x.png");
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
    }
  });

  it("documents the unified fm-requirement execution contract in every platform template", async () => {
    const requiredSnippets = [
      "save_requirement",
      "change_type",
      "ui_affected",
      "JSON structure validation",
      "re-emit valid JSON once",
      "get_requirement",
      "get_product_baseline",
      "get_product",
      "get_product_rules",
      "current document",
      "baseline",
      "language config",
      "rules",
      "page_id",
      "name",
      "baseline_page",
      "navigation references",
      "translation page/context references",
      "remove_page_ids",
      "languages.length * page_count > 10",
      "document/pages/navigation/rules/removals",
      "translations",
      "source_requirement",
      "current requirement id",
      "replaces_rule_id",
      "remove_rule_ids"
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

  it("documents v0.3 language, structured copy, and no-UI behavior in route templates", async () => {
    for (const platform of ["claude", "codex", "gemini"] as const) {
      const listProduct = await readFile(templateUrl(platform, "fm-list-product"), "utf8");
      expect(listProduct).toContain("list_products");
      expect(listProduct).toContain("numbered list");
      expect(listProduct).toContain("product name and product ID");
      expect(listProduct).toContain("choose by number");
      expect(listProduct).toContain("set_current_session");
      expect(listProduct).toContain("basic config is incomplete");
      expect(listProduct).toContain("init_product_config");
      expect(listProduct).toContain("update_product_config");
      expect(listProduct).toContain("retry `set_current_session` once");
      expect(listProduct).toContain("latest requirement");
      expect(listProduct).not.toContain("component-generation prompt");

      const status = await readFile(templateUrl(platform, "fm-status"), "utf8");
      expect(status).toContain("languages and default_language");

      for (const command of ["fm-design"] as const) {
        const template = await readFile(templateUrl(platform, command), "utf8");
        expect(template).toContain("当前需求无 UI 调整，无需设计");
        expect(template).toContain("ui_affected === false");
        expect(template).toContain("Do not call design/refine MCP tools");
        expect(template).toContain("exact structured page copy");
      }

      const design = await readFile(templateUrl(platform, "fm-design"), "utf8");
      expect(design).toContain("Do not call removed page-level design MCP tools");
      expect(design).toContain("requirement-level v6 design session flow");
      expect(design).not.toContain("generate_and_save_page_design");
      expect(design).not.toContain("generate_page_design");
      expect(design).not.toContain("save_designs");
      expect(design).not.toContain("complete_product_init");
    }

    const shared = await readFile(new URL("shared/SKILL.md", agentTemplatesDir), "utf8");
    expect(shared).toContain("language config");
    expect(shared).toContain("Product selection completeness excludes legacy component-initialization flags");
    expect(shared).toContain("collect missing platform, style, languages, and default_language");
    expect(shared).toContain("Do not generate components during product selection");
    expect(shared).toContain("Design routes must not call removed page-level design MCP tools");
    expect(shared).toContain("structured copy");
    expect(shared).toContain("ui_affected=false");
    expect(shared).toContain("stable MCP usage");
  });

  it("documents v6 agent template workflows and rejects legacy design routes", async () => {
    for (const platform of ["claude", "codex", "gemini"] as const) {
      const design = await readFile(templateUrl(platform, "fm-design"), "utf8");
      const rollback = await readFile(templateUrl(platform, "fm-rollback-design"), "utf8");
      const requirement = await readFile(templateUrl(platform, "fm-requirement"), "utf8");
      const changeStyle = await readFile(templateUrl(platform, "fm-change-style"), "utf8");
      const refineComponents = await readFile(templateUrl(platform, "fm-refine-components"), "utf8");
      const allTemplateText = [design, rollback, requirement, changeStyle, refineComponents].join("\n");

      for (const removedToolName of removedLegacyDesignTools) {
        expect(allTemplateText).not.toContain(removedToolName);
      }

      for (const requiredTool of [
        "get_requirement_design_canvas",
        "begin_requirement_design_session",
        "apply_requirement_design_operations",
        "validate_requirement_design_quality",
        "commit_requirement_design_session"
      ]) {
        expect(design).toContain(requiredTool);
      }
      expect(design).toContain("SEMANTIC_CONTRACT_REQUIRED");
      expect(design).toContain("REQUIREMENT_UPDATE_REQUIRED");
      expect(design).toContain("PENCIL_APP_REQUIRED");
      expect(design).toContain("no headless fallback");
      expect(design).toContain("component_refresh");
      expect(design).toContain("plan_import_metadata_normalization");
      expect(design).toContain("quality_repair");

      for (const semanticSnippet of [
        "declared_fields",
        "declared_actions",
        "declared_component_keys",
        "semantic.component_keys",
        "allowed_copy"
      ]) {
        expect(requirement).toContain(semanticSnippet);
      }

      expect(rollback).toContain("REQUIREMENT_DESIGN_CONTEXT_REQUIRED");
      expect(rollback).toContain("design_id");
      expect(rollback).toContain("get_requirement_design_history");
      expect(rollback).toContain("rollback_requirement_design");
      expect(rollback).toContain("apply_requirement_design_operations");
      expect(rollback).toContain("commit_requirement_design_session");

      expect(changeStyle).toContain("begin_product_component_session");
      expect(changeStyle).toContain("operation: \"change_style\"");
      expect(changeStyle).toContain("do not mutate existing requirement canvases");
      expect(refineComponents).toContain("begin_product_component_session");
      expect(refineComponents).toContain("operation: \"refine\"");
      expect(refineComponents).toContain("do not mutate existing requirement canvases");
    }

    const shared = await readFile(new URL("shared/SKILL.md", agentTemplatesDir), "utf8");
    expect(shared).toContain("generate_components");
    expect(shared).toContain("begin_product_component_session");
    expect(shared).toContain("commit_product_component_session");
    expect(shared).toContain("components: []");
    expect(shared).not.toContain("fm-refine-design");
  });

  it("copies v0.4 agent guidance for product selection, design init fallback, and deletion", async () => {
    const cliAssetsDir = fileURLToPath(new URL("../../../packages/cli/dist/assets/", import.meta.url));
    await mkdir(cliAssetsDir, { recursive: true });
    const copiedAssetsRoot = await mkdtemp(join(cliAssetsDir, "agent-test-v0.4-"));
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
      expect(shared).toContain("Product selection completeness excludes legacy component-initialization flags");
      expect(shared).toContain("collect missing platform, style, languages, and default_language");
      expect(shared).toContain("Do not generate components during product selection");
      expect(shared).toContain("Design routes must not call removed page-level design MCP tools");
      expect(shared).toContain("generate_components");
      expect(shared).not.toContain("complete_product_init");
      expect(shared).toContain("Only when the user explicitly asks to delete a product");
      expect(shared).toContain("repeat the product name and product ID");
      expect(shared).toContain("describe deletion scope");
      expect(shared).toContain("user must type the exact product ID");
      expect(shared).toContain("use the typed ID as `confirm_product_id`");
      expect(shared).toContain("Do not auto-fill `confirm_product_id` from context");
      expect(shared).toContain("confirm_product_id");
      expect(shared).toContain("session_cleared");
      expect(shared).toContain("recovery_warnings");
      expect(shared).not.toContain("delete_requirement");

      for (const platform of ["claude", "codex", "gemini"] as const) {
        const listProduct = await readCopiedTemplate(copiedTemplatesDir, platform, "fm-list-product");
        expect(listProduct).toContain("Basic config does not include legacy component-initialization flags");
        expect(listProduct).toContain("Deletion branch");
        expect(listProduct).toContain("Only when the user explicitly asks");
        expect(listProduct).toContain("repeat the product name and product ID");
        expect(listProduct).toContain("describe deletion scope");
        expect(listProduct).toContain("user must type the exact product ID");
        expect(listProduct).toContain("use the typed ID as `confirm_product_id`");
        expect(listProduct).toContain("Do not auto-fill `confirm_product_id` from context");
        expect(listProduct).toContain("session_cleared");
        expect(listProduct).toContain("run `fm-list-product` again");
        expect(listProduct).toContain("recovery_warnings");
        expect(listProduct).not.toContain("delete_requirement");
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
          "    variables:",
          "      primary: '#111827'",
          "      background: '#FFFFFF'",
          "      text-primary: '#111827'",
          "      font-heading: Inter",
          "      font-body: Inter",
          "      border-radius: 8px",
          "      spacing-unit: 8px"
        ].join("\n")
      )
    ].join("\n"),
    "utf8"
  );
}

async function writeStyleFiles(stylesDir: string, name: string) {
  await mkdir(join(stylesDir, name), { recursive: true });
  await writeFile(join(stylesDir, name, "DESIGN.md"), `# ${name}\n`, "utf8");
  await writeFile(join(stylesDir, name, "preview@2x.png"), minimalPng);
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
