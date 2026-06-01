// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StyleLibrary } from "./StyleLibrary.js";
import type { BrandStyleContent, FormaApiClient, StyleMetadata } from "../api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const styles: StyleMetadata[] = [
  {
    name: "linear",
    description: "Focused tool UI",
    design_md_path: "styles/linear/DESIGN.md",
    tokens_css_path: "styles/linear/tokens.css",
    components_html_path: "styles/linear/components.html"
  }
];

const styleDetail: BrandStyleContent = {
  kind: "brand",
  metadata: styles[0]!,
  designMd: `---
colors:
  background: "#fff7ed"
  primary: "#f97316"
  text-primary: "#111827"
typography:
  body: "Acme Sans"
---
`,
  tokensCss: ":root { --secondary: #3b82f6; }",
  componentsHtml: "<div>components</div>"
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

describe("StyleLibrary read-only mode", () => {
  it("does not render a sync button", async () => {
    const client = {
      getStyle: vi.fn(async () => styleDetail),
      listStyles: vi.fn(async () => styles)
    } satisfies Pick<FormaApiClient, "getStyle" | "listStyles">;
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleLibrary client={client} />);
      await flushMicrotasks();
    });

    const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(buttons.every((text) => !text.includes("同步"))).toBe(true);
  });

  it("renders styles after loading", async () => {
    const client = {
      getStyle: vi.fn(async () => styleDetail),
      listStyles: vi.fn(async () => styles)
    } satisfies Pick<FormaApiClient, "getStyle" | "listStyles">;
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleLibrary client={client} />);
      await flushMicrotasks();
    });

    expect(client.listStyles).toHaveBeenCalledTimes(1);
    expect(client.getStyle).toHaveBeenCalledWith("linear");
    expect(container.textContent).toContain("linear");
    expect(container.textContent).not.toContain("Category");
    expect(container.textContent).not.toContain("View");
    expect(container.textContent).not.toContain("Grid");
    expect(container.textContent).not.toContain("List");
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector('[data-style-primary-color="true"]')).not.toBeNull();
    expect(container.querySelector('[data-style-secondary-color="true"]')).not.toBeNull();
  });

  it("shows empty state when no styles are installed", async () => {
    const client = {
      getStyle: vi.fn(async () => styleDetail),
      listStyles: vi.fn(async () => [])
    } satisfies Pick<FormaApiClient, "getStyle" | "listStyles">;
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleLibrary client={client} />);
      await flushMicrotasks();
    });

    expect(container.textContent).toContain("No styles");
    expect(client.getStyle).not.toHaveBeenCalled();
  });

  it("keeps metadata cards visible when style detail loading fails", async () => {
    const client = {
      getStyle: vi.fn(async () => {
        throw new Error("detail unavailable");
      }),
      listStyles: vi.fn(async () => styles)
    } satisfies Pick<FormaApiClient, "getStyle" | "listStyles">;
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleLibrary client={client} />);
      await flushMicrotasks();
    });

    expect(container.textContent).toContain("linear");
    expect(container.querySelector('[data-style-primary-color="true"]')).toBeNull();
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
