import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  owner_id: string;
}

export type PencilLockSeed = PencilLockContext & {
  pid: number;
  acquired_at?: string;
  owner_id?: string;
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
  /**
   * Temporary directory ownership is transferred to the caller on success.
   */
  tempDir: string;
  penPath: string;
  previewPath: string;
}

export interface GeneratedComponents {
  /**
   * Temporary directory ownership is transferred to the caller on success.
   */
  tempDir: string;
  penPath: string;
  libraryPath: string;
}

export interface PencilServiceOptions {
  home: string;
  runner?: PencilRunner;
  isPidAlive?: (pid: number) => boolean;
}

const lockTimeoutMs = 5 * 60 * 1000;
type InvalidLockMode = "throw" | "ignore";
const productIdPattern = /^P-[a-f0-9]{6}$/;

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
      throw new FormaError("PENCIL_CLI_NOT_FOUND", "Pencil CLI not found", availabilityErrorDetails("version", error));
    }

    let status: { stdout: string; stderr: string };
    try {
      status = await this.runner.run("pencil", ["status"]);
    } catch (error) {
      throw new FormaError("PENCIL_NOT_AUTHENTICATED", "Pencil is not authenticated", availabilityErrorDetails("status", error));
    }

    if (!/\bactive\b/i.test(status.stdout)) {
      throw new FormaError("PENCIL_NOT_AUTHENTICATED", "Pencil is not authenticated", { command: "status" });
    }
  }

  async withLock<T>(context: PencilLockContext, fn: () => Promise<T>): Promise<T> {
    const lock = await this.acquireLock(context);
    try {
      return await fn();
    } finally {
      await this.releaseLock(lock.owner_id);
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
      try {
        const penPath = join(tempDir, "page.pen");
        const previewPath = join(tempDir, "preview.png");
        await this.runner.run("pencil", ["--out", penPath, "--workspace", input.workspace, "--prompt", input.prompt]);
        await this.validatePenFile(penPath);
        await this.exportPreview(penPath, previewPath);
        return { penPath, previewPath, tempDir };
      } catch (error) {
        await rm(tempDir, { recursive: true, force: true });
        throw error;
      }
    });
  }

  async generateComponents(input: GenerateComponentsInput): Promise<GeneratedComponents> {
    const productId = parseProductId(input.product_id);
    await this.checkAvailability();
    return await this.withLock({ operation: "components", product_id: productId }, async () => {
      const tempDir = await this.createTempDir();
      try {
        const penPath = join(tempDir, "components.lib.pen");
        const libraryPath = this.componentLibraryPath(productId);
        await this.runner.run("pencil", ["--out", penPath, "--prompt", input.prompt]);
        await this.validatePenFile(penPath);
        await copyFileAtomic(penPath, libraryPath);
        return { penPath, tempDir, libraryPath };
      } catch (error) {
        await rm(tempDir, { recursive: true, force: true });
        throw error;
      }
    });
  }

  async exportPreview(inputPen: string, outputPng: string): Promise<void> {
    await this.exportAsset(inputPen, outputPng, "png");
  }

  async exportAsset(inputPen: string, output: string, format: "png" | "pdf"): Promise<void> {
    const args = ["--in", inputPen, "--export", output, "--export-scale", "2"];
    if (format !== "png") {
      args.push("--export-type", format);
    }
    await this.runner.run("pencil", args);
    const bytes = await readFile(output).catch((error: unknown) => {
      throw new FormaError("PEN_FILE_INVALID", "Export is invalid", { file: output, cause: errorMessage(error) });
    });
    if (format === "png" && !hasPngSignature(bytes)) {
      throw new FormaError("PEN_FILE_INVALID", "Export is invalid", { file: output });
    }
    if (format === "pdf" && !hasPdfSignature(bytes)) {
      throw new FormaError("PEN_FILE_INVALID", "Export is invalid", { file: output });
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
      JSON.stringify({ ...lock, acquired_at: lock.acquired_at ?? new Date().toISOString(), owner_id: lock.owner_id ?? createOwnerId() }, null, 2),
      { encoding: "utf8", flag: exclusive ? "wx" : "w" }
    );
  }

  private async acquireLock(context: PencilLockContext): Promise<PencilLock> {
    await mkdir(this.home, { recursive: true });

    while (true) {
      const existing = await this.readLock("throw");
      if (existing) {
        if (this.shouldHoldLock(existing)) {
          throw new FormaError("PENCIL_LOCK_HELD", "Pencil lock is held", { ...existing });
        }
        await this.removeLockIfMatches(existing);
      }

      try {
        const lock = { ...context, pid: process.pid, acquired_at: new Date().toISOString(), owner_id: createOwnerId() };
        await this.writeLockFile(lock, true);
        return lock;
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") {
          throw error;
        }
      }
    }
  }

  private async readLock(invalidLockMode: InvalidLockMode = "ignore"): Promise<PencilLock | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.lockFile, "utf8"));
      if (
        !isRecord(parsed) ||
        typeof parsed.pid !== "number" ||
        typeof parsed.acquired_at !== "string" ||
        !Number.isFinite(Date.parse(parsed.acquired_at)) ||
        typeof parsed.operation !== "string" ||
        typeof parsed.product_id !== "string" ||
        typeof parsed.owner_id !== "string"
      ) {
        return handleInvalidLock(invalidLockMode);
      }
      return {
        pid: parsed.pid,
        acquired_at: parsed.acquired_at,
        operation: parsed.operation,
        product_id: parsed.product_id,
        owner_id: parsed.owner_id
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      return handleInvalidLock(invalidLockMode);
    }
  }

  private shouldHoldLock(lock: PencilLock): boolean {
    if (!this.isPidAlive(lock.pid)) {
      return false;
    }
    return Date.now() - Date.parse(lock.acquired_at) <= lockTimeoutMs;
  }

  private async releaseLock(ownerId: string): Promise<void> {
    const current = await this.readLock();
    if (current?.owner_id === ownerId) {
      await rm(this.lockFile, { force: true });
    }
  }

  private async removeLockIfMatches(lock: PencilLock): Promise<void> {
    const current = await this.readLock();
    if (current && locksMatch(current, lock)) {
      await rm(this.lockFile, { force: true });
    }
  }

  private async createTempDir(): Promise<string> {
    const tempDir = join(tmpdir(), `forma-pencil-${randomBytes(8).toString("hex")}`);
    await mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  private componentLibraryPath(productId: string): string {
    return join(this.home, "library", `${parseProductId(productId)}.lib.pen`);
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

function parseProductId(productId: string): string {
  if (!productIdPattern.test(productId)) {
    throw new FormaError("PRODUCT_NOT_FOUND", "Product not found", { product_id: productId });
  }
  return productId;
}

function createOwnerId(): string {
  return randomBytes(16).toString("hex");
}

function locksMatch(a: PencilLock, b: PencilLock): boolean {
  return (
    a.owner_id === b.owner_id &&
    a.pid === b.pid &&
    a.acquired_at === b.acquired_at &&
    a.operation === b.operation &&
    a.product_id === b.product_id
  );
}

function availabilityErrorDetails(command: "version" | "status", error: unknown): Record<string, unknown> {
  const details: Record<string, unknown> = { command };
  if (isRecord(error) && typeof error.exitCode === "number") {
    details.exitCode = error.exitCode;
  }
  return details;
}

function hasPngSignature(value: Buffer): boolean {
  return (
    value.length >= 8 &&
    value[0] === 0x89 &&
    value[1] === 0x50 &&
    value[2] === 0x4e &&
    value[3] === 0x47 &&
    value[4] === 0x0d &&
    value[5] === 0x0a &&
    value[6] === 0x1a &&
    value[7] === 0x0a
  );
}

function hasPdfSignature(value: Buffer): boolean {
  return value.length >= 5 && value.subarray(0, 5).toString("ascii") === "%PDF-";
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

function handleInvalidLock(mode: InvalidLockMode): undefined {
  if (mode === "throw") {
    throw new FormaError("PENCIL_LOCK_HELD", "Pencil lock is invalid", { reason: "invalid_lock" });
  }
  return undefined;
}
