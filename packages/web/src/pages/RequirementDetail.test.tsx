// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequirementDetail } from "./RequirementDetail.js";
import type { ArtifactSummary, RequirementWithDocument } from "../api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const uiRequirement: RequirementWithDocument = {
  id: "R-12345678",
  product_id: "P-123abc",
  title: "Checkout UI update",
  status: "active",
  created_at: "2026-05-17T00:00:00.000Z",
  updated_at: "2026-05-17T01:00:00.000Z",
  ui_affected: true,
  document_md: "# Checkout UI update\n\nDetails of the change.",
  pages: [
    {
      page_id: "checkout",
      baseline_page: "checkout",
      name: "Checkout",
      design_status: "done",
      copy: [],
    },
  ],
  navigation: [{ from: "policy", to: "checkout", label: "applies to" }],
};

const noUiRequirement: RequirementWithDocument = {
  ...uiRequirement,
  title: "Copy-only policy update",
  ui_affected: false,
  document_md: "# Copy-only policy update\n\nNo interface work is needed.",
};

const currentArtifact: ArtifactSummary = {
  id: "A-current",
  kind: "design-page",
  title: "Checkout design",
  requirement_id: "R-12345678",
  updated_at: "2026-05-28T00:00:00.000Z",
  superseded: false,
};

const otherArtifact: ArtifactSummary = {
  id: "A-other",
  kind: "design-page",
  title: "Other requirement design",
  requirement_id: "R-other",
  updated_at: "2026-05-28T00:00:00.000Z",
  superseded: false,
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
  Reflect.deleteProperty(globalThis.navigator, "clipboard");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RequirementDetail document card", () => {
  it("renders only the status row and document card", async () => {
    const client = createClient(uiRequirement, [currentArtifact]);
    const { container, root } = await renderDetail(client);

    expect(container.textContent).toContain("Details of the change.");
    expect(container.textContent).toContain("R-12345678");
    expect(client.listProductArtifacts).toHaveBeenCalledWith("P-123abc", "html");

    expect(container.textContent).not.toContain("Requirement pages");
    expect(container.textContent).not.toContain("applies to");
    expect(container.textContent).not.toContain("Open in app");
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("forma://");
    expect(container.innerHTML).not.toContain("xl:grid-cols");
    expect(container.querySelector('a[href*="page_id="]')).toBeNull();
  });

  it("shows both icon actions on the document card", async () => {
    const client = createClient(uiRequirement, [currentArtifact]);
    const { container } = await renderDetail(client);

    const copyButton = container.querySelector('button[aria-label="Copy document"]');
    expect(copyButton).not.toBeNull();
    expect(copyButton?.querySelector("svg")).not.toBeNull();

    const openDesign = container.querySelector('a[aria-label="Open design"]');
    expect(openDesign).not.toBeNull();
    expect(openDesign?.querySelector("svg")).not.toBeNull();
  });

  it("copies the document, announces success politely, and reverts after 2s", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    const client = createClient(uiRequirement, [currentArtifact]);
    const { container } = await renderDetail(client);

    const copyButton = container.querySelector<HTMLButtonElement>('button[aria-label="Copy document"]');
    expect(copyButton).not.toBeNull();

    await act(async () => {
      copyButton?.click();
      await flushPromises();
    });

    expect(writeText).toHaveBeenCalledWith(uiRequirement.document_md);
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.textContent).toContain("Copied");

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(container.querySelector('[aria-live="polite"]')?.textContent).not.toContain("Copied");
  });

  it("shows a failed state when the clipboard write rejects", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    stubClipboard(writeText);
    const client = createClient(uiRequirement, [currentArtifact]);
    const { container } = await renderDetail(client);

    const copyButton = container.querySelector<HTMLButtonElement>('button[aria-label="Copy document"]');

    await act(async () => {
      copyButton?.click();
      await flushPromises();
    });

    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("Copy failed");
  });

  it("shows a failed state when the clipboard API is unavailable", async () => {
    Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: undefined });
    const client = createClient(uiRequirement, [currentArtifact]);
    const { container } = await renderDetail(client);

    const copyButton = container.querySelector<HTMLButtonElement>('button[aria-label="Copy document"]');

    await act(async () => {
      copyButton?.click();
      await flushPromises();
    });

    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("Copy failed");
  });

  it("disables copy when the document is empty", async () => {
    const client = createClient({ ...uiRequirement, document_md: "" }, [currentArtifact]);
    const { container } = await renderDetail(client);

    expect(container.textContent).toContain("No markdown document is stored for this requirement.");
    const copyButton = container.querySelector<HTMLButtonElement>('button[aria-label="Copy document"]');
    expect(copyButton).not.toBeNull();
    expect(copyButton?.disabled).toBe(true);
  });
});

describe("RequirementDetail open design action", () => {
  it("disables open design when the requirement has no UI changes", async () => {
    const client = createClient(noUiRequirement, [currentArtifact]);
    const { container } = await renderDetail(client);

    expect(container.textContent).toContain("No UI changes");
    expect(container.querySelector('a[href$="/design"]')).toBeNull();
    const disabled = container.querySelector('[aria-label="Open design"]');
    expect(disabled).not.toBeNull();
    expect(disabled?.tagName).not.toBe("A");
    expect(disabled?.getAttribute("title")).toBe("No design available to open");
  });

  it("disables open design when no html artifact belongs to the requirement", async () => {
    const client = createClient(uiRequirement, [otherArtifact]);
    const { container } = await renderDetail(client);

    expect(container.querySelector('a[href$="/design"]')).toBeNull();
    const disabled = container.querySelector('[aria-label="Open design"]');
    expect(disabled).not.toBeNull();
    expect(disabled?.tagName).not.toBe("A");
    expect(disabled?.getAttribute("title")).toBe("No design available to open");
  });

  it("links open design to the requirement design route when enabled", async () => {
    const client = createClient(uiRequirement, [otherArtifact, currentArtifact]);
    const { container } = await renderDetail(client);

    const link = container.querySelector('a[aria-label="Open design"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/products/P-123abc/requirements/R-12345678/design");
  });
});

function createClient(requirement: RequirementWithDocument, artifacts: ArtifactSummary[]) {
  return {
    getRequirement: vi.fn(async () => requirement),
    listProductArtifacts: vi.fn(async () => ({ artifacts })),
  };
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

async function renderDetail(client: ReturnType<typeof createClient>) {
  const { container, root } = createTestRoot();
  await act(async () => {
    root.render(<RequirementDetail client={client} params={{ productId: "P-123abc", reqId: "R-12345678" }} />);
    await flushPromises();
  });
  return { container, root };
}

function createTestRoot() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
