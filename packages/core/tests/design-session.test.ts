import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyRequirementDesignOperations,
  beginRequirementDesignSession,
  discardRequirementDesignSession,
  recoverDesignCommitJournal,
  readDesignStartupRecoveryState,
  readYaml,
  writeYamlAtomic,
  type PencilRunner
} from "../src/index.js";
import {
  applyProductComponentOperations,
  beginProductComponentSession,
  commitProductComponentSession,
  discardProductComponentSession
} from "../src/component-session.js";
import { commitRequirementDesignSessionWithCandidates } from "../src/design-session.js";
import { PencilAppSessionAdapter, type PencilInteractiveProcessFactory } from "../src/pencil-adapter.js";

const fullPencilCapabilityHelp = "get_editor_state get_guidelines get_variables batch_get batch_design set_variables export_nodes snapshot_layout get_screenshot save";

function createRunner(options: { failVersion?: boolean; failWrite?: boolean } = {}): PencilRunner {
  return {
    async run(_command, args) {
      if (options.failVersion && args[0] === "version") {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      if (options.failWrite && args[0] === "batch_design") {
        throw new Error("write failed");
      }
      if (args[0] === "version") return { stdout: "pencil 1.2.3", stderr: "" };
      if (args[0] === "status") return { stdout: "active", stderr: "" };
      if (args[0] === "interactive" && args[1] === "--help") {
        return { stdout: fullPencilCapabilityHelp, stderr: "" };
      }
      if (args[0] === "get_editor_state") return { stdout: "{\"schema\":true}", stderr: "" };
      return { stdout: "ok", stderr: "" };
    }
  };
}

function createProcessFactory(options: { failOpen?: boolean; alive?: boolean; activePath?: string } = {}): PencilInteractiveProcessFactory {
  return async (input) => {
    if (options.failOpen) {
      throw new Error("open failed");
    }
    let alive = options.alive ?? true;
    return {
      pid: process.pid + 3000,
      async send(message) {
        if (!alive) throw new Error("dead");
        return createProcessResponse(message, input.stagingPath, options.activePath);
      },
      isAlive: () => alive,
      async close() {
        alive = false;
      }
    };
  };
}

function createControllableProcessFactory(): { factory: PencilInteractiveProcessFactory; killAll: () => void } {
  const aliveFlags: Array<{ alive: boolean }> = [];
  return {
    factory: async (input) => {
      const state = { alive: true };
      aliveFlags.push(state);
      return {
        pid: process.pid + 4000 + aliveFlags.length,
        async send(message) {
          if (!state.alive) throw new Error("dead");
          return createProcessResponse(message, input.stagingPath);
        },
        isAlive: () => state.alive,
        async close() {
          state.alive = false;
        }
      };
    },
    killAll: () => {
      for (const state of aliveFlags) state.alive = false;
    }
  };
}

function createWritingProcessFactory(options: { failBatchWrites?: number[] } = {}): PencilInteractiveProcessFactory {
  const failBatchWrites = new Set(options.failBatchWrites ?? []);
  let batchWrites = 0;
  return async (input) => {
    let alive = true;
    return {
      pid: process.pid + 7000 + Math.floor(Math.random() * 1000),
      async send(message) {
        if (!alive) throw new Error("dead");
        const openTimeResponse = createOpenTimeProcessResponse(message, input.stagingPath);
        if (openTimeResponse) return openTimeResponse;
        if (message.startsWith("batch_design(")) {
          batchWrites += 1;
          if (failBatchWrites.has(batchWrites)) {
            throw new Error(`write ${batchWrites} failed`);
          }
          const payload = JSON.parse(message.slice("batch_design(".length, -1)) as Record<string, unknown>;
          await writeFile(input.stagingPath, JSON.stringify({ children: [{ id: payload.id ?? `op-${batchWrites}`, type: "frame" }] }));
        }
        return { stdout: "ok\n", stderr: "" };
      },
      isAlive: () => alive,
      async close() {
        alive = false;
      }
    };
  };
}

function createProcessResponse(message: string, stagingPath: string, activePath?: string): { stdout: string; stderr: string } {
  return createOpenTimeProcessResponse(message, stagingPath, activePath) ?? { stdout: "ok\n", stderr: "" };
}

function createOpenTimeProcessResponse(message: string, stagingPath: string, activePath?: string): { stdout: string; stderr: string } | undefined {
  if (message.startsWith("get_editor_state")) {
    return { stdout: `${JSON.stringify({ schema: true, filePath: activePath ?? stagingPath })}\n`, stderr: "" };
  }
  if (message.startsWith("batch_get")) {
    return { stdout: `${JSON.stringify({ nodes: extractBatchGetNodeIds(message).map((id) => ({ id })) })}\n`, stderr: "" };
  }
  return undefined;
}

function extractBatchGetNodeIds(message: string): string[] {
  const payload = JSON.parse(message.slice("batch_get(".length, -1)) as { nodeIds?: string[] };
  return payload.nodeIds ?? [];
}

async function readJsonl(file: string): Promise<Record<string, unknown>[]> {
  const raw = await readFile(file, "utf8");
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function createHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "forma-design-session-"));
  await mkdir(join(home, "data", "P-123abc", "R-1234abcd"), { recursive: true });
  await writeYamlAtomic(join(home, "data", "P-123abc", "R-1234abcd", "requirement.yaml"), requirementFixture());
  await writeComponentLibrary(home);
  return home;
}

async function createEmptyComponentHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "forma-design-session-"));
  await mkdir(join(home, "data", "P-123abc"), { recursive: true });
  return home;
}

async function writeComponentLibrary(home: string): Promise<void> {
  const lib = JSON.stringify({ children: [{ id: "button", type: "component" }] });
  const checksum = `sha256:${createHash("sha256").update(lib).digest("hex")}`;
  await mkdir(join(home, "library", "P-123abc.versions"), { recursive: true });
  await writeFile(join(home, "library", "P-123abc.lib.pen"), lib);
  await writeFile(join(home, "library", "P-123abc.versions", "1.lib.pen"), lib);
  await writeYamlAtomic(join(home, "library", "P-123abc.components.yaml"), {
    product_id: "P-123abc",
    current_version: 1,
    latest_file: "P-123abc.lib.pen",
    versions: [{ version: 1, file: "P-123abc.versions/1.lib.pen", checksum, components: [{ key: "button", name: "Button" }] }]
  });
}

function requirementFixture() {
  return {
    id: "R-1234abcd",
    product_id: "P-123abc",
    title: "Checkout",
    status: "submitted",
    ui_affected: true,
    created_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:00:00.000Z",
    pages: [{
      page_id: "home",
      name: "Home",
      baseline_page: "B-home",
      design_status: "pending",
      copy: [{ context: "title", text: "Home" }],
      declared_fields: [],
      declared_actions: [{ key: "save", label: "Save" }],
      declared_component_keys: ["button"],
      semantic_contract: {
        fields: [],
        actions: [{ key: "save", label: "Save" }],
        navigation: [],
        component_keys: ["button"],
        allowed_copy: ["Home"]
      },
      semantic_contract_coverage: "explicit"
    }],
    navigation: []
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

describe("v6 requirement design sessions", () => {
  it("runs preflight before leases or staging files", async () => {
    const home = await createHome();
    await expect(beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "generate",
      runner: createRunner({ failVersion: true })
    })).rejects.toMatchObject({ code: "PENCIL_CLI_NOT_FOUND" });

    await expect(exists(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"))).resolves.toBe(false);
    await expect(exists(join(home, "data", "P-123abc", "R-1234abcd", "sessions"))).resolves.toBe(false);
  });

  it("blocks requirement sessions when semantic scope cannot be derived", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-design-session-"));
    await mkdir(join(home, "data", "P-123abc", "R-1234abcd"), { recursive: true });
    await writeComponentLibrary(home);

    await expect(beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "generate",
      runner: createRunner(),
      processFactory: createProcessFactory()
    })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      details: { failed_phase: "semantic_scope_derivation" }
    });

    await expect(exists(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"))).resolves.toBe(false);
    await expect(exists(join(home, "data", "P-123abc", "R-1234abcd", "sessions", "active.yaml"))).resolves.toBe(false);
    await expect(exists(join(home, "data", "P-123abc", "R-1234abcd", "sessions"))).resolves.toBe(false);
  });

  it("begins an app-bound requirement session with leases and empty staging", async () => {
    const home = await createHome();
    const result = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "generate",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });

    expect(result).toMatchObject({ mode: "app", canvas_state: "created_empty" });
    await expect(exists(result.staging_path)).resolves.toBe(true);
    await expect(readYaml(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"))).resolves.toMatchObject({
      session_id: result.session_id,
      scope: "requirement_canvas"
    });
    await expect(readYaml(join(home, "data", "P-123abc", "R-1234abcd", "sessions", "active.yaml"))).resolves.toMatchObject({
      session_id: result.session_id
    });
    await expect(readYaml(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"))).resolves.toMatchObject({
      owner_path: "data/P-123abc/R-1234abcd/sessions/active.yaml",
      local_active_path: "data/P-123abc/R-1234abcd/sessions/active.yaml"
    });
  });

  it("preserves adapter reason when requirement begin fails during active editor convergence", async () => {
    const home = await createHome();
    const other = join(home, "other.pen");
    await writeFile(other, JSON.stringify({ children: [{ id: "other", type: "frame" }] }));

    let error: unknown;
    try {
      await beginRequirementDesignSession({
        home,
        product_id: "P-123abc",
        requirement_id: "R-1234abcd",
        operation: "generate",
        runner: createRunner(),
        processFactory: createProcessFactory({ activePath: other })
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "PENCIL_APP_REQUIRED",
      details: {
        reason: "active_editor_path_mismatch"
      }
    });
    const sessionId = (error as { details?: { session_id?: string } }).details?.session_id;
    expect(sessionId).toEqual(expect.any(String));
    await expect(readYaml(join(home, "data", "P-123abc", "R-1234abcd", "sessions", "failed-begins", `${sessionId}.yaml`))).resolves.toMatchObject({
      reason: "active_editor_path_mismatch"
    });
  });

  it("rejects path-like apply args and detects manual staging edits", async () => {
    const home = await createHome();
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "generate",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });

    await expect(applyRequirementDesignOperations({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory: createProcessFactory(),
      operations: [{ tool: "batch_design", args: { outputDir: "/tmp/out" }, intent: "generate" }]
    })).rejects.toMatchObject({ code: "FORBIDDEN_PATH_PARAMETER" });

    await writeFile(session.staging_path, JSON.stringify({ children: [{ id: "manual", type: "frame" }] }));
    await expect(applyRequirementDesignOperations({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory: createProcessFactory(),
      operations: [{ tool: "batch_design", args: { nodes: [] }, intent: "generate" }]
    })).rejects.toMatchObject({ code: "MANUAL_EDIT_DETECTED" });
  });

  it("records requirement batch partial success and allows retry without manual-edit detection", async () => {
    const home = await createHome();
    const processFactory = createWritingProcessFactory({ failBatchWrites: [2] });
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "generate",
      runner: createRunner(),
      processFactory
    });
    const sessionDir = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id);
    const sessionFile = join(sessionDir, "design_session.yaml");
    const operationLog = join(sessionDir, "operations.jsonl");

    await expect(applyRequirementDesignOperations({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory,
      operations: [
        { tool: "batch_design", args: { id: "op-1" }, intent: "generate" },
        { tool: "batch_design", args: { id: "op-2" }, intent: "generate" }
      ]
    })).rejects.toThrow("write 2 failed");

    const postOp1Revision = `sha256:${createHash("sha256").update(await readFile(session.staging_path)).digest("hex")}`;
    await expect(readYaml(sessionFile)).resolves.toMatchObject({
      status: "failed_operation",
      last_saved_revision: postOp1Revision,
      last_controlled_revision: postOp1Revision
    });
    expect(await readJsonl(operationLog)).toEqual([
      expect.objectContaining({ sequence: 1, status: "applied", before_revision: expect.any(String), after_revision: postOp1Revision }),
      expect.objectContaining({ sequence: 2, status: "failed", before_revision: postOp1Revision, error: "write 2 failed" })
    ]);

    await expect(applyRequirementDesignOperations({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory,
      operations: [{ tool: "batch_design", args: { id: "retry-op-2" }, intent: "generate" }]
    })).resolves.toMatchObject({ sequence_start: 3, sequence_end: 3 });
    expect(await readJsonl(operationLog)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sequence: 3, status: "applied", retry_of_sequence: 2, before_revision: postOp1Revision })
    ]));
  });

  it("marks every requirement operation applied in a successful multi-op batch", async () => {
    const home = await createHome();
    const processFactory = createWritingProcessFactory();
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "generate",
      runner: createRunner(),
      processFactory
    });
    const operationLog = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "operations.jsonl");

    await expect(applyRequirementDesignOperations({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory,
      operations: [
        { tool: "batch_design", args: { id: "op-1" }, intent: "generate" },
        { tool: "batch_design", args: { id: "op-2" }, intent: "refine" }
      ]
    })).resolves.toMatchObject({ sequence_start: 1, sequence_end: 2 });

    const entries = await readJsonl(operationLog);
    expect(entries).toEqual([
      expect.objectContaining({ sequence: 1, status: "applied", intent: "generate", after_revision: expect.stringMatching(/^sha256:/) }),
      expect.objectContaining({ sequence: 2, status: "applied", intent: "refine", after_revision: expect.stringMatching(/^sha256:/) })
    ]);
    expect(entries[1].before_revision).toBe(entries[0].after_revision);
  });

  it("commits complete synthetic candidates and can restore a commit journal", async () => {
    const home = await createHome();
    const formal = join(home, "data", "P-123abc", "R-1234abcd", "design.pen");
    await writeFile(formal, JSON.stringify({ children: [{ id: "old", type: "frame" }] }));
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const candidate = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "candidate.design.pen");
    await writeFile(candidate, JSON.stringify({ children: [{ id: "new", type: "frame" }] }));

    await expect(commitRequirementDesignSessionWithCandidates({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory: createProcessFactory(),
      candidates: [{
        target_file: "data/P-123abc/R-1234abcd/design.pen",
        candidate_file: `data/P-123abc/R-1234abcd/sessions/${session.session_id}/candidate.design.pen`,
        replacement_kind: "design_canvas",
        restore_order: 1
      }]
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const oldHash = `sha256:${createHash("sha256").update(await readFile(formal)).digest("hex")}`;
    const candidateHash = `sha256:${createHash("sha256").update(await readFile(candidate)).digest("hex")}`;
    await expect(commitRequirementDesignSessionWithCandidates({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory: createProcessFactory(),
      candidates: [{
        target_file: "data/P-123abc/R-1234abcd/design.pen",
        candidate_file: `data/P-123abc/R-1234abcd/sessions/${session.session_id}/candidate.design.pen`,
        old_hash: oldHash,
        candidate_hash: candidateHash,
        replacement_kind: "design_canvas",
        restore_order: 1
      }]
    })).resolves.toMatchObject({ status: "committed" });
    await expect(readFile(formal, "utf8")).resolves.toContain("new");
    await expect(new PencilAppSessionAdapter({ home, runner: createRunner() }).controlledSave(session.pencil_binding_id)).rejects.toMatchObject({ code: "PENCIL_APP_REQUIRED" });

    await writeYamlAtomic(join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "design_session.yaml"), {
      ...(await readYaml<Record<string, unknown>>(join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "design_session.yaml"))),
      status: "commit_recovery_required"
    });
    await expect(recoverDesignCommitJournal({
      home,
      session_id: session.session_id,
      scope: "requirement_canvas"
    })).resolves.toMatchObject({ status: "failed_commit" });
    await expect(readFile(formal, "utf8")).resolves.toContain("old");
  });

  it("does not report a committed requirement journal during startup recovery", async () => {
    const home = await createHome();
    const formal = join(home, "data", "P-123abc", "R-1234abcd", "design.pen");
    await writeFile(formal, JSON.stringify({ children: [{ id: "old", type: "frame" }] }));
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const candidate = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "candidate.design.pen");
    await writeFile(candidate, JSON.stringify({ children: [{ id: "new", type: "frame" }] }));
    const oldHash = `sha256:${createHash("sha256").update(await readFile(formal)).digest("hex")}`;
    const candidateHash = `sha256:${createHash("sha256").update(await readFile(candidate)).digest("hex")}`;

    await expect(commitRequirementDesignSessionWithCandidates({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory: createProcessFactory(),
      candidates: [{
        target_file: "data/P-123abc/R-1234abcd/design.pen",
        candidate_file: `data/P-123abc/R-1234abcd/sessions/${session.session_id}/candidate.design.pen`,
        old_hash: oldHash,
        candidate_hash: candidateHash,
        replacement_kind: "design_canvas",
        restore_order: 1
      }]
    })).resolves.toMatchObject({ status: "committed" });
    await expect(readYaml(join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "commit-journal.yaml"))).resolves.toMatchObject({
      status: "committed"
    });

    const recovery = await readDesignStartupRecoveryState(home);
    expect(recovery.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "commit_journal", scope: "requirement_canvas", session_id: session.session_id })
    ]));
  });

  it("rejects commit when a formal canvas appears after a missing-baseline session began", async () => {
    const home = await createHome();
    const formal = join(home, "data", "P-123abc", "R-1234abcd", "design.pen");
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "generate",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const newFormal = JSON.stringify({ children: [{ id: "new-formal", type: "frame" }] });
    await writeFile(formal, newFormal);
    const candidate = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "candidate.design.pen");
    await writeFile(candidate, JSON.stringify({ children: [{ id: "candidate", type: "frame" }] }));
    const candidateHash = `sha256:${createHash("sha256").update(await readFile(candidate)).digest("hex")}`;

    await expect(commitRequirementDesignSessionWithCandidates({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory: createProcessFactory(),
      candidates: [{
        target_file: "data/P-123abc/R-1234abcd/design.pen",
        candidate_file: `data/P-123abc/R-1234abcd/sessions/${session.session_id}/candidate.design.pen`,
        old_file_missing: true,
        candidate_hash: candidateHash,
        replacement_kind: "design_canvas",
        restore_order: 1
      }]
    })).rejects.toMatchObject({ code: "DESIGN_CANVAS_CHANGED" });

    await expect(readFile(formal, "utf8")).resolves.toBe(newFormal);
  });

  it("rejects requirement commit candidates that claim an existing target is missing", async () => {
    const home = await createHome();
    const formal = join(home, "data", "P-123abc", "R-1234abcd", "design.pen");
    const original = JSON.stringify({ children: [{ id: "old", type: "frame" }] });
    await writeFile(formal, original);
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const candidate = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "candidate.design.pen");
    await writeFile(candidate, JSON.stringify({ children: [{ id: "new", type: "frame" }] }));
    const candidateHash = `sha256:${createHash("sha256").update(await readFile(candidate)).digest("hex")}`;

    await expect(commitRequirementDesignSessionWithCandidates({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory: createProcessFactory(),
      candidates: [{
        target_file: "data/P-123abc/R-1234abcd/design.pen",
        candidate_file: `data/P-123abc/R-1234abcd/sessions/${session.session_id}/candidate.design.pen`,
        old_file_missing: true,
        candidate_hash: candidateHash,
        replacement_kind: "design_canvas",
        restore_order: 1
      }]
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(readFile(formal, "utf8")).resolves.toBe(original);
  });

  it("rejects requirement commit when an existing baseline canvas is deleted before commit", async () => {
    const home = await createHome();
    const formal = join(home, "data", "P-123abc", "R-1234abcd", "design.pen");
    const original = JSON.stringify({ children: [{ id: "old", type: "frame" }] });
    await writeFile(formal, original);
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    await rm(formal, { force: true });
    const candidate = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "candidate.design.pen");
    await writeFile(candidate, JSON.stringify({ children: [{ id: "new", type: "frame" }] }));
    const candidateHash = `sha256:${createHash("sha256").update(await readFile(candidate)).digest("hex")}`;
    const sessionDir = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id);

    await expect(commitRequirementDesignSessionWithCandidates({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory: createProcessFactory(),
      candidates: [{
        target_file: "data/P-123abc/R-1234abcd/design.pen",
        candidate_file: `data/P-123abc/R-1234abcd/sessions/${session.session_id}/candidate.design.pen`,
        old_file_missing: true,
        candidate_hash: candidateHash,
        replacement_kind: "design_canvas",
        restore_order: 1
      }]
    })).rejects.toMatchObject({ code: "DESIGN_CANVAS_CHANGED" });

    await expect(exists(formal)).resolves.toBe(false);
    await expect(exists(join(sessionDir, "commit-journal.yaml"))).resolves.toBe(false);
    await expect(readYaml(join(sessionDir, "design_session.yaml"))).resolves.toMatchObject({ status: "running" });
  });

  it("rejects commit candidates in sibling-prefixed session directories", async () => {
    const home = await createHome();
    const formal = join(home, "data", "P-123abc", "R-1234abcd", "design.pen");
    await writeFile(formal, JSON.stringify({ children: [{ id: "old", type: "frame" }] }));
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const siblingCandidate = join(home, "data", "P-123abc", "R-1234abcd", "sessions", `${session.session_id}-evil`, "candidate.design.pen");
    await mkdir(join(siblingCandidate, ".."), { recursive: true });
    await writeFile(siblingCandidate, JSON.stringify({ children: [{ id: "evil", type: "frame" }] }));
    const oldHash = `sha256:${createHash("sha256").update(await readFile(formal)).digest("hex")}`;
    const candidateHash = `sha256:${createHash("sha256").update(await readFile(siblingCandidate)).digest("hex")}`;

    await expect(commitRequirementDesignSessionWithCandidates({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory: createProcessFactory(),
      candidates: [{
        target_file: "data/P-123abc/R-1234abcd/design.pen",
        candidate_file: `data/P-123abc/R-1234abcd/sessions/${session.session_id}-evil/candidate.design.pen`,
        old_hash: oldHash,
        candidate_hash: candidateHash,
        replacement_kind: "design_canvas",
        restore_order: 1
      }]
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects symlink requirement commit candidates that escape the session directory", async () => {
    const home = await createHome();
    const formal = join(home, "data", "P-123abc", "R-1234abcd", "design.pen");
    await writeFile(formal, JSON.stringify({ children: [{ id: "old", type: "frame" }] }));
    const outside = join(home, "outside-candidate.design.pen");
    await writeFile(outside, JSON.stringify({ children: [{ id: "outside", type: "frame" }] }));
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const candidateLink = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "candidate.design.pen");
    await symlink(outside, candidateLink);
    const oldHash = `sha256:${createHash("sha256").update(await readFile(formal)).digest("hex")}`;
    const candidateHash = `sha256:${createHash("sha256").update(await readFile(outside)).digest("hex")}`;

    await expect(commitRequirementDesignSessionWithCandidates({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory: createProcessFactory(),
      candidates: [{
        target_file: "data/P-123abc/R-1234abcd/design.pen",
        candidate_file: `data/P-123abc/R-1234abcd/sessions/${session.session_id}/candidate.design.pen`,
        old_hash: oldHash,
        candidate_hash: candidateHash,
        replacement_kind: "design_canvas",
        restore_order: 1
      }]
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(readFile(formal, "utf8")).resolves.toContain("old");
  });

  it("rejects requirement commit when the formal design target is a symlink", async () => {
    const home = await createHome();
    const formal = join(home, "data", "P-123abc", "R-1234abcd", "design.pen");
    await writeFile(formal, JSON.stringify({ children: [{ id: "old", type: "frame" }] }));
    const outside = join(home, "outside-target.design.pen");
    await writeFile(outside, JSON.stringify({ children: [{ id: "outside-old", type: "frame" }] }));
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    await rm(formal, { force: true });
    await symlink(outside, formal);
    const candidate = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "candidate.design.pen");
    await writeFile(candidate, JSON.stringify({ children: [{ id: "new", type: "frame" }] }));
    const oldHash = `sha256:${createHash("sha256").update(await readFile(outside)).digest("hex")}`;
    const candidateHash = `sha256:${createHash("sha256").update(await readFile(candidate)).digest("hex")}`;

    await expect(commitRequirementDesignSessionWithCandidates({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory: createProcessFactory(),
      candidates: [{
        target_file: "data/P-123abc/R-1234abcd/design.pen",
        candidate_file: `data/P-123abc/R-1234abcd/sessions/${session.session_id}/candidate.design.pen`,
        old_hash: oldHash,
        candidate_hash: candidateHash,
        replacement_kind: "design_canvas",
        restore_order: 1
      }]
    })).rejects.toMatchObject({ code: "DESIGN_CANVAS_CHANGED" });

    await expect(readFile(outside, "utf8")).resolves.toContain("outside-old");
  });

  it("records recovery failure instead of writing through a symlinked requirement rollback target", async () => {
    const home = await createHome();
    const formal = join(home, "data", "P-123abc", "R-1234abcd", "design.pen");
    const original = JSON.stringify({ children: [{ id: "old", type: "frame" }] });
    await writeFile(formal, original);
    const outside = join(home, "outside-requirement-rollback.design.pen");
    await writeFile(outside, "outside-old");

    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      let promotionRenames = 0;
      return {
        ...actual,
        rename: vi.fn(async (oldPath: Parameters<typeof actual.rename>[0], newPath: Parameters<typeof actual.rename>[1]) => {
          const oldPathString = String(oldPath);
          const newPathString = String(newPath);
          if (oldPathString.includes("/.forma-") && !oldPathString.includes("/.forma-restore-") && newPathString === formal) {
            promotionRenames += 1;
            if (promotionRenames === 2) {
              await actual.rm(newPathString, { force: true });
              await actual.symlink(outside, newPathString);
              throw new Error("promotion failed after target swap");
            }
          }
          return actual.rename(oldPath, newPath);
        })
      };
    });
    const designSession = await import("../src/design-session.js");
    const session = await designSession.beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const candidate1 = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "candidate-1.design.pen");
    const candidate2 = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "candidate-2.design.pen");
    await writeFile(candidate1, JSON.stringify({ children: [{ id: "new-1", type: "frame" }] }));
    await writeFile(candidate2, JSON.stringify({ children: [{ id: "new-2", type: "frame" }] }));
    const oldHash = `sha256:${createHash("sha256").update(original).digest("hex")}`;
    const candidateHash1 = `sha256:${createHash("sha256").update(await readFile(candidate1)).digest("hex")}`;
    const candidateHash2 = `sha256:${createHash("sha256").update(await readFile(candidate2)).digest("hex")}`;

    await expect(designSession.commitRequirementDesignSessionWithCandidates({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory: createProcessFactory(),
      candidates: [
        {
          target_file: "data/P-123abc/R-1234abcd/design.pen",
          candidate_file: `data/P-123abc/R-1234abcd/sessions/${session.session_id}/candidate-1.design.pen`,
          old_hash: oldHash,
          candidate_hash: candidateHash1,
          replacement_kind: "design_canvas",
          restore_order: 1
        },
        {
          target_file: "data/P-123abc/R-1234abcd/design.pen",
          candidate_file: `data/P-123abc/R-1234abcd/sessions/${session.session_id}/candidate-2.design.pen`,
          old_hash: oldHash,
          candidate_hash: candidateHash2,
          replacement_kind: "design_canvas",
          restore_order: 2
        }
      ]
    })).rejects.toMatchObject({ code: "DESIGN_COMMIT_RECOVERY_REQUIRED" });

    await expect(readFile(outside, "utf8")).resolves.toBe("outside-old");
    await expect(readYaml(join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({
      status: "commit_recovery_required"
    });
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("reports requirement rollback failure without applying a corrupted backup", async () => {
    const home = await createHome();
    const formal = join(home, "data", "P-123abc", "R-1234abcd", "design.pen");
    const original = JSON.stringify({ children: [{ id: "old", type: "frame" }] });
    const candidateContent = JSON.stringify({ children: [{ id: "new", type: "frame" }] });
    await writeFile(formal, original);
    let activeSessionId = "";

    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        rename: vi.fn(async (oldPath: Parameters<typeof actual.rename>[0], newPath: Parameters<typeof actual.rename>[1]) => {
          const oldPathString = String(oldPath);
          const newPathString = String(newPath);
          if (oldPathString.includes("/.forma-") && !oldPathString.includes("/.forma-restore-") && newPathString === formal) {
            await actual.rename(oldPath, newPath);
            await actual.writeFile(
              join(home, "data", "P-123abc", "R-1234abcd", "sessions", activeSessionId, "backup", "1-design.pen.bak"),
              "corrupted backup"
            );
            throw new Error("promotion failed after corrupt backup");
          }
          return actual.rename(oldPath, newPath);
        })
      };
    });
    const designSession = await import("../src/design-session.js");
    const session = await designSession.beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    activeSessionId = session.session_id;
    const candidate = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "candidate.design.pen");
    await writeFile(candidate, candidateContent);
    const oldHash = `sha256:${createHash("sha256").update(original).digest("hex")}`;
    const candidateHash = `sha256:${createHash("sha256").update(candidateContent).digest("hex")}`;

    await expect(designSession.commitRequirementDesignSessionWithCandidates({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory: createProcessFactory(),
      candidates: [{
        target_file: "data/P-123abc/R-1234abcd/design.pen",
        candidate_file: `data/P-123abc/R-1234abcd/sessions/${session.session_id}/candidate.design.pen`,
        old_hash: oldHash,
        candidate_hash: candidateHash,
        replacement_kind: "design_canvas",
        restore_order: 1
      }]
    })).rejects.toMatchObject({
      code: "DESIGN_COMMIT_RECOVERY_REQUIRED",
      details: expect.objectContaining({
        failed_files: [expect.objectContaining({ reason: expect.stringContaining("backup hash mismatch") })]
      })
    });

    await expect(readFile(formal, "utf8")).resolves.toBe(candidateContent);
    await expect(readYaml(join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({
      status: "commit_recovery_required"
    });
    const targetDirEntries = await readdir(join(home, "data", "P-123abc", "R-1234abcd"));
    expect(targetDirEntries.some((entry) => entry.startsWith(".forma-restore-"))).toBe(false);
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("prioritizes commit journals during startup recovery and ignores page-level D directories", async () => {
    const home = await createHome();
    await mkdir(join(home, "data", "P-123abc", "R-1234abcd", "D-legacy"), { recursive: true });
    await mkdir(join(home, "data", "P-123abc", "R-1234abcd", "sessions", "S-recover"), { recursive: true });
    await writeYamlAtomic(join(home, "data", "P-123abc", "R-1234abcd", "sessions", "S-recover", "design_session.yaml"), {
      session_id: "S-recover",
      status: "running",
      scope: "requirement_canvas"
    });
    await writeYamlAtomic(join(home, "data", "P-123abc", "R-1234abcd", "sessions", "S-recover", "commit-journal.yaml"), {
      session_id: "S-recover",
      scope: "requirement_canvas",
      status: "committing",
      entries: []
    });

    await expect(readDesignStartupRecoveryState(home)).resolves.toMatchObject({
      items: [expect.objectContaining({ kind: "commit_journal", session_id: "S-recover" })]
    });
  });

  it.each(["committing", "restore_failed", "commit_recovery_required"])("reports %s requirement journals during startup recovery", async (status) => {
    const home = await createHome();
    const sessionId = `S-${status}`;
    const sessionDir = join(home, "data", "P-123abc", "R-1234abcd", "sessions", sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeYamlAtomic(join(sessionDir, "commit-journal.yaml"), {
      session_id: sessionId,
      scope: "requirement_canvas",
      status,
      entries: [
        { target_file: "data/P-123abc/R-1234abcd/design.pen", replacement_kind: "design_canvas", restore_order: 1 }
      ]
    });

    await expect(readDesignStartupRecoveryState(home)).resolves.toMatchObject({
      items: [expect.objectContaining({ kind: "commit_journal", session_id: sessionId, affected_files: ["data/P-123abc/R-1234abcd/design.pen"] })]
    });
  });

  it("rejects requirement recovery journals that target unrelated home files", async () => {
    const home = await createHome();
    const unrelated = join(home, "data", "P-123abc", "unrelated.txt");
    await writeFile(unrelated, "keep-me");
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const sessionDir = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id);
    await writeYamlAtomic(join(sessionDir, "commit-journal.yaml"), {
      session_id: session.session_id,
      scope: "requirement_canvas",
      status: "committing",
      entries: [
        { target_file: "data/P-123abc/unrelated.txt", old_file_missing: true, replacement_kind: "design_canvas", restore_order: 1 }
      ]
    });

    await expect(recoverDesignCommitJournal({
      home,
      session_id: session.session_id,
      scope: "requirement_canvas"
    })).resolves.toMatchObject({
      status: "commit_recovery_required",
      failed_files: [expect.objectContaining({ reason: expect.stringContaining("active requirement design canvas") })]
    });

    await expect(readFile(unrelated, "utf8")).resolves.toBe("keep-me");
    await expect(readYaml(join(sessionDir, "design_session.yaml"))).resolves.toMatchObject({ status: "commit_recovery_required" });
  });

  it("rejects requirement recovery journals that mark an existing baseline canvas as missing", async () => {
    const home = await createHome();
    const formal = join(home, "data", "P-123abc", "R-1234abcd", "design.pen");
    const original = JSON.stringify({ children: [{ id: "baseline", type: "frame" }] });
    await writeFile(formal, original);
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const sessionDir = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id);
    await writeYamlAtomic(join(sessionDir, "commit-journal.yaml"), {
      session_id: session.session_id,
      scope: "requirement_canvas",
      status: "committing",
      entries: [
        {
          target_file: "data/P-123abc/R-1234abcd/design.pen",
          old_file_missing: true,
          replacement_kind: "design_canvas",
          restore_order: 1
        }
      ]
    });

    await expect(recoverDesignCommitJournal({
      home,
      session_id: session.session_id,
      scope: "requirement_canvas"
    })).resolves.toMatchObject({
      status: "commit_recovery_required",
      failed_files: [expect.objectContaining({ reason: expect.stringContaining("existing baseline canvas") })]
    });

    await expect(readFile(formal, "utf8")).resolves.toBe(original);
    await expect(readYaml(join(sessionDir, "design_session.yaml"))).resolves.toMatchObject({ status: "commit_recovery_required" });
  });

  it("rejects recovery backups outside the requirement session backup directory", async () => {
    const home = await createHome();
    const formal = join(home, "data", "P-123abc", "R-1234abcd", "design.pen");
    const currentFormal = JSON.stringify({ children: [{ id: "partial-current", type: "frame" }] });
    await writeFile(formal, currentFormal);
    const outsideBackup = join(home, "data", "P-123abc", "outside-design.bak");
    await writeFile(outsideBackup, "old-formal");
    const oldHash = `sha256:${createHash("sha256").update(await readFile(outsideBackup)).digest("hex")}`;
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const sessionDir = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id);
    await mkdir(join(sessionDir, "backup"), { recursive: true });
    await writeYamlAtomic(join(sessionDir, "commit-journal.yaml"), {
      session_id: session.session_id,
      scope: "requirement_canvas",
      status: "committing",
      entries: [
        {
          target_file: "data/P-123abc/R-1234abcd/design.pen",
          old_hash: oldHash,
          backup_file: "data/P-123abc/outside-design.bak",
          replacement_kind: "design_canvas",
          restore_order: 1
        }
      ]
    });

    await expect(recoverDesignCommitJournal({
      home,
      session_id: session.session_id,
      scope: "requirement_canvas"
    })).resolves.toMatchObject({
      status: "commit_recovery_required",
      failed_files: [expect.objectContaining({ reason: expect.stringContaining("session backup directory") })]
    });

    await expect(readFile(formal, "utf8")).resolves.toBe(currentFormal);
    await expect(readYaml(join(sessionDir, "design_session.yaml"))).resolves.toMatchObject({ status: "commit_recovery_required" });
  });

  it("discards staging while keeping formal canvas and audit files", async () => {
    const home = await createHome();
    const formal = join(home, "data", "P-123abc", "R-1234abcd", "design.pen");
    await writeFile(formal, JSON.stringify({ children: [{ id: "formal", type: "frame" }] }));
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });

    await expect(discardRequirementDesignSession({ home, session_id: session.session_id })).resolves.toMatchObject({ status: "discarded" });
    await expect(exists(session.staging_path)).resolves.toBe(false);
    await expect(exists(formal)).resolves.toBe(true);
    await expect(exists(join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "design_session.yaml"))).resolves.toBe(true);
    await expect(new PencilAppSessionAdapter({ home, runner: createRunner() }).controlledSave(session.pencil_binding_id)).rejects.toMatchObject({ code: "PENCIL_APP_REQUIRED" });
  });

  it("rejects malformed requirement session ids before path lookup", async () => {
    const home = await createHome();
    await expect(discardRequirementDesignSession({ home, session_id: "../../outside" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(commitRequirementDesignSessionWithCandidates({
      home,
      session_id: "S-1234567890abcdef/../evil",
      runner: createRunner(),
      processFactory: createProcessFactory(),
      candidates: [{
        target_file: "data/P-123abc/R-1234abcd/design.pen",
        candidate_file: "data/P-123abc/R-1234abcd/sessions/S-1234567890abcdef/candidate.design.pen",
        old_file_missing: true,
        candidate_hash: `sha256:${"a".repeat(64)}`,
        replacement_kind: "design_canvas",
        restore_order: 1
      }]
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(exists(join(home, "outside"))).resolves.toBe(false);
  });

  it("rejects corrupted requirement session path metadata before discard", async () => {
    const home = await createHome();
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const sessionFile = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "design_session.yaml");
    await writeYamlAtomic(sessionFile, {
      ...(await readYaml<Record<string, unknown>>(sessionFile)),
      staging_path: "/tmp/evil/staging.design.pen"
    });

    await expect(discardRequirementDesignSession({ home, session_id: session.session_id })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(exists(session.staging_path)).resolves.toBe(true);

    await writeYamlAtomic(sessionFile, {
      ...(await readYaml<Record<string, unknown>>(sessionFile)),
      staging_path: `data/P-123abc/R-1234abcd/sessions/${session.session_id}/staging.design.pen`,
      session_dir: `data/P-123abc/R-1234abcd/sessions/${session.session_id}-evil`
    });

    await expect(discardRequirementDesignSession({ home, session_id: session.session_id })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(exists(session.staging_path)).resolves.toBe(true);
  });

  it("discards non-running requirement sessions when leases still point at the same session", async () => {
    for (const status of ["failed_operation", "blocked_manual_edit"]) {
      const home = await createHome();
      const session = await beginRequirementDesignSession({
        home,
        product_id: "P-123abc",
        requirement_id: "R-1234abcd",
        operation: "refine",
        runner: createRunner(),
        processFactory: createProcessFactory()
      });
      const sessionFile = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "design_session.yaml");
      await writeYamlAtomic(sessionFile, {
        ...(await readYaml<Record<string, unknown>>(sessionFile)),
        status
      });
      await expect(readYaml(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"))).resolves.toMatchObject({
        status: "running"
      });
      await expect(readYaml(join(home, "data", "P-123abc", "R-1234abcd", "sessions", "active.yaml"))).resolves.toMatchObject({
        status: "running"
      });

      await expect(discardRequirementDesignSession({ home, session_id: session.session_id })).resolves.toMatchObject({ status: "discarded" });

      await expect(exists(session.staging_path)).resolves.toBe(false);
      await expect(readYaml(sessionFile)).resolves.toMatchObject({ status: "discarded" });
      await expect(exists(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"))).resolves.toBe(false);
      await expect(exists(join(home, "data", "P-123abc", "R-1234abcd", "sessions", "active.yaml"))).resolves.toBe(false);
    }
  });

  it("discards recovered requirement sessions without a live binding and clears leases", async () => {
    for (const status of ["failed_commit", "recoverable"]) {
      const home = await createHome();
      const processes = createControllableProcessFactory();
      const session = await beginRequirementDesignSession({
        home,
        product_id: "P-123abc",
        requirement_id: "R-1234abcd",
        operation: "refine",
        runner: createRunner(),
        processFactory: processes.factory
      });
      const sessionFile = join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "design_session.yaml");
      await writeYamlAtomic(sessionFile, {
        ...(await readYaml<Record<string, unknown>>(sessionFile)),
        status
      });
      processes.killAll();

      await expect(discardRequirementDesignSession({ home, session_id: session.session_id })).resolves.toMatchObject({ status: "discarded" });

      await expect(exists(session.staging_path)).resolves.toBe(false);
      await expect(readYaml(sessionFile)).resolves.toMatchObject({ status: "discarded" });
      await expect(exists(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"))).resolves.toBe(false);
      await expect(exists(join(home, "data", "P-123abc", "R-1234abcd", "sessions", "active.yaml"))).resolves.toBe(false);
    }
  });

  it("rejects requirement discard when product or local lease no longer matches", async () => {
    const home = await createHome();
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    await writeYamlAtomic(join(home, "data", "P-123abc", "R-1234abcd", "sessions", "active.yaml"), {
      session_id: "S-other",
      scope: "requirement_canvas",
      canvas_path: "data/P-123abc/R-1234abcd/design.pen",
      staging_path: "elsewhere/staging.design.pen",
      status: "running"
    });

    await expect(discardRequirementDesignSession({ home, session_id: session.session_id })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(exists(session.staging_path)).resolves.toBe(true);
    await expect(readYaml(join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({
      status: "running"
    });
    await expect(readYaml(join(home, "data", "P-123abc", "R-1234abcd", "sessions", "active.yaml"))).resolves.toMatchObject({
      session_id: "S-other"
    });

    await writeYamlAtomic(join(home, "data", "P-123abc", "R-1234abcd", "sessions", "active.yaml"), {
      session_id: session.session_id,
      scope: "requirement_canvas",
      canvas_path: "data/P-123abc/R-1234abcd/design.pen",
      staging_path: `data/P-123abc/R-1234abcd/sessions/${session.session_id}/staging.design.pen`,
      status: "running"
    });
    await writeYamlAtomic(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"), {
      session_id: "S-other",
      scope: "requirement_canvas",
      canvas_path: "data/P-123abc/R-1234abcd/design.pen",
      staging_path: "elsewhere/staging.design.pen",
      status: "running"
    });

    await expect(discardRequirementDesignSession({ home, session_id: session.session_id })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(exists(session.staging_path)).resolves.toBe(true);
    await expect(readYaml(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"))).resolves.toMatchObject({
      session_id: "S-other"
    });
  });

  it("rejects requirement discard when product lease points at the wrong local active path", async () => {
    const home = await createHome();
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    await writeYamlAtomic(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"), {
      session_id: session.session_id,
      scope: "requirement_canvas",
      owner_path: "data/P-123abc/R-other/sessions/active.yaml",
      local_active_path: "data/P-123abc/R-other/sessions/active.yaml",
      canvas_path: "data/P-123abc/R-1234abcd/design.pen",
      staging_path: `data/P-123abc/R-1234abcd/sessions/${session.session_id}/staging.design.pen`,
      status: "running"
    });

    await expect(discardRequirementDesignSession({ home, session_id: session.session_id })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(exists(session.staging_path)).resolves.toBe(true);
    await expect(readYaml(join(home, "data", "P-123abc", "R-1234abcd", "sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({
      status: "running"
    });
  });

  it("rejects requirement discard when product lease local active path escapes Forma home", async () => {
    const home = await createHome();
    const session = await beginRequirementDesignSession({
      home,
      product_id: "P-123abc",
      requirement_id: "R-1234abcd",
      operation: "refine",
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    await writeYamlAtomic(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"), {
      session_id: session.session_id,
      scope: "requirement_canvas",
      owner_path: "../escape/active.yaml",
      local_active_path: "../escape/active.yaml",
      canvas_path: "data/P-123abc/R-1234abcd/design.pen",
      staging_path: `data/P-123abc/R-1234abcd/sessions/${session.session_id}/staging.design.pen`,
      status: "running"
    });

    await expect(discardRequirementDesignSession({ home, session_id: session.session_id })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(exists(session.staging_path)).resolves.toBe(true);
  });
});

describe("v6 product component sessions", () => {
  it("rejects component generation over an orphaned latest file without creating leases", async () => {
    const home = await createEmptyComponentHome();
    await mkdir(join(home, "library"), { recursive: true });
    await writeFile(join(home, "library", "P-123abc.lib.pen"), JSON.stringify({ children: [] }));

    await expect(beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "generate",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    })).rejects.toMatchObject({ code: "COMPONENT_LIBRARY_METADATA_MISSING" });

    await expect(exists(join(home, "library", "P-123abc.sessions"))).resolves.toBe(false);
    await expect(exists(join(home, "library", "P-123abc.sessions", "active.yaml"))).resolves.toBe(false);
    await expect(exists(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"))).resolves.toBe(false);
  });

  it("rejects component generation over an orphaned version snapshot without creating leases", async () => {
    const home = await createEmptyComponentHome();
    await mkdir(join(home, "library", "P-123abc.versions"), { recursive: true });
    await writeFile(join(home, "library", "P-123abc.versions", "1.lib.pen"), JSON.stringify({ children: [] }));

    await expect(beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "generate",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    })).rejects.toMatchObject({ code: "COMPONENT_LIBRARY_METADATA_MISSING" });

    await expect(exists(join(home, "library", "P-123abc.sessions"))).resolves.toBe(false);
    await expect(exists(join(home, "library", "P-123abc.sessions", "active.yaml"))).resolves.toBe(false);
    await expect(exists(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"))).resolves.toBe(false);
  });

  it("preserves adapter reason when component begin fails during active editor convergence", async () => {
    const home = await createHome();
    const other = join(home, "other.pen");
    await writeFile(other, JSON.stringify({ children: [{ id: "other", type: "frame" }] }));

    let error: unknown;
    try {
      await beginProductComponentSession({
        home,
        product_id: "P-123abc",
        operation: "refine",
        seed_components: [{ component_key: "button" }],
        runner: createRunner(),
        processFactory: createProcessFactory({ activePath: other })
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "PENCIL_APP_REQUIRED",
      details: {
        reason: "active_editor_path_mismatch"
      }
    });
    const sessionId = (error as { details?: { session_id?: string } }).details?.session_id;
    expect(sessionId).toEqual(expect.any(String));
    await expect(readYaml(join(home, "library", "P-123abc.sessions", "failed-begins", `${sessionId}.yaml`))).resolves.toMatchObject({
      reason: "active_editor_path_mismatch"
    });
  });

  it("discards staging while keeping formal component library and audit files", async () => {
    const home = await createHome();
    const formal = join(home, "library", "P-123abc.lib.pen");
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button", semantic_contract_hash: `sha256:${"a".repeat(64)}` }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const sessionDir = join(home, "library", "P-123abc.sessions", session.session_id);
    await writeFile(join(sessionDir, "commit-journal.yaml"), "status: audit\n");
    await mkdir(join(sessionDir, "backup"), { recursive: true });
    await writeFile(join(sessionDir, "backup", "latest.lib.pen.bak"), "backup");

    await expect(discardProductComponentSession({ home, session_id: session.session_id })).resolves.toMatchObject({ status: "discarded" });

    await expect(exists(session.staging_path)).resolves.toBe(false);
    await expect(exists(formal)).resolves.toBe(true);
    await expect(exists(join(home, "library", "P-123abc.versions", "1.lib.pen"))).resolves.toBe(true);
    await expect(exists(join(home, "library", "P-123abc.components.yaml"))).resolves.toBe(true);
    await expect(exists(join(sessionDir, "design_session.yaml"))).resolves.toBe(true);
    await expect(exists(join(sessionDir, "operations.jsonl"))).resolves.toBe(true);
    await expect(exists(join(sessionDir, "commit-journal.yaml"))).resolves.toBe(true);
    await expect(exists(join(sessionDir, "backup", "latest.lib.pen.bak"))).resolves.toBe(true);
    await expect(new PencilAppSessionAdapter({ home, runner: createRunner() }).controlledSave(session.pencil_binding_id)).rejects.toMatchObject({ code: "PENCIL_APP_REQUIRED" });
  });

  it("rejects malformed component session ids before path lookup", async () => {
    const home = await createHome();
    await expect(discardProductComponentSession({ home, session_id: "../../outside" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(commitProductComponentSession({ home, session_id: "S-1234567890abcdef/../evil" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(exists(join(home, "outside"))).resolves.toBe(false);
  });

  it("rejects corrupted component session metadata before discard", async () => {
    const home = await createHome();
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const sessionFile = join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml");
    await writeYamlAtomic(sessionFile, {
      ...(await readYaml<Record<string, unknown>>(sessionFile)),
      product_id: "../../outside"
    });

    await expect(discardProductComponentSession({ home, session_id: session.session_id })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(exists(session.staging_path)).resolves.toBe(true);

    await writeYamlAtomic(sessionFile, {
      ...(await readYaml<Record<string, unknown>>(sessionFile)),
      product_id: "P-123abc",
      staging_path: "/tmp/evil/staging.lib.pen"
    });

    await expect(discardProductComponentSession({ home, session_id: session.session_id })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(exists(session.staging_path)).resolves.toBe(true);
  });

  it("records component batch partial success and allows retry without manual-edit detection", async () => {
    const home = await createHome();
    const processFactory = createWritingProcessFactory({ failBatchWrites: [2] });
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory
    });
    const sessionDir = join(home, "library", "P-123abc.sessions", session.session_id);
    const sessionFile = join(sessionDir, "design_session.yaml");
    const operationLog = join(sessionDir, "operations.jsonl");

    await expect(applyProductComponentOperations({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory,
      operations: [
        { tool: "batch_design", args: { id: "component-op-1" }, intent: "refine" },
        { tool: "batch_design", args: { id: "component-op-2" }, intent: "refine" }
      ]
    })).rejects.toThrow("write 2 failed");

    const postOp1Revision = `sha256:${createHash("sha256").update(await readFile(session.staging_path)).digest("hex")}`;
    await expect(readYaml(sessionFile)).resolves.toMatchObject({
      status: "failed_operation",
      last_saved_revision: postOp1Revision,
      last_controlled_revision: postOp1Revision
    });
    expect(await readJsonl(operationLog)).toEqual([
      expect.objectContaining({ sequence: 1, status: "applied", before_revision: expect.any(String), after_revision: postOp1Revision }),
      expect.objectContaining({ sequence: 2, status: "failed", before_revision: postOp1Revision, error: "write 2 failed" })
    ]);

    await expect(applyProductComponentOperations({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory,
      operations: [{ tool: "batch_design", args: { id: "component-retry-op-2" }, intent: "refine" }]
    })).resolves.toMatchObject({ status: "running" });
    expect(await readJsonl(operationLog)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sequence: 3, status: "applied", retry_of_sequence: 2, before_revision: postOp1Revision })
    ]));
  });

  it("marks every component operation applied in a successful multi-op batch", async () => {
    const home = await createHome();
    const processFactory = createWritingProcessFactory();
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory
    });
    const operationLog = join(home, "library", "P-123abc.sessions", session.session_id, "operations.jsonl");

    await expect(applyProductComponentOperations({
      home,
      session_id: session.session_id,
      runner: createRunner(),
      processFactory,
      operations: [
        { tool: "batch_design", args: { id: "component-op-1" }, intent: "refine" },
        { tool: "batch_design", args: { id: "component-op-2" }, intent: "refine" }
      ]
    })).resolves.toMatchObject({ status: "running" });

    const entries = await readJsonl(operationLog);
    expect(entries).toEqual([
      expect.objectContaining({ sequence: 1, status: "applied", intent: "refine", after_revision: expect.stringMatching(/^sha256:/) }),
      expect.objectContaining({ sequence: 2, status: "applied", intent: "refine", after_revision: expect.stringMatching(/^sha256:/) })
    ]);
    expect(entries[1].before_revision).toBe(entries[0].after_revision);
  });

  it("marks component discard recoverable when the app binding is dead and keeps leases", async () => {
    const home = await createHome();
    const processes = createControllableProcessFactory();
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: processes.factory
    });
    processes.killAll();

    await expect(discardProductComponentSession({ home, session_id: session.session_id })).rejects.toMatchObject({ code: "PENCIL_APP_REQUIRED" });

    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({
      status: "recoverable"
    });
    await expect(readYaml(join(home, "library", "P-123abc.sessions", "active.yaml"))).resolves.toMatchObject({ session_id: session.session_id });
    await expect(readYaml(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"))).resolves.toMatchObject({ session_id: session.session_id });
  });

  it("discards recovered component sessions without a live binding and clears leases", async () => {
    for (const status of ["failed_commit", "recoverable"]) {
      const home = await createHome();
      const processes = createControllableProcessFactory();
      const session = await beginProductComponentSession({
        home,
        product_id: "P-123abc",
        operation: "refine",
        seed_components: [{ component_key: "button" }],
        runner: createRunner(),
        processFactory: processes.factory
      });
      const sessionFile = join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml");
      await writeYamlAtomic(sessionFile, {
        ...(await readYaml<Record<string, unknown>>(sessionFile)),
        status
      });
      processes.killAll();

      await expect(discardProductComponentSession({ home, session_id: session.session_id })).resolves.toMatchObject({ status: "discarded" });

      await expect(exists(session.staging_path)).resolves.toBe(false);
      await expect(readYaml(sessionFile)).resolves.toMatchObject({ status: "discarded" });
      await expect(exists(join(home, "library", "P-123abc.sessions", "active.yaml"))).resolves.toBe(false);
      await expect(exists(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"))).resolves.toBe(false);
    }
  });

  it("rolls back component begin when final session record write fails after binding opens", async () => {
    const home = await createHome();
    const closed = { value: false };
    const processFactory: PencilInteractiveProcessFactory = async (input) => ({
      pid: process.pid + 5000,
      async send(message) {
        if (message.startsWith("batch_get") && input.stagingPath.endsWith("staging.lib.pen")) {
          await mkdir(join(input.stagingPath, "..", "design_session.yaml"), { recursive: true });
        }
        return createProcessResponse(message, input.stagingPath);
      },
      isAlive: () => !closed.value,
      async close() {
        closed.value = true;
      }
    });

    await expect(beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory
    })).rejects.toThrow();

    expect(closed.value).toBe(true);
    await expect(exists(join(home, "library", "P-123abc.sessions", "active.yaml"))).resolves.toBe(false);
    await expect(exists(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"))).resolves.toBe(false);
    const sessionsRoot = join(home, "library", "P-123abc.sessions");
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(sessionsRoot).catch(() => []));
    expect(entries.filter((entry) => entry.startsWith("S-"))).toEqual([]);

    await expect(beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    })).resolves.toMatchObject({ mode: "app" });
  });

  it("rolls back component begin when staging hash fails after binding opens", async () => {
    const home = await createHome();
    const openBinding = { closed: false, stagingPath: "" };
    const processFactory: PencilInteractiveProcessFactory = async (input) => {
      const isComponentOpen = input.stagingPath.endsWith("staging.lib.pen");
      if (isComponentOpen) {
        openBinding.stagingPath = input.stagingPath;
      }
      return {
        pid: process.pid + 6000,
        async send(message) {
          if (isComponentOpen && message.startsWith("batch_get")) {
            await rm(input.stagingPath, { force: true });
          }
          return createProcessResponse(message, input.stagingPath);
        },
        isAlive: () => !openBinding.closed,
        async close() {
          if (isComponentOpen) {
            openBinding.closed = true;
          }
        }
      };
    };

    await expect(beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory
    })).rejects.toThrow();

    expect(openBinding.closed).toBe(true);
    await expect(exists(join(home, "library", "P-123abc.sessions", "active.yaml"))).resolves.toBe(false);
    await expect(exists(join(home, "data", "P-123abc", "sessions", "active-design-session.yaml"))).resolves.toBe(false);
    await expect(exists(openBinding.stagingPath)).resolves.toBe(false);
    await expect(exists(join(openBinding.stagingPath, ".."))).resolves.toBe(false);

    await expect(beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    })).resolves.toMatchObject({ mode: "app" });
  });

  it("does not delete another active lease when component discard sees a mismatch", async () => {
    const home = await createHome();
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    await writeYamlAtomic(join(home, "library", "P-123abc.sessions", "active.yaml"), {
      session_id: "S-other",
      status: "running"
    });

    await expect(discardProductComponentSession({ home, session_id: session.session_id })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(exists(session.staging_path)).resolves.toBe(true);
    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({
      status: "running"
    });
    await expect(readYaml(join(home, "library", "P-123abc.sessions", "active.yaml"))).resolves.toMatchObject({ session_id: "S-other" });
    await expect(exists(join(home, "library", "P-123abc.sessions", session.session_id, "lease-cleanup-warnings.jsonl"))).resolves.toBe(true);
  });

  it("blocks component begin when the component active lease is corrupt", async () => {
    const home = await createHome();
    const activeFile = join(home, "library", "P-123abc.sessions", "active.yaml");
    await mkdir(join(activeFile, ".."), { recursive: true });
    await writeFile(activeFile, "status: [unterminated", "utf8");

    await expect(beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    })).rejects.toMatchObject({ code: "DESIGN_SESSION_ACTIVE" });

    await expect(readFile(activeFile, "utf8")).resolves.toBe("status: [unterminated");
  });

  it("blocks component begin when the product active lease is corrupt", async () => {
    const home = await createHome();
    const productLease = join(home, "data", "P-123abc", "sessions", "active-design-session.yaml");
    await mkdir(join(productLease, ".."), { recursive: true });
    await writeFile(productLease, "status: [unterminated", "utf8");

    await expect(beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    })).rejects.toMatchObject({ code: "DESIGN_SESSION_ACTIVE" });

    await expect(readFile(productLease, "utf8")).resolves.toBe("status: [unterminated");
    await expect(exists(join(home, "library", "P-123abc.sessions", "active.yaml"))).resolves.toBe(false);
  });

  it("commits component sessions with committed journal entries for latest, version, and components metadata", async () => {
    const home = await createHome();
    await writeFile(join(home, "library", "P-123abc.versions", "2.lib.pen"), "preexisting target version");
    const originalVersion2 = await readFile(join(home, "library", "P-123abc.versions", "2.lib.pen"), "utf8");
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button", semantic_contract_hash: `sha256:${"b".repeat(64)}` }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });

    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({
      previous_version: 1,
      target_version: 3
    });
    await expect(commitProductComponentSession({ home, session_id: session.session_id })).resolves.toMatchObject({ status: "committed" });

    const journal = await readYaml<Record<string, unknown>>(join(home, "library", "P-123abc.sessions", session.session_id, "commit-journal.yaml"));
    expect(journal).toMatchObject({ status: "committed" });
    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({
      status: "committed"
    });
    expect(journal.entries).toEqual([
      expect.objectContaining({ target_file: "library/P-123abc.versions/3.lib.pen", candidate_hash: expect.stringMatching(/^sha256:/), old_file_missing: true, restore_order: 1 }),
      expect.objectContaining({ target_file: "library/P-123abc.lib.pen", candidate_hash: expect.stringMatching(/^sha256:/), old_hash: expect.stringMatching(/^sha256:/), backup_file: expect.any(String), restore_order: 2 }),
      expect.objectContaining({ target_file: "library/P-123abc.components.yaml", candidate_hash: expect.stringMatching(/^sha256:/), old_hash: expect.stringMatching(/^sha256:/), backup_file: expect.any(String), restore_order: 3 })
    ]);
    await expect(readFile(join(home, "library", "P-123abc.versions", "2.lib.pen"), "utf8")).resolves.toBe(originalVersion2);
    await expect(new PencilAppSessionAdapter({ home, runner: createRunner() }).controlledSave(session.pencil_binding_id)).rejects.toMatchObject({ code: "PENCIL_APP_REQUIRED" });
  });

  it("does not report a committed component journal during startup recovery", async () => {
    const home = await createHome();
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button", semantic_contract_hash: `sha256:${"b".repeat(64)}` }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });

    await expect(commitProductComponentSession({ home, session_id: session.session_id })).resolves.toMatchObject({ status: "committed" });
    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "commit-journal.yaml"))).resolves.toMatchObject({
      status: "committed"
    });

    const recovery = await readDesignStartupRecoveryState(home);
    expect(recovery.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "commit_journal", scope: "product_component_library", session_id: session.session_id })
    ]));
  });

  it("uses current component version to target the next version without overwriting version 1", async () => {
    const home = await createHome();
    const originalVersion1 = await readFile(join(home, "library", "P-123abc.versions", "1.lib.pen"), "utf8");
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "change_style",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });

    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({
      previous_version: 1,
      target_version: 2
    });
    await expect(commitProductComponentSession({ home, session_id: session.session_id })).resolves.toMatchObject({ status: "committed" });

    await expect(readFile(join(home, "library", "P-123abc.versions", "1.lib.pen"), "utf8")).resolves.toBe(originalVersion1);
    await expect(exists(join(home, "library", "P-123abc.versions", "2.lib.pen"))).resolves.toBe(true);
  });

  it("rejects component begin when metadata has current_version but no versions array", async () => {
    const home = await createHome();
    const metadataPath = join(home, "library", "P-123abc.components.yaml");
    await writeYamlAtomic(metadataPath, {
      product_id: "P-123abc",
      current_version: 1,
      latest_file: "P-123abc.lib.pen"
    });
    const metadataBytes = await readFile(metadataPath, "utf8");

    await expect(beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    })).rejects.toMatchObject({ code: "COMPONENT_LIBRARY_INVALID" });

    await expect(readFile(metadataPath, "utf8")).resolves.toBe(metadataBytes);
    await expect(exists(join(home, "library", "P-123abc.sessions"))).resolves.toBe(false);
  });

  it("rejects component commit when metadata versions becomes non-array after begin", async () => {
    const home = await createHome();
    const originalLatest = await readFile(join(home, "library", "P-123abc.lib.pen"), "utf8");
    const metadataPath = join(home, "library", "P-123abc.components.yaml");
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    await writeYamlAtomic(metadataPath, {
      product_id: "P-123abc",
      current_version: 1,
      latest_file: "P-123abc.lib.pen",
      versions: "not-an-array"
    });
    const malformedMetadataBytes = await readFile(metadataPath, "utf8");

    await expect(commitProductComponentSession({ home, session_id: session.session_id })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(exists(join(home, "library", "P-123abc.sessions", session.session_id, "candidate.components.yaml"))).resolves.toBe(false);
    await expect(exists(join(home, "library", "P-123abc.sessions", session.session_id, "commit-journal.yaml"))).resolves.toBe(false);
    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({ status: "running" });
    await expect(readFile(join(home, "library", "P-123abc.lib.pen"), "utf8")).resolves.toBe(originalLatest);
    await expect(readFile(metadataPath, "utf8")).resolves.toBe(malformedMetadataBytes);
    await expect(exists(join(home, "library", "P-123abc.versions", "2.lib.pen"))).resolves.toBe(false);
  });

  it("fails closed when a component target version file appears after begin", async () => {
    const home = await createHome();
    const originalLatest = await readFile(join(home, "library", "P-123abc.lib.pen"), "utf8");
    const originalMetadata = await readFile(join(home, "library", "P-123abc.components.yaml"), "utf8");
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    await writeFile(join(home, "library", "P-123abc.versions", "2.lib.pen"), "late target");

    await expect(commitProductComponentSession({ home, session_id: session.session_id })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(exists(join(home, "library", "P-123abc.sessions", session.session_id, "commit-journal.yaml"))).resolves.toBe(false);
    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({ status: "running" });
    await expect(readFile(join(home, "library", "P-123abc.lib.pen"), "utf8")).resolves.toBe(originalLatest);
    await expect(readFile(join(home, "library", "P-123abc.components.yaml"), "utf8")).resolves.toBe(originalMetadata);
    await expect(readFile(join(home, "library", "P-123abc.versions", "2.lib.pen"), "utf8")).resolves.toBe("late target");
  });

  it("fails closed when component metadata gains the target version after begin", async () => {
    const home = await createHome();
    const originalLatest = await readFile(join(home, "library", "P-123abc.lib.pen"), "utf8");
    const metadataPath = join(home, "library", "P-123abc.components.yaml");
    const metadata = await readYaml<Record<string, unknown>>(metadataPath);
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const modifiedMetadata = {
      ...metadata,
      versions: [
        ...(Array.isArray(metadata.versions) ? metadata.versions : []),
        { version: 2, file: "P-123abc.versions/2.lib.pen", checksum: `sha256:${"c".repeat(64)}`, components: [] }
      ]
    };
    await writeYamlAtomic(metadataPath, modifiedMetadata);
    const modifiedMetadataBytes = await readFile(metadataPath, "utf8");

    await expect(commitProductComponentSession({ home, session_id: session.session_id })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(exists(join(home, "library", "P-123abc.sessions", session.session_id, "commit-journal.yaml"))).resolves.toBe(false);
    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({ status: "running" });
    await expect(readFile(join(home, "library", "P-123abc.lib.pen"), "utf8")).resolves.toBe(originalLatest);
    await expect(readFile(metadataPath, "utf8")).resolves.toBe(modifiedMetadataBytes);
  });

  it("rejects component commit when metadata current_version changes after begin", async () => {
    const home = await createHome();
    const originalLatest = await readFile(join(home, "library", "P-123abc.lib.pen"), "utf8");
    const metadataPath = join(home, "library", "P-123abc.components.yaml");
    const metadata = await readYaml<Record<string, unknown>>(metadataPath);
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    await writeYamlAtomic(metadataPath, { ...metadata, current_version: 9 });
    const modifiedMetadataBytes = await readFile(metadataPath, "utf8");

    await expect(commitProductComponentSession({ home, session_id: session.session_id })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      details: expect.objectContaining({
        expected_current_version: 1,
        actual_current_version: 9
      })
    });

    await expect(exists(join(home, "library", "P-123abc.sessions", session.session_id, "commit-journal.yaml"))).resolves.toBe(false);
    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({ status: "running" });
    await expect(readFile(join(home, "library", "P-123abc.lib.pen"), "utf8")).resolves.toBe(originalLatest);
    await expect(readFile(metadataPath, "utf8")).resolves.toBe(modifiedMetadataBytes);
    await expect(exists(join(home, "library", "P-123abc.versions", "2.lib.pen"))).resolves.toBe(false);
  });

  it("rejects component commit when the latest library canvas changes after begin", async () => {
    const home = await createHome();
    const metadataPath = join(home, "library", "P-123abc.components.yaml");
    const originalMetadata = await readFile(metadataPath, "utf8");
    const latestPath = join(home, "library", "P-123abc.lib.pen");
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    await writeFile(latestPath, JSON.stringify({ children: [{ id: "post-begin", type: "component" }] }));
    const modifiedLatest = await readFile(latestPath, "utf8");

    await expect(commitProductComponentSession({ home, session_id: session.session_id })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      details: expect.objectContaining({
        latest_file: "library/P-123abc.lib.pen"
      })
    });

    await expect(exists(join(home, "library", "P-123abc.sessions", session.session_id, "commit-journal.yaml"))).resolves.toBe(false);
    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({ status: "running" });
    await expect(readFile(latestPath, "utf8")).resolves.toBe(modifiedLatest);
    await expect(readFile(metadataPath, "utf8")).resolves.toBe(originalMetadata);
    await expect(exists(join(home, "library", "P-123abc.versions", "2.lib.pen"))).resolves.toBe(false);
  });

  it("rejects component generation from an empty baseline when metadata appears after begin", async () => {
    const home = await createEmptyComponentHome();
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "generate",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const metadataPath = join(home, "library", "P-123abc.components.yaml");
    await writeYamlAtomic(metadataPath, {
      product_id: "P-123abc",
      current_version: 1,
      latest_file: "P-123abc.lib.pen",
      versions: []
    });
    const metadataBytes = await readFile(metadataPath, "utf8");

    await expect(commitProductComponentSession({ home, session_id: session.session_id })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      details: expect.objectContaining({
        expected_current_version: 0,
        actual_current_version: 1
      })
    });

    await expect(exists(join(home, "library", "P-123abc.sessions", session.session_id, "commit-journal.yaml"))).resolves.toBe(false);
    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({ status: "running" });
    await expect(readFile(metadataPath, "utf8")).resolves.toBe(metadataBytes);
    await expect(exists(join(home, "library", "P-123abc.lib.pen"))).resolves.toBe(false);
  });

  it("rejects component generation from an empty baseline when latest appears after begin", async () => {
    const home = await createEmptyComponentHome();
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "generate",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const latestPath = join(home, "library", "P-123abc.lib.pen");
    await writeFile(latestPath, JSON.stringify({ children: [{ id: "late", type: "component" }] }));
    const latestBytes = await readFile(latestPath, "utf8");

    await expect(commitProductComponentSession({ home, session_id: session.session_id })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      details: expect.objectContaining({
        expected_latest_file_missing: true,
        latest_file: "library/P-123abc.lib.pen"
      })
    });

    await expect(exists(join(home, "library", "P-123abc.sessions", session.session_id, "commit-journal.yaml"))).resolves.toBe(false);
    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({ status: "running" });
    await expect(readFile(latestPath, "utf8")).resolves.toBe(latestBytes);
    await expect(exists(join(home, "library", "P-123abc.components.yaml"))).resolves.toBe(false);
  });

  it("rejects component commit when the latest library target is a symlink", async () => {
    const home = await createHome();
    const latestPath = join(home, "library", "P-123abc.lib.pen");
    const outside = join(home, "outside-component.lib.pen");
    await writeFile(outside, "outside-old");
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    await rm(latestPath, { force: true });
    await symlink(outside, latestPath);

    await expect(commitProductComponentSession({ home, session_id: session.session_id })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(readFile(outside, "utf8")).resolves.toBe("outside-old");
    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({ status: "running" });
  });

  it("recovers a component session left in committing with a committing journal", async () => {
    const home = await createHome();
    const originalLatest = await readFile(join(home, "library", "P-123abc.lib.pen"));
    const originalMetadata = await readFile(join(home, "library", "P-123abc.components.yaml"));
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const sessionDir = join(home, "library", "P-123abc.sessions", session.session_id);
    await mkdir(join(sessionDir, "backup"), { recursive: true });
    await writeFile(join(sessionDir, "backup", "latest.lib.pen.bak"), originalLatest);
    await writeFile(join(sessionDir, "backup", "components.yaml.bak"), originalMetadata);
    await writeFile(join(home, "library", "P-123abc.versions", "2.lib.pen"), "partial version");
    await writeFile(join(home, "library", "P-123abc.lib.pen"), "partial latest");
    const latestHash = `sha256:${createHash("sha256").update(originalLatest).digest("hex")}`;
    const metadataHash = `sha256:${createHash("sha256").update(originalMetadata).digest("hex")}`;
    await writeYamlAtomic(join(sessionDir, "commit-journal.yaml"), {
      session_id: session.session_id,
      scope: "product_component_library",
      status: "committing",
      entries: [
        { target_file: "library/P-123abc.versions/2.lib.pen", candidate_file: "library/P-123abc.sessions/noop/staging.lib.pen", candidate_hash: `sha256:${"d".repeat(64)}`, old_file_missing: true, replacement_kind: "component_version", restore_order: 1 },
        { target_file: "library/P-123abc.lib.pen", candidate_file: "library/P-123abc.sessions/noop/staging.lib.pen", candidate_hash: `sha256:${"d".repeat(64)}`, old_hash: latestHash, backup_file: `library/P-123abc.sessions/${session.session_id}/backup/latest.lib.pen.bak`, replacement_kind: "component_latest", restore_order: 2 },
        { target_file: "library/P-123abc.components.yaml", candidate_file: "library/P-123abc.sessions/noop/candidate.components.yaml", candidate_hash: `sha256:${"e".repeat(64)}`, old_hash: metadataHash, backup_file: `library/P-123abc.sessions/${session.session_id}/backup/components.yaml.bak`, replacement_kind: "component_metadata", restore_order: 3 }
      ]
    });

    await expect(recoverDesignCommitJournal({
      home,
      session_id: session.session_id,
      scope: "product_component_library"
    })).resolves.toMatchObject({ status: "failed_commit" });

    await expect(exists(join(home, "library", "P-123abc.versions", "2.lib.pen"))).resolves.toBe(false);
    await expect(readFile(join(home, "library", "P-123abc.lib.pen"))).resolves.toEqual(originalLatest);
    await expect(readYaml(join(sessionDir, "design_session.yaml"))).resolves.toMatchObject({ status: "failed_commit" });
  });

  it.each([
    {
      replacementKind: "component_latest",
      targetFile: "library/P-123abc.lib.pen",
      targetPath: (home: string) => join(home, "library", "P-123abc.lib.pen")
    },
    {
      replacementKind: "component_metadata",
      targetFile: "library/P-123abc.components.yaml",
      targetPath: (home: string) => join(home, "library", "P-123abc.components.yaml")
    }
  ])("rejects component recovery journals that mark existing $replacementKind baseline as missing", async ({ replacementKind, targetFile, targetPath }) => {
    const home = await createHome();
    const target = targetPath(home);
    const original = await readFile(target, "utf8");
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const sessionDir = join(home, "library", "P-123abc.sessions", session.session_id);
    await expect(readYaml(join(sessionDir, "design_session.yaml"))).resolves.toMatchObject({ previous_version: 1 });
    await writeYamlAtomic(join(sessionDir, "commit-journal.yaml"), {
      session_id: session.session_id,
      scope: "product_component_library",
      status: "committing",
      entries: [
        {
          target_file: targetFile,
          candidate_file: "library/P-123abc.sessions/noop/staging.lib.pen",
          candidate_hash: `sha256:${"d".repeat(64)}`,
          old_file_missing: true,
          replacement_kind: replacementKind,
          restore_order: 1
        }
      ]
    });

    await expect(recoverDesignCommitJournal({
      home,
      session_id: session.session_id,
      scope: "product_component_library"
    })).resolves.toMatchObject({
      status: "commit_recovery_required",
      failed_files: [expect.objectContaining({ reason: expect.stringContaining("existing component baseline files") })]
    });

    await expect(readFile(target, "utf8")).resolves.toBe(original);
    await expect(readYaml(join(sessionDir, "design_session.yaml"))).resolves.toMatchObject({ status: "commit_recovery_required" });
  });

  it("records recovery failure instead of writing through a symlinked component target", async () => {
    const home = await createHome();
    const originalLatest = await readFile(join(home, "library", "P-123abc.lib.pen"));
    const outside = join(home, "outside-recovery.lib.pen");
    await writeFile(outside, "outside-recovery-old");
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const sessionDir = join(home, "library", "P-123abc.sessions", session.session_id);
    await mkdir(join(sessionDir, "backup"), { recursive: true });
    await writeFile(join(sessionDir, "backup", "latest.lib.pen.bak"), originalLatest);
    await rm(join(home, "library", "P-123abc.lib.pen"), { force: true });
    await symlink(outside, join(home, "library", "P-123abc.lib.pen"));
    const latestHash = `sha256:${createHash("sha256").update(originalLatest).digest("hex")}`;
    await writeYamlAtomic(join(sessionDir, "design_session.yaml"), {
      ...(await readYaml<Record<string, unknown>>(join(sessionDir, "design_session.yaml"))),
      status: "committing"
    });
    await writeYamlAtomic(join(sessionDir, "commit-journal.yaml"), {
      session_id: session.session_id,
      scope: "product_component_library",
      status: "committing",
      entries: [
        { target_file: "library/P-123abc.lib.pen", candidate_file: "library/P-123abc.sessions/noop/staging.lib.pen", candidate_hash: `sha256:${"d".repeat(64)}`, old_hash: latestHash, backup_file: `library/P-123abc.sessions/${session.session_id}/backup/latest.lib.pen.bak`, replacement_kind: "component_latest", restore_order: 1 }
      ]
    });

    await expect(recoverDesignCommitJournal({
      home,
      session_id: session.session_id,
      scope: "product_component_library"
    })).resolves.toMatchObject({ status: "commit_recovery_required", failed_files: [expect.objectContaining({ reason: expect.stringContaining("regular file") })] });

    await expect(readFile(outside, "utf8")).resolves.toBe("outside-recovery-old");
    await expect(readYaml(join(sessionDir, "design_session.yaml"))).resolves.toMatchObject({ status: "commit_recovery_required" });
  });

  it("rejects component recovery journals that target the wrong product library file", async () => {
    const home = await createHome();
    const wrongLatest = join(home, "library", "P-abcdef.lib.pen");
    await writeFile(wrongLatest, "wrong-current");
    const session = await beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    const sessionDir = join(home, "library", "P-123abc.sessions", session.session_id);
    await mkdir(join(sessionDir, "backup"), { recursive: true });
    await writeFile(join(sessionDir, "backup", "wrong-latest.lib.pen.bak"), "wrong-old");
    const oldHash = `sha256:${createHash("sha256").update(await readFile(join(sessionDir, "backup", "wrong-latest.lib.pen.bak"))).digest("hex")}`;
    await writeYamlAtomic(join(sessionDir, "commit-journal.yaml"), {
      session_id: session.session_id,
      scope: "product_component_library",
      status: "committing",
      entries: [
        {
          target_file: "library/P-abcdef.lib.pen",
          candidate_file: "library/P-123abc.sessions/noop/staging.lib.pen",
          candidate_hash: `sha256:${"d".repeat(64)}`,
          old_hash: oldHash,
          backup_file: `library/P-123abc.sessions/${session.session_id}/backup/wrong-latest.lib.pen.bak`,
          replacement_kind: "component_latest",
          restore_order: 1
        }
      ]
    });

    await expect(recoverDesignCommitJournal({
      home,
      session_id: session.session_id,
      scope: "product_component_library"
    })).resolves.toMatchObject({
      status: "commit_recovery_required",
      failed_files: [expect.objectContaining({ reason: expect.stringContaining("does not match the recovered session") })]
    });

    await expect(readFile(wrongLatest, "utf8")).resolves.toBe("wrong-current");
    await expect(readYaml(join(sessionDir, "design_session.yaml"))).resolves.toMatchObject({ status: "commit_recovery_required" });
  });

  it("restores promoted component files when commit promotion fails", async () => {
    const home = await createHome();
    const originalLatest = await readFile(join(home, "library", "P-123abc.lib.pen"), "utf8");
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        rename: vi.fn(async (oldPath: Parameters<typeof actual.rename>[0], newPath: Parameters<typeof actual.rename>[1]) => {
          if (String(oldPath).includes("/.forma-") && !String(oldPath).includes("/.forma-restore-") && String(newPath).endsWith("/P-123abc.lib.pen")) {
            throw new Error("promotion failed");
          }
          return actual.rename(oldPath, newPath);
        })
      };
    });
    const componentSession = await import("../src/component-session.js");
    const session = await componentSession.beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });

    await expect(componentSession.commitProductComponentSession({ home, session_id: session.session_id })).rejects.toThrow("promotion failed");

    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({
      status: "failed_commit"
    });
    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "commit-journal.yaml"))).resolves.toMatchObject({
      status: "restored"
    });
    await expect(readFile(join(home, "library", "P-123abc.lib.pen"), "utf8")).resolves.toBe(originalLatest);
    await expect(exists(join(home, "library", "P-123abc.versions", "2.lib.pen"))).resolves.toBe(false);
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("reports component recovery failure without applying a corrupted backup", async () => {
    const home = await createHome();
    const latestPath = join(home, "library", "P-123abc.lib.pen");
    let activeSessionId = "";

    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        rename: vi.fn(async (oldPath: Parameters<typeof actual.rename>[0], newPath: Parameters<typeof actual.rename>[1]) => {
          const oldPathString = String(oldPath);
          const newPathString = String(newPath);
          if (oldPathString.includes("/.forma-") && !oldPathString.includes("/.forma-restore-") && newPathString === latestPath) {
            await actual.rename(oldPath, newPath);
            await actual.writeFile(
              join(home, "library", "P-123abc.sessions", activeSessionId, "backup", "2-latest.lib.pen.bak"),
              "corrupted latest backup"
            );
            throw new Error("component promotion failed after corrupt backup");
          }
          return actual.rename(oldPath, newPath);
        })
      };
    });
    const componentSession = await import("../src/component-session.js");
    const session = await componentSession.beginProductComponentSession({
      home,
      product_id: "P-123abc",
      operation: "refine",
      seed_components: [{ component_key: "button" }],
      runner: createRunner(),
      processFactory: createProcessFactory()
    });
    activeSessionId = session.session_id;

    await expect(componentSession.commitProductComponentSession({ home, session_id: session.session_id })).rejects.toMatchObject({
      code: "DESIGN_COMMIT_RECOVERY_REQUIRED"
    });

    const latestAfterFailedRecovery = await readFile(latestPath, "utf8");
    expect(latestAfterFailedRecovery).not.toBe("corrupted latest backup");
    expect(JSON.parse(latestAfterFailedRecovery) as unknown).toMatchObject({
      children: expect.arrayContaining([expect.objectContaining({ id: "button", type: "component" })])
    });
    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "design_session.yaml"))).resolves.toMatchObject({
      status: "commit_recovery_required"
    });
    await expect(readYaml(join(home, "library", "P-123abc.sessions", session.session_id, "commit-journal.yaml"))).resolves.toMatchObject({
      status: "restore_failed",
      failed_files: [expect.objectContaining({ reason: expect.stringContaining("backup hash mismatch") })]
    });
    const libraryEntries = await readdir(join(home, "library"));
    expect(libraryEntries.some((entry) => entry.startsWith(".forma-restore-"))).toBe(false);
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });
});
