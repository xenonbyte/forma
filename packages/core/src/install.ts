import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml, writeYamlAtomic } from "./yaml.js";

export type AgentInstallPlatform = "claude" | "codex" | "gemini";

export const formaInstallCommands = [
  "fm-list-product",
  "fm-status",
  "fm-requirement",
  "fm-rollback-design",
  "fm-design",
  "fm-refine-components",
  "fm-change-style",
  "fm-develop-design-handoff"
] as const;

export type FormaInstallCommand = (typeof formaInstallCommands)[number];

export interface FormaMcpCommand {
  command: string;
  args: string[];
}

export interface FormaMcpCommandRunOptions {
  env?: Record<string, string | undefined>;
}

export interface FormaMcpCommandRunner {
  run(command: string, args: string[], options?: FormaMcpCommandRunOptions): Promise<void>;
}

export interface InstallServiceOptions {
  formaHome?: string;
  userHome?: string;
  templatesDir?: string;
  mcpCommand?: FormaMcpCommand;
  mcpCommandRunner?: FormaMcpCommandRunner;
}

export interface InstallBackupRecord {
  target: string;
  backup: string;
}

export interface InstallManifest {
  schema_version: 1;
  platform: AgentInstallPlatform;
  installed_paths: string[];
  backups: InstallBackupRecord[];
  config_paths: string[];
  installed_at: string;
}

interface InstallRecord {
  installedPaths: string[];
  backups: InstallBackupRecord[];
  configPaths: string[];
}

const codexMcpStart = "# BEGIN Forma managed mcp server";
const codexMcpEnd = "# END Forma managed mcp server";
const defaultFormaMcpCommand: FormaMcpCommand = { command: "forma", args: ["mcp"] };

export class InstallService {
  readonly formaHome: string;
  readonly userHome: string;
  readonly templatesDir: string;
  readonly mcpCommand: FormaMcpCommand;
  readonly mcpCommandRunner: FormaMcpCommandRunner;

  constructor(options: InstallServiceOptions = {}) {
    this.userHome = resolve(options.userHome ?? homedir());
    this.formaHome = resolve(options.formaHome ?? join(this.userHome, ".forma"));
    this.templatesDir = resolve(options.templatesDir ?? defaultTemplatesDir());
    this.mcpCommand = options.mcpCommand ?? defaultFormaMcpCommand;
    this.mcpCommandRunner = options.mcpCommandRunner ?? defaultMcpCommandRunner;
  }

  async installPlatforms(platforms: AgentInstallPlatform[]): Promise<void> {
    for (const platform of platforms) {
      await this.installPlatform(platform);
    }
  }

  async uninstallPlatforms(platforms: AgentInstallPlatform[]): Promise<void> {
    const selectedManifests = new Map<AgentInstallPlatform, InstallManifest>();
    for (const platform of platforms) {
      const manifest = await readOptionalManifest(this.manifestFile(platform));
      if (manifest) {
        selectedManifests.set(platform, manifest);
      }
    }

    if (selectedManifests.size === 0) {
      return;
    }

    const backupByTarget = new Map<string, string>();
    for (const manifest of selectedManifests.values()) {
      for (const backup of manifest.backups) {
        if (!backupByTarget.has(backup.target)) {
          backupByTarget.set(backup.target, backup.backup);
        }
      }
    }

    for (const [platform, manifest] of selectedManifests) {
      await this.uninstallMcpConfig(platform, manifest.config_paths, backupByTarget);
    }

    const protectedPaths = await this.installedPathsOwnedByOtherPlatforms(Array.from(selectedManifests.keys()));
    await this.transferBackupsToRemainingOwners(Array.from(selectedManifests.keys()), protectedPaths, backupByTarget);

    const installedPaths = unique(Array.from(selectedManifests.values()).flatMap((manifest) => manifest.installed_paths));
    for (const target of installedPaths.reverse()) {
      if (protectedPaths.has(target)) {
        continue;
      }
      const backup = backupByTarget.get(target);
      if (backup && (await pathExists(backup))) {
        await mkdir(dirname(target), { recursive: true });
        await copyFile(backup, target);
      } else {
        await rm(target, { force: true });
      }
    }
    for (const dir of this.codexSkillDirsFromManifests(selectedManifests)) {
      await removeEmptyDirectory(dir);
    }

    for (const platform of selectedManifests.keys()) {
      await rm(this.manifestFile(platform), { force: true });
    }
    await this.removeUnreferencedBackups(Array.from(backupByTarget.values()));
  }

  private async installPlatform(platform: AgentInstallPlatform): Promise<void> {
    const existingManifest = await readOptionalManifest(this.manifestFile(platform));
    const record: InstallRecord = { installedPaths: [], backups: [], configPaths: [] };

    await this.installSharedSkill(platform, record);
    await this.installCommandTemplates(platform, record);
    await this.installMcpConfig(platform, record);
    await this.cleanupStaleManifestTargets(platform, existingManifest, record);
    await this.writeManifest(platform, record, existingManifest);
  }

  private async installSharedSkill(platform: AgentInstallPlatform, record: InstallRecord): Promise<void> {
    await this.writeManagedFile({
      platform,
      source: join(this.templatesDir, "shared", "SKILL.md"),
      target: join(this.formaHome, "skills", "forma", "SKILL.md"),
      record
    });
  }

  private async installCommandTemplates(platform: AgentInstallPlatform, record: InstallRecord): Promise<void> {
    for (const command of formaInstallCommands) {
      await this.writeManagedFile({
        platform,
        source: this.templatePath(platform, command),
        target: this.commandTargetPath(platform, command),
        record
      });
    }
  }

  private async installMcpConfig(platform: AgentInstallPlatform, record: InstallRecord): Promise<void> {
    const configPath = this.mcpConfigPath(platform);
    await this.backupExistingTargetIfNeeded(platform, configPath, record.backups);
    if (await this.installMcpConfigWithOfficialCli(platform)) {
      record.configPaths.push(configPath);
      return;
    }

    await this.installMcpConfigFallback(platform, configPath, record);
  }

  private async installMcpConfigFallback(
    platform: AgentInstallPlatform,
    configPath: string,
    record: InstallRecord
  ): Promise<void> {
    if (platform === "claude") {
      await this.writeJsonConfig(platform, configPath, (config) => ({
        ...withoutTopLevelForma(config),
        mcpServers: {
          ...asRecord(config.mcpServers),
          forma: stdioMcpServerConfig(this.mcpCommand)
        }
      }), record);
      return;
    }

    if (platform === "gemini") {
      await this.writeJsonConfig(platform, configPath, (config) => ({
        ...config,
        mcpServers: {
          ...asRecord(config.mcpServers),
          forma: stdioMcpServerConfig(this.mcpCommand)
        }
      }), record);
      return;
    }

    await this.writeCodexConfig(platform, configPath, record);
  }

  private async installMcpConfigWithOfficialCli(platform: AgentInstallPlatform): Promise<boolean> {
    try {
      const command = officialMcpInstallCommand(platform, this.mcpCommand);
      await this.mcpCommandRunner.run(command.command, command.args, this.mcpCommandRunOptions());
      return true;
    } catch {
      return false;
    }
  }

  private async uninstallMcpConfig(
    platform: AgentInstallPlatform,
    configPaths: string[],
    backupByTarget: Map<string, string>
  ): Promise<void> {
    const configPath = configPaths[0];
    if (!configPath) {
      return;
    }

    const backup = backupByTarget.get(configPath);
    const hasBackup = Boolean(backup && (await pathExists(backup)));
    const removedWithOfficialCli = !hasBackup && (await this.uninstallMcpConfigWithOfficialCli(platform));
    if (removedWithOfficialCli && !(await pathExists(configPath))) {
      return;
    }

    if (!(await pathExists(configPath))) {
      if (backup && hasBackup) {
        await mkdir(dirname(configPath), { recursive: true });
        if (platform === "claude") {
          await writeFile(configPath, sanitizeClaudeConfigBackup(await readFile(backup, "utf8"), configPath), "utf8");
        } else {
          await copyFile(backup, configPath);
        }
      }
      return;
    }

    if (backup && hasBackup) {
      await this.restoreConfigBackup(platform, configPath, backup);
      return;
    }

    if (platform === "claude") {
      const config = await readJsonObject(configPath);
      removeJsonMcpServer(config, true);
      if (Object.keys(config).length > 0) {
        await writeJsonObject(configPath, config);
      } else {
        await rm(configPath, { force: true });
      }
      return;
    }

    if (platform === "gemini") {
      const config = await readJsonObject(configPath);
      const mcpServers = asRecord(config.mcpServers);
      delete mcpServers.forma;
      if (Object.keys(mcpServers).length > 0) {
        config.mcpServers = mcpServers;
      } else {
        delete config.mcpServers;
      }
      if (Object.keys(config).length > 0) {
        await writeJsonObject(configPath, config);
      } else {
        await rm(configPath, { force: true });
      }
      return;
    }

    const content = await readFile(configPath, "utf8");
    const next = removeCodexManagedSection(content);
    if (next.trim()) {
      await writeFile(configPath, next, "utf8");
    } else {
      await rm(configPath, { force: true });
    }
  }

  private async uninstallMcpConfigWithOfficialCli(platform: AgentInstallPlatform): Promise<boolean> {
    try {
      const command = officialMcpUninstallCommand(platform);
      await this.mcpCommandRunner.run(command.command, command.args, this.mcpCommandRunOptions());
      return true;
    } catch {
      return false;
    }
  }

  private mcpCommandRunOptions(): FormaMcpCommandRunOptions {
    return {
      env: {
        HOME: this.userHome,
        USERPROFILE: this.userHome
      }
    };
  }

  private async restoreConfigBackup(
    platform: AgentInstallPlatform,
    configPath: string,
    backupPath: string
  ): Promise<void> {
    const currentContent = await readFile(configPath, "utf8");
    const backupContent = await readFile(backupPath, "utf8");

    if (platform === "claude") {
      await writeFile(configPath, mergeClaudeConfigBackup(currentContent, backupContent, configPath), "utf8");
      return;
    }

    if (platform === "gemini") {
      await writeFile(configPath, mergeGeminiConfigBackup(currentContent, backupContent, configPath), "utf8");
      return;
    }

    await writeFile(configPath, mergeCodexConfigBackup(currentContent, backupContent), "utf8");
  }

  private async writeJsonConfig(
    platform: AgentInstallPlatform,
    configPath: string,
    update: (config: Record<string, unknown>) => Record<string, unknown>,
    record: InstallRecord
  ): Promise<void> {
    const existingContent = await readOptionalText(configPath);
    const existingConfig = existingContent ? parseJsonObject(existingContent, configPath) : {};
    const nextContent = `${JSON.stringify(update(existingConfig), null, 2)}\n`;

    await this.writeTextTarget(platform, configPath, nextContent, record.backups);
    record.configPaths.push(configPath);
  }

  private async writeCodexConfig(
    platform: AgentInstallPlatform,
    configPath: string,
    record: InstallRecord
  ): Promise<void> {
    const existing = await readOptionalText(configPath);
    const next = appendCodexManagedSection(removeCodexManagedSection(existing ?? ""), this.mcpCommand);
    await this.writeTextTarget(platform, configPath, next, record.backups);
    record.configPaths.push(configPath);
  }

  private async writeManagedFile(args: {
    platform: AgentInstallPlatform;
    source: string;
    target: string;
    record: InstallRecord;
  }): Promise<void> {
    const content = await readFile(args.source, "utf8");
    await this.writeTextTarget(args.platform, args.target, content, args.record.backups);
    args.record.installedPaths.push(args.target);
  }

  private async writeTextTarget(
    platform: AgentInstallPlatform,
    target: string,
    content: string,
    backups: InstallBackupRecord[]
  ): Promise<void> {
    const existing = await readOptionalText(target);
    await this.backupExistingTargetIfNeeded(platform, target, backups);

    if (existing === content) {
      return;
    }

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  private async backupExistingTargetIfNeeded(
    platform: AgentInstallPlatform,
    target: string,
    backups: InstallBackupRecord[]
  ): Promise<void> {
    const existing = await readOptionalText(target);
    if (existing === undefined || backups.some((backup) => backup.target === target)) {
      return;
    }
    const isFormaOwned = await this.isTargetOwnedByActiveManifest(target);
    if (isFormaOwned) {
      return;
    }
    const backup = this.backupPath(platform, target);
    await mkdir(dirname(backup), { recursive: true });
    if (!(await this.isBackupReferencedByActiveManifest(backup))) {
      await writeFile(backup, existing, "utf8");
    }
    backups.push({ target, backup });
  }

  private templatePath(platform: AgentInstallPlatform, command: FormaInstallCommand): string {
    if (platform === "claude") {
      return join(this.templatesDir, "claude", `${command}.md`);
    }
    if (platform === "gemini") {
      return join(this.templatesDir, "gemini", `${command}.toml`);
    }
    return join(this.templatesDir, "codex", command, "SKILL.md");
  }

  private commandTargetPath(platform: AgentInstallPlatform, command: FormaInstallCommand): string {
    if (platform === "claude") {
      return join(this.userHome, ".claude", "commands", `${command}.md`);
    }
    if (platform === "gemini") {
      return join(this.userHome, ".gemini", "commands", `${command}.toml`);
    }
    return join(this.userHome, ".codex", "skills", command, "SKILL.md");
  }

  private mcpConfigPath(platform: AgentInstallPlatform): string {
    if (platform === "claude") {
      return join(this.userHome, ".claude.json");
    }
    if (platform === "gemini") {
      return join(this.userHome, ".gemini", "settings.json");
    }
    return join(this.userHome, ".codex", "config.toml");
  }

  private codexSkillDirsFromManifests(manifests: Map<AgentInstallPlatform, InstallManifest>): string[] {
    const dirs: string[] = [];
    for (const [platform, manifest] of manifests) {
      if (platform !== "codex") {
        continue;
      }
      for (const target of manifest.installed_paths) {
        const dir = this.codexSkillDirForTarget(target);
        if (dir) {
          dirs.push(dir);
        }
      }
    }
    return unique(dirs).sort((left, right) => right.length - left.length);
  }

  private codexSkillDirForTarget(target: string): string | undefined {
    if (basename(target) !== "SKILL.md") {
      return undefined;
    }

    const dir = dirname(target);
    const roots = [
      join(this.userHome, ".codex", "skills"),
      join(this.userHome, ".codex", "prompts", "skills")
    ];
    return roots.some((root) => pathIsWithin(root, dir)) ? dir : undefined;
  }

  private async writeManifest(
    platform: AgentInstallPlatform,
    record: InstallRecord,
    existingManifest?: InstallManifest
  ): Promise<void> {
    const carriedBackups = await this.backupsForInstalledPathsFromOtherManifests(platform, record.installedPaths);
    const currentTargets = new Set([...record.installedPaths, ...record.configPaths]);
    const retainedBackups = (existingManifest?.backups ?? []).filter((backup) => currentTargets.has(backup.target));
    const manifest: InstallManifest = {
      schema_version: 1,
      platform,
      installed_paths: unique(record.installedPaths),
      backups: mergeBackupRecords(retainedBackups, carriedBackups, record.backups),
      config_paths: unique(record.configPaths),
      installed_at: new Date().toISOString()
    };
    await writeYamlAtomic(this.manifestFile(platform), manifest);
  }

  private async cleanupStaleManifestTargets(
    platform: AgentInstallPlatform,
    existingManifest: InstallManifest | undefined,
    record: InstallRecord
  ): Promise<void> {
    if (!existingManifest) {
      return;
    }

    const currentTargets = new Set([...record.installedPaths, ...record.configPaths]);
    const protectedTargets = await this.pathsOwnedByOtherPlatforms([platform]);
    const backupByTarget = new Map<string, string>();
    for (const backup of existingManifest.backups) {
      if (!backupByTarget.has(backup.target)) {
        backupByTarget.set(backup.target, backup.backup);
      }
    }

    const previousTargets = unique([...existingManifest.installed_paths, ...existingManifest.config_paths]);
    for (const target of previousTargets.reverse()) {
      if (currentTargets.has(target) || protectedTargets.has(target)) {
        continue;
      }

      const backup = backupByTarget.get(target);
      if (backup && (await pathExists(backup))) {
        await mkdir(dirname(target), { recursive: true });
        await copyFile(backup, target);
      } else {
        await rm(target, { force: true });
      }
    }
  }

  private manifestFile(platform: AgentInstallPlatform): string {
    return join(this.formaHome, "manifests", `${platform}.manifest`);
  }

  private backupPath(platform: AgentInstallPlatform, target: string): string {
    const relativeTarget = relative(this.userHome, target);
    const safeName = relativeTarget.startsWith("..") ? encodeURIComponent(target) : relativeTarget;
    return join(this.formaHome, "backups", platform, safeName);
  }

  private async installedPathsOwnedByOtherPlatforms(selectedPlatforms: AgentInstallPlatform[]): Promise<Set<string>> {
    const selected = new Set(selectedPlatforms);
    const paths = new Set<string>();
    for (const platform of ["claude", "codex", "gemini"] satisfies AgentInstallPlatform[]) {
      if (selected.has(platform)) {
        continue;
      }
      const manifest = await readOptionalManifest(this.manifestFile(platform));
      for (const installedPath of manifest?.installed_paths ?? []) {
        paths.add(installedPath);
      }
    }
    return paths;
  }

  private async pathsOwnedByOtherPlatforms(selectedPlatforms: AgentInstallPlatform[]): Promise<Set<string>> {
    const selected = new Set(selectedPlatforms);
    const paths = new Set<string>();
    for (const platform of ["claude", "codex", "gemini"] satisfies AgentInstallPlatform[]) {
      if (selected.has(platform)) {
        continue;
      }
      const manifest = await readOptionalManifest(this.manifestFile(platform));
      for (const installedPath of manifest?.installed_paths ?? []) {
        paths.add(installedPath);
      }
      for (const configPath of manifest?.config_paths ?? []) {
        paths.add(configPath);
      }
    }
    return paths;
  }

  private async removeUnreferencedBackups(backupPaths: string[]): Promise<void> {
    const referencedBackups = new Set<string>();
    for (const platform of ["claude", "codex", "gemini"] satisfies AgentInstallPlatform[]) {
      const manifest = await readOptionalManifest(this.manifestFile(platform));
      for (const backup of manifest?.backups ?? []) {
        referencedBackups.add(backup.backup);
      }
    }

    for (const backupPath of unique(backupPaths)) {
      if (!referencedBackups.has(backupPath)) {
        await rm(backupPath, { force: true });
      }
    }
  }

  private async isBackupReferencedByActiveManifest(backupPath: string): Promise<boolean> {
    for (const platform of ["claude", "codex", "gemini"] satisfies AgentInstallPlatform[]) {
      const manifest = await readOptionalManifest(this.manifestFile(platform));
      if (manifest?.backups.some((backup) => backup.backup === backupPath)) {
        return true;
      }
    }
    return false;
  }

  private async isTargetOwnedByActiveManifest(target: string): Promise<boolean> {
    for (const platform of ["claude", "codex", "gemini"] satisfies AgentInstallPlatform[]) {
      const manifest = await readOptionalManifest(this.manifestFile(platform));
      if (manifest?.installed_paths.includes(target) || manifest?.config_paths.includes(target)) {
        return true;
      }
    }
    return false;
  }

  private async backupsForInstalledPathsFromOtherManifests(
    platform: AgentInstallPlatform,
    installedPaths: string[]
  ): Promise<InstallBackupRecord[]> {
    const installed = new Set(installedPaths);
    const backups: InstallBackupRecord[] = [];
    for (const otherPlatform of ["claude", "codex", "gemini"] satisfies AgentInstallPlatform[]) {
      if (otherPlatform === platform) {
        continue;
      }
      const manifest = await readOptionalManifest(this.manifestFile(otherPlatform));
      for (const backup of manifest?.backups ?? []) {
        if (installed.has(backup.target)) {
          backups.push(backup);
        }
      }
    }
    return backups;
  }

  private async transferBackupsToRemainingOwners(
    selectedPlatforms: AgentInstallPlatform[],
    protectedPaths: Set<string>,
    backupByTarget: Map<string, string>
  ): Promise<void> {
    if (protectedPaths.size === 0 || backupByTarget.size === 0) {
      return;
    }

    const selected = new Set(selectedPlatforms);
    for (const platform of ["claude", "codex", "gemini"] satisfies AgentInstallPlatform[]) {
      if (selected.has(platform)) {
        continue;
      }
      const manifest = await readOptionalManifest(this.manifestFile(platform));
      if (!manifest) {
        continue;
      }

      const transferred: InstallBackupRecord[] = [];
      const existingTargets = new Set(manifest.backups.map((backup) => backup.target));
      for (const installedPath of manifest.installed_paths) {
        const backup = backupByTarget.get(installedPath);
        if (protectedPaths.has(installedPath) && backup && !existingTargets.has(installedPath)) {
          transferred.push({ target: installedPath, backup });
        }
      }

      if (transferred.length > 0) {
        await writeYamlAtomic(this.manifestFile(platform), {
          ...manifest,
          backups: mergeBackupRecords(manifest.backups, transferred)
        });
      }
    }
  }
}

function defaultTemplatesDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../agent/templates");
}

const defaultMcpCommandRunner: FormaMcpCommandRunner = {
  async run(command, args, options) {
    await new Promise<void>((resolveCommand, rejectCommand) => {
      const child = spawn(command, args, { stdio: "ignore", env: { ...process.env, ...options?.env } });
      child.on("error", rejectCommand);
      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolveCommand();
          return;
        }
        rejectCommand(new Error(`${command} exited with ${code ?? `signal ${signal ?? "unknown"}`}`));
      });
    });
  }
};

function stdioMcpServerConfig(mcpCommand: FormaMcpCommand): FormaMcpCommand & { type: "stdio"; env: Record<string, string> } {
  return {
    type: "stdio",
    command: mcpCommand.command,
    args: mcpCommand.args,
    env: {}
  };
}

function officialMcpInstallCommand(platform: AgentInstallPlatform, mcpCommand: FormaMcpCommand): FormaMcpCommand {
  if (platform === "claude") {
    return {
      command: "claude",
      args: ["mcp", "add-json", "--scope", "user", "forma", JSON.stringify(stdioMcpServerConfig(mcpCommand))]
    };
  }
  if (platform === "gemini") {
    return {
      command: "gemini",
      args: ["mcp", "add", "--scope", "user", "--transport", "stdio", "forma", mcpCommand.command, ...mcpCommand.args]
    };
  }
  return {
    command: "codex",
    args: ["mcp", "add", "forma", "--", mcpCommand.command, ...mcpCommand.args]
  };
}

function officialMcpUninstallCommand(platform: AgentInstallPlatform): FormaMcpCommand {
  if (platform === "claude") {
    return { command: "claude", args: ["mcp", "remove", "--scope", "user", "forma"] };
  }
  if (platform === "gemini") {
    return { command: "gemini", args: ["mcp", "remove", "--scope", "user", "forma"] };
  }
  return { command: "codex", args: ["mcp", "remove", "forma"] };
}

async function readOptionalManifest(file: string): Promise<InstallManifest | undefined> {
  if (!(await pathExists(file))) {
    return undefined;
  }
  return readYaml<InstallManifest>(file);
}

async function readOptionalText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function pathIsWithin(root: string, target: string): boolean {
  const child = relative(resolve(root), resolve(target));
  return child !== "" && !child.startsWith("..") && !isAbsolute(child);
}

async function removeEmptyDirectory(dir: string): Promise<void> {
  try {
    await rmdir(dir);
  } catch (error) {
    if (isNodeError(error) && ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? "")) {
      return;
    }
    throw error;
  }
}

function parseJsonObject(content: string, file: string): Record<string, unknown> {
  const value = JSON.parse(content) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected JSON object in ${file}`);
  }
  return value as Record<string, unknown>;
}

async function readJsonObject(file: string): Promise<Record<string, unknown>> {
  return parseJsonObject(await readFile(file, "utf8"), file);
}

async function writeJsonObject(file: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function mergeClaudeConfigBackup(currentContent: string, backupContent: string, file: string): string {
  const current = parseJsonObject(currentContent, file);
  const backup = parseJsonObject(backupContent, file);
  const currentWithoutForma = removeJsonMcpServer({ ...current }, true);
  const backupWithoutTopLevelForma = withoutTopLevelForma(backup);
  const backupMcpServers = asRecord(backupWithoutTopLevelForma.mcpServers);
  const currentMcpServers = asRecord(currentWithoutForma.mcpServers);
  const merged = { ...backupWithoutTopLevelForma, ...currentWithoutForma };
  const mergedMcpServers = { ...backupMcpServers, ...currentMcpServers };
  if (Object.keys(mergedMcpServers).length > 0) {
    merged.mcpServers = mergedMcpServers;
  } else {
    delete merged.mcpServers;
  }
  return formatJsonLikeBackup(merged, backupContent);
}

function sanitizeClaudeConfigBackup(backupContent: string, file: string): string {
  return formatJsonLikeBackup(withoutTopLevelForma(parseJsonObject(backupContent, file)), backupContent);
}

function mergeGeminiConfigBackup(currentContent: string, backupContent: string, file: string): string {
  const current = parseJsonObject(currentContent, file);
  const backup = parseJsonObject(backupContent, file);
  const currentMcpServers = { ...asRecord(current.mcpServers) };
  const backupMcpServers = asRecord(backup.mcpServers);
  delete currentMcpServers.forma;

  const currentTopLevel = { ...current };
  delete currentTopLevel.mcpServers;
  const merged = { ...backup, ...currentTopLevel };
  const mergedMcpServers = { ...backupMcpServers, ...currentMcpServers };
  if (Object.keys(mergedMcpServers).length > 0) {
    merged.mcpServers = mergedMcpServers;
  } else {
    delete merged.mcpServers;
  }

  return formatJsonLikeBackup(merged, backupContent);
}

function formatJsonLikeBackup(value: Record<string, unknown>, backupContent: string): string {
  return `${JSON.stringify(value, null, 2)}${backupContent.endsWith("\n") ? "\n" : ""}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function withoutTopLevelForma(config: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config };
  delete next.forma;
  return next;
}

function removeJsonMcpServer(config: Record<string, unknown>, removeTopLevelForma = false): Record<string, unknown> {
  if (removeTopLevelForma) {
    delete config.forma;
  }
  const mcpServers = asRecord(config.mcpServers);
  delete mcpServers.forma;
  if (Object.keys(mcpServers).length > 0) {
    config.mcpServers = mcpServers;
  } else {
    delete config.mcpServers;
  }
  return config;
}

function appendCodexManagedSection(content: string, mcpCommand: FormaMcpCommand): string {
  const trimmed = content.trimEnd();
  const section = `${codexMcpStart}
[mcp_servers.forma]
command = ${JSON.stringify(mcpCommand.command)}
args = ${JSON.stringify(mcpCommand.args)}
${codexMcpEnd}
`;
  return trimmed ? `${trimmed}\n\n${section}` : section;
}

function mergeCodexConfigBackup(currentContent: string, backupContent: string): string {
  const currentWithoutForma = removeCodexManagedSection(currentContent);
  const backupFormaSection = extractCodexManagedSection(backupContent);
  if (!backupFormaSection) {
    return currentWithoutForma;
  }

  const trimmed = currentWithoutForma.trimEnd();
  return trimmed ? `${trimmed}\n\n${backupFormaSection}` : backupFormaSection;
}

function extractCodexManagedSection(content: string): string | undefined {
  const range = findCodexFormaSectionRange(content);
  return range ? content.slice(range.start, range.end) : undefined;
}

function removeCodexManagedSection(content: string): string {
  let next = content;
  let range = findCodexFormaSectionRange(next);
  while (range) {
    next = `${next.slice(0, range.start)}${next.slice(range.end)}`;
    range = findCodexFormaSectionRange(next);
  }
  next = next.replace(/\n{3,}/g, "\n\n");
  return next.trim() ? next.replace(/\n{2}$/g, "\n") : "";
}

function findCodexFormaSectionRange(content: string): { start: number; end: number } | undefined {
  const lines = splitLinesWithEndings(content);
  let offset = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const trimmedLine = line.trim();
    if (trimmedLine === codexMcpStart) {
      const start = offset;
      let end = offset + line.length;
      for (let endIndex = index + 1; endIndex < lines.length; endIndex++) {
        end += lines[endIndex]?.length ?? 0;
        if ((lines[endIndex] ?? "").trim() === codexMcpEnd) {
          return { start, end };
        }
      }
    }

    if (isCodexFormaTableHeader(line)) {
      const start = offset;
      let end = offset + line.length;
      for (let endIndex = index + 1; endIndex < lines.length; endIndex++) {
        const nextLine = lines[endIndex] ?? "";
        if (isTomlTableHeader(nextLine)) {
          return { start, end };
        }
        end += nextLine.length;
      }
      return { start, end };
    }

    offset += line.length;
  }

  return undefined;
}

function splitLinesWithEndings(content: string): string[] {
  return content.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter((line) => line.length > 0) ?? [];
}

function isTomlTableHeader(line: string): boolean {
  return /^\s*\[{1,2}[^\]\r\n]+\]{1,2}\s*(?:#.*)?(?:\r?\n|\r)?$/.test(line);
}

function isCodexFormaTableHeader(line: string): boolean {
  return /^\s*\[mcp_servers\.forma\]\s*(?:#.*)?(?:\r?\n|\r)?$/.test(line);
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function mergeBackupRecords(...groups: InstallBackupRecord[][]): InstallBackupRecord[] {
  const backupsByTarget = new Map<string, InstallBackupRecord>();
  for (const group of groups) {
    for (const backup of group) {
      if (!backupsByTarget.has(backup.target)) {
        backupsByTarget.set(backup.target, backup);
      }
    }
  }
  return Array.from(backupsByTarget.values());
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
