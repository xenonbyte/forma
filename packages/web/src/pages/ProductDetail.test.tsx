// @vitest-environment happy-dom

import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as productDetail from "./ProductDetail.js";
import { ProductDetail } from "./ProductDetail.js";
import { ApiError, type FormaApiClient, type Product, type ProductBaseline, type RequirementWithDocument, type StyleMetadata } from "../api.js";
import { LocaleProvider, useLocale } from "../LocaleContext.js";
import { localeStorageKey, setLocale as setAppLocale } from "../i18n.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const style: StyleMetadata = {
  name: "linear",
  description: "Focused tool UI",
  design_md_path: "styles/linear/DESIGN.md",
  tokens_css_path: "styles/linear/tokens.css",
  components_html_path: "styles/linear/components.html"
};

const configuredProduct: Product = {
  id: "P-123abc",
  name: "Checkout App",
  description: "Mobile checkout workbench",
  platform: "web",
  brand_style: style.name,
  languages: ["en"],
  default_language: "en",
};

const incompleteProduct: Product = {
  id: "P-123abc",
  name: "Checkout App",
  description: "Mobile checkout workbench"
};

const baseline: ProductBaseline = {
  product_id: "P-123abc",
  pages: [],
  navigation: []
};

const activeRequirement: RequirementWithDocument = {
  id: "R-12345678",
  product_id: "P-123abc",
  title: "Checkout update",
  status: "active",
  created_at: "2026-05-17T00:00:00.000Z",
  updated_at: "2026-05-17T01:00:00.000Z",
  pages: [],
  navigation: [],
  document_md: "# Checkout update"
};

const roots: Root[] = [];
const containers: HTMLElement[] = [];

beforeEach(() => {
  window.localStorage.clear();
  setAppLocale("en");
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  for (const container of containers.splice(0)) {
    container.remove();
  }
  vi.restoreAllMocks();
  window.localStorage.clear();
  setAppLocale("en");
});

describe("ProductDetailSummaryPanels", () => {
  it("renders baseline page and navigation counts without requiring the whole page", () => {
    const ProductDetailSummaryPanels = (
      productDetail as {
        ProductDetailSummaryPanels?: (props: {
          actionError: null;
          baselineState: { baseline: ProductBaseline; status: "ready" };
          productId: string;
          requirementCount: number;
        }) => ReactNode;
      }
    ).ProductDetailSummaryPanels;

    expect(ProductDetailSummaryPanels).toBeTypeOf("function");
    if (!ProductDetailSummaryPanels) {
      return;
    }

    const html = renderToStaticMarkup(
      <ProductDetailSummaryPanels
        actionError={null}
        baselineState={{
          baseline: {
            product_id: "P-123abc",
            pages: [
              { id: "home", name: "Home", features: "", copy: [], fields: "", interactions: "", source_requirements: ["R-12345678"] },
              { id: "checkout", name: "Checkout", features: "", copy: [], fields: "", interactions: "", source_requirements: ["R-12345678"] }
            ],
            navigation: [{ from: "home", to: "checkout" }]
          },
          status: "ready"
        }}
        productId="P-123abc"
        requirementCount={1}
      />
    );

    expect(html).toContain("2 pages");
    expect(html).toContain("1 navigation");
    expect(html).toContain('href="/products/P-123abc/baseline"');
  });

  it("scrolls and focuses a matching hash target", () => {
    const focusHashTarget = (
      productDetail as {
        focusHashTarget?: (
          hash: string,
          root: { getElementById: (id: string) => Pick<HTMLElement, "focus" | "scrollIntoView"> | null }
        ) => boolean;
      }
    ).focusHashTarget;
    const target = {
      focus: vi.fn(),
      scrollIntoView: vi.fn()
    };
    const root = {
      getElementById: vi.fn(() => target)
    };

    expect(focusHashTarget).toBeTypeOf("function");
    expect(focusHashTarget?.("#new-requirement", root)).toBe(true);
    expect(root.getElementById).toHaveBeenCalledWith("new-requirement");
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});

describe("ProductDetail", () => {
  it("renders skeleton detail layout while loading instead of plain loading copy", async () => {
    const client = createClient({ product: configuredProduct, requirements: [] });
    client.getProduct.mockImplementationOnce(() => new Promise<Product>(() => {}));
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductDetail client={client} params={{ productId: "P-123abc" }} />);
      await flushPromises();
    });

    expect(container.querySelector('[data-skeleton="detail"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Loading product record and requirement history.");
  });

  it("updates visible static text when the locale switches to Chinese", async () => {
    const client = createClient({ product: configuredProduct, requirements: [] });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <LocaleProvider>
          <LocaleSwitch />
          <ProductDetail client={client} params={{ productId: "P-123abc" }} />
        </LocaleProvider>
      );
      await flushPromises();
    });

    expect(container.textContent).toContain("Product configuration");
    expect(container.textContent).toContain("New requirement");

    await act(async () => {
      required(container.querySelector<HTMLButtonElement>("[data-locale-zh]"), "Chinese locale button").click();
      await flushPromises();
    });

    expect(window.localStorage.getItem(localeStorageKey)).toBe("zh");
    expect(container.textContent).toContain("产品配置");
    expect(container.textContent).toContain("新建需求");
    expect(container.textContent).not.toContain("Product configuration");
    expect(container.textContent).not.toContain("New requirement");
  });

  it("renders empty requirement action and inline illustration markup", async () => {
    const client = createClient({ product: configuredProduct, requirements: [] });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductDetail client={client} params={{ productId: "P-123abc" }} />);
      await flushPromises();
    });

    expect(container.querySelector('[data-empty-illustration="requirements"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Requirement empty state"]')).not.toBeNull();
    expect(container.querySelector('a[href="#new-requirement"]')?.textContent).toContain("Create requirement");
  });

  it("creates title-only requirements and reloads the requirement list", async () => {
    const client = createClient({ product: configuredProduct, requirements: [] });
    client.listRequirements.mockResolvedValueOnce([]).mockResolvedValueOnce([activeRequirement]);
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductDetail client={client} params={{ productId: "P-123abc" }} />);
      await flushPromises();
    });

    const form = required(container.querySelector<HTMLFormElement>("#new-requirement form"), "new requirement form");
    expect(form.querySelectorAll("textarea")).toHaveLength(0);

    await act(async () => {
      setInputValue(required(form.querySelector<HTMLInputElement>('input[name="requirement_title"]'), "requirement title input"), " Checkout update ");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushPromises();
    });

    expect(client.createEmptyRequirement).toHaveBeenCalledWith("P-123abc", { title: "Checkout update" });
    expect(client.createRequirement).not.toHaveBeenCalled();
    expect(client.listRequirements).toHaveBeenCalledTimes(2);
    expect(required(form.querySelector<HTMLInputElement>('input[name="requirement_title"]'), "requirement title input").value).toBe("");
  });

  it("renders a completion form for missing product configuration and submits it", async () => {
    const client = createClient({ product: incompleteProduct, requirements: [] });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductDetail client={client} params={{ productId: "P-123abc" }} />);
      await flushPromises();
    });

    const form = required(container.querySelector<HTMLFormElement>('form[data-product-config-form="true"]'), "product configuration form");
    expect(client.listStyles).toHaveBeenCalledTimes(1);

    await act(async () => {
      setSelectValue(required(form.querySelector<HTMLSelectElement>('select[name="platform"]'), "platform select"), "web");
      setSelectValue(required(form.querySelector<HTMLSelectElement>('select[name="style"]'), "style select"), "linear");
      required(form.querySelector<HTMLInputElement>('input[name="languages"][value="en"]'), "English language input").click();
      required(form.querySelector<HTMLInputElement>('input[name="languages"][value="zh-CN"]'), "Simplified Chinese language input").click();
      await flushPromises();
    });

    await act(async () => {
      setSelectValue(required(form.querySelector<HTMLSelectElement>('select[name="default_language"]'), "default language select"), "zh-CN");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushPromises();
    });

    expect(client.configureProduct).toHaveBeenCalledWith("P-123abc", {
      platform: "web",
      brand_style: "linear",
      languages: ["en", "zh-CN"],
      default_language: "zh-CN"
    });
  });

  it("keeps product configuration retry enabled after a submit failure", async () => {
    const client = createClient({ product: incompleteProduct, requirements: [] });
    client.configureProduct.mockRejectedValueOnce(new ApiError("CONFIG_FAILED", "Style configuration failed", {}, 400));
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductDetail client={client} params={{ productId: "P-123abc" }} />);
      await flushPromises();
    });

    const form = required(container.querySelector<HTMLFormElement>('form[data-product-config-form="true"]'), "product configuration form");

    await fillProductConfigForm(form);

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushPromises();
    });

    expect(container.textContent).toContain("CONFIG_FAILED - Style configuration failed");
    expect(required(form.querySelector<HTMLButtonElement>('button[type="submit"]'), "submit button").disabled).toBe(false);

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushPromises();
    });

    expect(client.configureProduct).toHaveBeenCalledTimes(2);
    expect(client.configureProduct).toHaveBeenNthCalledWith(2, "P-123abc", {
      platform: "web",
      brand_style: "linear",
      languages: ["en", "zh-CN"],
      default_language: "zh-CN"
    });
  });

  it("deletes the product and passes cleanup warnings to navigation", async () => {
    const client = createClient({ product: configuredProduct, requirements: [] });
    const onNavigate = vi.fn();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductDetail client={client} onNavigate={onNavigate} params={{ productId: "P-123abc" }} />);
      await flushPromises();
    });

    expect(container.textContent).toContain("Danger zone");

    await act(async () => {
      required(container.querySelector<HTMLButtonElement>('[data-product-detail-delete="true"]'), "detail delete action").click();
      await flushPromises();
    });

    const input = required(container.querySelector<HTMLInputElement>('input[name="confirm_product_id"]'), "confirmation input");
    await act(async () => {
      setInputValue(input, "P-123abc");
      required(container.querySelector<HTMLButtonElement>('[data-confirm-delete-final="true"]'), "final delete button").click();
      await flushPromises();
    });

    expect(client.deleteProduct).toHaveBeenCalledWith("P-123abc", { confirm_product_id: input.value });
    expect(onNavigate).toHaveBeenCalledWith("/products", {
      cleanupPending: true,
      productId: "P-123abc",
      recoveryWarnings: ["Recovered orphaned requirement index"],
      sessionCleared: true
    });
  });

  it("shows product deletion errors without navigating", async () => {
    const client = createClient({ product: configuredProduct, requirements: [] });
    client.deleteProduct.mockRejectedValueOnce(new ApiError("DELETE_FAILED", "Deletion denied", {}, 409));
    const onNavigate = vi.fn();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductDetail client={client} onNavigate={onNavigate} params={{ productId: "P-123abc" }} />);
      await flushPromises();
    });

    await act(async () => {
      required(container.querySelector<HTMLButtonElement>('[data-product-detail-delete="true"]'), "detail delete action").click();
      await flushPromises();
    });

    await act(async () => {
      setInputValue(required(container.querySelector<HTMLInputElement>('input[name="confirm_product_id"]'), "confirmation input"), "P-123abc");
      required(container.querySelector<HTMLButtonElement>('[data-confirm-delete-final="true"]'), "final delete button").click();
      await flushPromises();
    });

    expect(container.textContent).toContain("DELETE_FAILED - Deletion denied");
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

function createClient({ product, requirements }: { product: Product; requirements: RequirementWithDocument[] }) {
  return {
    archiveRequirement: vi.fn(async (_productId, requirementId) => requirements.find((requirement) => requirement.id === requirementId) ?? activeRequirement),
    configureProduct: vi.fn(async (_productId, input) => ({
      ...product,
      platform: input.platform,
      brand_style: input.brand_style,
      languages: input.languages,
      default_language: input.default_language
    })),
    createEmptyRequirement: vi.fn(async (_productId, input) => ({
      ...activeRequirement,
      title: input.title
    })),
    createRequirement: vi.fn(async () => activeRequirement),
    deleteProduct: vi.fn(async () => ({
      product_id: product.id,
      deleted: true as const,
      session_cleared: true,
      cleanup_pending: true,
      recovery_warnings: ["Recovered orphaned requirement index"]
    })),
    getBaseline: vi.fn(async () => baseline),
    getProduct: vi.fn(async () => product),
    listRequirements: vi.fn(async () => requirements),
    listStyles: vi.fn(async () => [style])
  } satisfies Pick<
    FormaApiClient,
    | "archiveRequirement"
    | "configureProduct"
    | "createEmptyRequirement"
    | "createRequirement"
    | "deleteProduct"
    | "getBaseline"
    | "getProduct"
    | "listRequirements"
    | "listStyles"
  >;
}

function createTestRoot() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}

function LocaleSwitch() {
  const { setLocale } = useLocale();
  return (
    <button data-locale-zh="" onClick={() => setLocale("zh")} type="button">
      中
    </button>
  );
}

function required<T extends Element>(element: T | null, label: string): T {
  if (!element) {
    throw new Error(`Missing ${label}`);
  }
  return element;
}

async function fillProductConfigForm(form: HTMLFormElement) {
  await act(async () => {
    setSelectValue(required(form.querySelector<HTMLSelectElement>('select[name="platform"]'), "platform select"), "web");
    setSelectValue(required(form.querySelector<HTMLSelectElement>('select[name="style"]'), "style select"), "linear");
    required(form.querySelector<HTMLInputElement>('input[name="languages"][value="en"]'), "English language input").click();
    required(form.querySelector<HTMLInputElement>('input[name="languages"][value="zh-CN"]'), "Simplified Chinese language input").click();
    await flushPromises();
  });

  await act(async () => {
    setSelectValue(required(form.querySelector<HTMLSelectElement>('select[name="default_language"]'), "default language select"), "zh-CN");
    await flushPromises();
  });
}

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  setNativeValue(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  setNativeValue(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function setNativeValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
