// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductNew } from "./ProductNew.js";
import * as productNew from "./ProductNew.js";
import { ApiError, type FormaApiClient, type Language, type Product, type StyleMetadata } from "../api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const styles: StyleMetadata[] = [
  {
    name: "linear",
    description: "Focused tool UI",
    design_md_path: "styles/linear/DESIGN.md",
    variables: {
      primary: "#111827",
      background: "#ffffff",
      "text-primary": "#111827",
      "font-heading": "Inter",
      "font-body": "Inter",
      "border-radius": "8px",
      "spacing-unit": "8px"
    }
  },
  {
    name: "retail",
    description: "Retail checkout UI",
    design_md_path: "styles/retail/DESIGN.md",
    variables: {
      primary: "#0f766e",
      background: "#ffffff",
      "text-primary": "#111827",
      "font-heading": "Inter",
      "font-body": "Inter",
      "border-radius": "8px",
      "spacing-unit": "8px"
    }
  }
];

const createdProduct: Product = {
  id: "P-123abc",
  name: "Checkout App",
  description: "Mobile checkout workbench"
};

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
  vi.restoreAllMocks();
});

describe("deriveDefaultLanguage", () => {
  it("keeps the current default only when it is still selected", () => {
    const deriveDefaultLanguage = (
      productNew as {
        deriveDefaultLanguage?: (selected: Language[], current?: Language) => Language | "";
      }
    ).deriveDefaultLanguage;

    expect(deriveDefaultLanguage).toBeTypeOf("function");
    expect(deriveDefaultLanguage?.([], "en")).toBe("");
    expect(deriveDefaultLanguage?.(["zh-CN", "en"], "zh-CN")).toBe("zh-CN");
    expect(deriveDefaultLanguage?.(["zh-CN", "ja"], "en")).toBe("zh-CN");
    expect(deriveDefaultLanguage?.(["zh-CN", "en"], undefined)).toBe("en");
  });
});

describe("ProductNew", () => {
  it("keeps submit disabled until required product configuration is complete", async () => {
    const client = createClient();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductNew client={client} navigate={vi.fn()} />);
      await flushPromises();
    });

    const submit = required(container.querySelector<HTMLButtonElement>('button[type="submit"]'), "submit button");
    expect(submit.disabled).toBe(true);

    await act(async () => {
      setInputValue(required(container.querySelector<HTMLInputElement>('input[name="name"]'), "name input"), "Checkout App");
      setInputValue(
        required(container.querySelector<HTMLTextAreaElement>('textarea[name="description"]'), "description textarea"),
        "Mobile checkout workbench"
      );
      setSelectValue(required(container.querySelector<HTMLSelectElement>('select[name="platform"]'), "platform select"), "web");
      setSelectValue(required(container.querySelector<HTMLSelectElement>('select[name="style"]'), "style select"), "linear");
      await flushPromises();
    });

    expect(submit.disabled).toBe(true);

    await act(async () => {
      required(container.querySelector<HTMLInputElement>('input[name="languages"][value="en"]'), "English language input").click();
      await flushPromises();
    });

    expect(submit.disabled).toBe(false);
  });

  it("creates then configures the product before navigating", async () => {
    const navigate = vi.fn();
    const client = createClient();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductNew client={client} navigate={navigate} />);
      await flushPromises();
    });

    await act(async () => {
      setInputValue(required(container.querySelector<HTMLInputElement>('input[name="name"]'), "name input"), " Checkout App ");
      setInputValue(
        required(container.querySelector<HTMLTextAreaElement>('textarea[name="description"]'), "description textarea"),
        " Mobile checkout workbench "
      );
      setSelectValue(required(container.querySelector<HTMLSelectElement>('select[name="platform"]'), "platform select"), "web");
      setSelectValue(required(container.querySelector<HTMLSelectElement>('select[name="style"]'), "style select"), "linear");
      required(container.querySelector<HTMLInputElement>('input[name="languages"][value="en"]'), "English language input").click();
      required(container.querySelector<HTMLInputElement>('input[name="languages"][value="zh-CN"]'), "Simplified Chinese language input").click();
      await flushPromises();
    });

    const defaultLanguage = required(
      container.querySelector<HTMLSelectElement>('select[name="default_language"]'),
      "default language select"
    );

    await act(async () => {
      setSelectValue(defaultLanguage, "zh-CN");
      container.querySelector<HTMLFormElement>("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushPromises();
    });

    expect(client.createProduct).toHaveBeenCalledWith({
      name: "Checkout App",
      description: "Mobile checkout workbench"
    });
    expect(client.configureProduct).toHaveBeenCalledWith("P-123abc", {
      platform: "web",
      style: "linear",
      languages: ["en", "zh-CN"],
      default_language: "zh-CN"
    });
    expect(navigate).toHaveBeenCalledWith("/products/P-123abc");
  });

  it("shows an error and does not navigate when product configuration fails after creation", async () => {
    const navigate = vi.fn();
    const client = {
      ...createClient(),
      configureProduct: vi.fn(async () => {
        throw new ApiError("CONFIG_FAILED", "Style configuration failed", {}, 400);
      }),
      deleteProduct: vi.fn()
    };
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductNew client={client} navigate={navigate} />);
      await flushPromises();
    });

    await fillValidProductForm(container);

    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushPromises();
    });

    expect(client.createProduct).toHaveBeenCalledTimes(1);
    expect(client.createProduct).toHaveBeenCalledWith({
      name: "Checkout App",
      description: "Mobile checkout workbench"
    });
    expect(client.configureProduct).toHaveBeenCalledTimes(1);
    expect(client.configureProduct).toHaveBeenCalledWith("P-123abc", {
      platform: "web",
      style: "linear",
      languages: ["en"],
      default_language: "en"
    });
    expect(client.deleteProduct).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("CONFIG_FAILED - Style configuration failed");
  });

  it("retries configuration for the created product instead of creating another product", async () => {
    const navigate = vi.fn();
    const client = createClient();
    client.configureProduct.mockRejectedValueOnce(new ApiError("CONFIG_FAILED", "Style configuration failed", {}, 400));
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductNew client={client} navigate={navigate} />);
      await flushPromises();
    });

    await fillValidProductForm(container);

    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushPromises();
    });

    expect(container.textContent).toContain("CONFIG_FAILED - Style configuration failed");
    expect(navigate).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushPromises();
    });

    expect(client.createProduct).toHaveBeenCalledTimes(1);
    expect(client.configureProduct).toHaveBeenCalledTimes(2);
    expect(client.configureProduct).toHaveBeenNthCalledWith(1, "P-123abc", {
      platform: "web",
      style: "linear",
      languages: ["en"],
      default_language: "en"
    });
    expect(client.configureProduct).toHaveBeenNthCalledWith(2, "P-123abc", {
      platform: "web",
      style: "linear",
      languages: ["en"],
      default_language: "en"
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/products/P-123abc");
  });

  it("disables style selection and submit when styles fail to load", async () => {
    const client = createClient();
    client.listStyles.mockRejectedValueOnce(new Error("style catalog unavailable"));
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductNew client={client} navigate={vi.fn()} />);
      await flushPromises();
    });

    expect(required(container.querySelector<HTMLSelectElement>('select[name="style"]'), "style select").disabled).toBe(true);
    expect(required(container.querySelector<HTMLButtonElement>('button[type="submit"]'), "submit button").disabled).toBe(true);
    expect(container.textContent).toContain("style catalog unavailable");
  });

  it("hides default language when a single language is selected", async () => {
    const client = createClient();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductNew client={client} navigate={vi.fn()} />);
      await flushPromises();
    });

    await act(async () => {
      required(container.querySelector<HTMLInputElement>('input[name="languages"][value="en"]'), "English language input").click();
      await flushPromises();
    });

    expect(container.querySelector('select[name="default_language"]')).toBeNull();
  });

  it("shows default language for multiple languages and allows manual override", async () => {
    const client = createClient();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<ProductNew client={client} navigate={vi.fn()} />);
      await flushPromises();
    });

    await act(async () => {
      required(container.querySelector<HTMLInputElement>('input[name="languages"][value="en"]'), "English language input").click();
      required(container.querySelector<HTMLInputElement>('input[name="languages"][value="zh-CN"]'), "Simplified Chinese language input").click();
      await flushPromises();
    });

    const defaultLanguage = required(
      container.querySelector<HTMLSelectElement>('select[name="default_language"]'),
      "default language select"
    );
    expect(defaultLanguage.value).toBe("en");

    await act(async () => {
      setSelectValue(defaultLanguage, "zh-CN");
      await flushPromises();
    });

    expect(defaultLanguage.value).toBe("zh-CN");
  });
});

function createClient() {
  return {
    createProduct: vi.fn(async () => createdProduct),
    configureProduct: vi.fn(async (_productId, input) => ({
      ...createdProduct,
      platform: input.platform,
      style: styles.find((style) => style.name === input.style),
      languages: input.languages,
      default_language: input.default_language
    })),
    listStyles: vi.fn(async () => styles)
  } satisfies Pick<FormaApiClient, "configureProduct" | "createProduct" | "listStyles">;
}

function createTestRoot() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}

async function fillValidProductForm(container: HTMLElement) {
  await act(async () => {
    setInputValue(required(container.querySelector<HTMLInputElement>('input[name="name"]'), "name input"), " Checkout App ");
    setInputValue(
      required(container.querySelector<HTMLTextAreaElement>('textarea[name="description"]'), "description textarea"),
      " Mobile checkout workbench "
    );
    setSelectValue(required(container.querySelector<HTMLSelectElement>('select[name="platform"]'), "platform select"), "web");
    setSelectValue(required(container.querySelector<HTMLSelectElement>('select[name="style"]'), "style select"), "linear");
    required(container.querySelector<HTMLInputElement>('input[name="languages"][value="en"]'), "English language input").click();
    await flushPromises();
  });
}

function required<T extends Element>(element: T | null, label: string): T {
  if (!element) {
    throw new Error(`Missing ${label}`);
  }
  return element;
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
