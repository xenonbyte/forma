/**
 * 标注样式系统
 *
 * 提供可配置的样式管理，支持深度合并和验证
 */

import type {
  AnnotationStyleConfig,
  PartialAnnotationStyleConfig,
  AnnotationTheme,
  DistanceStyle,
  RulerStyle,
  SelectionStyle,
  HoverStyle,
} from './types';

// ============================================
// 默认样式配置
// ============================================

/**
 * 默认标注样式
 *
 * 颜色方案参考 heron-handoff
 */
export const DEFAULT_ANNOTATION_STYLES: AnnotationStyleConfig = {
  distance: {
    strokeColor: '#ff3366', // 红色 - 标注线颜色
    strokeWidth: 1,
    labelBackgroundColor: '#ff3366', // 红色 - 标签背景
    labelTextColor: '#ffffff',
    labelFontSize: 12,
    labelBorderRadius: 2,
    labelPadding: [6, 2],
  },
  ruler: {
    strokeColor: '#FF3366', // 粉红色
    strokeWidth: 1,
    dashArray: [4, 2],
    opacity: 1,
  },
  selection: {
    strokeColor: '#2ca7fb', // 蓝色 - 选中框
    strokeWidth: 1,
    fillOpacity: 0.1,
    // 尺寸标签配置
    dimensionLabelBgColor: '#2ca7fb', // 蓝色 - 与选中框边框色一致
    dimensionLabelTextColor: '#ffffff', // 白色
    dimensionLabelFontSize: 12,
    dimensionLabelBorderRadius: 4,
    dimensionLabelPadding: [8, 4],
    showDimensionLabel: true,
  },
  hover: {
    strokeColor: '#ff3366', // 红色 - 悬停框
    strokeWidth: 1,
    fillOpacity: 0, // 无填充
  },
};

export function buildAnnotationStylesFromTheme(theme?: AnnotationTheme): PartialAnnotationStyleConfig | undefined {
  if (!theme) {
    return undefined;
  }

  const styles: PartialAnnotationStyleConfig = {};

  if (theme.selectionColor || theme.selectionStrokeWidth !== undefined) {
    styles.selection = {};
    if (theme.selectionColor) {
      styles.selection.strokeColor = theme.selectionColor;
      styles.selection.dimensionLabelBgColor = theme.selectionColor;
    }
    if (theme.selectionStrokeWidth !== undefined) {
      styles.selection.strokeWidth = theme.selectionStrokeWidth;
    }
  }

  if (theme.hoverColor || theme.hoverStrokeWidth !== undefined) {
    styles.hover = {};
    styles.distance = {};
    styles.ruler = {};

    if (theme.hoverColor) {
      styles.hover.strokeColor = theme.hoverColor;
      styles.distance.strokeColor = theme.hoverColor;
      styles.distance.labelBackgroundColor = theme.hoverColor;
      styles.ruler.strokeColor = theme.hoverColor;
    }

    if (theme.hoverStrokeWidth !== undefined) {
      styles.hover.strokeWidth = theme.hoverStrokeWidth;
      styles.distance.strokeWidth = theme.hoverStrokeWidth;
      styles.ruler.strokeWidth = theme.hoverStrokeWidth;
    }
  }

  return Object.keys(styles).length > 0 ? styles : undefined;
}

// ============================================
// 样式验证
// ============================================

/**
 * 验证颜色格式
 * 支持格式: #RGB, #RRGGBB, #RRGGBBAA, rgb(), rgba()
 *
 * @param color - 颜色字符串
 * @returns 是否有效
 */
function isValidColor(color: string): boolean {
  if (!color || typeof color !== 'string') {
    return false;
  }

  // 匹配十六进制颜色
  const hexPattern = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

  // 匹配 rgb/rgba 颜色
  const rgbPattern = /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/;

  return hexPattern.test(color) || rgbPattern.test(color);
}

/**
 * 验证样式配置中的颜色
 *
 * @param config - 样式配置
 * @returns 验证结果和警告信息
 */
function validateStyles(config: PartialAnnotationStyleConfig): string[] {
  const warnings: string[] = [];

  // 验证 distance 样式
  if (config.distance) {
    if (config.distance.strokeColor && !isValidColor(config.distance.strokeColor)) {
      warnings.push(`distance.strokeColor "${config.distance.strokeColor}" 不是有效的颜色值`);
    }
    if (config.distance.labelBackgroundColor && !isValidColor(config.distance.labelBackgroundColor)) {
      warnings.push(`distance.labelBackgroundColor "${config.distance.labelBackgroundColor}" 不是有效的颜色值`);
    }
    if (config.distance.labelTextColor && !isValidColor(config.distance.labelTextColor)) {
      warnings.push(`distance.labelTextColor "${config.distance.labelTextColor}" 不是有效的颜色值`);
    }
  }

  // 验证 ruler 样式
  if (config.ruler) {
    if (config.ruler.strokeColor && !isValidColor(config.ruler.strokeColor)) {
      warnings.push(`ruler.strokeColor "${config.ruler.strokeColor}" 不是有效的颜色值`);
    }
  }

  // 验证 selection 样式
  if (config.selection) {
    if (config.selection.strokeColor && !isValidColor(config.selection.strokeColor)) {
      warnings.push(`selection.strokeColor "${config.selection.strokeColor}" 不是有效的颜色值`);
    }
  }

  // 验证 hover 样式
  if (config.hover) {
    if (config.hover.strokeColor && !isValidColor(config.hover.strokeColor)) {
      warnings.push(`hover.strokeColor "${config.hover.strokeColor}" 不是有效的颜色值`);
    }
  }

  return warnings;
}

// ============================================
// 深度合并工具
// ============================================

/**
 * 深度合并两个对象
 *
 * @param target - 目标对象（基础）
 * @param source - 源对象（覆盖）
 * @returns 合并后的对象
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = (target as Record<string, unknown>)[key];

      if (
        sourceValue !== undefined &&
        sourceValue !== null &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue !== undefined &&
        targetValue !== null &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        // 递归合并嵌套对象
        (result as Record<string, unknown>)[key] = deepMerge(
          targetValue,
          sourceValue as Partial<typeof targetValue>
        );
      } else if (sourceValue !== undefined) {
        // 直接覆盖
        (result as Record<string, unknown>)[key] = sourceValue;
      }
    }
  }

  return result;
}

export function resolveAnnotationStyleConfig(
  theme?: AnnotationTheme,
  overrides?: PartialAnnotationStyleConfig
): AnnotationStyleConfig {
  let resolved = deepMerge(DEFAULT_ANNOTATION_STYLES, {});
  const themeStyles = buildAnnotationStylesFromTheme(theme);
  if (themeStyles) {
    resolved = deepMerge(resolved, themeStyles as Partial<AnnotationStyleConfig>);
  }
  if (overrides) {
    resolved = deepMerge(resolved, overrides as Partial<AnnotationStyleConfig>);
  }
  return resolved;
}

// ============================================
// 样式管理类
// ============================================

/**
 * 标注样式管理器
 *
 * 提供样式配置的获取、更新和重置功能
 */
export class AnnotationStyles {
  private config: AnnotationStyleConfig;

  /**
   * 创建样式管理器
   *
   * @param config - 可选的自定义样式配置（将与默认配置深度合并）
   */
  constructor(config?: PartialAnnotationStyleConfig) {
    // 使用默认配置作为基础
    this.config = { ...DEFAULT_ANNOTATION_STYLES };

    // 如果提供了自定义配置，进行深度合并
    if (config) {
      this.update(config);
    }
  }

  /**
   * 获取当前样式配置（只读）
   *
   * @returns 完整的样式配置
   */
  getConfig(): Readonly<AnnotationStyleConfig> {
    return this.config;
  }

  /**
   * 更新样式配置（深度合并）
   *
   * @param config - 部分样式配置
   */
  update(config: PartialAnnotationStyleConfig): void {
    // 验证颜色
    const warnings = validateStyles(config);
    if (warnings.length > 0) {
      console.warn('[AnnotationStyles] 样式验证警告:', warnings.join('; '));
    }

    // 深度合并配置（使用类型断言处理嵌套 Partial 类型）
    this.config = deepMerge(this.config, config as Partial<AnnotationStyleConfig>);
  }

  /**
   * 重置为默认样式
   */
  reset(): void {
    this.config = { ...DEFAULT_ANNOTATION_STYLES };
  }

  /**
   * 获取距离标注样式
   */
  getDistanceStyle(): DistanceStyle {
    return this.config.distance;
  }

  /**
   * 获取标尺线样式
   */
  getRulerStyle(): RulerStyle {
    return this.config.ruler;
  }

  /**
   * 获取选中元素样式
   */
  getSelectionStyle(): SelectionStyle {
    return this.config.selection;
  }

  /**
   * 获取悬停元素样式
   */
  getHoverStyle(): HoverStyle {
    return this.config.hover;
  }

  /**
   * 克隆当前样式管理器
   *
   * @returns 新的样式管理器实例
   */
  clone(): AnnotationStyles {
    return new AnnotationStyles(this.config);
  }
}
