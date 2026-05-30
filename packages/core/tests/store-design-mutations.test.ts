/**
 * store-design-mutations.test.ts — review regressions for store-level guards.
 *
 *   #4: generateRequirementDesign validates requirement ownership + page existence
 *       before writing an artifact / design pointer.
 *   #5: changeArtifactStyle rejects source artifacts whose kind does not support
 *       style changes (markdown-document / svg / image / preview-only).
 *
 * Both guards run before the save pipeline, so these tests never start a browser.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFormaStore } from '../src/store.js';
import { FormaError } from '../src/errors.js';
import type { ArtifactManifest } from '../src/artifact-manifest.js';

async function markNormalizationCommitted(home: string): Promise<void> {
  await writeFile(join(home, '.v6-schema-cutover-committed'), 'committed\n', 'utf8');
}

async function createTestStore() {
  const home = await mkdtemp(join(tmpdir(), 'forma-store-mut-'));
  await markNormalizationCommitted(home);
  return createFormaStore({
    home,
    bundledStylesDir: resolve('styles'),
    bundledCraftDir: resolve('craft'),
  });
}

async function seedProductWithPage(store: Awaited<ReturnType<typeof createTestStore>>) {
  const product = await store.products.createProduct({
    name: 'Checkout App',
    description: 'Mobile checkout workbench',
  });
  await store.products.initProductConfig(product.id, {
    platform: 'web',
    brand_style: 'ant',
    languages: ['en'],
    default_language: 'en',
  });
  const req = await store.requirements.createEmptyRequirement(product.id, 'Checkout flow');
  const pageId = 'page-cart-01';
  await store.requirements.saveRequirement({
    requirement_id: req.id,
    document_md: '# Checkout flow\nUsers can checkout items.',
    ui_affected: true,
    pages: [
      { page_id: pageId, name: 'Cart Page', baseline_page: 'cart', change_type: 'new', features: 'Cart' },
    ],
    navigation: [],
    translations: [],
    rules: [],
    remove_rule_ids: [],
    remove_page_ids: [],
  });
  return { product, requirementId: req.id, pageId };
}

const DESIGN_HTML = '<!doctype html><html><body><h1>x</h1></body></html>';

describe('Review #4: generateRequirementDesign validates requirement + page', () => {
  it('throws REQUIREMENT_NOT_FOUND for an unknown requirement and writes nothing', async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: 'P', description: 'd' });

    await expect(
      store.generateRequirementDesign(product.id, 'R-deadbeef', {
        html: DESIGN_HTML,
        title: 'T',
        pageId: 'page-x',
        brandStyle: 'ant',
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof FormaError && e.code === 'REQUIREMENT_NOT_FOUND');

    expect(await store.artifacts.listArtifacts(product.id)).toEqual([]);
  });

  it('throws REQUIREMENT_PAGE_NOT_FOUND for a typo page_id and writes nothing', async () => {
    const store = await createTestStore();
    const { product, requirementId } = await seedProductWithPage(store);

    await expect(
      store.generateRequirementDesign(product.id, requirementId, {
        html: DESIGN_HTML,
        title: 'T',
        pageId: 'page-typo',
        brandStyle: 'ant',
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof FormaError && e.code === 'REQUIREMENT_PAGE_NOT_FOUND');

    expect(await store.artifacts.listArtifacts(product.id)).toEqual([]);
  });

  it('throws REQUIREMENT_PRODUCT_MISMATCH when the requirement belongs to another product', async () => {
    const store = await createTestStore();
    const { requirementId, pageId } = await seedProductWithPage(store);
    const other = await store.products.createProduct({ name: 'Other', description: 'd' });

    await expect(
      store.generateRequirementDesign(other.id, requirementId, {
        html: DESIGN_HTML,
        title: 'T',
        pageId,
        brandStyle: 'ant',
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof FormaError && e.code === 'REQUIREMENT_PRODUCT_MISMATCH');

    expect(await store.artifacts.listArtifacts(other.id)).toEqual([]);
  });
});

describe('Review #5: changeArtifactStyle rejects unsupported source kinds', () => {
  it('throws ARTIFACT_INVALID_INPUT for a markdown-document source artifact', async () => {
    const store = await createTestStore();
    const product = await store.products.createProduct({ name: 'P', description: 'd' });

    const manifest: ArtifactManifest = {
      version: 1,
      id: 'MarkdownDoc1234A',
      kind: 'markdown-document',
      renderer: 'markdown',
      title: 'Doc',
      entry: 'index.md',
      status: 'complete',
      exports: ['index.md'],
      createdAt: '2026-05-30T00:00:00.000Z',
      updatedAt: '2026-05-30T00:00:00.000Z',
    };
    const { artifactId } = await store.artifacts.writeArtifact({
      productId: product.id,
      manifest,
      files: new Map([['index.md', Buffer.from('# Doc')]]),
    });

    await expect(
      store.changeArtifactStyle(product.id, artifactId, {
        html: DESIGN_HTML,
        title: 'Restyled',
        brandStyle: 'ant',
      }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof FormaError && e.code === 'ARTIFACT_INVALID_INPUT',
    );

    // No new version was appended to the markdown artifact
    expect(await store.artifacts.listArtifactVersions(product.id, artifactId)).toEqual([]);
  });
});
