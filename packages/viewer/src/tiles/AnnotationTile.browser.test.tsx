import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AnnotationTile } from "@xenonbyte/forma-viewer";
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
  id: "a:1:default", kind: "design-page", pageId: "login", pageName: "登录页",
  variant: "default", title: "登录页", version: 1, width: 800, height: 600, x: 0, y: 0,
  htmlBundle: { artifactId: "a", version: 1, kind: "bundle" },
  previewImages: {
    "1x": { artifactId: "a", version: 1, kind: "preview", density: "1x" },
    "2x": { artifactId: "a", version: 1, kind: "preview", density: "2x" }
  }
};
const resolver: ResourceResolver = {
  resolve: (ref) =>
    `https://example.test/${ref.artifactId}/v${ref.version}/${ref.kind}${ref.density ? `-${ref.density}` : ""}`
};

describe("AnnotationTile", () => {
  it("renders an img whose src is the resolved 1x preview png", () => {
    const container = render(<AnnotationTile tile={tile} resolver={resolver} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://example.test/a/v1/preview-1x");
  });

  it("renders a 2x preview srcSet when available", () => {
    const container = render(<AnnotationTile tile={tile} resolver={resolver} />);
    expect(container.querySelector("img")!.getAttribute("srcset")).toBe(
      "https://example.test/a/v1/preview-2x 2x"
    );
  });

  it("uses the tile title as alt text", () => {
    const container = render(<AnnotationTile tile={tile} resolver={resolver} />);
    expect(container.querySelector("img")!.getAttribute("alt")).toBe("登录页");
  });

  it("sizes the image to the tile intrinsic dimensions", () => {
    const container = render(<AnnotationTile tile={tile} resolver={resolver} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("width")).toBe("800");
    expect(img.getAttribute("height")).toBe("600");
  });
});
