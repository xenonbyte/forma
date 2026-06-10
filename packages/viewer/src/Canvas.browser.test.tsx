import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Canvas, buildViewerModel } from "@xenonbyte/forma-viewer";
import type { NormalizeArtifactInput, ResourceResolver } from "@xenonbyte/forma-viewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
const containers: HTMLElement[] = [];
function render(ui: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  container.style.width = "1024px";
  container.style.height = "768px";
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  roots.push(root);
  containers.push(container);
  return container;
}
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const container of containers.splice(0)) container.remove();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const artifacts: NormalizeArtifactInput[] = [
  {
    artifactId: "a",
    kind: "design-page",
    pageId: "login",
    pageName: "登录页",
    variant: "default",
    title: "登录页",
    version: 1,
    width: 600,
    height: 400,
  },
  {
    artifactId: "b",
    kind: "design-page",
    pageId: "home",
    pageName: "首页",
    variant: "default",
    title: "首页",
    version: 1,
    width: 600,
    height: 400,
  },
];
const resolver: ResourceResolver = { resolve: (ref) => `https://example.test/${ref.artifactId}/${ref.kind}` };

describe("Canvas", () => {
  it("renders a React Flow canvas with one node per tile in design mode", async () => {
    const model = buildViewerModel({ entry: "requirement", artifacts });
    const container = render(<Canvas model={model} mode="design" resolver={resolver} />);
    await act(async () => {
      await sleep(50);
    });
    // React Flow 给每个 node 渲染一个带 data-id 的 .react-flow__node 元素
    const nodes = container.querySelectorAll(".react-flow__node");
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    // 设计模式下应出现 iframe(至少视口内的那张)
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("renders PNG tiles in annotation mode", async () => {
    const model = buildViewerModel({ entry: "requirement", artifacts });
    const container = render(<Canvas model={model} mode="annotation" resolver={resolver} />);
    await act(async () => {
      await sleep(50);
    });
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("design canvas shows per-tile title label and selection frame", async () => {
    const model = buildViewerModel({ entry: "requirement", artifacts });
    // 不带 defaultSelectedTileId:初始无选中
    const container = render(<Canvas model={model} mode="design" resolver={resolver} />);
    await act(async () => {
      await sleep(50);
    });
    // 不变量:每个渲染出的设计 tile 恰有一个 tile-title 标签。Canvas 只渲视口内 tile
    // (onlyRenderVisibleElements),故断言 title 数 == 渲染出的 tile(iframe)数,而非 model.tiles 总数。
    const titleLabels = container.querySelectorAll("[data-testid='tile-title']");
    const renderedTiles = container.querySelectorAll("iframe");
    expect(titleLabels.length).toBeGreaterThanOrEqual(1);
    expect(titleLabels.length).toBe(renderedTiles.length);
    for (const iframe of renderedTiles) {
      expect((iframe as HTMLIFrameElement).style.pointerEvents).toBe("none");
    }

    // 初始无选中态,不应出现 selection-frame
    expect(container.querySelector("[data-testid='selection-frame']")).toBeNull();
  });

  it("design canvas shows selection-frame when defaultSelectedTileId is set", async () => {
    const model = buildViewerModel({ entry: "requirement", artifacts });
    // defaultSelectedTileId 预选第一个 tile — 确定性地断言选中框出现
    const firstTile = model.tiles[0]!;
    const container = render(
      <Canvas model={model} mode="design" resolver={resolver} defaultSelectedTileId={firstTile.id} />,
    );
    await act(async () => {
      await sleep(50);
    });

    // 选中态下应出现 selection-frame
    expect(container.querySelector("[data-testid='selection-frame']")).not.toBeNull();
  });

  // 回归 (d8205ab): design-page tile 关 iframe 指针事件交画布平移,但 component-library 是长文档,
  // 必须保留内部滚动,否则品牌资源画布只剩顶部一截(Color/Typography)可见、下面滚不到。
  it("keeps component-library tiles interactive (scrollable) while design pages are not", async () => {
    const componentLibrary: NormalizeArtifactInput = {
      artifactId: "lib",
      kind: "component-library",
      pageId: "brand-resources",
      pageName: "brand-resources",
      variant: "default",
      title: "组件库",
      version: 1,
      width: 390,
      height: 844,
    };
    const model = buildViewerModel({ entry: "page", artifacts: [componentLibrary] });
    const container = render(<Canvas model={model} mode="design" resolver={resolver} />);
    await act(async () => {
      await sleep(50);
    });
    const iframe = container.querySelector("iframe") as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(iframe!.style.pointerEvents).not.toBe("none");
  });

  it("annotation mode does not show design tile-title labels", async () => {
    const model = buildViewerModel({ entry: "requirement", artifacts });
    const container = render(<Canvas model={model} mode="annotation" resolver={resolver} />);
    await act(async () => {
      await sleep(50);
    });
    // 标注模式 tile-title 不要求存在(spec scope 是 design canvas)
    // 但不应出现 selection-frame
    expect(container.querySelector("[data-testid='selection-frame']")).toBeNull();
  });
});
