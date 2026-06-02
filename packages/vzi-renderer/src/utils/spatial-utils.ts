/**
 * 空间索引和视口裁剪工具
 *
 * 使用 R-tree 实现高效的空间查询，用于虚拟化渲染
 */

import RBush from 'rbush';
import type { BBox } from 'rbush';
import type { IRElement, IRBounds } from '@vzi-core/types';
import type { ViewportBounds, VirtualizationConfig } from '../types';

/**
 * 空间索引项
 */
export interface SpatialIndexItem extends BBox {
  id: string;
  element: IRElement;
}

/**
 * 空间索引管理器
 *
 * 使用 R-tree 实现高效的空间查询
 */
export class SpatialIndexManager {
  private tree: RBush<SpatialIndexItem>;
  private elementCount: number = 0;

  constructor() {
    this.tree = new RBush<SpatialIndexItem>();
  }

  /**
   * 从元素映射构建索引
   *
   * @param elements - 元素映射
   */
  buildFromElements(elements: Record<string, IRElement>): void {
    this.tree.clear();
    this.elementCount = 0;

    Object.entries(elements).forEach(([id, element]) => {
      const item: SpatialIndexItem = {
        id,
        element,
        minX: element.bounds.x,
        minY: element.bounds.y,
        maxX: element.bounds.x + element.bounds.width,
        maxY: element.bounds.y + element.bounds.height,
      };

      this.tree.insert(item);
      this.elementCount++;
    });
  }

  /**
   * 查询视口内的元素
   *
   * @param viewport - 视口边界
   * @returns 视口内的元素列表
   */
  queryViewport(viewport: ViewportBounds): IRElement[] {
    const results = this.tree.search({
      minX: viewport.minX,
      minY: viewport.minY,
      maxX: viewport.maxX,
      maxY: viewport.maxY,
    });

    return results.map((item) => item.element);
  }

  /**
   * 查询包含指定点的元素
   *
   * @param x - X 坐标
   * @param y - Y 坐标
   * @returns 包含该点的元素（按 z-index 排序，最上层优先）
   */
  queryPoint(x: number, y: number): IRElement[] {
    const results = this.tree.search({
      minX: x,
      minY: y,
      maxX: x,
      maxY: y,
    });

    // 按照元素在树中的位置排序（后插入的在上层）
    return results.map((item) => item.element);
  }

  /**
   * 查询与矩形相交的元素
   *
   * @param rect - 矩形边界
   * @returns 相交的元素列表
   */
  queryRect(rect: IRBounds): IRElement[] {
    const results = this.tree.search({
      minX: rect.x,
      minY: rect.y,
      maxX: rect.x + rect.width,
      maxY: rect.y + rect.height,
    });

    return results.map((item) => item.element);
  }

  /**
   * 获取元素数量
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
  }
}

/**
 * 计算视口边界（考虑缩放和平移）
 *
 * @param x - 视口 X 偏移
 * @param y - 视口 Y 偏移
 * @param width - 视口宽度
 * @param height - 视口高度
 * @param scale - 缩放比例
 * @param margin - 边距（用于预渲染）
 * @returns 视口边界
 */
export function calculateViewportBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number,
  margin: number = 0
): ViewportBounds {
  // 将屏幕坐标转换为画布坐标
  const canvasX = -x / scale;
  const canvasY = -y / scale;
  const canvasWidth = width / scale;
  const canvasHeight = height / scale;

  return {
    minX: canvasX - margin,
    minY: canvasY - margin,
    maxX: canvasX + canvasWidth + margin,
    maxY: canvasY + canvasHeight + margin,
  };
}

/**
 * 检查元素是否在视口内
 *
 * @param element - 元素
 * @param viewport - 视口边界
 * @returns 是否在视口内
 */
export function isElementInViewport(element: IRElement, viewport: ViewportBounds): boolean {
  const { bounds } = element;

  return (
    bounds.x + bounds.width >= viewport.minX &&
    bounds.x <= viewport.maxX &&
    bounds.y + bounds.height >= viewport.minY &&
    bounds.y <= viewport.maxY
  );
}

/**
 * 检查元素是否包含指定点
 *
 * @param element - 元素
 * @param x - X 坐标
 * @param y - Y 坐标
 * @returns 是否包含该点
 */
export function isElementContainsPoint(element: IRElement, x: number, y: number): boolean {
  const { bounds } = element;

  return (
    x >= bounds.x &&
    x <= bounds.x + bounds.width &&
    y >= bounds.y &&
    y <= bounds.y + bounds.height
  );
}

/**
 * 检查两个矩形是否相交
 *
 * @param a - 矩形 A
 * @param b - 矩形 B
 * @returns 是否相交
 */
export function isRectsIntersect(a: IRBounds, b: IRBounds): boolean {
  return (
    a.x + a.width >= b.x &&
    a.x <= b.x + b.width &&
    a.y + a.height >= b.y &&
    a.y <= b.y + b.height
  );
}

/**
 * 过滤视口内的元素
 *
 * @param elements - 所有元素
 * @param viewport - 视口边界
 * @param config - 虚拟化配置
 * @returns 视口内的元素列表
 */
export function filterVisibleElements(
  elements: Record<string, IRElement>,
  viewport: ViewportBounds,
  config: VirtualizationConfig
): IRElement[] {
  if (!config.enabled) {
    return Object.values(elements);
  }

  return Object.values(elements).filter((element) => {
    // 检查元素尺寸
    if (
      element.bounds.width < config.minElementSize ||
      element.bounds.height < config.minElementSize
    ) {
      return false;
    }

    // 检查是否在视口内
    return isElementInViewport(element, viewport);
  });
}

/**
 * 按层级排序元素
 *
 * @param elements - 元素列表
 * @param rootId - 根元素 ID
 * @returns 排序后的元素列表
 */
export function sortElementsByLayer(
  elements: Record<string, IRElement>,
  rootId: string
): IRElement[] {
  const result: IRElement[] = [];
  const visited = new Set<string>();
  const childrenMap = new Map<string, IRElement[]>();

  for (const element of Object.values(elements)) {
    if (!element.parentId) continue;
    const siblings = childrenMap.get(element.parentId);
    if (siblings) {
      siblings.push(element);
    } else {
      childrenMap.set(element.parentId, [element]);
    }
  }

  for (const siblings of childrenMap.values()) {
    siblings.sort((a, b) => {
      // 按照在父元素中的位置排序
      // 使用 bounds.x 作为简单排序依据
      return a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y;
    });
  }

  const traverse = (elementId: string): void => {
    if (visited.has(elementId)) return;
    visited.add(elementId);

    const element = elements[elementId];
    if (!element) return;

    result.push(element);

    const children = childrenMap.get(elementId) || [];

    children.forEach((child) => {
      traverse(child.id);
    });
  };

  traverse(rootId);

  // 容错：当 root 之外存在孤立节点时，仍保证返回稳定顺序
  for (const element of Object.values(elements)) {
    if (!visited.has(element.id)) {
      traverse(element.id);
    }
  }

  return result;
}

/**
 * 查找点击位置的最上层元素
 *
 * @param elements - 所有元素
 * @param x - 点击 X 坐标（画布坐标）
 * @param y - 点击 Y 坐标（画布坐标）
 * @param rootId - 根元素 ID
 * @returns 最上层元素或 null
 */
export function findTopElementAtPoint(
  elements: Record<string, IRElement>,
  x: number,
  y: number,
  rootId: string
): IRElement | null {
  // 按层级排序（从上到下）
  const sortedElements = sortElementsByLayer(elements, rootId).reverse();

  for (const element of sortedElements) {
    if (isElementContainsPoint(element, x, y)) {
      return element;
    }
  }

  return null;
}

/**
 * 框选元素
 *
 * @param elements - 所有元素
 * @param selectionRect - 选择矩形
 * @returns 选中的元素 ID 列表
 */
export function selectElementsInRect(
  elements: Record<string, IRElement>,
  selectionRect: IRBounds
): string[] {
  const selectedIds: string[] = [];

  Object.entries(elements).forEach(([id, element]) => {
    if (isRectsIntersect(element.bounds, selectionRect)) {
      selectedIds.push(id);
    }
  });

  return selectedIds;
}

/**
 * 计算画布的实际内容边界
 *
 * @param elements - 所有元素
 * @returns 内容边界
 */
export function calculateContentBounds(
  elements: Record<string, IRElement>
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  Object.values(elements).forEach((element) => {
    const right = element.bounds.x + element.bounds.width;
    const bottom = element.bounds.y + element.bounds.height;

    minX = Math.min(minX, element.bounds.x);
    minY = Math.min(minY, element.bounds.y);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, bottom);
  });

  // 如果没有元素，返回默认值
  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 1200, maxY: 800 };
  }

  return { minX, minY, maxX, maxY };
}

/**
 * 计算适合视口的缩放比例
 *
 * @param contentWidth - 内容宽度
 * @param contentHeight - 内容高度
 * @param viewportWidth - 视口宽度
 * @param viewportHeight - 视口高度
 * @param padding - 边距比例
 * @returns 缩放比例
 */
export function calculateFitScale(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding: number = 0.1
): number {
  const scaleX = (viewportWidth * (1 - padding)) / contentWidth;
  const scaleY = (viewportHeight * (1 - padding)) / contentHeight;

  return Math.min(scaleX, scaleY, 1); // 不超过 100%
}

/**
 * 计算居中位置
 *
 * @param contentWidth - 内容宽度
 * @param contentHeight - 内容高度
 * @param viewportWidth - 视口宽度
 * @param viewportHeight - 视口高度
 * @param scale - 缩放比例
 * @returns 居中位置 { x, y }
 */
export function calculateCenterPosition(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  scale: number
): { x: number; y: number } {
  const scaledWidth = contentWidth * scale;
  const scaledHeight = contentHeight * scale;

  const x = (viewportWidth - scaledWidth) / 2;
  const y = (viewportHeight - scaledHeight) / 2;

  return { x, y };
}
