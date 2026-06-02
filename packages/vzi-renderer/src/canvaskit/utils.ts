/**
 * CanvasKit 工具函数
 *
 * 提供常用的 CanvasKit 操作辅助函数
 */

import type { CanvasKit, Canvas, Paint, Surface, Font } from 'canvaskit-wasm';

/**
 * 检测 WebGL 支持
 */
export function detectWebGLSupport(): {
  supported: boolean;
  version?: string;
  renderer?: string;
} {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

    if (!gl) {
      return { supported: false };
    }

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : 'Unknown';

    return {
      supported: true,
      version: gl instanceof WebGL2RenderingContext ? 'WebGL 2.0' : 'WebGL 1.0',
      renderer,
    };
  } catch (_error) {
    return { supported: false };
  }
}

/**
 * 检测 WebAssembly 支持
 */
export function detectWebAssemblySupport(): boolean {
  try {
    if (typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function') {
      const module = new WebAssembly.Module(
        Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00)
      );
      if (module instanceof WebAssembly.Module) {
        return new WebAssembly.Instance(module) instanceof WebAssembly.Instance;
      }
    }
  } catch (_error) {
    // WebAssembly not supported
  }
  return false;
}

/**
 * 清空 Canvas
 */
export function clearCanvas(canvas: Canvas, CanvasKit: CanvasKit, color?: number[]): void {
  const clearColor = color
    ? CanvasKit.Color(color[0], color[1], color[2], color[3] ?? 1.0)
    : CanvasKit.WHITE;
  canvas.clear(clearColor);
}

/**
 * 保存 Canvas 状态
 */
export function saveCanvasState(canvas: Canvas): number {
  return canvas.save();
}

/**
 * 恢复 Canvas 状态
 */
export function restoreCanvasState(canvas: Canvas, saveCount?: number): void {
  if (saveCount !== undefined) {
    canvas.restoreToCount(saveCount);
  } else {
    canvas.restore();
  }
}

/**
 * 应用变换矩阵
 */
export function applyTransform(
  canvas: Canvas,
  transform: {
    translateX?: number;
    translateY?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
  }
): void {
  const { translateX = 0, translateY = 0, scaleX = 1, scaleY = 1, rotation = 0 } = transform;

  if (translateX !== 0 || translateY !== 0) {
    canvas.translate(translateX, translateY);
  }

  if (scaleX !== 1 || scaleY !== 1) {
    canvas.scale(scaleX, scaleY);
  }

  if (rotation !== 0) {
    canvas.rotate(rotation, 0, 0);
  }
}

/**
 * 设置裁剪区域
 */
export function setClipRect(
  canvas: Canvas,
  CanvasKit: CanvasKit,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const rect = CanvasKit.LTRBRect(x, y, x + width, y + height);
  canvas.clipRect(rect, CanvasKit.ClipOp.Intersect, true);
}

/**
 * 创建 Paint 对象
 */
export function createPaint(CanvasKit: CanvasKit): Paint {
  const paint = new CanvasKit.Paint();
  paint.setAntiAlias(true);
  return paint;
}

/**
 * 导出 Surface 为 PNG
 */
export function exportSurfaceToPNG(surface: Surface, CanvasKit: CanvasKit): Uint8Array | null {
  const image = surface.makeImageSnapshot();
  if (!image) {
    return null;
  }

  const pngData = image.encodeToBytes(CanvasKit.ImageFormat.PNG, 100);
  image.delete();

  return pngData;
}

/**
 * 导出 Surface 为 JPEG
 */
export function exportSurfaceToJPEG(
  surface: Surface,
  CanvasKit: CanvasKit,
  quality: number = 90
): Uint8Array | null {
  const image = surface.makeImageSnapshot();
  if (!image) {
    return null;
  }

  const jpegData = image.encodeToBytes(CanvasKit.ImageFormat.JPEG, quality);
  image.delete();

  return jpegData;
}

/**
 * 测量文本尺寸
 */
export function measureText(
  text: string,
  font: Font,
  _CanvasKit: CanvasKit
): { width: number; height: number } {
  // 简化实现：使用字体大小估算
  const fontSize = font.getSize() || 16;
  const charWidth = fontSize * 0.6;
  return {
    width: text.length * charWidth,
    height: fontSize,
  };
}

/**
 * 性能监控辅助函数
 */
export class PerformanceMonitor {
  private marks: Map<string, number> = new Map();

  start(label: string): void {
    this.marks.set(label, performance.now());
  }

  end(label: string): number {
    const startTime = this.marks.get(label);
    if (startTime === undefined) {
      console.warn(`Performance mark "${label}" not found`);
      return 0;
    }

    const duration = performance.now() - startTime;
    this.marks.delete(label);
    return duration;
  }

  measure(label: string, fn: () => void): number {
    this.start(label);
    fn();
    return this.end(label);
  }

  async measureAsync(label: string, fn: () => Promise<void>): Promise<number> {
    this.start(label);
    await fn();
    return this.end(label);
  }
}
