import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

const minimalPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00,
  0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

const oldPreviewPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x6f, 0x6c, 0x64]);

async function tempDir() {
  const home = await mkdtemp(join(tmpdir(), "forma-sync-test-"));
  await writeFile(join(home, ".v6-schema-cutover-committed"), "committed\n", "utf8");
  return home;
}

type RunnerCall = {
  command: string;
  args: string[];
  options?: { cwd?: string; timeoutMs?: number };
};

type StyleFixture = {
  name: string;
  designMd: string;
};

function designMd(name: string, primary: string) {
  return [
    `# ${name}`,
    "",
    `${name} product interface.`,
    `primary: ${primary}`,
    "background: #ffffff",
    "text-primary: #111827",
    "heading-font: Inter",
    "body-font: Inter",
    "border-radius: 12px",
    "spacing-unit: 8px",
    ""
  ].join("\n");
}

function createFakeRunner(styles: StyleFixture[], options: { failPencilFor?: string } = {}) {
  const calls: RunnerCall[] = [];
  const prompts: string[] = [];
  const runner = {
    async run(command: string, args: string[], runOptions?: { cwd?: string; timeoutMs?: number }) {
      calls.push({ command, args, options: runOptions });

      if (command === "git" && args[0] === "--version") {
        return { stdout: "git version 2\n", stderr: "" };
      }

      if (command === "git" && args[0] === "clone") {
        const target = args.at(-1);
        if (!target) {
          throw new Error("missing clone target");
        }
        await writeStyleRepo(target, styles);
        return { stdout: "cloned\n", stderr: "" };
      }

      if (command === "pencil") {
        const inIndex = args.indexOf("--in");
        const outIndex = args.indexOf("--out");
        const promptIndex = args.indexOf("--prompt");
        const input = inIndex >= 0 ? args[inIndex + 1] : undefined;
        const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
        const prompt = promptIndex >= 0 ? args[promptIndex + 1] : "";
        prompts.push(prompt);
        if (options.failPencilFor && prompt.includes(`Style name: ${options.failPencilFor}`)) {
          throw new Error(`pencil failed for ${options.failPencilFor}`);
        }
        if (!input) {
          throw new Error("missing --in");
        }
        if (!out) {
          throw new Error("missing --out");
        }
        await readFile(input, "utf8");
        await writeFile(out, JSON.stringify({ children: [{ id: "root", type: "frame" }] }), "utf8");
        return { stdout: "ok\n", stderr: "" };
      }

      return { stdout: "ok\n", stderr: "" };
    }
  };
  return { runner, calls, prompts };
}

function createFakePencilService(options: { failExportFor?: string; lockHeld?: boolean } = {}) {
  const service = {
    lockCalls: 0,
    async checkAvailability() {
      return undefined;
    },
    async withLock<T>(_context: { operation: string; product_id: string }, fn: () => Promise<T>): Promise<T> {
      service.lockCalls += 1;
      if (options.lockHeld) {
        const error = new Error("Pencil lock is held") as Error & { code: string };
        error.code = "PENCIL_LOCK_HELD";
        throw error;
      }
      return await fn();
    },
    async validatePenFile(filePath: string) {
      JSON.parse(await readFile(filePath, "utf8"));
    },
    async exportPreview(inputPen: string, outputPng: string) {
      if (options.failExportFor && inputPen.includes(options.failExportFor)) {
        throw new Error(`export failed for ${options.failExportFor}`);
      }
      await writeFile(outputPng, minimalPng);
    }
  };
  return service;
}

async function writeStyleRepo(root: string, styles: StyleFixture[]) {
  await mkdir(root, { recursive: true });
  for (const style of styles) {
    const dir = join(root, style.name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "DESIGN.md"), style.designMd, "utf8");
  }
}

async function writePreviewTemplate(home: string) {
  await mkdir(join(home, "styles"), { recursive: true });
  await writeFile(join(home, "styles", "_preview-template.pen"), JSON.stringify({ children: [{ id: "template", type: "frame" }] }), "utf8");
}

async function waitForSync(service: SyncService, fakeTimers = false) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await service.getStatus();
    if (status.status !== "running") {
      return status;
    }
    if (fakeTimers) {
      await vi.advanceTimersByTimeAsync(2_000);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error("sync did not finish");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("style sync pure helpers", () => {
  it("scans root-level style directories with DESIGN.md", async () => {
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

  it("scans the live awesome-design-md collection directory when root has no styles", async () => {
    const root = await tempDir();
    await mkdir(join(root, "design-md", "apple"), { recursive: true });
    await mkdir(join(root, "design-md", "_template"), { recursive: true });
    await mkdir(join(root, "design-md", "nested", "deep"), { recursive: true });
    await writeFile(join(root, "design-md", "apple", "DESIGN.md"), "# Apple\n");
    await writeFile(join(root, "design-md", "_template", "DESIGN.md"), "# Template\n");
    await writeFile(join(root, "design-md", "nested", "deep", "DESIGN.md"), "# Deep\n");

    await expect(scanStyleDirectories(root)).resolves.toEqual([{ name: "apple", designMdPath: join(root, "design-md", "apple", "DESIGN.md") }]);
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
  it("starts a sync after the Git gate when autoRun is false", async () => {
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
    expect(calls).toEqual([{ command: "git", args: ["--version"], options: { timeoutMs: 5_000 } }]);
  });

  it("does not require Pencil availability for metadata-only style sync", async () => {
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

    expect(calls).toEqual(["git --version 5000"]);
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
    const store = await createFormaStore({ home: await tempDir(), bundledStylesDir: join(await tempDir(), "styles") });

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

describe("SyncService task execution", () => {
  it("clones the design repository and writes style metadata without Pencil previews", async () => {
    const home = await tempDir();
    await writePreviewTemplate(home);
    const styles = [
      { name: "alpha", designMd: designMd("alpha", "#0055cc") },
      { name: "beta", designMd: designMd("beta", "#cc5500") }
    ];
    const { runner, calls, prompts } = createFakeRunner(styles);
    const service = new SyncService({
      home,
      pencilService: createFakePencilService(),
      runner,
      now: () => new Date("2026-05-18T00:00:00.000Z")
    });

    const started = await service.startSync();
    const status = await waitForSync(service);

    expect(status).toEqual({
      status: "idle",
      last_sync: {
        completed_at: "2026-05-18T00:00:00.000Z",
        styles_total: 2,
        styles_updated: 0,
        styles_added: 2,
        styles_failed: 0,
        duration_ms: 0
      }
    });
    const index = await readYaml<{ last_synced: string; styles: Array<{ name: string; design_md_path: string }> }>(
      join(home, "styles", "styles.yaml")
    );
    expect(index.last_synced).toBe("2026-05-18T00:00:00.000Z");
    expect(index.styles.map((style) => style.name)).toEqual(["alpha", "beta"]);
    expect(index.styles.map((style) => style.design_md_path)).toEqual(["styles/alpha/DESIGN.md", "styles/beta/DESIGN.md"]);
    for (const style of styles) {
      await expect(readFile(join(home, "styles", style.name, "DESIGN.md"), "utf8")).resolves.toBe(style.designMd);
      await expect(access(join(home, "styles", style.name, "preview@2x.png"))).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(calls).toContainEqual({
      command: "git",
      args: ["clone", "--depth", "1", "https://github.com/VoltAgent/awesome-design-md.git", `/tmp/forma-sync-${started.task_id}`],
      options: { timeoutMs: 60_000 }
    });
    expect(calls.filter((call) => call.command === "pencil")).toEqual([]);
    expect(prompts).toEqual([]);
  });

  it("counts added and updated styles without counting unchanged styles as updated", async () => {
    const home = await tempDir();
    await writePreviewTemplate(home);
    const unchanged = designMd("unchanged", "#111111");
    const previousChanged = designMd("changed", "#222222");
    const nextChanged = designMd("changed", "#333333");
    await mkdir(join(home, "styles", "unchanged"), { recursive: true });
    await mkdir(join(home, "styles", "changed"), { recursive: true });
    await writeFile(join(home, "styles", "unchanged", "DESIGN.md"), unchanged, "utf8");
    await writeFile(join(home, "styles", "changed", "DESIGN.md"), previousChanged, "utf8");
    const { runner } = createFakeRunner([
      { name: "changed", designMd: nextChanged },
      { name: "new-style", designMd: designMd("new-style", "#444444") },
      { name: "unchanged", designMd: unchanged }
    ]);
    const service = new SyncService({
      home,
      pencilService: createFakePencilService(),
      runner,
      now: () => new Date("2026-05-18T00:00:00.000Z")
    });

    await service.startSync();
    const status = await waitForSync(service);

    expect(status).toMatchObject({
      status: "idle",
      last_sync: {
        styles_total: 3,
        styles_added: 1,
        styles_updated: 1,
        styles_failed: 0
      }
    });
  });

  it("can limit scanned styles for bounded live checks", async () => {
    const home = await tempDir();
    await writePreviewTemplate(home);
    const { runner } = createFakeRunner([
      { name: "alpha", designMd: designMd("alpha", "#111111") },
      { name: "beta", designMd: designMd("beta", "#222222") },
      { name: "gamma", designMd: designMd("gamma", "#333333") }
    ]);
    const service = new SyncService({
      home,
      pencilService: createFakePencilService(),
      runner,
      styleLimit: 2,
      now: () => new Date("2026-05-18T00:00:00.000Z")
    });

    await service.startSync();
    const status = await waitForSync(service);
    const index = await readYaml<{ styles: Array<{ name: string }> }>(join(home, "styles", "styles.yaml"));

    expect(status).toMatchObject({
      status: "idle",
      last_sync: {
        styles_total: 2,
        styles_added: 2,
        styles_updated: 0,
        styles_failed: 0
      }
    });
    expect(index.styles.map((style) => style.name)).toEqual(["alpha", "beta"]);
  });

  it("keeps existing static previews as untouched resources while syncing metadata", async () => {
    const home = await tempDir();
    await writePreviewTemplate(home);
    await mkdir(join(home, "styles", "broken"), { recursive: true });
    await writeFile(join(home, "styles", "broken", "preview@2x.png"), oldPreviewPng);
    const styles = [
      { name: "broken", designMd: designMd("broken", "#990000") },
      { name: "working", designMd: designMd("working", "#009900") }
    ];
    const { runner } = createFakeRunner(styles, { failPencilFor: "broken" });
    const service = new SyncService({
      home,
      pencilService: createFakePencilService(),
      runner,
      now: () => new Date("2026-05-18T00:00:00.000Z")
    });

    await service.startSync();
    const status = await waitForSync(service);

    expect(status).toMatchObject({
      status: "idle",
      last_sync: {
        styles_total: 2,
        styles_added: 2,
        styles_updated: 0,
        styles_failed: 0
      }
    });
    const index = await readYaml<{ styles: Array<{ name: string }> }>(join(home, "styles", "styles.yaml"));
    expect(index.styles.map((style) => style.name)).toEqual(["broken", "working"]);
    await expect(readFile(join(home, "styles", "broken", "DESIGN.md"), "utf8")).resolves.toBe(styles[0]!.designMd);
    await expect(readFile(join(home, "styles", "broken", "preview@2x.png"))).resolves.toEqual(oldPreviewPng);
    await expect(access(join(home, "styles", "working", "preview@2x.png"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not acquire Pencil locks for metadata-only style sync", async () => {
    vi.useFakeTimers();
    const home = await tempDir();
    const { runner, calls } = createFakeRunner([
      { name: "alpha", designMd: designMd("alpha", "#0055cc") },
      { name: "beta", designMd: designMd("beta", "#cc5500") }
    ]);
    const pencilService = createFakePencilService({ lockHeld: true });
    const service = new SyncService({
      home,
      pencilService,
      runner,
      now: () => new Date("2026-05-18T00:00:00.000Z")
    });

    await service.startSync();
    const status = await waitForSync(service, true);

    expect(status).toMatchObject({
      status: "idle",
      last_sync: {
        styles_total: 2,
        styles_added: 2,
        styles_updated: 0,
        styles_failed: 0
      }
    });
    expect(pencilService.lockCalls).toBe(0);
    expect(calls.filter((call) => call.command === "pencil")).toEqual([]);
    await expect(access(join(home, "styles", "alpha", "preview@2x.png"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(home, "styles", "beta", "preview@2x.png"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps metadata when the preview template is missing", async () => {
    const home = await tempDir();
    const styles = [
      { name: "alpha", designMd: designMd("alpha", "#0055cc") },
      { name: "beta", designMd: designMd("beta", "#cc5500") }
    ];
    const { runner } = createFakeRunner(styles);
    const service = new SyncService({
      home,
      pencilService: createFakePencilService(),
      runner,
      now: () => new Date("2026-05-18T00:00:00.000Z")
    });

    await service.startSync();
    const status = await waitForSync(service);

    expect(status).toMatchObject({
      status: "idle",
      last_sync: {
        styles_total: 2,
        styles_added: 2,
        styles_updated: 0,
        styles_failed: 0
      }
    });
    const index = await readYaml<{ styles: Array<{ name: string }> }>(join(home, "styles", "styles.yaml"));
    expect(index.styles.map((style) => style.name)).toEqual(["alpha", "beta"]);
    await expect(readFile(join(home, "styles", "alpha", "DESIGN.md"), "utf8")).resolves.toBe(styles[0]!.designMd);
    await expect(readFile(join(home, "styles", "beta", "DESIGN.md"), "utf8")).resolves.toBe(styles[1]!.designMd);
    await expect(access(join(home, "styles", "alpha", "preview@2x.png"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(home, "styles", "beta", "preview@2x.png"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not publish partial style writes when updating the staged index fails", async () => {
    const home = await tempDir();
    await writePreviewTemplate(home);
    const previousDesign = designMd("alpha", "#111111");
    const nextDesign = designMd("alpha", "#222222");
    await mkdir(join(home, "styles", "alpha"), { recursive: true });
    await writeFile(join(home, "styles", "alpha", "DESIGN.md"), previousDesign, "utf8");
    await writeFile(join(home, "styles", "alpha", "preview@2x.png"), oldPreviewPng);
    await mkdir(join(home, "styles", "styles.yaml"), { recursive: true });
    const { runner } = createFakeRunner([{ name: "alpha", designMd: nextDesign }]);
    const service = new SyncService({
      home,
      pencilService: createFakePencilService(),
      runner,
      now: () => new Date("2026-05-18T00:00:00.000Z")
    });

    await service.startSync();
    const status = await waitForSync(service);

    expect(status).toMatchObject({
      status: "failed",
      error: { phase: "updating_index" }
    });
    await expect(readFile(join(home, "styles", "alpha", "DESIGN.md"), "utf8")).resolves.toBe(previousDesign);
    await expect(readFile(join(home, "styles", "alpha", "preview@2x.png"))).resolves.toEqual(oldPreviewPng);
  });

  it("fails the task during scanning when the cloned repository has no style directories", async () => {
    const home = await tempDir();
    const { runner } = createFakeRunner([]);
    const service = new SyncService({
      home,
      pencilService: createFakePencilService(),
      runner
    });

    await service.startSync();
    const status = await waitForSync(service);

    expect(status).toEqual({
      status: "failed",
      task_id: expect.stringMatching(/^sync-[a-f0-9]{16}$/),
      error: {
        phase: "scanning",
        message: "Repository structure changed: no style directories found"
      }
    });
    await expect(access(join(home, "styles", "styles.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
