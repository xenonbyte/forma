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

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PuppeteerParser, VIEWPORT_PRESETS, type ViewportPreset } from '@vzi-core/parser';
import { VZITransformer, buildVziContentFromTransformResult } from '@vzi-core/transformer';
import { VZIEncoder } from '@vzi-core/format';
import type { VZIContent, ImageAsset } from '@vzi-core/format';
import type { DesignPointer } from './product.js';
import {
  getArtifactVersionDir,
  getArtifactVziDir,
  getArtifactVziPath,
} from './artifact-paths.js';
import { FormaError } from './errors.js';
import type { Platform } from './schemas.js';
import type { ExportedPageIcons, ExportRequirementIconsResult } from './requirement-icon-export.js';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface CaptureRequirementVziDeps {
  /** Absolute path to the products root (contains <productId>/od-project/…). */
  productsRoot: string;
  /** Returns the platform for the given product (undefined if not set). */
  getProductPlatform: (productId: string) => Promise<Platform | undefined>;
  /** Returns all design pointers for the given product. */
  listDesignPointers: (productId: string) => Promise<DesignPointer[]>;
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
export type ViewportSource =
  | 'mobile'
  | 'tablet'
  | 'desktop'
  | 'web'
  | 'default(desktop)';

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
  /** Absolute path to the written page.vzi file. */
  vziPath: string;
}

export interface CaptureRequirementVziResult {
  pages: CapturedPageVzi[];
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
    case 'mobile':
      return { preset: 'mobile', viewportSource: 'mobile', ...VIEWPORT_PRESETS.mobile };
    case 'tablet':
      return { preset: 'tablet', viewportSource: 'tablet', ...VIEWPORT_PRESETS.tablet };
    case 'desktop':
      return { preset: 'desktop', viewportSource: 'desktop', ...VIEWPORT_PRESETS.desktop };
    case 'web':
      // web reuses the desktop preset
      return { preset: 'desktop', viewportSource: 'web', ...VIEWPORT_PRESETS.desktop };
    default:
      // missing/undefined → default(desktop)
      return {
        preset: 'desktop',
        viewportSource: 'default(desktop)',
        ...VIEWPORT_PRESETS.desktop,
      };
  }
}

// ─── Icon ref injection ────────────────────────────────────────────────────────

/**
 * Inject icon asset references into a VZIContent.  Matches each VZI element
 * that holds SVG or image data to its corresponding icon manifest entry by
 * document-order index of inline-svg/img elements.
 *
 * For each matched element:
 *  - An `ImageAsset` with `storageType: 'reference'` and `url` pointing at
 *    the SVG icon file is added to `content.images`.
 *  - The element's `metadata.iconAssetId` is set to the ImageAsset id.
 *
 * Returns the number of refs injected.  Throws FormaError if the count of
 * icon-bearing elements in the VZI does not match the manifest icon count
 * (mismatch detected before archive commit).
 */
function injectIconRefs(
  content: VZIContent,
  iconExportResult: ExportedPageIcons,
): number {
  const { manifest, artifactId } = iconExportResult;
  const icons = manifest.icons;

  if (icons.length === 0) {
    return 0;
  }

  // Gather elements in document-order (preserve insertion order of the Map)
  const svgAndImageElements = Array.from(content.elements.entries()).filter(
    ([, el]) => el.svgData !== undefined || el.imageData !== undefined,
  );

  if (svgAndImageElements.length !== icons.length) {
    throw new FormaError(
      'ARTIFACT_WRITE_FAIL',
      `Icon/VZI mapping mismatch for artifact ${artifactId}: ` +
        `VZI has ${svgAndImageElements.length} image/svg elements but icon manifest has ${icons.length} entries. ` +
        `Cannot safely link icon refs by document order.`,
      {
        artifactId,
        vziImageCount: svgAndImageElements.length,
        iconManifestCount: icons.length,
      },
    );
  }

  let injected = 0;
  for (let i = 0; i < svgAndImageElements.length; i++) {
    const [elementId, element] = svgAndImageElements[i];
    const icon = icons[i];

    // Use the icon manifest's own files.svg path as the canonical asset ref.
    // The manifest records the actual relative path written to disk (e.g.
    // "icons/icon-0-24x24-<hash>.svg").  The MCP read-layer resolves it to
    // absolute in Task 8.
    const relativeSvgPath = icon.files.svg;
    const assetId = `icon-${artifactId}-${icon.id}`;

    const asset: ImageAsset = {
      id: assetId,
      storageType: 'reference',
      url: relativeSvgPath,
      mimeType: 'image/svg+xml',
      width: 0,
      height: 0,
      size: 0,
      hash: icon.id,
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

// ─── Temp dir naming ──────────────────────────────────────────────────────────

function tmpSiblingDir(vziDir: string): string {
  const suffix = randomBytes(4).toString('hex');
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
  const { productsRoot, getProductPlatform, listDesignPointers } = deps;
  const { productId, requirementId } = input;

  // Resolve viewport from product platform
  const platform = await getProductPlatform(productId);
  const { preset, viewportSource, width: viewportWidth, height: viewportHeight } =
    resolveViewport(platform);

  // Filter to active pointers for this requirement
  const allPointers = await listDesignPointers(productId);
  const pointers = allPointers.filter(
    (p) => p.requirementId === requirementId && p.designStatus === 'active',
  );

  const pages: CapturedPageVzi[] = [];

  for (const pointer of pointers) {
    const { artifactId, version, pageId } = pointer;

    const versionDir = getArtifactVersionDir(productsRoot, productId, artifactId, version);
    const htmlPath = join(versionDir, 'index.html');
    const vziDir = getArtifactVziDir(productsRoot, productId, artifactId);
    const vziPath = getArtifactVziPath(productsRoot, productId, artifactId);
    const tmpDir = tmpSiblingDir(vziDir);
    const tmpVziPath = join(tmpDir, 'page.vzi');

    try {
      // ── 1. Read HTML ────────────────────────────────────────────────────────
      let htmlBuf: Buffer;
      try {
        htmlBuf = await deps.readFile(htmlPath);
      } catch (err) {
        throw new FormaError(
          'ARTIFACT_NOT_FOUND',
          `Could not read index.html for artifact ${artifactId} v${version}`,
          { productId, artifactId, version, path: htmlPath, cause: String(err) },
        );
      }
      const html = htmlBuf.toString('utf8');

      // ── 2. Parse via Puppeteer ──────────────────────────────────────────────
      let ir: import('@vzi-core/types').IntermediateRepresentation;
      try {
        const parser = new PuppeteerParser({ viewportPreset: preset });
        try {
          ir = await parser.parse(html);
        } finally {
          await parser.dispose();
        }
      } catch (err) {
        throw new FormaError(
          'ARTIFACT_WRITE_FAIL',
          `VZI parse failed for artifact ${artifactId}: ${err instanceof Error ? err.message : String(err)}`,
          { productId, artifactId, pageId, cause: String(err) },
        );
      }

      // ── 3. Transform IR → TransformResult ──────────────────────────────────
      let transformResult: import('@vzi-core/transformer').TransformResult;
      try {
        const transformer = new VZITransformer({
          title: pageId,
          createdBy: 'forma-vzi-capture',
          sourceType: 'file',
          sourceIdentifier: `${productId}/${requirementId}/${artifactId}/v${version}`,
          enableAnnotations: true,
          enableTokenExtraction: true,
        });
        transformResult = transformer.transform(ir);
      } catch (err) {
        throw new FormaError(
          'ARTIFACT_WRITE_FAIL',
          `VZI transform failed for artifact ${artifactId}: ${err instanceof Error ? err.message : String(err)}`,
          { productId, artifactId, pageId, cause: String(err) },
        );
      }

      // ── 4. Build VZIContent ─────────────────────────────────────────────────
      const content: VZIContent = buildVziContentFromTransformResult(transformResult);

      // Attach Forma-specific metadata
      content.metadata = {
        ...content.metadata,
        name: pageId,
        source: {
          url: undefined,
          title: `${productId}/${requirementId}/${artifactId}/v${version}`,
        },
      };

      // Add extended metadata as a structured extra field via the open source.title field:
      // We store identity + viewport metadata in a structured way accessible after decode.
      // VZIMetadata.source is { url?, title? } so we use the existing fields.
      // For richer metadata we also pack into an extra custom metadata key via type assertion
      // since VZIMetadata is defined with only known fields — use a compatible extension.
      const extMeta = content.metadata as typeof content.metadata & Record<string, unknown>;
      extMeta['formaProductId'] = productId;
      extMeta['formaRequirementId'] = requirementId;
      extMeta['formaArtifactId'] = artifactId;
      extMeta['formaSourceVersion'] = `v${version}`;
      extMeta['formaPlatform'] = platform ?? null;
      extMeta['formaViewport'] = { width: viewportWidth, height: viewportHeight };
      extMeta['formaViewportSource'] = viewportSource;
      extMeta['formaGenerationSource'] = 'forma-vzi-capture';

      // ── 5. Inject icon asset refs ──────────────────────────────────────────
      let iconRefsInjected = 0;
      if (iconExportResult) {
        const pageIconResult = iconExportResult.pages.find(
          (p) => p.artifactId === artifactId,
        );
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
          'ARTIFACT_WRITE_FAIL',
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
        vziPath,
      });
    } catch (err) {
      // Ensure temp dir is cleaned up before propagating
      await deps.rmDir(tmpDir).catch(() => undefined);
      // Re-wrap non-FormaError as FormaError
      if (err instanceof FormaError) throw err;
      throw new FormaError(
        'ARTIFACT_WRITE_FAIL',
        `VZI capture failed for artifact ${artifactId}: ${err instanceof Error ? err.message : String(err)}`,
        { productId, artifactId, pageId, cause: String(err) },
      );
    }
  }

  return { pages };
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
): CaptureRequirementVziDeps {
  return {
    productsRoot,
    getProductPlatform: getProductPlatformFn,
    listDesignPointers: listDesignPointersFn,
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
