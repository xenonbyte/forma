import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createFormaStore } from "../src/store.js";
import { diagnoseWorkspace } from "../src/doctor.js";

function minimalRequirementYaml(id: string, productId: string): string {
  const now = "2026-01-01T00:00:00.000Z";
  return [
    `id: ${id}`,
    `product_id: ${productId}`,
    `title: Test requirement`,
    `status: empty`,
    `ui_affected: true`,
    `created_at: "${now}"`,
    `updated_at: "${now}"`,
    `pages: []`,
    `navigation: []`,
  ].join("\n");
}

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

  it("reports document read failures that would block startup validation", async () => {
    const home = await testHome();
    const store = await createFormaStore({ home });
    const product = await store.products.createProduct({ name: "P", description: "d" });
    const requirementId = "R-aabbccdd";
    const requirementDir = join(home, "data", product.id, requirementId);
    await mkdir(requirementDir, { recursive: true });
    await writeFile(join(requirementDir, "requirement.yaml"), minimalRequirementYaml(requirementId, product.id), "utf8");
    await mkdir(join(requirementDir, "document.md"));

    await expect(createFormaStore({ home })).rejects.toThrow();

    const diagnosis = await diagnoseWorkspace({ home });

    expect(diagnosis.findings).toContainEqual(
      expect.objectContaining({
        kind: "schema",
        product_id: product.id,
        requirement_id: requirementId,
        file: `data/${product.id}/${requirementId}/document.md`,
      }),
    );
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

  it("reports REQUIREMENT_PRODUCT_MISMATCH when same requirement id exists under two products", async () => {
    const home = await testHome();
    const store = await createFormaStore({ home });
    const productA = await store.products.createProduct({ name: "A", description: "a" });
    const productB = await store.products.createProduct({ name: "B", description: "b" });

    // Shared requirement id — both dirs exist but both YAML files claim product_id = B.
    const requirementId = "R-aabbccdd";

    // Place requirement under product A's directory — product_id points to B (the mismatch).
    const dirA = join(home, "data", productA.id, requirementId);
    await mkdir(dirA, { recursive: true });
    await writeFile(join(dirA, "requirement.yaml"), minimalRequirementYaml(requirementId, productB.id), "utf8");

    // Place a valid copy under product B's directory — product_id matches B.
    const dirB = join(home, "data", productB.id, requirementId);
    await mkdir(dirB, { recursive: true });
    await writeFile(join(dirB, "requirement.yaml"), minimalRequirementYaml(requirementId, productB.id), "utf8");

    const diagnosis = await diagnoseWorkspace({ home });

    const mismatchFindings = diagnosis.findings.filter((f) => f.error_code === "REQUIREMENT_PRODUCT_MISMATCH");
    // Must report exactly one mismatch — for product A's directory.
    expect(mismatchFindings).toHaveLength(1);
    expect(mismatchFindings[0]).toMatchObject({
      kind: "schema",
      product_id: productA.id,
      requirement_id: requirementId,
      error_code: "REQUIREMENT_PRODUCT_MISMATCH",
    });

    // Product B's copy is valid — must not be reported as a mismatch.
    const mismatchForB = diagnosis.findings.filter(
      (f) => f.error_code === "REQUIREMENT_PRODUCT_MISMATCH" && f.product_id === productB.id,
    );
    expect(mismatchForB).toHaveLength(0);
  });

  it("does not misreport product-scoped duplicate requirement ids as mismatches", async () => {
    const home = await testHome();
    const store = await createFormaStore({ home });
    const productA = await store.products.createProduct({ name: "A", description: "a" });
    const productB = await store.products.createProduct({ name: "B", description: "b" });
    const requirementId = "R-aabbccdd";

    const dirA = join(home, "data", productA.id, requirementId);
    await mkdir(dirA, { recursive: true });
    await writeFile(join(dirA, "requirement.yaml"), minimalRequirementYaml(requirementId, productA.id), "utf8");

    const dirB = join(home, "data", productB.id, requirementId);
    await mkdir(dirB, { recursive: true });
    await writeFile(join(dirB, "requirement.yaml"), minimalRequirementYaml(requirementId, productB.id), "utf8");

    const diagnosis = await diagnoseWorkspace({ home });

    expect(diagnosis.findings.filter((f) => f.error_code === "REQUIREMENT_PRODUCT_MISMATCH")).toEqual([]);
  });
});
