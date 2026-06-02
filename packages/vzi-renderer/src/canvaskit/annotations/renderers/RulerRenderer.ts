/**
 * 标尺线渲染器
 *
 * 负责绘制辅助对齐的虚线标尺
 */

import type { CanvasKit, Canvas, Paint } from 'canvaskit-wasm';
import type { RulerData, RulerStyle, PageRect } from '../types';

/**
 * 标尺线渲染器选项
 */
export interface RulerRendererOptions {
  /** CanvasKit 实例 */
  canvasKit: CanvasKit;
  /** 样式配置 */
  style: RulerStyle;
  /** 页面尺寸 */
  pageRect: PageRect;
  /** 当前缩放比例 */
  scale: number;
}

/**
 * 标尺线渲染器
 *
 * 用于绘制辅助对齐的虚线标尺
 */
export class RulerRenderer {
  private canvasKit: CanvasKit;
  private style: RulerStyle;
  private pageRect: PageRect;
  private scale: number;
  private linePaint: Paint | null = null;

  constructor(options: RulerRendererOptions) {
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

    // 虚线画笔
    this.linePaint = new ck.Paint();
    this.linePaint.setColor(this.parseColor(this.style.strokeColor));
    this.linePaint.setStyle(ck.PaintStyle.Stroke);
    this.linePaint.setStrokeWidth(this.style.strokeWidth / this.scale);
    this.linePaint.setAntiAlias(true);

    // 设置虚线效果
    if (this.style.dashArray && this.style.dashArray.length >= 2) {
      const dashArray = [
        this.style.dashArray[0] / this.scale,
        this.style.dashArray[1] / this.scale,
      ];
      this.linePaint.setPathEffect(ck.PathEffect.MakeDash(dashArray, 0));
    }

    // 设置透明度
    this.linePaint.setAlphaf(this.style.opacity);
  }

  /**
   * 解析颜色字符串
   */
  private parseColor(color: string): Float32Array {
    return this.canvasKit.parseColorString(color);
  }

  /**
   * 渲染标尺线
   *
   * @param canvas - Canvas 实例
   * @param data - 标尺数据数组
   */
  render(canvas: Canvas, data: RulerData[]): void {
    if (!data || data.length === 0) return;

    for (const item of data) {
      this.renderRulerItem(canvas, item);
    }
  }

  /**
   * 渲染单个标尺线
   */
  private renderRulerItem(canvas: Canvas, item: RulerData): void {
    const pw = this.pageRect.width;
    const ph = this.pageRect.height;

    // 转换为像素坐标
    const x = item.x * pw;
    const y = item.y * ph;

    if (item.w !== undefined) {
      // 水平标尺线
      const width = item.w * pw;
      this.renderHorizontalRuler(canvas, x, y, width);
    } else if (item.h !== undefined) {
      // 垂直标尺线
      const height = item.h * ph;
      this.renderVerticalRuler(canvas, x, y, height);
    }
  }

  /**
   * 渲染水平标尺线
   */
  private renderHorizontalRuler(
    canvas: Canvas,
    x: number,
    y: number,
    width: number
  ): void {
    canvas.drawLine(x, y, x + width, y, this.linePaint!);
  }

  /**
   * 渲染垂直标尺线
   */
  private renderVerticalRuler(
    canvas: Canvas,
    x: number,
    y: number,
    height: number
  ): void {
    canvas.drawLine(x, y, x, y + height, this.linePaint!);
  }

  /**
   * 更新样式
   */
  updateStyle(style: RulerStyle): void {
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
    this.linePaint = null;
  }
}
