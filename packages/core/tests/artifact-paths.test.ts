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
  const pid = 'prod-abc';
  const aid = 'art-xyz';

  it('getProductOdProjectDir', () => {
    expect(getProductOdProjectDir(root, pid)).toBe('/data/products/prod-abc/od-project');
  });

  it('getArtifactsDir', () => {
    expect(getArtifactsDir(root, pid)).toBe('/data/products/prod-abc/od-project/artifacts');
  });

  it('getArtifactDir', () => {
    expect(getArtifactDir(root, pid, aid)).toBe('/data/products/prod-abc/od-project/artifacts/art-xyz');
  });

  it('getArtifactManifestPath', () => {
    expect(getArtifactManifestPath(root, pid, aid)).toBe('/data/products/prod-abc/od-project/artifacts/art-xyz/manifest.json');
  });

  it('getArtifactPreviewPath 1x', () => {
    expect(getArtifactPreviewPath(root, pid, aid, '1x')).toBe('/data/products/prod-abc/od-project/artifacts/art-xyz/preview/1x.png');
  });

  it('getArtifactPreviewPath 2x', () => {
    expect(getArtifactPreviewPath(root, pid, aid, '2x')).toBe('/data/products/prod-abc/od-project/artifacts/art-xyz/preview/2x.png');
  });

  it('getOdProjectManifestPath', () => {
    expect(getOdProjectManifestPath(root, pid)).toBe('/data/products/prod-abc/od-project/manifest.json');
  });

  it('no old data/designs or library paths', () => {
    // Static verification: all returned paths contain od-project
    const paths = [
      getProductOdProjectDir(root, pid),
      getArtifactsDir(root, pid),
      getArtifactDir(root, pid, aid),
      getArtifactManifestPath(root, pid, aid),
    ];
    for (const p of paths) {
      expect(p).toContain('od-project');
      expect(p).not.toContain('data/designs');
      expect(p).not.toContain('library');
    }
  });
});
