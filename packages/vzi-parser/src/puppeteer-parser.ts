/**
 * Puppeteer 解析器
 *
 * 使用真实 Chrome 浏览器解析 HTML，获取准确布局和样式信息。
 */

import puppeteer, { type Browser, type HTTPRequest, type Page } from "puppeteer";
import type {
  ImageData,
  IntermediateRepresentation,
  IRElement,
  SVGCircle,
  SVGData,
  SVGPath,
  SVGPolygon,
  SVGRect,
} from "@vzi-core/types";
import { isValidIR, getIRValidationErrors } from "@vzi-core/types";
import * as cheerio from "cheerio";
import { extractElementType } from "./style";
import { preprocessTailwindCSS } from "./tailwind-preprocessor";

/**
 * 视口预设
 */
export const VIEWPORT_PRESETS = {
  mobile: { width: 390, height: 884 }, // iPhone 12/13/14 Pro
  tablet: { width: 768, height: 1024 }, // iPad
  desktop: { width: 1024, height: 1280 }, // Desktop (13" MacBook)
} as const;

export type ViewportPreset = keyof typeof VIEWPORT_PRESETS;

/**
 * Puppeteer 解析器选项
 */
export interface PuppeteerParserOptions {
  /** 视口宽度 */
  viewportWidth?: number;
  /** 视口高度 */
  viewportHeight?: number;
  /** 视口预设（mobile/tablet/desktop） */
  viewportPreset?: ViewportPreset;
  /** 最小观测等待时间（毫秒），在此窗口内会持续监测网络/DOM 活动 */
  waitTime?: number;
  /** 等待特定选择器出现（可选） */
  waitForSelector?: string;
  /** 是否启用页面完成标记等待（若页面存在 data-page-ready） */
  waitForPageReadyMarker?: boolean;
  /** 页面完成标记存在选择器 */
  pageReadyMarkerSelector?: string;
  /** 页面完成标记完成选择器 */
  pageReadyDoneSelector?: string;
  /** 最大等待时间（毫秒） */
  maxWaitTime?: number;
  /** 是否等待字体加载完成 */
  waitForFonts?: boolean;
  /** 是否显式等待图标字体（如 material symbols）完成加载 */
  waitForIconFonts?: boolean;
  /** 图标字体元素选择器 */
  iconFontSelector?: string;
  /** 是否等待图片加载完成 */
  waitForImages?: boolean;
  /** 是否等待样式表加载完成 */
  waitForStyleSheets?: boolean;
  /** DOM 稳定窗口（毫秒） */
  stabilityTime?: number;
  /** 是否在解析前预处理 Tailwind CDN（将运行时样式编译为静态 CSS） */
  preprocessTailwind?: boolean;
  /** 是否冻结动画/过渡，按静态首帧提取 */
  freezeAnimations?: boolean;
  /** 是否输出调试日志 */
  debug?: boolean;
  /** 基础URL */
  baseUrl?: string;
  /** IR版本 */
  irVersion?: string;
  /**
   * 最大 DOM 深度限制（默认 50）。
   * 超过此深度的元素子树将被截断，并在 IR metadata 中记录 truncatedAtDepth。
   * 增加此值可以解析更深的 DOM 结构，但可能增加解析时间和内存使用。
   */
  maxDepth?: number;
  /**
   * 是否启用沙箱模式（默认 true）。
   * true：保留 Chromium 默认 OS 沙箱和同源策略，适合公共 API 场景。
   * false：传 --no-sandbox、--disable-setuid-sandbox、--disable-web-security，仅在可信内网环境下使用。
   */
  sandbox?: boolean;
}

export interface PuppeteerScreenshotOptions {
  /** 是否截取整页（默认 false，按当前 viewport 截图） */
  fullPage?: boolean;
}

interface RawPseudoElement {
  content: string;
  styles: Record<string, string>;
}

interface RawElement {
  id: string;
  parentId: string | null;
  tagName: string;
  className: string;
  idAttr: string;
  textContent: string;
  boundingRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  computedStyle: Record<string, string>;
  attributes: Record<string, string>;
  svgData?: SVGData;
  imageData?: ImageData;
  pseudoElements?: {
    before?: RawPseudoElement;
    after?: RawPseudoElement;
  };
}

interface ExtractElementsResult {
  elements: IRElement[];
  truncatedAtDepth?: number;
}

export function withDocumentBaseUrl(html: string, baseUrl: string): string {
  const href = new URL(baseUrl.trim()).toString();
  const $ = cheerio.load(html);

  if ($("base[href]").length > 0) {
    return $.html();
  }

  let head = $("head").first();
  if (head.length === 0) {
    const htmlElement = $("html").first();
    if (htmlElement.length > 0) {
      htmlElement.prepend("<head></head>");
    } else {
      $.root().prepend("<head></head>");
    }
    head = $("head").first();
  }

  const base = $("<base>");
  base.attr("href", href);
  head.prepend(base);
  return $.html();
}

function chromiumLaunchArgs(sandbox: boolean): string[] {
  const args = ["--disable-dev-shm-usage"];
  if (!sandbox) {
    args.push("--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security");
  }
  return args;
}

function allowNoSandboxFallback(): boolean {
  if (typeof process === "undefined" || !process?.env) {
    return false;
  }
  return (
    process.env.VZI_PARSER_ALLOW_NO_SANDBOX_FALLBACK === "1" ||
    process.env.VITEST === "true" ||
    process.env.NODE_ENV === "test" ||
    process.env.CI === "true"
  );
}

/**
 * Puppeteer 解析器类
 */
export class PuppeteerParser {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private parseQueue: Promise<void> = Promise.resolve();
  private readonly debugEnabled: boolean;
  private options: {
    viewportWidth: number;
    viewportHeight: number;
    viewportPreset?: ViewportPreset;
    waitTime: number;
    waitForSelector?: string;
    waitForPageReadyMarker: boolean;
    pageReadyMarkerSelector: string;
    pageReadyDoneSelector: string;
    maxWaitTime: number;
    waitForFonts: boolean;
    waitForIconFonts: boolean;
    iconFontSelector: string;
    waitForImages: boolean;
    waitForStyleSheets: boolean;
    stabilityTime: number;
    preprocessTailwind: boolean;
    freezeAnimations: boolean;
    baseUrl: string;
    irVersion: string;
    maxDepth: number;
    sandbox: boolean;
  };

  constructor(options: PuppeteerParserOptions = {}) {
    const preset = options.viewportPreset ? VIEWPORT_PRESETS[options.viewportPreset] : VIEWPORT_PRESETS.desktop;

    this.options = {
      viewportWidth: options.viewportWidth ?? preset.width,
      viewportHeight: options.viewportHeight ?? preset.height,
      viewportPreset: options.viewportPreset,
      waitTime: options.waitTime ?? 2000,
      waitForSelector: options.waitForSelector,
      waitForPageReadyMarker: options.waitForPageReadyMarker ?? true,
      pageReadyMarkerSelector: options.pageReadyMarkerSelector ?? "[data-page-ready]",
      pageReadyDoneSelector: options.pageReadyDoneSelector ?? '[data-page-ready="true"]',
      maxWaitTime: options.maxWaitTime ?? 30000,
      waitForFonts: options.waitForFonts ?? true,
      waitForIconFonts: options.waitForIconFonts ?? true,
      iconFontSelector:
        options.iconFontSelector ??
        '.material-symbols-outlined, .material-symbols-rounded, .material-symbols-sharp, .material-icons, [class*="material-symbols-"], [class*="material-icons"]',
      waitForImages: options.waitForImages ?? true,
      waitForStyleSheets: options.waitForStyleSheets ?? true,
      stabilityTime: options.stabilityTime ?? 800,
      preprocessTailwind: options.preprocessTailwind ?? true,
      freezeAnimations: options.freezeAnimations ?? true,
      baseUrl: options.baseUrl ?? "http://localhost",
      irVersion: options.irVersion ?? "1.0.0",
      maxDepth: options.maxDepth ?? 50,
      sandbox: options.sandbox ?? true,
    };

    this.debugEnabled =
      options.debug ?? (typeof process !== "undefined" && !!process?.env && process.env.VZI_PARSER_DEBUG === "1");
  }

  private debugLog(stage: string, message: string): void {
    if (!this.debugEnabled) {
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`[PuppeteerParser][${stage}] ${message}`);
  }

  private async applyStaticSnapshotStyles(): Promise<void> {
    if (!this.page || !this.options.freezeAnimations) {
      return;
    }

    await this.page
      .evaluate(() => {
        const styleId = "__vzi_static_snapshot_style__";
        if (document.getElementById(styleId)) {
          return;
        }

        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
        *, *::before, *::after {
          animation: none !important;
          transition-property: none !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
          scroll-behavior: auto !important;
        }
      `;
        (document.head || document.documentElement).appendChild(style);
      })
      .catch(() => {});
    this.debugLog("parse", "static snapshot styles applied");
  }

  /**
   * 初始化浏览器
   */
  private async initBrowser(): Promise<void> {
    if (!this.browser) {
      this.debugLog("initBrowser", "launch start");
      const args = chromiumLaunchArgs(this.options.sandbox);
      try {
        this.browser = await puppeteer.launch({
          headless: true,
          args,
        });
      } catch (error) {
        if (!this.options.sandbox || !allowNoSandboxFallback()) {
          throw error;
        }

        console.warn(
          "[PuppeteerParser] Chromium sandbox launch failed; retrying with no-sandbox fallback in controlled test/CI mode:",
          error instanceof Error ? error.message : String(error),
        );
        this.browser = await puppeteer.launch({
          headless: true,
          args: chromiumLaunchArgs(false),
        });
      }
      this.page = await this.browser.newPage();
      this.debugLog("initBrowser", "newPage created");

      await this.page.setViewport({
        width: this.options.viewportWidth,
        height: this.options.viewportHeight,
        deviceScaleFactor: 2,
      });
      this.debugLog("initBrowser", `viewport set: ${this.options.viewportWidth}x${this.options.viewportHeight}`);
    }
  }

  private async waitForRuntimeIdle(minObservationMs: number): Promise<void> {
    if (!this.page) {
      return;
    }

    const timeoutMs = this.options.maxWaitTime;
    const idleWindowMs = Math.max(0, this.options.stabilityTime);
    const startAt = Date.now();
    const deadline = startAt + timeoutMs;
    this.debugLog("runtimeIdle", `start (minObservation=${minObservationMs}ms, maxWait=${timeoutMs}ms)`);

    let lastNetworkActivity = Date.now();
    const inflightRequests = new Set<HTTPRequest>();

    const shouldTrackRequest = (request: HTTPRequest): boolean => {
      const url = request.url();
      return !url.startsWith("data:") && !url.startsWith("about:");
    };

    const onRequest = (request: HTTPRequest): void => {
      if (!shouldTrackRequest(request)) {
        return;
      }
      inflightRequests.add(request);
      lastNetworkActivity = Date.now();
    };

    const onRequestSettled = (request: HTTPRequest): void => {
      if (inflightRequests.delete(request)) {
        lastNetworkActivity = Date.now();
      }
    };

    await this.page
      .evaluate(() => {
        const state = globalThis as typeof globalThis & {
          __VZI_LAST_DOM_ACTIVITY__?: number;
          __VZI_DOM_ACTIVITY_OBSERVER__?: MutationObserver;
        };

        state.__VZI_LAST_DOM_ACTIVITY__ = Date.now();
        state.__VZI_DOM_ACTIVITY_OBSERVER__?.disconnect();

        const root = document.documentElement || document.body;
        if (!root) {
          state.__VZI_DOM_ACTIVITY_OBSERVER__ = undefined;
          return;
        }

        const observer = new MutationObserver(() => {
          state.__VZI_LAST_DOM_ACTIVITY__ = Date.now();
        });

        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });

        state.__VZI_DOM_ACTIVITY_OBSERVER__ = observer;
      })
      .catch(() => {});

    this.page.on("request", onRequest);
    this.page.on("requestfinished", onRequestSettled);
    this.page.on("requestfailed", onRequestSettled);

    try {
      while (Date.now() < deadline) {
        const now = Date.now();
        const elapsedMs = now - startAt;

        const lastDomActivity = await this.page
          .evaluate(() => {
            const state = globalThis as typeof globalThis & {
              __VZI_LAST_DOM_ACTIVITY__?: number;
            };
            return state.__VZI_LAST_DOM_ACTIVITY__ ?? Date.now();
          })
          .catch(() => now);

        const domIdleMs = now - lastDomActivity;
        const networkIdleMs = now - lastNetworkActivity;

        const domIdle = idleWindowMs <= 0 || domIdleMs >= idleWindowMs;
        const networkIdle = inflightRequests.size === 0 && (idleWindowMs <= 0 || networkIdleMs >= idleWindowMs);

        if (elapsedMs >= minObservationMs && domIdle && networkIdle) {
          this.debugLog("runtimeIdle", `resolved (elapsed=${elapsedMs}ms)`);
          return;
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      this.page.off("request", onRequest);
      this.page.off("requestfinished", onRequestSettled);
      this.page.off("requestfailed", onRequestSettled);
      await this.page
        .evaluate(() => {
          const state = globalThis as typeof globalThis & {
            __VZI_DOM_ACTIVITY_OBSERVER__?: MutationObserver;
          };
          state.__VZI_DOM_ACTIVITY_OBSERVER__?.disconnect();
          state.__VZI_DOM_ACTIVITY_OBSERVER__ = undefined;
        })
        .catch(() => {});
      this.debugLog("runtimeIdle", "cleanup done");
    }
  }

  /**
   * 等待页面达到可解析状态
   */
  private async waitForPageReady(minObservationMs = 0): Promise<void> {
    if (!this.page) {
      return;
    }

    const timeoutMs = this.options.maxWaitTime;
    this.debugLog("waitForPageReady", `start (minObservation=${minObservationMs}ms, maxWait=${timeoutMs}ms)`);
    // 解析精准优先：各阶段预算默认与 maxWaitTime 对齐，避免过早结束等待
    const iconClassCheckTimeoutMs = timeoutMs;
    const styleSheetBudgetMs = timeoutMs;
    const fontReadyBudgetMs = timeoutMs;
    const iconFontBudgetMs = timeoutMs;
    const imageBudgetMs = timeoutMs;

    await this.page
      .waitForFunction(() => document.readyState === "complete", {
        timeout: timeoutMs,
      })
      .catch(() => {});
    this.debugLog("waitForPageReady", "document.readyState complete check done");

    if (this.options.waitForSelector) {
      await this.page
        .waitForSelector(this.options.waitForSelector, {
          timeout: timeoutMs,
        })
        .catch(() => {});
      this.debugLog("waitForPageReady", `waitForSelector done: ${this.options.waitForSelector}`);
    }

    if (this.options.waitForPageReadyMarker) {
      const hasReadyMarker = await this.page.evaluate((markerSelector) => {
        return document.querySelector(markerSelector) !== null;
      }, this.options.pageReadyMarkerSelector);

      if (hasReadyMarker) {
        await this.page
          .waitForSelector(this.options.pageReadyDoneSelector, {
            timeout: timeoutMs,
          })
          .catch(() => {});
        this.debugLog("waitForPageReady", `page-ready marker done: ${this.options.pageReadyDoneSelector}`);
      }
    }

    if (this.options.waitForIconFonts && this.options.iconFontSelector) {
      await this.page
        .waitForFunction(
          (iconFontSelector) => {
            const iconElements = Array.from(document.querySelectorAll(iconFontSelector)).filter(
              (node): node is HTMLElement => node instanceof HTMLElement,
            );

            if (iconElements.length === 0) {
              return true;
            }

            const normalizeFamily = (value: string): string => value.toLowerCase().replace(/['"]/g, "");

            const inferExpectedFamilies = (element: HTMLElement): string[] => {
              const className = `${element.className || ""}`.toLowerCase();
              const expected: string[] = [];

              if (className.includes("material-symbols-outlined")) {
                expected.push("material symbols outlined", "material symbols");
              } else if (className.includes("material-symbols-rounded")) {
                expected.push("material symbols rounded", "material symbols");
              } else if (className.includes("material-symbols-sharp")) {
                expected.push("material symbols sharp", "material symbols");
              } else if (className.includes("material-symbols")) {
                expected.push("material symbols");
              }

              if (className.includes("material-icons")) {
                expected.push("material icons");
              }

              return expected;
            };

            return iconElements.every((iconElement) => {
              const expectedFamilies = inferExpectedFamilies(iconElement);
              if (expectedFamilies.length === 0) {
                return true;
              }

              const computedFamily = normalizeFamily(window.getComputedStyle(iconElement).fontFamily || "");
              return expectedFamilies.some((expected) => computedFamily.includes(expected));
            });
          },
          {
            timeout: iconClassCheckTimeoutMs,
          },
          this.options.iconFontSelector,
        )
        .catch(() => {});
      this.debugLog("waitForPageReady", "icon class family check done");
    }

    this.debugLog("waitForPageReady", "resource settling evaluate start");
    await this.page.evaluate(
      async ({
        waitForFonts,
        waitForIconFonts,
        iconFontSelector,
        waitForImages,
        waitForStyleSheets,
        stabilityTime,
        styleSheetBudgetMs,
        fontReadyBudgetMs,
        iconFontBudgetMs,
        imageBudgetMs,
        timeoutMs: maxWait,
      }) => {
        const withTimeout = async (promise: Promise<unknown>, ms: number): Promise<void> => {
          await Promise.race([
            promise.then(() => undefined).catch(() => undefined),
            new Promise<void>((resolve) => setTimeout(resolve, ms)),
          ]);
        };

        if (waitForStyleSheets) {
          const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')) as HTMLLinkElement[];

          await Promise.all(
            links.map((link) => {
              if (link.sheet) {
                return Promise.resolve();
              }
              return new Promise<void>((resolve) => {
                let settled = false;
                const done = () => {
                  if (settled) return;
                  settled = true;
                  resolve();
                };
                link.addEventListener("load", done, { once: true });
                link.addEventListener("error", done, { once: true });
                setTimeout(done, styleSheetBudgetMs);
              });
            }),
          );
        }

        if (waitForFonts) {
          const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
          if (fonts?.ready) {
            await withTimeout(fonts.ready, fontReadyBudgetMs);
          }

          if (waitForIconFonts && iconFontSelector && fonts?.load) {
            const iconElements = Array.from(document.querySelectorAll(iconFontSelector)).filter(
              (node): node is HTMLElement => node instanceof HTMLElement,
            );

            if (iconElements.length > 0) {
              const normalizeFamilyName = (value: string): string =>
                value
                  .trim()
                  .replace(/^['"]|['"]$/g, "")
                  .toLowerCase();

              const inferExpectedFamilies = (element: HTMLElement): string[] => {
                const className = `${element.className || ""}`.toLowerCase();
                const expected: string[] = [];

                if (className.includes("material-symbols-outlined")) {
                  expected.push("Material Symbols Outlined", "Material Symbols");
                } else if (className.includes("material-symbols-rounded")) {
                  expected.push("Material Symbols Rounded", "Material Symbols");
                } else if (className.includes("material-symbols-sharp")) {
                  expected.push("Material Symbols Sharp", "Material Symbols");
                } else if (className.includes("material-symbols")) {
                  expected.push("Material Symbols");
                }

                if (className.includes("material-icons")) {
                  expected.push("Material Icons");
                }

                return expected;
              };

              // 对字体加载请求做去重，避免按元素重复等待同一字体
              const loadSpecs = new Map<string, { fontSpec: string; sampleText: string }>();
              const perFontAttemptBudget = iconFontBudgetMs;

              for (const iconElement of iconElements) {
                const computedStyle = window.getComputedStyle(iconElement);
                const computedFamilies = computedStyle.fontFamily
                  .split(",")
                  .map((family) => family.trim().replace(/^['"]|['"]$/g, ""))
                  .filter((family) => family.length > 0);
                const expectedFamilies = inferExpectedFamilies(iconElement);
                const candidateFamilies = [...computedFamilies];
                for (const expectedFamily of expectedFamilies) {
                  if (
                    !candidateFamilies.some(
                      (candidate) => normalizeFamilyName(candidate) === normalizeFamilyName(expectedFamily),
                    )
                  ) {
                    candidateFamilies.push(expectedFamily);
                  }
                }

                if (candidateFamilies.length === 0) {
                  continue;
                }

                const fontSize = computedStyle.fontSize || "24px";
                const sampleText = (iconElement.textContent || "").trim() || "icon";
                for (const family of candidateFamilies) {
                  const normalized = normalizeFamilyName(family);
                  const key = `${normalized}|${fontSize}|${sampleText}`;
                  if (!loadSpecs.has(key)) {
                    loadSpecs.set(key, {
                      fontSpec: `400 ${fontSize} "${family}"`,
                      sampleText,
                    });
                  }
                }
              }

              if (loadSpecs.size > 0) {
                const start = Date.now();
                for (const { fontSpec, sampleText } of loadSpecs.values()) {
                  if (Date.now() - start >= iconFontBudgetMs) {
                    break;
                  }
                  await withTimeout(fonts.load(fontSpec, sampleText), perFontAttemptBudget);
                  if (fonts.check?.(fontSpec, sampleText)) {
                  }
                }
              }
              if (fonts.ready) {
                await withTimeout(fonts.ready, Math.min(fontReadyBudgetMs, iconFontBudgetMs));
              }

              const stableWindow = Math.max(300, Math.min(stabilityTime > 0 ? stabilityTime : 600, maxWait));

              await new Promise<void>((resolve) => {
                const snapshotMetrics = () => {
                  return iconElements
                    .map((iconElement) => {
                      const rect = iconElement.getBoundingClientRect();
                      const family = window.getComputedStyle(iconElement).fontFamily;
                      const roundedWidth = Math.round(rect.width * 100);
                      const roundedHeight = Math.round(rect.height * 100);
                      return `${roundedWidth}:${roundedHeight}:${family}`;
                    })
                    .join("|");
                };

                let lastSnapshot = snapshotMetrics();
                let idleTimer: ReturnType<typeof setTimeout> | null = null;
                let maxTimer: ReturnType<typeof setTimeout> | null = null;
                let interval: ReturnType<typeof setInterval> | null = null;

                const finish = () => {
                  if (idleTimer !== null) clearTimeout(idleTimer);
                  if (maxTimer !== null) clearTimeout(maxTimer);
                  if (interval !== null) clearInterval(interval);
                  resolve();
                };

                const resetIdleTimer = () => {
                  if (idleTimer !== null) clearTimeout(idleTimer);
                  idleTimer = setTimeout(finish, stableWindow);
                };

                interval = setInterval(() => {
                  const nextSnapshot = snapshotMetrics();
                  if (nextSnapshot !== lastSnapshot) {
                    lastSnapshot = nextSnapshot;
                    resetIdleTimer();
                  }
                }, 100);

                resetIdleTimer();
                maxTimer = setTimeout(finish, maxWait);
              });
            }
          }
        }

        if (waitForImages) {
          const pendingImages = Array.from(document.images).filter((img) => !img.complete);
          await Promise.all(
            pendingImages.map(
              (img) =>
                new Promise<void>((resolve) => {
                  let settled = false;
                  const done = () => {
                    if (settled) return;
                    settled = true;
                    resolve();
                  };
                  img.addEventListener("load", done, { once: true });
                  img.addEventListener("error", done, { once: true });
                  setTimeout(done, imageBudgetMs);
                }),
            ),
          );
        }

        if (stabilityTime > 0) {
          await new Promise<void>((resolve) => {
            const root = document.documentElement || document.body;
            if (!root) {
              resolve();
              return;
            }

            let finished = false;
            let idleTimer: ReturnType<typeof setTimeout> | null = null;
            let maxTimer: ReturnType<typeof setTimeout> | null = null;

            const finish = () => {
              if (finished) return;
              finished = true;
              if (idleTimer !== null) {
                clearTimeout(idleTimer);
              }
              if (maxTimer !== null) {
                clearTimeout(maxTimer);
              }
              observer.disconnect();
              resolve();
            };

            const scheduleIdleTimer = () => {
              if (idleTimer !== null) {
                clearTimeout(idleTimer);
              }
              idleTimer = setTimeout(finish, stabilityTime);
            };

            const observer = new MutationObserver(() => {
              scheduleIdleTimer();
            });
            observer.observe(root, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true,
            });

            scheduleIdleTimer();
            maxTimer = setTimeout(finish, maxWait);
          });
        }

        // 再等待两个渲染帧，确保样式和布局已提交。
        // 注意：无头环境中 requestAnimationFrame 可能不触发，必须有超时兜底避免卡死。
        await new Promise<void>((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            resolve();
          };

          const timeoutId = setTimeout(done, 120);
          const raf =
            typeof requestAnimationFrame === "function"
              ? requestAnimationFrame
              : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16);

          raf(() => {
            raf(() => {
              clearTimeout(timeoutId);
              done();
            });
          });
        });
      },
      {
        waitForFonts: this.options.waitForFonts,
        waitForIconFonts: this.options.waitForIconFonts,
        iconFontSelector: this.options.iconFontSelector,
        waitForImages: this.options.waitForImages,
        waitForStyleSheets: this.options.waitForStyleSheets,
        stabilityTime: this.options.stabilityTime,
        styleSheetBudgetMs,
        fontReadyBudgetMs,
        iconFontBudgetMs,
        imageBudgetMs,
        timeoutMs,
      },
    );
    this.debugLog("waitForPageReady", "resource settling evaluate done");

    await this.waitForRuntimeIdle(Math.max(0, minObservationMs));
    this.debugLog("waitForPageReady", "done");
  }

  /**
   * 解析HTML
   */
  async parse(html: string): Promise<IntermediateRepresentation> {
    return this.runExclusive(async () => {
      this.debugLog("parse", "start");
      await this.initBrowser();

      if (!this.page) {
        throw new Error("Failed to initialize browser");
      }

      let htmlForParse = html;
      if (this.options.preprocessTailwind) {
        this.debugLog("parse", "tailwind preprocess start");
        try {
          const preprocessResult = await preprocessTailwindCSS(html);
          htmlForParse = preprocessResult.html;
          this.debugLog("parse", "tailwind preprocess done");
        } catch (error) {
          console.warn("[PuppeteerParser] Tailwind preprocess failed, fallback to raw HTML:", error);
          this.debugLog("parse", "tailwind preprocess failed, fallback raw html");
        }
      }

      await this.page.setViewport({
        width: this.options.viewportWidth,
        height: this.options.viewportHeight,
        deviceScaleFactor: 2,
      });

      const htmlForContent = withDocumentBaseUrl(htmlForParse, this.options.baseUrl);

      await this.page.setContent(htmlForContent, {
        waitUntil: "load",
        timeout: this.options.maxWaitTime,
      });
      this.debugLog("parse", "setContent done");
      await this.applyStaticSnapshotStyles();

      await this.waitForPageReady(this.options.waitTime);
      this.debugLog("parse", "waitForPageReady done");

      const $ = cheerio.load(htmlForParse);
      const title = $("title").first().text() || undefined;
      const ir = await this.buildIrFromCurrentPage(title);
      this.debugLog("parse", "done");

      return ir;
    });
  }

  /**
   * 直接从 URL 导航并解析页面
   */
  async parseUrl(url: string): Promise<IntermediateRepresentation> {
    return this.runExclusive(async () => {
      this.debugLog("parseUrl", `start: ${url}`);
      await this.initBrowser();

      if (!this.page) {
        throw new Error("Failed to initialize browser");
      }

      let normalizedUrl: string;
      try {
        normalizedUrl = new URL(url).toString();
      } catch {
        throw new Error(`Invalid URL: ${url}`);
      }

      await this.page.setViewport({
        width: this.options.viewportWidth,
        height: this.options.viewportHeight,
        deviceScaleFactor: 2,
      });

      await this.page.goto(normalizedUrl, {
        waitUntil: "load",
        timeout: this.options.maxWaitTime,
      });
      this.debugLog("parseUrl", "goto done");
      await this.applyStaticSnapshotStyles();

      await this.waitForPageReady(this.options.waitTime);
      this.debugLog("parseUrl", "waitForPageReady done");

      const title = await this.page.title().catch(() => undefined);
      const ir = await this.buildIrFromCurrentPage(title || undefined);
      this.debugLog("parseUrl", "done");

      return ir;
    });
  }

  private async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.parseQueue;
    let release!: () => void;
    this.parseQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }

  private async buildIrFromCurrentPage(title?: string): Promise<IntermediateRepresentation> {
    const contentHeight = await this.page!.evaluate(() => {
      return Math.max(
        document.body.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.clientHeight,
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight,
      );
    });
    this.debugLog("buildIrFromCurrentPage", `contentHeight measured: ${contentHeight}`);

    this.debugLog("buildIrFromCurrentPage", "extractElements start");
    const { elements, truncatedAtDepth } = await this.extractElements();
    this.debugLog("buildIrFromCurrentPage", `extractElements done: ${elements.length}`);

    const elementMap: Record<string, IRElement> = {};
    for (const element of elements) {
      elementMap[element.id] = element;
    }

    const irMetadata: IntermediateRepresentation["metadata"] = {
      title,
      generatedAt: new Date().toISOString(),
      viewportWidth: this.options.viewportWidth,
      viewportHeight: this.options.viewportHeight,
      contentHeight,
    };

    // 如果有深度截断，记录在 metadata 中
    if (truncatedAtDepth !== undefined) {
      irMetadata.truncatedAtDepth = truncatedAtDepth;
    }

    const ir: IntermediateRepresentation = {
      version: this.options.irVersion,
      rootElementId: elements.length > 0 ? elements[0].id : "root",
      elements: elementMap,
      metadata: irMetadata,
    };

    if (!isValidIR(ir)) {
      throw new Error(`Generated IR is invalid: ${getIRValidationErrors(ir).join("; ")}`);
    }

    return ir;
  }

  /**
   * 获取当前页面截图（需在 parse 后调用）
   */
  async captureScreenshot(options: PuppeteerScreenshotOptions = {}): Promise<Uint8Array> {
    if (!this.page) {
      throw new Error("Browser not initialized");
    }

    const viewport = this.page.viewport();
    const needsNormalizeDPR = !!viewport && (viewport.deviceScaleFactor ?? 1) !== 1;

    try {
      if (needsNormalizeDPR && viewport) {
        await this.page.setViewport({
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          isMobile: viewport.isMobile,
          isLandscape: viewport.isLandscape,
          hasTouch: viewport.hasTouch,
        });
      }

      const fullPage = options.fullPage ?? false;
      const result = await this.page.screenshot({
        type: "png",
        fullPage,
        captureBeyondViewport: fullPage,
      });

      if (result instanceof Uint8Array) {
        return result;
      }

      return new Uint8Array(result);
    } finally {
      if (needsNormalizeDPR && viewport) {
        await this.page.setViewport(viewport).catch(() => {});
      }
    }
  }

  /**
   * 提取DOM元素
   */
  private async extractElements(): Promise<ExtractElementsResult> {
    if (!this.page) {
      throw new Error("Browser not initialized");
    }

    const rawResultUnknown: unknown = await this.page.evaluate((maxDepthLimit: number) => {
      const elements: RawElement[] = [];
      const usedIds = new Set<string>();
      let idCounter = 0;

      function createUniqueElementId(preferredId: string): string {
        const candidate = preferredId.trim();
        if (candidate && !usedIds.has(candidate)) {
          usedIds.add(candidate);
          return candidate;
        }

        if (candidate) {
          let suffix = 1;
          while (usedIds.has(`${candidate}_${suffix}`)) {
            suffix += 1;
          }
          const uniqueId = `${candidate}_${suffix}`;
          usedIds.add(uniqueId);
          return uniqueId;
        }

        let generatedId = `ir_${idCounter++}`;
        while (usedIds.has(generatedId)) {
          generatedId = `ir_${idCounter++}`;
        }
        usedIds.add(generatedId);
        return generatedId;
      }

      function extractStyles(computedStyle: CSSStyleDeclaration): Record<string, string> {
        const styles: Record<string, string> = {};
        const styleProps = [
          "display",
          "position",
          "top",
          "right",
          "bottom",
          "left",
          "width",
          "height",
          "margin",
          "padding",
          "border",
          "borderWidth",
          "borderStyle",
          "borderColor",
          "backgroundColor",
          "color",
          "fontSize",
          "fontFamily",
          "fontWeight",
          "lineHeight",
          "textAlign",
          "textTransform",
          "whiteSpace",
          "opacity",
          "zIndex",
          "overflow",
          "flexDirection",
          "justifyContent",
          "alignItems",
          "gap",
          "borderRadius",
          "boxShadow",
          "transform",
          "filter",
          "backdropFilter",
          "backgroundImage",
          "backgroundSize",
          "backgroundPosition",
          "backgroundRepeat",
          "backgroundClip",
          "backgroundOrigin",
        ];

        for (const prop of styleProps) {
          const kebabProp = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
          let value = computedStyle.getPropertyValue(kebabProp);
          if (value && value !== "initial" && value !== "inherit") {
            if (prop === "boxShadow" && value !== "none") {
              const colorFirstMatch = value.match(/^(rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-fA-F]+)\s+(.+)$/);
              if (colorFirstMatch) {
                const color = colorFirstMatch[1].replace(/\s+/g, "");
                value = `${colorFirstMatch[2]} ${color}`;
              }
            }
            styles[prop] = value;
          }
        }
        return styles;
      }

      function inferIconFontFamily(className: string): string | undefined {
        const normalized = className.toLowerCase();

        if (normalized.includes("material-symbols-outlined")) {
          return "Material Symbols Outlined";
        }
        if (normalized.includes("material-symbols-rounded")) {
          return "Material Symbols Rounded";
        }
        if (normalized.includes("material-symbols-sharp")) {
          return "Material Symbols Sharp";
        }
        if (normalized.includes("material-icons")) {
          return "Material Icons";
        }

        return undefined;
      }

      function toFillRule(value: string): "nonzero" | "evenodd" {
        return value === "evenodd" ? "evenodd" : "nonzero";
      }

      function extractSVGData(svgElement: SVGSVGElement): SVGData | undefined {
        const computedStyle = window.getComputedStyle(svgElement);
        const currentColor = computedStyle.color;

        let viewBox = svgElement.getAttribute("viewBox") || undefined;
        if (!viewBox) {
          const width = svgElement.width.baseVal.value || parseFloat(svgElement.getAttribute("width") || "0");
          const height = svgElement.height.baseVal.value || parseFloat(svgElement.getAttribute("height") || "0");
          if (width > 0 && height > 0) {
            viewBox = `0 0 ${width} ${height}`;
          }
        }

        const preserveAspectRatio = svgElement.getAttribute("preserveAspectRatio") || undefined;
        const paths: SVGPath[] = [];
        const circles: SVGCircle[] = [];
        const rects: SVGRect[] = [];
        const polygons: SVGPolygon[] = [];
        const paintServerColorCache = new Map<string, string | undefined>();

        function normalizeSvgColor(value: string | undefined): string | undefined {
          if (!value) {
            return undefined;
          }
          const normalized = value.trim();
          if (!normalized || normalized === "none") {
            return undefined;
          }
          return normalized;
        }

        function parseGradientOffset(offsetValue: string | null): number {
          if (!offsetValue) {
            return 0;
          }
          const trimmed = offsetValue.trim();
          if (!trimmed) {
            return 0;
          }
          if (trimmed.endsWith("%")) {
            const percent = parseFloat(trimmed.slice(0, -1));
            if (Number.isFinite(percent)) {
              return Math.max(0, Math.min(1, percent / 100));
            }
            return 0;
          }
          const numeric = parseFloat(trimmed);
          if (!Number.isFinite(numeric)) {
            return 0;
          }
          if (numeric > 1) {
            return Math.max(0, Math.min(1, numeric / 100));
          }
          return Math.max(0, Math.min(1, numeric));
        }

        function applyOpacityToColor(color: string, opacity: number): string {
          if (!Number.isFinite(opacity) || opacity >= 0.999) {
            return color;
          }
          const match = color.match(/^rgba?\(([^)]+)\)$/i);
          if (!match) {
            return color;
          }
          const channels = match[1]
            .split(",")
            .map((part) => parseFloat(part.trim()))
            .filter((value) => Number.isFinite(value));
          if (channels.length < 3) {
            return color;
          }
          const r = Math.round(channels[0]);
          const g = Math.round(channels[1]);
          const b = Math.round(channels[2]);
          const baseAlpha = channels.length >= 4 ? Math.max(0, Math.min(1, channels[3])) : 1;
          const finalAlpha = Math.max(0, Math.min(1, baseAlpha * opacity));
          return `rgba(${r}, ${g}, ${b}, ${finalAlpha})`;
        }

        function resolvePaintServerColor(value: string): string | undefined {
          const matched = value.match(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/i);
          if (!matched) {
            return undefined;
          }
          const paintServerId = matched[1];
          if (paintServerColorCache.has(paintServerId)) {
            return paintServerColorCache.get(paintServerId);
          }

          const paintServer = svgElement.querySelector(`#${paintServerId}`) || document.getElementById(paintServerId);
          if (!paintServer) {
            paintServerColorCache.set(paintServerId, undefined);
            return undefined;
          }

          const stopElements = Array.from(paintServer.querySelectorAll("stop"));
          let bestScore = -1;
          let resolved: string | undefined;
          for (const stopElement of stopElements) {
            const stopComputedStyle = window.getComputedStyle(stopElement);
            const stopColor = normalizeSvgColor(
              stopElement.getAttribute("stop-color") ||
                stopComputedStyle.stopColor ||
                stopComputedStyle.color ||
                undefined,
            );
            if (!stopColor) {
              continue;
            }
            const stopOpacity = parseFloat(
              stopElement.getAttribute("stop-opacity") || stopComputedStyle.stopOpacity || "1",
            );
            const clampedOpacity = Number.isFinite(stopOpacity) ? Math.max(0, Math.min(1, stopOpacity)) : 1;
            if (clampedOpacity <= 0.001) {
              continue;
            }
            const offset = parseGradientOffset(stopElement.getAttribute("offset"));
            const score = clampedOpacity * (1 - Math.abs(offset - 0.5));
            if (score > bestScore) {
              bestScore = score;
              resolved = applyOpacityToColor(stopColor, clampedOpacity);
            }
          }

          paintServerColorCache.set(paintServerId, resolved);
          return resolved;
        }

        function traverseElement(element: Element, inheritedFill?: string, inheritedStroke?: string): void {
          const tagName = element.tagName.toLowerCase();
          const elementComputedStyle = window.getComputedStyle(element);
          const elementColor = elementComputedStyle.color || currentColor;

          const attrFill = element.getAttribute("fill");
          const attrStroke = element.getAttribute("stroke");

          let fill = normalizeSvgColor(attrFill || inheritedFill);
          let stroke = normalizeSvgColor(attrStroke || inheritedStroke);

          if (fill === "currentColor") {
            fill = elementColor;
          }
          if (stroke === "currentColor") {
            stroke = elementColor;
          }

          if (!fill && elementComputedStyle.fill && elementComputedStyle.fill !== "none") {
            fill = elementComputedStyle.fill;
          }
          if (!stroke && elementComputedStyle.stroke && elementComputedStyle.stroke !== "none") {
            stroke = elementComputedStyle.stroke;
          }
          if ((attrFill === "currentColor" || inheritedFill === "currentColor") && elementColor) {
            fill = elementColor;
          }
          if ((attrStroke === "currentColor" || inheritedStroke === "currentColor") && elementColor) {
            stroke = elementColor;
          }

          if (fill && /^url\(/i.test(fill)) {
            fill = resolvePaintServerColor(fill) || elementColor;
          }
          if (stroke && /^url\(/i.test(stroke)) {
            stroke = resolvePaintServerColor(stroke) || elementColor;
          }

          const strokeWidth = parseFloat(
            element.getAttribute("stroke-width") || elementComputedStyle.strokeWidth || "0",
          );
          const computedDasharray = elementComputedStyle.strokeDasharray || "";
          const attrDasharray = element.getAttribute("stroke-dasharray") || "";
          const strokeDasharray = computedDasharray && computedDasharray !== "none" ? computedDasharray : attrDasharray;
          const computedDashoffset = parseFloat(elementComputedStyle.strokeDashoffset || "0");
          const attrDashoffset = parseFloat(element.getAttribute("stroke-dashoffset") || "0");
          const strokeDashoffset = Number.isFinite(computedDashoffset) ? computedDashoffset : attrDashoffset;
          const strokeLinecap = (
            elementComputedStyle.strokeLinecap ||
            element.getAttribute("stroke-linecap") ||
            ""
          ).toLowerCase();
          const opacity = parseFloat(element.getAttribute("opacity") || elementComputedStyle.opacity || "1");

          if (tagName === "path") {
            const d = element.getAttribute("d");
            if (d) {
              const fillRuleValue = element.getAttribute("fill-rule") || elementComputedStyle.fillRule || "nonzero";
              paths.push({
                d,
                fill: fill !== "none" ? fill : undefined,
                stroke: stroke !== "none" ? stroke : undefined,
                strokeWidth: strokeWidth > 0 ? strokeWidth : undefined,
                fillRule: toFillRule(fillRuleValue),
                opacity: opacity < 1 ? opacity : undefined,
                ...(strokeDasharray && strokeDasharray !== "none" ? { strokeDasharray } : {}),
                ...(Number.isFinite(strokeDashoffset) && Math.abs(strokeDashoffset) > 0.001
                  ? { strokeDashoffset }
                  : {}),
                ...(strokeLinecap ? { strokeLinecap } : {}),
              });
            }
          } else if (tagName === "circle") {
            const cx = parseFloat(element.getAttribute("cx") || "0");
            const cy = parseFloat(element.getAttribute("cy") || "0");
            const r = parseFloat(element.getAttribute("r") || "0");
            if (r > 0) {
              circles.push({
                cx,
                cy,
                r,
                fill: fill !== "none" ? fill : undefined,
                stroke: stroke !== "none" ? stroke : undefined,
                strokeWidth: strokeWidth > 0 ? strokeWidth : undefined,
                opacity: opacity < 1 ? opacity : undefined,
                ...(strokeDasharray && strokeDasharray !== "none" ? { strokeDasharray } : {}),
                ...(Number.isFinite(strokeDashoffset) && Math.abs(strokeDashoffset) > 0.001
                  ? { strokeDashoffset }
                  : {}),
                ...(strokeLinecap ? { strokeLinecap } : {}),
              } as SVGCircle);
            }
          } else if (tagName === "rect") {
            const x = parseFloat(element.getAttribute("x") || "0");
            const y = parseFloat(element.getAttribute("y") || "0");
            const width = parseFloat(element.getAttribute("width") || "0");
            const height = parseFloat(element.getAttribute("height") || "0");
            const rx = parseFloat(element.getAttribute("rx") || "0");
            const ry = parseFloat(element.getAttribute("ry") || "0");
            if (width > 0 && height > 0) {
              rects.push({
                x,
                y,
                width,
                height,
                rx: rx > 0 ? rx : undefined,
                ry: ry > 0 ? ry : undefined,
                fill: fill !== "none" ? fill : undefined,
                stroke: stroke !== "none" ? stroke : undefined,
                strokeWidth: strokeWidth > 0 ? strokeWidth : undefined,
                opacity: opacity < 1 ? opacity : undefined,
              });
            }
          } else if (tagName === "polygon" || tagName === "polyline") {
            const points = element.getAttribute("points");
            if (points) {
              polygons.push({
                points,
                fill: fill !== "none" ? fill : undefined,
                stroke: stroke !== "none" ? stroke : undefined,
                strokeWidth: strokeWidth > 0 ? strokeWidth : undefined,
                opacity: opacity < 1 ? opacity : undefined,
              });
            }
          }

          for (const child of element.children) {
            traverseElement(child, fill, stroke);
          }
        }

        traverseElement(svgElement);

        if (paths.length === 0 && circles.length === 0 && rects.length === 0 && polygons.length === 0) {
          return undefined;
        }

        const svgData: SVGData = { viewBox, preserveAspectRatio, paths };
        if (circles.length > 0) {
          svgData.circles = circles;
        }
        if (rects.length > 0) {
          svgData.rects = rects;
        }
        if (polygons.length > 0) {
          svgData.polygons = polygons;
        }
        return svgData;
      }

      function extractImageData(imgElement: HTMLImageElement): ImageData | undefined {
        const src = imgElement.currentSrc || imgElement.src;
        if (!src) {
          return undefined;
        }

        const isBase64 = src.startsWith("data:");
        let format: ImageData["format"];

        if (isBase64) {
          const match = src.match(/^data:image\/(png|jpg|jpeg|svg\+xml|webp|gif|bmp)/i);
          if (match) {
            const formatStr = match[1].toLowerCase();
            format = formatStr === "svg+xml" ? "svg" : (formatStr as ImageData["format"]);
          }
        } else {
          const match = src.match(/\.(png|jpg|jpeg|svg|webp|gif|bmp)(\?|#|$)/i);
          if (match) {
            format = match[1].toLowerCase() as ImageData["format"];
          }
        }

        let naturalWidth = imgElement.naturalWidth;
        let naturalHeight = imgElement.naturalHeight;

        if (naturalWidth === 0 || naturalHeight === 0) {
          naturalWidth = imgElement.width || 0;
          naturalHeight = imgElement.height || 0;
        }

        return {
          src,
          naturalWidth,
          naturalHeight,
          format,
          isBase64,
          alt: imgElement.alt || undefined,
        };
      }

      function hasExplicitTextAlignClass(className: string): boolean {
        return /\btext-(left|center|right|start|end|justify)\b/.test(className);
      }

      function shouldNormalizeFlexChildTextAlign(
        element: Element,
        className: string,
        styles: Record<string, string>,
        parentComputedStyle: CSSStyleDeclaration,
      ): boolean {
        const tagName = element.tagName.toLowerCase();
        const isTextLikeTag =
          tagName === "span" || tagName === "p" || tagName === "label" || tagName === "a" || tagName === "button";
        if (!isTextLikeTag) {
          return false;
        }

        if (!parentComputedStyle.display.includes("flex")) {
          return false;
        }

        if (!parentComputedStyle.justifyContent.includes("space-between")) {
          return false;
        }

        if (!styles.textAlign || styles.textAlign !== parentComputedStyle.textAlign) {
          return false;
        }

        if (hasExplicitTextAlignClass(className.toLowerCase())) {
          return false;
        }

        return true;
      }

      function createTextNodeStyles(parentComputedStyle: CSSStyleDeclaration): Record<string, string> {
        const textStyles = extractStyles(parentComputedStyle);
        textStyles.display = "inline";
        textStyles.margin = "0px";
        textStyles.padding = "0px";
        textStyles.border = "0px none rgba(0, 0, 0, 0)";
        textStyles.backgroundColor = "rgba(0, 0, 0, 0)";
        textStyles.backgroundImage = "none";
        textStyles.boxShadow = "none";
        return textStyles;
      }

      function shouldPreserveWhitespace(computedStyle: CSSStyleDeclaration): boolean {
        const whiteSpace = (computedStyle.whiteSpace || "").toLowerCase();
        return (
          whiteSpace === "pre" ||
          whiteSpace === "pre-wrap" ||
          whiteSpace === "pre-line" ||
          whiteSpace === "break-spaces"
        );
      }

      // 用于记录深度截断信息的变量
      let truncatedAtDepth: number | undefined;

      function extractElement(element: Element, parentId: string | null, depth: number): string | null {
        if (depth > maxDepthLimit) {
          // 深度超限，静默截断会丢失子树，用 console.warn 记录
          console.warn(
            `[vzi-parser] DOM depth limit (${maxDepthLimit}) reached at element <${element.tagName?.toLowerCase()}>. ` +
              "Sub-tree truncated. Pass a higher depth limit via parser options if needed.",
          );
          // 记录实际截断深度
          truncatedAtDepth = maxDepthLimit;
          return null;
        }

        const elementId = createUniqueElementId(element.id || "");
        const computedStyle = window.getComputedStyle(element);
        if (
          computedStyle.display === "none" ||
          computedStyle.visibility === "hidden" ||
          computedStyle.visibility === "collapse"
        ) {
          return null;
        }

        const rect = element.getBoundingClientRect();

        if (rect.width <= 0 || rect.height <= 0) {
          return null;
        }

        const styles = extractStyles(computedStyle);
        const className = element.getAttribute("class") || "";
        const parentElement = element.parentElement;
        const parentComputedStyle = parentElement ? window.getComputedStyle(parentElement) : null;
        if (parentComputedStyle && shouldNormalizeFlexChildTextAlign(element, className, styles, parentComputedStyle)) {
          styles.textAlign = "start";
        }
        const inferredIconFontFamily = inferIconFontFamily(className);
        if (inferredIconFontFamily) {
          // 即使字体尚未下载完成，图标类也应在 IR 中保留正确 font-family，
          // 否则下游渲染会把 ligature 当普通文本拆成竖排。
          styles.fontFamily = `"${inferredIconFontFamily}"`;
          if (!styles.fontWeight) {
            styles.fontWeight = "400";
          }
          if (!styles.textTransform) {
            styles.textTransform = "none";
          }
          if (!styles.whiteSpace) {
            styles.whiteSpace = "nowrap";
          }
        }

        const attributes: Record<string, string> = {};
        for (const attr of element.attributes) {
          attributes[attr.name] = attr.value;
        }

        const pseudoElements: RawElement["pseudoElements"] = {};

        try {
          const beforeStyle = window.getComputedStyle(element, "::before");
          const beforeContent = beforeStyle.getPropertyValue("content");
          if (beforeContent && beforeContent !== "none" && beforeContent !== '""') {
            pseudoElements.before = {
              content: beforeContent.replace(/^["']|["']$/g, ""),
              styles: extractStyles(beforeStyle),
            };
          }
        } catch {
          // 忽略伪元素提取异常
        }

        try {
          const afterStyle = window.getComputedStyle(element, "::after");
          const afterContent = afterStyle.getPropertyValue("content");
          if (afterContent && afterContent !== "none" && afterContent !== '""') {
            pseudoElements.after = {
              content: afterContent.replace(/^["']|["']$/g, ""),
              styles: extractStyles(afterStyle),
            };
          }
        } catch {
          // 忽略伪元素提取异常
        }

        const textContent =
          element.children.length === 0 && element.tagName.toLowerCase() !== "button"
            ? (element.textContent || "").trim()
            : "";

        const rawElement: RawElement = {
          id: elementId,
          parentId,
          tagName: element.tagName.toLowerCase(),
          className,
          idAttr: element.id || "",
          textContent,
          boundingRect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          computedStyle: styles,
          attributes,
        };

        if (element instanceof SVGSVGElement) {
          const svgData = extractSVGData(element);
          if (svgData) {
            rawElement.svgData = svgData;
          }
        }

        if (element instanceof HTMLImageElement) {
          const imageData = extractImageData(element);
          if (imageData) {
            rawElement.imageData = imageData;
          }
        }

        if (Object.keys(pseudoElements).length > 0) {
          rawElement.pseudoElements = pseudoElements;
        }

        elements.push(rawElement);

        const shouldExtractTextNodes = element.children.length > 0 || element.tagName.toLowerCase() === "button";
        if (shouldExtractTextNodes) {
          for (const childNode of Array.from(element.childNodes)) {
            if (childNode.nodeType === Node.TEXT_NODE) {
              const rawText = childNode.textContent || "";
              const preserveWhitespace = shouldPreserveWhitespace(computedStyle);
              const collapsedText = rawText.replace(/\s+/g, " ").trim();
              if (!preserveWhitespace && !collapsedText) {
                continue;
              }
              if (preserveWhitespace && !/[^\s]/.test(rawText)) {
                continue;
              }

              const range = document.createRange();
              try {
                range.selectNodeContents(childNode);
              } catch {
                continue;
              }

              const rects = Array.from(range.getClientRects()).filter(
                (candidateRect) => candidateRect.width > 0 && candidateRect.height > 0,
              );
              if (rects.length === 0) {
                continue;
              }

              let left = rects[0].left;
              let top = rects[0].top;
              let right = rects[0].right;
              let bottom = rects[0].bottom;
              for (let i = 1; i < rects.length; i++) {
                const clientRect = rects[i];
                left = Math.min(left, clientRect.left);
                top = Math.min(top, clientRect.top);
                right = Math.max(right, clientRect.right);
                bottom = Math.max(bottom, clientRect.bottom);
              }

              const textStyles = createTextNodeStyles(computedStyle);
              if (computedStyle.display.includes("flex") && computedStyle.justifyContent !== "center") {
                textStyles.textAlign = "start";
              } else if (!textStyles.textAlign) {
                textStyles.textAlign = "start";
              }

              if (preserveWhitespace && rects.length > 1) {
                const lineTexts = rawText
                  .split(/\r?\n/)
                  .map((line) => line.replace(/\r/g, ""))
                  .filter((line) => /[^\s]/.test(line));
                if (lineTexts.length > 0) {
                  for (let index = 0; index < lineTexts.length; index++) {
                    const lineText = lineTexts[index];
                    const rectIndex = Math.min(index, rects.length - 1);
                    const lineRect = rects[rectIndex];
                    elements.push({
                      id: createUniqueElementId(""),
                      parentId: elementId,
                      tagName: "span",
                      className: "",
                      idAttr: "",
                      textContent: lineText,
                      boundingRect: {
                        x: lineRect.left,
                        y: lineRect.top,
                        width: lineRect.width,
                        height: lineRect.height,
                      },
                      computedStyle: textStyles,
                      attributes: {},
                    });
                  }
                  continue;
                }
              }

              elements.push({
                id: createUniqueElementId(""),
                parentId: elementId,
                tagName: "span",
                className: "",
                idAttr: "",
                textContent: preserveWhitespace ? rawText : collapsedText,
                boundingRect: {
                  x: left,
                  y: top,
                  width: right - left,
                  height: bottom - top,
                },
                computedStyle: textStyles,
                attributes: {},
              });
              continue;
            }

            if (childNode.nodeType === Node.ELEMENT_NODE) {
              extractElement(childNode as Element, elementId, depth + 1);
            }
          }
        }

        return elementId;
      }

      function isTransparentColor(value: string | null): boolean {
        if (!value) {
          return true;
        }
        const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
        return (
          normalized === "transparent" ||
          normalized === "rgba(0,0,0,0)" ||
          normalized === "rgb(0,0,0,0)" ||
          normalized === "hsla(0,0%,0%,0)" ||
          normalized === "#0000" ||
          normalized === "#00000000"
        );
      }

      function getDocumentBounds(): { x: number; y: number; width: number; height: number } {
        return {
          x: 0,
          y: 0,
          width: Math.max(1, Math.round(window.innerWidth)),
          height: Math.max(1, Math.round(window.innerHeight)),
        };
      }

      function shouldWrapBodyAsRoot(bodyStyle: CSSStyleDeclaration, childCount: number): boolean {
        if (childCount !== 1) {
          return childCount > 1;
        }
        const backgroundColor = bodyStyle.getPropertyValue("background-color");
        const backgroundImage = bodyStyle.getPropertyValue("background-image");
        const boxShadow = bodyStyle.getPropertyValue("box-shadow");
        const hasVisualBackground =
          !isTransparentColor(backgroundColor) ||
          (Boolean(backgroundImage) && backgroundImage !== "none") ||
          (Boolean(boxShadow) && boxShadow !== "none");
        return hasVisualBackground;
      }

      const body = document.body;
      if (body && body.children.length > 0) {
        const bodyStyle = window.getComputedStyle(body);
        const useBodyRoot = shouldWrapBodyAsRoot(bodyStyle, body.children.length);

        if (useBodyRoot) {
          const rootId = createUniqueElementId("root");
          const rootStyles = extractStyles(bodyStyle);
          elements.push({
            id: rootId,
            parentId: null,
            tagName: "root",
            className: "",
            idAttr: "",
            textContent: "",
            boundingRect: getDocumentBounds(),
            computedStyle: rootStyles,
            attributes: {},
          });

          for (const child of body.children) {
            extractElement(child, rootId, 1);
          }
        } else {
          extractElement(body.children[0], null, 0);

          if (elements.length > 0) {
            const rootElement = elements[0];
            const rootBg = rootElement.computedStyle.backgroundColor || rootElement.computedStyle["background-color"];
            if (!rootBg || isTransparentColor(rootBg)) {
              const bodyBg = bodyStyle.getPropertyValue("background-color");
              if (!isTransparentColor(bodyBg)) {
                rootElement.computedStyle.backgroundColor = bodyBg;
              }
            }
            const rootBgImage =
              rootElement.computedStyle.backgroundImage || rootElement.computedStyle["background-image"];
            const bodyBgImage = bodyStyle.getPropertyValue("background-image");
            if ((!rootBgImage || rootBgImage === "none") && bodyBgImage && bodyBgImage !== "none") {
              rootElement.computedStyle.backgroundImage = bodyBgImage;
              rootElement.computedStyle.backgroundSize = bodyStyle.getPropertyValue("background-size");
              rootElement.computedStyle.backgroundPosition = bodyStyle.getPropertyValue("background-position");
              rootElement.computedStyle.backgroundRepeat = bodyStyle.getPropertyValue("background-repeat");
              rootElement.computedStyle.backgroundClip = bodyStyle.getPropertyValue("background-clip");
              rootElement.computedStyle.backgroundOrigin = bodyStyle.getPropertyValue("background-origin");
            }
          }
        }
      }

      return {
        elements,
        truncatedAtDepth,
      };
    }, this.options.maxDepth);

    if (!rawResultUnknown || typeof rawResultUnknown !== "object") {
      return { elements: [] };
    }

    const rawResult = rawResultUnknown as {
      elements?: unknown;
      truncatedAtDepth?: unknown;
    };

    const truncatedAtDepth = typeof rawResult.truncatedAtDepth === "number" ? rawResult.truncatedAtDepth : undefined;

    if (!Array.isArray(rawResult.elements)) {
      return { elements: [], truncatedAtDepth };
    }

    const rawElements = rawResult.elements as RawElement[];

    const irElements: IRElement[] = rawElements.map((raw) => {
      const getAttr = (name: string): string | undefined => {
        const value = raw.attributes[name];
        if (typeof value !== "string") {
          return undefined;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      };
      const pickAttributePrefix = (prefix: string): Record<string, string> | undefined => {
        const picked: Record<string, string> = {};
        for (const [key, value] of Object.entries(raw.attributes)) {
          if (!key.startsWith(prefix)) {
            continue;
          }
          const normalized = typeof value === "string" ? value.trim() : "";
          if (normalized.length > 0) {
            picked[key] = normalized;
          }
        }
        return Object.keys(picked).length > 0 ? picked : undefined;
      };
      const inferredName =
        getAttr("name") ||
        getAttr("aria-label") ||
        getAttr("alt") ||
        getAttr("placeholder") ||
        raw.textContent ||
        undefined;

      const imageSource =
        typeof raw.imageData?.src === "string" && raw.imageData.src.trim().length > 0
          ? raw.imageData.src.trim()
          : getAttr("src");

      const fallbackImageData: ImageData | undefined =
        !raw.imageData && raw.tagName === "img" && imageSource
          ? {
              src: imageSource,
              naturalWidth: Math.max(1, Math.round(raw.boundingRect.width)),
              naturalHeight: Math.max(1, Math.round(raw.boundingRect.height)),
              isBase64: imageSource.startsWith("data:"),
              alt: getAttr("alt"),
            }
          : undefined;

      const element: IRElement = {
        id: raw.id,
        parentId: raw.parentId,
        type: extractElementType(raw.tagName, raw.className),
        bounds: {
          x: Math.round(raw.boundingRect.x),
          y: Math.round(raw.boundingRect.y),
          width: Math.max(1, Math.round(raw.boundingRect.width)),
          height: Math.max(1, Math.round(raw.boundingRect.height)),
        },
        styles: this.convertStyles(raw.computedStyle),
        ...(raw.textContent ? { textContent: raw.textContent } : {}),
        source: {
          tagName: raw.tagName,
          className: raw.className || undefined,
          id: raw.idAttr || undefined,
          role: getAttr("role"),
          name: inferredName,
          dataAttributes: pickAttributePrefix("data-"),
          ariaAttributes: pickAttributePrefix("aria-"),
          src: imageSource,
          href: getAttr("href"),
          alt: getAttr("alt"),
          target: getAttr("target"),
          rel: getAttr("rel"),
          type: getAttr("type"),
          placeholder: getAttr("placeholder"),
          value: getAttr("value"),
        },
      };

      if (raw.svgData) {
        element.svgData = raw.svgData;
      }

      if (raw.imageData) {
        element.imageData = raw.imageData;
      } else if (fallbackImageData) {
        element.imageData = fallbackImageData;
      }

      if (raw.pseudoElements) {
        const pseudoElements: NonNullable<IRElement["pseudoElements"]> = {};
        if (raw.pseudoElements.before) {
          pseudoElements.before = {
            content: raw.pseudoElements.before.content,
            styles: this.convertStyles(raw.pseudoElements.before.styles),
          };
        }
        if (raw.pseudoElements.after) {
          pseudoElements.after = {
            content: raw.pseudoElements.after.content,
            styles: this.convertStyles(raw.pseudoElements.after.styles),
          };
        }

        if (pseudoElements.before || pseudoElements.after) {
          element.pseudoElements = pseudoElements;
        }
      }

      return element;
    });

    return {
      elements: irElements,
      truncatedAtDepth,
    };
  }

  /**
   * 转换样式格式（kebab-case → camelCase）
   */
  private convertStyles(styles: Record<string, string>): Record<string, string | number> {
    const converted: Record<string, string | number> = {};

    for (const [key, value] of Object.entries(styles)) {
      const camelKey = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

      if (/^-?\d+(\.\d+)?$/.test(value)) {
        converted[camelKey] = parseFloat(value);
      } else if (/^-?\d+(\.\d+)?px$/.test(value)) {
        converted[camelKey] = parseFloat(value);
      } else {
        converted[camelKey] = value;
      }
    }

    return converted;
  }

  /**
   * 关闭浏览器
   */
  async dispose(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}
