// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../LocaleContext.js";
import { getLocale, setLocale } from "../i18n.js";
import { Layout } from "./Layout.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const containers: HTMLElement[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  for (const container of containers.splice(0)) {
    container.remove();
  }
  setLocale("en");
});

describe("Layout locale switch", () => {
  it("renders language buttons and updates locale state", async () => {
    setLocale("en");
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <LocaleProvider>
          <Layout
            currentPathname="/products"
            navItems={[
              { href: "/products", label: "Products", meta: "Sessions and requirements" },
              { href: "/styles", label: "Styles", meta: "Design libraries" }
            ]}
            routeContext="Products"
            title="Products"
          >
            <p>Loaded</p>
          </Layout>
        </LocaleProvider>
      );
      await flushPromises();
    });

    const en = buttonByText(container, "EN");
    const zh = buttonByText(container, "中");
    expect(en.getAttribute("aria-pressed")).toBe("true");
    expect(zh.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      zh.click();
      await flushPromises();
    });

    expect(getLocale()).toBe("zh");
    expect(en.getAttribute("aria-pressed")).toBe("false");
    expect(zh.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("产品");
  });

  it("renders active nav accent while keeping icon labels accessible", async () => {
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <LocaleProvider>
          <Layout
            currentPathname="/products/P-123abc"
            navItems={[
              { href: "/products", label: "Products", meta: "Sessions and requirements" },
              { href: "/styles", label: "Styles", meta: "Design libraries" }
            ]}
            routeContext="Products"
            title="Products"
          >
            <p>Loaded</p>
          </Layout>
        </LocaleProvider>
      );
      await flushPromises();
    });

    const productsLink = required(container.querySelector<HTMLAnchorElement>('nav a[href="/products"]'), "products nav link");
    const stylesLink = required(container.querySelector<HTMLAnchorElement>('nav a[href="/styles"]'), "styles nav link");

    expect(productsLink.getAttribute("aria-current")).toBe("page");
    expect(productsLink.querySelector('[data-nav-active-accent="true"]')).not.toBeNull();
    expect(productsLink.querySelector("svg")).not.toBeNull();
    expect(productsLink.textContent).toContain("Products");
    expect(stylesLink.querySelector("svg")).not.toBeNull();
    expect(stylesLink.textContent).toContain("Styles");
    expect(required(container.querySelector("aside"), "sidebar").className).toContain("border-zinc-300");
    expect(required(container.querySelector("header"), "header").className).toContain("shadow-[0_1px_3px");
    expect(required(container.querySelector("main"), "main").className).toContain("page-fade-in");
  });
});

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === text);
  if (!button) {
    throw new Error(`Missing button ${text}`);
  }
  return button;
}

function required<T extends Element>(element: T | null, label: string): T {
  if (!element) {
    throw new Error(`Missing ${label}`);
  }
  return element;
}

function createTestRoot() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
