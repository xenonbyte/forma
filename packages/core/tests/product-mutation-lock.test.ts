import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPencilMutationLock,
  getProductMutationLock,
  pencilMutationLockPath,
  productMutationLockPath,
  PRODUCT_MUTATION_LOCK_HEARTBEAT_MS,
  PRODUCT_MUTATION_LOCK_TTL_MS,
  runProductMutationWithWarnings
} from "../src/index.js";

const tempRoots: string[] = [];

async function createHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "forma-v6-lock-"));
  tempRoots.push(home);
  return home;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function nextTick(): Promise<void> {
  await new Promise((resolveTick) => setTimeout(resolveTick, 0));
}

async function expectNoLockSidecars(lockDir: string): Promise<void> {
  const files = await readdir(lockDir);
  expect(files.filter((file) => file.endsWith(".mutate") || file.endsWith(".claim"))).toEqual([]);
}

async function writeMutationSidecar(lockFile: string, input: { lock_id: string; owner_pid: number; expires_at: string }): Promise<void> {
  await writeFile(`${lockFile}.mutate`, JSON.stringify({
    lock_id: input.lock_id,
    owner_pid: input.owner_pid,
    owner_process_start_time: "2026-05-21T00:00:00.000Z",
    hostname: "host",
    acquired_at: "2026-05-21T00:00:00.000Z",
    expires_at: input.expires_at
  }));
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("v6 transaction locks", () => {
  it("writes product lock content at the product-scoped v6 path", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-21T00:00:00.000Z") });
    const home = await createHome();
    let lock: Record<string, unknown> = {};

    await getProductMutationLock(home).run({ operation: "begin_requirement_design_session", product_id: "P-123abc", session_id: "S-1234567890abcdef" }, async () => {
      lock = JSON.parse(await readFile(productMutationLockPath(home, "P-123abc"), "utf8"));
    });

    expect(lock).toMatchObject({
      owner_pid: process.pid,
      command: "begin_requirement_design_session",
      scope: "begin_requirement_design_session",
      product_id: "P-123abc",
      session_id: "S-1234567890abcdef",
      acquired_at: "2026-05-21T00:00:00.000Z",
      heartbeat_at: "2026-05-21T00:00:00.000Z",
      expires_at: "2026-05-21T00:02:00.000Z"
    });
    expect(typeof lock.lock_id).toBe("string");
    expect(typeof lock.owner_process_start_time).toBe("string");
    expect(typeof lock.hostname).toBe("string");
    await expect(readFile(productMutationLockPath(home, "P-123abc"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses the global Pencil lock path and reports live locks", async () => {
    const home = await createHome();
    await mkdir(join(home, "locks"), { recursive: true });
    await writeFile(pencilMutationLockPath(home), JSON.stringify({
      lock_id: "L-live",
      owner_pid: process.pid,
      owner_process_start_time: "2026-05-21T00:00:00.000Z",
      hostname: "host",
      command: "begin",
      scope: "pencil",
      acquired_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + PRODUCT_MUTATION_LOCK_TTL_MS).toISOString(),
      heartbeat_at: new Date().toISOString()
    }));

    await expect(getPencilMutationLock(home).run({ operation: "begin", scope: "pencil" }, async () => "ok")).rejects.toMatchObject({
      code: "PENCIL_LOCK_HELD"
    });
  });

  it("reports corrupt locks without overwriting them", async () => {
    const home = await createHome();
    const lockFile = productMutationLockPath(home, "P-123abc");
    await mkdir(join(home, "data", "P-123abc", "locks"), { recursive: true });
    await writeFile(lockFile, "{not-json", "utf8");

    await expect(getProductMutationLock(home).run({ operation: "begin", product_id: "P-123abc" }, async () => "ok")).rejects.toMatchObject({
      code: "LOCK_CORRUPT"
    });
    await expect(readFile(lockFile, "utf8")).resolves.toBe("{not-json");
  });

  it("reclaims expired locks and exposes heartbeat timing constants", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-21T00:00:00.000Z") });
    const home = await createHome();
    const lockFile = productMutationLockPath(home, "P-123abc");
    await mkdir(join(home, "data", "P-123abc", "locks"), { recursive: true });
    await writeFile(lockFile, JSON.stringify({
      lock_id: "L-stale",
      owner_pid: 999999,
      owner_process_start_time: "2026-05-20T00:00:00.000Z",
      hostname: "host",
      command: "old",
      scope: "old",
      product_id: "P-123abc",
      acquired_at: "2026-05-20T00:00:00.000Z",
      expires_at: "2026-05-20T00:02:00.000Z",
      heartbeat_at: "2026-05-20T00:00:00.000Z"
    }));

    await getProductMutationLock(home).run({ operation: "new", product_id: "P-123abc" }, async () => {
      expect(PRODUCT_MUTATION_LOCK_HEARTBEAT_MS).toBe(15_000);
      expect(JSON.parse(await readFile(lockFile, "utf8")).lock_id).not.toBe("L-stale");
    });

    await expect(readFile(lockFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records release mismatch warnings instead of deleting a replacement lock", async () => {
    const home = await createHome();
    const warnings: string[] = [];
    await runProductMutationWithWarnings(
      getProductMutationLock(home),
      { operation: "replace", product_id: "P-123abc" },
      async () => {
        await writeFile(productMutationLockPath(home, "P-123abc"), JSON.stringify({
          lock_id: "L-replacement",
          owner_pid: process.pid,
          owner_process_start_time: "2026-05-21T00:00:00.000Z",
          hostname: "host",
          command: "replacement",
          scope: "replacement",
          product_id: "P-123abc",
          acquired_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + PRODUCT_MUTATION_LOCK_TTL_MS).toISOString(),
          heartbeat_at: new Date().toISOString()
        }));
      },
      (warning) => warnings.push(warning)
    );

    expect(warnings.some((warning) => warning.includes("LOCK_RELEASE_MISMATCH"))).toBe(true);
    await expect(readFile(productMutationLockPath(home, "P-123abc"), "utf8")).resolves.toContain("L-replacement");
  });

  it("treats a deleted product directory as already released", async () => {
    const home = await createHome();
    const productDir = join(home, "data", "P-123abc");

    await expect(getProductMutationLock(home).run({ operation: "delete-product", product_id: "P-123abc" }, async () => {
      await rm(productDir, { recursive: true, force: true });
    })).resolves.toBeUndefined();

    await expect(access(productDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("waits for an in-flight heartbeat before releasing the lock", async () => {
    vi.useFakeTimers();
    const home = await createHome();
    const heartbeatStarted = deferred();
    const allowHeartbeatWrite = deferred();
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        copyFile: vi.fn(async (src: Parameters<typeof actual.copyFile>[0], dest: Parameters<typeof actual.copyFile>[1], mode?: Parameters<typeof actual.copyFile>[2]) => {
          if (String(dest).endsWith("/data/P-123abc/locks/product-mutation.lock")) {
            heartbeatStarted.resolve();
            await allowHeartbeatWrite.promise;
          }
          return actual.copyFile(src, dest, mode);
        })
      };
    });
    const lockModule = await import("../src/product-mutation-lock.js");

    let completed = false;
    const running = lockModule.getProductMutationLock(home).run({ operation: "heartbeat", product_id: "P-123abc" }, async () => {
      await vi.advanceTimersByTimeAsync(lockModule.PRODUCT_MUTATION_LOCK_HEARTBEAT_MS);
      await heartbeatStarted.promise;
    }).then(() => {
      completed = true;
    });
    await nextTick();
    expect(completed).toBe(false);

    allowHeartbeatWrite.resolve();
    await running;
    await expect(readFile(lockModule.productMutationLockPath(home, "P-123abc"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("does not delete a replacement lock that appears during release", async () => {
    const home = await createHome();
    const warnings: string[] = [];
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      let injected = false;
      let claimRead = false;
      const target = join(home, "data", "P-123abc", "locks", "product-mutation.lock");
      return {
        ...actual,
        readFile: vi.fn(async (file: Parameters<typeof actual.readFile>[0], options?: Parameters<typeof actual.readFile>[1]) => {
          if (!injected && claimRead && String(file) === target) {
            injected = true;
            await actual.writeFile(target, JSON.stringify({
              lock_id: "L-release-replacement",
              owner_pid: process.pid,
              owner_process_start_time: "2026-05-21T00:00:00.000Z",
              hostname: "host",
              command: "replacement",
              scope: "replacement",
              product_id: "P-123abc",
              acquired_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + PRODUCT_MUTATION_LOCK_TTL_MS).toISOString(),
              heartbeat_at: new Date().toISOString()
            }));
          }
          const result = await actual.readFile(file, options);
          if (String(file).includes(".claim") && !String(file).includes(".mutate.")) {
            claimRead = true;
          }
          return result;
        })
      };
    });
    const lockModule = await import("../src/product-mutation-lock.js");

    await lockModule.runProductMutationWithWarnings(
      lockModule.getProductMutationLock(home),
      { operation: "release-race", product_id: "P-123abc" },
      async () => undefined,
      (warning) => warnings.push(warning)
    );

    expect(warnings.some((warning) => warning.includes("LOCK_RELEASE_MISMATCH"))).toBe(true);
    await expect(readFile(join(home, "data", "P-123abc", "locks", "product-mutation.lock"), "utf8")).resolves.toContain("L-release-replacement");
    await expectNoLockSidecars(join(home, "data", "P-123abc", "locks"));
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("does not overwrite a replacement lock that appears during heartbeat", async () => {
    vi.useFakeTimers();
    const home = await createHome();
    const warnings: string[] = [];
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      let injected = false;
      const target = join(home, "data", "P-123abc", "locks", "product-mutation.lock");
      return {
        ...actual,
        copyFile: vi.fn(async (src: Parameters<typeof actual.copyFile>[0], dest: Parameters<typeof actual.copyFile>[1], mode?: Parameters<typeof actual.copyFile>[2]) => {
          if (!injected && String(dest) === target) {
            injected = true;
            await actual.writeFile(target, JSON.stringify({
              lock_id: "L-heartbeat-replacement",
              owner_pid: process.pid,
              owner_process_start_time: "2026-05-21T00:00:00.000Z",
              hostname: "host",
              command: "replacement",
              scope: "replacement",
              product_id: "P-123abc",
              acquired_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + PRODUCT_MUTATION_LOCK_TTL_MS).toISOString(),
              heartbeat_at: new Date().toISOString()
            }));
          }
          return actual.copyFile(src, dest, mode);
        })
      };
    });
    const lockModule = await import("../src/product-mutation-lock.js");

    await lockModule.runProductMutationWithWarnings(
      lockModule.getProductMutationLock(home),
      { operation: "heartbeat-race", product_id: "P-123abc" },
      async () => {
        await vi.advanceTimersByTimeAsync(lockModule.PRODUCT_MUTATION_LOCK_HEARTBEAT_MS);
      },
      (warning) => warnings.push(warning)
    );

    expect(warnings.some((warning) => warning.includes("LOCK_RELEASE_MISMATCH"))).toBe(true);
    await expect(readFile(join(home, "data", "P-123abc", "locks", "product-mutation.lock"), "utf8")).resolves.toContain("L-heartbeat-replacement");
    await expectNoLockSidecars(join(home, "data", "P-123abc", "locks"));
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("reclaims stale dead mutation sidecars before acquiring", async () => {
    const home = await createHome();
    const lockFile = productMutationLockPath(home, "P-123abc");
    const lockDir = join(home, "data", "P-123abc", "locks");
    await mkdir(lockDir, { recursive: true });
    await writeMutationSidecar(lockFile, {
      lock_id: "M-stale-dead",
      owner_pid: 999999,
      expires_at: "2026-05-20T00:00:00.000Z"
    });

    let entered = false;
    await getProductMutationLock(home).run({ operation: "new", product_id: "P-123abc" }, async () => {
      entered = true;
      await expect(readFile(lockFile, "utf8")).resolves.toContain("\"lock_id\": \"L-");
    });

    expect(entered).toBe(true);
    await expect(readFile(lockFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expectNoLockSidecars(lockDir);
  });

  it("keeps fresh live mutation sidecars blocking without entering the callback", async () => {
    const home = await createHome();
    const lockFile = productMutationLockPath(home, "P-123abc");
    await mkdir(join(home, "data", "P-123abc", "locks"), { recursive: true });
    await writeMutationSidecar(lockFile, {
      lock_id: "M-live",
      owner_pid: process.pid,
      expires_at: new Date(Date.now() + PRODUCT_MUTATION_LOCK_TTL_MS).toISOString()
    });

    let entered = false;
    await expect(getProductMutationLock(home).run({ operation: "new", product_id: "P-123abc" }, async () => {
      entered = true;
    })).rejects.toMatchObject({ code: "PRODUCT_MUTATION_LOCKED" });

    expect(entered).toBe(false);
    await expect(readFile(lockFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(`${lockFile}.mutate`, "utf8")).resolves.toContain("M-live");
  });

  it("does not acquire a new lock while a recovered mutation sidecar still has a claimed live lock", async () => {
    const home = await createHome();
    const lockFile = productMutationLockPath(home, "P-123abc");
    const claimFile = `${lockFile}.in-flight.claim`;
    await mkdir(join(home, "data", "P-123abc", "locks"), { recursive: true });
    await writeFile(lockFile, JSON.stringify({
      lock_id: "L-original",
      owner_pid: process.pid,
      owner_process_start_time: "2026-05-21T00:00:00.000Z",
      hostname: "host",
      command: "original",
      scope: "original",
      product_id: "P-123abc",
      acquired_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + PRODUCT_MUTATION_LOCK_TTL_MS).toISOString(),
      heartbeat_at: new Date().toISOString()
    }));
    await writeMutationSidecar(lockFile, {
      lock_id: "M-stale-in-flight",
      owner_pid: 999999,
      expires_at: "2026-05-20T00:00:00.000Z"
    });
    await rename(lockFile, claimFile);

    let entered = false;
    await expect(getProductMutationLock(home).run({ operation: "new", product_id: "P-123abc" }, async () => {
      entered = true;
    })).rejects.toMatchObject({ code: "PRODUCT_MUTATION_LOCKED" });

    expect(entered).toBe(false);
    await expect(readFile(lockFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(claimFile, "utf8")).resolves.toContain("L-original");
    await expect(readFile(`${lockFile}.mutate`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the claim file when restore fails and blocks later acquisition", async () => {
    const home = await createHome();
    const lockDir = join(home, "data", "P-123abc", "locks");
    const lockFile = join(lockDir, "product-mutation.lock");
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        copyFile: vi.fn(async (src: Parameters<typeof actual.copyFile>[0], dest: Parameters<typeof actual.copyFile>[1], mode?: Parameters<typeof actual.copyFile>[2]) => {
          if (String(dest) === lockFile && String(src).endsWith(".claim")) {
            const error = new Error("restore failed") as Error & { code: string };
            error.code = "EIO";
            throw error;
          }
          return actual.copyFile(src, dest, mode);
        })
      };
    });
    const lockModule = await import("../src/product-mutation-lock.js");

    await expect(lockModule.getProductMutationLock(home).run({ operation: "restore-fails", product_id: "P-123abc" }, async () => {
      await writeFile(lockFile, JSON.stringify({
        lock_id: "L-replacement-before-restore",
        owner_pid: process.pid,
        owner_process_start_time: "2026-05-21T00:00:00.000Z",
        hostname: "host",
        command: "replacement",
        scope: "replacement",
        product_id: "P-123abc",
        acquired_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + PRODUCT_MUTATION_LOCK_TTL_MS).toISOString(),
        heartbeat_at: new Date().toISOString()
      }));
    })).rejects.toMatchObject({ code: "EIO" });

    const claimFiles = (await readdir(lockDir)).filter((file) => file.endsWith(".claim"));
    expect(claimFiles).toHaveLength(1);
    await expect(readFile(lockFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(lockDir, claimFiles[0]!), "utf8")).resolves.toContain("L-replacement-before-restore");

    let entered = false;
    await expect(lockModule.getProductMutationLock(home).run({ operation: "next", product_id: "P-123abc" }, async () => {
      entered = true;
    })).rejects.toMatchObject({ code: "PRODUCT_MUTATION_LOCKED" });
    expect(entered).toBe(false);
    await expect(readFile(lockFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("holds global mutations behind active product mutations in the same process", async () => {
    const home = await createHome();
    const release = deferred();
    const events: string[] = [];
    const product = getProductMutationLock(home).run({ operation: "product", product_id: "P-123abc" }, async () => {
      events.push("product-enter");
      await release.promise;
      events.push("product-exit");
    });
    while (!events.includes("product-enter")) {
      await nextTick();
    }

    let globalEntered = false;
    const global = getProductMutationLock(home).run({ operation: "global" }, async () => {
      globalEntered = true;
      events.push("global-enter");
    });
    await nextTick();

    expect(globalEntered).toBe(false);
    release.resolve();
    await Promise.all([product, global]);
    expect(events).toEqual(["product-enter", "product-exit", "global-enter"]);
  });

  it("holds product mutations behind active global mutations in the same process", async () => {
    const home = await createHome();
    const release = deferred();
    const events: string[] = [];
    const global = getProductMutationLock(home).run({ operation: "global" }, async () => {
      events.push("global-enter");
      await release.promise;
      events.push("global-exit");
    });
    while (!events.includes("global-enter")) {
      await nextTick();
    }

    let productEntered = false;
    const product = getProductMutationLock(home).run({ operation: "product", product_id: "P-123abc" }, async () => {
      productEntered = true;
      events.push("product-enter");
    });
    await nextTick();

    expect(productEntered).toBe(false);
    release.resolve();
    await Promise.all([global, product]);
    expect(events).toEqual(["global-enter", "global-exit", "product-enter"]);
  });

  it("reports live product files when a global mutation starts cross-process", async () => {
    const home = await createHome();
    await mkdir(join(home, "data", "P-123abc", "locks"), { recursive: true });
    await writeFile(productMutationLockPath(home, "P-123abc"), JSON.stringify({
      lock_id: "L-product",
      owner_pid: process.pid,
      owner_process_start_time: "2026-05-21T00:00:00.000Z",
      hostname: "host",
      command: "product",
      scope: "product",
      product_id: "P-123abc",
      acquired_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + PRODUCT_MUTATION_LOCK_TTL_MS).toISOString(),
      heartbeat_at: new Date().toISOString()
    }));

    await expect(getProductMutationLock(home).run({ operation: "global" }, async () => "ok")).rejects.toMatchObject({
      code: "PRODUCT_MUTATION_LOCKED"
    });
  });

  it("reports live global files when a product mutation starts cross-process", async () => {
    const home = await createHome();
    await mkdir(join(home, "locks"), { recursive: true });
    await writeFile(productMutationLockPath(home), JSON.stringify({
      lock_id: "L-global",
      owner_pid: process.pid,
      owner_process_start_time: "2026-05-21T00:00:00.000Z",
      hostname: "host",
      command: "global",
      scope: "global",
      acquired_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + PRODUCT_MUTATION_LOCK_TTL_MS).toISOString(),
      heartbeat_at: new Date().toISOString()
    }));

    await expect(getProductMutationLock(home).run({ operation: "product", product_id: "P-123abc" }, async () => "ok")).rejects.toMatchObject({
      code: "PRODUCT_MUTATION_LOCKED"
    });
  });

  it("cleans up a product lock when a global lock appears after the product write", async () => {
    const home = await createHome();
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        writeFile: vi.fn(async (file: Parameters<typeof actual.writeFile>[0], data: Parameters<typeof actual.writeFile>[1], options?: Parameters<typeof actual.writeFile>[2]) => {
          await actual.writeFile(file, data, options);
          if (String(file).endsWith("/data/P-123abc/locks/product-mutation.lock")) {
            await actual.mkdir(join(home, "locks"), { recursive: true });
            await actual.writeFile(join(home, "locks", "product-mutation.lock"), JSON.stringify({
              lock_id: "L-global-race",
              owner_pid: process.pid,
              owner_process_start_time: "2026-05-21T00:00:00.000Z",
              hostname: "host",
              command: "global",
              scope: "global",
              acquired_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + PRODUCT_MUTATION_LOCK_TTL_MS).toISOString(),
              heartbeat_at: new Date().toISOString()
            }));
          }
        })
      };
    });
    const lockModule = await import("../src/product-mutation-lock.js");

    let entered = false;
    await expect(lockModule.getProductMutationLock(home).run({ operation: "product", product_id: "P-123abc" }, async () => {
      entered = true;
    })).rejects.toMatchObject({ code: "PRODUCT_MUTATION_LOCKED" });

    expect(entered).toBe(false);
    await expect(readFile(join(home, "data", "P-123abc", "locks", "product-mutation.lock"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(home, "locks", "product-mutation.lock"), "utf8")).resolves.toContain("L-global-race");
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("does not unlink a fresh lock that replaces a stale lock during reclaim", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-21T00:00:00.000Z") });
    const home = await createHome();
    const lockFile = productMutationLockPath(home, "P-123abc");
    await mkdir(join(home, "data", "P-123abc", "locks"), { recursive: true });
    await writeFile(lockFile, JSON.stringify({
      lock_id: "L-stale",
      owner_pid: 999999,
      owner_process_start_time: "2026-05-20T00:00:00.000Z",
      hostname: "host",
      command: "old",
      scope: "old",
      product_id: "P-123abc",
      acquired_at: "2026-05-20T00:00:00.000Z",
      expires_at: "2026-05-20T00:02:00.000Z",
      heartbeat_at: "2026-05-20T00:00:00.000Z"
    }));
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        writeFile: vi.fn(async (file: Parameters<typeof actual.writeFile>[0], data: Parameters<typeof actual.writeFile>[1], options?: Parameters<typeof actual.writeFile>[2]) => {
          await actual.writeFile(file, data, options);
          if (String(file).endsWith("/product-mutation.lock.mutate")) {
            await actual.writeFile(lockFile, JSON.stringify({
              lock_id: "L-fresh",
              owner_pid: process.pid,
              owner_process_start_time: "2026-05-21T00:00:00.000Z",
              hostname: "host",
              command: "fresh",
              scope: "fresh",
              product_id: "P-123abc",
              acquired_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + PRODUCT_MUTATION_LOCK_TTL_MS).toISOString(),
              heartbeat_at: new Date().toISOString()
            }));
          }
        })
      };
    });
    const lockModule = await import("../src/product-mutation-lock.js");

    let entered = false;
    await expect(lockModule.getProductMutationLock(home).run({ operation: "new", product_id: "P-123abc" }, async () => {
      entered = true;
    })).rejects.toMatchObject({ code: "PRODUCT_MUTATION_LOCKED" });

    expect(entered).toBe(false);
    await expect(readFile(lockFile, "utf8")).resolves.toContain("L-fresh");
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("rejects malformed product ids before constructing lock paths", async () => {
    const home = await createHome();

    expect(() => productMutationLockPath(home, "../../outside")).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(() => productMutationLockPath(home, "not-a-product")).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    await expect(getProductMutationLock(home).run({ operation: "bad", product_id: "../../outside" }, async () => "ok")).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
    await expect(getProductMutationLock(home).run({ operation: "bad", product_id: "not-a-product" }, async () => "ok")).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
    await expect(access(join(home, "..", "..", "outside"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects malformed session ids before writing lock content", async () => {
    const home = await createHome();

    await expect(getProductMutationLock(home).run({ operation: "bad", product_id: "P-123abc", session_id: "S-1" }, async () => "ok")).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
  });
});
