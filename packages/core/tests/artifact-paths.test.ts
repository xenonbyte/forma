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
  getArtifactIconsDir,
  getArtifactIconsManifestPath,
  getArtifactVziDir,
  getArtifactVziPath,
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

describe('A5 page-level icons/vzi path helpers', () => {
  const root = '/data/products';
  const pid = 'P-abc123';
  const aid = 'AbCdEfGhIjKlMnOp';
  const base = `/data/products/P-abc123/od-project/artifacts/AbCdEfGhIjKlMnOp`;

  it('getArtifactIconsDir returns artifact-level icons/ sibling', () => {
    expect(getArtifactIconsDir(root, pid, aid)).toBe(`${base}/icons`);
  });

  it('getArtifactIconsManifestPath returns icons/icons.json', () => {
    expect(getArtifactIconsManifestPath(root, pid, aid)).toBe(`${base}/icons/icons.json`);
  });

  it('getArtifactVziDir returns artifact-level vzi/ sibling', () => {
    expect(getArtifactVziDir(root, pid, aid)).toBe(`${base}/vzi`);
  });

  it('getArtifactVziPath returns vzi/page.vzi', () => {
    expect(getArtifactVziPath(root, pid, aid)).toBe(`${base}/vzi/page.vzi`);
  });

  it('all icons/vzi paths are under od-project/artifacts', () => {
    const paths = [
      getArtifactIconsDir(root, pid, aid),
      getArtifactIconsManifestPath(root, pid, aid),
      getArtifactVziDir(root, pid, aid),
      getArtifactVziPath(root, pid, aid),
    ];
    for (const p of paths) {
      expect(p).toContain('od-project/artifacts');
    }
  });

  it('rejects invalid product id', () => {
    expect(() => getArtifactIconsDir(root, '../P-abc123', aid)).toThrow('Invalid product id');
    expect(() => getArtifactVziPath(root, 'bad-id', aid)).toThrow('Invalid product id');
  });

  it('rejects invalid artifact id', () => {
    expect(() => getArtifactIconsDir(root, pid, '../escape')).toThrow('Invalid artifact id');
    expect(() => getArtifactVziPath(root, pid, 'bad id!')).toThrow('Invalid artifact id');
  });
});
