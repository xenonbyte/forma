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
      expect(title!.backgroundSolid).toBe(true);
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
      expect(copy!.backgroundSolid).toBe(true);
      const ratio = contrastRatio(
        [copy!.color[0], copy!.color[1], copy!.color[2]],
        [copy!.backgroundColor[0], copy!.backgroundColor[1], copy!.backgroundColor[2]],
      );
      expect(ratio).toBeLessThan(4.5);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it('marks text over a CSS gradient/background-image as non-solid (not a white fallback)', async () => {
    const bundleDir = join(tmpdir(), `forma-snap4-${randomBytes(6).toString('hex')}`);
    const outDir = join(bundleDir, 'preview');
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, 'index.html'),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <section style="background:linear-gradient(#000000,#333333)">
           <p style="color:#ffffff;font-size:16px;font-family:Inter">On gradient</p>
         </section>
       </body></html>`,
      'utf8',
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const onGradient = result.snapshot!.textNodes.find((n) => n.text.includes('On gradient'));
      expect(onGradient).toBeDefined();
      expect(onGradient!.backgroundSolid).toBe(false);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it('captures only direct text per element (does not re-absorb a styled child\'s text)', async () => {
    const bundleDir = join(tmpdir(), `forma-snap6-${randomBytes(6).toString('hex')}`);
    const outDir = join(bundleDir, 'preview');
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, 'index.html'),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <p style="color:#111111;font-size:16px;font-family:Inter">Hello <strong style="color:#222222">world</strong></p>
       </body></html>`,
      'utf8',
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const nodes = result.snapshot!.textNodes;
      const p = nodes.find((n) => n.tag === 'p');
      const strong = nodes.find((n) => n.tag === 'strong');
      expect(p).toBeDefined();
      expect(strong).toBeDefined();
      // the <p> entry holds only its own direct text, NOT the child's "world"
      expect(p!.text).toBe('Hello');
      expect(strong!.text).toBe('world');
      // "world" appears exactly once across the snapshot (no double count)
      expect(nodes.filter((n) => n.text.includes('world'))).toHaveLength(1);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it('captures rendered text from form controls (submit value, placeholder)', async () => {
    const bundleDir = join(tmpdir(), `forma-snap5-${randomBytes(6).toString('hex')}`);
    const outDir = join(bundleDir, 'preview');
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, 'index.html'),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <input type="submit" value="Save Changes" style="color:#111111;font-size:14px;font-family:Inter">
         <input type="text" placeholder="Search here" style="color:#111111;font-size:14px;font-family:Inter">
       </body></html>`,
      'utf8',
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const nodes = result.snapshot!.textNodes;
      const submit = nodes.find((n) => n.text === 'Save Changes');
      expect(submit).toBeDefined();
      expect(submit!.tag).toBe('input');
      expect(submit!.color[0]).toBeLessThan(40); // near-#111
      expect(submit!.backgroundSolid).toBe(true);
      const placeholder = nodes.find((n) => n.text === 'Search here');
      expect(placeholder).toBeDefined();
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);
});
