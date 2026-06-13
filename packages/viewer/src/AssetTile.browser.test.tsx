import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetTile } from "@xenonbyte/forma-viewer";

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

const baseProps = {
  name: "icon",
  src: "https://example.test/app-icon/ios-1024.png",
  width: 1024,
  height: 1024,
  onDownload: () => {},
};

describe("AssetTile", () => {
  it("renders a thumbnail whose src is the given url", () => {
    const container = render(<AssetTile {...baseProps} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://example.test/app-icon/ios-1024.png");
  });

  it("uses the asset name as the image alt text", () => {
    const container = render(<AssetTile {...baseProps} />);
    expect(container.querySelector("img")!.getAttribute("alt")).toBe("icon");
  });

  it("renders the pixel-dimension size label", () => {
    const container = render(<AssetTile {...baseProps} />);
    expect(container.textContent).toContain("1024×1024");
  });

  it("invokes onDownload when the download button is clicked", () => {
    const onDownload = vi.fn();
    const container = render(<AssetTile {...baseProps} onDownload={onDownload} />);
    const button = container.querySelector("button[data-testid='asset-tile-download']") as HTMLButtonElement;
    expect(button).not.toBeNull();
    act(() => button.click());
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("shows the stale badge when stale is true", () => {
    const container = render(<AssetTile {...baseProps} stale />);
    expect(container.querySelector("[data-testid='asset-tile-stale']")).not.toBeNull();
  });

  it("hides the stale badge when stale is false or omitted", () => {
    const omitted = render(<AssetTile {...baseProps} />);
    expect(omitted.querySelector("[data-testid='asset-tile-stale']")).toBeNull();

    const explicit = render(<AssetTile {...baseProps} stale={false} />);
    expect(explicit.querySelector("[data-testid='asset-tile-stale']")).toBeNull();
  });
});
