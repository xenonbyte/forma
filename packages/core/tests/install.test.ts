import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

  it("keeps shared skill backup across staged platform uninstall", async () => {
    const { formaHome, service } = await createService();
    const sharedSkill = join(formaHome, "skills", "forma", "SKILL.md");
    await mkdir(join(formaHome, "skills", "forma"), { recursive: true });
    await writeFile(sharedSkill, "# Local Shared Skill\n", "utf8");

    await service.installPlatforms(["claude", "codex", "gemini"]);

    await service.uninstallPlatforms(["claude"]);
    await expect(readFile(sharedSkill, "utf8")).resolves.toContain("Forma shared guidance");

    await service.uninstallPlatforms(["codex", "gemini"]);

    await expect(readFile(sharedSkill, "utf8")).resolves.toBe("# Local Shared Skill\n");
  });

  it("preserves existing backups across reinstall before uninstall", async () => {
    const { formaHome, userHome, service } = await createService();
    const claudeCommand = join(userHome, ".claude", "commands", "fm-design.md");
    const claudeConfig = join(userHome, ".claude", "mcp.json");
    const sharedSkill = join(formaHome, "skills", "forma", "SKILL.md");
    const originalClaudeConfig = JSON.stringify({ keep: true }, null, 2);
    await mkdir(join(userHome, ".claude", "commands"), { recursive: true });
    await mkdir(join(userHome, ".claude"), { recursive: true });
    await mkdir(join(formaHome, "skills", "forma"), { recursive: true });
    await writeFile(claudeCommand, "# Local Claude Command\n", "utf8");
    await writeFile(claudeConfig, originalClaudeConfig, "utf8");
    await writeFile(sharedSkill, "# Local Shared Skill\n", "utf8");

    await service.installPlatforms(["claude"]);
    await service.installPlatforms(["claude"]);

    const manifest = await readManifest(formaHome, "claude");
    expect(manifest.backups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: claudeCommand }),
        expect.objectContaining({ target: claudeConfig }),
        expect.objectContaining({ target: sharedSkill })
      ])
    );

    await service.uninstallPlatforms(["claude"]);

    await expect(readFile(claudeCommand, "utf8")).resolves.toBe("# Local Claude Command\n");
    await expect(readFile(claudeConfig, "utf8")).resolves.toBe(originalClaudeConfig);
    await expect(readFile(sharedSkill, "utf8")).resolves.toBe("# Local Shared Skill\n");
  });

  it("does not reuse stale backup files across completed install cycles", async () => {
    const { userHome, service } = await createService();
    const claudeCommand = join(userHome, ".claude", "commands", "fm-design.md");
    await mkdir(join(userHome, ".claude", "commands"), { recursive: true });
    await writeFile(claudeCommand, "# Original A\n", "utf8");

    await service.installPlatforms(["claude"]);
    await service.uninstallPlatforms(["claude"]);
    await writeFile(claudeCommand, "# Current B\n", "utf8");
    await service.installPlatforms(["claude"]);
    await service.uninstallPlatforms(["claude"]);

    await expect(readFile(claudeCommand, "utf8")).resolves.toBe("# Current B\n");
  });

  it("does not back up Forma-owned Claude files on reinstall", async () => {
    const { userHome, service } = await createService();

    await service.installPlatforms(["claude"]);
    await service.installPlatforms(["claude"]);
    await service.uninstallPlatforms(["claude"]);

    for (const command of commands) {
      await expect(exists(join(userHome, ".claude", "commands", `${command}.md`))).resolves.toBe(false);
    }
    await expect(exists(join(userHome, ".claude", "mcp.json"))).resolves.toBe(false);
  });

  it("does not restore shared skill created by another platform during the same install set", async () => {
    const { formaHome, service } = await createService();
    const sharedSkill = join(formaHome, "skills", "forma", "SKILL.md");

    await service.installPlatforms(["claude", "codex", "gemini"]);
    await service.uninstallPlatforms(["claude", "codex", "gemini"]);

    await expect(exists(sharedSkill)).resolves.toBe(false);
  });

  it("preserves pre-existing files that already match managed templates", async () => {
    const { userHome, service } = await createService();
    const claudeCommand = join(userHome, ".claude", "commands", "fm-design.md");
    const template = await readFile(resolve("packages/agent/templates/claude/fm-design.md"), "utf8");
    await mkdir(join(userHome, ".claude", "commands"), { recursive: true });
    await writeFile(claudeCommand, template, "utf8");

    await service.installPlatforms(["claude"]);
    await service.uninstallPlatforms(["claude"]);

    await expect(readFile(claudeCommand, "utf8")).resolves.toBe(template);
  });

  it("overwrites orphan backup files before recording a new install lifecycle", async () => {
    const { formaHome, userHome, service } = await createService();
    const claudeCommand = join(userHome, ".claude", "commands", "fm-design.md");
    const staleBackup = join(formaHome, "backups", "claude", ".claude", "commands", "fm-design.md");
    await mkdir(join(userHome, ".claude", "commands"), { recursive: true });
    await mkdir(join(formaHome, "backups", "claude", ".claude", "commands"), { recursive: true });
    await writeFile(claudeCommand, "# current B\n", "utf8");
    await writeFile(staleBackup, "# stale A\n", "utf8");

    await service.installPlatforms(["claude"]);
    await service.uninstallPlatforms(["claude"]);

    await expect(readFile(claudeCommand, "utf8")).resolves.toBe("# current B\n");
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

  it("restores pre-existing user-owned Forma MCP config entries after reinstall and uninstall", async () => {
    const { userHome, service } = await createService();
    const claudeConfig = join(userHome, ".claude", "mcp.json");
    const geminiConfig = join(userHome, ".gemini", "settings.json");
    const codexConfig = join(userHome, ".codex", "config.toml");
    const originalClaudeConfig = `${JSON.stringify(
      { forma: { command: "user-forma" }, keep: true },
      null,
      2
    )}\n`;
    const originalGeminiConfig = `${JSON.stringify(
      { mcpServers: { forma: { command: "user-forma" } }, keep: true },
      null,
      2
    )}\n`;
    const originalCodexConfig = `theme = "dark"

# BEGIN Forma managed mcp server
[mcp_servers.forma]
command = "user-forma"
args = ["mcp"]
# END Forma managed mcp server
`;
    await mkdir(join(userHome, ".claude"), { recursive: true });
    await mkdir(join(userHome, ".gemini"), { recursive: true });
    await mkdir(join(userHome, ".codex"), { recursive: true });
    await writeFile(claudeConfig, originalClaudeConfig, "utf8");
    await writeFile(geminiConfig, originalGeminiConfig, "utf8");
    await writeFile(codexConfig, originalCodexConfig, "utf8");

    await service.installPlatforms(["claude", "codex", "gemini"]);
    await service.installPlatforms(["claude", "codex", "gemini"]);
    await service.uninstallPlatforms(["claude", "codex", "gemini"]);

    await expect(readFile(claudeConfig, "utf8")).resolves.toBe(originalClaudeConfig);
    await expect(readFile(geminiConfig, "utf8")).resolves.toBe(originalGeminiConfig);
    await expect(readFile(codexConfig, "utf8")).resolves.toBe(originalCodexConfig);
  });

  it("merges config backups with unrelated config added after install", async () => {
    const { userHome, service } = await createService();
    const claudeConfig = join(userHome, ".claude", "mcp.json");
    const geminiConfig = join(userHome, ".gemini", "settings.json");
    const codexConfig = join(userHome, ".codex", "config.toml");
    await mkdir(join(userHome, ".claude"), { recursive: true });
    await mkdir(join(userHome, ".gemini"), { recursive: true });
    await mkdir(join(userHome, ".codex"), { recursive: true });
    await writeFile(
      claudeConfig,
      `${JSON.stringify({ forma: { command: "user-forma" }, keep: true }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      geminiConfig,
      `${JSON.stringify(
        {
          mcpServers: {
            forma: { command: "user-forma" },
            existing: { command: "existing" }
          },
          keep: true
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      codexConfig,
      `theme = "dark"

# BEGIN Forma managed mcp server
[mcp_servers.forma]
command = "user-forma"
args = ["mcp"]
# END Forma managed mcp server
`,
      "utf8"
    );

    await service.installPlatforms(["claude", "codex", "gemini"]);
    await service.installPlatforms(["claude", "codex", "gemini"]);

    await writeFile(
      claudeConfig,
      `${JSON.stringify(
        {
          ...(JSON.parse(await readFile(claudeConfig, "utf8")) as Record<string, unknown>),
          postInstall: true
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    const geminiAfterInstall = JSON.parse(await readFile(geminiConfig, "utf8")) as {
      mcpServers: Record<string, unknown>;
      keep: boolean;
    };
    await writeFile(
      geminiConfig,
      `${JSON.stringify(
        {
          ...geminiAfterInstall,
          mcpServers: {
            ...geminiAfterInstall.mcpServers,
            postInstallServer: { command: "post-install" }
          },
          postInstall: true
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      codexConfig,
      `${await readFile(codexConfig, "utf8")}
post_install = true
`,
      "utf8"
    );

    await service.uninstallPlatforms(["claude", "codex", "gemini"]);

    expect(JSON.parse(await readFile(claudeConfig, "utf8"))).toEqual({
      forma: { command: "user-forma" },
      keep: true,
      postInstall: true
    });
    expect(JSON.parse(await readFile(geminiConfig, "utf8"))).toEqual({
      mcpServers: {
        forma: { command: "user-forma" },
        existing: { command: "existing" },
        postInstallServer: { command: "post-install" }
      },
      keep: true,
      postInstall: true
    });
    const codex = await readFile(codexConfig, "utf8");
    expect(codex).toContain('theme = "dark"');
    expect(codex).toContain("post_install = true");
    expect(codex).toContain('command = "user-forma"');
    expect(codex).not.toContain('command = "forma"');
  });

  it("restores config backups when current config files are missing at uninstall", async () => {
    const { userHome, service } = await createService();
    const claudeConfig = join(userHome, ".claude", "mcp.json");
    const geminiConfig = join(userHome, ".gemini", "settings.json");
    const codexConfig = join(userHome, ".codex", "config.toml");
    const originalClaudeConfig = `${JSON.stringify({ forma: { command: "user-forma" }, keep: true }, null, 2)}\n`;
    const originalGeminiConfig = `${JSON.stringify(
      { mcpServers: { forma: { command: "user-forma" } }, keep: true },
      null,
      2
    )}\n`;
    const originalCodexConfig = `theme = "dark"

[mcp_servers.forma]
command = "user-forma"
args = ["mcp"]
`;
    await mkdir(join(userHome, ".claude"), { recursive: true });
    await mkdir(join(userHome, ".gemini"), { recursive: true });
    await mkdir(join(userHome, ".codex"), { recursive: true });
    await writeFile(claudeConfig, originalClaudeConfig, "utf8");
    await writeFile(geminiConfig, originalGeminiConfig, "utf8");
    await writeFile(codexConfig, originalCodexConfig, "utf8");

    await service.installPlatforms(["claude", "codex", "gemini"]);
    await rm(claudeConfig);
    await rm(geminiConfig);
    await rm(codexConfig);

    await service.uninstallPlatforms(["claude", "codex", "gemini"]);

    await expect(readFile(claudeConfig, "utf8")).resolves.toBe(originalClaudeConfig);
    await expect(readFile(geminiConfig, "utf8")).resolves.toBe(originalGeminiConfig);
    await expect(readFile(codexConfig, "utf8")).resolves.toBe(originalCodexConfig);
  });

  it("handles unmarked Codex Forma tables without duplicating or losing user config", async () => {
    const { userHome, service } = await createService();
    const codexConfig = join(userHome, ".codex", "config.toml");
    await mkdir(join(userHome, ".codex"), { recursive: true });
    await writeFile(
      codexConfig,
      `theme = "dark"

[mcp_servers.forma]
command = "user-forma"
args = ["mcp"]

[mcp_servers.keep]
command = "keep"
`,
      "utf8"
    );

    await service.installPlatforms(["codex"]);

    const installed = await readFile(codexConfig, "utf8");
    expect(installed.match(/^\[mcp_servers\.forma\]$/gm)).toHaveLength(1);
    expect(installed).toContain('command = "forma"');
    expect(installed).toContain('[mcp_servers.keep]');

    await writeFile(codexConfig, `${installed}\npost_install = true\n`, "utf8");
    await service.uninstallPlatforms(["codex"]);

    const uninstalled = await readFile(codexConfig, "utf8");
    expect(uninstalled.match(/^\[mcp_servers\.forma\]$/gm)).toHaveLength(1);
    expect(uninstalled).toContain('command = "user-forma"');
    expect(uninstalled).toContain('[mcp_servers.keep]');
    expect(uninstalled).toContain("post_install = true");
    expect(uninstalled).not.toContain('command = "forma"');
  });

  it("handles unmarked Codex Forma table headers with inline comments", async () => {
    const { userHome, service } = await createService();
    const codexConfig = join(userHome, ".codex", "config.toml");
    await mkdir(join(userHome, ".codex"), { recursive: true });
    await writeFile(
      codexConfig,
      [
        'theme = "dark"',
        "",
        "  [mcp_servers.forma] # user-owned forma",
        'command = "user-forma"',
        'args = ["mcp"]',
        "",
        "[mcp_servers.keep]",
        'command = "keep"',
        ""
      ].join("\r\n"),
      "utf8"
    );

    await service.installPlatforms(["codex"]);

    const installed = await readFile(codexConfig, "utf8");
    expect(installed.match(/^\s*\[mcp_servers\.forma\](?:\s+#.*)?$/gm)).toHaveLength(1);
    expect(installed).toContain('command = "forma"');
    expect(installed).toContain("[mcp_servers.keep]");

    await service.uninstallPlatforms(["codex"]);

    const uninstalled = await readFile(codexConfig, "utf8");
    expect(uninstalled.match(/^\s*\[mcp_servers\.forma\](?:\s+#.*)?$/gm)).toHaveLength(1);
    expect(uninstalled).toContain('command = "user-forma"');
    expect(uninstalled).toContain("[mcp_servers.keep]");
    expect(uninstalled).not.toContain('command = "forma"');
  });

  it("preserves Codex TOML after unmarked Forma table with array and indented table headers", async () => {
    const { userHome, service } = await createService();
    const codexConfig = join(userHome, ".codex", "config.toml");
    const originalConfig = [
      'theme = "dark"',
      "",
      "  [mcp_servers.forma]",
      'command = "user-forma"',
      'args = ["mcp"]',
      "",
      "[[profiles]]",
      'name = "default"',
      "",
      "  [mcp_servers.keep]",
      'command = "keep"',
      ""
    ].join("\r\n");
    await mkdir(join(userHome, ".codex"), { recursive: true });
    await writeFile(codexConfig, originalConfig, "utf8");

    await service.installPlatforms(["codex"]);

    const installed = await readFile(codexConfig, "utf8");
    expect(installed.match(/^\s*\[mcp_servers\.forma\]\s*$/gm)).toHaveLength(1);
    expect(installed).toContain('command = "forma"');
    expect(installed).toContain("[[profiles]]");
    expect(installed).toContain('name = "default"');
    expect(installed).toContain("[mcp_servers.keep]");

    await writeFile(codexConfig, `${installed}\r\n[[post_install]]\r\nname = "later"\r\n`, "utf8");
    await service.uninstallPlatforms(["codex"]);

    const uninstalled = await readFile(codexConfig, "utf8");
    expect(uninstalled.match(/^\s*\[mcp_servers\.forma\]\s*$/gm)).toHaveLength(1);
    expect(uninstalled).toContain('command = "user-forma"');
    expect(uninstalled).toContain("[[profiles]]");
    expect(uninstalled).toContain('name = "default"');
    expect(uninstalled).toContain("[mcp_servers.keep]");
    expect(uninstalled).toContain("[[post_install]]");
    expect(uninstalled).not.toContain('command = "forma"');
  });
});
