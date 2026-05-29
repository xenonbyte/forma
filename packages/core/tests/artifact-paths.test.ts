import { describe, it, expect } from 'vitest';
import {
  getProductOdProjectDir,
  getArtifactsDir,
  getArtifactDir,
  getArtifactManifestPath,
  getArtifactPreviewPath,
  getOdProjectManifestPath,
  getArtifactVersionDir,
  getArtifactVersionManifestPath,
  getArtifactVersionAssetsDir,
  getArtifactVersionPreviewPath,
} from '../src/artifact-paths.js';

describe('artifact-paths', () => {
  const root = '/data/products';
  const pid = 'P-abc123';
  const aid = 'AbCdEfGhIjKlMnOp';

  it('getProductOdProjectDir', () => {
    expect(getProductOdProjectDir(root, pid)).toBe('/data/products/P-abc123/od-project');
  });

  it('getArtifactsDir', () => {
    expect(getArtifactsDir(root, pid)).toBe('/data/products/P-abc123/od-project/artifacts');
  });

  it('getArtifactDir', () => {
    expect(getArtifactDir(root, pid, aid)).toBe('/data/products/P-abc123/od-project/artifacts/AbCdEfGhIjKlMnOp');
  });

  it('getArtifactManifestPath', () => {
    expect(getArtifactManifestPath(root, pid, aid)).toBe('/data/products/P-abc123/od-project/artifacts/AbCdEfGhIjKlMnOp/manifest.json');
  });

  it('getArtifactPreviewPath 1x', () => {
    expect(getArtifactPreviewPath(root, pid, aid, '1x')).toBe('/data/products/P-abc123/od-project/artifacts/AbCdEfGhIjKlMnOp/preview/1x.png');
  });

  it('getArtifactPreviewPath 2x', () => {
    expect(getArtifactPreviewPath(root, pid, aid, '2x')).toBe('/data/products/P-abc123/od-project/artifacts/AbCdEfGhIjKlMnOp/preview/2x.png');
  });

  it('getOdProjectManifestPath', () => {
    expect(getOdProjectManifestPath(root, pid)).toBe('/data/products/P-abc123/od-project/manifest.json');
  });

  it('all artifact paths use od-project directory', () => {
    const paths = [
      getProductOdProjectDir(root, pid),
      getArtifactsDir(root, pid),
      getArtifactDir(root, pid, aid),
      getArtifactManifestPath(root, pid, aid),
    ];
    for (const p of paths) {
      expect(p).toContain('od-project');
    }
  });

  it('rejects product ids that would escape the products root', () => {
    expect(() => getArtifactsDir(root, '../P-abc123')).toThrow('Invalid product id');
    expect(() => getProductOdProjectDir(root, 'P-abc123/../../escape')).toThrow('Invalid product id');
  });

  it('rejects artifact ids that would escape the artifact root', () => {
    expect(() => getArtifactDir(root, pid, '../AbCdEfGhIjKlMnOp')).toThrow('Invalid artifact id');
    expect(() => getArtifactManifestPath(root, pid, 'AbCdEfGhIjKlMnOp/../../escape')).toThrow('Invalid artifact id');
    expect(() => getArtifactPreviewPath(root, pid, 'AbCdEfGhIjKlMnOp\0', '2x')).toThrow('Invalid artifact id');
  });
});

describe('A2 versioned artifact paths', () => {
  const root = '/tmp/products';
  const pid = 'P-ab1234';
  const aid = 'AbCdEfGhIjKlMnOp';

  it('builds v{n} dir under artifacts/{id}', () => {
    expect(getArtifactVersionDir(root, pid, aid, 1).endsWith('od-project/artifacts/AbCdEfGhIjKlMnOp/v1')).toBe(true);
  });
  it('builds version manifest / assets / preview paths', () => {
    expect(getArtifactVersionManifestPath(root, pid, aid, 2).endsWith('v2/manifest.json')).toBe(true);
    expect(getArtifactVersionAssetsDir(root, pid, aid, 3).endsWith('v3/assets')).toBe(true);
    expect(getArtifactVersionPreviewPath(root, pid, aid, 1, '2x').endsWith('v1/preview/2x.png')).toBe(true);
  });
  it('rejects non-positive-integer version', () => {
    expect(() => getArtifactVersionDir(root, pid, aid, 0)).toThrow();
    expect(() => getArtifactVersionDir(root, pid, aid, 1.5)).toThrow();
    expect(() => getArtifactVersionDir(root, pid, aid, -1)).toThrow();
  });
});
