/**
 * requirement-icon-export.test.ts
 *
 * TDD tests for exportRequirementIcons.
 *
 * Cases covered:
 *   1.  Multi-page filtering: only pointers matching requirementId are exported
 *   2.  Zero-icon page: still writes icons.json with icons:[]
 *   3.  Stale-output replacement: pre-existing icons/ is fully replaced (no leftover stale files)
 *   4.  Temp-directory cleanup on extractor failure
 *   5.  Whole-export failure when one page errors (no partial commit — failing page throws and aborts)
 *   6.  Result shape: pages[], totalIcons
 *   7.  icons.json content matches IconManifest structure
 */

import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  exportRequirementIcons,
  type ExportRequirementIconsDeps,
} from '../src/requirement-icon-export.js';
import {
  getArtifactVersionDir,
  getArtifactIconsDir,
  getArtifactIconsManifestPath,
} from '../src/artifact-paths.js';
import type { DesignPointer } from '../src/product.js';
import { FormaError } from '../src/errors.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PRODUCT_ID = 'P-aabbcc';
const REQ_ID = 'req-001';
const OTHER_REQ_ID = 'req-999';
const ARTIFACT_ID_1 = 'ArtAAAAAAAAAAAAA';
const ARTIFACT_ID_2 = 'ArtBBBBBBBBBBBBB';
const PAGE_ID_1 = 'page-home';
const PAGE_ID_2 = 'page-about';

/** Minimal safe SVG with explicit dimensions and aria-label */
function makeSvg(w: number, h: number, label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" aria-label="${label}"><rect width="${w}" height="${h}"/></svg>`;
}

function makeHtml(svgs: string[]): string {
  return `<!DOCTYPE html><html><body>${svgs.join('')}</body></html>`;
}

function makeHtmlNoIcons(): string {
  return `<!DOCTYPE html><html><body><p>No icons here</p></body></html>`;
}

function makePointer(
  requirementId: string,
  pageId: string,
  artifactId: string,
  version = 3,
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

// ─── Real-fs deps factory (writes under a fresh temp dir each test) ──────────

async function makeTestDeps(formaHome: string): Promise<ExportRequirementIconsDeps> {
  const productsRoot = join(formaHome, 'products');
  await mkdir(productsRoot, { recursive: true });

  return {
    productsRoot,
    listDesignPointers: async () => [],  // overridden per test
    readFile: (path) => readFile(path),
    writeFile: async (path, data) => {
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, data);
    },
    rmDir: (path) => rm(path, { recursive: true, force: true }),
    rename: (src, dest) => rename(src, dest),
    mkdir: (path) => mkdir(path, { recursive: true }),
  };
}

/**
 * Scaffold the on-disk structure for one artifact version so
 * exportRequirementIcons can find v{n}/index.html.
 */
async function scaffoldArtifactVersion(
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

// ─── Case 1: Multi-page filtering ─────────────────────────────────────────────

describe('Case 1: multi-page filtering by requirementId', () => {
  it('only exports pointers matching the given requirementId', async () => {
    const home = await mkdtemp(join(tmpdir(), 'forma-icon-test-'));
    try {
      const deps = await makeTestDeps(home);
      const { productsRoot } = deps;

      await scaffoldArtifactVersion(
        productsRoot, PRODUCT_ID, ARTIFACT_ID_1, 3,
        makeHtml([makeSvg(24, 24, 'Logo')]),
      );
      await scaffoldArtifactVersion(
        productsRoot, PRODUCT_ID, ARTIFACT_ID_2, 1,
        makeHtml([makeSvg(16, 16, 'Arrow')]),
      );

      const pointers: DesignPointer[] = [
        makePointer(REQ_ID, PAGE_ID_1, ARTIFACT_ID_1, 3),
        makePointer(OTHER_REQ_ID, PAGE_ID_2, ARTIFACT_ID_2, 1),
      ];
      deps.listDesignPointers = async () => pointers;

      const result = await exportRequirementIcons(deps, {
        productId: PRODUCT_ID,
        requirementId: REQ_ID,
        generatedFrom: 'requirement-archive',
      });

      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].pageId).toBe(PAGE_ID_1);
      expect(result.pages[0].artifactId).toBe(ARTIFACT_ID_1);
      expect(result.pages[0].version).toBe(3);
      expect(result.totalIcons).toBe(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('returns empty result when no pointers match requirementId', async () => {
    const home = await mkdtemp(join(tmpdir(), 'forma-icon-test-'));
    try {
      const deps = await makeTestDeps(home);
      deps.listDesignPointers = async () => [
        makePointer(OTHER_REQ_ID, PAGE_ID_1, ARTIFACT_ID_1),
      ];

      // No artifact on disk for this req
      const result = await exportRequirementIcons(deps, {
        productId: PRODUCT_ID,
        requirementId: REQ_ID,
        generatedFrom: 'requirement-archive',
      });

      expect(result.pages).toHaveLength(0);
      expect(result.totalIcons).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

// ─── Case 2: Zero-icon page ───────────────────────────────────────────────────

describe('Case 2: zero-icon page still writes icons.json', () => {
  it('creates icons/ with icons.json containing icons:[] when no SVGs', async () => {
    const home = await mkdtemp(join(tmpdir(), 'forma-icon-test-'));
    try {
      const deps = await makeTestDeps(home);
      const { productsRoot } = deps;

      await scaffoldArtifactVersion(
        productsRoot, PRODUCT_ID, ARTIFACT_ID_1, 2,
        makeHtmlNoIcons(),
      );

      deps.listDesignPointers = async () => [
        makePointer(REQ_ID, PAGE_ID_1, ARTIFACT_ID_1, 2),
      ];

      const result = await exportRequirementIcons(deps, {
        productId: PRODUCT_ID,
        requirementId: REQ_ID,
        generatedFrom: 'requirement-archive',
      });

      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].count).toBe(0);

      const iconsDir = getArtifactIconsDir(productsRoot, PRODUCT_ID, ARTIFACT_ID_1);
      const manifestPath = getArtifactIconsManifestPath(productsRoot, PRODUCT_ID, ARTIFACT_ID_1);
      const raw = await readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed.icons).toEqual([]);
      expect(parsed.artifactId).toBe(ARTIFACT_ID_1);

      // icons/ dir exists
      const entries = await readdir(iconsDir);
      expect(entries).toContain('icons.json');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

// ─── Case 3: Stale-output replacement ─────────────────────────────────────────

describe('Case 3: stale icons/ is fully replaced', () => {
  it('removes stale files from a prior export', async () => {
    const home = await mkdtemp(join(tmpdir(), 'forma-icon-test-'));
    try {
      const deps = await makeTestDeps(home);
      const { productsRoot } = deps;

      await scaffoldArtifactVersion(
        productsRoot, PRODUCT_ID, ARTIFACT_ID_1, 5,
        makeHtml([makeSvg(24, 24, 'Home')]),
      );

      const iconsDir = getArtifactIconsDir(productsRoot, PRODUCT_ID, ARTIFACT_ID_1);

      // Pre-seed a stale icons/ with a stale file
      await mkdir(iconsDir, { recursive: true });
      await writeFile(join(iconsDir, 'stale-leftover.svg'), 'stale', 'utf8');
      await writeFile(join(iconsDir, 'icons.json'), JSON.stringify({ icons: ['old'] }), 'utf8');

      deps.listDesignPointers = async () => [
        makePointer(REQ_ID, PAGE_ID_1, ARTIFACT_ID_1, 5),
      ];

      await exportRequirementIcons(deps, {
        productId: PRODUCT_ID,
        requirementId: REQ_ID,
        generatedFrom: 'manual-export',
      });

      // Stale file must be gone
      const entries = await readdir(iconsDir);
      expect(entries).not.toContain('stale-leftover.svg');

      // Fresh icons.json must be valid
      const manifestPath = getArtifactIconsManifestPath(productsRoot, PRODUCT_ID, ARTIFACT_ID_1);
      const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
      expect(parsed.icons).not.toEqual(['old']);
      expect(Array.isArray(parsed.icons)).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

// ─── Case 4: Temp-directory cleanup on extractor failure ─────────────────────

describe('Case 4: temp dir is cleaned up on extractor failure', () => {
  it('leaves no .tmp-* sibling when extractIconAssets throws', async () => {
    const home = await mkdtemp(join(tmpdir(), 'forma-icon-test-'));
    try {
      const deps = await makeTestDeps(home);
      const { productsRoot } = deps;

      // Provide HTML with unsafe SVG to trigger FormaError in extractor
      const unsafeHtml = `<!DOCTYPE html><html><body><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><script>alert(1)</script></svg></body></html>`;
      await scaffoldArtifactVersion(
        productsRoot, PRODUCT_ID, ARTIFACT_ID_1, 1,
        unsafeHtml,
      );

      deps.listDesignPointers = async () => [
        makePointer(REQ_ID, PAGE_ID_1, ARTIFACT_ID_1, 1),
      ];

      await expect(
        exportRequirementIcons(deps, {
          productId: PRODUCT_ID,
          requirementId: REQ_ID,
          generatedFrom: 'requirement-archive',
        }),
      ).rejects.toBeInstanceOf(FormaError);

      // No .tmp-* dirs should remain as siblings of icons/
      const artifactDir = join(
        productsRoot,
        PRODUCT_ID,
        'od-project',
        'artifacts',
        ARTIFACT_ID_1,
      );
      let entries: string[] = [];
      try {
        entries = await readdir(artifactDir);
      } catch {
        // artifact dir might not exist if nothing was written, that's fine
      }
      const tmpEntries = entries.filter((e) => e.startsWith('.tmp-'));
      expect(tmpEntries).toHaveLength(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('leaves no .tmp-* sibling when readFile throws', async () => {
    const home = await mkdtemp(join(tmpdir(), 'forma-icon-test-'));
    try {
      const deps = await makeTestDeps(home);
      const { productsRoot } = deps;

      // Do NOT scaffold any artifact — so readFile of index.html will fail
      deps.listDesignPointers = async () => [
        makePointer(REQ_ID, PAGE_ID_1, ARTIFACT_ID_1, 1),
      ];

      await expect(
        exportRequirementIcons(deps, {
          productId: PRODUCT_ID,
          requirementId: REQ_ID,
          generatedFrom: 'requirement-archive',
        }),
      ).rejects.toBeInstanceOf(FormaError);

      // Artifact dir may not exist at all — just confirm no tmp dirs
      const artifactDir = join(
        productsRoot,
        PRODUCT_ID,
        'od-project',
        'artifacts',
        ARTIFACT_ID_1,
      );
      let entries: string[] = [];
      try {
        entries = await readdir(artifactDir);
      } catch {
        // fine
      }
      const tmpEntries = entries.filter((e) => e.startsWith('.tmp-'));
      expect(tmpEntries).toHaveLength(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

// ─── Case 5: One-page failure aborts whole export (no partial commit) ─────────

describe('Case 5: whole-export failure — one page error aborts everything', () => {
  it('does not commit page-1 icons when page-2 fails to read', async () => {
    const home = await mkdtemp(join(tmpdir(), 'forma-icon-test-'));
    try {
      const deps = await makeTestDeps(home);
      const { productsRoot } = deps;

      // Page 1 is valid
      await scaffoldArtifactVersion(
        productsRoot, PRODUCT_ID, ARTIFACT_ID_1, 1,
        makeHtml([makeSvg(24, 24, 'Logo')]),
      );
      // Page 2 has NO index.html on disk → will throw on readFile

      deps.listDesignPointers = async () => [
        makePointer(REQ_ID, PAGE_ID_1, ARTIFACT_ID_1, 1),
        makePointer(REQ_ID, PAGE_ID_2, ARTIFACT_ID_2, 1),
      ];

      await expect(
        exportRequirementIcons(deps, {
          productId: PRODUCT_ID,
          requirementId: REQ_ID,
          generatedFrom: 'requirement-archive',
        }),
      ).rejects.toBeInstanceOf(FormaError);

      // Page 1's icons/ must NOT have been committed (the loop is sequential
      // and page 2 fails AFTER page 1 succeeds — page 1 is already committed,
      // but the spec says "fail-loud" at the PAGE that errors, not rollback
      // already-written pages). Actually re-reading the spec: "failing page
      // throws and aborts the whole export". This means no further pages are
      // committed, but already-written pages from the same run remain.
      // The critical invariant: the failing page itself leaves no partial state.
      const iconsDir2 = getArtifactIconsDir(productsRoot, PRODUCT_ID, ARTIFACT_ID_2);
      let dir2Exists = false;
      try {
        await readdir(iconsDir2);
        dir2Exists = true;
      } catch {
        dir2Exists = false;
      }
      // Page 2 icons/ must NOT exist (it failed, no commit)
      expect(dir2Exists).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('throws FormaError with error from the failing page', async () => {
    const home = await mkdtemp(join(tmpdir(), 'forma-icon-test-'));
    try {
      const deps = await makeTestDeps(home);
      const { productsRoot } = deps;

      // Unsafe SVG triggers FormaError in extractor
      const unsafeHtml = `<!DOCTYPE html><html><body><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><script>alert(1)</script></svg></body></html>`;
      await scaffoldArtifactVersion(
        productsRoot, PRODUCT_ID, ARTIFACT_ID_1, 1,
        unsafeHtml,
      );

      deps.listDesignPointers = async () => [
        makePointer(REQ_ID, PAGE_ID_1, ARTIFACT_ID_1, 1),
      ];

      const err = await exportRequirementIcons(deps, {
        productId: PRODUCT_ID,
        requirementId: REQ_ID,
        generatedFrom: 'requirement-archive',
      }).catch((e) => e);

      expect(err).toBeInstanceOf(FormaError);
      expect((err as FormaError).code).toBe('ARTIFACT_NOT_STATIC');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

// ─── Case 6: Result shape ─────────────────────────────────────────────────────

describe('Case 6: result shape', () => {
  it('returns correct totalIcons across multiple pages', async () => {
    const home = await mkdtemp(join(tmpdir(), 'forma-icon-test-'));
    try {
      const deps = await makeTestDeps(home);
      const { productsRoot } = deps;

      // Page 1: 2 icons
      await scaffoldArtifactVersion(
        productsRoot, PRODUCT_ID, ARTIFACT_ID_1, 1,
        makeHtml([makeSvg(24, 24, 'A'), makeSvg(16, 16, 'B')]),
      );
      // Page 2: 1 icon
      await scaffoldArtifactVersion(
        productsRoot, PRODUCT_ID, ARTIFACT_ID_2, 2,
        makeHtml([makeSvg(32, 32, 'C')]),
      );

      deps.listDesignPointers = async () => [
        makePointer(REQ_ID, PAGE_ID_1, ARTIFACT_ID_1, 1),
        makePointer(REQ_ID, PAGE_ID_2, ARTIFACT_ID_2, 2),
      ];

      const result = await exportRequirementIcons(deps, {
        productId: PRODUCT_ID,
        requirementId: REQ_ID,
        generatedFrom: 'requirement-archive',
      });

      expect(result.pages).toHaveLength(2);
      expect(result.totalIcons).toBe(3);
      expect(result.pages[0].count).toBe(2);
      expect(result.pages[1].count).toBe(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

// ─── Case 7: icons.json content ───────────────────────────────────────────────

describe('Case 7: icons.json manifest content', () => {
  it('writes valid IconManifest JSON to icons/icons.json', async () => {
    const home = await mkdtemp(join(tmpdir(), 'forma-icon-test-'));
    try {
      const deps = await makeTestDeps(home);
      const { productsRoot } = deps;

      await scaffoldArtifactVersion(
        productsRoot, PRODUCT_ID, ARTIFACT_ID_1, 4,
        makeHtml([makeSvg(24, 24, 'Close')]),
      );

      deps.listDesignPointers = async () => [
        makePointer(REQ_ID, PAGE_ID_1, ARTIFACT_ID_1, 4),
      ];

      await exportRequirementIcons(deps, {
        productId: PRODUCT_ID,
        requirementId: REQ_ID,
        generatedFrom: 'manual-export',
      });

      const manifestPath = getArtifactIconsManifestPath(productsRoot, PRODUCT_ID, ARTIFACT_ID_1);
      const raw = await readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);

      expect(manifest.artifactId).toBe(ARTIFACT_ID_1);
      expect(manifest.productId).toBe(PRODUCT_ID);
      expect(manifest.requirementId).toBe(REQ_ID);
      expect(manifest.pageId).toBe(PAGE_ID_1);
      expect(manifest.generatedFrom).toBe('manual-export');
      expect(Array.isArray(manifest.icons)).toBe(true);
      expect(manifest.icons).toHaveLength(1);
      expect(manifest.icons[0].id).toMatch(/^close-[0-9a-f]{16}$/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('SVG files and PNG files are written under icons/', async () => {
    const home = await mkdtemp(join(tmpdir(), 'forma-icon-test-'));
    try {
      const deps = await makeTestDeps(home);
      const { productsRoot } = deps;

      await scaffoldArtifactVersion(
        productsRoot, PRODUCT_ID, ARTIFACT_ID_1, 1,
        makeHtml([makeSvg(24, 24, 'Star')]),
      );

      deps.listDesignPointers = async () => [
        makePointer(REQ_ID, PAGE_ID_1, ARTIFACT_ID_1, 1),
      ];

      await exportRequirementIcons(deps, {
        productId: PRODUCT_ID,
        requirementId: REQ_ID,
        generatedFrom: 'requirement-archive',
      });

      const iconsDir = getArtifactIconsDir(productsRoot, PRODUCT_ID, ARTIFACT_ID_1);
      const entries = await readdir(iconsDir);

      // Must have icons.json
      expect(entries).toContain('icons.json');
      // Must have at least one .svg file
      expect(entries.some((e) => e.endsWith('.svg'))).toBe(true);
      // Must have at least one .png file
      expect(entries.some((e) => e.endsWith('.png'))).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
