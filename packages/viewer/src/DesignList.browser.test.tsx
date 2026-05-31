import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignList, buildViewerModel } from "@xenonbyte/forma-viewer";
import type { NormalizeArtifactInput } from "@xenonbyte/forma-viewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
const containers: HTMLElement[] = [];
function render(ui: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
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

const artifacts: NormalizeArtifactInput[] = [
  { artifactId: "a", kind: "design-page", pageId: "login", pageName: "登录页", variant: "default", title: "登录页 默认", version: 1, width: 600, height: 400 },
  { artifactId: "a", kind: "design-page", pageId: "login", pageName: "登录页", variant: "wide", title: "登录页 宽屏", version: 1, width: 600, height: 400 },
  { artifactId: "b", kind: "design-page", pageId: "home", pageName: "首页", variant: "default", title: "首页", version: 1, width: 600, height: 400 }
];

describe("DesignList", () => {
  it("lists each page group with its variants", () => {
    const model = buildViewerModel({ entry: "requirement", artifacts });
    const container = render(<DesignList model={model} onLocate={() => {}} />);
    expect(container.textContent).toContain("登录页");
    expect(container.textContent).toContain("首页");
    const items = container.querySelectorAll("[data-tile-id]");
    expect(items.length).toBe(3);
  });

  it("calls onLocate with the tile id when a variant row is clicked", () => {
    const model = buildViewerModel({ entry: "requirement", artifacts });
    const onLocate = vi.fn();
    const container = render(<DesignList model={model} onLocate={onLocate} />);
    const row = container.querySelector<HTMLElement>('[data-tile-id="a:1:wide"]')!;
    act(() => row.click());
    expect(onLocate).toHaveBeenCalledWith("a:1:wide");
  });
});
