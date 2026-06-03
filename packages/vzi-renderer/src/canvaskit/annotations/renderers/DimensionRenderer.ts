/**
 * 尺寸标注渲染器
 *
 * 负责绘制选中元素的尺寸标签（宽 × 高）
 */

import type { CanvasKit, Canvas, Paint } from 'canvaskit-wasm';
import type { SelectionStyle, ElementBounds } from '../types';
import { FontManager } from '../../FontManager';

/**
 * 尺寸标注渲染器选项
 */
export interface DimensionRendererOptions {
  /** CanvasKit 实例 */
  canvasKit: CanvasKit;
  /** 选中框样式配置（包含尺寸标签配置） */
  style: SelectionStyle;
  /** 当前缩放比例 */
  scale: number;
}

/**
 * 尺寸标注渲染器
 *
 * 用于绘制选中元素的尺寸标签
 */
export class DimensionRenderer {
  private canvasKit: CanvasKit;
  private style: SelectionStyle;
  private scale: number;
  private labelPaint: Paint | null = null;
  private labelBackgroundPaint: Paint | null = null;

  constructor(options: DimensionRendererOptions) {
    this.canvasKit = options.canvasKit;
    this.style = options.style;
    this.scale = options.scale;
    this.initPaints();
  }

  /**
   * 初始化画笔
   */
  private initPaints(): void {
    const ck = this.canvasKit;

    // 标签背景画笔（使用选中框颜色）
    this.labelBackgroundPaint = new ck.Paint();
    this.labelBackgroundPaint.setColor(
      this.parseColor(this.style.dimensionLabelBgColor || this.style.strokeColor)
    );
    this.labelBackgroundPaint.setStyle(ck.PaintStyle.Fill);
    this.labelBackgroundPaint.setAntiAlias(true);

    // 标签文字画笔
    this.labelPaint = new ck.Paint();
    this.labelPaint.setColor(
      this.parseColor(this.style.dimensionLabelTextColor || '#ffffff')
    );
    this.labelPaint.setAntiAlias(true);
  }

  /**
   * 解析颜色字符串
   */
  private parseColor(color: string): Float32Array {
    return this.canvasKit.parseColorString(color);
  }

  /**
   * 渲染选中元素的尺寸标签
   *
   * @param canvas - Canvas 实例
   * @param bounds - 元素边界
   */
  render(canvas: Canvas, bounds: ElementBounds): void {
    // 检查是否显示尺寸标签
    if (this.style.showDimensionLabel === false) {
      return;
    }

    // 格式化文本：宽 × 高
    const width = Math.round(bounds.width);
    const height = Math.round(bounds.height);
    const text = `${width} × ${height}`;

    // 锚点：元素底边中心（世界坐标）。标签在其下方、恒定屏幕尺寸绘制。
    const anchorX = bounds.left + bounds.width / 2;
    const anchorY = bounds.top + bounds.height;

    this.renderLabel(canvas, text, anchorX, anchorY);
  }

  /**
   * 渲染标签（恒定屏幕尺寸，缩放无关）
   *
   * 传入的 canvas 已应用视口变换 translate(offset)+scale(this.scale)，其中
   * this.scale 为「设备像素 / 世界单位」。我们在锚点处 scale(1/this.scale) 切回
   * 设备像素空间，按设备像素绘制标签——字形按最终尺寸一次性栅格化，避免
   * 「世界字号栅格化再缩放」带来的亚像素抖动；同时按 devicePixelRatio 补偿，
   * 使其在 Retina 上仍是可读的 ~12 CSS px。
   */
  private renderLabel(
    canvas: Canvas,
    text: string,
    anchorWorldX: number,
    anchorWorldY: number
  ): void {
    const ck = this.canvasKit;
    const dpr =
      typeof window !== 'undefined' && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1;

    // 切换到以锚点为原点的设备像素空间。
    canvas.save();
    canvas.translate(anchorWorldX, anchorWorldY);
    canvas.scale(1 / this.scale, 1 / this.scale);

    // 设备像素尺寸（dpr 补偿后等价于固定的 CSS px）。
    const fontSize = (this.style.dimensionLabelFontSize || 12) * dpr;
    const [paddingH, paddingV] = this.style.dimensionLabelPadding || [8, 4];
    const padH = paddingH * dpr;
    const padV = paddingV * dpr;
    const gap = 8 * dpr; // 元素下方 8px（屏幕）

    const fontManager = FontManager.getInstance();
    const typeface = fontManager.getDefaultTypeface();
    const font = new ck.Font(typeface, fontSize);

    // 测量文本（简化估算）。
    const charWidth = fontSize * 0.6;
    const textWidth = text.length * charWidth;
    const textHeight = fontSize;

    const labelWidth = textWidth + padH * 2;
    const labelHeight = textHeight + padV * 2;

    // 锚点在原点(0,0)，标签水平居中、置于元素下方。
    const labelLeft = -labelWidth / 2;
    const labelTop = gap;

    const rect = ck.LTRBRect(labelLeft, labelTop, labelLeft + labelWidth, labelTop + labelHeight);
    const radius = (this.style.dimensionLabelBorderRadius || 4) * dpr;

    const bgPath = new ck.Path();
    bgPath.addRRect(ck.RRectXY(rect, radius, radius));
    canvas.drawPath(bgPath, this.labelBackgroundPaint!);
    bgPath.delete();

    canvas.drawText(
      text,
      labelLeft + padH,
      labelTop + labelHeight - padV - 2 * dpr,
      this.labelPaint!,
      font
    );

    font.delete();
    canvas.restore();
  }

  /**
   * 更新样式
   */
  updateStyle(style: SelectionStyle): void {
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
   * 释放资源
   */
  dispose(): void {
    this.labelPaint?.delete();
    this.labelBackgroundPaint?.delete();

    this.labelPaint = null;
    this.labelBackgroundPaint = null;
  }
}
