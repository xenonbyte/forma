import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SpatialIndexBuilder, VZIEncoder, type VZIContent } from '@vzi-core/format';
import { loadDecodedHandoffContent } from '@xenonbyte/forma-core';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeContent(elements: Array<Record<string, unknown>>, metadata: Record<string, unknown> = {}): VZIContent {
  const map = new Map<string, unknown>();
  for (const el of elements) map.set(el.id as string, el);
  return {
    header: {}, metadata, elements: map, sharedStyles: new Map(),
    spatialIndex: new SpatialIndexBuilder().build(map as never), colorTokens: [], fontTokens: [], annotations: [],
    images: new Map(), layers: [], compatibility: { minReaderVersion: '2.0.0', formatVersion: '2.0.0', features: [] },
  } as unknown as VZIContent;
}

describe('loadDecodedHandoffContent', () => {
  it('decodes a .vzi file into slim JSON-serializable content (metadata + element/image entries)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forma-vzi-content-'));
    dirs.push(dir);
    const source = makeContent(
      [
        { id: 'root', parentId: null, type: 'container', bounds: { x: 0, y: 0, width: 320, height: 640 }, styles: {} },
        { id: 'title', parentId: 'root', type: 'text', bounds: { x: 16, y: 24, width: 200, height: 32 }, styles: {}, textContent: 'Home' },
      ],
      { formaViewport: { width: 320, height: 640 } },
    );
    const vziPath = join(dir, 'page.vzi');
    await mkdir(dir, { recursive: true });
    await writeFile(vziPath, Buffer.from(new VZIEncoder().encode(source)));

    const decoded = await loadDecodedHandoffContent(vziPath);
    expect((decoded.metadata as { formaViewport?: { width?: number } }).formaViewport?.width).toBe(320);
    expect(decoded.elements.map(([id]) => id)).toContain('root');
    // round-trips cleanly through JSON
    expect(() => JSON.parse(JSON.stringify(decoded))).not.toThrow();
  });

  it('throws ARTIFACT_NOT_FOUND when the file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forma-vzi-content-'));
    dirs.push(dir);
    await expect(loadDecodedHandoffContent(join(dir, 'nope.vzi'))).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' });
  });
});
