/**
 * design-save.test.ts — TDD for saveDesignArtifact (P4.3)
 *
 * Uses a real tmp $FORMA_HOME + createFormaStore for integration tests.
 * Preview rendering uses headless browser — may need dangerouslyDisableSandbox.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createFormaStore } from '../src/store.js';
import { saveDesignArtifact, type SaveDesignInput } from '../src/design-save.js';
import { FormaError } from '../src/errors.js';
import { getFormaPaths } from '../src/paths.js';

/** Required for createFormaStore to not throw SchemaNormalizationStartupError */
async function markNormalizationCommitted(home: string): Promise<void> {
  await writeFile(join(home, '.v6-schema-cutover-committed'), 'committed\n', 'utf8');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeHome(): string {
  return join(tmpdir(), `forma-design-save-test-${randomBytes(6).toString('hex')}`);
}

/**
 * Generate a small 3x3 PNG as a Buffer (real valid PNG via sharp),
 * then base64-encode it as a data: URL suitable for use in HTML.
 */
async function makeDataPng(): Promise<string> {
  const buf = await sharp({
    create: { width: 3, height: 3, channels: 3, background: { r: 100, g: 150, b: 200 } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

/**
 * Generate a small SVG with an embedded <script> as a data: URL.
 * After localizeArtifactAssets, this SVG becomes a .svg file in assets/,
 * and validateStaticArtifact should catch the <script> in the SVG.
 */
function makeScriptSvgDataUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// ─── Test state ───────────────────────────────────────────────────────────────

let home: string;
let store: Awaited<ReturnType<typeof createFormaStore>>;
let productId: string;

const homes: string[] = [];

beforeEach(async () => {
  home = makeHome();
  homes.push(home);
  await mkdir(home, { recursive: true });
  await markNormalizationCommitted(home);
  store = await createFormaStore({ home });
  // Create a product to write artifacts under
  const product = await store.products.createProduct({ name: 'Test Product', description: 'desc' });
  productId = product.id;
}, 30000);

afterEach(async () => {
  await Promise.all(homes.splice(0).map((h) => rm(h, { recursive: true, force: true })));
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function makeCleanInput(overrides: Partial<SaveDesignInput> = {}): Promise<SaveDesignInput> {
  const dataPng = await makeDataPng();
  const html = `<!doctype html><html><body style="margin:0"><img src="${dataPng}" alt="test"></body></html>`;
  return {
    productId,
    kind: 'design-page' as const,
    html,
    title: 'Test Design Page',
    forma: {
      requirementId: 'req-001',
      pageId: 'page-001',
      variant: 'default',
    },
    ...overrides,
  };
}

function makeDeps() {
  const productsDir = getFormaPaths(home).productsDir;
  return {
    artifacts: store.artifacts,
    products: store.products,
    runProductMutation: store.runProductMutation.bind(store),
    productsRoot: productsDir,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('saveDesignArtifact', () => {
  it('clean HTML + data:image/png → returns {artifactId, version:1, previewStatus:"ready"}, bundle on disk has index.html + assets/* + preview/1x.png + 2x.png, forma fields correct, design pointer created', async () => {
    const input = await makeCleanInput();
    const deps = makeDeps();

    const result = await saveDesignArtifact(deps, input);

    // Result shape
    expect(result.artifactId).toBeTruthy();
    expect(result.version).toBe(1);
    expect(result.previewStatus).toBe('ready');

    // Bundle on disk: version dir has index.html
    const { productsRoot } = deps;
    const versionDir = join(
      productsRoot,
      productId,
      'od-project',
      'artifacts',
      result.artifactId,
      'v1',
    );
    const indexHtml = await readFile(join(versionDir, 'index.html'), 'utf8');
    expect(indexHtml).toBeTruthy();
    // index.html should not have data: URLs anymore (localized)
    expect(indexHtml).not.toContain('data:image/png;base64,');

    // assets/ dir has at least one file
    const assetsDir = join(versionDir, 'assets');
    const { readdir } = await import('node:fs/promises');
    const assetFiles = await readdir(assetsDir);
    expect(assetFiles.length).toBeGreaterThan(0);

    // preview pngs exist
    expect(await readFile(join(versionDir, 'preview', '1x.png'))).toBeTruthy();
    expect(await readFile(join(versionDir, 'preview', '2x.png'))).toBeTruthy();

    // manifest has correct forma fields
    const manifestJson = await readFile(join(versionDir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestJson);
    expect(manifest.kind).toBe('design-page');
    expect(manifest.forma.variant).toBe('default');
    expect(manifest.forma.requirementId).toBe('req-001');
    expect(manifest.forma.preview.status).toBe('ready');
    expect(Array.isArray(manifest.forma.assets)).toBe(true);
    expect(manifest.forma.assets.length).toBeGreaterThan(0);

    // Design pointer was created
    const pointer = await store.products.getDesignPointer(productId, 'req-001', 'page-001', 'default');
    expect(pointer).toBeTruthy();
    expect(pointer!.artifactId).toBe(result.artifactId);
    expect(pointer!.version).toBe(1);
    expect(pointer!.designStatus).toBe('active');
  }, 90000);

  it('HTML with <script> → throws ARTIFACT_NOT_STATIC', async () => {
    const deps = makeDeps();
    const input: SaveDesignInput = {
      productId,
      kind: 'design-page' as const,
      html: '<!doctype html><html><body><script>alert(1)</script></body></html>',
      title: 'Bad Design',
      forma: { requirementId: 'req-002', pageId: 'page-002', variant: 'default' },
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof FormaError)) return false;
      return err.code === 'ARTIFACT_NOT_STATIC';
    });
  }, 30000);

  it('HTML with remote <img src=https://...> → throws ARTIFACT_REMOTE_RESOURCE', async () => {
    const deps = makeDeps();
    const input: SaveDesignInput = {
      productId,
      kind: 'design-page' as const,
      html: '<!doctype html><html><body><img src="https://example.com/img.png"></body></html>',
      title: 'Remote Design',
      forma: { requirementId: 'req-003', pageId: 'page-003', variant: 'default' },
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof FormaError)) return false;
      return err.code === 'ARTIFACT_REMOTE_RESOURCE';
    });
  }, 30000);

  it('data:SVG containing <script> inlined in HTML → localize makes it a .svg file → saveDesignArtifact throws ARTIFACT_NOT_STATIC', async () => {
    const deps = makeDeps();
    const svgDataUrl = makeScriptSvgDataUrl();
    const html = `<!doctype html><html><body><img src="${svgDataUrl}"></body></html>`;
    const input: SaveDesignInput = {
      productId,
      kind: 'design-page' as const,
      html,
      title: 'SVG Script Design',
      forma: { requirementId: 'req-004', pageId: 'page-004', variant: 'default' },
    };

    await expect(saveDesignArtifact(deps, input)).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof FormaError)) return false;
      return err.code === 'ARTIFACT_NOT_STATIC';
    });
  }, 30000);

  it('same artifactId saved twice → second result is version 2; pointer now points to v2', async () => {
    const deps = makeDeps();
    const input1 = await makeCleanInput({
      forma: { requirementId: 'req-005', pageId: 'page-005', variant: 'default' },
    });

    const result1 = await saveDesignArtifact(deps, input1);
    expect(result1.version).toBe(1);

    const input2 = await makeCleanInput({
      artifactId: result1.artifactId,
      forma: { requirementId: 'req-005', pageId: 'page-005', variant: 'default' },
    });

    const result2 = await saveDesignArtifact(deps, input2);
    expect(result2.artifactId).toBe(result1.artifactId);
    expect(result2.version).toBe(2);

    // Pointer now points to v2
    const pointer = await store.products.getDesignPointer(productId, 'req-005', 'page-005', 'default');
    expect(pointer!.version).toBe(2);
    expect(pointer!.artifactId).toBe(result1.artifactId);
  }, 120000);

  it('component-library kind → no design pointer created; form has no requirementId/pageId/variant in pointer', async () => {
    const dataPng = await makeDataPng();
    const html = `<!doctype html><html><body><img src="${dataPng}" alt="comp"></body></html>`;
    const deps = makeDeps();
    const input: SaveDesignInput = {
      productId,
      kind: 'component-library' as const,
      html,
      title: 'My Components',
      forma: { brandStyle: 'light' },
    };

    const result = await saveDesignArtifact(deps, input);
    expect(result.artifactId).toBeTruthy();
    expect(result.version).toBe(1);

    // No pointer should be created (no requirementId/pageId)
    const product = await store.products.getProduct(productId);
    expect((product.designPointers ?? []).length).toBe(0);
  }, 90000);

  it('design-page without variant → variant defaults to "default" in manifest', async () => {
    const input = await makeCleanInput({
      forma: { requirementId: 'req-006', pageId: 'page-006' }, // no variant
    });
    const deps = makeDeps();

    const result = await saveDesignArtifact(deps, input);
    const { productsRoot } = deps;
    const manifestJson = await readFile(
      join(productsRoot, productId, 'od-project', 'artifacts', result.artifactId, 'v1', 'manifest.json'),
      'utf8',
    );
    const manifest = JSON.parse(manifestJson);
    expect(manifest.forma.variant).toBe('default');

    // Pointer should be created with variant='default'
    const pointer = await store.products.getDesignPointer(productId, 'req-006', 'page-006', 'default');
    expect(pointer).toBeTruthy();
  }, 90000);
});
