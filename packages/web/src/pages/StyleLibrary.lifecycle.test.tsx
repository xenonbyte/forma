// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StyleLibrary } from "./StyleLibrary.js";
import type { FormaApiClient, StyleMetadata } from "../api.js";

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
  vi.restoreAllMocks();
});

describe("StyleLibrary read-only mode", () => {
  it("does not render a sync button", async () => {
    const client = {
      listStyles: vi.fn(async () => styles)
    } satisfies Pick<FormaApiClient, "listStyles">;
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleLibrary client={client} />);
      await flushMicrotasks();
    });

    expect(container.querySelector('[data-sync-button="true"]')).toBeNull();
  });

  it("renders styles after loading", async () => {
    const client = {
      listStyles: vi.fn(async () => styles)
    } satisfies Pick<FormaApiClient, "listStyles">;
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleLibrary client={client} />);
      await flushMicrotasks();
    });

    expect(client.listStyles).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("linear");
  });

  it("shows empty state when no styles are installed", async () => {
    const client = {
      listStyles: vi.fn(async () => [])
    } satisfies Pick<FormaApiClient, "listStyles">;
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleLibrary client={client} />);
      await flushMicrotasks();
    });

    expect(container.querySelector('[data-sync-button="true"]')).toBeNull();
    expect(container.textContent).toContain("No styles");
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
