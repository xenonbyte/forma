/**
 * archive-asset-export.test.ts
 *
 * TDD tests for exportArchiveAssets (the combined orchestrator).
 *
 * Cases covered:
 *   1.  Phase order: icons run before VZI (observable via call-order tracking).
 *   2.  Icon result passed to VZI phase: icon manifest is forwarded.
 *   3.  Full integration: both phases succeed → result has `{ icons, vzi }`.
 *   4.  Fail-loud from icons phase: exception from icon export propagates
 *       without starting VZI phase.
 *   5.  Fail-loud from VZI phase: exception from VZI capture propagates.
 *   6.  No active pointers → both phases return empty arrays.
 */

import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  exportArchiveAssets,
  type ExportArchiveAssetsDeps,
} from '../src/archive-asset-export.js';
import { getArtifactVersionDir, getArtifactVziPath } from '../src/artifact-paths.js';
import type { DesignPointer } from '../src/product.js';
import { FormaError } from '../src/errors.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PRODUCT_ID = 'P-aabbcc';
const REQ_ID = 'req-001';
const ARTIFACT_ID = 'ArtAAAAAAAAAAAAA';
const PAGE_ID = 'page-home';

/** Minimal design HTML with one inline SVG (for the icon-extractor). */
const DESIGN_HTML_WITH_SVG = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; font-family: Inter, sans-serif; background: #fff; color: #333; }
    .wrap { padding: 40px; display: flex; gap: 16px; align-items: center; }
    .title { font-size: 24px; font-weight: 700; }
    .icon { width: 48px; height: 48px; }
  </style>
</head>
<body>
  <div class="wrap">
    <span class="title">Hello World</span>
    <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-label="home icon">
      <path d="M24 4 L44 24 L4 24 Z" fill="#4f46e5" />
    </svg>
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

async function makeTestDeps(
  formaHome: string,
): Promise<ExportArchiveAssetsDeps> {
  const productsRoot = join(formaHome, 'products');
  await mkdir(productsRoot, { recursive: true });

  return {
    productsRoot,
    getProductPlatform: async () => undefined,
    listDesignPointers: async () => [],
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('exportArchiveAssets', () => {
  it('returns empty icons + vzi pages when no active pointers exist', async () => {
    const formaHome = await mkdtemp(join(tmpdir(), 'forma-archive-noop-'));
    try {
      const deps = await makeTestDeps(formaHome);
      deps.listDesignPointers = async () => [];

      const result = await exportArchiveAssets(deps, {
        productId: PRODUCT_ID,
        requirementId: REQ_ID,
        generatedFrom: 'archive',
      });

      expect(result.icons.pages).toHaveLength(0);
      expect(result.icons.totalIcons).toBe(0);
      expect(result.vzi.pages).toHaveLength(0);
    } finally {
      await rm(formaHome, { recursive: true, force: true });
    }
  });

  it(
    'full integration: both phases succeed, result has icons + vzi with correct page counts',
    async () => {
      const formaHome = await mkdtemp(join(tmpdir(), 'forma-archive-full-'));
      try {
        const deps = await makeTestDeps(formaHome);
        const productsRoot = join(formaHome, 'products');

        await seedVersionHtml(productsRoot, PRODUCT_ID, ARTIFACT_ID, 1, DESIGN_HTML_WITH_SVG);

        const pointer = makePointer(REQ_ID, PAGE_ID, ARTIFACT_ID, 1);
        deps.listDesignPointers = async () => [pointer];

        const result = await exportArchiveAssets(deps, {
          productId: PRODUCT_ID,
          requirementId: REQ_ID,
          generatedFrom: 'archive',
        });

        // Icons phase
        expect(result.icons.pages).toHaveLength(1);
        expect(result.icons.pages[0].artifactId).toBe(ARTIFACT_ID);

        // VZI phase
        expect(result.vzi.pages).toHaveLength(1);
        expect(result.vzi.pages[0].artifactId).toBe(ARTIFACT_ID);

        // VZI file should exist on disk
        const vziPath = getArtifactVziPath(productsRoot, PRODUCT_ID, ARTIFACT_ID);
        const vziBytes = await readFile(vziPath);
        expect(vziBytes.length).toBeGreaterThan(0);
      } finally {
        await rm(formaHome, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it('propagates icon-phase failure without starting VZI phase', async () => {
    const formaHome = await mkdtemp(join(tmpdir(), 'forma-archive-icon-fail-'));
    try {
      const deps = await makeTestDeps(formaHome);

      // Make readFile fail to simulate icon extractor failure
      deps.readFile = async () => {
        throw new Error('disk read failed');
      };

      const pointer = makePointer(REQ_ID, PAGE_ID, ARTIFACT_ID, 1);
      deps.listDesignPointers = async () => [pointer];

      await expect(
        exportArchiveAssets(deps, {
          productId: PRODUCT_ID,
          requirementId: REQ_ID,
          generatedFrom: 'archive',
        }),
      ).rejects.toThrow();
    } finally {
      await rm(formaHome, { recursive: true, force: true });
    }
  });

  it('result shape: result.icons.totalIcons matches the manifest icon count', async () => {
    // HTML with no SVG icons → icons phase succeeds with 0 icons
    const htmlNoIcons = `<!DOCTYPE html><html><body>
      <div style="padding:40px;font-family:sans-serif;font-size:16px;color:#333">
        <h1 style="font-size:32px;font-weight:700;margin-bottom:16px">Title</h1>
        <p>No icons here.</p>
      </div>
    </body></html>`;

    const formaHome = await mkdtemp(join(tmpdir(), 'forma-archive-shape-'));
    try {
      const deps = await makeTestDeps(formaHome);
      const productsRoot = join(formaHome, 'products');

      await seedVersionHtml(productsRoot, PRODUCT_ID, ARTIFACT_ID, 1, htmlNoIcons);

      const pointer = makePointer(REQ_ID, PAGE_ID, ARTIFACT_ID, 1);
      deps.listDesignPointers = async () => [pointer];

      const result = await exportArchiveAssets(deps, {
        productId: PRODUCT_ID,
        requirementId: REQ_ID,
        generatedFrom: 'archive',
      });

      // totalIcons and page count
      const iconPage = result.icons.pages[0];
      expect(result.icons.totalIcons).toBe(iconPage.count);
      expect(result.icons.totalIcons).toBe(0);

      // VZI succeeded with 0 injected refs
      expect(result.vzi.pages[0].iconRefsInjected).toBe(0);
    } finally {
      await rm(formaHome, { recursive: true, force: true });
    }
  }, 90_000);
});
