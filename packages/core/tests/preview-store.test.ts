import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readArtifactPreview } from '../src/preview-store.js';
import { FormaError } from '../src/errors.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Minimal PNG signature bytes.
const FAKE_PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const PRODUCT_ID = 'test-product';
const ARTIFACT_ID = 'AbCdEfGhIjKlMnOp';

let tmpRoot: string;
let productsRoot: string;

// Create a fresh tmp directory before each test.
beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'forma-preview-test-'));
  productsRoot = join(tmpRoot, 'products');
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function writePreviewFile(resolution: '1x' | '2x', content: Buffer = FAKE_PNG): Promise<void> {
  const previewDir = join(
    productsRoot,
    PRODUCT_ID,
    'od-project',
    'artifacts',
    ARTIFACT_ID,
    'preview',
  );
  await mkdir(previewDir, { recursive: true });
  await writeFile(join(previewDir, `${resolution}.png`), content);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('readArtifactPreview', () => {
  it('returns correct buffer for 2x resolution when file exists', async () => {
    await writePreviewFile('2x');

    const result = await readArtifactPreview(productsRoot, PRODUCT_ID, ARTIFACT_ID, '2x');

    expect(result).toBeInstanceOf(Buffer);
    expect(result).toEqual(FAKE_PNG);
  });

  it('returns correct buffer for 1x resolution when file exists', async () => {
    const content = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    await writePreviewFile('1x', content);

    const result = await readArtifactPreview(productsRoot, PRODUCT_ID, ARTIFACT_ID, '1x');

    expect(result).toBeInstanceOf(Buffer);
    expect(result).toEqual(content);
  });

  it('throws ARTIFACT_NOT_FOUND when 2x file is missing', async () => {
    // No file written — directory does not exist.
    await expect(
      readArtifactPreview(productsRoot, PRODUCT_ID, ARTIFACT_ID, '2x'),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof FormaError)) return false;
      return err.code === 'ARTIFACT_NOT_FOUND';
    });
  });

  it('throws ARTIFACT_NOT_FOUND when 1x file is missing', async () => {
    // Write only the 2x file; 1x is absent.
    await writePreviewFile('2x');

    await expect(
      readArtifactPreview(productsRoot, PRODUCT_ID, ARTIFACT_ID, '1x'),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof FormaError)) return false;
      return err.code === 'ARTIFACT_NOT_FOUND';
    });
  });

  it('both resolutions can be read independently', async () => {
    const png2x = Buffer.from([0x01, 0x02]);
    const png1x = Buffer.from([0x03, 0x04]);
    await writePreviewFile('2x', png2x);
    await writePreviewFile('1x', png1x);

    const result2x = await readArtifactPreview(productsRoot, PRODUCT_ID, ARTIFACT_ID, '2x');
    const result1x = await readArtifactPreview(productsRoot, PRODUCT_ID, ARTIFACT_ID, '1x');

    expect(result2x).toEqual(png2x);
    expect(result1x).toEqual(png1x);
  });
});
