// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, createElement } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Stub the viewer so WorkspacePane mounts without @xyflow.
vi.mock('@xenonbyte/forma-viewer', () => ({
  buildViewerModel: (input: unknown) => ({ __model: input }),
  Viewer: () => createElement('div', { 'data-testid': 'viewer' }),
}));
vi.mock('./viewer/resolver.js', () => ({
  createDesktopResourceResolver: () => ({ resolve: () => '' }),
}));

import { AppShell } from './AppShell.js';

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

function installForma() {
  const listProducts = vi.fn().mockResolvedValue({
    products: [{ id: 'p1', name: '产品一', description: '', platform: 'web' }],
  });
  const getProduct = vi.fn().mockResolvedValue({ id: 'p1', name: '产品一', description: '', platform: 'web' });
  const listRequirements = vi.fn().mockResolvedValue({
    requirements: [
      // intentionally NO pages here — page-nav must come from getRequirement
      { id: 'r1', title: '登录需求', status: 'active', ui_affected: true },
    ],
  });
  const getRequirement = vi.fn().mockResolvedValue({
    id: 'r1',
    title: '登录需求',
    status: 'active',
    ui_affected: true,
    pages: [
      { page_id: 'login', name: '登录页' },
      { page_id: 'home', name: '首页' },
    ],
  });
  const listArtifacts = vi.fn().mockResolvedValue({ artifacts: [] });
  const formaServerBaseUrl = vi.fn().mockResolvedValue('http://127.0.0.1:3000');
  const listStyles = vi.fn().mockResolvedValue([{ name: 'clean', description: 'Clean brand' }]);
  const getStyle = vi.fn().mockResolvedValue({
    kind: 'brand',
    metadata: { name: 'clean', description: '' },
    designMd: '# Clean',
    tokensCss: ':root{}',
    componentsHtml: '<i></i>',
  });
  window.forma = {
    listProducts,
    getProduct,
    listRequirements,
    getRequirement,
    listArtifacts,
    formaServerBaseUrl,
    listStyles,
    getStyle,
  } as unknown as Window['forma'];
  return { listProducts, getRequirement, listRequirements, listStyles, getStyle, formaServerBaseUrl };
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete window.forma;
  window.location.hash = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppShell', () => {
  it('loads products + styles and renders sidebar nav from getRequirement pages (not the listRequirements summary)', async () => {
    const { listProducts, getRequirement, listStyles } = installForma();
    const { container } = render(<AppShell />);
    await flush();
    await flush();

    expect(listProducts).toHaveBeenCalled();
    expect(listStyles).toHaveBeenCalled();
    // default requirement selected -> getRequirement called for full pages
    expect(getRequirement).toHaveBeenCalledWith('p1', 'r1');

    // page-nav from getRequirement pages
    expect(container.querySelector('[data-nav-page="login"]')).not.toBeNull();
    expect(container.querySelector('[data-nav-page="home"]')).not.toBeNull();
    // brand style nav from listStyles
    expect(container.querySelector('[data-nav-style="clean"]')).not.toBeNull();
  });

  it('never uses global fetch for style list/detail (IPC-only)', async () => {
    const fetchSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = fetchSpy;
    const { getStyle } = installForma();

    const { container } = render(<AppShell />);
    await flush();
    await flush();

    // click the brand style nav -> StyleDetail via getStyle, not fetch
    await act(async () => {
      (container.querySelector('[data-nav-style="clean"]') as HTMLButtonElement).click();
    });
    await flush();

    expect(getStyle).toHaveBeenCalledWith('clean');
    expect(fetchSpy).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).fetch;
  });

  it('reflects a style selection from the location hash', async () => {
    installForma();
    window.location.hash = '#/styles/clean';
    const { container } = render(<AppShell />);
    await flush();
    await flush();

    expect(container.textContent).toContain('# Clean');
  });

  it('restores requirement deep-link from hash — shows deep-linked req, not the first one', async () => {
    const { listRequirements } = installForma();
    // Override listRequirements to return r1 first, then r3 second
    listRequirements.mockResolvedValue({
      requirements: [
        { id: 'r1', title: '第一需求', status: 'active', ui_affected: true },
        { id: 'r3', title: '第三需求', status: 'active', ui_affected: true },
      ],
    });
    window.location.hash = '#/products/p1/requirements/r3';
    const { container } = render(<AppShell />);
    await flush();
    await flush();

    // The active nav item should be r3, not r1
    const activeItem = container.querySelector('.sidebar__item--active');
    expect(activeItem).not.toBeNull();
    expect(activeItem!.getAttribute('data-nav-requirement')).toBe('r3');

    // cleanup
    window.location.hash = '';
  });

  it('renders empty state when listProducts returns an empty list', async () => {
    const { listProducts } = installForma();
    listProducts.mockResolvedValue({ products: [] });
    const { container } = render(<AppShell />);
    await flush();
    await flush();

    // Should render the empty workspace prompt without crashing
    expect(container.querySelector('.workspace__empty')).not.toBeNull();
  });

  it('sets connected to false when a startup IPC call rejects', async () => {
    const { listProducts } = installForma();
    listProducts.mockRejectedValue(new Error('IPC error'));
    const { container } = render(<AppShell />);
    await flush();

    // connected=false is surfaced via the sidebar connection dot going off
    const dot = container.querySelector('.sidebar__dot--off');
    expect(dot).not.toBeNull();
  });
});
