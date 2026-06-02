/**
 * 样式转换工具
 *
 * 将 IR 样式转换为 Konva 渲染所需的格式
 */

import type { IRStyles } from '@vzi-core/types';
import type { RenderedElementStyle } from '../types';

/**
 * 颜色映射表（CSS 颜色名到十六进制）
 */
const CSS_COLOR_MAP: Record<string, string> = {
  transparent: 'transparent',
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  teal: '#008080',
  navy: '#000080',
  fuchsia: '#ff00ff',
  purple: '#800080',
  orange: '#ffa500',
  pink: '#ffc0cb',
  // 添加更多常用颜色
  primary: '#007bff',
  secondary: '#6c757d',
  success: '#28a745',
  danger: '#dc3545',
  warning: '#ffc107',
  info: '#17a2b8',
  light: '#f8f9fa',
  dark: '#343a40',
};

/**
 * 标准化颜色值为 Konva 可识别的格式
 *
 * @param color - 输入颜色值
 * @returns 标准化后的颜色值
 */
export function normalizeColor(color: string | number | undefined): string | undefined {
  if (color === undefined || color === null || color === '') {
    return undefined;
  }

  // 已经是十六进制格式
  if (typeof color === 'string') {
    const trimmed = color.trim().toLowerCase();

    // 十六进制格式
    if (trimmed.startsWith('#')) {
      // #fff -> #ffffff
      if (trimmed.length === 4) {
        const r = trimmed[1];
        const g = trimmed[2];
        const b = trimmed[3];
        return `#${r}${r}${g}${g}${b}${b}`;
      }
      return trimmed;
    }

    // rgb/rgba 格式
    if (trimmed.startsWith('rgb')) {
      return trimmed;
    }

    // CSS 颜色名
    if (CSS_COLOR_MAP[trimmed]) {
      return CSS_COLOR_MAP[trimmed];
    }

    // 其他情况（如 currentColor, inherit 等）
    return trimmed;
  }

  // 数字类型（假设为十六进制数值）
  if (typeof color === 'number') {
    return `#${color.toString(16).padStart(6, '0')}`;
  }

  return undefined;
}

/**
 * 解析边框圆角
 *
 * @param value - 边框圆角值
 * @returns 四个角的圆角值 [topLeft, topRight, bottomRight, bottomLeft]
 */
export function parseBorderRadius(value: string | number | undefined): [number, number, number, number] | number {
  if (value === undefined || value === null) {
    return 0;
  }

  // 数字类型
  if (typeof value === 'number') {
    return Math.max(0, value);
  }

  // 字符串类型
  const str = String(value).trim();

  // 解析单个值（带单位）
  const parseSingleValue = (v: string): number => {
    const num = parseFloat(v.replace(/px|em|rem|%/, ''));
    return isNaN(num) ? 0 : Math.max(0, num);
  };

  // 分割多个值
  const parts = str.split(/\s+/).map(parseSingleValue);

  switch (parts.length) {
    case 1:
      return parts[0];
    case 2:
      // top-left/bottom-right, top-right/bottom-left
      return [parts[0], parts[1], parts[0], parts[1]];
    case 3:
      // top-left, top-right/bottom-left, bottom-right
      return [parts[0], parts[1], parts[2], parts[1]];
    case 4:
      // top-left, top-right, bottom-right, bottom-left
      return [parts[0], parts[1], parts[2], parts[3]];
    default:
      return parts[0] || 0;
  }
}

/**
 * 解析边框宽度
 *
 * @param value - 边框宽度值
 * @returns 边框宽度数值
 */
export function parseBorderWidth(value: string | number | undefined): number {
  if (value === undefined || value === null) {
    return 0;
  }

  if (typeof value === 'number') {
    return Math.max(0, value);
  }

  const str = String(value).trim().toLowerCase();

  // 命名值
  if (str === 'thin') return 1;
  if (str === 'medium') return 2;
  if (str === 'thick') return 4;

  // 数值
  return Math.max(0, parseFloat(str.replace(/px|em|rem/, '')) || 0);
}

/**
 * 解析边框样式
 *
 * @param value - 边框样式值
 * @returns 边框样式
 */
export function parseBorderStyle(value: string | undefined): 'solid' | 'dashed' | 'dotted' | 'none' {
  if (!value) {
    return 'none';
  }

  const str = value.trim().toLowerCase();

  if (str === 'solid' || str === 'dashed' || str === 'dotted') {
    return str;
  }

  // double, groove, ridge, inset, outset 等当作 solid 处理
  if (str !== 'none' && str !== 'hidden') {
    return 'solid';
  }

  return 'none';
}

/**
 * 解析字体大小
 *
 * @param value - 字体大小值
 * @returns 字体大小（像素）
 */
export function parseFontSize(value: string | number | undefined): number {
  if (value === undefined || value === null) {
    return 14; // 默认字体大小
  }

  if (typeof value === 'number') {
    return Math.max(1, value);
  }

  const str = String(value).trim().toLowerCase();

  // 命名值
  const namedSizes: Record<string, number> = {
    'xx-small': 9,
    'x-small': 10,
    'small': 13,
    'medium': 16,
    'large': 18,
    'x-large': 24,
    'xx-large': 32,
  };

  if (namedSizes[str]) {
    return namedSizes[str];
  }

  // 相对单位（基于默认 16px）
  if (str.endsWith('em')) {
    const num = parseFloat(str);
    return isNaN(num) ? 14 : Math.max(1, num * 16);
  }

  if (str.endsWith('rem')) {
    const num = parseFloat(str);
    return isNaN(num) ? 14 : Math.max(1, num * 16);
  }

  if (str.endsWith('%')) {
    const num = parseFloat(str);
    return isNaN(num) ? 14 : Math.max(1, (num / 100) * 16);
  }

  // 像素值
  if (str.endsWith('px')) {
    const num = parseFloat(str);
    return isNaN(num) ? 14 : Math.max(1, num);
  }

  // 纯数字
  const num = parseFloat(str);
  return isNaN(num) ? 14 : Math.max(1, num);
}

/**
 * 解析字重
 *
 * @param value - 字重值
 * @returns 字重数值
 */
export function parseFontWeight(value: string | number | undefined): number {
  if (value === undefined || value === null) {
    return 400; // 默认字重
  }

  if (typeof value === 'number') {
    return Math.min(900, Math.max(100, value));
  }

  const str = String(value).trim().toLowerCase();

  // 命名值
  const namedWeights: Record<string, number> = {
    'thin': 100,
    'hairline': 100,
    'extralight': 200,
    'ultralight': 200,
    'light': 300,
    'normal': 400,
    'regular': 400,
    'medium': 500,
    'semibold': 600,
    'demibold': 600,
    'bold': 700,
    'extrabold': 800,
    'ultrabold': 800,
    'black': 900,
    'heavy': 900,
  };

  if (namedWeights[str]) {
    return namedWeights[str];
  }

  // 数值字符串
  const num = parseInt(str, 10);
  return isNaN(num) ? 400 : Math.min(900, Math.max(100, num));
}

/**
 * 解析透明度
 *
 * @param value - 透明度值
 * @returns 透明度（0-1）
 */
export function parseOpacity(value: string | number | null | undefined): number {
  if (value === undefined || value === null) {
    return 1;
  }

  if (typeof value === 'number') {
    return Math.min(1, Math.max(0, value));
  }

  const num = parseFloat(String(value));
  return isNaN(num) ? 1 : Math.min(1, Math.max(0, num));
}

/**
 * 解析文本对齐
 *
 * @param value - 文本对齐值
 * @returns 文本对齐方式
 */
export function parseTextAlign(value: string | undefined): 'left' | 'center' | 'right' {
  if (!value) {
    return 'left';
  }

  const str = value.trim().toLowerCase();

  if (str === 'center' || str === 'right') {
    return str;
  }

  return 'left';
}

/**
 * 解析垂直对齐
 *
 * @param value - 垂直对齐值
 * @returns 垂直对齐方式
 */
export function parseVerticalAlign(value: string | undefined): 'top' | 'middle' | 'bottom' {
  if (!value) {
    return 'top';
  }

  const str = value.trim().toLowerCase();

  if (str === 'middle' || str === 'center') {
    return 'middle';
  }

  if (str === 'bottom' || str === 'baseline' || str === 'sub' || str === 'super') {
    return 'bottom';
  }

  return 'top';
}

/**
 * 将 IR 样式转换为渲染样式
 *
 * @param styles - IR 样式
 * @returns 渲染样式
 */
export function convertStyles(styles: IRStyles | undefined): RenderedElementStyle {
  const result: RenderedElementStyle = {};

  if (!styles) {
    return result;
  }

  // 背景色
  if (styles.backgroundColor) {
    result.backgroundColor = normalizeColor(styles.backgroundColor as string);
  }

  // 边框
  if (styles.borderColor || styles.border) {
    result.borderColor = normalizeColor(styles.borderColor as string);
  }

  if (styles.borderWidth) {
    result.borderWidth = parseBorderWidth(styles.borderWidth);
  }

  if (styles.borderStyle) {
    result.borderStyle = parseBorderStyle(styles.borderStyle as string);
  }

  if (styles.borderRadius) {
    result.borderRadius = parseBorderRadius(styles.borderRadius);
  }

  // 透明度
  if (styles.opacity !== undefined) {
    result.opacity = parseOpacity(styles.opacity);
  }

  // 阴影
  if (styles.boxShadow) {
    const shadow = parseBoxShadow(styles.boxShadow as string);
    if (shadow) {
      result.shadowColor = shadow.color;
      result.shadowBlur = shadow.blur;
      result.shadowOffsetX = shadow.offsetX;
      result.shadowOffsetY = shadow.offsetY;
    }
  }

  // 文本样式
  if (styles.color) {
    result.color = normalizeColor(styles.color as string);
  }

  if (styles.fontFamily) {
    result.fontFamily = String(styles.fontFamily).split(',')[0].replace(/['"]/g, '').trim();
  }

  if (styles.fontSize) {
    result.fontSize = parseFontSize(styles.fontSize);
  }

  if (styles.fontWeight) {
    result.fontWeight = parseFontWeight(styles.fontWeight);
  }

  if (styles.fontStyle) {
    result.fontStyle = styles.fontStyle === 'italic' ? 'italic' : 'normal';
  }

  if (styles.lineHeight) {
    result.lineHeight = parseLineHeight(styles.lineHeight);
  }

  if (styles.letterSpacing) {
    result.letterSpacing = parseFloat(String(styles.letterSpacing)) || 0;
  }

  if (styles.textAlign) {
    result.textAlign = parseTextAlign(styles.textAlign as string);
  }

  if (styles.verticalAlign) {
    result.verticalAlign = parseVerticalAlign(styles.verticalAlign as string);
  }

  if (styles.textDecoration) {
    result.textDecoration = String(styles.textDecoration);
  }

  return result;
}

/**
 * 解析 box-shadow
 *
 * @param value - box-shadow 值
 * @returns 阴影参数
 */
function parseBoxShadow(value: string): {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
} | null {
  if (!value || value === 'none') {
    return null;
  }

  // 使用正则表达式匹配 box-shadow 格式：offset-x offset-y blur-radius spread-radius color
  // 支持 rgba(r, g, b, a) 格式（内部可以有空格）
  const match = value.match(/^([-\d.]+px)\s+([-\d.]+px)(?:\s+([-\d.]+px))?(?:\s+([-\d.]+px))?\s+(rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-fA-F]+|\w+)$/);

  if (!match) {
    return null;
  }

  const offsetX = parseFloat(match[1]);
  const offsetY = parseFloat(match[2]);
  const blur = match[3] ? parseFloat(match[3]) : 0;
  // spread-radius (match[4]) 在 canvas 中不支持，忽略
  const colorStr = match[5] || match[4] || 'rgba(0,0,0,0.25)';

  const color = normalizeColor(colorStr) || 'rgba(0,0,0,0.25)';

  return { color, blur, offsetX, offsetY };
}

/**
 * 解析行高
 *
 * @param value - 行高值
 * @returns 行高数值
 */
function parseLineHeight(value: string | number | undefined): number {
  if (value === undefined || value === null) {
    return 1.5;
  }

  if (typeof value === 'number') {
    return value;
  }

  const str = String(value).trim();

  // 无单位数字（倍数）
  if (/^\d+(\.\d+)?$/.test(str)) {
    return parseFloat(str);
  }

  // 百分比
  if (str.endsWith('%')) {
    return parseFloat(str) / 100;
  }

  // em, px 等
  const num = parseFloat(str);
  return isNaN(num) ? 1.5 : num;
}

/**
 * 获取默认文本样式
 *
 * @returns 默认文本样式
 */
export function getDefaultTextStyle(): RenderedElementStyle {
  return {
    fontFamily: 'Arial, sans-serif',
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.5,
    color: '#333333',
    textAlign: 'left',
    verticalAlign: 'top',
  };
}

/**
 * 解析线性渐变
 *
 * @param value - linear-gradient 值
 * @returns 渐变参数或 null
 */
export function parseLinearGradient(value: string): {
  angle: number;
  colorStops: Array<{ offset: number; color: string }>;
} | null {
  const match = value.match(/linear-gradient\(([^)]+)\)/);
  if (!match) return null;

  const parts = match[1].split(',').map(s => s.trim());
  let angle = 180; // 默认从上到下
  let startIndex = 0;

  // 检查第一个参数是否是角度或方向
  if (parts[0].includes('deg')) {
    angle = parseFloat(parts[0]);
    startIndex = 1;
  } else if (parts[0].startsWith('to ')) {
    const direction = parts[0].replace('to ', '');
    const angleMap: Record<string, number> = {
      'top': 0,
      'right': 90,
      'bottom': 180,
      'left': 270,
      'top right': 45,
      'right top': 45,
      'bottom right': 135,
      'right bottom': 135,
      'bottom left': 225,
      'left bottom': 225,
      'top left': 315,
      'left top': 315,
    };
    angle = angleMap[direction] || 180;
    startIndex = 1;
  }

  // 解析颜色停止点
  const colorStops: Array<{ offset: number; color: string }> = [];
  for (let i = startIndex; i < parts.length; i++) {
    const part = parts[i].trim();
    // 匹配 "color" 或 "color offset%"
    const colorMatch = part.match(/^(rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-fA-F]+|\w+)(?:\s+([\d.]+)%)?$/);
    if (colorMatch) {
      const color = normalizeColor(colorMatch[1]) || colorMatch[1];
      const offset = colorMatch[2] ? parseFloat(colorMatch[2]) / 100 : i / (parts.length - 1);
      colorStops.push({ offset, color });
    }
  }

  if (colorStops.length < 2) return null;

  return { angle, colorStops };
}

/**
 * 解析径向渐变
 *
 * @param value - radial-gradient 值
 * @returns 渐变参数或 null
 */
export function parseRadialGradient(value: string): {
  shape: 'circle' | 'ellipse';
  colorStops: Array<{ offset: number; color: string }>;
} | null {
  const match = value.match(/radial-gradient\(([^)]+)\)/);
  if (!match) return null;

  const parts = match[1].split(',').map(s => s.trim());
  let shape: 'circle' | 'ellipse' = 'ellipse';
  let startIndex = 0;

  // 检查第一个参数是否是形状
  if (parts[0] === 'circle' || parts[0] === 'ellipse') {
    shape = parts[0];
    startIndex = 1;
  }

  // 解析颜色停止点
  const colorStops: Array<{ offset: number; color: string }> = [];
  for (let i = startIndex; i < parts.length; i++) {
    const part = parts[i].trim();
    const colorMatch = part.match(/^(rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-fA-F]+|\w+)(?:\s+([\d.]+)%)?$/);
    if (colorMatch) {
      const color = normalizeColor(colorMatch[1]) || colorMatch[1];
      const offset = colorMatch[2] ? parseFloat(colorMatch[2]) / 100 : i / (parts.length - 1);
      colorStops.push({ offset, color });
    }
  }

  if (colorStops.length < 2) return null;

  return { shape, colorStops };
}

/**
 * 合并样式（后者覆盖前者）
 *
 * @param base - 基础样式
 * @param override - 覆盖样式
 * @returns 合并后的样式
 */
export function mergeStyles(
  base: RenderedElementStyle,
  override: RenderedElementStyle
): RenderedElementStyle {
  const result = { ...base };

  for (const key of Object.keys(override) as (keyof RenderedElementStyle)[]) {
    const value = override[key];
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }

  return result;
}
