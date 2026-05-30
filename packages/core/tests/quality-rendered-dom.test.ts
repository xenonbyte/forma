import { describe, expect, it } from 'vitest';
import { renderArtifactPreview } from '../src/preview-renderer.js';
import { contrastRatio } from '../src/quality/contrast.js';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

describe('extractDom via renderArtifactPreview', () => {
  it('returns a snapshot of rendered text nodes with computed color/font', async () => {
    const bundleDir = join(tmpdir(), `forma-snap-${randomBytes(6).toString('hex')}`);
    const outDir = join(bundleDir, 'preview');
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, 'index.html'),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <h1 style="color:#111111;font-size:32px;font-family:Inter">Title</h1>
         <p style="color:#777777;font-size:16px;font-family:Inter">Body text here</p>
       </body></html>`,
      'utf8',
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      expect(result.snapshot).toBeDefined();
      const nodes = result.snapshot!.textNodes;
      // both the h1 and p carry direct text
      const sizes = nodes.map((n) => n.fontSizePx).sort((a, b) => a - b);
      expect(sizes).toContain(16);
      expect(sizes).toContain(32);
      // h1 color is near-black, on a white effective background
      const title = nodes.find((n) => n.text.includes('Title'));
      expect(title).toBeDefined();
      expect(title!.color[0]).toBeLessThan(40);
      expect(title!.backgroundColor.slice(0, 3)).toEqual([255, 255, 255]);
      expect(title!.fontFamily).toContain('inter');
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it('omits snapshot when extractDom is not set', async () => {
    const bundleDir = join(tmpdir(), `forma-snap2-${randomBytes(6).toString('hex')}`);
    const outDir = join(bundleDir, 'preview');
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(bundleDir, 'index.html'), `<!doctype html><body style="margin:0"><p>hi</p></body>`, 'utf8');
    try {
      const result = await renderArtifactPreview({ bundleDir, outDir });
      expect(result.snapshot).toBeUndefined();
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it('composites translucent ancestor backgrounds before snapshotting contrast inputs', async () => {
    const bundleDir = join(tmpdir(), `forma-snap3-${randomBytes(6).toString('hex')}`);
    const outDir = join(bundleDir, 'preview');
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, 'index.html'),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <section style="background:rgba(0,0,0,0.5)">
           <p style="color:#ffffff;font-size:16px;font-family:Inter">Overlay copy</p>
         </section>
       </body></html>`,
      'utf8',
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const copy = result.snapshot!.textNodes.find((n) => n.text.includes('Overlay copy'));
      expect(copy).toBeDefined();
      expect(copy!.backgroundColor.slice(0, 3)).toEqual([128, 128, 128]);
      const ratio = contrastRatio(
        [copy!.color[0], copy!.color[1], copy!.color[2]],
        [copy!.backgroundColor[0], copy!.backgroundColor[1], copy!.backgroundColor[2]],
      );
      expect(ratio).toBeLessThan(4.5);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);
});
