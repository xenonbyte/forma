import { access, mkdir, readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BaselineService,
  RequirementService,
  createFormaStore,
  readYaml,
  writeYamlAtomic,
  type CopyByPage,
  type CopyService,
  type PageTranslation
} from "../src/index.js";

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

async function configureLanguages(
  home: string,
  productId: string,
  languages: string[],
  defaultLanguage = languages[0] ?? "zh-CN"
) {
  const productFile = join(home, "data", productId, "product.yaml");
  await writeYamlAtomic(productFile, {
    ...(await readYaml<Record<string, unknown>>(productFile)),
    languages,
    default_language: defaultLanguage
  });
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(file: string): Promise<string | undefined> {
  return (await fileExists(file)) ? readFile(file, "utf8") : undefined;
}

async function markRequirementPagesDone(
  home: string,
  productId: string,
  requirementId: string,
  designIdsByPageId: Record<string, string>
) {
  const requirementFile = join(home, "data", productId, requirementId, "requirement.yaml");
  const saved = await readYaml<Record<string, unknown>>(requirementFile);
  const pages = (saved.pages as Array<Record<string, unknown>>).map((page) => ({
    ...page,
    design_status: "done",
    design_id: designIdsByPageId[String(page.page_id)]
  }));
  await writeYamlAtomic(requirementFile, { ...saved, pages });
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

  it("reads stored product rules from the baseline rules file", async () => {
    const { store, product } = await createConfiguredStore();
    await writeYamlAtomic(join(store.home, "data", product.id, "baseline", "rules.yaml"), {
      rules: [
        {
          id: "R-12345678-rule-001",
          source_requirement: "R-12345678",
          given: "用户在登录页",
          when: "点击登录",
          then: "进入首页"
        }
      ]
    });

    await expect(store.requirements.getProductRules(product.id)).resolves.toEqual([
      expect.objectContaining({
        id: "R-12345678-rule-001",
        source_requirement: "R-12345678",
        given: "用户在登录页",
        when: "点击登录",
        then: "进入首页"
      })
    ]);
  });

  it("returns an empty rule list when the baseline rules file is missing", async () => {
    const { store, product } = await createConfiguredStore();

    await expect(store.requirements.getProductRules(product.id)).resolves.toEqual([]);
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
          copy: [{ context: "cart_title", text: "购物车" }],
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
          copy: [{ context: "cart_title", text: "购物车" }],
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
    expect(baseline.pages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "cart",
        name: "购物车",
        features: "Updated items",
        copy: [{ context: "cart_title", text: "购物车" }],
        fields: "Coupon",
        interactions: "Apply coupon",
        source_requirements: [req.id]
      }),
      expect.objectContaining({ id: "success", source_requirements: [req.id] }),
      expect.objectContaining({ id: "pay", source_requirements: [req.id] })
    ]));
    expect(baseline.pages.map((page) => page.id).sort()).toEqual(["cart", "pay", "success"]);
    expect(baseline.pages.find((page) => page.id === "cart")?.copy).toEqual([
      { context: "cart_title", text: "购物车" }
    ]);
    expect(baseline.navigation).toEqual([{ from: "cart", to: "success", label: "Success" }]);
  });

  it("drops baseline navigation edges that do not resolve to requirement pages", async () => {
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
    expect(baseline.navigation).toEqual([
      { from: "cart", to: "pay", label: "Stale Pay" },
      { from: "cart", to: "cart", label: "Stay" }
    ]);
  });

  it("does not advance requirement or document writes when baseline update fails", async () => {
    const { store, product } = await createConfiguredStore();
    const requirements = new RequirementService({
      home: store.home,
      products: store.products,
      copy: store.copy,
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

  it("rolls back baseline changes when submit fails after baseline update", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Login");
    store.requirements.setTestHooksForUnitTests({
      async afterBaselineUpdate() {
        throw new Error("document write failed");
      }
    });

    await expect(store.requirements.submitRequirement(validSubmit(req.id))).rejects.toThrow("document write failed");

    await expect(store.baseline.getProductBaseline(product.id)).resolves.toEqual({
      product_id: product.id,
      pages: [],
      navigation: []
    });
    await expect(readFile(join(store.home, "data", product.id, req.id, "document.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(store.requirements.getRequirement({ requirement_id: req.id })).resolves.toMatchObject({
      status: "empty",
      document_md: ""
    });
  });

  it("rolls back baseline and document changes when update metadata write fails", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Login");
    await store.requirements.submitRequirement(validSubmit(req.id));
    store.requirements.setTestHooksForUnitTests({
      async afterDocumentWrite() {
        throw new Error("metadata write failed");
      }
    });

    await expect(
      store.requirements.updateRequirement({
        requirement_id: req.id,
        document_md: "# Login\nUpdated document",
        pages: [{ page_id: `${req.id}-login`, name: "Updated Login", baseline_page: "login-updated" }],
        expired_pages: [`${req.id}-login`],
        navigation: []
      })
    ).rejects.toThrow("metadata write failed");

    await expect(store.requirements.getRequirement({ requirement_id: req.id })).resolves.toMatchObject({
      status: "submitted",
      document_md: "# Login\nEmail password login",
      pages: [expect.objectContaining({ page_id: `${req.id}-login`, baseline_page: "login" })]
    });
    const baseline = await store.baseline.getProductBaseline(product.id);
    expect(baseline.pages).toEqual([expect.objectContaining({ id: "login", name: "登录页" })]);
    expect(baseline.pages.map((page) => page.id)).not.toContain("login-updated");
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

  it("creates empty requirements with ui_affected true and reads legacy requirements with the same default", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Login");
    const requirementFile = join(store.home, "data", product.id, req.id, "requirement.yaml");

    await expect(readYaml<Record<string, unknown>>(requirementFile)).resolves.toMatchObject({
      ui_affected: true
    });

    const saved = await readYaml<Record<string, unknown>>(requirementFile);
    const { ui_affected: _uiAffected, ...legacy } = saved;
    await writeYamlAtomic(requirementFile, legacy);

    await expect(store.requirements.getRequirement({ requirement_id: req.id })).resolves.toMatchObject({
      ui_affected: true
    });
  });

  it("saves an empty UI requirement by marking all pages pending and writing translations", async () => {
    const { store, product } = await createConfiguredStore();
    await configureLanguages(store.home, product.id, ["zh-CN", "en"], "zh-CN");
    const req = await store.requirements.createEmptyRequirement(product.id, "Login");

    const saved = await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Login\n\n## 页面\n新增手机号登录",
      ui_affected: true,
      pages: [
        {
          page_id: "login",
          name: "登录页",
          baseline_page: "login",
          change_type: "new",
          change_summary: "新增手机号登录",
          copy: [{ context: "phone_tab", text: "手机号登录" }]
        }
      ],
      navigation: [{ from: "login", to: "home", label: "登录成功" }],
      translations: [
        { page_id: "login", entries: [{ context: "phone_tab", texts: { en: "Phone Login" } }] }
      ],
      rules: [{ id: "rule-001", page_id: "login", given: "用户在登录页", when: "切换手机号", then: "显示手机号登录表单" }],
      remove_rule_ids: [],
      remove_page_ids: []
    });

    expect(saved).toMatchObject({
      status: "submitted",
      ui_affected: true,
      pages: [expect.objectContaining({ page_id: "login", design_status: "pending" })]
    });
    await expect(store.copy.getTranslations(product.id, req.id)).resolves.toEqual([
      { page_id: "login", entries: [{ context: "phone_tab", texts: { en: "Phone Login" } }] }
    ]);
  });

  it("updates submitted UI requirements by preserving unchanged pages, expiring changed pages, and replacing navigation", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Checkout");
    await store.requirements.submitRequirement({
      requirement_id: req.id,
      document_md: "# Checkout\nInitial",
      pages: [
        { page_id: "cart", name: "购物车", baseline_page: "cart" },
        { page_id: "pay", name: "支付页", baseline_page: "pay" },
        { page_id: "profile", name: "资料页", baseline_page: "profile" }
      ],
      navigation: [{ from: "cart", to: "pay", label: "Pay" }]
    });
    const requirementFile = join(store.home, "data", product.id, req.id, "requirement.yaml");
    await writeYamlAtomic(requirementFile, {
      ...(await readYaml<Record<string, unknown>>(requirementFile)),
      pages: [
        { page_id: "cart", name: "购物车", baseline_page: "cart", design_status: "done", design_id: "D-11111111" },
        { page_id: "pay", name: "支付页", baseline_page: "pay", design_status: "done", design_id: "D-22222222" },
        { page_id: "profile", name: "资料页", baseline_page: "profile", design_status: "done", design_id: "D-33333333" }
      ]
    });

    const saved = await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Checkout\nUpdated",
      ui_affected: true,
      pages: [
        { page_id: "cart", name: "购物车", baseline_page: "cart", change_type: "patch", change_summary: "Coupon" },
        { page_id: "success", name: "成功页", baseline_page: "success", change_type: "new" },
        { page_id: "pay", name: "支付页", baseline_page: "pay", change_type: "rebuild" }
      ],
      navigation: [{ from: "cart", to: "success", label: "Done" }],
      translations: [],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });

    expect(saved.pages).toEqual([
      expect.objectContaining({ page_id: "cart", design_status: "expired", design_id: "D-11111111" }),
      expect.objectContaining({ page_id: "success", design_status: "pending" }),
      expect.objectContaining({ page_id: "pay", design_status: "expired", design_id: "D-22222222" }),
      expect.objectContaining({ page_id: "profile", design_status: "done", design_id: "D-33333333" })
    ]);
    expect(saved.navigation).toEqual([{ from: "cart", to: "success", label: "Done" }]);
  });

  it("persists change summaries for new, patch, and rebuild saves", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Summaries");

    await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Summaries\nInitial",
      ui_affected: true,
      pages: [
        { page_id: "cart", name: "购物车", baseline_page: "cart", change_type: "new", change_summary: "Create cart" },
        { page_id: "pay", name: "支付页", baseline_page: "pay", change_type: "new", change_summary: "Create pay" }
      ],
      navigation: [],
      translations: [],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });

    await expect(store.requirements.getRequirement({ requirement_id: req.id })).resolves.toMatchObject({
      pages: [
        expect.objectContaining({ page_id: "cart", change_summary: "Create cart" }),
        expect.objectContaining({ page_id: "pay", change_summary: "Create pay" })
      ]
    });

    const requirementFile = join(store.home, "data", product.id, req.id, "requirement.yaml");
    await writeYamlAtomic(requirementFile, {
      ...(await readYaml<Record<string, unknown>>(requirementFile)),
      pages: [
        {
          page_id: "cart",
          name: "购物车",
          baseline_page: "cart",
          design_status: "done",
          design_id: "D-11111111",
          change_type: "new",
          change_summary: "Create cart"
        },
        {
          page_id: "pay",
          name: "支付页",
          baseline_page: "pay",
          design_status: "done",
          design_id: "D-22222222",
          change_type: "new",
          change_summary: "Create pay"
        }
      ]
    });

    const saved = await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Summaries\nUpdated",
      ui_affected: true,
      pages: [
        { page_id: "cart", name: "购物车", baseline_page: "cart", change_type: "patch", change_summary: "Patch cart" },
        { page_id: "pay", name: "支付页", baseline_page: "pay", change_type: "rebuild", change_summary: "Rebuild pay" }
      ],
      navigation: [],
      translations: [],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });

    expect(saved.pages).toEqual([
      expect.objectContaining({
        page_id: "cart",
        design_status: "expired",
        design_id: "D-11111111",
        change_summary: "Patch cart"
      }),
      expect.objectContaining({
        page_id: "pay",
        design_status: "expired",
        design_id: "D-22222222",
        change_summary: "Rebuild pay"
      })
    ]);
    await expect(store.requirements.getRequirement({ requirement_id: req.id })).resolves.toMatchObject({
      pages: [
        expect.objectContaining({ page_id: "cart", change_summary: "Patch cart" }),
        expect.objectContaining({ page_id: "pay", change_summary: "Rebuild pay" })
      ]
    });
  });

  it("clears old design ids when an existing page is saved as new", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Reset Page");
    await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Reset\nInitial",
      ui_affected: true,
      pages: [{ page_id: "checkout", name: "结账页", baseline_page: "checkout", change_type: "new" }],
      navigation: [],
      translations: [],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });
    const requirementFile = join(store.home, "data", product.id, req.id, "requirement.yaml");
    await writeYamlAtomic(requirementFile, {
      ...(await readYaml<Record<string, unknown>>(requirementFile)),
      pages: [
        {
          page_id: "checkout",
          name: "结账页",
          baseline_page: "checkout",
          design_status: "done",
          design_id: "D-11111111"
        }
      ]
    });

    const saved = await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Reset\nNew flow",
      ui_affected: true,
      pages: [
        {
          page_id: "checkout",
          name: "新结账页",
          baseline_page: "checkout",
          change_type: "new",
          change_summary: "Replace checkout"
        }
      ],
      navigation: [],
      translations: [],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });

    expect(saved.pages).toEqual([
      expect.not.objectContaining({ design_id: "D-11111111" })
    ]);
    expect(saved.pages[0]).toMatchObject({
      page_id: "checkout",
      design_status: "pending",
      change_summary: "Replace checkout"
    });
    expect(saved.pages[0]).not.toHaveProperty("design_id");
  });

  it("rejects patch for missing pages without mutating saved files", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Missing Patch");
    await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Missing Patch\nInitial",
      ui_affected: true,
      pages: [{ page_id: "keep", name: "保留", baseline_page: "keep", change_type: "new" }],
      navigation: [],
      translations: [],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });
    const files = [
      join(store.home, "data", product.id, req.id, "requirement.yaml"),
      join(store.home, "data", product.id, req.id, "document.md"),
      join(store.home, "data", product.id, "baseline", "baseline.yaml")
    ];
    const before = await Promise.all(files.map(readTextIfExists));

    await expect(
      store.requirements.saveRequirement({
        requirement_id: req.id,
        document_md: "# Missing Patch\nInvalid",
        ui_affected: true,
        pages: [{ page_id: "missing", name: "缺失", baseline_page: "missing", change_type: "patch" }],
        navigation: [],
        translations: [],
        rules: [],
        remove_rule_ids: [],
        remove_page_ids: []
      })
    ).rejects.toMatchObject({
      code: "PAGE_NOT_DONE",
      details: { requirement_id: req.id, page_id: "missing", change_type: "patch" }
    });
    await expect(Promise.all(files.map(readTextIfExists))).resolves.toEqual(before);
  });

  it("rejects patch and rebuild for existing pages without a design id", async () => {
    for (const changeType of ["patch", "rebuild"] as const) {
      const { store, product } = await createConfiguredStore();
      const req = await store.requirements.createEmptyRequirement(product.id, `${changeType} No Design`);
      await store.requirements.saveRequirement({
        requirement_id: req.id,
        document_md: `# ${changeType}\nInitial`,
        ui_affected: true,
        pages: [{ page_id: "profile", name: "资料页", baseline_page: "profile", change_type: "new" }],
        navigation: [],
        translations: [],
        rules: [],
        remove_rule_ids: [],
        remove_page_ids: []
      });
      const files = [
        join(store.home, "data", product.id, req.id, "requirement.yaml"),
        join(store.home, "data", product.id, req.id, "document.md"),
        join(store.home, "data", product.id, "baseline", "baseline.yaml")
      ];
      const before = await Promise.all(files.map(readTextIfExists));

      await expect(
        store.requirements.saveRequirement({
          requirement_id: req.id,
          document_md: `# ${changeType}\nInvalid`,
          ui_affected: true,
          pages: [{ page_id: "profile", name: "资料页", baseline_page: "profile", change_type: changeType }],
          navigation: [],
          translations: [],
          rules: [],
          remove_rule_ids: [],
          remove_page_ids: []
        })
      ).rejects.toMatchObject({
        code: "PAGE_NOT_DONE",
        details: { requirement_id: req.id, page_id: "profile", change_type: changeType }
      });
      await expect(Promise.all(files.map(readTextIfExists))).resolves.toEqual(before);
    }
  });

  it("moves active UI requirements back to submitted when a UI save expires a page", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Profile");
    await store.requirements.submitRequirement({
      requirement_id: req.id,
      document_md: "# Profile\nInitial",
      pages: [{ page_id: "profile", name: "资料页", baseline_page: "profile" }],
      navigation: []
    });
    await markRequirementPagesDone(store.home, product.id, req.id, { profile: "D-11111111" });
    const requirementFile = join(store.home, "data", product.id, req.id, "requirement.yaml");
    await writeYamlAtomic(requirementFile, { ...(await readYaml<Record<string, unknown>>(requirementFile)), status: "active" });

    const saved = await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Profile\nUpdated",
      ui_affected: true,
      pages: [{ page_id: "profile", name: "资料页", baseline_page: "profile", change_type: "patch" }],
      navigation: [],
      translations: [],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });

    expect(saved).toMatchObject({
      status: "submitted",
      pages: [expect.objectContaining({ page_id: "profile", design_status: "expired" })]
    });
    await expect(store.requirements.getRequirement({ requirement_id: req.id })).resolves.toMatchObject({
      status: "submitted",
      pages: [expect.objectContaining({ page_id: "profile", design_status: "expired" })]
    });
  });

  it("saves logic-only requirements without changing pages, baseline, or pending status", async () => {
    const { store, product } = await createConfiguredStore();
    await configureLanguages(store.home, product.id, ["zh-CN", "en"], "zh-CN");
    const req = await store.requirements.createEmptyRequirement(product.id, "Rules");
    await store.requirements.submitRequirement(validSubmit(req.id));
    const requirementBefore = await store.requirements.getRequirement({ requirement_id: req.id });
    await store.copy.saveTranslations(product.id, req.id, [
      { page_id: `${req.id}-login`, entries: [{ context: "title", texts: { en: "Login" } }] }
    ]);
    const baselineBefore = await store.baseline.getProductBaseline(product.id);
    const pagesBefore = requirementBefore.pages;
    const navigationBefore = requirementBefore.navigation;
    const translationsBefore = await store.copy.getTranslations(product.id, req.id);

    const saved = await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Rules\nUpdated logic only",
      ui_affected: false,
      pages: [],
      navigation: [{ from: "ignored", to: "ignored" }],
      translations: [],
      rules: [{ id: "rule-logic", given: "用户打开登录页", when: "输入邮箱", then: "可以继续" }],
      remove_rule_ids: [],
      remove_page_ids: []
    });

    expect(saved.status).toBe("submitted");
    expect(saved.pages).toEqual(pagesBefore);
    expect(saved.navigation).toEqual(navigationBefore);
    await expect(store.requirements.getRequirement({ requirement_id: req.id })).resolves.toMatchObject({
      document_md: "# Rules\nUpdated logic only",
      pages: pagesBefore,
      navigation: navigationBefore
    });
    await expect(store.baseline.getProductBaseline(product.id)).resolves.toEqual(baselineBefore);
    await expect(store.copy.getTranslations(product.id, req.id)).resolves.toEqual(translationsBefore);
    await expect(store.requirements.getProductRules(product.id)).resolves.toEqual([
      expect.objectContaining({ id: `${req.id}-rule-logic`, source_requirement: req.id })
    ]);
  });

  it("promotes logic-only saves to active when no pages or every page is done", async () => {
    const { store, product } = await createConfiguredStore();
    const empty = await store.requirements.createEmptyRequirement(product.id, "No UI");

    await expect(
      store.requirements.saveRequirement({
        requirement_id: empty.id,
        document_md: "# No UI\nRules only",
        ui_affected: false,
        pages: [],
        navigation: [],
        translations: [],
        rules: [],
        remove_rule_ids: [],
        remove_page_ids: []
      })
    ).resolves.toMatchObject({ status: "active" });

    const req = await store.requirements.createEmptyRequirement(product.id, "Done UI");
    await store.requirements.submitRequirement(validSubmit(req.id));
    const requirementFile = join(store.home, "data", product.id, req.id, "requirement.yaml");
    await writeYamlAtomic(requirementFile, {
      ...(await readYaml<Record<string, unknown>>(requirementFile)),
      pages: [{ page_id: `${req.id}-login`, name: "登录页", baseline_page: "login", design_status: "done" }]
    });

    await expect(
      store.requirements.saveRequirement({
        requirement_id: req.id,
        document_md: "# Done UI\nRules only",
        ui_affected: false,
        pages: [],
        navigation: [],
        translations: [],
        rules: [],
        remove_rule_ids: [],
        remove_page_ids: []
      })
    ).resolves.toMatchObject({ status: "active" });
  });

  it("preserves logic-only status when any page is pending or expired", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Mixed UI");
    await store.requirements.submitRequirement(validSubmit(req.id));
    const requirementFile = join(store.home, "data", product.id, req.id, "requirement.yaml");
    await writeYamlAtomic(requirementFile, {
      ...(await readYaml<Record<string, unknown>>(requirementFile)),
      status: "active",
      pages: [
        { page_id: `${req.id}-login`, name: "登录页", baseline_page: "login", design_status: "done" },
        { page_id: `${req.id}-legacy`, name: "旧页", baseline_page: "legacy", design_status: "expired" }
      ]
    });

    await expect(
      store.requirements.saveRequirement({
        requirement_id: req.id,
        document_md: "# Mixed UI\nRules only",
        ui_affected: false,
        pages: [],
        navigation: [],
        translations: [],
        rules: [],
        remove_rule_ids: [],
        remove_page_ids: []
      })
    ).resolves.toMatchObject({ status: "active" });
  });

  it("replaces a requirement's saved rules instead of duplicating them", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Rules");

    const input = {
      requirement_id: req.id,
      document_md: "# Rules\nInitial",
      ui_affected: false,
      pages: [],
      navigation: [],
      translations: [],
      rules: [{ id: "rule-001", given: "G", when: "W", then: "T" }],
      remove_rule_ids: [],
      remove_page_ids: []
    };
    await store.requirements.saveRequirement(input);
    await store.requirements.saveRequirement({
      ...input,
      document_md: "# Rules\nUpdated",
      rules: [{ id: "rule-002", given: "G2", when: "W2", then: "T2" }]
    });

    await expect(store.requirements.getProductRules(product.id)).resolves.toEqual([
      expect.objectContaining({ id: `${req.id}-rule-002`, source_requirement: req.id })
    ]);
  });

  it("removes replaced and explicitly removed rules from other requirements", async () => {
    const { store, product } = await createConfiguredStore();
    const first = await store.requirements.createEmptyRequirement(product.id, "First");
    const second = await store.requirements.createEmptyRequirement(product.id, "Second");
    await writeYamlAtomic(join(store.home, "data", product.id, "baseline", "rules.yaml"), {
      rules: [
        { id: "legacy-replace", source_requirement: first.id, page_id: "login", given: "G", when: "W", then: "T" },
        { id: "legacy-remove", source_requirement: first.id, page_id: "login", given: "G", when: "W", then: "T" },
        { id: "legacy-keep", source_requirement: first.id, page_id: "home", given: "G", when: "W", then: "T" }
      ]
    });

    await store.requirements.saveRequirement({
      requirement_id: second.id,
      document_md: "# Second\nRules",
      ui_affected: false,
      pages: [],
      navigation: [],
      translations: [],
      rules: [{ id: "replacement", given: "G2", when: "W2", then: "T2", replaces_rule_id: "legacy-replace" }],
      remove_rule_ids: ["legacy-remove"],
      remove_page_ids: []
    });

    expect((await store.requirements.getProductRules(product.id)).map((rule) => rule.id)).toEqual([
      "legacy-keep",
      `${second.id}-replacement`
    ]);
  });

  it("ignores remove_page_ids for logic-only rule cleanup", async () => {
    const { store, product } = await createConfiguredStore();
    const owner = await store.requirements.createEmptyRequirement(product.id, "Owner");
    const logicOnly = await store.requirements.createEmptyRequirement(product.id, "Logic Only");
    await writeYamlAtomic(join(store.home, "data", product.id, "baseline", "rules.yaml"), {
      rules: [
        { id: "owner-profile-rule", source_requirement: owner.id, page_id: "profile", given: "G", when: "W", then: "T" },
        { id: "owner-home-rule", source_requirement: owner.id, page_id: "home", given: "G", when: "W", then: "T" }
      ]
    });

    await store.requirements.saveRequirement({
      requirement_id: logicOnly.id,
      document_md: "# Logic Only\nRules",
      ui_affected: false,
      pages: [],
      navigation: [],
      translations: [],
      rules: [{ id: "logic-rule", page_id: "profile", given: "G2", when: "W2", then: "T2" }],
      remove_rule_ids: [],
      remove_page_ids: ["profile"]
    });

    expect((await store.requirements.getProductRules(product.id)).map((rule) => rule.id)).toEqual([
      "owner-profile-rule",
      "owner-home-rule",
      `${logicOnly.id}-logic-rule`
    ]);
  });

  it("removes pages and related baseline, navigation, and page-rule records", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Cleanup");
    await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Cleanup\nInitial",
      ui_affected: true,
      pages: [
        { page_id: "keep", name: "保留", baseline_page: "keep", change_type: "new" },
        { page_id: "remove", name: "删除", baseline_page: "remove", change_type: "new" }
      ],
      navigation: [
        { from: "keep", to: "remove", label: "Remove" },
        { from: "keep", to: "keep", label: "Stay" }
      ],
      translations: [],
      rules: [
        { id: "keep-rule", page_id: "keep", given: "G", when: "W", then: "T" },
        { id: "remove-rule", page_id: "remove", given: "G", when: "W", then: "T" }
      ],
      remove_rule_ids: [],
      remove_page_ids: []
    });
    await markRequirementPagesDone(store.home, product.id, req.id, { keep: "D-11111111", remove: "D-22222222" });

    const saved = await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Cleanup\nRemoved page",
      ui_affected: true,
      pages: [{ page_id: "keep", name: "保留", baseline_page: "keep", change_type: "patch" }],
      navigation: [
        { from: "keep", to: "remove", label: "Stale" },
        { from: "keep", to: "keep", label: "Stay" }
      ],
      translations: [],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: ["remove"]
    });

    expect(saved.pages.map((page) => page.page_id)).toEqual(["keep"]);
    await expect(store.baseline.getProductBaseline(product.id)).resolves.toMatchObject({
      pages: [expect.objectContaining({ id: "keep", source_requirements: [req.id] })],
      navigation: [{ from: "keep", to: "keep", label: "Stay" }]
    });
    expect((await store.requirements.getProductRules(product.id)).map((rule) => rule.id)).toEqual([]);
  });

  it("rejects UI saves when remove_page_ids would remove every final page", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Remove All");
    await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Remove All\nInitial",
      ui_affected: true,
      pages: [{ page_id: "only", name: "唯一页", baseline_page: "only", change_type: "new" }],
      navigation: [],
      translations: [],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });
    const before = await store.requirements.getRequirement({ requirement_id: req.id });

    await expect(
      store.requirements.saveRequirement({
        requirement_id: req.id,
        document_md: "# Remove All\nRemoved",
        ui_affected: true,
        pages: [{ page_id: "only", name: "唯一页", baseline_page: "only", change_type: "patch" }],
        navigation: [],
        translations: [],
        rules: [],
        remove_rule_ids: [],
        remove_page_ids: ["only"]
      })
    ).rejects.toMatchObject({ code: "PAGES_EMPTY" });

    await expect(store.requirements.getRequirement({ requirement_id: req.id })).resolves.toMatchObject({
      document_md: before.document_md,
      pages: before.pages,
      status: before.status
    });
  });

  it("returns the latest non-archived requirement by updated_at", async () => {
    const { store, product } = await createConfiguredStore();
    const archived = await store.requirements.createEmptyRequirement(product.id, "Archived");
    const older = await store.requirements.createEmptyRequirement(product.id, "Older");
    const latest = await store.requirements.createEmptyRequirement(product.id, "Latest");
    for (const [req, status, updatedAt] of [
      [archived, "archived", "2026-01-03T00:00:00.000Z"],
      [older, "active", "2026-01-01T00:00:00.000Z"],
      [latest, "submitted", "2026-01-02T00:00:00.000Z"]
    ] as const) {
      const file = join(store.home, "data", product.id, req.id, "requirement.yaml");
      await writeYamlAtomic(file, { ...(await readYaml<Record<string, unknown>>(file)), status, updated_at: updatedAt });
    }

    await expect(store.requirements.getLatestRequirement(product.id)).resolves.toMatchObject({ id: latest.id });
  });

  it("rejects archived saveRequirement calls before UI page validation", async () => {
    const { store, product } = await createConfiguredStore();
    const req = await store.requirements.createEmptyRequirement(product.id, "Archived");
    const file = join(store.home, "data", product.id, req.id, "requirement.yaml");
    await writeYamlAtomic(file, { ...(await readYaml<Record<string, unknown>>(file)), status: "archived" });

    await expect(
      store.requirements.saveRequirement({
        requirement_id: req.id,
        document_md: "# Archived\nNo UI",
        ui_affected: false,
        pages: [],
        navigation: [],
        translations: [],
        rules: [],
        remove_rule_ids: [],
        remove_page_ids: []
      })
    ).rejects.toMatchObject({ code: "REQUIREMENT_STATUS_INVALID" });
    await expect(
      store.requirements.saveRequirement({
        requirement_id: req.id,
        document_md: "# Archived\nNo pages",
        ui_affected: true,
        pages: [],
        navigation: [],
        translations: [],
        rules: [],
        remove_rule_ids: [],
        remove_page_ids: []
      })
    ).rejects.toMatchObject({ code: "REQUIREMENT_STATUS_INVALID" });
  });

  it("merges translations before saving and marks stale default-copy translations outdated", async () => {
    const { store, product } = await createConfiguredStore();
    await configureLanguages(store.home, product.id, ["zh-CN", "en"], "zh-CN");
    const req = await store.requirements.createEmptyRequirement(product.id, "Copy");
    await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Copy\nInitial",
      ui_affected: true,
      pages: [{ page_id: "login", name: "登录页", baseline_page: "login", change_type: "new", copy: [{ context: "submit", text: "登录" }] }],
      navigation: [],
      translations: [{ page_id: "login", entries: [{ context: "submit", texts: { en: "Login" } }] }],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });
    await markRequirementPagesDone(store.home, product.id, req.id, { login: "D-11111111" });

    await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Copy\nUpdated",
      ui_affected: true,
      pages: [{ page_id: "login", name: "登录页", baseline_page: "login", change_type: "patch", copy: [{ context: "submit", text: "立即登录" }] }],
      navigation: [],
      translations: [],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });

    await expect(store.copy.getTranslations(product.id, req.id)).resolves.toEqual([
      { page_id: "login", entries: [{ context: "submit", texts: { en: "Login" }, outdated: true }] }
    ]);
  });

  it("calls CopyService merge before save with current and next copy for multilingual UI saves", async () => {
    const { store, product } = await createConfiguredStore();
    await configureLanguages(store.home, product.id, ["zh-CN", "en"], "zh-CN");
    const req = await store.requirements.createEmptyRequirement(product.id, "Copy Order");
    await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Copy Order\nInitial",
      ui_affected: true,
      pages: [
        { page_id: "login", name: "登录页", baseline_page: "login", change_type: "new", copy: [{ context: "submit", text: "登录" }] }
      ],
      navigation: [],
      translations: [],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });
    await markRequirementPagesDone(store.home, product.id, req.id, { login: "D-11111111" });
    const sentinelTranslations: PageTranslation[] = [
      { page_id: "login", entries: [{ context: "submit", texts: { en: "Existing Login" } }] }
    ];
    const calls: string[] = [];
    const mergeCalls: Array<{
      oldCopy: CopyByPage;
      newCopy: CopyByPage;
      translations: PageTranslation[];
    }> = [];
    const saveCalls: PageTranslation[][] = [];
    const fakeCopy = {
      async mergeTranslations(
        _productId: string,
        _requirementId: string,
        oldCopy: CopyByPage,
        newCopy: CopyByPage,
        translations: PageTranslation[]
      ) {
        calls.push("mergeTranslations");
        mergeCalls.push({ oldCopy, newCopy, translations });
        return sentinelTranslations;
      },
      async saveTranslations(_productId: string, _requirementId: string, translations: PageTranslation[]) {
        calls.push("saveTranslations");
        saveCalls.push(translations);
      }
    } as unknown as CopyService;
    const requirements = new RequirementService({
      home: store.home,
      products: store.products,
      baseline: store.baseline,
      copy: fakeCopy
    });

    await requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Copy Order\nUpdated",
      ui_affected: true,
      pages: [
        { page_id: "login", name: "登录页", baseline_page: "login", change_type: "patch", copy: [{ context: "submit", text: "立即登录" }] },
        { page_id: "signup", name: "注册页", baseline_page: "signup", change_type: "new", copy: [{ context: "submit", text: "注册" }] }
      ],
      navigation: [],
      translations: [],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });

    expect(calls).toEqual(["mergeTranslations", "saveTranslations"]);
    expect(mergeCalls).toEqual([
      {
        oldCopy: { login: [{ context: "submit", text: "登录" }] },
        newCopy: {
          login: [{ context: "submit", text: "立即登录" }],
          signup: [{ context: "submit", text: "注册" }]
        },
        translations: []
      }
    ]);
    expect(saveCalls).toEqual([sentinelTranslations]);
  });

  it("preserves translations for deleted copy contexts during UI saves", async () => {
    const { store, product } = await createConfiguredStore();
    await configureLanguages(store.home, product.id, ["zh-CN", "en"], "zh-CN");
    const req = await store.requirements.createEmptyRequirement(product.id, "Copy Delete");
    await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Copy\nInitial",
      ui_affected: true,
      pages: [{ page_id: "login", name: "登录页", baseline_page: "login", change_type: "new", copy: [{ context: "submit", text: "登录" }, { context: "forgot", text: "忘记密码" }] }],
      navigation: [],
      translations: [{ page_id: "login", entries: [{ context: "submit", texts: { en: "Login" } }, { context: "forgot", texts: { en: "Forgot password" } }] }],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });
    await markRequirementPagesDone(store.home, product.id, req.id, { login: "D-11111111" });

    await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Copy\nDeleted",
      ui_affected: true,
      pages: [{ page_id: "login", name: "登录页", baseline_page: "login", change_type: "patch", copy: [{ context: "submit", text: "登录" }] }],
      navigation: [],
      translations: [],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });

    await expect(store.copy.getTranslations(product.id, req.id)).resolves.toEqual([
      {
        page_id: "login",
        entries: [
          { context: "forgot", texts: { en: "Forgot password" } },
          { context: "submit", texts: { en: "Login" } }
        ]
      }
    ]);
  });

  it("removes stale translation files for single-language UI saves", async () => {
    const { store, product } = await createConfiguredStore();
    await configureLanguages(store.home, product.id, ["zh-CN"], "zh-CN");
    const req = await store.requirements.createEmptyRequirement(product.id, "Single Language");
    const translationsFile = join(store.home, "data", product.id, req.id, "copy-translations.yaml");
    await writeYamlAtomic(translationsFile, {
      translations: [{ page_id: "login", entries: [{ context: "submit", texts: { en: "Login" } }] }]
    });

    await store.requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Single\nUI",
      ui_affected: true,
      pages: [{ page_id: "login", name: "登录页", baseline_page: "login", change_type: "new", copy: [{ context: "submit", text: "登录" }] }],
      navigation: [],
      translations: [{ page_id: "login", entries: [{ context: "submit", texts: { en: "Login" } }] }],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });

    expect(await fileExists(translationsFile)).toBe(false);
  });

  it("passes an empty translation set to CopyService for single-language UI saves", async () => {
    const { store, product } = await createConfiguredStore();
    await configureLanguages(store.home, product.id, ["zh-CN"], "zh-CN");
    const req = await store.requirements.createEmptyRequirement(product.id, "Single Language Copy");
    const calls: string[] = [];
    const saveCalls: PageTranslation[][] = [];
    const fakeCopy = {
      async mergeTranslations() {
        calls.push("mergeTranslations");
        return [{ page_id: "unexpected", entries: [{ context: "unexpected", texts: { en: "Unexpected" } }] }];
      },
      async saveTranslations(_productId: string, _requirementId: string, translations: PageTranslation[]) {
        calls.push("saveTranslations");
        saveCalls.push(translations);
      }
    } as unknown as CopyService;
    const requirements = new RequirementService({
      home: store.home,
      products: store.products,
      baseline: store.baseline,
      copy: fakeCopy
    });

    await requirements.saveRequirement({
      requirement_id: req.id,
      document_md: "# Single Language Copy\nUI",
      ui_affected: true,
      pages: [
        { page_id: "login", name: "登录页", baseline_page: "login", change_type: "new", copy: [{ context: "submit", text: "登录" }] }
      ],
      navigation: [],
      translations: [{ page_id: "login", entries: [{ context: "submit", texts: { en: "Login" } }] }],
      rules: [],
      remove_rule_ids: [],
      remove_page_ids: []
    });

    expect(calls).toEqual(["saveTranslations"]);
    expect(saveCalls).toEqual([[]]);
  });

  it("rolls back all UI transaction files when later writes fail", async () => {
    const { store, product } = await createConfiguredStore();
    await configureLanguages(store.home, product.id, ["zh-CN", "en"], "zh-CN");

    for (const hookName of ["afterTranslationsWrite", "afterDocumentWrite", "afterRulesWrite"] as const) {
      const req = await store.requirements.createEmptyRequirement(product.id, `Rollback ${hookName}`);
      await store.requirements.saveRequirement({
        requirement_id: req.id,
        document_md: "# Rollback\nInitial",
        ui_affected: true,
        pages: [{ page_id: "login", name: "登录页", baseline_page: "login", change_type: "new", copy: [{ context: "submit", text: "登录" }] }],
        navigation: [],
        translations: [{ page_id: "login", entries: [{ context: "submit", texts: { en: "Login" } }] }],
        rules: [{ id: "rule-001", page_id: "login", given: "G", when: "W", then: "T" }],
        remove_rule_ids: [],
        remove_page_ids: []
      });
      await markRequirementPagesDone(store.home, product.id, req.id, { login: "D-11111111" });
      const files = [
        join(store.home, "data", product.id, req.id, "requirement.yaml"),
        join(store.home, "data", product.id, req.id, "document.md"),
        join(store.home, "data", product.id, req.id, "copy-translations.yaml"),
        join(store.home, "data", product.id, "baseline", "baseline.yaml"),
        join(store.home, "data", product.id, "baseline", "rules.yaml")
      ];
      const before = await Promise.all(files.map(readTextIfExists));
      store.requirements.setTestHooksForUnitTests({
        [hookName]: () => {
          throw new Error(`${hookName} failed`);
        }
      });

      await expect(
        store.requirements.saveRequirement({
          requirement_id: req.id,
          document_md: "# Rollback\nUpdated",
          ui_affected: true,
          pages: [{ page_id: "login", name: "登录页新版", baseline_page: "login", change_type: "patch", copy: [{ context: "submit", text: "立即登录" }] }],
          navigation: [],
          translations: [],
          rules: [{ id: "rule-002", page_id: "login", given: "G2", when: "W2", then: "T2" }],
          remove_rule_ids: [],
          remove_page_ids: []
        })
      ).rejects.toThrow(`${hookName} failed`);
      store.requirements.setTestHooksForUnitTests({});

      await expect(Promise.all(files.map(readTextIfExists))).resolves.toEqual(before);
    }
  });

  it("rolls back only logic transaction files and leaves baseline/translations untouched", async () => {
    const { store, product } = await createConfiguredStore();
    await configureLanguages(store.home, product.id, ["zh-CN", "en"], "zh-CN");

    for (const hookName of ["afterDocumentWrite", "afterRulesWrite"] as const) {
      const req = await store.requirements.createEmptyRequirement(product.id, `Logic Rollback ${hookName}`);
      await store.requirements.saveRequirement({
        requirement_id: req.id,
        document_md: "# Logic\nInitial",
        ui_affected: false,
        pages: [],
        navigation: [],
        translations: [],
        rules: [{ id: "rule-001", given: "G", when: "W", then: "T" }],
        remove_rule_ids: [],
        remove_page_ids: []
      });
      const uiFiles = [
        join(store.home, "data", product.id, "baseline", "baseline.yaml"),
        join(store.home, "data", product.id, req.id, "copy-translations.yaml")
      ];
      const logicFiles = [
        join(store.home, "data", product.id, req.id, "requirement.yaml"),
        join(store.home, "data", product.id, req.id, "document.md"),
        join(store.home, "data", product.id, "baseline", "rules.yaml")
      ];
      const uiBefore = await Promise.all(uiFiles.map(readTextIfExists));
      const logicBefore = await Promise.all(logicFiles.map(readTextIfExists));
      store.requirements.setTestHooksForUnitTests({
        [hookName]: () => {
          throw new Error(`${hookName} failed`);
        }
      });

      await expect(
        store.requirements.saveRequirement({
          requirement_id: req.id,
          document_md: "# Logic\nUpdated",
          ui_affected: false,
          pages: [],
          navigation: [],
          translations: [{ page_id: "ignored", entries: [{ context: "ignored", texts: { en: "Ignored" } }] }],
          rules: [{ id: "rule-002", given: "G2", when: "W2", then: "T2" }],
          remove_rule_ids: [],
          remove_page_ids: []
        })
      ).rejects.toThrow(`${hookName} failed`);
      store.requirements.setTestHooksForUnitTests({});

      await expect(Promise.all(logicFiles.map(readTextIfExists))).resolves.toEqual(logicBefore);
      await expect(Promise.all(uiFiles.map(readTextIfExists))).resolves.toEqual(uiBefore);
    }
  });
});
