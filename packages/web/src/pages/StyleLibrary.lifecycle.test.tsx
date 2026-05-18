// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StyleLibrary } from "./StyleLibrary.js";
import type { FormaApiClient, StyleMetadata, SyncStatusPayload } from "../api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const styles: StyleMetadata[] = [
  {
    name: "linear",
    description: "Focused tool UI",
    design_md_path: "styles/linear/DESIGN.md",
    variables: {
      primary: "#111827",
      background: "#ffffff",
      "text-primary": "#111827",
      "font-heading": "Inter",
      "font-body": "Inter",
      "border-radius": "8px",
      "spacing-unit": "8px"
    }
  }
];

const idleStatus: SyncStatusPayload = { status: "idle" };
const completedStatus: SyncStatusPayload = {
  status: "idle",
  last_sync: {
    completed_at: "2026-05-18T00:00:02.000Z",
    styles_total: 1,
    styles_added: 1,
    styles_updated: 0,
    styles_failed: 0,
    duration_ms: 2000
  }
};

const roots: Root[] = [];
const containers: HTMLElement[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  for (const container of containers.splice(0)) {
    container.remove();
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("StyleLibrary sync lifecycle", () => {
  it("starts sync, polls until completion, refreshes styles, and shows summary", async () => {
    vi.useFakeTimers();
    const client = {
      listStyles: vi.fn(async () => styles),
      syncStyles: vi.fn(async () => ({ task_id: "sync-123", status: "running" as const, message: "Style sync started" })),
      getSyncStatus: vi.fn<() => Promise<SyncStatusPayload>>(async () => idleStatus)
    } satisfies Pick<FormaApiClient, "listStyles" | "syncStyles" | "getSyncStatus">;
    client.getSyncStatus.mockResolvedValueOnce(idleStatus).mockResolvedValueOnce(completedStatus);
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleLibrary client={client} />);
      await flushMicrotasks();
    });

    expect(client.listStyles).toHaveBeenCalledTimes(1);
    expect(client.getSyncStatus).toHaveBeenCalledTimes(1);

    const syncButton = container.querySelector<HTMLButtonElement>('button[data-sync-button="true"]');
    expect(syncButton).not.toBeNull();

    await act(async () => {
      syncButton?.click();
      await flushMicrotasks();
    });

    expect(client.syncStyles).toHaveBeenCalledTimes(1);
    expect(client.getSyncStatus).toHaveBeenCalledTimes(1);
    expect(syncButton?.textContent).toContain("同步中... (0/0)");

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await flushMicrotasks();
    });

    expect(client.getSyncStatus).toHaveBeenCalledTimes(2);
    expect(client.listStyles).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("total 1, added 1, updated 0, failed 0");
  });

  it("keeps sync controls available when no styles are installed", async () => {
    vi.useFakeTimers();
    const client = {
      listStyles: vi.fn(async () => []),
      syncStyles: vi.fn(async () => ({ task_id: "sync-empty", status: "running" as const, message: "Style sync started" })),
      getSyncStatus: vi.fn<() => Promise<SyncStatusPayload>>(async () => idleStatus)
    } satisfies Pick<FormaApiClient, "listStyles" | "syncStyles" | "getSyncStatus">;
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleLibrary client={client} />);
      await flushMicrotasks();
    });

    const syncButton = container.querySelector<HTMLButtonElement>('button[data-sync-button="true"]');
    expect(syncButton).not.toBeNull();
    expect(syncButton?.textContent).toContain("一键同步");
    expect(container.textContent).toContain("No styles");

    await act(async () => {
      syncButton?.click();
      await flushMicrotasks();
    });

    expect(client.syncStyles).toHaveBeenCalledTimes(1);
  });
});

function createTestRoot() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
