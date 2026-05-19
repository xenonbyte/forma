import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { PencilService, type PencilRunner } from "../src/index.js";
import { defaultPencilRunner } from "../src/pencil.js";

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

async function createHome(name: string) {
  return await mkdir(join(tmpdir(), `forma-pencil-${name}-${randomUUID()}`), { recursive: true });
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("PencilService", () => {
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

  it("generatePageDesign runs expected pencil commands and returns temp paths", async () => {
    const home = await createHome("page-design");
    const fakeRunner = createFakeRunner(async (_command, args) => {
      if (args[0] === "status") return { stdout: "active", stderr: "" };
      if (args.includes("--out")) {
        const out = args[args.indexOf("--out") + 1];
        await writeFile(out, JSON.stringify({ children: [{ id: "root", type: "frame" }] }));
      }
      if (args.includes("--export")) {
        const output = args[args.indexOf("--export") + 1];
        await writeFile(output, minimalPng);
      }
      return { stdout: "ok", stderr: "" };
    });
    const service = new PencilService({ home, runner: fakeRunner });

    const result = await service.generatePageDesign({
      product_id: "P-page",
      prompt: "Create checkout",
      workspace: "/tmp/workspace"
    });

    await expect(access(result.penPath)).resolves.toBeUndefined();
    await expect(access(result.previewPath)).resolves.toBeUndefined();
    const generateCall = fakeRunner.calls.find((call) => call.args.includes("--prompt"));
    expect(generateCall?.command).toBe("pencil");
    expect(generateCall?.args).toEqual(["--out", result.penPath, "--workspace", "/tmp/workspace", "--prompt", "Create checkout"]);
    expect(fakeRunner.calls.some((call) => call.args.includes("--export-scale") && call.args.includes("2"))).toBe(true);
  });

  it("generateComponents runs expected pencil command and returns temp paths", async () => {
    const home = await createHome("components");
    const finalLibraryPath = join(home, "library", "P-c0ffee.lib.pen");
    await mkdir(dirname(finalLibraryPath), { recursive: true });
    await writeFile(finalLibraryPath, "sentinel component library");
    const fakeRunner = createFakeRunner(async (_command, args) => {
      if (args[0] === "status") return { stdout: "active", stderr: "" };
      if (args.includes("--out")) {
        const out = args[args.indexOf("--out") + 1];
        await writeFile(out, JSON.stringify({ children: [{ id: "button", type: "component" }] }));
      }
      return { stdout: "ok", stderr: "" };
    });
    const service = new PencilService({ home, runner: fakeRunner });

    const result = await service.generateComponents({
      product_id: "P-c0ffee",
      prompt: "Create controls",
      workspace: "/tmp/workspace"
    });

    await expect(access(result.penPath)).resolves.toBeUndefined();
    expect(result).toEqual({ tempDir: result.tempDir, penPath: result.penPath });
    expect(result.penPath.endsWith("components.lib.pen")).toBe(true);
    expect(await readFile(finalLibraryPath, "utf8")).toBe("sentinel component library");
    expect(fakeRunner.calls.find((call) => call.args.includes("--prompt"))?.args).toEqual([
      "--out",
      result.penPath,
      "--prompt",
      "Create controls"
    ]);
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
    ).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });

    expect(fakeRunner.calls).toEqual([]);
    await expect(access(join(home, "escape.lib.pen"))).rejects.toThrow();
    await expect(access(join(dirname(home), "escape.lib.pen"))).rejects.toThrow();
  });

  it("rejects invalid generated pen files and releases the lock", async () => {
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
    ).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
    await expect(access(join(home, "pencil.lock"))).rejects.toThrow();
    await expect(access(dirname(outputPen))).rejects.toThrow();
  });

  it("cleans up page design temp dir after failed preview export", async () => {
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
    ).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
    await expect(access(dirname(outputPen))).rejects.toThrow();
  });
});
