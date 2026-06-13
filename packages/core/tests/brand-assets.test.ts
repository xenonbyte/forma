/**
 * brand-assets.test.ts — PLAN-TASK-015 (M3)
 *
 * TDD for the brand-assets storage layer:
 *   - saveBrandAsset (app-icon path): 2048 master + per-platform derivative set
 *     + favicon, atomic under the product-mutation lock, manifest overwrite
 *     semantics (same kind+name replaces).
 *   - listBrandAssets: records, empty for absent kind.
 *   - resolveBrandImageRef: brand/app-icon → master, @<size> → derivative,
 *     unknown size / missing asset → MEDIA_IMAGE_NOT_FOUND.
 *   - exportBrandAssetsZip: contains every file, NEVER media-config.yaml.
 *   - path-boundary: traversal in name/ref is rejected.
 *
 * Spec: SPEC-BEHAVIOR-006, SPEC-BEHAVIOR-008, SPEC-BEHAVIOR-004.
 */

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import AdmZip from "adm-zip";
import {
  saveBrandAsset,
  listBrandAssets,
  exportBrandAssetsZip,
  resolveBrandImageRef,
  resolveFormaImageRef,
  putStagedImage,
  APP_ICON_SIZES,
  type BrandAssetDeps,
  type SavedBrandAsset,
  type BrandAssetRecord,
} from "@xenonbyte/forma-core";
import { FormaError } from "../src/errors.js";
import { getProductMutationLock, runProductMutationWithWarnings } from "../src/product-mutation-lock.js";

const PRODUCT_ID = "P-7e5701";

let home: string;

/** A real product-mutation lock bound to `home`, wrapped like the store does. */
function makeDeps(homeDir: string): BrandAssetDeps {
  const lock = getProductMutationLock(homeDir);
  return {
    home: homeDir,
    runProductMutation: (input, fn) => runProductMutationWithWarnings(lock, input, fn, () => undefined),
  };
}

/** Produces a solid-colour square PNG at the given pixel size. */
async function makeSquarePng(size: number, color = "#3366cc"): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 4, background: color } })
    .png()
    .toBuffer();
}

/** Stages a PNG and returns its forma-image:// ref for use as a source image_ref. */
async function stageImage(homeDir: string, productId: string, bytes: Buffer): Promise<string> {
  const meta = await sharp(bytes).metadata();
  const staged = await putStagedImage(homeDir, productId, bytes, {
    purpose: "app-icon",
    prompt: "brand icon",
    model: "stub",
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  });
  return staged.ref;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "forma-brand-assets-"));
});

// ─── app-icon save: master + platform set + favicon ───────────────────────────

describe("saveBrandAsset — app-icon (web product)", () => {
  it("derives the web size set + 2048 master + favicon", async () => {
    const ref = await stageImage(home, PRODUCT_ID, await makeSquarePng(2048));
    const saved = await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "primary",
      brand_style: "ant",
      source: { image_ref: ref },
      platform: "web",
    });

    expect(saved.kind).toBe("app-icon");
    expect(saved.name).toBe("primary");

    const widths = saved.files.map((f) => f.width).sort((a, b) => a - b);
    // web set 512/192/32/16 + favicon 32/16 (deduped) + 2048 master
    expect(widths).toContain(2048);
    for (const w of APP_ICON_SIZES.web) {
      expect(widths).toContain(w);
    }

    // Every emitted file is a square PNG of the declared size.
    for (const file of saved.files) {
      expect(file.width).toBe(file.height);
      const buf = await readFile(file.path);
      const meta = await sharp(buf).metadata();
      expect(meta.width).toBe(file.width);
      expect(meta.height).toBe(file.height);
      expect(meta.format).toBe("png");
    }

    // master is exactly 2048
    const master = saved.files.find((f) => f.width === 2048);
    expect(master).toBeDefined();
  });

  it("emits a favicon file", async () => {
    const ref = await stageImage(home, PRODUCT_ID, await makeSquarePng(2048));
    const saved = await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "primary",
      brand_style: "ant",
      source: { image_ref: ref },
      platform: "web",
    });
    expect(saved.files.some((f) => f.path.includes("favicon"))).toBe(true);
  });
});

describe("saveBrandAsset — app-icon (mobile product)", () => {
  it("derives BOTH ios + android sets (plus master + favicon)", async () => {
    const ref = await stageImage(home, PRODUCT_ID, await makeSquarePng(2048));
    const saved = await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "primary",
      brand_style: "ant",
      source: { image_ref: ref },
      platform: "mobile",
    });
    const widths = new Set(saved.files.map((f) => f.width));
    for (const w of APP_ICON_SIZES.ios) expect(widths.has(w)).toBe(true);
    for (const w of APP_ICON_SIZES.android) expect(widths.has(w)).toBe(true);
    expect(widths.has(2048)).toBe(true);
  });
});

// ─── under-2048 master warns (upscales) ───────────────────────────────────────

describe("saveBrandAsset — under-2048 master", () => {
  it("upscales to 2048 and returns a warning", async () => {
    const ref = await stageImage(home, PRODUCT_ID, await makeSquarePng(512));
    const saved = await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "small",
      brand_style: "ant",
      source: { image_ref: ref },
      platform: "web",
    });
    expect(saved.warnings.some((w) => /upscale|2048|smaller/i.test(w))).toBe(true);
    const master = saved.files.find((f) => f.width === 2048);
    expect(master).toBeDefined();
    const buf = await readFile(master!.path);
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(2048);
  });
});

// ─── invalid input ────────────────────────────────────────────────────────────

describe("saveBrandAsset — BRAND_ASSET_INVALID_INPUT", () => {
  async function expectInvalid(input: Parameters<typeof saveBrandAsset>[1]): Promise<void> {
    await expect(saveBrandAsset(makeDeps(home), input)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "BRAND_ASSET_INVALID_INPUT",
    );
  }

  it("rejects neither source", async () => {
    await expectInvalid({
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "x",
      brand_style: "ant",
      source: {},
      platform: "web",
    });
  });

  it("rejects both sources", async () => {
    const ref = await stageImage(home, PRODUCT_ID, await makeSquarePng(2048));
    await expectInvalid({
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "x",
      brand_style: "ant",
      source: { image_ref: ref, html: "<div/>" },
      platform: "web",
    });
  });

  it("rejects app-icon given html (only image_ref allowed)", async () => {
    await expectInvalid({
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "x",
      brand_style: "ant",
      source: { html: "<div/>" },
      platform: "web",
    });
  });

  it("rejects an unknown kind", async () => {
    const ref = await stageImage(home, PRODUCT_ID, await makeSquarePng(2048));
    await expectInvalid({
      product_id: PRODUCT_ID,
      // biome-ignore lint/suspicious/noExplicitAny: deliberately bad kind
      kind: "banner" as any,
      name: "x",
      brand_style: "ant",
      source: { image_ref: ref },
      platform: "web",
    });
  });

  it("rejects a name with path traversal", async () => {
    const ref = await stageImage(home, PRODUCT_ID, await makeSquarePng(2048));
    await expectInvalid({
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "../escape",
      brand_style: "ant",
      source: { image_ref: ref },
      platform: "web",
    });
  });
});

// ─── manifest overwrite semantics ─────────────────────────────────────────────

describe("saveBrandAsset — manifest overwrite (same kind+name replaces)", () => {
  it("replaces the prior record for the same kind+name", async () => {
    const deps = makeDeps(home);
    const ref1 = await stageImage(home, PRODUCT_ID, await makeSquarePng(2048, "#aa0000"));
    await saveBrandAsset(deps, {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "primary",
      brand_style: "ant",
      source: { image_ref: ref1 },
      platform: "web",
    });
    const ref2 = await stageImage(home, PRODUCT_ID, await makeSquarePng(2048, "#00aa00"));
    const second = await saveBrandAsset(deps, {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "primary",
      brand_style: "antd",
      source: { image_ref: ref2 },
      platform: "web",
    });

    const records = await listBrandAssets(home, PRODUCT_ID, "app-icon");
    const primaries = records.filter((r) => r.name === "primary");
    expect(primaries).toHaveLength(1);
    expect(primaries[0].brand_style).toBe("antd");
    expect(primaries[0].generated_at).toBe(second.generated_at);

    // The resolved master must reflect the second image (green, not red).
    const master = await resolveBrandImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon");
    const stats = await sharp(master).stats();
    // green channel dominant
    expect(stats.channels[1].mean).toBeGreaterThan(stats.channels[0].mean);
  });
});

// ─── lock acquisition (concurrency serializes) ────────────────────────────────

describe("saveBrandAsset — runs under the product-mutation lock", () => {
  it("serializes concurrent saves for the same product", async () => {
    const deps = makeDeps(home);
    const refA = await stageImage(home, PRODUCT_ID, await makeSquarePng(2048));
    const refB = await stageImage(home, PRODUCT_ID, await makeSquarePng(2048));
    const [a, b] = await Promise.all([
      saveBrandAsset(deps, {
        product_id: PRODUCT_ID,
        kind: "app-icon",
        name: "a",
        brand_style: "ant",
        source: { image_ref: refA },
        platform: "web",
      }),
      saveBrandAsset(deps, {
        product_id: PRODUCT_ID,
        kind: "app-icon",
        name: "b",
        brand_style: "ant",
        source: { image_ref: refB },
        platform: "web",
      }),
    ]);
    expect(a.name).toBe("a");
    expect(b.name).toBe("b");
    // both records survive — no lost update from interleaved manifest writes
    const records = await listBrandAssets(home, PRODUCT_ID, "app-icon");
    expect(records.map((r) => r.name).sort()).toEqual(["a", "b"]);
  });
});

// ─── listBrandAssets ──────────────────────────────────────────────────────────

describe("listBrandAssets", () => {
  it("returns an empty array for an absent kind", async () => {
    const ref = await stageImage(home, PRODUCT_ID, await makeSquarePng(2048));
    await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "primary",
      brand_style: "ant",
      source: { image_ref: ref },
      platform: "web",
    });
    expect(await listBrandAssets(home, PRODUCT_ID, "poster")).toEqual([]);
  });

  it("returns an empty array for a product with no brand assets", async () => {
    expect(await listBrandAssets(home, PRODUCT_ID)).toEqual([]);
  });

  it("returns all records when no kind filter is given", async () => {
    const ref = await stageImage(home, PRODUCT_ID, await makeSquarePng(2048));
    await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "primary",
      brand_style: "ant",
      source: { image_ref: ref },
      platform: "web",
    });
    const all = await listBrandAssets(home, PRODUCT_ID);
    expect(all).toHaveLength(1);
    expect(all[0].files.length).toBeGreaterThan(0);
  });
});

// ─── resolveBrandImageRef ─────────────────────────────────────────────────────

describe("resolveBrandImageRef", () => {
  async function seed(): Promise<void> {
    const ref = await stageImage(home, PRODUCT_ID, await makeSquarePng(2048));
    await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "primary",
      brand_style: "ant",
      source: { image_ref: ref },
      platform: "web",
    });
  }

  it("resolves brand/app-icon to the 2048 master", async () => {
    await seed();
    const bytes = await resolveBrandImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon");
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBe(2048);
  });

  it("resolves brand/app-icon@512 to the 512px derivative", async () => {
    await seed();
    const bytes = await resolveBrandImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon@512");
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBe(512);
  });

  it("rejects a size not in the set (@999) with MEDIA_IMAGE_NOT_FOUND", async () => {
    await seed();
    await expect(resolveBrandImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon@999")).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND",
    );
  });

  it("rejects a missing brand asset with MEDIA_IMAGE_NOT_FOUND", async () => {
    await expect(resolveBrandImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon")).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND",
    );
  });

  it("rejects an unknown brand kind with MEDIA_IMAGE_NOT_FOUND", async () => {
    await seed();
    await expect(resolveBrandImageRef(home, PRODUCT_ID, "forma-image://brand/unknown-thing")).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND",
    );
  });

  it("rejects a traversal-laden ref with MEDIA_IMAGE_NOT_FOUND", async () => {
    await seed();
    await expect(
      resolveBrandImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon@../../etc/passwd"),
    ).rejects.toSatisfy((err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND");
  });
});

// ─── image-staging forwarding ─────────────────────────────────────────────────

describe("resolveFormaImageRef — brand/ forwards to brand-assets", () => {
  it("resolves forma-image://brand/app-icon through the staging entry point", async () => {
    const ref = await stageImage(home, PRODUCT_ID, await makeSquarePng(2048));
    await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "primary",
      brand_style: "ant",
      source: { image_ref: ref },
      platform: "web",
    });
    const bytes = await resolveFormaImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon");
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBe(2048);
  });

  it("still 404s an unknown brand ref via the staging entry point", async () => {
    await expect(resolveFormaImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon")).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND",
    );
  });
});

// ─── zip export ───────────────────────────────────────────────────────────────

describe("exportBrandAssetsZip", () => {
  it("contains every brand-asset file and NEVER media-config.yaml", async () => {
    // Plant a media-config.yaml at $FORMA_HOME root to prove it is never zipped.
    await writeFile(join(home, "media-config.yaml"), "providers:\n  volcengine:\n    api_key: secret\n");

    const ref = await stageImage(home, PRODUCT_ID, await makeSquarePng(2048));
    const saved = await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      name: "primary",
      brand_style: "ant",
      source: { image_ref: ref },
      platform: "web",
    });

    const zipBuf = await exportBrandAssetsZip(home, PRODUCT_ID);
    const names = new AdmZip(zipBuf)
      .getEntries()
      .filter((e) => !e.isDirectory)
      .map((e) => e.entryName);

    // manifest + every derivative present
    expect(names).toContain("manifest.json");
    for (const file of saved.files) {
      const rel = file.path.split("/brand-assets/")[1];
      expect(names).toContain(rel);
    }
    // never the credential file
    expect(names.some((n) => n.includes("media-config.yaml"))).toBe(false);
    expect(names.some((n) => n.includes("api_key") || n.includes("secret"))).toBe(false);
  });

  it("returns a zip for an empty brand-assets dir (manifest only / nothing)", async () => {
    const zipBuf = await exportBrandAssetsZip(home, PRODUCT_ID);
    expect(Buffer.isBuffer(zipBuf)).toBe(true);
  });
});

// ─── APP_ICON_SIZES shape ─────────────────────────────────────────────────────

describe("APP_ICON_SIZES", () => {
  it("matches the spec'd platform sets", () => {
    expect(APP_ICON_SIZES.ios).toEqual([1024, 180, 120]);
    expect(APP_ICON_SIZES.android).toEqual([512, 192, 144, 96, 72, 48]);
    expect(APP_ICON_SIZES.web).toEqual([512, 192, 32, 16]);
  });
});

// Keep type-only imports referenced so unused-import lint stays quiet and the
// public export surface is exercised.
const _types: [SavedBrandAsset?, BrandAssetRecord?] = [];
void _types;
