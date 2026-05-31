import { describe, it, expect } from 'vitest';
import { parseHash, buildHash } from './router.js';

describe('parseHash', () => {
  it('returns none for empty / root hash', () => {
    expect(parseHash('')).toEqual({ type: 'none' });
    expect(parseHash('#')).toEqual({ type: 'none' });
    expect(parseHash('#/')).toEqual({ type: 'none' });
  });

  it('parses a requirement selection', () => {
    expect(parseHash('#/products/p-1/requirements/r-1')).toEqual({
      type: 'requirement',
      productId: 'p-1',
      reqId: 'r-1',
    });
  });

  it('parses a page selection', () => {
    expect(parseHash('#/products/p-1/requirements/r-1/pages/login')).toEqual({
      type: 'page',
      productId: 'p-1',
      reqId: 'r-1',
      pageId: 'login',
    });
  });

  it('parses a style selection', () => {
    expect(parseHash('#/styles/clean')).toEqual({ type: 'style', name: 'clean' });
  });

  it('decodes URI components', () => {
    expect(parseHash('#/products/p%201/requirements/r%2F1')).toEqual({
      type: 'requirement',
      productId: 'p 1',
      reqId: 'r/1',
    });
    expect(parseHash('#/styles/a%20b')).toEqual({ type: 'style', name: 'a b' });
  });

  it('returns none for unrecognized shapes', () => {
    expect(parseHash('#/products/p-1')).toEqual({ type: 'none' });
    expect(parseHash('#/garbage/x/y')).toEqual({ type: 'none' });
    expect(parseHash('#/products/p-1/requirements')).toEqual({ type: 'none' });
  });
});

describe('buildHash', () => {
  it('builds requirement / page / style hashes and round-trips through parseHash', () => {
    const req = { type: 'requirement', productId: 'p 1', reqId: 'r/1' } as const;
    const page = { type: 'page', productId: 'p-1', reqId: 'r-1', pageId: 'login' } as const;
    const style = { type: 'style', name: 'a b' } as const;
    expect(parseHash(buildHash(req))).toEqual(req);
    expect(parseHash(buildHash(page))).toEqual(page);
    expect(parseHash(buildHash(style))).toEqual(style);
  });
});
