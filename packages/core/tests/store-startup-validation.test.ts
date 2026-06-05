import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFormaStore, FormaError } from "../src/index.js";

describe("createFormaStore strict startup validation", () => {
  it("refuses to start and names the product when its read model is corrupt", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-startup-validation-"));

    // First boot succeeds and seeds one product.
    const store = await createFormaStore({ home, bundledStylesDir: resolve("styles") });
    const product = await store.products.createProduct({
      name: "Checkout App",
      description: "Mobile checkout workbench",
    });

    // Corrupt the product's read model on disk (schema-invalid product.yaml).
    await writeFile(join(home, "data", product.id, "product.yaml"), "corrupted: true\n", "utf8");

    // Second boot must fail loudly, attributing the failure to this product.
    const error = await createFormaStore({ home, bundledStylesDir: resolve("styles") }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(FormaError);
    expect((error as FormaError).details.product_id).toBe(product.id);
  });

  it("refuses to start when product.yaml still contains removed product fields", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-startup-validation-legacy-product-"));

    const store = await createFormaStore({ home, bundledStylesDir: resolve("styles") });
    const product = await store.products.createProduct({
      name: "Checkout App",
      description: "Mobile checkout workbench",
    });

    await writeFile(
      join(home, "data", product.id, "product.yaml"),
      [
        `id: ${product.id}`,
        "name: Checkout App",
        "description: Mobile checkout workbench",
        "components_initialized: true",
        "style:",
        "  name: Default",
        "",
      ].join("\n"),
      "utf8",
    );

    const error = await createFormaStore({ home, bundledStylesDir: resolve("styles") }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(FormaError);
    expect((error as FormaError).details.product_id).toBe(product.id);
  });

  it("starts cleanly when all product read models are intact", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-startup-validation-ok-"));

    const store = await createFormaStore({ home, bundledStylesDir: resolve("styles") });
    await store.products.createProduct({ name: "Intact App", description: "fine" });

    // Re-opening the same home revalidates every read model without throwing.
    await expect(createFormaStore({ home, bundledStylesDir: resolve("styles") })).resolves.toBeDefined();
  });
});
