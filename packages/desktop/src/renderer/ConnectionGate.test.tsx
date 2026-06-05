// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ConnectionGate } from "./ConnectionGate.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function render(ui: React.ReactElement): { container: HTMLElement } {
  const container = document.createElement("div");
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
  document.body.innerHTML = "";
  delete window.forma;
});

describe("ConnectionGate", () => {
  it("shows the checking placeholder during the initial pending status check", () => {
    // Use a never-resolving promise so connected stays null
    const neverResolves = new Promise<boolean>(() => undefined);
    const { container } = render(
      <ConnectionGate checkStatus={() => neverResolves}>
        <div data-testid="app">应用内容</div>
      </ConnectionGate>,
    );

    expect(container.querySelector('[data-gate="checking"]')).not.toBeNull();
    expect(container.querySelector('[data-gate="disconnected"]')).toBeNull();
    expect(container.querySelector('[data-testid="app"]')).toBeNull();
    expect(container.textContent).toContain("连接中");
  });

  it("renders the disconnected overlay when the server is unreachable", async () => {
    window.forma = {
      formaServerStatus: vi.fn().mockResolvedValue(false),
    } as unknown as Window["forma"];

    const { container } = render(
      <ConnectionGate>
        <div data-testid="app">应用内容</div>
      </ConnectionGate>,
    );
    await flush();

    expect(container.querySelector('[data-gate="disconnected"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="app"]')).toBeNull();
    expect(container.textContent).toContain("未连接");
  });

  it("renders children when the server is reachable", async () => {
    window.forma = {
      formaServerStatus: vi.fn().mockResolvedValue(true),
    } as unknown as Window["forma"];

    const { container } = render(
      <ConnectionGate>
        <div data-testid="app">应用内容</div>
      </ConnectionGate>,
    );
    await flush();

    expect(container.querySelector('[data-testid="app"]')).not.toBeNull();
    expect(container.querySelector('[data-gate="disconnected"]')).toBeNull();
  });

  it("retries on button click and renders children once reachable", async () => {
    const status = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    window.forma = {
      formaServerStatus: status,
    } as unknown as Window["forma"];

    const { container } = render(
      <ConnectionGate>
        <div data-testid="app">应用内容</div>
      </ConnectionGate>,
    );
    await flush();

    const retry = container.querySelector("[data-gate-retry]") as HTMLButtonElement;
    expect(retry).not.toBeNull();
    await act(async () => {
      retry.click();
    });
    await flush();

    expect(status).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="app"]')).not.toBeNull();
  });
});
