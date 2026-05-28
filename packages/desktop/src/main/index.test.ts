import { readFile } from 'fs/promises';
import { describe, it, expect, vi, afterEach } from 'vitest';

// We test the exported pure functions without launching real Electron.
// The module guards `if (process.env.NODE_ENV !== 'test')` so the Electron
// app lifecycle never runs during tests.

describe('assertElectronVersion', () => {
  const originalVersion = process.versions.electron;

  afterEach(() => {
    // Restore original value
    Object.defineProperty(process.versions, 'electron', {
      value: originalVersion,
      writable: true,
      configurable: true,
    });
    vi.resetModules();
  });

  it('rejects unsupported Electron version', async () => {
    Object.defineProperty(process.versions, 'electron', {
      value: '39.0.0',
      writable: true,
      configurable: true,
    });
    const { assertElectronVersion } = await import('./index.js');
    expect(() => assertElectronVersion()).toThrow('FORMA_DESKTOP_CONFIG_UNSUPPORTED');
  });

  it('accepts supported Electron version 41', async () => {
    Object.defineProperty(process.versions, 'electron', {
      value: '41.0.0',
      writable: true,
      configurable: true,
    });
    const { assertElectronVersion } = await import('./index.js');
    expect(() => assertElectronVersion()).not.toThrow();
  });
});

describe('createProtocolHandler', () => {
  it('protocol handler rejects path traversal', async () => {
    const { createProtocolHandler } = await import('./index.js');
    const handler = createProtocolHandler('/some/assets/root');
    const response = handler({ url: 'forma-asset://../etc/passwd' });
    expect(response.status).toBe(403);
  });

  it('protocol path resolver rejects encoded traversal before normalization', async () => {
    const { resolveFormaAssetPath } = await import('./index.js');
    const result = resolveFormaAssetPath('/some/assets/root', 'forma-asset:///%2e%2e%2froot-sibling/file.png');
    expect(result).toEqual({ status: 403 });
  });
});

describe('renderer paths', () => {
  it('resolves the production renderer next to out/main', async () => {
    const { resolveRendererIndexPath } = await import('./index.js');
    expect(resolveRendererIndexPath('/repo/packages/desktop/out/main')).toBe('/repo/packages/desktop/out/renderer/index.html');
  });

  it('uses a CommonJS-compatible package entry for electron-vite main output', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { main?: string; type?: string };
    expect(packageJson.main).toBe('out/main/index.js');
    expect(packageJson.type).not.toBe('module');
  });
});

describe('main process startup guard', () => {
  it('skips Electron startup when NODE_ENV is test at runtime', async () => {
    const { shouldStartMainProcess } = await import('./index.js');
    expect(shouldStartMainProcess({ NODE_ENV: 'test' })).toBe(false);
    expect(shouldStartMainProcess({ NODE_ENV: 'production' })).toBe(true);
  });
});

describe('createFormaHttpClient', () => {
  it('returns absolute HTTP preview URLs for the file-loaded renderer', async () => {
    const { createFormaHttpClient } = await import('./index.js');
    const fetchFn = vi.fn(async (input: string | URL) => {
      const path = input.toString();
      if (path.endsWith('/artifacts/A-123')) {
        return new Response(JSON.stringify({ manifest: { id: 'A-123' }, preview_url: '/api/products/P-123/artifacts/A-123/preview/2x' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ artifacts: [{ id: 'A-123', preview_url: '/api/products/P-123/artifacts/A-123/preview/1x' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const client = createFormaHttpClient({ baseUrl: 'http://127.0.0.1:3000', fetchFn: fetchFn as typeof fetch });

    await expect(client.listArtifacts('P-123')).resolves.toEqual({
      artifacts: [{ id: 'A-123', preview_url: 'http://127.0.0.1:3000/api/products/P-123/artifacts/A-123/preview/1x' }],
    });
    await expect(client.getArtifact('P-123', 'A-123')).resolves.toEqual({
      manifest: { id: 'A-123' },
      preview_url: 'http://127.0.0.1:3000/api/products/P-123/artifacts/A-123/preview/2x',
    });
  });
});

describe('registerFormaIpcHandlers', () => {
  it('registers handlers for every preload channel and proxies readonly calls', async () => {
    const { registerFormaIpcHandlers } = await import('./index.js');
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const client = {
      listProducts: vi.fn(async () => ({ products: [] })),
      getProduct: vi.fn(async (id: string) => ({ id })),
      listArtifacts: vi.fn(async (productId: string) => ({ artifacts: [], productId })),
      getArtifact: vi.fn(async (productId: string, artifactId: string) => ({ manifest: { id: artifactId }, productId })),
      listRequirements: vi.fn(async (productId: string) => ({ requirements: [], productId })),
      getRequirement: vi.fn(async (productId: string, requirementId: string) => ({ id: requirementId, productId })),
      serverStatus: vi.fn(async () => true),
    };

    registerFormaIpcHandlers({
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    }, client);

    expect([...handlers.keys()].sort()).toEqual([
      'forma:getArtifact',
      'forma:getProduct',
      'forma:getRequirement',
      'forma:listArtifacts',
      'forma:listProducts',
      'forma:listRequirements',
      'forma:serverStatus',
    ]);
    await expect(handlers.get('forma:getArtifact')?.({}, 'P-123abc', 'AbCdEfGhIjKlMnOp')).resolves.toMatchObject({
      manifest: { id: 'AbCdEfGhIjKlMnOp' },
    });
    expect(client.getArtifact).toHaveBeenCalledWith('P-123abc', 'AbCdEfGhIjKlMnOp');
  });
});
