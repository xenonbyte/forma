import { describe, it, expect, vi } from 'vitest';
import { createApiClient } from './api.js';

describe('getRequirementHandoff', () => {
  it('GETs the handoff route and returns pages + errors', async () => {
    const payload = {
      pages: [{
        pageId: 'home', artifactId: 'A-home', variant: 'default', version: 1, title: 'Home', iconCount: 1,
        vziUrl: '/api/products/P-abc123/artifacts/A-home/vzi/page.vzi',
        contentUrl: '/api/products/P-abc123/artifacts/A-home/vzi/content',
        iconBaseUrl: '/api/products/P-abc123/artifacts/A-home/icons/',
        bundleBaseUrl: '/api/products/P-abc123/artifacts/A-home/versions/1/bundle/',
      }],
      errors: [],
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const client = createApiClient(fetcher);
    const result = await client.getRequirementHandoff('P-abc123', 'R-1');
    expect(fetcher).toHaveBeenCalledWith('/api/products/P-abc123/requirements/R-1/handoff', expect.anything());
    expect(result.pages[0].vziUrl).toContain('page.vzi');
    expect(result.pages[0].contentUrl).toBe('/api/products/P-abc123/artifacts/A-home/vzi/content');
    expect(result.errors).toEqual([]);
  });
});
