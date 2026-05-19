import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { FormaError } from "./errors.js";

export interface ProductMutationContext {
  operation: string;
  product_id?: string;
  warnings: string[];
}

export interface ProductMutationLock {
  run<T>(
    input: { operation: string; product_id?: string },
    fn: (context: ProductMutationContext) => Promise<T>
  ): Promise<T>;
}

const staleThresholdMs = 120000;
const waitTimeoutMs = 30000;
const retryIntervalMs = 100;
const jitterMs = 25;
const heartbeatMs = 5000;

type QueueTail = Promise<void>;

interface ProductMutationOwner {
  owner_id: string;
  pid: number;
  operation: string;
  product_id?: string;
  acquired_at: string;
  updated_at: string;
}

type OwnerReadResult =
  | { status: "valid"; owner: ProductMutationOwner }
  | { status: "missing" }
  | { status: "corrupt" };

interface HeartbeatController {
  timer: NodeJS.Timeout;
  pending: Promise<void>;
  stopped: boolean;
}

const sameProcessQueues = new Map<string, QueueTail>();
const emittedProductMutationWarningCounts = new WeakMap<string[], number>();
const emittedFormaErrorDetailsWarningCounts = new WeakMap<Record<string, unknown>, number>();

export function getProductMutationLock(home: string): ProductMutationLock {
  return new ProductMutationLockImpl(resolve(home));
}

export function defaultProductMutationWarningSink(warning: string): void {
  process.emitWarning(warning);
}

export async function runProductMutationWithWarnings<T>(
  productMutationLock: ProductMutationLock,
  input: { operation: string; product_id?: string },
  fn: (context: ProductMutationContext) => Promise<T>,
  onProductMutationWarning: (warning: string) => void
): Promise<T> {
  let context: ProductMutationContext | undefined;
  let flushedWarnings = 0;
  const flushContextWarnings = () => {
    if (!context) {
      return;
    }
    const lockEmittedWarnings =
      onProductMutationWarning === defaultProductMutationWarningSink
        ? (emittedProductMutationWarningCounts.get(context.warnings) ?? 0)
        : 0;
    flushedWarnings = Math.max(flushedWarnings, lockEmittedWarnings);
    for (; flushedWarnings < context.warnings.length; flushedWarnings += 1) {
      onProductMutationWarning(context.warnings[flushedWarnings]!);
    }
  };

  try {
    const result = await productMutationLock.run(input, async (mutationContext) => {
      context = mutationContext;
      try {
        return await fn(mutationContext);
      } finally {
        flushContextWarnings();
      }
    });
    flushContextWarnings();
    return result;
  } catch (error) {
    flushContextWarnings();
    flushErrorWarnings(error, onProductMutationWarning);
    throw error;
  }
}

class ProductMutationLockImpl implements ProductMutationLock {
  private readonly lockDir: string;

  constructor(private readonly home: string) {
    this.lockDir = join(home, "tmp", "locks", "product-mutations.lock");
  }

  async run<T>(
    input: { operation: string; product_id?: string },
    fn: (context: ProductMutationContext) => Promise<T>
  ): Promise<T> {
    const normalized = normalizeInput(input);
    const queueTail = sameProcessQueues.get(this.home) ?? Promise.resolve();
    let releaseQueue!: () => void;
    const currentOperation = new Promise<void>((resolveCurrentOperation) => {
      releaseQueue = resolveCurrentOperation;
    });
    const queuedOperation = queueTail.catch(() => undefined).then(() => currentOperation);
    sameProcessQueues.set(this.home, queuedOperation);

    await queueTail.catch(() => undefined);
    try {
      return await this.runWithLock(normalized, fn);
    } finally {
      releaseQueue();
      if (sameProcessQueues.get(this.home) === queuedOperation) {
        sameProcessQueues.delete(this.home);
      }
    }
  }

  private async runWithLock<T>(
    input: { operation: string; product_id?: string },
    fn: (context: ProductMutationContext) => Promise<T>
  ): Promise<T> {
    const warnings: string[] = [];
    const owner = await this.acquireLock(input, warnings);
    const heartbeat = this.startHeartbeat(owner, warnings);

    try {
      return await fn({ ...input, warnings });
    } finally {
      heartbeat.stopped = true;
      clearInterval(heartbeat.timer);
      await heartbeat.pending.catch((error: unknown) => {
        this.recordWarning(`Product mutation lock heartbeat failed for ${this.lockDir}: ${errorMessage(error)}`, warnings);
      });
      await this.releaseLock(owner.owner_id, warnings);
    }
  }

  private async acquireLock(input: { operation: string; product_id?: string }, warnings: string[]): Promise<ProductMutationOwner> {
    const startedAt = Date.now();
    await mkdir(dirname(this.lockDir), { recursive: true });

    while (true) {
      try {
        await mkdir(this.lockDir);
        const owner = createOwner(input);
        try {
          await this.writeOwner(owner);
        } catch (error) {
          await this.cleanupFailedAcquisition(owner, warnings);
          throw error;
        }
        return owner;
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") {
          throw error;
        }
      }

      const recovered = await this.recoverExistingLock(warnings);
      if (recovered) {
        continue;
      }

      const waitedMs = Date.now() - startedAt;
      if (waitedMs >= waitTimeoutMs) {
        const details = {
          operation: input.operation,
          product_id: input.product_id,
          lock_path: this.lockDir,
          waited_ms: waitedMs,
          warnings: [...warnings]
        };
        emittedFormaErrorDetailsWarningCounts.set(details, warnings.length);
        throw new FormaError("PRODUCT_MUTATION_LOCKED", "Product mutation lock is held", details);
      }

      await delay(Math.min(retryDelayMs(), waitTimeoutMs - waitedMs));
    }
  }

  private async recoverExistingLock(warnings: string[]): Promise<boolean> {
    const ownerResult = await this.readOwner();

    if (ownerResult.status === "valid") {
      const owner = ownerResult.owner;
      if (!defaultIsPidAlive(owner.pid)) {
        return await this.removeLockWithMatchingOwner(
          owner,
          `Product mutation lock has dead owner PID ${owner.pid}; removing ${this.lockDir}`,
          warnings
        );
      }

      if (Date.now() - Date.parse(owner.updated_at) > staleThresholdMs) {
        return await this.removeLockWithMatchingOwner(
          owner,
          `Product mutation lock owner is stale; removing ${this.lockDir}`,
          warnings
        );
      }

      return false;
    }

    const lockStat = await stat(this.lockDir).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    });
    if (!lockStat) {
      return true;
    }

    if (Date.now() - lockStat.mtimeMs <= staleThresholdMs) {
      return false;
    }

    return await this.removeOwnerUnknownLockIfStillStale(
      lockStat.mtimeMs,
      `Product mutation lock owner.json is missing or corrupt and stale; removing ${this.lockDir}`,
      warnings
    );
  }

  private async removeLockWithMatchingOwner(
    owner: ProductMutationOwner,
    warning: string,
    warnings: string[]
  ): Promise<boolean> {
    const claimedDir = await this.claimLockDirectory();
    if (!claimedDir) {
      return true;
    }

    const current = await this.readOwner(claimedDir);
    if (current.status !== "valid" || !ownersMatch(current.owner, owner)) {
      await this.restoreClaimedLock(claimedDir, warnings);
      return false;
    }

    await rm(claimedDir, { recursive: true, force: true });
    this.recordWarning(warning, warnings);
    return true;
  }

  private async removeOwnerUnknownLockIfStillStale(
    expectedMtimeMs: number,
    warning: string,
    warnings: string[]
  ): Promise<boolean> {
    const claimedDir = await this.claimLockDirectory();
    if (!claimedDir) {
      return true;
    }

    const current = await this.readOwner(claimedDir);
    if (current.status === "valid") {
      await this.restoreClaimedLock(claimedDir, warnings);
      return false;
    }

    const currentStat = await stat(claimedDir).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    });
    if (!currentStat) {
      return true;
    }
    if (currentStat.mtimeMs !== expectedMtimeMs || Date.now() - currentStat.mtimeMs <= staleThresholdMs) {
      await this.restoreClaimedLock(claimedDir, warnings);
      return false;
    }

    await rm(claimedDir, { recursive: true, force: true });
    this.recordWarning(warning, warnings);
    return true;
  }

  private startHeartbeat(owner: ProductMutationOwner, warnings: string[]): HeartbeatController {
    const controller: HeartbeatController = {
      timer: undefined as unknown as NodeJS.Timeout,
      pending: Promise.resolve(),
      stopped: false
    };
    controller.timer = setInterval(() => {
      controller.pending = controller.pending
        .catch((error: unknown) => {
          this.recordWarning(`Product mutation lock heartbeat failed for ${this.lockDir}: ${errorMessage(error)}`, warnings);
        })
        .then(async () => {
          if (controller.stopped) {
            return;
          }
          await this.updateHeartbeat(owner, warnings, controller);
        });
    }, heartbeatMs);
    controller.timer.unref?.();
    return controller;
  }

  private async updateHeartbeat(
    owner: ProductMutationOwner,
    warnings: string[],
    heartbeat: HeartbeatController
  ): Promise<void> {
    if (heartbeat.stopped) {
      return;
    }

    const claimFile = join(this.lockDir, `.owner-${owner.owner_id}-${randomBytes(8).toString("hex")}.claim`);
    try {
      await rename(this.ownerFileFor(this.lockDir), claimFile);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        this.stopHeartbeat(heartbeat, warnings);
        return;
      }
      this.recordWarning(`Product mutation lock heartbeat failed for ${this.lockDir}: ${errorMessage(error)}`, warnings);
      return;
    }

    if (heartbeat.stopped) {
      await this.restoreClaimedOwner(claimFile, warnings);
      return;
    }

    const claimed = await this.readOwnerFile(claimFile);
    if (claimed.status !== "valid" || claimed.owner.owner_id !== owner.owner_id) {
      await this.restoreClaimedOwner(claimFile, warnings);
      this.stopHeartbeat(heartbeat, warnings);
      return;
    }

    const updatedOwner = { ...claimed.owner, updated_at: new Date().toISOString() };
    const tempFile = join(this.lockDir, `.owner-${owner.owner_id}-${randomBytes(8).toString("hex")}.tmp`);
    try {
      if (heartbeat.stopped) {
        await this.restoreClaimedOwner(claimFile, warnings);
        return;
      }
      await writeFile(tempFile, `${JSON.stringify(updatedOwner, null, 2)}\n`, "utf8");

      const stillClaimed = await this.readOwnerFile(claimFile);
      if (heartbeat.stopped) {
        await rm(tempFile, { force: true });
        await this.restoreClaimedOwner(claimFile, warnings);
        return;
      }
      if (stillClaimed.status !== "valid") {
        await rm(tempFile, { force: true });
        this.stopHeartbeat(heartbeat, warnings);
        return;
      }
      if (!ownersMatch(stillClaimed.owner, claimed.owner)) {
        await rm(tempFile, { force: true });
        await this.restoreClaimedOwner(claimFile, warnings);
        this.stopHeartbeat(heartbeat, warnings);
        return;
      }

      await rename(tempFile, this.ownerFileFor(this.lockDir));
      await rm(claimFile, { force: true });
      const mtime = new Date(updatedOwner.updated_at);
      await utimes(this.lockDir, mtime, mtime);
    } catch (error) {
      await rm(tempFile, { force: true });
      await this.restoreClaimedOwner(claimFile, warnings);
      this.recordWarning(`Product mutation lock heartbeat failed for ${this.lockDir}: ${errorMessage(error)}`, warnings);
    }
  }

  private async writeOwner(owner: ProductMutationOwner, lockDir = this.lockDir): Promise<void> {
    const tempFile = join(lockDir, `.owner-${owner.owner_id}-${randomBytes(8).toString("hex")}.tmp`);
    try {
      await writeFile(tempFile, `${JSON.stringify(owner, null, 2)}\n`, "utf8");
      await rename(tempFile, this.ownerFileFor(lockDir));
      const mtime = new Date(owner.updated_at);
      await utimes(lockDir, mtime, mtime);
    } catch (error) {
      await rm(tempFile, { force: true });
      throw error;
    }
  }

  private async readOwner(lockDir = this.lockDir): Promise<OwnerReadResult> {
    return await this.readOwnerFile(this.ownerFileFor(lockDir));
  }

  private async readOwnerFile(ownerFile: string): Promise<OwnerReadResult> {
    let raw: string;
    try {
      raw = await readFile(ownerFile, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { status: "missing" };
      }
      return { status: "corrupt" };
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isProductMutationOwner(parsed)) {
        return { status: "corrupt" };
      }
      return { status: "valid", owner: parsed };
    } catch {
      return { status: "corrupt" };
    }
  }

  private async releaseLock(ownerId: string, warnings: string[]): Promise<void> {
    const claimedDir = await this.claimLockDirectory();
    if (!claimedDir) {
      return;
    }

    const current = await this.readOwner(claimedDir);
    if (current.status === "valid" && current.owner.owner_id === ownerId) {
      await rm(claimedDir, { recursive: true, force: true });
      return;
    }

    await this.restoreClaimedLock(claimedDir, warnings);
  }

  private async cleanupFailedAcquisition(owner: ProductMutationOwner, warnings: string[]): Promise<void> {
    const claimedDir = await this.claimLockDirectory();
    if (!claimedDir) {
      return;
    }

    const current = await this.readOwner(claimedDir);
    if (current.status === "valid" && current.owner.owner_id !== owner.owner_id) {
      await this.restoreClaimedLock(claimedDir, warnings);
      return;
    }

    await rm(claimedDir, { recursive: true, force: true });
  }

  private recordWarning(warning: string, warnings: string[]): void {
    warnings.push(warning);
    defaultProductMutationWarningSink(warning);
    emittedProductMutationWarningCounts.set(warnings, warnings.length);
  }

  private stopHeartbeat(heartbeat: HeartbeatController, warnings: string[]): void {
    heartbeat.stopped = true;
    clearInterval(heartbeat.timer);
    this.recordWarning(`Product mutation lock owner changed; stopping heartbeat for ${this.lockDir}`, warnings);
  }

  private ownerFileFor(lockDir: string): string {
    return join(lockDir, "owner.json");
  }

  private async restoreClaimedOwner(claimFile: string, warnings: string[]): Promise<void> {
    let claimedOwner: string;
    try {
      claimedOwner = await readFile(claimFile, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    try {
      await writeFile(this.ownerFileFor(this.lockDir), claimedOwner, { encoding: "utf8", flag: "wx" });
      await rm(claimFile, { force: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        this.recordWarning(
          `Product mutation lock owner changed while restoring ${claimFile}; preserving ${this.lockDir}`,
          warnings
        );
        await rm(claimFile, { force: true });
        return;
      }
      if (isNodeError(error) && error.code === "ENOENT") {
        await rm(claimFile, { force: true });
        return;
      }
      throw error;
    }
  }

  private async claimLockDirectory(): Promise<string | undefined> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const claimedDir = join(
        dirname(this.lockDir),
        `.product-mutations.lock.${process.pid}.${randomBytes(8).toString("hex")}.removing`
      );
      try {
        await rename(this.lockDir, claimedDir);
        return claimedDir;
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          return undefined;
        }
        if (isNodeError(error) && error.code === "EEXIST") {
          continue;
        }
        throw error;
      }
    }

    throw new FormaError("PRODUCT_MUTATION_LOCKED", "Product mutation lock cleanup path is unavailable", {
      lock_path: this.lockDir
    });
  }

  private async restoreClaimedLock(claimedDir: string, warnings: string[]): Promise<void> {
    try {
      await mkdir(this.lockDir);
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        this.recordWarning(
          `Product mutation lock path was reused while restoring ${claimedDir}; preserving ${this.lockDir}`,
          warnings
        );
        await rm(claimedDir, { recursive: true, force: true });
        return;
      }
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    const entries = await readdir(claimedDir).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    });

    try {
      for (const entry of entries) {
        await rename(join(claimedDir, entry), join(this.lockDir, entry));
      }
      await rm(claimedDir, { recursive: true, force: true });
    } catch (error) {
      this.recordWarning(
        `Product mutation lock restore failed for ${claimedDir}: ${errorMessage(error)}`,
        warnings
      );
      throw error;
    }
  }
}

function normalizeInput(input: { operation: string; product_id?: string }): { operation: string; product_id?: string } {
  if (!input || typeof input.operation !== "string" || input.operation.trim().length === 0) {
    throw new FormaError("INVALID_INPUT", "Product mutation operation is required", { operation: input?.operation });
  }
  if (input.product_id !== undefined && (typeof input.product_id !== "string" || input.product_id.trim().length === 0)) {
    throw new FormaError("INVALID_INPUT", "Product mutation product_id must be a non-empty string", {
      product_id: input.product_id
    });
  }
  return input.product_id === undefined
    ? { operation: input.operation }
    : { operation: input.operation, product_id: input.product_id };
}

function createOwner(input: { operation: string; product_id?: string }): ProductMutationOwner {
  const now = new Date().toISOString();
  return {
    owner_id: randomBytes(16).toString("hex"),
    pid: process.pid,
    operation: input.operation,
    product_id: input.product_id,
    acquired_at: now,
    updated_at: now
  };
}

function retryDelayMs(): number {
  return retryIntervalMs + Math.floor(Math.random() * (jitterMs + 1));
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isProductMutationOwner(value: unknown): value is ProductMutationOwner {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.owner_id === "string" &&
    typeof value.pid === "number" &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.operation === "string" &&
    (value.product_id === undefined || typeof value.product_id === "string") &&
    typeof value.acquired_at === "string" &&
    Number.isFinite(Date.parse(value.acquired_at)) &&
    typeof value.updated_at === "string" &&
    Number.isFinite(Date.parse(value.updated_at))
  );
}

function ownersMatch(a: ProductMutationOwner, b: ProductMutationOwner): boolean {
  return (
    a.owner_id === b.owner_id &&
    a.pid === b.pid &&
    a.operation === b.operation &&
    a.product_id === b.product_id &&
    a.acquired_at === b.acquired_at &&
    a.updated_at === b.updated_at
  );
}

function flushErrorWarnings(error: unknown, onProductMutationWarning: (warning: string) => void): void {
  if (!isRecord(error) || !isRecord(error.details)) {
    return;
  }
  const warnings = error.details.warnings;
  if (!Array.isArray(warnings) || !warnings.every((warning) => typeof warning === "string")) {
    return;
  }
  const emittedWarnings =
    onProductMutationWarning === defaultProductMutationWarningSink
      ? (emittedFormaErrorDetailsWarningCounts.get(error.details) ?? 0)
      : 0;
  for (let index = emittedWarnings; index < warnings.length; index += 1) {
    onProductMutationWarning(warnings[index]!);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
