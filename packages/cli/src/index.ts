import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, closeSync, constants, openSync, readFileSync, rmSync } from "node:fs";
import { access, appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  InstallService,
  PencilService,
  formaCoreVersion,
  normalizeFormaHomeForV6,
  recoverV6NormalizationJournal,
  readYaml,
  restoreV6NormalizationBackup,
  type AgentInstallPlatform,
  type FormaMcpCommand,
  type InstallManifest,
  type InstallServiceOptions
} from "@xenonbyte/forma-core";
import { start as startMcpServer } from "@xenonbyte/forma-mcp";
import { start as startWebServer } from "@xenonbyte/forma-server";

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliServeOptions {
  detached?: boolean;
  entrypoint?: string;
  formaHome?: string;
  logFile?: string;
  runtimeFile?: string;
  startedAt?: string;
  token?: string;
}

export type CliServerStartResult = string | void | { pid?: number; message?: string };

export interface CliSpawnDetachedServerOptions {
  entrypoint: string;
  formaHome: string;
  logFile: string;
  runtimeFile: string;
  startedAt: string;
  token: string;
  readyTimeoutMs?: number;
}

export interface CliSpawnDetachedServerResult {
  pid: number;
}

export interface CliInstallService {
  installPlatforms(platforms: AgentInstallPlatform[]): Promise<void>;
  uninstallPlatforms(platforms: AgentInstallPlatform[]): Promise<void>;
}

export type CliInstallServiceOptions = Pick<InstallServiceOptions, "formaHome" | "templatesDir" | "mcpCommand">;

export type CliPencilStatus =
  | { available: true; authenticated: true; message?: string }
  | { available: true; authenticated: false; message?: string }
  | { available: false; authenticated: false; message?: string };

export interface CliEnv {
  formaHome?: string;
  currentPid?: number;
  now?: () => Date;
  startMcp?: () => Promise<string | void>;
  startServer?: (options?: CliServeOptions) => Promise<CliServerStartResult>;
  startWebServer?: (options: { home: string; bundledStylesDir?: string; webAssetsDir?: string }) => Promise<void>;
  createInstallService?: (options: CliInstallServiceOptions) => CliInstallService;
  checkPencil?: () => Promise<CliPencilStatus>;
  installedPlatforms?: () => Promise<AgentInstallPlatform[]>;
  isServerRunning?: () => Promise<boolean>;
  isPidAlive?: (pid: number) => boolean;
  verifyServerProcess?: (metadata: CliServeMetadata) => Promise<boolean> | boolean;
  readProcessCommand?: (pid: number) => Promise<string>;
  createServeToken?: () => string;
  spawnDetachedServer?: (options: CliSpawnDetachedServerOptions) => Promise<CliSpawnDetachedServerResult>;
  killProcess?: (pid: number) => Promise<void> | void;
  readText?: (file: string) => Promise<string>;
  writeText?: (file: string, content: string) => Promise<void>;
  appendText?: (file: string, content: string) => Promise<void>;
  removeFile?: (file: string) => Promise<void>;
  mkdir?: (dir: string) => Promise<void>;
  pathExists?: (file: string) => Promise<boolean>;
}

interface CliInstalledPlatformsStatus {
  platforms: AgentInstallPlatform[];
  warnings: string[];
}

interface CliServerStatus {
  running: boolean;
  warning?: string;
}

interface RuntimeCliEnv {
  formaHome: string;
  currentPid: number;
  now: () => Date;
  startMcp: () => Promise<string | void>;
  startServer: (options?: CliServeOptions) => Promise<CliServerStartResult>;
  createInstallService: () => CliInstallService;
  checkPencil: () => Promise<CliPencilStatus>;
  getInstalledPlatforms: () => Promise<CliInstalledPlatformsStatus>;
  getServerStatus: () => Promise<CliServerStatus>;
  isPidAlive: (pid: number) => boolean;
  verifyServerProcess: (metadata: ServeMetadata) => Promise<boolean>;
  createServeToken: () => string;
  spawnDetachedServer: (options: CliSpawnDetachedServerOptions) => Promise<CliSpawnDetachedServerResult>;
  killProcess: (pid: number) => Promise<void> | void;
  readText: (file: string) => Promise<string>;
  writeText: (file: string, content: string) => Promise<void>;
  appendText: (file: string, content: string) => Promise<void>;
  removeFile: (file: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
  pathExists: (file: string) => Promise<boolean>;
}

export interface CliServeMetadata {
  schema_version: 1;
  marker: typeof servePidMarker;
  home: string;
  pid: number;
  token: string;
  started_at: string;
  log: string;
}

type ServeMetadata = CliServeMetadata;

type ServeState =
  | { kind: "missing" }
  | { kind: "invalid"; reason: string }
  | { kind: "valid"; metadata: ServeMetadata };

const supportedPlatforms = ["claude", "codex", "gemini"] as const satisfies readonly AgentInstallPlatform[];
const servePidMarker = "xenonbyte.forma.serve";

export async function runCli(argv: string[] = process.argv.slice(2), env: CliEnv = {}): Promise<CliResult> {
  const runtimeEnv = resolveCliEnv(env);
  const output = createOutput();
  const [command, ...args] = argv;

  try {
    if (!command || command === "--help" || command === "-h" || command === "help") {
      output.stdout(usage());
      return output.result(0);
    }

    if (command === "version" || command === "--version" || command === "-v") {
      output.stdout(`forma ${formaCoreVersion}\n`);
      return output.result(0);
    }

    if (command === "mcp") {
      return output.result(await writeCommandReturn(output, runtimeEnv.startMcp()));
    }

    if (command === "serve") {
      return await runServe(args, runtimeEnv, output);
    }

    if (command === "schema-normalization-dry-run") {
      return await runSchemaNormalizationDryRun(args, runtimeEnv, output);
    }

    if (command === "v6-schema-cutover") {
      return await runV6SchemaCutoverCommand(args, runtimeEnv, output);
    }

    if (command === "recover-v6-normalization-journal") {
      return await runRecoverV6NormalizationJournal(args, runtimeEnv, output);
    }

    if (command === "restore-v6-normalization-backup") {
      return await runRestoreV6NormalizationBackup(args, runtimeEnv, output);
    }

    if (command === "install") {
      return await runInstall(args, runtimeEnv, output);
    }

    if (command === "uninstall") {
      return await runUninstall(args, runtimeEnv, output);
    }

    if (command === "status") {
      return await runStatus(args, runtimeEnv, output);
    }

    output.stderr(`Unknown command: ${command}\n\n${usage()}`);
    return output.result(1);
  } catch (error) {
    output.stderr(`${errorMessage(error)}\n`);
    return output.result(1);
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const result = await runCli(argv);
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

async function runServe(args: string[], env: RuntimeCliEnv, output: CliOutput): Promise<CliResult> {
  const [subcommand, ...rest] = args;
  if (!subcommand) {
    assertNoExtraArgs(rest);
    return output.result(await writeCommandReturn(output, env.startServer({})));
  }

  if (subcommand === "--foreground-internal") {
    return await runForegroundServeChild(rest, env, output);
  }

  if (subcommand === "start") {
    assertNoExtraArgs(rest);
    await ensureFormaHome(env);

    const existing = await readVerifiedServeState(env);
    if (existing.kind === "valid") {
      output.stderr(`Forma server is already running (${existing.metadata.pid})\n`);
      return output.result(1);
    }
    if (existing.kind !== "missing") {
      await removeServeStateFiles(env);
      if (existing.kind === "invalid") {
        output.stderr(`Invalid Forma server state removed: ${existing.reason}\n`);
      }
    }

    const startedAt = env.now().toISOString();
    const token = env.createServeToken();
    const logFile = serveLogFile(env.formaHome);
    const runtimeFile = serveRuntimeFile(env.formaHome);
    const started = await env.startServer({ detached: true, formaHome: env.formaHome, logFile, runtimeFile, startedAt, token });
    const pid = startedPid(started);
    if (!pid) {
      throw new Error("Detached Forma server start did not return a pid");
    }
    const metadata = createServeMetadata({ home: env.formaHome, pid, token, startedAt, logFile });
    const readyState = await readOwnedServeState(env, metadata);
    if (readyState.kind !== "valid") {
      await removeServeStateFiles(env);
      throw new Error(`Detached Forma server did not publish matching runtime state: ${readyState.kind === "invalid" ? readyState.reason : "runtime state missing"}`);
    }
    await writeServePidState(env, metadata);
    await env.appendText(logFile, `${startedAt} forma serve start pid=${pid}\n`);
    const message = startedMessage(started);
    if (message) {
      output.stdout(`${message}\n`);
    }
    output.stdout(`Forma server started with pid ${pid}\n`);
    return output.result(0);
  }

  if (subcommand === "stop") {
    assertNoExtraArgs(rest);
    return await stopServer(env, output);
  }

  output.stderr(`Unknown serve command: ${subcommand}\n`);
  return output.result(1);
}

async function runInstall(args: string[], env: RuntimeCliEnv, output: CliOutput): Promise<CliResult> {
  const platforms = parsePlatformArgs(args);
  await env.createInstallService().installPlatforms(platforms);
  output.stdout(`Installed Forma commands for ${formatPlatforms(platforms)}\n`);
  return output.result(0);
}

async function runUninstall(args: string[], env: RuntimeCliEnv, output: CliOutput): Promise<CliResult> {
  const platforms = parsePlatformArgs(args);
  await env.createInstallService().uninstallPlatforms(platforms);
  output.stdout(`Uninstalled Forma commands for ${formatPlatforms(platforms)}\n`);
  return output.result(0);
}

async function runSchemaNormalizationDryRun(args: string[], env: RuntimeCliEnv, output: CliOutput): Promise<CliResult> {
  const options = parseNormalizationArgs(args, { backupDir: false, confirm: false });
  const home = options.home ?? env.formaHome;
  const report = await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt: env.now().toISOString() });
  output.stdout(`Schema normalization dry-run report: ${report.report_file}\n`);
  output.stdout(`Status: ${report.status}\n`);
  return output.result(report.status === "passed" || report.status === "failed" ? 0 : 1);
}

async function runV6SchemaCutoverCommand(args: string[], env: RuntimeCliEnv, output: CliOutput): Promise<CliResult> {
  const options = parseNormalizationArgs(args, { backupDir: false, confirm: false });
  const home = options.home ?? env.formaHome;
  const result = await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: env.now().toISOString(), reportPath: options.report });
  if (result.status !== "committed") {
    output.stderr(`${result.code ?? "SCHEMA_NORMALIZATION_CUTOVER_FAILED"}: ${result.message}\n`);
    return output.result(1);
  }
  output.stdout(`Schema normalization cutover committed: ${result.backup_dir}\n`);
  return output.result(0);
}

async function runRecoverV6NormalizationJournal(args: string[], env: RuntimeCliEnv, output: CliOutput): Promise<CliResult> {
  const options = parseNormalizationArgs(args, { backupDir: true, confirm: false });
  const home = options.home ?? env.formaHome;
  const result = await recoverV6NormalizationJournal(home, options.backupDir!);
  output.stdout(`Schema normalization journal ${result.status}: ${result.restore_status}\n`);
  return output.result(result.status === "restored" ? 0 : 1);
}

async function runRestoreV6NormalizationBackup(args: string[], env: RuntimeCliEnv, output: CliOutput): Promise<CliResult> {
  const options = parseNormalizationArgs(args, { backupDir: true, confirm: true });
  const home = options.home ?? env.formaHome;
  const result = await restoreV6NormalizationBackup(home, options.backupDir!, { confirm: options.confirm ?? "" });
  output.stdout(`Schema normalization backup ${result.status}: ${result.restore_status}\n`);
  return output.result(result.status === "restored" ? 0 : 1);
}

async function runStatus(args: string[], env: RuntimeCliEnv, output: CliOutput): Promise<CliResult> {
  assertNoExtraArgs(args);

  const [installed, pencil, serverStatus] = await Promise.all([
    env.getInstalledPlatforms(),
    env.checkPencil(),
    env.getServerStatus()
  ]);

  for (const warning of installed.warnings) {
    output.stderr(`${warning}\n`);
  }
  if (serverStatus.warning) {
    output.stderr(`${serverStatus.warning}\n`);
  }

  output.stdout(`Data directory: ${env.formaHome}\n`);
  output.stdout(`Installed platforms: ${installed.platforms.length > 0 ? formatPlatforms(installed.platforms) : "none"}\n`);
  output.stdout(`Pencil CLI: ${pencil.available ? "available" : "not found"}\n`);
  output.stdout(`Pencil authentication: ${pencil.authenticated ? "authenticated" : "not authenticated"}\n`);
  output.stdout(`Web server: ${serverStatus.running ? "running" : "stopped"}\n`);
  return output.result(0);
}

async function stopServer(env: RuntimeCliEnv, output: CliOutput): Promise<CliResult> {
  const state = await readVerifiedServeState(env);
  if (state.kind === "missing") {
    output.stdout("Forma server is not running\n");
    return output.result(0);
  }
  if (state.kind === "invalid") {
    await removeServeStateFiles(env);
    output.stderr(`Invalid Forma server state removed: ${state.reason}\n`);
    return output.result(1);
  }

  const { pid } = state.metadata;
  try {
    await env.killProcess(pid);
    await removeServeStateFiles(env);
    output.stdout(`Stopped Forma server (${pid})\n`);
    return output.result(0);
  } catch (error) {
    if (isMissingProcessError(error)) {
      await removeServeStateFiles(env);
      output.stdout(`Removed stale Forma server pid (${pid})\n`);
      return output.result(0);
    }
    throw error;
  }
}

async function writeCommandReturn(output: CliOutput, value: Promise<CliServerStartResult>): Promise<number> {
  const result = await value;
  const message = startedMessage(result);
  if (message) {
    output.stdout(`${message}\n`);
  }
  return 0;
}

async function runForegroundServeChild(args: string[], env: RuntimeCliEnv, output: CliOutput): Promise<CliResult> {
  const options = parseForegroundServeArgs(args);
  const token = options.token ?? process.env.FORMA_SERVE_TOKEN;
  const serveHome = options.home ?? process.env.FORMA_HOME ?? env.formaHome;
  if (serveHome !== env.formaHome) {
    throw new Error(`Foreground serve home ${serveHome} does not match resolved Forma home ${env.formaHome}`);
  }
  const runtimeFile = process.env.FORMA_SERVE_READY_FILE;
  const startedAt = options.startedAt ?? process.env.FORMA_SERVE_STARTED_AT ?? env.now().toISOString();
  const logFile = process.env.FORMA_SERVE_LOG_FILE ?? serveLogFile(env.formaHome);

  await writeCommandReturn(output, env.startServer({}));

  if (token && runtimeFile) {
    const metadata = createServeMetadata({ home: env.formaHome, pid: env.currentPid, token, startedAt, logFile });
    await env.writeText(runtimeFile, `${JSON.stringify(metadata, null, 2)}\n`);
    installServeCleanupHandlers(env.formaHome, metadata);
  }

  return output.result(0);
}

function createServeMetadata(state: { home: string; pid: number; token: string; startedAt: string; logFile: string }): ServeMetadata {
  return {
    schema_version: 1,
    marker: servePidMarker,
    home: state.home,
    pid: state.pid,
    token: state.token,
    started_at: state.startedAt,
    log: state.logFile
  };
}

async function writeServePidState(env: RuntimeCliEnv, metadata: ServeMetadata): Promise<void> {
  await env.writeText(servePidFile(env.formaHome), `${JSON.stringify(metadata, null, 2)}\n`);
}

async function removeServeStateFiles(env: RuntimeCliEnv): Promise<void> {
  await Promise.all([
    env.removeFile(servePidFile(env.formaHome)),
    env.removeFile(serveRuntimeFile(env.formaHome))
  ]);
}

function parseForegroundServeArgs(args: string[]): { token?: string; home?: string; startedAt?: string } {
  const options: { token?: string; home?: string; startedAt?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--serve-token") {
      options.token = requireOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--serve-home") {
      options.home = requireOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--serve-started-at") {
      options.startedAt = requireOptionValue(args, index, arg);
      if (!Number.isFinite(Date.parse(options.startedAt))) {
        throw new Error("Invalid value for --serve-started-at");
      }
      index += 1;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }
  return options;
}

function requireOptionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function parsePlatformArgs(args: string[]): AgentInstallPlatform[] {
  let rawPlatforms: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--platform") {
      rawPlatforms = args[index + 1];
      index += 1;
      if (!rawPlatforms) {
        throw new Error("Missing value for --platform");
      }
      continue;
    }
    if (arg.startsWith("--platform=")) {
      rawPlatforms = arg.slice("--platform=".length);
      if (!rawPlatforms) {
        throw new Error("Missing value for --platform");
      }
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!rawPlatforms) {
    return [...supportedPlatforms];
  }

  const platforms = rawPlatforms
    .split(",")
    .map((platform) => platform.trim())
    .filter(Boolean);

  if (platforms.length === 0) {
    throw new Error("Missing value for --platform");
  }

  const selected: AgentInstallPlatform[] = [];
  for (const platform of platforms) {
    if (!isSupportedPlatform(platform)) {
      throw new Error(`Invalid platform: ${platform}`);
    }
    if (!selected.includes(platform)) {
      selected.push(platform);
    }
  }
  return selected;
}

function parseNormalizationArgs(
  args: string[],
  required: { backupDir: boolean; confirm: boolean }
): { home?: string; backupDir?: string; confirm?: string; report?: string } {
  const options: { home?: string; backupDir?: string; confirm?: string; report?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--home") {
      options.home = requireOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--backup-dir") {
      options.backupDir = requireOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--confirm") {
      options.confirm = requireOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--preflight-report" || arg === "--report") {
      options.report = requireOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (required.backupDir && !options.backupDir) {
    throw new Error("Missing value for --backup-dir");
  }
  if (required.confirm && options.confirm !== "restore_v6_backup") {
    throw new Error("Missing required confirmation: --confirm restore_v6_backup");
  }
  return options;
}

function resolveCliEnv(env: CliEnv): RuntimeCliEnv {
  const formaHome = env.formaHome ?? defaultFormaHome();
  const currentPid = env.currentPid ?? process.pid;
  const readText = env.readText ?? ((file) => readFile(file, "utf8"));
  const pathExists = env.pathExists ?? defaultPathExists;
  const isPidAlive = env.isPidAlive ?? defaultIsPidAlive;
  const readProcessCommand = env.readProcessCommand ?? defaultReadProcessCommand;
  const verifyServerProcess = async (metadata: ServeMetadata): Promise<boolean> => {
    return await (env.verifyServerProcess?.(metadata) ?? defaultVerifyServerProcess(metadata, readProcessCommand));
  };
  const spawnDetachedServer = env.spawnDetachedServer ?? defaultSpawnDetachedServer;
  const launchWebServer = env.startWebServer ?? ((options: { home: string; bundledStylesDir?: string; webAssetsDir?: string }) => startWebServer(options));
  const bundledStylesDir = packageBundledStylesDir();
  const webAssetsDir = packageWebAssetsDir();
  const installServiceOptions = { formaHome, templatesDir: packageAgentTemplatesDir(), mcpCommand: resolveInstallMcpCommand() };
  const runtimeEnv: RuntimeCliEnv = {
    formaHome,
    currentPid,
    now: env.now ?? (() => new Date()),
    startMcp: env.startMcp ?? (() => startMcpServer({ home: formaHome, bundledStylesDir })),
    startServer:
      env.startServer ??
      (async (options) => {
        if (options?.detached) {
          return await spawnDetachedServer({
            entrypoint: options.entrypoint ?? packageCliEntrypoint(),
            formaHome: options.formaHome ?? formaHome,
            logFile: options.logFile ?? serveLogFile(formaHome),
            runtimeFile: options.runtimeFile ?? serveRuntimeFile(formaHome),
            startedAt: options.startedAt ?? new Date().toISOString(),
            token: options.token ?? randomUUID()
          });
        }
        await launchWebServer({ home: formaHome, bundledStylesDir, webAssetsDir });
        return undefined;
      }),
    createInstallService: () => (env.createInstallService ? env.createInstallService(installServiceOptions) : new InstallService(installServiceOptions)),
    checkPencil: env.checkPencil ?? (() => checkPencil(formaHome)),
    getInstalledPlatforms: env.installedPlatforms
      ? async () => ({ platforms: await env.installedPlatforms!(), warnings: [] })
      : () => readInstalledPlatforms(formaHome, pathExists),
    getServerStatus: env.isServerRunning
      ? async () => ({ running: await env.isServerRunning!() })
      : () => readServerStatus(formaHome, readText, pathExists, isPidAlive, verifyServerProcess),
    isPidAlive,
    verifyServerProcess,
    createServeToken: env.createServeToken ?? randomUUID,
    spawnDetachedServer,
    killProcess: env.killProcess ?? defaultKillProcess,
    readText,
    writeText:
      env.writeText ??
      (async (file, content) => {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, content, "utf8");
      }),
    appendText:
      env.appendText ??
      (async (file, content) => {
        await mkdir(dirname(file), { recursive: true });
        await appendFile(file, content, "utf8");
      }),
    removeFile: env.removeFile ?? ((file) => rm(file, { force: true })),
    mkdir: env.mkdir ?? ((dir) => mkdir(dir, { recursive: true }).then(() => undefined)),
    pathExists
  };
  return runtimeEnv;
}

async function checkPencil(formaHome: string): Promise<CliPencilStatus> {
  try {
    await new PencilService({ home: formaHome }).checkAvailability();
    return { available: true, authenticated: true };
  } catch (error) {
    if (isFormaErrorCode(error, "PENCIL_CLI_NOT_FOUND")) {
      return { available: false, authenticated: false, message: errorMessage(error) };
    }
    if (isFormaErrorCode(error, "PENCIL_NOT_AUTHENTICATED")) {
      return { available: true, authenticated: false, message: errorMessage(error) };
    }
    throw error;
  }
}

async function readInstalledPlatforms(
  formaHome: string,
  pathExists: (file: string) => Promise<boolean>
): Promise<CliInstalledPlatformsStatus> {
  const manifestsDir = join(formaHome, "manifests");
  const installed: AgentInstallPlatform[] = [];
  const warnings: string[] = [];
  for (const platform of supportedPlatforms) {
    const manifestFile = join(manifestsDir, `${platform}.manifest`);
    if (!(await pathExists(manifestFile))) {
      continue;
    }
    try {
      const manifest = await readYaml<InstallManifest>(manifestFile);
      if (manifest.platform === platform) {
        installed.push(platform);
      } else {
        warnings.push(`Invalid manifest for ${platform}: platform is ${String(manifest.platform)}`);
      }
    } catch (error) {
      warnings.push(`Invalid manifest for ${platform}: ${errorMessage(error)}`);
    }
  }
  return { platforms: installed, warnings };
}

async function readServerStatus(
  formaHome: string,
  readText: (file: string) => Promise<string>,
  pathExists: (file: string) => Promise<boolean>,
  isPidAlive: (pid: number) => boolean,
  verifyServerProcess: (metadata: ServeMetadata) => Promise<boolean>
): Promise<CliServerStatus> {
  const state = await readOwnedServeStateFromPaths(formaHome, readText, pathExists);
  if (state.kind === "missing") {
    return { running: false };
  }
  if (state.kind === "invalid") {
    return { running: false, warning: `Invalid Forma server state: ${state.reason}` };
  }
  const verified = await verifyServeOwnership(state.metadata, isPidAlive, verifyServerProcess);
  if (!verified.ok) {
    return { running: false, warning: verified.reason };
  }
  return { running: true };
}

async function readOwnedServeState(env: RuntimeCliEnv, expected?: ServeMetadata): Promise<ServeState> {
  return await readOwnedServeStateFromPaths(env.formaHome, env.readText, env.pathExists, expected);
}

async function readVerifiedServeState(env: RuntimeCliEnv): Promise<ServeState> {
  const state = await readOwnedServeState(env);
  if (state.kind !== "valid") {
    return state;
  }
  const verified = await verifyServeOwnership(state.metadata, env.isPidAlive, env.verifyServerProcess);
  if (!verified.ok) {
    return { kind: "invalid", reason: verified.reason };
  }
  return state;
}

async function verifyServeOwnership(
  metadata: ServeMetadata,
  isPidAlive: (pid: number) => boolean,
  verifyServerProcess: (metadata: ServeMetadata) => Promise<boolean>
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isPidAlive(metadata.pid)) {
    return { ok: false, reason: `Forma server process ${metadata.pid} is not running` };
  }
  if (!(await verifyServerProcess(metadata))) {
    return { ok: false, reason: `Forma server process ${metadata.pid} could not be verified` };
  }
  return { ok: true };
}

async function readOwnedServeStateFromPaths(
  formaHome: string,
  readText: (file: string) => Promise<string>,
  pathExists: (file: string) => Promise<boolean>,
  expected?: ServeMetadata
): Promise<ServeState> {
  const pidState = expected
    ? { kind: "valid" as const, metadata: expected }
    : await readServeStateFromPaths(servePidFile(formaHome), readText, pathExists, formaHome);
  const runtimeState = await readServeStateFromPaths(serveRuntimeFile(formaHome), readText, pathExists, formaHome);

  if (!expected && pidState.kind === "missing") {
    if (runtimeState.kind === "missing") {
      return { kind: "missing" };
    }
    return runtimeState;
  }

  if (pidState.kind !== "valid") {
    return pidState;
  }

  if (runtimeState.kind === "missing") {
    return { kind: "invalid", reason: `${serveRuntimeFile(formaHome)} runtime state is missing` };
  }
  if (runtimeState.kind === "invalid") {
    return runtimeState;
  }
  if (!serveMetadataMatches(pidState.metadata, runtimeState.metadata)) {
    return { kind: "invalid", reason: `${serveRuntimeFile(formaHome)} does not match ${servePidFile(formaHome)}` };
  }

  return pidState;
}

async function readServeStateFromPaths(
  file: string,
  readText: (file: string) => Promise<string>,
  pathExists: (file: string) => Promise<boolean>,
  expectedHome?: string
): Promise<ServeState> {
  if (!(await pathExists(file))) {
    return { kind: "missing" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readText(file));
  } catch {
    return { kind: "invalid", reason: `${file} is not Forma JSON metadata` };
  }
  return parseServeMetadata(parsed, file, expectedHome);
}

function parseServeMetadata(value: unknown, file: string, expectedHome?: string): ServeState {
  if (!isRecord(value)) {
    return { kind: "invalid", reason: `${file} is not an object` };
  }
  if (value.marker !== servePidMarker) {
    return { kind: "invalid", reason: `${file} does not contain a Forma marker` };
  }
  if (value.schema_version !== 1) {
    return { kind: "invalid", reason: `${file} has unsupported schema_version` };
  }
  if (typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 0) {
    return { kind: "invalid", reason: `${file} has invalid pid` };
  }
  if (typeof value.home !== "string" || value.home.length === 0) {
    return { kind: "invalid", reason: `${file} has invalid home` };
  }
  if (expectedHome && value.home !== expectedHome) {
    return { kind: "invalid", reason: `${file} belongs to ${value.home}, not ${expectedHome}` };
  }
  if (typeof value.token !== "string" || value.token.length === 0) {
    return { kind: "invalid", reason: `${file} has invalid token` };
  }
  if (typeof value.started_at !== "string" || !Number.isFinite(Date.parse(value.started_at))) {
    return { kind: "invalid", reason: `${file} has invalid started_at` };
  }
  if (typeof value.log !== "string" || value.log.length === 0) {
    return { kind: "invalid", reason: `${file} has invalid log` };
  }
  return {
    kind: "valid",
    metadata: {
      schema_version: 1,
      marker: servePidMarker,
      home: value.home,
      pid: value.pid,
      token: value.token,
      started_at: value.started_at,
      log: value.log
    }
  };
}

async function ensureFormaHome(env: RuntimeCliEnv): Promise<void> {
  await env.mkdir(env.formaHome);
}

function servePidFile(formaHome: string): string {
  return join(formaHome, "serve.pid");
}

function serveLogFile(formaHome: string): string {
  return join(formaHome, "serve.log");
}

function serveRuntimeFile(formaHome: string): string {
  return join(formaHome, "serve.state.json");
}

function formatPlatforms(platforms: AgentInstallPlatform[]): string {
  return platforms.join(", ");
}

function serveMetadataMatches(left: ServeMetadata, right: ServeMetadata): boolean {
  return (
    left.home === right.home &&
    left.pid === right.pid &&
    left.token === right.token &&
    left.started_at === right.started_at &&
    left.log === right.log
  );
}

function startedPid(result: CliServerStartResult): number | undefined {
  if (result && typeof result === "object" && typeof result.pid === "number" && Number.isInteger(result.pid) && result.pid > 0) {
    return result.pid;
  }
  return undefined;
}

function startedMessage(result: CliServerStartResult): string | undefined {
  if (typeof result === "string" && result.length > 0) {
    return result;
  }
  if (result && typeof result === "object" && typeof result.message === "string" && result.message.length > 0) {
    return result.message;
  }
  return undefined;
}

function isSupportedPlatform(platform: string): platform is AgentInstallPlatform {
  return supportedPlatforms.includes(platform as AgentInstallPlatform);
}

function assertNoExtraArgs(args: string[]): void {
  if (args.length > 0) {
    throw new Error(`Unexpected argument: ${args[0]}`);
  }
}

function usage(): string {
  return [
    "Usage: forma <command>",
    "",
    "Commands:",
    "  mcp",
    "  serve [start|stop]",
    "  schema-normalization-dry-run [--home path]",
    "  v6-schema-cutover [--home path] [--preflight-report path]",
    "  recover-v6-normalization-journal [--home path] --backup-dir path",
    "  restore-v6-normalization-backup [--home path] --backup-dir path --confirm restore_v6_backup",
    "  install [--platform claude,codex,gemini]",
    "  uninstall [--platform claude,codex,gemini]",
    "  status",
    "  version"
  ].join("\n").concat("\n");
}

interface CliOutput {
  stdout(content: string): void;
  stderr(content: string): void;
  result(exitCode: number): CliResult;
}

function createOutput(): CliOutput {
  let stdout = "";
  let stderr = "";
  return {
    stdout(content) {
      stdout += content;
    },
    stderr(content) {
      stderr += content;
    },
    result(exitCode) {
      return { stdout, stderr, exitCode };
    }
  };
}

function defaultFormaHome(): string {
  return process.env.FORMA_HOME ?? join(homedir(), ".forma");
}

function packageCliEntrypoint(): string {
  return join(packageRoot(), "bin", "forma.js");
}

function resolveInstallMcpCommand(): FormaMcpCommand {
  return executableOnPath("forma")
    ? { command: "forma", args: ["mcp"] }
    : { command: process.execPath, args: [packageCliEntrypoint(), "mcp"] };
}

function executableOnPath(command: string): boolean {
  for (const pathDir of (process.env.PATH ?? "").split(delimiter)) {
    if (!pathDir) {
      continue;
    }
    try {
      accessSync(join(pathDir, command), constants.X_OK);
      return true;
    } catch {
      // Keep scanning PATH.
    }
  }
  return false;
}

function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

function packageAssetPath(...segments: string[]): string {
  return join(packageRoot(), "dist", "assets", ...segments);
}

function packageAgentTemplatesDir(): string {
  return packageAssetPath("agent", "templates");
}

function packageBundledStylesDir(): string {
  return packageAssetPath("styles");
}

function packageWebAssetsDir(): string {
  return packageAssetPath("web");
}

async function defaultSpawnDetachedServer(options: CliSpawnDetachedServerOptions): Promise<CliSpawnDetachedServerResult> {
  await mkdir(dirname(options.logFile), { recursive: true });
  const logFd = openSync(options.logFile, "a");
  let childPid: number | undefined;
  try {
    const child = spawn(
      process.execPath,
      [
        options.entrypoint,
        "serve",
        "--foreground-internal",
        "--serve-token",
        options.token,
        "--serve-home",
        options.formaHome,
        "--serve-started-at",
        options.startedAt
      ],
      {
        cwd: process.cwd(),
        detached: true,
        env: {
          ...process.env,
          FORMA_HOME: options.formaHome,
          FORMA_SERVE_LOG_FILE: options.logFile,
          FORMA_SERVE_READY_FILE: options.runtimeFile,
          FORMA_SERVE_STARTED_AT: options.startedAt,
          FORMA_SERVE_TOKEN: options.token
        },
        stdio: ["ignore", logFd, logFd]
      }
    );
    if (!child.pid) {
      throw new Error("Background Forma server did not expose a pid");
    }
    childPid = child.pid;
    await waitForDetachedServerReady(child, options);
    child.unref();
    return { pid: child.pid };
  } catch (error) {
    if (childPid) {
      try {
        process.kill(childPid, "SIGTERM");
      } catch {
        // The process may already have exited before readiness was observed.
      }
    }
    throw error;
  } finally {
    closeSync(logFd);
  }
}

async function waitForDetachedServerReady(
  child: ReturnType<typeof spawn>,
  options: CliSpawnDetachedServerOptions
): Promise<void> {
  const timeoutMs = options.readyTimeoutMs ?? 5000;
  const expected = createServeMetadata({
    pid: child.pid ?? -1,
    home: options.formaHome,
    token: options.token,
    startedAt: options.startedAt,
    logFile: options.logFile
  });

  await new Promise<void>((resolve, reject) => {
    let finished = false;
    let checking = false;

    const finish = (error?: Error): void => {
      if (finished) {
        return;
      }
      finished = true;
      clearInterval(interval);
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const checkReady = async (): Promise<void> => {
      if (checking || finished) {
        return;
      }
      checking = true;
      try {
        const state = await readServeStateFromPaths(options.runtimeFile, (file) => readFile(file, "utf8"), defaultPathExists, options.formaHome);
        if (state.kind === "valid" && serveMetadataMatches(expected, state.metadata)) {
          finish();
        }
      } catch {
        // Keep waiting; child exit/error handlers produce actionable failures.
      } finally {
        checking = false;
      }
    };

    const onError = (error: Error): void => {
      finish(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(new Error(`Background Forma server exited before ready (${code === null ? `signal ${signal}` : `code ${code}`})`));
    };

    const interval = setInterval(() => {
      void checkReady();
    }, 25);
    const timeout = setTimeout(() => {
      finish(new Error(`Timed out waiting for Forma server readiness after ${timeoutMs}ms`));
    }, timeoutMs);

    child.once("error", onError);
    child.once("exit", onExit);
    void checkReady();
  });
}

async function defaultPathExists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function defaultVerifyServerProcess(metadata: ServeMetadata, readProcessCommand: (pid: number) => Promise<string>): Promise<boolean> {
  try {
    const command = await readProcessCommand(metadata.pid);
    return (
      commandIncludesArgs(command, [packageCliEntrypoint(), "serve", "--foreground-internal"]) &&
      commandIncludesArgPair(command, "--serve-token", metadata.token) &&
      commandIncludesArgPair(command, "--serve-home", metadata.home) &&
      commandIncludesArgPair(command, "--serve-started-at", metadata.started_at)
    );
  } catch {
    return false;
  }
}

function commandIncludesArgPair(command: string, flag: string, value: string): boolean {
  return commandIncludesArgs(command, [flag, value]);
}

function commandIncludesArgs(command: string, args: string[]): boolean {
  const pattern = args.map(escapeRegExp).join("\\s+");
  return new RegExp(`(?:^|\\s)${pattern}(?:\\s|$)`).test(command);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function defaultReadProcessCommand(pid: number): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function defaultKillProcess(pid: number): void {
  process.kill(pid, "SIGTERM");
}

function installServeCleanupHandlers(formaHome: string, metadata: ServeMetadata): void {
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    cleanupServeFileSync(serveRuntimeFile(formaHome), metadata);
    cleanupServeFileSync(servePidFile(formaHome), metadata);
  };

  process.once("exit", cleanup);
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
}

function cleanupServeFileSync(file: string, metadata: ServeMetadata): void {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const state = parseServeMetadata(parsed, file);
    if (state.kind === "valid" && serveMetadataMatches(metadata, state.metadata)) {
      rmSync(file, { force: true });
    }
  } catch {
    // Cleanup is best-effort; ownership checks prevent later stop from killing unrelated processes.
  }
}

function isMissingProcessError(error: unknown): boolean {
  return isNodeError(error) && error.code === "ESRCH";
}

function isFormaErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
