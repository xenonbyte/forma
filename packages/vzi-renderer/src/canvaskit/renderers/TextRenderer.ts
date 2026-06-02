/**
 * 文本渲染器
 *
 * 渲染文本元素
 */

import type { CanvasKit, Canvas, Font, Paint, TextAlign, LineMetrics } from 'canvaskit-wasm';
import type { IElementRenderer, IRElement } from './types';
import { mapFontWeight, parseTextStyle } from '../converters/TextStyleConverter';
import { FontManager } from '../FontManager';

function isRendererDebugEnabled(): boolean {
  const globalConfig = globalThis as typeof globalThis & {
    __VZI_RENDERER_DEBUG__?: unknown;
  };
  return globalConfig.__VZI_RENDERER_DEBUG__ === true;
}

function rendererDebugLog(message: string, payload?: unknown): void {
  if (!isRendererDebugEnabled()) {
    return;
  }
  if (payload !== undefined) {
    // eslint-disable-next-line no-console
    console.log(`[VZI][TextRenderer] ${message}`, payload);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[VZI][TextRenderer] ${message}`);
}

/**
 * 文本类型列表
 */
const TEXT_TYPES = ['text', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label'];

/**
 * 文本渲染器
 */
export class TextRenderer implements IElementRenderer {
  private static readonly LOGGED_TEXT_KEYS = new Set<string>();
  private static readonly ICON_FONT_KEYWORDS = ['material symbols', 'material icons'];
  private static readonly MATERIAL_ICONS_FAMILY = 'material icons';
  private static readonly ICON_FALLBACK_FAMILIES = [
    'material icons',
  ];
  private static readonly ICON_LIGATURE_CODEPOINTS: Record<string, string> = {
    alternate_email: 'e0e6',
    arrow_back: 'e5c4',
    arrow_back_ios: 'e5e0',
    arrow_back_ios_new: 'e2ea',
    arrow_forward: 'e5c8',
    auto_fix_high: 'e663',
    chevron_left: 'e5cb',
    check_circle: 'e86c',
    content_copy: 'e14d',
    design_services: 'f10a',
    language: 'e894',
    lock_reset: 'eade',
    sync: 'e627',
    open_in_new: 'e89e',
    mail: 'e158',
    public: 'e80b',
    refresh: 'e5d5',
    share: 'e80d',
    terminal: 'eb8e',
    token: 'ea25',
    translate: 'e8e2',
    upload_file: 'e9fc',
  };

  canRender(type: string): boolean {
    return TEXT_TYPES.includes(type);
  }

  render(canvas: Canvas, element: IRElement, CanvasKit: CanvasKit): void {
    const { bounds, styles, textContent = '' } = element;

    if (!textContent) {
      return;
    }

    canvas.save();

    // 解析文本样式
    const textStyle = parseTextStyle(styles as Record<string, string | number>);
    const normalizedFamilies = this.normalizeFontFamilies(textStyle.fontFamily);
    const usesIconFontByFamily = normalizedFamilies.some((family) =>
      TextRenderer.ICON_FONT_KEYWORDS.some((keyword) => family.includes(keyword))
    );
    const usesIconFontByLigature = this.isLikelyIconLigature(textContent, bounds, textStyle.fontSize);
    const usesIconFont = usesIconFontByFamily || usesIconFontByLigature;
    const transformedText = usesIconFont
      ? textContent
      : this.applyTextTransform(textContent, styles.textTransform);
    const paragraphFamilies = [...normalizedFamilies];
    if (usesIconFont) {
      for (const family of TextRenderer.ICON_FALLBACK_FAMILIES) {
        if (!paragraphFamilies.includes(family)) {
          paragraphFamilies.push(family);
        }
      }
    }
    if (!paragraphFamilies.includes('defaultfont')) {
      paragraphFamilies.push('defaultfont');
    }

    // 获取全局 FontProvider（所有文本共享，不删除）
    const fontManager = FontManager.getInstance();
    const fontProvider = fontManager.getGlobalFontProvider();

    if (!fontProvider) {
      console.error('[TextRenderer] 全局 FontProvider 未初始化');
      rendererDebugLog('font provider missing', {
        elementId: element.id,
        text: textContent,
        fontFamily: textStyle.fontFamily,
      });
      canvas.restore();
      return;
    }

    const shouldUseCodepoint = this.shouldUseIconCodepoint(
      textContent,
      normalizedFamilies,
      usesIconFontByFamily,
      usesIconFont,
      fontManager
    );
    if (shouldUseCodepoint) {
      const prefersMaterialIcons = normalizedFamilies.some((family) =>
        family.includes('material icons')
      );
      if (prefersMaterialIcons) {
        const materialIconsIndex = paragraphFamilies.indexOf(TextRenderer.MATERIAL_ICONS_FAMILY);
        if (materialIconsIndex > 0) {
          paragraphFamilies.splice(materialIconsIndex, 1);
          paragraphFamilies.unshift(TextRenderer.MATERIAL_ICONS_FAMILY);
        }
      }
    }
    const resolvedParagraphFamilies = this.prioritizeRegisteredFamilies(paragraphFamilies, fontManager);
    if (usesIconFont) {
      rendererDebugLog('icon text render decision', {
        elementId: element.id,
        text: textContent,
        normalizedFamilies,
        usesIconFontByFamily,
        usesIconFontByLigature,
        shouldUseCodepoint,
        paragraphFamilies: resolvedParagraphFamilies,
      });
    }
    const resolvedColor = this.resolveEffectiveTextColor(styles, textStyle.color);

    const effectiveIconFontSize = usesIconFont
      ? this.getEffectiveIconFontSize(textStyle.fontSize, textStyle.lineHeight)
      : textStyle.fontSize;

    // 使用 ParagraphBuilder 支持中文
    const effectiveTextAlign: 'left' | 'center' | 'right' = usesIconFont
      ? 'center'
      : textStyle.textAlign;

    const paraStyle = new CanvasKit.ParagraphStyle({
      textStyle: {
        color: CanvasKit.parseColorString(resolvedColor),
        fontSize: effectiveIconFontSize,
        fontStyle: {
          weight: mapFontWeight(textStyle.fontWeight, CanvasKit),
          slant:
            textStyle.fontStyle === 'italic'
              ? CanvasKit.FontSlant.Italic
              : CanvasKit.FontSlant.Upright,
        },
        // 按元素 fontFamily 渲染，并回退到默认字体
        fontFamilies: resolvedParagraphFamilies,
        ...(usesIconFont
          ? {
              // 已转换为 codepoint 时不再依赖 liga，避免 CanvasKit/WebGL 在图标整形阶段崩溃。
                ...(!shouldUseCodepoint
                  ? { fontFeatures: [{ name: 'liga', value: 1 }] }
                  : {}),
                fontVariations: [
                  { axis: 'wght', value: typeof textStyle.fontWeight === 'number' ? textStyle.fontWeight : 400 },
                  // 与浏览器更接近：opsz 以字号为主并限制在常见区间，避免大图标下沉/小图标过小。
                  { axis: 'opsz', value: Math.max(20, Math.min(48, effectiveIconFontSize)) },
                ],
              }
          : {}),
      },
      textAlign: this.mapTextAlign(effectiveTextAlign, CanvasKit),
      ...(usesIconFont ? { maxLines: 1 } : {}),
    });

    const builder = CanvasKit.ParagraphBuilder.MakeFromFontProvider(paraStyle, fontProvider);
    const renderText = this.resolveIconText(transformedText, usesIconFont, shouldUseCodepoint);
    if (renderText !== textContent) {
      rendererDebugLog('icon ligature converted to codepoint', {
        elementId: element.id,
        original: textContent,
        resolved: renderText,
      });
    }
    builder.addText(renderText);
    const paragraph = builder.build();
    const padding = this.parsePadding(styles.padding);
    const contentX = bounds.x + padding.left;
    const contentY = bounds.y + padding.top;
    const availableWidth = Math.max(1, bounds.width - padding.left - padding.right);
    const availableHeight = Math.max(1, bounds.height - padding.top - padding.bottom);
    const minLayoutWidth = Math.max(effectiveIconFontSize, 1);
    const isSingleTokenText = !/\s/.test(renderText.trim());
    const singleLineWidthHint = this.estimateSingleLineWidthHint(
      renderText,
      effectiveIconFontSize,
      textStyle.lineHeight,
      availableHeight,
      usesIconFont
    );
    const shouldStretchLayoutForSingleLine =
      !usesIconFont && (
        effectiveTextAlign === 'left' ||
        (isSingleTokenText && (effectiveTextAlign === 'center' || effectiveTextAlign === 'right'))
      );
    const layoutWidth = shouldStretchLayoutForSingleLine
      ? Math.max(availableWidth, minLayoutWidth, singleLineWidthHint)
      : Math.max(availableWidth, minLayoutWidth);
    paragraph.layout(layoutWidth);

    const textLogKey = [
      element.id,
      textContent,
      textStyle.fontFamily,
      textStyle.fontSize,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
    ].join('|');
    if (isRendererDebugEnabled() && !TextRenderer.LOGGED_TEXT_KEYS.has(textLogKey)) {
      TextRenderer.LOGGED_TEXT_KEYS.add(textLogKey);
      rendererDebugLog('text draw', {
        elementId: element.id,
        text: textContent,
        resolvedText: renderText,
        bounds,
        fontFamily: textStyle.fontFamily,
        fontSize: textStyle.fontSize,
        color: resolvedColor,
        usesIconFont,
        shouldUseCodepoint,
        padding,
        layoutWidth,
      });
    }

    // 计算文本位置
    const extraLayoutWidth = Math.max(0, layoutWidth - availableWidth);
    let x = contentX;
    if (extraLayoutWidth > 0) {
      if (effectiveTextAlign === 'center') {
        x -= extraLayoutWidth * 0.5;
      } else if (effectiveTextAlign === 'right') {
        x -= extraLayoutWidth;
      }
    }
    let y = contentY;
    if (usesIconFont) {
      const lineHeight = Number.isFinite(textStyle.lineHeight)
        ? textStyle.lineHeight
        : effectiveIconFontSize;
      if (lineHeight > effectiveIconFontSize) {
        y += (lineHeight - effectiveIconFontSize) * 0.3;
      } else if (effectiveIconFontSize >= 32 && bounds.height <= effectiveIconFontSize + 0.5) {
        // 大号 Material 图标通常视觉中心偏下，做轻微上移以贴近浏览器。
        y -= Math.max(1, Math.round(effectiveIconFontSize * 0.1));
      }
    }

    // 绘制
    canvas.drawParagraph(paragraph, x, y);
    this.renderTextDecorations(canvas, paragraph, x, y, textStyle, resolvedColor, CanvasKit);

    // 立即删除 Paragraph 和 ParagraphBuilder，防止内存泄漏
    // 注意：不删除 fontProvider（全局共享）
    paragraph.delete();
    builder.delete();

    canvas.restore();
  }

  private renderTextDecorations(
    canvas: Canvas,
    paragraph: {
      getLineMetrics(): LineMetrics[];
    },
    x: number,
    y: number,
    textStyle: {
      fontSize: number;
      textDecoration: string[];
    },
    color: string,
    CanvasKit: CanvasKit
  ): void {
    if (!textStyle.textDecoration || textStyle.textDecoration.length === 0) {
      return;
    }

    const lineMetrics = paragraph.getLineMetrics();
    if (!Array.isArray(lineMetrics) || lineMetrics.length === 0) {
      return;
    }

    const paint = new CanvasKit.Paint();
    try {
      paint.setAntiAlias(true);
      paint.setStyle(CanvasKit.PaintStyle.Stroke);
      paint.setColor(CanvasKit.parseColorString(color));
      paint.setStrokeWidth(Math.max(1, textStyle.fontSize * 0.06));

      for (const line of lineMetrics) {
        const lineStartX = x + line.left;
        const lineEndX = lineStartX + line.width;
        const baselineY = y + line.baseline;

        if (textStyle.textDecoration.includes('underline')) {
          const underlineY = baselineY + Math.max(1, textStyle.fontSize * 0.08);
          canvas.drawLine(lineStartX, underlineY, lineEndX, underlineY, paint);
        }

        if (textStyle.textDecoration.includes('line-through')) {
          const strikeY = baselineY - textStyle.fontSize * 0.3;
          canvas.drawLine(lineStartX, strikeY, lineEndX, strikeY, paint);
        }

        if (textStyle.textDecoration.includes('overline')) {
          const overlineY = baselineY + line.ascent + Math.max(1, textStyle.fontSize * 0.06);
          canvas.drawLine(lineStartX, overlineY, lineEndX, overlineY, paint);
        }
      }
    } finally {
      paint.delete();
    }
  }

  private isLikelyIconLigature(text: string, bounds: IRElement['bounds'], fontSize: number): boolean {
    const normalized = text.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    if (!/^[a-z0-9_]+$/.test(normalized) || !normalized.includes('_')) {
      return false;
    }

    if (normalized.length < 3 || normalized.length > 40) {
      return false;
    }

    const maxWidth = Math.max(fontSize * 3, 96);
    const maxHeight = Math.max(fontSize * 3, 96);
    return bounds.width <= maxWidth && bounds.height <= maxHeight;
  }

  private normalizeFontFamilies(fontFamily: string): string[] {
    return fontFamily
      .split(',')
      .map((family) => family.trim().toLowerCase().replace(/['"]/g, ''))
      .filter((family) => family.length > 0);
  }

  private prioritizeRegisteredFamilies(families: string[], fontManager: FontManager): string[] {
    const uniqueFamilies = [...new Set(families.filter((family) => family.length > 0))];
    if (uniqueFamilies.length === 0) {
      return ['defaultfont'];
    }

    const registered: string[] = [];
    const unresolved: string[] = [];
    for (const family of uniqueFamilies) {
      if (fontManager.isFontRegistered(family)) {
        registered.push(family);
      } else {
        unresolved.push(family);
      }
    }

    if (registered.length === 0) {
      return uniqueFamilies;
    }

    return [...registered, ...unresolved];
  }

  private shouldUseIconCodepoint(
    text: string,
    normalizedFamilies: string[],
    usesIconFontByFamily: boolean,
    usesIconFont: boolean,
    fontManager: FontManager
  ): boolean {
    if (!usesIconFont) {
      return false;
    }

    const ligature = text.trim().toLowerCase();
    if (!TextRenderer.ICON_LIGATURE_CODEPOINTS[ligature]) {
      return false;
    }

    const hasMaterialIconsRegistered = fontManager.isFontRegistered(TextRenderer.MATERIAL_ICONS_FAMILY);
    const symbolFamilies = normalizedFamilies.filter((family) =>
      family.includes('material symbols') || family.includes('material-symbols')
    );
    const hasAnySymbolRegistered = symbolFamilies.some((family) => fontManager.isFontRegistered(family));

    if (symbolFamilies.length > 0) {
      // Material Symbols 在 CanvasKit WebGL 下走 ligature shaping 存在稳定性问题。
      // 只要本地有对应 codepoint，就优先使用 codepoint，并继续保留变量字体轴设置。
      if (hasAnySymbolRegistered) {
        return true;
      }
      return hasMaterialIconsRegistered;
    }

    if (usesIconFontByFamily) {
      return hasMaterialIconsRegistered;
    }

    // 样式未准确携带 icon family 时（仍像图标 ligature），有 Material Icons 即可回退。
    return hasMaterialIconsRegistered;
  }

  private resolveIconText(text: string, usesIconFont: boolean, shouldUseCodepoint: boolean): string {
    if (!usesIconFont || !shouldUseCodepoint) {
      return text;
    }

    const ligature = text.trim().toLowerCase();
    const codepointHex = TextRenderer.ICON_LIGATURE_CODEPOINTS[ligature];
    if (!codepointHex) {
      return text;
    }

    const codepoint = Number.parseInt(codepointHex, 16);
    if (!Number.isFinite(codepoint)) {
      return text;
    }

    return String.fromCodePoint(codepoint);
  }

  private resolveEffectiveTextColor(
    styles: IRElement['styles'],
    defaultColor: string
  ): string {
    const color =
      typeof styles.color === 'string'
        ? styles.color
        : defaultColor;
    if (!this.isTransparentColor(color)) {
      return color;
    }

    const backgroundClip =
      typeof styles.backgroundClip === 'string'
        ? styles.backgroundClip.toLowerCase()
        : '';
    const backgroundImage =
      typeof styles.backgroundImage === 'string'
        ? styles.backgroundImage
        : '';
    if (backgroundClip !== 'text' || !backgroundImage || backgroundImage === 'none') {
      return color;
    }

    const fallbackGradientColor = this.extractFirstColorToken(backgroundImage);
    if (fallbackGradientColor) {
      return fallbackGradientColor;
    }
    return color;
  }

  private applyTextTransform(
    text: string,
    textTransform: string | number | undefined
  ): string {
    if (typeof textTransform !== 'string') {
      return text;
    }

    const normalized = textTransform.trim().toLowerCase();
    if (normalized === 'uppercase') {
      return text.toLocaleUpperCase();
    }
    if (normalized === 'lowercase') {
      return text.toLocaleLowerCase();
    }
    if (normalized === 'capitalize') {
      return text.replace(/\b([^\s])/g, (match) => match.toLocaleUpperCase());
    }
    return text;
  }

  private isTransparentColor(color: string): boolean {
    const normalized = color.trim().toLowerCase();
    if (normalized === 'transparent') {
      return true;
    }
    const rgbaMatch = normalized.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/);
    if (rgbaMatch) {
      return Number.parseFloat(rgbaMatch[1]) <= 0.001;
    }
    const hslaMatch = normalized.match(/^hsla\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/);
    if (hslaMatch) {
      return Number.parseFloat(hslaMatch[1]) <= 0.001;
    }
    if (/^#[0-9a-f]{4}$/i.test(normalized)) {
      return normalized[4] === '0';
    }
    if (/^#[0-9a-f]{8}$/i.test(normalized)) {
      return normalized.slice(7, 9) === '00';
    }
    return false;
  }

  private extractFirstColorToken(backgroundImage: string): string | undefined {
    const colorTokenRegex =
      /(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-fA-F]{3,8})/g;
    const matched = backgroundImage.match(colorTokenRegex);
    if (!matched || matched.length === 0) {
      return undefined;
    }
    return matched[0];
  }

  private parsePadding(
    padding: string | number | undefined
  ): { top: number; right: number; bottom: number; left: number } {
    if (typeof padding === 'number') {
      const value = Number.isFinite(padding) ? padding : 0;
      return {
        top: value,
        right: value,
        bottom: value,
        left: value,
      };
    }

    if (typeof padding !== 'string' || padding.trim().length === 0) {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }

    const values = padding
      .trim()
      .split(/\s+/)
      .map((token) => this.parseLengthToNumber(token));

    if (values.length === 1) {
      return { top: values[0], right: values[0], bottom: values[0], left: values[0] };
    }

    if (values.length === 2) {
      return { top: values[0], right: values[1], bottom: values[0], left: values[1] };
    }

    if (values.length === 3) {
      return { top: values[0], right: values[1], bottom: values[2], left: values[1] };
    }

    return {
      top: values[0] ?? 0,
      right: values[1] ?? 0,
      bottom: values[2] ?? 0,
      left: values[3] ?? 0,
    };
  }

  private parseLengthToNumber(value: string): number {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return parsed;
  }

  private estimateSingleLineWidthHint(
    text: string,
    fontSize: number,
    lineHeight: number,
    availableHeight: number,
    usesIconFont: boolean
  ): number {
    if (!text || text.includes('\n')) {
      return 0;
    }

    const normalizedLineHeight =
      Number.isFinite(lineHeight) && lineHeight > 0
        ? lineHeight
        : fontSize * 1.2;
    const singleLineThreshold = Math.max(normalizedLineHeight * 1.3, fontSize * 1.6);
    if (availableHeight > singleLineThreshold) {
      return 0;
    }

    if (usesIconFont) {
      return Math.max(fontSize * 1.2, 24);
    }

    let estimate = 0;
    for (const char of text) {
      const codePoint = char.codePointAt(0) ?? 0;
      if (codePoint <= 0x7f) {
        estimate += fontSize * 0.56;
      } else if (codePoint >= 0x2e80 && codePoint <= 0x9fff) {
        estimate += fontSize;
      } else {
        estimate += fontSize * 0.72;
      }
    }

    // 对短 token（如 "75%"）放宽单行宽度预算，避免被错误换行。
    const isShortToken = !/\s/.test(text) && text.length <= 8;
    if (isShortToken) {
      return Math.max(estimate + fontSize * 0.6, fontSize * 1.2);
    }

    return Math.max(estimate + fontSize * 0.2, fontSize);
  }

  private getEffectiveIconFontSize(fontSize: number, lineHeight: number): number {
    if (!Number.isFinite(fontSize) || fontSize <= 0) {
      return 16;
    }

    if (!Number.isFinite(lineHeight) || lineHeight <= fontSize) {
      return fontSize;
    }

    // 小图标在 CanvasKit 下偏小，按行高做温和补偿，避免破坏大图标。
    if (fontSize <= 24) {
      const boosted = fontSize + (lineHeight - fontSize) * 0.2;
      return Math.min(lineHeight, boosted);
    }
    return fontSize;
  }

  /**
   * 映射文本对齐方式
   */
  private mapTextAlign(align: 'left' | 'center' | 'right', CanvasKit: CanvasKit): TextAlign {
    switch (align) {
      case 'center':
        return CanvasKit.TextAlign.Center;
      case 'right':
        return CanvasKit.TextAlign.Right;
      default:
        return CanvasKit.TextAlign.Left;
    }
  }

  /**
   * 测量文本
   */
  measureText(text: string, font: Font, _CanvasKit: CanvasKit): { width: number; height: number } {
    const fontSize = font.getSize() || 16;
    const charWidth = fontSize * 0.6;

    return {
      width: text.length * charWidth,
      height: fontSize,
    };
  }
}

/**
 * 单例实例
 */
export const textRenderer = new TextRenderer();
