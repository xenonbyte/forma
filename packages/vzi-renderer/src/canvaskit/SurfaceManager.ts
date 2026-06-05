/**
 * Surface 管理器
 *
 * 负责创建、管理和销毁 CanvasKit Surface
 */

import type { CanvasKit, Surface } from "canvaskit-wasm";
import { getCanvasKit } from "./CanvasKitLoader";

export interface SurfaceOptions {
  /**
   * 画布宽度
   */
  width: number;

  /**
   * 画布高度
   */
  height: number;

  /**
   * 是否使用 WebGL 后端
   * 默认 true，如果失败会自动降级到 CPU
   */
  useWebGL?: boolean;

  /**
   * 设备像素比
   * 默认 window.devicePixelRatio
   */
  devicePixelRatio?: number;
}

export interface SurfaceInfo {
  surface: Surface;
  backend: "WebGL" | "CPU";
  width: number;
  height: number;
  devicePixelRatio: number;
}

/**
 * Surface 管理器
 */
export class SurfaceManager {
  private surfaces: Map<string, SurfaceInfo> = new Map();
  private canvasKit: CanvasKit | null = null;

  private safeDeleteSurface(surface: Surface): void {
    try {
      surface.delete();
    } catch (error) {
      // React StrictMode 或异步初始化竞态下，Surface 可能已被释放；幂等处理即可
      // eslint-disable-next-line no-console
      console.warn("[VZI][SurfaceManager] surface already deleted, skip", error);
    }
  }

  constructor(canvasKit?: CanvasKit) {
    this.canvasKit = canvasKit || getCanvasKit();
  }

  /**
   * 创建 Surface
   */
  createSurface(canvas: HTMLCanvasElement, options: SurfaceOptions): SurfaceInfo {
    if (!this.canvasKit) {
      throw new Error("CanvasKit not loaded. Call loadCanvasKit() first.");
    }

    const id = this.generateSurfaceId(canvas);
    const existingInfo = this.surfaces.get(id);
    if (existingInfo) {
      this.safeDeleteSurface(existingInfo.surface);
      this.surfaces.delete(id);
    }

    const { width, height, useWebGL = true, devicePixelRatio = window.devicePixelRatio || 1 } = options;

    // 设置 canvas 尺寸
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    let surface: Surface | null = null;
    let backend: "WebGL" | "CPU" = "CPU";

    // 尝试创建 WebGL Surface
    if (useWebGL) {
      try {
        surface = this.canvasKit.MakeWebGLCanvasSurface(canvas);
        if (surface) {
          backend = "WebGL";
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[VZI][SurfaceManager] WebGL surface creation failed, fallback to CPU", error);
        surface = null;
      }
    }

    // 降级到 CPU 渲染
    if (!surface) {
      try {
        surface = this.canvasKit.MakeCanvasSurface(canvas);
      } catch (error) {
        throw new Error(`Failed to create CPU Surface: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!surface) {
        throw new Error("Failed to create Surface (both WebGL and CPU failed)");
      }
      backend = "CPU";
    }

    const surfaceInfo: SurfaceInfo = {
      surface,
      backend,
      width,
      height,
      devicePixelRatio,
    };

    // 存储 Surface 信息
    this.surfaces.set(id, surfaceInfo);

    return surfaceInfo;
  }

  /**
   * 调整 Surface 大小
   */
  resizeSurface(canvas: HTMLCanvasElement, width: number, height: number, devicePixelRatio?: number): SurfaceInfo {
    const id = this.generateSurfaceId(canvas);
    const existingInfo = this.surfaces.get(id);

    // 删除旧的 Surface
    if (existingInfo) {
      this.safeDeleteSurface(existingInfo.surface);
      this.surfaces.delete(id);
    }

    // 创建新的 Surface
    return this.createSurface(canvas, {
      width,
      height,
      useWebGL: existingInfo?.backend === "WebGL",
      devicePixelRatio: devicePixelRatio || existingInfo?.devicePixelRatio,
    });
  }

  /**
   * 获取 Surface 信息
   */
  getSurfaceInfo(canvas: HTMLCanvasElement): SurfaceInfo | undefined {
    const id = this.generateSurfaceId(canvas);
    return this.surfaces.get(id);
  }

  /**
   * 销毁 Surface
   */
  disposeSurface(canvas: HTMLCanvasElement): void {
    const id = this.generateSurfaceId(canvas);
    const surfaceInfo = this.surfaces.get(id);

    if (surfaceInfo) {
      this.safeDeleteSurface(surfaceInfo.surface);
      this.surfaces.delete(id);
    }
  }

  /**
   * 销毁所有 Surface
   */
  disposeAll(): void {
    this.surfaces.forEach((surfaceInfo) => {
      this.safeDeleteSurface(surfaceInfo.surface);
    });
    this.surfaces.clear();
  }

  /**
   * 生成 Surface ID
   */
  private generateSurfaceId(canvas: HTMLCanvasElement): string {
    // 使用 canvas 元素的唯一标识
    if (!canvas.dataset.surfaceId) {
      canvas.dataset.surfaceId = `surface-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    return canvas.dataset.surfaceId;
  }

  /**
   * 获取管理的 Surface 数量
   */
  getSurfaceCount(): number {
    return this.surfaces.size;
  }
}

/**
 * 全局 Surface 管理器实例
 */
let globalSurfaceManager: SurfaceManager | null = null;

/**
 * 获取全局 Surface 管理器
 */
export function getSurfaceManager(): SurfaceManager {
  if (!globalSurfaceManager) {
    globalSurfaceManager = new SurfaceManager();
  }
  return globalSurfaceManager;
}

/**
 * 重置全局 Surface 管理器（用于测试）
 */
export function resetSurfaceManager(): void {
  if (globalSurfaceManager) {
    globalSurfaceManager.disposeAll();
    globalSurfaceManager = null;
  }
}
