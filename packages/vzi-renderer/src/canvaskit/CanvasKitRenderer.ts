/**
 * CanvasKit 渲染引擎
 *
 * 核心渲染器，管理 Surface、渲染流程和元素树
 */

import type { CanvasKit, Surface, Canvas } from "canvaskit-wasm";
import type { IRElement, Bounds } from "./renderers/types";
import { loadCanvasKit } from "./CanvasKitLoader";
import { getSurfaceManager } from "./SurfaceManager";
import { renderElement } from "./renderers/RendererRegistry";
import { createBorderPath, parseBorder } from "./converters/BorderConverter";
import { FontManager } from "./FontManager";
import { imageRenderer } from "./renderers/ImageRenderer";
import { sortCanvasKitTree } from "./render-order";
import type { CanvasAnnotationRenderer } from "./annotations/AnnotationRenderer";

const TEXT_TYPES = ["text", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "label"];
const ICON_FALLBACK_FAMILIES = ["Material Icons"];

function shouldClipOverflow(overflow: string | number | undefined): boolean {
  if (typeof overflow !== "string") {
    return false;
  }
  const normalized = overflow.trim().toLowerCase();
  return normalized === "hidden" || normalized === "clip";
}

function isRendererDebugEnabled(): boolean {
  const globalConfig = globalThis as typeof globalThis & {
    __VZI_RENDERER_DEBUG__?: unknown;
  };
  return globalConfig.__VZI_RENDERER_DEBUG__ === true;
}

function rendererDebugLog(message: string, payload?: unknown): void {
  if (!isRendererDebugEnabled()) {
    return;
  }
  if (payload !== undefined) {
    // eslint-disable-next-line no-console
    console.log(`[VZI][CanvasKitRenderer] ${message}`, payload);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[VZI][CanvasKitRenderer] ${message}`);
}

/**
 * 渲染选项
 */
export interface RenderOptions {
  /**
   * 是否使用 WebGL
   */
  useWebGL?: boolean;

  /**
   * 设备像素比
   */
  devicePixelRatio?: number;

  /**
   * 是否清空画布
   */
  clear?: boolean;

  /**
   * 背景色
   */
  backgroundColor?: string;

  /**
   * 视口变换
   */
  transform?: {
    translateX?: number;
    translateY?: number;
    scale?: number;
  };
}

/**
 * CanvasKit 渲染器
 */
export class CanvasKitRenderer {
  private canvasKit: CanvasKit | null = null;
  private surface: Surface | null = null;
  private canvas: Canvas | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private isInitialized = false;
  private annotationRenderer: CanvasAnnotationRenderer | null = null;
  private preparedElementsRef: IRElement[] | null = null;
  private sortedElementsRef: IRElement[] | null = null;
  private sortedElementsCache: IRElement[] = [];

  /**
   * 初始化渲染器
   */
  async init(canvas: HTMLCanvasElement, options: RenderOptions = {}): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.canvasElement = canvas;

    // 加载 CanvasKit
    this.canvasKit = await loadCanvasKit();

    // 初始化字体管理器（加载中文字体）
    const fontManager = FontManager.getInstance();
    await fontManager.init(this.canvasKit);

    // 创建 Surface
    const surfaceManager = getSurfaceManager();
    const surfaceInfo = surfaceManager.createSurface(canvas, {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      useWebGL: options.useWebGL ?? true,
      devicePixelRatio: (options.devicePixelRatio ?? window.devicePixelRatio) || 1,
    });

    this.surface = surfaceInfo.surface;
    this.canvas = this.surface.getCanvas();
    this.isInitialized = true;
  }

  /**
   * 渲染元素树
   */
  async render(elements: IRElement[], options: RenderOptions = {}): Promise<void> {
    if (!this.isInitialized || !this.canvas) {
      console.warn("Renderer not initialized");
      return;
    }

    if (this.preparedElementsRef !== elements) {
      // 只有元素集变化时才重新准备字体/图片资源；纯视口缩放和平移不应重复走资源准备。
      const fontFamilies = this.collectFontFamilies(elements);
      if (fontFamilies.size > 0) {
        await this.preloadFonts(fontFamilies);
      }
      const imageSources = this.collectImageSources(elements);
      if (imageSources.size > 0) {
        await this.preloadImages(imageSources);
      }
      this.preparedElementsRef = elements;
    }

    if (this.sortedElementsRef !== elements) {
      this.sortedElementsCache = sortCanvasKitTree(elements);
      this.sortedElementsRef = elements;
    }

    // 第二阶段：执行渲染
    this.renderSync(this.sortedElementsCache, options);
  }

  /**
   * 收集所有文本元素的 fontFamily
   */
  private collectFontFamilies(elements: IRElement[]): Set<string> {
    const fontFamilies = new Set<string>();

    const traverse = (element: IRElement): void => {
      // 任何携带 textContent 的元素都应参与字体预加载（例如 button）
      if (element.textContent && element.textContent.trim().length > 0) {
        const fontFamily = element.styles?.fontFamily as string;
        if (fontFamily) {
          fontFamilies.add(fontFamily);
        }

        if (this.isLikelyIconLigature(element.textContent, element.bounds)) {
          for (const iconFamily of ICON_FALLBACK_FAMILIES) {
            fontFamilies.add(iconFamily);
          }
        }
      }

      // 递归处理子元素
      if (element.children) {
        element.children.forEach(traverse);
      }
    };

    elements.forEach(traverse);
    return fontFamilies;
  }

  private isLikelyIconLigature(text: string, bounds: Bounds): boolean {
    const normalized = text.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    if (!/^[a-z0-9_]+$/.test(normalized) || !normalized.includes("_")) {
      return false;
    }

    if (normalized.length < 3 || normalized.length > 40) {
      return false;
    }

    return bounds.width <= 96 && bounds.height <= 96;
  }

  /**
   * 预加载字体
   */
  private async preloadFonts(fontFamilies: Set<string>): Promise<void> {
    const fontManager = FontManager.getInstance();
    const promises = Array.from(fontFamilies).map((fontFamily) => fontManager.getTypeface(fontFamily));
    await Promise.all(promises);
  }

  private collectImageSources(elements: IRElement[]): Set<string> {
    const imageSources = new Set<string>();

    const extractBackgroundImageUrls = (backgroundImage: string): string[] => {
      const results: string[] = [];
      const regex = /url\((['"]?)(.*?)\1\)/gi;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(backgroundImage)) !== null) {
        const url = match[2]?.trim();
        if (url) {
          results.push(url);
        }
      }
      return results;
    };

    const traverse = (element: IRElement): void => {
      if (typeof element.src === "string" && element.src.trim().length > 0) {
        imageSources.add(element.src.trim());
      }
      if (typeof element.styles?.backgroundImage === "string") {
        for (const url of extractBackgroundImageUrls(element.styles.backgroundImage)) {
          imageSources.add(url);
        }
      }
      if (element.children && element.children.length > 0) {
        element.children.forEach(traverse);
      }
    };

    elements.forEach(traverse);
    return imageSources;
  }

  private async preloadImages(imageSources: Set<string>): Promise<void> {
    if (!this.canvasKit || imageSources.size === 0) {
      return;
    }
    const promises = Array.from(imageSources).map((src) => imageRenderer.loadImage(src, this.canvasKit!));
    await Promise.allSettled(promises);
  }

  /**
   * 同步渲染（字体已预加载）
   */
  private renderSync(elements: IRElement[], options: RenderOptions = {}): void {
    if (!this.canvas || !this.canvasKit) {
      return;
    }

    // 清空画布
    if (options.clear !== false) {
      this.clearCanvas(options.backgroundColor);
    }

    // 应用视口变换
    this.canvas.save();
    if (options.transform) {
      const { translateX = 0, translateY = 0, scale = 1 } = options.transform;
      // 先缩放，再平移（注意：translate 的参数需要除以 scale）
      this.canvas.scale(scale, scale);
      this.canvas.translate(translateX / scale, translateY / scale);
    }

    // 渲染元素
    for (const element of elements) {
      this.renderElement(element);
    }

    // 恢复变换
    this.canvas.restore();

    // 刷新 Surface
    this.flush();
  }

  /**
   * 渲染单个元素
   */
  private renderElement(element: IRElement): void {
    if (!this.canvas || !this.canvasKit) {
      return;
    }

    this.canvas.save();

    // 应用裁剪区域
    if (shouldClipOverflow(element.styles.overflow)) {
      this.applyClip(element);
    }

    // 渲染元素
    try {
      rendererDebugLog("render element", {
        id: element.id,
        type: element.type,
        hasText: typeof element.textContent === "string" && element.textContent.trim().length > 0,
      });
      renderElement(this.canvas, element, this.canvasKit);
    } catch (error) {
      console.error(
        "[VZI][CanvasKitRenderer] render element failed",
        {
          id: element.id,
          type: element.type,
          text: element.textContent,
        },
        error,
      );
      throw error;
    }

    // 渲染子元素
    if (element.children && element.children.length > 0) {
      for (const child of element.children) {
        this.renderElement(child);
      }
    }

    this.canvas.restore();
  }

  /**
   * 应用裁剪区域
   */
  private applyClip(element: IRElement): void {
    if (!this.canvas || !this.canvasKit) {
      return;
    }

    const border = parseBorder(element.styles);
    const path = createBorderPath(element.bounds, border.radius, this.canvasKit);
    try {
      this.canvas.clipPath(path, this.canvasKit.ClipOp.Intersect, true);
    } finally {
      path.delete();
    }
  }

  /**
   * 清空画布
   */
  private clearCanvas(backgroundColor?: string): void {
    if (!this.canvas || !this.canvasKit) {
      return;
    }

    if (backgroundColor) {
      // 使用指定颜色清空
      // 使用 CanvasKit.parseColorString 解析颜色字符串
      const color = this.canvasKit.parseColorString(backgroundColor);
      this.canvas.clear(color);
    } else {
      // 透明清空
      this.canvas.clear(this.canvasKit.Color(0, 0, 0, 0));
    }
  }

  /**
   * 刷新 Surface
   */
  flush(): void {
    if (this.surface) {
      this.surface.flush();
    }
  }

  /**
   * 调整大小
   */
  resize(width: number, height: number): void {
    if (!this.canvasElement) {
      return;
    }

    const surfaceManager = getSurfaceManager();
    const surfaceInfo = surfaceManager.resizeSurface(this.canvasElement, width, height);

    this.surface = surfaceInfo.surface;
    this.canvas = this.surface.getCanvas();
    if (this.annotationRenderer && this.canvas) {
      this.annotationRenderer.setCanvas(this.canvas);
    }
  }

  /**
   * 销毁渲染器
   */
  dispose(): void {
    const surfaceManager = getSurfaceManager();

    if (this.canvasElement) {
      surfaceManager.disposeSurface(this.canvasElement);
    } else if (this.surface) {
      // 兜底：无 canvasElement 时尝试直接释放 Surface
      try {
        this.surface.delete();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[VZI][CanvasKitRenderer] surface already deleted, skip", error);
      }
    }

    this.surface = null;
    this.canvas = null;
    this.canvasElement = null;
    this.canvasKit = null;
    this.isInitialized = false;
    this.preparedElementsRef = null;
  }

  /**
   * 获取 CanvasKit 实例
   */
  getCanvasKit(): CanvasKit | null {
    return this.canvasKit;
  }

  /**
   * 获取 Canvas 实例
   */
  getCanvas(): Canvas | null {
    return this.canvas;
  }

  /**
   * 是否已初始化
   */
  get initialized(): boolean {
    return this.isInitialized;
  }

  // ============================================
  // 标注渲染支持
  // ============================================

  /**
   * 设置标注渲染器
   *
   * @param renderer - 标注渲染器实例
   */
  setAnnotationRenderer(renderer: CanvasAnnotationRenderer): void {
    this.annotationRenderer = renderer;

    // 设置 Canvas 引用
    if (this.canvas) {
      renderer.setCanvas(this.canvas);
    }
  }

  /**
   * 获取标注渲染器
   */
  getAnnotationRenderer(): CanvasAnnotationRenderer | null {
    return this.annotationRenderer;
  }

  /**
   * 渲染标注层
   *
   * 在元素渲染完成后调用，确保标注显示在最上层
   */
  renderAnnotations(): void {
    if (this.annotationRenderer) {
      this.annotationRenderer.render();
    }
  }

  /**
   * 渲染元素和标注（完整流程）
   *
   * @param elements - 元素数组
   * @param options - 渲染选项
   */
  async renderWithAnnotations(elements: IRElement[], options: RenderOptions = {}): Promise<void> {
    if (!this.isInitialized || !this.canvas) {
      console.warn("Renderer not initialized");
      return;
    }

    // 第一阶段：收集所有需要的字体
    const fontFamilies = this.collectFontFamilies(elements);
    if (fontFamilies.size > 0) {
      await this.preloadFonts(fontFamilies);
    }

    // 第二阶段：渲染元素
    this.renderSync(elements, options);

    // 第三阶段：渲染标注（在元素之上）
    this.renderAnnotations();

    // 刷新 Surface
    this.flush();
  }
}

/**
 * 创建渲染器实例
 */
export function createCanvasKitRenderer(): CanvasKitRenderer {
  return new CanvasKitRenderer();
}
