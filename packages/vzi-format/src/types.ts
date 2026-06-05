/**
 * VZI 2.0 格式类型定义
 *
 * 任务 3.3-3.4: 定义 VZI 2.0 文件格式和核心类型
 */

import type { IRStyles, IRElement, IRBounds } from "@vzi-core/types";

// ============================================
// VZI 2.0 文件头（未加密，256 bytes）
// ============================================

/**
 * VZI 魔数（文件标识）
 */
export const VZI_MAGIC = 0x565a6932; // 'VZI\x32'

/**
 * VZI 文件版本
 */
export const VZI_VERSION = 0x0002;

/**
 * VZI 文件头（256 bytes，未加密）
 */
export interface VZIHeader {
  /** 魔数（4 bytes） */
  magic: number;
  /** 版本（2 bytes） */
  version: number;
  /** 文件大小（8 bytes） */
  fileSize: bigint;
  /** 元素数量（4 bytes） */
  elementCount: number;
  /** 块数量（4 bytes） */
  blockCount: number;
  /** 元数据偏移（8 bytes） */
  metadataOffset: bigint;
  /** 元数据长度（4 bytes） */
  metadataLength: number;
  /** 块索引偏移（8 bytes） */
  blockIndexOffset: bigint;
  /** 块索引长度（4 bytes） */
  blockIndexLength: number;
  /** 数据偏移（8 bytes） */
  dataOffset: bigint;
  /** 校验和（32 bytes） */
  checksum: Uint8Array;
  /** 保留字段（168 bytes） */
  reserved: Uint8Array;
}

// ============================================
// VZI 块结构
// ============================================

/**
 * 块类型
 */
export type BlockType =
  | "metadata" // 元数据块
  | "elements" // 元素块
  | "styles" // 样式块
  | "resources" // 资源块
  | "annotations" // 标注块
  | "spatial"; // 空间索引块

/**
 * 块索引项
 */
export interface BlockIndexEntry {
  /** 块类型 */
  type: BlockType;
  /** 块 ID */
  id: string;
  /** 偏移量 */
  offset: bigint;
  /** 块大小（压缩后） */
  compressedSize: number;
  /** 块大小（原始） */
  uncompressedSize: number;
  /** 块校验和 */
  checksum: Uint8Array;
}

/**
 * 块数据
 */
export interface Block {
  /** 块头 */
  header: BlockIndexEntry;
  /** 块数据（解压后） */
  data: Uint8Array;
}

// ============================================
// 元数据
// ============================================

/**
 * VZI 文件元数据
 */
export interface VZIMetadata {
  /** 文件名 */
  name: string;
  /** 创建时间 */
  createdAt: string;
  /** 修改时间 */
  modifiedAt: string;
  /** 视口宽度 */
  viewportWidth: number;
  /** 视口高度 */
  viewportHeight: number;
  /** 最小阅读器版本 */
  minReaderVersion: string;
  /** 功能标志 */
  features: string[];
  /** 来源信息 */
  source?: {
    url?: string;
    title?: string;
  };
}

// ============================================
// 任务 3.5: SharedStyle 接口
// ============================================

/**
 * 共享样式（用于样式去重）
 */
export interface SharedStyle {
  /** 样式 ID（哈希值） */
  id: string;
  /** 样式属性 */
  properties: IRStyles;
  /** 使用此样式的元素 ID 列表 */
  elementIds: string[];
  /** 出现频率 */
  frequency: number;
}

// ============================================
// 任务 3.6: SpatialBlock 接口（四叉树结构）
// ============================================

/**
 * 空间块（四叉树节点）
 */
export interface SpatialBlock {
  /** 块 ID */
  id: string;
  /** 边界 */
  bounds: IRBounds;
  /** 子块 ID 列表（最多 4 个） */
  children?: string[];
  /** 元素 ID 列表 */
  elementIds: string[];
  /** 深度 */
  depth: number;
}

/**
 * 四叉树空间索引
 */
export interface QuadTreeIndex {
  /** 根块 ID */
  rootBlockId: string;
  /** 所有块 */
  blocks: Map<string, SpatialBlock>;
  /** 最大深度 */
  maxDepth: number;
}

// ============================================
// 任务 3.7: ColorToken 接口
// ============================================

/**
 * 颜色类别
 */
export type ColorCategory =
  | "primary" // 主色
  | "secondary" // 辅色
  | "accent" // 强调色
  | "background" // 背景色
  | "text" // 文本色
  | "border" // 边框色
  | "other"; // 其他

/**
 * 颜色令牌
 */
export interface ColorToken {
  /** 颜色值（如 #ffffff, rgb(255,255,255)） */
  value: string;
  /** 颜色名称（自动生成或手动指定） */
  name?: string;
  /** 颜色类别 */
  category: ColorCategory;
  /** 使用场景描述 */
  usage?: string;
  /** 出现频率 */
  frequency: number;
  /** 相关颜色令牌 */
  relatedTokens?: string[];
}

// ============================================
// 任务 3.8: FontToken 接口
// ============================================

/**
 * 字体令牌
 */
export interface FontToken {
  /** 字体族 */
  fontFamily: string;
  /** 字重 */
  fontWeight?: number;
  /** 字号（像素） */
  fontSize?: number;
  /** 行高 */
  lineHeight?: number;
  /** 字间距 */
  letterSpacing?: number;
  /** 使用场景描述 */
  usage?: string;
  /** 出现频率 */
  frequency: number;
}

// ============================================
// 任务 3.9: 标注类型
// ============================================

/**
 * 标注类型
 */
export type AnnotationType =
  | "spacing" // 间距标注
  | "alignment" // 对齐标注
  | "dimension" // 尺寸标注
  | "grid" // 网格标注
  | "distance"; // 距离标注

/**
 * 基础标注
 */
export interface BaseAnnotation {
  /** 标注 ID */
  id: string;
  /** 标注类型 */
  type: AnnotationType;
  /** 关联的元素 ID */
  elementIds: string[];
  /** 标注位置 */
  position: IRBounds;
  /** 标注值 */
  value: string;
}

/**
 * 间距标注
 */
export interface SpacingAnnotation extends BaseAnnotation {
  type: "spacing";
  /** 间距类型 */
  spacingType: "margin" | "padding" | "gap";
  /** 间距值（上右下左） */
  values: [number, number, number, number];
}

/**
 * 对齐标注
 */
export interface AlignmentAnnotation extends BaseAnnotation {
  type: "alignment";
  /** 对齐方式 */
  alignment: "left" | "center" | "right" | "top" | "middle" | "bottom";
}

/**
 * 尺寸标注
 */
export interface DimensionAnnotation extends BaseAnnotation {
  type: "dimension";
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
}

/**
 * 网格标注
 */
export interface GridAnnotation extends BaseAnnotation {
  type: "grid";
  /** 列数 */
  columns: number;
  /** 行数 */
  rows: number;
  /** 列宽 */
  columnWidths: number[];
  /** 行高 */
  rowHeights: number[];
  /** 间距 */
  gap: number;
}

/**
 * 距离标注
 */
export interface DistanceAnnotation extends BaseAnnotation {
  type: "distance";
  /** 起始元素 */
  fromElementId: string;
  /** 目标元素 */
  toElementId: string;
  /** 距离值 */
  distance: number;
  /** 方向 */
  direction: "horizontal" | "vertical";
}

/**
 * 所有标注类型
 */
export type Annotation =
  | SpacingAnnotation
  | AlignmentAnnotation
  | DimensionAnnotation
  | GridAnnotation
  | DistanceAnnotation;

// ============================================
// 任务 3.10: ImageAsset 接口
// ============================================

/**
 * 图片存储类型
 */
export type ImageStorageType =
  | "embedded" // 内嵌
  | "external" // 外部 URL
  | "reference"; // 引用（共享）

/**
 * 图片资源
 */
export interface ImageAsset {
  /** 资源 ID */
  id: string;
  /** 存储类型 */
  storageType: ImageStorageType;
  /** 图片数据（内嵌时） */
  data?: Uint8Array;
  /** 外部 URL（外部时） */
  url?: string;
  /** 引用 ID（共享时） */
  referenceId?: string;
  /** 缩略图（可选） */
  thumbnail?: Uint8Array;
  /** MIME 类型 */
  mimeType: string;
  /** 原始宽度 */
  width: number;
  /** 原始高度 */
  height: number;
  /** 文件大小 */
  size: number;
  /** 哈希值（用于去重） */
  hash: string;
}

// ============================================
// 任务 3.11: Layer 接口
// ============================================

/**
 * 混合模式
 */
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

/**
 * 图层
 */
export interface Layer {
  /** 图层 ID */
  id: string;
  /** 图层名称 */
  name: string;
  /** 父图层 ID */
  parentId?: string;
  /** 子图层 ID 列表 */
  children?: string[];
  /** 元素 ID 列表 */
  elementIds: string[];
  /** 是否可见 */
  visible: boolean;
  /** 是否锁定 */
  locked: boolean;
  /** 透明度 */
  opacity: number;
  /** 混合模式 */
  blendMode: BlendMode;
  /** 图层顺序 */
  zIndex: number;
}

// ============================================
// 任务 3.12: 版本兼容性结构
// ============================================

/**
 * 版本兼容性信息
 */
export interface VersionCompatibility {
  /** 最小阅读器版本 */
  minReaderVersion: string;
  /** 当前格式版本 */
  formatVersion: string;
  /** 支持的功能 */
  features: VZIFeature[];
  /** 弃用的功能 */
  deprecatedFeatures?: string[];
}

/**
 * VZI 功能标志
 */
export interface VZIFeature {
  /** 功能名称 */
  name: string;
  /** 引入版本 */
  introducedIn: string;
  /** 是否必需 */
  required: boolean;
  /** 功能参数（可选） */
  parameters?: Record<string, unknown>;
}

// ============================================
// 错误恢复
// ============================================

/**
 * 块错误类型
 */
export type BlockErrorType =
  | "checksum_mismatch" // 校验和不匹配
  | "decryption_failed" // 解密失败
  | "decompression_failed" // 解压失败
  | "decode_failed" // 解码失败
  | "corrupted_data"; // 数据损坏

/**
 * 块错误信息
 */
export interface BlockError {
  /** 块 ID */
  blockId: string;
  /** 块类型 */
  blockType: BlockType;
  /** 错误类型 */
  errorType: BlockErrorType;
  /** 错误消息 */
  message: string;
  /** 是否为致命错误 */
  fatal: boolean;
}

/**
 * 解码结果（包含错误信息）
 */
export interface DecodeResult {
  /** 解码的内容 */
  content: VZIContent;
  /** 错误列表 */
  errors: BlockError[];
  /** 是否为降级模式 */
  degraded: boolean;
  /** 成功解码的块数 */
  successfulBlocks: number;
  /** 失败的块数 */
  failedBlocks: number;
}

// ============================================
// VZI 完整内容
// ============================================

/**
 * VZI 2.0 完整内容
 */
export interface VZIContent {
  /** 文件头 */
  header: VZIHeader;
  /** 元数据 */
  metadata: VZIMetadata;
  /** 元素映射 */
  elements: Map<string, IRElement>;
  /** 共享样式 */
  sharedStyles: Map<string, SharedStyle>;
  /** 空间索引 */
  spatialIndex: QuadTreeIndex;
  /** 颜色令牌 */
  colorTokens: ColorToken[];
  /** 字体令牌 */
  fontTokens: FontToken[];
  /** 标注 */
  annotations: Annotation[];
  /** 图片资源 */
  images: Map<string, ImageAsset>;
  /** 图层 */
  layers: Layer[];
  /** 版本兼容性 */
  compatibility: VersionCompatibility;
}
