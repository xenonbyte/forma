// NOTE(vendored): sync parse() and JSDOM/lightweight path removed — Forma uses
// PuppeteerParser exclusively. Use PuppeteerParser.parse() for accurate layout.
import { HTMLParser as HTMLParserClass, type HTMLParserOptions } from './parser';

// 直接导出，避免 re-export 问题
export const HTMLParser = HTMLParserClass;
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

// 导出 Puppeteer 解析器
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
 * Async parse via Puppeteer (accurate) or JSDOM (fallback when usePuppeteer is
 * not set). For Forma use always construct PuppeteerParser directly — it
 * guarantees the Puppeteer path.
 *
 * @deprecated Prefer PuppeteerParser directly.
 */
export async function parseAsync(
  html: string,
  options?: HTMLParserOptions
): Promise<import('@vzi-core/types').IntermediateRepresentation> {
  const parser = new HTMLParser(options);
  return parser.parseAsync(html);
}
