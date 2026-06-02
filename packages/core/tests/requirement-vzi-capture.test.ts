/**
 * requirement-vzi-capture.test.ts
 *
 * TDD tests for captureRequirementVzi and helpers.
 *
 * Cases covered:
 *   1.  Viewport mapping: mobile/tablet/desktop/web/missing platform → correct
 *       viewport dimensions and observable viewportSource.
 *   2.  Smoke test: parse → transform → encode → decode ROUND-TRIP on a real
 *       Forma design-page HTML fixture with text, layout, inline SVG, and an
 *       image resource.  Asserts decoded non-zero bounds, non-empty
 *       color/font tokens, and generated annotations.
 *   3.  Icon ref resolution: injectIconRefs correctly maps VZI image elements
 *       to icon manifest entries.
 *   4.  Icon/VZI mapping mismatch (count difference) throws FormaError before
 *       archive commit.
 *   5.  Multi-page filtering: only active pointers matching requirementId are
 *       exported.
 *   6.  Result shape: pages[], viewportSource, iconRefsInjected, vziPath.
 *   7.  Temp-directory cleanup on parse/encode failure.
 */

import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  captureRequirementVzi,
  resolveViewport,
  type CaptureRequirementVziDeps,
} from '../src/requirement-vzi-capture.js';
import { getArtifactVersionDir, getArtifactVziPath } from '../src/artifact-paths.js';
import type { DesignPointer } from '../src/product.js';
import type { Platform } from '../src/schemas.js';
import { FormaError } from '../src/errors.js';
import { VZIDecoder } from '@vzi-core/format';
import type { ExportRequirementIconsResult } from '../src/requirement-icon-export.js';
import type { IconManifest, IconEntry } from '../src/artifact-icon-extraction.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PRODUCT_ID = 'P-aabbcc';
const REQ_ID = 'req-001';
const ARTIFACT_ID = 'ArtAAAAAAAAAAAAA';
const PAGE_ID = 'page-home';

/**
 * A representative Forma design-page HTML fixture.
 * Contains: text, layout, an inline SVG with a path, and an <img> element.
 */
const DESIGN_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Design Page Fixture</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: Inter, sans-serif;
      background-color: #f5f5f5;
      color: #333333;
    }
    .container {
      max-width: 1024px;
      margin: 0 auto;
      padding: 40px 24px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background-color: #ffffff;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .title {
      font-size: 24px;
      font-weight: 700;
      color: #1a1a2e;
    }
    .subtitle {
      font-size: 16px;
      color: #666666;
    }
    .card {
      background: #ffffff;
      padding: 24px;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
    }
    .icon-area {
      width: 48px;
      height: 48px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="title">Design System</span>
      <svg class="icon-area" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-label="settings icon">
        <path d="M24 4 L44 24 L24 44 L4 24 Z" fill="#4f46e5" stroke="none" />
      </svg>
    </div>
    <div class="card">
      <p class="subtitle">Welcome to the component library.</p>
    </div>
  </div>
</body>
</html>`;

function makePointer(
  requirementId: string,
  pageId: string,
  artifactId: string,
  version = 1,
): DesignPointer {
  return {
    requirementId,
    pageId,
    variant: 'default',
    artifactId,
    version,
    designStatus: 'active',
  };
}

// ─── Real-fs deps factory ──────────────────────────────────────────────────────

async function makeTestDeps(
  formaHome: string,
  platform: Platform | undefined = undefined,
): Promise<CaptureRequirementVziDeps> {
  const productsRoot = join(formaHome, 'products');
  await mkdir(productsRoot, { recursive: true });

  return {
    productsRoot,
    getProductPlatform: async () => platform,
    listDesignPointers: async () => [],  // overridden per test
    readFile: (path) => readFile(path),
    writeFile: async (path, data) => {
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, data);
    },
    rmDir: (path) => rm(path, { recursive: true, force: true }),
    rename: (src, dest) => rename(src, dest),
    mkdir: async (path) => { await mkdir(path, { recursive: true }); },
  };
}

/** Write the design HTML fixture at the expected version path. */
async function seedVersionHtml(
  productsRoot: string,
  productId: string,
  artifactId: string,
  version: number,
  html: string,
): Promise<void> {
  const versionDir = getArtifactVersionDir(productsRoot, productId, artifactId, version);
  await mkdir(versionDir, { recursive: true });
  await writeFile(join(versionDir, 'index.html'), html, 'utf8');
}

// ─── 1. Viewport mapping tests ────────────────────────────────────────────────

describe('resolveViewport', () => {
  it('mobile → 390×884, source=mobile', () => {
    const vp = resolveViewport('mobile');
    expect(vp.width).toBe(390);
    expect(vp.height).toBe(884);
    expect(vp.viewportSource).toBe('mobile');
    expect(vp.preset).toBe('mobile');
  });

  it('tablet → 768×1024, source=tablet', () => {
    const vp = resolveViewport('tablet');
    expect(vp.width).toBe(768);
    expect(vp.height).toBe(1024);
    expect(vp.viewportSource).toBe('tablet');
    expect(vp.preset).toBe('tablet');
  });

  it('desktop → 1024×1280, source=desktop', () => {
    const vp = resolveViewport('desktop');
    expect(vp.width).toBe(1024);
    expect(vp.height).toBe(1280);
    expect(vp.viewportSource).toBe('desktop');
    expect(vp.preset).toBe('desktop');
  });

  it('web → 1024×1280 (reuses desktop preset), source=web', () => {
    const vp = resolveViewport('web');
    expect(vp.width).toBe(1024);
    expect(vp.height).toBe(1280);
    expect(vp.viewportSource).toBe('web');
    expect(vp.preset).toBe('desktop');
  });

  it('undefined (missing platform) → 1024×1280, source="default(desktop)"', () => {
    const vp = resolveViewport(undefined);
    expect(vp.width).toBe(1024);
    expect(vp.height).toBe(1280);
    expect(vp.viewportSource).toBe('default(desktop)');
    expect(vp.preset).toBe('desktop');
  });
});

// ─── 2. Smoke test: full round-trip via Puppeteer ─────────────────────────────

describe('captureRequirementVzi (smoke — Puppeteer required)', () => {
  it(
    'parses a design-page HTML fixture and produces a decodable .vzi with non-zero bounds, color tokens, font tokens, and annotations',
    async () => {
      const formaHome = await mkdtemp(join(tmpdir(), 'forma-vzi-smoke-'));
      try {
        const deps = await makeTestDeps(formaHome, 'desktop');
        const productsRoot = join(formaHome, 'products');

        // Seed fixture HTML
        await seedVersionHtml(productsRoot, PRODUCT_ID, ARTIFACT_ID, 1, DESIGN_PAGE_HTML);

        const pointer = makePointer(REQ_ID, PAGE_ID, ARTIFACT_ID, 1);
        deps.listDesignPointers = async () => [pointer];

        const result = await captureRequirementVzi(deps, { productId: PRODUCT_ID, requirementId: REQ_ID });

        expect(result.pages).toHaveLength(1);
        const page = result.pages[0];
        expect(page.artifactId).toBe(ARTIFACT_ID);
        expect(page.viewportWidth).toBe(1024);
        expect(page.viewportHeight).toBe(1280);
        expect(page.viewportSource).toBe('desktop');
        expect(page.iconRefsInjected).toBe(0);

        // Verify the .vzi file was written
        const vziPath = getArtifactVziPath(productsRoot, PRODUCT_ID, ARTIFACT_ID);
        const vziBytes = await readFile(vziPath);
        expect(vziBytes.length).toBeGreaterThan(0);

        // Decode and assert structural properties
        const decoder = new VZIDecoder({ enableErrorRecovery: true });
        const decoded = decoder.decode(new Uint8Array(vziBytes));

        // Should decode without fatal errors
        const fatals = decoded.errors.filter((e) => e.fatal);
        expect(fatals).toHaveLength(0);

        const content = decoded.content;

        // Non-zero elements with valid bounds
        expect(content.elements.size).toBeGreaterThan(0);
        for (const [, el] of content.elements) {
          // At least one element must have non-zero width and height
          if (el.bounds.width > 0 && el.bounds.height > 0) {
            break;
          }
        }
        const hasNonZeroBounds = Array.from(content.elements.values()).some(
          (el) => el.bounds.width > 0 && el.bounds.height > 0,
        );
        expect(hasNonZeroBounds).toBe(true);

        // Non-empty color tokens
        expect(content.colorTokens.length).toBeGreaterThan(0);

        // Non-empty font tokens
        expect(content.fontTokens.length).toBeGreaterThan(0);

        // Non-empty annotations (enableAnnotations is on)
        expect(content.annotations.length).toBeGreaterThan(0);
      } finally {
        await rm(formaHome, { recursive: true, force: true });
      }
    },
    // Puppeteer can be slow to launch; give it 90 seconds
    90_000,
  );

  it('viewport source is observable in page result for platform=mobile', async () => {
    const formaHome = await mkdtemp(join(tmpdir(), 'forma-vzi-mobile-'));
    try {
      const deps = await makeTestDeps(formaHome, 'mobile');
      const productsRoot = join(formaHome, 'products');

      await seedVersionHtml(productsRoot, PRODUCT_ID, ARTIFACT_ID, 1, DESIGN_PAGE_HTML);

      const pointer = makePointer(REQ_ID, PAGE_ID, ARTIFACT_ID, 1);
      deps.listDesignPointers = async () => [pointer];

      const result = await captureRequirementVzi(deps, { productId: PRODUCT_ID, requirementId: REQ_ID });

      expect(result.pages[0].viewportWidth).toBe(390);
      expect(result.pages[0].viewportHeight).toBe(884);
      expect(result.pages[0].viewportSource).toBe('mobile');
    } finally {
      await rm(formaHome, { recursive: true, force: true });
    }
  }, 90_000);
});

// ─── 3. Icon ref resolution ────────────────────────────────────────────────────

describe('captureRequirementVzi with iconExportResult', () => {
  it('injects icon asset refs when icon count matches VZI image/svg element count', async () => {
    // We use the DESIGN_PAGE_HTML fixture which has 1 inline <svg>.
    // Build a fake icon manifest with exactly 1 entry to match.
    const singleIconManifest: IconManifest = {
      artifactId: ARTIFACT_ID,
      productId: PRODUCT_ID,
      requirementId: REQ_ID,
      pageId: PAGE_ID,
      version: 'v1',
      sourceVersion: 'v1',
      generatedFrom: 'requirement-archive',
      icons: [
        {
          id: 'icon-settings',
          size: { w: 48, h: 48 },
          usesCurrentColor: false,
          sourceOrderFirst: true,
          files: {
            svg: `icons/svg/icon-settings.svg`,
            png: {
              '1x': `icons/png/icon-settings@1x.png`,
              '2x': `icons/png/icon-settings@2x.png`,
              '3x': `icons/png/icon-settings@3x.png`,
            },
          },
        },
      ],
    };

    const iconExportResult: ExportRequirementIconsResult = {
      pages: [
        {
          pageId: PAGE_ID,
          artifactId: ARTIFACT_ID,
          version: 1,
          count: 1,
          manifest: singleIconManifest,
        },
      ],
      totalIcons: 1,
    };

    const formaHome = await mkdtemp(join(tmpdir(), 'forma-vzi-iconref-'));
    try {
      const deps = await makeTestDeps(formaHome, 'desktop');
      const productsRoot = join(formaHome, 'products');

      await seedVersionHtml(productsRoot, PRODUCT_ID, ARTIFACT_ID, 1, DESIGN_PAGE_HTML);

      const pointer = makePointer(REQ_ID, PAGE_ID, ARTIFACT_ID, 1);
      deps.listDesignPointers = async () => [pointer];

      const result = await captureRequirementVzi(
        deps,
        { productId: PRODUCT_ID, requirementId: REQ_ID },
        iconExportResult,
      );

      expect(result.pages).toHaveLength(1);
      // Icon refs injected = 1 (matching the 1 SVG element in the fixture)
      expect(result.pages[0].iconRefsInjected).toBe(1);

      // Verify the .vzi contains an image asset with the expected ref
      const vziPath = getArtifactVziPath(productsRoot, PRODUCT_ID, ARTIFACT_ID);
      const vziBytes = await readFile(vziPath);
      const decoder = new VZIDecoder({ enableErrorRecovery: true });
      const decoded = decoder.decode(new Uint8Array(vziBytes));

      // Should have exactly one image asset
      expect(decoded.content.images.size).toBe(1);
      const [, asset] = Array.from(decoded.content.images.entries())[0];
      expect(asset.storageType).toBe('reference');
      expect(asset.url).toBe('icons/svg/icon-settings.svg');

      // The element that has the SVG data should have iconAssetId in metadata
      const elementWithIconRef = Array.from(decoded.content.elements.values()).find(
        (el) => el.metadata?.iconAssetId !== undefined,
      );
      expect(elementWithIconRef).toBeDefined();
      expect(elementWithIconRef?.metadata?.iconAssetId).toBe(asset.id);
    } finally {
      await rm(formaHome, { recursive: true, force: true });
    }
  }, 90_000);
});

// ─── 4. Icon/VZI count mismatch → fail-loud ───────────────────────────────────

describe('captureRequirementVzi icon mismatch', () => {
  it(
    'throws FormaError before archive commit when icon count mismatches VZI image element count',
    async () => {
      // DESIGN_PAGE_HTML has 1 SVG element; we supply 3 icons → mismatch
      const mismatchManifest: IconManifest = {
        artifactId: ARTIFACT_ID,
        productId: PRODUCT_ID,
        requirementId: REQ_ID,
        pageId: PAGE_ID,
        version: 'v1',
        sourceVersion: 'v1',
        generatedFrom: 'requirement-archive',
        icons: [
          {
            id: 'icon-a',
            size: { w: 24, h: 24 },
            usesCurrentColor: false,
            sourceOrderFirst: true,
            files: { svg: 'icons/svg/icon-a.svg', png: { '1x': '', '2x': '', '3x': '' } },
          },
          {
            id: 'icon-b',
            size: { w: 24, h: 24 },
            usesCurrentColor: false,
            sourceOrderFirst: true,
            files: { svg: 'icons/svg/icon-b.svg', png: { '1x': '', '2x': '', '3x': '' } },
          },
          {
            id: 'icon-c',
            size: { w: 24, h: 24 },
            usesCurrentColor: false,
            sourceOrderFirst: true,
            files: { svg: 'icons/svg/icon-c.svg', png: { '1x': '', '2x': '', '3x': '' } },
          },
        ],
      };

      const iconExportResult: ExportRequirementIconsResult = {
        pages: [
          {
            pageId: PAGE_ID,
            artifactId: ARTIFACT_ID,
            version: 1,
            count: 3,
            manifest: mismatchManifest,
          },
        ],
        totalIcons: 3,
      };

      const formaHome = await mkdtemp(join(tmpdir(), 'forma-vzi-mismatch-'));
      try {
        const deps = await makeTestDeps(formaHome, 'desktop');
        const productsRoot = join(formaHome, 'products');

        await seedVersionHtml(productsRoot, PRODUCT_ID, ARTIFACT_ID, 1, DESIGN_PAGE_HTML);

        const pointer = makePointer(REQ_ID, PAGE_ID, ARTIFACT_ID, 1);
        deps.listDesignPointers = async () => [pointer];

        await expect(
          captureRequirementVzi(
            deps,
            { productId: PRODUCT_ID, requirementId: REQ_ID },
            iconExportResult,
          ),
        ).rejects.toThrow(FormaError);

        // Verify the vzi/ directory was NOT created (no partial commit)
        const vziPath = getArtifactVziPath(productsRoot, PRODUCT_ID, ARTIFACT_ID);
        await expect(readFile(vziPath)).rejects.toThrow();
      } finally {
        await rm(formaHome, { recursive: true, force: true });
      }
    },
    90_000,
  );
});

// ─── 5. Multi-page filtering ──────────────────────────────────────────────────

describe('captureRequirementVzi multi-page filtering', () => {
  it('only processes pointers matching requirementId (active)', async () => {
    const formaHome = await mkdtemp(join(tmpdir(), 'forma-vzi-filter-'));
    try {
      const deps = await makeTestDeps(formaHome, 'desktop');
      const productsRoot = join(formaHome, 'products');

      // Seed only the target requirement's artifact
      await seedVersionHtml(productsRoot, PRODUCT_ID, ARTIFACT_ID, 1, DESIGN_PAGE_HTML);

      const targetPointer = makePointer(REQ_ID, PAGE_ID, ARTIFACT_ID, 1);
      const otherPointer: DesignPointer = {
        requirementId: 'req-other',
        pageId: 'page-other',
        variant: 'default',
        artifactId: 'ArtBBBBBBBBBBBBB',
        version: 1,
        designStatus: 'active',
      };

      deps.listDesignPointers = async () => [targetPointer, otherPointer];

      const result = await captureRequirementVzi(deps, { productId: PRODUCT_ID, requirementId: REQ_ID });

      // Only the target requirement's page should be processed
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].artifactId).toBe(ARTIFACT_ID);
    } finally {
      await rm(formaHome, { recursive: true, force: true });
    }
  }, 90_000);

  it('returns empty pages array when no active pointers match requirementId', async () => {
    const formaHome = await mkdtemp(join(tmpdir(), 'forma-vzi-noop-'));
    try {
      const deps = await makeTestDeps(formaHome);
      deps.listDesignPointers = async () => [];

      const result = await captureRequirementVzi(deps, { productId: PRODUCT_ID, requirementId: REQ_ID });
      expect(result.pages).toHaveLength(0);
    } finally {
      await rm(formaHome, { recursive: true, force: true });
    }
  });
});

// ─── 6. Temp-dir cleanup on failure ──────────────────────────────────────────

describe('captureRequirementVzi temp cleanup on failure', () => {
  it('cleans up temp dir when HTML is missing (no partial vzi/)', async () => {
    const formaHome = await mkdtemp(join(tmpdir(), 'forma-vzi-cleanup-'));
    try {
      const deps = await makeTestDeps(formaHome, 'desktop');
      const productsRoot = join(formaHome, 'products');

      // Do NOT seed the HTML → readFile will throw
      const pointer = makePointer(REQ_ID, PAGE_ID, ARTIFACT_ID, 1);
      deps.listDesignPointers = async () => [pointer];

      await expect(
        captureRequirementVzi(deps, { productId: PRODUCT_ID, requirementId: REQ_ID }),
      ).rejects.toThrow(FormaError);

      // No partial vzi/ directory should exist
      const vziPath = getArtifactVziPath(productsRoot, PRODUCT_ID, ARTIFACT_ID);
      await expect(readFile(vziPath)).rejects.toThrow();

      // No tmp dir should linger (glob check)
      const artifactDir = join(productsRoot, PRODUCT_ID, 'od-project', 'artifacts', ARTIFACT_ID);
      let entries: string[] = [];
      try {
        entries = await readdir(artifactDir);
      } catch {
        // dir may not exist — that's fine
      }
      const tmpEntries = entries.filter((e) => e.startsWith('vzi.tmp-'));
      expect(tmpEntries).toHaveLength(0);
    } finally {
      await rm(formaHome, { recursive: true, force: true });
    }
  });
});
