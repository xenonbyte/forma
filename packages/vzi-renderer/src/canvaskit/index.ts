/**
 * CanvasKit 模块导出
 */

export { CanvasKitLoader, loadCanvasKit, getCanvasKit } from './CanvasKitLoader';
export type { CanvasKitLoaderOptions } from './CanvasKitLoader';
export { resetCanvasKitRuntime } from './RuntimeReset';

export { FontManager } from './FontManager';
export type { FontManagerOptions } from './FontManager';

export { FontCache } from './FontCache';
export type { CachedFont } from './FontCache';

export { SurfaceManager, getSurfaceManager, resetSurfaceManager } from './SurfaceManager';
export type { SurfaceOptions, SurfaceInfo } from './SurfaceManager';

export {
  detectWebGLSupport,
  detectWebAssemblySupport,
  clearCanvas,
  saveCanvasState,
  restoreCanvasState,
  applyTransform,
  setClipRect,
  createPaint,
  exportSurfaceToPNG,
  exportSurfaceToJPEG,
  measureText,
  PerformanceMonitor,
} from './utils';

// 验证和基准测试
export { runAllVerifications } from './verify';

// 样式转换器
export {
  parseColor,
  toCanvasKitColor,
  parseGradient,
  createGradientShader,
  parseBorder,
  createBorderPath,
  createBorderPaint,
  parseShadow,
  createShadowFilters,
  parseTextStyle,
  createFont,
  createTextPaint,
  convertStyles,
} from './converters';
export type {
  RGBA,
  Gradient,
  BorderStyle,
  Shadow,
  TextStyle,
  CanvasKitStyles,
  CSSStyles,
} from './converters';

// 渲染器
export {
  containerRenderer,
  textRenderer,
  imageRenderer,
  svgRenderer,
  getRenderer,
  renderElement,
} from './renderers';
export type {
  IElementRenderer,
  IRElement,
  Bounds,
  Styles,
  RenderContext,
} from './renderers/types';

// 核心渲染引擎
export {
  CanvasKitRenderer,
  createCanvasKitRenderer,
} from './CanvasKitRenderer';
export type { RenderOptions } from './CanvasKitRenderer';

// 瓦片渲染
export {
  TileRenderer,
  createTileRenderer,
} from './tile';
export type { TileConfig, TileInfo } from './tile';

// 降级方案
export {
  FallbackDetector,
  fallbackDetector,
  detectRecommendedRenderer,
  supportsCanvasKit,
} from './fallback';
export type { CapabilityResult } from './fallback';

// 标注系统
export {
  CanvasAnnotationRenderer,
  AnnotationStyles,
  ViewportManager,
  DEFAULT_ANNOTATION_STYLES,
  buildAnnotationStylesFromTheme,
  resolveAnnotationStyleConfig,
  // 距离计算函数
  calculateMarkData,
  isIntersect,
  getPosition,
  // 渲染器
  DistanceRenderer,
  DimensionRenderer,
  RulerRenderer,
} from './annotations';
// 兼容性别名（用于 CanvasKit 标注系统）
export { CanvasAnnotationRenderer as AnnotationRenderer } from './annotations';
export type {
  // 类型定义
  ElementBounds,
  PageRect,
  DistanceData,
  RulerData,
  CalculationResult,
  DistanceStyle,
  RulerStyle,
  SelectionStyle,
  HoverStyle,
  AnnotationStyleConfig,
  PartialAnnotationStyleConfig,
  AnnotationTheme,
  ViewportConfig,
  ViewportState,
  AnnotationElement,
  AnnotationRendererOptions,
  AnnotationRenderContext,
} from './annotations';
