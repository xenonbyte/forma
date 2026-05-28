// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequirementDetail } from "./RequirementDetail.js";
import type { ActiveDesignSession, FormaApiClient, ProductComponentLibrary, RequirementDesignCanvas, RequirementWithDocument } from "../api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noUiRequirement: RequirementWithDocument = {
  id: "R-12345678",
  product_id: "P-123abc",
  title: "Copy-only policy update",
  status: "active",
  created_at: "2026-05-17T00:00:00.000Z",
  updated_at: "2026-05-17T01:00:00.000Z",
  ui_affected: false,
  document_md: "# Copy-only policy update\n\nNo interface work is needed.",
  pages: [
    {
      page_id: "checkout",
      baseline_page: "checkout",
      name: "Checkout",
      design_status: "done",
      copy: []
    }
  ],
  navigation: [{ from: "policy", to: "checkout", label: "applies to" }]
};

const uiRequirementWithLegacyDesignId: RequirementWithDocument = {
  ...noUiRequirement,
  title: "Checkout UI update",
  ui_affected: true,
  document_md: "# Checkout UI update",
  pages: [
    {
      page_id: "checkout",
      baseline_page: "checkout",
      name: "Checkout",
      design_status: "done",
      copy: []
    }
  ],
  navigation: []
};

const completeCanvas: RequirementDesignCanvas = {
  component_library_version: 7,
  index_status: "stale",
  product_id: "P-123abc",
  requirement_id: "R-12345678",
  canvas_version: 4,
  pages: [{ page_id: "checkout", frame_id: "frame-1", status: "done" }]
};

const activeSession: ActiveDesignSession = {
  elapsed_ms: 192000,
  lock_owner: { agent: "codex", pid: 70604 },
  operation: "generate",
  page_id: "checkout",
  product_id: "P-123abc",
  requirement_id: "R-12345678",
  session_id: "S-active",
  status: "drawing",
  quality_result: "passed",
  screenshot_review_status: "pending"
};

const componentLibrary: ProductComponentLibrary = {
  components: [{ key: "button.primary", name: "Primary button" }],
  current_version: 8,
  product_id: "P-123abc",
  status: "ready"
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

describe("RequirementDetail", () => {
  it("shows no-UI state while hiding design actions and history", async () => {
    const client = {
      getRequirement: vi.fn(async () => noUiRequirement)
    } satisfies Pick<FormaApiClient, "getRequirement">;
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<RequirementDetail client={client} params={{ productId: "P-123abc", reqId: "R-12345678" }} />);
      await flushPromises();
    });

    expect(container.textContent).toContain("No UI changes");
    expect(container.textContent).toContain("No interface work is needed.");
    expect(container.textContent).toContain("applies to");
    expect(container.textContent).not.toContain("Open design");
    expect(container.textContent).not.toContain("Design history");
    expect(container.querySelector('a[href*="/designs/"]')).toBeNull();
  });

  it("links UI-affecting pages to the requirement-level design view without legacy design ids", async () => {
    const client = {
      getRequirement: vi.fn(async () => uiRequirementWithLegacyDesignId)
    } satisfies Pick<FormaApiClient, "getRequirement">;
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<RequirementDetail client={client} params={{ productId: "P-123abc", reqId: "R-12345678" }} />);
      await flushPromises();
    });

    expect(container.textContent).toContain("Checkout UI update");
    expect(container.textContent).toContain("Open design");
    expect(container.querySelector('a[href="/products/P-123abc/requirements/R-12345678/design?page_id=checkout"]')).not.toBeNull();
    expect(container.querySelector('a[href*="/designs/"]')).toBeNull();
    expect(container.innerHTML).not.toContain("/products/P-123abc/requirements/R-12345678/designs/D-12345678");
  });

  it("shows requirement-level canvas, component, and active session status from structured APIs", async () => {
    const client = {
      getActiveRequirementDesignSession: vi.fn(async () => activeSession),
      getProductComponentLibrary: vi.fn(async () => componentLibrary),
      getRequirement: vi.fn(async () => uiRequirementWithLegacyDesignId),
      getRequirementDesignCanvas: vi.fn(async () => completeCanvas)
    } satisfies Pick<
      FormaApiClient,
      "getActiveRequirementDesignSession" | "getProductComponentLibrary" | "getRequirement" | "getRequirementDesignCanvas"
    >;
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<RequirementDetail client={client} params={{ productId: "P-123abc", reqId: "R-12345678" }} />);
      await flushPromises();
    });

    expect(client.getRequirementDesignCanvas).toHaveBeenCalledWith("P-123abc", "R-12345678");
    expect(client.getActiveRequirementDesignSession).toHaveBeenCalledWith("P-123abc", "R-12345678");
    expect(client.getProductComponentLibrary).toHaveBeenCalledWith("P-123abc");
    expect(container.textContent).toContain("design.pen");
    expect(container.textContent).toContain("Pinned components v7");
    expect(container.textContent).toContain("Latest components v8");
    expect(container.textContent).toContain("03:12");
    expect(container.textContent).toContain("codex");
    expect(container.textContent).toContain("stale");
    expect(container.textContent).toContain("passed");
    expect(container.textContent).toContain("pending");
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

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
