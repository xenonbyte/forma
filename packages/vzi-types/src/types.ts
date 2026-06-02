/**
 * IR（Intermediate Representation）核心类型定义
 */

/**
 * 元素类型（使用字符串字面量联合类型）
 */
export type IRElementType = 'container' | 'text' | 'image' | 'button' | 'input' | 'link';

/**
 * @deprecated 使用 IRElementType 字符串字面量类型
 */
export const IRElementType = {
  CONTAINER: 'container' as const,
  TEXT: 'text' as const,
  IMAGE: 'image' as const,
  BUTTON: 'button' as const,
  INPUT: 'input' as const,
  LINK: 'link' as const,
};

export interface IRBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type IRStyleValue = string | number | null;

/**
 * 样式对象
 *
 * 说明：
 * - 由于 CSS 属性集合非常庞大且会持续扩展，使用索引签名覆盖全部属性。
 * - 同时声明常见属性，便于调用方获得更好的类型提示。
 */
export interface IRStyles {
  [property: string]: IRStyleValue | undefined;
  display?: IRStyleValue;
  position?: IRStyleValue;
  top?: IRStyleValue;
  right?: IRStyleValue;
  bottom?: IRStyleValue;
  left?: IRStyleValue;
  width?: IRStyleValue;
  height?: IRStyleValue;
  margin?: IRStyleValue;
  padding?: IRStyleValue;
  border?: IRStyleValue;
  borderRadius?: IRStyleValue;
  background?: IRStyleValue;
  backgroundColor?: IRStyleValue;
  color?: IRStyleValue;
  fontSize?: IRStyleValue;
  fontWeight?: IRStyleValue;
  lineHeight?: IRStyleValue;
  textAlign?: IRStyleValue;
  opacity?: IRStyleValue;
  zIndex?: IRStyleValue;
  transform?: IRStyleValue;
  filter?: IRStyleValue;
  boxShadow?: IRStyleValue;
}

export interface IRSource {
  tagName?: string;
  className?: string;
  id?: string;
  role?: string;
  name?: string;
  dataAttributes?: Record<string, string>;
  ariaAttributes?: Record<string, string>;
  // HTML元素核心属性
  src?: string;
  href?: string;
  alt?: string;
  target?: string;
  rel?: string;
  type?: string;
  placeholder?: string;
  value?: string;
}

export interface IRPseudoElement {
  content?: string;
  styles?: IRStyles;
}

export interface IRResponsive {
  breakpoints?: number[];
  mediaQueries?: string[];
}

export interface IRTransition {
  property: string;
  duration: string;
  timingFunction?: string;
  delay?: string;
}

export interface IRKeyframeStep {
  offset: string;
  styles: IRStyles;
}

export interface IRKeyframe {
  name: string;
  steps: IRKeyframeStep[];
}

export interface IRAnimations {
  transitions?: IRTransition[];
  keyframes?: IRKeyframe[];
}

export interface IRTransform {
  matrix?: number[];
  translate?: { x: number; y: number; z?: number };
  rotate?: { x?: number; y?: number; z?: number };
  scale?: { x: number; y: number; z?: number };
}

export interface IRShadow {
  x: number;
  y: number;
  blur: number;
  spread?: number;
  color: string;
  inset?: boolean;
}

export interface IREffects {
  filters?: string[];
  shadows?: IRShadow[];
}

export interface IRMetadata {
  semanticRole?: string;
  designSystem?: string;
  componentName?: string;
  [key: string]: unknown;
  /** 深度截断限制（当 DOM 深度超过限制时记录） */
  truncatedAtDepth?: number;
}

/**
 * SVG 路径元素
 */
export interface SVGPath {
  /** path 的 d 属性 */
  d: string;
  /** 填充色 */
  fill?: string;
  /** 描边色 */
  stroke?: string;
  /** 描边宽度 */
  strokeWidth?: number;
  /** 虚线样式（如 "10 4"） */
  strokeDasharray?: string;
  /** 虚线偏移 */
  strokeDashoffset?: number;
  /** 线帽样式 */
  strokeLinecap?: string;
  /** 填充规则 */
  fillRule?: 'nonzero' | 'evenodd';
  /** 透明度 */
  opacity?: number;
}

/**
 * SVG 圆形元素
 */
export interface SVGCircle {
  cx: number;
  cy: number;
  r: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  strokeDashoffset?: number;
  strokeLinecap?: string;
  opacity?: number;
}

/**
 * SVG 矩形元素
 */
export interface SVGRect {
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  ry?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

/**
 * SVG 多边形元素
 */
export interface SVGPolygon {
  points: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

/**
 * SVG 矢量数据
 */
export interface SVGData {
  /** viewBox 属性 */
  viewBox?: string;
  /** preserveAspectRatio 属性 */
  preserveAspectRatio?: string;
  /** SVG path 元素 */
  paths: SVGPath[];
  /** SVG circle 元素 */
  circles?: SVGCircle[];
  /** SVG rect 元素 */
  rects?: SVGRect[];
  /** SVG polygon 元素 */
  polygons?: SVGPolygon[];
}

/**
 * 图片数据
 */
export interface ImageData {
  /** 图片源（URL 或 base64） */
  src: string;
  /** 图片原始宽度 */
  naturalWidth: number;
  /** 图片原始高度 */
  naturalHeight: number;
  /** 图片格式 */
  format?: 'png' | 'jpg' | 'jpeg' | 'svg' | 'webp' | 'gif' | 'bmp';
  /** 是否为 base64 内联图片 */
  isBase64?: boolean;
  /** alt 文本 */
  alt?: string;
}

export interface IRElement {
  id: string;
  parentId: string | null;
  type: IRElementType;
  bounds: IRBounds;
  styles: IRStyles;
  textContent?: string;

  source?: IRSource;
  pseudoElements?: {
    before?: IRPseudoElement;
    after?: IRPseudoElement;
  };
  responsive?: IRResponsive;
  animations?: IRAnimations;
  transform?: IRTransform;
  effects?: IREffects;
  metadata?: IRMetadata;

  /** SVG 矢量数据（仅当元素是 SVG 时存在） */
  svgData?: SVGData;
  /** 图片数据（仅当元素是 img 时存在） */
  imageData?: ImageData;
}

export interface IRDocumentMetadata {
  title?: string;
  sourceUrl?: string;
  viewport?: {
    width: number;
    height: number;
  };
  generatedAt?: string;
  [key: string]: unknown;
}

export interface IntermediateRepresentation {
  version: string;
  rootElementId: string;
  elements: Record<string, IRElement>;
  metadata?: IRDocumentMetadata;
}
