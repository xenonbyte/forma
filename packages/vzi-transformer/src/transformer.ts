/**
 * VZI Transformer - IR 到 VZI 2.0 转换器
 *
 * 任务 4.3-4.28: 实现完整的转换器功能
 */

import type {
  IntermediateRepresentation,
  IRMetadata,
  IRElementType,
  IRElement,
  IRStyles,
  IRBounds,
} from "@vzi-core/types";
import type {
  VZIMetadata,
  Annotation,
  ColorToken,
  FontToken,
  SpacingAnnotation,
  AlignmentAnnotation,
  DimensionAnnotation,
} from "@vzi-core/format";
import RBush from "rbush";
import type { BBox } from "rbush";

// ============================================
// 类型定义
// ============================================

/**
 * 间距令牌
 */
export interface SpacingToken {
  value: number;
  type: "padding" | "margin" | "gap";
  frequency: number;
}

/**
 * 来源信息
 */
export interface VZISource {
  type: "file" | "url" | "figma";
  identifier: string;
  capturedAt: number;
}

/**
 * 令牌集合
 */
export interface VZITokens {
  colors: ColorToken[];
  fontSizes: FontToken[];
  spacing: SpacingToken[];
}

export interface TransformOptions {
  /** 文档标题 */
  title?: string;
  /** 原始文件名 */
  originalFileName?: string | null;
  /** 原始 URL */
  originalUrl?: string | null;
  /** 创建者标识 */
  createdBy: string;
  /** 来源类型 */
  sourceType: "file" | "url" | "figma";
  /** 来源标识 */
  sourceIdentifier: string;
  /** 转换器版本 */
  converterVersion?: string;
  /** 是否启用智能标注 */
  enableAnnotations?: boolean;
  /** 是否启用设计令牌提取 */
  enableTokenExtraction?: boolean;
}

export interface TransformResult {
  metadata: VZIMetadata;
  ir: IntermediateRepresentation;
  tokens: VZITokens;
  annotations: Annotation[];
  source: VZISource;
}

// R-tree 索引项
interface SpatialIndexItem extends BBox {
  id: string;
  element: IRElement;
}

// ============================================
// VZI Transformer 主类
// ============================================

export class VZITransformer {
  private options: TransformOptions;
  private ir: IntermediateRepresentation | null = null;
  private spatialIndex: RBush<SpatialIndexItem> | null = null;
  private elementMap: Map<string, IRElement> = new Map();

  constructor(options: TransformOptions) {
    this.options = {
      enableAnnotations: true,
      enableTokenExtraction: true,
      converterVersion: "2.0.0",
      ...options,
    };
  }

  /**
   * 转换 IR 到 VZI 格式
   */
  transform(ir: IntermediateRepresentation): TransformResult {
    this.ir = ir;
    this.buildSpatialIndex();

    const normalized = this.normalizeIR(ir);
    const canvasSize = this.inferCanvasSize(normalized);

    const metadata: VZIMetadata = {
      name: this.options.title ?? String(normalized.metadata?.title || "Untitled Design"),
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      viewportWidth: canvasSize.width,
      viewportHeight: canvasSize.height,
      minReaderVersion: "2.0.0",
      features: [],
      source: {
        url: this.options.originalUrl ?? undefined,
        title: this.options.originalFileName ?? undefined,
      },
    };

    const tokens = this.options.enableTokenExtraction
      ? this.extractTokens(normalized)
      : this.extractBasicTokens(normalized);

    const annotations = this.options.enableAnnotations ? this.extractAnnotations(normalized) : [];

    return {
      metadata,
      ir: normalized,
      tokens,
      annotations,
      source: {
        type: this.options.sourceType,
        identifier: this.options.sourceIdentifier,
        capturedAt: Date.now(),
      },
    };
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 构建空间索引（R-tree）
   */
  private buildSpatialIndex(): void {
    this.spatialIndex = new RBush<SpatialIndexItem>();
    this.elementMap.clear();

    if (!this.ir) return;

    Object.entries(this.ir.elements).forEach(([id, element]) => {
      this.elementMap.set(id, element);

      this.spatialIndex!.insert({
        minX: element.bounds.x,
        minY: element.bounds.y,
        maxX: element.bounds.x + element.bounds.width,
        maxY: element.bounds.y + element.bounds.height,
        id,
        element,
      });
    });
  }

  /**
   * 规范化 IR
   */
  private normalizeIR(ir: IntermediateRepresentation): IntermediateRepresentation {
    const elements: Record<string, IRElement> = {};

    Object.entries(ir.elements).forEach(([id, element]) => {
      const type = this.mapElementType(element.type);
      elements[id] = {
        ...element,
        type,
        styles: this.normalizeStyles(element.styles),
        metadata: this.normalizeElementMetadata(element.metadata),
      };
    });

    return {
      ...ir,
      version: ir.version || "1.0.0",
      elements,
      metadata: this.normalizeDocumentMetadata(ir.metadata),
    };
  }

  /**
   * 映射元素类型
   */
  private mapElementType(type: IRElementType): IRElementType {
    const validTypes = ["container", "text", "image", "button", "input", "link"];
    if (validTypes.includes(type)) {
      return type;
    }
    return "container" as IRElementType;
  }

  /**
   * 规范化样式
   */
  private normalizeStyles(styles: IRStyles): IRStyles {
    const normalized: IRStyles = {};
    Object.entries(styles || {}).forEach(([key, value]) => {
      if (value !== undefined) {
        normalized[key] = value;
      }
    });
    return normalized;
  }

  /**
   * 规范化元素元数据
   */
  private normalizeElementMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!metadata) return undefined;

    const result: Record<string, unknown> = {};
    Object.entries(metadata).forEach(([key, value]) => {
      if (value !== undefined) {
        result[key] = value;
      }
    });

    return Object.keys(result).length > 0 ? result : undefined;
  }

  /**
   * 规范化文档元数据
   */
  private normalizeDocumentMetadata(metadata?: IRMetadata): IRMetadata | undefined {
    if (!metadata) return undefined;

    const result: IRMetadata = {};
    Object.entries(metadata).forEach(([key, value]) => {
      if (value !== undefined) {
        result[key] = value;
      }
    });

    return Object.keys(result).length > 0 ? result : undefined;
  }

  /**
   * 推断画布大小
   */
  private inferCanvasSize(ir: IntermediateRepresentation): { width: number; height: number } {
    let maxRight = 0;
    let maxBottom = 0;

    Object.values(ir.elements).forEach((element) => {
      const right = element.bounds.x + element.bounds.width;
      const bottom = element.bounds.y + element.bounds.height;
      if (right > maxRight) maxRight = right;
      if (bottom > maxBottom) maxBottom = bottom;
    });

    return {
      width: Math.max(1, Math.ceil(maxRight)),
      height: Math.max(1, Math.ceil(maxBottom)),
    };
  }

  // ============================================
  // 设计令牌提取
  // ============================================

  /**
   * 提取基础令牌
   */
  private extractBasicTokens(ir: IntermediateRepresentation): VZITokens {
    const colors: ColorToken[] = [];
    const fontSizes: FontToken[] = [];
    const spacing: SpacingToken[] = [];
    const colorSet = new Set<string>();
    const fontTokenMap = new Map<string, FontToken>();
    const spacingSet = new Set<number>();

    Object.values(ir.elements).forEach((element) => {
      Object.entries(element.styles || {}).forEach(([key, value]) => {
        if (typeof value === "string") {
          if (key.toLowerCase().includes("color")) {
            colorSet.add(value);
          }
        }
        if (key === "fontSize") {
          const parsedSize =
            typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;

          if (Number.isFinite(parsedSize) && parsedSize > 0) {
            const rawFamily = element.styles?.fontFamily;
            const fontFamily =
              typeof rawFamily === "string" && rawFamily.trim().length > 0 ? rawFamily.trim() : "unknown";
            const normalizedSize = Math.round(parsedSize * 1000) / 1000;
            const tokenKey = `${fontFamily}:${normalizedSize}`;
            const existing = fontTokenMap.get(tokenKey);
            if (existing) {
              existing.frequency += 1;
            } else {
              fontTokenMap.set(tokenKey, {
                fontFamily,
                fontSize: normalizedSize,
                frequency: 1,
              });
            }
          }
        }
        if (typeof value === "number" && (key.includes("padding") || key.includes("margin") || key === "gap")) {
          spacingSet.add(value);
        }
      });
    });

    // 转换为 ColorToken
    Array.from(colorSet).forEach((value) => {
      colors.push({
        value,
        category: this.categorizeColor(value),
        frequency: 1,
      });
    });

    // 转换为 FontToken
    Array.from(fontTokenMap.values())
      .sort((a, b) => {
        const sizeA = a.fontSize ?? 0;
        const sizeB = b.fontSize ?? 0;
        if (sizeA !== sizeB) {
          return sizeA - sizeB;
        }
        return a.fontFamily.localeCompare(b.fontFamily);
      })
      .forEach((token) => fontSizes.push(token));

    // 转换为 SpacingToken
    Array.from(spacingSet)
      .sort((a, b) => a - b)
      .forEach((value) => {
        spacing.push({
          value,
          type: "padding",
          frequency: 1,
        });
      });

    return { colors, fontSizes, spacing };
  }

  /**
   * 提取设计令牌（增强版）
   */
  private extractTokens(ir: IntermediateRepresentation): VZITokens {
    const colorExtractor = new ColorTokenExtractor();
    const fontExtractor = new FontTokenExtractor();
    const spacingExtractor = new SpacingTokenExtractor();

    Object.values(ir.elements).forEach((element) => {
      colorExtractor.processElement(element);
      fontExtractor.processElement(element);
      spacingExtractor.processElement(element);
    });

    return {
      colors: colorExtractor.getTokens(),
      fontSizes: fontExtractor.getTokens(),
      spacing: spacingExtractor.getTokens(),
    };
  }

  /**
   * 分类颜色
   */
  private categorizeColor(color: string): ColorToken["category"] {
    return categorizeColorFromUsage(color, []);
  }

  // ============================================
  // 智能标注提取
  // ============================================

  /**
   * 提取标注
   */
  private extractAnnotations(ir: IntermediateRepresentation): Annotation[] {
    const annotations: Annotation[] = [];
    const elements = Object.values(ir.elements);

    // 间距标注
    annotations.push(...this.extractSpacingAnnotations(elements));

    // 对齐标注
    annotations.push(...this.extractAlignmentAnnotations(elements));

    // 尺寸标注
    annotations.push(...this.extractDimensionAnnotations(elements));

    // 去重
    return this.deduplicateAnnotations(annotations);
  }

  /**
   * 提取间距标注
   */
  private extractSpacingAnnotations(elements: IRElement[]): SpacingAnnotation[] {
    const MAX_GAP = 128;
    const MAX_CANDIDATES = 100;
    const annotations: SpacingAnnotation[] = [];

    for (const source of elements) {
      let nearestHorizontal: { target: IRElement; gap: number; position: IRBounds } | null = null;
      let nearestVertical: { target: IRElement; gap: number; position: IRBounds } | null = null;

      // 第一次以 MAX_GAP 查询；若无结果则扩大为 MAX_GAP*2 再查一次，
      // 避免稀疏布局下退化为 O(n²) 的全量遍历
      let nearbyCandidates = this.findNearbyElements(source.bounds, MAX_GAP);
      if (nearbyCandidates.length === 0) {
        nearbyCandidates = this.findNearbyElements(source.bounds, MAX_GAP * 2);
      }
      // 截断候选元素数量，防止密集布局下超线性开销
      const candidatePool =
        nearbyCandidates.length > MAX_CANDIDATES ? nearbyCandidates.slice(0, MAX_CANDIDATES) : nearbyCandidates;

      for (const candidate of candidatePool) {
        if (source.id === candidate.id) {
          continue;
        }

        const horizontalGap = this.getHorizontalGapInfo(source.bounds, candidate.bounds);
        if (horizontalGap && horizontalGap.gap <= MAX_GAP) {
          if (!nearestHorizontal || horizontalGap.gap < nearestHorizontal.gap) {
            nearestHorizontal = {
              target: candidate,
              gap: horizontalGap.gap,
              position: horizontalGap.position,
            };
          }
        }

        const verticalGap = this.getVerticalGapInfo(source.bounds, candidate.bounds);
        if (verticalGap && verticalGap.gap <= MAX_GAP) {
          if (!nearestVertical || verticalGap.gap < nearestVertical.gap) {
            nearestVertical = {
              target: candidate,
              gap: verticalGap.gap,
              position: verticalGap.position,
            };
          }
        }
      }

      if (nearestHorizontal) {
        const pair = [source.id, nearestHorizontal.target.id].sort();
        const roundedGap = Math.round(nearestHorizontal.gap);
        annotations.push({
          id: `spacing-h-${pair[0]}-${pair[1]}`,
          type: "spacing",
          spacingType: "gap",
          values: [0, roundedGap, 0, roundedGap],
          elementIds: pair,
          position: nearestHorizontal.position,
          value: `${roundedGap}px`,
        });
      }

      if (nearestVertical) {
        const pair = [source.id, nearestVertical.target.id].sort();
        const roundedGap = Math.round(nearestVertical.gap);
        annotations.push({
          id: `spacing-v-${pair[0]}-${pair[1]}`,
          type: "spacing",
          spacingType: "gap",
          values: [roundedGap, 0, roundedGap, 0],
          elementIds: pair,
          position: nearestVertical.position,
          value: `${roundedGap}px`,
        });
      }
    }

    return annotations;
  }

  /**
   * 提取对齐标注
   */
  private extractAlignmentAnnotations(elements: IRElement[]): AlignmentAnnotation[] {
    const annotations: AlignmentAnnotation[] = [];
    const tolerance = 2;

    // 11.3: 使用 Union-Find 算法进行对齐分组
    // 先收集所有值，再建立连接，最后合并连通分量

    const leftItems: Array<{ value: number; element: IRElement }> = [];
    const centerXItems: Array<{ value: number; element: IRElement }> = [];
    const rightItems: Array<{ value: number; element: IRElement }> = [];
    const topItems: Array<{ value: number; element: IRElement }> = [];
    const middleItems: Array<{ value: number; element: IRElement }> = [];
    const bottomItems: Array<{ value: number; element: IRElement }> = [];

    elements.forEach((el) => {
      const left = Math.round(el.bounds.x);
      const center = Math.round(el.bounds.x + el.bounds.width / 2);
      const right = Math.round(el.bounds.x + el.bounds.width);
      const top = Math.round(el.bounds.y);
      const middle = Math.round(el.bounds.y + el.bounds.height / 2);
      const bottom = Math.round(el.bounds.y + el.bounds.height);

      leftItems.push({ value: left, element: el });
      centerXItems.push({ value: center, element: el });
      rightItems.push({ value: right, element: el });
      topItems.push({ value: top, element: el });
      middleItems.push({ value: middle, element: el });
      bottomItems.push({ value: bottom, element: el });
    });

    // 使用 Union-Find 分组
    const leftGroups = this.groupByUnionFind(leftItems, tolerance);
    const centerXGroups = this.groupByUnionFind(centerXItems, tolerance);
    const rightGroups = this.groupByUnionFind(rightItems, tolerance);
    const topGroups = this.groupByUnionFind(topItems, tolerance);
    const middleGroups = this.groupByUnionFind(middleItems, tolerance);
    const bottomGroups = this.groupByUnionFind(bottomItems, tolerance);

    // 生成对齐标注
    annotations.push(...this.createAlignmentAnnotations(leftGroups, "left"));
    annotations.push(...this.createAlignmentAnnotations(centerXGroups, "center"));
    annotations.push(...this.createAlignmentAnnotations(rightGroups, "right"));
    annotations.push(...this.createAlignmentAnnotations(topGroups, "top"));
    annotations.push(...this.createAlignmentAnnotations(middleGroups, "middle"));
    annotations.push(...this.createAlignmentAnnotations(bottomGroups, "bottom"));

    return annotations;
  }

  /**
   * 提取尺寸标注
   */
  private extractDimensionAnnotations(elements: IRElement[]): DimensionAnnotation[] {
    const annotations: DimensionAnnotation[] = [];

    // 按宽度分组
    const widthGroups = new Map<number, IRElement[]>();
    const heightGroups = new Map<number, IRElement[]>();

    elements.forEach((el) => {
      const width = Math.round(el.bounds.width);
      const height = Math.round(el.bounds.height);

      this.addToGroup(widthGroups, width, el, 1);
      this.addToGroup(heightGroups, height, el, 1);
    });

    // 生成尺寸标注
    widthGroups.forEach((groupElements, size) => {
      if (groupElements.length >= 2) {
        const position = this.computeUnionBounds(groupElements.map((element) => element.bounds));
        annotations.push({
          id: `dimension-w-${size}`,
          type: "dimension",
          width: size,
          height: 0,
          elementIds: groupElements.map((el) => el.id),
          position,
          value: String(size),
        });
      }
    });

    heightGroups.forEach((groupElements, size) => {
      if (groupElements.length >= 2) {
        const position = this.computeUnionBounds(groupElements.map((element) => element.bounds));
        annotations.push({
          id: `dimension-h-${size}`,
          type: "dimension",
          width: 0,
          height: size,
          elementIds: groupElements.map((el) => el.id),
          position,
          value: String(size),
        });
      }
    });

    return annotations;
  }

  /**
   * 去重标注
   */
  private deduplicateAnnotations(annotations: Annotation[]): Annotation[] {
    const seen = new Set<string>();
    return annotations.filter((ann) => {
      if (ann.position.width <= 0 && ann.position.height <= 0) {
        return false;
      }

      const sortedIds = [...ann.elementIds].sort();
      const annotationSpecific =
        ann.type === "spacing"
          ? `${ann.spacingType}:${ann.value}`
          : ann.type === "alignment"
            ? `${ann.alignment}:${ann.value}`
            : ann.type === "dimension"
              ? `${ann.width}x${ann.height}:${ann.value}`
              : ann.value;

      const key = `${ann.type}:${sortedIds.join(",")}:${annotationSpecific}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ============================================
  // 辅助方法
  // ============================================

  private getHorizontalGapInfo(a: IRBounds, b: IRBounds): { gap: number; position: IRBounds } | null {
    const overlapTop = Math.max(a.y, b.y);
    const overlapBottom = Math.min(a.y + a.height, b.y + b.height);
    const overlapHeight = overlapBottom - overlapTop;
    if (overlapHeight <= 0) {
      return null;
    }

    const overlapRatio = overlapHeight / Math.max(1, Math.min(a.height, b.height));
    if (overlapRatio < 0.35) {
      return null;
    }

    if (a.x + a.width <= b.x) {
      const gap = b.x - (a.x + a.width);
      if (gap <= 0) {
        return null;
      }
      return {
        gap,
        position: {
          x: a.x + a.width,
          y: overlapTop,
          width: gap,
          height: overlapHeight,
        },
      };
    }

    if (b.x + b.width <= a.x) {
      const gap = a.x - (b.x + b.width);
      if (gap <= 0) {
        return null;
      }
      return {
        gap,
        position: {
          x: b.x + b.width,
          y: overlapTop,
          width: gap,
          height: overlapHeight,
        },
      };
    }

    return null;
  }

  private getVerticalGapInfo(a: IRBounds, b: IRBounds): { gap: number; position: IRBounds } | null {
    const overlapLeft = Math.max(a.x, b.x);
    const overlapRight = Math.min(a.x + a.width, b.x + b.width);
    const overlapWidth = overlapRight - overlapLeft;
    if (overlapWidth <= 0) {
      return null;
    }

    const overlapRatio = overlapWidth / Math.max(1, Math.min(a.width, b.width));
    if (overlapRatio < 0.35) {
      return null;
    }

    if (a.y + a.height <= b.y) {
      const gap = b.y - (a.y + a.height);
      if (gap <= 0) {
        return null;
      }
      return {
        gap,
        position: {
          x: overlapLeft,
          y: a.y + a.height,
          width: overlapWidth,
          height: gap,
        },
      };
    }

    if (b.y + b.height <= a.y) {
      const gap = a.y - (b.y + b.height);
      if (gap <= 0) {
        return null;
      }
      return {
        gap,
        position: {
          x: overlapLeft,
          y: b.y + b.height,
          width: overlapWidth,
          height: gap,
        },
      };
    }

    return null;
  }

  private addToGroup(groups: Map<number, IRElement[]>, value: number, element: IRElement, tolerance: number): void {
    // best-match: 选距离最近的组键，避免 first-match 导致的不确定性
    let bestKey: number | null = null;
    let bestDist = Infinity;
    for (const key of groups.keys()) {
      const dist = Math.abs(key - value);
      if (dist <= tolerance && dist < bestDist) {
        bestDist = dist;
        bestKey = key;
      }
    }

    if (bestKey !== null) {
      groups.get(bestKey)!.push(element);
    } else {
      groups.set(value, [element]);
    }
  }

  /**
   * Union-Find 数据结构 (11.3)
   *
   * 用于对齐分组算法：先建立所有 tolerance 内的连接，再合并连通分量
   */
  private createUnionFind(): { find: (x: number) => number; union: (x: number, y: number) => void } {
    const parent = new Map<number, number>();

    const find = (x: number): number => {
      let root = x;
      // 查找根
      while (parent.get(root) !== undefined && parent.get(root) !== root) {
        root = parent.get(root)!;
      }
      // 路径压缩
      let current = x;
      while (parent.get(current) !== undefined && parent.get(current) !== root) {
        const next = parent.get(current)!;
        parent.set(current, root);
        current = next;
      }
      return root;
    };

    const union = (x: number, y: number): void => {
      const rootX = find(x);
      const rootY = find(y);
      if (rootX !== rootY) {
        // 按较小值合并，确保组键是最小值
        const newRoot = Math.min(rootX, rootY);
        parent.set(rootX, newRoot);
        parent.set(rootY, newRoot);
      }
    };

    return { find, union };
  }

  /**
   * 使用 Union-Find 算法进行对齐分组 (11.3)
   *
   * 策略：先建立所有 tolerance 内的连接，再合并连通分量。
   * 这比 best-match 更能处理连续链式情况 (如 99, 100, 101, 102)。
   *
   * @param items - 待分组的项，包含值和元素
   * @param tolerance - 允许的误差范围
   * @returns 分组结果，键为组代表值
   */
  private groupByUnionFind(
    items: Array<{ value: number; element: IRElement }>,
    tolerance: number,
  ): Map<number, IRElement[]> {
    if (items.length === 0) {
      return new Map();
    }

    const uf = this.createUnionFind();
    const values = items.map((item) => item.value);

    // 先为所有值建立初始状态
    for (const v of values) {
      // 不需要显式初始化，union 会处理
    }

    // 建立所有 tolerance 内的连接
    // 排序后只需检查相邻元素
    const sortedValues = [...new Set(values)].sort((a, b) => a - b);

    for (let i = 0; i < sortedValues.length; i++) {
      for (let j = i + 1; j < sortedValues.length; j++) {
        const diff = sortedValues[j]! - sortedValues[i]!;
        if (diff <= tolerance) {
          uf.union(sortedValues[i]!, sortedValues[j]!);
        } else {
          // 由于已排序，后面的差值只会更大
          break;
        }
      }
    }

    // 构建分组
    const groups = new Map<number, IRElement[]>();
    for (const item of items) {
      const root = uf.find(item.value);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root)!.push(item.element);
    }

    return groups;
  }

  private createAlignmentAnnotations(
    groups: Map<number, IRElement[]>,
    alignment: "left" | "center" | "right" | "top" | "middle" | "bottom",
  ): AlignmentAnnotation[] {
    const annotations: AlignmentAnnotation[] = [];

    groups.forEach((elements, lineValue) => {
      if (elements.length >= 2) {
        const union = this.computeUnionBounds(elements.map((element) => element.bounds));
        const isVerticalLine = alignment === "left" || alignment === "center" || alignment === "right";
        const position: IRBounds = isVerticalLine
          ? {
              x: lineValue,
              y: union.y,
              width: 1,
              height: Math.max(1, union.height),
            }
          : {
              x: union.x,
              y: lineValue,
              width: Math.max(1, union.width),
              height: 1,
            };

        annotations.push({
          id: `alignment-${alignment}-${lineValue}`,
          type: "alignment",
          alignment,
          elementIds: elements.map((el) => el.id),
          position,
          value: alignment,
        });
      }
    });

    return annotations;
  }

  private computeUnionBounds(boundsList: IRBounds[]): IRBounds {
    const normalized = boundsList.filter((bounds) => bounds.width > 0 && bounds.height > 0);
    if (normalized.length === 0) {
      return { x: 0, y: 0, width: 1, height: 1 };
    }

    const minX = Math.min(...normalized.map((bounds) => bounds.x));
    const minY = Math.min(...normalized.map((bounds) => bounds.y));
    const maxX = Math.max(...normalized.map((bounds) => bounds.x + bounds.width));
    const maxY = Math.max(...normalized.map((bounds) => bounds.y + bounds.height));

    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }

  /**
   * 使用 R-tree 查找邻近元素
   */
  findNearbyElements(bounds: IRBounds, maxDistance: number = 50): IRElement[] {
    if (!this.spatialIndex) return [];

    const results = this.spatialIndex.search({
      minX: bounds.x - maxDistance,
      minY: bounds.y - maxDistance,
      maxX: bounds.x + bounds.width + maxDistance,
      maxY: bounds.y + bounds.height + maxDistance,
    });

    return results.map((r: SpatialIndexItem) => r.element);
  }
}

// ============================================
// 令牌提取器
// ============================================

function parseRgbChannels(color: string): [number, number, number] | null {
  const normalized = color.trim().toLowerCase();

  if (normalized.startsWith("#")) {
    let hex = normalized.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((char) => `${char}${char}`)
        .join("");
    }
    if (hex.length !== 6 || !/^[0-9a-f]{6}$/i.test(hex)) {
      return null;
    }

    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return [r, g, b];
  }

  const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/);
  if (!rgbMatch) {
    return null;
  }

  const channels = rgbMatch[1]
    .split(",")
    .slice(0, 3)
    .map((part) => Number.parseFloat(part.trim()))
    .filter((value) => Number.isFinite(value));

  if (channels.length !== 3) {
    return null;
  }

  return [channels[0], channels[1], channels[2]];
}

function categorizeColorFromUsage(color: string, usages: Iterable<string>): ColorToken["category"] {
  const usageList = Array.from(usages).map((usage) => usage.toLowerCase());
  if (usageList.some((usage) => usage.includes("background"))) return "background";
  if (usageList.some((usage) => usage.includes("border") || usage.includes("outline"))) return "border";
  if (usageList.some((usage) => usage === "color" || usage.includes("text") || usage.includes("font"))) return "text";

  const rgb = parseRgbChannels(color);
  if (!rgb) {
    return "accent";
  }

  const [r, g, b] = rgb;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  if (brightness >= 245) {
    return "background";
  }
  if (brightness <= 48) {
    return "text";
  }

  const isMonochrome = Math.abs(r - g) <= 12 && Math.abs(g - b) <= 12;
  if (isMonochrome) {
    return "secondary";
  }

  if (b > r && b > g) {
    return "primary";
  }

  return "accent";
}

function extractSpacingNumbers(value: unknown): number[] {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? [value] : [];
  }

  if (typeof value !== "string") {
    return [];
  }

  const matches = value.match(/-?\d*\.?\d+/g);
  if (!matches) {
    return [];
  }

  return matches.map((token) => Number.parseFloat(token)).filter((numeric) => Number.isFinite(numeric) && numeric > 0);
}

class ColorTokenExtractor {
  private colors = new Map<string, { count: number; usages: Set<string> }>();

  processElement(element: IRElement): void {
    const styles = element.styles || {};

    [
      "color",
      "backgroundColor",
      "borderColor",
      "borderTopColor",
      "borderRightColor",
      "borderBottomColor",
      "borderLeftColor",
      "textDecorationColor",
    ].forEach((prop) => {
      const value = styles[prop];
      if (typeof value === "string" && value !== "transparent" && value !== "none") {
        this.addColor(value, prop);
      }
    });
  }

  private addColor(color: string, usage: string): void {
    const normalized = this.normalizeColor(color);
    const existing = this.colors.get(normalized);
    if (existing) {
      existing.count++;
      existing.usages.add(usage);
    } else {
      this.colors.set(normalized, { count: 1, usages: new Set([usage]) });
    }
  }

  private normalizeColor(color: string): string {
    return color.toLowerCase().trim();
  }

  getTokens(): ColorToken[] {
    return Array.from(this.colors.entries())
      .map(([value, data]) => ({
        value,
        category: this.categorizeColor(value, data.usages),
        usage: Array.from(data.usages).join(", "),
        frequency: data.count,
      }))
      .sort((a, b) => b.frequency - a.frequency);
  }

  private categorizeColor(color: string, usages: Set<string>): ColorToken["category"] {
    return categorizeColorFromUsage(color, usages);
  }
}

class FontTokenExtractor {
  private fonts = new Map<string, { count: number; usages: Set<string> }>();

  processElement(element: IRElement): void {
    const styles = element.styles || {};
    const fontFamily = styles.fontFamily;
    const fontSize = styles.fontSize;
    const fontWeight = styles.fontWeight;

    if (fontFamily || fontSize || fontWeight) {
      const key = [fontFamily || "inherit", String(fontWeight || "400"), String(fontSize || "16px")].join("|");
      const existing = this.fonts.get(key);
      if (existing) {
        existing.count++;
        if (element.textContent) {
          existing.usages.add("text");
        }
      } else {
        this.fonts.set(key, {
          count: 1,
          usages: new Set([element.textContent ? "text" : "display"]),
        });
      }
    }
  }

  getTokens(): FontToken[] {
    return Array.from(this.fonts.entries())
      .map(([key, data]) => {
        const [fontFamily, fontWeight, fontSize] = key.split("|");
        return {
          fontFamily,
          fontWeight: fontWeight !== "400" ? parseInt(fontWeight) : undefined,
          fontSize: fontSize !== "16px" ? parseFloat(fontSize) : undefined,
          usage: Array.from(data.usages).join(", "),
          frequency: data.count,
        };
      })
      .sort((a, b) => b.frequency - a.frequency);
  }
}

class SpacingTokenExtractor {
  private spacing = new Map<number, { count: number; types: Set<"padding" | "margin" | "gap"> }>();

  processElement(element: IRElement): void {
    const styles = element.styles || {};
    const spacingProperties = [
      "margin",
      "marginTop",
      "marginRight",
      "marginBottom",
      "marginLeft",
      "padding",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "gap",
      "rowGap",
      "columnGap",
    ];

    spacingProperties.forEach((prop) => {
      const values = extractSpacingNumbers(styles[prop]);
      if (values.length === 0) {
        return;
      }

      const type: "padding" | "margin" | "gap" = prop.includes("padding")
        ? "padding"
        : prop.includes("margin")
          ? "margin"
          : "gap";

      values.forEach((value) => {
        this.addSpacing(value, type);
      });
    });
  }

  private addSpacing(value: number, type: "padding" | "margin" | "gap"): void {
    const normalizedValue = Math.round(value * 100) / 100;
    const existing = this.spacing.get(normalizedValue);
    if (existing) {
      existing.count++;
      existing.types.add(type);
    } else {
      this.spacing.set(normalizedValue, { count: 1, types: new Set([type]) });
    }
  }

  getTokens(): SpacingToken[] {
    return Array.from(this.spacing.entries())
      .map(([value, data]) => ({
        value,
        type: this.inferPrimaryType(data.types),
        frequency: data.count,
      }))
      .sort((a, b) => b.frequency - a.frequency);
  }

  private inferPrimaryType(types: Set<"padding" | "margin" | "gap">): "padding" | "margin" | "gap" {
    if (types.has("gap")) return "gap";
    if (types.has("padding")) return "padding";
    return "margin";
  }
}

// ============================================
// 便捷函数
// ============================================

/**
 * 便捷函数：转换 IR 到 VZI 格式
 */
export function transform(ir: IntermediateRepresentation, options: TransformOptions): TransformResult {
  const transformer = new VZITransformer(options);
  return transformer.transform(ir);
}
