import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFormaStore, readYaml } from "../src/index.js";

async function createTestStore() {
  const home = await mkdtemp(join(tmpdir(), "forma-store-"));
  return createFormaStore({ home, bundledStylesDir: resolve("styles") });
}

describe("product session and style services", () => {
  it("creates products and blocks incomplete session", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });

    await expect(store.sessions.setCurrentProduct(product.id)).rejects.toMatchObject({
      code: "PRODUCT_CONFIG_INCOMPLETE",
      details: {
        missing: ["platform", "style", "components_initialized"]
      }
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

  it("does not read outside data dir for invalid product ids", async () => {
    const store = await createTestStore();
    await mkdir(join(store.home, "outside"), { recursive: true });
    await writeFile(join(store.home, "outside", "product.yaml"), "id: P-123456\nname: Escape\ndescription: Outside\n");

    await expect(store.products.getProduct("../outside")).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
  });

  it("reports missing products with stable error codes", async () => {
    const store = await createTestStore();

    await expect(store.products.getProduct("P-missing")).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
  });

  it("rejects unsafe style design paths in product config", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });
    const baseConfig = {
      platform: "mobile" as const,
      style: {
        name: "linear",
        description: "Focused tool UI",
        design_md_path: "styles/linear/DESIGN.md",
        variables: store.styles.withDefaultVariables({})
      }
    };

    await expect(
      store.products.initProductConfig(product.id, {
        ...baseConfig,
        style: { ...baseConfig.style, design_md_path: "../outside.md" }
      })
    ).rejects.toThrow();
    await expect(
      store.products.initProductConfig(product.id, {
        ...baseConfig,
        style: { ...baseConfig.style, design_md_path: "/tmp/outside.md" }
      })
    ).rejects.toThrow();
  });

  it("rejects incomplete style variables in product config", async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });

    await expect(
      store.products.initProductConfig(product.id, {
        platform: "mobile",
        style: {
          name: "linear",
          description: "Focused tool UI",
          design_md_path: "styles/linear/DESIGN.md",
          variables: {
            primary: "#5E6AD2"
          }
        }
      })
    ).rejects.toThrow();
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

  it("does not overwrite existing home styles on reinstall", async () => {
    const store = await createTestStore();
    await store.styles.installBuiltInStyles();
    await writeFile(join(store.home, "styles", "linear", "DESIGN.md"), "# Local Linear\n");

    await store.styles.installBuiltInStyles();

    expect(await readFile(join(store.home, "styles", "linear", "DESIGN.md"), "utf8")).toBe("# Local Linear\n");
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
