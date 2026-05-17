import { mkdir, readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BaselineService, RequirementService, createFormaStore, readYaml, writeYamlAtomic } from "../src/index.js";

async function createConfiguredStore() {
  const home = await mkdtemp(join(tmpdir(), "forma-requirement-"));
  const store = createFormaStore({ home, bundledStylesDir: resolve("styles") });
  const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });

  return { store, product };
}

function validSubmit(requirementId: string) {
  return {
    requirement_id: requirementId,
    document_md: "# Login\nEmail password login",
    pages: [{ page_id: `${requirementId}-login`, name: "登录页", baseline_page: "login" }],
    navigation: []
  };
}

describe("requirement and baseline services", () => {
  it("submits an empty requirement and updates baseline", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Login");

    await store.requirements.submitRequirement({
      requirement_id: req.id,
      document_md: "# Login\nEmail password login",
      pages: [{ page_id: `${req.id}-login`, name: "登录页", baseline_page: "login", design_status: "pending" }],
      navigation: []
    });

    const baseline = await store.baseline.getProductBaseline(product.id);
    expect(baseline.pages[0].id).toBe("login");
  });

  it("forces submitted page design statuses to pending", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Login");

    const submitted = await store.requirements.submitRequirement({
      requirement_id: req.id,
      document_md: "# Login\nEmail password login",
      pages: [
        { page_id: `${req.id}-login`, name: "登录页", baseline_page: "login", design_status: "done" },
        { page_id: `${req.id}-signup`, name: "注册页", baseline_page: "signup", design_status: "expired" }
      ],
      navigation: []
    });

    expect(submitted.pages).toEqual([
      expect.objectContaining({ page_id: `${req.id}-login`, design_status: "pending" }),
      expect.objectContaining({ page_id: `${req.id}-signup`, design_status: "pending" })
    ]);
    await expect(store.requirements.getRequirement({ requirement_id: req.id })).resolves.toMatchObject({
      pages: [
        expect.objectContaining({ page_id: `${req.id}-login`, design_status: "pending" }),
        expect.objectContaining({ page_id: `${req.id}-signup`, design_status: "pending" })
      ]
    });
  });

  it("blocks submit when requirement is not empty", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Login");

    await store.requirements.submitRequirement(validSubmit(req.id));

    await expect(store.requirements.submitRequirement(validSubmit(req.id))).rejects.toMatchObject({
      code: "REQUIREMENT_STATUS_INVALID"
    });
  });

  it("validates product, document, pages, and missing requirements", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Login");

    await expect(store.requirements.createEmptyRequirement("P-missing", "Login")).rejects.toMatchObject({
      code: "PRODUCT_NOT_FOUND"
    });
    await expect(
      store.requirements.submitRequirement({ ...validSubmit(req.id), document_md: "   \n\t" })
    ).rejects.toMatchObject({ code: "DOCUMENT_EMPTY" });
    await expect(store.requirements.submitRequirement({ ...validSubmit(req.id), pages: [] })).rejects.toMatchObject({
      code: "PAGES_EMPTY"
    });
    await expect(store.requirements.getRequirement({ requirement_id: "R-00000000" })).rejects.toMatchObject({
      code: "REQUIREMENT_NOT_FOUND"
    });
  });

  it("rejects invalid requirement ids without reading outside requirement paths", async () => {
    const { store, product } = await createConfiguredStore();
    await writeYamlAtomic(join(store.home, "outside", "requirement.yaml"), {
      id: "R-aaaaaaaa",
      product_id: product.id,
      title: "Outside",
      status: "submitted",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      pages: [],
      navigation: []
    });

    await expect(store.requirements.getRequirement({ requirement_id: "../../outside" })).rejects.toMatchObject({
      code: "REQUIREMENT_NOT_FOUND"
    });
    await expect(
      store.requirements.submitRequirement({
        requirement_id: "../../outside",
        document_md: "",
        pages: [],
        navigation: []
      })
    ).rejects.toMatchObject({ code: "REQUIREMENT_NOT_FOUND" });
    await expect(
      store.requirements.updateRequirement({
        requirement_id: "../../outside",
        document_md: "",
        pages: [],
        expired_pages: [],
        navigation: []
      })
    ).rejects.toMatchObject({ code: "REQUIREMENT_NOT_FOUND" });
  });

  it("rejects requirement files whose id or product do not match the requested path", async () => {
    const { store, product } = await createConfiguredStore();
    const otherProduct = await store.products.createProduct({ name: "Other App", description: "Other mobile shop" });
    await writeYamlAtomic(join(store.home, "data", product.id, "R-11111111", "requirement.yaml"), {
      id: "R-22222222",
      product_id: product.id,
      title: "Wrong ID",
      status: "empty",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      pages: [],
      navigation: []
    });

    await expect(store.requirements.getRequirement({ requirement_id: "R-11111111" })).rejects.toMatchObject({
      code: "REQUIREMENT_NOT_FOUND"
    });

    await writeYamlAtomic(join(store.home, "data", product.id, "R-33333333", "requirement.yaml"), {
      id: "R-33333333",
      product_id: otherProduct.id,
      title: "Wrong Product",
      status: "empty",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      pages: [],
      navigation: []
    });

    await expect(store.requirements.getRequirement({ requirement_id: "R-33333333" })).rejects.toMatchObject({
      code: "REQUIREMENT_NOT_FOUND"
    });
  });

  it("validates update document and pages", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Login");
    await store.requirements.submitRequirement(validSubmit(req.id));

    await expect(
      store.requirements.updateRequirement({
        requirement_id: req.id,
        document_md: "   ",
        pages: [{ page_id: `${req.id}-login`, name: "登录页", baseline_page: "login" }],
        expired_pages: [],
        navigation: []
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_EMPTY" });
    await expect(
      store.requirements.updateRequirement({
        requirement_id: req.id,
        document_md: "# Login\nUpdated",
        pages: [],
        expired_pages: [],
        navigation: []
      })
    ).rejects.toMatchObject({ code: "PAGES_EMPTY" });
  });

  it("normalizes update page statuses from current state and expired pages", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Profile");
    await store.requirements.submitRequirement({
      requirement_id: req.id,
      document_md: "# Profile\nEdit profile",
      pages: [
        { page_id: `${req.id}-profile`, name: "资料页", baseline_page: "profile" },
        { page_id: `${req.id}-avatar`, name: "头像页", baseline_page: "avatar" }
      ],
      navigation: []
    });
    const saved = await readYaml<Record<string, unknown>>(
      join(store.home, "data", product.id, req.id, "requirement.yaml")
    );
    await writeYamlAtomic(join(store.home, "data", product.id, req.id, "requirement.yaml"), {
      ...saved,
      pages: [
        { page_id: `${req.id}-profile`, name: "资料页", baseline_page: "profile", design_status: "done" },
        { page_id: `${req.id}-avatar`, name: "头像页", baseline_page: "avatar", design_status: "done" }
      ]
    });

    const updated = await store.requirements.updateRequirement({
      requirement_id: req.id,
      document_md: "# Profile\nUpdated profile",
      pages: [
        { page_id: `${req.id}-profile`, name: "资料页", baseline_page: "profile", design_status: "expired" },
        { page_id: `${req.id}-avatar`, name: "头像页", baseline_page: "avatar", design_status: "done" },
        { page_id: `${req.id}-security`, name: "安全页", baseline_page: "security", design_status: "done" },
        { page_id: `${req.id}-audit`, name: "审计页", baseline_page: "audit", design_status: "expired" }
      ],
      expired_pages: [`${req.id}-avatar`],
      navigation: []
    });

    expect(updated.pages).toEqual([
      expect.objectContaining({ page_id: `${req.id}-profile`, design_status: "done" }),
      expect.objectContaining({ page_id: `${req.id}-avatar`, design_status: "expired" }),
      expect.objectContaining({ page_id: `${req.id}-security`, design_status: "pending" }),
      expect.objectContaining({ page_id: `${req.id}-audit`, design_status: "pending" })
    ]);
  });

  it("updates requirements, marks expired pages, and cleans up removed baseline pages", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Checkout");
    await store.requirements.submitRequirement({
      requirement_id: req.id,
      document_md: "# Checkout\nCart checkout",
      pages: [
        {
          page_id: `${req.id}-cart`,
          name: "购物车",
          baseline_page: "cart",
          features: "Items",
          copy: "Cart copy",
          fields: "Quantity",
          interactions: "Update item"
        },
        { page_id: `${req.id}-pay`, name: "支付页", baseline_page: "pay" }
      ],
      navigation: [{ from: `${req.id}-cart`, to: `${req.id}-pay`, label: "Pay" }]
    });

    await store.requirements.updateRequirement({
      requirement_id: req.id,
      document_md: "# Checkout\nCard checkout",
      pages: [
        {
          page_id: `${req.id}-cart`,
          name: "购物车",
          baseline_page: "cart",
          features: "Updated items",
          copy: "Updated cart copy",
          fields: "Coupon",
          interactions: "Apply coupon"
        },
        { page_id: `${req.id}-success`, name: "成功页", baseline_page: "success" }
      ],
      expired_pages: [`${req.id}-pay`],
      navigation: [{ from: `${req.id}-cart`, to: `${req.id}-success`, label: "Success" }]
    });

    const requirement = await store.requirements.getRequirement({ requirement_id: req.id });
    expect(requirement.pages).toEqual([
      expect.objectContaining({
        page_id: `${req.id}-cart`,
        baseline_page: "cart",
        design_status: "pending",
        features: "Updated items"
      }),
      expect.objectContaining({ page_id: `${req.id}-success`, baseline_page: "success", design_status: "pending" }),
      expect.objectContaining({ page_id: `${req.id}-pay`, baseline_page: "pay", design_status: "expired" })
    ]);

    const baseline = await store.baseline.getProductBaseline(product.id);
    expect(baseline.pages).toEqual([
      expect.objectContaining({
        id: "cart",
        name: "购物车",
        features: "Updated items",
        copy: "Updated cart copy",
        fields: "Coupon",
        interactions: "Apply coupon",
        source_requirements: [req.id]
      }),
      expect.objectContaining({ id: "success", source_requirements: [req.id] })
    ]);
    expect(baseline.pages.map((page) => page.id)).not.toContain("pay");
    expect(baseline.navigation).toEqual([{ from: "cart", to: "success", label: "Success" }]);
  });

  it("drops baseline navigation edges that do not resolve to active pages", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Checkout");
    await store.requirements.submitRequirement({
      requirement_id: req.id,
      document_md: "# Checkout\nCart checkout",
      pages: [
        { page_id: `${req.id}-cart`, name: "购物车", baseline_page: "cart" },
        { page_id: `${req.id}-pay`, name: "支付页", baseline_page: "pay" }
      ],
      navigation: [{ from: `${req.id}-cart`, to: `${req.id}-pay`, label: "Pay" }]
    });

    await store.requirements.updateRequirement({
      requirement_id: req.id,
      document_md: "# Checkout\nCart only",
      pages: [{ page_id: `${req.id}-cart`, name: "购物车", baseline_page: "cart" }],
      expired_pages: [`${req.id}-pay`],
      navigation: [
        { from: `${req.id}-cart`, to: `${req.id}-pay`, label: "Stale Pay" },
        { from: `${req.id}-missing`, to: `${req.id}-cart`, label: "Missing Cart" },
        { from: `${req.id}-cart`, to: `${req.id}-cart`, label: "Stay" }
      ]
    });

    const baseline = await store.baseline.getProductBaseline(product.id);
    expect(baseline.navigation).toEqual([{ from: "cart", to: "cart", label: "Stay" }]);
  });

  it("does not advance requirement or document writes when baseline update fails", async () => {
    const { store, product } = await createConfiguredStore();
    const requirements = new RequirementService({
      home: store.home,
      products: store.products,
      baseline: {
        updateFromRequirement: async () => {
          throw new Error("baseline failed");
        }
      } as BaselineService
    });
    const req = await requirements.createEmptyRequirement(product.id, "Login");

    await expect(requirements.submitRequirement(validSubmit(req.id))).rejects.toThrow("baseline failed");

    await expect(store.requirements.getRequirement({ requirement_id: req.id })).resolves.toMatchObject({
      status: "empty",
      document_md: ""
    });
    await expect(readFile(join(store.home, "data", product.id, req.id, "document.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("deduplicates baseline source requirements when the same requirement updates a page", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Login");
    await store.requirements.submitRequirement(validSubmit(req.id));
    await store.requirements.updateRequirement({
      requirement_id: req.id,
      document_md: "# Login\nMagic link login",
      pages: [{ page_id: `${req.id}-login`, name: "登录页", baseline_page: "login" }],
      expired_pages: [],
      navigation: []
    });

    const baseline = await store.baseline.getProductBaseline(product.id);
    expect(baseline.pages[0].source_requirements).toEqual([req.id]);
  });

  it("archives only active requirements", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Login");

    await expect(store.requirements.archiveRequirement(req.id)).rejects.toMatchObject({
      code: "REQUIREMENT_STATUS_INVALID"
    });

    await store.requirements.submitRequirement(validSubmit(req.id));
    await expect(store.requirements.archiveRequirement(req.id)).rejects.toMatchObject({
      code: "REQUIREMENT_STATUS_INVALID"
    });

    const saved = await readYaml<Record<string, unknown>>(
      join(store.home, "data", product.id, req.id, "requirement.yaml")
    );
    await writeYamlAtomic(join(store.home, "data", product.id, req.id, "requirement.yaml"), {
      ...saved,
      status: "active"
    });

    await expect(store.requirements.archiveRequirement(req.id)).resolves.toMatchObject({ status: "archived" });
  });

  it("returns latest requirements by created_at and includes document history", async () => {
    const { store, product } = await createConfiguredStore();
    const first = await store.requirements.createEmptyRequirement(product.id, "First");
    const second = await store.requirements.createEmptyRequirement(product.id, "Second");

    const firstYaml = await readYaml<Record<string, unknown>>(
      join(store.home, "data", product.id, first.id, "requirement.yaml")
    );
    const secondYaml = await readYaml<Record<string, unknown>>(
      join(store.home, "data", product.id, second.id, "requirement.yaml")
    );
    await writeYamlAtomic(join(store.home, "data", product.id, first.id, "requirement.yaml"), {
      ...firstYaml,
      created_at: "2026-01-01T00:00:00.000Z"
    });
    await writeYamlAtomic(join(store.home, "data", product.id, second.id, "requirement.yaml"), {
      ...secondYaml,
      created_at: "2026-01-02T00:00:00.000Z"
    });
    await store.requirements.submitRequirement({
      requirement_id: second.id,
      document_md: "# Second\nLatest document",
      pages: [{ page_id: `${second.id}-home`, name: "首页", baseline_page: "home" }],
      navigation: []
    });

    await expect(store.requirements.getLatestRequirement(product.id)).resolves.toMatchObject({ id: second.id });
    await expect(store.requirements.getRequirement({ product_id: product.id })).resolves.toMatchObject({
      id: second.id,
      document_md: "# Second\nLatest document"
    });

    const history = await store.requirements.getRequirementHistory(product.id);
    expect(history).toEqual([
      expect.objectContaining({ id: first.id, document_md: "" }),
      expect.objectContaining({ id: second.id, document_md: "# Second\nLatest document" })
    ]);
  });

  it("ignores mismatched requirement records in product latest and history reads", async () => {
    const { store, product } = await createConfiguredStore();
    const otherProduct = await store.products.createProduct({ name: "Other App", description: "Other mobile shop" });
    const valid = await store.requirements.createEmptyRequirement(product.id, "Valid");
    await store.requirements.submitRequirement({
      requirement_id: valid.id,
      document_md: "# Valid\nMatched document",
      pages: [{ page_id: `${valid.id}-home`, name: "首页", baseline_page: "home" }],
      navigation: []
    });
    const validFile = join(store.home, "data", product.id, valid.id, "requirement.yaml");
    await writeYamlAtomic(validFile, {
      ...(await readYaml<Record<string, unknown>>(validFile)),
      created_at: "2026-01-01T00:00:00.000Z"
    });

    await writeYamlAtomic(join(store.home, "data", product.id, "R-11111111", "requirement.yaml"), {
      id: "R-99999999",
      product_id: product.id,
      title: "Wrong ID",
      status: "submitted",
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
      pages: [],
      navigation: []
    });
    await writeYamlAtomic(join(store.home, "data", product.id, "R-22222222", "requirement.yaml"), {
      id: "R-22222222",
      product_id: otherProduct.id,
      title: "Wrong Product",
      status: "submitted",
      created_at: "2026-01-04T00:00:00.000Z",
      updated_at: "2026-01-04T00:00:00.000Z",
      pages: [],
      navigation: []
    });
    await mkdir(join(store.home, "data", otherProduct.id, "R-22222222"), { recursive: true });
    await writeFile(join(store.home, "data", otherProduct.id, "R-22222222", "document.md"), "# Wrong Product\nPoison\n");

    await expect(store.requirements.getLatestRequirement(product.id)).resolves.toMatchObject({ id: valid.id });
    await expect(store.requirements.getRequirement({ product_id: product.id })).resolves.toMatchObject({
      id: valid.id,
      document_md: "# Valid\nMatched document"
    });

    const history = await store.requirements.getRequirementHistory(product.id);
    expect(history).toEqual([expect.objectContaining({ id: valid.id, document_md: "# Valid\nMatched document" })]);
    expect(history.map((requirement) => requirement.document_md)).not.toContain("# Wrong ID\nPoison\n");
    expect(history.map((requirement) => requirement.document_md)).not.toContain("# Wrong Product\nPoison\n");
  });

  it("rejects persisted requirement and baseline YAML with unknown keys", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Login");
    await store.requirements.submitRequirement(validSubmit(req.id));

    const requirementFile = join(store.home, "data", product.id, req.id, "requirement.yaml");
    await writeYamlAtomic(requirementFile, {
      ...(await readYaml<Record<string, unknown>>(requirementFile)),
      unexpected: true
    });
    await expect(store.requirements.getRequirement({ requirement_id: req.id })).rejects.toThrow();

    const baselineFile = join(store.home, "data", product.id, "baseline", "baseline.yaml");
    await writeYamlAtomic(baselineFile, {
      ...(await readYaml<Record<string, unknown>>(baselineFile)),
      unexpected: true
    });
    await expect(store.baseline.getProductBaseline(product.id)).rejects.toThrow();
  });
});
