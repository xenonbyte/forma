import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Viewer, buildViewerModel } from "@xenonbyte/forma-viewer";
import type { NormalizeArtifactInput, ResourceResolver } from "@xenonbyte/forma-viewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
const containers: HTMLElement[] = [];
function render(ui: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  container.style.width = "1200px";
  container.style.height = "800px";
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
  { artifactId: "a", kind: "design-page", pageId: "login", pageName: "登录页", variant: "default", title: "登录页", version: 1, width: 600, height: 400 },
  { artifactId: "b", kind: "design-page", pageId: "home", pageName: "首页", variant: "default", title: "首页", version: 1, width: 600, height: 400 }
];
const resolver: ResourceResolver = { resolve: (ref) => `https://example.test/${ref.artifactId}/${ref.kind}` };

describe("Viewer", () => {
  it("renders left list, center canvas, and right annotation slot", async () => {
    const model = buildViewerModel({ entry: "requirement", artifacts });
    const container = render(<Viewer model={model} resolver={resolver} />);
    await act(async () => { await sleep(50); });
    expect(container.querySelector('nav[aria-label="设计稿列表"]')).not.toBeNull();
    expect(container.querySelector(".react-flow")).not.toBeNull();
    expect(container.querySelector('[data-slot="annotation"]')).not.toBeNull();
  });

  it("defaults to design mode (iframe) and switches to annotation mode (img)", async () => {
    const model = buildViewerModel({ entry: "requirement", artifacts });
    const container = render(<Viewer model={model} resolver={resolver} />);
    await act(async () => { await sleep(50); });
    expect(container.querySelector("iframe")).not.toBeNull();

    const toggle = container.querySelector<HTMLElement>('[data-action="mode-annotation"]')!;
    await act(async () => { toggle.click(); await sleep(50); });
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });
});
