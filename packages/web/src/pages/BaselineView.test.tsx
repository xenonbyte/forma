// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider, useLocale } from "../LocaleContext.js";
import * as baselineView from "./BaselineView.js";
import { BaselineView } from "./BaselineView.js";
import type { FormaApiClient, PageCopyPayload, ProductBaseline } from "../api.js";
import { localeStorageKey, setLocale } from "../i18n.js";

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
  window.localStorage.clear();
  setLocale("en");
});

describe("BaselineContent", () => {
  const BaselineContent = (
    baselineView as {
      BaselineContent?: (props: {
        baseline: ProductBaseline;
        client: Pick<FormaApiClient, "getPageCopy">;
        productId: string;
      }) => ReactNode;
    }
  ).BaselineContent;

  it("renders preview and annotations links for each baseline page", () => {
    expect(BaselineContent).toBeTypeOf("function");
    if (!BaselineContent) {
      return;
    }

    const html = renderToStaticMarkup(
      <BaselineContent
        baseline={{
          product_id: "P-123abc",
          pages: [
            {
              id: "checkout",
              name: "Checkout",
              features: "Checkout flow",
              copy: [],
              fields: "",
              interactions: "",
              source_requirements: ["R-12345678"]
            }
          ],
          navigation: []
        }}
        client={createClient({ baseline: emptyBaseline })}
        productId="P-123abc"
      />
    );

    expect(html).toContain("Preview");
    expect(html).toContain("Annotations");
    expect(html).toContain('href="/api/products/P-123abc/baseline/pages/checkout/image"');
    expect(html).toContain('href="/api/products/P-123abc/baseline/pages/checkout/annotations"');
  });

  it("keeps copy content in the middle column and sources in the right rail", () => {
    expect(BaselineContent).toBeTypeOf("function");
    if (!BaselineContent) {
      return;
    }

    const html = renderToStaticMarkup(<BaselineContent baseline={baselineFixture} client={createClient({ baseline: baselineFixture })} productId="P-123abc" />);

    expect(html).toContain('data-page-content="checkout"');
    expect(html).toContain('data-page-rail="checkout"');
    expect(html).toContain('data-copy-table="checkout"');
    expect(html.indexOf('data-page-content="checkout"')).toBeLessThan(html.indexOf('data-copy-table="checkout"'));
    expect(html.indexOf('data-copy-table="checkout"')).toBeLessThan(html.indexOf('data-page-rail="checkout"'));
  });

  it("defaults to the list tab with functional page content", () => {
    expect(BaselineContent).toBeTypeOf("function");
    if (!BaselineContent) {
      return;
    }

    const html = renderToStaticMarkup(<BaselineContent baseline={baselineFixture} client={createClient({ baseline: baselineFixture })} productId="P-123abc" />);

    expect(html).toContain("Functional pages");
    expect(html).toContain("Checkout flow");
    expect(html).toContain("Payment terms");
    expect(html).toContain("Continue");
    expect(html).toContain("Legacy return");
    expect(html).not.toContain("Navigation graph");
  });

  it("renders the graph tab after tab selection", async () => {
    expect(BaselineContent).toBeTypeOf("function");
    if (!BaselineContent) {
      return;
    }

    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<BaselineContent baseline={baselineFixture} client={createClient({ baseline: baselineFixture })} productId="P-123abc" />);
      await flushPromises();
    });

    const graphTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Graph");
    expect(graphTab).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      graphTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    expect(container.textContent).toContain("Navigation graph");
    expect(container.textContent).toContain("Checkout");
  });

  it("updates static baseline text when the persisted locale changes", async () => {
    expect(BaselineContent).toBeTypeOf("function");
    if (!BaselineContent) {
      return;
    }

    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <LocaleProvider>
          <LocaleSwitch />
          <BaselineContent baseline={baselineFixture} client={createClient({ baseline: baselineFixture })} productId="P-123abc" />
        </LocaleProvider>
      );
      await flushPromises();
    });

    expect(container.textContent).toContain("Functional pages");
    expect(container.textContent).toContain("Sources");

    await act(async () => {
      required(container.querySelector<HTMLButtonElement>("[data-locale-zh]"), "Chinese locale button").click();
      await flushPromises();
    });

    expect(window.localStorage.getItem(localeStorageKey)).toBe("zh");
    expect(container.textContent).toContain("功能页面");
    expect(container.textContent).toContain("来源");
    expect(container.textContent).not.toContain("Functional pages");
  });
});

describe("BaselineView multilingual copy", () => {
  it("fetches baseline and page copy for each rendered baseline page", async () => {
    const baseline: ProductBaseline = {
      product_id: "P-123abc",
      pages: [
        pageFixture({ id: "checkout", name: "Checkout" }),
        pageFixture({ id: "home", name: "Home" })
      ],
      navigation: []
    };
    const client = createClient({ baseline });
    const { root } = createTestRoot();

    await act(async () => {
      root.render(<BaselineView client={client} params={{ productId: "P-123abc" }} />);
      await flushPromises();
    });

    expect(client.getBaseline).toHaveBeenCalledWith("P-123abc");
    expect(client.getPageCopy).toHaveBeenCalledTimes(2);
    expect(client.getPageCopy).toHaveBeenCalledWith("P-123abc", "checkout");
    expect(client.getPageCopy).toHaveBeenCalledWith("P-123abc", "home");
  });

  it("renders default copy and translation language values in a structured table", async () => {
    const baseline: ProductBaseline = {
      product_id: "P-123abc",
      pages: [pageFixture({ id: "checkout", name: "Checkout" })],
      navigation: []
    };
    const client = createClient({
      baseline,
      pageCopies: {
        checkout: {
          page_id: "checkout",
          default_language_copy: [
            { context: "title", text: "Checkout" },
            { context: "cta", text: "Pay now" }
          ],
          translations: [
            { context: "title", texts: { en: "Checkout", "zh-CN": "结账" } },
            { context: "cta", texts: { en: "Pay now", "zh-CN": "立即支付" } }
          ]
        }
      }
    });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<BaselineView client={client} params={{ productId: "P-123abc" }} />);
      await flushPromises();
    });

    const copyTable = required(container.querySelector<HTMLTableElement>('table[data-copy-table="checkout"]'), "copy table");
    expect(copyTable.textContent).toContain("Context");
    expect(copyTable.textContent).toContain("Default copy");
    expect(copyTable.textContent).toContain("zh-CN");
    expect(copyTable.textContent).toContain("title");
    expect(copyTable.textContent).toContain("Checkout");
    expect(copyTable.textContent).toContain("结账");
    expect(copyTable.textContent).toContain("Pay now");
    expect(copyTable.textContent).toContain("立即支付");
  });

  it("flags outdated translation entries", async () => {
    const baseline: ProductBaseline = {
      product_id: "P-123abc",
      pages: [pageFixture({ id: "checkout", name: "Checkout" })],
      navigation: []
    };
    const client = createClient({
      baseline,
      pageCopies: {
        checkout: {
          page_id: "checkout",
          default_language_copy: [{ context: "cta", text: "Pay now" }],
          translations: [{ context: "cta", outdated: true, texts: { en: "Pay now", "zh-CN": "立即支付" } }]
        }
      }
    });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<BaselineView client={client} params={{ productId: "P-123abc" }} />);
      await flushPromises();
    });

    const outdatedRow = required(container.querySelector<HTMLElement>('[data-outdated-copy="true"]'), "outdated copy row");
    expect(outdatedRow.textContent).toContain("cta");
    expect(outdatedRow.textContent).toContain("Outdated");
    expect(outdatedRow.textContent).toContain("立即支付");
  });

  it("falls back to baseline page copy when the copy route returns empty arrays", async () => {
    const baseline: ProductBaseline = {
      product_id: "P-123abc",
      pages: [
        pageFixture({
          id: "checkout",
          name: "Checkout",
          copy: [{ context: "title", text: "结账" }]
        })
      ],
      navigation: []
    };
    const client = createClient({
      baseline,
      pageCopies: {
        checkout: {
          page_id: "checkout",
          default_language_copy: [],
          translations: []
        }
      }
    });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<BaselineView client={client} params={{ productId: "P-123abc" }} />);
      await flushPromises();
    });

    expect(container.textContent).toContain("title");
    expect(container.textContent).toContain("结账");
  });

  it("shows baseline page copy and an error notice when the copy route fails", async () => {
    const baseline: ProductBaseline = {
      product_id: "P-123abc",
      pages: [
        pageFixture({
          id: "checkout",
          name: "Checkout",
          copy: [{ context: "title", text: "结账" }]
        })
      ],
      navigation: []
    };
    const client = createClient({
      baseline,
      pageCopyErrors: {
        checkout: new Error("copy route unavailable")
      }
    });
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<BaselineView client={client} params={{ productId: "P-123abc" }} />);
      await flushPromises();
    });

    expect(container.textContent).toContain("title");
    expect(container.textContent).toContain("结账");
    expect(container.textContent).toContain("CLIENT_ERROR - Copy unavailable");
  });
});

const emptyBaseline: ProductBaseline = {
  product_id: "P-empty",
  pages: [],
  navigation: []
};

const baselineFixture: ProductBaseline = {
  product_id: "P-123abc",
  pages: [
    {
      id: "checkout",
      name: "Checkout",
      features: "Checkout flow",
      copy: [{ context: "payment_terms", text: "Payment terms" }],
      fields: "card number",
      interactions: "submit payment",
      source_requirements: ["R-12345678"]
    }
  ],
  navigation: [
    { from: "checkout", to: "checkout", trigger: "Continue" } as ProductBaseline["navigation"][number] & { trigger: string },
    { from: "checkout", to: "checkout", label: "Legacy return" }
  ]
};

function pageFixture(input: Partial<ProductBaseline["pages"][number]> = {}): ProductBaseline["pages"][number] {
  return {
    id: "checkout",
    name: "Checkout",
    features: "Checkout flow",
    copy: [],
    fields: "card number",
    interactions: "submit payment",
    source_requirements: ["R-12345678"],
    ...input
  };
}

function createClient({
  baseline,
  pageCopyErrors = {},
  pageCopies = {}
}: {
  baseline: ProductBaseline;
  pageCopyErrors?: Record<string, Error>;
  pageCopies?: Record<string, PageCopyPayload>;
}) {
  return {
    getBaseline: vi.fn(async () => baseline),
    getPageCopy: vi.fn(async (_productId, pageId) => {
      const error = pageCopyErrors[pageId];
      if (error) {
        throw error;
      }
      return pageCopies[pageId] ?? { page_id: pageId, default_language_copy: [], translations: [] };
    })
  } satisfies Pick<FormaApiClient, "getBaseline" | "getPageCopy">;
}

function LocaleSwitch() {
  const { setLocale } = useLocale();
  return (
    <button data-locale-zh="" onClick={() => setLocale("zh")} type="button">
      中
    </button>
  );
}

function createTestRoot() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}

function required<T extends Element>(element: T | null, label: string): T {
  if (!element) {
    throw new Error(`Missing ${label}`);
  }
  return element;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
