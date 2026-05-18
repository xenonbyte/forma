// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesignView } from "./DesignView.js";
import type { FormaApiClient } from "../api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
});

describe("DesignView lifecycle", () => {
  it("uses the injected client for the embedded diff viewer", async () => {
    const client = {
      getDesignAnnotations: vi.fn(async () => []),
      getDesignDiff: vi.fn(async () => ({
        added: [],
        removed: [],
        modified: [],
        visual: {
          from_image_url: "/api/designs/D-12345678/image/file?version=1",
          to_image_url: "/api/designs/D-12345678/image/file?version=2"
        }
      })),
      getDesignHistory: vi.fn(async () => ({
        design_id: "D-12345678",
        product_id: "P-123abc",
        requirement_id: "R-12345678",
        page_id: "checkout",
        current_version: 2,
        versions: [
          {
            version: 1,
            file: "design.v1.pen",
            preview_file: "preview.v1@2x.png",
            created_at: "2026-05-17T01:00:00.000Z",
            current: false,
            image_url: "/api/designs/D-12345678/image/file?version=1"
          },
          {
            version: 2,
            file: "design.pen",
            preview_file: "preview@2x.png",
            created_at: "2026-05-17T02:00:00.000Z",
            current: true,
            image_url: "/api/designs/D-12345678/image/file?version=2"
          }
        ]
      }))
    } satisfies Pick<FormaApiClient, "getDesignAnnotations" | "getDesignDiff" | "getDesignHistory">;
    const { root } = createTestRoot();

    await act(async () => {
      root.render(<DesignView client={client} params={{ designId: "D-12345678", productId: "P-123abc", reqId: "R-12345678" }} />);
      await flushPromises();
    });

    expect(client.getDesignAnnotations).toHaveBeenCalledWith("D-12345678");
    expect(client.getDesignHistory).toHaveBeenCalledWith("D-12345678");
    expect(client.getDesignDiff).toHaveBeenCalledWith("D-12345678", 1, 2);
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
