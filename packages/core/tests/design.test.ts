import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFormaStore } from "../src/index.js";

const minimalPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00,
  0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

const samplePen = {
  variables: { "--primary": "#5E6AD2" },
  children: [
    {
      id: "root",
      name: "Root",
      type: "frame",
      x: 0,
      y: 0,
      width: 375,
      height: 812,
      children: [
        {
          id: "button",
          name: "Button",
          type: "rectangle",
          x: 24,
          y: 100,
          width: 327,
          height: 48,
          fill: "$--primary"
        }
      ]
    }
  ]
};

async function createDesignStore(pageCount = 1) {
  const home = await mkdtemp(join(tmpdir(), "forma-design-"));
  const store = createFormaStore({ home, bundledStylesDir: resolve("styles") });
  const product = await store.products.createProduct({ name: "Shop App", description: "Mobile shop" });
  const empty = await store.requirements.createEmptyRequirement(product.id, "Checkout");
  const requirement = await store.requirements.submitRequirement({
    requirement_id: empty.id,
    document_md: "# Checkout\nCart checkout",
    pages: Array.from({ length: pageCount }, (_, index) => ({
      page_id: `${empty.id}-page-${index + 1}`,
      name: `Page ${index + 1}`,
      baseline_page: `page-${index + 1}`
    })),
    navigation: []
  });

  return { home, product, requirement, store };
}

async function writeDesignOutput(home: string, name: string, pen: unknown = samplePen) {
  const penPath = join(home, `${name}.pen`);
  const previewPath = join(home, `${name}.png`);
  await writeFile(penPath, JSON.stringify(pen), "utf8");
  await writeFile(previewPath, minimalPng);
  return { penPath, previewPath };
}

describe("DesignService", () => {
  it("saving a generated design changes the page status to done", async () => {
    const { home, requirement, store } = await createDesignStore();
    const output = await writeDesignOutput(home, "generated");

    const [design] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...output }]);

    expect(design).toMatchObject({ requirement_id: requirement.id, page_id: requirement.pages[0]!.page_id, version: 1 });
    await expect(store.requirements.getRequirement({ requirement_id: requirement.id })).resolves.toMatchObject({
      pages: [expect.objectContaining({ page_id: requirement.pages[0]!.page_id, design_status: "done", design_id: design.id })]
    });
    await expect(access(join(home, "data", requirement.product_id, requirement.id, design.id, "design.pen"))).resolves.toBeUndefined();
    await expect(access(join(home, "data", requirement.product_id, requirement.id, design.id, "preview@2x.png"))).resolves.toBeUndefined();
  });

  it("saving all pages done changes the requirement status to active", async () => {
    const { home, requirement, store } = await createDesignStore(2);
    const first = await writeDesignOutput(home, "first");
    const second = await writeDesignOutput(home, "second");

    await store.designs.saveDesigns(requirement.id, [
      { page_id: requirement.pages[0]!.page_id, ...first },
      { page_id: requirement.pages[1]!.page_id, ...second }
    ]);

    await expect(store.requirements.getRequirement({ requirement_id: requirement.id })).resolves.toMatchObject({ status: "active" });
  });

  it("saveDesigns rejects PAGE_NOT_OWNED when a page is outside the requirement", async () => {
    const { home, requirement, store } = await createDesignStore();
    const output = await writeDesignOutput(home, "outside");

    await expect(store.designs.saveDesigns(requirement.id, [{ page_id: "other-page", ...output }])).rejects.toMatchObject({
      code: "PAGE_NOT_OWNED"
    });
  });

  it("saving a refine requires an existing done page", async () => {
    const { home, requirement, store } = await createDesignStore();
    const output = await writeDesignOutput(home, "refine-pending");

    await expect(
      store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, mode: "refine", ...output }])
    ).rejects.toMatchObject({ code: "PAGE_NOT_DONE" });
  });

  it("refine increments version and preserves design.v1.pen", async () => {
    const { home, requirement, store } = await createDesignStore();
    const initial = await writeDesignOutput(home, "initial");
    const [saved] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...initial }]);
    const refined = await writeDesignOutput(home, "refined", {
      ...samplePen,
      children: [{ ...samplePen.children[0], width: 390 }]
    });

    const [next] = await store.designs.saveDesigns(requirement.id, [
      { page_id: requirement.pages[0]!.page_id, mode: "refine", ...refined }
    ]);

    expect(next).toMatchObject({ id: saved.id, version: 2 });
    expect(next.history).toEqual([expect.objectContaining({ version: 1, file: "design.v1.pen" })]);
    await expect(access(join(home, "data", requirement.product_id, requirement.id, saved.id, "design.v1.pen"))).resolves.toBeUndefined();
  });

  it("rollback fails on version 1", async () => {
    const { home, requirement, store } = await createDesignStore();
    const output = await writeDesignOutput(home, "version-one");
    const [design] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...output }]);

    await expect(store.designs.rollbackDesign(design.id)).rejects.toMatchObject({ code: "VERSION_TOO_LOW" });
  });

  it("rollback restores design.vN.pen", async () => {
    const { home, requirement, store } = await createDesignStore();
    const initial = await writeDesignOutput(home, "rollback-initial");
    const [saved] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...initial }]);
    const refinedPen = { ...samplePen, children: [{ ...samplePen.children[0], width: 390 }] };
    const refined = await writeDesignOutput(home, "rollback-refined", refinedPen);
    await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, mode: "refine", ...refined }]);

    const rolledBack = await store.designs.rollbackDesign(saved.id);

    expect(rolledBack).toMatchObject({ id: saved.id, version: 1, history: [] });
    expect(JSON.parse(await readFile(join(home, "data", requirement.product_id, requirement.id, saved.id, "design.pen"), "utf8"))).toEqual(
      samplePen
    );
  });

  it("annotation flattens nested coordinates and resolves variables", async () => {
    const { home, requirement, store } = await createDesignStore();
    const output = await writeDesignOutput(home, "annotation");
    const [design] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...output }]);

    await expect(store.designs.getDesignAnnotations(design.id)).resolves.toEqual([
      expect.objectContaining({ id: "root", x: 0, y: 0, width: 375, height: 812 }),
      expect.objectContaining({ id: "button", parent_id: "root", x: 24, y: 100, width: 327, height: 48, fill: "#5E6AD2" })
    ]);
  });

  it("diff reports added, removed, and modified nodes", async () => {
    const { home, requirement, store } = await createDesignStore();
    const initial = await writeDesignOutput(home, "diff-initial");
    const [design] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...initial }]);
    const changed = await writeDesignOutput(home, "diff-changed", {
      variables: { "--primary": "#5E6AD2" },
      children: [{ id: "root", name: "Root", type: "frame", x: 0, y: 0, width: 390, height: 812, children: [
        { id: "title", name: "Title", type: "text", x: 24, y: 40, width: 200, height: 24, content: "Hello" }
      ] }]
    });
    await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, mode: "refine", ...changed }]);

    await expect(store.designs.diffDesigns(design.id, 1, 2)).resolves.toMatchObject({
      added: [expect.objectContaining({ id: "title" })],
      removed: [expect.objectContaining({ id: "button" })],
      modified: [expect.objectContaining({ id: "root" })]
    });
  });

  it("exportDesignAsset validates that the node exists", async () => {
    const { home, requirement, store } = await createDesignStore();
    const output = await writeDesignOutput(home, "export");
    const [design] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...output }]);

    await expect(store.designs.exportDesignAsset(design.id, "button", "png")).resolves.toMatchObject({
      design_id: design.id,
      node_id: "button",
      format: "png",
      path: join(home, "data", requirement.product_id, requirement.id, design.id, "exports", "button.png")
    });
    await expect(store.designs.exportDesignAsset(design.id, "missing", "png")).rejects.toMatchObject({ code: "NODE_NOT_FOUND" });
  });
});
