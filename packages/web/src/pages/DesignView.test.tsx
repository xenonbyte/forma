// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const canvasSpy = vi.hoisted(() => vi.fn());

// 仅替换 Canvas 为记录 props 的桩;buildViewerModel 等其余导出保持真实实现,
// 让模型形状(tiles/groups/entry)在断言里保持真实。
vi.mock("@xenonbyte/forma-viewer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xenonbyte/forma-viewer")>();
  return {
    ...actual,
    Canvas: (props: unknown) => {
      canvasSpy(props);
      return createElement("div", { "data-testid": "canvas" });
    },
  };
});

import { DesignView, type DesignViewClient } from "./DesignView.js";
import type { ViewerModel, ResourceResolver, CanvasMode } from "@xenonbyte/forma-viewer";

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
  canvasSpy.mockClear();
});

interface FakeClientOverrides {
  getProduct?: DesignViewClient["getProduct"];
  getRequirement?: DesignViewClient["getRequirement"];
  listProductArtifacts?: DesignViewClient["listProductArtifacts"];
}

function fakeClient(overrides: FakeClientOverrides = {}): DesignViewClient {
  return {
    getProduct: async () => ({ id: "p1", name: "P", description: "", platform: "web" }),
    getRequirement: async () => ({
      id: "r1",
      title: "需求",
      product_id: "p1",
      status: "active",
      created_at: "",
      updated_at: "",
      navigation: [],
      document_md: "",
      pages: [
        { baseline_page: "login", design_status: "done", name: "登录页", page_id: "login" },
        { baseline_page: "settings", design_status: "done", name: "设置页", page_id: "settings" },
      ],
    }),
    listProductArtifacts: async () => ({
      artifacts: [
        {
          id: "a",
          kind: "design-page",
          title: "登录页",
          updated_at: "",
          superseded: false,
          requirement_id: "r1",
          page_id: "login",
          variant: "default",
          current_version: 1,
          version_count: 1,
        },
        {
          id: "d",
          kind: "design-page",
          title: "登录页 宽屏",
          updated_at: "",
          superseded: false,
          requirement_id: "r1",
          page_id: "login",
          variant: "wide",
          current_version: 1,
          version_count: 2,
        },
        {
          id: "b",
          kind: "design-page",
          title: "设置页",
          updated_at: "",
          superseded: false,
          requirement_id: "r1",
          page_id: "settings",
          variant: "default",
          current_version: 1,
          version_count: 1,
        },
        {
          id: "c",
          kind: "design-page",
          title: "别的需求",
          updated_at: "",
          superseded: false,
          requirement_id: "r2",
          page_id: "login",
          variant: "default",
          current_version: 1,
          version_count: 1,
        },
        {
          id: "lib",
          kind: "component-library",
          title: "组件库",
          updated_at: "",
          superseded: false,
          requirement_id: "r1",
        },
      ],
    }),
    ...overrides,
  } as unknown as DesignViewClient;
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

interface CanvasCallProps {
  model: ViewerModel;
  mode: CanvasMode;
  resolver: ResourceResolver;
}

describe("DesignView", () => {
  // TEST-WEB-001: 纯画布渲染 — Canvas 收到 requirement 模型与产品 resolver,无 PNG 网格。
  it("renders Canvas with a requirement-entry model and product-scoped resolver, without a PNG grid", async () => {
    const client = fakeClient();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<DesignView client={client} params={{ productId: "p1", reqId: "r1" }} />);
      await flushPromises();
    });

    expect(container.querySelector("[data-testid='canvas']")).toBeTruthy();
    expect(canvasSpy).toHaveBeenCalled();
    const props = canvasSpy.mock.calls.at(-1)?.[0] as CanvasCallProps;

    expect(props.mode).toBe("design");
    expect(props.model.entry).toBe("requirement");
    // r2 的 c 与 component-library 的 lib 被排除;tile id = artifactId:version:variant。
    expect(props.model.tiles.map((tile) => tile.id).sort()).toEqual(["a:1:default", "b:1:default", "d:1:wide"]);

    expect(props.resolver.resolve({ artifactId: "a", version: 1, kind: "bundle" })).toBe(
      "/api/products/p1/artifacts/a/versions/1/bundle/index.html",
    );

    // 旧 PNG 网格 / lightbox 已删除:页面上不应有任何 img。
    expect(container.querySelectorAll("img").length).toBe(0);
  });

  it("renders a top bar with a back link to the requirement detail and the requirement id", async () => {
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<DesignView client={fakeClient()} params={{ productId: "p1", reqId: "r1" }} />);
      await flushPromises();
    });

    const backLink = container.querySelector('a[href="/products/p1/requirements/r1"]');
    expect(backLink).not.toBeNull();
    expect(container.textContent).toContain("r1");
  });

  // TEST-WEB-002: 空态/ui_affected=false/加载/错误态。
  it("shows the canvas empty state when the requirement has no renderable design artifacts", async () => {
    const client = fakeClient({
      listProductArtifacts: (async () => ({ artifacts: [] })) as DesignViewClient["listProductArtifacts"],
    });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<DesignView client={client} params={{ productId: "p1", reqId: "r1" }} />);
      await flushPromises();
    });

    expect(canvasSpy).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='canvas']")).toBeNull();
    expect(container.textContent).toContain("No designs on the canvas yet");
  });

  it("shows the dedicated empty state when requirement.ui_affected is false", async () => {
    const client = fakeClient({
      getRequirement: (async () => ({
        id: "r1",
        title: "需求",
        product_id: "p1",
        status: "active",
        created_at: "",
        updated_at: "",
        navigation: [],
        document_md: "",
        ui_affected: false,
        pages: [],
      })) as unknown as DesignViewClient["getRequirement"],
      listProductArtifacts: (async () => ({ artifacts: [] })) as DesignViewClient["listProductArtifacts"],
    });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<DesignView client={client} params={{ productId: "p1", reqId: "r1" }} />);
      await flushPromises();
    });

    expect(canvasSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain("This requirement has no UI changes");
    expect(container.textContent).not.toContain("No designs on the canvas yet");
  });

  it("shows the loading state while requests are pending", async () => {
    const never = new Promise<never>(() => {});
    const client = fakeClient({
      getProduct: (() => never) as unknown as DesignViewClient["getProduct"],
      getRequirement: (() => never) as unknown as DesignViewClient["getRequirement"],
      listProductArtifacts: (() => never) as unknown as DesignViewClient["listProductArtifacts"],
    });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<DesignView client={client} params={{ productId: "p1", reqId: "r1" }} />);
    });

    expect(container.textContent).toContain("Design view");
    expect(container.querySelector("[data-testid='canvas']")).toBeNull();
  });

  it("shows the error state when loading fails", async () => {
    const client = fakeClient({
      getRequirement: (async () => {
        throw new Error("boom");
      }) as unknown as DesignViewClient["getRequirement"],
    });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<DesignView client={client} params={{ productId: "p1", reqId: "r1" }} />);
      await flushPromises();
    });

    expect(canvasSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Design canvas unavailable");
    expect(container.textContent).toContain("boom");
  });

  // RISK-REG-002: current_version 内部活跃指针被保留 — 当 current_version 不是最高版本时
  // (例如回滚后 current_version=2 而 versions=[1,2,3])，Canvas 仍应渲染，不显示对比链接。
  it("no compare route/link; current design renders when current_version is not max", async () => {
    // Fixture: artifact "d" has versions [1,2,3] but current_version=2 (simulates rollback)
    const client = fakeClient({
      listProductArtifacts: (async () => ({
        artifacts: [
          {
            id: "a",
            kind: "design-page",
            title: "登录页",
            updated_at: "",
            superseded: false,
            requirement_id: "r1",
            page_id: "login",
            variant: "default",
            current_version: 2, // not the max version (3)
            version_count: 3,
          },
        ],
      })) as DesignViewClient["listProductArtifacts"],
    });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<DesignView client={client} params={{ productId: "p1", reqId: "r1" }} />);
      await flushPromises();
    });

    // Canvas renders (the active pointer is preserved)
    expect(container.querySelector("[data-testid='canvas']")).toBeTruthy();
    expect(canvasSpy).toHaveBeenCalled();

    // The active version in the model tile is current_version=2, not the max (3)
    const props = canvasSpy.mock.calls.at(-1)?.[0] as CanvasCallProps;
    const tileIds = props.model.tiles.map((tile) => tile.id);
    expect(tileIds).toContain("a:2:default"); // current_version is the active pointer

    // No compare link anywhere in the document
    const compareLinks = container.querySelectorAll('a[href*="/compare"]');
    expect(compareLinks.length).toBe(0);
  });
});
