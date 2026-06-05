/**
 * 四叉树空间索引
 *
 * 任务 3.19: 实现四叉树空间分块算法
 */

import type { IRBounds, IRElement } from "@vzi-core/types";
import type { SpatialBlock, QuadTreeIndex } from "./types";

/**
 * 四叉树节点
 */
interface QuadTreeNode {
  bounds: IRBounds;
  elements: string[];
  children: QuadTreeNode[] | null;
  depth: number;
  id: string;
}

/**
 * 空间索引构建器配置
 */
export interface SpatialIndexBuilderOptions {
  /** 最大深度 */
  maxDepth?: number;
  /** 每个节点的最大元素数 */
  maxElementsPerNode?: number;
  /** 最小节点尺寸 */
  minNodeSize?: number;
}

/**
 * 空间索引构建器
 */
export class SpatialIndexBuilder {
  private options: Required<SpatialIndexBuilderOptions>;
  private nodeCounter = 0;
  // 保存元素边界的引用，用于分裂时重新分配
  private elementBounds: Map<string, IRBounds> = new Map();

  constructor(options: SpatialIndexBuilderOptions = {}) {
    this.options = {
      maxDepth: 8,
      maxElementsPerNode: 50,
      minNodeSize: 10,
      ...options,
    };
  }

  /**
   * 从元素集合构建四叉树空间索引
   */
  build(elements: Map<string, IRElement>): QuadTreeIndex {
    this.nodeCounter = 0;
    this.elementBounds.clear();

    // 保存所有元素的边界
    for (const [id, element] of elements) {
      this.elementBounds.set(id, element.bounds);
    }

    // 计算整体边界
    const rootBounds = this.calculateRootBounds(elements);

    // 创建根节点
    const root: QuadTreeNode = {
      bounds: rootBounds,
      elements: [],
      children: null,
      depth: 0,
      id: this.generateNodeId(),
    };

    // 插入所有元素
    for (const [id, element] of elements) {
      this.insert(root, id, element.bounds);
    }

    // 转换为索引格式
    const blocks = new Map<string, SpatialBlock>();
    this.convertToBlocks(root, blocks);

    return {
      rootBlockId: root.id,
      blocks,
      maxDepth: this.options.maxDepth,
    };
  }

  /**
   * 计算根节点边界
   */
  private calculateRootBounds(elements: Map<string, IRElement>): IRBounds {
    if (elements.size === 0) {
      return { x: 0, y: 0, width: 1000, height: 1000 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const element of elements.values()) {
      const b = element.bounds;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }

    // 添加边距
    const padding = 10;
    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    };
  }

  /**
   * 插入元素到四叉树
   */
  private insert(node: QuadTreeNode, elementId: string, elementBounds: IRBounds): void {
    // 如果有子节点，尝试插入到子节点
    if (node.children) {
      for (const child of node.children) {
        if (this.contains(child.bounds, elementBounds)) {
          this.insert(child, elementId, elementBounds);
          return;
        }
      }
    }

    // 添加到当前节点
    node.elements.push(elementId);

    // 检查是否需要分裂
    if (
      node.elements.length > this.options.maxElementsPerNode &&
      node.depth < this.options.maxDepth &&
      this.canSplit(node)
    ) {
      this.split(node);
    }
  }

  /**
   * 检查边界是否包含另一个边界
   */
  private contains(outer: IRBounds, inner: IRBounds): boolean {
    return (
      inner.x >= outer.x &&
      inner.y >= outer.y &&
      inner.x + inner.width <= outer.x + outer.width &&
      inner.y + inner.height <= outer.y + outer.height
    );
  }

  /**
   * 检查边界是否相交
   */
  intersects(a: IRBounds, b: IRBounds): boolean {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  /**
   * 检查是否可以分裂
   */
  private canSplit(node: QuadTreeNode): boolean {
    return node.bounds.width >= this.options.minNodeSize * 2 && node.bounds.height >= this.options.minNodeSize * 2;
  }

  /**
   * 分裂节点
   */
  private split(node: QuadTreeNode): void {
    const { x, y, width, height } = node.bounds;
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    // 创建四个子节点
    node.children = [
      // 左上
      {
        bounds: { x, y, width: halfWidth, height: halfHeight },
        elements: [],
        children: null,
        depth: node.depth + 1,
        id: this.generateNodeId(),
      },
      // 右上
      {
        bounds: { x: x + halfWidth, y, width: halfWidth, height: halfHeight },
        elements: [],
        children: null,
        depth: node.depth + 1,
        id: this.generateNodeId(),
      },
      // 左下
      {
        bounds: { x, y: y + halfHeight, width: halfWidth, height: halfHeight },
        elements: [],
        children: null,
        depth: node.depth + 1,
        id: this.generateNodeId(),
      },
      // 右下
      {
        bounds: { x: x + halfWidth, y: y + halfHeight, width: halfWidth, height: halfHeight },
        elements: [],
        children: null,
        depth: node.depth + 1,
        id: this.generateNodeId(),
      },
    ];

    // 重新分配现有元素到子节点
    const elements = [...node.elements];
    node.elements = [];

    for (const elementId of elements) {
      const bounds = this.elementBounds.get(elementId);
      if (!bounds) {
        // 如果找不到边界，保留在当前节点
        node.elements.push(elementId);
        continue;
      }

      // 尝试将元素分配到子节点
      let assigned = false;
      for (const child of node.children) {
        if (this.contains(child.bounds, bounds)) {
          child.elements.push(elementId);
          assigned = true;
          break;
        }
      }

      // 如果元素不完全包含在任何子节点中，保留在父节点
      if (!assigned) {
        node.elements.push(elementId);
      }
    }
  }

  /**
   * 生成节点 ID
   */
  private generateNodeId(): string {
    return `spatial_${this.nodeCounter++}`;
  }

  /**
   * 转换为块格式
   */
  private convertToBlocks(node: QuadTreeNode, blocks: Map<string, SpatialBlock>): void {
    const block: SpatialBlock = {
      id: node.id,
      bounds: node.bounds,
      elementIds: node.elements,
      depth: node.depth,
    };

    if (node.children) {
      block.children = node.children.map((c) => c.id);
      for (const child of node.children) {
        this.convertToBlocks(child, blocks);
      }
    }

    blocks.set(node.id, block);
  }

  /**
   * 查询指定区域内的元素
   */
  query(index: QuadTreeIndex, queryBounds: IRBounds): string[] {
    const root = index.blocks.get(index.rootBlockId);
    if (!root) {
      return [];
    }

    const results: string[] = [];
    this.queryRecursive(root, queryBounds, index.blocks, results);
    return results;
  }

  /**
   * 递归查询
   */
  private queryRecursive(
    block: SpatialBlock,
    queryBounds: IRBounds,
    blocks: Map<string, SpatialBlock>,
    results: string[],
  ): void {
    // 检查是否相交
    if (!this.intersects(block.bounds, queryBounds)) {
      return;
    }

    // 添加当前块的元素
    results.push(...block.elementIds);

    // 递归查询子块
    if (block.children) {
      for (const childId of block.children) {
        const childBlock = blocks.get(childId);
        if (childBlock) {
          this.queryRecursive(childBlock, queryBounds, blocks, results);
        }
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStats(index: QuadTreeIndex): {
    totalBlocks: number;
    totalElements: number;
    avgElementsPerBlock: number;
    maxDepth: number;
  } {
    let totalElements = 0;
    let maxDepthFound = 0;

    for (const block of index.blocks.values()) {
      totalElements += block.elementIds.length;
      maxDepthFound = Math.max(maxDepthFound, block.depth);
    }

    return {
      totalBlocks: index.blocks.size,
      totalElements,
      avgElementsPerBlock: index.blocks.size > 0 ? totalElements / index.blocks.size : 0,
      maxDepth: maxDepthFound,
    };
  }
}
