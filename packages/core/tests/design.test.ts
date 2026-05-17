import { access, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFormaStore, readYaml, writeYamlAtomic } from "../src/index.js";

const minimalPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00,
  0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

const alternatePng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x61, 0x6c, 0x74, 0x2d, 0x70, 0x6e, 0x67
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
    await expect(access(join(home, "data", requirement.product_id, requirement.id, design.id, "design.yaml"))).resolves.toBeUndefined();
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

  it("ignores stage cleanup failure after requirement metadata is committed", async () => {
    const { home, requirement, store } = await createDesignStore();
    const output = await writeDesignOutput(home, "cleanup-after-commit");
    let cleanupHookCalled = false;
    (store.designs as unknown as { testHooks?: { beforePostCommitStageCleanup?: () => Promise<void> } }).testHooks = {
      async beforePostCommitStageCleanup() {
        cleanupHookCalled = true;
        throw new Error("cleanup failed");
      }
    };

    const [design] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...output }]);

    expect(cleanupHookCalled).toBe(true);
    await expect(store.requirements.getRequirement({ requirement_id: requirement.id })).resolves.toMatchObject({
      pages: [expect.objectContaining({ page_id: requirement.pages[0]!.page_id, design_status: "done", design_id: design.id })]
    });
    await expect(access(join(home, "data", requirement.product_id, requirement.id, design.id, "design.pen"))).resolves.toBeUndefined();
    await expect(access(join(home, "data", requirement.product_id, requirement.id, design.id, "preview@2x.png"))).resolves.toBeUndefined();
    await expect(access(join(home, "data", requirement.product_id, requirement.id, design.id, "design.yaml"))).resolves.toBeUndefined();
  });

  it("does not leave orphan designs when a later batch input fails", async () => {
    const { home, requirement, store } = await createDesignStore(2);
    const first = await writeDesignOutput(home, "batch-first");
    const second = await writeDesignOutput(home, "batch-second");
    await rm(second.previewPath);

    await expect(
      store.designs.saveDesigns(requirement.id, [
        { page_id: requirement.pages[0]!.page_id, ...first },
        { page_id: requirement.pages[1]!.page_id, ...second }
      ])
    ).rejects.toThrow();

    const storedRequirement = await store.requirements.getRequirement({ requirement_id: requirement.id });
    expect(storedRequirement).toMatchObject({
      status: "submitted",
      pages: [
        expect.objectContaining({ page_id: requirement.pages[0]!.page_id, design_status: "pending" }),
        expect.objectContaining({ page_id: requirement.pages[1]!.page_id, design_status: "pending" })
      ]
    });
    expect(storedRequirement.pages[0]).not.toHaveProperty("design_id");
    expect(storedRequirement.pages[1]).not.toHaveProperty("design_id");
    const entries = await readdir(join(home, "data", requirement.product_id, requirement.id), { withFileTypes: true });
    expect(entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("D-")).map((entry) => entry.name)).toEqual([]);
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

  it("update mode increments version and replaces the preview", async () => {
    const { home, requirement, store } = await createDesignStore();
    const initial = await writeDesignOutput(home, "update-initial");
    const [saved] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...initial }]);
    const updated = await writeDesignOutput(home, "updated");
    await writeFile(updated.previewPath, alternatePng);

    const [next] = await store.designs.saveDesigns(requirement.id, [
      { page_id: requirement.pages[0]!.page_id, mode: "update", ...updated }
    ]);

    expect(next).toMatchObject({ id: saved.id, version: 2 });
    expect(await readFile(join(home, "data", requirement.product_id, requirement.id, saved.id, "preview@2x.png"))).toEqual(alternatePng);
  });

  it("does not half-update an existing design when preview copy fails", async () => {
    const { home, requirement, store } = await createDesignStore();
    const initial = await writeDesignOutput(home, "half-update-initial");
    const [saved] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...initial }]);
    const updatedPen = { ...samplePen, children: [{ ...samplePen.children[0], width: 390 }] };
    const updated = await writeDesignOutput(home, "half-update-new", updatedPen);
    await rm(updated.previewPath);

    await expect(
      store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, mode: "update", ...updated }])
    ).rejects.toThrow();

    const designDir = join(home, "data", requirement.product_id, requirement.id, saved.id);
    expect(JSON.parse(await readFile(join(designDir, "design.pen"), "utf8"))).toEqual(samplePen);
    expect(await readFile(join(designDir, "preview@2x.png"))).toEqual(minimalPng);
    await expect(access(join(designDir, "design.v1.pen"))).rejects.toThrow();
    await expect(store.designs.getDesignAnnotations(saved.id)).resolves.toContainEqual(expect.objectContaining({ id: "button", width: 327 }));
  });

  it("restores an existing design when commit fails after writing history files", async () => {
    const { home, requirement, store } = await createDesignStore();
    const initial = await writeDesignOutput(home, "mid-commit-initial");
    const [saved] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...initial }]);
    const updatedPen = { ...samplePen, children: [{ ...samplePen.children[0], width: 390 }] };
    const updated = await writeDesignOutput(home, "mid-commit-updated", updatedPen);
    await writeFile(updated.previewPath, alternatePng);
    (store.designs as unknown as { testHooks?: { afterCommitExistingHistoryFiles?: () => Promise<void> } }).testHooks = {
      async afterCommitExistingHistoryFiles() {
        throw new Error("mid-commit failure");
      }
    };

    await expect(
      store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, mode: "update", ...updated }])
    ).rejects.toThrow("mid-commit failure");

    const designDir = join(home, "data", requirement.product_id, requirement.id, saved.id);
    expect(JSON.parse(await readFile(join(designDir, "design.pen"), "utf8"))).toEqual(samplePen);
    expect(await readFile(join(designDir, "preview@2x.png"))).toEqual(minimalPng);
    await expect(readYaml(join(designDir, "design.yaml"))).resolves.toMatchObject({ id: saved.id, version: 1, history: [] });
    await expect(access(join(designDir, "design.v1.pen"))).rejects.toThrow();
    await expect(access(join(designDir, "preview.v1@2x.png"))).rejects.toThrow();
  });

  it("refine replaces the preview", async () => {
    const { home, requirement, store } = await createDesignStore();
    const initial = await writeDesignOutput(home, "preview-initial");
    const [saved] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...initial }]);
    const refined = await writeDesignOutput(home, "preview-refined");
    await writeFile(refined.previewPath, alternatePng);

    await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, mode: "refine", ...refined }]);

    expect(await readFile(join(home, "data", requirement.product_id, requirement.id, saved.id, "preview@2x.png"))).toEqual(alternatePng);
  });

  it("saveDesigns rejects invalid pen files", async () => {
    const { home, requirement, store } = await createDesignStore();
    const output = await writeDesignOutput(home, "invalid-pen");
    await writeFile(output.penPath, "{", "utf8");

    await expect(store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...output }])).rejects.toMatchObject({
      code: "PEN_FILE_INVALID"
    });
  });

  it("saveDesigns rejects missing requirements", async () => {
    const { home, requirement, store } = await createDesignStore();
    const output = await writeDesignOutput(home, "missing-requirement");

    await expect(store.designs.saveDesigns("R-00000000", [{ page_id: requirement.pages[0]!.page_id, ...output }])).rejects.toMatchObject({
      code: "REQUIREMENT_NOT_FOUND"
    });
  });

  it("rejects corrupt page metadata that points at another requirement design", async () => {
    const { home, requirement, store } = await createDesignStore();
    const otherEmpty = await store.requirements.createEmptyRequirement(requirement.product_id, "Profile");
    const otherRequirement = await store.requirements.submitRequirement({
      requirement_id: otherEmpty.id,
      document_md: "# Profile\nEdit profile",
      pages: [{ page_id: `${otherEmpty.id}-page-1`, name: "Profile", baseline_page: "profile" }],
      navigation: []
    });
    const original = await writeDesignOutput(home, "owner-original");
    const [otherDesign] = await store.designs.saveDesigns(otherRequirement.id, [{ page_id: otherRequirement.pages[0]!.page_id, ...original }]);
    const requirementFile = join(home, "data", requirement.product_id, requirement.id, "requirement.yaml");
    const storedRequirement = await readYaml<Record<string, unknown>>(requirementFile);
    await writeYamlAtomic(requirementFile, {
      ...storedRequirement,
      pages: [{ ...requirement.pages[0], design_status: "done", design_id: otherDesign.id }]
    });
    const output = await writeDesignOutput(home, "owner-invalid");

    await expect(
      store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, mode: "update", ...output }])
    ).rejects.toMatchObject({ code: "PAGE_NOT_OWNED" });
    await expect(access(join(home, "data", otherRequirement.product_id, otherRequirement.id, otherDesign.id, "design.v1.pen"))).rejects.toThrow();
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

  it("rollback restores the previous preview without an exporter", async () => {
    const { home, requirement, store } = await createDesignStore();
    const initial = await writeDesignOutput(home, "rollback-preview-initial");
    const [saved] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...initial }]);
    const refined = await writeDesignOutput(home, "rollback-preview-refined");
    await writeFile(refined.previewPath, alternatePng);
    await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, mode: "refine", ...refined }]);

    await store.designs.rollbackDesign(saved.id);

    expect(await readFile(join(home, "data", requirement.product_id, requirement.id, saved.id, "preview@2x.png"))).toEqual(minimalPng);
  });

  it("restores current files and metadata when rollback fails after writing pen", async () => {
    const { home, requirement, store } = await createDesignStore();
    const initial = await writeDesignOutput(home, "rollback-partial-initial");
    const [saved] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...initial }]);
    const refinedPen = { ...samplePen, children: [{ ...samplePen.children[0], width: 390 }] };
    const refined = await writeDesignOutput(home, "rollback-partial-refined", refinedPen);
    await writeFile(refined.previewPath, alternatePng);
    const [updated] = await store.designs.saveDesigns(requirement.id, [
      { page_id: requirement.pages[0]!.page_id, mode: "refine", ...refined }
    ]);
    (store.designs as unknown as { testHooks?: { afterRollbackPenWrite?: () => Promise<void> } }).testHooks = {
      async afterRollbackPenWrite() {
        throw new Error("rollback partial failure");
      }
    };

    await expect(store.designs.rollbackDesign(saved.id)).rejects.toThrow("rollback partial failure");

    const designDir = join(home, "data", requirement.product_id, requirement.id, saved.id);
    expect(JSON.parse(await readFile(join(designDir, "design.pen"), "utf8"))).toEqual(refinedPen);
    expect(await readFile(join(designDir, "preview@2x.png"))).toEqual(alternatePng);
    await expect(readYaml(join(designDir, "design.yaml"))).resolves.toMatchObject({
      id: saved.id,
      version: 2,
      history: updated.history
    });
  });

  it("rollback rejects when a newer requirement supersedes the design requirement without mutating files", async () => {
    const { home, requirement, store } = await createDesignStore();
    const initial = await writeDesignOutput(home, "rollback-current-initial");
    const [saved] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...initial }]);
    const refinedPen = { ...samplePen, children: [{ ...samplePen.children[0], width: 390 }] };
    const refined = await writeDesignOutput(home, "rollback-current-refined", refinedPen);
    await writeFile(refined.previewPath, alternatePng);
    const [updated] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, mode: "refine", ...refined }]);
    const newerEmpty = await store.requirements.createEmptyRequirement(requirement.product_id, "Newer checkout");
    const newer = await store.requirements.submitRequirement({
      requirement_id: newerEmpty.id,
      document_md: "# Newer\nSupersedes old design",
      pages: [{ page_id: `${newerEmpty.id}-page-1`, name: "Newer Page", baseline_page: "newer-page" }],
      navigation: []
    });
    await writeYamlAtomic(join(home, "data", requirement.product_id, newer.id, "requirement.yaml"), {
      ...newer,
      created_at: "2999-01-01T00:00:00.000Z",
      updated_at: "2999-01-01T00:00:00.000Z"
    });

    await expect(store.designs.rollbackDesign(saved.id)).rejects.toMatchObject({ code: "PAGE_NOT_OWNED" });

    const designDir = join(home, "data", requirement.product_id, requirement.id, saved.id);
    expect(JSON.parse(await readFile(join(designDir, "design.pen"), "utf8"))).toEqual(refinedPen);
    expect(await readFile(join(designDir, "preview@2x.png"))).toEqual(alternatePng);
    await expect(readYaml(join(designDir, "design.yaml"))).resolves.toMatchObject({ id: saved.id, version: 2, history: updated.history });
  });

  it("rollback rejects when current requirement page no longer points at the design without mutating files", async () => {
    const { home, requirement, store } = await createDesignStore();
    const initial = await writeDesignOutput(home, "rollback-page-current-initial");
    const [saved] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...initial }]);
    const refinedPen = { ...samplePen, children: [{ ...samplePen.children[0], width: 390 }] };
    const refined = await writeDesignOutput(home, "rollback-page-current-refined", refinedPen);
    await writeFile(refined.previewPath, alternatePng);
    const [updated] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, mode: "refine", ...refined }]);
    const requirementFile = join(home, "data", requirement.product_id, requirement.id, "requirement.yaml");
    const storedRequirement = await readYaml<Record<string, unknown>>(requirementFile);
    await writeYamlAtomic(requirementFile, {
      ...storedRequirement,
      pages: [{ ...requirement.pages[0], design_status: "expired", design_id: saved.id }]
    });

    await expect(store.designs.rollbackDesign(saved.id)).rejects.toMatchObject({ code: "PAGE_NOT_OWNED" });

    const designDir = join(home, "data", requirement.product_id, requirement.id, saved.id);
    expect(JSON.parse(await readFile(join(designDir, "design.pen"), "utf8"))).toEqual(refinedPen);
    expect(await readFile(join(designDir, "preview@2x.png"))).toEqual(alternatePng);
    await expect(readYaml(join(designDir, "design.yaml"))).resolves.toMatchObject({ id: saved.id, version: 2, history: updated.history });
  });

  it("rollback fails when the previous history file is missing", async () => {
    const { home, requirement, store } = await createDesignStore();
    const initial = await writeDesignOutput(home, "history-initial");
    const [saved] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...initial }]);
    const refined = await writeDesignOutput(home, "history-refined");
    await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, mode: "refine", ...refined }]);
    await rm(join(home, "data", requirement.product_id, requirement.id, saved.id, "design.v1.pen"));

    await expect(store.designs.rollbackDesign(saved.id)).rejects.toMatchObject({ code: "HISTORY_FILE_MISSING" });
  });

  it("rollback fails when the previous preview history file is missing", async () => {
    const { home, requirement, store } = await createDesignStore();
    const initial = await writeDesignOutput(home, "history-preview-initial");
    const [saved] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...initial }]);
    const refined = await writeDesignOutput(home, "history-preview-refined");
    await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, mode: "refine", ...refined }]);
    await rm(join(home, "data", requirement.product_id, requirement.id, saved.id, "preview.v1@2x.png"), { force: true });

    await expect(store.designs.rollbackDesign(saved.id)).rejects.toMatchObject({ code: "HISTORY_FILE_MISSING" });
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

  it("annotation maps malformed current pen to PEN_FILE_INVALID", async () => {
    const { home, requirement, store } = await createDesignStore();
    const output = await writeDesignOutput(home, "malformed-current");
    const [design] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...output }]);
    await writeFile(join(home, "data", requirement.product_id, requirement.id, design.id, "design.pen"), "{", "utf8");

    await expect(store.designs.getDesignAnnotations(design.id)).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
    await expect(store.designs.exportDesignAsset(design.id, "button", "png")).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
  });

  it("annotation maps structurally invalid current pen to PEN_FILE_INVALID", async () => {
    const { home, requirement, store } = await createDesignStore();
    const output = await writeDesignOutput(home, "invalid-current-structure");
    const [design] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...output }]);
    await writeFile(
      join(home, "data", requirement.product_id, requirement.id, design.id, "design.pen"),
      JSON.stringify({ children: [] }),
      "utf8"
    );

    await expect(store.designs.getDesignAnnotations(design.id)).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
    await expect(store.designs.exportDesignAsset(design.id, "button", "png")).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
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

  it("diff maps malformed history pen to PEN_FILE_INVALID", async () => {
    const { home, requirement, store } = await createDesignStore();
    const initial = await writeDesignOutput(home, "malformed-history-initial");
    const [design] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...initial }]);
    const refined = await writeDesignOutput(home, "malformed-history-refined", {
      ...samplePen,
      children: [{ ...samplePen.children[0], width: 390 }]
    });
    await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, mode: "refine", ...refined }]);
    await writeFile(join(home, "data", requirement.product_id, requirement.id, design.id, "design.v1.pen"), "{", "utf8");

    await expect(store.designs.diffDesigns(design.id, 1, 2)).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
  });

  it("diff maps structurally invalid history pen to PEN_FILE_INVALID", async () => {
    const { home, requirement, store } = await createDesignStore();
    const initial = await writeDesignOutput(home, "invalid-history-structure-initial");
    const [design] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...initial }]);
    const refined = await writeDesignOutput(home, "invalid-history-structure-refined", {
      ...samplePen,
      children: [{ ...samplePen.children[0], width: 390 }]
    });
    await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, mode: "refine", ...refined }]);
    await writeFile(join(home, "data", requirement.product_id, requirement.id, design.id, "design.v1.pen"), JSON.stringify({}), "utf8");

    await expect(store.designs.diffDesigns(design.id, 1, 2)).rejects.toMatchObject({ code: "PEN_FILE_INVALID" });
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

  it("exportDesignAsset rejects missing designs", async () => {
    const { store } = await createDesignStore();

    await expect(store.designs.exportDesignAsset("D-00000000", "button", "png")).rejects.toMatchObject({ code: "DESIGN_NOT_FOUND" });
  });

  it("exportDesignAsset validates runtime id, node, and format inputs", async () => {
    const { home, requirement, store } = await createDesignStore();
    const output = await writeDesignOutput(home, "export-validation");
    const [design] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...output }]);

    await expect(store.designs.exportDesignAsset("../../outside", "button", "png")).rejects.toMatchObject({ code: "DESIGN_NOT_FOUND" });
    await expect(store.designs.exportDesignAsset(design.id, "../button", "png")).rejects.toMatchObject({ code: "NODE_NOT_FOUND" });
    await expect(store.designs.exportDesignAsset(design.id, "button", "png/../../escape" as "png")).rejects.toMatchObject({
      code: "EXPORT_FORMAT_UNSUPPORTED"
    });
  });

  it("exportDesignAsset rejects unsafe node ids even when the node exists", async () => {
    const { home, requirement, store } = await createDesignStore();
    const output = await writeDesignOutput(home, "unsafe-node", {
      children: [{ id: "../button", name: "Button", type: "rectangle", x: 0, y: 0, width: 1, height: 1 }]
    });
    const [design] = await store.designs.saveDesigns(requirement.id, [{ page_id: requirement.pages[0]!.page_id, ...output }]);

    await expect(store.designs.exportDesignAsset(design.id, "../button", "png")).rejects.toMatchObject({ code: "NODE_NOT_FOUND" });
  });
});
