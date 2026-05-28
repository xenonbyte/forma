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
});
