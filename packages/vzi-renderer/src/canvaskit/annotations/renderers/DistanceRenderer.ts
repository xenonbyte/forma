/**
 * 距离标注渲染器
 *
 * 负责绘制两个元素之间的距离标注线（蓝色实线 + 标签）
 */

import type { CanvasKit, Canvas, Paint } from 'canvaskit-wasm';
import type { DistanceData, DistanceStyle, PageRect } from '../types';
import { FontManager } from '../../FontManager';

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
  private renderHorizontalDistance(
    canvas: Canvas,
    x: number,
    y: number,
    width: number,
    distance: number
  ): void {
    // 绘制线条
    canvas.drawLine(x, y, x + width, y, this.linePaint!);

    // 绘制端点标记
    const endCapHeight = 6 / this.scale;
    canvas.drawLine(x, y - endCapHeight, x, y + endCapHeight, this.linePaint!);
    canvas.drawLine(
      x + width,
      y - endCapHeight,
      x + width,
      y + endCapHeight,
      this.linePaint!
    );

    // 绘制标签
    this.renderLabel(
      canvas,
      `${Math.round(distance)}px`,
      x + width / 2,
      y,
      'horizontal'
    );
  }

  /**
   * 渲染垂直距离标注
   */
  private renderVerticalDistance(
    canvas: Canvas,
    x: number,
    y: number,
    height: number,
    distance: number
  ): void {
    // 绘制线条
    canvas.drawLine(x, y, x, y + height, this.linePaint!);

    // 绘制端点标记
    const endCapWidth = 6 / this.scale;
    canvas.drawLine(x - endCapWidth, y, x + endCapWidth, y, this.linePaint!);
    canvas.drawLine(
      x - endCapWidth,
      y + height,
      x + endCapWidth,
      y + height,
      this.linePaint!
    );

    // 绘制标签
    this.renderLabel(
      canvas,
      `${Math.round(distance)}px`,
      x,
      y + height / 2,
      'vertical'
    );
  }

  /**
   * 渲染标签
   */
  private renderLabel(
    canvas: Canvas,
    text: string,
    x: number,
    y: number,
    direction: 'horizontal' | 'vertical'
  ): void {
    const ck = this.canvasKit;
    const fontSize = this.style.labelFontSize / this.scale;
    const [paddingH, paddingV] = this.style.labelPadding;

    // 使用 FontManager 获取字体
    const fontManager = FontManager.getInstance();
    const typeface = fontManager.getDefaultTypeface();
    const font = new ck.Font(typeface, fontSize);

    // 测量文本（使用简化估算方法）
    const charWidth = fontSize * 0.6;
    const textWidth = text.length * charWidth;
    const textHeight = fontSize;

    // 计算标签尺寸
    const labelWidth = textWidth + (paddingH * 2) / this.scale;
    const labelHeight = textHeight + (paddingV * 2) / this.scale;

    // 计算标签位置
    let labelX: number;
    let labelY: number;

    if (direction === 'horizontal') {
      labelX = x - labelWidth / 2;
      labelY = y - labelHeight / 2 - 8 / this.scale;
    } else {
      labelX = x + 8 / this.scale;
      labelY = y - labelHeight / 2;
    }

    // 绘制圆角矩形背景
    const rect = ck.LTRBRect(
      labelX,
      labelY,
      labelX + labelWidth,
      labelY + labelHeight
    );
    const radius = this.style.labelBorderRadius / this.scale;

    const bgPath = new ck.Path();
    bgPath.addRRect(
      ck.RRectXY(rect, radius, radius)
    );
    canvas.drawPath(bgPath, this.labelBackgroundPaint!);
    bgPath.delete();

    // 绘制文本
    canvas.drawText(
      text,
      labelX + paddingH / this.scale,
      labelY + labelHeight - paddingV / this.scale - 2 / this.scale,
      this.labelPaint!,
      font
    );

    font.delete();
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
