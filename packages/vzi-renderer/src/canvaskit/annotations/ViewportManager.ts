/**
 * 视口管理器
 *
 * 管理可拖动的视口系统，支持坐标转换
 */

import type { ViewportConfig, ViewportState } from './types';

/**
 * 默认视口配置
 */
const DEFAULT_VIEWPORT_CONFIG: ViewportConfig = {
  viewportWidth: undefined, // 自动计算
  viewportHeight: undefined, // 自动计算
  pannable: true,
  bounds: undefined, // 无限制
};

/**
 * 视口管理器
 *
 * 负责：
 * - 视口偏移和缩放管理
 * - 屏幕坐标与设计稿坐标转换
 * - 拖动边界控制
 */
export class ViewportManager {
  private config: ViewportConfig;
  private state: ViewportState;

  // 拖动状态
  private isDragging = false;
  private lastDragPoint: { x: number; y: number } | null = null;

  constructor(config?: Partial<ViewportConfig>) {
    this.config = { ...DEFAULT_VIEWPORT_CONFIG, ...config };
    this.state = {
      offset: { x: 0, y: 0 },
      scale: 1,
    };
  }

  // ============================================
  // 配置管理
  // ============================================

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<ViewportConfig> {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ViewportConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ============================================
  // 状态管理
  // ============================================

  /**
   * 获取当前状态
   */
  getState(): ViewportState {
    return {
      offset: { ...this.state.offset },
      scale: this.state.scale,
    };
  }

  /**
   * 获取视口大小
   */
  getViewportSize(): { width: number; height: number } {
    return {
      width: this.config.viewportWidth ?? 0,
      height: this.config.viewportHeight ?? 0,
    };
  }

  // ============================================
  // 偏移管理
  // ============================================

  /**
   * 设置偏移
   */
  setOffset(x: number, y: number): void {
    if (this.config.bounds) {
      // 应用边界限制
      const { min, max } = this.config.bounds;
      if (min) {
        x = Math.max(x, min.x);
        y = Math.max(y, min.y);
      }
      if (max) {
        x = Math.min(x, max.x);
        y = Math.min(y, max.y);
      }
    }

    this.state.offset = { x, y };
  }

  /**
   * 相对移动
   */
  pan(dx: number, dy: number): void {
    if (!this.config.pannable) return;

    this.setOffset(
      this.state.offset.x + dx,
      this.state.offset.y + dy
    );
  }

  /**
   * 重置偏移
   */
  resetOffset(): void {
    this.state.offset = { x: 0, y: 0 };
  }

  // ============================================
  // 缩放管理
  // ============================================

  /**
   * 设置缩放
   */
  setScale(scale: number): void {
    // 限制缩放范围
    this.state.scale = Math.max(0.1, Math.min(scale, 10));
  }

  /**
   * 相对缩放
   */
  zoom(delta: number, centerX?: number, centerY?: number): void {
    const oldScale = this.state.scale;
    const newScale = Math.max(0.1, Math.min(oldScale * (1 + delta), 10));

    if (centerX !== undefined && centerY !== undefined) {
      // 以指定点为中心缩放
      const scaleRatio = newScale / oldScale;
      this.state.offset.x = centerX - (centerX - this.state.offset.x) * scaleRatio;
      this.state.offset.y = centerY - (centerY - this.state.offset.y) * scaleRatio;
    }

    this.state.scale = newScale;
  }

  /**
   * 重置缩放
   */
  resetZoom(): void {
    this.state.scale = 1;
  }

  /**
   * 重置所有
   */
  reset(): void {
    this.resetOffset();
    this.resetZoom();
  }

  // ============================================
  // 坐标转换
  // ============================================

  /**
   * 屏幕坐标转设计稿坐标
   *
   * @param x - 屏幕坐标 X
   * @param y - 屏幕坐标 Y
   * @returns 设计稿坐标
   */
  screenToDesign(x: number, y: number): { x: number; y: number } {
    const scale = this.state.scale;
    const offset = this.state.offset;

    return {
      x: (x - offset.x) / scale,
      y: (y - offset.y) / scale,
    };
  }

  /**
   * 设计稿坐标转屏幕坐标
   *
   * @param x - 设计稿坐标 X
   * @param y - 设计稿坐标 Y
   * @returns 屏幕坐标
   */
  designToScreen(x: number, y: number): { x: number; y: number } {
    const scale = this.state.scale;
    const offset = this.state.offset;

    return {
      x: x * scale + offset.x,
      y: y * scale + offset.y,
    };
  }

  /**
   * 转换距离（设计稿 -> 屏幕）
   */
  designToScreenDistance(distance: number): number {
    return distance * this.state.scale;
  }

  /**
   * 转换距离（屏幕 -> 设计稿）
   */
  screenToDesignDistance(distance: number): number {
    return distance / this.state.scale;
  }

  // ============================================
  // 拖动事件处理
  // ============================================

  /**
   * 开始拖动
   */
  beginDrag(screenX: number, screenY: number): void {
    if (!this.config.pannable) return;

    this.isDragging = true;
    this.lastDragPoint = { x: screenX, y: screenY };
  }

  /**
   * 拖动中
   *
   * @returns 是否有位移发生
   */
  onDrag(screenX: number, screenY: number): boolean {
    if (!this.isDragging || !this.lastDragPoint || !this.config.pannable) {
      return false;
    }

    const dx = screenX - this.lastDragPoint.x;
    const dy = screenY - this.lastDragPoint.y;

    this.pan(dx, dy);
    this.lastDragPoint = { x: screenX, y: screenY };

    return dx !== 0 || dy !== 0;
  }

  /**
   * 结束拖动
   */
  endDrag(): void {
    this.isDragging = false;
    this.lastDragPoint = null;
  }

  /**
   * 是否正在拖动
   */
  getIsDragging(): boolean {
    return this.isDragging;
  }

  // ============================================
  // 可见性检测
  // ============================================

  /**
   * 检测设计稿区域是否在视口中可见
   */
  isRectVisible(
    designX: number,
    designY: number,
    designWidth: number,
    designHeight: number
  ): boolean {
    const { offset, scale } = this.state;
    const viewportWidth = this.config.viewportWidth ?? 0;
    const viewportHeight = this.config.viewportHeight ?? 0;

    // 转换为屏幕坐标
    const screenX = designX * scale + offset.x;
    const screenY = designY * scale + offset.y;
    const screenWidth = designWidth * scale;
    const screenHeight = designHeight * scale;

    // 检测是否与视口相交
    return !(
      screenX + screenWidth < 0 ||
      screenX > viewportWidth ||
      screenY + screenHeight < 0 ||
      screenY > viewportHeight
    );
  }

  /**
   * 计算将指定设计稿区域居中显示所需的偏移
   */
  centerOn(
    designX: number,
    designY: number,
    designWidth: number,
    designHeight: number
  ): void {
    const viewportWidth = this.config.viewportWidth ?? 0;
    const viewportHeight = this.config.viewportHeight ?? 0;
    const scale = this.state.scale;

    // 计算居中偏移
    this.state.offset = {
      x: viewportWidth / 2 - (designX + designWidth / 2) * scale,
      y: viewportHeight / 2 - (designY + designHeight / 2) * scale,
    };
  }

  /**
   * 计算适应整个设计稿的缩放比例
   */
  fitToView(
    designWidth: number,
    designHeight: number,
    padding: number = 50
  ): void {
    const viewportWidth = this.config.viewportWidth ?? 0;
    const viewportHeight = this.config.viewportHeight ?? 0;

    // 计算最佳缩放比例
    const scaleX = (viewportWidth - padding * 2) / designWidth;
    const scaleY = (viewportHeight - padding * 2) / designHeight;
    const scale = Math.min(scaleX, scaleY, 1); // 不超过 100%

    this.state.scale = scale;

    // 居中
    this.centerOn(0, 0, designWidth, designHeight);
  }
}
