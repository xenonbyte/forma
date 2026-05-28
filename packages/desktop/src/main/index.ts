import { existsSync } from 'fs';
import { resolve } from 'path';

const MIN_ELECTRON_VERSION = 41;

export function assertElectronVersion(): void {
  const version = parseInt(process.versions.electron.split('.')[0], 10);
  if (version < MIN_ELECTRON_VERSION) {
    throw new Error(
      `FORMA_DESKTOP_CONFIG_UNSUPPORTED: Electron ${process.versions.electron} is below minimum required ${MIN_ELECTRON_VERSION}.x`
    );
  }
}

export function createProtocolHandler(assetsRoot: string) {
  return (request: { url: string }): Response => {
    // Block path traversal in the raw URL string before any normalization.
    // new URL() absorbs '..' segments silently; check early to be safe.
    if (/(\.\.|%2e%2e)/i.test(request.url)) {
      return new Response('Forbidden', { status: 403 });
    }
    const url = new URL(request.url);
    const relativePath = decodeURIComponent(url.pathname).replace(/^\//, '');
    // Secondary guard: resolved path must stay inside assetsRoot.
    const safePath = resolve(assetsRoot, relativePath);
    if (!safePath.startsWith(resolve(assetsRoot))) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!existsSync(safePath)) {
      return new Response('Not found', { status: 404 });
    }
    // Return file content — real impl uses fs.createReadStream
    return new Response(null, { status: 200 });
  };
}

// Main entry — only runs when not in test
if (process.env.NODE_ENV !== 'test') {
  // Dynamic import keeps electron out of the module graph during tests
  const { app, BrowserWindow, protocol } = await import('electron');
  const { createReadStream } = await import('fs');
  const { join } = await import('path');

  assertElectronVersion();

  app.on('ready', () => {
    const assetsRoot = app.getPath('userData');

    protocol.handle('forma-asset', (request) => {
      const url = new URL(request.url);
      const relativePath = decodeURIComponent(url.pathname).replace(/^\//, '');
      const safePath = resolve(assetsRoot, relativePath);
      if (!safePath.startsWith(resolve(assetsRoot))) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!existsSync(safePath)) {
        return new Response('Not found', { status: 404 });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new Response(createReadStream(safePath) as unknown as any);
    });

    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: join(__dirname, '../preload/index.js'),
      },
    });

    win.loadFile(join(__dirname, '../../renderer/index.html'));
  });
}
