import { describe, it, expect, vi } from 'vitest';
import {
  parseSessionYaml,
  checkServerHealth,
  FORMA_DEFAULT_PORT,
} from './session.js';

describe('parseSessionYaml', () => {
  it('returns null when content is empty', () => {
    expect(parseSessionYaml('')).toBeNull();
  });

  it('returns null when pid or token missing', () => {
    expect(parseSessionYaml('marker: xenonbyte.forma.serve\npid: 12345')).toBeNull();
    expect(parseSessionYaml('marker: xenonbyte.forma.serve\ntoken: abc123')).toBeNull();
  });

  it('returns SessionInfo with default port when valid yaml', () => {
    const content =
      'marker: xenonbyte.forma.serve\npid: 12345\ntoken: abc123\nstarted_at: 2026-05-28T00:00:00Z';
    expect(parseSessionYaml(content)).toEqual({
      port: FORMA_DEFAULT_PORT,
      token: 'abc123',
      pid: 12345,
    });
  });
});

describe('checkServerHealth', () => {
  it('returns true when fetch succeeds with ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
    const result = await checkServerHealth(FORMA_DEFAULT_PORT, mockFetch);
    expect(result).toBe(true);
  });

  it('returns false when fetch throws', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const result = await checkServerHealth(FORMA_DEFAULT_PORT, mockFetch);
    expect(result).toBe(false);
  });
});
