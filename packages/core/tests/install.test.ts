import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { InstallService, readYaml } from "../src/index.js";

const commands = [
  "fm-list-product",
  "fm-status",
  "fm-upload-requirement",
  "fm-update-requirement",
  "fm-design",
  "fm-refine-design",
  "fm-refine-components",
  "fm-change-style",
  "fm-rollback-design"
] as const;

type Platform = "claude" | "codex" | "gemini";

interface InstallManifest {
  platform: Platform;
  installed_paths: string[];
  backups: Array<{ target: string; backup: string }>;
  config_paths: string[];
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function createService() {
  const root = await mkdtemp(join(tmpdir(), "forma-install-"));
  const formaHome = join(root, ".forma");
  const userHome = join(root, "user");
  const service = new InstallService({
    formaHome,
    userHome,
    templatesDir: resolve("packages/agent/templates")
  });
  return { formaHome, userHome, service };
}

async function readManifest(formaHome: string, platform: Platform): Promise<InstallManifest> {
  return readYaml<InstallManifest>(join(formaHome, "manifests", `${platform}.manifest`));
}

describe("InstallService", () => {
  it("installs all platform command templates and shared skill", async () => {
    const { formaHome, userHome, service } = await createService();

    await service.installPlatforms(["claude", "codex", "gemini"]);

    for (const command of commands) {
      await expect(readFile(join(userHome, ".claude", "commands", `${command}.md`), "utf8")).resolves.toContain(
        `# Forma route: ${command}`
      );
      await expect(readFile(join(userHome, ".gemini", "commands", `${command}.toml`), "utf8")).resolves.toContain(
        `# Forma route: ${command}`
      );
      await expect(
        readFile(join(userHome, ".codex", "prompts", "skills", command, "SKILL.md"), "utf8")
      ).resolves.toContain(`# Forma route: ${command}`);
    }
    await expect(readFile(join(formaHome, "skills", "forma", "SKILL.md"), "utf8")).resolves.toContain(
      "Forma shared guidance"
    );
  });

  it("records every installed file and config path in platform manifests", async () => {
    const { formaHome, userHome, service } = await createService();

    await service.installPlatforms(["claude", "codex", "gemini"]);

    const claude = await readManifest(formaHome, "claude");
    expect(claude.platform).toBe("claude");
    expect(claude.installed_paths).toEqual(
      expect.arrayContaining([
        join(formaHome, "skills", "forma", "SKILL.md"),
        ...commands.map((command) => join(userHome, ".claude", "commands", `${command}.md`))
      ])
    );
    expect(claude.config_paths).toEqual([join(userHome, ".claude", "mcp.json")]);

    const gemini = await readManifest(formaHome, "gemini");
    expect(gemini.platform).toBe("gemini");
    expect(gemini.installed_paths).toEqual(
      expect.arrayContaining([
        join(formaHome, "skills", "forma", "SKILL.md"),
        ...commands.map((command) => join(userHome, ".gemini", "commands", `${command}.toml`))
      ])
    );
    expect(gemini.config_paths).toEqual([join(userHome, ".gemini", "settings.json")]);

    const codex = await readManifest(formaHome, "codex");
    expect(codex.platform).toBe("codex");
    expect(codex.installed_paths).toEqual(
      expect.arrayContaining([
        join(formaHome, "skills", "forma", "SKILL.md"),
        ...commands.map((command) => join(userHome, ".codex", "prompts", "skills", command, "SKILL.md"))
      ])
    );
    expect(codex.config_paths).toEqual([join(userHome, ".codex", "config.toml")]);
  });

  it("uninstalls only manifest-owned files and preserves unrelated files and config entries", async () => {
    const { formaHome, userHome, service } = await createService();
    const unrelatedClaudeCommand = join(userHome, ".claude", "commands", "custom.md");
    const unrelatedGeminiCommand = join(userHome, ".gemini", "commands", "custom.toml");
    const unrelatedCodexSkill = join(userHome, ".codex", "prompts", "skills", "custom", "SKILL.md");
    await mkdir(join(userHome, ".claude", "commands"), { recursive: true });
    await mkdir(join(userHome, ".gemini", "commands"), { recursive: true });
    await mkdir(join(userHome, ".codex", "prompts", "skills", "custom"), { recursive: true });
    await writeFile(unrelatedClaudeCommand, "# Custom\n", "utf8");
    await writeFile(unrelatedGeminiCommand, "description = \"Custom\"\n", "utf8");
    await writeFile(unrelatedCodexSkill, "# Custom\n", "utf8");
    await mkdir(join(userHome, ".claude"), { recursive: true });
    await mkdir(join(userHome, ".gemini"), { recursive: true });
    await mkdir(join(userHome, ".codex"), { recursive: true });
    await writeFile(
      join(userHome, ".claude", "mcp.json"),
      JSON.stringify({ mcpServers: { existing: { command: "existing" } } }, null, 2),
      "utf8"
    );
    await writeFile(
      join(userHome, ".gemini", "settings.json"),
      JSON.stringify({ mcpServers: { existing: { command: "existing" } } }, null, 2),
      "utf8"
    );
    await writeFile(join(userHome, ".codex", "config.toml"), "[mcp_servers.existing]\ncommand = \"existing\"\n", "utf8");

    await service.installPlatforms(["claude", "codex", "gemini"]);
    await service.uninstallPlatforms(["claude", "codex", "gemini"]);

    for (const command of commands) {
      await expect(exists(join(userHome, ".claude", "commands", `${command}.md`))).resolves.toBe(false);
      await expect(exists(join(userHome, ".gemini", "commands", `${command}.toml`))).resolves.toBe(false);
      await expect(exists(join(userHome, ".codex", "prompts", "skills", command, "SKILL.md"))).resolves.toBe(false);
    }
    await expect(readFile(unrelatedClaudeCommand, "utf8")).resolves.toBe("# Custom\n");
    await expect(readFile(unrelatedGeminiCommand, "utf8")).resolves.toBe("description = \"Custom\"\n");
    await expect(readFile(unrelatedCodexSkill, "utf8")).resolves.toBe("# Custom\n");
    await expect(readFile(join(userHome, ".claude", "mcp.json"), "utf8")).resolves.toContain("existing");
    await expect(readFile(join(userHome, ".claude", "mcp.json"), "utf8")).resolves.not.toContain("forma");
    await expect(readFile(join(userHome, ".gemini", "settings.json"), "utf8")).resolves.toContain("existing");
    await expect(readFile(join(userHome, ".gemini", "settings.json"), "utf8")).resolves.not.toContain("forma");
    await expect(readFile(join(userHome, ".codex", "config.toml"), "utf8")).resolves.toContain("existing");
    await expect(readFile(join(userHome, ".codex", "config.toml"), "utf8")).resolves.not.toContain("Forma route");
  });

  it("backs up pre-existing target files before replacement and restores them on uninstall", async () => {
    const { formaHome, userHome, service } = await createService();
    const claudeCommand = join(userHome, ".claude", "commands", "fm-design.md");
    const codexConfig = join(userHome, ".codex", "config.toml");
    const sharedSkill = join(formaHome, "skills", "forma", "SKILL.md");
    await mkdir(join(userHome, ".claude", "commands"), { recursive: true });
    await mkdir(join(userHome, ".codex"), { recursive: true });
    await mkdir(join(formaHome, "skills", "forma"), { recursive: true });
    await writeFile(claudeCommand, "# Local Claude Command\n", "utf8");
    await writeFile(codexConfig, "[mcp_servers.existing]\ncommand = \"existing\"\n", "utf8");
    await writeFile(sharedSkill, "# Local Shared Skill\n", "utf8");

    await service.installPlatforms(["claude", "codex", "gemini"]);

    const claudeManifest = await readManifest(formaHome, "claude");
    expect(claudeManifest.backups).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: claudeCommand })])
    );
    expect(claudeManifest.backups).toEqual(expect.arrayContaining([expect.objectContaining({ target: sharedSkill })]));
    const codexManifest = await readManifest(formaHome, "codex");
    expect(codexManifest.backups).toEqual(expect.arrayContaining([expect.objectContaining({ target: codexConfig })]));
    await expect(readFile(claudeCommand, "utf8")).resolves.toContain("# Forma route: fm-design");

    await service.uninstallPlatforms(["claude", "codex", "gemini"]);

    await expect(readFile(claudeCommand, "utf8")).resolves.toBe("# Local Claude Command\n");
    await expect(readFile(codexConfig, "utf8")).resolves.toBe("[mcp_servers.existing]\ncommand = \"existing\"\n");
    await expect(readFile(sharedSkill, "utf8")).resolves.toBe("# Local Shared Skill\n");
  });

  it("injects and removes MCP config entries without deleting unrelated user config", async () => {
    const { userHome, service } = await createService();
    await mkdir(join(userHome, ".claude"), { recursive: true });
    await mkdir(join(userHome, ".gemini"), { recursive: true });
    await mkdir(join(userHome, ".codex"), { recursive: true });
    await writeFile(join(userHome, ".claude", "mcp.json"), JSON.stringify({ keep: true }, null, 2), "utf8");
    await writeFile(join(userHome, ".gemini", "settings.json"), JSON.stringify({ keep: true }, null, 2), "utf8");
    await writeFile(join(userHome, ".codex", "config.toml"), "theme = \"dark\"\n", "utf8");

    await service.installPlatforms(["claude", "codex", "gemini"]);

    await expect(readFile(join(userHome, ".claude", "mcp.json"), "utf8")).resolves.toContain("\"forma\"");
    await expect(readFile(join(userHome, ".gemini", "settings.json"), "utf8")).resolves.toContain("\"forma\"");
    await expect(readFile(join(userHome, ".codex", "config.toml"), "utf8")).resolves.toContain(
      "# BEGIN Forma managed mcp server"
    );

    await service.uninstallPlatforms(["claude", "codex", "gemini"]);

    await expect(readFile(join(userHome, ".claude", "mcp.json"), "utf8")).resolves.toContain("\"keep\": true");
    await expect(readFile(join(userHome, ".claude", "mcp.json"), "utf8")).resolves.not.toContain("\"forma\"");
    await expect(readFile(join(userHome, ".gemini", "settings.json"), "utf8")).resolves.toContain("\"keep\": true");
    await expect(readFile(join(userHome, ".gemini", "settings.json"), "utf8")).resolves.not.toContain("\"forma\"");
    await expect(readFile(join(userHome, ".codex", "config.toml"), "utf8")).resolves.toBe("theme = \"dark\"\n");
  });
});
