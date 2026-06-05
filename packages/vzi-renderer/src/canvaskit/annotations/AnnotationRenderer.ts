/**
 * 标注渲染器主类
 *
 * 管理标注的生命周期、状态和渲染流程
 */

import type { CanvasKit, Canvas, Paint } from "canvaskit-wasm";
import type {
  AnnotationElement,
  AnnotationRendererOptions,
  AnnotationStyleConfig,
  PageRect,
  PartialAnnotationStyleConfig,
  ViewportConfig,
  ViewportState,
  ElementBounds,
} from "./types";
import { AnnotationStyles } from "./AnnotationStyles";
import { ViewportManager } from "./ViewportManager";
import { calculateMarkData } from "./DistanceCalculator";
import { DistanceRenderer } from "./renderers/DistanceRenderer";
import { DimensionRenderer } from "./renderers/DimensionRenderer";
import { RulerRenderer } from "./renderers/RulerRenderer";

/**
 * 标注渲染器
 *
 * 负责管理设计稿标注的渲染，包括：
 * - 选中/悬停状态管理
 * - 距离标注
 * - 尺寸标注
 * - 标尺线
 */
export class CanvasAnnotationRenderer {
  private canvasKit: CanvasKit;
  private canvas: Canvas | null = null;
  private styles: AnnotationStyles;
  private viewportManager: ViewportManager;

  // 状态
  private selectedElement: AnnotationElement | null = null;
  private hoveredElement: AnnotationElement | null = null;
  private elements: Map<string, AnnotationElement> = new Map();
  private pageRect: PageRect;

  // 子渲染器
  private distanceRenderer: DistanceRenderer | null = null;
  private dimensionRenderer: DimensionRenderer | null = null;
  private rulerRenderer: RulerRenderer | null = null;

  // 选中/悬停框画笔
  private selectionPaint: Paint | null = null;
  private hoverPaint: Paint | null = null;
  private hoverFillPaint: Paint | null = null;

  // 缓存的计算结果
  private cachedDistanceData: ReturnType<typeof calculateMarkData> | null = null;

  constructor(options: AnnotationRendererOptions) {
    this.canvasKit = options.canvasKit as CanvasKit;
    this.canvas = options.canvas as Canvas;
    this.styles = new AnnotationStyles(options.styles);
    this.viewportManager = new ViewportManager(options.viewport);

    // 默认页面尺寸
    this.pageRect = { width: 1000, height: 800 };

    // 初始化子渲染器
    this.initRenderers();

    // 初始化选中/悬停框画笔
    this.initSelectionPaints();
  }

  /**
   * 初始化选中/悬停框画笔
   */
  private initSelectionPaints(): void {
    const ck = this.canvasKit;
    const scale = this.viewportManager.getState().scale;
    const styleConfig = this.styles.getConfig();

    // 选中框画笔（边框）
    this.selectionPaint = new ck.Paint();
    this.selectionPaint.setColor(this.parseColor(styleConfig.selection.strokeColor));
    this.selectionPaint.setStyle(ck.PaintStyle.Stroke);
    this.selectionPaint.setStrokeWidth(styleConfig.selection.strokeWidth / scale);
    this.selectionPaint.setAntiAlias(true);

    // 悬停框画笔（边框）
    this.hoverPaint = new ck.Paint();
    this.hoverPaint.setColor(this.parseColor(styleConfig.hover.strokeColor));
    this.hoverPaint.setStyle(ck.PaintStyle.Stroke);
    this.hoverPaint.setStrokeWidth(styleConfig.hover.strokeWidth / scale);
    this.hoverPaint.setAntiAlias(true);

    // 悬停框填充画笔
    this.hoverFillPaint = new ck.Paint();
    const hoverColor = this.parseColor(styleConfig.hover.strokeColor);
    // 复制颜色数组并设置透明度
    const colorWithOpacity = new Float32Array([
      hoverColor[0],
      hoverColor[1],
      hoverColor[2],
      styleConfig.hover.fillOpacity,
    ]);
    this.hoverFillPaint.setColor(colorWithOpacity);
    this.hoverFillPaint.setStyle(ck.PaintStyle.Fill);
    this.hoverFillPaint.setAntiAlias(true);
  }

  /**
   * 解析颜色字符串
   */
  private parseColor(color: string): Float32Array {
    return this.canvasKit.parseColorString(color);
  }

  /**
   * 初始化子渲染器
   */
  private initRenderers(): void {
    const styleConfig = this.styles.getConfig();

    this.distanceRenderer = new DistanceRenderer({
      canvasKit: this.canvasKit,
      style: styleConfig.distance,
      pageRect: this.pageRect,
      scale: this.viewportManager.getState().scale,
    });

    this.dimensionRenderer = new DimensionRenderer({
      canvasKit: this.canvasKit,
      style: styleConfig.selection, // 使用 selection 配置
      scale: this.viewportManager.getState().scale,
    });

    this.rulerRenderer = new RulerRenderer({
      canvasKit: this.canvasKit,
      style: styleConfig.ruler,
      pageRect: this.pageRect,
      scale: this.viewportManager.getState().scale,
    });
  }

  // ============================================
  // 元素管理
  // ============================================

  /**
   * 设置所有元素
   */
  setElements(elements: AnnotationElement[]): void {
    this.elements.clear();
    for (const element of elements) {
      this.elements.set(element.id, element);
    }

    // 更新页面尺寸（基于元素边界）
    this.updatePageRectFromElements();
  }

  /**
   * 添加单个元素
   */
  addElement(element: AnnotationElement): void {
    this.elements.set(element.id, element);
  }

  /**
   * 移除元素
   */
  removeElement(elementId: string): void {
    this.elements.delete(elementId);

    // 如果移除的是选中或悬停元素，清除状态
    if (this.selectedElement?.id === elementId) {
      this.selectedElement = null;
    }
    if (this.hoveredElement?.id === elementId) {
      this.hoveredElement = null;
    }
  }

  /**
   * 根据元素更新页面尺寸
   */
  private updatePageRectFromElements(): void {
    let maxX = 0;
    let maxY = 0;

    for (const element of this.elements.values()) {
      const right = element.bounds.left + element.bounds.width;
      const bottom = element.bounds.top + element.bounds.height;

      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }

    // 添加边距
    this.pageRect = {
      width: Math.max(maxX + 50, 100),
      height: Math.max(maxY + 50, 100),
    };

    // 更新子渲染器
    this.distanceRenderer?.updatePageRect(this.pageRect);
    this.rulerRenderer?.updatePageRect(this.pageRect);
  }

  // ============================================
  // 状态管理
  // ============================================

  /**
   * 设置选中元素
   */
  setSelectedElement(element: AnnotationElement | null): void {
    this.selectedElement = element;
    this.clearCache();

    // 如果有悬停元素，重新计算距离
    if (this.selectedElement && this.hoveredElement) {
      this.calculateDistance();
    }
  }

  /**
   * 通过 ID 设置选中元素
   */
  setSelectedElementById(elementId: string | null): void {
    if (elementId === null) {
      this.setSelectedElement(null);
      return;
    }

    const element = this.elements.get(elementId);
    if (element) {
      this.setSelectedElement(element);
    }
  }

  /**
   * 设置悬停元素
   */
  setHoveredElement(element: AnnotationElement | null): void {
    this.hoveredElement = element;
    this.clearCache();

    // 如果有选中元素，计算距离
    if (this.selectedElement && this.hoveredElement) {
      this.calculateDistance();
    }
  }

  /**
   * 通过 ID 设置悬停元素
   */
  setHoveredElementById(elementId: string | null): void {
    if (elementId === null) {
      this.setHoveredElement(null);
      return;
    }

    const element = this.elements.get(elementId);
    if (element) {
      this.setHoveredElement(element);
    }
  }

  /**
   * 获取选中元素
   */
  getSelectedElement(): AnnotationElement | null {
    return this.selectedElement;
  }

  /**
   * 获取悬停元素
   */
  getHoveredElement(): AnnotationElement | null {
    return this.hoveredElement;
  }

  // ============================================
  // 距离计算
  // ============================================

  /**
   * 清除缓存
   */
  private clearCache(): void {
    this.cachedDistanceData = null;
  }

  /**
   * 计算距离标注数据
   */
  private calculateDistance(): void {
    if (!this.selectedElement || !this.hoveredElement) {
      this.cachedDistanceData = null;
      return;
    }

    this.cachedDistanceData = calculateMarkData(this.selectedElement.bounds, this.hoveredElement.bounds, this.pageRect);
  }

  // ============================================
  // 渲染
  // ============================================

  /**
   * 渲染所有标注
   */
  render(): void {
    if (!this.canvas) return;

    const canvas = this.canvas;

    // 应用视口变换
    const state = this.viewportManager.getState();
    canvas.save();
    canvas.translate(state.offset.x, state.offset.y);
    canvas.scale(state.scale, state.scale);

    // 1. 渲染悬停元素框（先渲染，这样选中框在上面）
    if (this.hoveredElement && this.hoveredElement !== this.selectedElement) {
      this.renderElementBox(canvas, this.hoveredElement.bounds, "hover");
    }

    // 2. 渲染选中元素框
    if (this.selectedElement) {
      this.renderElementBox(canvas, this.selectedElement.bounds, "selection");
      // 渲染选中元素的尺寸标注
      this.dimensionRenderer?.render(canvas, this.selectedElement.bounds);
    }

    // 3. 渲染距离标注和标尺线
    if (this.cachedDistanceData) {
      this.distanceRenderer?.render(canvas, this.cachedDistanceData.distanceData);
      this.rulerRenderer?.render(canvas, this.cachedDistanceData.rulerData);
    }

    canvas.restore();
  }

  /**
   * 渲染元素边框
   */
  private renderElementBox(canvas: Canvas, bounds: ElementBounds, type: "selection" | "hover"): void {
    const x = bounds.left;
    const y = bounds.top;
    const width = bounds.width;
    const height = bounds.height;

    // 创建矩形对象
    const rect = this.canvasKit.LTRBRect(x, y, x + width, y + height);

    if (type === "hover") {
      // 先绘制填充
      canvas.drawRect(rect, this.hoverFillPaint!);
      // 再绘制边框
      canvas.drawRect(rect, this.hoverPaint!);
    } else {
      // 绘制选中框边框
      canvas.drawRect(rect, this.selectionPaint!);
    }
  }

  /**
   * 清除所有标注
   */
  clear(): void {
    this.selectedElement = null;
    this.hoveredElement = null;
    this.clearCache();
  }

  // ============================================
  // 样式配置
  // ============================================

  /**
   * 更新样式配置
   */
  updateStyles(styles: PartialAnnotationStyleConfig): void {
    this.styles.update(styles);

    // 更新子渲染器样式
    const config = this.styles.getConfig();
    this.distanceRenderer?.updateStyle(config.distance);
    this.dimensionRenderer?.updateStyle(config.selection); // 使用 selection 配置
    this.rulerRenderer?.updateStyle(config.ruler);
  }

  /**
   * 获取当前样式配置
   */
  getStyles(): Readonly<AnnotationStyleConfig> {
    return this.styles.getConfig();
  }

  // ============================================
  // 视口管理
  // ============================================

  /**
   * 设置视口配置
   */
  setViewportConfig(config: Partial<ViewportConfig>): void {
    this.viewportManager.updateConfig(config);
  }

  /**
   * 获取视口状态
   */
  getViewportState(): ViewportState {
    return this.viewportManager.getState();
  }

  /**
   * 平移视口
   */
  pan(dx: number, dy: number): void {
    this.viewportManager.pan(dx, dy);
  }

  /**
   * 设置视口偏移
   */
  setOffset(x: number, y: number): void {
    this.viewportManager.setOffset(x, y);
  }

  /**
   * 设置缩放比例
   */
  setScale(scale: number): void {
    this.viewportManager.setScale(scale);
    // 更新所有渲染器的缩放
    this.distanceRenderer?.updateScale(scale);
    this.dimensionRenderer?.updateScale(scale);
    this.rulerRenderer?.updateScale(scale);
    // 重新初始化选中/悬停画笔以更新线宽
    this.updateSelectionPaintsScale(scale);
  }

  /**
   * 更新选中/悬停画笔的缩放
   */
  private updateSelectionPaintsScale(scale: number): void {
    const styleConfig = this.styles.getConfig();
    if (this.selectionPaint) {
      this.selectionPaint.setStrokeWidth(styleConfig.selection.strokeWidth / scale);
    }
    if (this.hoverPaint) {
      this.hoverPaint.setStrokeWidth(styleConfig.hover.strokeWidth / scale);
    }
  }

  /**
   * 屏幕坐标转设计稿坐标
   */
  screenToDesign(x: number, y: number): { x: number; y: number } {
    return this.viewportManager.screenToDesign(x, y);
  }

  /**
   * 设计稿坐标转屏幕坐标
   */
  designToScreen(x: number, y: number): { x: number; y: number } {
    return this.viewportManager.designToScreen(x, y);
  }

  // ============================================
  // 生命周期
  // ============================================

  /**
   * 设置 Canvas
   */
  setCanvas(canvas: Canvas): void {
    this.canvas = canvas;
  }

  /**
   * 获取页面尺寸
   */
  getPageRect(): PageRect {
    return { ...this.pageRect };
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.distanceRenderer?.dispose();
    this.dimensionRenderer?.dispose();
    this.rulerRenderer?.dispose();

    // 释放选中/悬停画笔
    this.selectionPaint?.delete();
    this.hoverPaint?.delete();
    this.hoverFillPaint?.delete();

    this.selectionPaint = null;
    this.hoverPaint = null;
    this.hoverFillPaint = null;

    this.distanceRenderer = null;
    this.dimensionRenderer = null;
    this.rulerRenderer = null;

    this.elements.clear();
    this.selectedElement = null;
    this.hoveredElement = null;
    this.cachedDistanceData = null;
    this.canvas = null;
  }
}
