// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ProductView } from './ProductView.js';

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

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('ProductView', () => {
  it('renders artifact grid', async () => {
    const listArtifacts = vi.fn().mockResolvedValue({
      artifacts: [
        { id: 'A-1', kind: 'page', title: 'Home Page', updated_at: '2026-01-01' },
      ],
    });
    const listRequirements = vi.fn().mockResolvedValue({ requirements: [] });
    const onBack = vi.fn();

    const { container } = render(
      <ProductView
        forma={{ listArtifacts, listRequirements }}
        productId="p-1"
        onBack={onBack}
      />
    );

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    const card = container.querySelector('[data-artifact-id="A-1"]');
    expect(card).not.toBeNull();
  });

  it('renders requirements list', async () => {
    const listArtifacts = vi.fn().mockResolvedValue({ artifacts: [] });
    const listRequirements = vi.fn().mockResolvedValue({
      requirements: [
        { id: 'R-1', title: 'User can login', status: 'active', ui_affected: true },
      ],
    });
    const onBack = vi.fn();

    const { container } = render(
      <ProductView
        forma={{ listArtifacts, listRequirements }}
        productId="p-1"
        onBack={onBack}
      />
    );

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    // Click the Requirements tab
    const tabs = container.querySelectorAll('[data-tab]');
    const reqTab = Array.from(tabs).find(
      (t) => t.textContent?.includes('Requirements')
    ) as HTMLElement;
    expect(reqTab).not.toBeUndefined();

    await act(async () => {
      reqTab.click();
    });

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    expect(container.textContent).toContain('User can login');
  });
});
