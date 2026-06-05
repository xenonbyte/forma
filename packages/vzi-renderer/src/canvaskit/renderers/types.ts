/**
 * CanvasKit 渲染器类型定义
 */

import type { CanvasKit, Canvas } from "canvaskit-wasm";

/**
 * IR 元素边界
 */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * IR 元素样式（简化版）
 */
export interface Styles {
  // 背景
  backgroundColor?: string;
  backgroundImage?: string;

  // 边框
  borderWidth?: string | number;
  borderColor?: string;
  borderStyle?: string;
  borderRadius?: string | number;

  // 阴影
  boxShadow?: string;

  // 文本
  fontFamily?: string;
  fontSize?: string | number;
  fontWeight?: string | number;
  fontStyle?: string;
  color?: string;
  textAlign?: string;
  textDecoration?: string;
  lineHeight?: string | number;

  // 其他
  opacity?: number;
  [key: string]: string | number | undefined;
}

/**
 * IR 元素（简化版）
 */
export interface IRElement {
  id: string;
  type: string;
  bounds: Bounds;
  styles: Styles;
  textContent?: string;
  children?: IRElement[];
  // SVG 特有
  svgData?: string;
  // 图片特有
  src?: string;
}

/**
 * 元素渲染器接口
 */
export interface IElementRenderer {
  /**
   * 渲染元素
   */
  render(canvas: Canvas, element: IRElement, CanvasKit: CanvasKit): void;

  /**
   * 检查是否可以渲染该类型的元素
   */
  canRender(type: string): boolean;
}

/**
 * 渲染上下文
 */
export interface RenderContext {
  CanvasKit: CanvasKit;
  canvas: Canvas;
  bounds: Bounds;
}
