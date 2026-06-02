/**
 * 瓦片渲染系统类型定义
 */

/**
 * 瓦片坐标
 */
export interface Tile {
  x: number // 瓦片 X 坐标（整数）
  y: number // 瓦片 Y 坐标（整数）
}

/**
 * 瓦片矩形区域
 */
export interface TileRect {
  startX: number // 起始 X 坐标
  startY: number // 起始 Y 坐标
  endX: number // 结束 X 坐标
  endY: number // 结束 Y 坐标
}

/**
 * 瓦片视口
 */
export interface TileViewbox {
  visible: TileRect // 可见瓦片区域
  interest: TileRect // 预加载区域（可见区域外 1-2 个瓦片）
  center: Tile // 视口中心瓦片
}

/**
 * 视口定义
 */
export interface Viewport {
  x: number // 视口 X 坐标
  y: number // 视口 Y 坐标
  width: number // 视口宽度
  height: number // 视口高度
  scale: number // 缩放比例
}

/**
 * 矩形区域
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  hits: number // 缓存命中次数
  misses: number // 缓存未命中次数
  size: number // 当前缓存大小
  maxSize: number // 最大缓存大小
}

/**
 * 视口盒子
 */
export interface Viewbox {
  x: number
  y: number
  width: number
  height: number
  scale: number
}
