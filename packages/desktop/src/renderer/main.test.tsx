// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, createElement } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Stub the viewer so the AppShell subtree mounts without @xyflow.
vi.mock('@xenonbyte/forma-viewer', () => ({
  buildViewerModel: (input: unknown) => ({ __model: input }),
  Viewer: () => createElement('div', { 'data-testid': 'viewer' }),
}));
vi.mock('./viewer/resolver.js', () => ({
  createDesktopResourceResolver: () => ({ resolve: () => '' }),
}));

import * as mainModule from './main.js';

function render(ui: React.ReactElement): { container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(ui);
  });
  return { container };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete window.forma;
  window.location.hash = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('App', () => {
  it('gates on the connection then mounts the AppShell when connected', async () => {
    window.forma = {
      formaServerStatus: vi.fn().mockResolvedValue(true),
      listProducts: vi.fn().mockResolvedValue({
        products: [{ id: 'p1', name: '产品一', description: '', platform: 'web' }],
      }),
      getProduct: vi.fn(),
      listRequirements: vi.fn().mockResolvedValue({ requirements: [] }),
      getRequirement: vi.fn(),
      listArtifacts: vi.fn().mockResolvedValue({ artifacts: [] }),
      getArtifact: vi.fn(),
      formaServerBaseUrl: vi.fn().mockResolvedValue('http://127.0.0.1:3000'),
      listStyles: vi.fn().mockResolvedValue([{ name: 'clean', description: '' }]),
      getStyle: vi.fn(),
    } as unknown as Window['forma'];

    const App = (mainModule as { App?: () => React.ReactElement }).App;
    if (typeof App !== 'function') {
      throw new Error('App export missing');
    }

    const { container } = render(<App />);
    await flush();
    await flush();

    expect(container.querySelector('.shell')).not.toBeNull();
    expect(container.querySelector('[data-gate="disconnected"]')).toBeNull();
    expect(container.querySelector('[data-product-switcher]')).not.toBeNull();
  });

  it('shows the disconnected gate when the server is unreachable', async () => {
    window.forma = {
      formaServerStatus: vi.fn().mockResolvedValue(false),
    } as unknown as Window['forma'];

    const App = (mainModule as { App?: () => React.ReactElement }).App;
    if (typeof App !== 'function') {
      throw new Error('App export missing');
    }

    const { container } = render(<App />);
    await flush();

    expect(container.querySelector('[data-gate="disconnected"]')).not.toBeNull();
    expect(container.querySelector('.shell')).toBeNull();
  });
});
