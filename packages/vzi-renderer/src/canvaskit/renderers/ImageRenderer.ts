/**
 * 图片渲染器
 *
 * 渲染图片元素，支持 URL 和 base64
 */

import type { CanvasKit, Canvas, Image } from "canvaskit-wasm";
import type { IElementRenderer, IRElement, Bounds } from "./types";

/**
 * 图片类型列表
 */
const IMAGE_TYPES = ["image", "img"];
const MAX_IMAGE_CACHE_ENTRIES = 128;
const IMAGE_FETCH_TIMEOUT_MS = 15000;
/** 失败图片缓存过期时间（ms）：到期后允许重试 */
const FAILED_IMAGE_TTL_MS = 60_000;
/** 单个 URL 最大重试次数，超过后永久标记 */
const FAILED_IMAGE_MAX_RETRIES = 3;

/**
 * object-fit 类型
 */
type ObjectFit = "fill" | "contain" | "cover" | "none" | "scale-down";

interface ParsedDataUrl {
  mimeType: string;
  data: string;
  isBase64: boolean;
}

interface FailedImageRecord {
  failedAt: number;
  retryCount: number;
}

/**
 * 图片缓存
 */
const imageCache = new Map<string, Image>();

/**
 * 正在加载的图片
 */
const loadingPromises = new Map<string, Promise<Image | null>>();

/**
 * 失败图片缓存，避免在每次 render 时重复请求同一张坏图。
 */
const failedImageCache = new Map<string, FailedImageRecord>();

function touchImageCacheEntry(src: string): void {
  const image = imageCache.get(src);
  if (!image) {
    return;
  }
  imageCache.delete(src);
  imageCache.set(src, image);
}

function evictImageCacheIfNeeded(): void {
  while (imageCache.size > MAX_IMAGE_CACHE_ENTRIES) {
    const oldestKey = imageCache.keys().next().value;
    if (!oldestKey) {
      return;
    }
    const image = imageCache.get(oldestKey);
    image?.delete();
    imageCache.delete(oldestKey);
  }
}

/**
 * 图片渲染器
 */
export class ImageRenderer implements IElementRenderer {
  canRender(type: string): boolean {
    return IMAGE_TYPES.includes(type);
  }

  render(canvas: Canvas, element: IRElement, CanvasKit: CanvasKit): void {
    const { bounds, src } = element;

    if (!src) {
      return;
    }

    // 从缓存获取图片
    const image = imageCache.get(src);
    if (!image) {
      // 图片未加载，异步加载
      void this.loadImage(src, CanvasKit).then((_img) => {
        if (_img) {
          // 图片加载完成后，需要触发重新渲染
          // 这里只是占位，实际使用时需要配合渲染引擎
        }
      });
      return;
    }
    touchImageCacheEntry(src);

    this.renderImage(
      canvas,
      image,
      bounds,
      element.styles,
      (element.styles.objectFit || "cover") as ObjectFit,
      CanvasKit,
    );
  }

  /**
   * 加载图片
   */
  async loadImage(src: string, CanvasKit: CanvasKit): Promise<Image | null> {
    if (imageCache.has(src)) {
      touchImageCacheEntry(src);
      return imageCache.get(src)!;
    }

    const failedRecord = failedImageCache.get(src);
    if (failedRecord) {
      // 已达最大重试次数：永久跳过
      if (failedRecord.retryCount >= FAILED_IMAGE_MAX_RETRIES) {
        return null;
      }
      // 未过期：跳过
      if (Date.now() - failedRecord.failedAt < FAILED_IMAGE_TTL_MS) {
        return null;
      }
      // 已过期：移除记录，允许重试
      failedImageCache.delete(src);
    }

    if (loadingPromises.has(src)) {
      return loadingPromises.get(src)!;
    }

    const promise = this.fetchAndDecodeImage(src, CanvasKit);
    loadingPromises.set(src, promise);

    try {
      const image = await promise;
      if (image) {
        imageCache.set(src, image);
        touchImageCacheEntry(src);
        evictImageCacheIfNeeded();
        failedImageCache.delete(src);
        return image;
      }

      this.markImageFailure(src);
      return null;
    } catch (error) {
      this.markImageFailure(src);
      console.error("Failed to load image:", src, error);
      return null;
    } finally {
      loadingPromises.delete(src);
    }
  }

  /**
   * 获取并解码图片
   */
  private async fetchAndDecodeImage(src: string, CanvasKit: CanvasKit): Promise<Image | null> {
    try {
      let imageData: ArrayBuffer;

      if (src.startsWith("data:")) {
        const parsed = this.parseDataUrl(src);
        if (this.isSvgMimeType(parsed.mimeType)) {
          return await this.decodeSvgDataUrl(parsed, src, CanvasKit);
        }
        imageData = this.decodeDataUrlToBytes(parsed);
      } else {
        const response = await this.fetchWithTimeout(src);
        if (!response.ok) {
          console.error("Failed to fetch image:", src, new Error(`HTTP ${response.status}`));
          return null;
        }

        const contentType = response.headers.get("content-type");
        if (this.isSvgMimeType(contentType) || this.isSvgSource(src)) {
          return await this.decodeSvgResponse(response, src, CanvasKit);
        }

        imageData = await response.arrayBuffer();
      }

      const image = CanvasKit.MakeImageFromEncoded(imageData);
      if (!image) {
        console.error("Failed to decode image:", src);
        return null;
      }

      return image;
    } catch (error) {
      console.error("Failed to fetch image:", src, error);
      return null;
    }
  }

  private markImageFailure(src: string): void {
    const existing = failedImageCache.get(src);
    failedImageCache.set(src, {
      failedAt: Date.now(),
      retryCount: existing ? existing.retryCount + 1 : 1,
    });
  }

  private parseDataUrl(dataUrl: string): ParsedDataUrl {
    const matches = dataUrl.match(/^data:([^,]*?),(.*)$/s);
    if (!matches) {
      throw new Error("Invalid data URL");
    }

    const meta = matches[1] ?? "";
    const data = matches[2] ?? "";
    const metaParts = meta
      .split(";")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    const mimeType = metaParts.find((part) => part.includes("/")) || "text/plain";

    return {
      mimeType,
      data,
      isBase64: metaParts.includes("base64"),
    };
  }

  private decodeDataUrlToBytes(parsed: ParsedDataUrl): ArrayBuffer {
    if (parsed.isBase64) {
      return this.toArrayBuffer(this.base64ToUint8Array(parsed.data));
    }

    const decoded = decodeURIComponent(parsed.data);
    return this.toArrayBuffer(new TextEncoder().encode(decoded));
  }

  private toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const { buffer, byteOffset, byteLength } = bytes;
    if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) {
      return buffer;
    }
    return bytes.slice().buffer;
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(base64, "base64"));
    }

    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  private isSvgMimeType(contentType: string | null | undefined): boolean {
    if (typeof contentType !== "string") {
      return false;
    }
    return contentType.trim().toLowerCase().startsWith("image/svg+xml");
  }

  private isSvgSource(src: string): boolean {
    return /\.svg(?:$|[?#&])/i.test(src);
  }

  private async decodeSvgResponse(response: Response, src: string, CanvasKit: CanvasKit): Promise<Image | null> {
    const blob = await response.blob();
    const svgBlob = this.isSvgMimeType(blob.type) ? blob : new Blob([blob], { type: "image/svg+xml" });
    return this.decodeSvgBlob(svgBlob, src, CanvasKit);
  }

  private async decodeSvgDataUrl(parsed: ParsedDataUrl, src: string, CanvasKit: CanvasKit): Promise<Image | null> {
    const svgBlob = new Blob([this.decodeDataUrlToBytes(parsed)], {
      type: parsed.mimeType || "image/svg+xml",
    });
    return this.decodeSvgBlob(svgBlob, src, CanvasKit);
  }

  private async decodeSvgBlob(blob: Blob, src: string, CanvasKit: CanvasKit): Promise<Image | null> {
    if (typeof CanvasKit.MakeImageFromCanvasImageSource !== "function") {
      console.error("Failed to decode image:", src, new Error("CanvasKit SVG rasterization is unavailable"));
      return null;
    }

    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(blob);
        try {
          return CanvasKit.MakeImageFromCanvasImageSource(bitmap);
        } finally {
          if (typeof bitmap.close === "function") {
            bitmap.close();
          }
        }
      } catch {
        // createImageBitmap 对 SVG 兼容性不稳定，继续走 HTMLImageElement 兜底。
      }
    }

    if (typeof Image === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      console.error("Failed to decode image:", src, new Error("SVG rasterization is unsupported in this runtime"));
      return null;
    }

    const objectUrl = URL.createObjectURL(blob);
    try {
      const imageElement = await this.loadHtmlImage(objectUrl);
      return CanvasKit.MakeImageFromCanvasImageSource(imageElement);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  private async loadHtmlImage(src: string): Promise<HTMLImageElement> {
    const imageElement = new Image();
    imageElement.decoding = "async";

    await new Promise<void>((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        imageElement.onload = null;
        imageElement.onerror = null;
        reject(new Error("Timed out while decoding SVG image element"));
      }, IMAGE_FETCH_TIMEOUT_MS);
      imageElement.onload = () => {
        globalThis.clearTimeout(timeoutId);
        resolve();
      };
      imageElement.onerror = () => {
        globalThis.clearTimeout(timeoutId);
        reject(new Error("Failed to decode SVG image element"));
      };
      imageElement.src = src;
    });

    if (typeof imageElement.decode === "function") {
      await imageElement.decode().catch(() => undefined);
    }

    return imageElement;
  }

  /**
   * 渲染图片
   */
  private renderImage(
    canvas: Canvas,
    image: Image,
    bounds: Bounds,
    styles: IRElement["styles"],
    objectFit: ObjectFit,
    CanvasKit: CanvasKit,
  ): void {
    const imageWidth = image.width();
    const imageHeight = image.height();

    const srcX = 0;
    const srcY = 0;
    const srcWidth = imageWidth;
    const srcHeight = imageHeight;
    let dstX = bounds.x;
    let dstY = bounds.y;
    let dstWidth = bounds.width;
    let dstHeight = bounds.height;

    switch (objectFit) {
      case "contain":
        // 保持比例，完整显示
        {
          const scale = Math.min(bounds.width / imageWidth, bounds.height / imageHeight);
          dstWidth = imageWidth * scale;
          dstHeight = imageHeight * scale;
          dstX = bounds.x + (bounds.width - dstWidth) / 2;
          dstY = bounds.y + (bounds.height - dstHeight) / 2;
        }
        break;

      case "cover":
        // 保持比例，填充容器
        {
          const scale = Math.max(bounds.width / imageWidth, bounds.height / imageHeight);
          dstWidth = imageWidth * scale;
          dstHeight = imageHeight * scale;
          dstX = bounds.x + (bounds.width - dstWidth) / 2;
          dstY = bounds.y + (bounds.height - dstHeight) / 2;
        }
        break;

      case "fill":
        // 拉伸填充
        // 使用默认的 bounds
        break;

      case "none":
        // 不缩放，使用原始尺寸
        dstWidth = imageWidth;
        dstHeight = imageHeight;
        break;

      case "scale-down":
        // 缩小或保持原始尺寸
        {
          const scale = Math.min(Math.min(bounds.width / imageWidth, bounds.height / imageHeight), 1);
          dstWidth = imageWidth * scale;
          dstHeight = imageHeight * scale;
          dstX = bounds.x + (bounds.width - dstWidth) / 2;
          dstY = bounds.y + (bounds.height - dstHeight) / 2;
        }
        break;
    }

    const paint = new CanvasKit.Paint();
    let colorFilter: ReturnType<CanvasKit["ColorFilter"]["MakeMatrix"]> | null = null;
    try {
      paint.setAntiAlias(true);
      const brightness = this.parseBrightness(styles.filter);
      if (
        Number.isFinite(brightness) &&
        brightness > 0 &&
        Math.abs(brightness - 1) > 0.001 &&
        CanvasKit.ColorFilter &&
        typeof CanvasKit.ColorFilter.MakeMatrix === "function"
      ) {
        colorFilter = CanvasKit.ColorFilter.MakeMatrix([
          brightness,
          0,
          0,
          0,
          0,
          0,
          brightness,
          0,
          0,
          0,
          0,
          0,
          brightness,
          0,
          0,
          0,
          0,
          0,
          1,
          0,
        ]);
        if (colorFilter) {
          paint.setColorFilter(colorFilter);
        }
      }

      // 创建图片矩形
      const srcRect = CanvasKit.LTRBRect(srcX, srcY, srcX + srcWidth, srcY + srcHeight);
      const dstRect = CanvasKit.LTRBRect(dstX, dstY, dstX + dstWidth, dstY + dstHeight);

      canvas.drawImageRect(image, srcRect, dstRect, paint);
    } finally {
      if (colorFilter) {
        colorFilter.delete();
      }
      paint.delete();
    }
  }

  private parseBrightness(filter: string | number | undefined): number {
    if (typeof filter !== "string" || filter.trim().length === 0 || filter === "none") {
      return 1;
    }
    const match = filter.match(/brightness\(([^)]+)\)/i);
    if (!match) {
      return 1;
    }
    const raw = match[1].trim();
    if (raw.endsWith("%")) {
      const percent = Number.parseFloat(raw.slice(0, -1));
      if (Number.isFinite(percent) && percent > 0) {
        return percent / 100;
      }
      return 1;
    }
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  /**
   * 清除图片缓存
   */
  clearCache(): void {
    imageCache.forEach((image) => image.delete());
    imageCache.clear();
    failedImageCache.clear();
    loadingPromises.clear();
  }

  /**
   * 获取缓存中的图片（仅供渲染管线内部使用）
   */
  getCachedImage(src: string): Image | undefined {
    touchImageCacheEntry(src);
    return imageCache.get(src);
  }

  /**
   * 从缓存中移除指定图片
   */
  removeFromCache(src: string): void {
    const image = imageCache.get(src);
    if (image) {
      image.delete();
      imageCache.delete(src);
    }
    failedImageCache.delete(src);
  }

  private async fetchWithTimeout(src: string): Promise<Response> {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller ? globalThis.setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS) : null;

    try {
      return await fetch(src, controller ? { signal: controller.signal } : undefined);
    } finally {
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
    }
  }
}

/**
 * 单例实例
 */
export const imageRenderer = new ImageRenderer();
