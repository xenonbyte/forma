/**
 * 渐变转换器
 *
 * 将 CSS 渐变转换为 CanvasKit Shader
 */

import type { CanvasKit, Shader } from "canvaskit-wasm";
import { parseColor } from "./ColorConverter";

export interface Gradient {
  type: "linear" | "radial";
  colors: string[];
  positions: number[];
  // 线性渐变参数
  angle?: number;
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
  // 径向渐变参数
  cx?: number;
  cy?: number;
  radius?: number;
}

/**
 * 解析 CSS 渐变
 */
export function parseGradient(gradient: string): Gradient | null {
  const trimmed = gradient.trim();

  if (trimmed.startsWith("linear-gradient")) {
    return parseLinearGradient(trimmed);
  }

  if (trimmed.startsWith("radial-gradient")) {
    return parseRadialGradient(trimmed);
  }

  return null;
}

function extractFunctionBody(input: string, functionName: string): string | null {
  const prefix = `${functionName}(`;
  if (!input.startsWith(prefix)) {
    return null;
  }

  let depth = 0;
  let bodyStart = -1;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "(") {
      depth += 1;
      if (bodyStart === -1) {
        bodyStart = index + 1;
      }
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0 && bodyStart !== -1) {
        return input.slice(bodyStart, index).trim();
      }
    }
  }

  return null;
}

function splitTopLevelByComma(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "(") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (char === "," && depth === 0) {
      const normalized = current.trim();
      if (normalized.length > 0) {
        parts.push(normalized);
      }
      current = "";
      continue;
    }
    current += char;
  }

  const tail = current.trim();
  if (tail.length > 0) {
    parts.push(tail);
  }

  return parts;
}

/**
 * 解析线性渐变
 */
function parseLinearGradient(gradient: string): Gradient | null {
  // linear-gradient(90deg, #ff0000 0%, #0000ff 100%)
  const body = extractFunctionBody(gradient, "linear-gradient");
  if (!body) {
    return null;
  }

  const parts = splitTopLevelByComma(body);

  // 解析角度或方向
  let angle = 180; // 默认从上到下
  let startIndex = 0;

  const firstPart = parts[0];
  if (firstPart.includes("deg")) {
    angle = parseFloat(firstPart);
    startIndex = 1;
  } else if (firstPart.startsWith("to ")) {
    angle = parseDirection(firstPart);
    startIndex = 1;
  }

  // 解析色标
  const colorStops = parts.slice(startIndex);
  const colors: string[] = [];
  const positions: number[] = [];

  for (const stop of colorStops) {
    const stopMatch = stop.match(/^(.+?)\s+(\d+(?:\.\d+)?%?)$/);
    if (stopMatch) {
      colors.push(stopMatch[1].trim());
      const pos = stopMatch[2];
      positions.push(pos.endsWith("%") ? parseFloat(pos) / 100 : parseFloat(pos));
    } else {
      colors.push(stop.trim());
      positions.push(colors.length === 1 ? 0 : 1);
    }
  }

  return {
    type: "linear",
    colors,
    positions,
    angle,
  };
}

/**
 * 解析径向渐变
 */
function parseRadialGradient(gradient: string): Gradient | null {
  // radial-gradient(circle at 50% 50%, #ff0000 0%, #0000ff 100%)
  const body = extractFunctionBody(gradient, "radial-gradient");
  if (!body) {
    return null;
  }

  const parts = splitTopLevelByComma(body);

  // 解析位置和形状
  let cx = 0.5;
  let cy = 0.5;
  let startIndex = 0;

  const firstPart = parts[0];
  if (firstPart.includes("at")) {
    const posMatch = firstPart.match(/at\s+(\d+(?:\.\d+)?%?)\s+(\d+(?:\.\d+)?%?)/);
    if (posMatch) {
      cx = parseFloat(posMatch[1]) / 100;
      cy = parseFloat(posMatch[2]) / 100;
    }
    startIndex = 1;
  }

  // 解析色标
  const colorStops = parts.slice(startIndex);
  const colors: string[] = [];
  const positions: number[] = [];

  for (const stop of colorStops) {
    const stopMatch = stop.match(/^(.+?)\s+(\d+(?:\.\d+)?%?)$/);
    if (stopMatch) {
      colors.push(stopMatch[1].trim());
      const pos = stopMatch[2];
      positions.push(pos.endsWith("%") ? parseFloat(pos) / 100 : parseFloat(pos));
    } else {
      colors.push(stop.trim());
      positions.push(colors.length === 1 ? 0 : 1);
    }
  }

  return {
    type: "radial",
    colors,
    positions,
    cx,
    cy,
    radius: 1.0,
  };
}

/**
 * 解析方向关键字
 */
function parseDirection(direction: string): number {
  const dir = direction.replace("to ", "").trim();
  const directionMap: Record<string, number> = {
    top: 0,
    "top right": 45,
    right: 90,
    "bottom right": 135,
    bottom: 180,
    "bottom left": 225,
    left: 270,
    "top left": 315,
  };
  return directionMap[dir] || 180;
}

/**
 * 创建线性渐变 Shader
 */
export function createLinearGradientShader(
  gradient: Gradient,
  bounds: { x: number; y: number; width: number; height: number },
  CanvasKit: CanvasKit,
): Shader {
  const { colors, positions, angle = 180 } = gradient;

  // 计算渐变起止点
  const rad = ((angle - 90) * Math.PI) / 180;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  const length = Math.max(bounds.width, bounds.height);
  const x0 = centerX - (Math.cos(rad) * length) / 2;
  const y0 = centerY - (Math.sin(rad) * length) / 2;
  const x1 = centerX + (Math.cos(rad) * length) / 2;
  const y1 = centerY + (Math.sin(rad) * length) / 2;

  const ckColors = normalizeGradientColors(colors, CanvasKit);

  return CanvasKit.Shader.MakeLinearGradient([x0, y0], [x1, y1], ckColors, positions, CanvasKit.TileMode.Clamp);
}

/**
 * 创建径向渐变 Shader
 */
export function createRadialGradientShader(
  gradient: Gradient,
  bounds: { x: number; y: number; width: number; height: number },
  CanvasKit: CanvasKit,
): Shader {
  const { colors, positions, cx = 0.5, cy = 0.5 } = gradient;

  // 计算中心点和半径
  const centerX = bounds.x + bounds.width * cx;
  const centerY = bounds.y + bounds.height * cy;
  const radius = Math.max(bounds.width, bounds.height) / 2;

  const ckColors = normalizeGradientColors(colors, CanvasKit);

  return CanvasKit.Shader.MakeRadialGradient([centerX, centerY], radius, ckColors, positions, CanvasKit.TileMode.Clamp);
}

/**
 * 创建渐变 Shader
 */
export function createGradientShader(
  gradient: string | Gradient,
  bounds: { x: number; y: number; width: number; height: number },
  CanvasKit: CanvasKit,
): Shader | null {
  const parsed = typeof gradient === "string" ? parseGradient(gradient) : gradient;

  if (!parsed) {
    return null;
  }

  if (parsed.type === "linear") {
    return createLinearGradientShader(parsed, bounds, CanvasKit);
  } else {
    return createRadialGradientShader(parsed, bounds, CanvasKit);
  }
}

function normalizeGradientColors(colors: string[], CanvasKit: CanvasKit): Float32Array[] {
  const parsed = colors.map((color) => parseColor(color));

  // Avoid dark halos from "transparent" (rgba(0,0,0,0)) stops by borrowing
  // neighbor RGB while preserving alpha=0.
  for (let i = 0; i < parsed.length; i += 1) {
    const current = parsed[i];
    if (current.a === 0 && current.r === 0 && current.g === 0 && current.b === 0) {
      let replacement = parsed[i - 1];
      if (!replacement || replacement.a === 0) {
        replacement = parsed[i + 1];
      }
      if (replacement) {
        parsed[i] = {
          r: replacement.r,
          g: replacement.g,
          b: replacement.b,
          a: 0,
        };
      }
    }
  }

  return parsed.map((rgba) => CanvasKit.Color(rgba.r, rgba.g, rgba.b, rgba.a));
}
