import { constants } from "node:fs";
import { access, appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  InstallService,
  PencilService,
  formaCoreVersion,
  readYaml,
  type AgentInstallPlatform,
  type InstallManifest
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
}

export interface CliInstallService {
  installPlatforms(platforms: AgentInstallPlatform[]): Promise<void>;
  uninstallPlatforms(platforms: AgentInstallPlatform[]): Promise<void>;
}

export type CliPencilStatus =
  | { available: true; authenticated: true; message?: string }
  | { available: true; authenticated: false; message?: string }
  | { available: false; authenticated: false; message?: string };

export interface CliEnv {
  formaHome?: string;
  currentPid?: number;
  now?: () => Date;
  startMcp?: () => Promise<string | void>;
  startServer?: (options?: CliServeOptions) => Promise<string | void>;
  createInstallService?: () => CliInstallService;
  checkPencil?: () => Promise<CliPencilStatus>;
  installedPlatforms?: () => Promise<AgentInstallPlatform[]>;
  isServerRunning?: () => Promise<boolean>;
  killProcess?: (pid: number) => Promise<void> | void;
  readText?: (file: string) => Promise<string>;
  writeText?: (file: string, content: string) => Promise<void>;
  appendText?: (file: string, content: string) => Promise<void>;
  removeFile?: (file: string) => Promise<void>;
  mkdir?: (dir: string) => Promise<void>;
  pathExists?: (file: string) => Promise<boolean>;
}

type RuntimeCliEnv = Required<CliEnv>;

const supportedPlatforms = ["claude", "codex", "gemini"] as const satisfies readonly AgentInstallPlatform[];

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

  if (subcommand === "start") {
    assertNoExtraArgs(rest);
    await ensureFormaHome(env);
    const started = await env.startServer({ detached: true });
    await writeServeState(env);
    if (typeof started === "string" && started.length > 0) {
      output.stdout(`${started}\n`);
    }
    output.stdout(`Forma server started with pid ${env.currentPid}\n`);
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

async function runStatus(args: string[], env: RuntimeCliEnv, output: CliOutput): Promise<CliResult> {
  assertNoExtraArgs(args);

  const [installed, pencil, serverRunning] = await Promise.all([
    env.installedPlatforms(),
    env.checkPencil(),
    env.isServerRunning()
  ]);

  output.stdout(`Data directory: ${env.formaHome}\n`);
  output.stdout(`Installed platforms: ${installed.length > 0 ? formatPlatforms(installed) : "none"}\n`);
  output.stdout(`Pencil CLI: ${pencil.available ? "available" : "not found"}\n`);
  output.stdout(`Pencil authentication: ${pencil.authenticated ? "authenticated" : "not authenticated"}\n`);
  output.stdout(`Web server: ${serverRunning ? "running" : "stopped"}\n`);
  return output.result(0);
}

async function stopServer(env: RuntimeCliEnv, output: CliOutput): Promise<CliResult> {
  const pidFile = servePidFile(env.formaHome);
  if (!(await env.pathExists(pidFile))) {
    output.stdout("Forma server is not running\n");
    return output.result(0);
  }

  const pidText = (await env.readText(pidFile)).trim();
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid <= 0) {
    await env.removeFile(pidFile);
    output.stderr(`Invalid server pid file: ${pidFile}\n`);
    return output.result(1);
  }

  let stopped = true;
  try {
    await env.killProcess(pid);
  } catch (error) {
    if (!isMissingProcessError(error)) {
      throw error;
    }
    stopped = false;
  } finally {
    await env.removeFile(pidFile);
  }

  output.stdout(stopped ? `Stopped Forma server (${pid})\n` : `Removed stale Forma server pid (${pid})\n`);
  return output.result(0);
}

async function writeCommandReturn(output: CliOutput, value: Promise<string | void>): Promise<number> {
  const result = await value;
  if (typeof result === "string" && result.length > 0) {
    output.stdout(`${result}\n`);
  }
  return 0;
}

async function writeServeState(env: RuntimeCliEnv): Promise<void> {
  await env.writeText(servePidFile(env.formaHome), `${env.currentPid}\n`);
  await env.appendText(serveLogFile(env.formaHome), `${env.now().toISOString()} forma serve start pid=${env.currentPid}\n`);
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

function resolveCliEnv(env: CliEnv): RuntimeCliEnv {
  const formaHome = env.formaHome ?? defaultFormaHome();
  const currentPid = env.currentPid ?? process.pid;
  const readText = env.readText ?? ((file) => readFile(file, "utf8"));
  const pathExists = env.pathExists ?? defaultPathExists;
  const runtimeEnv: RuntimeCliEnv = {
    formaHome,
    currentPid,
    now: env.now ?? (() => new Date()),
    startMcp: env.startMcp ?? (() => startMcpServer()),
    startServer: env.startServer ?? (() => startWebServer()),
    createInstallService: env.createInstallService ?? (() => new InstallService({ formaHome })),
    checkPencil: env.checkPencil ?? (() => checkPencil(formaHome)),
    installedPlatforms: env.installedPlatforms ?? (() => readInstalledPlatforms(formaHome)),
    isServerRunning: env.isServerRunning ?? (() => isServerRunning(formaHome, readText, pathExists)),
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

async function readInstalledPlatforms(formaHome: string): Promise<AgentInstallPlatform[]> {
  const manifestsDir = join(formaHome, "manifests");
  let entries: string[];
  try {
    entries = await readdir(manifestsDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const installed: AgentInstallPlatform[] = [];
  for (const platform of supportedPlatforms) {
    if (!entries.includes(`${platform}.manifest`)) {
      continue;
    }
    const manifest = await readYaml<InstallManifest>(join(manifestsDir, `${platform}.manifest`));
    if (manifest.platform === platform) {
      installed.push(platform);
    }
  }
  return installed;
}

async function isServerRunning(
  formaHome: string,
  readText: (file: string) => Promise<string>,
  pathExists: (file: string) => Promise<boolean>
): Promise<boolean> {
  const pidFile = servePidFile(formaHome);
  if (!(await pathExists(pidFile))) {
    return false;
  }
  const pid = Number((await readText(pidFile)).trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

function formatPlatforms(platforms: AgentInstallPlatform[]): string {
  return platforms.join(", ");
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

async function defaultPathExists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultKillProcess(pid: number): void {
  process.kill(pid, "SIGTERM");
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
