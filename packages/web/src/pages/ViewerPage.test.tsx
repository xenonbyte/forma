// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const viewerSpy = vi.fn();
vi.mock("@xenonbyte/forma-viewer", () => ({
  buildViewerModel: (input: unknown) => ({ __model: input }),
  Viewer: (props: { model: unknown }) => {
    viewerSpy(props);
    return createElement("div", { "data-testid": "viewer" });
  }
}));

import { ViewerPage } from "./ViewerPage.js";
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
  vi.restoreAllMocks();
  viewerSpy.mockClear();
});

function fakeClient(): FormaApiClient {
  return {
    getProduct: async () => ({ id: "p1", name: "P", description: "", platform: "web" }),
    getRequirement: async () => ({
      id: "r1", title: "需求", product_id: "p1", status: "active", created_at: "", updated_at: "",
      navigation: [], document_md: "",
      pages: [
        { baseline_page: "login", design_status: "done", name: "登录页", page_id: "login" },
        { baseline_page: "settings", design_status: "done", name: "设置页", page_id: "settings" }
      ]
    }),
    listProductArtifacts: async () => ({
      artifacts: [
        { id: "a", kind: "design-page", title: "登录页", updated_at: "", superseded: false, requirement_id: "r1", page_id: "login", variant: "default", current_version: 1 },
        { id: "d", kind: "design-page", title: "登录页 宽屏", updated_at: "", superseded: false, requirement_id: "r1", page_id: "login", variant: "wide", current_version: 2 },
        { id: "b", kind: "design-page", title: "设置页", updated_at: "", superseded: false, requirement_id: "r1", page_id: "settings", variant: "default", current_version: 1 },
        { id: "c", kind: "design-page", title: "别的需求", updated_at: "", superseded: false, requirement_id: "r2", page_id: "login", variant: "default", current_version: 1 }
      ]
    })
  } as unknown as FormaApiClient;
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
  await Promise.resolve();
}

describe("ViewerPage", () => {
  it("loads requirement + artifacts and renders Viewer with a built model (requirement entry)", async () => {
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ViewerPage client={fakeClient()} params={{ productId: "p1", reqId: "r1" }} entry="requirement" />);
      await flushPromises();
    });

    expect(container.querySelector("[data-testid='viewer']")).toBeTruthy();
    expect(viewerSpy).toHaveBeenCalled();
    const model = viewerSpy.mock.calls[0][0].model as { __model: { entry: string; artifacts: Array<{ artifactId: string }> } };
    expect(model.__model.entry).toBe("requirement");
    expect(model.__model.artifacts.map((a) => a.artifactId)).toEqual(["a", "d", "b"]);
  });

  it("filters to a single page for the page entry", async () => {
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ViewerPage client={fakeClient()} params={{ productId: "p1", reqId: "r1", pageId: "login" }} entry="page" />);
      await flushPromises();
    });

    expect(container.querySelector("[data-testid='viewer']")).toBeTruthy();
    const model = viewerSpy.mock.calls.at(-1)![0].model as { __model: { entry: string; artifacts: Array<{ artifactId: string }> } };
    expect(model.__model.entry).toBe("page");
    expect(model.__model.artifacts.map((a) => a.artifactId)).toEqual(["a", "d"]);
  });

  it("contains the absolute viewer within a sized route surface", async () => {
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ViewerPage client={fakeClient()} params={{ productId: "p1", reqId: "r1" }} entry="requirement" />);
      await flushPromises();
    });

    const surface = container.firstElementChild as HTMLElement | null;
    expect(surface).not.toBeNull();
    expect(surface?.style.position).toBe("relative");
    expect(surface?.style.height).not.toBe("");

    const viewerFrame = surface?.firstElementChild as HTMLElement | null;
    expect(viewerFrame?.style.position).toBe("absolute");
    expect(viewerFrame?.style.inset).toMatch(/^0(px)?$/);
  });
});
