// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ProductsHome } from './ProductsHome.js';

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

describe('ProductsHome', () => {
  it('renders product cards from listProducts', async () => {
    const listProducts = vi.fn().mockResolvedValue({
      products: [
        { id: 'p-1', name: 'Product One', description: 'Desc one' },
        { id: 'p-2', name: 'Product Two', description: 'Desc two' },
      ],
    });
    const onSelect = vi.fn();

    const { container } = render(
      <ProductsHome forma={{ listProducts }} onSelect={onSelect} />
    );

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    const cards = container.querySelectorAll('[data-product-id]');
    expect(cards).toHaveLength(2);
    expect(cards[0].getAttribute('data-product-id')).toBe('p-1');
    expect(cards[1].getAttribute('data-product-id')).toBe('p-2');
  });

  it('shows empty state when no products', async () => {
    const listProducts = vi.fn().mockResolvedValue({ products: [] });
    const onSelect = vi.fn();

    const { container } = render(
      <ProductsHome forma={{ listProducts }} onSelect={onSelect} />
    );

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    expect(container.textContent).toContain('No products found');
  });

  it('calls onSelect when product card clicked', async () => {
    const listProducts = vi.fn().mockResolvedValue({
      products: [{ id: 'p-99', name: 'Clickable', description: 'Click me' }],
    });
    const onSelect = vi.fn();

    const { container } = render(
      <ProductsHome forma={{ listProducts }} onSelect={onSelect} />
    );

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    const card = container.querySelector('[data-product-id="p-99"]') as HTMLElement;
    expect(card).not.toBeNull();

    await act(async () => {
      card.click();
    });

    expect(onSelect).toHaveBeenCalledWith('p-99');
  });
});
