import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createFormaStore } from "../src/store.js";
import { diagnoseWorkspace } from "../src/doctor.js";

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function testHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "forma-doctor-"));
  homes.push(home);
  return home;
}

describe("diagnoseWorkspace (F4)", () => {
  it("reports a clean workspace with zero findings", async () => {
    const home = await testHome();
    const store = await createFormaStore({ home });
    await store.products.createProduct({ name: "P", description: "d" });

    const diagnosis = await diagnoseWorkspace({ home });

    expect(diagnosis.findings).toEqual([]);
    expect(diagnosis.products_checked).toBe(1);
  });

  it("collects ALL schema findings instead of failing fast", async () => {
    const home = await testHome();
    const store = await createFormaStore({ home });
    const p1 = await store.products.createProduct({ name: "P1", description: "d" });
    const p2 = await store.products.createProduct({ name: "P2", description: "d" });

    await writeFile(join(home, "data", p1.id, "product.yaml"), "not: [valid yaml", "utf8");
    await writeFile(join(home, "data", p2.id, "product.yaml"), "also: [broken", "utf8");

    const diagnosis = await diagnoseWorkspace({ home });

    const schemaFindings = diagnosis.findings.filter((f) => f.kind === "schema");
    expect(schemaFindings.map((f) => f.product_id).sort()).toEqual([p1.id, p2.id].sort());
    expect(diagnosis.products_checked).toBe(2);
  });

  it("reports orphan product directories without modifying them", async () => {
    const home = await testHome();
    await createFormaStore({ home }); // initialize empty workspace
    const orphanDir = join(home, "data", "P-0ffffe");
    await mkdir(orphanDir, { recursive: true });
    await writeFile(join(orphanDir, "stray.txt"), "keep me", "utf8");

    const diagnosis = await diagnoseWorkspace({ home });

    expect(diagnosis.findings).toContainEqual(
      expect.objectContaining({ kind: "orphan", product_id: "P-0ffffe" }),
    );
    await expect(readFile(join(orphanDir, "stray.txt"), "utf8")).resolves.toBe("keep me");
  });

  it("does not modify existing workspace files while diagnosing", async () => {
    const home = await testHome();
    const store = await createFormaStore({ home });
    const product = await store.products.createProduct({ name: "P", description: "d" });
    const productFile = join(home, "data", product.id, "product.yaml");
    const beforeContent = await readFile(productFile, "utf8");
    const beforeStat = await stat(productFile);

    await diagnoseWorkspace({ home });

    expect(await readFile(productFile, "utf8")).toBe(beforeContent);
    const afterStat = await stat(productFile);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
    expect(afterStat.size).toBe(beforeStat.size);
  });

  it("survives a corrupt products.yaml and reports it as an index finding", async () => {
    const home = await testHome();
    await mkdir(join(home, "data"), { recursive: true });
    await writeFile(join(home, "data", "products.yaml"), "{{{{ not yaml", "utf8");

    const diagnosis = await diagnoseWorkspace({ home });

    expect(diagnosis.findings.some((f) => f.kind === "index")).toBe(true);
    expect(diagnosis.products_checked).toBe(0);
  });
});
