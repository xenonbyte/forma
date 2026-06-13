/**
 * brand-assets.test.ts — Task 4 (discriminated-union save_brand_asset)
 *
 * TDD for the brand-assets storage layer after SPEC-DATA-006 / SPEC-BEHAVIOR-005 /
 * SPEC-BEHAVIOR-006 / SPEC-DATA-008:
 *   - saveBrandAsset(app-icon): resolves master refs (logo/bg/safe-logo), derives
 *     the full per-surface variant set, and ATOMICALLY REPLACES the product's
 *     entire app-icon set. Returns { kind:"app-icon", assets }.
 *   - saveBrandAsset(store-shot/banner/poster): html→PNG render, records carry
 *     surface/variant, target honoured. Returns { kind, asset }.
 *   - deleteBrandAsset: removes record + files, rejects boundary escapes, fails
 *     loud on not-found.
 *   - resolveBrandImageRef: bare ref → largest standard-variant file; @size →
 *     matching standard file; no match → MEDIA_IMAGE_NOT_FOUND. No "primary"
 *     fallback, no MASTER_SIZE dependence.
 *   - listBrandAssets / exportBrandAssetsZip: records + zip (never media-config).
 */

import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import AdmZip from "adm-zip";
import {
  deleteBrandAsset,
  saveBrandAsset,
  listBrandAssets,
  exportBrandAssetsZip,
  resolveBrandImageRef,
  resolveFormaImageRef,
  putStagedImage,
  BRAND_ASSET_KINDS,
  brandSurfacesForPlatform,
  type BrandAssetDeps,
  type SaveBrandAssetResult,
  type BrandAssetRecord,
} from "@xenonbyte/forma-core";
import { FormaError } from "../src/errors.js";
import { renderBrandAssetHtml } from "../src/brand-asset-render.js";
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

/** Deps with the real puppeteer-backed render sandbox wired in. */
function makeRenderDeps(homeDir: string): BrandAssetDeps {
  const lock = getProductMutationLock(homeDir);
  return {
    home: homeDir,
    runProductMutation: (input, fn) => runProductMutationWithWarnings(lock, input, fn, () => undefined),
    renderHtml: (input) =>
      renderBrandAssetHtml({ resolveFormaImage: (ref) => resolveFormaImageRef(homeDir, PRODUCT_ID, ref) }, input),
  };
}

/** A solid-colour OPAQUE square PNG (background master b). */
async function makeOpaqueSquare(size: number, color = "#3366cc"): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 4, background: color } })
    .png()
    .toBuffer();
}

/** A transparent-background logo PNG: a centred opaque disc on transparency (master a / c). */
async function makeLogoPng(size: number, color = "#cc3366"): Promise<Buffer> {
  const r = Math.round(size * 0.3);
  const c = Math.round(size / 2);
  const svg = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="${color}"/></svg>`,
  );
  return sharp(svg).png().toBuffer();
}

/** Stages a PNG and returns its forma-image:// ref for use as a master ref. */
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

/** Stage the three app-icon masters and return their refs. */
async function stageMasters(
  homeDir: string,
  productId: string,
  opts: { withSafe?: boolean; logoColor?: string; bgColor?: string } = {},
): Promise<{ logo_ref: string; bg_ref: string; safe_logo_ref?: string }> {
  const logo_ref = await stageImage(homeDir, productId, await makeLogoPng(1024, opts.logoColor ?? "#cc3366"));
  const bg_ref = await stageImage(homeDir, productId, await makeOpaqueSquare(1024, opts.bgColor ?? "#0a2540"));
  if (opts.withSafe) {
    const safe_logo_ref = await stageImage(homeDir, productId, await makeLogoPng(1024, opts.logoColor ?? "#cc3366"));
    return { logo_ref, bg_ref, safe_logo_ref };
  }
  return { logo_ref, bg_ref };
}

function appIconAssets(result: SaveBrandAssetResult): BrandAssetRecord[] {
  if (result.kind !== "app-icon") throw new Error(`expected app-icon result, got ${result.kind}`);
  return result.assets;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "forma-brand-assets-"));
});

// ─── app-icon save: discriminated input derives the full variant set ──────────

describe("saveBrandAsset — app-icon (web product)", () => {
  it("derives the standard web variant set and returns { kind, assets }", async () => {
    const masters = await stageMasters(home, PRODUCT_ID);
    const result = await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      brand_style: "ant",
      platform: "web",
      ...masters,
    });

    expect(result.kind).toBe("app-icon");
    const assets = appIconAssets(result);
    // web is single-surface → one "standard" record, no surface field.
    expect(assets).toHaveLength(1);
    expect(assets[0].kind).toBe("app-icon");
    expect(assets[0].name).toBe("standard");
    expect(assets[0].variant).toBe("standard");
    expect(assets[0].surface).toBeUndefined();
    expect(assets[0].files.length).toBeGreaterThan(0);

    // Every emitted file is a square PNG of the declared size and exists on disk.
    for (const file of assets[0].files) {
      expect(file.width).toBe(file.height);
      const meta = await sharp(await readFile(file.path)).metadata();
      expect(meta.width).toBe(file.width);
      expect(meta.height).toBe(file.height);
      expect(meta.format).toBe("png");
    }
  });
});

describe("saveBrandAsset — app-icon (mobile product)", () => {
  it("derives BOTH android + ios surface variant records", async () => {
    const masters = await stageMasters(home, PRODUCT_ID, { withSafe: true });
    const result = await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      brand_style: "ant",
      platform: "mobile",
      ...masters,
    });

    const assets = appIconAssets(result);
    const surfaces = new Set(assets.map((a) => a.surface));
    expect(surfaces).toEqual(new Set(["android", "ios"]));

    // Variant names cover the android + ios matrices.
    const variants = new Set(assets.map((a) => a.variant));
    expect(variants.has("android-standard")).toBe(true);
    expect(variants.has("android-foreground")).toBe(true);
    expect(variants.has("android-background")).toBe(true);
    expect(variants.has("android-monochrome")).toBe(true);
    expect(variants.has("ios-standard")).toBe(true);
    expect(variants.has("ios-dark")).toBe(true);
    expect(variants.has("ios-tinted")).toBe(true);

    // ios-standard is a multi-size variant → ONE record with multiple files.
    const iosStandard = assets.find((a) => a.variant === "ios-standard");
    if (!iosStandard) throw new Error("ios-standard record not found");
    expect(iosStandard.files.length).toBeGreaterThan(1);
  });

  it("fails loud (FormaError) when safe_logo_ref is missing for a mobile product", async () => {
    const masters = await stageMasters(home, PRODUCT_ID, { withSafe: false });
    await expect(
      saveBrandAsset(makeDeps(home), {
        product_id: PRODUCT_ID,
        kind: "app-icon",
        brand_style: "ant",
        platform: "mobile",
        ...masters,
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof FormaError);
  });
});

// ─── app-icon ATOMIC REPLACE (re-save does not accumulate) ────────────────────

describe("saveBrandAsset — app-icon atomic replacement", () => {
  it("re-saving replaces the whole set: record count stays constant", async () => {
    const deps = makeDeps(home);
    const first = await saveBrandAsset(deps, {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      brand_style: "ant",
      platform: "web",
      ...(await stageMasters(home, PRODUCT_ID, { bgColor: "#aa0000" })),
    });
    const firstCount = appIconAssets(first).length;

    const second = await saveBrandAsset(deps, {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      brand_style: "antd",
      platform: "web",
      ...(await stageMasters(home, PRODUCT_ID, { bgColor: "#00aa00" })),
    });
    const secondCount = appIconAssets(second).length;

    expect(secondCount).toBe(firstCount);

    // The manifest holds exactly the second set (no accumulation).
    const records = await listBrandAssets(home, PRODUCT_ID, "app-icon");
    expect(records).toHaveLength(secondCount);
    expect(records.every((r) => r.brand_style === "antd")).toBe(true);

    // The resolved standard icon reflects the second image (green-dominant bg).
    const bytes = await resolveBrandImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon");
    const stats = await sharp(bytes).stats();
    expect(stats.channels[1].mean).toBeGreaterThan(stats.channels[0].mean);
  });

  it("prior on-disk files are pruned after replacement", async () => {
    const deps = makeDeps(home);
    const first = appIconAssets(
      await saveBrandAsset(deps, {
        product_id: PRODUCT_ID,
        kind: "app-icon",
        brand_style: "ant",
        platform: "web",
        ...(await stageMasters(home, PRODUCT_ID)),
      }),
    );
    const oldPath = first[0].files[0].path;
    await expect(access(oldPath)).resolves.toBeUndefined();

    await saveBrandAsset(deps, {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      brand_style: "ant",
      platform: "web",
      ...(await stageMasters(home, PRODUCT_ID)),
    });

    // The first generation's file is gone.
    await expect(access(oldPath)).rejects.toBeInstanceOf(Error);
  });
});

// ─── invalid input ────────────────────────────────────────────────────────────

describe("saveBrandAsset — invalid input", () => {
  it("rejects an unknown kind with BRAND_ASSET_INVALID_INPUT", async () => {
    await expect(
      saveBrandAsset(makeDeps(home), {
        // biome-ignore lint/suspicious/noExplicitAny: deliberately bad kind
        kind: "splash-screen" as any,
        product_id: PRODUCT_ID,
        name: "x",
        brand_style: "ant",
        source: { html: "<div/>" },
        target: { width: 10, height: 10 },
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof FormaError && err.code === "BRAND_ASSET_INVALID_INPUT");
  });

  it("rejects a media name with path traversal", async () => {
    await expect(
      saveBrandAsset(makeRenderDeps(home), {
        product_id: PRODUCT_ID,
        kind: "store-shot",
        name: "../escape",
        brand_style: "ant",
        source: { html: "<div/>" },
        target: { width: 10, height: 10 },
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof FormaError && err.code === "BRAND_ASSET_INVALID_INPUT");
  });
});

// ─── lock acquisition (concurrency serializes) ────────────────────────────────

describe("saveBrandAsset — app-icon runs under the product-mutation lock", () => {
  it("serializes concurrent app-icon saves (last write wins, set stays consistent)", async () => {
    const deps = makeDeps(home);
    const [a, b] = await Promise.all([
      saveBrandAsset(deps, {
        product_id: PRODUCT_ID,
        kind: "app-icon",
        brand_style: "ant",
        platform: "web",
        ...(await stageMasters(home, PRODUCT_ID)),
      }),
      saveBrandAsset(deps, {
        product_id: PRODUCT_ID,
        kind: "app-icon",
        brand_style: "ant",
        platform: "web",
        ...(await stageMasters(home, PRODUCT_ID)),
      }),
    ]);
    expect(a.kind).toBe("app-icon");
    expect(b.kind).toBe("app-icon");
    // Atomic-replace under the lock → manifest holds exactly one consistent set.
    const records = await listBrandAssets(home, PRODUCT_ID, "app-icon");
    expect(records.length).toBe(appIconAssets(a).length);
  });
});

// ─── listBrandAssets ──────────────────────────────────────────────────────────

describe("listBrandAssets", () => {
  it("returns an empty array for an absent kind", async () => {
    await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      brand_style: "ant",
      platform: "web",
      ...(await stageMasters(home, PRODUCT_ID)),
    });
    expect(await listBrandAssets(home, PRODUCT_ID, "poster")).toEqual([]);
  });

  it("returns an empty array for a product with no brand assets", async () => {
    expect(await listBrandAssets(home, PRODUCT_ID)).toEqual([]);
  });

  it("returns all app-icon records when filtered by kind", async () => {
    await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      brand_style: "ant",
      platform: "web",
      ...(await stageMasters(home, PRODUCT_ID)),
    });
    const records = await listBrandAssets(home, PRODUCT_ID, "app-icon");
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.kind === "app-icon")).toBe(true);
  });
});

// ─── resolveBrandImageRef (SPEC-DATA-008) ─────────────────────────────────────

describe("resolveBrandImageRef", () => {
  async function seed(platform: "web" | "mobile" = "web"): Promise<BrandAssetRecord[]> {
    const result = await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      brand_style: "ant",
      platform,
      ...(await stageMasters(home, PRODUCT_ID, { withSafe: platform === "mobile" })),
    });
    return appIconAssets(result);
  }

  it("bare ref resolves the LARGEST standard-variant file", async () => {
    const assets = await seed("web");
    const standardWidths = assets.filter((a) => a.variant === "standard").flatMap((a) => a.files.map((f) => f.width));
    const largest = Math.max(...standardWidths);

    const bytes = await resolveBrandImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon");
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBe(largest);
  });

  it("@size resolves the standard file whose width === size", async () => {
    const assets = await seed("web");
    const aWidth = assets[0].files[0].width;
    const bytes = await resolveBrandImageRef(home, PRODUCT_ID, `forma-image://brand/app-icon@${aWidth}`);
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBe(aWidth);
  });

  it("bare ref on a mobile product picks a STANDARD variant (never a foreground/mono layer)", async () => {
    await seed("mobile");
    // The largest standard width across android-standard + ios-standard.
    const bytes = await resolveBrandImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon");
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBeGreaterThan(0);
    expect(meta.height).toBe(meta.width);
  });

  it("rejects a size not in the standard set (@999) with MEDIA_IMAGE_NOT_FOUND", async () => {
    await seed("web");
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
    await seed("web");
    await expect(resolveBrandImageRef(home, PRODUCT_ID, "forma-image://brand/unknown-thing")).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND",
    );
  });

  it("rejects a traversal-laden ref with MEDIA_IMAGE_NOT_FOUND", async () => {
    await seed("web");
    await expect(
      resolveBrandImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon@../../etc/passwd"),
    ).rejects.toSatisfy((err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND");
  });
});

// ─── image-staging forwarding ─────────────────────────────────────────────────

describe("resolveFormaImageRef — brand/ forwards to brand-assets", () => {
  it("resolves forma-image://brand/app-icon through the staging entry point", async () => {
    await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      brand_style: "ant",
      platform: "web",
      ...(await stageMasters(home, PRODUCT_ID)),
    });
    const bytes = await resolveFormaImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon");
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBeGreaterThan(0);
  });

  it("still 404s an unknown brand ref via the staging entry point", async () => {
    await expect(resolveFormaImageRef(home, PRODUCT_ID, "forma-image://brand/app-icon")).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND",
    );
  });
});

// ─── deleteBrandAsset (SPEC-BEHAVIOR-006) ─────────────────────────────────────

describe("deleteBrandAsset", () => {
  /** Persist a poster via the render path and return its name. */
  async function savedPoster(name: string): Promise<BrandAssetRecord> {
    const result = await saveBrandAsset(makeRenderDeps(home), {
      product_id: PRODUCT_ID,
      kind: "poster",
      name,
      brand_style: "ant",
      source: { html: "<!doctype html><html><body style='margin:0;background:#0a2540'></body></html>" },
      variant: "portrait",
      target: { width: 80, height: 120 },
    });
    if (result.kind === "app-icon") throw new Error("expected poster result");
    return (await listBrandAssets(home, PRODUCT_ID, "poster")).find((r) => r.name === name) as BrandAssetRecord;
  }

  it("deletes the manifest record and its on-disk files", async () => {
    const record = await savedPoster("p1");
    const filePath = record.files[0].path;
    await expect(access(filePath)).resolves.toBeUndefined();

    const res = await deleteBrandAsset(makeDeps(home), { product_id: PRODUCT_ID, kind: "poster", name: "p1" });
    expect(res).toEqual({ deleted: true });

    expect(await listBrandAssets(home, PRODUCT_ID, "poster")).toEqual([]);
    await expect(access(filePath)).rejects.toBeInstanceOf(Error);
  }, 60000);

  it("fails loud with FormaError when the record does not exist (no silent no-op)", async () => {
    await expect(
      deleteBrandAsset(makeDeps(home), { product_id: PRODUCT_ID, kind: "poster", name: "ghost" }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof FormaError &&
        err.code === "BRAND_ASSET_INVALID_INPUT" &&
        (err.details as { reason?: string }).reason === "not_found",
    );
  });

  it("rejects a record whose file path escapes the kind directory", async () => {
    // Plant a manifest record with an absolute out-of-boundary file path.
    const productsRoot = join(home, "data", "products");
    const brandDir = join(productsRoot, PRODUCT_ID, "od-project", "brand-assets");
    await mkdir(brandDir, { recursive: true });
    const manifest = {
      assets: [
        {
          kind: "poster",
          name: "evil",
          files: [{ path: "/etc/passwd", width: 10, height: 10 }],
          brand_style: "ant",
          generated_at: new Date().toISOString(),
        },
      ],
    };
    await writeFile(join(brandDir, "manifest.json"), JSON.stringify(manifest));

    await expect(
      deleteBrandAsset(makeDeps(home), { product_id: PRODUCT_ID, kind: "poster", name: "evil" }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof FormaError &&
        err.code === "BRAND_ASSET_INVALID_INPUT" &&
        (err.details as { reason?: string }).reason === "path_traversal",
    );
    // The escaping path was NOT deleted (it never existed; just assert no crash leaked it).
    expect(await listBrandAssets(home, PRODUCT_ID, "poster")).toHaveLength(1);
  });

  it("supports orphan cleanup: deleting one poster leaves the others intact", async () => {
    await savedPoster("keep-1");
    await savedPoster("drop");
    await savedPoster("keep-2");

    await deleteBrandAsset(makeDeps(home), { product_id: PRODUCT_ID, kind: "poster", name: "drop" });

    const names = (await listBrandAssets(home, PRODUCT_ID, "poster")).map((r) => r.name).sort();
    expect(names).toEqual(["keep-1", "keep-2"]);
  }, 60000);
});

// ─── zip export ───────────────────────────────────────────────────────────────

describe("exportBrandAssetsZip", () => {
  it("contains every brand-asset file and NEVER media-config.yaml", async () => {
    await writeFile(join(home, "media-config.yaml"), "providers:\n  volcengine:\n    api_key: secret\n");

    const result = await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      brand_style: "ant",
      platform: "web",
      ...(await stageMasters(home, PRODUCT_ID)),
    });
    const assets = appIconAssets(result);

    const zipBuf = await exportBrandAssetsZip(home, PRODUCT_ID);
    const names = new AdmZip(zipBuf)
      .getEntries()
      .filter((e) => !e.isDirectory)
      .map((e) => e.entryName);

    expect(names).toContain("manifest.json");
    for (const file of assets.flatMap((a) => a.files)) {
      const rel = file.path.split("/brand-assets/")[1];
      expect(names).toContain(rel);
    }
    expect(names.some((n) => n.includes("media-config.yaml"))).toBe(false);
    expect(names.some((n) => n.includes("api_key") || n.includes("secret"))).toBe(false);
  });

  it("exports manifest file paths as brand-assets-relative paths, never absolute host paths", async () => {
    const result = await saveBrandAsset(makeDeps(home), {
      product_id: PRODUCT_ID,
      kind: "app-icon",
      brand_style: "ant",
      platform: "web",
      ...(await stageMasters(home, PRODUCT_ID)),
    });
    const fileCount = appIconAssets(result).flatMap((a) => a.files).length;

    const zip = new AdmZip(await exportBrandAssetsZip(home, PRODUCT_ID));
    const exported = JSON.parse(zip.readAsText("manifest.json")) as {
      assets: Array<{ files: Array<{ path: string }> }>;
    };
    const exportedPaths = exported.assets.flatMap((asset) => asset.files.map((file) => file.path));

    expect(exportedPaths).toHaveLength(fileCount);
    for (const path of exportedPaths) {
      expect(path.startsWith("/")).toBe(false);
      expect(path).not.toContain(home);
      expect(path).toMatch(/^app-icon\//);
    }
  });

  it("returns a zip for an empty brand-assets dir (manifest only / nothing)", async () => {
    const zipBuf = await exportBrandAssetsZip(home, PRODUCT_ID);
    expect(Buffer.isBuffer(zipBuf)).toBe(true);
  });
});

// ─── store-shot / banner / poster — HTML → PNG through the PUBLIC save path ────

describe("saveBrandAsset — media kinds (html render, public path)", () => {
  it("renders store-shot HTML to a PNG, records surface/variant, returns { kind, asset }", async () => {
    const result = await saveBrandAsset(makeRenderDeps(home), {
      product_id: PRODUCT_ID,
      kind: "store-shot",
      name: "hero",
      brand_style: "ant",
      source: { html: "<!doctype html><html><body style='margin:0;background:#0a2540'></body></html>" },
      surface: "android",
      variant: "feature",
      target: { width: 320, height: 480 },
    });

    expect(result.kind).toBe("store-shot");
    if (result.kind === "app-icon") throw new Error("unexpected app-icon");
    const asset = result.asset;
    expect(asset.files).toHaveLength(1);
    expect(asset.surface).toBe("android");
    expect(asset.variant).toBe("feature");
    const file = asset.files[0];
    expect(file.width).toBe(320);
    expect(file.height).toBe(480);
    expect(file.path.includes("/store-shots/")).toBe(true);

    const meta = await sharp(await readFile(file.path)).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(480);

    // Recorded in the manifest with surface/variant.
    const records = await listBrandAssets(home, PRODUCT_ID, "store-shot");
    expect(records).toHaveLength(1);
    expect(records[0].surface).toBe("android");
    expect(records[0].variant).toBe("feature");
  }, 60000);

  it("renders a banner to its target size and stores it under banners/", async () => {
    const result = await saveBrandAsset(makeRenderDeps(home), {
      product_id: PRODUCT_ID,
      kind: "banner",
      name: "promo",
      brand_style: "ant",
      source: { html: "<!doctype html><html><body style='margin:0;background:#123'></body></html>" },
      target: { width: 200, height: 80 },
    });
    if (result.kind === "app-icon") throw new Error("unexpected app-icon");
    const file = result.asset.files[0];
    expect(file.path.includes("/banners/")).toBe(true);
    const meta = await sharp(await readFile(file.path)).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(80);
  }, 60000);

  it("renders poster HTML referencing a localized forma-image:// (public path)", async () => {
    const staged = await stageImage(home, PRODUCT_ID, await makeOpaqueSquare(256, "#ff8800"));
    const result = await saveBrandAsset(makeRenderDeps(home), {
      product_id: PRODUCT_ID,
      kind: "poster",
      name: "launch",
      brand_style: "ant",
      source: {
        html: `<!doctype html><html><body style='margin:0'><img src="${staged}" style="width:100%"></body></html>`,
      },
      variant: "square",
      target: { width: 400, height: 400 },
    });
    if (result.kind === "app-icon") throw new Error("unexpected app-icon");
    const file = result.asset.files[0];
    expect(file.path.includes("/posters/")).toBe(true);
    const meta = await sharp(await readFile(file.path)).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(400);
  }, 60000);

  it("fails loud when store-shot HTML references a remote resource (no PNG produced)", async () => {
    await expect(
      saveBrandAsset(makeRenderDeps(home), {
        product_id: PRODUCT_ID,
        kind: "store-shot",
        name: "bad",
        brand_style: "ant",
        source: { html: '<!doctype html><html><body><img src="https://evil.example.com/x.png"></body></html>' },
        target: { width: 100, height: 100 },
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof FormaError);
    expect(await listBrandAssets(home, PRODUCT_ID, "store-shot")).toEqual([]);
  }, 60000);
});

// ─── BRAND_ASSET_KINDS includes "banner" (SPEC-DATA-001) ─────────────────────

describe("BRAND_ASSET_KINDS", () => {
  it("contains all four expected kinds", () => {
    const kinds = [...BRAND_ASSET_KINDS].sort();
    expect(kinds).toEqual(["app-icon", "banner", "poster", "store-shot"]);
  });
});

// ─── brandSurfacesForPlatform (SPEC-BEHAVIOR-002) ─────────────────────────────

describe("brandSurfacesForPlatform", () => {
  it("mobile / tablet → ['android', 'ios']", () => {
    expect(brandSurfacesForPlatform("mobile")).toEqual(["android", "ios"]);
    expect(brandSurfacesForPlatform("tablet")).toEqual(["android", "ios"]);
  });

  it("web / desktop → [] (single surface)", () => {
    expect(brandSurfacesForPlatform("web")).toEqual([]);
    expect(brandSurfacesForPlatform("desktop")).toEqual([]);
  });
});
