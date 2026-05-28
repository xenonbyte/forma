// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { afterEach, vi } from "vitest";

import type { FormaApiClient, StyleDetailPayload, StyleMetadata } from "../api.js";
import { StyleDetail } from "./StyleDetail.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const metadata: StyleMetadata = {
  name: "linear",
  description: "Focused tool UI",
  design_md_path: "styles/linear/DESIGN.md",
  variables: {
    primary: "#111827",
    background: "#ffffff",
    "text-primary": "#222222",
    "font-heading": "Inter",
    "font-body": "Inter",
    "border-radius": "8px",
    "spacing-unit": "8px"
  }
};

const styleDetail: StyleDetailPayload = {
  metadata,
  designMd: `---
colors:
  primary: "#5E6AD2"
components:
  button-primary:
    background: "{colors.primary}"
---
# Linear
`
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
  vi.restoreAllMocks();
});

describe("StyleDetail", () => {
  it("renders the live style preview without requesting removed static preview metadata", async () => {
    const client = createClient();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleDetail client={client} params={{ name: "linear" }} />);
      await flushMicrotasks();
    });

    expect(container.querySelector('[data-style-preview-panel="true"]')).not.toBeNull();
    expect(container.querySelector('[data-preview-type="web"]')).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Live style preview");
    expect("getStylePreview" in client).toBe(false);
  });

  it("always renders the live style preview when style detail is ready", async () => {
    const client = createClient();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleDetail client={client} params={{ name: "linear" }} />);
      await flushMicrotasks();
    });

    expect(container.querySelector('[data-style-preview-panel="true"]')).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders translated StyleDetail copy instead of bare i18n keys", async () => {
    const client = createClient();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleDetail client={client} params={{ name: "linear" }} />);
      await flushMicrotasks();
    });

    expect(container.textContent).toContain("Back to styles");
    expect(container.textContent).toContain("Variables");
    expect(container.textContent).not.toContain("style.detail.");
    expect(container.textContent).not.toContain("style.preview.");
  });
});

function createClient() {
  return {
    getStyle: vi.fn(async () => styleDetail)
  } satisfies Pick<FormaApiClient, "getStyle">;
}

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
}
