/**
 * requirement-vzi-capture.ts
 *
 * Captures a page-level `vzi/page.vzi` for every active design pointer of a
 * requirement.  Uses the vendored Puppeteer-based parse chain:
 *
 *   HTML  →  PuppeteerParser.parse()  →  IR
 *         →  VZITransformer.transform()  →  TransformResult
 *         →  buildVziContentFromTransformResult()  →  VZIContent
 *         [+ icon asset refs attached to VZIContent.images + element metadata]
 *         →  VZIEncoder.encode()  →  bytes
 *         →  temp-dir + atomic rename  →  <artifactId>/vzi/page.vzi
 *
 * Narrow-deps pattern: callers (store, tests) inject real or fake
 * implementations via CaptureRequirementVziDeps.
 *
 * Viewport mapping (from approved spec):
 *   mobile  → 390×884
 *   tablet  → 768×1024
 *   desktop → 1024×1280
 *   web     → 1024×1280 (reuses desktop preset)
 *   missing → 1024×1280, viewportSource = "default(desktop)"
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { PuppeteerParser, VIEWPORT_PRESETS, type ViewportPreset } from "@vzi-core/parser";
import { VZITransformer, buildVziContentFromTransformResult } from "@vzi-core/transformer";
import { VZIEncoder } from "@vzi-core/format";
import type { VZIContent, ImageAsset } from "@vzi-core/format";
import { parse } from "node-html-parser";
import type { DesignPointer } from "./product.js";
import { getArtifactVersionDir, getArtifactVziDir, getArtifactVziPath } from "./artifact-paths.js";
import { FormaError } from "./errors.js";
import type { Platform } from "./schemas.js";
import type { ExportedPageIcons, ExportRequirementIconsResult } from "./requirement-icon-export.js";
import type { IconEntry, IconManifest } from "./artifact-icon-extraction.js";
import {
  listCurrentRequirementDesignPointers,
  type GetRequirementPageIds,
} from "./requirement-design-pointer-filter.js";

const ICON_SOURCE_ORDER_ATTR = "data-forma-icon-source-order";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface CaptureRequirementVziDeps {
  /** Absolute path to the products root (contains <productId>/od-project/…). */
  productsRoot: string;
  /** Returns the platform for the given product (undefined if not set). */
  getProductPlatform: (productId: string) => Promise<Platform | undefined>;
  /** Returns all design pointers for the given product. */
  listDesignPointers: (productId: string) => Promise<DesignPointer[]>;
  /** Returns current page ids for the requirement, when stale removed-page pointers must be excluded. */
  getRequirementPageIds?: GetRequirementPageIds;
  /** Read a file from disk. */
  readFile: (path: string) => Promise<Buffer>;
  /** Write a file to disk, creating parent dirs as needed. */
  writeFile: (path: string, data: Buffer | Uint8Array | string) => Promise<void>;
  /** Remove a directory tree (force, ignore-missing). */
  rmDir: (path: string) => Promise<void>;
  /** Atomically rename src → dest (must be same filesystem). */
  rename: (src: string, dest: string) => Promise<void>;
  /** Make a directory (recursive). */
  mkdir: (path: string) => Promise<void>;
}

export interface CaptureRequirementVziInput {
  productId: string;
  requirementId: string;
}

/** Observable viewport source for the page capture. */
export type ViewportSource = "mobile" | "tablet" | "desktop" | "web" | "default(desktop)";

export interface CapturedPageVzi {
  pageId: string;
  artifactId: string;
  version: number;
  /** Viewport width used for capture. */
  viewportWidth: number;
  /** Viewport height used for capture. */
  viewportHeight: number;
  /** Observable source of the viewport choice. */
  viewportSource: ViewportSource;
  /** Number of icon asset refs injected into the VZI. */
  iconRefsInjected: number;
  /** Number of UI elements encoded into this page VZI. */
  elementCount: number;
  /** Absolute path to the written page.vzi file. */
  vziPath: string;
}

export interface CaptureRequirementVziResult {
  pages: CapturedPageVzi[];
  totalElements: number;
}

// ─── Viewport mapping ─────────────────────────────────────────────────────────

/**
 * Map a Forma product platform to the VZI parser viewport preset and source
 * label.  `web` reuses the `desktop` preset (1024×1280).  A missing platform
 * falls back to 1024×1280 with a `"default(desktop)"` source label.
 */
export function resolveViewport(platform: Platform | undefined): {
  preset: ViewportPreset;
  viewportSource: ViewportSource;
  width: number;
  height: number;
} {
  switch (platform) {
    case "mobile":
      return { preset: "mobile", viewportSource: "mobile", ...VIEWPORT_PRESETS.mobile };
    case "tablet":
      return { preset: "tablet", viewportSource: "tablet", ...VIEWPORT_PRESETS.tablet };
    case "desktop":
      return { preset: "desktop", viewportSource: "desktop", ...VIEWPORT_PRESETS.desktop };
    case "web":
      // web reuses the desktop preset
      return { preset: "desktop", viewportSource: "web", ...VIEWPORT_PRESETS.desktop };
    default:
      // missing/undefined → default(desktop)
      return {
        preset: "desktop",
        viewportSource: "default(desktop)",
        ...VIEWPORT_PRESETS.desktop,
      };
  }
}

// ─── Icon ref injection ────────────────────────────────────────────────────────

/**
 * Inject icon asset references into a VZIContent. Matches each VZI inline SVG
 * element to its corresponding icon manifest occurrence by explicit SVG source
 * order carried through `element.source.dataAttributes`.
 *
 * For each matched element:
 *  - An `ImageAsset` with `storageType: 'reference'` and `url` pointing at
 *    the SVG icon file is added to `content.images`.
 *  - The element's `metadata.iconAssetId` is set to the ImageAsset id.
 *
 * Returns the number of refs injected.  Throws FormaError if the count of
 * inline SVG elements in the VZI does not match the manifest icon count
 * (mismatch detected before archive commit).
 */
function injectIconRefs(content: VZIContent, iconExportResult: ExportedPageIcons): number {
  const { manifest, artifactId } = iconExportResult;
  const icons = manifest.icons;

  if (icons.length === 0) {
    return 0;
  }

  const inlineSvgElements = Array.from(content.elements.entries()).filter(([, el]) => el.svgData !== undefined);
  const inlineSvgElementsBySourceOrder = new Map<number, (typeof inlineSvgElements)[number]>();
  for (const entry of inlineSvgElements) {
    const [, element] = entry;
    const sourceOrder = readIconSourceOrder(element);
    if (sourceOrder === undefined) {
      throw new FormaError(
        "ARTIFACT_WRITE_FAIL",
        `Icon/VZI mapping mismatch for artifact ${artifactId}: ` +
          "VZI inline SVG element is missing explicit source-order metadata. " +
          "Cannot safely link icon refs.",
        { artifactId },
      );
    }
    if (inlineSvgElementsBySourceOrder.has(sourceOrder)) {
      throw new FormaError(
        "ARTIFACT_WRITE_FAIL",
        `Icon/VZI mapping mismatch for artifact ${artifactId}: ` +
          `duplicate VZI inline SVG source-order ${sourceOrder}. Cannot safely link icon refs.`,
        { artifactId, sourceOrder },
      );
    }
    inlineSvgElementsBySourceOrder.set(sourceOrder, entry);
  }

  const iconOccurrences = iconOccurrencesInSourceOrder(manifest);

  if (inlineSvgElements.length !== iconOccurrences.length) {
    throw new FormaError(
      "ARTIFACT_WRITE_FAIL",
      `Icon/VZI mapping mismatch for artifact ${artifactId}: ` +
        `VZI has ${inlineSvgElements.length} inline SVG elements but icon manifest has ${iconOccurrences.length} source occurrences. ` +
        `Cannot safely link icon refs by document order.`,
      {
        artifactId,
        vziInlineSvgCount: inlineSvgElements.length,
        iconManifestOccurrenceCount: iconOccurrences.length,
      },
    );
  }

  let injected = 0;
  for (const occurrence of iconOccurrences) {
    const match = inlineSvgElementsBySourceOrder.get(occurrence.sourceOrder);
    if (!match) {
      throw new FormaError(
        "ARTIFACT_WRITE_FAIL",
        `Icon/VZI mapping mismatch for artifact ${artifactId}: ` +
          `no VZI inline SVG element found for source-order ${occurrence.sourceOrder}. ` +
          "Cannot safely link icon refs.",
        { artifactId, sourceOrder: occurrence.sourceOrder },
      );
    }
    const [elementId, element] = match;
    const icon = occurrence.icon;

    // Use the icon manifest's own files.svg path as the canonical asset ref.
    // The manifest records the actual relative path written to disk (e.g.
    // "icons/icon-0-24x24-<hash>.svg").  The MCP read-layer resolves it to
    // absolute in Task 8.
    const relativeSvgPath = icon.files.svg;
    const assetId = `icon-${artifactId}-${icon.id}`;

    const asset: ImageAsset = {
      id: assetId,
      storageType: "reference",
      url: relativeSvgPath,
      mimeType: "image/svg+xml",
      width: 0,
      height: 0,
      size: 0,
      hash: icon.contentHash,
    };

    content.images.set(assetId, asset);

    // Attach ref via element metadata (open Record<string, unknown>)
    element.metadata = {
      ...(element.metadata ?? {}),
      iconAssetId: assetId,
      iconRelativePath: relativeSvgPath,
    };

    // Reflect mutation back into the map
    content.elements.set(elementId, element);

    injected++;
  }

  return injected;
}

function readIconSourceOrder(element: { source?: { dataAttributes?: Record<string, string> } }): number | undefined {
  const raw = element.source?.dataAttributes?.[ICON_SOURCE_ORDER_ATTR];
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function annotateInlineSvgSourceOrder(html: string): string {
  const root = parse(html, { comment: true });
  const svgElements = root.querySelectorAll("svg");
  if (svgElements.length === 0) {
    return html;
  }
  for (let i = 0; i < svgElements.length; i++) {
    svgElements[i].setAttribute(ICON_SOURCE_ORDER_ATTR, String(i));
  }
  return root.toString();
}

function iconOccurrencesInSourceOrder(manifest: IconManifest): Array<{ sourceOrder: number; icon: IconEntry }> {
  const byId = new Map(manifest.icons.map((icon) => [icon.id, icon]));
  const byHash = new Map(manifest.icons.map((icon) => [icon.contentHash, icon]));
  const instances = Array.isArray(manifest.instances) ? manifest.instances : [];

  if (instances.length > 0) {
    return instances
      .slice()
      .sort((a, b) => a.sourceOrder - b.sourceOrder)
      .map((instance) => ({
        sourceOrder: instance.sourceOrder,
        icon: byId.get(instance.iconId) ?? byHash.get(instance.contentHash),
      }))
      .filter((occurrence): occurrence is { sourceOrder: number; icon: IconEntry } => occurrence.icon !== undefined);
  }

  return manifest.icons
    .flatMap((icon, index) => {
      const sourceOrders = Array.isArray(icon.sourceOrders) ? icon.sourceOrders : [index];
      return sourceOrders.map((sourceOrder) => ({ sourceOrder, icon }));
    })
    .sort((a, b) => a.sourceOrder - b.sourceOrder);
}

// ─── Temp dir naming ──────────────────────────────────────────────────────────

function tmpSiblingDir(vziDir: string): string {
  const suffix = randomBytes(4).toString("hex");
  return `${vziDir}.tmp-${suffix}`;
}

// ─── Main capture ─────────────────────────────────────────────────────────────

/**
 * For every active design pointer of `requirementId`, reads the final
 * version's index.html, runs the full Puppeteer → transformer → encoder
 * pipeline, optionally injects icon asset refs (when `iconExportResult` is
 * provided), and atomically writes <artifactId>/vzi/page.vzi.
 *
 * A single-page failure throws immediately (fail-loud, no partial commit).
 * Temp dirs are cleaned up on both success and failure.
 */
export async function captureRequirementVzi(
  deps: CaptureRequirementVziDeps,
  input: CaptureRequirementVziInput,
  iconExportResult?: ExportRequirementIconsResult,
): Promise<CaptureRequirementVziResult> {
  const { productsRoot, getProductPlatform } = deps;
  const { productId, requirementId } = input;

  // Resolve viewport from product platform
  const platform = await getProductPlatform(productId);
  const { preset, viewportSource, width: viewportWidth, height: viewportHeight } = resolveViewport(platform);

  const pointers = await listCurrentRequirementDesignPointers(deps, productId, requirementId);

  const pages: CapturedPageVzi[] = [];

  for (const pointer of pointers) {
    const { artifactId, version, pageId, variant } = pointer;

    const versionDir = getArtifactVersionDir(productsRoot, productId, artifactId, version);
    const htmlPath = join(versionDir, "index.html");
    const vziDir = getArtifactVziDir(productsRoot, productId, artifactId);
    const vziPath = getArtifactVziPath(productsRoot, productId, artifactId);
    const tmpDir = tmpSiblingDir(vziDir);
    const tmpVziPath = join(tmpDir, "page.vzi");

    try {
      // ── 1. Read HTML ────────────────────────────────────────────────────────
      let htmlBuf: Buffer;
      try {
        htmlBuf = await deps.readFile(htmlPath);
      } catch (err) {
        throw new FormaError("ARTIFACT_NOT_FOUND", `Could not read index.html for artifact ${artifactId} v${version}`, {
          productId,
          artifactId,
          version,
          path: htmlPath,
          cause: String(err),
        });
      }
      const html = annotateInlineSvgSourceOrder(htmlBuf.toString("utf8"));

      // ── 2. Parse via Puppeteer ──────────────────────────────────────────────
      let ir: import("@vzi-core/types").IntermediateRepresentation;
      try {
        const parser = new PuppeteerParser({
          viewportPreset: preset,
          baseUrl: pathToFileURL(`${versionDir}/`).toString(),
        });
        try {
          ir = await parser.parse(html);
        } finally {
          // Non-masking dispose: if parse() threw, we must not let a secondary
          // dispose() error replace the original parse exception in the catch
          // below. Log and swallow any dispose failure so the real error propagates.
          await parser.dispose().catch((disposeErr) => {
            console.warn(`[vzi-capture] PuppeteerParser.dispose() failed (artifact ${artifactId}): `, disposeErr);
          });
        }
      } catch (err) {
        throw new FormaError(
          "ARTIFACT_WRITE_FAIL",
          `VZI parse failed for artifact ${artifactId}: ${err instanceof Error ? err.message : String(err)}`,
          { productId, artifactId, pageId, cause: String(err) },
        );
      }

      // ── 3. Transform IR → TransformResult ──────────────────────────────────
      let transformResult: import("@vzi-core/transformer").TransformResult;
      try {
        const transformer = new VZITransformer({
          title: pageId,
          createdBy: "forma-vzi-capture",
          sourceType: "file",
          sourceIdentifier: `${productId}/${requirementId}/${artifactId}/v${version}`,
          enableAnnotations: true,
          enableTokenExtraction: true,
        });
        transformResult = transformer.transform(ir);
      } catch (err) {
        throw new FormaError(
          "ARTIFACT_WRITE_FAIL",
          `VZI transform failed for artifact ${artifactId}: ${err instanceof Error ? err.message : String(err)}`,
          { productId, artifactId, pageId, cause: String(err) },
        );
      }

      // ── 4. Build VZIContent ─────────────────────────────────────────────────
      const content: VZIContent = buildVziContentFromTransformResult(transformResult);
      const elementCount = content.elements.size;

      // Attach Forma-specific metadata
      content.metadata = {
        ...content.metadata,
        name: pageId,
        source: {
          title: `${productId}/${requirementId}/${artifactId}/v${version}`,
        },
      };

      // Add extended metadata as a structured extra field via the open source.title field:
      // We store identity + viewport metadata in a structured way accessible after decode.
      // VZIMetadata.source is { url?, title? } so we use the existing fields.
      // For richer metadata we also pack into an extra custom metadata key via type assertion
      // since VZIMetadata is defined with only known fields — use a compatible extension.
      //
      // IMPORTANT: This depends on VZIEncoder preserving unknown/extension metadata fields
      // (formaProductId, formaRequirementId, formaArtifactId, formaSourceVersion,
      // formaPlatform, formaViewport, formaViewportSource, formaGenerationSource)
      // through encode → decode.  The smoke test in
      // packages/core/tests/requirement-vzi-capture.test.ts asserts this contract.
      // If the encoder is ever updated and drops unknown fields, that test will catch it.
      const extMeta = content.metadata as typeof content.metadata & Record<string, unknown>;
      extMeta["formaProductId"] = productId;
      extMeta["formaRequirementId"] = requirementId;
      extMeta["formaArtifactId"] = artifactId;
      extMeta["formaVariant"] = variant;
      extMeta["formaSourceVersion"] = `v${version}`;
      extMeta["formaPlatform"] = platform ?? null;
      extMeta["formaViewport"] = { width: viewportWidth, height: viewportHeight };
      extMeta["formaViewportSource"] = viewportSource;
      extMeta["formaGenerationSource"] = "forma-vzi-capture";

      // ── 5. Inject icon asset refs ──────────────────────────────────────────
      let iconRefsInjected = 0;
      if (iconExportResult) {
        const pageIconResult = iconExportResult.pages.find((p) => p.artifactId === artifactId);
        if (pageIconResult && pageIconResult.manifest.icons.length > 0) {
          iconRefsInjected = injectIconRefs(content, pageIconResult);
        }
      }

      // ── 6. Encode → bytes ──────────────────────────────────────────────────
      let vziBytes: Uint8Array;
      try {
        const encoder = new VZIEncoder();
        vziBytes = encoder.encode(content);
      } catch (err) {
        throw new FormaError(
          "ARTIFACT_WRITE_FAIL",
          `VZI encode failed for artifact ${artifactId}: ${err instanceof Error ? err.message : String(err)}`,
          { productId, artifactId, pageId, cause: String(err) },
        );
      }

      // ── 7. Write to temp dir + atomic rename ───────────────────────────────
      await deps.mkdir(tmpDir);
      await deps.writeFile(tmpVziPath, Buffer.from(vziBytes));

      // Remove stale vzi/ (if any), then atomic rename
      await deps.rmDir(vziDir);
      await deps.rename(tmpDir, vziDir);

      pages.push({
        pageId,
        artifactId,
        version,
        viewportWidth,
        viewportHeight,
        viewportSource,
        iconRefsInjected,
        elementCount,
        vziPath,
      });
    } catch (err) {
      // Ensure temp dir is cleaned up before propagating
      await deps.rmDir(tmpDir).catch(() => undefined);
      // Re-wrap non-FormaError as FormaError
      if (err instanceof FormaError) throw err;
      throw new FormaError(
        "ARTIFACT_WRITE_FAIL",
        `VZI capture failed for artifact ${artifactId}: ${err instanceof Error ? err.message : String(err)}`,
        { productId, artifactId, pageId, cause: String(err) },
      );
    }
  }

  const totalElements = pages.reduce((sum, page) => sum + page.elementCount, 0);
  return { pages, totalElements };
}

// ─── Real deps factory ────────────────────────────────────────────────────────

/**
 * Build production-ready deps from a ProductService and productsRoot.
 * Tests can inject fakes instead.
 */
export function makeCaptureRequirementVziDeps(
  productsRoot: string,
  getProductPlatformFn: (productId: string) => Promise<Platform | undefined>,
  listDesignPointersFn: (productId: string) => Promise<DesignPointer[]>,
  getRequirementPageIdsFn?: GetRequirementPageIds,
): CaptureRequirementVziDeps {
  return {
    productsRoot,
    getProductPlatform: getProductPlatformFn,
    listDesignPointers: listDesignPointersFn,
    getRequirementPageIds: getRequirementPageIdsFn,
    readFile: (path) => readFile(path),
    writeFile: async (path, data) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    rmDir: (path) => rm(path, { recursive: true, force: true }),
    rename: (src, dest) => rename(src, dest),
    mkdir: async (path) => {
      await mkdir(path, { recursive: true });
    },
  };
}
