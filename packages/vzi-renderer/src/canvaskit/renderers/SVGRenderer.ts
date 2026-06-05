/**
 * SVG 渲染器
 *
 * 渲染 SVG 元素，支持 path、circle、rect、polygon
 */

import type { CanvasKit, Canvas, Paint, Path } from "canvaskit-wasm";
import type { IElementRenderer, IRElement, Bounds, Styles } from "./types";
import { toCanvasKitColor } from "../converters/ColorConverter";

/**
 * SVG 类型列表
 */
const SVG_TYPES = ["svg", "path", "circle", "rect", "polygon", "line", "ellipse", "polyline"];

/**
 * SVG 元素数据
 */
interface SVGElementData {
  type: string;
  // path 特有
  d?: string;
  // circle 特有
  cx?: number;
  cy?: number;
  r?: number;
  // rect 特有
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rx?: number;
  ry?: number;
  // polygon/polyline 特有
  points?: string;
  // line 特有
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  // ellipse 特有
  rx_ellipse?: number;
  ry_ellipse?: number;
  // 通用样式
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

interface SVGPathData {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  strokeDashoffset?: number;
  strokeLinecap?: string;
  opacity?: number;
}

interface SVGCircleData {
  cx: number;
  cy: number;
  r: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  strokeDashoffset?: number;
  strokeLinecap?: string;
  opacity?: number;
}

interface SVGRectData {
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  ry?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

interface SVGPolygonData {
  points: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

interface SVGDataBundle {
  viewBox?: string;
  preserveAspectRatio?: string;
  paths?: SVGPathData[];
  circles?: SVGCircleData[];
  rects?: SVGRectData[];
  polygons?: SVGPolygonData[];
}

/**
 * SVG 渲染器
 */
export class SVGRenderer implements IElementRenderer {
  canRender(type: string): boolean {
    return SVG_TYPES.includes(type);
  }

  render(canvas: Canvas, element: IRElement, CanvasKit: CanvasKit): void {
    const { bounds, styles } = element;

    // 如果有 SVG 数据，解析并渲染
    if (element.svgData) {
      try {
        const parsed = JSON.parse(element.svgData) as SVGElementData | SVGDataBundle;
        if (this.isSVGDataBundle(parsed)) {
          this.renderSVGDataBundle(canvas, parsed, bounds, styles, CanvasKit);
          return;
        }
        this.renderSVGElement(canvas, parsed as SVGElementData, bounds, styles, CanvasKit);
      } catch (error) {
        console.error("Failed to parse SVG data:", error);
      }
    }
  }

  private isSVGDataBundle(value: SVGElementData | SVGDataBundle): value is SVGDataBundle {
    const maybeBundle = value as SVGDataBundle;
    return (
      Array.isArray(maybeBundle.paths) ||
      Array.isArray(maybeBundle.circles) ||
      Array.isArray(maybeBundle.rects) ||
      Array.isArray(maybeBundle.polygons)
    );
  }

  private parseViewBox(
    viewBox: string | undefined,
    bounds: Bounds,
  ): { minX: number; minY: number; width: number; height: number } {
    if (typeof viewBox === "string") {
      const parts = viewBox
        .trim()
        .split(/[\s,]+/)
        .map((part) => Number.parseFloat(part))
        .filter((value) => Number.isFinite(value));
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        return {
          minX: parts[0],
          minY: parts[1],
          width: parts[2],
          height: parts[3],
        };
      }
    }
    return {
      minX: 0,
      minY: 0,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
    };
  }

  private parseDashArray(raw: string | undefined): number[] {
    if (!raw || raw === "none") {
      return [];
    }
    const parsed = raw
      .split(/[,\s]+/)
      .map((part) => Number.parseFloat(part))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (parsed.length === 1) {
      return [parsed[0], parsed[0]];
    }
    if (parsed.length % 2 === 1) {
      return [...parsed, ...parsed];
    }
    return parsed;
  }

  private isTransparentColor(value: string | undefined): boolean {
    if (!value) {
      return true;
    }
    const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
    return (
      normalized === "none" ||
      normalized === "transparent" ||
      normalized === "rgba(0,0,0,0)" ||
      normalized === "rgb(0,0,0,0)" ||
      normalized === "#0000" ||
      normalized === "#00000000" ||
      normalized === "hsla(0,0%,0%,0)"
    );
  }

  private applySVGTransform(canvas: Canvas, bounds: Bounds, styles: Styles): void {
    const transform = typeof styles.transform === "string" ? styles.transform : "";
    const matrixMatch = transform.match(/^matrix\(([^)]+)\)$/);
    if (!matrixMatch) {
      return;
    }
    const values = matrixMatch[1]
      .split(",")
      .map((token) => Number.parseFloat(token.trim()))
      .filter((value) => Number.isFinite(value));
    if (values.length < 4) {
      return;
    }
    const [a, b, c, d] = values;
    const eps = 0.001;
    let rotation: number | null = null;

    if (
      Math.abs(a) <= eps &&
      Math.abs(d) <= eps &&
      Math.abs(Math.abs(b) - 1) <= eps &&
      Math.abs(Math.abs(c) - 1) <= eps
    ) {
      rotation = b < 0 ? -90 : 90;
    } else if (Math.abs(a + 1) <= eps && Math.abs(d + 1) <= eps && Math.abs(b) <= eps && Math.abs(c) <= eps) {
      rotation = 180;
    }

    if (rotation === null) {
      return;
    }

    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    canvas.translate(cx, cy);
    canvas.rotate(rotation, 0, 0);
    canvas.translate(-cx, -cy);
  }

  private createFillPaint(fill: string | undefined, opacity: number, CanvasKit: CanvasKit): Paint | null {
    if (this.isTransparentColor(fill)) {
      return null;
    }
    const paint = new CanvasKit.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(CanvasKit.PaintStyle.Fill);
    paint.setColor(toCanvasKitColor(fill!, CanvasKit));
    const color = paint.getColor();
    paint.setColor([color[0], color[1], color[2], Math.max(0, Math.min(1, color[3] * opacity))]);
    return paint;
  }

  private createStrokePaint(
    stroke: string | undefined,
    strokeWidth: number | undefined,
    strokeDasharray: string | undefined,
    strokeDashoffset: number | undefined,
    strokeLinecap: string | undefined,
    opacity: number,
    CanvasKit: CanvasKit,
  ): { paint: Paint } | null {
    if (this.isTransparentColor(stroke)) {
      return null;
    }

    const paint = new CanvasKit.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(CanvasKit.PaintStyle.Stroke);
    paint.setColor(toCanvasKitColor(stroke!, CanvasKit));
    paint.setStrokeWidth(strokeWidth && strokeWidth > 0 ? strokeWidth : 1);
    if (strokeLinecap === "round" && CanvasKit.StrokeCap?.Round !== undefined) {
      paint.setStrokeCap(CanvasKit.StrokeCap.Round);
    } else if (strokeLinecap === "square" && CanvasKit.StrokeCap?.Square !== undefined) {
      paint.setStrokeCap(CanvasKit.StrokeCap.Square);
    } else if (CanvasKit.StrokeCap?.Butt !== undefined) {
      paint.setStrokeCap(CanvasKit.StrokeCap.Butt);
    }

    const dashArray = this.parseDashArray(strokeDasharray);
    if (dashArray.length > 0 && CanvasKit.PathEffect?.MakeDash) {
      const dashOffset = Number.isFinite(strokeDashoffset ?? NaN) ? (strokeDashoffset as number) : 0;
      // effect.delete() 释放 JS 端引用；Skia 层由 paint 持有，paint.delete() 时自动清理
      const effect = CanvasKit.PathEffect.MakeDash(dashArray, dashOffset);
      if (effect) {
        paint.setPathEffect(effect);
        effect.delete();
      }
    }

    const color = paint.getColor();
    paint.setColor([color[0], color[1], color[2], Math.max(0, Math.min(1, color[3] * opacity))]);

    return { paint };
  }

  private renderSVGDataBundle(
    canvas: Canvas,
    svgData: SVGDataBundle,
    bounds: Bounds,
    styles: Styles,
    CanvasKit: CanvasKit,
  ): void {
    const viewBox = this.parseViewBox(svgData.viewBox, bounds);
    canvas.save();
    try {
      this.applySVGTransform(canvas, bounds, styles);
      canvas.translate(bounds.x, bounds.y);
      canvas.scale(bounds.width / Math.max(viewBox.width, 1), bounds.height / Math.max(viewBox.height, 1));
      canvas.translate(-viewBox.minX, -viewBox.minY);

      for (const pathData of svgData.paths || []) {
        const opacity = pathData.opacity ?? styles.opacity ?? 1;
        const fillPaint = this.createFillPaint(pathData.fill, opacity, CanvasKit);
        const strokeResult = this.createStrokePaint(
          pathData.stroke,
          pathData.strokeWidth,
          pathData.strokeDasharray,
          pathData.strokeDashoffset,
          pathData.strokeLinecap,
          opacity,
          CanvasKit,
        );
        try {
          this.renderPath(canvas, pathData.d, fillPaint, strokeResult?.paint || null, CanvasKit);
        } finally {
          fillPaint?.delete();
          strokeResult?.paint.delete();
        }
      }

      for (const circleData of svgData.circles || []) {
        const opacity = circleData.opacity ?? styles.opacity ?? 1;
        const fillPaint = this.createFillPaint(circleData.fill, opacity, CanvasKit);
        const strokeResult = this.createStrokePaint(
          circleData.stroke,
          circleData.strokeWidth,
          circleData.strokeDasharray,
          circleData.strokeDashoffset,
          circleData.strokeLinecap,
          opacity,
          CanvasKit,
        );
        const path = new CanvasKit.Path();
        try {
          path.addCircle(circleData.cx, circleData.cy, circleData.r);
          if (fillPaint) {
            canvas.drawPath(path, fillPaint);
          }
          if (strokeResult?.paint) {
            canvas.drawPath(path, strokeResult.paint);
          }
        } finally {
          path.delete();
          fillPaint?.delete();
          strokeResult?.paint.delete();
        }
      }

      for (const rectData of svgData.rects || []) {
        const opacity = rectData.opacity ?? styles.opacity ?? 1;
        const fillPaint = this.createFillPaint(rectData.fill, opacity, CanvasKit);
        const strokeResult = this.createStrokePaint(
          rectData.stroke,
          rectData.strokeWidth,
          undefined,
          undefined,
          undefined,
          opacity,
          CanvasKit,
        );
        try {
          this.renderRect(
            canvas,
            rectData.x,
            rectData.y,
            rectData.width,
            rectData.height,
            rectData.rx || rectData.ry || 0,
            fillPaint,
            strokeResult?.paint || null,
            CanvasKit,
          );
        } finally {
          fillPaint?.delete();
          strokeResult?.paint.delete();
        }
      }

      for (const polygonData of svgData.polygons || []) {
        const opacity = polygonData.opacity ?? styles.opacity ?? 1;
        const fillPaint = this.createFillPaint(polygonData.fill, opacity, CanvasKit);
        const strokeResult = this.createStrokePaint(
          polygonData.stroke,
          polygonData.strokeWidth,
          undefined,
          undefined,
          undefined,
          opacity,
          CanvasKit,
        );
        try {
          this.renderPolygon(canvas, polygonData.points, fillPaint, strokeResult?.paint || null, CanvasKit);
        } finally {
          fillPaint?.delete();
          strokeResult?.paint.delete();
        }
      }
    } finally {
      canvas.restore();
    }
  }

  /**
   * 渲染 SVG 元素
   */
  private renderSVGElement(
    canvas: Canvas,
    svgData: SVGElementData,
    bounds: Bounds,
    styles: Styles,
    CanvasKit: CanvasKit,
  ): void {
    canvas.save();

    // 创建填充 Paint
    const fill = (svgData.fill || styles.fill || styles.backgroundColor || "#000000") as string;
    const fillPaint = new CanvasKit.Paint();
    fillPaint.setColor(toCanvasKitColor(fill, CanvasKit));
    fillPaint.setStyle(CanvasKit.PaintStyle.Fill);
    const alpha = svgData.opacity ?? styles.opacity ?? 1;
    const color = fillPaint.getColor();
    fillPaint.setColor([color[0], color[1], color[2], Math.max(0, Math.min(1, color[3] * alpha))]);

    // 创建描边 Paint
    let strokePaint: Paint | null = null;
    if (svgData.stroke || styles.stroke || styles.borderColor) {
      const strokeColor = (svgData.stroke || styles.stroke || styles.borderColor) as string;
      strokePaint = new CanvasKit.Paint();
      strokePaint.setColor(toCanvasKitColor(strokeColor, CanvasKit));
      strokePaint.setStyle(CanvasKit.PaintStyle.Stroke);
      const strokeWidthValue = svgData.strokeWidth || styles.strokeWidth || 1;
      const strokeWidth: number =
        typeof strokeWidthValue === "number" ? strokeWidthValue : parseFloat(String(strokeWidthValue));
      strokePaint.setStrokeWidth(strokeWidth);
      const strokeColorArr = strokePaint.getColor();
      strokePaint.setColor([
        strokeColorArr[0],
        strokeColorArr[1],
        strokeColorArr[2],
        Math.max(0, Math.min(1, strokeColorArr[3] * alpha)),
      ]);
    }

    try {
      // 根据类型渲染
      switch (svgData.type) {
        case "path":
          this.renderPath(canvas, svgData.d || "", fillPaint, strokePaint, CanvasKit);
          break;

        case "circle":
          this.renderCircle(
            canvas,
            svgData.cx || bounds.x + bounds.width / 2,
            svgData.cy || bounds.y + bounds.height / 2,
            svgData.r || Math.min(bounds.width, bounds.height) / 2,
            fillPaint,
            strokePaint,
            CanvasKit,
          );
          break;

        case "rect":
          this.renderRect(
            canvas,
            svgData.x || bounds.x,
            svgData.y || bounds.y,
            svgData.width || bounds.width,
            svgData.height || bounds.height,
            svgData.rx || svgData.ry || 0,
            fillPaint,
            strokePaint,
            CanvasKit,
          );
          break;

        case "polygon":
        case "polyline":
          this.renderPolygon(canvas, svgData.points || "", fillPaint, strokePaint, CanvasKit);
          break;

        case "line":
          this.renderLine(
            canvas,
            svgData.x1 || 0,
            svgData.y1 || 0,
            svgData.x2 || 0,
            svgData.y2 || 0,
            strokePaint,
            CanvasKit,
          );
          break;

        case "ellipse":
          this.renderEllipse(
            canvas,
            svgData.cx || bounds.x + bounds.width / 2,
            svgData.cy || bounds.y + bounds.height / 2,
            svgData.rx_ellipse || bounds.width / 2,
            svgData.ry_ellipse || bounds.height / 2,
            fillPaint,
            strokePaint,
            CanvasKit,
          );
          break;
      }
    } finally {
      fillPaint.delete();
      strokePaint?.delete();
      canvas.restore();
    }
  }

  /**
   * 渲染路径
   */
  private renderPath(
    canvas: Canvas,
    pathData: string,
    fillPaint: Paint | null,
    strokePaint: Paint | null,
    CanvasKit: CanvasKit,
  ): void {
    const path = this.parsePathData(pathData, CanvasKit);
    if (!path) {
      return;
    }

    if (fillPaint && fillPaint.getColor()[3] > 0) {
      canvas.drawPath(path, fillPaint);
    }

    if (strokePaint) {
      canvas.drawPath(path, strokePaint);
    }

    path.delete();
  }

  /**
   * 解析 SVG path 数据
   */
  private parsePathData(pathData: string, CanvasKit: CanvasKit): Path | null {
    const pathFactory = CanvasKit.Path as unknown as {
      MakeFromSVGString?: (path: string) => Path | null;
    };
    if (typeof pathFactory.MakeFromSVGString === "function") {
      const nativePath = pathFactory.MakeFromSVGString(pathData);
      if (nativePath) {
        return nativePath;
      }
    }

    const path = new CanvasKit.Path();

    // 简化版 path 解析器
    // 支持常见的命令：M, L, H, V, C, S, Q, T, A, Z
    const commands = pathData.match(/[MLHVCSQTAZ][^MLHVCSQTAZ]*/gi);
    if (!commands) {
      return null;
    }

    let currentX = 0;
    let currentY = 0;
    let startX = 0;
    let startY = 0;

    for (const cmd of commands) {
      const type = cmd[0].toUpperCase();
      const args = this.parsePathArguments(cmd.substring(1));

      switch (type) {
        case "M": // moveto
          if (cmd[0] === "m") {
            currentX += args[0];
            currentY += args[1];
          } else {
            currentX = args[0];
            currentY = args[1];
          }
          startX = currentX;
          startY = currentY;
          path.moveTo(currentX, currentY);
          break;

        case "L": // lineto
          if (cmd[0] === "l") {
            currentX += args[0];
            currentY += args[1];
          } else {
            currentX = args[0];
            currentY = args[1];
          }
          path.lineTo(currentX, currentY);
          break;

        case "H": // horizontal lineto
          if (cmd[0] === "h") {
            currentX += args[0];
          } else {
            currentX = args[0];
          }
          path.lineTo(currentX, currentY);
          break;

        case "V": // vertical lineto
          if (cmd[0] === "v") {
            currentY += args[0];
          } else {
            currentY = args[0];
          }
          path.lineTo(currentX, currentY);
          break;

        case "C": // curveto
          if (args.length < 6) {
            break;
          }
          for (let i = 0; i + 5 < args.length; i += 6) {
            let x1 = args[i];
            let y1 = args[i + 1];
            let x2 = args[i + 2];
            let y2 = args[i + 3];
            let x = args[i + 4];
            let y = args[i + 5];

            if (cmd[0] === "c") {
              x1 += currentX;
              y1 += currentY;
              x2 += currentX;
              y2 += currentY;
              x += currentX;
              y += currentY;
            }

            path.cubicTo(x1, y1, x2, y2, x, y);
            currentX = x;
            currentY = y;
          }
          break;

        case "Z": // closepath
          path.close();
          currentX = startX;
          currentY = startY;
          break;

        default:
          // 其他命令暂时简化为直线
          break;
      }
    }

    return path;
  }

  /**
   * 解析 path 命令参数
   */
  private parsePathArguments(argsStr: string): number[] {
    const args: number[] = [];
    const regex = /-?[\d.]+(?:e[+-]?\d+)?/gi;
    let match;
    while ((match = regex.exec(argsStr)) !== null) {
      args.push(parseFloat(match[0]));
    }
    return args;
  }

  /**
   * 渲染圆形
   */
  private renderCircle(
    canvas: Canvas,
    cx: number,
    cy: number,
    r: number,
    fillPaint: Paint | null,
    strokePaint: Paint | null,
    _CanvasKit: CanvasKit,
  ): void {
    if (fillPaint && fillPaint.getColor()[3] > 0) {
      canvas.drawCircle(cx, cy, r, fillPaint);
    }

    if (strokePaint) {
      canvas.drawCircle(cx, cy, r, strokePaint);
    }
  }

  /**
   * 渲染矩形
   */
  private renderRect(
    canvas: Canvas,
    x: number,
    y: number,
    width: number,
    height: number,
    rx: number,
    fillPaint: Paint | null,
    strokePaint: Paint | null,
    CanvasKit: CanvasKit,
  ): void {
    const rect = CanvasKit.LTRBRect(x, y, x + width, y + height);

    if (rx > 0) {
      // 圆角矩形
      const rrect = CanvasKit.RRectXY(rect, rx, rx);
      if (fillPaint && fillPaint.getColor()[3] > 0) {
        canvas.drawRRect(rrect, fillPaint);
      }
      if (strokePaint) {
        canvas.drawRRect(rrect, strokePaint);
      }
    } else {
      // 普通矩形
      if (fillPaint && fillPaint.getColor()[3] > 0) {
        canvas.drawRect(rect, fillPaint);
      }
      if (strokePaint) {
        canvas.drawRect(rect, strokePaint);
      }
    }
  }

  /**
   * 渲染多边形
   */
  private renderPolygon(
    canvas: Canvas,
    pointsStr: string,
    fillPaint: Paint | null,
    strokePaint: Paint | null,
    CanvasKit: CanvasKit,
  ): void {
    const points = this.parsePoints(pointsStr);
    if (points.length < 2) {
      return;
    }

    const path = new CanvasKit.Path();
    path.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      path.lineTo(points[i].x, points[i].y);
    }

    path.close();

    if (fillPaint && fillPaint.getColor()[3] > 0) {
      canvas.drawPath(path, fillPaint);
    }

    if (strokePaint) {
      canvas.drawPath(path, strokePaint);
    }

    path.delete();
  }

  /**
   * 解析点坐标
   */
  private parsePoints(pointsStr: string): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [];
    const coords = pointsStr.trim().split(/[\s,]+/);

    for (let i = 0; i < coords.length - 1; i += 2) {
      const x = parseFloat(coords[i]);
      const y = parseFloat(coords[i + 1]);
      if (!isNaN(x) && !isNaN(y)) {
        points.push({ x, y });
      }
    }

    return points;
  }

  /**
   * 渲染直线
   */
  private renderLine(
    canvas: Canvas,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    strokePaint: Paint | null,
    _CanvasKit: CanvasKit,
  ): void {
    if (!strokePaint) {
      return;
    }
    // 直接复用调用方传入的 strokePaint，避免创建额外 Paint 对象
    canvas.drawLine(x1, y1, x2, y2, strokePaint);
  }

  /**
   * 渲染椭圆
   */
  private renderEllipse(
    canvas: Canvas,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    fillPaint: Paint | null,
    strokePaint: Paint | null,
    CanvasKit: CanvasKit,
  ): void {
    const rect = CanvasKit.LTRBRect(cx - rx, cy - ry, cx + rx, cy + ry);

    if (fillPaint && fillPaint.getColor()[3] > 0) {
      canvas.drawOval(rect, fillPaint);
    }

    if (strokePaint) {
      canvas.drawOval(rect, strokePaint);
    }
  }
}

/**
 * 单例实例
 */
export const svgRenderer = new SVGRenderer();
