import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml, writeYamlAtomic } from "./yaml.js";

export type AgentInstallPlatform = "claude" | "codex" | "gemini";

export const formaInstallCommands = [
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

export type FormaInstallCommand = (typeof formaInstallCommands)[number];

export interface InstallServiceOptions {
  formaHome?: string;
  userHome?: string;
  templatesDir?: string;
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
const formaMcpConfig = { command: "forma", args: ["mcp"] };

export class InstallService {
  readonly formaHome: string;
  readonly userHome: string;
  readonly templatesDir: string;

  constructor(options: InstallServiceOptions = {}) {
    this.userHome = resolve(options.userHome ?? homedir());
    this.formaHome = resolve(options.formaHome ?? join(this.userHome, ".forma"));
    this.templatesDir = resolve(options.templatesDir ?? defaultTemplatesDir());
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

    for (const platform of selectedManifests.keys()) {
      await rm(this.manifestFile(platform), { force: true });
    }
    await this.removeUnreferencedBackups(Array.from(backupByTarget.values()));
  }

  private async installPlatform(platform: AgentInstallPlatform): Promise<void> {
    const record: InstallRecord = { installedPaths: [], backups: [], configPaths: [] };

    await this.installSharedSkill(platform, record);
    await this.installCommandTemplates(platform, record);
    await this.installMcpConfig(platform, record);
    await this.writeManifest(platform, record);
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
    if (platform === "claude") {
      await this.writeJsonConfig(platform, join(this.userHome, ".claude", "mcp.json"), (config) => ({
        ...config,
        forma: formaMcpConfig
      }), record);
      return;
    }

    if (platform === "gemini") {
      await this.writeJsonConfig(platform, join(this.userHome, ".gemini", "settings.json"), (config) => ({
        ...config,
        mcpServers: {
          ...asRecord(config.mcpServers),
          forma: formaMcpConfig
        }
      }), record);
      return;
    }

    await this.writeCodexConfig(platform, join(this.userHome, ".codex", "config.toml"), record);
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
    if (!(await pathExists(configPath))) {
      if (backup && hasBackup) {
        await mkdir(dirname(configPath), { recursive: true });
        await copyFile(backup, configPath);
      }
      return;
    }

    if (backup && hasBackup) {
      await this.restoreConfigBackup(platform, configPath, backup);
      return;
    }

    if (platform === "claude") {
      const config = await readJsonObject(configPath);
      delete config.forma;
      await writeJsonObject(configPath, config);
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
      await writeJsonObject(configPath, config);
      return;
    }

    const content = await readFile(configPath, "utf8");
    await writeFile(configPath, removeCodexManagedSection(content), "utf8");
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
    const next = appendCodexManagedSection(removeCodexManagedSection(existing ?? ""));
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
    if (existing === content) {
      return;
    }

    if (existing !== undefined) {
      const backup = this.backupPath(platform, target);
      await mkdir(dirname(backup), { recursive: true });
      if (!(await pathExists(backup))) {
        await writeFile(backup, existing, "utf8");
      }
      backups.push({ target, backup });
    }

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
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
    return join(this.userHome, ".codex", "prompts", "skills", command, "SKILL.md");
  }

  private async writeManifest(platform: AgentInstallPlatform, record: InstallRecord): Promise<void> {
    const existingManifest = await readOptionalManifest(this.manifestFile(platform));
    const carriedBackups = await this.backupsForInstalledPathsFromOtherManifests(platform, record.installedPaths);
    const manifest: InstallManifest = {
      schema_version: 1,
      platform,
      installed_paths: unique(record.installedPaths),
      backups: mergeBackupRecords(existingManifest?.backups ?? [], carriedBackups, record.backups),
      config_paths: unique(record.configPaths),
      installed_at: new Date().toISOString()
    };
    await writeYamlAtomic(this.manifestFile(platform), manifest);
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
  const currentWithoutForma = { ...current };
  delete currentWithoutForma.forma;
  return formatJsonLikeBackup({ ...backup, ...currentWithoutForma }, backupContent);
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

function appendCodexManagedSection(content: string): string {
  const trimmed = content.trimEnd();
  const section = `${codexMcpStart}
[mcp_servers.forma]
command = "forma"
args = ["mcp"]
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

    if (trimmedLine === "[mcp_servers.forma]") {
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
