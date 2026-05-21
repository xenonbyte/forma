import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFormaStore,
  getProductComponentLibrary,
  getRequirementDesign,
  readSchemaNormalizationRecoveryState,
  readYaml,
  writeYamlAtomic
} from "../src/index.js";

const emptySemanticContract = {
  fields: [],
  actions: [],
  navigation: [],
  component_keys: [],
  allowed_copy: []
};

async function markNormalizationCommitted(home: string): Promise<void> {
  await writeFile(join(home, ".v6-schema-cutover-committed"), "committed\n", "utf8");
}

async function createStrictStore() {
  const home = await mkdtemp(join(tmpdir(), "forma-strict-v6-"));
  await markNormalizationCommitted(home);
  const store = await createFormaStore({ home, bundledStylesDir: resolve("styles") });
  const product = await store.products.createProduct({ name: "Shop", description: "Shop app" });
  return { home, store, product };
}

async function writeRequirement(home: string, productId: string, requirement: Record<string, unknown>): Promise<void> {
  await writeYamlAtomic(join(home, "data", productId, String(requirement.id), "requirement.yaml"), requirement);
  await writeFile(join(home, "data", productId, String(requirement.id), "document.md"), "# Requirement\n", "utf8");
}

function strictRequirement(productId: string, patch: Record<string, unknown> = {}) {
  return {
    id: "R-11111111",
    product_id: productId,
    title: "Login",
    status: "submitted",
    ui_affected: true,
    created_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:00:00.000Z",
    pages: [
      {
        page_id: "login",
        name: "Login",
        baseline_page: "login",
        design_status: "pending",
        semantic_contract: emptySemanticContract,
        semantic_contract_coverage: "minimal",
        ...patch
      }
    ],
    navigation: []
  };
}

async function expectPathExists(file: string): Promise<void> {
  await expect(access(file)).resolves.toBeUndefined();
}

describe("strict v6 runtime schema and read models", () => {
  it("requires the committed cutover marker before constructing strict services", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-strict-marker-"));

    await expect(readSchemaNormalizationRecoveryState(home)).resolves.toMatchObject({
      mode: "preflight_only",
      status: "preflight_required",
      code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED"
    });
    await expect(createFormaStore({ home })).rejects.toMatchObject({
      state: { mode: "preflight_only", code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED" }
    });
  });

  it("validates strict persisted schemas before exposing normal store services", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-strict-startup-"));
    await markNormalizationCommitted(home);
    await mkdir(join(home, "data", "P-123abc"), { recursive: true });
    await writeYamlAtomic(join(home, "data", "products.yaml"), {
      products: [{ id: "P-123abc", name: "Shop", description: "Shop app" }]
    });
    await writeYamlAtomic(join(home, "data", "P-123abc", "product.yaml"), {
      id: "P-123abc",
      name: "Shop",
      description: "Shop app",
      components_initialized: true
    });

    await expect(createFormaStore({ home, bundledStylesDir: resolve("styles") })).rejects.toThrow(/components_initialized/);

    await writeYamlAtomic(join(home, "data", "P-123abc", "product.yaml"), {
      id: "P-123abc",
      name: "Shop",
      description: "Shop app"
    });
    await writeRequirement(home, "P-123abc", strictRequirement("P-123abc", { semantic_contract: undefined }));

    await expect(createFormaStore({ home, bundledStylesDir: resolve("styles") })).rejects.toThrow(/semantic_contract/);
  });

  it("rejects old product, requirement page, and baseline persisted fields after cutover", async () => {
    const { home, store, product } = await createStrictStore();
    const productFile = join(home, "data", product.id, "product.yaml");
    await writeYamlAtomic(productFile, {
      ...(await readYaml<Record<string, unknown>>(productFile)),
      components_initialized: true
    });
    await expect(store.products.getProduct(product.id)).rejects.toThrow(/components_initialized/);

    await writeYamlAtomic(productFile, {
      id: product.id,
      name: product.name,
      description: product.description
    });
    await writeRequirement(home, product.id, strictRequirement(product.id, { design_id: "D-11111111" }));
    await expect(store.requirements.getRequirement({ requirement_id: "R-11111111" })).rejects.toThrow(/design_id/);

    await writeRequirement(home, product.id, strictRequirement(product.id, {
      design_metadata: { legacy: true },
      pen_path: "data/P-123abc/R-11111111/D-11111111/design.pen",
      preview_path: "data/P-123abc/R-11111111/D-11111111/preview@2x.png"
    }));
    await expect(store.requirements.getRequirement({ requirement_id: "R-11111111" })).rejects.toThrow(/design_metadata|pen_path|preview_path/);

    const missingContract = strictRequirement(product.id);
    delete (missingContract.pages as Array<Record<string, unknown>>)[0]!.semantic_contract;
    await writeRequirement(home, product.id, missingContract);
    await expect(store.requirements.getRequirement({ requirement_id: "R-11111111" })).rejects.toThrow(/semantic_contract/);

    await writeYamlAtomic(join(home, "data", product.id, "baseline", "baseline.yaml"), {
      product_id: product.id,
      pages: [
        {
          id: "login",
          name: "Login",
          features: "",
          copy: [],
          fields: "",
          interactions: "",
          source_requirements: ["R-11111111"]
        }
      ],
      navigation: []
    });
    await expect(store.baseline.getProductBaseline(product.id)).rejects.toThrow(/semantic_contract/);
  });

  it("reads and validates component library metadata without writing product yaml", async () => {
    const { home, product } = await createStrictStore();
    const libraryDir = join(home, "library");
    const latestFile = join(libraryDir, `${product.id}.lib.pen`);
    const versionFile = join(libraryDir, `${product.id}.versions`, "1.lib.pen");
    const metadataFile = join(libraryDir, `${product.id}.components.yaml`);
    const emptyPen = JSON.stringify({ children: [] });
    await mkdir(join(libraryDir, `${product.id}.versions`), { recursive: true });
    await writeFile(latestFile, emptyPen, "utf8");
    await writeFile(versionFile, emptyPen, "utf8");
    await writeYamlAtomic(metadataFile, {
      product_id: product.id,
      current_version: 1,
      latest_file: `${product.id}.lib.pen`,
      versions: [
        {
          version: 1,
          file: `${product.id}.versions/1.lib.pen`,
          checksum: `sha256:${createHash("sha256").update(emptyPen).digest("hex")}`,
          components: []
        }
      ]
    });
    const beforeProduct = await readFile(join(home, "data", product.id, "product.yaml"), "utf8");

    await expect(getProductComponentLibrary(home, product.id)).resolves.toMatchObject({
      status: "complete",
      product_id: product.id,
      current_version: 1,
      components: []
    });
    expect(await readFile(join(home, "data", product.id, "product.yaml"), "utf8")).toBe(beforeProduct);

    await writeYamlAtomic(metadataFile, {
      product_id: product.id,
      current_version: 2,
      latest_file: `${product.id}.lib.pen`,
      versions: []
    });
    await expect(getProductComponentLibrary(home, product.id)).resolves.toMatchObject({ status: "invalid" });
  });

  it("rejects component library symlink escapes before hashing files", async () => {
    const { home, product } = await createStrictStore();
    const libraryDir = join(home, "library");
    const latestFile = join(libraryDir, `${product.id}.lib.pen`);
    const versionFile = join(libraryDir, `${product.id}.versions`, "1.lib.pen");
    const metadataFile = join(libraryDir, `${product.id}.components.yaml`);
    const outside = await mkdtemp(join(tmpdir(), "forma-outside-lib-"));
    const emptyPen = JSON.stringify({ children: [] });
    await mkdir(join(libraryDir, `${product.id}.versions`), { recursive: true });
    await writeFile(join(outside, "outside.lib.pen"), emptyPen, "utf8");
    await writeFile(versionFile, emptyPen, "utf8");
    await symlink(join(outside, "outside.lib.pen"), latestFile);
    await writeYamlAtomic(metadataFile, {
      product_id: product.id,
      current_version: 1,
      latest_file: `${product.id}.lib.pen`,
      versions: [{
        version: 1,
        file: `${product.id}.versions/1.lib.pen`,
        checksum: `sha256:${createHash("sha256").update(emptyPen).digest("hex")}`,
        components: []
      }]
    });

    await expect(getProductComponentLibrary(home, product.id)).resolves.toMatchObject({
      status: "invalid",
      error: expect.stringContaining("escapes")
    });

    await rm(latestFile, { force: true });
    await writeFile(latestFile, emptyPen, "utf8");
    await rm(versionFile, { force: true });
    await symlink(join(outside, "outside.lib.pen"), versionFile);

    await expect(getProductComponentLibrary(home, product.id)).resolves.toMatchObject({
      status: "invalid",
      error: expect.stringContaining("escapes")
    });
  });

  it("reads requirement-level design metadata and does not create missing design files", async () => {
    const { home, product } = await createStrictStore();
    const requirementId = "R-11111111";
    const requirementDir = join(home, "data", product.id, requirementId);
    await writeRequirement(home, product.id, strictRequirement(product.id));

    await expect(getRequirementDesign(home, product.id, requirementId)).resolves.toMatchObject({
      status: "missing",
      product_id: product.id,
      requirement_id: requirementId
    });
    await expect(access(join(requirementDir, "design.yaml"))).rejects.toThrow();

    await mkdir(join(requirementDir, "previews"), { recursive: true });
    await writeFile(join(requirementDir, "design.pen"), "pen", "utf8");
    await writeFile(join(requirementDir, "previews", "login@2x.png"), "png", "utf8");
    await writeYamlAtomic(join(requirementDir, "design.yaml"), {
      schema_version: 1,
      product_id: product.id,
      requirement_id: requirementId,
      canvas_file: "design.pen",
      canvas_version: 3,
      pages: [
        {
          page_id: "login",
          status: "done",
          preview_file: "previews/login@2x.png",
          page_version: 2
        }
      ],
      history: []
    });

    const result = await getRequirementDesign(home, product.id, requirementId);
    expect(result).toMatchObject({
      status: "complete",
      canvas_version: 3,
      pages: [expect.objectContaining({ page_id: "login", status: "done", page_version: 2 })]
    });
    await expectPathExists(join(requirementDir, "design.yaml"));
  });

  it("reports invalid requirement design metadata when referenced files are missing", async () => {
    const { home, product } = await createStrictStore();
    const requirementId = "R-11111111";
    const requirementDir = join(home, "data", product.id, requirementId);
    await writeRequirement(home, product.id, strictRequirement(product.id));
    await writeYamlAtomic(join(requirementDir, "design.yaml"), {
      schema_version: 1,
      product_id: product.id,
      requirement_id: requirementId,
      canvas_file: "design.pen",
      canvas_version: 1,
      pages: [
        {
          page_id: "login",
          status: "done",
          preview_file: "previews/login@2x.png",
          page_version: 1
        }
      ],
      history: [{ version: 1, file: "history/1.design.yaml" }]
    });

    await expect(getRequirementDesign(home, product.id, requirementId)).resolves.toMatchObject({
      status: "invalid",
      missing_files: [
        join(requirementDir, "design.pen"),
        join(requirementDir, "previews", "login@2x.png"),
        join(requirementDir, "history", "1.design.yaml")
      ]
    });
  });

  it("rejects requirement design symlink escapes and blocks strict startup", async () => {
    const { home, product } = await createStrictStore();
    const requirementId = "R-11111111";
    const requirementDir = join(home, "data", product.id, requirementId);
    const outside = await mkdtemp(join(tmpdir(), "forma-outside-design-"));
    await writeRequirement(home, product.id, strictRequirement(product.id));
    await mkdir(join(requirementDir, "previews"), { recursive: true });
    await mkdir(join(requirementDir, "history"), { recursive: true });
    await writeFile(join(outside, "design.pen"), "pen", "utf8");
    await writeFile(join(outside, "preview.png"), "png", "utf8");
    await writeFile(join(outside, "history.yaml"), "history", "utf8");
    await symlink(join(outside, "design.pen"), join(requirementDir, "design.pen"));
    await symlink(join(outside, "preview.png"), join(requirementDir, "previews", "login@2x.png"));
    await symlink(join(outside, "history.yaml"), join(requirementDir, "history", "1.design.yaml"));
    await writeYamlAtomic(join(requirementDir, "design.yaml"), {
      schema_version: 1,
      product_id: product.id,
      requirement_id: requirementId,
      canvas_file: "design.pen",
      canvas_version: 1,
      pages: [{
        page_id: "login",
        status: "done",
        preview_file: "previews/login@2x.png",
        page_version: 1
      }],
      history: [{ version: 1, file: "history/1.design.yaml" }]
    });

    await expect(getRequirementDesign(home, product.id, requirementId)).resolves.toMatchObject({
      status: "invalid",
      error: expect.stringContaining("escapes")
    });
    await expect(createFormaStore({ home, bundledStylesDir: resolve("styles") })).rejects.toMatchObject({
      code: "STRICT_SCHEMA_VALIDATION_FAILED"
    });
  });
});
