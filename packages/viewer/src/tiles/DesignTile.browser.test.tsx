import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DesignTile } from "@xenonbyte/forma-viewer";
import type { PositionedTile, ResourceResolver } from "@xenonbyte/forma-viewer";

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

const tile: PositionedTile = {
  id: "a:1:default",
  kind: "design-page",
  pageId: "login",
  pageName: "登录页",
  variant: "default",
  title: "登录页",
  version: 1,
  width: 800,
  height: 600,
  x: 0,
  y: 0,
  htmlBundle: { artifactId: "a", version: 1, kind: "bundle" },
  previewImages: {
    "1x": { artifactId: "a", version: 1, kind: "preview", density: "1x" },
    "2x": { artifactId: "a", version: 1, kind: "preview", density: "2x" },
  },
};
const resolver: ResourceResolver = {
  resolve: (ref) =>
    `https://example.test/${ref.artifactId}/v${ref.version}/${ref.kind}${ref.density ? `-${ref.density}` : ""}`,
};

describe("DesignTile", () => {
  it("renders an iframe whose src is the resolved html bundle", () => {
    const container = render(<DesignTile tile={tile} resolver={resolver} />);
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toBe("https://example.test/a/v1/bundle");
  });

  it("sandboxes the iframe without allow-scripts", () => {
    const container = render(<DesignTile tile={tile} resolver={resolver} />);
    const sandbox = container.querySelector("iframe")!.getAttribute("sandbox");
    expect(sandbox).not.toBeNull();
    expect(sandbox!).not.toContain("allow-scripts");
  });

  it("sizes the iframe to the tile intrinsic dimensions", () => {
    const container = render(<DesignTile tile={tile} resolver={resolver} />);
    const iframe = container.querySelector("iframe")!;
    expect(iframe.getAttribute("width")).toBe("800");
    expect(iframe.getAttribute("height")).toBe("600");
  });
});
