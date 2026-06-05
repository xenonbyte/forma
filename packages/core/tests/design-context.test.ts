import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFormaStore } from "../src/store.js";
import { buildDesignContext } from "../src/design-context.js";

async function markNormalizationCommitted(home: string): Promise<void> {
  await writeFile(join(home, ".v6-schema-cutover-committed"), "committed\n", "utf8");
}

async function createTestStore() {
  const home = await mkdtemp(join(tmpdir(), "forma-design-ctx-"));
  await markNormalizationCommitted(home);
  return createFormaStore({
    home,
    bundledStylesDir: resolve("styles"),
    bundledCraftDir: resolve("craft"),
  });
}

/** Seed a product + requirement with one page and one page-scoped rule. */
async function seedProductAndRequirement(store: Awaited<ReturnType<typeof createTestStore>>) {
  // Create and configure product
  const product = await store.products.createProduct({
    name: "Checkout App",
    description: "Mobile checkout workbench",
  });
  await store.products.initProductConfig(product.id, {
    platform: "web",
    brand_style: "ant",
    languages: ["en"],
    default_language: "en",
  });

  // Create empty requirement
  const req = await store.requirements.createEmptyRequirement(product.id, "Checkout flow");
  const pageId = "page-cart-01";

  // Submit requirement with a page using saveRequirement (which handles empty → submitted)
  const saved = await store.requirements.saveRequirement({
    requirement_id: req.id,
    document_md: "# Checkout flow\nUsers can checkout items.",
    ui_affected: true,
    pages: [
      {
        page_id: pageId,
        name: "Cart Page",
        baseline_page: "cart",
        change_type: "new",
        features: "Display cart items and checkout button",
      },
    ],
    navigation: [],
    translations: [],
    rules: [
      {
        id: "rule-cart-empty",
        page_id: pageId,
        given: "Cart is empty",
        when: "User views cart",
        then: "Show empty cart message",
      },
      {
        id: "rule-global",
        given: "Any page",
        when: "User is not authenticated",
        then: "Redirect to login",
      },
    ],
    remove_rule_ids: [],
    remove_page_ids: [],
  });

  return { product, requirement: saved, pageId };
}

describe("buildDesignContext", () => {
  it("returns craft (>=11 docs), brandStyle, page, rules, platform, language", async () => {
    const store = await createTestStore();
    const deps = { styles: store.styles, requirements: store.requirements, products: store.products };
    const { product, requirement, pageId } = await seedProductAndRequirement(store);

    const ctx = await buildDesignContext(deps, {
      productId: product.id,
      requirementId: requirement.id,
      pageId,
      brandStyle: "ant",
    });

    // craft: all docs
    expect(ctx.craft.length).toBeGreaterThanOrEqual(11);

    // brandStyle
    expect(ctx.brandStyle).toBeDefined();
    expect(ctx.brandStyle!.kind).toBe("brand");
    expect(ctx.brandStyle!.tokensCss).toContain("--accent");

    // page
    expect(ctx.page).toBeDefined();
    expect(ctx.page!.page_id).toBe(pageId);

    // rules: page-scoped rule + global rule (no page_id)
    expect(ctx.rules.length).toBeGreaterThanOrEqual(2);
    expect(ctx.rules.some((r) => r.page_id === pageId)).toBe(true);
    // global rule has no page_id
    expect(ctx.rules.some((r) => r.page_id === undefined)).toBe(true);

    // platform and language from product config
    expect(ctx.platform).toBe("web");
    expect(ctx.language).toBe("en");
  });

  it("returns exactly 1 craft doc when craftSlugs: [color]", async () => {
    const store = await createTestStore();
    const deps = { styles: store.styles, requirements: store.requirements, products: store.products };
    const { product, requirement, pageId } = await seedProductAndRequirement(store);

    const ctx = await buildDesignContext(deps, {
      productId: product.id,
      requirementId: requirement.id,
      pageId,
      craftSlugs: ["color"],
    });

    expect(ctx.craft).toHaveLength(1);
    expect(ctx.craft[0]!.slug).toBe("color");
  });

  it("falls back to product.brand_style when input.brandStyle is omitted", async () => {
    const store = await createTestStore();
    const deps = { styles: store.styles, requirements: store.requirements, products: store.products };
    const { product, requirement, pageId } = await seedProductAndRequirement(store);

    // Do NOT pass brandStyle — should fall back to product.brand_style = 'ant'
    const ctx = await buildDesignContext(deps, {
      productId: product.id,
      requirementId: requirement.id,
      pageId,
    });

    expect(ctx.brandStyle).toBeDefined();
    expect(ctx.brandStyle!.metadata.name).toBe("ant");
  });

  it("page is undefined when pageId is omitted", async () => {
    const store = await createTestStore();
    const deps = { styles: store.styles, requirements: store.requirements, products: store.products };
    const { product, requirement } = await seedProductAndRequirement(store);

    const ctx = await buildDesignContext(deps, {
      productId: product.id,
      requirementId: requirement.id,
      // no pageId
    });

    expect(ctx.page).toBeUndefined();
    // rules: all rules returned when no pageId
    expect(ctx.rules.length).toBeGreaterThanOrEqual(2);
  });

  it("page is undefined when pageId does not match any page", async () => {
    const store = await createTestStore();
    const deps = { styles: store.styles, requirements: store.requirements, products: store.products };
    const { product, requirement } = await seedProductAndRequirement(store);

    const ctx = await buildDesignContext(deps, {
      productId: product.id,
      requirementId: requirement.id,
      pageId: "nonexistent-page",
    });

    expect(ctx.page).toBeUndefined();
  });

  it("rules are filtered to page-scoped + global when pageId is given", async () => {
    const store = await createTestStore();
    const deps = { styles: store.styles, requirements: store.requirements, products: store.products };
    const { product, requirement, pageId } = await seedProductAndRequirement(store);

    const ctx = await buildDesignContext(deps, {
      productId: product.id,
      requirementId: requirement.id,
      pageId,
    });

    // All returned rules should either match the pageId or have no page_id
    for (const rule of ctx.rules) {
      expect(rule.page_id === pageId || rule.page_id === undefined).toBe(true);
    }
  });

  it("throws when brandStyle name does not exist in the style library", async () => {
    const store = await createTestStore();
    const deps = { styles: store.styles, requirements: store.requirements, products: store.products };
    const { product, requirement, pageId } = await seedProductAndRequirement(store);

    await expect(
      buildDesignContext(deps, {
        productId: product.id,
        requirementId: requirement.id,
        pageId,
        brandStyle: "nonexistent-brand-xyz",
      }),
    ).rejects.toThrow();

    // Should be a FormaError with INVALID_INPUT
    await expect(
      buildDesignContext(deps, {
        productId: product.id,
        requirementId: requirement.id,
        pageId,
        brandStyle: "nonexistent-brand-xyz",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("brandStyle is undefined when no brandStyle name on input or product", async () => {
    const store = await createTestStore();
    const deps = { styles: store.styles, requirements: store.requirements, products: store.products };

    // Create product WITHOUT brand_style configured (no initProductConfig)
    const product = await store.products.createProduct({
      name: "Bare App",
      description: "No config",
    });
    const req = await store.requirements.createEmptyRequirement(product.id, "Bare flow");
    await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Bare\nJust a page.",
      ui_affected: true,
      pages: [
        {
          page_id: "pg-bare",
          name: "Bare Page",
          baseline_page: "bare",
          change_type: "new",
        },
      ],
      navigation: [],
      translations: [],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: [],
    });

    const ctx = await buildDesignContext(deps, {
      productId: product.id,
      requirementId: req.id,
    });

    expect(ctx.brandStyle).toBeUndefined();
    expect(ctx.platform).toBeUndefined();
    expect(ctx.language).toBeUndefined();
  });

  it("systemStyle is resolved by name when product.system_style is set", async () => {
    const store = await createTestStore();
    const deps = { styles: store.styles, requirements: store.requirements, products: store.products };

    const product = await store.products.createProduct({
      name: "System Style App",
      description: "App with system style",
    });
    await store.products.initProductConfig(product.id, {
      platform: "web",
      brand_style: "ant",
      system_style: "shadcn-ui",
      languages: ["en"],
      default_language: "en",
    });
    const req = await store.requirements.createEmptyRequirement(product.id, "System style flow");
    await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# System style flow\nTest.",
      ui_affected: true,
      pages: [
        {
          page_id: "pg-sys",
          name: "System Page",
          baseline_page: "sys",
          change_type: "new",
        },
      ],
      navigation: [],
      translations: [],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: [],
    });

    const ctx = await buildDesignContext(deps, {
      productId: product.id,
      requirementId: req.id,
    });

    expect(ctx.systemStyle).toBeDefined();
    expect(ctx.systemStyle!.name).toBe("shadcn-ui");
    expect(ctx.systemStyle!.mode).toBe("design-system");
  });

  it("systemStyle is undefined when system style name does not match any entry", async () => {
    const store = await createTestStore();
    const deps = { styles: store.styles, requirements: store.requirements, products: store.products };
    const { product, requirement } = await seedProductAndRequirement(store);

    const ctx = await buildDesignContext(deps, {
      productId: product.id,
      requirementId: requirement.id,
      systemStyle: "nonexistent-system-style-xyz",
    });

    expect(ctx.systemStyle).toBeUndefined();
  });
});
