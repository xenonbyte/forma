/**
 * 阴影转换器
 *
 * 将 CSS box-shadow 转换为 CanvasKit ImageFilter
 */

import type { CanvasKit, ImageFilter } from 'canvaskit-wasm';
import { toCanvasKitColor } from './ColorConverter';

export interface Shadow {
  offsetX: number;
  offsetY: number;
  blurRadius: number;
  spreadRadius: number;
  color: string;
  inset: boolean;
}

/**
 * 解析 box-shadow
 */
export function parseShadow(boxShadow: string): Shadow[] {
  if (!boxShadow || boxShadow === 'none') {
    return [];
  }

  const shadows: Shadow[] = [];

  // 分割多个阴影（用逗号分隔，但要注意 rgba() 中的逗号）
  const shadowStrings = splitShadows(boxShadow);

  for (const shadowStr of shadowStrings) {
    const shadow = parseSingleShadow(shadowStr);
    if (shadow) {
      shadows.push(shadow);
    }
  }

  return shadows;
}

/**
 * 分割多个阴影
 */
function splitShadows(boxShadow: string): string[] {
  const shadows: string[] = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < boxShadow.length; i++) {
    const char = boxShadow[i];

    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
    } else if (char === ',' && depth === 0) {
      shadows.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    shadows.push(current.trim());
  }

  return shadows;
}

/**
 * 解析单个阴影
 */
function parseSingleShadow(shadowStr: string): Shadow | null {
  const trimmed = shadowStr.trim();

  // 检查是否是 inset
  const inset = trimmed.startsWith('inset');
  const str = inset ? trimmed.substring(5).trim() : trimmed;

  // 提取颜色（可能在开头或结尾）
  let color = '#000000';
  let values = str;

  // 尝试匹配颜色
  const colorMatch =
    str.match(/rgba?\([^)]+\)/) ||
    str.match(/hsla?\([^)]+\)/) ||
    str.match(/#[0-9a-fA-F]{3,8}/) ||
    str.match(/\b(black|white|red|green|blue|yellow|cyan|magenta|gray|grey|silver)\b/);

  if (colorMatch) {
    color = colorMatch[0];
    values = str.replace(color, '').trim();
  }

  // 解析数值（offsetX offsetY blurRadius spreadRadius）
  const parts = values.split(/\s+/).filter((p) => p);
  if (parts.length < 2) {
    return null;
  }

  const offsetX = parseFloat(parts[0]) || 0;
  const offsetY = parseFloat(parts[1]) || 0;
  const blurRadius = parts[2] ? parseFloat(parts[2]) || 0 : 0;
  const spreadRadius = parts[3] ? parseFloat(parts[3]) || 0 : 0;

  return {
    offsetX,
    offsetY,
    blurRadius,
    spreadRadius,
    color,
    inset,
  };
}

/**
 * 创建阴影 ImageFilter
 */
export function createShadowFilter(
  shadow: Shadow,
  CanvasKit: CanvasKit
): ImageFilter | null {
  const { offsetX, offsetY, blurRadius, color } = shadow;

  // CanvasKit 不直接支持 spread，需要通过其他方式实现
  // 这里只实现基本的 drop shadow

  if (blurRadius === 0 && offsetX === 0 && offsetY === 0) {
    return null;
  }

  const ckColor = toCanvasKitColor(color, CanvasKit);

  return CanvasKit.ImageFilter.MakeDropShadow(
    offsetX,
    offsetY,
    blurRadius / 2, // sigmaX
    blurRadius / 2, // sigmaY
    ckColor,
    null // input
  );
}

/**
 * 创建多个阴影的组合 ImageFilter
 */
export function createShadowFilters(
  shadows: Shadow[],
  CanvasKit: CanvasKit
): ImageFilter | null {
  const activeShadows = shadows.filter((shadow) => !shadow.inset);
  if (activeShadows.length === 0) {
    return null;
  }

  const filters = activeShadows
    .map((shadow) => createShadowFilter(shadow, CanvasKit))
    .filter((filter): filter is ImageFilter => filter !== null);

  if (filters.length === 0) {
    return null;
  }

  let composed = filters[0];
  for (let index = 1; index < filters.length; index += 1) {
    const next = filters[index];
    const combined = CanvasKit.ImageFilter.MakeCompose(composed, next);
    if (!combined) {
      next.delete();
      continue;
    }
    composed.delete();
    next.delete();
    composed = combined;
  }

  return composed;
}
