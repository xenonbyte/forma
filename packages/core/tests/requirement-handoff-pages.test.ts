import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import {
  listArchivedHandoffPages,
  getArtifactsDir,
  getArtifactVziPath,
  getArtifactIconsManifestPath,
} from "@xenonbyte/forma-core";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const PRODUCT_ID = "P-abc123";

async function seedArtifact(
  productsRoot: string,
  artifactId: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  const iconsManifestPath = getArtifactIconsManifestPath(productsRoot, PRODUCT_ID, artifactId);
  await mkdir(join(iconsManifestPath, ".."), { recursive: true });
  await writeFile(iconsManifestPath, JSON.stringify(manifest), "utf8");
  await mkdir(join(getArtifactsDir(productsRoot, PRODUCT_ID), artifactId, "v1"), { recursive: true });
  await writeFile(
    join(getArtifactsDir(productsRoot, PRODUCT_ID), artifactId, "v1", "index.html"),
    "<html></html>",
    "utf8",
  );
  const vziPath = getArtifactVziPath(productsRoot, PRODUCT_ID, artifactId);
  await mkdir(join(vziPath, ".."), { recursive: true });
  await writeFile(vziPath, Buffer.from([1, 2, 3]));
}

describe("listArchivedHandoffPages", () => {
  it("returns one record per requirement-archive icons bundle, skipping others", async () => {
    const productsRoot = await mkdtemp(join(tmpdir(), "forma-handoff-"));
    dirs.push(productsRoot);

    await seedArtifact(productsRoot, "A-home", {
      requirementId: "R-1",
      generatedFrom: "requirement-archive",
      pageId: "home",
      variant: "default",
      sourceVersion: 1,
      icons: [{}, {}],
    });
    await seedArtifact(productsRoot, "A-other", {
      requirementId: "R-2",
      generatedFrom: "requirement-archive",
      pageId: "home",
      sourceVersion: 1,
      icons: [],
    });
    await seedArtifact(productsRoot, "A-active", {
      requirementId: "R-1",
      generatedFrom: "active",
      pageId: "settings",
      sourceVersion: 1,
      icons: [],
    });

    const pages = await listArchivedHandoffPages(productsRoot, PRODUCT_ID, "R-1");
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      pageId: "home",
      variant: "default",
      artifactId: "A-home",
      version: 1,
      iconCount: 2,
    });
    expect(pages[0].vziPath.endsWith("page.vzi")).toBe(true);
  });

  it("returns [] when the artifacts dir does not exist", async () => {
    const productsRoot = await mkdtemp(join(tmpdir(), "forma-handoff-"));
    dirs.push(productsRoot);
    const pages = await listArchivedHandoffPages(productsRoot, PRODUCT_ID, "R-1");
    expect(pages).toEqual([]);
  });

  it("filters out pages not in the current page-id set", async () => {
    const productsRoot = await mkdtemp(join(tmpdir(), "forma-handoff-"));
    dirs.push(productsRoot);
    await seedArtifact(productsRoot, "A-home", {
      requirementId: "R-1",
      generatedFrom: "requirement-archive",
      pageId: "home",
      sourceVersion: 1,
      icons: [],
    });
    const pages = await listArchivedHandoffPages(productsRoot, PRODUCT_ID, "R-1", new Set(["settings"]));
    expect(pages).toEqual([]);
  });

  it("does not drop an archived manifest when page.vzi is missing", async () => {
    const productsRoot = await mkdtemp(join(tmpdir(), "forma-handoff-"));
    dirs.push(productsRoot);
    const iconsManifestPath = getArtifactIconsManifestPath(productsRoot, PRODUCT_ID, "A-missing-vzi");
    await mkdir(join(iconsManifestPath, ".."), { recursive: true });
    await writeFile(
      iconsManifestPath,
      JSON.stringify({
        requirementId: "R-1",
        generatedFrom: "requirement-archive",
        pageId: "missing",
        sourceVersion: 1,
        icons: [],
      }),
      "utf8",
    );
    await mkdir(join(getArtifactsDir(productsRoot, PRODUCT_ID), "A-missing-vzi", "v1"), { recursive: true });
    await writeFile(
      join(getArtifactsDir(productsRoot, PRODUCT_ID), "A-missing-vzi", "v1", "index.html"),
      "<html></html>",
      "utf8",
    );

    const pages = await listArchivedHandoffPages(productsRoot, PRODUCT_ID, "R-1");
    expect(pages).toHaveLength(1);
    expect(pages[0].artifactId).toBe("A-missing-vzi");
  });
});
