import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { DesignPointer } from "../src/product.js";
import type { CaptureRequirementVziDeps } from "../src/requirement-vzi-capture.js";

const parserOptions = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("@vzi-core/parser", () => {
  const fakeIR: import("@vzi-core/types").IntermediateRepresentation = {
    version: "1.0",
    rootElementId: "el-root",
    elements: {
      "el-root": {
        id: "el-root",
        parentId: null,
        type: "container",
        bounds: { x: 0, y: 0, width: 1024, height: 768 },
        styles: { display: "block" },
      },
    },
    metadata: { title: "base-url-test" },
  };

  class MockPuppeteerParser {
    constructor(options: Record<string, unknown>) {
      parserOptions.push(options);
    }

    async parse() {
      return fakeIR;
    }

    async dispose() {
      return undefined;
    }
  }

  return {
    PuppeteerParser: MockPuppeteerParser,
    VIEWPORT_PRESETS: {
      mobile: { width: 390, height: 884 },
      tablet: { width: 768, height: 1024 },
      desktop: { width: 1024, height: 1280 },
    },
  };
});

const { captureRequirementVzi } = await import("../src/requirement-vzi-capture.js");
const { getArtifactVersionDir } = await import("../src/artifact-paths.js");

describe("captureRequirementVzi parser baseUrl", () => {
  it("passes the artifact version directory to PuppeteerParser for localized assets", async () => {
    parserOptions.length = 0;
    const home = await mkdtemp(join(tmpdir(), "forma-vzi-base-url-"));
    try {
      const productsRoot = join(home, "products");
      const productId = "P-aabbcc";
      const requirementId = "R-aabbccdd";
      const artifactId = "ArtAAAAAAAAAAAAA";
      const version = 1;
      const versionDir = getArtifactVersionDir(productsRoot, productId, artifactId, version);
      await mkdir(versionDir, { recursive: true });
      await writeFile(
        join(versionDir, "index.html"),
        `<!DOCTYPE html><html><body><img src="assets/logo.png"></body></html>`,
        "utf8",
      );

      const pointer: DesignPointer = {
        requirementId,
        pageId: "page-home",
        variant: "default",
        artifactId,
        version,
        designStatus: "active",
      };

      const deps: CaptureRequirementVziDeps = {
        productsRoot,
        getProductPlatform: async () => "desktop",
        listDesignPointers: async () => [pointer],
        readFile: (path) => readFile(path),
        writeFile: async (path, data) => {
          await mkdir(join(path, ".."), { recursive: true });
          await writeFile(path, data);
        },
        rmDir: (path) => rm(path, { recursive: true, force: true }),
        rename: (src, dest) => rename(src, dest),
        mkdir: async (path) => {
          await mkdir(path, { recursive: true });
        },
      };

      await captureRequirementVzi(deps, { productId, requirementId });

      expect(parserOptions).toHaveLength(1);
      expect(parserOptions[0]).toMatchObject({
        viewportPreset: "desktop",
        baseUrl: pathToFileURL(`${versionDir}/`).toString(),
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
