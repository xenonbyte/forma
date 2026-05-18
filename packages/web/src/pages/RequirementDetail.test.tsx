// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequirementDetail } from "./RequirementDetail.js";
import type { FormaApiClient, RequirementWithDocument } from "../api.js";

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
      design_id: "D-12345678",
      design_status: "done",
      copy: []
    }
  ],
  navigation: [{ from: "policy", to: "checkout", label: "applies to" }]
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
