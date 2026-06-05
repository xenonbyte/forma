/**
 * 距离标注渲染器
 *
 * 负责绘制两个元素之间的距离标注线（蓝色实线 + 标签）
 */

import type { CanvasKit, Canvas, Paint } from "canvaskit-wasm";
import type { DistanceData, DistanceStyle, PageRect } from "../types";
import { FontManager } from "../../FontManager";

/**
 * 距离标注渲染器选项
 */
export interface DistanceRendererOptions {
  /** CanvasKit 实例 */
  canvasKit: CanvasKit;
  /** 样式配置 */
  style: DistanceStyle;
  /** 页面尺寸 */
  pageRect: PageRect;
  /** 当前缩放比例 */
  scale: number;
}

/**
 * 距离标注渲染器
 *
 * 用于绘制元素之间的距离标注
 */
export class DistanceRenderer {
  private canvasKit: CanvasKit;
  private style: DistanceStyle;
  private pageRect: PageRect;
  private scale: number;
  private linePaint: Paint | null = null;
  private labelPaint: Paint | null = null;
  private labelBackgroundPaint: Paint | null = null;

  constructor(options: DistanceRendererOptions) {
    this.canvasKit = options.canvasKit;
    this.style = options.style;
    this.pageRect = options.pageRect;
    this.scale = options.scale;
    this.initPaints();
  }

  /**
   * 初始化画笔
   */
  private initPaints(): void {
    const ck = this.canvasKit;

    // 线条画笔
    this.linePaint = new ck.Paint();
    this.linePaint.setColor(this.parseColor(this.style.strokeColor));
    this.linePaint.setStyle(ck.PaintStyle.Stroke);
    this.linePaint.setStrokeWidth(this.style.strokeWidth / this.scale);
    this.linePaint.setAntiAlias(true);

    // 标签背景画笔
    this.labelBackgroundPaint = new ck.Paint();
    this.labelBackgroundPaint.setColor(this.parseColor(this.style.labelBackgroundColor));
    this.labelBackgroundPaint.setStyle(ck.PaintStyle.Fill);
    this.labelBackgroundPaint.setAntiAlias(true);

    // 标签文字画笔
    this.labelPaint = new ck.Paint();
    this.labelPaint.setColor(this.parseColor(this.style.labelTextColor));
    this.labelPaint.setAntiAlias(true);
  }

  /**
   * 解析颜色字符串为 CanvasKit Color
   */
  private parseColor(color: string): Float32Array {
    return this.canvasKit.parseColorString(color);
  }

  /**
   * 渲染距离标注
   *
   * @param canvas - Canvas 实例
   * @param data - 距离数据数组
   */
  render(canvas: Canvas, data: DistanceData[]): void {
    if (!data || data.length === 0) return;

    for (const item of data) {
      this.renderDistanceItem(canvas, item);
    }
  }

  /**
   * 渲染单个距离标注项
   */
  private renderDistanceItem(canvas: Canvas, item: DistanceData): void {
    const pw = this.pageRect.width;
    const ph = this.pageRect.height;

    // 转换为像素坐标
    const x = item.x * pw;
    const y = item.y * ph;

    if (item.w !== undefined) {
      // 水平距离标注
      const width = item.w * pw;
      this.renderHorizontalDistance(canvas, x, y, width, item.distance);
    } else if (item.h !== undefined) {
      // 垂直距离标注
      const height = item.h * ph;
      this.renderVerticalDistance(canvas, x, y, height, item.distance);
    }
  }

  /**
   * 渲染水平距离标注
   */
  private renderHorizontalDistance(canvas: Canvas, x: number, y: number, width: number, distance: number): void {
    // 绘制线条
    canvas.drawLine(x, y, x + width, y, this.linePaint!);

    // 绘制端点标记
    const endCapHeight = 6 / this.scale;
    canvas.drawLine(x, y - endCapHeight, x, y + endCapHeight, this.linePaint!);
    canvas.drawLine(x + width, y - endCapHeight, x + width, y + endCapHeight, this.linePaint!);

    // 绘制标签
    this.renderLabel(canvas, `${Math.round(distance)}px`, x + width / 2, y, "horizontal");
  }

  /**
   * 渲染垂直距离标注
   */
  private renderVerticalDistance(canvas: Canvas, x: number, y: number, height: number, distance: number): void {
    // 绘制线条
    canvas.drawLine(x, y, x, y + height, this.linePaint!);

    // 绘制端点标记
    const endCapWidth = 6 / this.scale;
    canvas.drawLine(x - endCapWidth, y, x + endCapWidth, y, this.linePaint!);
    canvas.drawLine(x - endCapWidth, y + height, x + endCapWidth, y + height, this.linePaint!);

    // 绘制标签
    this.renderLabel(canvas, `${Math.round(distance)}px`, x, y + height / 2, "vertical");
  }

  /**
   * 渲染标签（恒定屏幕尺寸，缩放无关）
   *
   * 与 DimensionRenderer 一致：在锚点处 scale(1/this.scale) 切回设备像素空间绘制，
   * 字形按最终屏幕尺寸一次性栅格化（避免缩放抖动），并按 devicePixelRatio 补偿。
   * 连接两点的距离线仍在世界坐标系绘制，只有这个数值标签是恒定屏幕尺寸。
   *
   * @param x,y 锚点（世界坐标）：水平标注为线段中点、垂直标注为线段中点
   */
  private renderLabel(canvas: Canvas, text: string, x: number, y: number, direction: "horizontal" | "vertical"): void {
    const ck = this.canvasKit;
    const dpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;

    canvas.save();
    canvas.translate(x, y);
    canvas.scale(1 / this.scale, 1 / this.scale);

    const fontSize = this.style.labelFontSize * dpr;
    const [paddingH, paddingV] = this.style.labelPadding;
    const padH = paddingH * dpr;
    const padV = paddingV * dpr;
    const gap = 8 * dpr;

    const fontManager = FontManager.getInstance();
    const typeface = fontManager.getDefaultTypeface();
    const font = new ck.Font(typeface, fontSize);

    const charWidth = fontSize * 0.6;
    const textWidth = text.length * charWidth;
    const textHeight = fontSize;

    const labelWidth = textWidth + padH * 2;
    const labelHeight = textHeight + padV * 2;

    // 锚点在原点(0,0)。水平：居中于上方；垂直：右侧、纵向居中。
    let labelLeft: number;
    let labelTop: number;
    if (direction === "horizontal") {
      labelLeft = -labelWidth / 2;
      labelTop = -labelHeight / 2 - gap;
    } else {
      labelLeft = gap;
      labelTop = -labelHeight / 2;
    }

    const rect = ck.LTRBRect(labelLeft, labelTop, labelLeft + labelWidth, labelTop + labelHeight);
    const radius = this.style.labelBorderRadius * dpr;

    const bgPath = new ck.Path();
    bgPath.addRRect(ck.RRectXY(rect, radius, radius));
    canvas.drawPath(bgPath, this.labelBackgroundPaint!);
    bgPath.delete();

    canvas.drawText(text, labelLeft + padH, labelTop + labelHeight - padV - 2 * dpr, this.labelPaint!, font);

    font.delete();
    canvas.restore();
  }

  /**
   * 更新样式
   */
  updateStyle(style: DistanceStyle): void {
    this.style = style;
    this.dispose();
    this.initPaints();
  }

  /**
   * 更新缩放比例
   */
  updateScale(scale: number): void {
    this.scale = scale;
    this.dispose();
    this.initPaints();
  }

  /**
   * 更新页面尺寸
   */
  updatePageRect(pageRect: PageRect): void {
    this.pageRect = pageRect;
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.linePaint?.delete();
    this.labelPaint?.delete();
    this.labelBackgroundPaint?.delete();

    this.linePaint = null;
    this.labelPaint = null;
    this.labelBackgroundPaint = null;
  }
}
