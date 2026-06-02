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

    // 计算标签位置（元素下方居中）
    const labelX = bounds.left + bounds.width / 2;
    const labelY = bounds.top + bounds.height + 8 / this.scale; // 元素下方 8px

    this.renderLabel(canvas, text, labelX, labelY);
  }

  /**
   * 渲染标签
   */
  private renderLabel(
    canvas: Canvas,
    text: string,
    x: number,
    y: number
  ): void {
    const ck = this.canvasKit;
    const fontSize = (this.style.dimensionLabelFontSize || 12) / this.scale;
    const [paddingH, paddingV] = this.style.dimensionLabelPadding || [8, 4];

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

    // 计算标签位置（居中）
    const labelX = x - labelWidth / 2;
    const labelY = y;

    // 绘制圆角矩形背景
    const rect = ck.LTRBRect(
      labelX,
      labelY,
      labelX + labelWidth,
      labelY + labelHeight
    );
    const radius = (this.style.dimensionLabelBorderRadius || 4) / this.scale;

    const bgPath = new ck.Path();
    bgPath.addRRect(ck.RRectXY(rect, radius, radius));
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
