// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { afterEach, vi } from "vitest";

import type { FormaApiClient, StyleDetailPayload, StyleMetadata, StylePreviewPayload } from "../api.js";
import { isStylePreviewImageUrl } from "./StyleDetail.js";
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

describe("isStylePreviewImageUrl", () => {
  it("only accepts explicit preview image endpoints", () => {
    expect(isStylePreviewImageUrl("/api/styles/linear/preview/image")).toBe(true);
    expect(isStylePreviewImageUrl("/api/styles/linear/preview")).toBe(false);
    expect(isStylePreviewImageUrl(undefined)).toBe(false);
  });
});

describe("StyleDetail", () => {
  it("renders the live style preview and the static preview PNG when both are available", async () => {
    const client = createClient({ preview: { name: "linear", image_url: "/api/styles/linear/preview/image" } });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleDetail client={client} params={{ name: "linear" }} />);
      await flushMicrotasks();
    });

    expect(container.querySelector('[data-style-preview-panel="true"]')).not.toBeNull();
    expect(container.querySelector('[data-preview-type="web"]')).not.toBeNull();
    expect(container.querySelector<HTMLImageElement>('img[src="/api/styles/linear/preview/image"]')).not.toBeNull();
    expect(container.textContent).toContain("Static preview");
    expect(container.textContent).toContain("Live style preview");
  });

  it("always renders the live style preview when style detail is ready", async () => {
    const client = createClient({ preview: { name: "linear" } });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleDetail client={client} params={{ name: "linear" }} />);
      await flushMicrotasks();
    });

    expect(container.querySelector('[data-style-preview-panel="true"]')).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders translated StyleDetail copy instead of bare i18n keys", async () => {
    const client = createClient({ preview: { name: "linear", image_url: "/api/styles/linear/preview/image" } });
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

function createClient({ preview }: { preview: StylePreviewPayload }) {
  return {
    getStyle: vi.fn(async () => styleDetail),
    getStylePreview: vi.fn(async () => preview)
  } satisfies Pick<FormaApiClient, "getStyle" | "getStylePreview">;
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
