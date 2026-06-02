// NOTE(vendored): sync parse() and JSDOM/lightweight path removed — Forma uses
// the Puppeteer path exclusively. Use parseAsync() or PuppeteerParser directly.
// HTMLParser is kept for internal use but its parse() method throws; downstream
// callers should use parseAsync(html) or construct PuppeteerParser directly.
export type { HTMLParserOptions } from './parser';

// 导出计算样式相关功能
export {
  ComputedStyleCalculator,
  computeElementStyle,
  computeAllStyles,
  type ComputedStyleOptions,
  type ComputedStyleResult,
} from './computed-style';

// 导出 Tailwind CSS 预处理器
export {
  preprocessTailwindCSS,
  type TailwindPreprocessResult,
} from './tailwind-preprocessor';

// 导出 Puppeteer 解析器（推荐入口）
export {
  PuppeteerParser,
  VIEWPORT_PRESETS,
  type PuppeteerParserOptions,
  type ViewportPreset,
} from './puppeteer-parser';

// 导出 CSS 变量解析相关功能
export {
  CSSVariableParser,
  cssVariableParser,
  extractCSSVariableReferences,
  type CSSVariable,
} from './style';

// 导出元素类型和样式解析工具
export {
  extractElementType,
  parseInlineStyle,
} from './style';

// 导出响应式检测相关功能
export {
  ResponsiveDetector,
  responsiveDetector,
  extractBreakpointsFromCSS,
  STANDARD_BREAKPOINTS,
  type BreakpointName,
  type ParsedMediaQuery,
  type MediaQueryCondition,
  type ResponsiveStyleChange,
} from './responsive';

// 导出高级解析功能
export {
  AdvancedStyleExtractor,
  advancedStyleExtractor,
  WaitStrategyManager,
  type WaitStrategy,
  type WaitStrategyOptions,
  ShadowDOMDetector,
  type ShadowDOMInfo,
  type SlotInfo,
  AnimationExtractor,
  TransformExtractor,
  EffectsExtractor,
} from './advanced-parsing';

/**
 * Async parse via Puppeteer (accurate, Node.js runtime required).
 *
 * This is the only supported parse entry-point in the Forma fork.
 * The sync (cheerio) and JSDOM lightweight paths have been removed.
 */
export async function parseAsync(
  html: string,
  options?: import('./parser').HTMLParserOptions
): Promise<import('@vzi-core/types').IntermediateRepresentation> {
  const { HTMLParser } = await import('./parser.js');
  const parser = new HTMLParser({ ...options, reusePuppeteer: false });
  try {
    return await parser.parseAsync(html);
  } finally {
    await parser.dispose();
  }
}
