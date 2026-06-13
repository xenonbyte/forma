import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrandAssetDeps } from "@xenonbyte/forma-core";

const PRODUCT_ID = "P-7e5702";

/** Opaque background master (b). */
async function makeBackground(size: number, color: string): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 4, background: color } })
    .png()
    .toBuffer();
}

/** A tiny transparent-background logo (a) — kept small so the background dominates. */
async function makeLogo(size: number): Promise<Buffer> {
  const r = Math.round(size * 0.05);
  const c = Math.round(size / 2);
  return sharp(
    Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="#ffffff"/></svg>`),
  )
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

  it("keeps the previous app-icon set readable when replacement directory activation fails", async () => {
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
            // The app-icon generation activation renames `<kindDir>.tmp-XXXX` →
            // `<kindDir>/generation-...`. Fail that rename on demand.
            if (
              failNextAssetRename &&
              from.includes("/brand-assets/app-icon.tmp-") &&
              to.includes("/brand-assets/app-icon/generation-")
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

    const stage = async (png: Buffer): Promise<string> => {
      const meta = await sharp(png).metadata();
      const staged = await core.putStagedImage(home, PRODUCT_ID, png, {
        purpose: "app-icon",
        prompt: "master",
        model: "stub",
        width: meta.width ?? 0,
        height: meta.height ?? 0,
      });
      return staged.ref;
    };

    // First save: RED background → the resolved standard icon is red-dominant.
    await core.saveBrandAsset(deps, {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      brand_style: "ant",
      platform: "web",
      logo_ref: await stage(await makeLogo(1024)),
      bg_ref: await stage(await makeBackground(1024, "#cc0000")),
    });

    // Second save: GREEN background, but the activation rename fails.
    failNextAssetRename = true;
    await expect(
      core.saveBrandAsset(deps, {
        product_id: PRODUCT_ID,
        kind: "app-icon",
        brand_style: "ant",
        platform: "web",
        logo_ref: await stage(await makeLogo(1024)),
        bg_ref: await stage(await makeBackground(1024, "#00cc00")),
      }),
    ).rejects.toThrow("injected brand asset rename failure");

    expect(injectedFailures).toBe(1);

    // The previous (red) set is still readable — the manifest was never switched.
    const preserved = await core.resolveBrandImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon");
    const stats = await sharp(preserved).stats();
    expect(stats.channels[0].mean).toBeGreaterThan(stats.channels[1].mean);
  });
});
