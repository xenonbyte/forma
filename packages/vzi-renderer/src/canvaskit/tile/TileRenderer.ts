/**
 * 瓦片渲染器
 *
 * 将大型设计稿分割为多个瓦片进行渲染，提高性能
 */

import type { CanvasKit, Surface } from "canvaskit-wasm";
import type { IRElement } from "../renderers/types";

/**
 * 瓦片配置
 */
export interface TileConfig {
  /**
   * 瓦片大小
   */
  tileSize: number;

  /**
   * 瓦片间距
   */
  tileGap: number;

  /**
   * 缓存大小
   */
  cacheSize: number;
}

/**
 * 瓦片信息
 */
export interface TileInfo {
  x: number;
  y: number;
  index: string;
  surface: Surface | null;
  lastUsed: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: TileConfig = {
  tileSize: 512,
  tileGap: 0,
  cacheSize: 32,
};

/**
 * 瓦片渲染器
 */
export class TileRenderer {
  private tiles: Map<string, TileInfo> = new Map();
  private config: TileConfig;
  private canvasKit: CanvasKit | null = null;

  constructor(config: Partial<TileConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 初始化瓦片渲染器
   */
  init(canvasKit: CanvasKit): void {
    this.canvasKit = canvasKit;
  }

  /**
   * 获取指定位置的瓦片
   */
  getTile(tileX: number, tileY: number): Surface | null {
    const index = `${tileX},${tileY}`;
    const tile = this.tiles.get(index);

    if (tile) {
      tile.lastUsed = Date.now();
      return tile.surface;
    }

    return null;
  }

  /**
   * 创建瓦片
   */
  createTile(tileX: number, tileY: number): Surface | null {
    if (!this.canvasKit) {
      return null;
    }

    const index = `${tileX},${tileY}`;

    // 检查是否已存在
    const existing = this.tiles.get(index);
    if (existing) {
      return existing.surface;
    }

    // 创建新瓦片 Surface
    const surface = this.canvasKit.MakeSurface(this.config.tileSize, this.config.tileSize);

    if (!surface) {
      return null;
    }

    // 缓存瓦片
    this.evictIfNeeded();
    this.tiles.set(index, {
      x: tileX,
      y: tileY,
      index,
      surface,
      lastUsed: Date.now(),
    });

    return surface;
  }

  /**
   * 渲染瓦片
   */
  renderTile(tileX: number, tileY: number, elements: IRElement[], _bounds: { width: number; height: number }): void {
    const tile = this.getTile(tileX, tileY) || this.createTile(tileX, tileY);

    if (!tile) {
      return;
    }

    const canvas = tile.getCanvas();
    if (!canvas || !this.canvasKit) {
      return;
    }

    // 清空瓦片
    canvas.clear(this.canvasKit.Color(0, 0, 0, 0));

    // 计算偏移
    const offsetX = -tileX * this.config.tileSize;
    const offsetY = -tileY * this.config.tileSize;

    canvas.save();
    canvas.translate(offsetX, offsetY);

    // 渲染元素
    for (const element of elements) {
      // 检查元素是否在瓦片范围内
      if (this.isElementInTile(element, tileX, tileY, _bounds)) {
        // 渲染元素（这里需要调用元素渲染器）
        // renderElement(canvas, element, this.canvasKit);
      }
    }

    canvas.restore();
  }

  /**
   * 检查元素是否在瓦片范围内
   */
  private isElementInTile(
    element: IRElement,
    tileX: number,
    tileY: number,
    _bounds: { width: number; height: number },
  ): boolean {
    const tileLeft = tileX * this.config.tileSize;
    const tileTop = tileY * this.config.tileSize;
    const tileRight = tileLeft + this.config.tileSize;
    const tileBottom = tileTop + this.config.tileSize;

    const elemRight = element.bounds.x + element.bounds.width;
    const elemBottom = element.bounds.y + element.bounds.height;

    // AABB 碰撞检测
    return !(
      element.bounds.x > tileRight ||
      elemRight < tileLeft ||
      element.bounds.y > tileBottom ||
      elemBottom < tileTop
    );
  }

  /**
   * 淘汰最旧的瓦片
   */
  private evictIfNeeded(): void {
    if (this.tiles.size >= this.config.cacheSize) {
      // 找到最旧的瓦片
      let oldest: TileInfo | null = null;

      for (const [_key, tile] of this.tiles.entries()) {
        if (!oldest || tile.lastUsed < oldest.lastUsed) {
          oldest = tile;
        }
      }

      if (oldest) {
        if (oldest.surface) {
          oldest.surface.delete();
        }
        this.tiles.delete(oldest.index);
      }
    }
  }

  /**
   * 清空所有瓦片
   */
  clear(): void {
    for (const [_key, tile] of this.tiles.entries()) {
      if (tile.surface) {
        tile.surface.delete();
      }
    }
    this.tiles.clear();
  }

  /**
   * 获取瓦片数量
   */
  get tileCount(): number {
    return this.tiles.size;
  }

  /**
   * 销毁瓦片渲染器
   */
  dispose(): void {
    this.clear();
    this.canvasKit = null;
  }
}

/**
 * 创建瓦片渲染器
 */
export function createTileRenderer(config?: Partial<TileConfig>): TileRenderer {
  return new TileRenderer(config);
}
