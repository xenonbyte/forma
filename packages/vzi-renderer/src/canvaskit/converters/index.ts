/**
 * 样式转换器
 *
 * 将 CSS 样式转换为 CanvasKit API 调用
 */

import type { CanvasKit, Paint, Shader, ImageFilter, Font, Path } from "canvaskit-wasm";

// 导出所有转换器
export * from "./ColorConverter";
export * from "./GradientConverter";
export * from "./BorderConverter";
export * from "./ShadowConverter";
export * from "./TextStyleConverter";

// 导入转换器函数
import { toCanvasKitColor } from "./ColorConverter";
import { parseGradient, createGradientShader } from "./GradientConverter";
import { parseBorder, createBorderPath, createBorderPaint } from "./BorderConverter";
import { parseShadow, createShadowFilters } from "./ShadowConverter";
import { parseTextStyle, createFont, createTextPaint } from "./TextStyleConverter";

/**
 * CanvasKit 样式对象
 */
export interface CanvasKitStyles {
  // 填充
  fillPaint?: Paint;
  fillShader?: Shader | null;

  // 边框
  strokePaint?: Paint;
  strokePath?: Path;

  // 阴影
  shadowFilter?: ImageFilter | null;

  // 文本
  font?: Font;
  textPaint?: Paint;
}

/**
 * CSS 样式对象（简化版）
 */
export interface CSSStyles {
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
  [key: string]: string | number | undefined;
}

/**
 * 转换样式对象
 *
 * 将 CSS 样式转换为 CanvasKit 样式对象
 *
 * @param styles - CSS 样式对象
 * @param bounds - 元素边界（用于渐变计算）
 * @param CanvasKit - CanvasKit 实例
 * @returns CanvasKit 样式对象
 */
export function convertStyles(
  styles: CSSStyles,
  bounds: { x: number; y: number; width: number; height: number },
  CanvasKit: CanvasKit,
): CanvasKitStyles {
  const result: CanvasKitStyles = {};

  // 1. 处理填充（背景色或渐变）
  if (styles.backgroundImage && styles.backgroundImage !== "none") {
    // 渐变背景
    const gradient = parseGradient(styles.backgroundImage);
    if (gradient) {
      result.fillShader = createGradientShader(gradient, bounds, CanvasKit);
      const paint = new CanvasKit.Paint();
      paint.setShader(result.fillShader);
      paint.setStyle(CanvasKit.PaintStyle.Fill);
      result.fillPaint = paint;
    }
  } else if (styles.backgroundColor) {
    // 纯色背景
    const paint = new CanvasKit.Paint();
    paint.setColor(toCanvasKitColor(styles.backgroundColor, CanvasKit));
    paint.setStyle(CanvasKit.PaintStyle.Fill);
    result.fillPaint = paint;
  }

  // 2. 处理边框
  if (styles.borderWidth && styles.borderColor) {
    const border = parseBorder(styles as Record<string, string | number>);
    result.strokePath = createBorderPath(bounds, border.radius, CanvasKit);
    result.strokePaint = createBorderPaint(border.color, border.width, border.style, CanvasKit);
  }

  // 3. 处理阴影
  if (styles.boxShadow) {
    const shadows = parseShadow(styles.boxShadow);
    result.shadowFilter = createShadowFilters(shadows, CanvasKit);
  }

  // 4. 处理文本样式
  if (styles.fontFamily || styles.fontSize) {
    const textStyle = parseTextStyle(styles as Record<string, string | number>);
    result.font = createFont(
      textStyle.fontFamily,
      textStyle.fontSize,
      textStyle.fontWeight,
      textStyle.fontStyle,
      CanvasKit,
    );
    result.textPaint = createTextPaint(textStyle.color, textStyle.textDecoration, CanvasKit);
  }

  return result;
}
