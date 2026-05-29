// D1-04: verify that initProductConfig writes platform, brand_style, and language
// fields to product.yaml after a product is created.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFormaStore, readYaml } from "../src/index.js";

async function markNormalizationCommitted(home: string): Promise<void> {
  await writeFile(join(home, ".v6-schema-cutover-committed"), "committed\n", "utf8");
}

async function createTestStore() {
  const home = await mkdtemp(join(tmpdir(), "forma-product-config-"));
  await markNormalizationCommitted(home);
  return createFormaStore({ home, bundledStylesDir: resolve("styles") });
}

describe("D1-04 ProductNew config wiring — product.yaml disk verification", () => {
  it("writes brand_style and optional system_style to product.yaml", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({
      name: "Checkout App",
      description: "Mobile checkout workbench"
    });

    await store.products.initProductConfig(product.id, {
      platform: "web",
      brand_style: "ant",
      system_style: "shadcn-ui",
      languages: ["en", "zh-CN"],
      default_language: "en"
    });

    // Read the raw product.yaml from disk to confirm all fields are persisted.
    const productYaml = await readYaml(
      join(store.home, "data", product.id, "product.yaml")
    );

    expect(productYaml).toMatchObject({
      id: product.id,
      name: "Checkout App",
      description: "Mobile checkout workbench",
      platform: "web",
      brand_style: "ant",
      system_style: "shadcn-ui",
      languages: ["en", "zh-CN"],
      default_language: "en"
    });
  });

  it("writes brand_style without system_style (system_style is optional)", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({
      name: "Shop App",
      description: "Retail shop"
    });

    await store.products.initProductConfig(product.id, {
      platform: "mobile",
      brand_style: "linear",
      languages: ["en"],
      default_language: "en"
    });

    const productYaml = await readYaml(
      join(store.home, "data", product.id, "product.yaml")
    );

    expect(productYaml).toMatchObject({
      platform: "mobile",
      brand_style: "linear"
    });
    expect((productYaml as Record<string, unknown>).system_style).toBeUndefined();
  });

  it("overwrites a previous config when initProductConfig is called again", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({
      name: "Shop App",
      description: "Retail shop"
    });

    // First config call
    await store.products.initProductConfig(product.id, {
      platform: "mobile",
      brand_style: "linear",
      languages: ["en"],
      default_language: "en"
    });

    // Second config call — new platform and language set
    await store.products.initProductConfig(product.id, {
      platform: "desktop",
      brand_style: "linear",
      languages: ["en", "zh-CN"],
      default_language: "zh-CN"
    });

    const productYaml = await readYaml(
      join(store.home, "data", product.id, "product.yaml")
    );

    expect(productYaml).toMatchObject({
      platform: "desktop",
      languages: ["en", "zh-CN"],
      default_language: "zh-CN"
    });
  });
});
