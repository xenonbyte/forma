import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFormaStore } from '../src/index.js';
import { backfillDesignArtifacts } from '../src/backfill-design-artifacts.js';

async function seedLegacyArtifact(home: string, productId: string, artifactId: string, kind: string, requirementId?: string) {
  const dir = join(home, 'data', 'products', productId, 'od-project', 'artifacts', artifactId);
  await mkdir(dir, { recursive: true });
  const manifest = {
    version: 1, id: artifactId, kind, renderer: kind === 'design-system' ? 'design-system' : 'html',
    title: 'Legacy', entry: 'index.html', status: 'complete', exports: ['index.html'],
    ...(requirementId ? { requirementId } : {}),
    createdAt: '2026-05-28T00:00:00.000Z', updatedAt: '2026-05-28T00:00:00.000Z',
  };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await writeFile(join(dir, 'index.html'), '<h1>legacy</h1>', 'utf8');
}

async function makeStore() {
  const home = await mkdtemp(join(tmpdir(), 'forma-backfill-'));
  await writeFile(join(home, '.v6-schema-cutover-committed'), 'committed\n', 'utf8');
  return createFormaStore({ home });
}

describe('A6 backfill', () => {
  it('migrates legacy html→design-page (with variant=default) and design-system→component-library', async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: 'X', description: 'y' });
    await seedLegacyArtifact(store.home, p.id, 'AbCdEfGhIjKlMnOp', 'html', 'R-1234abcd');
    await seedLegacyArtifact(store.home, p.id, 'CcCdEfGhIjKlMnOp', 'design-system');

    const report = await backfillDesignArtifacts({ home: store.home });
    expect(report.migrated).toBe(2);

    const dir = join(store.home, 'data', 'products', p.id, 'od-project', 'artifacts');
    const pageManifest = JSON.parse(await readFile(join(dir, 'AbCdEfGhIjKlMnOp', 'v1', 'manifest.json'), 'utf8'));
    expect(pageManifest.kind).toBe('design-page');
    expect(pageManifest.forma.variant).toBe('default');
    expect(pageManifest.forma.requirementId).toBe('R-1234abcd');

    const libManifest = JSON.parse(await readFile(join(dir, 'CcCdEfGhIjKlMnOp', 'v1', 'manifest.json'), 'utf8'));
    expect(libManifest.kind).toBe('component-library');
  });

  it('is idempotent: re-running makes no further changes', async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: 'X', description: 'y' });
    await seedLegacyArtifact(store.home, p.id, 'AbCdEfGhIjKlMnOp', 'html', 'R-1234abcd');
    const first = await backfillDesignArtifacts({ home: store.home });
    const second = await backfillDesignArtifacts({ home: store.home });
    expect(first.migrated).toBe(1);
    expect(second.migrated).toBe(0);
    expect(second.recovered).toBe(0);
  });

  it('builds a design pointer for migrated design-page artifacts', async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: 'X', description: 'y' });
    await seedLegacyArtifact(store.home, p.id, 'AbCdEfGhIjKlMnOp', 'html', 'R-1234abcd');
    await backfillDesignArtifacts({ home: store.home });
    const pointers = await store.products.listDesignPointers(p.id);
    expect(pointers).toHaveLength(1);
    expect(pointers[0]).toMatchObject({ requirementId: 'R-1234abcd', variant: 'default', version: 1 });
  });

  it('recovers an interrupted migration where v1 exists but flat manifest cleanup did not finish', async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: 'X', description: 'y' });
    await seedLegacyArtifact(store.home, p.id, 'AbCdEfGhIjKlMnOp', 'html', 'R-1234abcd');
    const artifactDir = join(store.home, 'data', 'products', p.id, 'od-project', 'artifacts', 'AbCdEfGhIjKlMnOp');
    await mkdir(join(artifactDir, 'v1'), { recursive: true });
    await writeFile(join(artifactDir, 'v1', 'manifest.json'), JSON.stringify({
      version: 1, id: 'AbCdEfGhIjKlMnOp', kind: 'design-page', renderer: 'html',
      title: 'Legacy', entry: 'index.html', status: 'complete', exports: ['index.html'],
      forma: { requirementId: 'R-1234abcd', pageId: 'R-1234abcd', variant: 'default' },
      createdAt: '2026-05-28T00:00:00.000Z', updatedAt: '2026-05-28T00:00:00.000Z',
    }), 'utf8');
    await writeFile(join(artifactDir, 'v1', 'index.html'), '<h1>already copied</h1>', 'utf8');

    const report = await backfillDesignArtifacts({ home: store.home });
    expect(report.recovered).toBe(1);
    await expect(readFile(join(artifactDir, 'manifest.json'), 'utf8')).rejects.toThrow();
    expect(await store.products.listDesignPointers(p.id)).toHaveLength(1);
  });

  it('recovers an interrupted migration where v1 exists, flat manifest is gone, and pointer is missing', async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: 'X', description: 'y' });
    const artifactDir = join(store.home, 'data', 'products', p.id, 'od-project', 'artifacts', 'AbCdEfGhIjKlMnOp');
    await mkdir(join(artifactDir, 'v1'), { recursive: true });
    await writeFile(join(artifactDir, 'v1', 'manifest.json'), JSON.stringify({
      version: 1, id: 'AbCdEfGhIjKlMnOp', kind: 'design-page', renderer: 'html',
      title: 'Legacy', entry: 'index.html', status: 'complete', exports: ['index.html'],
      forma: { requirementId: 'R-1234abcd', pageId: 'R-1234abcd', variant: 'default' },
      createdAt: '2026-05-28T00:00:00.000Z', updatedAt: '2026-05-28T00:00:00.000Z',
    }), 'utf8');
    await writeFile(join(artifactDir, 'v1', 'index.html'), '<h1>already copied</h1>', 'utf8');

    const report = await backfillDesignArtifacts({ home: store.home });
    expect(report.recovered).toBe(1);
    expect(await store.products.listDesignPointers(p.id)).toHaveLength(1);
  });

  it('runs product pointer writes under the product mutation lock', async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: 'X', description: 'y' });
    await seedLegacyArtifact(store.home, p.id, 'AbCdEfGhIjKlMnOp', 'html', 'R-1234abcd');
    const operations: string[] = [];
    await backfillDesignArtifacts({
      home: store.home,
      productMutationLock: { run: async (input, fn) => { operations.push(input.operation); return fn({ operation: input.operation, product_id: input.product_id, warnings: [] }); } },
    });
    expect(operations).toContain('backfill_design_artifacts');
  });
});
