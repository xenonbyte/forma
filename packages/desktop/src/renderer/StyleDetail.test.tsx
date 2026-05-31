// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { StyleDetail } from './StyleDetail.js';

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

const brandContent = {
  kind: 'brand' as const,
  metadata: {
    name: 'clean',
    description: 'Clean brand',
    design_md_path: 'styles/clean/DESIGN.md',
    tokens_css_path: 'styles/clean/tokens.css',
    components_html_path: 'styles/clean/components.html',
  },
  designMd: '# Clean 设计语言',
  tokensCss: ':root { --accent: #111111; }',
  componentsHtml: '<button>按钮</button>',
};

beforeEach(() => {
  document.body.innerHTML = '';
  delete window.forma;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StyleDetail (desktop)', () => {
  it('reads 3-file content via window.forma.getStyle and renders it', async () => {
    const getStyle = vi.fn().mockResolvedValue(brandContent);
    window.forma = { getStyle } as unknown as Window['forma'];

    const { container } = render(<StyleDetail name="clean" />);
    await flush();

    expect(getStyle).toHaveBeenCalledWith('clean');
    expect(container.textContent).toContain('# Clean 设计语言');
    expect(container.textContent).toContain(':root { --accent: #111111; }');

    const iframe = container.querySelector('iframe[sandbox]') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    const sandbox = iframe.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-scripts');
    expect(iframe.getAttribute('srcdoc')).toContain('<button>按钮</button>');
  });

  it('does NOT call global fetch (IPC-only style reads)', async () => {
    const fetchSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = fetchSpy;
    const getStyle = vi.fn().mockResolvedValue(brandContent);
    window.forma = { getStyle } as unknown as Window['forma'];

    render(<StyleDetail name="clean" />);
    await flush();

    expect(fetchSpy).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).fetch;
  });

  it('shows an error message when getStyle rejects', async () => {
    const getStyle = vi.fn().mockRejectedValue(new Error('boom'));
    window.forma = { getStyle } as unknown as Window['forma'];

    const { container } = render(<StyleDetail name="missing" />);
    await flush();

    expect(container.textContent).toContain('加载失败');
  });
});
