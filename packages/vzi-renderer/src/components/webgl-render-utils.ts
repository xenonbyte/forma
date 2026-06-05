import type { IRElement } from "@vzi-core/types";
import { normalizeColor, parseBorderWidth, parseOpacity } from "../utils/style-utils";

const DEFAULT_TEXT_COLOR: [number, number, number, number] = [0.11, 0.11, 0.13, 0.95];
const DEFAULT_IMAGE_COLOR: [number, number, number, number] = [0.82, 0.84, 0.88, 0.85];
const DEFAULT_BUTTON_COLOR: [number, number, number, number] = [0.23, 0.51, 0.96, 0.85];
const DEFAULT_BORDER_COLOR: [number, number, number, number] = [0.46, 0.49, 0.54, 0.75];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseHexChannel(hex: string): number {
  return Number.parseInt(hex, 16) / 255;
}

function withOpacity(color: [number, number, number, number], opacity: number): [number, number, number, number] {
  return [color[0], color[1], color[2], clamp01(color[3] * opacity)];
}

export function parseWebGLColor(
  color: string | number | undefined,
  opacity = 1,
  fallback?: [number, number, number, number],
): [number, number, number, number] | null {
  const normalized = normalizeColor(color);
  const clampedOpacity = clamp01(opacity);

  if (!normalized) {
    return fallback ? withOpacity(fallback, clampedOpacity) : null;
  }

  if (normalized === "transparent") {
    return [0, 0, 0, 0];
  }

  if (normalized.startsWith("#")) {
    const hex = normalized.slice(1);
    if (hex.length === 3) {
      const r = parseHexChannel(`${hex[0]}${hex[0]}`);
      const g = parseHexChannel(`${hex[1]}${hex[1]}`);
      const b = parseHexChannel(`${hex[2]}${hex[2]}`);
      return [r, g, b, clampedOpacity];
    }

    if (hex.length === 4) {
      const r = parseHexChannel(`${hex[0]}${hex[0]}`);
      const g = parseHexChannel(`${hex[1]}${hex[1]}`);
      const b = parseHexChannel(`${hex[2]}${hex[2]}`);
      const a = parseHexChannel(`${hex[3]}${hex[3]}`);
      return [r, g, b, clamp01(a * clampedOpacity)];
    }

    if (hex.length === 6 || hex.length === 8) {
      const r = parseHexChannel(hex.slice(0, 2));
      const g = parseHexChannel(hex.slice(2, 4));
      const b = parseHexChannel(hex.slice(4, 6));
      const a = hex.length === 8 ? parseHexChannel(hex.slice(6, 8)) : 1;
      return [r, g, b, clamp01(a * clampedOpacity)];
    }
  }

  const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1]
      .split(",")
      .map((segment) => segment.trim())
      .map((segment) => Number.parseFloat(segment));

    if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part))) {
      const alpha = parts.length >= 4 && Number.isFinite(parts[3]) ? clamp01(parts[3]) : 1;
      return [
        clamp01(parts[0] / 255),
        clamp01(parts[1] / 255),
        clamp01(parts[2] / 255),
        clamp01(alpha * clampedOpacity),
      ];
    }
  }

  return fallback ? withOpacity(fallback, clampedOpacity) : null;
}

function resolveElementColor(element: IRElement): [number, number, number, number] | null {
  const opacity = parseOpacity(element.styles.opacity);
  const backgroundColor = parseWebGLColor(
    typeof element.styles.backgroundColor === "string" || typeof element.styles.backgroundColor === "number"
      ? element.styles.backgroundColor
      : undefined,
    opacity,
  );

  if (backgroundColor && backgroundColor[3] > 0) {
    return backgroundColor;
  }

  if (typeof element.textContent === "string" && element.textContent.trim().length > 0) {
    return parseWebGLColor(
      typeof element.styles.color === "string" || typeof element.styles.color === "number"
        ? element.styles.color
        : undefined,
      opacity,
      DEFAULT_TEXT_COLOR,
    );
  }

  const borderWidth = parseBorderWidth(
    typeof element.styles.borderWidth === "string" || typeof element.styles.borderWidth === "number"
      ? element.styles.borderWidth
      : undefined,
  );

  if (borderWidth > 0) {
    return parseWebGLColor(
      typeof element.styles.borderColor === "string" || typeof element.styles.borderColor === "number"
        ? element.styles.borderColor
        : undefined,
      opacity,
      DEFAULT_BORDER_COLOR,
    );
  }

  if (element.type === "image") {
    return withOpacity(DEFAULT_IMAGE_COLOR, opacity);
  }

  if (element.type === "button") {
    return withOpacity(DEFAULT_BUTTON_COLOR, opacity);
  }

  return null;
}

function pushRectVertices(
  target: number[],
  x: number,
  y: number,
  width: number,
  height: number,
  color: [number, number, number, number],
): void {
  const x2 = x + width;
  const y2 = y + height;
  const [r, g, b, a] = color;

  target.push(
    x,
    y,
    r,
    g,
    b,
    a,
    x2,
    y,
    r,
    g,
    b,
    a,
    x,
    y2,
    r,
    g,
    b,
    a,
    x,
    y2,
    r,
    g,
    b,
    a,
    x2,
    y,
    r,
    g,
    b,
    a,
    x2,
    y2,
    r,
    g,
    b,
    a,
  );
}

export function buildWebGLRenderBatch(elements: IRElement[]): {
  vertexData: Float32Array;
  drawnElementCount: number;
} {
  const vertexData: number[] = [];
  let drawnElementCount = 0;

  for (const element of elements) {
    const { width, height, x, y } = element.bounds;
    if (!(width > 0) || !(height > 0)) {
      continue;
    }

    const color = resolveElementColor(element);
    if (!color || color[3] <= 0) {
      continue;
    }

    pushRectVertices(vertexData, x, y, width, height, color);
    drawnElementCount += 1;
  }

  return {
    vertexData: new Float32Array(vertexData),
    drawnElementCount,
  };
}
