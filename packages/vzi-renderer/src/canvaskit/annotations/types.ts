/**
 * 标注系统类型定义
 *
 * 包含距离计算、样式配置、视口管理等核心类型
 */

// ============================================
// 元素边界类型
// ============================================

/**
 * 元素边界信息（用于距离计算）
 */
export interface ElementBounds {
  /** 上边界 Y 坐标 */
  top: number;
  /** 左边界 X 坐标 */
  left: number;
  /** 下边界 Y 坐标 */
  bottom: number;
  /** 右边界 X 坐标 */
  right: number;
  /** 元素宽度 */
  width: number;
  /** 元素高度 */
  height: number;
}

/**
 * 页面/画布尺寸
 */
export interface PageRect {
  /** 页面宽度 */
  width: number;
  /** 页面高度 */
  height: number;
}

// ============================================
// 距离计算结果类型
// ============================================

/**
 * 距离标注数据
 */
export interface DistanceData {
  /** 标注位置 X（相对于画布的百分比 0-1） */
  x: number;
  /** 标注位置 Y（相对于画布的百分比 0-1） */
  y: number;
  /** 水平标注宽度（百分比） */
  w?: number;
  /** 垂直标注高度（百分比） */
  h?: number;
  /** 距离值（像素） */
  distance: number;
}

/**
 * 标尺线数据
 */
export interface RulerData {
  /** 标尺位置 X（百分比） */
  x: number;
  /** 标尺位置 Y（百分比） */
  y: number;
  /** 水平宽度（百分比） */
  w?: number;
  /** 垂直高度（百分比） */
  h?: number;
  /** 距离值（像素） */
  distance: number;
}

/**
 * 距离计算结果
 */
export interface CalculationResult {
  /** 距离标注数据数组 */
  distanceData: DistanceData[];
  /** 标尺线数据数组 */
  rulerData: RulerData[];
}

// ============================================
// 样式配置类型
// ============================================

/**
 * 距离标注样式
 */
export interface DistanceStyle {
  /** 线条颜色 */
  strokeColor: string;
  /** 线条宽度 */
  strokeWidth: number;
  /** 标签背景色 */
  labelBackgroundColor: string;
  /** 标签文字颜色 */
  labelTextColor: string;
  /** 标签字体大小 */
  labelFontSize: number;
  /** 标签圆角 */
  labelBorderRadius: number;
  /** 标签内边距 [水平, 垂直] */
  labelPadding: [number, number];
}

/**
 * 标尺线样式
 */
export interface RulerStyle {
  /** 线条颜色 */
  strokeColor: string;
  /** 线条宽度 */
  strokeWidth: number;
  /** 虚线模式 [线段长度, 间隔] */
  dashArray: number[];
  /** 透明度 */
  opacity: number;
}

/**
 * 选中元素样式
 */
export interface SelectionStyle {
  /** 边框颜色 */
  strokeColor: string;
  /** 边框宽度 */
  strokeWidth: number;
  /** 填充透明度 */
  fillOpacity: number;
  /** 尺寸标签背景色（默认与边框色一致） */
  dimensionLabelBgColor?: string;
  /** 尺寸标签文字颜色 */
  dimensionLabelTextColor?: string;
  /** 尺寸标签字体大小 */
  dimensionLabelFontSize?: number;
  /** 尺寸标签圆角 */
  dimensionLabelBorderRadius?: number;
  /** 尺寸标签内边距 [水平, 垂直] */
  dimensionLabelPadding?: [number, number];
  /** 是否显示尺寸标签 */
  showDimensionLabel?: boolean;
}

/**
 * 悬停元素样式
 */
export interface HoverStyle {
  /** 边框颜色 */
  strokeColor: string;
  /** 边框宽度 */
  strokeWidth: number;
  /** 填充透明度 */
  fillOpacity: number;
}

/**
 * 完整的标注样式配置
 */
export interface AnnotationStyleConfig {
  /** 距离标注样式 */
  distance: DistanceStyle;
  /** 标尺线样式 */
  ruler: RulerStyle;
  /** 选中元素样式 */
  selection: SelectionStyle;
  /** 悬停元素样式 */
  hover: HoverStyle;
}

/**
 * 部分标注样式配置（用于覆盖）
 */
export type PartialAnnotationStyleConfig = {
  [K in keyof AnnotationStyleConfig]?: Partial<AnnotationStyleConfig[K]>;
};

/**
 * 业务友好的简化标注主题
 *
 * 语义约定：
 * - selection* 控制选中框与尺寸标签
 * - hover* 控制悬停框
 * - measurement 复用 hover 的颜色与线宽
 */
export interface AnnotationTheme {
  /** 选中框颜色，同时作为尺寸标签背景色 */
  selectionColor?: string;
  /** 选中框线宽 */
  selectionStrokeWidth?: number;
  /** 悬停框颜色，同时作为距离线/标尺线/距离标签背景色 */
  hoverColor?: string;
  /** 悬停框线宽，同时作为距离线/标尺线线宽 */
  hoverStrokeWidth?: number;
}

// ============================================
// 视口管理类型
// ============================================

/**
 * 视口配置
 */
export interface ViewportConfig {
  /** 可视区域宽度，默认自动计算（设计稿宽度） */
  viewportWidth?: number;
  /** 可视区域高度，默认自动计算（设计稿高度） */
  viewportHeight?: number;
  /** 是否允许拖动，默认 true */
  pannable?: boolean;
  /** 拖动边界限制，默认无限制 */
  bounds?: {
    min?: { x: number; y: number };
    max?: { x: number; y: number };
  };
}

/**
 * 视口状态
 */
export interface ViewportState {
  /** 当前偏移量（设计稿坐标系） */
  offset: { x: number; y: number };
  /** 当前缩放比例 */
  scale: number;
}

// ============================================
// 标注渲染器类型
// ============================================

/**
 * 标注元素信息（用于渲染）
 */
export interface AnnotationElement {
  /** 元素 ID */
  id: string;
  /** 元素名称 */
  name?: string;
  /** 元素边界（设计稿坐标系） */
  bounds: ElementBounds;
  /** 是否为组件 */
  isComponent?: boolean;
  /** 是否为组 */
  isGroup?: boolean;
}

/**
 * 标注渲染器选项
 */
export interface AnnotationRendererOptions {
  /** CanvasKit 实例 */
  canvasKit: unknown; // CanvasKit 类型
  /** Canvas 实例 */
  canvas: unknown; // Canvas 类型
  /** 样式配置 */
  styles?: PartialAnnotationStyleConfig;
  /** 视口配置 */
  viewport?: Partial<ViewportConfig>;
}

/**
 * 标注渲染上下文
 */
export interface AnnotationRenderContext {
  /** CanvasKit 实例 */
  canvasKit: unknown;
  /** Canvas 实例 */
  canvas: unknown;
  /** 当前缩放比例 */
  scale: number;
  /** 视口偏移 */
  offset: { x: number; y: number };
  /** 页面尺寸 */
  pageRect: PageRect;
  /** 样式配置 */
  styles: AnnotationStyleConfig;
}
