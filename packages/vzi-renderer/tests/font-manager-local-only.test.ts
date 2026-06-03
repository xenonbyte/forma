import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const SOURCE = readFileSync(
  new URL('../src/canvaskit/FontManager.ts', import.meta.url),
  'utf8',
);

describe('FontManager is local-only', () => {
  for (const host of [
    'raw.githubusercontent.com',
    'fonts.googleapis.com',
    'cdn.jsdelivr.net',
  ]) {
    it(`does not reference ${host}`, () => {
      expect(SOURCE).not.toContain(host);
    });
  }

  it('maps every required family to a bundled local file name', () => {
    for (const file of [
      'NotoSansCJKsc-Regular.otf',
      'NotoSans-Variable.ttf',
      'Inter-Variable.ttf',
      'SpaceGrotesk-Variable.ttf',
      'NotoSansMono-Variable.ttf',
      'MaterialIcons-Regular.ttf',
      'MaterialSymbolsOutlined-Variable.ttf',
      'MaterialSymbolsRounded-Variable.ttf',
      'MaterialSymbolsSharp-Variable.ttf',
    ]) {
      expect(SOURCE).toContain(file);
    }
  });

  it('checks the web public runtime-assets font directory in Node', () => {
    expect(SOURCE).toContain('packages/web/public/runtime-assets/fonts');
  });

  it('allows same-origin browser font asset URLs but rejects remote origins', () => {
    expect(SOURCE).toContain('isAllowedBrowserFontUrl');
    expect(SOURCE).toContain('document.baseURI');
    expect(SOURCE).toContain('Remote font URL is not allowed in local-only FontManager');
  });
});
