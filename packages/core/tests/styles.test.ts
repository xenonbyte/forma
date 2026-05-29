import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StyleService } from '../src/styles.js';

function svc() {
  return new StyleService({ home: '/tmp/forma-styles', bundledStylesDir: resolve('styles'), bundledCraftDir: resolve('craft') });
}

describe('B4 styles.ts new format', () => {
  it('listStyles returns >=150 brand styles, no variables field', async () => {
    const styles = await svc().listStyles();
    expect(styles.length).toBeGreaterThanOrEqual(150);
    const ant = styles.find((s) => s.name === 'ant');
    expect(ant).toBeDefined();
    expect((ant as Record<string, unknown>).variables).toBeUndefined();
    expect(ant?.tokens_css_path).toBe('styles/ant/tokens.css');
  });

  it('getStyle returns 3 files for a brand style', async () => {
    const r = await svc().getStyle('ant');
    expect(r.kind).toBe('brand');
    expect(r.designMd.length).toBeGreaterThan(0);
    expect(r.tokensCss).toContain('--accent');
    expect(r.componentsHtml.length).toBeGreaterThan(0);
  });

  it('listSystemStyles returns >=36 catalog stubs', async () => {
    const systems = await svc().listSystemStyles();
    expect(systems.length).toBeGreaterThanOrEqual(36);
    expect(systems[0].mode).toBe('design-system');
  });

  it('getStyle throws for unknown style', async () => {
    await expect(svc().getStyle('nope')).rejects.toThrow();
  });
});
