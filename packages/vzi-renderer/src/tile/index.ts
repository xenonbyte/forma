/**
 * 瓦片渲染系统
 * 导出所有瓦片渲染相关的类型和组件
 */

/**
 * Legacy browser tile engine.
 *
 * Snapshot-first migration 后，该路径仅保留给 debug / stress / focused preview 场景，
 * 生产级 annotation snapshot tile 输出改走 `renderDesignSnapshotNode(...)`。
 */
export { TileManager } from './TileManager'
export { TileHashMap } from './TileHashMap'
export { TileCache } from './TileCache'
export { ExtrectCache } from './ExtrectCache'
export { ViewportCache } from './ViewportCache'
export { RenderScheduler } from './RenderScheduler'
export { TileRenderEngine } from './TileRenderEngine'
export { BinaryElementData, ElementType, ElementFlags } from './BinaryElementData'

export type {
  Tile,
  TileRect,
  TileViewbox,
  Rect,
  Viewbox,
  Viewport,
} from './types'

export type { TileRenderer } from './RenderScheduler'
export type { TileRenderEngineConfig } from './TileRenderEngine'
