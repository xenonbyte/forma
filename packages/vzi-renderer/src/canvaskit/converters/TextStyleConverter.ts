/**
 * 文本样式转换器
 *
 * 将 CSS 文本样式转换为 CanvasKit Font 和 Paint
 */

import type { CanvasKit, Font, Paint, FontWeight } from "canvaskit-wasm";
import { toCanvasKitColor } from "./ColorConverter";
import { FontManager } from "../FontManager";

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  color: string;
  textAlign: "left" | "center" | "right";
  textDecoration: string[];
  lineHeight: number;
}

/**
 * 解析字体大小
 */
export function parseFontSize(fontSize: string | number): number {
  if (typeof fontSize === "number") {
    return fontSize;
  }

  const trimmed = fontSize.trim();
  if (trimmed.endsWith("px")) {
    return parseFloat(trimmed);
  }

  if (trimmed.endsWith("pt")) {
    return parseFloat(trimmed) * 1.333; // pt to px
  }

  if (trimmed.endsWith("em")) {
    return parseFloat(trimmed) * 16; // 假设基础字体 16px
  }

  return parseFloat(trimmed) || 16;
}

/**
 * 解析字体粗细
 */
export function parseFontWeight(fontWeight: string | number): number {
  if (typeof fontWeight === "number") {
    return fontWeight;
  }

  const trimmed = fontWeight.trim().toLowerCase();

  const weightMap: Record<string, number> = {
    thin: 100,
    extralight: 200,
    light: 300,
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
    black: 900,
  };

  return weightMap[trimmed] || parseInt(trimmed) || 400;
}

/**
 * 解析字体样式
 */
export function parseFontStyle(fontStyle: string): "normal" | "italic" {
  const style = fontStyle.trim().toLowerCase();
  return style === "italic" || style === "oblique" ? "italic" : "normal";
}

/**
 * 解析文本对齐
 */
export function parseTextAlign(textAlign: string): "left" | "center" | "right" {
  const align = textAlign.trim().toLowerCase();
  if (align === "center") return "center";
  if (align === "right") return "right";
  return "left";
}

/**
 * 解析文本装饰
 */
export function parseTextDecoration(textDecoration: string): string[] {
  if (!textDecoration || textDecoration === "none") {
    return [];
  }

  const decorations: string[] = [];
  const trimmed = textDecoration.trim().toLowerCase();

  if (trimmed.includes("underline")) {
    decorations.push("underline");
  }

  if (trimmed.includes("line-through")) {
    decorations.push("line-through");
  }

  if (trimmed.includes("overline")) {
    decorations.push("overline");
  }

  return decorations;
}

/**
 * 解析行高
 */
export function parseLineHeight(lineHeight: string | number, fontSize: number): number {
  if (typeof lineHeight === "number") {
    return lineHeight;
  }

  const trimmed = lineHeight.trim();

  if (trimmed === "normal") {
    return fontSize * 1.2;
  }

  if (trimmed.endsWith("px")) {
    return parseFloat(trimmed);
  }

  if (trimmed.endsWith("%")) {
    return (parseFloat(trimmed) / 100) * fontSize;
  }

  // 数字倍数
  const multiplier = parseFloat(trimmed);
  if (!isNaN(multiplier)) {
    return multiplier * fontSize;
  }

  return fontSize * 1.2;
}

/**
 * 创建 Font 对象（异步版本，支持动态字体加载）
 */
export async function createFontAsync(
  fontFamily: string,
  fontSize: number,
  fontWeight: number,
  fontStyle: "normal" | "italic",
  CanvasKit: CanvasKit,
): Promise<Font | undefined> {
  try {
    // 使用 FontManager 根据 fontFamily 获取对应的字体
    const fontManager = FontManager.getInstance();
    const typeface = await fontManager.getTypeface(fontFamily);

    if (typeface) {
      return new CanvasKit.Font(typeface, fontSize);
    }

    // 最后的降级方案：使用 CanvasKit 默认 typeface
    console.warn("[createFontAsync] 无可用字体，使用 CanvasKit 默认字体");
    const defaultTypeface = CanvasKit.Typeface.GetDefault();
    return new CanvasKit.Font(defaultTypeface, fontSize);
  } catch (error) {
    console.error("[createFontAsync] ❌ 创建字体失败:", error);
    return undefined;
  }
}

/**
 * 创建 Font 对象（同步版本，使用预加载的字体）
 */
export function createFont(
  fontFamily: string,
  fontSize: number,
  fontWeight: number,
  fontStyle: "normal" | "italic",
  CanvasKit: CanvasKit,
): Font | undefined {
  try {
    // 使用 FontManager 获取预加载的字体（同步）
    const fontManager = FontManager.getInstance();
    let typeface = fontManager.getTypefaceSync(fontFamily);

    // 如果没有找到预加载的字体，使用默认字体
    if (!typeface) {
      console.warn(`[createFont] 字体 "${fontFamily}" 未预加载，使用默认字体`);
      typeface = fontManager.getDefaultTypeface();
    }

    // 如果 FontManager 未加载，降级到 CanvasKit 默认字体
    if (!typeface) {
      console.warn("[createFont] FontManager 未加载，使用 CanvasKit 默认字体");
      typeface = CanvasKit.Typeface.GetDefault();
    }

    if (typeface) {
      return new CanvasKit.Font(typeface, fontSize);
    }

    // 最后的降级方案：使用 CanvasKit 默认 typeface
    console.warn("[createFont] 无可用字体，使用 CanvasKit 默认字体");
    const defaultTypeface = CanvasKit.Typeface.GetDefault();
    return new CanvasKit.Font(defaultTypeface, fontSize);
  } catch (error) {
    console.error("[createFont] ❌ 创建字体失败:", error);
    return undefined;
  }
}

/**
 * 映射字体粗细到 CanvasKit 枚举
 *
 * @example
 * ```typescript
 * const ckWeight = mapFontWeight(700, CanvasKit);
 * // 返回 CanvasKit.FontWeight.Bold
 * ```
 */
export function mapFontWeight(weight: number, CanvasKit: CanvasKit): FontWeight {
  if (weight <= 100) return CanvasKit.FontWeight.Thin;
  if (weight <= 200) return CanvasKit.FontWeight.ExtraLight;
  if (weight <= 300) return CanvasKit.FontWeight.Light;
  if (weight <= 400) return CanvasKit.FontWeight.Normal;
  if (weight <= 500) return CanvasKit.FontWeight.Medium;
  if (weight <= 600) return CanvasKit.FontWeight.SemiBold;
  if (weight <= 700) return CanvasKit.FontWeight.Bold;
  if (weight <= 800) return CanvasKit.FontWeight.ExtraBold;
  return CanvasKit.FontWeight.Black;
}

/**
 * 创建文本 Paint
 */
export function createTextPaint(color: string, decorations: string[], CanvasKit: CanvasKit): Paint {
  const paint = new CanvasKit.Paint();
  paint.setColor(toCanvasKitColor(color, CanvasKit));
  paint.setStyle(CanvasKit.PaintStyle.Fill);
  paint.setAntiAlias(true);

  // TODO: 实现文本装饰（下划线、删除线等）
  // CanvasKit 不直接支持文本装饰，需要手动绘制线条

  return paint;
}

/**
 * 解析文本样式对象
 */
export function parseTextStyle(styles: Record<string, string | number | undefined>): TextStyle {
  const fontFamily = (styles.fontFamily || "sans-serif") as string;
  const fontSize = parseFontSize(styles.fontSize || 16);
  const fontWeight = parseFontWeight(styles.fontWeight || 400);
  const fontStyle = parseFontStyle((styles.fontStyle || "normal") as string);
  const color = (styles.color || "#000000") as string;
  const textAlign = parseTextAlign((styles.textAlign || "left") as string);
  const textDecoration = parseTextDecoration((styles.textDecoration || "none") as string);
  const lineHeight = parseLineHeight(styles.lineHeight || "normal", fontSize);

  return {
    fontFamily,
    fontSize,
    fontWeight,
    fontStyle,
    color,
    textAlign,
    textDecoration,
    lineHeight,
  };
}
