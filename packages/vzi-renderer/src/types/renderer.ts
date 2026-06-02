/**
 * VZI Renderer 类型定义
 *
 * 包含所有公开 API 的类型定义
 */

import type { IRElement, IRBounds } from '@vzi-core/types';
import type { Annotation, ColorToken, FontToken } from './design-tokens';

// ============================================
// 渲染器属性
// ============================================

/**
 * 渲染模式
 */
export type RenderMode = 'full' | 'tile';

/**
 * VZI 渲染器属性
 */
export interface VZIRendererProps {
  /** IR 数据或转换结果 */
  data: RendererData;
  /** 容器宽度 */
  width: number;
  /** 容器高度 */
  height: number;
  /** 渲染模式：full（全量渲染）或 tile（瓦片渲染） */
  renderMode?: RenderMode;
  /** 初始缩放比例 */
  initialScale?: number;
  /** 最小缩放比例 */
  minScale?: number;
  /** 最大缩放比例 */
  maxScale?: number;
  /** 是否显示网格 */
  showGrid?: boolean;
  /** 网格大小 */
  gridSize?: number;
  /** 是否显示标尺 */
  showRulers?: boolean;
  /** 是否显示标注 */
  showAnnotations?: boolean;
  /** 标注样式配置（CanvasKit 模式） */
  annotationStyles?: Partial<import('../canvaskit/annotations/types').AnnotationStyleConfig>;
  /** 视口配置 */
  viewportConfig?: Partial<import('../canvaskit/annotations/types').ViewportConfig>;
  /** 选中元素 ID */
  selectedElementId?: string | null;
  /** 悬停元素 ID */
  hoveredElementId?: string | null;
  /** 元素选中回调 */
  onElementSelect?: (elementId: string | null) => void;
  /** 元素悬停回调 */
  onElementHover?: (elementId: string | null) => void;
  /** 缩放变化回调 */
  onScaleChange?: (scale: number) => void;
  /** 画布位置变化回调 */
  onPositionChange?: (x: number, y: number) => void;
  /** 标注点击回调 */
  onAnnotationClick?: (elementId: string) => void;
  /** 自定义类名 */
  className?: string;
}

/**
 * 渲染器数据输入
 */
export type RendererData = IRData | TransformResultData;

/**
 * IR 数据
 */
export interface IRData {
  type: 'ir';
  ir: {
    version: string;
    rootElementId: string;
    elements: Record<string, IRElement>;
    metadata?: {
      title?: string;
      [key: string]: unknown;
    };
  };
}

/**
 * 转换结果数据
 */
export interface TransformResultData {
  type: 'transform-result';
  metadata: {
    name: string;
    viewportWidth: number;
    viewportHeight: number;
    [key: string]: unknown;
  };
  ir: {
    version: string;
    rootElementId: string;
    elements: Record<string, IRElement>;
  };
  tokens: {
    colors: ColorToken[];
    fontSizes: FontToken[];
    spacing: Array<{ value: number; type: string; frequency: number }>;
  };
  annotations: Annotation[];
}

// ============================================
// 视口状态
// ============================================

/**
 * 视口状态
 */
export interface ViewportState {
  /** 缩放比例 */
  scale: number;
  /** X 偏移 */
  x: number;
  /** Y 偏移 */
  y: number;
  /** 视口宽度 */
  width: number;
  /** 视口高度 */
  height: number;
  /** 画布宽度 */
  canvasWidth: number;
  /** 画布高度 */
  canvasHeight: number;
}

/**
 * 视口边界
 */
export interface ViewportBounds {
  /** 最小 X */
  minX: number;
  /** 最小 Y */
  minY: number;
  /** 最大 X */
  maxX: number;
  /** 最大 Y */
  maxY: number;
}

// ============================================
// 渲染器状态
// ============================================

/**
 * 渲染器状态
 */
export interface RendererState {
  /** 视口状态 */
  viewport: ViewportState;
  /** 选中元素 ID */
  selectedElementId: string | null;
  /** 悬停元素 ID */
  hoveredElementId: string | null;
  /** 是否正在拖拽 */
  isDragging: boolean;
  /** 是否正在框选 */
  isSelecting: boolean;
  /** 框选区域 */
  selectionRect: IRBounds | null;
  /** 显示网格 */
  showGrid: boolean;
  /** 显示标尺 */
  showRulers: boolean;
  /** 显示标注 */
  showAnnotations: boolean;
}

/**
 * 渲染器动作
 */
export type RendererAction =
  | { type: 'SET_SCALE'; scale: number }
  | { type: 'SET_POSITION'; x: number; y: number }
  | { type: 'ZOOM_TO'; scale: number; centerX: number; centerY: number }
  | { type: 'SELECT_ELEMENT'; elementId: string | null }
  | { type: 'HOVER_ELEMENT'; elementId: string | null }
  | { type: 'START_DRAG' }
  | { type: 'END_DRAG' }
  | { type: 'START_SELECTION'; rect: IRBounds }
  | { type: 'UPDATE_SELECTION'; rect: IRBounds }
  | { type: 'END_SELECTION' }
  | { type: 'TOGGLE_GRID' }
  | { type: 'TOGGLE_RULERS' }
  | { type: 'TOGGLE_ANNOTATIONS' };

// ============================================
// 元素渲染
// ============================================

/**
 * 元素渲染属性
 */
export interface ElementRenderProps {
  /** 元素数据 */
  element: IRElement;
  /** 缩放比例 */
  scale: number;
  /** 是否选中 */
  isSelected: boolean;
  /** 是否悬停 */
  isHovered: boolean;
  /** 点击回调 */
  onClick?: (elementId: string) => void;
  /** 悬停回调 */
  onHover?: (elementId: string | null) => void;
}

/**
 * 渲染后的元素样式
 */
export interface RenderedElementStyle {
  /** 背景色 */
  backgroundColor?: string;
  /** 边框颜色 */
  borderColor?: string;
  /** 边框宽度 */
  borderWidth?: number;
  /** 边框样式 */
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none';
  /** 边框圆角 */
  borderRadius?: number | [number, number, number, number];
  /** 透明度 */
  opacity?: number;
  /** 阴影 */
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  /** 文本样式 */
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fontStyle?: 'normal' | 'italic';
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  color?: string;
  textDecoration?: string;
}

// ============================================
// 标注渲染
// ============================================

/**
 * 标注渲染属性
 */
export interface AnnotationRenderProps {
  /** 标注数据 */
  annotation: Annotation;
  /** 元素映射 */
  elements: Record<string, IRElement>;
  /** 缩放比例 */
  scale: number;
  /** 可见性 */
  visible: boolean;
}

/**
 * 标注样式
 */
export interface AnnotationStyle {
  /** 线条颜色 */
  strokeColor: string;
  /** 线条宽度 */
  strokeWidth: number;
  /** 线条样式 */
  dash?: number[];
  /** 文本颜色 */
  textColor: string;
  /** 字体大小 */
  fontSize: number;
  /** 背景色 */
  backgroundColor?: string;
}

// ============================================
// 网格和标尺
// ============================================

/**
 * 网格配置
 */
export interface GridConfig {
  /** 是否显示 */
  visible: boolean;
  /** 网格大小 */
  size: number;
  /** 主网格颜色 */
  majorColor: string;
  /** 次网格颜色 */
  minorColor: string;
  /** 主网格间隔（每几个格子一个主网格） */
  majorInterval: number;
}

/**
 * 标尺配置
 */
export interface RulerConfig {
  /** 是否显示 */
  visible: boolean;
  /** 标尺宽度/高度 */
  size: number;
  /** 背景色 */
  backgroundColor: string;
  /** 文字颜色 */
  textColor: string;
  /** 刻度颜色 */
  tickColor: string;
  /** 字体大小 */
  fontSize: number;
}

// ============================================
// 导出功能
// ============================================

/**
 * 导出选项
 */
export interface ExportOptions {
  /** 导出格式 */
  format: 'png' | 'jpeg' | 'pdf';
  /** 导出区域 */
  region?: 'all' | 'viewport' | 'selection';
  /** 缩放比例（用于控制导出质量） */
  pixelRatio?: number;
  /** 背景色 */
  backgroundColor?: string;
  /** JPEG 质量（0-1） */
  quality?: number;
}

/**
 * 导出结果
 */
export interface ExportResult {
  /** 数据 URL */
  dataUrl: string;
  /** Blob 数据 */
  blob?: Blob;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
  /** 格式 */
  format: 'png' | 'jpeg' | 'pdf';
}

// ============================================
// 性能优化
// ============================================

/**
 * 虚拟化配置
 */
export interface VirtualizationConfig {
  /** 是否启用虚拟化 */
  enabled: boolean;
  /** 预渲染边距（像素） */
  margin: number;
  /** 最小元素尺寸（小于此尺寸的元素不渲染） */
  minElementSize: number;
}

/**
 * 缓存配置
 */
export interface CacheConfig {
  /** 是否启用缓存 */
  enabled: boolean;
  /** 最大缓存数量 */
  maxSize: number;
  /** 缓存过期时间（毫秒） */
  ttl: number;
}

// ============================================
// 事件类型
// ============================================

/**
 * 渲染器事件映射
 */
export interface RendererEventMap {
  'element:select': { elementId: string | null; element: IRElement | null };
  'element:hover': { elementId: string | null; element: IRElement | null };
  'viewport:change': ViewportState;
  'scale:change': number;
  'position:change': { x: number; y: number };
  'selection:complete': { elementIds: string[] };
  'export:complete': ExportResult;
  'export:error': Error;
}

/**
 * 事件处理器
 */
export type RendererEventHandler<K extends keyof RendererEventMap> = (
  event: RendererEventMap[K]
) => void;
