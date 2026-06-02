import type { Tile, TileRect, TileViewbox, Viewport, Rect } from './types'

/**
 * 瓦片管理器
 * 负责瓦片坐标计算、TileViewbox 管理和瓦片优先级排序
 */
export class TileManager {
  private readonly TILE_SIZE: number
  private readonly INTEREST_MARGIN: number

  constructor(tileSize = 512, interestMargin = 1) {
    this.TILE_SIZE = tileSize
    this.INTEREST_MARGIN = interestMargin
  }

  /**
   * 右/下边界按半开区间 [min, max) 处理，避免恰好落在瓦片边界时多算 1 格
   */
  private worldToTileExclusiveMax(value: number): number {
    return Math.ceil(value / this.TILE_SIZE) - 1
  }

  /**
   * 世界坐标转瓦片坐标
   */
  worldToTile(x: number, y: number): Tile {
    return {
      x: Math.floor(x / this.TILE_SIZE),
      y: Math.floor(y / this.TILE_SIZE),
    }
  }

  /**
   * 瓦片坐标转世界坐标
   */
  tileToWorld(tile: Tile): { x: number; y: number } {
    return {
      x: tile.x * this.TILE_SIZE,
      y: tile.y * this.TILE_SIZE,
    }
  }

  /**
   * 计算瓦片视图
   */
  calculateTileViewbox(viewport: Viewport): TileViewbox {
    // 计算世界坐标范围
    const worldMinX = viewport.x
    const worldMinY = viewport.y
    const worldMaxX = viewport.x + viewport.width / viewport.scale
    const worldMaxY = viewport.y + viewport.height / viewport.scale

    // 转换为瓦片坐标
    const minTile = this.worldToTile(worldMinX, worldMinY)
    const maxTile = {
      x: Math.max(minTile.x, this.worldToTileExclusiveMax(worldMaxX)),
      y: Math.max(minTile.y, this.worldToTileExclusiveMax(worldMaxY)),
    }

    // 可见区域
    const visible: TileRect = {
      startX: minTile.x,
      startY: minTile.y,
      endX: maxTile.x,
      endY: maxTile.y,
    }

    // 预加载区域（扩展 INTEREST_MARGIN 个瓦片）
    const interest: TileRect = {
      startX: visible.startX - this.INTEREST_MARGIN,
      startY: visible.startY - this.INTEREST_MARGIN,
      endX: visible.endX + this.INTEREST_MARGIN,
      endY: visible.endY + this.INTEREST_MARGIN,
    }

    // 中心瓦片
    const centerX = Math.floor((visible.startX + visible.endX) / 2)
    const centerY = Math.floor((visible.startY + visible.endY) / 2)
    const center: Tile = { x: centerX, y: centerY }

    return { visible, interest, center }
  }

  /**
   * 获取矩形区域内的所有瓦片
   */
  getTilesForRect(rect: Rect): Tile[] {
    if (rect.width <= 0 || rect.height <= 0) {
      return []
    }

    const minTile = this.worldToTile(rect.x, rect.y)
    const maxTile = {
      x: Math.max(minTile.x, this.worldToTileExclusiveMax(rect.x + rect.width)),
      y: Math.max(minTile.y, this.worldToTileExclusiveMax(rect.y + rect.height)),
    }

    const tiles: Tile[] = []
    for (let y = minTile.y; y <= maxTile.y; y++) {
      for (let x = minTile.x; x <= maxTile.x; x++) {
        tiles.push({ x, y })
      }
    }

    return tiles
  }

  /**
   * 按优先级排序瓦片（曼哈顿距离）
   */
  sortTilesByPriority(tiles: Tile[], center: Tile): Tile[] {
    return tiles.slice().sort((a, b) => {
      const distA = this.calculateManhattanDistance(a, center)
      const distB = this.calculateManhattanDistance(b, center)
      return distA - distB
    })
  }

  /**
   * 计算曼哈顿距离
   */
  calculateManhattanDistance(tile: Tile, center: Tile): number {
    return Math.abs(tile.x - center.x) + Math.abs(tile.y - center.y)
  }
}
