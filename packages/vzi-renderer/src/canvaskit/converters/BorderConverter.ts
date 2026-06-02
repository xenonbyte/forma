/**
 * 边框转换器
 *
 * 将 CSS 边框样式转换为 CanvasKit Path 和 Paint
 */

import type { CanvasKit, Path, Paint } from 'canvaskit-wasm';
import { toCanvasKitColor } from './ColorConverter';

export interface BorderStyle {
  width: number;
  color: string;
  style: 'solid' | 'dashed' | 'dotted';
  radius: number[];
}

function splitTokensOutsideParens(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of input) {
    if (char === '(') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ')') {
      if (depth > 0) {
        depth -= 1;
      }
      current += char;
      continue;
    }
    if (/\s/.test(char) && depth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        tokens.push(trimmed);
      }
      current = '';
      continue;
    }
    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    tokens.push(trimmed);
  }

  return tokens;
}

function isWidthToken(token: string): boolean {
  const lower = token.toLowerCase();
  return (
    lower === 'thin' ||
    lower === 'medium' ||
    lower === 'thick' ||
    /^-?\d+(\.\d+)?(px|em|rem|pt|pc|cm|mm|in|q|vh|vw|vmin|vmax|%)?$/.test(lower)
  );
}

function isColorToken(token: string): boolean {
  const lower = token.toLowerCase();
  const borderStyleKeywords = new Set([
    'none',
    'hidden',
    'dotted',
    'dashed',
    'solid',
    'double',
    'groove',
    'ridge',
    'inset',
    'outset',
  ]);
  if (borderStyleKeywords.has(lower)) {
    return false;
  }
  if (
    lower.startsWith('#') ||
    lower.startsWith('rgb(') ||
    lower.startsWith('rgba(') ||
    lower.startsWith('hsl(') ||
    lower.startsWith('hsla(') ||
    lower.startsWith('lab(') ||
    lower.startsWith('lch(') ||
    lower.startsWith('oklab(') ||
    lower.startsWith('oklch(') ||
    lower.startsWith('color(')
  ) {
    return true;
  }
  return lower === 'transparent' || lower === 'currentcolor' || /^[a-z-]+$/.test(lower);
}

function extractBorderTokens(border: string): {
  width?: string;
  style?: string;
  color?: string;
} {
  const tokens = splitTokensOutsideParens(border.trim());
  let width: string | undefined;
  let style: string | undefined;
  let color: string | undefined;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (!width && isWidthToken(lower)) {
      width = token;
      continue;
    }
    if (!style && (lower === 'solid' || lower === 'dashed' || lower === 'dotted' || lower === 'none')) {
      style = lower;
      continue;
    }
    if (!color && isColorToken(token)) {
      color = token;
      continue;
    }
  }

  return { width, style, color };
}

/**
 * 解析边框宽度
 */
export function parseBorderWidth(borderWidth: string | number): number {
  if (typeof borderWidth === 'number') {
    return borderWidth;
  }

  const trimmed = borderWidth.trim();
  if (trimmed === 'thin') return 1;
  if (trimmed === 'medium') return 2;
  if (trimmed === 'thick') return 4;
  if (trimmed.endsWith('px')) {
    return parseFloat(trimmed);
  }

  return parseFloat(trimmed) || 0;
}

/**
 * 解析边框样式
 */
export function parseBorderStyle(borderStyle: string): 'solid' | 'dashed' | 'dotted' {
  const style = borderStyle.trim().toLowerCase();
  if (style === 'dashed') return 'dashed';
  if (style === 'dotted') return 'dotted';
  return 'solid';
}

/**
 * 解析边框圆角
 */
export function parseBorderRadius(borderRadius: string | number): number[] {
  if (typeof borderRadius === 'number') {
    return [borderRadius, borderRadius, borderRadius, borderRadius];
  }

  const trimmed = borderRadius.trim();
  const parts = trimmed.split(/\s+/).map((p) => {
    return p.endsWith('px') ? parseFloat(p) : parseFloat(p) || 0;
  });

  if (parts.length === 1) {
    return [parts[0], parts[0], parts[0], parts[0]];
  } else if (parts.length === 2) {
    return [parts[0], parts[1], parts[0], parts[1]];
  } else if (parts.length === 3) {
    return [parts[0], parts[1], parts[2], parts[1]];
  } else {
    return parts.slice(0, 4);
  }
}

/**
 * 创建边框路径
 */
export function createBorderPath(
  bounds: { x: number; y: number; width: number; height: number },
  borderRadius: number[],
  CanvasKit: CanvasKit
): Path {
  const { x, y, width, height } = bounds;
  const [tl, tr, br, bl] = borderRadius;

  const path = new CanvasKit.Path();

  if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
    // 无圆角，直接绘制矩形
    path.addRect(CanvasKit.LTRBRect(x, y, x + width, y + height));
  } else {
    // 有圆角，使用 CanvasKit RRect（支持四角独立圆角）
    const clamped = [Math.max(0, tl), Math.max(0, tr), Math.max(0, br), Math.max(0, bl)];
    const maxScale = Math.min(
      clamped[0] + clamped[1] > 0 ? width / (clamped[0] + clamped[1]) : 1,
      clamped[3] + clamped[2] > 0 ? width / (clamped[3] + clamped[2]) : 1,
      clamped[0] + clamped[3] > 0 ? height / (clamped[0] + clamped[3]) : 1,
      clamped[1] + clamped[2] > 0 ? height / (clamped[1] + clamped[2]) : 1,
      1
    );
    const scale = Number.isFinite(maxScale) && maxScale > 0 ? maxScale : 1;
    const [ctl, ctr, cbr, cbl] = clamped.map((radius) => radius * scale);

    const rrect = Float32Array.of(
      x,
      y,
      x + width,
      y + height,
      ctl,
      ctl,
      ctr,
      ctr,
      cbr,
      cbr,
      cbl,
      cbl
    );
    path.addRRect(rrect);
  }

  return path;
}

/**
 * 创建边框 Paint
 */
export function createBorderPaint(
  borderColor: string,
  borderWidth: number,
  borderStyle: 'solid' | 'dashed' | 'dotted',
  CanvasKit: CanvasKit
): Paint {
  const paint = new CanvasKit.Paint();
  paint.setColor(toCanvasKitColor(borderColor, CanvasKit));
  paint.setStyle(CanvasKit.PaintStyle.Stroke);
  paint.setStrokeWidth(borderWidth);
  paint.setAntiAlias(true);

  // 设置虚线样式；effect.delete() 释放 JS 端引用，Skia 层由 paint 持有所有权，paint.delete() 时自动清理
  if (borderStyle === 'dashed') {
    const dashLength = borderWidth * 3;
    const gapLength = borderWidth * 2;
    const effect = CanvasKit.PathEffect.MakeDash([dashLength, gapLength], 0);
    if (effect) {
      paint.setPathEffect(effect);
      effect.delete();
    }
  } else if (borderStyle === 'dotted') {
    const dotLength = borderWidth;
    const gapLength = borderWidth;
    const effect = CanvasKit.PathEffect.MakeDash([dotLength, gapLength], 0);
    if (effect) {
      paint.setPathEffect(effect);
      effect.delete();
    }
  }

  return paint;
}

/**
 * 解析边框样式对象
 */
export function parseBorder(styles: Record<string, string | number | undefined>): BorderStyle {
  const borderShorthand = typeof styles.border === 'string' ? styles.border : '';
  const borderTokens = borderShorthand ? extractBorderTokens(borderShorthand) : {};

  const width = parseBorderWidth(styles.borderWidth ?? borderTokens.width ?? styles.border ?? 0);
  const color = (styles.borderColor ?? borderTokens.color ?? '#000000') as string;
  const style = parseBorderStyle(
    (
      styles.borderStyle ??
      borderTokens.style ??
      'solid'
    ) as string
  );
  const radius = parseBorderRadius(styles.borderRadius || 0);

  return { width, color, style, radius };
}
