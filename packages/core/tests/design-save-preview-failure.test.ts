/**
 * Pins the R11 safety property: if the sandboxed Chromium launch fails on an
 * exotic environment, the save still succeeds with previewStatus "failed".
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/preview-renderer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/preview-renderer.js")>();
  return {
    ...actual,
    renderArtifactPreview: vi.fn(async () => {
      throw new Error("chromium sandbox launch failed");
    }),
  };
});

import { saveDesignArtifact } from "../src/design-save.js";
import { createFormaStore } from "../src/store.js";
import { getFormaPaths } from "../src/paths.js";

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("design save when preview rendering fails (R11)", () => {
  it("persists the artifact with previewStatus failed", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-preview-fail-"));
    homes.push(home);
    const store = await createFormaStore({ home });

    const result = await saveDesignArtifact(
      { artifacts: store.artifacts, products: store.products, productsRoot: getFormaPaths(home).productsDir },
      {
        productId: "P-0abc12",
        kind: "component-library",
        html: "<html><body><p>ok</p></body></html>",
        title: "Components",
        forma: {},
      },
    );

    expect(result.previewStatus).toBe("failed");
    expect(result.version).toBe(1);
    expect(result.artifactId).toMatch(/^[a-zA-Z0-9]{16}$/);
  });
});
