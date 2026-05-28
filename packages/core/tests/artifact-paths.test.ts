import { describe, it, expect } from 'vitest';
import {
  getProductOdProjectDir,
  getArtifactsDir,
  getArtifactDir,
  getArtifactManifestPath,
  getArtifactPreviewPath,
  getOdProjectManifestPath,
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
