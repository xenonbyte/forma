import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  new URL('../src/canvaskit/CanvasKitLoader.ts', import.meta.url),
  'utf8',
);

describe('CanvasKitLoader is local-only in the browser', () => {
  it('does not include a CDN wasm fallback', () => {
    expect(SOURCE).not.toContain('unpkg.com');
    expect(SOURCE).not.toContain('CANVASKIT_CDN_BASE');
  });

  it('uses committed runtime-assets candidates', () => {
    expect(SOURCE).toContain('/runtime-assets/canvaskit/');
    expect(SOURCE).toContain("new URL('runtime-assets/canvaskit/', document.baseURI)");
  });
});
