// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../LocaleContext.js";
import { setLocale } from "../i18n.js";
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

const testNavItems = [
  { href: "/products", label: "Products", meta: "Sessions and requirements" },
  { href: "/styles", label: "Styles", meta: "Design libraries" },
  { href: "/settings", label: "Settings", meta: "Preferences" },
];

describe("Layout shell", () => {
  it("renders clickable header breadcrumbs", async () => {
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <LocaleProvider>
          <Layout
            breadcrumbs={[
              { href: "/products", label: "Product list" },
              { href: "/products/P-123abc", label: "Checkout App" },
              { label: "Baseline" },
            ]}
            currentPathname="/products/P-123abc/baseline"
            navItems={testNavItems}
            routeContext="Baseline"
            title="Baseline"
          >
            <p>Loaded</p>
          </Layout>
        </LocaleProvider>,
      );
      await flushPromises();
    });

    const breadcrumb = required(container.querySelector<HTMLElement>('nav[aria-label="Breadcrumb"]'), "breadcrumb nav");
    expect(breadcrumb.textContent).toContain("Product list");
    expect(breadcrumb.textContent).toContain("Checkout App");
    expect(
      required(breadcrumb.querySelector<HTMLAnchorElement>('a[href="/products"]'), "products breadcrumb").textContent,
    ).toBe("Product list");
    expect(
      required(breadcrumb.querySelector<HTMLAnchorElement>('a[href="/products"]'), "products breadcrumb").className,
    ).toContain("text-amber-600");
    expect(
      required(breadcrumb.querySelector<HTMLAnchorElement>('a[href="/products/P-123abc"]'), "product breadcrumb")
        .textContent,
    ).toBe("Checkout App");
    expect(
      required(breadcrumb.querySelector<HTMLAnchorElement>('a[href="/products/P-123abc"]'), "product breadcrumb")
        .className,
    ).toContain("text-amber-600");
    expect(required(breadcrumb.querySelector("h1"), "current breadcrumb").textContent).toBe("Baseline");
  });

  it("renders header actions and settings nav without a global language switcher", async () => {
    setLocale("zh");
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <LocaleProvider>
          <Layout
            currentPathname="/settings"
            headerAction={<a href="/products/new">新建产品</a>}
            navItems={testNavItems}
            routeContext="Settings"
            title="Settings"
          >
            <p>Loaded</p>
          </Layout>
        </LocaleProvider>,
      );
      await flushPromises();
    });

    const settingsLink = required(
      container.querySelector<HTMLAnchorElement>('nav a[href="/settings"]'),
      "settings nav link",
    );

    expect(settingsLink.getAttribute("aria-current")).toBe("page");
    expect(settingsLink.getAttribute("aria-label")).toBe("设置");
    expect(settingsLink.getAttribute("title")).toBe("设置");
    expect(settingsLink.textContent).toContain("设置");
    expect(container.textContent).toContain("新建产品");
    expect(required(container.querySelector("h1"), "route title").textContent).toBe("设置");
    expect(container.querySelector('[aria-label="Language"]')).toBeNull();
  });

  it("renders active nav accent while keeping icon labels accessible", async () => {
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <LocaleProvider>
          <Layout currentPathname="/products/P-123abc" navItems={testNavItems} routeContext="Products" title="Products">
            <p>Loaded</p>
          </Layout>
        </LocaleProvider>,
      );
      await flushPromises();
    });

    const productsLink = required(
      container.querySelector<HTMLAnchorElement>('nav a[href="/products"]'),
      "products nav link",
    );
    const stylesLink = required(container.querySelector<HTMLAnchorElement>('nav a[href="/styles"]'), "styles nav link");
    const settingsLink = required(
      container.querySelector<HTMLAnchorElement>('nav a[href="/settings"]'),
      "settings nav link",
    );

    expect(productsLink.getAttribute("aria-current")).toBe("page");
    expect(productsLink.querySelector('[data-nav-active-accent="true"]')).not.toBeNull();
    expect(productsLink.getAttribute("aria-label")).toBe("Product list");
    expect(productsLink.getAttribute("title")).toBe("Product list");
    expect(productsLink.querySelector("svg")).not.toBeNull();
    expect(productsLink.textContent).toContain("Product list");
    expect(productsLink.textContent).not.toContain("Sessions and requirements");
    expect(stylesLink.querySelector("svg")).not.toBeNull();
    expect(stylesLink.getAttribute("aria-label")).toBe("Style templates");
    expect(stylesLink.getAttribute("title")).toBe("Style templates");
    expect(stylesLink.textContent).toContain("Style templates");
    expect(stylesLink.textContent).not.toContain("Design libraries");
    expect(settingsLink.querySelector("svg")).not.toBeNull();
    expect(settingsLink.getAttribute("aria-label")).toBe("Settings");
    expect(settingsLink.textContent).toContain("Settings");
    expect(required(container.querySelector("aside"), "sidebar").className).toContain("md:w-56");
    expect(
      required(container.querySelector<HTMLAnchorElement>('a[href="/products"]'), "brand link").className,
    ).toContain("text-[21px]");
    expect(
      required(container.querySelector<HTMLAnchorElement>('a[href="/products"]'), "brand link").className,
    ).toContain("font-bold");
    expect(container.textContent).not.toContain("Admin workbench");
    expect(container.textContent).not.toContain("Client shell");
    expect(container.textContent).not.toContain("Idle");
    expect(required(container.querySelector("aside"), "sidebar").className).not.toContain("border-r");
    expect(required(container.querySelector("aside"), "sidebar").className).not.toContain("border-zinc-300");
    expect(required(container.querySelector("header"), "header").className).toContain("shadow-[0_1px_3px");
    expect(required(container.querySelector("main"), "main").className).toContain("page-fade-in");
  });

  it("collapses the sidebar to an icon rail", async () => {
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <LocaleProvider>
          <Layout currentPathname="/styles" navItems={testNavItems} routeContext="Styles" title="Styles">
            <p>Loaded</p>
          </Layout>
        </LocaleProvider>,
      );
      await flushPromises();
    });

    const aside = required(container.querySelector("aside"), "sidebar");
    const nav = required(container.querySelector("nav"), "primary nav");
    const toggle = required(
      container.querySelector<HTMLButtonElement>('[data-sidebar-toggle="true"]'),
      "sidebar toggle",
    );
    const stylesLink = required(container.querySelector<HTMLAnchorElement>('nav a[href="/styles"]'), "styles nav link");

    expect(aside.getAttribute("data-sidebar-collapsed")).toBe("false");
    expect(nav.className).toContain("md:justify-start");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Collapse sidebar");
    expect(stylesLink.className).toContain("bg-white");
    expect(stylesLink.textContent).toContain("Style templates");

    await act(async () => {
      toggle.click();
      await flushPromises();
    });

    expect(aside.getAttribute("data-sidebar-collapsed")).toBe("true");
    expect(aside.className).toContain("md:w-[76px]");
    expect(nav.className).toContain("md:justify-center");
    expect(nav.className).toContain("md:justify-items-center");
    expect(nav.className).not.toContain("md:justify-start");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Expand sidebar");
    expect(stylesLink.className).toContain("md:bg-transparent");
    expect(stylesLink.className).toContain("md:ring-0");
    expect(stylesLink.className).toContain("md:shadow-none");
    expect(stylesLink.className).toContain("h-10");
    expect(stylesLink.className).toContain("w-10");
    expect(stylesLink.querySelector('[data-nav-active-accent="true"]')).not.toBeNull();
    expect(required(stylesLink.querySelector("span:last-child"), "styles label").className).toContain("md:hidden");
  });
});

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
