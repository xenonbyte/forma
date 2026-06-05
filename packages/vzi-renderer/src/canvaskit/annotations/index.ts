/**
 * 标注系统模块
 *
 * 提供设计稿标注功能，包括距离标注、尺寸标注、标尺线等
 *
 * @example
 * ```typescript
 * import { AnnotationRenderer, AnnotationStyles } from '@vzi-core/renderer';
 *
 * // 创建标注渲染器
 * const renderer = new AnnotationRenderer({
 *   canvasKit,
 *   canvas,
 *   styles: {
 *     distance: { strokeColor: '#1890ff' }
 *   }
 * });
 *
 * // 设置选中元素
 * renderer.setSelectedElement(element);
 *
 * // 渲染标注
 * renderer.render();
 * ```
 */

// ============================================
// 类型导出
// ============================================

export type {
  // 边界类型
  ElementBounds,
  PageRect,
  // 计算结果类型
  DistanceData,
  RulerData,
  CalculationResult,
  // 样式类型
  DistanceStyle,
  RulerStyle,
  SelectionStyle,
  HoverStyle,
  AnnotationStyleConfig,
  PartialAnnotationStyleConfig,
  AnnotationTheme,
  // 视口类型
  ViewportConfig,
  ViewportState,
  // 渲染器类型
  AnnotationElement,
  AnnotationRendererOptions,
  AnnotationRenderContext,
} from "./types";

// ============================================
// 距离计算器导出
// ============================================

export {
  calculateMarkData,
  isIntersect,
  getPosition,
  getSortedNumbers,
  getMidNumbers,
  getAverage,
} from "./DistanceCalculator";

// ============================================
// 样式系统导出
// ============================================

export {
  AnnotationStyles,
  DEFAULT_ANNOTATION_STYLES,
  buildAnnotationStylesFromTheme,
  resolveAnnotationStyleConfig,
} from "./AnnotationStyles";

// ============================================
// 视口管理导出
// ============================================

export { ViewportManager } from "./ViewportManager";

// ============================================
// 标注渲染器导出
// ============================================

export { CanvasAnnotationRenderer } from "./AnnotationRenderer";
// 兼容性别名
export { CanvasAnnotationRenderer as AnnotationRenderer } from "./AnnotationRenderer";

// ============================================
// 子渲染器导出
// ============================================

export { DistanceRenderer } from "./renderers/DistanceRenderer";
export { DimensionRenderer } from "./renderers/DimensionRenderer";
export { RulerRenderer } from "./renderers/RulerRenderer";
