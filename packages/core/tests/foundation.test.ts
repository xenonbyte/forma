import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FormaError, createId, getFormaPaths, readYaml, writeYamlAtomic } from "../src/index.js";

describe("core foundation", () => {
  it("creates typed ids", () => {
    expect(createId("product")).toMatch(/^P-[a-f0-9]{6}$/);
    expect(createId("requirement")).toMatch(/^R-[a-f0-9]{8}$/);
    expect(createId("design")).toMatch(/^D-[a-f0-9]{8}$/);
  });

  it("uses injected forma home", async () => {
    const root = await mkdtemp(join(tmpdir(), "forma-test-"));
    const paths = getFormaPaths(root);
    expect(paths.dataDir).toBe(join(root, "data"));
    expect(paths.sessionFile).toBe(join(root, "session.yaml"));
  });

  it("writes yaml atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "forma-yaml-"));
    const file = join(root, "value.yaml");
    await writeYamlAtomic(file, { id: "P-a1b2c3", enabled: true });
    expect(await readYaml<{ id: string; enabled: boolean }>(file)).toEqual({ id: "P-a1b2c3", enabled: true });
    expect(await readFile(file, "utf8")).toContain("P-a1b2c3");
  });

  it("formats stable forma errors", () => {
    const err = new FormaError("PRODUCT_NOT_FOUND", "Product not found", { product_id: "P-missing" });
    expect(err.toJSON()).toEqual({
      error_code: "PRODUCT_NOT_FOUND",
      message: "Product not found",
      details: { product_id: "P-missing" }
    });
  });
});
