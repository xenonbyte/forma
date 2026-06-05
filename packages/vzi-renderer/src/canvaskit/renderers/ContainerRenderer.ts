/**
 * 容器渲染器
 *
 * 渲染容器元素（container, button, input, link 等）
 */

import type { CanvasKit, Canvas, Image, Paint, Path, Shader, ImageFilter } from "canvaskit-wasm";
import type { IElementRenderer, IRElement, Bounds, Styles } from "./types";
import { toCanvasKitColor } from "../converters/ColorConverter";
import { createGradientShader } from "../converters/GradientConverter";
import { parseBorder, createBorderPath, createBorderPaint } from "../converters/BorderConverter";
import { parseShadow, createShadowFilters } from "../converters/ShadowConverter";
import { textRenderer } from "./TextRenderer";
import { imageRenderer } from "./ImageRenderer";

/**
 * 容器类型列表
 */
const CONTAINER_TYPES = [
  "container",
  "button",
  "input",
  "link",
  "div",
  "span",
  "section",
  "article",
  "header",
  "footer",
  "nav",
  "main",
  "aside",
];

/**
 * 容器渲染器
 */
export class ContainerRenderer implements IElementRenderer {
  canRender(type: string): boolean {
    return CONTAINER_TYPES.includes(type);
  }

  render(canvas: Canvas, element: IRElement, CanvasKit: CanvasKit): void {
    const { bounds, styles } = element;

    // 保存当前画布状态
    canvas.save();

    // 应用透明度
    const opacity = styles.opacity ?? 1;
    let opacityPaint: Paint | null = null;
    if (opacity < 1) {
      opacityPaint = new CanvasKit.Paint();
      opacityPaint.setAlphaf(Math.max(0, Math.min(1, opacity)));
      canvas.saveLayer(opacityPaint, CanvasKit.XYWHRect(bounds.x, bounds.y, bounds.width, bounds.height));
    }

    try {
      // 渲染阴影
      this.renderShadow(canvas, bounds, styles, CanvasKit);

      // 渲染背景
      this.renderBackground(canvas, bounds, styles, CanvasKit);
      this.renderBackgroundImage(canvas, bounds, styles, CanvasKit);

      // 渲染边框
      this.renderBorder(canvas, bounds, styles, CanvasKit);
      this.renderInlineText(canvas, element, CanvasKit);
    } finally {
      // 恢复画布状态
      if (opacity < 1) {
        canvas.restore();
      }

      canvas.restore();
      opacityPaint?.delete();
    }
  }

  /**
   * 渲染容器类元素的内联文本（如 button 的 textContent）
   */
  private renderInlineText(canvas: Canvas, element: IRElement, CanvasKit: CanvasKit): void {
    const text = (element.textContent || "").trim();
    if (!text) {
      return;
    }

    const textElement: IRElement = {
      id: `${element.id}__inline_text`,
      type: "text",
      bounds: {
        x: element.bounds.x,
        y: element.bounds.y,
        width: element.bounds.width,
        height: element.bounds.height,
      },
      styles: {
        ...element.styles,
      },
      textContent: text,
    };

    textRenderer.render(canvas, textElement, CanvasKit);
  }

  /**
   * 渲染背景
   */
  private renderBackground(canvas: Canvas, bounds: Bounds, styles: Styles, CanvasKit: CanvasKit): void {
    let paint: Paint | null = null;
    let path: Path | null = null;
    let shader: Shader | null = null;
    let blurFilter: ImageFilter | null = null;
    try {
      paint = new CanvasKit.Paint();
      paint.setAntiAlias(true);
      let hasFill = false;

      // 检查是否有渐变背景
      if (styles.backgroundImage && styles.backgroundImage !== "none") {
        shader = createGradientShader(styles.backgroundImage, bounds, CanvasKit);
        if (shader) {
          paint.setShader(shader);
          hasFill = true;
        }
      }

      if (!hasFill && styles.backgroundColor && !this.isTransparentColor(styles.backgroundColor)) {
        paint.setColor(toCanvasKitColor(styles.backgroundColor, CanvasKit));
        hasFill = true;
      }

      if (!hasFill) {
        return; // 无背景
      }

      paint.setStyle(CanvasKit.PaintStyle.Fill);
      const blurSigma = this.parseFilterBlurSigma(styles.filter);
      if (blurSigma > 0 && CanvasKit.ImageFilter && typeof CanvasKit.ImageFilter.MakeBlur === "function") {
        const tileMode = CanvasKit.TileMode?.Decal ?? CanvasKit.TileMode?.Clamp;
        blurFilter = CanvasKit.ImageFilter.MakeBlur(blurSigma, blurSigma, tileMode, null);
        if (blurFilter) {
          paint.setImageFilter(blurFilter);
        }
      }

      // 创建背景路径
      const border = parseBorder(styles);
      path = createBorderPath(bounds, border.radius, CanvasKit);
      canvas.drawPath(path, paint);
    } finally {
      if (path) {
        path.delete();
      }
      if (shader) {
        shader.delete();
      }
      if (blurFilter) {
        blurFilter.delete();
      }
      if (paint) {
        paint.delete();
      }
    }
  }

  private renderBackgroundImage(canvas: Canvas, bounds: Bounds, styles: Styles, CanvasKit: CanvasKit): void {
    const backgroundImage = typeof styles.backgroundImage === "string" ? styles.backgroundImage : "";
    const imageUrl = this.extractBackgroundImageUrl(backgroundImage);
    if (!imageUrl) {
      return;
    }

    const border = parseBorder(styles);
    const image = imageRenderer.getCachedImage(imageUrl);
    if (!image) {
      void imageRenderer.loadImage(imageUrl, CanvasKit);
      return;
    }

    const padding = this.parseBoxValues(styles.padding);
    const originRect = this.resolveBackgroundBox(bounds, border.width, padding, styles.backgroundOrigin, "padding-box");
    const clipRect = this.resolveBackgroundBox(bounds, border.width, padding, styles.backgroundClip, "border-box");
    if (originRect.width <= 0 || originRect.height <= 0 || clipRect.width <= 0 || clipRect.height <= 0) {
      return;
    }

    const renderSize = this.resolveBackgroundImageSize(
      image,
      originRect.width,
      originRect.height,
      styles.backgroundSize,
    );
    if (renderSize.width <= 0 || renderSize.height <= 0) {
      return;
    }

    const position = this.resolveBackgroundPosition(
      styles.backgroundPosition,
      originRect.width,
      originRect.height,
      renderSize.width,
      renderSize.height,
    );

    const imageRect = {
      x: originRect.x + position.x,
      y: originRect.y + position.y,
      width: renderSize.width,
      height: renderSize.height,
    };
    const repeatMode = this.resolveBackgroundRepeat(styles.backgroundRepeat);
    const clipPath = this.createBackgroundClipPath(bounds, clipRect, border.radius, CanvasKit);
    const paint = new CanvasKit.Paint();

    try {
      paint.setAntiAlias(true);
      canvas.save();
      try {
        canvas.clipPath(clipPath, CanvasKit.ClipOp.Intersect, true);
        this.drawBackgroundImage(canvas, image, imageRect, originRect, repeatMode, paint, CanvasKit);
      } finally {
        canvas.restore();
      }
    } finally {
      paint.delete();
      clipPath.delete();
    }
  }

  /**
   * 渲染边框
   */
  private renderBorder(canvas: Canvas, bounds: Bounds, styles: Styles, CanvasKit: CanvasKit): void {
    const border = parseBorder(styles);
    if (border.width <= 0) {
      return;
    }

    const path = createBorderPath(bounds, border.radius, CanvasKit);
    const paint = createBorderPaint(border.color, border.width, border.style, CanvasKit);
    try {
      canvas.drawPath(path, paint);
    } finally {
      path.delete();
      paint.delete();
    }
  }

  /**
   * 渲染阴影
   */
  private renderShadow(canvas: Canvas, bounds: Bounds, styles: Styles, CanvasKit: CanvasKit): void {
    if (!styles.boxShadow || styles.boxShadow === "none") {
      return;
    }

    const shadows = parseShadow(styles.boxShadow);
    if (shadows.length === 0) {
      return;
    }

    const filter = createShadowFilters(shadows, CanvasKit);
    if (!filter) {
      return;
    }

    // 创建带阴影的绘制
    const paint = new CanvasKit.Paint();
    paint.setImageFilter(filter);
    paint.setColor(toCanvasKitColor(styles.backgroundColor || "#000000", CanvasKit));
    paint.setStyle(CanvasKit.PaintStyle.Fill);

    const border = parseBorder(styles);
    const path = createBorderPath(bounds, border.radius, CanvasKit);

    try {
      canvas.drawPath(path, paint);
    } finally {
      path.delete();
      paint.delete();
      filter.delete();
    }
  }

  private extractBackgroundImageUrl(backgroundImage: string): string | undefined {
    if (!backgroundImage || backgroundImage === "none") {
      return undefined;
    }
    const match = backgroundImage.match(/url\((['"]?)(.*?)\1\)/i);
    if (!match) {
      return undefined;
    }
    const url = match[2]?.trim();
    if (!url) {
      return undefined;
    }
    return url;
  }

  private parseBoxValues(value: string | number | undefined): [number, number, number, number] {
    if (typeof value === "number") {
      return [value, value, value, value];
    }
    if (typeof value !== "string") {
      return [0, 0, 0, 0];
    }
    const tokens = value.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return [0, 0, 0, 0];
    }
    const values = tokens.map((token) => this.parsePixelLength(token));
    if (values.length === 1) {
      return [values[0], values[0], values[0], values[0]];
    }
    if (values.length === 2) {
      return [values[0], values[1], values[0], values[1]];
    }
    if (values.length === 3) {
      return [values[0], values[1], values[2], values[1]];
    }
    return [values[0], values[1], values[2], values[3]];
  }

  private parsePixelLength(value: string | number): number {
    if (typeof value === "number") {
      return value;
    }
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return parsed;
  }

  private insetRect(rect: Bounds, top: number, right: number, bottom: number, left: number): Bounds {
    const width = Math.max(0, rect.width - left - right);
    const height = Math.max(0, rect.height - top - bottom);
    return {
      x: rect.x + left,
      y: rect.y + top,
      width,
      height,
    };
  }

  private resolveBackgroundBox(
    bounds: Bounds,
    borderWidth: number,
    padding: [number, number, number, number],
    boxValue: string | number | undefined,
    fallback: "border-box" | "padding-box" | "content-box",
  ): Bounds {
    const normalized = typeof boxValue === "string" ? boxValue.trim().toLowerCase() : fallback;
    if (normalized === "content-box") {
      return this.insetRect(
        bounds,
        borderWidth + padding[0],
        borderWidth + padding[1],
        borderWidth + padding[2],
        borderWidth + padding[3],
      );
    }
    if (normalized === "padding-box") {
      return this.insetRect(bounds, borderWidth, borderWidth, borderWidth, borderWidth);
    }
    return { ...bounds };
  }

  private resolveBackgroundImageSize(
    image: Image,
    boxWidth: number,
    boxHeight: number,
    backgroundSize: string | number | undefined,
  ): { width: number; height: number } {
    const intrinsicWidth = image.width();
    const intrinsicHeight = image.height();
    if (intrinsicWidth <= 0 || intrinsicHeight <= 0) {
      return { width: 0, height: 0 };
    }

    if (typeof backgroundSize === "number") {
      return { width: backgroundSize, height: backgroundSize };
    }

    const normalized = typeof backgroundSize === "string" ? backgroundSize.trim().toLowerCase() : "";

    if (!normalized || normalized === "auto") {
      return { width: intrinsicWidth, height: intrinsicHeight };
    }

    if (normalized === "contain") {
      const scale = Math.min(boxWidth / intrinsicWidth, boxHeight / intrinsicHeight);
      return { width: intrinsicWidth * scale, height: intrinsicHeight * scale };
    }

    if (normalized === "cover") {
      const scale = Math.max(boxWidth / intrinsicWidth, boxHeight / intrinsicHeight);
      return { width: intrinsicWidth * scale, height: intrinsicHeight * scale };
    }

    const [firstToken, secondToken] = normalized.split(/\s+/);
    const parsedWidth = this.parseBackgroundLength(firstToken, boxWidth);
    const parsedHeight = this.parseBackgroundLength(secondToken, boxHeight);

    if (parsedWidth == null && parsedHeight == null) {
      return { width: intrinsicWidth, height: intrinsicHeight };
    }

    if (parsedWidth == null) {
      const scale = parsedHeight! / intrinsicHeight;
      return { width: intrinsicWidth * scale, height: parsedHeight! };
    }

    if (parsedHeight == null) {
      const scale = parsedWidth / intrinsicWidth;
      return { width: parsedWidth, height: intrinsicHeight * scale };
    }

    return { width: parsedWidth, height: parsedHeight };
  }

  private parseBackgroundLength(token: string | undefined, basis: number): number | undefined {
    if (!token || token === "auto") {
      return undefined;
    }
    if (token.endsWith("%")) {
      const ratio = Number.parseFloat(token) / 100;
      return Number.isFinite(ratio) ? basis * ratio : undefined;
    }
    const value = Number.parseFloat(token);
    return Number.isFinite(value) ? value : undefined;
  }

  private resolveBackgroundPosition(
    value: string | number | undefined,
    boxWidth: number,
    boxHeight: number,
    imageWidth: number,
    imageHeight: number,
  ): { x: number; y: number } {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    const tokens = normalized ? normalized.split(/\s+/).filter(Boolean) : [];

    let xToken = tokens[0] ?? "0%";
    let yToken = tokens[1];

    if (!yToken) {
      if (xToken === "top" || xToken === "bottom") {
        yToken = xToken;
        xToken = "50%";
      } else if (xToken === "left" || xToken === "right" || xToken === "center") {
        yToken = "50%";
      } else {
        yToken = "0%";
      }
    }

    if ((xToken === "top" || xToken === "bottom") && (yToken === "left" || yToken === "right")) {
      const temp = xToken;
      xToken = yToken;
      yToken = temp;
    }

    const x = this.resolveAxisPosition(xToken, boxWidth - imageWidth, "x");
    const y = this.resolveAxisPosition(yToken, boxHeight - imageHeight, "y");
    return { x, y };
  }

  private resolveAxisPosition(token: string, available: number, axis: "x" | "y"): number {
    const normalized = token.toLowerCase();
    if (normalized === "center") {
      return available * 0.5;
    }
    if (axis === "x") {
      if (normalized === "left") return 0;
      if (normalized === "right") return available;
    } else {
      if (normalized === "top") return 0;
      if (normalized === "bottom") return available;
    }
    if (normalized.endsWith("%")) {
      const ratio = Number.parseFloat(normalized) / 100;
      return Number.isFinite(ratio) ? available * ratio : 0;
    }
    const length = Number.parseFloat(normalized);
    return Number.isFinite(length) ? length : 0;
  }

  private resolveBackgroundRepeat(
    value: string | number | undefined,
  ): "repeat" | "repeat-x" | "repeat-y" | "no-repeat" {
    if (typeof value !== "string") {
      return "repeat";
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "repeat-x") {
      return "repeat-x";
    }
    if (normalized === "repeat-y") {
      return "repeat-y";
    }
    if (normalized === "no-repeat") {
      return "no-repeat";
    }
    if (normalized === "repeat") {
      return "repeat";
    }

    const [xRepeat, yRepeat] = normalized.split(/\s+/);
    if (xRepeat === "repeat" && yRepeat === "no-repeat") {
      return "repeat-x";
    }
    if (xRepeat === "no-repeat" && yRepeat === "repeat") {
      return "repeat-y";
    }
    if (xRepeat === "no-repeat" && yRepeat === "no-repeat") {
      return "no-repeat";
    }
    return "repeat";
  }

  private createBackgroundClipPath(
    outerBounds: Bounds,
    clipBounds: Bounds,
    borderRadius: number[],
    CanvasKit: CanvasKit,
  ): Path {
    const topInset = clipBounds.y - outerBounds.y;
    const leftInset = clipBounds.x - outerBounds.x;
    const rightInset = outerBounds.x + outerBounds.width - (clipBounds.x + clipBounds.width);
    const bottomInset = outerBounds.y + outerBounds.height - (clipBounds.y + clipBounds.height);
    const radii = [
      Math.max(0, (borderRadius[0] ?? 0) - Math.max(topInset, leftInset)),
      Math.max(0, (borderRadius[1] ?? 0) - Math.max(topInset, rightInset)),
      Math.max(0, (borderRadius[2] ?? 0) - Math.max(bottomInset, rightInset)),
      Math.max(0, (borderRadius[3] ?? 0) - Math.max(bottomInset, leftInset)),
    ];
    return createBorderPath(clipBounds, radii, CanvasKit);
  }

  private drawBackgroundImage(
    canvas: Canvas,
    image: Image,
    imageRect: Bounds,
    repeatBounds: Bounds,
    repeatMode: "repeat" | "repeat-x" | "repeat-y" | "no-repeat",
    paint: Paint,
    CanvasKit: CanvasKit,
  ): void {
    if (imageRect.width <= 0 || imageRect.height <= 0) {
      return;
    }

    const srcRect = CanvasKit.LTRBRect(0, 0, image.width(), image.height());
    const repeatX = repeatMode === "repeat" || repeatMode === "repeat-x";
    const repeatY = repeatMode === "repeat" || repeatMode === "repeat-y";

    const xPositions = repeatX
      ? this.computeRepeatPositions(imageRect.x, imageRect.width, repeatBounds.x, repeatBounds.x + repeatBounds.width)
      : [imageRect.x];
    const yPositions = repeatY
      ? this.computeRepeatPositions(imageRect.y, imageRect.height, repeatBounds.y, repeatBounds.y + repeatBounds.height)
      : [imageRect.y];

    for (const y of yPositions) {
      for (const x of xPositions) {
        const dstRect = CanvasKit.LTRBRect(x, y, x + imageRect.width, y + imageRect.height);
        canvas.drawImageRect(image, srcRect, dstRect, paint);
      }
    }
  }

  private computeRepeatPositions(start: number, step: number, min: number, max: number): number[] {
    if (!Number.isFinite(step) || step <= 0) {
      return [start];
    }
    const positions: number[] = [];
    let current = start + Math.floor((min - start) / step) * step;
    if (current + step <= min) {
      current += step;
    }
    const maxTiles = Math.ceil((max - min) / step) + 3;
    let guard = 0;
    while (current < max && guard < maxTiles) {
      if (current + step > min) {
        positions.push(current);
      }
      current += step;
      guard += 1;
    }
    if (positions.length === 0) {
      positions.push(start);
    }
    return positions;
  }

  private isTransparentColor(color: string): boolean {
    const normalized = color.trim().toLowerCase();
    if (normalized === "transparent") {
      return true;
    }
    const rgbaMatch = normalized.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/);
    if (rgbaMatch) {
      return Number.parseFloat(rgbaMatch[1]) <= 0.001;
    }
    const hslaMatch = normalized.match(/^hsla\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/);
    if (hslaMatch) {
      return Number.parseFloat(hslaMatch[1]) <= 0.001;
    }
    return false;
  }

  private parseFilterBlurSigma(filterValue: string | number | undefined): number {
    if (typeof filterValue !== "string") {
      return 0;
    }

    const match = filterValue.match(/blur\(\s*([-+]?\d*\.?\d+)px\s*\)/i);
    if (!match) {
      return 0;
    }

    const blurPx = Number.parseFloat(match[1]);
    if (!Number.isFinite(blurPx) || blurPx <= 0) {
      return 0;
    }

    // CSS blur radius 与 Skia sigma 并非严格等价，使用经验映射降低过度模糊。
    return Math.max(0.5, blurPx * 0.5);
  }
}

/**
 * 单例实例
 */
export const containerRenderer = new ContainerRenderer();
