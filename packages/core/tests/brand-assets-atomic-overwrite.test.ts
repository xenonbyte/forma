import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrandAssetDeps } from "@xenonbyte/forma-core";

const PRODUCT_ID = "P-7e5702";

async function makeSquarePng(size: number, color: string): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 4, background: color } })
    .png()
    .toBuffer();
}

function makeDeps(core: typeof import("@xenonbyte/forma-core"), home: string): BrandAssetDeps {
  const lock = core.getProductMutationLock(home);
  return {
    home,
    runProductMutation: (input, fn) => core.runProductMutationWithWarnings(lock, input, fn, () => undefined),
  };
}

describe("saveBrandAsset — durable overwrite", () => {
  afterEach(() => {
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("keeps the previous files readable when replacement directory activation fails", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-brand-assets-atomic-"));
    let failNextAssetRename = false;
    let injectedFailures = 0;

    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        rename: vi.fn(
          async (oldPath: Parameters<typeof actual.rename>[0], newPath: Parameters<typeof actual.rename>[1]) => {
            const from = String(oldPath);
            const to = String(newPath);
            if (
              failNextAssetRename &&
              from.includes("/brand-assets/app-icon/primary.tmp-") &&
              to.includes("/brand-assets/app-icon/primary")
            ) {
              failNextAssetRename = false;
              injectedFailures += 1;
              throw Object.assign(new Error("injected brand asset rename failure"), { code: "EIO" });
            }
            return actual.rename(oldPath, newPath);
          },
        ),
      };
    });

    const core = await import("@xenonbyte/forma-core");
    const deps = makeDeps(core, home);

    const firstImage = await makeSquarePng(2048, "#cc0000");
    const firstStaged = await core.putStagedImage(home, PRODUCT_ID, firstImage, {
      purpose: "app-icon",
      prompt: "first",
      model: "stub",
      width: 2048,
      height: 2048,
    });
    await core.saveBrandAsset(deps, {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "primary",
      brand_style: "ant",
      source: { image_ref: firstStaged.ref },
      platform: "web",
    });

    const secondImage = await makeSquarePng(2048, "#00cc00");
    const secondStaged = await core.putStagedImage(home, PRODUCT_ID, secondImage, {
      purpose: "app-icon",
      prompt: "second",
      model: "stub",
      width: 2048,
      height: 2048,
    });
    failNextAssetRename = true;

    await expect(
      core.saveBrandAsset(deps, {
        product_id: PRODUCT_ID,
        kind: "app-icon",
        name: "primary",
        brand_style: "ant",
        source: { image_ref: secondStaged.ref },
        platform: "web",
      }),
    ).rejects.toThrow("injected brand asset rename failure");

    expect(injectedFailures).toBe(1);
    const preserved = await core.resolveBrandImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon");
    const stats = await sharp(preserved).stats();
    expect(stats.channels[0].mean).toBeGreaterThan(stats.channels[1].mean);
  });
});
