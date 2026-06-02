import { LRUCache } from 'lru-cache'
import type { Tile } from './types'

/**
 * 缓存统计信息
 */
export interface CacheStats {
  size: number
  capacity: number
  maxSize: number
  hits: number
  misses: number
  hitRate: number
  memoryUsageMB: number
}

/**
 * 瓦片缓存 (L1)
 * 使用 LRU 策略缓存已渲染的瓦片纹理
 */
export class TileCache {
  private cache: LRUCache<string, ImageBitmap>
  private readonly capacity: number
  private readonly maxMemoryMB: number
  private hits = 0
  private misses = 0

  constructor(capacity = 100, maxMemoryMB = 50) {
    this.capacity = capacity
    this.maxMemoryMB = maxMemoryMB
    this.cache = new LRUCache({
      max: capacity,
      dispose: (value: ImageBitmap) => {
        value.close()
      },
    })
  }

  /**
   * 生成瓦片键
   */
  private getTileKey(tile: Tile): string {
    return `${tile.x},${tile.y}`
  }

  /**
   * 获取缓存的瓦片
   */
  get(tile: Tile): ImageBitmap | undefined {
    const key = this.getTileKey(tile)
    const value = this.cache.get(key)

    if (value) {
      this.hits++
    } else {
      this.misses++
    }

    return value
  }

  /**
   * 读取缓存但不更新命中统计
   */
  peek(tile: Tile): ImageBitmap | undefined {
    const key = this.getTileKey(tile)
    return this.cache.peek(key)
  }

  /**
   * 缓存瓦片
   */
  set(tile: Tile, image: ImageBitmap): void {
    const key = this.getTileKey(tile)
    this.cache.set(key, image)
  }

  /**
   * 检查瓦片是否存在
   */
  has(tile: Tile): boolean {
    const key = this.getTileKey(tile)
    return this.cache.has(key)
  }

  /**
   * 删除瓦片缓存
   * 注意：不在此处手动 close()，由 LRUCache 的 dispose 回调统一清理，防止双重 close
   */
  delete(tile: Tile): void {
    const key = this.getTileKey(tile)
    this.cache.delete(key)
  }

  /**
   * 批量失效
   */
  invalidate(tiles: Tile[]): void {
    for (const tile of tiles) {
      this.delete(tile)
    }
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear()
    this.hits = 0
    this.misses = 0
  }

  /**
   * 获取统计信息
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses
    return {
      size: this.cache.size,
      capacity: this.capacity,
      maxSize: this.capacity,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      memoryUsageMB: this.getMemoryUsage(),
    }
  }

  /**
   * 获取内存占用（MB）
   */
  getMemoryUsage(): number {
    // 估算：每个瓦片 512x512 RGBA = 1MB
    return this.cache.size * 1
  }
}
