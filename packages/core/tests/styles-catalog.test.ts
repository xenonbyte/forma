import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';

describe('B2 brand styles catalog (new 3-file format)', () => {
  it('styles.yaml lists >=150 brand styles, each with 3 file paths and no variables block', async () => {
    const raw = await readFile(resolve('styles/styles.yaml'), 'utf8');
    const doc = load(raw) as { styles: Array<Record<string, unknown>> };
    expect(doc.styles.length).toBeGreaterThanOrEqual(150);
    for (const s of doc.styles) {
      expect(typeof s.name).toBe('string');
      expect(typeof s.description).toBe('string');
      expect(s.design_md_path).toMatch(/^styles\/[^/]+\/DESIGN\.md$/);
      expect(s.tokens_css_path).toMatch(/^styles\/[^/]+\/tokens\.css$/);
      expect(s.components_html_path).toMatch(/^styles\/[^/]+\/components\.html$/);
      expect(s.variables).toBeUndefined(); // 旧 variables 块已移除
    }
  });
});
