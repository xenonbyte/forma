import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { hashFile } from "../src/file-hash.js";
import { PencilService, type PencilRunner } from "../src/index.js";
import { defaultPencilRunner } from "../src/pencil.js";
import {
  PENCIL_BATCH_GET_TIMEOUT_MS,
  PENCIL_CONTROLLED_SAVE_TIMEOUT_MS,
  PENCIL_DESKTOP_PREFLIGHT_TIMEOUT_MS,
  PENCIL_EDITOR_STATE_TIMEOUT_MS,
  PENCIL_GUIDELINES_TIMEOUT_MS,
  PENCIL_LIVENESS_TIMEOUT_MS,
  PENCIL_OPEN_PROBE_TIMEOUT_MS,
  PENCIL_SCREENSHOT_TIMEOUT_MS,
  PENCIL_SESSION_EXPORT_TIMEOUT_MS,
  PENCIL_SNAPSHOT_LAYOUT_TIMEOUT_MS,
  PENCIL_STATUS_TIMEOUT_MS,
  PENCIL_VARIABLES_TIMEOUT_MS,
  PENCIL_VERSION_TIMEOUT_MS,
  type OpenPencilSessionInput,
  PencilAppSessionAdapter,
  PencilReadExportAdapter,
  type PencilInteractiveProcess,
  type PencilInteractiveProcessFactory
} from "../src/pencil-adapter.js";
import {
  createSanitizedCommitCandidate,
  createSessionBindingGuard,
  insertSessionBindingGuard,
  penDocumentHasSessionBindingGuard
} from "../src/pencil-session-guard.js";
import { isSameOrChildPath, realpathInsideDirectory } from "../src/path-boundary.js";

const minimalPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00,
  0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

function createFakeRunner(
  handler: (command: string, args: string[], options?: { cwd?: string; timeoutMs?: number }) => Promise<{ stdout: string; stderr: string }> = async () => ({
    stdout: "",
    stderr: ""
  })
): PencilRunner & { calls: Array<{ command: string; args: string[]; options?: { cwd?: string; timeoutMs?: number } }> } {
  const calls: Array<{ command: string; args: string[]; options?: { cwd?: string; timeoutMs?: number } }> = [];
  return {
    calls,
    async run(command, args, options) {
      calls.push({ command, args, options });
      return handler(command, args, options);
    }
  };
}

function createHealthyRunner(): PencilRunner & { calls: Array<{ command: string; args: string[]; options?: { cwd?: string; timeoutMs?: number } }> } {
  return createFakeRunner(async (_command, args) => {
    if (args[0] === "version") return { stdout: "pencil 1.2.3", stderr: "" };
    if (args[0] === "status") return { stdout: "active", stderr: "" };
    if (args[0] === "interactive" && args[1] === "--help") {
      return { stdout: "get_editor_state get_guidelines get_variables batch_get batch_design set_variables export_nodes snapshot_layout get_screenshot save", stderr: "" };
    }
    return { stdout: "ok", stderr: "" };
  });
}

async function createHome(name: string) {
  return await mkdir(join(tmpdir(), `forma-pencil-${name}-${randomUUID()}`), { recursive: true });
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createConvergedProcessFactory(
  messages: string[] = [],
  options: { activePath?: string; missingGuardReads?: number } = {}
): PencilInteractiveProcessFactory {
  let batchGetReads = 0;
  return async (input) => ({
    pid: process.pid + 4242 + messages.length,
    async send(message) {
      messages.push(message);
      if (message.startsWith("get_editor_state")) {
        return { stdout: JSON.stringify({ schema: true, filePath: options.activePath ?? input.stagingPath }), stderr: "" };
      }
      if (message.startsWith("batch_get")) {
        batchGetReads += 1;
        if (batchGetReads <= (options.missingGuardReads ?? 0)) {
          return { stdout: JSON.stringify({ nodes: [] }), stderr: "" };
        }
        const payload = JSON.parse(message.slice("batch_get(".length, -1)) as { nodeIds?: string[] };
        const document = JSON.parse(await readFile(input.stagingPath, "utf8")) as { children?: Array<{ id?: unknown }> };
        const childIds = new Set((document.children ?? []).map((node) => node.id).filter((id): id is string => typeof id === "string"));
        return { stdout: JSON.stringify({ nodes: (payload.nodeIds ?? []).filter((id) => childIds.has(id)).map((id) => ({ id })) }), stderr: "" };
      }
      return { stdout: "ok\n", stderr: "" };
    },
    isAlive: () => true,
    async close() {
      messages.push("close");
    }
  });
}

function createDriftingProcessFactory(
  messages: string[],
  options: { driftAfterBatchGet: number; stagingPath: string; otherPath: string }
): PencilInteractiveProcessFactory {
  let batchGetReads = 0;
  return async () => ({
    pid: process.pid + 5050 + messages.length,
    async send(message) {
      messages.push(message);
      if (message.startsWith("get_editor_state")) {
        const path = batchGetReads >= options.driftAfterBatchGet ? options.otherPath : options.stagingPath;
        return { stdout: JSON.stringify({ filePath: path, schema: true }), stderr: "" };
      }
      if (message.startsWith("batch_get")) {
        batchGetReads += 1;
        const payload = JSON.parse(message.slice("batch_get(".length, -1)) as { nodeIds?: string[] };
        return { stdout: JSON.stringify({ nodes: (payload.nodeIds ?? []).map((id) => ({ id })) }), stderr: "" };
      }
      return { stdout: "ok\n", stderr: "" };
    },
    isAlive: () => true,
    async close() {
      messages.push("close");
    }
  });
}

function createMockInteractiveChild(options: {
  stderrBeforeStdout?: boolean;
  neverRespond?: boolean;
  responseDelayMs?: number;
  writes?: string[];
}) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdin: Writable & { setDefaultEncoding(encoding: BufferEncoding): Writable };
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const writes = options.writes ?? [];
  child.pid = process.pid + 9000 + writes.length;
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn(() => {
    child.emit("exit", 1);
    return true;
  });
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      const text = chunk.toString();
      writes.push(text);
      callback();
      if (options.neverRespond) return;
      setTimeout(() => {
        if (options.stderrBeforeStdout) {
          stderr.write("warning before completion\n");
        }
        stdout.write(`${mockInteractiveOutputForText(text)}\n\u001b[36mpencil\u001b[39m \u001b[2m>\u001b[22m `);
      }, options.responseDelayMs ?? 0);
    }
  }) as Writable & { setDefaultEncoding(encoding: BufferEncoding): Writable };
  child.stdin.setDefaultEncoding = () => child.stdin;
  return { child, writes };
}

function createPromptTerminatedInteractiveChild(options: { writes?: string[] }) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdin: Writable & { setDefaultEncoding(encoding: BufferEncoding): Writable };
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const writes = options.writes ?? [];
  child.pid = process.pid + 9100 + writes.length;
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn(() => {
    child.emit("exit", 1);
    return true;
  });
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      const text = chunk.toString();
      writes.push(text);
      callback();
      if (/^\w+\(.*\)\n$/.test(text)) {
        stdout.write(`${mockInteractiveOutputForText(text)}\n\u001b[36mpencil\u001b[39m \u001b[2m>\u001b[22m `);
      } else {
        stdout.write(`\u001b[31mInvalid syntax. Expected: tool_name({ key: value })\u001b[39m\n\u001b[36mpencil\u001b[39m \u001b[2m>\u001b[22m `);
      }
    }
  }) as Writable & { setDefaultEncoding(encoding: BufferEncoding): Writable };
  child.stdin.setDefaultEncoding = () => child.stdin;
  return { child, writes };
}

function mockInteractiveOutputForText(text: string): string {
  if (text.startsWith("get_editor_state")) {
    return JSON.stringify({ schema: true });
  }
  if (text.startsWith("batch_get")) {
    const payload = JSON.parse(text.slice("batch_get(".length, -2)) as { nodeIds?: string[] };
    return JSON.stringify({ nodes: (payload.nodeIds ?? []).map((id) => ({ id })) });
  }
  return "ok";
}

describe("PencilService", () => {
  it("exports fixed v6 Pencil adapter timeout constants", () => {
    expect(PENCIL_VERSION_TIMEOUT_MS).toBe(10_000);
    expect(PENCIL_STATUS_TIMEOUT_MS).toBe(10_000);
    expect(PENCIL_DESKTOP_PREFLIGHT_TIMEOUT_MS).toBe(45_000);
    expect(PENCIL_OPEN_PROBE_TIMEOUT_MS).toBe(60_000);
    expect(PENCIL_LIVENESS_TIMEOUT_MS).toBe(5_000);
    expect(PENCIL_CONTROLLED_SAVE_TIMEOUT_MS).toBe(30_000);
    expect(PENCIL_SESSION_EXPORT_TIMEOUT_MS).toBe(60_000);
    expect(PENCIL_EDITOR_STATE_TIMEOUT_MS).toBe(15_000);
    expect(PENCIL_VARIABLES_TIMEOUT_MS).toBe(15_000);
    expect(PENCIL_GUIDELINES_TIMEOUT_MS).toBe(20_000);
    expect(PENCIL_BATCH_GET_TIMEOUT_MS).toBe(15_000);
    expect(PENCIL_SNAPSHOT_LAYOUT_TIMEOUT_MS).toBe(15_000);
    expect(PENCIL_SCREENSHOT_TIMEOUT_MS).toBe(60_000);
  });

  it("inserts a top-level session binding guard and writes sanitized no-guard candidates", async () => {
    const home = await createHome("guard-sanitize");
    const staging = join(home, "session", "staging.design.pen");
    const candidate = join(home, "session", "commit-candidates", "staging.no-guard.pen");
    await mkdir(dirname(staging), { recursive: true });
    await writeFile(staging, JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame" }] }, null, 2));
    const guard = createSessionBindingGuard("S-1234567890abcdef", "a".repeat(24));

    await insertSessionBindingGuard(staging, guard);
    const withGuard = JSON.parse(await readFile(staging, "utf8")) as { children: Array<{ id: string; metadata?: Record<string, unknown> }> };
    expect(withGuard.children.map((node) => node.id)).toEqual(["root", guard.id]);
    expect(withGuard.children.at(-1)?.metadata).toMatchObject({ kind: "session_binding_guard", session_id: "S-1234567890abcdef" });
    await expect(insertSessionBindingGuard(staging, guard)).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });

    const sourceHash = await hashFile(staging);
    const result = await createSanitizedCommitCandidate({
      source_staging_path: staging,
      candidate_path: candidate,
      binding_guard_id: guard.id,
      expected_source_hash: sourceHash
    });

    expect(result.candidate_hash).toBe(await hashFile(candidate));
    expect(await penDocumentHasSessionBindingGuard(staging)).toBe(true);
    expect(await penDocumentHasSessionBindingGuard(candidate)).toBe(false);
    const sanitized = JSON.parse(await readFile(candidate, "utf8")) as { children: Array<{ id: string }> };
    expect(sanitized.children.map((node) => node.id)).toEqual(["root"]);
  });

  it("rejects sanitized candidates when residual session binding guards remain", async () => {
    const home = await createHome("guard-residual");
    const staging = join(home, "session", "staging.lib.pen");
    const candidate = join(home, "session", "commit-candidates", "staging.no-guard.pen");
    await mkdir(dirname(staging), { recursive: true });
    await writeFile(staging, JSON.stringify({
      schema_version: 1,
      children: [
        createSessionBindingGuard("S-1234567890abcdef", "a".repeat(24)),
        createSessionBindingGuard("S-fedcba0987654321", "b".repeat(24))
      ]
    }, null, 2));

    await expect(createSanitizedCommitCandidate({
      source_staging_path: staging,
      candidate_path: candidate,
      binding_guard_id: "formaSessionBindingGuardS-1234567890abcdef_aaaaaaaaaaaaaaaaaaaaaaaa",
      expected_source_hash: await hashFile(staging)
    })).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
  });

  it("rejects session binding guard sanitized candidates when the target id is not a guard", async () => {
    const home = await createHome("guard-non-guard-target");
    const staging = join(home, "session", "staging.design.pen");
    const candidate = join(home, "session", "commit-candidates", "staging.no-guard.pen");
    await mkdir(dirname(staging), { recursive: true });
    await writeFile(staging, JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame" }] }, null, 2));

    await expect(createSanitizedCommitCandidate({
      source_staging_path: staging,
      candidate_path: candidate,
      binding_guard_id: "root",
      expected_source_hash: await hashFile(staging)
    })).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
    await expect(access(candidate)).rejects.toThrow();
  });

  it("wraps malformed session binding guard documents as pen file invalid", async () => {
    const home = await createHome("guard-malformed-json");
    const staging = join(home, "session", "staging.design.pen");
    await mkdir(dirname(staging), { recursive: true });
    await writeFile(staging, "{");

    await expect(penDocumentHasSessionBindingGuard(staging)).rejects.toMatchObject({
      code: "PEN_FILE_INVALID",
      details: expect.objectContaining({ cause: expect.any(String) })
    });
  });

  it("treats dot-prefixed session binding guard child path segments as inside", async () => {
    const home = await createHome("guard-dot-prefixed-child");
    const sessionDir = join(home, "session");

    expect(isSameOrChildPath(sessionDir, join(sessionDir, "..cache", "staging.no-guard.pen"))).toBe(true);
    expect(isSameOrChildPath(sessionDir, join(sessionDir, "..", "staging.no-guard.pen"))).toBe(false);
  });

  it("rejects session binding guard sanitized candidates on source hash mismatch without writing", async () => {
    const home = await createHome("guard-hash-mismatch");
    const staging = join(home, "session", "staging.design.pen");
    const candidate = join(home, "session", "commit-candidates", "staging.no-guard.pen");
    await mkdir(dirname(staging), { recursive: true });
    await writeFile(staging, JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame" }] }, null, 2));
    const guard = createSessionBindingGuard("S-1234567890abcdef", "a".repeat(24));
    await insertSessionBindingGuard(staging, guard);

    await expect(createSanitizedCommitCandidate({
      source_staging_path: staging,
      candidate_path: candidate,
      binding_guard_id: guard.id,
      expected_source_hash: "sha256:000000"
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(access(candidate)).rejects.toThrow();
  });

  it("rejects session binding guard sanitized candidates with the wrong basename", async () => {
    const home = await createHome("guard-wrong-basename");
    const staging = join(home, "session", "staging.design.pen");
    const candidate = join(home, "session", "commit-candidates", "wrong.no-guard.pen");
    await mkdir(dirname(staging), { recursive: true });
    await writeFile(staging, JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame" }] }, null, 2));
    const guard = createSessionBindingGuard("S-1234567890abcdef", "a".repeat(24));
    await insertSessionBindingGuard(staging, guard);

    await expect(createSanitizedCommitCandidate({
      source_staging_path: staging,
      candidate_path: candidate,
      binding_guard_id: guard.id,
      expected_source_hash: await hashFile(staging)
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(access(candidate)).rejects.toThrow();
  });

  it("creates session binding guard sanitized candidate parent directories", async () => {
    const home = await createHome("guard-create-parent");
    const staging = join(home, "session", "staging.design.pen");
    const candidate = join(home, "session", "commit-candidates", "staging.no-guard.pen");
    await mkdir(dirname(staging), { recursive: true });
    await writeFile(staging, JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame" }] }, null, 2));
    const guard = createSessionBindingGuard("S-1234567890abcdef", "a".repeat(24));
    await insertSessionBindingGuard(staging, guard);

    await expect(access(dirname(candidate))).rejects.toThrow();
    await createSanitizedCommitCandidate({
      source_staging_path: staging,
      candidate_path: candidate,
      binding_guard_id: guard.id,
      expected_source_hash: await hashFile(staging)
    });
    await expect(access(candidate)).resolves.toBeUndefined();
  });

  it("rejects session binding guard sanitized candidates that overwrite source staging", async () => {
    const home = await createHome("guard-overwrite-source");
    const staging = join(home, "session", "staging.design.pen");
    await mkdir(dirname(staging), { recursive: true });
    await writeFile(staging, JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame" }] }, null, 2));
    const guard = createSessionBindingGuard("S-1234567890abcdef", "a".repeat(24));
    await insertSessionBindingGuard(staging, guard);
    const sourceHash = await hashFile(staging);

    await expect(createSanitizedCommitCandidate({
      source_staging_path: staging,
      candidate_path: staging,
      binding_guard_id: guard.id,
      expected_source_hash: sourceHash
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await hashFile(staging)).toBe(sourceHash);
    expect(await penDocumentHasSessionBindingGuard(staging)).toBe(true);
  });

  it("rejects session binding guard sanitized candidates that target existing outside symlinks", async () => {
    const home = await createHome("guard-candidate-symlink");
    const staging = join(home, "session", "staging.design.pen");
    const candidate = join(home, "session", "commit-candidates", "staging.no-guard.pen");
    const outside = join(home, "outside.pen");
    await mkdir(dirname(staging), { recursive: true });
    await mkdir(dirname(candidate), { recursive: true });
    await writeFile(staging, JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame" }] }, null, 2));
    await writeFile(outside, "outside");
    await symlink(outside, candidate);
    const guard = createSessionBindingGuard("S-1234567890abcdef", "a".repeat(24));
    await insertSessionBindingGuard(staging, guard);

    await expect(createSanitizedCommitCandidate({
      source_staging_path: staging,
      candidate_path: candidate,
      binding_guard_id: guard.id,
      expected_source_hash: await hashFile(staging)
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await readFile(outside, "utf8")).toBe("outside");
  });

  it("rejects session binding guard source files that are symlinks to internal files", async () => {
    const home = await createHome("guard-source-symlink");
    const sessionDir = join(home, "session");
    const staging = join(sessionDir, "staging.design.pen");
    const stagingLink = join(sessionDir, "staging-link.design.pen");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(staging, JSON.stringify({ schema_version: 1, children: [] }, null, 2));
    await symlink(staging, stagingLink);

    await expect(realpathInsideDirectory({
      path: stagingLink,
      expectedDirectory: sessionDir,
      field: "source_staging_path",
      requireFile: true,
      requirePen: true
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("wraps missing session binding guard source path errors as invalid input", async () => {
    const home = await createHome("guard-missing-source");
    const sessionDir = join(home, "session");
    await mkdir(sessionDir, { recursive: true });

    await expect(realpathInsideDirectory({
      path: join(sessionDir, "missing.pen"),
      expectedDirectory: sessionDir,
      field: "source_staging_path",
      requireFile: true,
      requirePen: true
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("runs capability-only Pencil preflight without app probe files or processes", async () => {
    const home = await createHome("adapter-preflight");
    let processFactoryCalls = 0;
    const fakeRunner = createFakeRunner(async (_command, args) => {
      if (args[0] === "version") return { stdout: "pencil 1.2.3", stderr: "" };
      if (args[0] === "status") return { stdout: "active", stderr: "" };
      if (args[0] === "interactive" && args[1] === "--help") {
        return { stdout: "get_editor_state get_guidelines get_variables batch_get batch_design set_variables export_nodes snapshot_layout get_screenshot save", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });
    const adapter = new PencilAppSessionAdapter({
      home,
      runner: fakeRunner,
      processFactory: async () => {
        processFactoryCalls += 1;
        throw new Error("preflight must not start app-bound Pencil");
      }
    });

    await expect(adapter.preflight()).resolves.toMatchObject({
      ok: true,
      version: "pencil 1.2.3",
      capabilities: expect.arrayContaining(["batch_design", "get_variables", "get_screenshot", "save", "set_variables"])
    });
    await expect(access(join(home, ".pencil-preflight"))).rejects.toThrow();
    expect(processFactoryCalls).toBe(0);
    expect(fakeRunner.calls.map((call) => call.args)).toEqual([
      ["version"],
      ["status"],
      ["interactive", "--help"]
    ]);
  });

  it("maps Pencil preflight failures to stable v6 error codes", async () => {
    const home = await createHome("adapter-failures");
    await expect(new PencilAppSessionAdapter({
      home,
      runner: createFakeRunner(async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      })
    }).preflight()).rejects.toMatchObject({ code: "PENCIL_CLI_NOT_FOUND" });

    await expect(new PencilAppSessionAdapter({
      home,
      runner: createFakeRunner(async (_command, args) => {
        if (args[0] === "version") return { stdout: "pencil 1.2.3", stderr: "" };
        throw new Error("inactive");
      })
    }).preflight()).rejects.toMatchObject({ code: "PENCIL_NOT_AUTHENTICATED" });

    await expect(new PencilAppSessionAdapter({
      home,
      runner: createFakeRunner(async (_command, args) => {
        if (args[0] === "version") return { stdout: "pencil 1.2.3", stderr: "" };
        if (args[0] === "status") return { stdout: "active", stderr: "" };
        return { stdout: "get_editor_state", stderr: "" };
      })
    }).preflight()).rejects.toMatchObject({ code: "PENCIL_CAPABILITY_UNAVAILABLE" });
  });

  it("foreground-opens staging before app-bound process startup and registers a guard binding", async () => {
    const home = await createHome("foreground-open");
    const sessionDir = join(home, "S-foreground");
    const staging = join(sessionDir, "staging.design.pen");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(staging, JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame" }] }, null, 2));
    const events: string[] = [];
    const messages: string[] = [];
    const runner = createFakeRunner(async (command, args) => {
      if (args[0] === "version") return { stdout: "pencil 1.2.3", stderr: "" };
      if (args[0] === "status") return { stdout: "active", stderr: "" };
      if (args[0] === "interactive" && args[1] === "--help") {
        return { stdout: "get_editor_state get_guidelines get_variables batch_get batch_design set_variables export_nodes snapshot_layout get_screenshot save", stderr: "" };
      }
      if (command === "open") {
        events.push("foreground_open");
      }
      return { stdout: "ok", stderr: "" };
    });
    const adapter = new PencilAppSessionAdapter({
      home,
      platform: "darwin",
      runner,
      processFactory: async (input) => {
        events.push("process_start");
        return createConvergedProcessFactory(messages)(input);
      }
    });

    const binding = await adapter.openSession({ session_id: "S-foreground", staging_path: staging, expected_session_dir: sessionDir });
    const realStaging = await realpath(staging);

    expect(binding).toMatchObject({
      session_id: "S-foreground",
      mode: "app",
      staging_path: realStaging
    });
    expect(binding.binding_guard_id).toMatch(/^formaSessionBindingGuardS-foreground_[A-Za-z0-9_-]{24}$/);
    expect(runner.calls.some((call) => call.command === "open" && call.args[0] === "-a" && call.args[1] === "Pencil" && call.args[2] === realStaging)).toBe(true);
    expect(events).toEqual(["foreground_open", "process_start"]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe("get_editor_state({\"include_schema\":true})");
    expect(messages[1]).toMatch(/^batch_get\(/);
    const payload = JSON.parse(messages[1]!.slice("batch_get(".length, -1)) as { nodeIds?: string[]; readDepth?: number };
    expect(payload).toEqual({ nodeIds: [binding.binding_guard_id], readDepth: 0 });
  });

  it("fails openSession when active editor path points at another pen", async () => {
    const home = await createHome("foreground-path-mismatch");
    const sessionDir = join(home, "S-mismatch");
    const staging = join(sessionDir, "staging.design.pen");
    const other = join(home, "other.pen");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(staging, JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame" }] }, null, 2));
    await writeFile(other, JSON.stringify({ schema_version: 1, children: [{ id: "other", type: "frame" }] }, null, 2));
    const adapter = new PencilAppSessionAdapter({
      home,
      platform: "darwin",
      runner: createHealthyRunner(),
      processFactory: createConvergedProcessFactory([], { activePath: other })
    });

    await expect(adapter.openSession({ session_id: "S-mismatch", staging_path: staging, expected_session_dir: sessionDir })).rejects.toMatchObject({
      code: "PENCIL_APP_REQUIRED",
      details: {
        failed_phase: "staging_document_check",
        staging_path: await realpath(staging)
      }
    });
  });

  it("rejects openSession without expected_session_dir instead of falling back to the staging parent", async () => {
    const home = await createHome("foreground-missing-session-dir");
    const sessionDir = join(home, "S-missing-dir");
    const staging = join(sessionDir, "staging.design.pen");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(staging, JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame" }] }, null, 2));
    let processFactoryCalls = 0;
    const runner = createHealthyRunner();
    const adapter = new PencilAppSessionAdapter({
      home,
      platform: "darwin",
      runner,
      processFactory: async (input) => {
        processFactoryCalls += 1;
        return createConvergedProcessFactory()(input);
      }
    });
    const openWithoutExpectedSessionDir = (input: { session_id: string; staging_path: string }) => {
      return adapter.openSession(input as unknown as OpenPencilSessionInput);
    };

    await expect(openWithoutExpectedSessionDir({ session_id: "S-missing-dir", staging_path: staging })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      details: {
        field: "expected_session_dir"
      }
    });
    expect(processFactoryCalls).toBe(0);
    expect(runner.calls).toEqual([]);
  });

  it("uses top-level filePath for active editor path when activeEditor is not a string", async () => {
    const home = await createHome("foreground-active-editor-priority");
    const sessionDir = join(home, "S-priority");
    const staging = join(sessionDir, "staging.design.pen");
    const other = join(home, "other.pen");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(staging, JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame" }] }, null, 2));
    await writeFile(other, JSON.stringify({ schema_version: 1, children: [{ id: "other", type: "frame" }] }, null, 2));
    const messages: string[] = [];
    const adapter = new PencilAppSessionAdapter({
      home,
      platform: "darwin",
      runner: createHealthyRunner(),
      processFactory: async (input) => ({
        pid: process.pid + 4242,
        async send(message) {
          messages.push(message);
          if (message.startsWith("get_editor_state")) {
            return {
              stdout: JSON.stringify({
                schema: true,
                activeEditor: { filePath: other },
                filePath: input.stagingPath,
                editor: { filePath: other }
              }),
              stderr: ""
            };
          }
          if (message.startsWith("batch_get")) {
            const payload = JSON.parse(message.slice("batch_get(".length, -1)) as { nodeIds?: string[] };
            return { stdout: JSON.stringify({ nodes: (payload.nodeIds ?? []).map((id) => ({ id })) }), stderr: "" };
          }
          return { stdout: "ok\n", stderr: "" };
        },
        isAlive: () => true,
        async close() {
          messages.push("close");
        }
      })
    });

    await expect(adapter.openSession({ session_id: "S-priority", staging_path: staging, expected_session_dir: sessionDir })).resolves.toMatchObject({
      staging_path: await realpath(staging)
    });
    expect(messages).toEqual([
      "get_editor_state({\"include_schema\":true})",
      expect.stringMatching(/^batch_get\(/)
    ]);
  });

  it("maps foreground open failures to foreground_open", async () => {
    const home = await createHome("foreground-open-failure");
    const sessionDir = join(home, "S-open-fail");
    const staging = join(sessionDir, "staging.design.pen");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(staging, JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame" }] }, null, 2));
    let processFactoryCalls = 0;
    const runner = createFakeRunner(async (command, args) => {
      if (args[0] === "version") return { stdout: "pencil 1.2.3", stderr: "" };
      if (args[0] === "status") return { stdout: "active", stderr: "" };
      if (args[0] === "interactive" && args[1] === "--help") {
        return { stdout: "get_editor_state get_guidelines get_variables batch_get batch_design set_variables export_nodes snapshot_layout get_screenshot save", stderr: "" };
      }
      if (command === "open") {
        throw new Error("foreground failed");
      }
      return { stdout: "ok", stderr: "" };
    });
    const adapter = new PencilAppSessionAdapter({
      home,
      platform: "darwin",
      runner,
      processFactory: async (input) => {
        processFactoryCalls += 1;
        return createConvergedProcessFactory()(input);
      }
    });

    await expect(adapter.openSession({ session_id: "S-open-fail", staging_path: staging, expected_session_dir: sessionDir })).rejects.toMatchObject({
      code: "PENCIL_APP_REQUIRED",
      details: {
        failed_phase: "foreground_open",
        staging_path: await realpath(staging)
      }
    });
    expect(processFactoryCalls).toBe(0);
  });

  it("retries foreground open when guard is missing and succeeds after convergence", async () => {
    const home = await createHome("foreground-retry");
    const sessionDir = join(home, "S-retry");
    const staging = join(sessionDir, "staging.design.pen");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(staging, JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame" }] }, null, 2));
    const messages: string[] = [];
    const adapter = new PencilAppSessionAdapter({
      home,
      platform: "darwin",
      runner: createHealthyRunner(),
      processFactory: createConvergedProcessFactory(messages, { missingGuardReads: 1 }),
      sleep: async () => undefined
    });

    await expect(adapter.openSession({ session_id: "S-retry", staging_path: staging, expected_session_dir: sessionDir })).resolves.toMatchObject({
      session_id: "S-retry"
    });
    expect(messages.filter((message) => message === "close")).toHaveLength(1);
    expect(messages.filter((message) => message.startsWith("batch_get"))).toHaveLength(2);
  });

  it("fails closed after guard convergence retries are exhausted", async () => {
    const home = await createHome("foreground-retry-exhausted");
    const sessionDir = join(home, "S-exhausted");
    const staging = join(sessionDir, "staging.design.pen");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(staging, JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame" }] }, null, 2));
    const messages: string[] = [];
    const adapter = new PencilAppSessionAdapter({
      home,
      platform: "darwin",
      runner: createHealthyRunner(),
      processFactory: createConvergedProcessFactory(messages, { missingGuardReads: 99 }),
      sleep: async () => undefined
    });

    await expect(adapter.openSession({ session_id: "S-exhausted", staging_path: staging, expected_session_dir: sessionDir })).rejects.toMatchObject({
      code: "PENCIL_APP_REQUIRED",
      details: {
        failed_phase: "staging_document_check",
        reason: "guard_missing"
      }
    });
    expect(messages.filter((message) => message === "close")).toHaveLength(8);
  });

  it("opens app-bound staging files and rejects read-export mutations", async () => {
    const home = await createHome("adapter-open");
    const staging = join(home, "staging.design.pen");
    await writeFile(staging, JSON.stringify({ children: [{ id: "root", type: "frame" }] }));
    const fakeRunner = createFakeRunner(async (_command, args) => {
      if (args[0] === "version") return { stdout: "pencil 1.2.3", stderr: "" };
      if (args[0] === "status") return { stdout: "active", stderr: "" };
      if (args[0] === "interactive" && args[1] === "--help") {
        return { stdout: "get_editor_state get_guidelines get_variables batch_get batch_design set_variables export_nodes snapshot_layout get_screenshot save", stderr: "" };
      }
      if (args[0] === "interactive") return { stdout: "{\"schema\":true}", stderr: "" };
      if (args[0] === "get_editor_state") return { stdout: "{\"schema\":true}", stderr: "" };
      if (args[0] === "interactive-shell") return { stdout: "{\"schema\":true}", stderr: "" };
      if (args[0] === "save") return { stdout: "saved", stderr: "" };
      return { stdout: "", stderr: "" };
    });
    const appAdapter = new PencilAppSessionAdapter({
      home,
      platform: "darwin",
      runner: fakeRunner,
      processFactory: createConvergedProcessFactory()
    });

    const binding = await appAdapter.openSession({ session_id: "S-open", staging_path: staging, expected_session_dir: home });
    expect(binding).toMatchObject({
      session_id: "S-open",
      mode: "app",
      staging_path: await realpath(staging)
    });
    expect(binding.pid).not.toBe(process.pid);
    await expect(new PencilReadExportAdapter({ home, runner: fakeRunner }).executeMutation("batch_design", {})).rejects.toMatchObject({
      code: "PENCIL_CAPABILITY_UNAVAILABLE"
    });
  });

  it("keeps a child-process binding and sends save/write through the binding shell", async () => {
    const home = await createHome("adapter-binding");
    const staging = join(home, "staging.design.pen");
    await writeFile(staging, JSON.stringify({ children: [{ id: "root", type: "frame" }] }));
    const realStaging = await realpath(staging);
    const messages: string[] = [];
    const aliveStates: boolean[] = [];
    const runner = createFakeRunner(async (_command, args) => {
      if (args[0] === "version") return { stdout: "pencil 1.2.3", stderr: "" };
      if (args[0] === "status") return { stdout: "active", stderr: "" };
      if (args[0] === "interactive" && args[1] === "--help") {
        return { stdout: "get_editor_state get_guidelines get_variables batch_get batch_design set_variables export_nodes snapshot_layout get_screenshot save", stderr: "" };
      }
      if (args[0] === "get_editor_state") return { stdout: "{\"schema\":true}", stderr: "" };
      return { stdout: "ok", stderr: "" };
    });
    const adapter = new PencilAppSessionAdapter({
      home,
      platform: "darwin",
      runner,
      processFactory: async () => {
        const index = aliveStates.push(true) - 1;
        return {
          pid: process.pid + 4242 + index,
          async send(message) {
            messages.push(message);
            if (!aliveStates[index]) throw new Error("dead");
            if (message.startsWith("get_editor_state")) {
              return { stdout: JSON.stringify({ schema: true, filePath: realStaging }), stderr: "" };
            }
            if (message.startsWith("batch_get")) {
              const payload = JSON.parse(message.slice("batch_get(".length, -1)) as { nodeIds?: string[] };
              return { stdout: JSON.stringify({ nodes: (payload.nodeIds ?? []).map((id) => ({ id })) }), stderr: "" };
            }
            return { stdout: "ok", stderr: "" };
          },
          isAlive: () => aliveStates[index]!,
          async close() {
            aliveStates[index] = false;
          }
        };
      }
    });

    const binding = await adapter.openSession({ session_id: "S-bind", staging_path: staging, expected_session_dir: home });
    expect(binding.pid).toBe(process.pid + 4242);
    await adapter.controlledSave(binding.pencil_binding_id);
    await adapter.executeWriteTool(binding.pencil_binding_id, "batch_design", { nodes: [] });

    expect(messages[0]).toBe("get_editor_state({\"include_schema\":true})");
    expect(messages[1]).toMatch(/^batch_get\(/);
    expect(messages.slice(2)).toEqual([
      "get_editor_state({\"include_schema\":false})",
      expect.stringMatching(/^batch_get\(/),
      "save()",
      "get_editor_state({\"include_schema\":false})",
      expect.stringMatching(/^batch_get\(/),
      "get_editor_state({\"include_schema\":false})",
      expect.stringMatching(/^batch_get\(/),
      "batch_design({\"nodes\":[]})",
      "get_editor_state({\"include_schema\":false})",
      expect.stringMatching(/^batch_get\(/)
    ]);
    expect(runner.calls.filter((call) => call.args[0] === "batch_design" || (call.args[0] === "save" && call.args[1] === staging))).toEqual([]);

    aliveStates[0] = false;
    await expect(adapter.controlledSave(binding.pencil_binding_id)).rejects.toMatchObject({ code: "PENCIL_APP_REQUIRED" });
  });

  it("asserts active staging before and after controlled save and write tools", async () => {
    const home = await createHome("adapter-runtime-drift-write");
    const staging = join(home, "staging.design.pen");
    const other = join(home, "other.pen");
    await writeFile(staging, JSON.stringify({ children: [{ id: "root", type: "frame" }] }));
    await writeFile(other, JSON.stringify({ children: [{ id: "other", type: "frame" }] }));
    const realStaging = await realpath(staging);
    const messages: string[] = [];
    const adapter = new PencilAppSessionAdapter({
      home,
      platform: "darwin",
      runner: createHealthyRunner(),
      processFactory: createDriftingProcessFactory(messages, {
        driftAfterBatchGet: 99,
        stagingPath: realStaging,
        otherPath: await realpath(other)
      })
    });
    const binding = await adapter.openSession({ session_id: "S-runtime-write", staging_path: staging, expected_session_dir: home });
    messages.length = 0;

    await adapter.controlledSave(binding.pencil_binding_id, staging);
    await adapter.executeWriteTool(binding.pencil_binding_id, "batch_design", { nodes: [] }, staging);

    expect(messages).toEqual([
      "get_editor_state({\"include_schema\":false})",
      expect.stringMatching(/^batch_get\(/),
      "save()",
      "get_editor_state({\"include_schema\":false})",
      expect.stringMatching(/^batch_get\(/),
      "get_editor_state({\"include_schema\":false})",
      expect.stringMatching(/^batch_get\(/),
      "batch_design({\"nodes\":[]})",
      "get_editor_state({\"include_schema\":false})",
      expect.stringMatching(/^batch_get\(/)
    ]);
  });

  it("reports missing expected active staging as session_check", async () => {
    const home = await createHome("adapter-missing-expected-staging");
    const staging = join(home, "staging.design.pen");
    const missing = join(home, "missing.design.pen");
    await writeFile(staging, JSON.stringify({ children: [{ id: "root", type: "frame" }] }));
    const messages: string[] = [];
    const adapter = new PencilAppSessionAdapter({
      home,
      platform: "darwin",
      runner: createHealthyRunner(),
      processFactory: createConvergedProcessFactory(messages)
    });
    const binding = await adapter.openSession({ session_id: "S-missing-expected-staging", staging_path: staging, expected_session_dir: home });
    messages.length = 0;

    await expect(
      adapter.assertActiveStagingBinding({ bindingId: binding.pencil_binding_id, expectedStagingPath: missing })
    ).rejects.toMatchObject({
      code: "PENCIL_APP_REQUIRED",
      message: "Pencil App session is not bound to this staging file",
      details: {
        failed_phase: "session_check",
        pencil_binding_id: binding.pencil_binding_id,
        staging_path: missing,
        reason: expect.stringMatching(/no such file|ENOENT/i)
      }
    });
    expect(messages).toEqual([]);
  });

  it("fails controlled save with active_editor_drift after the user switches documents", async () => {
    const home = await createHome("adapter-runtime-drift-save");
    const staging = join(home, "staging.design.pen");
    const other = join(home, "other.pen");
    await writeFile(staging, JSON.stringify({ children: [{ id: "root", type: "frame" }] }));
    await writeFile(other, JSON.stringify({ children: [{ id: "other", type: "frame" }] }));
    const realStaging = await realpath(staging);
    const messages: string[] = [];
    const adapter = new PencilAppSessionAdapter({
      home,
      platform: "darwin",
      runner: createHealthyRunner(),
      processFactory: createDriftingProcessFactory(messages, {
        driftAfterBatchGet: 1,
        stagingPath: realStaging,
        otherPath: await realpath(other)
      })
    });
    const binding = await adapter.openSession({ session_id: "S-runtime-drift", staging_path: staging, expected_session_dir: home });
    messages.length = 0;

    await expect(adapter.controlledSave(binding.pencil_binding_id, staging)).rejects.toMatchObject({
      code: "PENCIL_APP_REQUIRED",
      details: {
        failed_phase: "active_editor_drift"
      }
    });
    expect(messages).toEqual(["get_editor_state({\"include_schema\":false})"]);
  });

  it("asserts active staging before session read and export tools", async () => {
    const home = await createHome("adapter-runtime-drift-read");
    const staging = join(home, "staging.design.pen");
    const other = join(home, "other.pen");
    await writeFile(staging, JSON.stringify({ children: [{ id: "root", type: "frame" }] }));
    await writeFile(other, JSON.stringify({ children: [{ id: "other", type: "frame" }] }));
    const realStaging = await realpath(staging);
    const messages: string[] = [];
    const adapter = new PencilAppSessionAdapter({
      home,
      platform: "darwin",
      runner: createHealthyRunner(),
      processFactory: createDriftingProcessFactory(messages, {
        driftAfterBatchGet: 99,
        stagingPath: realStaging,
        otherPath: await realpath(other)
      })
    });
    const binding = await adapter.openSession({ session_id: "S-runtime-read", staging_path: staging, expected_session_dir: home });
    messages.length = 0;

    await expect(adapter.sessionBatchGet(binding.pencil_binding_id, { nodeIds: ["root"] }, staging)).resolves.toEqual({ nodes: [{ id: "root" }] });
    await expect(adapter.sessionExportNodes(binding.pencil_binding_id, { nodeIds: ["root"] }, staging)).resolves.toBe("ok");

    expect(messages).toEqual([
      "get_editor_state({\"include_schema\":false})",
      expect.stringMatching(/^batch_get\(/),
      "batch_get({\"nodeIds\":[\"root\"]})",
      "get_editor_state({\"include_schema\":false})",
      expect.stringMatching(/^batch_get\(/),
      "export_nodes({\"nodeIds\":[\"root\"]})"
    ]);
  });

  it("does not treat stderr warnings as interactive command completion", async () => {
    vi.resetModules();
    const writes: string[] = [];
    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => createMockInteractiveChild({ stderrBeforeStdout: true, writes }).child)
    }));
    const { PencilAppSessionAdapter: FreshAdapter } = await import("../src/pencil-adapter.js");
    const home = await createHome("adapter-stderr-frame");
    const staging = join(home, "staging.design.pen");
    await writeFile(staging, JSON.stringify({ children: [{ id: "root", type: "frame" }] }));
    const adapter = new FreshAdapter({ home, platform: "darwin", runner: createHealthyRunner() });

    const binding = await adapter.openSession({ session_id: "S-stderr", staging_path: staging, expected_session_dir: home });
    await expect(adapter.controlledSave(binding.pencil_binding_id)).resolves.toBeUndefined();

    expect(writes.some((write) => write.includes("save()"))).toBe(true);
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  it("uses Pencil function-call syntax and completes on the returned prompt", async () => {
    vi.resetModules();
    const writes: string[] = [];
    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => createPromptTerminatedInteractiveChild({ writes }).child)
    }));
    const { PencilAppSessionAdapter: FreshAdapter } = await import("../src/pencil-adapter.js");
    const home = await createHome("adapter-prompt-completion");
    const staging = join(home, "staging.design.pen");
    await writeFile(staging, JSON.stringify({ children: [{ id: "root", type: "frame" }] }));
    const adapter = new FreshAdapter({ home, platform: "darwin", runner: createHealthyRunner() });

    try {
      const opened = adapter.openSession({ session_id: "S-prompt", staging_path: staging, expected_session_dir: home });
      await expect(opened).resolves.toMatchObject({ session_id: "S-prompt" });
      expect(writes[0]).toBe("get_editor_state({\"include_schema\":true})\n");
      expect(writes[1]).toMatch(/^batch_get\(/);
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("serializes concurrent interactive sends for one child process", async () => {
    vi.resetModules();
    const writes: string[] = [];
    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => createMockInteractiveChild({ responseDelayMs: 5, writes }).child)
    }));
    const { PencilAppSessionAdapter: FreshAdapter } = await import("../src/pencil-adapter.js");
    const home = await createHome("adapter-serialized");
    const staging = join(home, "staging.design.pen");
    await writeFile(staging, JSON.stringify({ children: [{ id: "root", type: "frame" }] }));
    const adapter = new FreshAdapter({ home, platform: "darwin", runner: createHealthyRunner() });
    const binding = await adapter.openSession({ session_id: "S-serial", staging_path: staging, expected_session_dir: home });
    writes.length = 0;

    await Promise.all([
      adapter.controlledSave(binding.pencil_binding_id),
      adapter.executeWriteTool(binding.pencil_binding_id, "batch_design", { nodes: [] })
    ]);

    expect(writes).toHaveLength(10);
    expect(writes.filter((write) => write.includes("get_editor_state"))).toHaveLength(4);
    expect(writes.filter((write) => write.includes("batch_get"))).toHaveLength(4);
    expect(writes.some((write) => write.includes("save()"))).toBe(true);
    expect(writes.some((write) => write.includes("batch_design"))).toBe(true);
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  it("marks timed out interactive child processes unavailable", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const children: Array<ReturnType<typeof createMockInteractiveChild>["child"]> = [];
    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => {
        const created = createMockInteractiveChild({ neverRespond: true });
        children.push(created.child);
        return created.child;
      })
    }));
    const { PencilAppSessionAdapter: FreshAdapter } = await import("../src/pencil-adapter.js");
    const home = await createHome("adapter-timeout");
    const staging = join(home, "staging.design.pen");
    await writeFile(staging, JSON.stringify({ children: [{ id: "root", type: "frame" }] }));
    const adapter = new FreshAdapter({ home, platform: "darwin", runner: createHealthyRunner() });

    const opened = adapter.openSession({ session_id: "S-timeout", staging_path: staging, expected_session_dir: home });
    const openedRejects = expect(opened).rejects.toMatchObject({ code: "PENCIL_APP_REQUIRED" });
    while (children.length === 0) {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    }
    await vi.advanceTimersByTimeAsync(PENCIL_EDITOR_STATE_TIMEOUT_MS + 1);
    await openedRejects;
    expect(children[0]?.kill).toHaveBeenCalled();
    vi.doUnmock("node:child_process");
    vi.resetModules();
    vi.useRealTimers();
  });

  it("makes legacy headless generation unavailable in v6 runtime", async () => {
    const home = await createHome("headless-unavailable");
    const service = new PencilService({ home, runner: createFakeRunner() });

    await expect(service.generatePageDesign({ product_id: "P-123abc", prompt: "draw", workspace: home })).rejects.toMatchObject({
      code: "PENCIL_CAPABILITY_UNAVAILABLE"
    });
    await expect(service.generateComponents({ product_id: "P-123abc", prompt: "draw", workspace: home })).rejects.toMatchObject({
      code: "PENCIL_CAPABILITY_UNAVAILABLE"
    });
  });

  it("passes timeout options through the default runner", async () => {
    await expect(defaultPencilRunner.run(process.execPath, ["--version"], { timeoutMs: 5_000 })).resolves.toMatchObject({
      stderr: expect.any(String),
      stdout: expect.any(String)
    });
  });

  it("validates pen files and rejects truncation markers", async () => {
    const home = await createHome("validate");
    const fakeRunner = createFakeRunner();
    const service = new PencilService({ home, runner: fakeRunner });
    const validPen = join(home, "valid.pen");
    const badPen = join(home, "bad.pen");

    await writeFile(validPen, JSON.stringify({ children: [{ id: "root", type: "frame" }] }));
    await expect(service.validatePenFile(validPen)).resolves.toBeUndefined();
    await writeFile(badPen, JSON.stringify({ children: ["..."] }));
    await expect(service.validatePenFile(badPen)).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
  });

  it("rejects missing, malformed, empty, and nested-truncated pen files", async () => {
    const home = await createHome("invalid-pen");
    const service = new PencilService({ home, runner: createFakeRunner() });
    const missingPen = join(home, "missing.pen");
    const invalidJsonPen = join(home, "invalid-json.pen");
    const emptyChildrenPen = join(home, "empty-children.pen");
    const nestedTruncatedPen = join(home, "nested-truncated.pen");

    await writeFile(invalidJsonPen, "{");
    await writeFile(emptyChildrenPen, JSON.stringify({ children: [] }));
    await writeFile(
      nestedTruncatedPen,
      JSON.stringify({ children: [{ id: "root", layers: [{ id: "truncated", value: "..." }] }] })
    );

    await expect(service.validatePenFile(missingPen)).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
    await expect(service.validatePenFile(invalidJsonPen)).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
    await expect(service.validatePenFile(emptyChildrenPen)).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
    await expect(service.validatePenFile(nestedTruncatedPen)).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
  });

  it("reclaims stale lock when pid is dead", async () => {
    const home = await createHome("dead-lock");
    const fakeRunner = createFakeRunner();
    const lockFile = join(home, "pencil.lock");
    const service = new PencilService({ home, runner: fakeRunner, isPidAlive: () => false });

    await service.writeLock({ pid: 999999, operation: "design", product_id: "P-stale" });
    await expect(service.withLock({ operation: "design", product_id: "P-live" }, async () => "ok")).resolves.toBe("ok");
    await expect(access(lockFile)).rejects.toThrow();
  });

  it("rejects a live lock that has not timed out", async () => {
    const home = await createHome("live-lock");
    const fakeRunner = createFakeRunner();
    const service = new PencilService({ home, runner: fakeRunner, isPidAlive: () => true });

    await service.writeLock({ pid: 123, operation: "design", product_id: "P-live" });

    await expect(service.withLock({ operation: "components", product_id: "P-next" }, async () => "blocked")).rejects.toMatchObject({
      code: "PENCIL_LOCK_HELD"
    });
  });

  it("reclaims a live lock older than five minutes", async () => {
    const home = await createHome("timeout-lock");
    const fakeRunner = createFakeRunner();
    const service = new PencilService({ home, runner: fakeRunner, isPidAlive: () => true });

    await service.writeLock({
      pid: 123,
      operation: "design",
      product_id: "P-old",
      acquired_at: new Date(Date.now() - 301_000).toISOString()
    });

    await expect(service.withLock({ operation: "components", product_id: "P-new" }, async () => "ok")).resolves.toBe("ok");
    await expect(access(join(home, "pencil.lock"))).rejects.toThrow();
  });

  it("releases the lock after fn throws", async () => {
    const home = await createHome("throw-lock");
    const fakeRunner = createFakeRunner();
    const service = new PencilService({ home, runner: fakeRunner });

    await expect(
      service.withLock({ operation: "design", product_id: "P-err" }, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    await expect(access(join(home, "pencil.lock"))).rejects.toThrow();
  });

  it("does not release a fresh lock acquired after the original owner exits", async () => {
    const home = await createHome("owner-release");
    const service = new PencilService({ home, runner: createFakeRunner(), isPidAlive: () => true });
    const lockFile = join(home, "pencil.lock");

    await service.withLock({ operation: "design", product_id: "P-old" }, async () => {
      await service.writeLock({ pid: process.pid, operation: "design", product_id: "P-new", owner_id: "fresh-owner" });
    });

    const lock = JSON.parse(await readFile(lockFile, "utf8")) as { owner_id?: string; product_id?: string };
    expect(lock).toMatchObject({ owner_id: "fresh-owner", product_id: "P-new" });
  });

  it("keeps a race-losing stale reclaimer from deleting the winner lock", async () => {
    const home = await createHome("stale-race");
    const service = new PencilService({
      home,
      runner: createFakeRunner(),
      isPidAlive: (pid) => pid === process.pid
    });
    await service.writeLock({
      pid: 999999,
      operation: "design",
      product_id: "P-stale",
      acquired_at: new Date(Date.now() - 301_000).toISOString(),
      owner_id: "stale-owner"
    });

    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const winnerAcquired = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const winner = service.withLock({ operation: "design", product_id: "P-winner" }, async () => {
      acquired();
      await held;
      return "winner";
    });

    await winnerAcquired;
    await expect(service.withLock({ operation: "design", product_id: "P-loser" }, async () => "loser")).rejects.toMatchObject({
      code: "PENCIL_LOCK_HELD"
    });
    const heldLock = JSON.parse(await readFile(join(home, "pencil.lock"), "utf8")) as { product_id?: string; owner_id?: string };
    expect(heldLock.product_id).toBe("P-winner");
    expect(typeof heldLock.owner_id).toBe("string");

    release();
    await expect(winner).resolves.toBe("winner");
  });

  it("rejects malformed lock files without spinning", async () => {
    const home = await createHome("malformed-lock");
    const lockFile = join(home, "pencil.lock");
    const service = new PencilService({ home, runner: createFakeRunner() });
    await writeFile(lockFile, "{not-json", "utf8");

    const operation = service.withLock({ operation: "design", product_id: "P-bad-lock" }, async () => "acquired");
    const result = await Promise.race([
      operation.then(
        (value) => ({ status: "resolved", value }),
        (error) => ({ status: "rejected", error })
      ),
      delay(50).then(() => ({ status: "timeout" }))
    ]);

    if (result.status === "timeout") {
      await rm(lockFile, { force: true });
      await operation.catch(() => undefined);
    }

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error).toMatchObject({ code: "PENCIL_LOCK_HELD", details: { reason: "invalid_lock" } });
    }
  });

  it("maps availability failures to Pencil error codes", async () => {
    const home = await createHome("availability");
    const missing = new PencilService({
      home,
      runner: createFakeRunner(async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      })
    });
    await expect(missing.checkAvailability()).rejects.toMatchObject({ code: "PENCIL_CLI_NOT_FOUND" });

    const inactive = new PencilService({
      home,
      runner: createFakeRunner(async (_command, args) => {
        if (args[0] === "version") return { stdout: "1.0.0", stderr: "" };
        return { stdout: "inactive", stderr: "" };
      })
    });
    await expect(inactive.checkAvailability()).rejects.toMatchObject({ code: "PENCIL_NOT_AUTHENTICATED" });
  });

  it("maps status runner throws to not authenticated", async () => {
    const home = await createHome("status-throw");
    const service = new PencilService({
      home,
      runner: createFakeRunner(async (_command, args) => {
        if (args[0] === "version") return { stdout: "1.0.0", stderr: "" };
        throw new Error("status failed");
      })
    });

    await expect(service.checkAvailability()).rejects.toMatchObject({ code: "PENCIL_NOT_AUTHENTICATED" });
  });

  it("sanitizes availability error details", async () => {
    const home = await createHome("availability-secrets");
    const token = "token-SECRET-123";
    const versionError = new Error(`failed with ${token}`);
    Object.assign(versionError, { stdout: token, stderr: token, exitCode: 127 });
    const missing = new PencilService({
      home,
      runner: createFakeRunner(async () => {
        throw versionError;
      })
    });
    await expect(missing.checkAvailability()).rejects.toSatisfy((error) => {
      expect(JSON.stringify(error.toJSON())).not.toContain(token);
      expect(error.toJSON().details).toMatchObject({ command: "version", exitCode: 127 });
      return true;
    });

    const inactive = new PencilService({
      home,
      runner: createFakeRunner(async (_command, args) => {
        if (args[0] === "version") return { stdout: "1.0.0", stderr: "" };
        return { stdout: `inactive ${token}`, stderr: token };
      })
    });
    await expect(inactive.checkAvailability()).rejects.toSatisfy((error) => {
      expect(JSON.stringify(error.toJSON())).not.toContain(token);
      expect(error.toJSON().details).toMatchObject({ command: "status" });
      return true;
    });
  });

  it("exportPreview validates PNG signature", async () => {
    const home = await createHome("export");
    const inputPen = join(home, "input.pen");
    const outputPng = join(home, "output.png");
    await writeFile(inputPen, JSON.stringify({ children: [{ id: "root" }] }));

    const emptyRunner = createFakeRunner(async () => {
      await writeFile(outputPng, "");
      return { stdout: "", stderr: "" };
    });
    await expect(new PencilService({ home, runner: emptyRunner }).exportPreview(inputPen, outputPng)).rejects.toMatchObject({
      code: "PEN_FILE_INVALID"
    });

    const invalidRunner = createFakeRunner(async () => {
      await writeFile(outputPng, "png");
      return { stdout: "", stderr: "" };
    });
    await expect(new PencilService({ home, runner: invalidRunner }).exportPreview(inputPen, outputPng)).rejects.toMatchObject({
      code: "PEN_FILE_INVALID"
    });

    const validRunner = createFakeRunner(async () => {
      await writeFile(outputPng, minimalPng);
      return { stdout: "", stderr: "" };
    });
    await expect(new PencilService({ home, runner: validRunner }).exportPreview(inputPen, outputPng)).resolves.toBeUndefined();
    expect(validRunner.calls.at(-1)?.args).toEqual(["--in", inputPen, "--export", outputPng, "--export-scale", "2"]);
  });

  it("exportAsset passes the requested export type for PDFs", async () => {
    const home = await createHome("pdf-export");
    const inputPen = join(home, "input.pen");
    const outputPdf = join(home, "output.pdf");
    await writeFile(inputPen, JSON.stringify({ children: [{ id: "root" }] }));
    const pdfRunner = createFakeRunner(async (_command, args) => {
      expect(args).toContain("--export-type");
      expect(args).toContain("pdf");
      await writeFile(outputPdf, "%PDF-1.7\n");
      return { stdout: "", stderr: "" };
    });

    await expect(new PencilService({ home, runner: pdfRunner }).exportAsset(inputPen, outputPdf, "pdf")).resolves.toBeUndefined();
    expect(pdfRunner.calls.at(-1)?.args).toEqual([
      "--in",
      inputPen,
      "--export",
      outputPdf,
      "--export-scale",
      "2",
      "--export-type",
      "pdf"
    ]);
  });

  it("generatePageDesign is unavailable as a v6 headless runtime write path", async () => {
    const home = await createHome("page-design");
    const fakeRunner = createFakeRunner();
    const service = new PencilService({ home, runner: fakeRunner });

    await expect(service.generatePageDesign({
      product_id: "P-page",
      prompt: "Create checkout",
      workspace: "/tmp/workspace"
    })).rejects.toMatchObject({ code: "PENCIL_CAPABILITY_UNAVAILABLE" });

    expect(fakeRunner.calls).toEqual([]);
  });

  it("generateComponents is unavailable as a v6 headless runtime write path", async () => {
    const home = await createHome("components");
    const finalLibraryPath = join(home, "library", "P-c0ffee.lib.pen");
    await mkdir(dirname(finalLibraryPath), { recursive: true });
    await writeFile(finalLibraryPath, "sentinel component library");
    const fakeRunner = createFakeRunner();
    const service = new PencilService({ home, runner: fakeRunner });

    await expect(service.generateComponents({
      product_id: "P-c0ffee",
      prompt: "Create controls",
      workspace: "/tmp/workspace"
    })).rejects.toMatchObject({ code: "PENCIL_CAPABILITY_UNAVAILABLE" });

    expect(await readFile(finalLibraryPath, "utf8")).toBe("sentinel component library");
    expect(fakeRunner.calls).toEqual([]);
  });

  it("rejects unsafe component library product ids before running Pencil", async () => {
    const home = await createHome("unsafe-components");
    const fakeRunner = createFakeRunner(async (_command, args) => {
      if (args[0] === "status") return { stdout: "active", stderr: "" };
      if (args.includes("--out")) {
        const out = args[args.indexOf("--out") + 1];
        await writeFile(out, JSON.stringify({ children: [{ id: "button", type: "component" }] }));
      }
      return { stdout: "ok", stderr: "" };
    });
    const service = new PencilService({ home, runner: fakeRunner });

    await expect(
      service.generateComponents({
        product_id: "../escape",
        prompt: "Create controls",
        workspace: "/tmp/workspace"
      })
    ).rejects.toMatchObject({ code: "PENCIL_CAPABILITY_UNAVAILABLE" });

    expect(fakeRunner.calls).toEqual([]);
    await expect(access(join(home, "escape.lib.pen"))).rejects.toThrow();
    await expect(access(join(dirname(home), "escape.lib.pen"))).rejects.toThrow();
  });

  it("does not create temp files for removed headless component generation", async () => {
    const home = await createHome("invalid-generated");
    let outputPen = "";
    const fakeRunner = createFakeRunner(async (_command, args) => {
      if (args[0] === "status") return { stdout: "active", stderr: "" };
      if (args.includes("--out")) {
        const out = args[args.indexOf("--out") + 1];
        outputPen = out;
        await writeFile(out, JSON.stringify({ children: [] }));
      }
      return { stdout: "ok", stderr: "" };
    });
    const service = new PencilService({ home, runner: fakeRunner });

    await expect(
      service.generateComponents({
        product_id: "P-badf00",
        prompt: "Create invalid output",
        workspace: "/tmp/workspace"
      })
    ).rejects.toMatchObject({ code: "PENCIL_CAPABILITY_UNAVAILABLE" });
    await expect(access(join(home, "pencil.lock"))).rejects.toThrow();
    expect(outputPen).toBe("");
  });

  it("does not create temp files for removed headless page design generation", async () => {
    const home = await createHome("preview-cleanup");
    let outputPen = "";
    const fakeRunner = createFakeRunner(async (_command, args) => {
      if (args[0] === "status") return { stdout: "active", stderr: "" };
      if (args.includes("--out")) {
        outputPen = args[args.indexOf("--out") + 1];
        await writeFile(outputPen, JSON.stringify({ children: [{ id: "root", type: "frame" }] }));
      }
      if (args.includes("--export")) {
        const output = args[args.indexOf("--export") + 1];
        await writeFile(output, "not a png");
      }
      return { stdout: "ok", stderr: "" };
    });
    const service = new PencilService({ home, runner: fakeRunner });

    await expect(
      service.generatePageDesign({
        product_id: "P-preview",
        prompt: "Create preview",
        workspace: "/tmp/workspace"
      })
    ).rejects.toMatchObject({ code: "PENCIL_CAPABILITY_UNAVAILABLE" });
    expect(outputPen).toBe("");
  });
});
