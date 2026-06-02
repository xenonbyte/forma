import type { Viewbox } from './types'

/**
 * 视口缓存 (L2)
 * 缓存整个视口快照，优化平移场景
 */
export class ViewportCache {
  private cache: Map<string, ImageBitmap> = new Map()
  private viewboxes: Map<string, Viewbox> = new Map()
  private scheduledCaching: number | null = null
  private scheduledTimeout: ReturnType<typeof setTimeout> | null = null

  /**
   * 生成视口键
   */
  private getViewboxKey(viewbox: Viewbox): string {
    return `${Math.round(viewbox.x)},${Math.round(viewbox.y)},${Math.round(viewbox.width)},${Math.round(viewbox.height)},${viewbox.scale.toFixed(2)}`
  }

  /**
   * 设置缓存
   */
  set(viewbox: Viewbox, snapshot: ImageBitmap): void {
    const key = this.getViewboxKey(viewbox)
    const existing = this.cache.get(key)
    if (existing && existing !== snapshot) {
      existing.close()
    }
    this.cache.set(key, snapshot)
    this.viewboxes.set(key, viewbox)
  }

  /**
   * 查询缓存
   */
  get(viewbox: Viewbox): ImageBitmap | undefined {
    const key = this.getViewboxKey(viewbox)
    return this.cache.get(key)
  }

  /**
   * 通过缓存键获取快照
   */
  getByKey(key: string): ImageBitmap | undefined {
    return this.cache.get(key)
  }

  /**
   * 检查是否存在
   */
  has(viewbox: Viewbox): boolean {
    const key = this.getViewboxKey(viewbox)
    return this.cache.has(key)
  }

  /**
   * 判断是否可复用缓存
   * 当新视口与缓存视口重叠度高时可复用
   */
  canReuse(currentViewbox: Viewbox, threshold = 0.7): { key: string; viewbox: Viewbox } | null {
    const currentArea = currentViewbox.width * currentViewbox.height
    if (currentArea <= 0) {
      return null
    }

    for (const [key, cachedViewbox] of this.viewboxes.entries()) {
      // 缩放必须相同
      if (Math.abs(cachedViewbox.scale - currentViewbox.scale) > 0.01) {
        continue
      }

      // 计算重叠面积
      const overlapX = Math.max(
        0,
        Math.min(cachedViewbox.x + cachedViewbox.width, currentViewbox.x + currentViewbox.width) -
          Math.max(cachedViewbox.x, currentViewbox.x)
      )
      const overlapY = Math.max(
        0,
        Math.min(cachedViewbox.y + cachedViewbox.height, currentViewbox.y + currentViewbox.height) -
          Math.max(cachedViewbox.y, currentViewbox.y)
      )
      const overlapArea = overlapX * overlapY

      if (overlapArea / currentArea >= threshold) {
        return { key, viewbox: cachedViewbox }
      }
    }

    return null
  }

  /**
   * 计算绘制偏移
   */
  calculateOffset(
    cachedViewbox: Viewbox,
    currentViewbox: Viewbox
  ): { offsetX: number; offsetY: number } {
    return {
      offsetX: (cachedViewbox.x - currentViewbox.x) * currentViewbox.scale,
      offsetY: (cachedViewbox.y - currentViewbox.y) * currentViewbox.scale,
    }
  }

  /**
   * 清空缓存
   */
  clear(): void {
    // 释放所有 ImageBitmap 资源
    for (const bitmap of this.cache.values()) {
      bitmap.close()
    }
    this.cache.clear()
    this.viewboxes.clear()

    if (this.scheduledCaching !== null) {
      cancelAnimationFrame(this.scheduledCaching)
      this.scheduledCaching = null
    }

    if (this.scheduledTimeout !== null) {
      clearTimeout(this.scheduledTimeout)
      this.scheduledTimeout = null
    }
  }

  /**
   * 缓存当前视口（异步）
   */
  async cacheCurrentViewport(
    viewbox: Viewbox,
    canvas: HTMLCanvasElement
  ): Promise<void> {
    try {
      const snapshot = await createImageBitmap(canvas)
      this.set(viewbox, snapshot)
    } catch (error) {
      console.error('Failed to cache viewport:', error)
    }
  }

  /**
   * 延迟缓存（在用户停止交互后）
   */
  scheduleCaching(
    viewbox: Viewbox,
    canvas: HTMLCanvasElement,
    delay = 100
  ): void {
    if (this.scheduledCaching !== null) {
      cancelAnimationFrame(this.scheduledCaching)
      this.scheduledCaching = null
    }

    if (this.scheduledTimeout !== null) {
      clearTimeout(this.scheduledTimeout)
      this.scheduledTimeout = null
    }

    this.scheduledCaching = requestAnimationFrame(() => {
      this.scheduledTimeout = setTimeout(() => {
        void this.cacheCurrentViewport(viewbox, canvas)
        this.scheduledCaching = null
        this.scheduledTimeout = null
      }, delay)
    })
  }
}
