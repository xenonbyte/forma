import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { PuppeteerParser } from "../src/puppeteer-parser.js";

const launchCalls = vi.hoisted(() => [] as Array<{ args?: string[] }>);

vi.mock("puppeteer", () => {
  return {
    default: {
      launch: vi.fn(async (options: { args?: string[] }) => {
        launchCalls.push({ args: options.args ?? [] });
        return {
          newPage: async () => createMockPage(),
          close: async () => undefined,
        };
      }),
    },
    Browser: class {},
    HTTPRequest: class {},
    Page: class {},
  };
});

function createMockPage() {
  let dom: JSDOM | undefined;
  let viewport = { width: 1024, height: 1280, deviceScaleFactor: 2 };

  const installLayout = (nextDom: JSDOM) => {
    const win = nextDom.window;
    const scrollHeight = parsePositive(win.document.body.getAttribute("data-mock-scroll-height")) ?? viewport.height;
    Object.defineProperty(win, "innerWidth", { configurable: true, value: viewport.width });
    Object.defineProperty(win, "innerHeight", { configurable: true, value: viewport.height });
    for (const target of [win.document.body, win.document.documentElement]) {
      Object.defineProperty(target, "scrollHeight", { configurable: true, value: scrollHeight });
      Object.defineProperty(target, "offsetHeight", { configurable: true, value: scrollHeight });
      Object.defineProperty(target, "clientHeight", { configurable: true, value: viewport.height });
    }
    const getComputedStyle = win.getComputedStyle.bind(win);
    Object.defineProperty(win, "getComputedStyle", {
      configurable: true,
      value: (element: Element) => getComputedStyle(element),
    });
    Object.defineProperty(win.Element.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: Element) {
        const style = win.getComputedStyle(this);
        if (style.display === "none") {
          return makeRect(0, 0);
        }
        const tagName = this.tagName.toLowerCase();
        const width =
          parsePositive(this.getAttribute("width")) ??
          parseStylePx(style.width) ??
          (tagName === "svg" ? 24 : viewport.width);
        const height =
          parsePositive(this.getAttribute("height")) ??
          parseStylePx(style.height) ??
          parseViewportHeight(style.height, viewport.height) ??
          (tagName === "svg" ? 24 : viewport.height);
        return makeRect(width, height);
      },
    });
  };

  const withDomGlobals = async <T>(callback: () => T | Promise<T>): Promise<T> => {
    if (!dom) {
      throw new Error("setContent must be called before evaluate");
    }
    const win = dom.window;
    const globalRecord = globalThis as Record<string, unknown>;
    const keys = [
      "window",
      "document",
      "Node",
      "Element",
      "HTMLElement",
      "SVGSVGElement",
      "HTMLImageElement",
      "CSSStyleDeclaration",
      "MutationObserver",
      "requestAnimationFrame",
    ];
    const previous = new Map<string, unknown>();
    for (const key of keys) {
      previous.set(key, globalRecord[key]);
    }
    Object.assign(globalRecord, {
      window: win,
      document: win.document,
      Node: win.Node,
      Element: win.Element,
      HTMLElement: win.HTMLElement,
      SVGSVGElement: win.SVGSVGElement,
      HTMLImageElement: win.HTMLImageElement,
      CSSStyleDeclaration: win.CSSStyleDeclaration,
      MutationObserver: win.MutationObserver,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
    });
    try {
      return await callback();
    } finally {
      for (const key of keys) {
        const value = previous.get(key);
        if (value === undefined) {
          delete globalRecord[key];
        } else {
          globalRecord[key] = value;
        }
      }
    }
  };

  return {
    setViewport: vi.fn(async (nextViewport: typeof viewport) => {
      viewport = nextViewport;
    }),
    setContent: vi.fn(async (html: string) => {
      dom = new JSDOM(html, { pretendToBeVisual: true });
      installLayout(dom);
    }),
    waitForFunction: vi.fn(async () => undefined),
    waitForSelector: vi.fn(async () => undefined),
    evaluate: vi.fn(async (pageFunction: (...args: unknown[]) => unknown, ...args: unknown[]) =>
      withDomGlobals(() => pageFunction(...args)),
    ),
    on: vi.fn(),
    off: vi.fn(),
    viewport: vi.fn(() => viewport),
    title: vi.fn(async () => dom?.window.document.title ?? ""),
  };
}

function makeRect(width: number, height: number) {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON() {
      return this;
    },
  };
}

function parsePositive(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseStylePx(value: string): number | undefined {
  const match = value.match(/^(\d+(?:\.\d+)?)px$/);
  if (!match) return undefined;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseViewportHeight(value: string, viewportHeight: number): number | undefined {
  const match = value.match(/^(\d+(?:\.\d+)?)vh$/);
  if (!match) return undefined;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? viewportHeight * (parsed / 100) : undefined;
}

async function parseWithMockPage(html: string, options: ConstructorParameters<typeof PuppeteerParser>[0] = {}) {
  const parser = new PuppeteerParser({
    waitTime: 0,
    maxWaitTime: 10,
    waitForPageReadyMarker: false,
    waitForFonts: false,
    waitForIconFonts: false,
    waitForImages: false,
    waitForStyleSheets: false,
    stabilityTime: 0,
    preprocessTailwind: false,
    freezeAnimations: false,
    ...options,
  });
  try {
    return await parser.parse(html);
  } finally {
    await parser.dispose();
  }
}

afterEach(() => {
  launchCalls.length = 0;
  vi.clearAllMocks();
});

describe("PuppeteerParser SVG visibility filtering", () => {
  it("does not emit svgData for visibility:hidden SVG elements", async () => {
    const ir = await parseWithMockPage(`<!DOCTYPE html>
<html>
  <body>
    <svg xmlns="http://www.w3.org/2000/svg" style="visibility:hidden" viewBox="0 0 24 24" width="24" height="24" aria-label="Hidden">
      <path d="M0 0h24v24H0z" />
    </svg>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" aria-label="Visible">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  </body>
</html>`);

    const svgElements = Object.values(ir.elements).filter((element) => element.svgData !== undefined);
    expect(svgElements).toHaveLength(1);
    expect(svgElements[0].source.name).toBe("Visible");
  });
});

describe("PuppeteerParser viewport geometry", () => {
  it("keeps viewport-unit element bounds tied to the configured viewport on long pages", async () => {
    const ir = await parseWithMockPage(
      `<!DOCTYPE html>
<html>
  <body data-mock-scroll-height="2400" style="margin:0">
    <main id="hero" style="height:100vh;width:320px">Hero</main>
  </body>
</html>`,
      {
        viewportWidth: 390,
        viewportHeight: 884,
      },
    );

    const hero = ir.elements.hero;
    expect(hero?.bounds.height).toBe(884);
    expect(ir.metadata.viewportHeight).toBe(884);
    expect(ir.metadata.contentHeight).toBe(2400);
  });
});

describe("PuppeteerParser sandbox launch args", () => {
  it("keeps the Chromium OS sandbox enabled by default", async () => {
    await parseWithMockPage(`<html><body><div style="width:24px;height:24px"></div></body></html>`);

    expect(launchCalls).toHaveLength(1);
    expect(launchCalls[0].args ?? []).not.toContain("--no-sandbox");
    expect(launchCalls[0].args ?? []).not.toContain("--disable-setuid-sandbox");
  });

  it("only disables sandboxing when sandbox is explicitly false", async () => {
    await parseWithMockPage(`<html><body><div style="width:24px;height:24px"></div></body></html>`, {
      sandbox: false,
    });

    expect(launchCalls).toHaveLength(1);
    expect(launchCalls[0].args ?? []).toContain("--no-sandbox");
    expect(launchCalls[0].args ?? []).toContain("--disable-setuid-sandbox");
    expect(launchCalls[0].args ?? []).toContain("--disable-web-security");
  });
});
