import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launch, type Browser } from "puppeteer";
import { FormaError } from "./errors.js";
import { extractSnapshotInPage, type RenderedDomSnapshot } from "./quality/rendered-dom.js";

export interface RenderPreviewInput {
  bundleDir: string;
  outDir: string;
  entry?: string;
  viewport?: { width: number; height: number };
  /** When true, also extract a rendered-DOM snapshot from the 1x page for craft lint. */
  extractDom?: boolean;
}

export interface RenderPreviewResult {
  files: { "1x": string; "2x": string };
  snapshot?: RenderedDomSnapshot;
  /** Non-blocking DOM extraction failure; preview files may still be ready. */
  snapshotError?: string;
}

const RELEVANT_RESOURCE_TYPES = new Set(["image", "stylesheet", "font", "media"]);

/**
 * R11: keep the Chromium OS sandbox by default — generated HTML is validated
 * but still untrusted. Mirror the vzi-parser fallback gates so tests/CI (and
 * an explicit local escape hatch) can run where the sandbox is unavailable.
 * Preview failure is non-fatal: design saves complete with previewStatus
 * "failed" (design-save.ts), so a sandbox-incompatible host degrades safely.
 */
export function previewChromiumLaunchArgs(): string[] {
  const args = ["--disable-dev-shm-usage"];
  const allowNoSandbox =
    process.env.FORMA_PREVIEW_ALLOW_NO_SANDBOX === "1" ||
    process.env.VITEST === "true" ||
    process.env.NODE_ENV === "test" ||
    process.env.CI === "true";
  if (allowNoSandbox) {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }
  return args;
}

/**
 * 从已落盘 bundle 经 file:// 渲染（相对 assets 自然解析，非裸 setContent）。
 * 产出 1x/2x PNG。任一关键子资源（image/css/font/media）加载失败 → fail-loud 抛错。
 * 不写 manifest preview 状态（由 P4 接 save 时记录）。
 */
export async function renderArtifactPreview(input: RenderPreviewInput): Promise<RenderPreviewResult> {
  const entry = input.entry ?? "index.html";
  const viewport = input.viewport ?? { width: 1280, height: 800 };
  const url = pathToFileURL(join(input.bundleDir, entry)).href;

  let browser: Browser | undefined;
  try {
    // Use 'shell' headless mode (chrome-headless-shell) which reliably supports
    // file:// URL navigation and screenshot in headless environments.
    browser = await launch({ headless: "shell", args: previewChromiumLaunchArgs() });
    await mkdir(input.outDir, { recursive: true });

    const files: Record<"1x" | "2x", string> = { "1x": "", "2x": "" };
    let snapshot: RenderedDomSnapshot | undefined;
    let snapshotError: string | undefined;
    for (const [label, deviceScaleFactor] of [
      ["1x", 1],
      ["2x", 2],
    ] as const) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor });
        const failed: string[] = [];
        page.on("requestfailed", (req) => {
          if (RELEVANT_RESOURCE_TYPES.has(req.resourceType())) failed.push(req.url());
        });
        await page.goto(url, { waitUntil: "load", timeout: 30000 });
        if (failed.length > 0) {
          throw new FormaError(
            "PREVIEW_RENDER_FAILED",
            `Sub-resource(s) failed to load (relative assets must resolve from the bundle): ${failed.join(", ")}`,
            { bundleDir: input.bundleDir, failed },
          );
        }
        const buf = await page.screenshot({ type: "png" });
        const file = join(input.outDir, `${label}.png`);
        await writeFile(file, buf);
        files[label] = file;
        if (label === "1x" && input.extractDom) {
          try {
            snapshot = await page.evaluate(extractSnapshotInPage);
          } catch (err) {
            snapshotError = err instanceof Error ? err.message : String(err);
          }
        }
      } finally {
        await page.close().catch(() => undefined);
      }
    }
    return { files, ...(snapshot ? { snapshot } : {}), ...(snapshotError ? { snapshotError } : {}) };
  } catch (err) {
    if (err instanceof FormaError) throw err;
    throw new FormaError(
      "PREVIEW_RENDER_FAILED",
      `Preview render failed: ${err instanceof Error ? err.message : String(err)}`,
      {
        bundleDir: input.bundleDir,
      },
    );
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
