import { createHash, randomBytes } from "node:crypto";
import { access, copyFile, cp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z, ZodError } from "zod";
import { FormaError } from "./errors.js";
import type { PencilRunner, PencilService } from "./pencil.js";
import { styleVariablesSchema, type StyleVariables } from "./styles.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

export type CommandRunner = PencilRunner;

export const syncPhases = ["git_clone", "scanning", "extracting_variables", "rendering_previews", "updating_index", "cleanup"] as const;
export type SyncPhase = (typeof syncPhases)[number];

export const syncStatusSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("idle"),
    last_sync: z
      .object({
        completed_at: z.string(),
        styles_total: z.number().int().nonnegative(),
        styles_updated: z.number().int().nonnegative(),
        styles_added: z.number().int().nonnegative(),
        styles_failed: z.number().int().nonnegative(),
        duration_ms: z.number().int().nonnegative()
      })
      .optional()
  }),
  z.object({
    status: z.literal("running"),
    task_id: z.string().min(1),
    started_at: z.string(),
    progress: z.object({
      phase: z.enum(syncPhases),
      current: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      current_style: z.string().optional()
    })
  }),
  z.object({
    status: z.literal("failed"),
    task_id: z.string().min(1).optional(),
    error: z.object({
      phase: z.enum(syncPhases),
      message: z.string()
    })
  })
]);

export const syncPhaseSchema = z.enum(syncPhases);
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export interface ScannedStyleDirectory {
  name: string;
  designMdPath: string;
}

type SyncPencilService = Pick<PencilService, "checkAvailability">;

export interface SyncServiceOptions {
  home: string;
  pencilService: SyncPencilService;
  runner?: CommandRunner;
  autoRun?: boolean;
  now?: () => Date;
  styleLimit?: number;
}

const defaultStyleVariables: StyleVariables = {
  primary: "#3b82f6",
  background: "#FFFFFF",
  "text-primary": "#111827",
  "font-heading": "Inter",
  "font-body": "Inter",
  "border-radius": "8",
  "spacing-unit": "8"
};

const syncStaleAfterMs = 10 * 60 * 1000;
const styleRepoUrl = "https://github.com/VoltAgent/awesome-design-md.git";
type ScannedStyle = {
  name: string;
  designMdPath: string;
  designMd: string;
  description: string;
  category: Classification;
  variables: StyleVariables;
  sha256: string;
  status: "added" | "updated" | "unchanged";
};

class SyncTaskFailure extends Error {
  constructor(
    public readonly phase: SyncPhase,
    message: string
  ) {
    super(message);
  }
}

export class SyncService {
  private readonly home: string;
  private readonly stateFile: string;
  private readonly pencilService: SyncPencilService;
  private readonly runner?: CommandRunner;
  private readonly autoRun: boolean;
  private readonly now: () => Date;
  private readonly styleLimit?: number;

  constructor(options: SyncServiceOptions) {
    if (options.styleLimit !== undefined && (!Number.isInteger(options.styleLimit) || options.styleLimit < 1)) {
      throw new Error("Sync styleLimit must be a positive integer");
    }
    this.home = options.home;
    this.stateFile = join(options.home, "sync-state.yaml");
    this.pencilService = options.pencilService;
    this.runner = options.runner;
    this.autoRun = options.autoRun ?? true;
    this.now = options.now ?? (() => new Date());
    this.styleLimit = options.styleLimit;
  }

  async getStatus(): Promise<SyncStatus> {
    await this.recoverFromCrash();
    return await this.readStatus();
  }

  async startSync(): Promise<Extract<SyncStatus, { status: "running" }>> {
    await this.recoverFromCrash();
    await this.checkGit();

    const current = await this.readStatus();
    if (this.isNonStaleRunning(current)) {
      throw new FormaError("SYNC_ALREADY_RUNNING", "Sync already running", { task_id: current.task_id });
    }

    const startedAt = this.now().toISOString();
    const running: Extract<SyncStatus, { status: "running" }> = {
      status: "running",
      task_id: `sync-${randomBytes(8).toString("hex")}`,
      started_at: startedAt,
      progress: { phase: "git_clone", current: 0, total: 0 }
    };

    await this.writeStatus(running);
    if (this.autoRun !== false) {
      void this.runTask(running.task_id, startedAt).catch(() => undefined);
    }
    return running;
  }

  async recoverFromCrash(): Promise<SyncStatus> {
    const status = await this.readStatus();
    if (!this.isStaleRunning(status)) {
      return status;
    }

    const failed = syncStatusSchema.parse({
      status: "failed",
      task_id: status.task_id,
      error: { phase: "cleanup", message: "Previous sync task crashed or stopped" }
    });
    await this.writeStatus(failed);
    return failed;
  }

  private async checkGit(): Promise<void> {
    if (!this.runner) {
      throw new FormaError("SYNC_GIT_NOT_FOUND", "Git CLI not found", { command: "git --version" });
    }

    try {
      await this.runner.run("git", ["--version"], { timeoutMs: 5_000 });
    } catch {
      throw new FormaError("SYNC_GIT_NOT_FOUND", "Git CLI not found", { command: "git --version" });
    }
  }

  private async runTask(taskId: string, startedAt: string): Promise<void> {
    const tempRepoDir = join("/tmp", `forma-sync-${taskId}`);
    const stylesDir = join(this.home, "styles");
    let currentPhase: SyncPhase = "git_clone";
    let taskFailed = false;

    try {
      if (!this.runner) {
        throw new SyncTaskFailure("git_clone", "Git CLI not found");
      }

      await rm(tempRepoDir, { recursive: true, force: true });
      await this.writeProgress(taskId, startedAt, "git_clone", 0, 0);
      await this.runner.run("git", ["clone", "--depth", "1", styleRepoUrl, tempRepoDir], { timeoutMs: 60_000 });

      currentPhase = "scanning";
      await this.writeProgress(taskId, startedAt, "scanning", 0, 0);
      const scanned = await scanStyleDirectories(tempRepoDir);
      if (scanned.length === 0) {
        throw new SyncTaskFailure("scanning", "Repository structure changed: no style directories found");
      }
      const stylesToSync = this.styleLimit === undefined ? scanned : scanned.slice(0, this.styleLimit);

      currentPhase = "extracting_variables";
      await this.writeProgress(taskId, startedAt, "extracting_variables", 0, stylesToSync.length);
      const styles: ScannedStyle[] = [];
      for (const style of stylesToSync) {
        const designMd = await readFile(style.designMdPath, "utf8");
        const sha256 = sha256Hex(designMd);
        const existingDesignMd = join(stylesDir, style.name, "DESIGN.md");
        const status = await this.compareLocalStyle(existingDesignMd, sha256);
        styles.push({
          name: style.name,
          designMdPath: style.designMdPath,
          designMd,
          description: describeStyle(designMd),
          category: classifyStyle(designMd),
          variables: extractVariablesFromDesignMd(designMd),
          sha256,
          status
        });
        await this.writeProgress(taskId, startedAt, "extracting_variables", styles.length, stylesToSync.length, style.name);
      }

      currentPhase = "rendering_previews";
      await this.writeProgress(taskId, startedAt, "rendering_previews", 0, styles.length);
      for (const [index, style] of styles.entries()) {
        await this.writeProgress(taskId, startedAt, "rendering_previews", index + 1, styles.length, style.name);
      }

      currentPhase = "updating_index";
      await this.writeProgress(taskId, startedAt, "updating_index", 0, styles.length);
      const completedAt = this.now().toISOString();
      await this.updateStylesIndex(taskId, styles, completedAt, startedAt);

      await this.writeStatus({
        status: "idle",
        last_sync: {
          completed_at: completedAt,
          styles_total: styles.length,
          styles_updated: styles.filter((style) => style.status === "updated").length,
          styles_added: styles.filter((style) => style.status === "added").length,
          styles_failed: 0,
          duration_ms: Math.max(0, this.now().getTime() - new Date(startedAt).getTime())
        }
      });
    } catch (error) {
      taskFailed = true;
      const failure = error instanceof SyncTaskFailure ? error : new SyncTaskFailure(currentPhase, errorMessage(error));
      await this.writeStatus({
        status: "failed",
        task_id: taskId,
        error: { phase: failure.phase, message: failure.message }
      });
    } finally {
      try {
        await rm(tempRepoDir, { recursive: true, force: true });
      } catch (error) {
        if (!taskFailed) {
          await this.writeStatus({
            status: "failed",
            task_id: taskId,
            error: { phase: "cleanup", message: `Failed to cleanup sync temp directory: ${errorMessage(error)}` }
          });
        }
      }
    }
  }

  private async updateStylesIndex(taskId: string, styles: ScannedStyle[], completedAt: string, startedAt: string): Promise<void> {
    const stylesDir = join(this.home, "styles");
    const stageDir = join(this.home, `.styles-stage-${taskId}`);
    const backupDir = join(this.home, `.styles-backup-${taskId}`);
    let preserveBackup = false;

    try {
      await rm(stageDir, { recursive: true, force: true });
      await rm(backupDir, { recursive: true, force: true });
      if (await fileExists(stylesDir)) {
        await cp(stylesDir, stageDir, { recursive: true });
      } else {
        await mkdir(stageDir, { recursive: true });
      }

      for (const [index, style] of styles.entries()) {
        await copyFileAtomic(style.designMdPath, join(stageDir, style.name, "DESIGN.md"));
        await this.writeProgress(taskId, startedAt, "updating_index", index + 1, styles.length, style.name);
      }

      await writeYamlAtomic(join(stageDir, "styles.yaml"), {
        last_synced: completedAt,
        styles: styles.map((style) => ({
          name: style.name,
          description: style.description,
          category: style.category,
          design_md_path: `styles/${style.name}/DESIGN.md`,
          sha256: style.sha256,
          variables: style.variables
        }))
      });

      if (await fileExists(stylesDir)) {
        await rename(stylesDir, backupDir);
      }
      try {
        await rename(stageDir, stylesDir);
      } catch (error) {
        if (await fileExists(backupDir)) {
          try {
            await rename(backupDir, stylesDir);
          } catch {
            preserveBackup = true;
          }
        }
        throw error;
      }
      await rm(backupDir, { recursive: true, force: true });
    } finally {
      await rm(stageDir, { recursive: true, force: true });
      if (!preserveBackup) {
        await rm(backupDir, { recursive: true, force: true });
      }
    }
  }

  private async writeProgress(
    taskId: string,
    startedAt: string,
    phase: SyncPhase,
    current: number,
    total: number,
    currentStyle?: string
  ): Promise<void> {
    await this.writeStatus({
      status: "running",
      task_id: taskId,
      started_at: startedAt,
      progress: {
        phase,
        current,
        total,
        ...(currentStyle ? { current_style: currentStyle } : {})
      }
    });
  }

  private async compareLocalStyle(existingDesignMd: string, nextSha256: string): Promise<ScannedStyle["status"]> {
    try {
      const previous = await readFile(existingDesignMd, "utf8");
      return sha256Hex(previous) === nextSha256 ? "unchanged" : "updated";
    } catch (error) {
      if (isEnoent(error)) {
        return "added";
      }
      throw error;
    }
  }

  private async readStatus(): Promise<SyncStatus> {
    try {
      return await readYamlAs(this.stateFile, syncStatusSchema);
    } catch (error) {
      if (isEnoent(error)) {
        const idle = syncStatusSchema.parse({ status: "idle" });
        await this.writeStatus(idle);
        return idle;
      }
      if (isIoError(error)) {
        throw error;
      }

      const idle = syncStatusSchema.parse({ status: "idle" });
      await this.writeStatus(idle);
      return idle;
    }
  }

  private async writeStatus(status: SyncStatus): Promise<void> {
    await writeYamlAtomic(this.stateFile, syncStatusSchema.parse(status));
  }

  private isNonStaleRunning(status: SyncStatus): status is Extract<SyncStatus, { status: "running" }> {
    return status.status === "running" && !this.isStaleRunning(status);
  }

  private isStaleRunning(status: SyncStatus): status is Extract<SyncStatus, { status: "running" }> {
    if (status.status !== "running") {
      return false;
    }
    const startedAt = new Date(status.started_at).getTime();
    return Number.isFinite(startedAt) && startedAt < this.now().getTime() - syncStaleAfterMs;
  }
}

const variableKeyMap: Record<string, keyof StyleVariables> = {
  primary: "primary",
  background: "background",
  canvas: "background",
  foreground: "text-primary",
  ink: "text-primary",
  "text primary": "text-primary",
  "text-primary": "text-primary",
  "heading font": "font-heading",
  "heading-font": "font-heading",
  "body font": "font-body",
  "body-font": "font-body",
  "corner radius": "border-radius",
  "border-radius": "border-radius",
  "base spacing": "spacing-unit",
  "spacing-unit": "spacing-unit",
  md: "border-radius",
  xs: "spacing-unit"
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function copyFileAtomic(source: string, destination: string): Promise<void> {
  const parentDir = dirname(destination);
  await mkdir(parentDir, { recursive: true });
  const tempFile = join(parentDir, `.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await copyFile(source, tempFile);
    await rename(tempFile, destination);
  } catch (error) {
    await rm(tempFile, { force: true });
    throw error;
  }
}

type Classification = "AI 产品" | "工具类" | "电商" | "金融" | "社交" | "健康" | "其他";

export async function scanStyleDirectories(root: string): Promise<ScannedStyleDirectory[]> {
  const rootStyles = await scanFirstLevelStyleDirectories(root);
  if (rootStyles.length > 0) {
    return rootStyles;
  }

  const collectionRoot = join(root, "design-md");
  if (await directoryExists(collectionRoot)) {
    return await scanFirstLevelStyleDirectories(collectionRoot);
  }

  return [];
}

async function scanFirstLevelStyleDirectories(root: string): Promise<ScannedStyleDirectory[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_"))
    .sort((a, b) => a.name.localeCompare(b.name));

  const styles: ScannedStyleDirectory[] = [];
  for (const directory of directories) {
    const designMdPath = join(root, directory.name, "DESIGN.md");
    if (await fileExists(designMdPath)) {
      styles.push({ name: directory.name, designMdPath });
    }
  }

  return styles;
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    const metadata = await stat(directory);
    return metadata.isDirectory();
  } catch (error) {
    if (isEnoent(error)) {
      return false;
    }
    throw error;
  }
}

export function extractVariablesFromDesignMd(markdown: string): StyleVariables {
  const variables: StyleVariables = { ...defaultStyleVariables };
  const context: string[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*---\s*$/.test(line)) {
      context.length = 0;
      continue;
    }

    const match = /^(\s*)([A-Za-z][A-Za-z -]*):\s*(.*?)\s*$/.exec(line);
    if (!match) {
      continue;
    }

    const indent = match[1].length;
    const key = match[2].trim().toLowerCase();
    const rawValue = match[3].trim();
    const level = indent / 2;
    const parent = level > 0 ? context[level - 1] : undefined;
    context[level] = key;
    context.length = level + 1;

    if (!rawValue) {
      continue;
    }

    const variableKey = variableKeyForParsedLine(parent, key);
    if (variableKey) {
      variables[variableKey] = normalizeVariableValue(rawValue, variableKey);
    }
  }

  return styleVariablesSchema.parse(variables);
}

export function classifyStyle(markdown: string): Classification {
  const text = markdown.toLowerCase();
  if (/\b(ai|llm|chat|assistant)\b/.test(text)) {
    return "AI 产品";
  }
  if (/\b(tool|productivity|project|task)\b/.test(text)) {
    return "工具类";
  }
  if (/\b(shop|commerce|retail|store|checkout|ecommerce)\b/.test(text)) {
    return "电商";
  }
  if (/\b(finance|bank|payment|trading)\b/.test(text)) {
    return "金融";
  }
  if (/\b(social|community|message)\b/.test(text)) {
    return "社交";
  }
  if (/\b(health|medical|fitness)\b/.test(text)) {
    return "健康";
  }
  return "其他";
}

export function describeStyle(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let bodyStart = 0;

  if (lines[0]?.trim() === "---") {
    for (let index = 1; index < lines.length; index += 1) {
      const trimmed = lines[index].trim();
      if (trimmed === "---") {
        bodyStart = index + 1;
        break;
      }

      const description = /^description:\s*(.+?)\s*$/.exec(trimmed);
      if (description) {
        if (description[1] === "|") {
          return describeBlockScalar(lines, index + 1);
        }
        return normalizeDescription(description[1]).slice(0, 50);
      }
    }
  }

  for (const line of lines.slice(bodyStart)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      return trimmed.slice(0, 50);
    }
  }

  return "Style generated from DESIGN.md";
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isIoError(error: unknown): boolean {
  return error instanceof Error && "code" in error && !(error instanceof ZodError);
}

function variableKeyForParsedLine(parent: string | undefined, key: string): keyof StyleVariables | undefined {
  if (parent === "colors") {
    return variableKeyMap[key];
  }
  if (parent === "rounded" && key === "md") {
    return "border-radius";
  }
  if (parent === "spacing" && key === "xs") {
    return "spacing-unit";
  }
  if (!parent) {
    return variableKeyMap[key];
  }
  if (key === "fontfamily" && parent === "hero-display") {
    return "font-heading";
  }
  if (key === "fontfamily" && parent === "body") {
    return "font-body";
  }
  return undefined;
}

function normalizeVariableValue(value: string, variableKey: keyof StyleVariables): string {
  const unquoted = value.replace(/^["']|["']$/g, "").trim();
  if (variableKey === "border-radius" || variableKey === "spacing-unit") {
    return unquoted.replace(/px$/i, "").trim();
  }
  if (variableKey === "font-heading" || variableKey === "font-body") {
    return unquoted.split(",")[0].trim();
  }
  return unquoted;
}

function normalizeDescription(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}

function describeBlockScalar(lines: string[], start: number): string {
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "---") {
      break;
    }
    if (line.trim()) {
      return line.trim().slice(0, 50);
    }
  }
  return "Style generated from DESIGN.md";
}
