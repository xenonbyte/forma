import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { InstallService, formaInstallCommands, readYaml, writeYamlAtomic } from "../src/index.js";

const commands = [
  "fm-list-product",
  "fm-status",
  "fm-requirement",
  "fm-rollback-design",
  "fm-design",
  "fm-refine-components",
  "fm-change-style",
  "fm-develop-design-handoff",
] as const;

const removedRequirementCommands = ["fm-upload-requirement", "fm-update-requirement"] as const;
const removedLegacyCommands = ["fm-refine-design"] as const;

type Platform = "claude" | "codex" | "gemini";

const fallbackMcpCommandRunner = {
  run: async () => {
    throw new Error("official MCP CLI unavailable in install tests");
  },
};

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

async function createService(options: ConstructorParameters<typeof InstallService>[0] = {}) {
  const root = await mkdtemp(join(tmpdir(), "forma-install-"));
  const formaHome = join(root, ".forma");
  const userHome = join(root, "user");
  const service = new InstallService({
    formaHome,
    userHome,
    templatesDir: resolve("packages/agent/templates"),
    mcpCommandRunner: fallbackMcpCommandRunner,
    ...options,
  });
  return { formaHome, userHome, service };
}

function formaStdioMcpConfig(command = "forma", args = ["mcp"]) {
  return { type: "stdio", command, args, env: {} };
}

function userHomeEnv(userHome: string) {
  return { HOME: userHome, USERPROFILE: userHome };
}

async function readManifest(formaHome: string, platform: Platform): Promise<InstallManifest> {
  return readYaml<InstallManifest>(join(formaHome, "manifests", `${platform}.manifest`));
}

function commandTarget(userHome: string, platform: Platform, command: string): string {
  if (platform === "claude") {
    return join(userHome, ".claude", "commands", `${command}.md`);
  }
  if (platform === "gemini") {
    return join(userHome, ".gemini", "commands", `${command}.toml`);
  }
  return join(userHome, ".codex", "skills", command, "SKILL.md");
}

function customCommandTarget(userHome: string, platform: Platform): string {
  if (platform === "claude") {
    return join(userHome, ".claude", "commands", "custom.md");
  }
  if (platform === "gemini") {
    return join(userHome, ".gemini", "commands", "custom.toml");
  }
  return join(userHome, ".codex", "skills", "custom", "SKILL.md");
}

function oldCodexCommandTarget(userHome: string, command: string): string {
  return join(userHome, ".codex", "prompts", "skills", command, "SKILL.md");
}

async function writeOldManifest(
  formaHome: string,
  platform: Platform,
  installedPaths: string[],
  backups: Array<{ target: string; backup: string }>,
): Promise<void> {
  await writeYamlAtomic(join(formaHome, "manifests", `${platform}.manifest`), {
    schema_version: 1,
    platform,
    installed_paths: installedPaths,
    backups,
    config_paths: [],
    installed_at: "2026-01-01T00:00:00.000Z",
  });
}

describe("InstallService", () => {
  it("uses the v6 public command list without removed legacy design routes", () => {
    expect(formaInstallCommands).toEqual(commands);
    expect(formaInstallCommands).not.toEqual(expect.arrayContaining(removedRequirementCommands));
    expect(formaInstallCommands).not.toEqual(expect.arrayContaining(removedLegacyCommands));
  });

  it("installs all platform command templates and shared skill", async () => {
    const { formaHome, userHome, service } = await createService();

    await service.installPlatforms(["claude", "codex", "gemini"]);

    for (const command of commands) {
      await expect(readFile(join(userHome, ".claude", "commands", `${command}.md`), "utf8")).resolves.toContain(
        `# Forma route: ${command}`,
      );
      await expect(readFile(join(userHome, ".gemini", "commands", `${command}.toml`), "utf8")).resolves.toContain(
        `# Forma route: ${command}`,
      );
      await expect(readFile(join(userHome, ".codex", "skills", command, "SKILL.md"), "utf8")).resolves.toContain(
        `# Forma route: ${command}`,
      );
    }
    for (const command of removedRequirementCommands) {
      await expect(exists(join(userHome, ".claude", "commands", `${command}.md`))).resolves.toBe(false);
      await expect(exists(join(userHome, ".gemini", "commands", `${command}.toml`))).resolves.toBe(false);
      await expect(exists(join(userHome, ".codex", "skills", command, "SKILL.md"))).resolves.toBe(false);
    }
    for (const command of removedLegacyCommands) {
      await expect(exists(join(userHome, ".claude", "commands", `${command}.md`))).resolves.toBe(false);
      await expect(exists(join(userHome, ".gemini", "commands", `${command}.toml`))).resolves.toBe(false);
      await expect(exists(join(userHome, ".codex", "skills", command, "SKILL.md"))).resolves.toBe(false);
    }
    await expect(readFile(join(formaHome, "skills", "forma", "SKILL.md"), "utf8")).resolves.toContain(
      "Forma shared guidance",
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
        ...commands.map((command) => join(userHome, ".claude", "commands", `${command}.md`)),
      ]),
    );
    for (const command of removedRequirementCommands) {
      expect(claude.installed_paths).not.toContain(join(userHome, ".claude", "commands", `${command}.md`));
    }
    for (const command of removedLegacyCommands) {
      expect(claude.installed_paths).not.toContain(join(userHome, ".claude", "commands", `${command}.md`));
    }
    expect(claude.config_paths).toEqual([join(userHome, ".claude.json")]);

    const gemini = await readManifest(formaHome, "gemini");
    expect(gemini.platform).toBe("gemini");
    expect(gemini.installed_paths).toEqual(
      expect.arrayContaining([
        join(formaHome, "skills", "forma", "SKILL.md"),
        ...commands.map((command) => join(userHome, ".gemini", "commands", `${command}.toml`)),
      ]),
    );
    for (const command of removedRequirementCommands) {
      expect(gemini.installed_paths).not.toContain(join(userHome, ".gemini", "commands", `${command}.toml`));
    }
    for (const command of removedLegacyCommands) {
      expect(gemini.installed_paths).not.toContain(join(userHome, ".gemini", "commands", `${command}.toml`));
    }
    expect(gemini.config_paths).toEqual([join(userHome, ".gemini", "settings.json")]);

    const codex = await readManifest(formaHome, "codex");
    expect(codex.platform).toBe("codex");
    expect(codex.installed_paths).toEqual(
      expect.arrayContaining([
        join(formaHome, "skills", "forma", "SKILL.md"),
        ...commands.map((command) => join(userHome, ".codex", "skills", command, "SKILL.md")),
      ]),
    );
    for (const command of removedRequirementCommands) {
      expect(codex.installed_paths).not.toContain(join(userHome, ".codex", "skills", command, "SKILL.md"));
    }
    for (const command of removedLegacyCommands) {
      expect(codex.installed_paths).not.toContain(join(userHome, ".codex", "skills", command, "SKILL.md"));
    }
    expect(codex.config_paths).toEqual([join(userHome, ".codex", "config.toml")]);
  });

  it("uses official MCP CLI commands before managed config file fallbacks", async () => {
    const calls: Array<{
      command: string;
      args: string[];
      options?: { env?: Record<string, string | undefined> };
    }> = [];
    const { formaHome, userHome, service } = await createService({
      mcpCommandRunner: {
        run: async (command, args, options) => {
          calls.push({ command, args, options });
        },
      },
    });

    await service.installPlatforms(["claude", "codex", "gemini"]);

    expect((await readManifest(formaHome, "claude")).config_paths).toEqual([join(userHome, ".claude.json")]);
    expect((await readManifest(formaHome, "codex")).config_paths).toEqual([join(userHome, ".codex", "config.toml")]);
    expect((await readManifest(formaHome, "gemini")).config_paths).toEqual([
      join(userHome, ".gemini", "settings.json"),
    ]);

    await service.uninstallPlatforms(["claude", "codex", "gemini"]);

    expect(calls).toEqual([
      {
        command: "claude",
        args: ["mcp", "add-json", "--scope", "user", "forma", JSON.stringify(formaStdioMcpConfig())],
        options: { env: userHomeEnv(userHome) },
      },
      {
        command: "codex",
        args: ["mcp", "add", "forma", "--", "forma", "mcp"],
        options: { env: userHomeEnv(userHome) },
      },
      {
        command: "gemini",
        args: ["mcp", "add", "--scope", "user", "--transport", "stdio", "forma", "forma", "mcp"],
        options: { env: userHomeEnv(userHome) },
      },
      {
        command: "claude",
        args: ["mcp", "remove", "--scope", "user", "forma"],
        options: { env: userHomeEnv(userHome) },
      },
      {
        command: "codex",
        args: ["mcp", "remove", "forma"],
        options: { env: userHomeEnv(userHome) },
      },
      {
        command: "gemini",
        args: ["mcp", "remove", "--scope", "user", "forma"],
        options: { env: userHomeEnv(userHome) },
      },
    ]);
    await expect(exists(join(userHome, ".claude.json"))).resolves.toBe(false);
    await expect(exists(join(userHome, ".codex", "config.toml"))).resolves.toBe(false);
    await expect(exists(join(userHome, ".gemini", "settings.json"))).resolves.toBe(false);
  });

  it("removes empty config artifacts left by official MCP CLI removal", async () => {
    let userHome = "";
    const { service, userHome: createdUserHome } = await createService({
      mcpCommandRunner: {
        run: async (command, args) => {
          if (args[0] !== "mcp" || args[1] !== "remove") {
            return;
          }

          if (command === "claude") {
            const configPath = join(userHome, ".claude.json");
            await mkdir(dirname(configPath), { recursive: true });
            await writeFile(configPath, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`, "utf8");
            return;
          }

          if (command === "gemini") {
            const configPath = join(userHome, ".gemini", "settings.json");
            await mkdir(dirname(configPath), { recursive: true });
            await writeFile(configPath, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`, "utf8");
            return;
          }

          const configPath = join(userHome, ".codex", "config.toml");
          await mkdir(dirname(configPath), { recursive: true });
          await writeFile(configPath, "\n", "utf8");
        },
      },
    });
    userHome = createdUserHome;

    await service.installPlatforms(["claude", "codex", "gemini"]);
    await service.uninstallPlatforms(["claude", "codex", "gemini"]);

    await expect(exists(join(userHome, ".claude.json"))).resolves.toBe(false);
    await expect(exists(join(userHome, ".codex", "config.toml"))).resolves.toBe(false);
    await expect(exists(join(userHome, ".gemini", "settings.json"))).resolves.toBe(false);
  });

  it("removes stale command files from old manifests during install upgrade", async () => {
    for (const platform of ["claude", "codex", "gemini"] satisfies Platform[]) {
      const { formaHome, userHome, service } = await createService();
      const oldCommands = [...removedRequirementCommands, ...removedLegacyCommands];
      const oldCommandPaths = oldCommands.map((command) => commandTarget(userHome, platform, command));
      const unrelatedCommand = customCommandTarget(userHome, platform);

      for (const [index, commandPath] of oldCommandPaths.entries()) {
        await mkdir(dirname(commandPath), { recursive: true });
        await writeFile(commandPath, `# Forma route: ${oldCommands[index]}\n`, "utf8");
      }
      await mkdir(dirname(unrelatedCommand), { recursive: true });
      await writeFile(unrelatedCommand, "# Custom\n", "utf8");
      await writeOldManifest(
        formaHome,
        platform,
        [join(formaHome, "skills", "forma", "SKILL.md"), ...oldCommandPaths],
        [],
      );

      await service.installPlatforms([platform]);

      for (const oldPath of oldCommandPaths) {
        await expect(exists(oldPath)).resolves.toBe(false);
      }
      await expect(readFile(commandTarget(userHome, platform, "fm-requirement"), "utf8")).resolves.toContain(
        "# Forma route: fm-requirement",
      );
      await expect(readFile(unrelatedCommand, "utf8")).resolves.toBe("# Custom\n");

      const upgradedManifest = await readManifest(formaHome, platform);
      const serializedManifest = JSON.stringify(upgradedManifest);
      for (const oldPath of oldCommandPaths) {
        expect(upgradedManifest.installed_paths).not.toContain(oldPath);
        expect(serializedManifest).not.toContain(oldPath);
      }

      await service.uninstallPlatforms([platform]);

      for (const oldPath of oldCommandPaths) {
        await expect(exists(oldPath)).resolves.toBe(false);
      }
      await expect(exists(commandTarget(userHome, platform, "fm-requirement"))).resolves.toBe(false);
      await expect(readFile(unrelatedCommand, "utf8")).resolves.toBe("# Custom\n");
    }
  });

  it("preserves non-managed user fm-refine-design files during install", async () => {
    for (const platform of ["claude", "codex", "gemini"] satisfies Platform[]) {
      const { userHome, service } = await createService();
      const userCommand = commandTarget(userHome, platform, "fm-refine-design");
      await mkdir(dirname(userCommand), { recursive: true });
      await writeFile(userCommand, "# User-owned refine shortcut\n", "utf8");

      await service.installPlatforms([platform]);

      await expect(readFile(userCommand, "utf8")).resolves.toBe("# User-owned refine shortcut\n");
    }
  });

  it("restores user backups when stale manifest paths are cleaned during install upgrade", async () => {
    const { formaHome, userHome, service } = await createService();
    const oldCommand = commandTarget(userHome, "claude", "fm-upload-requirement");
    const backup = join(formaHome, "backups", "claude", ".claude", "commands", "fm-upload-requirement.md");
    await mkdir(dirname(oldCommand), { recursive: true });
    await mkdir(join(formaHome, "backups", "claude", ".claude", "commands"), { recursive: true });
    await writeFile(oldCommand, "# Forma route: fm-upload-requirement\n", "utf8");
    await writeFile(backup, "# User upload shortcut\n", "utf8");
    await writeOldManifest(formaHome, "claude", [oldCommand], [{ target: oldCommand, backup }]);

    await service.installPlatforms(["claude"]);

    await expect(readFile(oldCommand, "utf8")).resolves.toBe("# User upload shortcut\n");
    const upgradedManifest = await readManifest(formaHome, "claude");
    expect(JSON.stringify(upgradedManifest)).not.toContain(oldCommand);

    await service.uninstallPlatforms(["claude"]);

    await expect(readFile(oldCommand, "utf8")).resolves.toBe("# User upload shortcut\n");
  });

  it("migrates Codex skills from the old prompts directory to the active skills directory", async () => {
    const { formaHome, userHome, service } = await createService();
    const oldCommand = oldCodexCommandTarget(userHome, "fm-requirement");
    await mkdir(dirname(oldCommand), { recursive: true });
    await writeFile(oldCommand, "# Forma route: fm-requirement\n", "utf8");
    await writeOldManifest(formaHome, "codex", [oldCommand], []);

    await service.installPlatforms(["codex"]);

    await expect(exists(oldCommand)).resolves.toBe(false);
    await expect(readFile(commandTarget(userHome, "codex", "fm-requirement"), "utf8")).resolves.toContain(
      "# Forma route: fm-requirement",
    );

    const upgradedManifest = await readManifest(formaHome, "codex");
    expect(upgradedManifest.installed_paths).toContain(commandTarget(userHome, "codex", "fm-requirement"));
    expect(JSON.stringify(upgradedManifest)).not.toContain(oldCommand);
  });

  it("uninstalls legacy Codex skills recorded in old manifests", async () => {
    const { formaHome, userHome, service } = await createService();
    const oldCommand = oldCodexCommandTarget(userHome, "fm-design");
    await mkdir(dirname(oldCommand), { recursive: true });
    await writeFile(oldCommand, "# Forma route: fm-design\n", "utf8");
    await writeOldManifest(formaHome, "codex", [oldCommand], []);

    await service.uninstallPlatforms(["codex"]);

    await expect(exists(oldCommand)).resolves.toBe(false);
    await expect(exists(dirname(oldCommand))).resolves.toBe(false);
    await expect(exists(join(formaHome, "manifests", "codex.manifest"))).resolves.toBe(false);
  });

  it("uninstalls only manifest-owned files and preserves unrelated files and config entries", async () => {
    const { formaHome, userHome, service } = await createService();
    const unrelatedClaudeCommand = join(userHome, ".claude", "commands", "custom.md");
    const unrelatedGeminiCommand = join(userHome, ".gemini", "commands", "custom.toml");
    const unrelatedCodexSkill = join(userHome, ".codex", "skills", "custom", "SKILL.md");
    await mkdir(join(userHome, ".claude", "commands"), { recursive: true });
    await mkdir(join(userHome, ".gemini", "commands"), { recursive: true });
    await mkdir(join(userHome, ".codex", "skills", "custom"), { recursive: true });
    await writeFile(unrelatedClaudeCommand, "# Custom\n", "utf8");
    await writeFile(unrelatedGeminiCommand, 'description = "Custom"\n', "utf8");
    await writeFile(unrelatedCodexSkill, "# Custom\n", "utf8");
    await mkdir(join(userHome, ".claude"), { recursive: true });
    await mkdir(join(userHome, ".gemini"), { recursive: true });
    await mkdir(join(userHome, ".codex"), { recursive: true });
    await writeFile(
      join(userHome, ".claude.json"),
      JSON.stringify({ mcpServers: { existing: { command: "existing" } } }, null, 2),
      "utf8",
    );
    await writeFile(
      join(userHome, ".gemini", "settings.json"),
      JSON.stringify({ mcpServers: { existing: { command: "existing" } } }, null, 2),
      "utf8",
    );
    await writeFile(join(userHome, ".codex", "config.toml"), '[mcp_servers.existing]\ncommand = "existing"\n', "utf8");

    await service.installPlatforms(["claude", "codex", "gemini"]);
    await service.uninstallPlatforms(["claude", "codex", "gemini"]);

    for (const command of commands) {
      await expect(exists(join(userHome, ".claude", "commands", `${command}.md`))).resolves.toBe(false);
      await expect(exists(join(userHome, ".gemini", "commands", `${command}.toml`))).resolves.toBe(false);
      await expect(exists(join(userHome, ".codex", "skills", command, "SKILL.md"))).resolves.toBe(false);
      await expect(exists(join(userHome, ".codex", "skills", command))).resolves.toBe(false);
    }
    await expect(readFile(unrelatedClaudeCommand, "utf8")).resolves.toBe("# Custom\n");
    await expect(readFile(unrelatedGeminiCommand, "utf8")).resolves.toBe('description = "Custom"\n');
    await expect(readFile(unrelatedCodexSkill, "utf8")).resolves.toBe("# Custom\n");
    await expect(readFile(join(userHome, ".claude.json"), "utf8")).resolves.toContain("existing");
    await expect(readFile(join(userHome, ".claude.json"), "utf8")).resolves.not.toContain("forma");
    await expect(readFile(join(userHome, ".gemini", "settings.json"), "utf8")).resolves.toContain("existing");
    await expect(readFile(join(userHome, ".gemini", "settings.json"), "utf8")).resolves.not.toContain("forma");
    await expect(readFile(join(userHome, ".codex", "config.toml"), "utf8")).resolves.toContain("existing");
    await expect(readFile(join(userHome, ".codex", "config.toml"), "utf8")).resolves.not.toContain("Forma route");
  });

  it("backs up pre-existing target files before replacement and restores them on uninstall", async () => {
    const { formaHome, userHome, service } = await createService();
    const claudeCommand = join(userHome, ".claude", "commands", "fm-requirement.md");
    const codexConfig = join(userHome, ".codex", "config.toml");
    const sharedSkill = join(formaHome, "skills", "forma", "SKILL.md");
    await mkdir(join(userHome, ".claude", "commands"), { recursive: true });
    await mkdir(join(userHome, ".codex"), { recursive: true });
    await mkdir(join(formaHome, "skills", "forma"), { recursive: true });
    await writeFile(claudeCommand, "# Local Claude Command\n", "utf8");
    await writeFile(codexConfig, '[mcp_servers.existing]\ncommand = "existing"\n', "utf8");
    await writeFile(sharedSkill, "# Local Shared Skill\n", "utf8");

    await service.installPlatforms(["claude", "codex", "gemini"]);

    const claudeManifest = await readManifest(formaHome, "claude");
    expect(claudeManifest.backups).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: claudeCommand })]),
    );
    expect(claudeManifest.backups).toEqual(expect.arrayContaining([expect.objectContaining({ target: sharedSkill })]));
    const codexManifest = await readManifest(formaHome, "codex");
    expect(codexManifest.backups).toEqual(expect.arrayContaining([expect.objectContaining({ target: codexConfig })]));
    await expect(readFile(claudeCommand, "utf8")).resolves.toContain("# Forma route: fm-requirement");

    await service.uninstallPlatforms(["claude", "codex", "gemini"]);

    await expect(readFile(claudeCommand, "utf8")).resolves.toBe("# Local Claude Command\n");
    await expect(readFile(codexConfig, "utf8")).resolves.toBe('[mcp_servers.existing]\ncommand = "existing"\n');
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
    const claudeCommand = join(userHome, ".claude", "commands", "fm-requirement.md");
    const claudeConfig = join(userHome, ".claude.json");
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
        expect.objectContaining({ target: sharedSkill }),
      ]),
    );

    await service.uninstallPlatforms(["claude"]);

    await expect(readFile(claudeCommand, "utf8")).resolves.toBe("# Local Claude Command\n");
    await expect(readFile(claudeConfig, "utf8")).resolves.toBe(originalClaudeConfig);
    await expect(readFile(sharedSkill, "utf8")).resolves.toBe("# Local Shared Skill\n");
  });

  it("does not reuse stale backup files across completed install cycles", async () => {
    const { userHome, service } = await createService();
    const claudeCommand = join(userHome, ".claude", "commands", "fm-requirement.md");
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
    await expect(exists(join(userHome, ".claude.json"))).resolves.toBe(false);
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
    const claudeCommand = join(userHome, ".claude", "commands", "fm-requirement.md");
    const template = await readFile(resolve("packages/agent/templates/claude/fm-requirement.md"), "utf8");
    await mkdir(join(userHome, ".claude", "commands"), { recursive: true });
    await writeFile(claudeCommand, template, "utf8");

    await service.installPlatforms(["claude"]);
    await service.uninstallPlatforms(["claude"]);

    await expect(readFile(claudeCommand, "utf8")).resolves.toBe(template);
  });

  it("overwrites orphan backup files before recording a new install lifecycle", async () => {
    const { formaHome, userHome, service } = await createService();
    const claudeCommand = join(userHome, ".claude", "commands", "fm-requirement.md");
    const staleBackup = join(formaHome, "backups", "claude", ".claude", "commands", "fm-requirement.md");
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
    await writeFile(join(userHome, ".claude.json"), JSON.stringify({ keep: true }, null, 2), "utf8");
    await writeFile(join(userHome, ".gemini", "settings.json"), JSON.stringify({ keep: true }, null, 2), "utf8");
    await writeFile(join(userHome, ".codex", "config.toml"), 'theme = "dark"\n', "utf8");

    await service.installPlatforms(["claude", "codex", "gemini"]);

    await expect(readFile(join(userHome, ".claude.json"), "utf8")).resolves.toContain('"forma"');
    await expect(readFile(join(userHome, ".gemini", "settings.json"), "utf8")).resolves.toContain('"forma"');
    await expect(readFile(join(userHome, ".codex", "config.toml"), "utf8")).resolves.toContain(
      "# BEGIN Forma managed mcp server",
    );

    await service.uninstallPlatforms(["claude", "codex", "gemini"]);

    await expect(readFile(join(userHome, ".claude.json"), "utf8")).resolves.toContain('"keep": true');
    await expect(readFile(join(userHome, ".claude.json"), "utf8")).resolves.not.toContain('"forma"');
    await expect(readFile(join(userHome, ".gemini", "settings.json"), "utf8")).resolves.toContain('"keep": true');
    await expect(readFile(join(userHome, ".gemini", "settings.json"), "utf8")).resolves.not.toContain('"forma"');
    await expect(readFile(join(userHome, ".codex", "config.toml"), "utf8")).resolves.toBe('theme = "dark"\n');
  });

  it("writes Claude MCP config to the Claude Code user config", async () => {
    const { userHome, service } = await createService();
    const claudeCodeConfig = join(userHome, ".claude.json");
    await mkdir(userHome, { recursive: true });
    await writeFile(claudeCodeConfig, JSON.stringify({ keep: true }, null, 2), "utf8");

    await service.installPlatforms(["claude"]);

    expect(JSON.parse(await readFile(claudeCodeConfig, "utf8"))).toEqual({
      keep: true,
      mcpServers: {
        forma: formaStdioMcpConfig(),
      },
    });
    await expect(exists(join(userHome, ".claude", "mcp.json"))).resolves.toBe(false);
  });

  it("migrates legacy Claude MCP installs to the Claude Code user config", async () => {
    const { formaHome, userHome, service } = await createService();
    const legacyConfig = join(userHome, ".claude", "mcp.json");
    const claudeCodeConfig = join(userHome, ".claude.json");
    await mkdir(dirname(legacyConfig), { recursive: true });
    await writeFile(
      legacyConfig,
      `${JSON.stringify({ mcpServers: { forma: formaStdioMcpConfig() } }, null, 2)}\n`,
      "utf8",
    );
    await writeYamlAtomic(join(formaHome, "manifests", "claude.manifest"), {
      schema_version: 1,
      platform: "claude",
      installed_paths: [],
      backups: [],
      config_paths: [legacyConfig],
      installed_at: "2026-01-01T00:00:00.000Z",
    });

    await service.installPlatforms(["claude"]);

    expect(JSON.parse(await readFile(claudeCodeConfig, "utf8"))).toEqual({
      mcpServers: {
        forma: formaStdioMcpConfig(),
      },
    });
    await expect(exists(legacyConfig)).resolves.toBe(false);
    expect((await readManifest(formaHome, "claude")).config_paths).toEqual([claudeCodeConfig]);
  });

  it("writes Claude and Gemini MCP config under mcpServers.forma without a top-level Claude forma entry", async () => {
    const { userHome, service } = await createService();
    await mkdir(join(userHome, ".claude"), { recursive: true });
    await mkdir(join(userHome, ".gemini"), { recursive: true });
    await writeFile(
      join(userHome, ".claude.json"),
      JSON.stringify({ keep: true, forma: { command: "legacy-forma" } }, null, 2),
      "utf8",
    );
    await writeFile(join(userHome, ".gemini", "settings.json"), JSON.stringify({ keep: true }, null, 2), "utf8");

    await service.installPlatforms(["claude", "gemini"]);

    expect(JSON.parse(await readFile(join(userHome, ".claude.json"), "utf8"))).toEqual({
      keep: true,
      mcpServers: {
        forma: formaStdioMcpConfig(),
      },
    });
    expect(JSON.parse(await readFile(join(userHome, ".gemini", "settings.json"), "utf8"))).toEqual({
      keep: true,
      mcpServers: {
        forma: formaStdioMcpConfig(),
      },
    });
  });

  it("cleans historical top-level Claude forma entries during reinstall and uninstall", async () => {
    const { userHome, service } = await createService();
    const claudeConfig = join(userHome, ".claude.json");
    await mkdir(join(userHome, ".claude"), { recursive: true });
    await writeFile(claudeConfig, JSON.stringify({ keep: true, forma: { command: "legacy-forma" } }, null, 2), "utf8");

    await service.installPlatforms(["claude"]);
    await writeFile(
      claudeConfig,
      JSON.stringify(
        {
          ...(JSON.parse(await readFile(claudeConfig, "utf8")) as Record<string, unknown>),
          forma: { command: "legacy-forma" },
        },
        null,
        2,
      ),
      "utf8",
    );
    await service.installPlatforms(["claude"]);

    expect(JSON.parse(await readFile(claudeConfig, "utf8"))).toEqual({
      keep: true,
      mcpServers: {
        forma: formaStdioMcpConfig(),
      },
    });

    await service.uninstallPlatforms(["claude"]);

    expect(JSON.parse(await readFile(claudeConfig, "utf8"))).toEqual({ keep: true });
  });

  it("sanitizes top-level Claude forma while restoring backup mcpServers.forma", async () => {
    const { userHome, service } = await createService();
    const claudeConfig = join(userHome, ".claude.json");
    const originalClaudeConfig = `${JSON.stringify(
      {
        keep: true,
        forma: { command: "legacy-forma" },
        mcpServers: { forma: { command: "user-forma" } },
      },
      null,
      2,
    )}\n`;
    await mkdir(join(userHome, ".claude"), { recursive: true });
    await writeFile(claudeConfig, originalClaudeConfig, "utf8");

    await service.installPlatforms(["claude"]);
    await writeFile(
      claudeConfig,
      JSON.stringify(
        {
          ...(JSON.parse(await readFile(claudeConfig, "utf8")) as Record<string, unknown>),
          forma: { command: "legacy-forma" },
          postInstall: true,
        },
        null,
        2,
      ),
      "utf8",
    );

    await service.uninstallPlatforms(["claude"]);

    expect(JSON.parse(await readFile(claudeConfig, "utf8"))).toEqual({
      keep: true,
      mcpServers: { forma: { command: "user-forma" } },
      postInstall: true,
    });
  });

  it("writes Codex MCP command and args from injected install options with JSON escaping", async () => {
    const { userHome, service } = await createService({
      mcpCommand: {
        command: '/tmp/Forma "dev"/node',
        args: ['/tmp/path with spaces/forma "cli".js', "mcp"],
      },
    });

    await service.installPlatforms(["codex"]);

    const codexConfig = await readFile(join(userHome, ".codex", "config.toml"), "utf8");
    expect(codexConfig).toContain(`command = ${JSON.stringify('/tmp/Forma "dev"/node')}`);
    expect(codexConfig).toContain(`args = ${JSON.stringify(['/tmp/path with spaces/forma "cli".js', "mcp"])}`);
  });

  it("restores pre-existing user-owned Forma MCP config entries after reinstall and uninstall", async () => {
    const { userHome, service } = await createService();
    const claudeConfig = join(userHome, ".claude.json");
    const geminiConfig = join(userHome, ".gemini", "settings.json");
    const codexConfig = join(userHome, ".codex", "config.toml");
    const originalClaudeConfig = `${JSON.stringify(
      { mcpServers: { forma: { command: "user-forma" } }, keep: true },
      null,
      2,
    )}\n`;
    const originalGeminiConfig = `${JSON.stringify(
      { mcpServers: { forma: { command: "user-forma" } }, keep: true },
      null,
      2,
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
    const claudeConfig = join(userHome, ".claude.json");
    const geminiConfig = join(userHome, ".gemini", "settings.json");
    const codexConfig = join(userHome, ".codex", "config.toml");
    await mkdir(join(userHome, ".claude"), { recursive: true });
    await mkdir(join(userHome, ".gemini"), { recursive: true });
    await mkdir(join(userHome, ".codex"), { recursive: true });
    await writeFile(
      claudeConfig,
      `${JSON.stringify({ mcpServers: { forma: { command: "user-forma" } }, keep: true }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      geminiConfig,
      `${JSON.stringify(
        {
          mcpServers: {
            forma: { command: "user-forma" },
            existing: { command: "existing" },
          },
          keep: true,
        },
        null,
        2,
      )}\n`,
      "utf8",
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
      "utf8",
    );

    await service.installPlatforms(["claude", "codex", "gemini"]);
    await service.installPlatforms(["claude", "codex", "gemini"]);

    await writeFile(
      claudeConfig,
      `${JSON.stringify(
        {
          ...(JSON.parse(await readFile(claudeConfig, "utf8")) as Record<string, unknown>),
          postInstall: true,
        },
        null,
        2,
      )}\n`,
      "utf8",
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
            postInstallServer: { command: "post-install" },
          },
          postInstall: true,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      codexConfig,
      `${await readFile(codexConfig, "utf8")}
post_install = true
`,
      "utf8",
    );

    await service.uninstallPlatforms(["claude", "codex", "gemini"]);

    expect(JSON.parse(await readFile(claudeConfig, "utf8"))).toEqual({
      mcpServers: {
        forma: { command: "user-forma" },
      },
      keep: true,
      postInstall: true,
    });
    expect(JSON.parse(await readFile(geminiConfig, "utf8"))).toEqual({
      mcpServers: {
        forma: { command: "user-forma" },
        existing: { command: "existing" },
        postInstallServer: { command: "post-install" },
      },
      keep: true,
      postInstall: true,
    });
    const codex = await readFile(codexConfig, "utf8");
    expect(codex).toContain('theme = "dark"');
    expect(codex).toContain("post_install = true");
    expect(codex).toContain('command = "user-forma"');
    expect(codex).not.toContain('command = "forma"');
  });

  it("restores config backups when current config files are missing at uninstall", async () => {
    const { userHome, service } = await createService();
    const claudeConfig = join(userHome, ".claude.json");
    const geminiConfig = join(userHome, ".gemini", "settings.json");
    const codexConfig = join(userHome, ".codex", "config.toml");
    const originalClaudeConfig = `${JSON.stringify(
      { forma: { command: "legacy-forma" }, mcpServers: { forma: { command: "user-forma" } }, keep: true },
      null,
      2,
    )}\n`;
    const sanitizedClaudeConfig = `${JSON.stringify(
      { mcpServers: { forma: { command: "user-forma" } }, keep: true },
      null,
      2,
    )}\n`;
    const originalGeminiConfig = `${JSON.stringify(
      { mcpServers: { forma: { command: "user-forma" } }, keep: true },
      null,
      2,
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

    await expect(readFile(claudeConfig, "utf8")).resolves.toBe(sanitizedClaudeConfig);
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
      "utf8",
    );

    await service.installPlatforms(["codex"]);

    const installed = await readFile(codexConfig, "utf8");
    expect(installed.match(/^\[mcp_servers\.forma\]$/gm)).toHaveLength(1);
    expect(installed).toContain('command = "forma"');
    expect(installed).toContain("[mcp_servers.keep]");

    await writeFile(codexConfig, `${installed}\npost_install = true\n`, "utf8");
    await service.uninstallPlatforms(["codex"]);

    const uninstalled = await readFile(codexConfig, "utf8");
    expect(uninstalled.match(/^\[mcp_servers\.forma\]$/gm)).toHaveLength(1);
    expect(uninstalled).toContain('command = "user-forma"');
    expect(uninstalled).toContain("[mcp_servers.keep]");
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
        "",
      ].join("\r\n"),
      "utf8",
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
      "",
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
