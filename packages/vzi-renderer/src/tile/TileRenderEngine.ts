import type { IRElement } from '@vzi-core/types'
import { TileManager } from './TileManager'
import { TileHashMap } from './TileHashMap'
import { TileCache } from './TileCache'
import { ExtrectCache } from './ExtrectCache'
import { ViewportCache } from './ViewportCache'
import { RenderScheduler, type TileRenderer } from './RenderScheduler'
import type { Tile, Viewbox } from './types'

/**
 * 瓦片渲染引擎配置
 */
export interface TileRenderEngineConfig {
  /** 瓦片大小（像素） */
  tileSize?: number
  /** 预加载边距（瓦片数量） */
  interestMargin?: number
  /** 瓦片缓存容量 */
  tileCacheCapacity?: number
  /** 扩展矩形缓存容量 */
  extrectCacheCapacity?: number
  /** 最大批次大小 */
  maxBatchSize?: number
  /** 最大帧时间（毫秒） */
  maxFrameTime?: number
}

/**
 * 瓦片渲染引擎
 * 整合所有瓦片渲染组件，提供统一的渲染接口
 */
export class TileRenderEngine implements TileRenderer {
  private tileManager: TileManager
  private tileHashMap: TileHashMap
  private tileCache: TileCache
  private extrectCache: ExtrectCache
  private viewportCache: ViewportCache
  private scheduler: RenderScheduler
  private elements: Record<string, IRElement> = {}
  private currentViewbox: Viewbox | null = null
  private tileSize: number

  constructor(config: TileRenderEngineConfig = {}) {
    const {
      tileSize = 512,
      interestMargin = 1,
      tileCacheCapacity = 100,
      extrectCacheCapacity = 1000,
      maxBatchSize = 10,
      maxFrameTime = 32,
    } = config

    this.tileSize = tileSize
    this.tileManager = new TileManager(tileSize, interestMargin)
    this.tileHashMap = new TileHashMap()
    this.tileCache = new TileCache(tileCacheCapacity)
    this.extrectCache = new ExtrectCache(extrectCacheCapacity)
    this.viewportCache = new ViewportCache()
    this.scheduler = new RenderScheduler(this, maxBatchSize, maxFrameTime)
  }

  /**
   * 初始化元素数据
   */
  setElements(elements: Record<string, IRElement>): void {
    this.scheduler.cancel()
    this.elements = elements
    this.currentViewbox = null
    this.tileCache.clear()
    this.viewportCache.clear()
    this.extrectCache.clear()

    // 构建瓦片索引
    const elementTiles = Object.entries(elements).map(([id, element]) => {
      const bounds = element.bounds
      const tiles = this.tileManager.getTilesForRect(bounds)
      return { id, tiles }
    })

    this.tileHashMap.buildFromElements(elementTiles)
  }

  /**
   * 渲染视口
   */
  async renderViewport(viewbox: Viewbox): Promise<void> {
    this.currentViewbox = viewbox

    // 计算瓦片视图
    const tileViewbox = this.tileManager.calculateTileViewbox(viewbox)

    // 获取可见瓦片
    const visibleTiles = this.tileManager.getTilesForRect({
      x: tileViewbox.visible.startX * this.tileSize,
      y: tileViewbox.visible.startY * this.tileSize,
      width: (tileViewbox.visible.endX - tileViewbox.visible.startX + 1) * this.tileSize,
      height: (tileViewbox.visible.endY - tileViewbox.visible.startY + 1) * this.tileSize,
    })

    // 按优先级排序
    const sortedTiles = this.tileManager.sortTilesByPriority(
      visibleTiles,
      tileViewbox.center
    )

    const missingTiles = sortedTiles.filter((tile) => !this.tileCache.has(tile))
    if (missingTiles.length > 0) {
      await this.scheduler.scheduleTiles(missingTiles)
    }

    // 生成视口快照缓存，用于后续平移复用
    await this.cacheViewportSnapshot(viewbox, visibleTiles)
  }

  /**
   * 渲染单个瓦片（TileRenderer 接口实现）
   */
  async renderTile(tile: Tile): Promise<ImageBitmap> {
    // 检查缓存
    const cached = this.tileCache.get(tile)
    if (cached) {
      return cached
    }

    // 获取瓦片内的元素
    const elementIds = this.tileHashMap.getElementsAt(tile.x, tile.y)

    // 渲染瓦片
    const bitmap = await this.renderTileContent(tile, elementIds)

    // 缓存结果
    this.tileCache.set(tile, bitmap)

    return bitmap
  }

  /**
   * 渲染瓦片内容
   */
  private async renderTileContent(
    tile: Tile,
    elementIds: string[]
  ): Promise<ImageBitmap> {
    const canvas = document.createElement('canvas')
    canvas.width = this.tileSize
    canvas.height = this.tileSize

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get 2D context')
    }

    // 计算瓦片世界坐标
    const tileWorld = this.tileManager.tileToWorld(tile)

    // 渲染元素
    for (const elementId of elementIds) {
      const element = this.elements[elementId]
      if (!element) continue

      // 计算元素在瓦片中的相对位置
      const relativeX = element.bounds.x - tileWorld.x
      const relativeY = element.bounds.y - tileWorld.y

      // 简单渲染
      const bgColor = element.styles?.backgroundColor
      ctx.fillStyle = typeof bgColor === 'string' ? bgColor : '#ffffff'
      ctx.fillRect(
        relativeX,
        relativeY,
        element.bounds.width,
        element.bounds.height
      )
    }

    // 创建 ImageBitmap
    return createImageBitmap(canvas)
  }

  /**
   * 将当前视口绘制到目标 Canvas
   */
  drawToCanvas(canvas: HTMLCanvasElement, viewbox: Viewbox): boolean {
    if (viewbox.width <= 0 || viewbox.height <= 0) {
      return false
    }

    const targetWidth = Math.ceil(viewbox.width)
    const targetHeight = Math.ceil(viewbox.height)

    if (canvas.width !== targetWidth) {
      canvas.width = targetWidth
    }
    if (canvas.height !== targetHeight) {
      canvas.height = targetHeight
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return false
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const reusableViewport = this.viewportCache.canReuse(viewbox)
    if (reusableViewport) {
      const snapshot = this.viewportCache.getByKey(reusableViewport.key)
      if (snapshot) {
        const { offsetX, offsetY } = this.viewportCache.calculateOffset(
          reusableViewport.viewbox,
          viewbox
        )
        ctx.drawImage(snapshot, offsetX, offsetY)
      }
    }

    const tileViewbox = this.tileManager.calculateTileViewbox(viewbox)
    const visibleTiles = this.tileManager.getTilesForRect({
      x: tileViewbox.visible.startX * this.tileSize,
      y: tileViewbox.visible.startY * this.tileSize,
      width: (tileViewbox.visible.endX - tileViewbox.visible.startX + 1) * this.tileSize,
      height: (tileViewbox.visible.endY - tileViewbox.visible.startY + 1) * this.tileSize,
    })

    this.drawTilesToContext(ctx, viewbox, visibleTiles)
    return true
  }

  /**
   * 将指定瓦片绘制到 Canvas 上下文
   */
  private drawTilesToContext(
    ctx: CanvasRenderingContext2D,
    viewbox: Viewbox,
    tiles: Tile[]
  ): void {
    for (const tile of tiles) {
      const bitmap = this.tileCache.peek(tile)
      if (!bitmap) {
        continue
      }

      const tileWorld = this.tileManager.tileToWorld(tile)
      const screenX = (tileWorld.x - viewbox.x) * viewbox.scale
      const screenY = (tileWorld.y - viewbox.y) * viewbox.scale
      const size = this.tileSize * viewbox.scale

      ctx.drawImage(bitmap, screenX, screenY, size, size)
    }
  }

  /**
   * 缓存当前视口快照
   */
  private async cacheViewportSnapshot(viewbox: Viewbox, tiles: Tile[]): Promise<void> {
    if (typeof document === 'undefined') {
      return
    }

    if (viewbox.width <= 0 || viewbox.height <= 0) {
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewbox.width)
    canvas.height = Math.ceil(viewbox.height)

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    this.drawTilesToContext(ctx, viewbox, tiles)
    await this.viewportCache.cacheCurrentViewport(viewbox, canvas)
  }

  /**
   * 处理视口变化
   */
  onViewportChange(viewbox: Viewbox): void {
    this.scheduler.onViewportChange(
      this.tileManager.getTilesForRect({
        x: viewbox.x,
        y: viewbox.y,
        width: viewbox.width,
        height: viewbox.height,
      })
    )
  }

  /**
   * 更新元素
   */
  updateElement(elementId: string, element: IRElement): void {
    // 获取旧瓦片
    const oldTiles = this.tileHashMap.getTilesOf(elementId)

    // 计算新瓦片
    const newTiles = this.tileManager.getTilesForRect(element.bounds)

    // 更新索引
    this.tileHashMap.updateElement(elementId, oldTiles, newTiles)

    // 使缓存失效
    this.tileCache.invalidate(oldTiles)
    this.tileCache.invalidate(newTiles)
    this.viewportCache.clear()
    this.extrectCache.invalidate([elementId])

    // 更新元素数据
    this.elements[elementId] = element

    // 通知调度器
    this.scheduler.updateElement(elementId, newTiles)
  }

  /**
   * 获取渲染进度
   */
  getProgress(): { rendered: number; total: number; percentage: number } {
    return this.scheduler.getProgress()
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): {
    tileCache: ReturnType<TileCache['getStats']>
    tileCacheMemory: number
  } {
    return {
      tileCache: this.tileCache.getStats(),
      tileCacheMemory: this.tileCache.getMemoryUsage(),
    }
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.tileCache.clear()
    this.viewportCache.clear()
    this.extrectCache.clear()
    this.tileHashMap.clear()
  }
}
