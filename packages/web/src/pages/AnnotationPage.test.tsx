// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../LocaleContext.js';
import type { FormaApiClient, RequirementHandoff } from '../api.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const canvasKitSurfaceCalls = vi.hoisted(() => [] as Array<{
  elements?: unknown[];
  onViewportChange?: (viewport: { offsetX: number; offsetY: number; scale: number }) => void;
}>);

// Mock the WebGL surface — happy-dom has no canvas/WebGL. The adapter pulls
// buildCanvasKitElementTree from the same module, so mock it here too.
vi.mock('@vzi-core/renderer', async () => {
  const React = await import('react');
  return {
    CanvasKitSurface: (props: {
      elements?: unknown[];
      width?: number;
      height?: number;
      viewport?: { offsetX: number; offsetY: number; scale: number };
      onViewportChange?: (viewport: { offsetX: number; offsetY: number; scale: number }) => void;
    }) => {
      canvasKitSurfaceCalls.push({ elements: props.elements, onViewportChange: props.onViewportChange });
      return React.createElement('div', {
        'data-testid': 'ck-surface',
        'data-count': (props.elements ?? []).length,
        'data-width': props.width,
        'data-height': props.height,
        'data-viewport-scale': props.viewport ? String(props.viewport.scale) : '',
        'data-viewport-offset-x': props.viewport ? String(props.viewport.offsetX) : '',
        'data-viewport-offset-y': props.viewport ? String(props.viewport.offsetY) : '',
      });
    },
    buildCanvasKitElementTree: (doc: { elements?: Record<string, unknown> }) =>
      Object.values(doc.elements ?? {}).map((e) => ({ ...(e as object), children: [] })),
  };
});

interface DecodedPageContent {
  metadata: Record<string, unknown>;
  elements: Map<string, unknown>;
  images: Map<string, unknown>;
}

function rootContent(): DecodedPageContent {
  return {
    metadata: { formaViewport: { width: 390, height: 800 } },
    elements: new Map([['root', { id: 'root', parentId: null, type: 'container', bounds: { x: 0, y: 0, width: 390, height: 800 }, styles: {} }]]),
    images: new Map(),
  };
}

function missingResContent(): DecodedPageContent {
  return {
    metadata: { formaViewport: { width: 64, height: 24 } },
    elements: new Map<string, unknown>([
      ['icon', { id: 'icon', parentId: null, type: 'image', bounds: { x: 0, y: 0, width: 24, height: 24 }, styles: {}, imageData: { src: 'icons/missing.svg' } }],
      ['bundle', { id: 'bundle', parentId: null, type: 'image', bounds: { x: 32, y: 0, width: 24, height: 24 }, styles: {}, imageData: { src: 'assets/missing.png' } }],
    ]),
    images: new Map(),
  };
}

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  canvasKitSurfaceCalls.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(
  client: FormaApiClient,
  options: {
    fetchContent?: (url: string) => Promise<DecodedPageContent>;
    checkResourceUrl?: (url: string) => Promise<boolean>;
  } = {},
) {
  const { AnnotationPage } = await import('./AnnotationPage.js');
  const fetchContent = options.fetchContent ?? (async () => rootContent());
  await act(async () => {
    root.render(
      <LocaleProvider>
        <AnnotationPage
          client={client}
          params={{ productId: 'P-abc123', reqId: 'R-1' }}
          fetchContent={fetchContent}
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

function page(over: Partial<RequirementHandoff['pages'][number]> = {}): RequirementHandoff['pages'][number] {
  return {
    pageId: 'home', artifactId: 'A', variant: 'default', version: 1, title: 'Home', iconCount: 0,
    vziUrl: '/v', contentUrl: '/c',
    iconBaseUrl: '/api/products/P-abc123/artifacts/A/icons/',
    bundleBaseUrl: '/api/products/P-abc123/artifacts/A/versions/1/bundle/',
    ...over,
  };
}

type TestResizeObserverInstance = {
  callback: (entries: Array<{ contentRect: { width: number; height: number } }>) => void;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

function stubResizeObserver(): TestResizeObserverInstance[] {
  const instances: TestResizeObserverInstance[] = [];
  vi.stubGlobal('ResizeObserver', class {
    callback: TestResizeObserverInstance['callback'];
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(callback: TestResizeObserverInstance['callback']) {
      this.callback = callback;
      instances.push(this);
    }
  });
  return instances;
}

describe('AnnotationPage', () => {
  it('shows an empty state (no surface) when there are no handoff pages', async () => {
    await render(clientWith({ pages: [], errors: [] }));
    expect(container.querySelector('[data-testid="ck-surface"]')).toBeNull();
    expect(container.textContent && container.textContent.length).toBeTruthy();
  });

  it('renders the CanvasKit surface when pages decode', async () => {
    await render(clientWith({ pages: [page()], errors: [] }));
    expect(container.querySelector('[data-testid="ck-surface"]')).not.toBeNull();
  });

  it('observes the ready canvas container after loading before sizing the surface', async () => {
    const instances = stubResizeObserver();

    await render(clientWith({ pages: [page()], errors: [] }));

    expect(instances).toHaveLength(1);
    expect(instances[0].observe).toHaveBeenCalledWith(expect.any(HTMLDivElement));

    await act(async () => {
      instances[0].callback([{ contentRect: { width: 640, height: 480 } }]);
    });

    const surface = container.querySelector('[data-testid="ck-surface"]');
    expect(surface?.getAttribute('data-width')).toBe('640');
    expect(surface?.getAttribute('data-height')).toBe('480');
  });

  it('waits for a measured canvas size before fitting the initial viewport', async () => {
    const instances = stubResizeObserver();

    await render(clientWith({ pages: [page()], errors: [] }));

    let surface = container.querySelector('[data-testid="ck-surface"]');
    expect(surface?.getAttribute('data-viewport-scale')).toBe('');

    await act(async () => {
      instances[0].callback([{ contentRect: { width: 640, height: 480 } }]);
      await Promise.resolve();
      await Promise.resolve();
    });

    surface = container.querySelector('[data-testid="ck-surface"]');
    expect(Number(surface?.getAttribute('data-viewport-scale'))).toBeCloseTo(0.552, 3);
    expect(Number(surface?.getAttribute('data-viewport-offset-x'))).toBeCloseTo(212.36, 2);
    expect(Number(surface?.getAttribute('data-viewport-offset-y'))).toBe(28);
  });

  it('keeps CanvasKit elements stable across viewport-only updates when no resources are missing', async () => {
    await render(clientWith({ pages: [page()], errors: [] }));

    const initialCall = canvasKitSurfaceCalls.at(-1);
    const initialElements = initialCall?.elements;
    if (!initialElements || !initialCall?.onViewportChange) {
      throw new Error('CanvasKitSurface did not render with viewport callback');
    }

    await act(async () => {
      initialCall.onViewportChange?.({ offsetX: 12, offsetY: 34, scale: 0.75 });
      await Promise.resolve();
    });

    expect(canvasKitSurfaceCalls.at(-1)?.elements).toBe(initialElements);
  });

  it('records missing icon and bundle resources but still renders the page', async () => {
    await render(clientWith({ pages: [page()], errors: [] }), {
      fetchContent: async () => missingResContent(),
      checkResourceUrl: async () => false,
    });
    expect(container.querySelector('[data-testid="ck-surface"]')).not.toBeNull();
    expect(container.textContent).toContain('icons/missing.svg');
    expect(container.textContent).toContain('assets/missing.png');
    expect(container.textContent).toContain('Missing resource');
  });

  it('keeps a failed content fetch as a marked frame while rendering another page', async () => {
    const instances = stubResizeObserver();

    await render(clientWith({
      pages: [
        page({ pageId: 'home', artifactId: 'A', title: 'Home', contentUrl: '/ok' }),
        page({ pageId: 'settings', artifactId: 'B', title: 'Settings', contentUrl: '/missing' }),
      ],
      errors: [],
    }), {
      fetchContent: async (url) => {
        if (url === '/missing') throw new Error('HTTP 404');
        return rootContent();
      },
    });
    await act(async () => {
      instances[0].callback([{ contentRect: { width: 640, height: 480 } }]);
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="ck-surface"]')).not.toBeNull();
    expect(container.textContent).toContain('Settings');
    expect(container.textContent).toContain('HTTP 404');
  });
});
