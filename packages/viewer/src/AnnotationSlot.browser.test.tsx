import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AnnotationSlot } from "@xenonbyte/forma-viewer";

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

describe("AnnotationSlot", () => {
  it("renders a reserved region with the annotation role", () => {
    const container = render(<AnnotationSlot />);
    const region = container.querySelector('[data-slot="annotation"]');
    expect(region).not.toBeNull();
  });

  it("is empty of annotation content this phase (placeholder only)", () => {
    const container = render(<AnnotationSlot />);
    const region = container.querySelector('[data-slot="annotation"]')!;
    expect(region.querySelectorAll('[data-annotation-item]').length).toBe(0);
  });
});
