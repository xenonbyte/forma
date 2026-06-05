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
  container.style.width = "800px";
  container.style.height = "600px";
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

// 造 40 个分散在大画布上的 tile,远超视口
const artifacts: NormalizeArtifactInput[] = Array.from({ length: 40 }, (_, i) => ({
  artifactId: `art${i}`,
  kind: "design-page" as const,
  pageId: `page${i}`,
  pageName: `页 ${i}`,
  variant: "default",
  title: `页 ${i}`,
  version: 1,
  width: 1200,
  height: 900,
}));
const resolver: ResourceResolver = { resolve: (ref) => `https://example.test/${ref.artifactId}/${ref.kind}` };

describe("Canvas viewport virtualization", () => {
  it("mounts far fewer node iframes than total tiles (offscreen unmounted)", async () => {
    const model = buildViewerModel({ entry: "requirement", artifacts });
    const container = render(<Canvas model={model} mode="design" resolver={resolver} />);
    // Canvas 生产代码不得默认 fitView;默认/受控初始视口只覆盖局部区域。
    await act(async () => {
      await sleep(80);
    });
    const renderedNodes = container.querySelectorAll(".react-flow__node");
    // onlyRenderVisibleElements 应让挂载节点数远小于 40
    expect(renderedNodes.length).toBeGreaterThan(0);
    expect(renderedNodes.length).toBeLessThan(40);
  });
});
