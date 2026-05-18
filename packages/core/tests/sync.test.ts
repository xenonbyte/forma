import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFormaStore,
  FormaError,
  classifyStyle,
  describeStyle,
  extractVariablesFromDesignMd,
  PencilService,
  readYaml,
  scanStyleDirectories,
  sha256Hex,
  SyncService,
  syncStatusSchema
} from "../src/index.js";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "forma-sync-test-"));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("style sync pure helpers", () => {
  it("scans only first-level style directories with DESIGN.md", async () => {
    const root = await tempDir();
    await mkdir(join(root, "linear"), { recursive: true });
    await mkdir(join(root, "_template"), { recursive: true });
    await mkdir(join(root, ".hidden"), { recursive: true });
    await mkdir(join(root, "nested", "deep"), { recursive: true });
    await writeFile(join(root, "linear", "DESIGN.md"), "# Linear\n");
    await writeFile(join(root, "_template", "DESIGN.md"), "# Template\n");
    await writeFile(join(root, ".hidden", "DESIGN.md"), "# Hidden\n");
    await writeFile(join(root, "nested", "deep", "DESIGN.md"), "# Deep\n");

    await expect(scanStyleDirectories(root)).resolves.toEqual([{ name: "linear", designMdPath: join(root, "linear", "DESIGN.md") }]);
  });

  it("extracts variables and fills deterministic defaults", () => {
    expect(
      extractVariablesFromDesignMd(`
# Demo
primary: #5E6AD2
background: #FAFAFA
foreground: #111827
heading font: Inter
body font: Source Sans
corner radius: 12
base spacing: 10
`)
    ).toEqual({
      primary: "#5E6AD2",
      background: "#FAFAFA",
      "text-primary": "#111827",
      "font-heading": "Inter",
      "font-body": "Source Sans",
      "border-radius": "12",
      "spacing-unit": "10"
    });

    expect(extractVariablesFromDesignMd("# Sparse")).toEqual({
      primary: "#3b82f6",
      background: "#FFFFFF",
      "text-primary": "#111827",
      "font-heading": "Inter",
      "font-body": "Inter",
      "border-radius": "8",
      "spacing-unit": "8"
    });
  });

  it("extracts variables from DESIGN-v2 hyphenated fields", () => {
    expect(
      extractVariablesFromDesignMd(`
# Demo
primary: "#101010"
background: "#fafafa"
text-primary: "#202020"
heading-font: "Acme Display"
body-font: "Acme Text"
border-radius: 14px
spacing-unit: 6px
`)
    ).toEqual({
      primary: "#101010",
      background: "#fafafa",
      "text-primary": "#202020",
      "font-heading": "Acme Display",
      "font-body": "Acme Text",
      "border-radius": "14",
      "spacing-unit": "6"
    });
  });

  it("extracts variables from DESIGN.md front matter tokens", () => {
    expect(
      extractVariablesFromDesignMd(`---
colors:
  primary: "#0066cc"
  canvas: "#ffffff"
  ink: "#1d1d1f"
typography:
  hero-display:
    fontFamily: "SF Pro Display, system-ui, sans-serif"
  body:
    fontFamily: "SF Pro Text, system-ui, sans-serif"
rounded:
  md: 11px
spacing:
  xs: 8px
---
# Demo
`)
    ).toEqual({
      primary: "#0066cc",
      background: "#ffffff",
      "text-primary": "#1d1d1f",
      "font-heading": "SF Pro Display",
      "font-body": "SF Pro Text",
      "border-radius": "11",
      "spacing-unit": "8"
    });
  });

  it("classifies and describes style documents", () => {
    expect(classifyStyle("An AI assistant for LLM chat")).toBe("AI 产品");
    expect(classifyStyle("Project task productivity tool")).toBe("工具类");
    expect(classifyStyle("Retail store checkout")).toBe("电商");
    expect(classifyStyle("Finance bank payment dashboard")).toBe("金融");
    expect(classifyStyle("Social community message feed")).toBe("社交");
    expect(classifyStyle("Health medical fitness tracker")).toBe("健康");
    expect(classifyStyle("Plain editorial layout")).toBe("其他");
    expect(describeStyle("# Title\n\nA focused product interface with dense controls.\nSecond line")).toBe(
      "A focused product interface with dense controls."
    );
    expect(describeStyle("# Title\n\n123456789012345678901234567890123456789012345678901234567890")).toBe(
      "12345678901234567890123456789012345678901234567890"
    );
    expect(
      describeStyle(`---
description: "A photography-first interface with immersive gallery controls and editorial spacing."
colors:
  primary: "#0066cc"
---
# Title

Body copy should not win over front matter description.`)
    ).toBe("A photography-first interface with immersive galle");
    expect(
      describeStyle(`---
description: |
  An almost defiantly minimal documentation-first system that treats the home page like a Markdown README.
colors:
  primary: "#000000"
---
# Title`)
    ).toBe("An almost defiantly minimal documentation-first sy");
    expect(
      describeStyle(`---
colors:
  primary: "#0066cc"
---
# Title

Body copy should be used after front matter.`)
    ).toBe("Body copy should be used after front matter.");
    expect(
      describeStyle(`---
colors:
  primary: "#0066cc"
---
# Title`)
    ).toBe("Style generated from DESIGN.md");
    expect(describeStyle("# Title")).toBe("Style generated from DESIGN.md");
  });

  it("computes stable sha256 and validates status shapes", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(syncStatusSchema.parse({ status: "idle" })).toEqual({ status: "idle" });
    expect(
      syncStatusSchema.parse({
        status: "idle",
        last_sync: {
          completed_at: "2026-05-18T00:00:00.000Z",
          styles_total: 3,
          styles_updated: 2,
          styles_added: 1,
          styles_failed: 0,
          duration_ms: 1250
        }
      })
    ).toEqual({
      status: "idle",
      last_sync: {
        completed_at: "2026-05-18T00:00:00.000Z",
        styles_total: 3,
        styles_updated: 2,
        styles_added: 1,
        styles_failed: 0,
        duration_ms: 1250
      }
    });
    expect(
      syncStatusSchema.parse({
        status: "running",
        task_id: "sync-1",
        started_at: "2026-05-18T00:00:00.000Z",
        progress: {
          phase: "extracting_variables",
          current: 1,
          total: 3,
          current_style: "linear"
        }
      })
    ).toEqual({
      status: "running",
      task_id: "sync-1",
      started_at: "2026-05-18T00:00:00.000Z",
      progress: {
        phase: "extracting_variables",
        current: 1,
        total: 3,
        current_style: "linear"
      }
    });
    expect(
      syncStatusSchema.parse({
        status: "failed",
        task_id: "sync-1",
        error: {
          phase: "git_clone",
          message: "git not found"
        }
      })
    ).toEqual({
      status: "failed",
      task_id: "sync-1",
      error: {
        phase: "git_clone",
        message: "git not found"
      }
    });
  });
});

describe("SyncService state, gates, and recovery", () => {
  it("starts a sync after Pencil and Git gates when autoRun is false", async () => {
    const home = await tempDir();
    const calls: Array<{ command: string; args: string[]; options?: { timeoutMs?: number } }> = [];
    const runner = {
      async run(command: string, args: string[], options?: { timeoutMs?: number }) {
        calls.push({ command, args, options });
        return { stdout: command === "pencil" && args[0] === "status" ? "active\n" : "ok\n", stderr: "" };
      }
    };
    const pencilService = new PencilService({ home, runner });
    const service = new SyncService({ home, pencilService, runner, autoRun: false });

    const started = await service.startSync();

    expect(started.task_id).toMatch(/^sync-[a-f0-9]{16}$/);
    expect(await service.getStatus()).toEqual({
      status: "running",
      task_id: started.task_id,
      started_at: started.started_at,
      progress: { phase: "git_clone", current: 0, total: 0 }
    });
    expect(calls).toEqual([
      { command: "pencil", args: ["version"], options: undefined },
      { command: "pencil", args: ["status"], options: undefined },
      { command: "git", args: ["--version"], options: { timeoutMs: 5_000 } }
    ]);
  });

  it("runs Pencil availability before Git gate when starting", async () => {
    const home = await tempDir();
    const calls: string[] = [];
    const runner = {
      async run(command: string, args: string[], options?: { timeoutMs?: number }) {
        calls.push(`${command} ${args.join(" ")} ${options?.timeoutMs ?? ""}`.trim());
        return { stdout: "ok\n", stderr: "" };
      }
    };
    const pencilService = {
      async checkAvailability() {
        await runner.run("pencil", ["version"]);
        await runner.run("pencil", ["status"]);
      }
    };
    const service = new SyncService({ home, pencilService, runner, autoRun: false });

    await service.startSync();

    expect(calls).toEqual(["pencil version", "pencil status", "git --version 5000"]);
  });

  it("rejects duplicate starts while a non-stale sync is running", async () => {
    const service = new SyncService({
      home: await tempDir(),
      pencilService: { checkAvailability: async () => undefined },
      runner: { run: async () => ({ stdout: "git version 2\n", stderr: "" }) },
      autoRun: false,
      now: () => new Date("2026-05-18T00:00:00.000Z")
    });
    await service.startSync();

    await expect(service.startSync()).rejects.toMatchObject({ code: "SYNC_ALREADY_RUNNING" });
  });

  it("rejects missing Git without writing running state", async () => {
    const home = await tempDir();
    const service = new SyncService({
      home,
      pencilService: { checkAvailability: async () => undefined },
      runner: {
        async run() {
          throw new Error("spawn git ENOENT");
        }
      },
      autoRun: false
    });

    await expect(service.startSync()).rejects.toMatchObject({
      code: "SYNC_GIT_NOT_FOUND",
      message: "Git CLI not found",
      details: { command: "git --version" }
    });
    expect(await service.getStatus()).toEqual({ status: "idle" });
    expect(await readYaml(join(home, "sync-state.yaml"))).toEqual({ status: "idle" });
  });

  it("creates idle sync state for a fresh home", async () => {
    const home = await tempDir();
    const service = new SyncService({ home, pencilService: { checkAvailability: async () => undefined } });

    expect(await service.getStatus()).toEqual({ status: "idle" });
    expect(await readYaml(join(home, "sync-state.yaml"))).toEqual({ status: "idle" });
  });

  it("recovers stale running state as failed", async () => {
    const home = await tempDir();
    await writeFile(
      join(home, "sync-state.yaml"),
      [
        "status: running",
        "task_id: sync-deadbeefdeadbeef",
        "started_at: '2026-05-18T00:00:00.000Z'",
        "progress:",
        "  phase: git_clone",
        "  current: 0",
        "  total: 0",
        ""
      ].join("\n")
    );
    const service = new SyncService({
      home,
      pencilService: { checkAvailability: async () => undefined },
      now: () => new Date("2026-05-18T00:11:00.000Z")
    });

    expect(await service.getStatus()).toEqual({
      status: "failed",
      task_id: "sync-deadbeefdeadbeef",
      error: { phase: "cleanup", message: "Previous sync task crashed or stopped" }
    });
  });

  it("does not reset non-stale running state during recovery", async () => {
    const home = await tempDir();
    await writeFile(
      join(home, "sync-state.yaml"),
      [
        "status: running",
        "task_id: sync-feedfacefeedface",
        "started_at: '2026-05-18T00:01:00.000Z'",
        "progress:",
        "  phase: git_clone",
        "  current: 0",
        "  total: 0",
        ""
      ].join("\n")
    );
    const service = new SyncService({
      home,
      pencilService: { checkAvailability: async () => undefined },
      now: () => new Date("2026-05-18T00:10:59.000Z")
    });

    expect(await service.recoverFromCrash()).toEqual({
      status: "running",
      task_id: "sync-feedfacefeedface",
      started_at: "2026-05-18T00:01:00.000Z",
      progress: { phase: "git_clone", current: 0, total: 0 }
    });
  });

  it("returns idle for invalid sync state and rewrites it", async () => {
    const home = await tempDir();
    await writeFile(join(home, "sync-state.yaml"), "status: wat\n");
    const service = new SyncService({ home, pencilService: { checkAvailability: async () => undefined } });

    expect(await service.getStatus()).toEqual({ status: "idle" });
    expect(await readYaml(join(home, "sync-state.yaml"))).toEqual({ status: "idle" });
  });

  it("exposes sync service from the forma store", async () => {
    const store = createFormaStore({ home: await tempDir(), bundledStylesDir: join(await tempDir(), "styles") });

    expect(store.sync).toBeInstanceOf(SyncService);
    await expect(store.sync.getStatus()).resolves.toEqual({ status: "idle" });
  });

  it("surfaces sync errors as FormaError instances", async () => {
    const service = new SyncService({
      home: await tempDir(),
      pencilService: { checkAvailability: async () => undefined },
      runner: {
        async run() {
          throw new Error("missing");
        }
      },
      autoRun: false
    });

    await expect(service.startSync()).rejects.toBeInstanceOf(FormaError);
  });
});
