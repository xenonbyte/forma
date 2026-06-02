/**
 * VZI 2.0 工具函数
 *
 * 任务 3.27-3.28: 实现文件格式验证、令牌提取
 */

import type { IRElement, IRStyles } from '@vzi-core/types';
import type {
  ColorToken,
  FontToken,
  ColorCategory,
} from './types';

/**
 * 验证 VZI 文件格式
 */
export function validateVZIFile(buffer: Buffer | Uint8Array): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  // 确保 buffer 是 Buffer 类型
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const errors: string[] = [];
  const warnings: string[] = [];

  // 检查最小大小
  if (buf.length < 256) {
    errors.push('File too small to contain valid VZI header');
    return { valid: false, errors, warnings };
  }

  // 读取魔数
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x565a6932) {
    errors.push(`Invalid magic number: expected 0x565a6932, got 0x${magic.toString(16)}`);
  }

  // 读取版本
  const version = buf.readUInt16LE(4);
  if (version > 0x0002) {
    warnings.push(`Unsupported version: ${version}. May have compatibility issues.`);
  }

  // 读取文件大小
  const fileSize = buf.readBigUInt64LE(6);
  if (fileSize !== BigInt(buf.length)) {
    errors.push(`File size mismatch: header says ${fileSize}, actual is ${buf.length}`);
  }

  // 验证偏移量合理性
  const elementCount = buf.readUInt32LE(14);
  const blockCount = buf.readUInt32LE(18);

  if (elementCount === 0) {
    warnings.push('File contains no elements');
  }

  if (blockCount === 0) {
    errors.push('File contains no data blocks');
  }

  // 与 VZIDecoder.validateHeaderOffsets 对齐的偏移量边界检查
  // header 布局: magic(4) version(2) fileSize(8) elementCount(4) blockCount(4)
  //   → metadataOffset(8) at 22, metadataLength(4) at 30
  //   → blockIndexOffset(8) at 34, blockIndexLength(4) at 42
  //   → dataOffset(8) at 46
  if (buf.length >= 50) {
    const metadataOffset = Number(buf.readBigUInt64LE(22));
    const metadataLength = buf.readUInt32LE(30);
    const metadataEnd = metadataOffset + metadataLength;
    if (metadataOffset < 256 || metadataEnd > buf.length) {
      errors.push(
        `Invalid metadataOffset: ${metadataOffset}+${metadataLength} out of bounds (buffer: ${buf.length})`
      );
    }

    const blockIndexOffset = Number(buf.readBigUInt64LE(34));
    const blockIndexLength = buf.readUInt32LE(42);
    const blockIndexEnd = blockIndexOffset + blockIndexLength;
    if (blockIndexOffset < 256 || blockIndexEnd > buf.length) {
      errors.push(
        `Invalid blockIndexOffset: ${blockIndexOffset}+${blockIndexLength} out of bounds (buffer: ${buf.length})`
      );
    }

    const dataOffset = Number(buf.readBigUInt64LE(46));
    if (dataOffset < 256 || dataOffset > buf.length) {
      errors.push(
        `Invalid dataOffset: ${dataOffset} out of bounds (buffer: ${buf.length})`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 获取 VZI 文件信息（不解析完整内容）
 */
export function getVZIFileInfo(buffer: Buffer | Uint8Array): {
  version: string;
  elementCount: number;
  blockCount: number;
  fileSize: number;
  hasEncryption: boolean;
  hasSpatialIndex: boolean;
} {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 256) {
    throw new Error('File too small to contain valid VZI header');
  }

  const version = buf.readUInt16LE(4);
  const elementCount = buf.readUInt32LE(14);
  const blockCount = buf.readUInt32LE(18);
  const fileSize = Number(buf.readBigUInt64LE(6));

  // 检查是否有加密（通过检查块索引中的块类型）
  const hasEncryption = false;
  let hasSpatialIndex = false;

  try {
    const blockIndexOffset = Number(buf.readBigUInt64LE(34));
    const blockIndexLength = buf.readUInt32LE(42);

    if (blockIndexOffset > 0 && blockIndexLength > 0) {
      // 简单检查块索引中是否包含 spatial 类型
      const indexBuffer = buf.slice(blockIndexOffset, blockIndexOffset + blockIndexLength);
      hasSpatialIndex = indexBuffer.includes(Buffer.from('spatial'));
    }
  } catch {
    // 忽略解析错误
  }

  return {
    version: formatVZIVersion(version),
    elementCount,
    blockCount,
    fileSize,
    hasEncryption,
    hasSpatialIndex,
  };
}

function formatVZIVersion(version: number): string {
  if (version <= 0xff) {
    return `${version}.0`;
  }

  return `${(version >> 8) & 0xff}.${version & 0xff}`;
}

/**
 * 从元素集合中提取颜色令牌
 */
export function extractTokens(elements: Map<string, IRElement>): {
  colors: ColorToken[];
  fonts: FontToken[];
} {
  const colorMap = new Map<string, { count: number; usages: Set<string> }>();
  const fontMap = new Map<string, { count: number; usages: Set<string> }>();

  // 遍历所有元素，提取颜色和字体
  for (const element of elements.values()) {
    extractColorsFromStyles(element.styles, colorMap);
    extractFontsFromStyles(element.styles, fontMap);
  }

  // 转换为令牌数组
  const colors: ColorToken[] = [];
  let colorIndex = 0;

  for (const [value, data] of colorMap) {
    colors.push({
      value,
      name: `color_${colorIndex++}`,
      category: categorizeColor(value),
      usage: Array.from(data.usages).join(', '),
      frequency: data.count,
    });
  }

  // 按频率排序
  colors.sort((a, b) => b.frequency - a.frequency);

  // 转换字体令牌
  const fonts: FontToken[] = [];

  for (const [key, data] of fontMap) {
    const [fontFamily, fontWeight, fontSize] = key.split('|');
    fonts.push({
      fontFamily,
      fontWeight: fontWeight ? parseInt(fontWeight) : undefined,
      fontSize: fontSize ? parseFloat(fontSize) : undefined,
      usage: Array.from(data.usages).join(', '),
      frequency: data.count,
    });
  }

  fonts.sort((a, b) => b.frequency - a.frequency);

  return { colors, fonts };
}

/**
 * 从样式中提取颜色
 */
function extractColorsFromStyles(
  styles: IRStyles,
  colorMap: Map<string, { count: number; usages: Set<string> }>
): void {
  const colorProperties = [
    'color',
    'backgroundColor',
    'borderColor',
    'borderTopColor',
    'borderRightColor',
    'borderBottomColor',
    'borderLeftColor',
    'outlineColor',
    'textDecorationColor',
    'columnRuleColor',
    'accentColor',
    'caretColor',
    'fill',
    'stroke',
  ];

  for (const prop of colorProperties) {
    const value = styles[prop];
    if (value && typeof value === 'string') {
      const colorValue = normalizeColor(value);
      if (colorValue) {
        const existing = colorMap.get(colorValue) || { count: 0, usages: new Set() };
        existing.count++;
        existing.usages.add(prop);
        colorMap.set(colorValue, existing);
      }
    }
  }
}

/**
 * 从样式中提取字体
 */
function extractFontsFromStyles(
  styles: IRStyles,
  fontMap: Map<string, { count: number; usages: Set<string> }>
): void {
  const fontFamily = styles.fontFamily;
  if (fontFamily && typeof fontFamily === 'string') {
    const key = `${fontFamily}|${styles.fontWeight || ''}|${styles.fontSize || ''}`;
    const existing = fontMap.get(key) || { count: 0, usages: new Set() };
    existing.count++;
    existing.usages.add('text');
    fontMap.set(key, existing);
  }
}

/**
 * 标准化颜色值
 */
function normalizeColor(value: string): string | null {
  // 跳过 CSS 变量和关键字
  if (value.startsWith('var(') || value === 'inherit' || value === 'initial' || value === 'transparent') {
    return null;
  }

  // 标准化十六进制颜色
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      // 扩展 #RGB 为 #RRGGBB
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
    } else if (hex.length === 6 || hex.length === 8) {
      return value.toLowerCase();
    }
  }

  // 标准化 rgb/rgba
  if (value.startsWith('rgb')) {
    return value.replace(/\s+/g, '').toLowerCase();
  }

  // 标准化 hsl/hsla
  if (value.startsWith('hsl')) {
    return value.replace(/\s+/g, '').toLowerCase();
  }

  // 命名颜色保持原样
  return value.toLowerCase();
}

/**
 * 颜色分类
 */
function categorizeColor(value: string): ColorCategory {
  // 简单的分类逻辑
  const lowerValue = value.toLowerCase();

  if (lowerValue.includes('background') || lowerValue.includes('bg')) {
    return 'background';
  }

  if (lowerValue.includes('text') || lowerValue.includes('font')) {
    return 'text';
  }

  if (lowerValue.includes('border') || lowerValue.includes('stroke')) {
    return 'border';
  }

  if (lowerValue.includes('primary') || lowerValue.includes('brand')) {
    return 'primary';
  }

  if (lowerValue.includes('secondary')) {
    return 'secondary';
  }

  if (lowerValue.includes('accent') || lowerValue.includes('highlight')) {
    return 'accent';
  }

  return 'other';
}

/**
 * 合并相似的令牌
 */
export function mergeSimilarTokens(
  colors: ColorToken[],
  threshold: number = 10
): ColorToken[] {
  const merged: ColorToken[] = [];
  const used = new Set<number>();

  for (let i = 0; i < colors.length; i++) {
    if (used.has(i)) continue;

    const token = colors[i];
    const similar: ColorToken[] = [token];
    const relatedTokens: string[] = [];

    for (let j = i + 1; j < colors.length; j++) {
      if (used.has(j)) continue;

      const other = colors[j];
      if (colorDistance(token.value, other.value) < threshold) {
        similar.push(other);
        relatedTokens.push(other.name || '');
        used.add(j);
      }
    }

    if (similar.length > 1) {
      // 合并频率
      token.frequency = similar.reduce((sum, t) => sum + t.frequency, 0);
      token.relatedTokens = relatedTokens;
    }

    merged.push(token);
  }

  return merged;
}

/**
 * 计算两个颜色之间的距离
 */
function colorDistance(color1: string, color2: string): number {
  const rgb1 = parseColor(color1);
  const rgb2 = parseColor(color2);

  if (!rgb1 || !rgb2) {
    return Infinity;
  }

  // 欧几里得距离
  return Math.sqrt(
    Math.pow(rgb1.r - rgb2.r, 2) +
    Math.pow(rgb1.g - rgb2.g, 2) +
    Math.pow(rgb1.b - rgb2.b, 2)
  );
}

/**
 * 解析颜色为 RGB
 */
function parseColor(value: string): { r: number; g: number; b: number } | null {
  // 十六进制
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
  }

  // rgb
  const rgbMatch = value.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1]),
      g: parseInt(rgbMatch[2]),
      b: parseInt(rgbMatch[3]),
    };
  }

  return null;
}
