/**
 * HTML Parser：负责把 HTML 字符串解析为 IR。
 */

import type {
  IRElement,
  IRElementType,
  IntermediateRepresentation,
} from '@vzi-core/types';
import { isValidIR, getIRValidationErrors } from '@vzi-core/types';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { extractElementType, parseInlineStyle } from './style';
import { ComputedStyleCalculator, type ComputedStyleOptions } from './computed-style';
import { preprocessTailwindCSS } from './tailwind-preprocessor';

const DEFAULT_MAX_INPUT_SIZE = 100 * 1024 * 1024;
const DEFAULT_PUPPETEER_VIEWPORT = { width: 1024, height: 1280 };

/**
 * CSS.escape polyfill
 * 完整实现 CSS 选择器转义规则
 * @see https://drafts.csswg.org/cssom/#serialize-an-identifier
 */
function escapeCssSelector(value: string): string {
  if (!value || value.length === 0) {
    return '';
  }

  let result = '';
  const firstCharCode = value.charCodeAt(0);

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const charCode = value.charCodeAt(i);

    // NULL 字符
    if (charCode === 0x0000) {
      result += '\uFFFD';
      continue;
    }

    // 控制字符 (0x0001-0x001F) 或 0x007F
    if ((charCode >= 0x0001 && charCode <= 0x001f) || charCode === 0x007f) {
      result += '\\' + charCode.toString(16) + ' ';
      continue;
    }

    // 第一个字符是数字
    if (i === 0 && charCode >= 0x0030 && charCode <= 0x0039) {
      result += '\\' + charCode.toString(16) + ' ';
      continue;
    }

    // 第二个字符是数字，且第一个字符是连字符
    if (i === 1 && charCode >= 0x0030 && charCode <= 0x0039 && firstCharCode === 0x002d) {
      result += '\\' + charCode.toString(16) + ' ';
      continue;
    }

    // 第一个字符是连字符，且只有一个字符
    if (i === 0 && value.length === 1 && charCode === 0x002d) {
      result += '\\' + char;
      continue;
    }

    // 字母、数字、下划线、连字符、非 ASCII 字符（>= 0x0080）
    if (
      (charCode >= 0x0030 && charCode <= 0x0039) || // 0-9
      (charCode >= 0x0041 && charCode <= 0x005a) || // A-Z
      (charCode >= 0x0061 && charCode <= 0x007a) || // a-z
      charCode === 0x005f || // _
      charCode === 0x002d || // -
      charCode >= 0x0080 // 非 ASCII
    ) {
      result += char;
      continue;
    }

    // 其他字符需要转义
    result += '\\' + char;
  }

  return result;
}

function getTagName(node: unknown, fallbackTagName = 'div'): string {
  if (!node || typeof node !== 'object') {
    return fallbackTagName;
  }

  const maybeNode = node as { tagName?: unknown; name?: unknown };
  const rawTag = typeof maybeNode.tagName === 'string'
    ? maybeNode.tagName
    : typeof maybeNode.name === 'string'
      ? maybeNode.name
      : fallbackTagName;
  return rawTag.toLowerCase();
}

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
  /** 是否使用 JSDOM 计算样式（更准确但更慢）。 */
  useComputedStyles?: boolean;
  /** JSDOM 计算样式选项。 */
  computedStyleOptions?: ComputedStyleOptions;
  /** 是否在异步解析时使用 Puppeteer（真实浏览器，最准确但需要 ~300MB 依赖）。默认：false */
  usePuppeteer?: boolean;
  /** Puppeteer 最小观测等待时间（毫秒）。默认：2000 */
  puppeteerWaitTime?: number;
  /** Puppeteer 额外等待的选择器（用于 SPA/异步渲染完成判定） */
  puppeteerWaitForSelector?: string;
  /** 是否启用页面完成标记等待（若页面存在 data-page-ready）。默认：true */
  puppeteerWaitForPageReadyMarker?: boolean;
  /** 页面完成标记存在选择器。默认：'[data-page-ready]' */
  puppeteerPageReadyMarkerSelector?: string;
  /** 页面完成标记完成选择器。默认：'[data-page-ready=\"true\"]' */
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
 * HTML Parser：负责把 HTML 字符串解析为 IR。
 */
export class HTMLParser {
  private readonly maxInputBytes: number;

  private readonly irVersion: string;

  private readonly baseUrl?: string;

  private readonly useComputedStyles: boolean;

  private readonly computedStyleOptions?: ComputedStyleOptions;

  private readonly usePuppeteer: boolean;

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
    this.useComputedStyles = options.useComputedStyles ?? false;
    this.computedStyleOptions = options.computedStyleOptions;
    this.usePuppeteer = options.usePuppeteer ?? false;
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
   * 解析 HTML 字符串（支持异步计算样式）。
   * @param html HTML 字符串
   * @returns IR 文档
   */
  parse(html: string): IntermediateRepresentation {
    // 如果启用了计算样式，使用异步版本
    if (this.useComputedStyles) {
      throw new Error(
        'useComputedStyles is enabled. Use parseAsync() instead, or disable useComputedStyles option.'
      );
    }

    if (this.usePuppeteer) {
      throw new Error(
        'usePuppeteer is enabled. Use parseAsync() instead, or disable usePuppeteer option.'
      );
    }

    return this.parseSync(html);
  }

  /**
   * 异步解析 HTML 字符串，支持 JSDOM 计算样式。
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

    // 模式1：使用 Puppeteer（最准确，需 Node 运行时）
    if (this.usePuppeteer && this.isNodeRuntime()) {
      const puppeteerParser = await this.getPuppeteerParser();
      try {
        return await puppeteerParser.parse(html);
      } finally {
        await this.releasePuppeteerParser();
      }
    }

    // 模式2：使用 JSDOM + Tailwind 预处理器（快速，布局不准确）
    // 预处理 Tailwind CSS（如果存在）
    const preprocessResult = await preprocessTailwindCSS(html);
    const processedHTML = preprocessResult.html;

    // 如果启用计算样式，使用 JSDOM
    if (this.useComputedStyles) {
      return this.parseWithComputedStyles(processedHTML);
    }

    // 否则使用同步解析
    return this.parseSync(processedHTML);
  }

  /**
   * 释放解析器内部资源（主要是可复用的 Puppeteer 浏览器实例）。
   */
  async dispose(): Promise<void> {
    await this.releasePuppeteerParser(true);
  }

  /**
   * 使用 JSDOM 计算样式解析 HTML
   */
  private async parseWithComputedStyles(html: string): Promise<IntermediateRepresentation> {
    const markerAttr = 'vzi-ir-node';
    const annotated$ = cheerio.load(html);
    let markerSeq = 0;

    annotated$('*').each((_, node) => {
      annotated$(node).attr(markerAttr, `node_${markerSeq++}`);
    });

    const annotatedHtml = annotated$.html();

    const calculator = new ComputedStyleCalculator({
      baseUrl: this.baseUrl,
      ...this.computedStyleOptions,
    });

    try {
      await calculator.initialize(annotatedHtml);
      const document = calculator.getDocument();

      if (!document) {
        throw new Error('Failed to initialize JSDOM environment');
      }

      const $ = cheerio.load(annotatedHtml);
      const elements: Record<string, IRElement> = {};
      let seq = 0;

      const createUniqueElementId = (preferredId?: string): string => {
        const candidate = preferredId?.trim();
        if (candidate && !elements[candidate]) {
          return candidate;
        }

        if (candidate) {
          let suffix = 1;
          while (elements[`${candidate}_${suffix}`]) {
            suffix += 1;
          }
          return `${candidate}_${suffix}`;
        }

        return `ir_${seq++}`;
      };

      const walk = (
        node: cheerio.Cheerio<AnyNode>,
        parentId: string | null,
        depth: number,
        siblingIndex: number
      ): string => {
        const tagName = getTagName(node.get(0), 'div');
        const elementId = createUniqueElementId(node.attr('id'));
        const className = node.attr('class')?.trim() || undefined;

        const marker = node.attr(markerAttr);
        const domElement = marker
          ? document.querySelector(`[${markerAttr}="${escapeCssSelector(marker)}"]`)
          : null;

        let computedResult = null;
        if (domElement) {
          computedResult = calculator.computeStyle(undefined, domElement);
        }

        const inlineStyles = parseInlineStyle(node.attr('style') || '');

        // 合并计算样式和内联样式，计算样式优先
        const styles = computedResult?.styles || inlineStyles;
        const bounds = computedResult?.bounds || {
          x: toFiniteNumber(inlineStyles.left) ?? siblingIndex * 8,
          y: toFiniteNumber(inlineStyles.top) ?? depth * 24,
          width: toFinitePositiveNumber(inlineStyles.width) ?? 0,
          height: toFinitePositiveNumber(inlineStyles.height) ?? 0,
        };

        const textContent =
          node.children().length === 0
            ? (node.text() || '').trim() || undefined
            : undefined;

        const elementType = extractElementType(tagName, className);

        // 提取并解析URL属性
        const rawSrc = node.attr('src');
        const rawHref = node.attr('href');
        const resolvedSrc = rawSrc ? this.resolveUrl(rawSrc) : undefined;
        const resolvedHref = rawHref ? this.resolveUrl(rawHref) : undefined;
        const role = extractOptionalAttribute(node, 'role');
        const sourceName = inferSourceName(node, textContent);

        const element: IRElement = {
          id: elementId,
          parentId,
          type: elementType,
          bounds: {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          },
          styles,
          ...(textContent ? { textContent } : {}),
          source: {
            tagName,
            className,
            id: node.attr('id') || undefined,
            role,
            name: sourceName,
            dataAttributes: extractAttributes(node, 'data-'),
            ariaAttributes: extractAttributes(node, 'aria-'),
            src: resolvedSrc,
            href: resolvedHref,
            alt: node.attr('alt') || undefined,
            target: node.attr('target') || undefined,
            rel: node.attr('rel') || undefined,
            type: node.attr('type') || undefined,
            placeholder: node.attr('placeholder') || undefined,
            value: node.attr('value') || undefined,
          },
          // 添加伪元素
          ...(computedResult?.pseudoElements ? { pseudoElements: computedResult.pseudoElements } : {}),
        };

        elements[elementId] = element;

        const childIds: string[] = [];
        const children = node.children();
        children.each((childIdx) => {
          const childElementId = walk(children.eq(childIdx), elementId, depth + 1, childIdx);
          childIds.push(childElementId);
        });

        // 推断元素尺寸
        if (bounds.width <= 0 || bounds.height <= 0) {
          const inferredSize = inferElementSize({
            elementType,
            textContent,
            x: bounds.x,
            y: bounds.y,
            fontSize: styles.fontSize,
            fontFamily: styles.fontFamily,
            lineHeight: styles.lineHeight,
            childIds,
            elements,
          });

          if (bounds.width <= 0) {
            element.bounds.width = Math.max(1, inferredSize.width);
          }
          if (bounds.height <= 0) {
            element.bounds.height = Math.max(1, inferredSize.height);
          }
        }

        return elementId;
      };

      // 构建根元素
      const bodyRoot = $('body').first();
      const bodyChildCandidates = bodyRoot.children();
      const topLevelCandidates = $.root().children();

      if (bodyRoot.length === 0 && topLevelCandidates.length === 0) {
        throw new Error('Invalid HTML input: no root element found');
      }

      const rootElementId = bodyRoot.length > 0
        ? bodyChildCandidates.length === 1
          ? walk(bodyChildCandidates.first(), null, 0, 0)
          : (() => {
              const syntheticRootId = createUniqueElementId('root');
              const syntheticRoot: IRElement = {
                id: syntheticRootId,
                parentId: null,
                type: 'container',
                bounds: { x: 0, y: 0, width: 0, height: 0 },
                styles: {},
                source: {
                  tagName: 'root',
                },
              };
              elements[syntheticRootId] = syntheticRoot;

              bodyChildCandidates.each((index) => {
                walk(bodyChildCandidates.eq(index), syntheticRootId, 1, index);
              });

              return syntheticRootId;
            })()
        : (() => {
            const syntheticRootId = createUniqueElementId('root');
            const syntheticRoot: IRElement = {
              id: syntheticRootId,
              parentId: null,
              type: 'container',
              bounds: { x: 0, y: 0, width: 0, height: 0 },
              styles: {},
              source: {
                tagName: 'root',
              },
            };
            elements[syntheticRootId] = syntheticRoot;

            topLevelCandidates.each((index) => {
              walk(topLevelCandidates.eq(index), syntheticRootId, 1, index);
            });

            return syntheticRootId;
          })();

      const ir: IntermediateRepresentation = {
        version: this.irVersion,
        rootElementId,
        elements,
        metadata: {
          title: $('title').first().text() || undefined,
          generatedAt: new Date().toISOString(),
        },
      };

      if (!isValidIR(ir)) {
        throw new Error(`Generated IR is invalid: ${getIRValidationErrors(ir).join('; ')}`);
      }

      return ir;
    } finally {
      calculator.dispose();
    }
  }

  /**
   * 同步解析 HTML 字符串（不使用 JSDOM）。
   */
  private parseSync(html: string): IntermediateRepresentation {
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

    const $ = cheerio.load(html);

    const bodyRoot = $('body').first();
    const bodyChildCandidates = bodyRoot.children();
    const topLevelCandidates = $.root().children();
    if (bodyRoot.length === 0 && topLevelCandidates.length === 0) {
      throw new Error('Invalid HTML input: no root element found');
    }

    const elements: Record<string, IRElement> = {};
    let seq = 0;

    const createUniqueElementId = (preferredId?: string): string => {
      const candidate = preferredId?.trim();
      if (candidate && !elements[candidate]) {
        return candidate;
      }

      if (candidate) {
        let suffix = 1;
        while (elements[`${candidate}_${suffix}`]) {
          suffix += 1;
        }
        return `${candidate}_${suffix}`;
      }

      return `ir_${seq++}`;
    };

    const walk = (
      node: cheerio.Cheerio<AnyNode>,
      parentId: string | null,
      depth: number,
      siblingIndex: number
    ): string => {
      const tagName = getTagName(node.get(0), 'div');
      const elementId = createUniqueElementId(node.attr('id'));
      const className = node.attr('class')?.trim() || undefined;

      const styleAttr = node.attr('style') || '';
      const inlineStyles = parseInlineStyle(styleAttr);

      const left = toFiniteNumber(inlineStyles.left) ?? siblingIndex * 8;
      const top = toFiniteNumber(inlineStyles.top) ?? depth * 24;

      let width =
        toFinitePositiveNumber(inlineStyles.width) ??
        toFinitePositiveNumber(inlineStyles.minWidth) ??
        parseDimensionAttribute(node.attr('width'));

      let height =
        toFinitePositiveNumber(inlineStyles.height) ??
        toFinitePositiveNumber(inlineStyles.minHeight) ??
        parseDimensionAttribute(node.attr('height'));

      const textContent =
        node.children().length === 0
          ? (node.text() || '').trim() || undefined
          : undefined;

      const elementType = extractElementType(tagName, className);

      // 提取并解析URL属性
      const rawSrc = node.attr('src');
      const rawHref = node.attr('href');
      const resolvedSrc = rawSrc ? this.resolveUrl(rawSrc) : undefined;
      const resolvedHref = rawHref ? this.resolveUrl(rawHref) : undefined;
      const role = extractOptionalAttribute(node, 'role');
      const sourceName = inferSourceName(node, textContent);

      const element: IRElement = {
        id: elementId,
        parentId,
        type: elementType,
        bounds: {
          x: left,
          y: top,
          width: width ?? 0,
          height: height ?? 0,
        },
        styles: inlineStyles,
        ...(textContent ? { textContent } : {}),
        source: {
          tagName,
          className,
          id: node.attr('id') || undefined,
          role,
          name: sourceName,
          dataAttributes: extractAttributes(node, 'data-'),
          ariaAttributes: extractAttributes(node, 'aria-'),
          // 提取HTML元素核心属性（URL已解析为绝对路径）
          src: resolvedSrc,
          href: resolvedHref,
          alt: node.attr('alt') || undefined,
          target: node.attr('target') || undefined,
          rel: node.attr('rel') || undefined,
          type: node.attr('type') || undefined,
          placeholder: node.attr('placeholder') || undefined,
          value: node.attr('value') || undefined,
        },
      };

      elements[elementId] = element;

      const childIds: string[] = [];
      const children = node.children();
      children.each((childIdx) => {
        const childElementId = walk(children.eq(childIdx), elementId, depth + 1, childIdx);
        childIds.push(childElementId);
      });

      if ((width ?? 0) <= 0 || (height ?? 0) <= 0) {
        const inferredSize = inferElementSize({
          elementType,
          textContent,
          x: left,
          y: top,
          fontSize: inlineStyles.fontSize,
          fontFamily: inlineStyles.fontFamily,
          lineHeight: inlineStyles.lineHeight,
          childIds,
          elements,
        });

        if ((width ?? 0) <= 0) {
          width = inferredSize.width;
        }
        if ((height ?? 0) <= 0) {
          height = inferredSize.height;
        }

        element.bounds.width = Math.max(1, width ?? 1);
        element.bounds.height = Math.max(1, height ?? 1);
      }

      return elementId;
    };

    const rootElementId = bodyRoot.length > 0
      ? bodyChildCandidates.length === 1
        ? walk(bodyChildCandidates.first(), null, 0, 0)
        : (() => {
            const syntheticRootId = createUniqueElementId('root');
            const syntheticRoot: IRElement = {
              id: syntheticRootId,
              parentId: null,
              type: 'container',
              bounds: { x: 0, y: 0, width: 0, height: 0 },
              styles: {},
              source: {
                tagName: 'root',
              },
            };
            elements[syntheticRootId] = syntheticRoot;

            bodyChildCandidates.each((index) => {
              walk(bodyChildCandidates.eq(index), syntheticRootId, 1, index);
            });

            return syntheticRootId;
          })()
      : (() => {
          const syntheticRootId = createUniqueElementId('root');
          const syntheticRoot: IRElement = {
            id: syntheticRootId,
            parentId: null,
            type: 'container',
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            styles: {},
            source: {
              tagName: 'root',
            },
          };
          elements[syntheticRootId] = syntheticRoot;

          topLevelCandidates.each((index) => {
            walk(topLevelCandidates.eq(index), syntheticRootId, 1, index);
          });

          return syntheticRootId;
        })();

    const ir: IntermediateRepresentation = {
      version: this.irVersion,
      rootElementId,
      elements,
      metadata: {
        title: $('title').first().text() || undefined,
        generatedAt: new Date().toISOString(),
      },
    };

    if (!isValidIR(ir)) {
      throw new Error(`Generated IR is invalid: ${getIRValidationErrors(ir).join('; ')}`);
    }

    return ir;
  }

  /**
   * 从本地文件读取并解析 HTML。
   */
  async parseFromFile(filePath: string): Promise<IntermediateRepresentation> {
    const fsModulePath = this.isNodeRuntime()
      ? ['node:fs', 'promises'].join('/')
      : ['fs', 'promises'].join('/');
    const fsModule = await import(fsModulePath) as {
      readFile(path: string, encoding: BufferEncoding): Promise<string>;
    };
    const html = await fsModule.readFile(filePath, 'utf-8');
    return this.parseAsync(html);
  }

  /**
   * 解析相对URL为绝对URL。
   */
  private resolveUrl(url: string): string {
    if (!this.baseUrl) {
      return url;
    }

    // 如果已经是绝对URL（http/https/data等），直接返回
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      return url;
    }

    // 如果是协议相对URL（//example.com/path），添加协议
    if (url.startsWith('//')) {
      try {
        const baseUrlObj = new URL(this.baseUrl);
        return `${baseUrlObj.protocol}${url}`;
      } catch {
        return url;
      }
    }

    // 解析相对URL
    try {
      return new URL(url, this.baseUrl).toString();
    } catch {
      // 如果解析失败，返回原始URL
      return url;
    }
  }
}

function extractAttributes(node: cheerio.Cheerio<AnyNode>, prefix: string): Record<string, string> | undefined {
  const firstNode = node.get(0);
  if (!firstNode || typeof firstNode !== 'object') {
    return undefined;
  }

  const rawAttribs = (firstNode as { attribs?: unknown }).attribs;
  if (!rawAttribs || typeof rawAttribs !== 'object') {
    return undefined;
  }

  const raw = rawAttribs as Record<string, unknown>;
  const picked: Record<string, string> = {};

  Object.entries(raw).forEach(([key, value]) => {
    if (key.startsWith(prefix) && typeof value === 'string') {
      picked[key] = value;
    }
  });

  if (Object.keys(picked).length === 0) {
    return undefined;
  }

  return picked;
}

function extractOptionalAttribute(
  node: cheerio.Cheerio<AnyNode>,
  attributeName: string
): string | undefined {
  const raw = node.attr(attributeName);
  if (typeof raw !== 'string') {
    return undefined;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function inferSourceName(
  node: cheerio.Cheerio<AnyNode>,
  textContent?: string
): string | undefined {
  const candidates = [
    extractOptionalAttribute(node, 'name'),
    extractOptionalAttribute(node, 'aria-label'),
    extractOptionalAttribute(node, 'alt'),
    extractOptionalAttribute(node, 'placeholder'),
    textContent,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function toFinitePositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function parseDimensionAttribute(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseFloat(value.replace(/px$/i, '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

/**
 * 估算文本宽度（改进版）
 * 考虑字体族、字符类型等因素
 */
function estimateTextWidth(text: string, fontSize: number, fontFamily?: string): number {
  const charCount = Math.max(text.length, 1);

  // 检测是否包含中文字符
  const hasCJK = /[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff]/.test(text);

  // 根据字体和字符类型调整系数
  let widthFactor = 0.6; // 默认英文字符宽度系数

  if (hasCJK) {
    // 中文字符通常是等宽的，接近 1em
    widthFactor = 0.9;
  } else if (fontFamily?.toLowerCase().includes('mono')) {
    // 等宽字体
    widthFactor = 0.6;
  } else {
    // 比例字体（如 Arial, Helvetica）
    widthFactor = 0.55;
  }

  // 计算宽度：字符数 × 字号 × 宽度系数 + 内边距
  return Math.ceil(charCount * fontSize * widthFactor + 16);
}

/**
 * 估算文本高度（改进版）
 */
function estimateTextHeight(fontSize: number, lineHeight?: number): number {
  // 如果有行高，使用行高
  if (lineHeight && typeof lineHeight === 'number') {
    return Math.ceil(lineHeight + 8);
  }

  // 否则使用默认行高（1.2-1.5倍字号）
  return Math.ceil(fontSize * 1.4 + 8);
}

function inferElementSize(options: {
  elementType: IRElementType;
  textContent?: string;
  x: number;
  y: number;
  fontSize: unknown;
  fontFamily?: unknown;
  lineHeight?: unknown;
  childIds: string[];
  elements: Record<string, IRElement>;
}): { width: number; height: number } {
  const inferredFromChildren = inferSizeFromChildren(options.x, options.y, options.childIds, options.elements);
  const fontSize = toFinitePositiveNumber(options.fontSize) ?? 14;
  const fontFamily = typeof options.fontFamily === 'string' ? options.fontFamily : undefined;
  const lineHeight = toFinitePositiveNumber(options.lineHeight);

  if (options.elementType === 'image') {
    return {
      width: inferredFromChildren?.width ?? 100,
      height: inferredFromChildren?.height ?? 100,
    };
  }

  if (options.textContent) {
    return {
      width: inferredFromChildren?.width ?? estimateTextWidth(options.textContent, fontSize, fontFamily),
      height: inferredFromChildren?.height ?? estimateTextHeight(fontSize, lineHeight),
    };
  }

  if (inferredFromChildren) {
    return inferredFromChildren;
  }

  return { width: 1, height: 1 };
}

function inferSizeFromChildren(
  parentX: number,
  parentY: number,
  childIds: string[],
  elements: Record<string, IRElement>
): { width: number; height: number } | null {
  if (childIds.length === 0) {
    return null;
  }

  let maxRight = parentX;
  let maxBottom = parentY;
  let hasValidChild = false;

  childIds.forEach((childId) => {
    const child = elements[childId];
    if (!child) {
      return;
    }

    if (child.bounds.width <= 0 || child.bounds.height <= 0) {
      return;
    }

    hasValidChild = true;
    maxRight = Math.max(maxRight, child.bounds.x + child.bounds.width);
    maxBottom = Math.max(maxBottom, child.bounds.y + child.bounds.height);
  });

  if (!hasValidChild) {
    return null;
  }

  const width = Math.ceil(maxRight - parentX);
  const height = Math.ceil(maxBottom - parentY);

  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}
