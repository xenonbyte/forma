import { access, chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formaCoreVersion,
  readYamlUnknown,
  writeYamlAtomic,
  type AgentInstallPlatform,
  type InstallServiceOptions
} from "@xenonbyte/forma-core";
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
  installServiceOptions: InstallServiceOptions[];
}

let states: TestState[] = [];
const originalPath = process.env.PATH;

beforeEach(() => {
  states = [];
  process.env.PATH = originalPath;
});

afterEach(async () => {
  process.env.PATH = originalPath;
  await Promise.all(states.map((state) => rm(state.tmp, { recursive: true, force: true })));
});

describe("runCli", () => {
  it("prints version", async () => {
    const result = await runCli(["version"], await testEnv());

    expect(result).toEqual({ stdout: `forma ${formaCoreVersion}\n`, stderr: "", exitCode: 0 });
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

  it("runs schema-normalization-dry-run against an explicit home without rewriting runtime YAML", async () => {
    const env = await testEnv();
    await seedLegacyRuntime(env.state.formaHome, { productPatch: { components_initialized: true } });
    const before = await readFile(join(env.state.formaHome, "data", "P-123abc", "product.yaml"), "utf8");

    const result = await runCli(["schema-normalization-dry-run", "--home", env.state.formaHome], env);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("normalization-preflight/");
    expect(await readFile(join(env.state.formaHome, "data", "P-123abc", "product.yaml"), "utf8")).toBe(before);
  });

  it("runs v6-schema-cutover after dry-run and writes committed marker", async () => {
    const env = await testEnv();
    await seedLegacyRuntime(env.state.formaHome, { productPatch: { components_initialized: true } });
    await expect(runCli(["schema-normalization-dry-run", "--home", env.state.formaHome], env)).resolves.toMatchObject({ exitCode: 0 });

    const result = await runCli(["v6-schema-cutover", "--home", env.state.formaHome], env);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("normalization-backups/");
    await expect(access(join(env.state.formaHome, ".v6-schema-cutover-committed"))).resolves.toBeUndefined();
    const product = await readYamlUnknown(join(env.state.formaHome, "data", "P-123abc", "product.yaml")) as Record<string, unknown>;
    expect(product).not.toHaveProperty("components_initialized");
  });

  it("passes an explicit preflight report path to v6-schema-cutover", async () => {
    const env = await testEnv();
    await seedLegacyRuntime(env.state.formaHome, { productPatch: { components_initialized: true } });
    const dryRun = await runCli(["schema-normalization-dry-run", "--home", env.state.formaHome], env);
    const reportPath = dryRun.stdout.match(/report: (.+)$/m)?.[1];
    expect(reportPath).toBeTruthy();

    const result = await runCli(["v6-schema-cutover", "--home", env.state.formaHome, "--report", join(env.state.formaHome, reportPath!)], env);

    expect(result.exitCode).toBe(0);
    await expect(access(join(env.state.formaHome, ".v6-schema-cutover-committed"))).resolves.toBeUndefined();
  });

  it("accepts --preflight-report for v6-schema-cutover", async () => {
    const env = await testEnv();
    await seedLegacyRuntime(env.state.formaHome, { productPatch: { components_initialized: true } });
    const dryRun = await runCli(["schema-normalization-dry-run", "--home", env.state.formaHome], env);
    const reportPath = dryRun.stdout.match(/report: (.+)$/m)?.[1];
    expect(reportPath).toBeTruthy();

    const result = await runCli(["v6-schema-cutover", "--home", env.state.formaHome, "--preflight-report", join(env.state.formaHome, reportPath!)], env);

    expect(result.exitCode).toBe(0);
    await expect(access(join(env.state.formaHome, ".v6-schema-cutover-committed"))).resolves.toBeUndefined();
  });

  it("runs recover-v6-normalization-journal only for backup directories under the current home", async () => {
    const env = await testEnv();
    await seedLegacyRuntime(env.state.formaHome, { productPatch: { components_initialized: true } });
    await runCli(["schema-normalization-dry-run", "--home", env.state.formaHome], env);
    await runCli(["v6-schema-cutover", "--home", env.state.formaHome], env);
    const backupDir = join(env.state.formaHome, "normalization-backups");
    const selected = `normalization-backups/${(await readdir(backupDir))[0]!}`;

    const outside = await mkdtemp();
    const rejected = await runCli(["recover-v6-normalization-journal", "--home", env.state.formaHome, "--backup-dir", outside], env);
    const recovered = await runCli(["recover-v6-normalization-journal", "--home", env.state.formaHome, "--backup-dir", selected], env);

    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain("backup-dir");
    expect(recovered.exitCode).toBe(0);
    expect(recovered.stdout).toContain("restored");
  });

  it("requires restore_v6_backup confirmation for restore-v6-normalization-backup", async () => {
    const env = await testEnv();
    await seedLegacyRuntime(env.state.formaHome, { productPatch: { components_initialized: true } });
    await runCli(["schema-normalization-dry-run", "--home", env.state.formaHome], env);
    await runCli(["v6-schema-cutover", "--home", env.state.formaHome], env);
    const backupRoot = join(env.state.formaHome, "normalization-backups");
    const backupDir = join(backupRoot, (await readdir(backupRoot))[0]!);

    const missingConfirm = await runCli(["restore-v6-normalization-backup", "--home", env.state.formaHome, "--backup-dir", backupDir], env);
    const restored = await runCli([
      "restore-v6-normalization-backup",
      "--home",
      env.state.formaHome,
      "--backup-dir",
      backupDir,
      "--confirm",
      "restore_v6_backup"
    ], env);

    expect(missingConfirm.exitCode).toBe(1);
    expect(missingConfirm.stderr).toContain("restore_v6_backup");
    expect(restored.exitCode).toBe(0);
    expect(restored.stdout).toContain("restored");
  });

  it("serve start writes metadata and log files under the Forma home", async () => {
    let env: CliEnv & { state: TestState };
    env = await testEnv({
      now: () => new Date("2026-05-17T12:00:00.000Z"),
      createServeToken: () => "test-token",
      startServer: async (options) => {
        await writeFile(
          join(env.state.formaHome, "serve.state.json"),
          JSON.stringify(
            serveMetadata({
              pid: 4242,
              home: env.state.formaHome,
              token: options?.token,
              started_at: "2026-05-17T12:00:00.000Z",
              log: options?.logFile
            })
          ),
          "utf8"
        );
        return { pid: 4242, message: "server started" };
      }
    });

    const result = await runCli(["serve", "start"], env);

    expect(env.state.startedServers).toEqual([
      expect.objectContaining({ detached: true, token: "test-token", logFile: join(env.state.formaHome, "serve.log") })
    ]);
    await expect(readFile(join(env.state.formaHome, "serve.pid"), "utf8").then(JSON.parse)).resolves.toMatchObject({
      marker: "xenonbyte.forma.serve",
      pid: 4242,
      home: env.state.formaHome,
      token: "test-token",
      started_at: "2026-05-17T12:00:00.000Z",
      log: join(env.state.formaHome, "serve.log")
    });
    await expect(readFile(join(env.state.formaHome, "serve.state.json"), "utf8").then(JSON.parse)).resolves.toMatchObject({
      marker: "xenonbyte.forma.serve",
      pid: 4242,
      home: env.state.formaHome,
      token: "test-token"
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
        await writeFile(
          join(env.state.formaHome, "serve.state.json"),
          JSON.stringify(
            serveMetadata({
              pid: 2222,
              home: env.state.formaHome,
              token: "spawn-token",
              started_at: "2026-05-17T00:00:00.000Z",
              log: join(env.state.formaHome, "serve.log")
            })
          ),
          "utf8"
        );
        return { pid: 2222 };
      },
      useDefaultStartServer: true
    });

    const first = await runCli(["serve", "start"], env);
    const second = await runCli(["serve", "start"], env);

    expect(first.exitCode).toBe(0);
    expect(env.state.spawnedServers).toHaveLength(1);
    expect(env.state.spawnedServers[0]).toMatchObject({
      entrypoint: expect.stringMatching(/packages\/cli\/bin\/forma\.js$/),
      formaHome: env.state.formaHome,
      logFile: join(env.state.formaHome, "serve.log"),
      runtimeFile: join(env.state.formaHome, "serve.state.json"),
      token: "spawn-token"
    });
    await expect(readFile(join(env.state.formaHome, "serve.pid"), "utf8").then(JSON.parse)).resolves.toMatchObject({
      pid: 2222,
      home: env.state.formaHome,
      token: "spawn-token"
    });
    expect(second.exitCode).toBe(1);
    expect(second.stderr).toContain("Forma server is already running");
    expect(env.state.spawnedServers).toHaveLength(1);
  });

  it("foreground internal default server receives the resolved Forma home and bundled styles", async () => {
    const webStarts: unknown[] = [];
    const env = await testEnv({
      startWebServer: async (options) => {
        webStarts.push(options);
      },
      useDefaultStartServer: true
    });

    const result = await runCli(
      [
        "serve",
        "--foreground-internal",
        "--serve-token",
        "child-token",
        "--serve-home",
        env.state.formaHome,
        "--serve-started-at",
        "2026-05-17T00:00:00.000Z"
      ],
      env
    );

    expect(result.exitCode).toBe(0);
    expect(webStarts).toEqual([
      {
        home: env.state.formaHome,
        bundledStylesDir: expect.stringMatching(/packages\/cli\/dist\/assets\/styles$/),
        webAssetsDir: expect.stringMatching(/packages\/cli\/dist\/assets\/web$/)
      }
    ]);
  });

  it("foreground internal rejects a serve home that does not match the resolved Forma home", async () => {
    const env = await testEnv({ useDefaultStartServer: true });

    const result = await runCli(
      [
        "serve",
        "--foreground-internal",
        "--serve-token",
        "child-token",
        "--serve-home",
        join(env.state.home, "other-forma-home"),
        "--serve-started-at",
        "2026-05-17T00:00:00.000Z"
      ],
      env
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("does not match");
  });

  it("serve start fails without a pidfile when detached spawn fails before ready", async () => {
    const env = await testEnv({
      spawnDetachedServer: async () => {
        throw new Error("listen failed");
      },
      useDefaultStartServer: true
    });

    const result = await runCli(["serve", "start"], env);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("listen failed");
    await expect(access(join(env.state.formaHome, "serve.pid"))).rejects.toThrow();
    await expect(access(join(env.state.formaHome, "serve.state.json"))).rejects.toThrow();
  });

  it("serve start fails if detached spawn returns before runtime ready state exists", async () => {
    const env = await testEnv({
      spawnDetachedServer: async () => ({ pid: 3333 }),
      useDefaultStartServer: true
    });

    const result = await runCli(["serve", "start"], env);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("runtime state");
    await expect(access(join(env.state.formaHome, "serve.pid"))).rejects.toThrow();
  });

  it("serve stop kills only a valid Forma metadata pid and removes it", async () => {
    const env = await testEnv({ isPidAlive: (pid) => pid === 9876 });
    await mkdir(env.state.formaHome, { recursive: true });
    await writeFile(join(env.state.formaHome, "serve.pid"), JSON.stringify(serveMetadata({ home: env.state.formaHome, pid: 9876 })), "utf8");
    await writeFile(
      join(env.state.formaHome, "serve.state.json"),
      JSON.stringify(serveMetadata({ home: env.state.formaHome, pid: 9876 })),
      "utf8"
    );

    const result = await runCli(["serve", "stop"], env);

    expect(env.state.killed).toEqual([9876]);
    await expect(access(join(env.state.formaHome, "serve.pid"))).rejects.toThrow();
    await expect(access(join(env.state.formaHome, "serve.state.json"))).rejects.toThrow();
    expect(result.stdout).toContain("Stopped Forma server");
  });

  it("serve stop preserves state files when signalling the process fails", async () => {
    const env = await testEnv({
      isPidAlive: (pid) => pid === 9876,
      killProcess: async (pid) => {
        env.state.killed.push(pid);
        throw Object.assign(new Error("permission denied"), { code: "EPERM" });
      }
    });
    await mkdir(env.state.formaHome, { recursive: true });
    await writeFile(join(env.state.formaHome, "serve.pid"), JSON.stringify(serveMetadata({ home: env.state.formaHome, pid: 9876 })), "utf8");
    await writeFile(
      join(env.state.formaHome, "serve.state.json"),
      JSON.stringify(serveMetadata({ home: env.state.formaHome, pid: 9876 })),
      "utf8"
    );

    const result = await runCli(["serve", "stop"], env);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("permission denied");
    expect(env.state.killed).toEqual([9876]);
    await expect(access(join(env.state.formaHome, "serve.pid"))).resolves.toBeUndefined();
    await expect(access(join(env.state.formaHome, "serve.state.json"))).resolves.toBeUndefined();
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

  it("does not report or kill a valid-looking pidfile without runtime state", async () => {
    const env = await testEnv({
      useDefaultServerStatus: true,
      isPidAlive: () => true
    });
    await mkdir(env.state.formaHome, { recursive: true });
    await writeFile(join(env.state.formaHome, "serve.pid"), JSON.stringify(serveMetadata({ home: env.state.formaHome, pid: 7654 })), "utf8");

    const status = await runCli(["status"], env);
    const stop = await runCli(["serve", "stop"], env);

    expect(status.stdout).toContain("Web server: stopped");
    expect(status.stderr).toContain("runtime state");
    expect(stop.exitCode).toBe(1);
    expect(stop.stderr).toContain("runtime state");
    expect(env.state.killed).toEqual([]);
    await expect(access(join(env.state.formaHome, "serve.pid"))).rejects.toThrow();
  });

  it("does not report or kill when pidfile and runtime state tokens differ", async () => {
    const env = await testEnv({
      useDefaultServerStatus: true,
      isPidAlive: () => true
    });
    await mkdir(env.state.formaHome, { recursive: true });
    await writeFile(
      join(env.state.formaHome, "serve.pid"),
      JSON.stringify(serveMetadata({ home: env.state.formaHome, pid: 4567, token: "pid-token" })),
      "utf8"
    );
    await writeFile(
      join(env.state.formaHome, "serve.state.json"),
      JSON.stringify(serveMetadata({ home: env.state.formaHome, pid: 4567, token: "runtime-token" })),
      "utf8"
    );

    const status = await runCli(["status"], env);
    const stop = await runCli(["serve", "stop"], env);

    expect(status.stdout).toContain("Web server: stopped");
    expect(status.stderr).toContain("does not match");
    expect(stop.exitCode).toBe(1);
    expect(stop.stderr).toContain("does not match");
    expect(env.state.killed).toEqual([]);
  });

  it("does not report or kill when metadata is valid but process ownership cannot be verified", async () => {
    const env = await testEnv({
      useDefaultServerStatus: true,
      isPidAlive: () => true,
      verifyServerProcess: async () => false
    });
    await mkdir(env.state.formaHome, { recursive: true });
    await writeFile(join(env.state.formaHome, "serve.pid"), JSON.stringify(serveMetadata({ home: env.state.formaHome, pid: 6789 })), "utf8");
    await writeFile(
      join(env.state.formaHome, "serve.state.json"),
      JSON.stringify(serveMetadata({ home: env.state.formaHome, pid: 6789 })),
      "utf8"
    );

    const status = await runCli(["status"], env);
    const stop = await runCli(["serve", "stop"], env);

    expect(status.stdout).toContain("Web server: stopped");
    expect(status.stderr).toContain("could not be verified");
    expect(stop.exitCode).toBe(1);
    expect(stop.stderr).toContain("could not be verified");
    expect(env.state.killed).toEqual([]);
  });

  it("does not treat another Forma child from a different home as owned", async () => {
    const startedAt = "2026-05-17T00:00:00.000Z";
    const otherHome = join(tmpdir(), "forma-cli-other-home");
    const env = await testEnv({
      useDefaultServerStatus: true,
      useDefaultVerifyServerProcess: true,
      isPidAlive: (pid) => pid === 5432,
      readProcessCommand: async () =>
        formaServerCommandLine({
          token: "other-token",
          home: otherHome,
          startedAt
        })
    });
    const metadata = serveMetadata({
      home: env.state.formaHome,
      pid: 5432,
      token: "home-a-token",
      started_at: startedAt,
      log: join(env.state.formaHome, "serve.log")
    });
    await mkdir(env.state.formaHome, { recursive: true });
    await writeFile(join(env.state.formaHome, "serve.pid"), JSON.stringify(metadata), "utf8");
    await writeFile(join(env.state.formaHome, "serve.state.json"), JSON.stringify(metadata), "utf8");

    const status = await runCli(["status"], env);
    const stop = await runCli(["serve", "stop"], env);

    expect(status.stdout).toContain("Web server: stopped");
    expect(status.stderr).toContain("could not be verified");
    expect(stop.exitCode).toBe(1);
    expect(stop.stderr).toContain("could not be verified");
    expect(env.state.killed).toEqual([]);
  });

  it("recovers runtime-only state when the process ownership verifies", async () => {
    const env = await testEnv({
      useDefaultServerStatus: true,
      isPidAlive: (pid) => pid === 2468,
      verifyServerProcess: async () => true
    });
    await mkdir(env.state.formaHome, { recursive: true });
    await writeFile(
      join(env.state.formaHome, "serve.state.json"),
      JSON.stringify(serveMetadata({ home: env.state.formaHome, pid: 2468 })),
      "utf8"
    );

    const status = await runCli(["status"], env);
    const stop = await runCli(["serve", "stop"], env);

    expect(status.stdout).toContain("Web server: running");
    expect(stop.exitCode).toBe(0);
    expect(env.state.killed).toEqual([2468]);
    await expect(access(join(env.state.formaHome, "serve.state.json"))).rejects.toThrow();
  });

  it("does not kill runtime-only state when process ownership cannot be verified", async () => {
    const env = await testEnv({
      useDefaultServerStatus: true,
      isPidAlive: () => true,
      verifyServerProcess: async () => false
    });
    await mkdir(env.state.formaHome, { recursive: true });
    await writeFile(
      join(env.state.formaHome, "serve.state.json"),
      JSON.stringify(serveMetadata({ home: env.state.formaHome, pid: 1357 })),
      "utf8"
    );

    const status = await runCli(["status"], env);
    const stop = await runCli(["serve", "stop"], env);

    expect(status.stdout).toContain("Web server: stopped");
    expect(status.stderr).toContain("could not be verified");
    expect(stop.exitCode).toBe(1);
    expect(env.state.killed).toEqual([]);
  });

  it("dispatches install and uninstall to selected platforms", async () => {
    const env = await testEnv();

    await expect(runCli(["install", "--platform", "claude,codex"], env)).resolves.toMatchObject({ exitCode: 0 });
    await expect(runCli(["uninstall", "--platform", "gemini"], env)).resolves.toMatchObject({ exitCode: 0 });

    expect(env.state.installed).toEqual([["claude", "codex"]]);
    expect(env.state.uninstalled).toEqual([["gemini"]]);
  });

  it("passes package-local agent templates to the install service", async () => {
    const env = await testEnv();

    await expect(runCli(["install", "--platform", "claude"], env)).resolves.toMatchObject({ exitCode: 0 });

    expect(env.state.installServiceOptions[0]).toMatchObject({
      formaHome: env.state.formaHome,
      templatesDir: expect.stringMatching(/packages\/cli\/dist\/assets\/agent\/templates$/)
    });
  });

  it("passes forma mcp as the install MCP command when forma is executable on PATH", async () => {
    const env = await testEnv();
    const binDir = join(env.state.tmp, "bin");
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, "forma"), "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(join(binDir, "forma"), 0o755);
    process.env.PATH = binDir;

    await expect(runCli(["install", "--platform", "claude"], env)).resolves.toMatchObject({ exitCode: 0 });

    expect(env.state.installServiceOptions[0]).toMatchObject({
      mcpCommand: { command: "forma", args: ["mcp"] }
    });
  });

  it("passes the package CLI entrypoint as the install MCP command when forma is not on PATH", async () => {
    const env = await testEnv();
    process.env.PATH = join(env.state.tmp, "empty-bin");

    await expect(runCli(["install", "--platform", "claude"], env)).resolves.toMatchObject({ exitCode: 0 });

    expect(env.state.installServiceOptions[0]).toMatchObject({
      mcpCommand: {
        command: process.execPath,
        args: [expect.stringMatching(/packages\/cli\/bin\/forma\.js$/), "mcp"]
      }
    });
  });

  it("rejects invalid platforms", async () => {
    const env = await testEnv();

    const result = await runCli(["install", "--platform", "claude,vscode"], env);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid platform: vscode");
    expect(env.state.installed).toEqual([]);
  });

  it("prints status with data directory, installed platforms, and server state", async () => {
    const env = await testEnv({
      installedPlatforms: async () => ["claude", "gemini"],
      isServerRunning: async () => true
    });

    const result = await runCli(["status"], env);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Data directory: ${env.state.formaHome}`);
    expect(result.stdout).toContain("Installed platforms: claude, gemini");
    expect(result.stdout).toContain("Web server: running");
    expect(result.stdout).not.toContain("Pencil");
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
    expect(result.stdout).toContain("Web server: stopped");
    expect(result.stderr).toContain("Invalid manifest for claude");
  });
});

type TestEnvOverrides = Partial<CliEnv> & {
  useDefaultInstalledPlatforms?: boolean;
  useDefaultServerStatus?: boolean;
  useDefaultStartServer?: boolean;
  useDefaultVerifyServerProcess?: boolean;
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
    installServiceOptions: []
  };
  states.push(state);

  const env: CliEnv & { state: TestState } = {
    state,
    formaHome,
    currentPid: overrides.currentPid ?? 1234,
    now: overrides.now ?? (() => new Date("2026-05-17T00:00:00.000Z")),
    createServeToken: overrides.createServeToken,
    isPidAlive: overrides.isPidAlive,
    verifyServerProcess: overrides.useDefaultVerifyServerProcess ? undefined : overrides.verifyServerProcess ?? (async () => true),
    readProcessCommand: overrides.readProcessCommand,
    spawnDetachedServer: overrides.spawnDetachedServer,
    startWebServer: overrides.startWebServer,
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
      ((options) => {
        state.installServiceOptions.push(options);
        return {
          installPlatforms: async (platforms) => {
            state.installed.push([...platforms]);
          },
          uninstallPlatforms: async (platforms) => {
            state.uninstalled.push([...platforms]);
          }
        };
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

async function seedLegacyRuntime(
  home: string,
  options: { productPatch?: Record<string, unknown>; pagePatch?: Record<string, unknown> } = {}
): Promise<void> {
  const createdAt = "2026-05-21T00:00:00.000Z";
  await writeYamlAtomic(join(home, "data", "products.yaml"), {
    products: [{ id: "P-123abc", name: "Shop", description: "Shop app" }]
  });
  await writeYamlAtomic(join(home, "data", "P-123abc", "product.yaml"), {
    id: "P-123abc",
    name: "Shop",
    description: "Shop app",
    ...options.productPatch
  });
  await writeYamlAtomic(join(home, "data", "P-123abc", "R-11111111", "requirement.yaml"), {
    id: "R-11111111",
    product_id: "P-123abc",
    title: "Login",
    status: "submitted",
    ui_affected: true,
    created_at: createdAt,
    updated_at: createdAt,
    pages: [
      {
        page_id: "login",
        name: "Login",
        baseline_page: "login",
        design_status: "pending",
        copy: [{ context: "cta", text: "Sign in" }],
        ...options.pagePatch
      }
    ],
    navigation: []
  });
  await writeYamlAtomic(join(home, "data", "P-123abc", "baseline", "baseline.yaml"), {
    product_id: "P-123abc",
    pages: [
      {
        id: "login",
        name: "Login",
        features: "",
        copy: [{ context: "cta", text: "Sign in" }],
        fields: "free-text field notes",
        interactions: "free-text interaction notes",
        source_requirements: ["R-11111111"]
      }
    ],
    navigation: []
  });
}

function serveMetadata(overrides: Partial<{ home: string; pid: number; token: string; started_at: string; log: string }> = {}) {
  return {
    schema_version: 1,
    marker: "xenonbyte.forma.serve",
    home: overrides.home ?? "/tmp/forma-home",
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

function formaServerCommandLine(options: { token: string; home: string; startedAt: string }): string {
  return [
    process.execPath,
    fileURLToPath(new URL("../bin/forma.js", import.meta.url)),
    "serve",
    "--foreground-internal",
    "--serve-token",
    options.token,
    "--serve-home",
    options.home,
    "--serve-started-at",
    options.startedAt
  ].join(" ");
}
