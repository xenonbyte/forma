/**
 * 瓦片哈希映射
 * 维护瓦片与元素的双向索引
 */
export class TileHashMap {
  // 瓦片 → 元素 IDs 映射
  private tileToElements: Map<string, Set<string>>
  // 元素 ID → 瓦片集合映射
  private elementToTiles: Map<string, Set<string>>

  constructor() {
    this.tileToElements = new Map()
    this.elementToTiles = new Map()
  }

  /**
   * 生成瓦片键
   */
  getTileKey(x: number, y: number): string {
    return `${x},${y}`
  }

  /**
   * 添加元素到瓦片
   */
  addElement(elementId: string, tileX: number, tileY: number): void {
    const tileKey = this.getTileKey(tileX, tileY)

    // 更新瓦片 → 元素映射
    if (!this.tileToElements.has(tileKey)) {
      this.tileToElements.set(tileKey, new Set())
    }
    this.tileToElements.get(tileKey)!.add(elementId)

    // 更新元素 → 瓦片映射
    if (!this.elementToTiles.has(elementId)) {
      this.elementToTiles.set(elementId, new Set())
    }
    this.elementToTiles.get(elementId)!.add(tileKey)
  }

  /**
   * 从瓦片中移除元素
   */
  removeElement(elementId: string, tileX: number, tileY: number): void {
    const tileKey = this.getTileKey(tileX, tileY)

    // 从瓦片 → 元素映射中移除
    const elements = this.tileToElements.get(tileKey)
    if (elements) {
      elements.delete(elementId)
      if (elements.size === 0) {
        this.tileToElements.delete(tileKey)
      }
    }

    // 从元素 → 瓦片映射中移除
    const tiles = this.elementToTiles.get(elementId)
    if (tiles) {
      tiles.delete(tileKey)
      if (tiles.size === 0) {
        this.elementToTiles.delete(elementId)
      }
    }
  }

  /**
   * 更新元素位置（增量更新）
   */
  updateElement(
    elementId: string,
    oldTiles: Array<{ x: number; y: number }>,
    newTiles: Array<{ x: number; y: number }>
  ): void {
    // 找出需要移除的瓦片
    const oldTileKeys = new Set(oldTiles.map((t) => this.getTileKey(t.x, t.y)))
    const newTileKeys = new Set(newTiles.map((t) => this.getTileKey(t.x, t.y)))

    // 移除不再包含该元素的瓦片
    for (const tile of oldTiles) {
      const key = this.getTileKey(tile.x, tile.y)
      if (!newTileKeys.has(key)) {
        this.removeElement(elementId, tile.x, tile.y)
      }
    }

    // 添加新包含该元素的瓦片
    for (const tile of newTiles) {
      const key = this.getTileKey(tile.x, tile.y)
      if (!oldTileKeys.has(key)) {
        this.addElement(elementId, tile.x, tile.y)
      }
    }
  }

  /**
   * 查询瓦片内的元素
   */
  getElementsAt(tileX: number, tileY: number): string[] {
    const tileKey = this.getTileKey(tileX, tileY)
    const elements = this.tileToElements.get(tileKey)
    return elements ? Array.from(elements) : []
  }

  /**
   * 查询元素所在的瓦片
   */
  getTilesOf(elementId: string): Array<{ x: number; y: number }> {
    const tiles = this.elementToTiles.get(elementId)
    if (!tiles) return []

    return Array.from(tiles).map((key) => {
      const [x, y] = key.split(',').map(Number)
      return { x, y }
    })
  }

  /**
   * 检查元素是否存在
   */
  hasElement(elementId: string): boolean {
    return this.elementToTiles.has(elementId)
  }

  /**
   * 批量构建索引
   */
  buildFromElements(
    elements: Array<{
      id: string
      tiles: Array<{ x: number; y: number }>
    }>
  ): void {
    this.clear()
    for (const element of elements) {
      for (const tile of element.tiles) {
        this.addElement(element.id, tile.x, tile.y)
      }
    }
  }

  /**
   * 清空所有索引
   */
  clear(): void {
    this.tileToElements.clear()
    this.elementToTiles.clear()
  }

  /**
   * 使索引失效（清空）
   */
  invalidate(): void {
    this.clear()
  }
}
