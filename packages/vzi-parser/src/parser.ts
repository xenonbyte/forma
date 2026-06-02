/**
 * HTML Parser：负责把 HTML 字符串解析为 IR。
 *
 * NOTE(vendored/Forma): sync (cheerio) parse() and JSDOM/lightweight parseAsync fallback
 * have been removed. parseAsync() ALWAYS uses the Puppeteer path. The resolveUrl helper
 * and all helpers that were only used by the removed paths have been removed too.
 */

import type { IntermediateRepresentation } from '@vzi-core/types';
import { type ComputedStyleOptions } from './computed-style';

const DEFAULT_MAX_INPUT_SIZE = 100 * 1024 * 1024;
const DEFAULT_PUPPETEER_VIEWPORT = { width: 1024, height: 1280 };

interface PuppeteerParserInstance {
  parse(html: string): Promise<IntermediateRepresentation>;
  dispose(): Promise<void>;
}

export interface HTMLParserOptions {
  /** 最大输入大小，默认 100MB。 */
  maxInputBytes?: number;
  /** IR 版本号。 */
  irVersion?: string;
  /** 基础URL，用于解析相对路径。 */
  baseUrl?: string;
  /** (ignored, kept for backwards-compat) */
  useComputedStyles?: boolean;
  /** JSDOM 计算样式选项。 */
  computedStyleOptions?: ComputedStyleOptions;
  /** (ignored, kept for backwards-compat — Puppeteer is always used) */
  usePuppeteer?: boolean;
  /** Puppeteer 最小观测等待时间（毫秒）。默认：2000 */
  puppeteerWaitTime?: number;
  /** Puppeteer 额外等待的选择器（用于 SPA/异步渲染完成判定） */
  puppeteerWaitForSelector?: string;
  /** 是否启用页面完成标记等待（若页面存在 data-page-ready）。默认：true */
  puppeteerWaitForPageReadyMarker?: boolean;
  /** 页面完成标记存在选择器。默认：'[data-page-ready]' */
  puppeteerPageReadyMarkerSelector?: string;
  /** 页面完成标记完成选择器。默认：'[data-page-ready="true"]' */
  puppeteerPageReadyDoneSelector?: string;
  /** Puppeteer 最大等待时间（毫秒）。默认：30000 */
  puppeteerMaxWaitTime?: number;
  /** 是否等待字体加载完成。默认：true */
  puppeteerWaitForFonts?: boolean;
  /** 是否显式等待图标字体（如 material symbols）。默认：true */
  puppeteerWaitForIconFonts?: boolean;
  /** 图标字体元素选择器。 */
  puppeteerIconFontSelector?: string;
  /** 是否等待图片加载完成。默认：true */
  puppeteerWaitForImages?: boolean;
  /** 是否等待样式表加载完成。默认：true */
  puppeteerWaitForStyleSheets?: boolean;
  /** DOM 稳定窗口（毫秒），在该时间内无变更视为稳定。默认：800 */
  puppeteerStabilityTime?: number;
  /** 是否在 Puppeteer 解析前预处理 Tailwind CDN（编译为静态 CSS）。默认：true */
  puppeteerPreprocessTailwind?: boolean;
  /** 是否复用 Puppeteer 浏览器实例（减少重复启动开销）。默认：true */
  reusePuppeteer?: boolean;
}

/**
 * HTML Parser — thin wrapper around PuppeteerParser.
 *
 * NOTE(vendored/Forma): the sync (cheerio) path and the JSDOM lightweight path
 * have been removed. parseAsync() is the only supported entry point and always
 * uses Puppeteer regardless of the `usePuppeteer` option value.
 */
export class HTMLParser {
  private readonly maxInputBytes: number;

  private readonly irVersion: string;

  private readonly baseUrl?: string;

  private readonly computedStyleOptions?: ComputedStyleOptions;

  private readonly puppeteerWaitTime: number;

  private readonly puppeteerWaitForSelector?: string;

  private readonly puppeteerWaitForPageReadyMarker: boolean;

  private readonly puppeteerPageReadyMarkerSelector: string;

  private readonly puppeteerPageReadyDoneSelector: string;

  private readonly puppeteerMaxWaitTime: number;

  private readonly puppeteerWaitForFonts: boolean;

  private readonly puppeteerWaitForIconFonts: boolean;

  private readonly puppeteerIconFontSelector: string;

  private readonly puppeteerWaitForImages: boolean;

  private readonly puppeteerWaitForStyleSheets: boolean;

  private readonly puppeteerStabilityTime: number;

  private readonly puppeteerPreprocessTailwind: boolean;

  private readonly reusePuppeteer: boolean;

  private puppeteerParserPromise: Promise<PuppeteerParserInstance> | null = null;

  constructor(options: HTMLParserOptions = {}) {
    this.maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_SIZE;
    this.irVersion = options.irVersion ?? '1.0.0';
    this.baseUrl = options.baseUrl;
    this.computedStyleOptions = options.computedStyleOptions;
    this.puppeteerWaitTime = options.puppeteerWaitTime ?? 2000;
    this.puppeteerWaitForSelector = options.puppeteerWaitForSelector;
    this.puppeteerWaitForPageReadyMarker = options.puppeteerWaitForPageReadyMarker ?? true;
    this.puppeteerPageReadyMarkerSelector = options.puppeteerPageReadyMarkerSelector ?? '[data-page-ready]';
    this.puppeteerPageReadyDoneSelector = options.puppeteerPageReadyDoneSelector ?? '[data-page-ready="true"]';
    this.puppeteerMaxWaitTime = options.puppeteerMaxWaitTime ?? 30000;
    this.puppeteerWaitForFonts = options.puppeteerWaitForFonts ?? true;
    this.puppeteerWaitForIconFonts = options.puppeteerWaitForIconFonts ?? true;
    this.puppeteerIconFontSelector =
      options.puppeteerIconFontSelector ??
      '.material-symbols-outlined, .material-symbols-rounded, .material-symbols-sharp, .material-icons, [class*="material-symbols-"], [class*="material-icons"]';
    this.puppeteerWaitForImages = options.puppeteerWaitForImages ?? true;
    this.puppeteerWaitForStyleSheets = options.puppeteerWaitForStyleSheets ?? true;
    this.puppeteerStabilityTime = options.puppeteerStabilityTime ?? 800;
    this.puppeteerPreprocessTailwind = options.puppeteerPreprocessTailwind ?? true;
    this.reusePuppeteer = options.reusePuppeteer ?? true;
  }

  private isNodeRuntime(): boolean {
    const maybeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
    return typeof maybeProcess?.versions?.node === 'string';
  }

  private async getPuppeteerParser(): Promise<PuppeteerParserInstance> {
    if (this.puppeteerParserPromise) {
      return this.puppeteerParserPromise;
    }

    this.puppeteerParserPromise = (async () => {
      const puppeteerModule = await import('./puppeteer-parser.js') as {
        PuppeteerParser: new (options: {
          viewportWidth: number;
          viewportHeight: number;
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
          baseUrl?: string;
          irVersion: string;
        }) => PuppeteerParserInstance;
      };

      const viewportWidth = this.computedStyleOptions?.viewportWidth ?? DEFAULT_PUPPETEER_VIEWPORT.width;
      const viewportHeight = this.computedStyleOptions?.viewportHeight ?? DEFAULT_PUPPETEER_VIEWPORT.height;

      return new puppeteerModule.PuppeteerParser({
        viewportWidth,
        viewportHeight,
        waitTime: this.puppeteerWaitTime,
        waitForSelector: this.puppeteerWaitForSelector,
        waitForPageReadyMarker: this.puppeteerWaitForPageReadyMarker,
        pageReadyMarkerSelector: this.puppeteerPageReadyMarkerSelector,
        pageReadyDoneSelector: this.puppeteerPageReadyDoneSelector,
        maxWaitTime: this.puppeteerMaxWaitTime,
        waitForFonts: this.puppeteerWaitForFonts,
        waitForIconFonts: this.puppeteerWaitForIconFonts,
        iconFontSelector: this.puppeteerIconFontSelector,
        waitForImages: this.puppeteerWaitForImages,
        waitForStyleSheets: this.puppeteerWaitForStyleSheets,
        stabilityTime: this.puppeteerStabilityTime,
        preprocessTailwind: this.puppeteerPreprocessTailwind,
        baseUrl: this.baseUrl,
        irVersion: this.irVersion,
      });
    })();

    return this.puppeteerParserPromise;
  }

  private async releasePuppeteerParser(forceDispose = false): Promise<void> {
    if (!this.puppeteerParserPromise) {
      return;
    }

    const shouldDispose = forceDispose || !this.reusePuppeteer;
    if (!shouldDispose) {
      return;
    }

    const parser = await this.puppeteerParserPromise;
    await parser.dispose();
    this.puppeteerParserPromise = null;
  }

  /**
   * @deprecated Sync (cheerio) parse has been removed. Use parseAsync() — Puppeteer-only.
   */
  parse(_html: string): IntermediateRepresentation {
    throw new Error(
      'sync parse() has been removed from HTMLParser. Use parseAsync() (Puppeteer-only) instead.'
    );
  }

  /**
   * 异步解析 HTML 字符串（Puppeteer-only）。
   *
   * Note(vendored): The JSDOM / sync-cheerio fallback has been removed. This method
   * ALWAYS uses Puppeteer regardless of the `usePuppeteer` option value.
   * Passing `usePuppeteer: false` is accepted for backwards-compat but has no effect.
   * @param html HTML 字符串
   * @returns IR 文档
   */
  async parseAsync(html: string): Promise<IntermediateRepresentation> {
    if (typeof html !== 'string') {
      throw new Error('Invalid HTML input: expected string');
    }

    if (!html.trim()) {
      throw new Error('Invalid HTML input: content is empty');
    }

    const inputBytes = Buffer.byteLength(html, 'utf-8');
    if (inputBytes > this.maxInputBytes) {
      throw new Error(`Invalid HTML input: exceeds max size ${this.maxInputBytes} bytes`);
    }

    if (!this.isNodeRuntime()) {
      throw new Error('parseAsync requires a Node.js runtime (Puppeteer is not available in browser environments).');
    }

    // Puppeteer-only path (JSDOM / sync-cheerio fallback removed in Forma fork)
    const puppeteerParser = await this.getPuppeteerParser();
    try {
      return await puppeteerParser.parse(html);
    } finally {
      await this.releasePuppeteerParser();
    }
  }

  /**
   * 释放解析器内部资源（主要是可复用的 Puppeteer 浏览器实例）。
   */
  async dispose(): Promise<void> {
    await this.releasePuppeteerParser(true);
  }

  /**
   * 从本地文件读取并解析 HTML。
   */
  async parseFromFile(filePath: string): Promise<IntermediateRepresentation> {
    const fsModule = await import('node:fs/promises');
    const html = await fsModule.readFile(filePath, 'utf-8');
    return this.parseAsync(html);
  }
}
