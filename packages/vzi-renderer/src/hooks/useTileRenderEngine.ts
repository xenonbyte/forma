/**
 * 瓦片渲染引擎 Hook
 * 管理瓦片渲染引擎的生命周期
 */

import { useEffect, useMemo, useRef, useCallback, useState } from 'react'
import type { IRElement } from '@vzi-core/types'
import { TileRenderEngine } from '../tile/TileRenderEngine'
import type { Viewbox } from '../tile/types'

export interface UseTileRenderEngineOptions {
  /** 是否启用瓦片渲染 */
  enabled: boolean
  /** 元素数据 */
  elements: Record<string, IRElement>
  /** 视口状态 */
  viewbox: Viewbox
  /** 视口变化回调 */
  onViewportChange?: (viewbox: Viewbox) => void
}

interface TileRenderEngineResult {
  engine: TileRenderEngine | null
  renderRevision: number
  getProgress: () => { rendered: number; total: number; percentage: number }
  getCacheStats: () => ReturnType<TileRenderEngine['getCacheStats']> | null
}

export function useTileRenderEngine(
  options: UseTileRenderEngineOptions
): TileRenderEngineResult {
  const { enabled, elements, viewbox, onViewportChange } = options
  const engineRef = useRef<TileRenderEngine | null>(null)
  const prevViewboxRef = useRef<Viewbox | null>(null)
  const [renderRevision, setRenderRevision] = useState(0)

  // 创建引擎实例
  const engine = useMemo(() => {
    if (!enabled) return null

    const instance = new TileRenderEngine({
      tileSize: 512,
      interestMargin: 1,
      tileCacheCapacity: 100,
      extrectCacheCapacity: 1000,
      maxBatchSize: 10,
      maxFrameTime: 32,
    })

    engineRef.current = instance
    return instance
  }, [enabled])

  // 更新元素数据
  useEffect(() => {
    if (engine && elements) {
      engine.setElements(elements)
    }
  }, [engine, elements])

  // 处理视口变化
  useEffect(() => {
    if (!engine || !viewbox) return

    let isCancelled = false
    const prev = prevViewboxRef.current

    // 检查视口是否真的变化了
    if (prev &&
        prev.x === viewbox.x &&
        prev.y === viewbox.y &&
        prev.width === viewbox.width &&
        prev.height === viewbox.height &&
        prev.scale === viewbox.scale) {
      return
    }

    prevViewboxRef.current = viewbox

    // 渲染新视口
    engine
      .renderViewport(viewbox)
      .then(() => {
        if (!isCancelled) {
          setRenderRevision((value) => value + 1)
        }
      })
      .catch((error) => {
        console.error('Failed to render viewport:', error)
      })

    // 通知外部
    onViewportChange?.(viewbox)

    return () => {
      isCancelled = true
    }
  }, [engine, viewbox, onViewportChange])

  // 获取进度
  const getProgress = useCallback(() => {
    return engine?.getProgress() || { rendered: 0, total: 0, percentage: 0 }
  }, [engine])

  // 获取缓存统计
  const getCacheStats = useCallback(() => {
    return engine?.getCacheStats() || null
  }, [engine])

  // 清理资源
  useEffect(() => {
    return () => {
      if (engineRef.current) {
        engineRef.current.dispose()
        engineRef.current = null
      }
    }
  }, [])

  return {
    engine,
    renderRevision,
    getProgress,
    getCacheStats,
  }
}
