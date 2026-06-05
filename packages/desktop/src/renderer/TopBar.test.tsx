// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { TopBar } from "./TopBar.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function render(ui: React.ReactElement): { container: HTMLElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(ui);
  });
  return { container };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("TopBar", () => {
  it("renders the product name and breadcrumb", () => {
    const { container } = render(<TopBar productName="产品一" crumb="登录需求 / 登录页" />);
    expect(container.textContent).toContain("产品一");
    expect(container.textContent).toContain("登录需求 / 登录页");
  });

  it("renders without a crumb", () => {
    const { container } = render(<TopBar productName="产品一" crumb="" />);
    expect(container.textContent).toContain("产品一");
  });
});
