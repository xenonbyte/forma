// D1-04: verify that initProductConfig writes platform, brand_style, and language
// fields to product.yaml after a product is created.
// T1: brand_assets settings schema + updateBrandAssetSettings method.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFormaStore, readYaml } from "../src/index.js";

async function createTestStore() {
  const home = await mkdtemp(join(tmpdir(), "forma-product-config-"));
  return createFormaStore({ home, bundledStylesDir: resolve("styles") });
}

describe("D1-04 ProductNew config wiring — product.yaml disk verification", () => {
  it("writes brand_style and optional system_style to product.yaml", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({
      name: "Checkout App",
      description: "Mobile checkout workbench",
    });

    await store.products.initProductConfig(product.id, {
      platform: "web",
      brand_style: "ant",
      system_style: "shadcn-ui",
      languages: ["en", "zh-CN"],
      default_language: "en",
    });

    // Read the raw product.yaml from disk to confirm all fields are persisted.
    const productYaml = await readYaml(join(store.home, "data", product.id, "product.yaml"));

    expect(productYaml).toMatchObject({
      id: product.id,
      name: "Checkout App",
      description: "Mobile checkout workbench",
      platform: "web",
      brand_style: "ant",
      system_style: "shadcn-ui",
      languages: ["en", "zh-CN"],
      default_language: "en",
    });
  });

  it("writes brand_style without system_style (system_style is optional)", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({
      name: "Shop App",
      description: "Retail shop",
    });

    await store.products.initProductConfig(product.id, {
      platform: "mobile",
      brand_style: "linear",
      languages: ["en"],
      default_language: "en",
    });

    const productYaml = await readYaml(join(store.home, "data", product.id, "product.yaml"));

    expect(productYaml).toMatchObject({
      platform: "mobile",
      brand_style: "linear",
    });
    expect((productYaml as Record<string, unknown>).system_style).toBeUndefined();
  });

  it("overwrites a previous config when initProductConfig is called again", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({
      name: "Shop App",
      description: "Retail shop",
    });

    // First config call
    await store.products.initProductConfig(product.id, {
      platform: "mobile",
      brand_style: "linear",
      languages: ["en"],
      default_language: "en",
    });

    // Second config call — new platform and language set
    await store.products.initProductConfig(product.id, {
      platform: "desktop",
      brand_style: "linear",
      languages: ["en", "zh-CN"],
      default_language: "zh-CN",
    });

    const productYaml = await readYaml(join(store.home, "data", product.id, "product.yaml"));

    expect(productYaml).toMatchObject({
      platform: "desktop",
      languages: ["en", "zh-CN"],
      default_language: "zh-CN",
    });
  });
});

// ─── T1: brand_assets settings schema (SPEC-DATA-002) ────────────────────────

describe("brand_assets settings schema — defaults and boundary values", () => {
  it("store_shot_count must be in [3, 8] — rejects 2", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Test", description: "" });
    await expect(store.products.updateBrandAssetSettings(product.id, { store_shot_count: 2 })).rejects.toThrow();
  });

  it("store_shot_count 3 is the minimum accepted value", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Test", description: "" });
    const updated = await store.products.updateBrandAssetSettings(product.id, { store_shot_count: 3 });
    expect(updated.brand_assets?.store_shot_count).toBe(3);
  });

  it("store_shot_count 8 is the maximum accepted value", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Test", description: "" });
    const updated = await store.products.updateBrandAssetSettings(product.id, { store_shot_count: 8 });
    expect(updated.brand_assets?.store_shot_count).toBe(8);
  });

  it("store_shot_count must be in [3, 8] — rejects 9", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Test", description: "" });
    await expect(store.products.updateBrandAssetSettings(product.id, { store_shot_count: 9 })).rejects.toThrow();
  });

  it("banner defaults to false when not set", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Test", description: "" });
    // updateBrandAssetSettings with an empty patch applies defaults
    const updated = await store.products.updateBrandAssetSettings(product.id, {});
    expect(updated.brand_assets?.banner).toBe(false);
  });

  it("poster_portrait defaults to true (DECISION-001)", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Test", description: "" });
    const updated = await store.products.updateBrandAssetSettings(product.id, {});
    expect(updated.brand_assets?.poster_portrait).toBe(true);
  });

  it("poster_landscape defaults to true (DECISION-001)", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Test", description: "" });
    const updated = await store.products.updateBrandAssetSettings(product.id, {});
    expect(updated.brand_assets?.poster_landscape).toBe(true);
  });

  it("poster_square defaults to true (DECISION-001)", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Test", description: "" });
    const updated = await store.products.updateBrandAssetSettings(product.id, {});
    expect(updated.brand_assets?.poster_square).toBe(true);
  });

  it("absent brand_assets gets defaults applied on first updateBrandAssetSettings call", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Test", description: "" });
    // brand_assets not set yet
    expect(product.brand_assets).toBeUndefined();
    const updated = await store.products.updateBrandAssetSettings(product.id, {});
    expect(updated.brand_assets).toBeDefined();
    expect(updated.brand_assets?.store_shot_count).toBe(3);
    expect(updated.brand_assets?.banner).toBe(false);
    expect(updated.brand_assets?.poster_portrait).toBe(true);
    expect(updated.brand_assets?.poster_landscape).toBe(true);
    expect(updated.brand_assets?.poster_square).toBe(true);
  });

  it("updateBrandAssetSettings patch merge preserves prior values (sequential)", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Test", description: "" });
    // Write two distinct fields sequentially — the second write must NOT clobber the first.
    await store.products.updateBrandAssetSettings(product.id, { banner: true });
    await store.products.updateBrandAssetSettings(product.id, { store_shot_count: 5 });
    const final = await store.products.getProduct(product.id);
    expect(final.brand_assets?.banner).toBe(true);
    expect(final.brand_assets?.store_shot_count).toBe(5);
  });
});

// ─── T1: brand_assets persisted to product.yaml on disk ──────────────────────

describe("brand_assets persisted to disk", () => {
  it("writes brand_assets to product.yaml", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Test", description: "" });
    await store.products.updateBrandAssetSettings(product.id, { store_shot_count: 6, banner: true });
    const productYaml = await readYaml(join(store.home, "data", product.id, "product.yaml"));
    expect((productYaml as Record<string, unknown>).brand_assets).toMatchObject({
      store_shot_count: 6,
      banner: true,
    });
  });
});
