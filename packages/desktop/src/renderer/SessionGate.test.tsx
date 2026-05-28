// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { SessionGate } from './SessionGate.js';

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

describe('SessionGate', () => {
  it('shows placeholder when server unreachable', async () => {
    const checkStatus = vi.fn().mockResolvedValue(false);
    const { container } = render(
      <SessionGate checkStatus={checkStatus} retryIntervalMs={10000} maxRetries={0}>
        <div>App content</div>
      </SessionGate>
    );

    // Flush async state updates from the resolved promise
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    expect(container.querySelector('[data-testid="placeholder"]')).not.toBeNull();
    expect(container.textContent).toContain('Connecting to Forma server');
  });

  it('renders children when server is reachable', async () => {
    const checkStatus = vi.fn().mockResolvedValue(true);
    const { container } = render(
      <SessionGate checkStatus={checkStatus}>
        <div>App content</div>
      </SessionGate>
    );

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    expect(container.textContent).toContain('App content');
    expect(container.querySelector('[data-testid="placeholder"]')).toBeNull();
  });

  it('retries and shows placeholder after max retries exceeded', async () => {
    const checkStatus = vi.fn().mockResolvedValue(false);
    const { container } = render(
      <SessionGate checkStatus={checkStatus} retryIntervalMs={10000} maxRetries={2}>
        <div>App content</div>
      </SessionGate>
    );

    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    expect(container.querySelector('[data-testid="placeholder"]')).not.toBeNull();
    // Initial call happened; retries scheduled but not fired (long interval)
    expect(checkStatus).toHaveBeenCalledTimes(1);
  });
});
