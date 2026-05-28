import { describe, it, expect } from 'vitest';

// Mirrors ALLOWED_MUTATION_ORIGINS in packages/server/src/routes.ts (SPEC-PERM-003).
// The desktop renderer uses forma-asset:// or file:// scheme — neither is in this set.
const ALLOWED_MUTATION_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:4173',
]);

// Mirrors the isOriginAllowed logic from packages/server/src/routes.ts.
// undefined origin (no Origin header) → allowed (same-origin CLI / curl).
// "null" origin → blocked (sandboxed renderer sends this).
// forma-asset:// prefix → blocked (Electron renderer).
// Anything else must be in ALLOWED_MUTATION_ORIGINS.
function isOriginAllowed(originStr: string | undefined): boolean {
  if (originStr === undefined) return true;
  if (originStr === 'null') return false;
  if (originStr.startsWith('forma-asset://')) return false;
  return ALLOWED_MUTATION_ORIGINS.has(originStr);
}

describe('mutation origin guard (SPEC-PERM-003)', () => {
  it('desktop origin is not in the mutation whitelist', () => {
    // Desktop renderer uses forma-asset:// scheme or file:// — neither is whitelisted.
    expect(ALLOWED_MUTATION_ORIGINS.has('forma-asset://localhost')).toBe(false);
    expect(ALLOWED_MUTATION_ORIGINS.has('file://')).toBe(false);
    expect(ALLOWED_MUTATION_ORIGINS.has('null')).toBe(false); // sandboxed renderer sends null origin
  });

  it('admin web origins are in the mutation whitelist', () => {
    expect(ALLOWED_MUTATION_ORIGINS.has('http://localhost:5173')).toBe(true);
    expect(ALLOWED_MUTATION_ORIGINS.has('http://localhost:4173')).toBe(true);
  });

  it('arbitrary origins are not in the mutation whitelist', () => {
    const arbitraryOrigins = [
      'http://evil.com',
      'https://localhost:5173',
      'http://localhost:9999',
    ];
    for (const origin of arbitraryOrigins) {
      expect(ALLOWED_MUTATION_ORIGINS.has(origin)).toBe(false);
    }
  });

  it('isOriginAllowed blocks forma-asset:// (Electron renderer scheme)', () => {
    expect(isOriginAllowed('forma-asset://localhost')).toBe(false);
    expect(isOriginAllowed('forma-asset://')).toBe(false);
  });

  it('isOriginAllowed blocks null origin (sandboxed renderer)', () => {
    expect(isOriginAllowed('null')).toBe(false);
  });

  it('isOriginAllowed blocks file:// origin', () => {
    expect(isOriginAllowed('file://')).toBe(false);
  });

  it('isOriginAllowed allows whitelisted admin origins', () => {
    expect(isOriginAllowed('http://localhost:5173')).toBe(true);
    expect(isOriginAllowed('http://localhost:4173')).toBe(true);
  });

  it('isOriginAllowed allows undefined origin (no header — CLI / curl)', () => {
    expect(isOriginAllowed(undefined)).toBe(true);
  });

  it('isOriginAllowed blocks arbitrary origins', () => {
    expect(isOriginAllowed('http://evil.com')).toBe(false);
    expect(isOriginAllowed('https://localhost:5173')).toBe(false);
    expect(isOriginAllowed('http://localhost:9999')).toBe(false);
  });
});
