import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const containers: HTMLElement[] = [];

function render(ui: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  roots.push(root);
  containers.push(container);
  return container;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  for (const container of containers.splice(0)) {
    container.remove();
  }
});

describe("browser-mode smoke", () => {
  it("mounts a React component into a real DOM with layout measurement", () => {
    const container = render(<div style={{ width: 200, height: 100 }}>hello</div>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.textContent).toBe("hello");
    // 真实浏览器才有非零量测;happy-dom/jsdom 通常返回 0,以此证明确在真实浏览器跑。
    expect(el.getBoundingClientRect().width).toBeGreaterThan(0);
  });
});
