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

  it("serve start writes pid and log files under the Forma home", async () => {
    const env = await testEnv({
      currentPid: 4242,
      now: () => new Date("2026-05-17T12:00:00.000Z"),
      startServer: async () => "server started"
    });

    const result = await runCli(["serve", "start"], env);

    expect(env.state.startedServers).toEqual([{ detached: true }]);
    await expect(readFile(join(env.state.formaHome, "serve.pid"), "utf8")).resolves.toBe("4242\n");
    await expect(readFile(join(env.state.formaHome, "serve.log"), "utf8")).resolves.toContain(
      "2026-05-17T12:00:00.000Z forma serve start"
    );
    expect(result.stdout).toContain("server started");
  });

  it("serve stop kills the pid from the pid file and removes it", async () => {
    const env = await testEnv();
    await mkdir(env.state.formaHome, { recursive: true });
    await writeFile(join(env.state.formaHome, "serve.pid"), "9876\n", "utf8");

    const result = await runCli(["serve", "stop"], env);

    expect(env.state.killed).toEqual([9876]);
    await expect(access(join(env.state.formaHome, "serve.pid"))).rejects.toThrow();
    expect(result.stdout).toContain("Stopped Forma server");
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
});

async function testEnv(overrides: Partial<CliEnv> & Partial<Pick<TestState, "pencil">> = {}): Promise<CliEnv & { state: TestState }> {
  const tmp = await mkdtemp();
  const home = join(tmp, "home");
  const formaHome = join(home, ".forma");
  const state: TestState = {
    tmp,
    home,
    formaHome,
    startedMcp: 0,
    startedServers: [],
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
    startMcp: async () => {
      state.startedMcp += 1;
      if (overrides.startMcp) {
        return overrides.startMcp();
      }
      return undefined;
    },
    startServer: async (options) => {
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
    installedPlatforms:
      overrides.installedPlatforms ??
      (async () => {
        return state.installed.at(-1) ?? [];
      }),
    isServerRunning:
      overrides.isServerRunning ??
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

async function mkdtemp(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), "forma-cli-"));
}
