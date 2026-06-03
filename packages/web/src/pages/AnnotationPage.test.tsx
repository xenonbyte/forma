// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../LocaleContext.js';
import type { FormaApiClient, RequirementHandoff } from '../api.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock the WebGL surface — happy-dom has no canvas/WebGL. The adapter pulls
// buildCanvasKitElementTree from the same module, so mock it here too.
vi.mock('@vzi-core/renderer', async () => {
  const React = await import('react');
  return {
    CanvasKitSurface: (props: { elements?: unknown[] }) =>
      React.createElement('div', {
        'data-testid': 'ck-surface',
        'data-count': (props.elements ?? []).length,
      }),
    buildCanvasKitElementTree: (doc: { elements?: Record<string, unknown> }) =>
      Object.values(doc.elements ?? {}).map((e) => ({ ...(e as object), children: [] })),
  };
});

// Mock the decoder so we don't need real .vzi bytes.
vi.mock('@vzi-core/format', () => ({
  VZIDecoder: class {
    decode(bytes: Uint8Array) {
      const elements = bytes[0] === 9
        ? new Map([
          ['icon', { id: 'icon', parentId: null, type: 'image', bounds: { x: 0, y: 0, width: 24, height: 24 }, styles: {}, imageData: { src: 'icons/missing.svg' } }],
          ['bundle', { id: 'bundle', parentId: null, type: 'image', bounds: { x: 32, y: 0, width: 24, height: 24 }, styles: {}, imageData: { src: 'assets/missing.png' } }],
        ])
        : new Map([['root', { id: 'root', parentId: null, type: 'container', bounds: { x: 0, y: 0, width: 390, height: 800 }, styles: {} }]]);
      return {
        content: {
          metadata: { formaViewport: { width: 390, height: 800 } },
          elements,
          images: new Map(),
        },
        errors: [],
      };
    }
  },
}));

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(
  client: FormaApiClient,
  options: {
    fetchVzi?: (url: string) => Promise<Uint8Array>;
    checkResourceUrl?: (url: string) => Promise<boolean>;
  } = {},
) {
  const { AnnotationPage } = await import('./AnnotationPage.js');
  const fetchVzi = options.fetchVzi ?? (async () => new Uint8Array([1, 2, 3]));
  await act(async () => {
    root.render(
      <LocaleProvider>
        <AnnotationPage
          client={client}
          params={{ productId: 'P-abc123', reqId: 'R-1' }}
          fetchVzi={fetchVzi}
          checkResourceUrl={options.checkResourceUrl}
        />
      </LocaleProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function clientWith(handoff: RequirementHandoff): FormaApiClient {
  return { getRequirementHandoff: vi.fn(async () => handoff) } as unknown as FormaApiClient;
}

describe('AnnotationPage', () => {
  it('shows an empty state (no surface) when there are no handoff pages', async () => {
    await render(clientWith({ pages: [], errors: [] }));
    expect(container.querySelector('[data-testid="ck-surface"]')).toBeNull();
    expect(container.textContent && container.textContent.length).toBeTruthy();
  });

  it('renders the CanvasKit surface when pages decode', async () => {
    await render(clientWith({
      pages: [{
        pageId: 'home', artifactId: 'A', variant: 'default', version: 1, title: 'Home', iconCount: 0,
        vziUrl: '/v',
        iconBaseUrl: '/api/products/P-abc123/artifacts/A/icons/',
        bundleBaseUrl: '/api/products/P-abc123/artifacts/A/versions/1/bundle/',
      }],
      errors: [],
    }));
    expect(container.querySelector('[data-testid="ck-surface"]')).not.toBeNull();
  });

  it('records missing icon and bundle resources but still renders the page', async () => {
    await render(clientWith({
      pages: [{
        pageId: 'home', artifactId: 'A', variant: 'default', version: 1, title: 'Home', iconCount: 0,
        vziUrl: '/v',
        iconBaseUrl: '/api/products/P-abc123/artifacts/A/icons/',
        bundleBaseUrl: '/api/products/P-abc123/artifacts/A/versions/1/bundle/',
      }],
      errors: [],
    }), {
      fetchVzi: async () => new Uint8Array([9]),
      checkResourceUrl: async () => false,
    });
    expect(container.querySelector('[data-testid="ck-surface"]')).not.toBeNull();
    expect(container.textContent).toContain('icons/missing.svg');
    expect(container.textContent).toContain('assets/missing.png');
    expect(container.textContent).toContain('missing resource');
  });

  it('keeps a failed VZI page as a marked frame while rendering another decoded page', async () => {
    await render(clientWith({
      pages: [
        {
          pageId: 'home', artifactId: 'A', variant: 'default', version: 1, title: 'Home', iconCount: 0,
          vziUrl: '/ok', iconBaseUrl: '/i/', bundleBaseUrl: '/b/',
        },
        {
          pageId: 'settings', artifactId: 'B', variant: 'default', version: 1, title: 'Settings', iconCount: 0,
          vziUrl: '/missing', iconBaseUrl: '/i2/', bundleBaseUrl: '/b2/',
        },
      ],
      errors: [],
    }), {
      fetchVzi: async (url) => {
        if (url === '/missing') throw new Error('HTTP 404');
        return new Uint8Array([1]);
      },
    });
    expect(container.querySelector('[data-testid="ck-surface"]')).not.toBeNull();
    expect(container.textContent).toContain('Settings');
    expect(container.textContent).toContain('HTTP 404');
  });
});
