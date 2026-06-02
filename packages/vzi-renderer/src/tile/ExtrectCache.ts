import type { Rect } from './types'

/**
 * 扩展矩形缓存 (L3)
 * 缓存元素的扩展边界，避免重复计算
 */
export class ExtrectCache {
  private cache: Map<string, Rect>
  private readonly capacity: number
  private insertionOrder: string[] = []

  constructor(capacity = 1000) {
    this.capacity = capacity
    this.cache = new Map()
  }

  /**
   * 生成缓存键
   */
  getCacheKey(elementId: string): string {
    return elementId
  }

  /**
   * 计算扩展矩形
   * 扩展元素边界以包含描边、阴影等效果
   */
  calculateExtrect(bounds: Rect, strokeWidth = 0, shadowBlur = 0): Rect {
    const expansion = Math.max(strokeWidth / 2, shadowBlur)
    return {
      x: bounds.x - expansion,
      y: bounds.y - expansion,
      width: bounds.width + expansion * 2,
      height: bounds.height + expansion * 2,
    }
  }

  /**
   * 查询缓存
   */
  get(elementId: string): Rect | undefined {
    const key = this.getCacheKey(elementId)
    return this.cache.get(key)
  }

  /**
   * 设置缓存（FIFO 淘汰）
   */
  set(elementId: string, extrect: Rect): void {
    const key = this.getCacheKey(elementId)

    // 如果已存在，先删除旧的
    if (this.cache.has(key)) {
      const index = this.insertionOrder.indexOf(key)
      if (index > -1) {
        this.insertionOrder.splice(index, 1)
      }
    }

    // FIFO 淘汰
    if (this.cache.size >= this.capacity) {
      const oldestKey = this.insertionOrder.shift()
      if (oldestKey) {
        this.cache.delete(oldestKey)
      }
    }

    this.cache.set(key, extrect)
    this.insertionOrder.push(key)
  }

  /**
   * 删除元素的所有缓存
   */
  delete(elementId: string): void {
    const key = this.getCacheKey(elementId)
    this.cache.delete(key)

    const index = this.insertionOrder.indexOf(key)
    if (index > -1) {
      this.insertionOrder.splice(index, 1)
    }
  }

  /**
   * 批量失效
   */
  invalidate(elementIds: string[]): void {
    for (const id of elementIds) {
      this.delete(id)
    }
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear()
    this.insertionOrder = []
  }

  /**
   * 批量计算（优化版本）
   */
  batchCalculate(
    elements: Array<{
      id: string
      bounds: Rect
      strokeWidth?: number
      shadowBlur?: number
    }>
  ): Map<string, Rect> {
    const results = new Map<string, Rect>()

    for (const element of elements) {
      const extrect = this.calculateExtrect(
        element.bounds,
        element.strokeWidth,
        element.shadowBlur
      )
      this.set(element.id, extrect)
      results.set(element.id, extrect)
    }

    return results
  }
}
