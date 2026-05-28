// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import * as mainModule from './main.js';

// Required for React's act() to work in vitest
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
});

describe('App artifact route', () => {
  it('opens ArtifactDetail when an artifact card is selected', async () => {
    const App = (mainModule as { App?: () => React.ReactElement }).App;
    if (typeof App !== 'function') {
      throw new Error('App export missing');
    }

    const getArtifact = vi.fn().mockResolvedValue({
      manifest: { id: 'A-1', kind: 'html', title: 'Home Page' },
      preview_url: '/preview/1x.png',
    });
    window.forma = {
      formaServerStatus: vi.fn().mockResolvedValue(true),
      listProducts: vi.fn().mockResolvedValue({
        products: [{ id: 'p-1', name: 'Product One', description: 'Desc one' }],
      }),
      getProduct: vi.fn(),
      listArtifacts: vi.fn().mockResolvedValue({
        artifacts: [{ id: 'A-1', kind: 'html', title: 'Home Page', updated_at: '2026-01-01' }],
      }),
      getArtifact,
      listRequirements: vi.fn().mockResolvedValue({ requirements: [] }),
      getRequirement: vi.fn(),
    };

    const { container } = render(<App />);
    await flush();

    const productCard = container.querySelector('[data-product-id="p-1"]') as HTMLElement;
    expect(productCard).not.toBeNull();
    await act(async () => {
      productCard.click();
    });
    await flush();

    const artifactCard = container.querySelector('[data-artifact-id="A-1"]') as HTMLElement;
    expect(artifactCard).not.toBeNull();
    await act(async () => {
      artifactCard.click();
    });
    await flush();

    expect(getArtifact).toHaveBeenCalledWith('p-1', 'A-1');
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/preview/2x.png');
  });
});
