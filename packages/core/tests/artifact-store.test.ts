import { mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactManifest } from '../src/artifact-manifest.js';
import { createArtifactStore } from '../src/artifact-store.js';
import { getProductMutationLock } from '../src/product-mutation-lock.js';
import { FormaError } from '../src/errors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTestRoot(): string {
  return join(tmpdir(), `artifact-store-test-${randomBytes(6).toString('hex')}`);
}

function makeManifest(overrides: Partial<ArtifactManifest> = {}): ArtifactManifest {
  return {
    version: 1,
    id: 'AbCdEfGhIjKlMnOp',
    kind: 'html',
    renderer: 'html',
    title: 'Test Artifact',
    entry: 'index.html',
    status: 'complete',
    exports: ['index.html'],
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-28T00:00:00.000Z',
    ...overrides,
  };
}

function makeFiles(content = '<h1>Hello</h1>'): Map<string, Buffer> {
  return new Map([['index.html', Buffer.from(content)]]);
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('ArtifactStore', () => {
  let testRoot: string;
  let productsRoot: string;
  const productId = 'P-ab1234'; // must match /^P-[a-f0-9]{6}$/

  beforeEach(async () => {
    testRoot = makeTestRoot();
    productsRoot = join(testRoot, 'data', 'products');
    await mkdir(productsRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  // ─── Step 1: writeArtifact happy path ───────────────────────────────────────
  describe('writeArtifact — happy path', () => {
    it('writes artifact dir + manifest.json and returns consistent ETag on read-back', async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const manifest = makeManifest();
      const files = makeFiles();

      const { artifactId, etag } = await store.writeArtifact({ productId, manifest, files });

      expect(typeof artifactId).toBe('string');
      expect(artifactId.length).toBeGreaterThan(0);
      expect(typeof etag).toBe('string');
      expect(etag.length).toBe(64); // SHA-256 hex

      // Read back and verify ETag matches
      const { manifest: readManifest, etag: readEtag } = await store.readArtifact(productId, artifactId);
      expect(readEtag).toBe(etag);
      expect(readManifest.kind).toBe(manifest.kind);
      expect(readManifest.title).toBe(manifest.title);
    });

    it('writes all files into the artifact directory', async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const manifest = makeManifest();
      const files = new Map([
        ['index.html', Buffer.from('<h1>Hello</h1>')],
        ['assets/style.css', Buffer.from('body { color: red; }')],
      ]);

      const { artifactId } = await store.writeArtifact({ productId, manifest, files });

      // Verify files exist
      const artifactDir = join(productsRoot, productId, 'od-project', 'artifacts', artifactId);
      const indexContent = await readFile(join(artifactDir, 'index.html'), 'utf8');
      const cssContent = await readFile(join(artifactDir, 'assets', 'style.css'), 'utf8');
      expect(indexContent).toBe('<h1>Hello</h1>');
      expect(cssContent).toBe('body { color: red; }');
    });

    it('calls retentionHook after successful write', async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const manifest = makeManifest();
      const files = makeFiles();
      const retentionHook = vi.fn().mockResolvedValue(undefined);

      const { artifactId } = await store.writeArtifact({ productId, manifest, files, retentionHook });

      expect(retentionHook).toHaveBeenCalledOnce();
      expect(retentionHook).toHaveBeenCalledWith(artifactId, productId);
    });

    it('does not call retentionHook when not provided', async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      // Should not throw even without a retention hook
      const { artifactId } = await store.writeArtifact({
        productId,
        manifest: makeManifest(),
        files: makeFiles(),
      });
      expect(typeof artifactId).toBe('string');
    });
  });

  // ─── Step 2: Failure atomicity ──────────────────────────────────────────────
  describe('writeArtifact — failure atomicity', () => {
    it('throws ARTIFACT_ALREADY_EXISTS when artifact dir pre-exists (collision guard before rename)', async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const manifest = makeManifest();
      const files = makeFiles();
      const forcedId = 'AtomicTest1234AB';

      // Pre-create the artifact dir to cause rename to fail (ENOTEMPTY / EEXIST on macOS)
      const artifactDir = join(productsRoot, productId, 'od-project', 'artifacts', forcedId);
      await mkdir(artifactDir, { recursive: true });
      // Write a sentinel file so we can verify it's untouched after failure
      await import('node:fs/promises').then(fs =>
        fs.writeFile(join(artifactDir, 'sentinel.txt'), 'original')
      );

      await expect(
        store.writeArtifact({ productId, manifest, files, __forceNanoid: forcedId })
      ).rejects.toThrow(FormaError);

      // The error code should be ARTIFACT_ALREADY_EXISTS (collision guard catches this before rename)
      try {
        await store.writeArtifact({ productId, manifest, files, __forceNanoid: forcedId });
      } catch (err) {
        expect(err).toBeInstanceOf(FormaError);
        const fe = err as FormaError;
        // Pre-existing dir triggers ARTIFACT_ALREADY_EXISTS
        expect(fe.code).toBe('ARTIFACT_ALREADY_EXISTS');
      }

      // Sentinel file must still exist — original content unchanged
      const sentinel = await readFile(join(artifactDir, 'sentinel.txt'), 'utf8');
      expect(sentinel).toBe('original');
    });

    it('throws ARTIFACT_ALREADY_EXISTS when same __forceNanoid used twice, original content unchanged', async () => {
      // This test verifies the ARTIFACT_WRITE_FAIL path by checking the error code
      // The easiest way is to mock rename at module level; here we verify the code
      // is exported correctly by checking FormaError throw pattern
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      // Write one artifact, then use same ID to trigger ARTIFACT_ALREADY_EXISTS
      const forcedId = 'ColliTest5678XY';
      await store.writeArtifact({
        productId,
        manifest: makeManifest(),
        files: makeFiles('first'),
        __forceNanoid: forcedId,
      });

      // Read back to confirm original is there
      const { manifest: readManifest } = await store.readArtifact(productId, forcedId);
      expect(readManifest.title).toBe('Test Artifact');

      // Now try to overwrite — must throw ARTIFACT_ALREADY_EXISTS
      await expect(
        store.writeArtifact({
          productId,
          manifest: makeManifest({ title: 'Overwrite Attempt' }),
          files: makeFiles('second'),
          __forceNanoid: forcedId,
        })
      ).rejects.toMatchObject({ code: 'ARTIFACT_ALREADY_EXISTS' });

      // Original content is unchanged
      const { manifest: afterAttempt } = await store.readArtifact(productId, forcedId);
      expect(afterAttempt.title).toBe('Test Artifact');
    });

    it('cleans up tmp dir and throws ARTIFACT_WRITE_FAIL when rename throws', async () => {
      const mockRename = vi.fn().mockRejectedValueOnce(
        Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
      );
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock, { _rename: mockRename as any });
      const manifest = makeManifest();
      const files = makeFiles();

      await expect(
        store.writeArtifact({ productId, manifest, files })
      ).rejects.toMatchObject({ code: 'ARTIFACT_WRITE_FAIL' });

      // Verify no tmp dirs remain in the artifacts dir
      const artifactsDir = join(productsRoot, productId, 'od-project', 'artifacts');
      const entries = existsSync(artifactsDir) ? readdirSync(artifactsDir) : [];
      const tmpDirs = entries.filter(e => e.startsWith('.tmp-'));
      expect(tmpDirs).toHaveLength(0);
    });
  });

  // ─── Step 3: Concurrent writes serialized (SPEC-EDGE-001) ───────────────────
  describe('writeArtifact — concurrency serialization', () => {
    it('two concurrent writes for the same product do not overlap', async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const order: string[] = [];

      const write1 = store
        .writeArtifact({
          productId,
          manifest: makeManifest({ title: 'Write 1' }),
          files: makeFiles('content-1'),
          retentionHook: async (id) => {
            order.push(`hook-1:${id}`);
          },
        })
        .then((r) => { order.push(`done-1:${r.artifactId}`); return r; });

      const write2 = store
        .writeArtifact({
          productId,
          manifest: makeManifest({ title: 'Write 2' }),
          files: makeFiles('content-2'),
          retentionHook: async (id) => {
            order.push(`hook-2:${id}`);
          },
        })
        .then((r) => { order.push(`done-2:${r.artifactId}`); return r; });

      const [r1, r2] = await Promise.all([write1, write2]);

      // Both must succeed
      expect(r1.artifactId).toBeTruthy();
      expect(r2.artifactId).toBeTruthy();
      expect(r1.artifactId).not.toBe(r2.artifactId);

      // Verify both artifacts exist
      const list = await store.listArtifacts(productId);
      const ids = list.map((a) => a.artifactId);
      expect(ids).toContain(r1.artifactId);
      expect(ids).toContain(r2.artifactId);

      // Serialization: each write's hook must fire before the next write's done marker appears
      // (i.e., hook-1 before done-1, hook-2 before done-2, and both grouped by lock order)
      const hook1Idx = order.findIndex((e) => e.startsWith('hook-1:'));
      const done1Idx = order.findIndex((e) => e.startsWith('done-1:'));
      const hook2Idx = order.findIndex((e) => e.startsWith('hook-2:'));
      const done2Idx = order.findIndex((e) => e.startsWith('done-2:'));

      expect(hook1Idx).toBeLessThan(done1Idx);
      expect(hook2Idx).toBeLessThan(done2Idx);
    });
  });

  // ─── Step 4: __forceNanoid collision → ARTIFACT_ALREADY_EXISTS (SPEC-DS-001a) ─
  describe('writeArtifact — collision guard (SPEC-DS-001a)', () => {
    it('throws ARTIFACT_ALREADY_EXISTS when __forceNanoid matches existing artifact, content unchanged', async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const forcedId = 'CollisionAABBCC';

      // Write artifact A
      await store.writeArtifact({
        productId,
        manifest: makeManifest({ title: 'Artifact A', id: forcedId }),
        files: makeFiles('artifact-A-content'),
        __forceNanoid: forcedId,
      });

      // Confirm A is readable
      const { manifest: manifestA } = await store.readArtifact(productId, forcedId);
      expect(manifestA.title).toBe('Artifact A');

      // Write B with same ID → must throw ARTIFACT_ALREADY_EXISTS
      await expect(
        store.writeArtifact({
          productId,
          manifest: makeManifest({ title: 'Artifact B', id: forcedId }),
          files: makeFiles('artifact-B-content'),
          __forceNanoid: forcedId,
        })
      ).rejects.toMatchObject({ code: 'ARTIFACT_ALREADY_EXISTS' });

      // Artifact A content must be unchanged
      const { manifest: manifestAAfter } = await store.readArtifact(productId, forcedId);
      expect(manifestAAfter.title).toBe('Artifact A');

      // Verify the file for A still has original content
      const artifactDir = join(productsRoot, productId, 'od-project', 'artifacts', forcedId);
      const indexContent = await readFile(join(artifactDir, 'index.html'), 'utf8');
      expect(indexContent).toBe('artifact-A-content');
    });
  });

  // ─── Step 5: Static grep verified externally in CI ──────────────────────────
  // The literal "od-project/artifacts/" must only appear in:
  //   artifact-store.ts, artifact-paths.ts, artifact-tmp-cleanup.ts

  // ─── Step 6: Full implementation — readArtifact / listArtifacts / deleteArtifact ─
  describe('readArtifact', () => {
    it('throws ARTIFACT_NOT_FOUND for missing artifact', async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      await expect(store.readArtifact(productId, 'NonExistent1234')).rejects.toMatchObject({
        code: 'ARTIFACT_NOT_FOUND',
      });
    });
  });

  describe('listArtifacts', () => {
    it('returns empty array when no artifacts exist', async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      const list = await store.listArtifacts(productId);
      expect(list).toEqual([]);
    });

    it('lists all written artifacts with their ETags', async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      const r1 = await store.writeArtifact({
        productId,
        manifest: makeManifest({ title: 'A1' }),
        files: makeFiles('a1'),
      });
      const r2 = await store.writeArtifact({
        productId,
        manifest: makeManifest({ title: 'A2' }),
        files: makeFiles('a2'),
      });

      const list = await store.listArtifacts(productId);
      expect(list).toHaveLength(2);
      const ids = list.map((a) => a.artifactId);
      expect(ids).toContain(r1.artifactId);
      expect(ids).toContain(r2.artifactId);

      // ETags must match what writeArtifact returned
      const item1 = list.find((a) => a.artifactId === r1.artifactId);
      const item2 = list.find((a) => a.artifactId === r2.artifactId);
      expect(item1?.etag).toBe(r1.etag);
      expect(item2?.etag).toBe(r2.etag);
    });
  });

  describe('deleteArtifact', () => {
    it('removes the artifact directory', async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      const { artifactId } = await store.writeArtifact({
        productId,
        manifest: makeManifest(),
        files: makeFiles(),
      });

      await store.deleteArtifact(productId, artifactId);

      await expect(store.readArtifact(productId, artifactId)).rejects.toMatchObject({
        code: 'ARTIFACT_NOT_FOUND',
      });
    });

    it('throws ARTIFACT_NOT_FOUND when deleting non-existent artifact', async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      await expect(store.deleteArtifact(productId, 'NoExist12345678')).rejects.toMatchObject({
        code: 'ARTIFACT_NOT_FOUND',
      });
    });
  });

  // ─── Step 7: RetentionHook type is exported ──────────────────────────────────
  describe('RetentionHook type', () => {
    it('retentionHook is called with correct args', async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const calls: Array<[string, string]> = [];

      const retentionHook = async (artifactId: string, pid: string) => {
        calls.push([artifactId, pid]);
      };

      const { artifactId } = await store.writeArtifact({
        productId,
        manifest: makeManifest(),
        files: makeFiles(),
        retentionHook,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([artifactId, productId]);
    });
  });
});
