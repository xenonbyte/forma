import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { FormaError } from "./errors.js";
import type { PencilRunner } from "./pencil.js";

export const PENCIL_VERSION_TIMEOUT_MS = 10_000;
export const PENCIL_STATUS_TIMEOUT_MS = 10_000;
export const PENCIL_HELP_TIMEOUT_MS = 10_000;
export const PENCIL_DESKTOP_PREFLIGHT_TIMEOUT_MS = 45_000;
export const PENCIL_OPEN_PROBE_TIMEOUT_MS = 60_000;
export const PENCIL_LIVENESS_TIMEOUT_MS = 5_000;
export const PENCIL_CONTROLLED_SAVE_TIMEOUT_MS = 30_000;
export const PENCIL_SESSION_EXPORT_TIMEOUT_MS = 60_000;
export const PENCIL_EDITOR_STATE_TIMEOUT_MS = 15_000;
export const PENCIL_VARIABLES_TIMEOUT_MS = 15_000;
export const PENCIL_GUIDELINES_TIMEOUT_MS = 20_000;
export const PENCIL_BATCH_GET_TIMEOUT_MS = 15_000;
export const PENCIL_SNAPSHOT_LAYOUT_TIMEOUT_MS = 15_000;
export const PENCIL_SCREENSHOT_TIMEOUT_MS = 60_000;

const requiredCapabilities = [
  "get_editor_state",
  "get_guidelines",
  "batch_get",
  "batch_design",
  "export_nodes",
  "snapshot_layout",
  "save"
] as const;

export interface PencilPreflightResult {
  ok: true;
  version: string;
  capabilities: string[];
  preflight_cleanup_warning?: string;
}

export interface PencilAppBinding {
  session_id: string;
  pencil_binding_id: string;
  mode: "app";
  pid: number;
  command: string;
  capabilities: string[];
  version: string;
  staging_path: string;
  stdin: "interactive-shell";
  stdout: "interactive-shell";
}

export interface PencilAppSessionAdapterOptions {
  home: string;
  runner: PencilRunner;
  isPidAlive?: (pid: number) => boolean;
  processFactory?: PencilInteractiveProcessFactory;
}

export interface OpenPencilSessionInput {
  session_id: string;
  staging_path: string;
}

export interface PencilInteractiveProcess {
  pid: number;
  send(input: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }>;
  isAlive(): boolean;
  close(): Promise<void>;
}

export type PencilInteractiveProcessFactory = (input: {
  command: string;
  args: string[];
  stagingPath: string;
  runner: PencilRunner;
}) => Promise<PencilInteractiveProcess>;

export class PencilAppSessionAdapter {
  private readonly home: string;
  private readonly runner: PencilRunner;
  private readonly isPidAlive: (pid: number) => boolean;
  private readonly processFactory: PencilInteractiveProcessFactory;
  private lastPreflight?: PencilPreflightResult;

  constructor(options: PencilAppSessionAdapterOptions) {
    this.home = options.home;
    this.runner = options.runner;
    this.isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
    this.processFactory = options.processFactory ?? spawnInteractiveProcess;
  }

  async preflight(): Promise<PencilPreflightResult> {
    const version = await this.readVersion();
    await this.readAuthenticatedStatus();
    const capabilities = parseCapabilities(
      (await this.runPencil(["interactive", "--help"], PENCIL_HELP_TIMEOUT_MS, "PENCIL_CAPABILITY_UNAVAILABLE", "interactive_help")).stdout
    );
    assertCapabilities(capabilities, requiredCapabilities, "PENCIL_CAPABILITY_UNAVAILABLE");

    const probeId = `probe-${randomBytes(8).toString("hex")}`;
    const probeDir = join(this.home, ".pencil-preflight", probeId);
    const probePen = join(probeDir, "probe.pen");
    await mkdir(probeDir, { recursive: true });
    let cleanupWarning: string | undefined;
    try {
      await writeFile(probePen, minimalLegalPen(), "utf8");
      const probe = await this.processFactory({
        command: "pencil",
        args: ["interactive", "--app", "desktop", "--in", probePen],
        stagingPath: probePen,
        runner: this.runner
      });
      try {
        if (!probe.isAlive()) {
          throw new FormaError("PENCIL_APP_REQUIRED", "Pencil App is required", { failed_phase: "preflight_app_probe", reason: "process_not_alive" });
        }
        await this.getEditorStateFromProcess(probe, "probe");
        await this.controlledSaveProcess(probe);
      } finally {
        await probe.close().catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof FormaError) {
        throw error;
      }
      throw new FormaError("PENCIL_APP_REQUIRED", "Pencil App is required", { failed_phase: "preflight_app_probe", reason: errorMessage(error) });
    } finally {
      try {
        await rm(probeDir, { recursive: true, force: true });
        await rm(join(this.home, ".pencil-preflight"), { recursive: true, force: true });
      } catch (error) {
        cleanupWarning = `preflight_cleanup_warning:${errorMessage(error)}`;
      }
    }

    const result: PencilPreflightResult = {
      ok: true,
      version,
      capabilities,
      ...(cleanupWarning ? { preflight_cleanup_warning: cleanupWarning } : {})
    };
    this.lastPreflight = result;
    return result;
  }

  async openSession(input: OpenPencilSessionInput): Promise<PencilAppBinding> {
    const stagingPath = await realpath(input.staging_path);
    const preflight = this.lastPreflight ?? await this.preflight();
    const command = `pencil interactive --app desktop --in ${stagingPath}`;
    let process: PencilInteractiveProcess | undefined;
    try {
      process = await this.processFactory({
        command: "pencil",
        args: ["interactive", "--app", "desktop", "--in", stagingPath],
        stagingPath,
        runner: this.runner
      });
      if (!process.isAlive()) {
        throw new FormaError("PENCIL_APP_REQUIRED", "Pencil App is required", { failed_phase: "open_app", reason: "process_not_alive" });
      }
      await this.getEditorStateFromProcess(process, input.session_id);
      await this.controlledSaveProcess(process);
    } catch (error) {
      await process?.close().catch(() => undefined);
      if (error instanceof FormaError) {
        throw new FormaError("PENCIL_APP_REQUIRED", "Pencil App is required", {
          ...error.details,
          session_id: input.session_id,
          failed_phase: error.details.failed_phase ?? "open_app",
          command,
          pencil_version: preflight.version
        });
      }
      throw new FormaError("PENCIL_APP_REQUIRED", "Pencil App is required", {
        session_id: input.session_id,
        failed_phase: "open_app",
        command,
        reason: errorMessage(error),
        pencil_version: preflight.version
      });
    }

    const binding: PencilAppBinding = {
      session_id: input.session_id,
      pencil_binding_id: `B-${randomBytes(8).toString("hex")}`,
      mode: "app",
      pid: process.pid,
      command,
      capabilities: preflight.capabilities,
      version: preflight.version,
      staging_path: stagingPath,
      stdin: "interactive-shell",
      stdout: "interactive-shell"
    };
    bindingRegistry.set(binding.pencil_binding_id, { binding, process });
    return binding;
  }

  async controlledSave(bindingId: string): Promise<void> {
    const owned = this.requireLiveBinding(bindingId);
    await this.controlledSaveProcess(owned.process);
  }

  async executeWriteTool(bindingId: string, tool: "batch_design" | "set_variables", args: Record<string, unknown>): Promise<void> {
    const owned = this.requireLiveBinding(bindingId);
    rejectPathLikeParameters(args);
    await owned.process.send(formatInteractiveToolCall(tool, args), tool === "batch_design" ? PENCIL_BATCH_GET_TIMEOUT_MS : PENCIL_VARIABLES_TIMEOUT_MS);
  }

  async sessionGetEditorState(bindingId: string, args: { include_schema: true }): Promise<unknown> {
    return this.executeReadTool(bindingId, "get_editor_state", args, PENCIL_EDITOR_STATE_TIMEOUT_MS);
  }

  async sessionGetGuidelines(bindingId: string, args: { category: string; name: string }): Promise<unknown> {
    return this.executeReadTool(bindingId, "get_guidelines", args, PENCIL_GUIDELINES_TIMEOUT_MS);
  }

  async sessionGetVariables(bindingId: string): Promise<unknown> {
    return this.executeReadTool(bindingId, "get_variables", {}, PENCIL_VARIABLES_TIMEOUT_MS);
  }

  async sessionBatchGet(bindingId: string, args: Record<string, unknown>): Promise<unknown> {
    return this.executeReadTool(bindingId, "batch_get", args, PENCIL_BATCH_GET_TIMEOUT_MS);
  }

  async sessionSnapshotLayout(bindingId: string, args: { problemsOnly: false; parentId: string; maxDepth: 8 }): Promise<unknown> {
    return this.executeReadTool(bindingId, "snapshot_layout", args, PENCIL_SNAPSHOT_LAYOUT_TIMEOUT_MS);
  }

  async sessionGetScreenshot(bindingId: string, args: Record<string, unknown>): Promise<unknown> {
    return this.executeReadTool(bindingId, "get_screenshot", args, PENCIL_SCREENSHOT_TIMEOUT_MS);
  }

  async sessionExportNodes(bindingId: string, args: Record<string, unknown>): Promise<unknown> {
    return this.executeReadTool(bindingId, "export_nodes", args, PENCIL_SESSION_EXPORT_TIMEOUT_MS);
  }

  getBinding(bindingId: string): PencilAppBinding | undefined {
    return bindingRegistry.get(bindingId)?.binding;
  }

  async assertLiveBinding(bindingId: string, stagingPath: string): Promise<PencilAppBinding> {
    const owned = this.requireLiveBinding(bindingId);
    const expected = await realpath(stagingPath);
    if (owned.binding.staging_path !== expected) {
      throw new FormaError("PENCIL_APP_REQUIRED", "Pencil App session is not bound to this staging file", {
        failed_phase: "session_check",
        pencil_binding_id: bindingId
      });
    }
    return owned.binding;
  }

  async closeBinding(bindingId: string): Promise<void> {
    const owned = bindingRegistry.get(bindingId);
    if (!owned) return;
    try {
      await owned.process.close();
    } finally {
      bindingRegistry.delete(bindingId);
    }
  }

  private async executeReadTool(bindingId: string, tool: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const owned = this.requireLiveBinding(bindingId);
    rejectPathLikeParameters(args);
    const result = await owned.process.send(formatInteractiveToolCall(tool, args), timeoutMs);
    const trimmed = result.stdout.trim();
    if (!trimmed) {
      return undefined;
    }
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed;
    }
  }

  private requireLiveBinding(bindingId: string): { binding: PencilAppBinding; process: PencilInteractiveProcess } {
    const owned = bindingRegistry.get(bindingId);
    if (!owned || !owned.process.isAlive()) {
      if (owned) {
        bindingRegistry.delete(bindingId);
      }
      throw new FormaError("PENCIL_APP_REQUIRED", "Pencil App session is not available", { failed_phase: "session_check", pencil_binding_id: bindingId });
    }
    return owned;
  }

  private async readVersion(): Promise<string> {
    return (await this.runPencil(["version"], PENCIL_VERSION_TIMEOUT_MS, "PENCIL_CLI_NOT_FOUND", "version")).stdout.trim();
  }

  private async readAuthenticatedStatus(): Promise<void> {
    const status = await this.runPencil(["status"], PENCIL_STATUS_TIMEOUT_MS, "PENCIL_NOT_AUTHENTICATED", "status");
    if (!/\bactive\b/i.test(status.stdout)) {
      throw new FormaError("PENCIL_NOT_AUTHENTICATED", "Pencil is not authenticated", { command: "status" });
    }
  }

  private async controlledSavePath(stagingPath: string): Promise<void> {
    await this.runPencil(["save", stagingPath], PENCIL_CONTROLLED_SAVE_TIMEOUT_MS, "PENCIL_APP_REQUIRED", "controlled_save");
  }

  private async controlledSaveProcess(process: PencilInteractiveProcess): Promise<void> {
    await process.send("save()", PENCIL_CONTROLLED_SAVE_TIMEOUT_MS);
  }

  private async getEditorStateFromProcess(process: PencilInteractiveProcess, sessionId: string): Promise<void> {
    const state = await process.send("get_editor_state({\"include_schema\":true})", PENCIL_EDITOR_STATE_TIMEOUT_MS);
    if (!state.stdout.trim()) {
      throw new FormaError("PENCIL_CAPABILITY_UNAVAILABLE", "Pencil editor state schema is unavailable", {
        session_id: sessionId,
        failed_phase: "editor_state_schema"
      });
    }
  }

  private async runPencil(
    args: string[],
    timeoutMs: number,
    code: "PENCIL_CLI_NOT_FOUND" | "PENCIL_NOT_AUTHENTICATED" | "PENCIL_CAPABILITY_UNAVAILABLE" | "PENCIL_APP_REQUIRED",
    phase: string
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      return await this.runner.run("pencil", args, { timeoutMs });
    } catch (error) {
      throw new FormaError(code, pencilErrorMessage(code), {
        command: args.join(" "),
        failed_phase: phase,
        reason: isTimeoutError(error) ? "timeout" : errorMessage(error)
      });
    }
  }
}

const bindingRegistry = new Map<string, { binding: PencilAppBinding; process: PencilInteractiveProcess }>();

async function spawnInteractiveProcess(input: {
  command: string;
  args: string[];
  stagingPath: string;
}): Promise<PencilInteractiveProcess> {
  const child = spawn(input.command, input.args, { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.setDefaultEncoding("utf8");
  let alive = true;
  let queue = Promise.resolve();
  child.once("exit", () => {
    alive = false;
  });
  child.once("error", () => {
    alive = false;
  });
  if (!child.pid) {
    throw new FormaError("PENCIL_APP_REQUIRED", "Pencil App is required", { failed_phase: "open_app", reason: "missing_child_pid" });
  }
  return {
    pid: child.pid,
    async send(message, timeoutMs) {
      return enqueueSend(message, timeoutMs);
    },
    isAlive() {
      return alive;
    },
    async close() {
      alive = false;
      child.kill();
    }
  };

  function markUnavailable(): void {
    alive = false;
    child.kill();
  }

  function enqueueSend(message: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
    const operation = queue.catch(() => undefined).then(async () => {
      if (!alive) {
        throw new FormaError("PENCIL_APP_REQUIRED", "Pencil App session is not available", { failed_phase: "session_check" });
      }
      return sendInteractiveLine(child, message, timeoutMs, markUnavailable);
    });
    queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

function sendInteractiveLine(
  child: ChildProcessWithoutNullStreams,
  message: string,
  timeoutMs: number,
  markUnavailable: () => void
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onStdout = (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (hasInteractivePrompt(stdout)) {
        finish(() => resolve({ stdout: extractInteractiveCommandOutput(stdout), stderr }));
      }
    };
    const onStderr = (chunk: Buffer | string) => {
      stderr += chunk.toString();
    };
    const onExit = () => {
      finish(() => reject(new FormaError("PENCIL_APP_REQUIRED", "Pencil App session exited", { failed_phase: "session_check" })));
    };
    const onError = (error: Error) => {
      finish(() => reject(error));
    };
    const timer = setTimeout(() => {
      markUnavailable();
      finish(() => reject(new FormaError("PENCIL_CAPABILITY_UNAVAILABLE", "Pencil interactive command timed out", {
        failed_phase: "interactive_timeout",
        reason: "timeout"
      })));
    }, timeoutMs);
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
    child.once("error", onError);
    child.stdin.write(`${message}\n`, (error) => {
      if (error) {
        markUnavailable();
        finish(() => reject(error));
      }
    });
  });
}

function formatInteractiveToolCall(tool: string, args: Record<string, unknown>): string {
  return Object.keys(args).length === 0 ? `${tool}()` : `${tool}(${JSON.stringify(args)})`;
}

function hasInteractivePrompt(stdout: string): boolean {
  return /pencil\s*>\s*$/.test(stripAnsi(stdout).replace(/\r/g, ""));
}

function extractInteractiveCommandOutput(stdout: string): string {
  const parts = stripAnsi(stdout).replace(/\r/g, "").split(/pencil\s*>\s*/);
  const output = parts.length > 1 ? parts.at(-2) ?? "" : parts[0] ?? "";
  return output.trimEnd();
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

export class PencilReadExportAdapter {
  constructor(private readonly options: { home: string; runner: PencilRunner }) {
    void options;
  }

  async executeMutation(_tool: string, _args: Record<string, unknown>): Promise<never> {
    throw new FormaError("PENCIL_CAPABILITY_UNAVAILABLE", "Read/export adapter cannot mutate Pencil documents", {
      failed_phase: "read_export_mutation"
    });
  }
}

export function rejectPathLikeParameters(value: unknown): void {
  const forbidden = findForbiddenPathKey(value);
  if (forbidden) {
    throw new FormaError("FORBIDDEN_PATH_PARAMETER", "Pencil file paths are session-owned", { parameter: forbidden });
  }
}

function findForbiddenPathKey(value: unknown): string | undefined {
  const forbidden = new Set(["filePath", "file_path", "canvas_path", "staging_path", "outputDir", "output_dir", "path", "pen_path", "preview_path", "history_path"]);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenPathKey(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) {
      return key;
    }
    const found = findForbiddenPathKey(child);
    if (found) return found;
  }
  return undefined;
}

async function assertReadableEditorState(runner: PencilRunner, sessionId: string, stagingPath: string): Promise<void> {
  const state = await runner.run("pencil", ["get_editor_state", "--include-schema", "--in", stagingPath], { timeoutMs: PENCIL_EDITOR_STATE_TIMEOUT_MS });
  if (!state.stdout.trim()) {
    throw new FormaError("PENCIL_CAPABILITY_UNAVAILABLE", "Pencil editor state schema is unavailable", {
      session_id: sessionId,
      failed_phase: "editor_state_schema"
    });
  }
}

function parseCapabilities(help: string): string[] {
  const capabilities = new Set<string>();
  for (const name of [
    "get_editor_state",
    "get_guidelines",
    "batch_get",
    "batch_design",
    "export_nodes",
    "snapshot_layout",
    "get_screenshot",
    "set_variables",
    "save"
  ]) {
    if (help.includes(name)) {
      capabilities.add(name);
    }
  }
  return [...capabilities].sort();
}

function assertCapabilities(capabilities: string[], required: readonly string[], code: "PENCIL_CAPABILITY_UNAVAILABLE" | "PENCIL_APP_REQUIRED"): void {
  const missing = required.filter((capability) => !capabilities.includes(capability));
  if (missing.length > 0) {
    throw new FormaError(code, "Pencil capability is unavailable", {
      missing_capabilities: missing,
      failed_phase: "capability_probe"
    });
  }
}

function minimalLegalPen(): string {
  return `${JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame", name: basename("Probe") }] }, null, 2)}\n`;
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timeout/i.test(error.message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pencilErrorMessage(code: string): string {
  switch (code) {
    case "PENCIL_CLI_NOT_FOUND":
      return "Pencil CLI not found";
    case "PENCIL_NOT_AUTHENTICATED":
      return "Pencil is not authenticated";
    case "PENCIL_CAPABILITY_UNAVAILABLE":
      return "Pencil capability is unavailable";
    default:
      return "Pencil App is required";
  }
}
