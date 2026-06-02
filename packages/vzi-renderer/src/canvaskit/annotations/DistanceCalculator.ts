/**
 * 距离计算器
 *
 * 移植自 heron-handoff 的 calculateMarkData 算法
 * 计算两个元素之间的距离标注数据
 */

import type {
  ElementBounds,
  PageRect,
  DistanceData,
  RulerData,
  CalculationResult,
} from './types';

// ============================================
// 辅助函数
// ============================================

/**
 * 对四个数字进行排序
 * @param numbers - 四个数字的数组
 * @returns 排序后的数组
 */
export function getSortedNumbers(numbers: number[]): number[] {
  if (numbers.length !== 4) return [];
  return [...numbers].sort((a, b) => a - b);
}

/**
 * 获取四个数字中的中间两个
 * @param numbers - 四个数字的数组
 * @returns 中间两个数字
 */
export function getMidNumbers(numbers: number[]): number[] {
  return getSortedNumbers(numbers).slice(1, 3);
}

/**
 * 计算数组平均值
 * @param numbers - 数字数组
 * @returns 平均值
 */
export function getAverage(numbers: number[]): number {
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

/**
 * 判断两个矩形是否相交
 * @param rect1 - 第一个矩形
 * @param rect2 - 第二个矩形
 * @returns 是否相交
 */
export function isIntersect(
  rect1: ElementBounds,
  rect2: ElementBounds
): boolean {
  return !(
    rect1.right <= rect2.left ||
    rect1.left >= rect2.right ||
    rect1.top >= rect2.bottom ||
    rect1.bottom <= rect2.top
  );
}

/**
 * 获取两个元素的相对位置
 * @param selected - 选中元素
 * @param target - 目标元素
 * @returns 相对位置信息
 */
export function getPosition(
  selected: ElementBounds,
  target: ElementBounds
): {
  v?: [number, number]; // [距离, 方向: 0=目标在上, 1=选中在上]
  h?: [number, number]; // [距离, 方向: 0=目标在左, 1=选中在左]
} {
  const position: { v?: [number, number]; h?: [number, number] } = {};

  // 垂直方向：选中元素在目标元素上方或下方
  if (selected.top >= target.bottom) {
    // 选中元素在目标元素下方
    position.v = [selected.top - target.bottom, 1];
  }
  if (target.top >= selected.bottom) {
    // 目标元素在选中元素下方
    position.v = [target.top - selected.bottom, 0];
  }

  // 水平方向：选中元素在目标元素左侧或右侧
  if (selected.left >= target.right) {
    // 选中元素在目标元素右侧
    position.h = [selected.left - target.right, 1];
  }
  if (target.left >= selected.right) {
    // 目标元素在选中元素右侧
    position.h = [target.left - selected.right, 0];
  }

  return position;
}

// ============================================
// 内部辅助函数
// ============================================

/**
 * 获取数字分组（平行和相交方向）
 */
function getNums(
  direction: 'v' | 'h',
  verticalNums: number[],
  horizontalNums: number[]
): {
  parallel: number[];
  intersect: number[];
} {
  return direction === 'v'
    ? {
        parallel: [...verticalNums],
        intersect: [...horizontalNums],
      }
    : {
        parallel: [...horizontalNums],
        intersect: [...verticalNums],
      };
}

/**
 * 对数字对象进行排序
 */
function getOrderedNums(nums: {
  parallel: number[];
  intersect: number[];
}): {
  parallel: number[];
  intersect: number[];
} {
  return {
    parallel: getSortedNumbers(nums.parallel),
    intersect: getSortedNumbers(nums.intersect),
  };
}

/**
 * 获取中间索引
 */
function getMidIndex(
  intersectNums: number[],
  closerIndex: number
): [number, number] {
  const flag = closerIndex === 0 ? 1 : -1;
  return [
    (intersectNums[0] - intersectNums[2]) * flag > 0 ? 0 : 1,
    (intersectNums[1] - intersectNums[3]) * flag > 0 ? 1 : 0,
  ];
}

/**
 * 获取平行方向间距
 */
function getParallelSpacing(parallelNums: number[]): number {
  return parallelNums[2] - parallelNums[1];
}

/**
 * 获取边距
 */
function getMargin(intersectNums: number[], whichOne: 'smaller' | 'larger'): number {
  return whichOne === 'smaller'
    ? intersectNums[1] - intersectNums[0]
    : intersectNums[3] - intersectNums[2];
}

// ============================================
// 主计算函数
// ============================================

/**
 * 计算两个元素之间的距离标注数据
 *
 * @param selected - 选中元素的边界信息
 * @param target - 目标（悬停）元素的边界信息
 * @param pageRect - 页面/画布尺寸
 * @returns 距离数据和标尺数据
 */
export function calculateMarkData(
  selected: ElementBounds | null,
  target: ElementBounds,
  pageRect: PageRect
): CalculationResult {
  // 如果没有选中元素或者是同一个元素，返回空
  if (!selected || (selected.left === target.left && selected.top === target.top)) {
    return { distanceData: [], rulerData: [] };
  }

  const pw = pageRect.width;
  const ph = pageRect.height;

  const selectedMidX = selected.left + selected.width / 2;
  const selectedMidY = selected.top + selected.height / 2;

  const verticalNums = [
    selected.top,
    selected.bottom,
    target.top,
    target.bottom,
  ];
  const horizontalNums = [
    selected.left,
    selected.right,
    target.left,
    target.right,
  ];

  const distanceData: DistanceData[] = [];
  const rulerData: RulerData[] = [];

  // 判断是否相交
  if (!isIntersect(selected, target)) {
    // 不相交的情况
    const position = getPosition(selected, target);

    if (position.v && position.h && position.v[0] > 0 && position.h[0] > 0) {
      // 对角线方向，不相交
      const spacingV = position.v[0];
      const spacingH = position.h[0];
      const selectedIsCloserV = position.v[1] === 0;
      const selectedIsCloserH = position.h[1] === 0;

      // 水平距离标注
      distanceData.push({
        x: (selectedIsCloserH ? selected.right : target.right) / pw,
        y: selectedMidY / ph,
        w: spacingH / pw,
        distance: Math.round(spacingH * 100) / 100,
      });

      // 垂直距离标注
      distanceData.push({
        x: selectedMidX / pw,
        y: (selectedIsCloserV ? selected.bottom : target.bottom) / ph,
        h: spacingV / ph,
        distance: Math.round(spacingV * 100) / 100,
      });

      // 标尺线
      rulerData.push({
        x: (selectedIsCloserH ? selectedMidX : target.right) / pw,
        y: (selectedIsCloserV ? target.top : target.bottom) / ph,
        w: (selected.width / 2 + spacingH) / pw,
        distance: Math.round((selected.width / 2 + spacingH) * 100) / 100,
      });

      rulerData.push({
        x: (selectedIsCloserH ? target.left : target.right) / pw,
        y: (selectedIsCloserV ? selectedMidY : target.bottom) / ph,
        h: (selected.height / 2 + spacingV) / ph,
        distance: Math.round((selected.height / 2 + spacingV) * 100) / 100,
      });
    } else if (
      position.v &&
      position.h &&
      (position.v[0] === 0 || position.h[0] === 0)
    ) {
      // 相交于一点
      if (position.v[0] === 0 && position.h[0] === 0) {
        const sortedVNumbers = getSortedNumbers(verticalNums);
        const sortedHNumbers = getSortedNumbers(horizontalNums);
        const edges = [
          sortedVNumbers[0],
          sortedVNumbers[3],
          sortedHNumbers[0],
          sortedHNumbers[3],
        ];
        const mids = [sortedVNumbers[1], sortedHNumbers[1]];

        const isBackslashed = position.v[1] === position.h[1];

        edges.forEach((edge, index) => {
          let unfixedNum: number;
          let d: number;
          const flag = index % 2 === 0 ? isBackslashed : !isBackslashed;

          if (index < 2) {
            unfixedNum = flag ? mids[1] : edges[3];
            d = flag ? edges[3] - mids[1] : mids[1] - edges[2];
          } else {
            unfixedNum = flag ? mids[0] : edges[0];
            d = flag ? edges[1] - mids[0] : mids[0] - edges[0];
          }

          distanceData.push({
            x: (index < 2 ? unfixedNum : edge) / pw,
            y: (index < 2 ? edge : unfixedNum) / ph,
            [index < 2 ? 'w' : 'h']: d / (index < 2 ? pw : ph),
            distance: Math.round(d * 100) / 100,
          } as DistanceData);
        });
      } else {
        const direction = position.v![0] !== 0 ? 'v' : 'h';
        const nums = getNums(direction, verticalNums, horizontalNums);
        const posData = position[direction]!;

        distanceData.push({
          x:
            direction === 'v'
              ? nums.intersect[1] / pw
              : nums.parallel[1] / pw,
          y:
            direction === 'v'
              ? nums.parallel[1] / ph
              : nums.intersect[1] / ph,
          [direction === 'v' ? 'h' : 'w']:
            posData[0] / (direction === 'v' ? ph : pw),
          distance: Math.round(posData[0] * 100) / 100,
        } as DistanceData);
      }
    } else {
      // 只在一个方向不相交（平行方向）
      const direction = position.v ? 'v' : 'h';
      const closerIndex = position[direction]![1];
      const nums = getNums(direction, verticalNums, horizontalNums);
      const orderedNums = getOrderedNums(nums);
      const mids = [
        getAverage(orderedNums.parallel.slice(0, 2)),
        getAverage(orderedNums.parallel.slice(2)),
      ];
      const midIndex = getMidIndex(nums.intersect, closerIndex);
      const parallelSpacing = getParallelSpacing(orderedNums.parallel);
      const margins = [
        getMargin(orderedNums.intersect, 'smaller'),
        getMargin(orderedNums.intersect, 'larger'),
      ];

      // 平行方向间距
      if (parallelSpacing !== 0) {
        distanceData.push({
          x:
            direction === 'v'
              ? getAverage(orderedNums.intersect.slice(1, 3)) / pw
              : orderedNums.parallel[1] / pw,
          y:
            direction === 'v'
              ? orderedNums.parallel[1] / ph
              : getAverage(orderedNums.intersect.slice(1, 3)) / ph,
          [direction === 'v' ? 'h' : 'w']:
            parallelSpacing / (direction === 'v' ? ph : pw),
          distance: Math.round(parallelSpacing * 100) / 100,
        } as DistanceData);
      }

      // 边距标注
      margins.forEach((margin, index) => {
        if (margin !== 0) {
          // rulerUnfixedStart 用于后续扩展，当前保留
          const _rulerUnfixedStart =
            midIndex[index] === 0 ? mids[0] : orderedNums.parallel[1];

          distanceData.push({
            x:
              (direction === 'v'
                ? orderedNums.intersect[index * 2]
                : mids[midIndex[index]]) / pw,
            y:
              (direction === 'v'
                ? mids[midIndex[index]]
                : orderedNums.intersect[index * 2]) / ph,
            [direction === 'v' ? 'w' : 'h']:
              margin / (direction === 'v' ? pw : ph),
            distance: Math.round(margin * 100) / 100,
          } as DistanceData);
        }
      });
    }
  } else {
    // 相交的情况
    const sortedVNumbers = getSortedNumbers(verticalNums);
    const sortedHNumbers = getSortedNumbers(horizontalNums);
    const x = getAverage(getMidNumbers(sortedHNumbers));
    const y = getAverage(getMidNumbers(sortedVNumbers));

    // 上方间距
    if (sortedVNumbers[1] - sortedVNumbers[0] !== 0) {
      distanceData.push({
        x: x / pw,
        y: sortedVNumbers[0] / ph,
        h: (sortedVNumbers[1] - sortedVNumbers[0]) / ph,
        distance: Math.round((sortedVNumbers[1] - sortedVNumbers[0]) * 100) / 100,
      });
    }

    // 下方间距
    if (sortedVNumbers[3] - sortedVNumbers[2] !== 0) {
      distanceData.push({
        x: x / pw,
        y: sortedVNumbers[2] / ph,
        h: (sortedVNumbers[3] - sortedVNumbers[2]) / ph,
        distance: Math.round((sortedVNumbers[3] - sortedVNumbers[2]) * 100) / 100,
      });
    }

    // 左侧间距
    if (sortedHNumbers[1] - sortedHNumbers[0] !== 0) {
      distanceData.push({
        x: sortedHNumbers[0] / pw,
        y: y / ph,
        w: (sortedHNumbers[1] - sortedHNumbers[0]) / pw,
        distance: Math.round((sortedHNumbers[1] - sortedHNumbers[0]) * 100) / 100,
      });
    }

    // 右侧间距
    if (sortedHNumbers[3] - sortedHNumbers[2] !== 0) {
      distanceData.push({
        x: sortedHNumbers[2] / pw,
        y: y / ph,
        w: (sortedHNumbers[3] - sortedHNumbers[2]) / pw,
        distance: Math.round((sortedHNumbers[3] - sortedHNumbers[2]) * 100) / 100,
      });
    }
  }

  return { distanceData, rulerData };
}
