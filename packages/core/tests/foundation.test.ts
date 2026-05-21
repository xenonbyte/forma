import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as corePublic from "../src/index.js";
import {
  FormaError,
  createId,
  designStatuses,
  getFormaPaths,
  idKinds,
  platforms,
  readYaml,
  readYamlAs,
  requirementStatuses,
  writeYamlAtomic
} from "../src/index.js";

describe("core foundation", () => {
  it("creates typed ids", () => {
    expect(createId("product")).toMatch(/^P-[a-f0-9]{6}$/);
    expect(createId("requirement")).toMatch(/^R-[a-f0-9]{8}$/);
    expect(createId("design")).toMatch(/^D-[a-f0-9]{8}$/);
  });

  it("exports spec-aligned schema literals", () => {
    expect(idKinds).toEqual(["product", "requirement", "design"]);
    expect(platforms).toEqual(["mobile", "desktop", "tablet", "web"]);
    expect(requirementStatuses).toEqual(["empty", "submitted", "active", "archived"]);
    expect(designStatuses).toEqual(["pending", "done", "expired"]);
  });

  it("does not publicly export legacy page-level design write surface", () => {
    expect(corePublic).not.toHaveProperty("DesignService");
    expect(corePublic).not.toHaveProperty("designSchema");
    expect(corePublic).not.toHaveProperty("designIdSchema");
    expect(corePublic).not.toHaveProperty("saveDesignInputSchema");
  });

  it("uses injected forma home", async () => {
    const root = await mkdtemp(join(tmpdir(), "forma-test-"));
    const paths = getFormaPaths(root);
    expect(paths.configFile).toBe(join(root, "config.yaml"));
    expect(paths.lockFile).toBe(join(root, "pencil.lock"));
    expect(paths.dataDir).toBe(join(root, "data"));
    expect(paths.sessionFile).toBe(join(root, "session.yaml"));
    expect(paths.manifestsDir).toBe(join(root, "manifests"));
    expect(paths.skillsDir).toBe(join(root, "skills"));
    expect(paths.commandsDir).toBe(join(root, "commands"));
    expect(paths.libraryDir).toBe(join(root, "library"));
    expect(paths.stylesDir).toBe(join(root, "styles"));
  });

  it("writes yaml atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "forma-yaml-"));
    const file = join(root, "value.yaml");
    await writeYamlAtomic(file, { id: "P-a1b2c3", enabled: true });
    expect(await readYaml<{ id: string; enabled: boolean }>(file)).toEqual({ id: "P-a1b2c3", enabled: true });
    expect(await readFile(file, "utf8")).toContain("P-a1b2c3");
  });

  it("validates yaml with zod schemas", async () => {
    const root = await mkdtemp(join(tmpdir(), "forma-yaml-schema-"));
    const file = join(root, "value.yaml");
    await writeYamlAtomic(file, { id: "P-a1b2c3", enabled: "yes" });

    await expect(readYamlAs(file, z.object({ id: z.string(), enabled: z.boolean() }))).rejects.toThrow();
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
