/**
 * CanvasKit 加载器
 *
 * 负责加载和初始化 CanvasKit WASM 模块
 */

import CanvasKitInit from 'canvaskit-wasm/full';
import type { CanvasKit } from 'canvaskit-wasm';

export interface CanvasKitLoaderOptions {
  /**
   * WASM 文件位置
   * 默认使用 CDN
   */
  locateFile?: (file: string) => string;

  /**
   * 是否使用 WebGL 后端
   * 默认 true
   */
  useWebGL?: boolean;
}

const CANVASKIT_CDN_BASE = 'https://unpkg.com/canvaskit-wasm@0.40.0/bin/full/';
const CANVASKIT_LOCAL_BASE = '/runtime-assets/canvaskit/';

/**
 * CanvasKit 加载器单例
 */
export class CanvasKitLoader {
  private static instance: CanvasKitLoader | null = null;
  private canvasKit: CanvasKit | null = null;
  private loadPromise: Promise<CanvasKit> | null = null;

  private constructor() {}

  /**
   * 检测是否为 Node.js 运行时（包含 jsdom 测试环境）
   */
  private isNodeRuntime(): boolean {
    return (
      typeof process !== 'undefined' &&
      !!process.versions &&
      !!process.versions.node
    );
  }

  /**
   * 在 Node.js 中解析 CanvasKit wasm 文件路径
   */
  private resolveNodeWasmPath(file: string): string {
    if (typeof require === 'function') {
      return require.resolve(`canvaskit-wasm/bin/full/${file}`);
    }

    const cwd = typeof process !== 'undefined' ? process.cwd() : '';
    return `${cwd}/node_modules/canvaskit-wasm/bin/full/${file}`;
  }

  private getBrowserWasmBaseCandidates(): string[] {
    const globalConfig = globalThis as typeof globalThis & {
      __VZI_CANVASKIT_BASE_URL__?: unknown;
      __VZI_RUNTIME_ASSET_BASE_URL__?: unknown;
    };

    const customCanvasKitBase =
      typeof globalConfig.__VZI_CANVASKIT_BASE_URL__ === 'string'
        ? globalConfig.__VZI_CANVASKIT_BASE_URL__.trim()
        : '';
    const runtimeBase =
      typeof globalConfig.__VZI_RUNTIME_ASSET_BASE_URL__ === 'string'
        ? globalConfig.__VZI_RUNTIME_ASSET_BASE_URL__.trim()
        : '';

    const candidates = new Set<string>();
    if (customCanvasKitBase) {
      candidates.add(customCanvasKitBase.endsWith('/') ? customCanvasKitBase : `${customCanvasKitBase}/`);
    }
    if (runtimeBase) {
      const normalized = runtimeBase.endsWith('/') ? runtimeBase.slice(0, -1) : runtimeBase;
      candidates.add(`${normalized}/canvaskit/`);
    }

    if (typeof document !== 'undefined' && typeof document.baseURI === 'string') {
      try {
        candidates.add(new URL('runtime-assets/canvaskit/', document.baseURI).toString());
      } catch {
        // ignore invalid base URI
      }
    }

    candidates.add(CANVASKIT_LOCAL_BASE);
    candidates.add(CANVASKIT_CDN_BASE);
    return [...candidates];
  }

  /**
   * 获取加载器实例
   */
  static getInstance(): CanvasKitLoader {
    if (!CanvasKitLoader.instance) {
      CanvasKitLoader.instance = new CanvasKitLoader();
    }
    return CanvasKitLoader.instance;
  }

  /**
   * 加载 CanvasKit
   */
  async load(options: CanvasKitLoaderOptions = {}): Promise<CanvasKit> {
    // 如果已经加载，直接返回
    if (this.canvasKit) {
      return this.canvasKit;
    }

    // 如果正在加载，等待加载完成
    if (this.loadPromise) {
      return this.loadPromise;
    }

    // 开始加载
    this.loadPromise = this.loadInternal(options);

    try {
      this.canvasKit = await this.loadPromise;
      return this.canvasKit;
    } catch (error) {
      this.loadPromise = null;
      throw error;
    }
  }

  /**
   * 内部加载逻辑
   */
  private async loadInternal(options: CanvasKitLoaderOptions): Promise<CanvasKit> {
    const { locateFile } = options;

    try {
      if (locateFile) {
        return await CanvasKitInit({
          locateFile: (file: string) => {
            const resolvedPath = locateFile(file);

            // Node.js 下如果 custom locateFile 返回 URL，回退到本地路径避免 ENOENT
            if (this.isNodeRuntime() && /^https?:\/\//.test(resolvedPath)) {
              return this.resolveNodeWasmPath(file);
            }

            return resolvedPath;
          },
        });
      }

      if (this.isNodeRuntime()) {
        return await CanvasKitInit({
          locateFile: (file: string) => this.resolveNodeWasmPath(file),
        });
      }

      let lastError: unknown = null;
      for (const base of this.getBrowserWasmBaseCandidates()) {
        try {
          return await CanvasKitInit({
            locateFile: (file: string) => `${base}${file}`,
          });
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError instanceof Error ? lastError : new Error('No available CanvasKit wasm source');
    } catch (error) {
      throw new Error(
        `Failed to load CanvasKit: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 获取已加载的 CanvasKit 实例
   */
  getCanvasKit(): CanvasKit | null {
    return this.canvasKit;
  }

  /**
   * 检查是否已加载
   */
  isLoaded(): boolean {
    return this.canvasKit !== null;
  }

  /**
   * 重置加载器（用于测试）
   */
  reset(): void {
    this.canvasKit = null;
    this.loadPromise = null;
  }
}

/**
 * 便捷函数：加载 CanvasKit
 */
export async function loadCanvasKit(options?: CanvasKitLoaderOptions): Promise<CanvasKit> {
  const loader = CanvasKitLoader.getInstance();
  return loader.load(options);
}

/**
 * 便捷函数：获取已加载的 CanvasKit
 */
export function getCanvasKit(): CanvasKit | null {
  const loader = CanvasKitLoader.getInstance();
  return loader.getCanvasKit();
}
