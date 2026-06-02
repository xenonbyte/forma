/**
 * 响应式检测模块
 *
 * 功能：
 * - 从 CSS 中提取媒体查询断点
 * - 分析元素在不同断点下的样式变化
 * - 检测元素是否为响应式组件
 */

import type { IRStyles, IRResponsive } from '@vzi-core/types';

/**
 * 标准断点定义（px）
 * 常见的响应式设计断点
 */
export const STANDARD_BREAKPOINTS = {
  xs: 320,   // 小型手机
  sm: 576,   // 大型手机
  md: 768,   // 平板
  lg: 992,   // 小型桌面
  xl: 1200,  // 桌面
  xxl: 1400, // 大型桌面
} as const;

/**
 * 断点类型
 */
export type BreakpointName = keyof typeof STANDARD_BREAKPOINTS;

/**
 * 媒体类型
 */
export type MediaType = 'all' | 'screen' | 'print' | 'speech';

/**
 * 媒体查询解析结果
 */
export interface ParsedMediaQuery {
  /** 原始媒体查询字符串 */
  raw: string;
  /** 媒体类型 */
  mediaType: MediaType | null;
  /** 断点条件 */
  conditions: MediaQueryCondition[];
  /** 提取的断点宽度值 */
  breakpointWidths: number[];
}

/**
 * 媒体查询条件
 */
export interface MediaQueryCondition {
  /** 类型：min-width, max-width, min-height, max-height 等 */
  type: 'min-width' | 'max-width' | 'min-height' | 'max-height' | 'orientation' | 'resolution' | 'prefers-color-scheme' | 'other';
  /** 值 */
  value?: number | string;
  /** 单位 */
  unit?: 'px' | 'em' | 'rem' | 'dpi' | 'dppx';
}

/**
 * 响应式样式变化
 */
export interface ResponsiveStyleChange {
  /** 断点 */
  breakpoint: number;
  /** 变化的样式属性 */
  changedProperties: string[];
  /** 变化前后的值 */
  changes: Record<string, { from: string | number | undefined; to: string | number | undefined }>;
}

/**
 * 响应式检测器
 */
export class ResponsiveDetector {
  private detectedBreakpoints: Set<number> = new Set();
  private mediaQueries: ParsedMediaQuery[] = [];

  /**
   * 从 CSS 文本中提取媒体查询
   * @param cssText CSS 文本
   */
  extractMediaQueries(cssText: string): ParsedMediaQuery[] {
    const results: ParsedMediaQuery[] = [];

    // 匹配 @media 查询
    const mediaRegex = /@media\s+([^{]+)\s*\{/g;
    let match;

    while ((match = mediaRegex.exec(cssText)) !== null) {
      const queryText = match[1].trim();
      const parsed = this.parseMediaQuery(queryText);
      results.push(parsed);

      // 记录检测到的断点
      parsed.breakpointWidths.forEach((width) => {
        this.detectedBreakpoints.add(width);
      });
    }

    this.mediaQueries.push(...results);
    return results;
  }

  /**
   * 解析单个媒体查询字符串
   */
  private parseMediaQuery(queryText: string): ParsedMediaQuery {
    const conditions: MediaQueryCondition[] = [];
    const breakpointWidths: number[] = [];
    let mediaType: MediaType | null = null;

    // 检测媒体类型
    const typeMatch = queryText.match(/^(all|screen|print|speech)/i);
    if (typeMatch) {
      mediaType = typeMatch[1].toLowerCase() as MediaType;
    }

    // 匹配 min-width/max-width/min-height/max-height
    const dimensionRegex = /(min|max)-(width|height)\s*:\s*(\d+(?:\.\d+)?)(px|em|rem)?/gi;
    let dimensionMatch;

    while ((dimensionMatch = dimensionRegex.exec(queryText)) !== null) {
      const type = `${dimensionMatch[1]}-${dimensionMatch[2]}` as MediaQueryCondition['type'];
      const value = parseFloat(dimensionMatch[3]);
      const unit = dimensionMatch[4] as 'px' | 'em' | 'rem' | undefined;

      conditions.push({ type, value, unit });

      // 转换为像素值
      let pixelValue = value;
      if (unit === 'em' || unit === 'rem') {
        // 假设基准字体大小为 16px
        pixelValue = value * 16;
      }

      if (type === 'min-width' || type === 'max-width') {
        breakpointWidths.push(Math.round(pixelValue));
      }
    }

    // 匹配 orientation
    const orientationMatch = queryText.match(/orientation\s*:\s*(portrait|landscape)/i);
    if (orientationMatch) {
      conditions.push({
        type: 'orientation',
        value: orientationMatch[1].toLowerCase(),
      });
    }

    // 匹配 prefers-color-scheme
    const colorSchemeMatch = queryText.match(/prefers-color-scheme\s*:\s*(light|dark)/i);
    if (colorSchemeMatch) {
      conditions.push({
        type: 'prefers-color-scheme',
        value: colorSchemeMatch[1].toLowerCase(),
      });
    }

    // 匹配 resolution
    const resolutionMatch = queryText.match(/resolution\s*:\s*(\d+(?:\.\d+)?)(dpi|dppx)/i);
    if (resolutionMatch) {
      conditions.push({
        type: 'resolution',
        value: parseFloat(resolutionMatch[1]),
        unit: resolutionMatch[2] as 'dpi' | 'dppx',
      });
    }

    return {
      raw: queryText,
      mediaType,
      conditions,
      breakpointWidths,
    };
  }

  /**
   * 检测元素的响应式属性
   * @param elementStyles 元素在不同断点下的样式
   */
  detectResponsiveProperties(
    elementStyles: Map<number, IRStyles>
  ): IRResponsive | undefined {
    const breakpoints = Array.from(elementStyles.keys()).sort((a, b) => a - b);

    if (breakpoints.length <= 1) {
      return undefined;
    }

    // 提取媒体查询字符串
    const mediaQueries = this.mediaQueries.map((q) => q.raw);

    return {
      breakpoints,
      mediaQueries,
    };
  }

  /**
   * 比较两个断点之间的样式变化
   */
  compareStyles(baseStyles: IRStyles, breakpointStyles: IRStyles): ResponsiveStyleChange | null {
    const changedProperties: string[] = [];
    const changes: ResponsiveStyleChange['changes'] = {};

    for (const [key, value] of Object.entries(breakpointStyles)) {
      const baseValue = baseStyles[key];

      if (value !== baseValue) {
        changedProperties.push(key);
        changes[key] = { from: baseValue ?? undefined, to: value ?? undefined };
      }
    }

    if (changedProperties.length === 0) {
      return null;
    }

    return {
      breakpoint: 0, // 调用方需要设置
      changedProperties,
      changes,
    };
  }

  /**
   * 获取所有检测到的断点
   */
  getDetectedBreakpoints(): number[] {
    return Array.from(this.detectedBreakpoints).sort((a, b) => a - b);
  }

  /**
   * 获取所有媒体查询
   */
  getMediaQueries(): ParsedMediaQuery[] {
    return [...this.mediaQueries];
  }

  /**
   * 清空检测结果
   */
  clear(): void {
    this.detectedBreakpoints.clear();
    this.mediaQueries = [];
  }

  /**
   * 判断元素是否为响应式组件
   * @param className 类名
   * @param styles 样式
   */
  isResponsiveComponent(className: string, styles: IRStyles): boolean {
    // 通过类名判断
    const responsivePatterns = [
      /hidden-(xs|sm|md|lg|xl)/i,
      /visible-(xs|sm|md|lg|xl)/i,
      /col-(xs|sm|md|lg|xl)/i,
      /-sm-|-md-|-lg-|-xl-/i,
    ];

    for (const pattern of responsivePatterns) {
      if (pattern.test(className)) {
        return true;
      }
    }

    // 通过样式判断
    if (styles.width === '100%' || styles.maxWidth === '100%') {
      return true;
    }

    return false;
  }
}

/**
 * 全局响应式检测器实例
 */
export const responsiveDetector = new ResponsiveDetector();

/**
 * 便捷函数：从 CSS 提取断点
 */
export function extractBreakpointsFromCSS(cssText: string): number[] {
  const detector = new ResponsiveDetector();
  detector.extractMediaQueries(cssText);
  return detector.getDetectedBreakpoints();
}
