import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { FormaError } from "./errors.js";
import { productIdSchema } from "./product.js";
import { sessionIdSchema } from "./session-id.js";

export const PRODUCT_MUTATION_LOCK_TTL_MS = 120_000;
export const PRODUCT_MUTATION_LOCK_HEARTBEAT_MS = 15_000;

export interface ProductMutationContext {
  operation: string;
  product_id?: string;
  warnings: string[];
}

export interface ProductMutationLock {
  run<T>(
    input: { operation: string; product_id?: string; session_id?: string; scope?: string },
    fn: (context: ProductMutationContext) => Promise<T>,
  ): Promise<T>;
}

export interface V6LockContent {
  lock_id: string;
  owner_pid: number;
  owner_process_start_time: string;
  hostname: string;
  command: string;
  scope: string;
  product_id?: string;
  session_id?: string;
  acquired_at: string;
  expires_at: string;
  heartbeat_at: string;
}

const lockSchema = z.object({
  lock_id: z.string().min(1),
  owner_pid: z.number().int().positive(),
  owner_process_start_time: z.string().min(1),
  hostname: z.string().min(1),
  command: z.string().min(1),
  scope: z.string().min(1),
  product_id: z.string().optional(),
  session_id: z.string().optional(),
  acquired_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  expires_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  heartbeat_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
});

const sameProcessQueues = new Map<string, Promise<void>>();
const sameProcessProductQueueKeys = new Set<string>();
const emittedProductMutationWarningCounts = new WeakMap<string[], number>();
const emittedFormaErrorDetailsWarningCounts = new WeakMap<Record<string, unknown>, number>();

interface HeartbeatController {
  stop(): Promise<void>;
}

type ClaimedLock = { status: "valid"; lock: V6LockContent } | { status: "corrupt" };

interface ClaimedLockMutation {
  remove(): Promise<void>;
  replace(lock: V6LockContent): Promise<boolean>;
  restore(): Promise<void>;
}

interface MutationSidecar {
  release(): Promise<void>;
}

interface MutationSidecarContent {
  lock_id: string;
  owner_pid: number;
  owner_process_start_time: string;
  hostname: string;
  acquired_at: string;
  expires_at: string;
}

type MutationSidecarRead = { status: "valid"; lock: MutationSidecarContent } | { status: "corrupt" };

const mutationSidecarSchema = z.object({
  lock_id: z.string().min(1),
  owner_pid: z.number().int().positive(),
  owner_process_start_time: z.string().min(1),
  hostname: z.string().min(1),
  acquired_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  expires_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
});

export function getProductMutationLock(home: string): ProductMutationLock {
  return new ProductMutationLockImpl(resolve(home), "product");
}

export function productMutationLockPath(home: string, productId?: string): string {
  const resolvedHome = resolve(home);
  const lockPath = productId
    ? join(resolvedHome, "data", parseProductId(productId), "locks", "product-mutation.lock")
    : join(resolvedHome, "locks", "product-mutation.lock");
  return assertInsideHome(resolvedHome, lockPath);
}

export function defaultProductMutationWarningSink(warning: string): void {
  process.emitWarning(warning);
}

export async function runProductMutationWithWarnings<T>(
  productMutationLock: ProductMutationLock,
  input: { operation: string; product_id?: string; session_id?: string; scope?: string },
  fn: (context: ProductMutationContext) => Promise<T>,
  onProductMutationWarning: (warning: string) => void,
): Promise<T> {
  let context: ProductMutationContext | undefined;
  let flushedWarnings = 0;
  const flushContextWarnings = () => {
    if (!context) return;
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
  constructor(
    private readonly home: string,
    private readonly kind: "product" = "product",
  ) {}

  async run<T>(
    input: { operation: string; product_id?: string; session_id?: string; scope?: string },
    fn: (context: ProductMutationContext) => Promise<T>,
  ): Promise<T> {
    const normalized = normalizeInput(input);
    const lockPath = productMutationLockPath(this.home, normalized.product_id);
    const globalQueueKey = productMutationLockPath(this.home);
    const queueKey = lockPath;
    const isProductScoped = Boolean(normalized.product_id);
    if (isProductScoped) {
      sameProcessProductQueueKeys.add(queueKey);
    }
    const hierarchyQueues = !normalized.product_id
      ? [...sameProcessProductQueueKeys].map((key) => sameProcessQueues.get(key) ?? Promise.resolve())
      : [];
    const queueTail =
      normalized.product_id && globalQueueKey
        ? Promise.all([
            sameProcessQueues.get(globalQueueKey) ?? Promise.resolve(),
            sameProcessQueues.get(queueKey) ?? Promise.resolve(),
          ]).then(() => undefined)
        : !normalized.product_id
          ? Promise.all([sameProcessQueues.get(queueKey) ?? Promise.resolve(), ...hierarchyQueues]).then(
              () => undefined,
            )
          : (sameProcessQueues.get(queueKey) ?? Promise.resolve());
    let releaseQueue!: () => void;
    const currentOperation = new Promise<void>((resolveCurrentOperation) => {
      releaseQueue = resolveCurrentOperation;
    });
    const queuedOperation = queueTail.catch(() => undefined).then(() => currentOperation);
    sameProcessQueues.set(queueKey, queuedOperation);
    await queueTail.catch(() => undefined);

    const warnings: string[] = [];
    let lock: V6LockContent | undefined;
    let heartbeat: HeartbeatController | undefined;
    try {
      try {
        lock = await this.acquireLock(lockPath, normalized, warnings);
        heartbeat = this.startHeartbeat(lockPath, lock, warnings);
        return await fn({ operation: normalized.operation, product_id: normalized.product_id, warnings });
      } finally {
        if (heartbeat) await heartbeat.stop();
        if (lock) await this.releaseLock(lockPath, lock.lock_id, warnings);
      }
    } finally {
      releaseQueue();
      if (sameProcessQueues.get(queueKey) === queuedOperation) {
        sameProcessQueues.delete(queueKey);
      }
      if (isProductScoped && sameProcessQueues.get(queueKey) === undefined) {
        sameProcessProductQueueKeys.delete(queueKey);
      }
    }
  }

  private async acquireLock(
    lockPath: string,
    input: { operation: string; product_id?: string; session_id?: string; scope?: string },
    warnings: string[],
  ): Promise<V6LockContent> {
    await mkdir(dirname(lockPath), { recursive: true });
    return await this.withMutationSidecar(lockPath, async () => {
      await this.assertNoClaimedLock(lockPath);
      if (input.product_id) {
        await this.assertNoLiveGlobalProductLock(lockPath, warnings);
      }
      const existing = await this.readExisting(lockPath);
      if (existing) {
        if (existing.status === "corrupt") {
          throw new FormaError("LOCK_CORRUPT", "Lock file is corrupt", { lock_path: lockPath });
        }
        const owner = existing.lock;
        if (isLockLive(owner)) {
          const details = {
            lock_path: lockPath,
            owner_pid: owner.owner_pid,
            scope: owner.scope,
            session_id: owner.session_id,
            acquired_at: owner.acquired_at,
            expires_at: owner.expires_at,
            heartbeat_at: owner.heartbeat_at,
          };
          emittedFormaErrorDetailsWarningCounts.set(details, warnings.length);
          throw new FormaError("PRODUCT_MUTATION_LOCKED", "Mutation lock is held", details);
        }
        await this.removeStaleLockUnderMutation(lockPath, owner, warnings);
      }

      const lock = createLock(input);
      try {
        await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
          throw new FormaError("PRODUCT_MUTATION_LOCKED", "Mutation lock is held", { lock_path: lockPath });
        }
        throw error;
      }
      if (input.product_id) {
        try {
          await this.assertNoLiveGlobalProductLock(lockPath, warnings);
        } catch (error) {
          await this.removeLockByIdUnderMutation(lockPath, lock.lock_id, warnings);
          throw error;
        }
      }
      if (!input.product_id) {
        try {
          await this.assertNoLiveProductLocks(lockPath, warnings);
        } catch (error) {
          await this.removeLockByIdUnderMutation(lockPath, lock.lock_id, warnings);
          throw error;
        }
      }
      return lock;
    });
  }

  private async assertNoLiveGlobalProductLock(currentLockPath: string, warnings: string[]): Promise<void> {
    const globalLockPath = productMutationLockPath(this.home);
    if (globalLockPath === currentLockPath) return;
    await this.assertNoLiveLockAt(globalLockPath, warnings);
  }

  private async assertNoLiveProductLocks(currentLockPath: string, warnings: string[]): Promise<void> {
    const dataDir = join(this.home, "data");
    for (const productId of await readdir(dataDir).catch(() => [])) {
      const parsed = productIdSchema.safeParse(productId);
      if (!parsed.success) continue;
      const lockPath = productMutationLockPath(this.home, parsed.data);
      if (lockPath === currentLockPath) continue;
      await this.assertNoLiveLockAt(lockPath, warnings);
    }
  }

  private async assertNoLiveLockAt(lockPath: string, warnings: string[]): Promise<void> {
    await mkdir(dirname(lockPath), { recursive: true });
    await this.withMutationSidecar(lockPath, async () => {
      await this.assertNoClaimedLock(lockPath);
      const existing = await this.readExisting(lockPath);
      if (!existing) return;
      if (existing.status === "corrupt") {
        throw new FormaError("LOCK_CORRUPT", "Lock file is corrupt", { lock_path: lockPath });
      }
      if (isLockLive(existing.lock)) {
        const details = {
          lock_path: lockPath,
          owner_pid: existing.lock.owner_pid,
          scope: existing.lock.scope,
          session_id: existing.lock.session_id,
          acquired_at: existing.lock.acquired_at,
          expires_at: existing.lock.expires_at,
          heartbeat_at: existing.lock.heartbeat_at,
        };
        emittedFormaErrorDetailsWarningCounts.set(details, warnings.length);
        throw new FormaError("PRODUCT_MUTATION_LOCKED", "Mutation lock is held", details);
      }
      await this.removeStaleLockUnderMutation(lockPath, existing.lock, warnings);
    });
  }

  private async removeStaleLockUnderMutation(
    lockPath: string,
    expected: V6LockContent,
    warnings: string[],
  ): Promise<void> {
    await this.withClaimedLockUnderMutation(lockPath, warnings, async (latest, claim) => {
      if (!latest) return;
      if (latest.status === "corrupt") {
        throw new FormaError("LOCK_CORRUPT", "Lock file is corrupt", { lock_path: lockPath });
      }
      if (latest.lock.lock_id !== expected.lock_id || isLockLive(latest.lock)) {
        const details = {
          lock_path: lockPath,
          owner_pid: latest.lock.owner_pid,
          scope: latest.lock.scope,
          session_id: latest.lock.session_id,
          acquired_at: latest.lock.acquired_at,
          expires_at: latest.lock.expires_at,
          heartbeat_at: latest.lock.heartbeat_at,
        };
        emittedFormaErrorDetailsWarningCounts.set(details, warnings.length);
        throw new FormaError("PRODUCT_MUTATION_LOCKED", "Mutation lock changed during stale reclaim", details);
      }
      await claim.remove();
      recordWarning(`stale_reclaimed:${lockPath}`, warnings);
    });
  }

  private async removeLockByIdUnderMutation(lockPath: string, lockId: string, warnings: string[]): Promise<void> {
    await this.withClaimedLockUnderMutation(lockPath, warnings, async (existing, claim) => {
      if (!existing) return;
      if (existing.status === "valid" && existing.lock.lock_id === lockId) {
        await claim.remove();
        return;
      }
      await claim.restore();
      recordWarning(`LOCK_RELEASE_MISMATCH:${lockPath}`, warnings);
    });
  }

  private startHeartbeat(lockPath: string, lock: V6LockContent, warnings: string[]): HeartbeatController {
    const inFlight = new Set<Promise<void>>();
    let stopped = false;
    const runHeartbeat = () => {
      if (stopped) return;
      const pending = this.heartbeat(lockPath, lock, warnings, () => stopped).catch((error: unknown) => {
        recordWarning(`lock_heartbeat_failed:${lockPath}:${errorMessage(error)}`, warnings);
      });
      inFlight.add(pending);
      pending.finally(() => inFlight.delete(pending));
    };
    const timer = setInterval(() => {
      runHeartbeat();
    }, PRODUCT_MUTATION_LOCK_HEARTBEAT_MS);
    return {
      async stop() {
        stopped = true;
        clearInterval(timer);
        await Promise.allSettled([...inFlight]);
      },
    };
  }

  private async heartbeat(
    lockPath: string,
    lock: V6LockContent,
    warnings: string[],
    isStopped: () => boolean,
  ): Promise<void> {
    if (isStopped()) return;
    await this.withClaimedLock(lockPath, warnings, async (existing, claim) => {
      if (isStopped()) {
        await claim.restore();
        return;
      }
      if (!existing || existing.status === "corrupt" || existing.lock.lock_id !== lock.lock_id) {
        await claim.restore();
        recordWarning(`LOCK_RELEASE_MISMATCH:${lockPath}`, warnings);
        return;
      }
      const now = new Date();
      const updated = {
        ...existing.lock,
        heartbeat_at: now.toISOString(),
        expires_at: new Date(now.getTime() + PRODUCT_MUTATION_LOCK_TTL_MS).toISOString(),
      };
      if (isStopped()) {
        await claim.restore();
        return;
      }
      await claim.replace(updated);
    });
  }

  private async releaseLock(lockPath: string, lockId: string, warnings: string[]): Promise<void> {
    try {
      await this.withClaimedLock(lockPath, warnings, async (existing, claim) => {
        if (!existing) return;
        if (existing.status === "valid" && existing.lock.lock_id === lockId) {
          await claim.remove();
          return;
        }
        await claim.restore();
        recordWarning(`LOCK_RELEASE_MISMATCH:${lockPath}`, warnings);
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }

  private async withClaimedLock<T>(
    lockPath: string,
    warnings: string[],
    mutate: (existing: ClaimedLock | undefined, claim: ClaimedLockMutation) => Promise<T>,
  ): Promise<T> {
    const sidecar = await this.acquireMutationSidecar(lockPath);
    try {
      return await this.withClaimedLockUnderMutation(lockPath, warnings, mutate);
    } finally {
      await sidecar.release();
    }
  }

  private async withMutationSidecar<T>(lockPath: string, mutate: () => Promise<T>): Promise<T> {
    const sidecar = await this.acquireMutationSidecar(lockPath);
    try {
      return await mutate();
    } finally {
      await sidecar.release();
    }
  }

  private async acquireMutationSidecar(lockPath: string): Promise<MutationSidecar> {
    const mutationLockPath = `${lockPath}.mutate`;
    const mutationLock = createMutationSidecar();
    while (true) {
      try {
        await writeFile(mutationLockPath, `${JSON.stringify(mutationLock, null, 2)}\n`, {
          encoding: "utf8",
          flag: "wx",
        });
        return {
          release: () => this.releaseMutationSidecar(lockPath, mutationLock),
        };
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
          throw error;
        }
      }

      const existing = await this.readMutationSidecar(mutationLockPath);
      if (existing && !isMutationSidecarReclaimable(existing)) {
        throw new FormaError("PRODUCT_MUTATION_LOCKED", "Lock mutation is already in progress", {
          lock_path: lockPath,
        });
      }
      const reclaimed = await this.reclaimMutationSidecar(lockPath, existing);
      if (!reclaimed) {
        throw new FormaError("PRODUCT_MUTATION_LOCKED", "Lock mutation is already in progress", {
          lock_path: lockPath,
        });
      }
    }
  }

  private async readMutationSidecar(mutationLockPath: string): Promise<MutationSidecarRead | undefined> {
    let raw: string;
    try {
      raw = await readFile(mutationLockPath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      return { status: "corrupt" };
    }
    try {
      return { status: "valid", lock: mutationSidecarSchema.parse(JSON.parse(raw)) };
    } catch {
      return { status: "corrupt" };
    }
  }

  private async reclaimMutationSidecar(lockPath: string, expected: MutationSidecarRead | undefined): Promise<boolean> {
    const mutationLockPath = `${lockPath}.mutate`;
    const claimPath = `${mutationLockPath}.${randomBytes(8).toString("hex")}.claim`;
    try {
      await rename(mutationLockPath, claimPath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return true;
      throw error;
    }

    const claimed = await this.readMutationSidecar(claimPath);
    if (sameMutationSidecar(expected, claimed) && isMutationSidecarReclaimable(claimed)) {
      await rm(claimPath, { force: true });
      return true;
    }

    await this.restoreClaimFile(claimPath, mutationLockPath, { removeOnExisting: false });
    return false;
  }

  private async releaseMutationSidecar(lockPath: string, expected: MutationSidecarContent): Promise<void> {
    const mutationLockPath = `${lockPath}.mutate`;
    const claimPath = `${mutationLockPath}.${randomBytes(8).toString("hex")}.claim`;
    try {
      await rename(mutationLockPath, claimPath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }

    const claimed = await this.readMutationSidecar(claimPath);
    if (claimed?.status === "valid" && claimed.lock.lock_id === expected.lock_id) {
      await rm(claimPath, { force: true });
      return;
    }
    await this.restoreClaimFile(claimPath, mutationLockPath, { removeOnExisting: false });
  }

  private async restoreClaimFile(
    claimPath: string,
    targetPath: string,
    options?: { removeOnExisting?: boolean },
  ): Promise<void> {
    try {
      await copyFile(claimPath, targetPath, constants.COPYFILE_EXCL);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
      if (options?.removeOnExisting === false) {
        throw error;
      }
    }
    await rm(claimPath, { force: true });
  }

  private async assertNoClaimedLock(lockPath: string): Promise<void> {
    const lockDir = dirname(lockPath);
    const prefix = `${basename(lockPath)}.`;
    const claims = (await readdir(lockDir).catch(() => [])).filter(
      (file) => file.startsWith(prefix) && file.endsWith(".claim"),
    );
    if (claims.length === 0) return;
    throw new FormaError("PRODUCT_MUTATION_LOCKED", "Lock mutation claim is in progress", {
      lock_path: lockPath,
      claim_path: join(lockDir, claims[0]!),
    });
  }

  private async withClaimedLockUnderMutation<T>(
    lockPath: string,
    warnings: string[],
    mutate: (existing: ClaimedLock | undefined, claim: ClaimedLockMutation) => Promise<T>,
  ): Promise<T> {
    const claimPath = `${lockPath}.${randomBytes(8).toString("hex")}.claim`;
    let claimActive = false;
    const restore = async () => {
      if (!claimActive) return;
      try {
        await copyFile(claimPath, lockPath, constants.COPYFILE_EXCL);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
          recordWarning(`LOCK_RELEASE_MISMATCH:${lockPath}`, warnings);
          await rm(claimPath, { force: true });
          claimActive = false;
          return;
        } else {
          throw error;
        }
      }
      await rm(claimPath, { force: true });
      claimActive = false;
    };
    const claim: ClaimedLockMutation = {
      async remove() {
        if (!claimActive) return;
        try {
          await readFile(lockPath, "utf8");
          recordWarning(`LOCK_RELEASE_MISMATCH:${lockPath}`, warnings);
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
            throw error;
          }
        }
        await rm(claimPath, { force: true });
        claimActive = false;
      },
      async replace(lock) {
        if (!claimActive) return false;
        await writeFile(claimPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
        try {
          await copyFile(claimPath, lockPath, constants.COPYFILE_EXCL);
          await rm(claimPath, { force: true });
          claimActive = false;
          return true;
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "EEXIST") {
            recordWarning(`LOCK_RELEASE_MISMATCH:${lockPath}`, warnings);
            await rm(claimPath, { force: true });
            claimActive = false;
            return false;
          }
          throw error;
        }
      },
      restore,
    };

    try {
      try {
        await rename(lockPath, claimPath);
        claimActive = true;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return await mutate(undefined, claim);
        }
        throw error;
      }
      let existing: ClaimedLock;
      try {
        existing = { status: "valid", lock: lockSchema.parse(JSON.parse(await readFile(claimPath, "utf8"))) };
      } catch {
        existing = { status: "corrupt" };
      }
      return await mutate(existing, claim);
    } finally {
      if (claimActive) {
        await restore();
      }
    }
  }

  private async readExisting(
    lockPath: string,
  ): Promise<{ status: "valid"; lock: V6LockContent } | { status: "corrupt" } | undefined> {
    let raw: string;
    try {
      raw = await readFile(lockPath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      return { status: "corrupt" };
    }
    try {
      return { status: "valid", lock: lockSchema.parse(JSON.parse(raw)) };
    } catch {
      return { status: "corrupt" };
    }
  }
}

function createLock(input: {
  operation: string;
  product_id?: string;
  session_id?: string;
  scope?: string;
}): V6LockContent {
  const now = new Date();
  return {
    lock_id: `L-${randomBytes(8).toString("hex")}`,
    owner_pid: process.pid,
    owner_process_start_time: processStartTime(),
    hostname: hostname(),
    command: input.operation,
    scope: input.scope ?? input.operation,
    ...(input.product_id ? { product_id: input.product_id } : {}),
    ...(input.session_id ? { session_id: input.session_id } : {}),
    acquired_at: now.toISOString(),
    expires_at: new Date(now.getTime() + PRODUCT_MUTATION_LOCK_TTL_MS).toISOString(),
    heartbeat_at: now.toISOString(),
  };
}

function createMutationSidecar(): MutationSidecarContent {
  const now = new Date();
  return {
    lock_id: `M-${randomBytes(8).toString("hex")}`,
    owner_pid: process.pid,
    owner_process_start_time: processStartTime(),
    hostname: hostname(),
    acquired_at: now.toISOString(),
    expires_at: new Date(now.getTime() + PRODUCT_MUTATION_LOCK_TTL_MS).toISOString(),
  };
}

function isMutationSidecarReclaimable(sidecar: MutationSidecarRead | undefined): boolean {
  if (!sidecar || sidecar.status === "corrupt") return true;
  return Date.parse(sidecar.lock.expires_at) <= Date.now() || !isPidAlive(sidecar.lock.owner_pid);
}

function sameMutationSidecar(
  expected: MutationSidecarRead | undefined,
  actual: MutationSidecarRead | undefined,
): boolean {
  if (!expected) return !actual;
  if (!actual) return false;
  if (expected.status === "corrupt" || actual.status === "corrupt") {
    return expected.status === actual.status;
  }
  return expected.lock.lock_id === actual.lock.lock_id;
}

function normalizeInput(input: { operation: string; product_id?: string; session_id?: string; scope?: string }): {
  operation: string;
  product_id?: string;
  session_id?: string;
  scope?: string;
} {
  if (!input || typeof input.operation !== "string" || input.operation.trim().length === 0) {
    throw new FormaError("INVALID_INPUT", "Product mutation operation is required", { operation: input?.operation });
  }
  if (input.product_id !== undefined) {
    return {
      ...input,
      product_id: parseProductId(input.product_id),
      ...(input.session_id !== undefined ? { session_id: parseSessionId(input.session_id) } : {}),
    };
  }
  if (input.session_id !== undefined) {
    return { ...input, session_id: parseSessionId(input.session_id) };
  }
  return input;
}

function parseProductId(productId: string): string {
  const parsed = productIdSchema.safeParse(productId);
  if (!parsed.success) {
    throw new FormaError("INVALID_INPUT", "Product mutation product_id is invalid", { product_id: productId });
  }
  return parsed.data;
}

function parseSessionId(sessionId: string): string {
  const parsed = sessionIdSchema.safeParse(sessionId);
  if (!parsed.success) {
    throw new FormaError("INVALID_INPUT", "Product mutation session_id is invalid", { session_id: sessionId });
  }
  return parsed.data;
}

function assertInsideHome(home: string, file: string): string {
  const resolved = resolve(file);
  if (resolved !== home && !resolved.startsWith(`${home}${sep}`)) {
    throw new FormaError("INVALID_INPUT", "Lock path escapes Forma home", { home, path: file });
  }
  return resolved;
}

function isLockLive(lock: V6LockContent): boolean {
  return Date.parse(lock.expires_at) > Date.now() && isPidAlive(lock.owner_pid);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function processStartTime(): string {
  return new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();
}

function recordWarning(warning: string, warnings: string[]): void {
  warnings.push(warning);
  defaultProductMutationWarningSink(warning);
  emittedProductMutationWarningCounts.set(warnings, warnings.length);
}

function flushErrorWarnings(error: unknown, onProductMutationWarning: (warning: string) => void): void {
  if (!(error instanceof FormaError)) return;
  const details = error.details;
  const warnings = Array.isArray(details.warnings)
    ? details.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  const alreadyEmitted = emittedFormaErrorDetailsWarningCounts.get(details) ?? 0;
  for (const warning of warnings.slice(alreadyEmitted)) {
    onProductMutationWarning(warning);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
