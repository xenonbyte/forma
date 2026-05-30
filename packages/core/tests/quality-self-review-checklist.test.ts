import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SELF_REVIEW_CHECKLIST } from '../src/quality/self-review-checklist.js';
import { StyleService } from '../src/styles.js';

describe('SELF_REVIEW_CHECKLIST', () => {
  it('is a non-empty list of well-formed items', () => {
    expect(SELF_REVIEW_CHECKLIST.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const item of SELF_REVIEW_CHECKLIST) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
      expect(item.craftDoc).toMatch(/^[a-z0-9-]+$/);
      expect(item.prompt.trim().length).toBeGreaterThan(0);
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
    }
  });

  it('every referenced craftDoc slug exists in the bundled craft docs', async () => {
    const home = await mkdtemp(join(tmpdir(), 'forma-checklist-'));
    const styles = new StyleService({ home, bundledCraftDir: resolve('craft') });
    const slugs = new Set((await styles.listCraftDocs()).map((d) => d.slug));
    for (const item of SELF_REVIEW_CHECKLIST) {
      expect(slugs.has(item.craftDoc), `craftDoc "${item.craftDoc}" not found`).toBe(true);
    }
  });
});
