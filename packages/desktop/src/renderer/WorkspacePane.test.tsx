// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, createElement } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const viewerSpy = vi.fn();
const resolverSpy = vi.fn();
vi.mock('@xenonbyte/forma-viewer', () => ({
  buildViewerModel: (input: unknown) => ({ __model: input }),
  Viewer: (props: { model: unknown; resolver: unknown }) => {
    viewerSpy(props);
    return createElement('div', { 'data-testid': 'viewer' });
  },
}));
vi.mock('./viewer/resolver.js', () => ({
  createDesktopResourceResolver: (...args: unknown[]) => {
    resolverSpy(...args);
    return { resolve: () => '' };
  },
}));

import { WorkspacePane } from './WorkspacePane.js';

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
  const getProduct = vi.fn().mockResolvedValue({ id: 'p1', name: 'P', description: '', platform: 'web' });
  const getRequirement = vi.fn().mockResolvedValue({
    id: 'r1',
    title: '需求',
    status: 'active',
    ui_affected: true,
    pages: [
      { page_id: 'login', name: '登录页' },
      { page_id: 'settings', name: '设置页' },
    ],
  });
  const listArtifacts = vi.fn().mockResolvedValue({
    artifacts: [
      { id: 'a', kind: 'design-page', title: '登录页', updated_at: '', requirement_id: 'r1', page_id: 'login', variant: 'default', current_version: 1 },
      { id: 'd', kind: 'design-page', title: '登录页宽屏', updated_at: '', requirement_id: 'r1', page_id: 'login', variant: 'wide', current_version: 2 },
      { id: 'b', kind: 'design-page', title: '设置页', updated_at: '', requirement_id: 'r1', page_id: 'settings', variant: 'default', current_version: 1 },
      { id: 'c', kind: 'design-page', title: '别的需求', updated_at: '', requirement_id: 'r2', page_id: 'login', variant: 'default', current_version: 1 },
    ],
  });
  const getStyle = vi.fn().mockResolvedValue({
    kind: 'brand',
    metadata: { name: 'clean', description: '' },
    designMd: '# Clean',
    tokensCss: ':root{}',
    componentsHtml: '<i></i>',
  });
  window.forma = { getProduct, getRequirement, listArtifacts, getStyle } as unknown as Window['forma'];
  return { getProduct, getRequirement, listArtifacts, getStyle };
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete window.forma;
  viewerSpy.mockClear();
  resolverSpy.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WorkspacePane', () => {
  it('requirement selection builds a requirement-entry model from req artifacts only', async () => {
    installForma();
    const { container } = render(
      <WorkspacePane selection={{ type: 'requirement', reqId: 'r1' }} productId="p1" baseUrl="http://127.0.0.1:3000" />
    );
    await flush();

    expect(container.querySelector("[data-testid='viewer']")).not.toBeNull();
    const model = viewerSpy.mock.calls.at(-1)![0].model as { __model: { entry: string; artifacts: Array<{ artifactId: string }> } };
    expect(model.__model.entry).toBe('requirement');
    expect(model.__model.artifacts.map((a) => a.artifactId)).toEqual(['a', 'd', 'b']);
    expect(resolverSpy).toHaveBeenCalledWith('http://127.0.0.1:3000', 'p1');
  });

  it('page selection filters to a single page (page entry)', async () => {
    installForma();
    const { container } = render(
      <WorkspacePane selection={{ type: 'page', reqId: 'r1', pageId: 'login' }} productId="p1" baseUrl="http://127.0.0.1:3000" />
    );
    await flush();

    expect(container.querySelector("[data-testid='viewer']")).not.toBeNull();
    const model = viewerSpy.mock.calls.at(-1)![0].model as { __model: { entry: string; artifacts: Array<{ artifactId: string }> } };
    expect(model.__model.entry).toBe('page');
    expect(model.__model.artifacts.map((a) => a.artifactId)).toEqual(['a', 'd']);
  });

  it('style selection renders StyleDetail with only the name; baseUrl never reaches style reads', async () => {
    const { getStyle } = installForma();
    const { container } = render(
      <WorkspacePane selection={{ type: 'style', name: 'clean' }} productId="p1" baseUrl="http://127.0.0.1:3000" />
    );
    await flush();

    expect(container.querySelector("[data-testid='viewer']")).toBeNull();
    expect(getStyle).toHaveBeenCalledWith('clean');
    expect(resolverSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('# Clean');
  });

  it('renders an empty prompt for an empty selection', async () => {
    installForma();
    const { container } = render(
      <WorkspacePane selection={{ type: 'none' }} productId="p1" baseUrl="http://127.0.0.1:3000" />
    );
    await flush();

    expect(container.querySelector("[data-testid='viewer']")).toBeNull();
    expect(container.querySelector('.workspace__empty')).not.toBeNull();
  });

  it('renders the failure status element when getRequirement rejects', async () => {
    const { getRequirement } = installForma();
    getRequirement.mockRejectedValue(new Error('服务器错误'));
    const { container } = render(
      <WorkspacePane selection={{ type: 'requirement', reqId: 'r1' }} productId="p1" baseUrl="http://127.0.0.1:3000" />
    );
    await flush();

    expect(container.querySelector("[data-testid='viewer']")).toBeNull();
    const status = container.querySelector('.workspace__status');
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain('加载失败');
  });
});
