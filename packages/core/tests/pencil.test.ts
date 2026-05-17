import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PencilService, type PencilRunner } from "../src/index.js";

function createFakeRunner(
  handler: (command: string, args: string[], options?: { cwd?: string }) => Promise<{ stdout: string; stderr: string }> = async () => ({
    stdout: "",
    stderr: ""
  })
): PencilRunner & { calls: Array<{ command: string; args: string[]; options?: { cwd?: string } }> } {
  const calls: Array<{ command: string; args: string[]; options?: { cwd?: string } }> = [];
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

describe("PencilService", () => {
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

  it("exportPreview validates PNG size", async () => {
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

    const validRunner = createFakeRunner(async () => {
      await writeFile(outputPng, "png");
      return { stdout: "", stderr: "" };
    });
    await expect(new PencilService({ home, runner: validRunner }).exportPreview(inputPen, outputPng)).resolves.toBeUndefined();
    expect(validRunner.calls.at(-1)?.args).toEqual(["--in", inputPen, "--export", outputPng, "--export-scale", "2"]);
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
        await writeFile(output, "png");
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
      product_id: "P-comp",
      prompt: "Create controls",
      workspace: "/tmp/workspace"
    });

    await expect(access(result.penPath)).resolves.toBeUndefined();
    expect(result.penPath.endsWith("components.lib.pen")).toBe(true);
    expect(fakeRunner.calls.find((call) => call.args.includes("--prompt"))?.args).toEqual([
      "--out",
      result.penPath,
      "--prompt",
      "Create controls"
    ]);
  });

  it("rejects invalid generated pen files and releases the lock", async () => {
    const home = await createHome("invalid-generated");
    const fakeRunner = createFakeRunner(async (_command, args) => {
      if (args[0] === "status") return { stdout: "active", stderr: "" };
      if (args.includes("--out")) {
        const out = args[args.indexOf("--out") + 1];
        await writeFile(out, JSON.stringify({ children: [] }));
      }
      return { stdout: "ok", stderr: "" };
    });
    const service = new PencilService({ home, runner: fakeRunner });

    await expect(
      service.generateComponents({
        product_id: "P-invalid",
        prompt: "Create invalid output",
        workspace: "/tmp/workspace"
      })
    ).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
    await expect(access(join(home, "pencil.lock"))).rejects.toThrow();
  });
});
