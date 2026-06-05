/**
 * 渲染器注册中心
 *
 * 管理所有元素渲染器的注册和获取
 */

import type { Canvas, CanvasKit } from "canvaskit-wasm";
import type { IElementRenderer, IRElement } from "./types";
import { containerRenderer } from "./ContainerRenderer";
import { textRenderer } from "./TextRenderer";
import { imageRenderer } from "./ImageRenderer";
import { svgRenderer } from "./SVGRenderer";

/**
 * 渲染器注册表
 */

/**
 * 注册渲染器
 */
export function registerRenderer(_renderer: IElementRenderer): void {
  // 注册时检查所有支持的类型
  // 这里简化处理，实际使用时由每个渲染器自己管理类型
}

const TEXT_LIKE_TYPES = ["text", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "label"];

function isTransparentColor(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  return (
    normalized === "transparent" ||
    normalized === "rgba(0,0,0,0)" ||
    normalized === "rgb(0,0,0,0)" ||
    normalized === "#0000" ||
    normalized === "#00000000" ||
    normalized === "hsla(0,0%,0%,0)"
  );
}

function parseNumeric(value: string | number | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value !== "string") {
    return 0;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasVisibleBorder(border: string): boolean {
  const normalized = border.trim().toLowerCase();
  if (!normalized || normalized === "none") {
    return false;
  }
  if (normalized.includes(" none")) {
    return false;
  }

  const widthMatch = normalized.match(
    /(^|\s)(thin|medium|thick|-?\d+(?:\.\d+)?(?:px|em|rem|pt|pc|cm|mm|in|q|vh|vw|vmin|vmax|%)?)(?=\s|$)/,
  );
  if (!widthMatch) {
    return true;
  }

  const token = widthMatch[2];
  if (token === "thin" || token === "medium" || token === "thick") {
    return true;
  }

  return parseNumeric(token) > 0;
}

function hasNonZeroPadding(padding: string | number | undefined): boolean {
  if (typeof padding === "number") {
    return padding > 0;
  }
  if (typeof padding !== "string" || padding.trim().length === 0) {
    return false;
  }
  return padding
    .trim()
    .split(/\s+/)
    .some((token) => parseNumeric(token) > 0);
}

function hasVisualBoxStyles(element: IRElement): boolean {
  const styles = element.styles || {};

  const backgroundColor = styles.backgroundColor;
  if (
    typeof backgroundColor === "string" &&
    backgroundColor.trim().length > 0 &&
    !isTransparentColor(backgroundColor)
  ) {
    return true;
  }

  const backgroundImage = styles.backgroundImage;
  const backgroundClip = typeof styles.backgroundClip === "string" ? styles.backgroundClip.trim().toLowerCase() : "";
  if (typeof backgroundImage === "string" && backgroundImage.trim().length > 0 && backgroundImage !== "none") {
    // 文字渐变（bg-clip:text）应走文本渲染
    if (backgroundClip !== "text") {
      return true;
    }
  }

  if (parseNumeric(styles.borderWidth) > 0) {
    return true;
  }

  const border = styles.border;
  if (typeof border === "string" && hasVisibleBorder(border)) {
    return true;
  }

  if (typeof styles.boxShadow === "string" && styles.boxShadow !== "none") {
    return true;
  }

  if (hasNonZeroPadding(styles.padding)) {
    return true;
  }

  return false;
}

function shouldPreferContainerRenderer(element: IRElement): boolean {
  if (!TEXT_LIKE_TYPES.includes(element.type)) {
    return false;
  }

  if (element.children && element.children.length > 0) {
    return true;
  }

  const hasText = typeof element.textContent === "string" && element.textContent.trim().length > 0;
  if (!hasText && (element.type === "label" || element.type === "span")) {
    return true;
  }

  const display = typeof element.styles?.display === "string" ? element.styles.display.trim().toLowerCase() : "";
  if ((display === "inline" || display === "inline-block") && !hasVisualBoxStyles(element)) {
    return false;
  }

  return hasVisualBoxStyles(element);
}

/**
 * 获取渲染器
 */
export function getRenderer(type: string, element?: IRElement): IElementRenderer | null {
  if (element?.svgData) {
    return svgRenderer;
  }

  if (element && shouldPreferContainerRenderer(element)) {
    return containerRenderer;
  }

  // 按优先级检查渲染器
  const rendererList = [containerRenderer, textRenderer, imageRenderer, svgRenderer];

  for (const renderer of rendererList) {
    if (renderer.canRender(type)) {
      return renderer;
    }
  }

  return null;
}

/**
 * 渲染元素
 */
export function renderElement(canvas: Canvas, element: IRElement, CanvasKit: CanvasKit): void {
  const renderer = getRenderer(element.type, element);

  if (!renderer) {
    console.warn(`No renderer found for type: ${element.type}`);
    return;
  }

  renderer.render(canvas, element, CanvasKit);
}

// 导出所有渲染器
export { containerRenderer, textRenderer, imageRenderer, svgRenderer };

// 导出类型
export * from "./types";
