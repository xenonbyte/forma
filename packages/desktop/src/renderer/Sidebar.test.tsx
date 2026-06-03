// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { Sidebar } from './Sidebar.js';

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

const baseProps = {
  products: [
    { id: 'p1', name: '产品一', description: '' },
    { id: 'p2', name: '产品二', description: '' },
  ],
  activeProductId: 'p1',
  requirements: [
    { id: 'r1', title: '登录需求', status: 'active', ui_affected: true },
    { id: 'r2', title: '设置需求', status: 'active', ui_affected: false },
  ],
  pages: [
    { page_id: 'login', name: '登录页' },
    { page_id: 'home', name: '首页' },
  ],
  connected: true,
};

describe('Sidebar', () => {
  it('renders the two nav sections with their items', () => {
    const { container } = render(
      <Sidebar {...baseProps} nav={{ type: 'none' }} onSelect={vi.fn()} onSelectProduct={vi.fn()} />
    );

    expect(container.textContent).toContain('需求');
    expect(container.textContent).toContain('页面');

    expect(container.querySelector('[data-nav-requirement="r1"]')).not.toBeNull();
    expect(container.querySelector('[data-nav-page="login"]')).not.toBeNull();
  });

  it('fires onSelect with a requirement selection', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Sidebar {...baseProps} nav={{ type: 'none' }} onSelect={onSelect} onSelectProduct={vi.fn()} />
    );
    (container.querySelector('[data-nav-requirement="r2"]') as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledWith({ type: 'requirement', reqId: 'r2' });
  });

  it('fires onSelect with a page selection carrying the active requirement', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Sidebar
        {...baseProps}
        nav={{ type: 'requirement', reqId: 'r1' }}
        onSelect={onSelect}
        onSelectProduct={vi.fn()}
      />
    );
    (container.querySelector('[data-nav-page="login"]') as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledWith({ type: 'page', reqId: 'r1', pageId: 'login' });
  });

  it('fires onSelectProduct from the product switcher', () => {
    const onSelectProduct = vi.fn();
    const { container } = render(
      <Sidebar {...baseProps} nav={{ type: 'none' }} onSelect={vi.fn()} onSelectProduct={onSelectProduct} />
    );
    const select = container.querySelector('[data-product-switcher]') as HTMLSelectElement;
    select.value = 'p2';
    act(() => {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onSelectProduct).toHaveBeenCalledWith('p2');
  });

  it('shows the connection status dot reflecting connected state', () => {
    const { container } = render(
      <Sidebar {...baseProps} connected={false} nav={{ type: 'none' }} onSelect={vi.fn()} onSelectProduct={vi.fn()} />
    );
    expect(container.querySelector('.sidebar__dot--off')).not.toBeNull();
    expect(container.querySelector('.sidebar__dot--on')).toBeNull();
  });

  it('marks the active nav item', () => {
    const { container } = render(
      <Sidebar {...baseProps} nav={{ type: 'requirement', reqId: 'r1' }} onSelect={vi.fn()} onSelectProduct={vi.fn()} />
    );
    expect(
      (container.querySelector('[data-nav-requirement="r1"]') as HTMLElement).className
    ).toContain('sidebar__item--active');
  });
});
