import { describe, it, expect } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// Import the ProductService to load products from disk
// We need to test that product.yaml with .pen fields loads without error
// and without console output.

describe('SPEC-PLAN-017: product.yaml .pen field backward compat', () => {
  it('loads product.yaml with .pen fields, drops them silently, no console output', async () => {
    // Find and import ProductService
    const { ProductService } = await import('../src/product.js');
    const { getProductMutationLock } = await import('../src/product-mutation-lock.js');

    const testHome = join(tmpdir(), `pen-compat-${randomBytes(4).toString('hex')}`);
    const dataDir = join(testHome, 'data');
    const productId = 'P-abc123';
    const productDir = join(dataDir, productId);

    await mkdir(productDir, { recursive: true });

    // Write a product.yaml that includes .pen legacy fields
    const productYaml = `
id: ${productId}
name: Test Product
description: A test product
platform: web
style:
  name: Default
  description: Default style
  design_md_path: styles/default.md
  variables:
    primary: "#111827"
    background: "#FFFFFF"
    text-primary: "#111827"
    font-heading: Inter
    font-body: Inter
    border-radius: 8px
    spacing-unit: 8px
languages:
  - en
default_language: en
pencil_document_id: some-old-pencil-id
design_canvas_path: /old/pencil/path.pen
`.trim();

    await writeFile(join(productDir, 'product.yaml'), productYaml, 'utf8');

    // Create product index (at data/products.yaml per ProductService impl)
    await writeFile(
      join(dataDir, 'products.yaml'),
      `products:\n  - id: ${productId}\n    name: Test Product\n    description: A test product\n`,
      'utf8'
    );

    const lock = getProductMutationLock(testHome);
    const service = new ProductService({
      home: testHome,
      productMutationLock: lock,
    });

    // Capture console output
    const consoleLogs: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    console.log = (...args: unknown[]) => consoleLogs.push(args.join(' '));
    console.warn = (...args: unknown[]) => consoleLogs.push(args.join(' '));
    console.error = (...args: unknown[]) => consoleLogs.push(args.join(' '));

    try {
      const product = await service.getProduct(productId);

      // .pen fields must not appear in loaded product
      expect((product as unknown as Record<string, unknown>).pencil_document_id).toBeUndefined();
      expect((product as unknown as Record<string, unknown>).design_canvas_path).toBeUndefined();

      // No console output related to pen fields
      const penRelated = consoleLogs.filter(l => l.includes('pencil') || l.includes('.pen'));
      expect(penRelated).toHaveLength(0);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
      await rm(testHome, { recursive: true, force: true });
    }
  });
});
