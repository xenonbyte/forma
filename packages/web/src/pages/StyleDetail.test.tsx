// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { afterEach, vi } from "vitest";

import type { BrandStyleContent, FormaApiClient, StyleMetadata } from "../api.js";
import { StyleDetail } from "./StyleDetail.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const metadata: StyleMetadata = {
  name: "linear",
  description: "Focused tool UI",
  design_md_path: "styles/linear/DESIGN.md",
  tokens_css_path: "styles/linear/tokens.css",
  components_html_path: "styles/linear/components.html"
};

const styleDetail: BrandStyleContent = {
  kind: "brand",
  metadata,
  designMd: `---
colors:
  primary: "#5E6AD2"
components:
  button-primary:
    background: "{colors.primary}"
---
# Linear
`,
  tokensCss: ":root { --primary: #5E6AD2; }",
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

describe("StyleDetail", () => {
  it("renders DESIGN.md text when style detail is ready", async () => {
    const client = createClient();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleDetail client={client} params={{ name: "linear" }} />);
      await flushMicrotasks();
    });

    expect(container.textContent).toContain("# Linear");
    expect(container.querySelector("img")).toBeNull();
    expect("getStylePreview" in client).toBe(false);
  });

  it("renders tokens.css text block", async () => {
    const client = createClient();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleDetail client={client} params={{ name: "linear" }} />);
      await flushMicrotasks();
    });

    expect(container.textContent).toContain(":root { --primary: #5E6AD2; }");
  });

  it("renders a sandboxed iframe for components.html", async () => {
    const client = createClient();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleDetail client={client} params={{ name: "linear" }} />);
      await flushMicrotasks();
    });

    const iframe = container.querySelector("iframe[sandbox]");
    expect(iframe).not.toBeNull();
    // sandbox must not include allow-scripts
    const sandbox = iframe?.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-scripts");
  });

  it("renders translated StyleDetail copy instead of bare i18n keys", async () => {
    const client = createClient();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StyleDetail client={client} params={{ name: "linear" }} />);
      await flushMicrotasks();
    });

    expect(container.textContent).toContain("Back to styles");
    expect(container.textContent).not.toContain("style.detail.");
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
