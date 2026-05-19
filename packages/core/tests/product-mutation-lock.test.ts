import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultProductMutationWarningSink,
  FormaError,
  getProductMutationLock,
  type ProductMutationContext
} from "../src/index.js";

type FsPromises = typeof import("node:fs/promises");
type ProductMutationLockModule = typeof import("../src/product-mutation-lock.js");

const staleThresholdMs = 120_000;
const waitTimeoutMs = 30_000;
const heartbeatMs = 5_000;
const testNow = new Date("2026-05-19T00:00:00.000Z");

const tempRoots: string[] = [];

function lockPath(home: string): string {
  return join(home, "tmp", "locks", "product-mutations.lock");
}

function ownerPath(home: string): string {
  return join(lockPath(home), "owner.json");
}

async function createHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "forma-product-lock-"));
  tempRoots.push(home);
  return home;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function readOwner(home: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(ownerPath(home), "utf8")) as Record<string, unknown>;
}

async function waitForOwner(home: string): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await readOwner(home);
    } catch (error) {
      lastError = error;
      await vi.advanceTimersByTimeAsync(1);
    }
  }
  throw lastError;
}

async function waitForWarnings(context: ProductMutationContext | undefined): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((context?.warnings.length ?? 0) > 0) {
      return;
    }
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
  }
  throw new Error("Timed out waiting for product mutation lock warning");
}

async function writeOwner(home: string, owner: Record<string, unknown>): Promise<void> {
  await mkdir(lockPath(home), { recursive: true });
  await writeFile(ownerPath(home), JSON.stringify(owner, null, 2), "utf8");
}

async function importLockWithReusedPathRace(
  home: string,
  replacementOwner: Record<string, unknown>
): Promise<ProductMutationLockModule> {
  const actual = await vi.importActual<FsPromises>("node:fs/promises");
  vi.resetModules();
  let injected = false;

  async function replaceLockPath(): Promise<void> {
    if (injected) {
      return;
    }
    injected = true;
    await actual.rm(lockPath(home), { recursive: true, force: true });
    await actual.mkdir(lockPath(home), { recursive: true });
    await actual.writeFile(ownerPath(home), JSON.stringify(replacementOwner, null, 2), "utf8");
  }

  vi.doMock("node:fs/promises", () => ({
    ...actual,
    rename: vi.fn(async (oldPath: Parameters<FsPromises["rename"]>[0], newPath: Parameters<FsPromises["rename"]>[1]) => {
      if (oldPath === lockPath(home)) {
        await replaceLockPath();
      }
      return await actual.rename(oldPath, newPath);
    }),
    rm: vi.fn(async (path: Parameters<FsPromises["rm"]>[0], options?: Parameters<FsPromises["rm"]>[1]) => {
      if (path === lockPath(home)) {
        await replaceLockPath();
      }
      return await actual.rm(path, options);
    })
  }));

  return await import("../src/product-mutation-lock.js");
}

async function importLockWithHeartbeatWriteRace(
  home: string,
  replacementOwner: Record<string, unknown>
): Promise<{ module: ProductMutationLockModule; armRace: () => void; raceInjected: Promise<void> }> {
  const actual = await vi.importActual<FsPromises>("node:fs/promises");
  vi.resetModules();
  let armed = false;
  let injected = false;
  const raceInjected = deferred();

  async function replaceLockPath(): Promise<void> {
    if (injected) {
      return;
    }
    injected = true;
    await actual.rm(lockPath(home), { recursive: true, force: true });
    await actual.mkdir(lockPath(home), { recursive: true });
    await actual.writeFile(ownerPath(home), JSON.stringify(replacementOwner, null, 2), "utf8");
    raceInjected.resolve();
  }

  vi.doMock("node:fs/promises", () => ({
    ...actual,
    writeFile: vi.fn(
      async (
        file: Parameters<FsPromises["writeFile"]>[0],
        data: Parameters<FsPromises["writeFile"]>[1],
        options?: Parameters<FsPromises["writeFile"]>[2]
      ) => {
        if (armed && typeof file === "string" && dirname(file) === lockPath(home) && file.endsWith(".tmp")) {
          await replaceLockPath();
        }
        return await actual.writeFile(file, data, options);
      }
    )
  }));

  return {
    module: await import("../src/product-mutation-lock.js"),
    raceInjected: raceInjected.promise,
    armRace() {
      armed = true;
    }
  };
}

async function importLockWithPausedHeartbeatClaim(
  home: string
): Promise<{ module: ProductMutationLockModule; claimReached: Promise<void>; resumeClaim: () => void }> {
  const actual = await vi.importActual<FsPromises>("node:fs/promises");
  vi.resetModules();
  const claimReached = deferred();
  const resume = deferred();
  let paused = false;

  vi.doMock("node:fs/promises", () => ({
    ...actual,
    rename: vi.fn(async (oldPath: Parameters<FsPromises["rename"]>[0], newPath: Parameters<FsPromises["rename"]>[1]) => {
      if (!paused && oldPath === ownerPath(home) && typeof newPath === "string" && newPath.endsWith(".claim")) {
        paused = true;
        await actual.rename(oldPath, newPath);
        claimReached.resolve();
        await resume.promise;
        return;
      }
      return await actual.rename(oldPath, newPath);
    })
  }));

  return {
    module: await import("../src/product-mutation-lock.js"),
    claimReached: claimReached.promise,
    resumeClaim: resume.resolve
  };
}

async function importLockWithRestoreLockEmptyTargetRace(
  home: string
): Promise<{ module: ProductMutationLockModule; targetCreated: Promise<void> }> {
  const actual = await vi.importActual<FsPromises>("node:fs/promises");
  vi.resetModules();
  const targetCreated = deferred();
  let injected = false;

  vi.doMock("node:fs/promises", () => ({
    ...actual,
    readFile: vi.fn(async (file: Parameters<FsPromises["readFile"]>[0], options?: Parameters<FsPromises["readFile"]>[1]) => {
      const result = await actual.readFile(file, options);
      if (!injected && typeof file === "string" && file.includes(".removing") && file.endsWith("owner.json")) {
        injected = true;
        await actual.mkdir(lockPath(home));
        targetCreated.resolve();
      }
      return result;
    })
  }));

  return {
    module: await import("../src/product-mutation-lock.js"),
    targetCreated: targetCreated.promise
  };
}

async function setLockDirectoryMtime(home: string, mtime: Date): Promise<void> {
  await utimes(lockPath(home), mtime, mtime);
}

function liveOwner(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    owner_id: "owner-live",
    pid: process.pid,
    operation: "existing-operation",
    product_id: "P-existing",
    acquired_at: testNow.toISOString(),
    updated_at: testNow.toISOString(),
    ...overrides
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ProductMutationLock", () => {
  it("serializes same-process mutations for the same resolved home", async () => {
    const home = await createHome();
    const firstRelease = deferred();
    const events: string[] = [];
    const firstLock = getProductMutationLock(home);
    const secondLock = getProductMutationLock(join(home, "."));

    const first = firstLock.run({ operation: "first", product_id: "P-a1b2c3" }, async () => {
      events.push("first-start");
      await firstRelease.promise;
      events.push("first-end");
      return "first-result";
    });

    while (!events.includes("first-start")) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    const second = secondLock.run({ operation: "second", product_id: "P-a1b2c3" }, async () => {
      events.push("second-start");
      events.push("second-end");
      return "second-result";
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual(["first-start"]);

    firstRelease.resolve();

    await expect(first).resolves.toBe("first-result");
    await expect(second).resolves.toBe("second-result");
    expect(events).toEqual(["first-start", "first-end", "second-start", "second-end"]);
  });

  it("recovers an existing stale lock directory before acquiring with the lock directory path", async () => {
    vi.useFakeTimers({ now: testNow });
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const home = await createHome();
    const staleUpdatedAt = new Date(testNow.getTime() - staleThresholdMs - 1_000).toISOString();
    await writeOwner(home, liveOwner({ owner_id: "owner-stale", updated_at: staleUpdatedAt }));

    let lockDirIsDirectory = false;
    let warnings: string[] = [];
    await getProductMutationLock(home).run({ operation: "replace-stale", product_id: "P-a1b2c3" }, async (context) => {
      lockDirIsDirectory = (await stat(lockPath(home))).isDirectory();
      warnings = [...context.warnings];
    });

    expect(lockDirIsDirectory).toBe(true);
    expect(warnings).toEqual([expect.stringContaining("stale")]);
    expect(emitWarning).toHaveBeenCalledWith(expect.stringContaining("stale"));
    await expect(stat(lockPath(home))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes owner.json atomically and leaves no temporary owner files behind", async () => {
    vi.useFakeTimers({ now: testNow });
    const home = await createHome();

    let owner: Record<string, unknown> = {};
    let lockEntries: string[] = [];
    await getProductMutationLock(home).run({ operation: "create-owner", product_id: "P-a1b2c3" }, async () => {
      owner = await readOwner(home);
      lockEntries = await readdir(lockPath(home));
    });

    expect(owner).toMatchObject({
      operation: "create-owner",
      product_id: "P-a1b2c3",
      pid: process.pid
    });
    expect(typeof owner.owner_id).toBe("string");
    expect(Date.parse(String(owner.acquired_at))).not.toBeNaN();
    expect(Date.parse(String(owner.updated_at))).not.toBeNaN();
    expect(lockEntries).toContain("owner.json");
    expect(lockEntries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("heartbeats owner.json.updated_at and the lock directory mtime", async () => {
    vi.useFakeTimers({ now: testNow });
    const home = await createHome();
    const release = deferred();
    const entered = deferred<ProductMutationContext>();
    const run = getProductMutationLock(home).run({ operation: "heartbeat", product_id: "P-a1b2c3" }, async (context) => {
      entered.resolve(context);
      await release.promise;
      return "done";
    });

    await entered.promise;
    const firstOwner = await readOwner(home);
    const firstDirectoryStat = await stat(lockPath(home));

    await vi.advanceTimersByTimeAsync(heartbeatMs);

    let secondOwner = await waitForOwner(home);
    let secondDirectoryStat = await stat(lockPath(home));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (
        Date.parse(String(secondOwner.updated_at)) > Date.parse(String(firstOwner.updated_at)) &&
        secondDirectoryStat.mtimeMs > firstDirectoryStat.mtimeMs
      ) {
        break;
      }
      await vi.advanceTimersByTimeAsync(1);
      secondOwner = await waitForOwner(home);
      secondDirectoryStat = await stat(lockPath(home));
    }

    expect(Date.parse(String(secondOwner.updated_at))).toBeGreaterThan(Date.parse(String(firstOwner.updated_at)));
    expect(secondDirectoryStat.mtimeMs).toBeGreaterThan(firstDirectoryStat.mtimeMs);

    release.resolve();
    await expect(run).resolves.toBe("done");
  });

  it("stops heartbeat without overwriting a lock path reused by another owner", async () => {
    vi.useFakeTimers({ now: testNow });
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const home = await createHome();
    const release = deferred();
    const entered = deferred<ProductMutationContext>();
    let mutationContext: ProductMutationContext | undefined;
    const run = getProductMutationLock(home).run({ operation: "heartbeat-race", product_id: "P-a1b2c3" }, async (context) => {
      mutationContext = context;
      entered.resolve(context);
      await release.promise;
      return "done";
    });

    await entered.promise;
    const replacementOwner = liveOwner({
      owner_id: "owner-heartbeat-reused",
      operation: "replacement-heartbeat",
      product_id: "P-fedcba"
    });
    await rm(lockPath(home), { recursive: true, force: true });
    await writeOwner(home, replacementOwner);

    await vi.advanceTimersByTimeAsync(heartbeatMs);
    await waitForWarnings(mutationContext);

    expect(await waitForOwner(home)).toMatchObject({
      owner_id: "owner-heartbeat-reused",
      operation: "replacement-heartbeat"
    });
    expect(mutationContext?.warnings).toEqual([expect.stringContaining("stopping heartbeat")]);
    expect(emitWarning).toHaveBeenCalledWith(expect.stringContaining("stopping heartbeat"));

    release.resolve();
    await expect(run).resolves.toBe("done");
    expect(await waitForOwner(home)).toMatchObject({ owner_id: "owner-heartbeat-reused" });
  });

  it("does not overwrite a lock path reused between heartbeat owner read and write", async () => {
    vi.useFakeTimers({ now: testNow });
    const stopped = deferred();
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation((warning) => {
      if (String(warning).includes("stopping heartbeat")) {
        stopped.resolve();
      }
      return undefined;
    });
    const home = await createHome();
    const replacementOwner = liveOwner({
      owner_id: "owner-heartbeat-write-reused",
      operation: "replacement-heartbeat-write",
      product_id: "P-fedcba"
    });
    const { module, armRace, raceInjected } = await importLockWithHeartbeatWriteRace(home, replacementOwner);
    const release = deferred();
    const entered = deferred<ProductMutationContext>();
    let mutationContext: ProductMutationContext | undefined;
    const run = module
      .getProductMutationLock(home)
      .run({ operation: "heartbeat-write-race", product_id: "P-a1b2c3" }, async (context) => {
        mutationContext = context;
        entered.resolve(context);
        await release.promise;
        return "done";
      });

    await entered.promise;
    armRace();

    await vi.advanceTimersByTimeAsync(heartbeatMs);
    await raceInjected;
    await stopped.promise;

    expect(await waitForOwner(home)).toMatchObject({
      owner_id: "owner-heartbeat-write-reused",
      operation: "replacement-heartbeat-write"
    });
    expect(mutationContext?.warnings).toEqual([expect.stringContaining("stopping heartbeat")]);
    expect(emitWarning).toHaveBeenCalledWith(expect.stringContaining("stopping heartbeat"));

    release.resolve();
    await expect(run).resolves.toBe("done");
    expect(await waitForOwner(home)).toMatchObject({ owner_id: "owner-heartbeat-write-reused" });
  });

  it("does not restore a claimed owner over an existing owner.json", async () => {
    vi.useFakeTimers({ now: testNow });
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const home = await createHome();
    const { module, claimReached, resumeClaim } = await importLockWithPausedHeartbeatClaim(home);
    const release = deferred();
    const entered = deferred();
    const replacementOwner = liveOwner({
      owner_id: "owner-restore-claim-existing",
      operation: "replacement-owner-restore",
      product_id: "P-fedcba"
    });
    const run = module.getProductMutationLock(home).run({ operation: "owner-restore-race", product_id: "P-a1b2c3" }, async () => {
      entered.resolve();
      await release.promise;
      return "done";
    });

    await entered.promise;
    await vi.advanceTimersByTimeAsync(heartbeatMs);
    await claimReached;
    await writeOwner(home, replacementOwner);
    release.resolve();
    resumeClaim();

    await expect(run).resolves.toBe("done");
    expect(await waitForOwner(home)).toMatchObject({
      owner_id: "owner-restore-claim-existing",
      operation: "replacement-owner-restore"
    });
    expect(emitWarning).toHaveBeenCalledWith(expect.stringContaining("owner changed while restoring"));
  });

  it("waits for an in-flight heartbeat before releasing the lock", async () => {
    vi.useFakeTimers({ now: testNow });
    const home = await createHome();
    const { module, claimReached, resumeClaim } = await importLockWithPausedHeartbeatClaim(home);
    const release = deferred();
    const entered = deferred();
    const run = module.getProductMutationLock(home).run({ operation: "pending-heartbeat", product_id: "P-a1b2c3" }, async () => {
      entered.resolve();
      await release.promise;
      return "done";
    });

    await entered.promise;
    await vi.advanceTimersByTimeAsync(heartbeatMs);
    await claimReached;
    release.resolve();
    await vi.advanceTimersByTimeAsync(1);

    let settled = false;
    void run.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(settled).toBe(false);

    resumeClaim();
    await expect(run).resolves.toBe("done");
    await expect(stat(lockPath(home))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not restore a claimed lock over an existing empty lock directory", async () => {
    vi.useFakeTimers({ now: testNow });
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const home = await createHome();
    const { module, targetCreated } = await importLockWithRestoreLockEmptyTargetRace(home);
    const replacementOwner = liveOwner({
      owner_id: "owner-lock-restore-empty-target",
      operation: "replacement-lock-restore",
      product_id: "P-fedcba"
    });

    await module.getProductMutationLock(home).run({ operation: "lock-restore-race", product_id: "P-a1b2c3" }, async () => {
      await writeOwner(home, replacementOwner);
      return "done";
    });
    await targetCreated;

    expect((await stat(lockPath(home))).isDirectory()).toBe(true);
    await expect(readFile(ownerPath(home), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(emitWarning).toHaveBeenCalledWith(expect.stringContaining("path was reused while restoring"));
  });

  it("does not remove a lock path reused between release validation and deletion", async () => {
    vi.useFakeTimers({ now: testNow });
    const home = await createHome();
    const replacementOwner = liveOwner({
      owner_id: "owner-release-reused",
      operation: "replacement-release",
      product_id: "P-fedcba"
    });
    const { getProductMutationLock: getRaceLock } = await importLockWithReusedPathRace(home, replacementOwner);

    await getRaceLock(home).run({ operation: "release-race", product_id: "P-a1b2c3" }, async () => "done");

    expect(await readOwner(home)).toMatchObject({
      owner_id: "owner-release-reused",
      operation: "replacement-release"
    });
  });

  it("does not remove an active owner-unknown lock younger than the stale threshold", async () => {
    vi.useFakeTimers({ now: testNow });
    const home = await createHome();
    await mkdir(lockPath(home), { recursive: true });
    await setLockDirectoryMtime(home, testNow);

    const errorPromise = getProductMutationLock(home)
      .run({ operation: "blocked-missing-owner", product_id: "P-a1b2c3" }, async () => {
        throw new Error("callback must not run");
      })
      .then(
        () => undefined,
        (error: unknown) => error
      );

    await vi.advanceTimersByTimeAsync(waitTimeoutMs + 1_000);

    const error = await errorPromise;
    expect(error).toBeInstanceOf(FormaError);
    expect((error as FormaError).code).toBe("PRODUCT_MUTATION_LOCKED");
    expect((await stat(lockPath(home))).isDirectory()).toBe(true);
  });

  it("removes a missing owner.json lock that is stale by directory mtime and reports the warning", async () => {
    vi.useFakeTimers({ now: testNow });
    vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const home = await createHome();
    await mkdir(lockPath(home), { recursive: true });
    await setLockDirectoryMtime(home, new Date(testNow.getTime() - staleThresholdMs - 1_000));

    let warnings: string[] = [];
    await getProductMutationLock(home).run({ operation: "recover-missing", product_id: "P-a1b2c3" }, async (context) => {
      warnings = [...context.warnings];
    });

    expect(warnings).toEqual([expect.stringContaining("missing or corrupt")]);
  });

  it("removes a corrupt owner.json lock that is stale by directory mtime and reports the warning", async () => {
    vi.useFakeTimers({ now: testNow });
    vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const home = await createHome();
    await mkdir(dirname(ownerPath(home)), { recursive: true });
    await writeFile(ownerPath(home), "{not-json", "utf8");
    await setLockDirectoryMtime(home, new Date(testNow.getTime() - staleThresholdMs - 1_000));

    let warnings: string[] = [];
    await getProductMutationLock(home).run({ operation: "recover-corrupt", product_id: "P-a1b2c3" }, async (context) => {
      warnings = [...context.warnings];
    });

    expect(warnings).toEqual([expect.stringContaining("missing or corrupt")]);
  });

  it("removes a dead owner PID and reports the warning", async () => {
    vi.useFakeTimers({ now: testNow });
    vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const home = await createHome();
    await writeOwner(home, liveOwner({ owner_id: "owner-dead", pid: 999_999_999 }));

    let warnings: string[] = [];
    await getProductMutationLock(home).run({ operation: "recover-dead-pid", product_id: "P-a1b2c3" }, async (context) => {
      warnings = [...context.warnings];
    });

    expect(warnings).toEqual([expect.stringContaining("dead owner PID")]);
  });

  it("does not remove a lock path reused during stale owner cleanup", async () => {
    vi.useFakeTimers({ now: testNow });
    const home = await createHome();
    const staleUpdatedAt = new Date(testNow.getTime() - staleThresholdMs - 1_000).toISOString();
    await writeOwner(home, liveOwner({ owner_id: "owner-stale-race", updated_at: staleUpdatedAt }));
    const replacementOwner = liveOwner({
      owner_id: "owner-cleanup-reused",
      operation: "replacement-cleanup",
      product_id: "P-fedcba"
    });
    const { getProductMutationLock: getRaceLock } = await importLockWithReusedPathRace(home, replacementOwner);
    let callbackRan = false;

    const errorPromise = getRaceLock(home)
      .run({ operation: "cleanup-race", product_id: "P-a1b2c3" }, async () => {
        callbackRan = true;
      })
      .then(
        () => undefined,
        (error: unknown) => error
      );

    await vi.advanceTimersByTimeAsync(waitTimeoutMs + 1_000);

    const error = await errorPromise;
    expect(callbackRan).toBe(false);
    expect((error as { code?: string }).code).toBe("PRODUCT_MUTATION_LOCKED");
    expect(await readOwner(home)).toMatchObject({
      owner_id: "owner-cleanup-reused",
      operation: "replacement-cleanup"
    });
  });

  it("times out with operation, product ID, lock path, waited milliseconds, and warnings", async () => {
    vi.useFakeTimers({ now: testNow });
    const home = await createHome();
    await writeOwner(home, liveOwner({ operation: "other-live", product_id: "P-other1" }));

    const errorPromise = getProductMutationLock(home)
      .run({ operation: "delete-product", product_id: "P-a1b2c3" }, async () => {
        throw new Error("callback must not run");
      })
      .then(
        () => undefined,
        (error: unknown) => error
      );

    await vi.advanceTimersByTimeAsync(waitTimeoutMs + 1_000);

    const error = errorPromise.then((caught) => caught as FormaError);
    await expect(error).resolves.toBeInstanceOf(FormaError);
    await expect(error).resolves.toMatchObject({
      code: "PRODUCT_MUTATION_LOCKED",
      details: {
        operation: "delete-product",
        product_id: "P-a1b2c3",
        lock_path: lockPath(home),
        warnings: []
      }
    });
    await expect(error.then((caught) => caught.details.waited_ms)).resolves.toBeGreaterThanOrEqual(waitTimeoutMs);
  });

  it("exposes the new product mutation error codes", () => {
    expect(new FormaError("INVALID_INPUT", "Invalid input").toJSON().error_code).toBe("INVALID_INPUT");
    expect(new FormaError("PRODUCT_MUTATION_LOCKED", "Product mutation locked").toJSON().error_code).toBe(
      "PRODUCT_MUTATION_LOCKED"
    );
    expect(new FormaError("PRODUCT_DELETION_RECOVERY_FAILED", "Product deletion recovery failed").toJSON().error_code).toBe(
      "PRODUCT_DELETION_RECOVERY_FAILED"
    );
  });
});

describe("defaultProductMutationWarningSink", () => {
  it("emits process warnings", () => {
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);

    defaultProductMutationWarningSink("product mutation warning");

    expect(emitWarning).toHaveBeenCalledWith("product mutation warning");
  });
});
