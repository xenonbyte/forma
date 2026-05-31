import { describe, it, expect } from 'vitest';

const EXPECTED_API_KEYS = [
  'listProducts',
  'getProduct',
  'listArtifacts',
  'getArtifact',
  'listRequirements',
  'getRequirement',
  'formaServerStatus',
  'formaServerBaseUrl',
  'listStyles',
  'getStyle',
] as const;

describe('preload readonlyApi', () => {
  it('exposes only readonly API methods', async () => {
    const { readonlyApi } = await import('./index.js');
    const actualKeys = Object.keys(readonlyApi).sort();
    const expectedKeys = [...EXPECTED_API_KEYS].sort();
    expect(actualKeys).toEqual(expectedKeys);
  });
});
