import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFormaStore } from "../src/index.js";

async function makeStore() {
  const home = await mkdtemp(join(tmpdir(), "forma-design-pointer-"));
  return createFormaStore({ home });
}

describe("A5 design pointer index", () => {
  it("sets, gets, lists a pointer keyed by (requirementId,pageId,variant)", async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: "X", description: "y" });
    await store.runProductMutation({ operation: "test", product_id: p.id }, () =>
      store.products.setDesignPointerLocked(p.id, {
        requirementId: "R-1234abcd",
        pageId: "login",
        variant: "default",
        artifactId: "AbCdEfGhIjKlMnOp",
        version: 2,
        designStatus: "active",
      }),
    );
    const got = await store.products.getDesignPointer(p.id, "R-1234abcd", "login", "default");
    expect(got).toMatchObject({ artifactId: "AbCdEfGhIjKlMnOp", version: 2, designStatus: "active" });
    const all = await store.products.listDesignPointers(p.id);
    expect(all).toHaveLength(1);
  });

  it("enforces uniqueness: re-setting same (req,page,variant) replaces, not duplicates", async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: "X", description: "y" });
    const set = (artifactId: string, version: number) =>
      store.runProductMutation({ operation: "test", product_id: p.id }, () =>
        store.products.setDesignPointerLocked(p.id, {
          requirementId: "R-1234abcd",
          pageId: "login",
          variant: "default",
          artifactId,
          version,
          designStatus: "active",
        }),
      );
    await set("AbCdEfGhIjKlMnOp", 1);
    await set("AbCdEfGhIjKlMnOp", 2);
    const all = await store.products.listDesignPointers(p.id);
    expect(all).toHaveLength(1);
    expect(all[0].version).toBe(2);
  });

  // rollbackDesignPointerLocked removed in R1/R4/R5 (PLAN-TASK-001); no test here

  it("schema rejects two pointers with identical (req,page,variant)", async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: "X", description: "y" });
    const dup = {
      ...p,
      designPointers: [
        { requirementId: "R-1", pageId: "a", variant: "default", artifactId: "A1", version: 1, designStatus: "active" },
        { requirementId: "R-1", pageId: "a", variant: "default", artifactId: "A2", version: 1, designStatus: "active" },
      ],
    };
    await writeFile(join(store.home, "data", p.id, "product.yaml"), JSON.stringify(dup), "utf8");
    await expect(store.products.getProduct(p.id)).rejects.toThrow();
  });
});
