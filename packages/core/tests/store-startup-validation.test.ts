import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFormaStore, FormaError, readYaml } from "../src/index.js";

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

  it("refuses to start when a requirement page is missing its semantic contract", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-startup-validation-legacy-requirement-"));

    const store = await createFormaStore({ home, bundledStylesDir: resolve("styles") });
    const product = await store.products.createProduct({
      name: "Checkout App",
      description: "Mobile checkout workbench",
    });
    const requirement = await store.requirements.createEmptyRequirement(product.id, "Checkout flow");

    await writeFile(
      join(home, "data", product.id, requirement.id, "requirement.yaml"),
      [
        `id: ${requirement.id}`,
        `product_id: ${product.id}`,
        "title: Checkout flow",
        "status: submitted",
        "ui_affected: true",
        "created_at: '2026-06-05T00:00:00.000Z'",
        "updated_at: '2026-06-05T00:00:00.000Z'",
        "pages:",
        "  - page_id: checkout",
        "    name: Checkout",
        "    baseline_page: checkout",
        "    design_status: pending",
        "navigation: []",
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

  it("writes a minimal semantic contract for newly saved requirement pages", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-startup-validation-new-requirement-"));

    const store = await createFormaStore({ home, bundledStylesDir: resolve("styles") });
    const product = await store.products.createProduct({
      name: "Checkout App",
      description: "Mobile checkout workbench",
    });
    const requirement = await store.requirements.createEmptyRequirement(product.id, "Checkout flow");

    await store.requirements.saveRequirement({
      requirement_id: requirement.id,
      document_md: "# Checkout flow",
      pages: [
        {
          page_id: "checkout",
          name: "Checkout",
          baseline_page: "checkout",
          change_type: "new",
          copy: [{ context: "cta", text: "Pay now" }],
          declared_fields: [{ key: "email", label: "Email" }],
          declared_actions: [{ key: "submit_payment", label: "Submit payment" }],
          declared_component_keys: ["primary-button"],
        },
      ],
      navigation: [],
    });

    const saved = await readYaml<{ pages: Array<Record<string, unknown>> }>(
      join(home, "data", product.id, requirement.id, "requirement.yaml"),
    );

    expect(saved.pages[0]).toMatchObject({
      semantic_contract_coverage: "minimal",
      semantic_contract: {
        actions: [{ key: "submit_payment", label: "Submit payment" }],
        allowed_copy: ["Pay now"],
        component_keys: ["primary-button"],
        fields: [{ key: "email", label: "Email" }],
        navigation: [],
      },
    });
    await expect(createFormaStore({ home, bundledStylesDir: resolve("styles") })).resolves.toBeDefined();
  });

  it("rebuilds the minimal semantic contract when an existing requirement page changes", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-startup-validation-update-requirement-"));

    const store = await createFormaStore({ home, bundledStylesDir: resolve("styles") });
    const product = await store.products.createProduct({
      name: "Checkout App",
      description: "Mobile checkout workbench",
    });
    const requirement = await store.requirements.createEmptyRequirement(product.id, "Checkout flow");

    await store.requirements.saveRequirement({
      requirement_id: requirement.id,
      document_md: "# Checkout flow",
      pages: [
        {
          page_id: "checkout",
          name: "Checkout",
          baseline_page: "checkout",
          change_type: "new",
          copy: [{ context: "cta", text: "Pay now" }],
          declared_actions: [{ key: "submit_payment", label: "Submit payment" }],
        },
      ],
      navigation: [],
    });

    await store.requirements.saveRequirement({
      requirement_id: requirement.id,
      document_md: "# Checkout flow",
      pages: [
        {
          page_id: "checkout",
          name: "Checkout",
          baseline_page: "checkout",
          change_type: "new",
          copy: [{ context: "cta", text: "Place order" }],
          declared_fields: [{ key: "shipping_address", label: "Shipping address" }],
          declared_actions: [{ key: "place_order", label: "Place order" }],
        },
      ],
      navigation: [],
    });

    const saved = await readYaml<{ pages: Array<Record<string, unknown>> }>(
      join(home, "data", product.id, requirement.id, "requirement.yaml"),
    );

    expect(saved.pages[0]).toMatchObject({
      semantic_contract_coverage: "minimal",
      semantic_contract: {
        actions: [{ key: "place_order", label: "Place order" }],
        allowed_copy: ["Place order"],
        fields: [{ key: "shipping_address", label: "Shipping address" }],
      },
    });
    expect(saved.pages[0]?.semantic_contract).not.toMatchObject({
      actions: [{ key: "submit_payment", label: "Submit payment" }],
      allowed_copy: ["Pay now"],
    });
  });

  it("starts cleanly when all product read models are intact", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-startup-validation-ok-"));

    const store = await createFormaStore({ home, bundledStylesDir: resolve("styles") });
    await store.products.createProduct({ name: "Intact App", description: "fine" });

    // Re-opening the same home revalidates every read model without throwing.
    await expect(createFormaStore({ home, bundledStylesDir: resolve("styles") })).resolves.toBeDefined();
  });
});
