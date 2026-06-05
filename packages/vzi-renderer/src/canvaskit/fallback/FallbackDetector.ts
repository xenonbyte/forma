/**
 * 降级方案检测器
 *
 * 检测浏览器能力并决定是否降级
 */

import { detectWebGLSupport, detectWebAssemblySupport } from "../utils";

/**
 * 能力检测结果
 */
export interface CapabilityResult {
  /**
   * 是否支持 WebAssembly
   */
  wasmSupported: boolean;

  /**
   * 是否支持 WebGL
   */
  webglSupported: boolean;

  /**
   * 推荐使用的渲染器
   */
  recommendedRenderer: "canvaskit" | "cpu" | "fallback";

  /**
   * 降级原因
   */
  reason?: string;
}

/**
 * 降级检测器
 */
export class FallbackDetector {
  private cachedResult: CapabilityResult | null = null;

  /**
   * 检测能力
   */
  detect(): CapabilityResult {
    // 使用缓存
    if (this.cachedResult) {
      return this.cachedResult;
    }

    const wasmSupported = detectWebAssemblySupport();
    const webglResult = detectWebGLSupport();
    const webglSupported = webglResult.supported;

    // 决定推荐渲染器
    let recommendedRenderer: "canvaskit" | "cpu" | "fallback" = "fallback";
    let reason: string | undefined;

    if (!wasmSupported) {
      recommendedRenderer = "fallback";
      reason = "WebAssembly 不支持";
    } else if (!webglSupported) {
      recommendedRenderer = "cpu";
      reason = "WebGL 不支持，将使用 CPU 渲染";
    } else {
      recommendedRenderer = "canvaskit";
    }

    this.cachedResult = {
      wasmSupported,
      webglSupported,
      recommendedRenderer,
      reason,
    };

    return this.cachedResult;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedResult = null;
  }

  /**
   * 是否应该使用 CanvasKit
   */
  shouldUseCanvasKit(): boolean {
    const result = this.detect();
    return result.recommendedRenderer === "canvaskit" || result.recommendedRenderer === "cpu";
  }

  /**
   * 是否应该降级到 fallback
   */
  shouldFallback(): boolean {
    const result = this.detect();
    return result.recommendedRenderer === "fallback";
  }

  /**
   * 获取降级原因
   */
  getFallbackReason(): string | undefined {
    const result = this.detect();
    return result.reason;
  }
}

/**
 * 单例实例
 */
export const fallbackDetector = new FallbackDetector();

/**
 * 检测并返回推荐渲染器
 */
export function detectRecommendedRenderer(): "canvaskit" | "cpu" | "fallback" {
  return fallbackDetector.detect().recommendedRenderer;
}

/**
 * 是否支持 CanvasKit
 */
export function supportsCanvasKit(): boolean {
  return fallbackDetector.shouldUseCanvasKit();
}
