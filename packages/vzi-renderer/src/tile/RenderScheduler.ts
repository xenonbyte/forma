import type { Tile } from './types'

/**
 * 瓦片渲染器接口
 */
export interface TileRenderer {
  renderTile(tile: Tile): Promise<ImageBitmap>
}

/**
 * 渲染调度器
 * 负责渐进式渲染，避免阻塞 UI
 */
export class RenderScheduler {
  private readonly renderer: TileRenderer
  private readonly maxBatchSize: number
  private readonly maxFrameTime: number
  private activeJobId = 0
  private isRendering = false
  private currentBatch: Tile[] = []
  private renderedCount = 0
  private totalCount = 0
  private cancelRequested = false
  private paused = false

  constructor(
    renderer: TileRenderer,
    maxBatchSize = 10,
    maxFrameTime = 32
  ) {
    this.renderer = renderer
    this.maxBatchSize = maxBatchSize
    this.maxFrameTime = maxFrameTime
  }

  /**
   * 调度瓦片渲染
   */
  async scheduleTiles(tiles: Tile[]): Promise<void> {
    if (this.isRendering) {
      this.cancel()
    }

    const jobId = ++this.activeJobId
    this.isRendering = true
    this.currentBatch = [...tiles]
    this.renderedCount = 0
    this.totalCount = tiles.length
    this.cancelRequested = false
    this.paused = false

    while (
      this.currentBatch.length > 0 &&
      !this.cancelRequested &&
      this.activeJobId === jobId
    ) {
      if (this.paused) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        continue
      }

      await this.renderNextBatch(jobId)
    }

    if (this.activeJobId === jobId) {
      this.isRendering = false
    }
  }

  /**
   * 渲染下一批瓦片
   */
  async renderNextBatch(jobId: number): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(async () => {
        if (this.activeJobId !== jobId) {
          resolve()
          return
        }

        const startTime = performance.now()
        let processed = 0
        while (processed < this.maxBatchSize && this.currentBatch.length > 0) {
          if (this.cancelRequested || this.paused || this.activeJobId !== jobId) {
            break
          }

          const tile = this.currentBatch.shift()
          if (!tile) {
            break
          }

          await this.renderTile(tile)
          this.renderedCount++
          processed++

          if (this.shouldYield(startTime)) {
            break
          }
        }

        resolve()
      })
    })
  }

  /**
   * 渲染单个瓦片
   */
  async renderTile(tile: Tile): Promise<void> {
    try {
      await this.renderer.renderTile(tile)
    } catch (error) {
      console.error(`Failed to render tile ${tile.x},${tile.y}:`, error)
    }
  }

  /**
   * 检查是否应该让出控制权
   */
  shouldYield(startTime: number): boolean {
    return performance.now() - startTime >= this.maxFrameTime
  }

  /**
   * 取消渲染
   */
  cancel(): void {
    this.cancelRequested = true
    this.currentBatch = []
    this.activeJobId++
    this.isRendering = false
  }

  /**
   * 暂停渲染
   */
  pause(): void {
    this.paused = true
  }

  /**
   * 恢复渲染
   */
  resume(): void {
    this.paused = false
  }

  /**
   * 是否正在渲染
   */
  isRenderingNow(): boolean {
    return this.isRendering
  }

  /**
   * 获取渲染进度
   */
  getProgress(): { rendered: number; total: number; percentage: number } {
    return {
      rendered: this.renderedCount,
      total: this.totalCount,
      percentage: this.totalCount > 0 ? this.renderedCount / this.totalCount : 0,
    }
  }

  /**
   * 更新元素（增量更新）
   */
  updateElement(elementId: string, tiles: Tile[]): void {
    // 将需要更新的瓦片添加到当前批次
    this.currentBatch.push(...tiles)
    this.totalCount += tiles.length
  }

  /**
   * 视口变化处理
   */
  onViewportChange(visibleTiles: Tile[]): void {
    // 取消当前渲染
    this.cancel()
    // 重新调度可见瓦片
    void this.scheduleTiles(visibleTiles).catch((error) => {
      console.error('Failed to schedule tiles after viewport change:', error)
    })
  }
}
