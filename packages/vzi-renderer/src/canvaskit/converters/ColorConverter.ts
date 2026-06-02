/**
 * 颜色转换器
 *
 * 将 CSS 颜色格式转换为 CanvasKit Color
 */

import type { CanvasKit } from 'canvaskit-wasm';

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * 解析 CSS 颜色字符串
 */
export function parseColor(color: string): RGBA {
  const trimmed = color.trim().toLowerCase();

  // hex 格式
  if (trimmed.startsWith('#')) {
    return parseHexColor(trimmed);
  }

  // rgb/rgba 格式
  if (trimmed.startsWith('rgb')) {
    return parseRGBColor(trimmed);
  }

  // hsl/hsla 格式
  if (trimmed.startsWith('hsl')) {
    return parseHSLColor(trimmed);
  }

  // 命名颜色
  if (NAMED_COLORS[trimmed]) {
    return parseHexColor(NAMED_COLORS[trimmed]);
  }

  // 默认黑色
  return { r: 0, g: 0, b: 0, a: 1.0 };
}

/**
 * 解析 hex 颜色
 */
function parseHexColor(hex: string): RGBA {
  // 移除 #
  hex = hex.replace('#', '');

  // 3 位 hex (#RGB)
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }

  // 4 位 hex (#RGBA)
  if (hex.length === 4) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1.0;

  return { r, g, b, a };
}

/**
 * 解析 rgb/rgba 颜色
 */
function parseRGBColor(rgb: string): RGBA {
  const match = rgb.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    return { r: 0, g: 0, b: 0, a: 1.0 };
  }

  const parts = match[1].split(',').map((s) => s.trim());
  const r = parseFloat(parts[0]);
  const g = parseFloat(parts[1]);
  const b = parseFloat(parts[2]);
  const a = parts[3] ? parseFloat(parts[3]) : 1.0;

  return { r, g, b, a };
}

/**
 * 解析 hsl/hsla 颜色
 */
function parseHSLColor(hsl: string): RGBA {
  const match = hsl.match(/hsla?\(([^)]+)\)/);
  if (!match) {
    return { r: 0, g: 0, b: 0, a: 1.0 };
  }

  const parts = match[1].split(',').map((s) => s.trim());
  const h = parseFloat(parts[0]) / 360;
  const s = parseFloat(parts[1].replace('%', '')) / 100;
  const l = parseFloat(parts[2].replace('%', '')) / 100;
  const a = parts[3] ? parseFloat(parts[3]) : 1.0;

  return { ...hslToRgb(h, s, l), a };
}

/**
 * HSL 转 RGB
 */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

/**
 * 转换为 CanvasKit Color
 */
export function toCanvasKitColor(color: string | RGBA, CanvasKit: CanvasKit): Float32Array {
  const rgba = typeof color === 'string' ? parseColor(color) : color;
  return CanvasKit.Color(rgba.r, rgba.g, rgba.b, rgba.a);
}

/**
 * 常用命名颜色
 */
const NAMED_COLORS: Record<string, string> = {
  transparent: '#00000000',
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
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
};
