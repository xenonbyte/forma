/**
 * brand-asset-render.ts — PLAN-TASK-016 (M3)
 *
 * The HTML → PNG render sandbox for store-shot / poster brand assets
 * (SPEC-BEHAVIOR-007, RISK-SEC-002 "render sandbox escape").
 *
 * Two layers, in this exact order:
 *
 *  ① PRE-RENDER LOCALIZE (same sequence as design-save: localize BEFORE render).
 *     The author HTML is run through localizeArtifactAssets — the identical
 *     localizer the design-save path uses. It:
 *       - resolves every forma-image:// reference (staging uuid OR brand/) to
 *         bytes via the injected resolver and writes them into the bundle's
 *         assets/ dir,
 *       - inlines/relativizes data: resources into the same assets/ dir,
 *       - REJECTS any http(s): / protocol-relative // reference up front
 *         (ARTIFACT_REMOTE_RESOURCE).
 *     The rewritten HTML + asset files are written to a fresh temp bundle dir.
 *     EVERYTHING the page legitimately needs now lives inside that one dir, so
 *     the browser never issues a forma-image:// or remote request, and the
 *     interception whitelist below collapses to a single "child of bundle dir"
 *     check.
 *
 *  ② PUPPETEER INTERCEPTION. The bundle is loaded via a file:// URL. Author
 *     scripts are disabled (page.setJavaScriptEnabled(false)). Request
 *     interception is on; every request is classified:
 *       - the navigation document + any file:// resource that realpath-resolves
 *         to a child of the (realpath'd) bundle dir → ALLOW,
 *       - everything else (http(s):, protocol-relative //, data:, file:// outside
 *         the bundle, any out-of-boundary path) → ABORT and record a violation.
 *     A single recorded violation makes the whole render FAIL LOUD: after
 *     navigation we throw a FormaError naming the blocked category. Aborting a
 *     puppeteer request does not by itself fail the render — the explicit
 *     violation flag is what turns a blocked subresource into a hard failure
 *     (never a partial / downgraded PNG).
 *
 * preset → size: this task supports an explicit { width, height } target only.
 * preset resolution (the preset → pixel table) is M5 / task 024 and is wired at
 * the saveBrandAsset layer, not here.
 */

import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch, type Browser, type HTTPRequest } from "puppeteer";
import { localizeArtifactAssets } from "./artifact-asset-pipeline.js";
import { FormaError } from "./errors.js";
import { isSameOrChildPath, realpathWithMissingTail } from "./path-boundary.js";
import { previewChromiumLaunchArgs } from "./preview-renderer.js";

/** Dependencies the render sandbox needs. */
export interface BrandAssetRenderDeps {
  /**
   * Resolves a `forma-image://` reference (staging uuid or brand/) to raw image
   * bytes. The store binds this to the product's resolveFormaImageRef. The
   * localizer rejects http(s): refs itself, so this only ever sees forma-image://.
   */
  resolveFormaImage: (ref: string) => Promise<Buffer>;
}

export interface BrandAssetRenderInput {
  /** Author HTML to render (untrusted). */
  html: string;
  /** Target pixel width. */
  width: number;
  /** Target pixel height. */
  height: number;
  /** Owning product id — carried for error context; resolution is via deps. */
  productId: string;
}

/** The single bundle entry file the localized HTML is written to. */
const BUNDLE_ENTRY = "index.html";

/** Navigation/render timeout, mirroring preview-renderer. */
const RENDER_TIMEOUT_MS = 30000;

// 16384 = Chromium's max canvas/texture dimension; larger viewports clip.
const MAX_RENDER_DIMENSION = 16384;

function assertPositiveDimension(value: number, field: "width" | "height"): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_RENDER_DIMENSION) {
    throw new FormaError(
      "BRAND_ASSET_INVALID_INPUT",
      `Render ${field} must be a positive integer ≤ ${MAX_RENDER_DIMENSION}`,
      { field, value },
    );
  }
}

/**
 * Classify an intercepted request URL against the realpath'd bundle dir.
 * Returns null when the request is allowed, or a short category string when it
 * must be aborted (and the render failed). The category is deliberately coarse
 * so the thrown error never leaks an absolute internal path.
 *
 * Defense-in-depth Layer ②: the localizer (Layer ①) already rejects remote
 * refs before the browser launches, so in practice only file:// children of the
 * bundle reach here — but this independently re-validates every request, so a
 * regression upstream cannot turn a remote/out-of-bundle ref into an allow.
 *
 * Boundary failures fail CLOSED: realpathWithMissingTail rethrows on EACCES /
 * ELOOP (it only swallows ENOENT/ENOTDIR for a not-yet-written leaf), and the
 * caller treats any thrown classify error as a violation — never a silent allow.
 */
export async function classifyBrandAssetRequest(url: string, bundleRealDir: string): Promise<string | null> {
  // Remote + protocol-relative are never allowed.
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//")) {
    return "remote";
  }
  // data: must not appear — the localizer turns data: into bundle files. A
  // surviving data: URL is unexpected; block it rather than render it.
  if (url.startsWith("data:")) return "data";
  if (!url.startsWith("file://")) return "non_file";

  // file:// — must resolve to a child of (or equal to) the bundle dir.
  let candidate: string;
  try {
    candidate = fileURLToPath(url);
  } catch {
    return "unparseable_file";
  }
  // realpath defeats symlink escapes AND normalizes the path form so the
  // boundary check compares like-with-like (macOS /var → /private/var). The
  // file may not exist yet; in that case realpath the existing parent prefix
  // and re-append the missing tail so the boundary check still holds.
  const real = await realpathWithMissingTail(candidate);
  if (!isSameOrChildPath(bundleRealDir, real)) return "out_of_bundle";
  return null;
}

/**
 * Renders untrusted author HTML to a PNG buffer of exactly `width`×`height`
 * pixels, with the localize + interception sandbox described in the file header.
 * Fails loud (throws FormaError) on any disallowed subresource or load failure;
 * never returns a partial or downgraded image.
 */
export async function renderBrandAssetHtml(deps: BrandAssetRenderDeps, input: BrandAssetRenderInput): Promise<Buffer> {
  assertPositiveDimension(input.width, "width");
  assertPositiveDimension(input.height, "height");

  // ── Layer ①: localize into a temp bundle dir ──────────────────────────────
  // Reuses the design-save localizer: forma-image:// → bundle files, data: →
  // bundle files, http(s): / // → ARTIFACT_REMOTE_RESOURCE (thrown here).
  const localized = await localizeArtifactAssets({
    html: input.html,
    resolveFormaImage: deps.resolveFormaImage,
  });

  const root = await mkdtemp(join(tmpdir(), "forma-brand-render-"));
  // realpath the bundle root so the interception boundary check is symlink-safe
  // (macOS tmpdir is itself a symlink: /var → /private/var).
  const bundleDir = join(root, "bundle");
  await mkdir(bundleDir, { recursive: true });
  const bundleRealDir = await realpath(bundleDir);

  // Write localized assets (paths are bundle-relative, e.g. assets/<hash>@1x.png).
  for (const [relPath, buf] of localized.files) {
    const abs = join(bundleDir, relPath);
    // Defense-in-depth: a localizer-produced path must never escape the bundle.
    if (!isSameOrChildPath(bundleDir, abs)) {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
      throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Localized asset path escapes the render bundle", {
        product_id: input.productId,
      });
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, buf);
  }
  await writeFile(join(bundleDir, BUNDLE_ENTRY), localized.html, "utf8");

  const entryUrl = pathToFileURL(join(bundleDir, BUNDLE_ENTRY)).href;

  // ── Layer ②: render under the puppeteer sandbox ───────────────────────────
  let browser: Browser | undefined;
  try {
    browser = await launch({ headless: "shell", args: previewChromiumLaunchArgs() });
    const page = await browser.newPage();
    // Untrusted author HTML — never execute its scripts.
    await page.setJavaScriptEnabled(false);
    await page.setViewport({ width: input.width, height: input.height, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);

    const violations: string[] = [];
    const failed: string[] = [];
    // Requests WE aborted. Used to tell our own aborts apart from genuine load
    // failures in requestfailed — robust across Chromium versions, unlike
    // string-matching errorText.
    const abortedByUs = new WeakSet<HTTPRequest>();

    page.on("request", (req: HTTPRequest) => {
      const url = req.url();
      void (async () => {
        // Fail CLOSED: any classification error is treated as a violation, so a
        // request can only ever be allowed by an explicit `null` verdict.
        let category: string | null;
        try {
          category = await classifyBrandAssetRequest(url, bundleRealDir);
        } catch {
          category = "classify_error";
        }
        if (category === null) {
          await req.continue().catch(() => undefined);
        } else {
          violations.push(category);
          abortedByUs.add(req);
          await req.abort("blockedbyclient").catch(() => undefined);
        }
      })();
    });
    page.on("requestfailed", (req: HTTPRequest) => {
      // Aborts we triggered surface here too; the violations[] flag is the
      // authority for blocked requests. Track other genuine load failures of
      // sub-resources that were allowed (e.g. a referenced bundle file missing).
      if (!abortedByUs.has(req)) failed.push(req.url());
    });

    await page.goto(entryUrl, { waitUntil: "load", timeout: RENDER_TIMEOUT_MS });

    if (violations.length > 0) {
      throw new FormaError("BRAND_ASSET_INVALID_INPUT", "Render blocked a disallowed sub-resource request", {
        product_id: input.productId,
        reason: "sandbox_violation",
        categories: [...new Set(violations)],
      });
    }
    if (failed.length > 0) {
      throw new FormaError("PREVIEW_RENDER_FAILED", "A bundle sub-resource failed to load during render", {
        product_id: input.productId,
        failed_count: failed.length,
      });
    }

    // page.screenshot returns Uint8Array (puppeteer ≥23); the brand-asset store
    // chain is typed Buffer, so convert unconditionally.
    return Buffer.from(await page.screenshot({ type: "png" }));
  } catch (err) {
    if (err instanceof FormaError) throw err;
    throw new FormaError(
      "PREVIEW_RENDER_FAILED",
      `Brand asset render failed: ${err instanceof Error ? err.message : String(err)}`,
      {
        product_id: input.productId,
      },
    );
  } finally {
    await browser?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}
