// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect } from "vitest";
import { LocaleProvider } from "../LocaleContext.js";
import { CanvasShell } from "./CanvasShell.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CanvasShell", () => {
  it("renders a back link, product name and type name, plus children", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <LocaleProvider>
          <CanvasShell backHref="/products/P1" productName="计算器" typeName="品牌资源">
            <div data-testid="canvas-body" />
          </CanvasShell>
        </LocaleProvider>,
      ),
    );
    const back = container.querySelector("a[href='/products/P1']")!;
    expect(back).not.toBeNull();
    expect(container.textContent).toContain("计算器");
    expect(container.textContent).toContain("品牌资源");
    expect(container.querySelector("[data-testid='canvas-body']")).not.toBeNull();
    act(() => root.unmount());
    container.remove();
  });
});
