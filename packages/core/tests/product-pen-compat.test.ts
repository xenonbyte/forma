import { expect, describe, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

describe("product.yaml strict field validation", () => {
  it("rejects product.yaml with unknown legacy fields", async () => {
    const { ProductService } = await import("../src/product.js");
    const { getProductMutationLock } = await import("../src/product-mutation-lock.js");

    const testHome = join(tmpdir(), `pen-compat-${randomBytes(4).toString("hex")}`);
    const dataDir = join(testHome, "data");
    const productId = "P-abc123";
    const productDir = join(dataDir, productId);

    await mkdir(productDir, { recursive: true });

    const productYaml = `
id: ${productId}
name: Test Product
description: A test product
platform: web
style:
  name: Default
  description: Default style
  design_md_path: styles/default.md
  variables:
    primary: "#111827"
    background: "#FFFFFF"
    text-primary: "#111827"
    font-heading: Inter
    font-body: Inter
    border-radius: 8px
    spacing-unit: 8px
languages:
  - en
default_language: en
legacy_integration_id: some-old-integration-id
legacy_canvas_path: /old/integration/path
`.trim();

    await writeFile(join(productDir, "product.yaml"), productYaml, "utf8");

    // Create product index (at data/products.yaml per ProductService impl)
    await writeFile(
      join(dataDir, "products.yaml"),
      `products:\n  - id: ${productId}\n    name: Test Product\n    description: A test product\n`,
      "utf8",
    );

    const lock = getProductMutationLock(testHome);
    const service = new ProductService({
      home: testHome,
      productMutationLock: lock,
    });

    try {
      await expect(service.getProduct(productId)).rejects.toThrow(/Unrecognized key/);
    } finally {
      await rm(testHome, { recursive: true, force: true });
    }
  });
});
