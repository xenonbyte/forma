import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFormaStore, readYaml } from "../src/index.js";

async function createTestStore() {
  const home = await mkdtemp(join(tmpdir(), "forma-store-"));
  return createFormaStore({ home });
}

describe("product session and style services", () => {
  it("creates products and blocks incomplete session", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });

    await expect(store.sessions.setCurrentProduct(product.id)).rejects.toMatchObject({
      code: "PRODUCT_CONFIG_INCOMPLETE"
    });
  });

  it("sets session after platform style and components exist", async () => {
    const store = await createTestStore();
    await store.styles.installBuiltInStyles();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });
    await store.products.initProductConfig(product.id, {
      platform: "mobile",
      style: {
        name: "linear",
        description: "Focused tool UI",
        design_md_path: "styles/linear/DESIGN.md",
        variables: store.styles.withDefaultVariables({ primary: "#5E6AD2" })
      }
    });
    await store.products.markComponentsInitialized(product.id);
    await store.sessions.setCurrentProduct(product.id);

    expect(await store.sessions.getCurrentSession()).toEqual({ current_product: product.id });
  });

  it("writes product index and product yaml", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });

    expect(await store.products.getProduct(product.id)).toMatchObject({
      id: product.id,
      name: "Shop App",
      description: "Mobile shop"
    });
    expect(await store.products.listProducts()).toEqual([
      { id: product.id, name: "Shop App", description: "Mobile shop" }
    ]);

    await expect(readYaml(join(store.home, "data", "products.yaml"))).resolves.toEqual({
      products: [{ id: product.id, name: "Shop App", description: "Mobile shop" }]
    });
    await expect(readYaml(join(store.home, "data", product.id, "product.yaml"))).resolves.toMatchObject({
      id: product.id,
      name: "Shop App",
      description: "Mobile shop"
    });
  });

  it("reports missing products with stable error codes", async () => {
    const store = await createTestStore();

    await expect(store.products.getProduct("P-missing")).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
  });

  it("installs and reads built-in styles", async () => {
    const store = await createTestStore();

    await store.styles.installBuiltInStyles();

    const styles = await store.styles.listStyles();
    expect(styles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "linear",
          description: "Focused tool UI",
          design_md_path: "styles/linear/DESIGN.md"
        }),
        expect.objectContaining({
          name: "claude",
          design_md_path: "styles/claude/DESIGN.md"
        })
      ])
    );
    expect(await readFile(join(store.home, "styles", "_preview-template.pen"), "utf8")).toContain("Forma Style Preview");

    const linear = await store.styles.getStyle("linear");
    expect(linear.metadata).toMatchObject({ name: "linear", description: "Focused tool UI" });
    expect(linear.designMd).toContain("# Linear");

    await expect(store.styles.getStyle("missing")).rejects.toMatchObject({ code: "STYLE_NOT_FOUND" });
  });

  it("fills default style variables", async () => {
    const store = await createTestStore();

    expect(store.styles.withDefaultVariables({ primary: "#5E6AD2" })).toEqual({
      primary: "#5E6AD2",
      background: "#FFFFFF",
      "text-primary": "#111827",
      "font-heading": "Inter",
      "font-body": "Inter",
      "border-radius": "8px",
      "spacing-unit": "8px"
    });
  });
});
