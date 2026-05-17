import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentInstallPlatform } from "@xenonbyte/forma-core";
import { runCli, type CliEnv } from "../src/index.js";

interface TestState {
  tmp: string;
  home: string;
  formaHome: string;
  startedMcp: number;
  startedServers: unknown[];
  spawnedServers: unknown[];
  killed: number[];
  installed: AgentInstallPlatform[][];
  uninstalled: AgentInstallPlatform[][];
  pencil:
    | { available: true; authenticated: true }
    | { available: false; authenticated: false; message: string }
    | { available: true; authenticated: false; message: string };
}

let states: TestState[] = [];

beforeEach(() => {
  states = [];
});

afterEach(async () => {
  await Promise.all(states.map((state) => rm(state.tmp, { recursive: true, force: true })));
});

describe("runCli", () => {
  it("prints version", async () => {
    const result = await runCli(["version"], await testEnv());

    expect(result).toEqual({ stdout: "forma 0.1.0\n", stderr: "", exitCode: 0 });
  });

  it("routes mcp to the injected MCP starter", async () => {
    const env = await testEnv({ startMcp: async () => "mcp started" });

    const result = await runCli(["mcp"], env);

    expect(env.state.startedMcp).toBe(1);
    expect(result.stdout).toContain("mcp started");
    expect(result.exitCode).toBe(0);
  });

  it("routes serve to the injected server starter", async () => {
    const env = await testEnv({ startServer: async () => "server started" });

    const result = await runCli(["serve"], env);

    expect(env.state.startedServers).toEqual([{}]);
    expect(result.stdout).toContain("server started");
    expect(result.exitCode).toBe(0);
  });

  it("serve start writes metadata and log files under the Forma home", async () => {
    const env = await testEnv({
      now: () => new Date("2026-05-17T12:00:00.000Z"),
      createServeToken: () => "test-token",
      startServer: async () => ({ pid: 4242, message: "server started" })
    });

    const result = await runCli(["serve", "start"], env);

    expect(env.state.startedServers).toEqual([
      expect.objectContaining({ detached: true, token: "test-token", logFile: join(env.state.formaHome, "serve.log") })
    ]);
    await expect(readFile(join(env.state.formaHome, "serve.pid"), "utf8").then(JSON.parse)).resolves.toMatchObject({
      marker: "xenonbyte.forma.serve",
      pid: 4242,
      token: "test-token",
      started_at: "2026-05-17T12:00:00.000Z",
      log: join(env.state.formaHome, "serve.log")
    });
    await expect(readFile(join(env.state.formaHome, "serve.log"), "utf8")).resolves.toContain(
      "2026-05-17T12:00:00.000Z forma serve start pid=4242"
    );
    expect(result.stdout).toContain("server started");
  });

  it("serve start defaults to detached spawn and refuses to overwrite a running Forma server", async () => {
    const env = await testEnv({
      currentPid: 1111,
      createServeToken: () => "spawn-token",
      isPidAlive: (pid) => pid === 2222,
      spawnDetachedServer: async (options) => {
        env.state.spawnedServers.push(options);
        return { pid: 2222 };
      },
      useDefaultStartServer: true
    });

    const first = await runCli(["serve", "start"], env);
    const second = await runCli(["serve", "start"], env);

    expect(first.exitCode).toBe(0);
    expect(env.state.spawnedServers).toHaveLength(1);
    await expect(readFile(join(env.state.formaHome, "serve.pid"), "utf8").then(JSON.parse)).resolves.toMatchObject({
      pid: 2222,
      token: "spawn-token"
    });
    expect(second.exitCode).toBe(1);
    expect(second.stderr).toContain("Forma server is already running");
    expect(env.state.spawnedServers).toHaveLength(1);
  });

  it("serve stop kills only a valid Forma metadata pid and removes it", async () => {
    const env = await testEnv({ isPidAlive: (pid) => pid === 9876 });
    await mkdir(env.state.formaHome, { recursive: true });
    await writeFile(join(env.state.formaHome, "serve.pid"), JSON.stringify(serveMetadata({ pid: 9876 })), "utf8");

    const result = await runCli(["serve", "stop"], env);

    expect(env.state.killed).toEqual([9876]);
    await expect(access(join(env.state.formaHome, "serve.pid"))).rejects.toThrow();
    expect(result.stdout).toContain("Stopped Forma server");
  });

  it("does not report or kill a naked pid file", async () => {
    const env = await testEnv({
      useDefaultServerStatus: true,
      isPidAlive: () => true
    });
    await mkdir(env.state.formaHome, { recursive: true });
    await writeFile(join(env.state.formaHome, "serve.pid"), `${process.pid}\n`, "utf8");

    const status = await runCli(["status"], env);
    const stop = await runCli(["serve", "stop"], env);

    expect(status.stdout).toContain("Web server: stopped");
    expect(status.stderr).toContain("Invalid Forma server state");
    expect(stop.exitCode).toBe(1);
    expect(stop.stderr).toContain("Invalid Forma server state");
    expect(env.state.killed).toEqual([]);
    await expect(access(join(env.state.formaHome, "serve.pid"))).rejects.toThrow();
  });

  it("dispatches install and uninstall to selected platforms", async () => {
    const env = await testEnv();

    await expect(runCli(["install", "--platform", "claude,codex"], env)).resolves.toMatchObject({ exitCode: 0 });
    await expect(runCli(["uninstall", "--platform", "gemini"], env)).resolves.toMatchObject({ exitCode: 0 });

    expect(env.state.installed).toEqual([["claude", "codex"]]);
    expect(env.state.uninstalled).toEqual([["gemini"]]);
  });

  it("rejects invalid platforms", async () => {
    const env = await testEnv();

    const result = await runCli(["install", "--platform", "claude,vscode"], env);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid platform: vscode");
    expect(env.state.installed).toEqual([]);
  });

  it("prints status with data directory, installed platforms, pencil state, and server state", async () => {
    const env = await testEnv({
      installedPlatforms: async () => ["claude", "gemini"],
      isServerRunning: async () => true,
      pencil: { available: true, authenticated: true }
    });

    const result = await runCli(["status"], env);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Data directory: ${env.state.formaHome}`);
    expect(result.stdout).toContain("Installed platforms: claude, gemini");
    expect(result.stdout).toContain("Pencil CLI: available");
    expect(result.stdout).toContain("Pencil authentication: authenticated");
    expect(result.stdout).toContain("Web server: running");
  });

  it("prints status when one platform manifest is damaged", async () => {
    const env = await testEnv({
      useDefaultInstalledPlatforms: true,
      useDefaultServerStatus: true
    });
    const manifestsDir = join(env.state.formaHome, "manifests");
    await mkdir(manifestsDir, { recursive: true });
    await writeFile(join(manifestsDir, "claude.manifest"), "schema_version: [\n", "utf8");
    await writeFile(
      join(manifestsDir, "codex.manifest"),
      [
        "schema_version: 1",
        "platform: codex",
        "installed_paths: []",
        "backups: []",
        "config_paths: []",
        "installed_at: '2026-05-17T00:00:00.000Z'",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = await runCli(["status"], env);

    expect(result.stdout).toContain(`Data directory: ${env.state.formaHome}`);
    expect(result.stdout).toContain("Installed platforms: codex");
    expect(result.stdout).toContain("Pencil CLI: available");
    expect(result.stdout).toContain("Web server: stopped");
    expect(result.stderr).toContain("Invalid manifest for claude");
  });
});

type TestEnvOverrides = Partial<CliEnv> &
  Partial<Pick<TestState, "pencil">> & {
    useDefaultInstalledPlatforms?: boolean;
    useDefaultServerStatus?: boolean;
    useDefaultStartServer?: boolean;
  };

async function testEnv(overrides: TestEnvOverrides = {}): Promise<CliEnv & { state: TestState }> {
  const tmp = await mkdtemp();
  const home = join(tmp, "home");
  const formaHome = join(home, ".forma");
  const state: TestState = {
    tmp,
    home,
    formaHome,
    startedMcp: 0,
    startedServers: [],
    spawnedServers: [],
    killed: [],
    installed: [],
    uninstalled: [],
    pencil: overrides.pencil ?? { available: true, authenticated: true }
  };
  states.push(state);

  const env: CliEnv & { state: TestState } = {
    state,
    formaHome,
    currentPid: overrides.currentPid ?? 1234,
    now: overrides.now ?? (() => new Date("2026-05-17T00:00:00.000Z")),
    createServeToken: overrides.createServeToken,
    isPidAlive: overrides.isPidAlive,
    spawnDetachedServer: overrides.spawnDetachedServer,
    startMcp: async () => {
      state.startedMcp += 1;
      if (overrides.startMcp) {
        return overrides.startMcp();
      }
      return undefined;
    },
    startServer: overrides.useDefaultStartServer
      ? undefined
      : async (options) => {
          state.startedServers.push(options ?? {});
          if (overrides.startServer) {
            return overrides.startServer(options);
          }
          return undefined;
        },
    createInstallService:
      overrides.createInstallService ??
      (() => ({
        installPlatforms: async (platforms) => {
          state.installed.push([...platforms]);
        },
        uninstallPlatforms: async (platforms) => {
          state.uninstalled.push([...platforms]);
        }
      })),
    checkPencil:
      overrides.checkPencil ??
      (async () => {
        return state.pencil;
      }),
    installedPlatforms: overrides.useDefaultInstalledPlatforms
      ? undefined
      : overrides.installedPlatforms ??
        (async () => {
          return state.installed.at(-1) ?? [];
        }),
    isServerRunning: overrides.useDefaultServerStatus
      ? undefined
      : overrides.isServerRunning ??
        (async () => {
          try {
            await access(join(formaHome, "serve.pid"));
            return true;
          } catch {
            return false;
          }
        }),
    killProcess:
      overrides.killProcess ??
      (async (pid) => {
        state.killed.push(pid);
      })
  };

  return env;
}

function serveMetadata(overrides: Partial<{ pid: number; token: string; started_at: string; log: string }> = {}) {
  return {
    schema_version: 1,
    marker: "xenonbyte.forma.serve",
    pid: overrides.pid ?? 1234,
    token: overrides.token ?? "test-token",
    started_at: overrides.started_at ?? "2026-05-17T00:00:00.000Z",
    log: overrides.log ?? "/tmp/forma-serve.log"
  };
}

async function mkdtemp(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), "forma-cli-"));
}
