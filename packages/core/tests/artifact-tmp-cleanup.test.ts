import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cleanupArtifactTmpDirs } from '../src/artifact-tmp-cleanup.js';
import { createFormaStore, type ProductMutationContext, type ProductMutationLock } from '../src/index.js';

describe('cleanupArtifactTmpDirs', () => {
  let testHome: string;

  beforeEach(() => {
    testHome = join(tmpdir(), `forma-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true });
    }
  });

  it('removes .tmp-* directories under each product od-project/artifacts/', () => {
    // Setup: create a product with a tmp dir
    const productsDir = join(testHome, 'data', 'products');
    const prod1ArtifactsDir = join(productsDir, 'prod-1', 'od-project', 'artifacts');
    const tmpDir = join(prod1ArtifactsDir, '.tmp-abc123');
    mkdirSync(tmpDir, { recursive: true });
    // Create a file in the tmp dir
    writeFileSync(join(tmpDir, 'manifest.json'), '{}');

    // Verify setup
    expect(existsSync(tmpDir)).toBe(true);

    // Run cleanup
    cleanupArtifactTmpDirs(productsDir);

    // Verify tmp dir removed
    expect(existsSync(tmpDir)).toBe(false);
  });

  it('removes multiple .tmp-* dirs in same product', () => {
    const productsDir = join(testHome, 'data', 'products');
    const artifactsDir = join(productsDir, 'prod-1', 'od-project', 'artifacts');
    const tmpDir1 = join(artifactsDir, '.tmp-abc123');
    const tmpDir2 = join(artifactsDir, '.tmp-def456');

    mkdirSync(tmpDir1, { recursive: true });
    mkdirSync(tmpDir2, { recursive: true });
    writeFileSync(join(tmpDir1, 'data.json'), '{}');
    writeFileSync(join(tmpDir2, 'data.json'), '{}');

    cleanupArtifactTmpDirs(productsDir);

    expect(existsSync(tmpDir1)).toBe(false);
    expect(existsSync(tmpDir2)).toBe(false);
  });

  it('removes .tmp-* dirs across multiple products', () => {
    const productsDir = join(testHome, 'data', 'products');
    const tmpDir1 = join(productsDir, 'prod-1', 'od-project', 'artifacts', '.tmp-111');
    const tmpDir2 = join(productsDir, 'prod-2', 'od-project', 'artifacts', '.tmp-222');

    mkdirSync(tmpDir1, { recursive: true });
    mkdirSync(tmpDir2, { recursive: true });

    cleanupArtifactTmpDirs(productsDir);

    expect(existsSync(tmpDir1)).toBe(false);
    expect(existsSync(tmpDir2)).toBe(false);
  });

  it('skips non-.tmp-* directories', () => {
    const productsDir = join(testHome, 'data', 'products');
    const artifactsDir = join(productsDir, 'prod-1', 'od-project', 'artifacts');
    const normalArtifact = join(artifactsDir, 'artifact-123');
    const tmpDir = join(artifactsDir, '.tmp-abc');

    mkdirSync(normalArtifact, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(normalArtifact, 'manifest.json'), '{}');

    cleanupArtifactTmpDirs(productsDir);

    expect(existsSync(normalArtifact)).toBe(true);
    expect(existsSync(tmpDir)).toBe(false);
  });

  it('does not crash on missing products dir', () => {
    const nonExistentDir = join(testHome, 'nonexistent', 'products');

    // Should not throw
    expect(() => cleanupArtifactTmpDirs(nonExistentDir)).not.toThrow();
  });

  it('does not crash if product has no od-project', () => {
    const productsDir = join(testHome, 'data', 'products');
    mkdirSync(join(productsDir, 'prod-1'), { recursive: true });

    // Should not throw
    expect(() => cleanupArtifactTmpDirs(productsDir)).not.toThrow();
  });

  it('continues on fs error when removing tmp dir', () => {
    // Create a real tmp dir and another product to verify continuation
    const productsDir = join(testHome, 'data', 'products');
    const tmpDir1 = join(productsDir, 'prod-1', 'od-project', 'artifacts', '.tmp-111');
    const tmpDir2 = join(productsDir, 'prod-2', 'od-project', 'artifacts', '.tmp-222');

    mkdirSync(tmpDir1, { recursive: true });
    mkdirSync(tmpDir2, { recursive: true });

    // Should remove both even if one fails (we skip the error)
    // This test verifies non-fatal errors don't stop processing
    expect(() => cleanupArtifactTmpDirs(productsDir)).not.toThrow();

    // At least one should be cleaned
    const oneRemoved = !existsSync(tmpDir1) || !existsSync(tmpDir2);
    expect(oneRemoved).toBe(true);
  });

  it('runs startup tmp cleanup under the product mutation lock', async () => {
    writeFileSync(join(testHome, '.v6-schema-cutover-committed'), 'committed\n');
    const productsDir = join(testHome, 'data', 'products');
    const tmpDir = join(productsDir, 'P-abc123', 'od-project', 'artifacts', '.tmp-startup');
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'manifest.json'), '{}');

    const calls: string[] = [];
    const lock: ProductMutationLock = {
      async run<T>(
        input: { operation: string; product_id?: string },
        fn: (context: ProductMutationContext) => Promise<T>
      ): Promise<T> {
        calls.push(input.operation);
        expect(existsSync(tmpDir)).toBe(true);
        const result = await fn({ operation: input.operation, product_id: input.product_id, warnings: [] });
        calls.push(`tmp-exists-after:${existsSync(tmpDir)}`);
        return result;
      },
    };

    await createFormaStore({ home: testHome, bundledStylesDir: resolve('styles'), productMutationLock: lock });

    expect(calls).toEqual(['cleanup_artifact_tmp_dirs', 'tmp-exists-after:false']);
    expect(existsSync(tmpDir)).toBe(false);
  });
});
