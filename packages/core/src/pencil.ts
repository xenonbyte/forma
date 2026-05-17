import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { FormaError } from "./errors.js";

export interface PencilRunner {
  run(command: string, args: string[], options?: { cwd?: string }): Promise<{ stdout: string; stderr: string }>;
}

export interface PencilLockContext {
  operation: string;
  product_id: string;
}

export interface PencilLock extends PencilLockContext {
  pid: number;
  acquired_at: string;
}

export type PencilLockSeed = PencilLockContext & {
  pid: number;
  acquired_at?: string;
};

export interface GeneratePageDesignInput {
  product_id: string;
  prompt: string;
  workspace: string;
}

export interface GenerateComponentsInput {
  product_id: string;
  prompt: string;
  workspace: string;
}

export interface GeneratedDesign {
  penPath: string;
  previewPath: string;
  tempDir: string;
}

export interface GeneratedComponents {
  penPath: string;
  tempDir: string;
}

export interface PencilServiceOptions {
  home: string;
  runner?: PencilRunner;
  isPidAlive?: (pid: number) => boolean;
}

const lockTimeoutMs = 5 * 60 * 1000;

export const defaultPencilRunner: PencilRunner = {
  async run(command, args, options) {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: options?.cwd, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(Object.assign(new Error(stderr || `${command} exited with code ${code}`), { stdout, stderr, exitCode: code }));
      });
    });
  }
};

export class PencilService {
  private readonly home: string;
  private readonly runner: PencilRunner;
  private readonly isPidAlive: (pid: number) => boolean;
  private readonly lockFile: string;

  constructor(options: PencilServiceOptions) {
    this.home = options.home;
    this.runner = options.runner ?? defaultPencilRunner;
    this.isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
    this.lockFile = join(options.home, "pencil.lock");
  }

  async checkAvailability(): Promise<void> {
    try {
      await this.runner.run("pencil", ["version"]);
    } catch (error) {
      throw new FormaError("PENCIL_CLI_NOT_FOUND", "Pencil CLI not found", { cause: errorMessage(error) });
    }

    let status: { stdout: string; stderr: string };
    try {
      status = await this.runner.run("pencil", ["status"]);
    } catch (error) {
      throw new FormaError("PENCIL_NOT_AUTHENTICATED", "Pencil is not authenticated", { cause: errorMessage(error) });
    }

    if (!/\bactive\b/i.test(status.stdout)) {
      throw new FormaError("PENCIL_NOT_AUTHENTICATED", "Pencil is not authenticated", { status: status.stdout.trim() });
    }
  }

  async withLock<T>(context: PencilLockContext, fn: () => Promise<T>): Promise<T> {
    await this.acquireLock(context);
    try {
      return await fn();
    } finally {
      await rm(this.lockFile, { force: true });
    }
  }

  async validatePenFile(filePath: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      throw new FormaError("PEN_FILE_INVALID", "Pen file is invalid", { file: filePath, cause: errorMessage(error) });
    }

    if (!isRecord(parsed) || !Array.isArray(parsed.children) || parsed.children.length === 0 || containsTruncationMarker(parsed)) {
      throw new FormaError("PEN_FILE_INVALID", "Pen file is invalid", { file: filePath });
    }
  }

  async generatePageDesign(input: GeneratePageDesignInput): Promise<GeneratedDesign> {
    await this.checkAvailability();
    return await this.withLock({ operation: "design", product_id: input.product_id }, async () => {
      const tempDir = await this.createTempDir();
      const penPath = join(tempDir, "page.pen");
      const previewPath = join(tempDir, "preview.png");
      await this.runner.run("pencil", [
        "generate-page-design",
        "--out",
        penPath,
        "--workspace",
        input.workspace,
        "--prompt",
        input.prompt
      ]);
      await this.validatePenFile(penPath);
      await this.exportPreview(penPath, previewPath);
      return { penPath, previewPath, tempDir };
    });
  }

  async generateComponents(input: GenerateComponentsInput): Promise<GeneratedComponents> {
    await this.checkAvailability();
    return await this.withLock({ operation: "components", product_id: input.product_id }, async () => {
      const tempDir = await this.createTempDir();
      const penPath = join(tempDir, "components.pen");
      await this.runner.run("pencil", [
        "generate-components",
        "--out",
        penPath,
        "--workspace",
        input.workspace,
        "--prompt",
        input.prompt
      ]);
      await this.validatePenFile(penPath);
      return { penPath, tempDir };
    });
  }

  async exportPreview(inputPen: string, outputPng: string): Promise<void> {
    await this.runner.run("pencil", ["--in", inputPen, "--export", outputPng, "--export-scale", "2"]);
    const output = await stat(outputPng).catch((error: unknown) => {
      throw new FormaError("PEN_FILE_INVALID", "Preview export is invalid", { file: outputPng, cause: errorMessage(error) });
    });
    if (output.size <= 0) {
      throw new FormaError("PEN_FILE_INVALID", "Preview export is invalid", { file: outputPng });
    }
  }

  /**
   * Test helper for seeding lock state without invoking Pencil.
   */
  async writeLock(lock: PencilLockSeed): Promise<void> {
    await this.writeLockFile(lock);
  }

  private async writeLockFile(lock: PencilLockSeed, exclusive = false): Promise<void> {
    await mkdir(this.home, { recursive: true });
    await writeFile(
      this.lockFile,
      JSON.stringify({ ...lock, acquired_at: lock.acquired_at ?? new Date().toISOString() }, null, 2),
      { encoding: "utf8", flag: exclusive ? "wx" : "w" }
    );
  }

  private async acquireLock(context: PencilLockContext): Promise<void> {
    await mkdir(this.home, { recursive: true });

    while (true) {
      const existing = await this.readLock();
      if (existing) {
        if (this.shouldHoldLock(existing)) {
          throw new FormaError("PENCIL_LOCK_HELD", "Pencil lock is held", { ...existing });
        }
        await rm(this.lockFile, { force: true });
      }

      try {
        await this.writeLockFile({ ...context, pid: process.pid, acquired_at: new Date().toISOString() }, true);
        return;
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") {
          throw error;
        }
      }
    }
  }

  private async readLock(): Promise<PencilLock | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.lockFile, "utf8"));
      if (!isRecord(parsed) || typeof parsed.pid !== "number") {
        return undefined;
      }
      return {
        pid: parsed.pid,
        acquired_at: typeof parsed.acquired_at === "string" ? parsed.acquired_at : new Date(0).toISOString(),
        operation: typeof parsed.operation === "string" ? parsed.operation : "unknown",
        product_id: typeof parsed.product_id === "string" ? parsed.product_id : "unknown"
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      return undefined;
    }
  }

  private shouldHoldLock(lock: PencilLock): boolean {
    if (!this.isPidAlive(lock.pid)) {
      return false;
    }
    return Date.now() - Date.parse(lock.acquired_at) <= lockTimeoutMs;
  }

  private async createTempDir(): Promise<string> {
    const tempDir = join(tmpdir(), `forma-pencil-${randomBytes(8).toString("hex")}`);
    await mkdir(tempDir, { recursive: true });
    return tempDir;
  }
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function containsTruncationMarker(value: unknown): boolean {
  if (value === "...") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsTruncationMarker(item));
  }
  if (isRecord(value)) {
    return Object.values(value).some((item) => containsTruncationMarker(item));
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
