/**
 * 计算样式模块 - 使用 JSDOM 的 getComputedStyle 获取元素的计算样式
 *
 * 说明：
 * - 使用 JSDOM 创建虚拟 DOM 环境
 * - 通过 window.getComputedStyle 获取计算后的 CSS 样式
 * - 支持样式继承和默认值
 */

import type { IRStyles, IRBounds, IRPseudoElement } from '@vzi-core/types';
import { JSDOM } from 'jsdom';

/**
 * JSDOM 虚拟 DOM 环境配置
 */
export interface ComputedStyleOptions {
  /** 默认视口宽度 */
  viewportWidth?: number;
  /** 默认视口高度 */
  viewportHeight?: number;
  /** 基础 URL，用于解析相对路径 */
  baseUrl?: string;
  /** 等待 load 事件的超时时间（ms），默认 10000 */
  loadTimeoutMs?: number;
  /** 等待外部 CSS 加载的额外时间（ms），默认 500 */
  cssWaitMs?: number;
}

/**
 * 计算样式结果
 */
export interface ComputedStyleResult {
  /** 元素样式 */
  styles: IRStyles;
  /** 伪元素样式（::before, ::after） */
  pseudoElements?: {
    before?: IRPseudoElement;
    after?: IRPseudoElement;
  };
  /** 元素边界（包含位置和尺寸） */
  bounds: IRBounds;
}

/**
 * 需要提取的 CSS 属性列表
 * 包含所有影响布局和视觉呈现的关键属性
 */
const CSS_PROPERTIES_TO_EXTRACT = [
  // 布局
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'float',
  'clear',
  'z-index',

  // Flexbox
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'align-content',
  'gap',
  'row-gap',
  'column-gap',

  // Grid
  'grid-template-columns',
  'grid-template-rows',
  'grid-gap',

  // 尺寸
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',

  // 间距
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',

  // 边框
  'border',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',

  // 背景
  'background',
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'background-repeat',

  // 文字
  'color',
  'font',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'text-align',
  'text-decoration',
  'text-transform',
  'letter-spacing',
  'word-spacing',
  'white-space',

  // 效果
  'opacity',
  'box-shadow',
  'text-shadow',
  'filter',
  'backdrop-filter',

  // 变换
  'transform',
  'transform-origin',

  // 过渡和动画
  'transition',
  'animation',

  // 其他
  'overflow',
  'overflow-x',
  'overflow-y',
  'visibility',
  'cursor',
  'pointer-events',
  'object-fit',
  'object-position',
];

/**
 * 创建 JSDOM 虚拟 DOM 环境并计算样式
 */
export class ComputedStyleCalculator {
  private dom: JSDOM | null = null;
  private document: Document | null = null;
  private window: Window | null = null;
  private options: ComputedStyleOptions;

  constructor(options: ComputedStyleOptions = {}) {
    this.options = {
      viewportWidth: 1920,
      viewportHeight: 1080,
      loadTimeoutMs: 10000,
      cssWaitMs: 500,
      ...options,
    };
  }

  /**
   * 初始化 JSDOM 环境
   * @param html 完整的 HTML 文档字符串
   */
  async initialize(html: string): Promise<void> {
    // 注意：JSDOM 无法可靠执行 Tailwind CSS Play CDN 等动态脚本
    // 这些脚本依赖完整的浏览器环境，在 JSDOM 中会崩溃
    // 建议用户：
    // 1. 使用 Tailwind CLI 预编译 CSS 并内联到 HTML
    // 2. 使用 --static 参数进行静态解析（快速但可能不准确）
    // 3. 使用真实浏览器环境（如 Puppeteer）

    this.dom = new JSDOM(html, {
      runScripts: 'outside-only',  // 不执行脚本，避免崩溃
      resources: 'usable',          // 允许加载外部CSS
      pretendToBeVisual: true,
      url: this.options.baseUrl || 'http://localhost',
      beforeParse: (window) => {
        // 设置视口尺寸
        Object.defineProperty(window, 'innerWidth', {
          value: this.options.viewportWidth,
          writable: false,
        });
        Object.defineProperty(window, 'innerHeight', {
          value: this.options.viewportHeight,
          writable: false,
        });
      },
    });

    this.window = this.dom.window as unknown as Window;
    this.document = this.dom.window.document;

    // 等待 DOM 完全解析和外部资源加载（带超时保护，防止外部 CSS 永久挂起）
    const loadTimeoutMs = this.options.loadTimeoutMs ?? 10000;
    await new Promise<void>((resolve) => {
      if (this.document?.readyState === 'complete') {
        resolve();
        return;
      }
      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const settle = (): void => {
        if (!settled) {
          settled = true;
          if (timeoutHandle !== undefined) {
            clearTimeout(timeoutHandle);
            timeoutHandle = undefined;
          }
          this.window?.removeEventListener('load', settle);
          resolve();
        }
      };
      this.window?.addEventListener('load', settle);
      timeoutHandle = setTimeout(() => {
        if (!settled) {
          console.warn(
            `[computed-style] JSDOM load event timed out after ${loadTimeoutMs}ms; ` +
            'continuing with partial styles. Check for unreachable external CSS resources.'
          );
          settle();
        }
      }, loadTimeoutMs);
    });

    // 等待外部CSS加载（可配置）
    const cssWaitMs = this.options.cssWaitMs ?? 500;
    if (cssWaitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, cssWaitMs));
    }
  }

  /**
   * 计算指定元素的计算样式
   * @param selector CSS 选择器或元素引用
   * @param element 可选的直接元素引用
   */
  computeStyle(selector?: string, element?: Element): ComputedStyleResult | null {
    if (!this.window || !this.document) {
      throw new Error('JSDOM environment not initialized. Call initialize() first.');
    }

    const targetElement = element || (selector ? this.document.querySelector(selector) : null);
    if (!targetElement) {
      return null;
    }

    const computedStyle = this.window.getComputedStyle(targetElement);
    const styles = this.extractStyles(computedStyle);
    const bounds = this.extractBounds(targetElement, computedStyle);
    const pseudoElements = this.extractPseudoElements(targetElement);

    return {
      styles,
      bounds,
      pseudoElements: Object.keys(pseudoElements).length > 0 ? pseudoElements : undefined,
    };
  }

  /**
   * 批量计算多个元素的计算样式
   * @param selectors CSS 选择器数组
   */
  computeStyles(selectors: string[]): Map<string, ComputedStyleResult> {
    const results = new Map<string, ComputedStyleResult>();

    for (const selector of selectors) {
      const elements = this.document?.querySelectorAll(selector);
      elements?.forEach((element, index) => {
        const key = `${selector}[${index}]`;
        const result = this.computeStyle(undefined, element);
        if (result) {
          results.set(key, result);
        }
      });
    }

    return results;
  }

  /**
   * 从 CSSStyleDeclaration 提取样式
   */
  private extractStyles(computedStyle: CSSStyleDeclaration): IRStyles {
    const styles: IRStyles = {};

    for (const property of CSS_PROPERTIES_TO_EXTRACT) {
      const value = computedStyle.getPropertyValue(property);
      if (value && value !== 'initial' && value !== 'inherit') {
        const camelCaseProperty = this.toCamelCase(property);
        styles[camelCaseProperty] = this.parseStyleValue(value);
      }
    }

    return styles;
  }

  /**
   * 提取元素边界信息
   */
  private extractBounds(element: Element, computedStyle: CSSStyleDeclaration): IRBounds {
    // 对于 HTML 元素，尝试获取其实际位置和尺寸
    const htmlElement = element as HTMLElement;

    // 获取计算后的尺寸
    let width = this.parsePixelValue(computedStyle.width);
    let height = this.parsePixelValue(computedStyle.height);

    // 如果 width/height 为 auto 或无效，尝试使用 getBoundingClientRect
    if ((!width || width <= 0) && typeof htmlElement.getBoundingClientRect === 'function') {
      const rect = htmlElement.getBoundingClientRect();
      width = rect.width || 0;
      height = rect.height || 0;
    }

    // 获取位置
    const position = computedStyle.position;
    let x = 0;
    let y = 0;

    if (position === 'absolute' || position === 'fixed') {
      x = this.parsePixelValue(computedStyle.left) || 0;
      y = this.parsePixelValue(computedStyle.top) || 0;
    } else if (typeof htmlElement.getBoundingClientRect === 'function') {
      const rect = htmlElement.getBoundingClientRect();
      x = rect.left || 0;
      y = rect.top || 0;
    }

    return {
      x,
      y,
      width: Math.max(0, width),
      height: Math.max(0, height),
    };
  }

  /**
   * 提取伪元素样式
   */
  private extractPseudoElements(_element: Element): {
    before?: IRPseudoElement;
    after?: IRPseudoElement;
  } {
    const result: { before?: IRPseudoElement; after?: IRPseudoElement } = {};

    // JSDOM 不支持 getComputedStyle 的第二个参数（伪元素）
    // 暂时禁用伪元素提取以避免错误
    // TODO: 在真实浏览器环境中重新启用
    return result;

    /* 原始代码 - JSDOM 不支持
    if (!this.window) {
      return result;
    }

    try {
      // 提取 ::before
      // 注意：JSDOM 不支持 getComputedStyle 的第二个参数（伪元素）
      // 如果运行在 JSDOM 环境中，这里会抛出 "Not implemented" 错误
      const beforeStyle = this.window.getComputedStyle(element, '::before');
      if (beforeStyle.content && beforeStyle.content !== 'none') {
        result.before = {
          content: this.parseContentValue(beforeStyle.content),
          styles: this.extractStyles(beforeStyle),
        };
      }
    } catch (error) {
      // JSDOM 不支持伪元素，跳过
      // 这不影响主要功能，只是无法提取伪元素样式
    }

    try {
      // 提取 ::after
      const afterStyle = this.window.getComputedStyle(element, '::after');
      if (afterStyle.content && afterStyle.content !== 'none') {
        result.after = {
          content: this.parseContentValue(afterStyle.content),
          styles: this.extractStyles(afterStyle),
        };
      }
    } catch (error) {
      // JSDOM 不支持伪元素，跳过
    }

    return result;
    */
  }

  /**
   * 解析 content 属性值
   */
  private parseContentValue(content: string): string {
    // 移除引号
    if ((content.startsWith('"') && content.endsWith('"')) ||
        (content.startsWith("'") && content.endsWith("'"))) {
      return content.slice(1, -1);
    }
    return content;
  }

  /**
   * 解析像素值
   */
  private parsePixelValue(value: string): number {
    if (!value || value === 'auto' || value === 'none') {
      return 0;
    }
    const match = value.match(/^(-?[\d.]+)px$/);
    return match ? parseFloat(match[1]) : 0;
  }

  /**
   * 解析样式值
   * 保留 CSS 变量（var(--name)）和复杂值，只转换简单的数字和像素值
   */
  private parseStyleValue(value: string): string | number {
    // 如果包含 CSS 变量，保留原值
    if (value.includes('var(')) {
      return value;
    }

    // 如果包含 calc()、rgb()、rgba() 等函数，保留原值
    if (/^(calc|rgb|rgba|hsl|hsla|url|linear-gradient|radial-gradient)\(/i.test(value)) {
      return value;
    }

    // 尝试解析为纯数字
    if (/^-?[\d.]+$/.test(value)) {
      return parseFloat(value);
    }

    // 尝试解析像素值
    const pxMatch = value.match(/^(-?[\d.]+)px$/);
    if (pxMatch) {
      return parseFloat(pxMatch[1]);
    }

    return value;
  }

  /**
   * 转换为驼峰命名
   */
  private toCamelCase(property: string): string {
    return property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  }

  /**
   * 获取当前 JSDOM 环境中的 document
   */
  getDocument(): Document | null {
    return this.document;
  }

  /**
   * 获取当前 JSDOM 环境中的 window
   */
  getWindow(): Window | null {
    return this.window;
  }

  /**
   * 清理 JSDOM 环境
   */
  dispose(): void {
    if (this.dom) {
      this.dom.window.close();
      this.dom = null;
      this.document = null;
      this.window = null;
    }
  }
}

/**
 * 便捷函数：计算单个 HTML 元素的样式
 * @param html 完整的 HTML 文档
 * @param selector 目标元素选择器
 * @param options 计算选项
 */
export async function computeElementStyle(
  html: string,
  selector: string,
  options?: ComputedStyleOptions
): Promise<ComputedStyleResult | null> {
  const calculator = new ComputedStyleCalculator(options);
  try {
    await calculator.initialize(html);
    return calculator.computeStyle(selector);
  } finally {
    calculator.dispose();
  }
}

/**
 * 便捷函数：计算 HTML 中所有指定元素的样式
 * @param html 完整的 HTML 文档
 * @param selectors 选择器数组
 * @param options 计算选项
 */
export async function computeAllStyles(
  html: string,
  selectors: string[],
  options?: ComputedStyleOptions
): Promise<Map<string, ComputedStyleResult>> {
  const calculator = new ComputedStyleCalculator(options);
  try {
    await calculator.initialize(html);
    return calculator.computeStyles(selectors);
  } finally {
    calculator.dispose();
  }
}
