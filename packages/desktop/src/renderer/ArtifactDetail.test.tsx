// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ArtifactDetail } from './ArtifactDetail.js';

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

describe('ArtifactDetail', () => {
  it('shows preview image with 2x URL', async () => {
    const getArtifact = vi.fn().mockResolvedValue({
      manifest: { id: 'A-1', kind: 'page', title: 'Home Page' },
      preview_url: '/preview/1x.png',
    });
    const onClose = vi.fn();

    const { container } = render(
      <ArtifactDetail
        forma={{ getArtifact }}
        productId="p-1"
        artifactId="A-1"
        onClose={onClose}
      />
    );

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toContain('/preview/2x.png');
  });

  it('calls onClose when close button clicked', async () => {
    const getArtifact = vi.fn().mockResolvedValue({
      manifest: { id: 'A-1', kind: 'page', title: 'Home Page' },
      preview_url: '/preview/1x.png',
    });
    const onClose = vi.fn();

    const { container } = render(
      <ArtifactDetail
        forma={{ getArtifact }}
        productId="p-1"
        artifactId="A-1"
        onClose={onClose}
      />
    );

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    const closeBtn = container.querySelector('[data-close]') as HTMLElement;
    expect(closeBtn).not.toBeNull();

    await act(async () => {
      closeBtn.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
