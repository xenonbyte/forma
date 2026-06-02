/**
 * 命中测试空间索引 (M6)
 *
 * 使用 RBush R-tree 实现高效的点击测试，替代 O(n) 线性扫描。
 */

import RBush from 'rbush';
import type { BBox } from 'rbush';
import type { IRElement } from './renderers/types';

/**
 * 空间索引项
 */
export interface HitTestItem extends BBox {
  id: string;
  element: IRElement;
  /** 元素在渲染顺序中的索引 */
  renderOrder: number;
}

/**
 * 命中测试结果
 */
export interface HitTestResult {
  element: IRElement;
  renderOrder: number;
}

/**
 * 解析 zIndex 数值
 */
function parseZIndex(value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

/**
 * 计算元素的渲染顺序索引
 *
 * 遍历扁平化元素列表，为每个元素分配一个基于渲染顺序的索引。
 * 后出现的元素渲染在上层（更大的 renderOrder）。
 */
function computeRenderOrder(flatElements: IRElement[]): Map<string, number> {
  const orderMap = new Map<string, number>();

  // 按 zIndex, y, x 排序（与 render-order.ts 保持一致）
  const sorted = [...flatElements].sort((a, b) => {
    const aZ = parseZIndex(a.styles.zIndex);
    const bZ = parseZIndex(b.styles.zIndex);
    if (aZ !== bZ) return aZ - bZ;
    if (a.bounds.y !== b.bounds.y) return a.bounds.y - b.bounds.y;
    if (a.bounds.x !== b.bounds.x) return a.bounds.x - b.bounds.x;
    return a.id.localeCompare(b.id);
  });

  sorted.forEach((element, index) => {
    orderMap.set(element.id, index);
  });

  return orderMap;
}

/**
 * 命中测试空间索引管理器
 *
 * 使用 R-tree 实现高效的点击测试
 */
export class HitTestIndex {
  private tree: RBush<HitTestItem>;
  private elementCount: number = 0;
  private orderMap: Map<string, number> = new Map();

  constructor() {
    this.tree = new RBush<HitTestItem>();
  }

  /**
   * 从扁平化元素列表构建索引
   *
   * @param flatElements - 扁平化的元素列表
   */
  build(flatElements: IRElement[]): void {
    this.tree.clear();
    this.elementCount = 0;
    this.orderMap = computeRenderOrder(flatElements);

    for (const element of flatElements) {
      const { bounds, id } = element;

      // 跳过无有效边界的元素
      if (
        !Number.isFinite(bounds.x) ||
        !Number.isFinite(bounds.y) ||
        !Number.isFinite(bounds.width) ||
        !Number.isFinite(bounds.height) ||
        bounds.width <= 0 ||
        bounds.height <= 0
      ) {
        continue;
      }

      const renderOrder = this.orderMap.get(id) ?? 0;

      const item: HitTestItem = {
        id,
        element,
        renderOrder,
        minX: bounds.x,
        minY: bounds.y,
        maxX: bounds.x + bounds.width,
        maxY: bounds.y + bounds.height,
      };

      this.tree.insert(item);
      this.elementCount++;
    }
  }

  /**
   * 查询包含指定点的最上层元素
   *
   * @param x - 世界坐标 X
   * @param y - 世界坐标 Y
   * @returns 最上层元素或 null
   */
  queryTopElementAtPoint(x: number, y: number): IRElement | null {
    // RBush 的 search 需要一个 bbox，我们用点作为 bbox
    const candidates = this.tree.search({
      minX: x,
      minY: y,
      maxX: x,
      maxY: y,
    });

    if (candidates.length === 0) {
      return null;
    }

    // 按 renderOrder 降序排序，取最上层元素
    candidates.sort((a, b) => b.renderOrder - a.renderOrder);

    return candidates[0]?.element ?? null;
  }

  /**
   * 查询包含指定点的所有元素
   *
   * @param x - 世界坐标 X
   * @param y - 世界坐标 Y
   * @returns 按渲染顺序排序的元素列表（上层在前）
   */
  queryAllElementsAtPoint(x: number, y: number): HitTestResult[] {
    const candidates = this.tree.search({
      minX: x,
      minY: y,
      maxX: x,
      maxY: y,
    });

    // 按 renderOrder 降序排序
    candidates.sort((a, b) => b.renderOrder - a.renderOrder);

    return candidates.map((item) => ({
      element: item.element,
      renderOrder: item.renderOrder,
    }));
  }

  /**
   * 获取索引中的元素数量
   */
  size(): number {
    return this.elementCount;
  }

  /**
   * 清空索引
   */
  clear(): void {
    this.tree.clear();
    this.elementCount = 0;
    this.orderMap.clear();
  }

  /**
   * 检查索引是否已构建
   */
  isReady(): boolean {
    return this.elementCount > 0;
  }
}

/**
 * 创建命中测试索引实例
 */
export function createHitTestIndex(): HitTestIndex {
  return new HitTestIndex();
}
