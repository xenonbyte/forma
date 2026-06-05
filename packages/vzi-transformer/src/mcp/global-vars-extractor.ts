import type { IRStyles } from "@vzi-core/types";
import type { GlobalVarsExtraction, McpDesignTokens } from "./types";

interface ColorInfo {
  value: string;
  count: number;
  usages: Set<string>;
}

interface FontInfo {
  fontFamily: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  count: number;
}

interface SpacingInfo {
  value: string;
  count: number;
}

interface RadiusInfo {
  value: string;
  count: number;
}

interface ShadowInfo {
  value: string;
  count: number;
}

interface GradientInfo {
  value: string;
  count: number;
}

const COLOR_REGEX = /^(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|hsl\([^)]+\)|hsla\([^)]+\)|[a-zA-Z]+)$/;

function isValidColor(value: string | undefined | null): value is string {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (!COLOR_REGEX.test(normalized)) return false;
  return normalized !== "transparent" && normalized !== "inherit" && normalized !== "initial";
}

function normalizeColor(color: string): string {
  return color.toLowerCase().trim();
}

function generateColorName(category: McpDesignTokens["colors"][number]["category"], index: number): string {
  return `${category}-${index}`;
}

function parseRgb(color: string): { r: number; g: number; b: number } | undefined {
  const normalized = color.trim().toLowerCase();
  if (normalized.startsWith("#")) {
    const hex = normalized.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(`${hex[0]}${hex[0]}`, 16),
        g: parseInt(`${hex[1]}${hex[1]}`, 16),
        b: parseInt(`${hex[2]}${hex[2]}`, 16),
      };
    }
    if (hex.length >= 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
    return undefined;
  }

  const rgb = normalized.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1]
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isFinite(value));
    if (parts.length >= 3) {
      return {
        r: Math.max(0, Math.min(255, parts[0])),
        g: Math.max(0, Math.min(255, parts[1])),
        b: Math.max(0, Math.min(255, parts[2])),
      };
    }
  }

  return undefined;
}

function rgbToHsl(rgb: { r: number; g: number; b: number }): { h: number; s: number; l: number } {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  if (delta !== 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  }

  if (h < 0) h += 360;
  return { h, s, l };
}

function isNeutralColor(rgb: { r: number; g: number; b: number }, hsl: { h: number; s: number; l: number }): boolean {
  const channelSpread = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);
  return hsl.s < 0.12 || channelSpread < 14;
}

function categorizeByUsage(color: string, usages: Set<string>): McpDesignTokens["colors"][number]["category"] {
  const usageList = Array.from(usages);
  const hasBackground = usageList.some((usage) => usage.toLowerCase().includes("background"));
  const hasText = usageList.some((usage) => usage === "color" || usage.toLowerCase().includes("text"));
  const hasBorder = usageList.some((usage) => usage.toLowerCase().includes("border"));

  const rgb = parseRgb(color);
  if (!rgb) {
    if (hasBackground) return "background";
    if (hasText) return "text";
    if (hasBorder) return "border";
    return "other";
  }

  const hsl = rgbToHsl(rgb);
  const neutral = isNeutralColor(rgb, hsl);

  if (neutral) {
    if (hasBackground && !hasBorder) return "background";
    if (hasText && !hasBackground && !hasBorder) return "text";
    if (hasBorder && !hasBackground) return "border";
    if (hasBackground && hasBorder) return "background";
    if (hsl.l > 0.82) return "background";
    if (hsl.l < 0.38) return "text";
    if (hasBorder) return "border";
    return "background";
  }

  if (hsl.h >= 0 && hsl.h < 22) return "danger";
  if (hsl.h >= 22 && hsl.h < 58) return "warning";
  if (hsl.h >= 58 && hsl.h < 88) return "warning";
  if (hsl.h >= 88 && hsl.h < 165) return "success";
  if (hsl.h >= 165 && hsl.h < 245) return "primary";
  if (hsl.h >= 245 && hsl.h < 320) return "secondary";
  if (hsl.h >= 320) return "accent";

  if (hasBackground) return "background";
  if (hasText) return "text";
  if (hasBorder) return "border";
  return "accent";
}

function parseNumericStyleValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^-?\d*\.?\d+/);
  if (!match) return undefined;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function extractNumericValues(value: string | number): number[] {
  if (typeof value === "number") {
    return value > 0 ? [value] : [];
  }

  const matches = value.match(/-?\d*\.?\d+/g);
  if (!matches) return [];
  return matches.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0);
}

function extractColors(elements: Iterable<{ id: string; styles: IRStyles }>): McpDesignTokens["colors"] {
  const colorMap = new Map<string, ColorInfo>();

  for (const element of elements) {
    const styles = element.styles;
    const colorProperties = [
      "color",
      "backgroundColor",
      "borderColor",
      "borderTopColor",
      "borderRightColor",
      "borderBottomColor",
      "borderLeftColor",
      "outlineColor",
      "textDecorationColor",
    ];

    for (const prop of colorProperties) {
      const value = styles[prop] as string | undefined;
      if (!isValidColor(value)) continue;

      const normalized = normalizeColor(value);
      const existing = colorMap.get(normalized);
      if (existing) {
        existing.count++;
        existing.usages.add(prop);
      } else {
        colorMap.set(normalized, {
          value: normalized,
          count: 1,
          usages: new Set([prop]),
        });
      }
    }
  }

  const colors: McpDesignTokens["colors"] = [];
  const categoryIndex = new Map<McpDesignTokens["colors"][number]["category"], number>();
  const sortedColors = Array.from(colorMap.values()).sort((a, b) => b.count - a.count);

  for (const info of sortedColors) {
    const category = categorizeByUsage(info.value, info.usages);
    const index = (categoryIndex.get(category) || 0) + 1;
    categoryIndex.set(category, index);
    colors.push({
      name: generateColorName(category, index),
      value: info.value,
      category,
      frequency: info.count,
    });
  }

  return colors;
}

function extractFonts(elements: Iterable<{ id: string; styles: IRStyles }>): McpDesignTokens["fonts"] {
  const fontMap = new Map<string, FontInfo>();

  for (const element of elements) {
    const styles = element.styles;
    if (!styles.fontFamily) continue;

    const fontFamily = String(styles.fontFamily);
    const fontSize = parseNumericStyleValue(styles.fontSize);
    const fontWeight = parseNumericStyleValue(styles.fontWeight);
    const lineHeight = parseNumericStyleValue(styles.lineHeight);
    const letterSpacing = parseNumericStyleValue(styles.letterSpacing);

    const key = JSON.stringify({ fontFamily, fontSize, fontWeight, lineHeight, letterSpacing });
    const existing = fontMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      fontMap.set(key, {
        fontFamily,
        fontSize,
        fontWeight,
        lineHeight,
        letterSpacing,
        count: 1,
      });
    }
  }

  return Array.from(fontMap.values())
    .sort((a, b) => b.count - a.count)
    .map((info) => ({
      fontFamily: info.fontFamily,
      fontSize: info.fontSize,
      fontWeight: info.fontWeight,
      lineHeight: info.lineHeight,
      letterSpacing: info.letterSpacing,
      frequency: info.count,
    }));
}

function extractSpacing(elements: Iterable<{ id: string; styles: IRStyles }>): McpDesignTokens["spacing"] {
  const spacingMap = new Map<string, SpacingInfo>();

  for (const element of elements) {
    const styles = element.styles;
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

    for (const prop of spacingProperties) {
      const value = styles[prop];
      if (value === undefined || value === null || value === "") continue;

      for (const numeric of extractNumericValues(value as string | number)) {
        const key = `${numeric}px`;
        const existing = spacingMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          spacingMap.set(key, { value: key, count: 1 });
        }
      }
    }
  }

  return Array.from(spacingMap.values())
    .sort((a, b) => b.count - a.count)
    .map((info) => ({
      value: info.value,
      frequency: info.count,
    }));
}

function normalizeTokenValue(value: string | number): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return `${value}px`;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized;
}

function extractRadii(elements: Iterable<{ id: string; styles: IRStyles }>): NonNullable<McpDesignTokens["radii"]> {
  const radiusMap = new Map<string, RadiusInfo>();
  const radiusProps = [
    "borderRadius",
    "borderTopLeftRadius",
    "borderTopRightRadius",
    "borderBottomLeftRadius",
    "borderBottomRightRadius",
  ];

  for (const element of elements) {
    const styles = element.styles;
    for (const prop of radiusProps) {
      const raw = styles[prop];
      if (raw === undefined || raw === null || raw === "") continue;
      const value = normalizeTokenValue(raw as string | number);
      if (!value || value === "0" || value === "0px") continue;
      const existing = radiusMap.get(value);
      if (existing) {
        existing.count++;
      } else {
        radiusMap.set(value, { value, count: 1 });
      }
    }
  }

  return Array.from(radiusMap.values())
    .sort((a, b) => b.count - a.count)
    .map((info) => ({
      value: info.value,
      frequency: info.count,
    }));
}

function extractShadows(elements: Iterable<{ id: string; styles: IRStyles }>): NonNullable<McpDesignTokens["shadows"]> {
  const shadowMap = new Map<string, ShadowInfo>();
  for (const element of elements) {
    const shadow = element.styles.boxShadow;
    if (typeof shadow !== "string") continue;
    const normalized = shadow.trim();
    if (!normalized || normalized.toLowerCase() === "none") continue;
    const existing = shadowMap.get(normalized);
    if (existing) {
      existing.count++;
    } else {
      shadowMap.set(normalized, { value: normalized, count: 1 });
    }
  }

  return Array.from(shadowMap.values())
    .sort((a, b) => b.count - a.count)
    .map((info) => ({
      value: info.value,
      frequency: info.count,
    }));
}

function extractGradients(
  elements: Iterable<{ id: string; styles: IRStyles }>,
): NonNullable<McpDesignTokens["gradients"]> {
  const gradientMap = new Map<string, GradientInfo>();
  const gradientPattern = /gradient\(/i;

  for (const element of elements) {
    const bg = element.styles.backgroundImage;
    if (typeof bg !== "string") continue;
    const normalized = bg.trim();
    if (!normalized || normalized.toLowerCase() === "none") continue;
    if (!gradientPattern.test(normalized)) continue;
    const existing = gradientMap.get(normalized);
    if (existing) {
      existing.count++;
    } else {
      gradientMap.set(normalized, { value: normalized, count: 1 });
    }
  }

  return Array.from(gradientMap.values())
    .sort((a, b) => b.count - a.count)
    .map((info) => ({
      value: info.value,
      frequency: info.count,
    }));
}

function generateCssVariables(tokens: McpDesignTokens): string {
  const lines: string[] = [":root {"];

  for (const color of tokens.colors) {
    lines.push(`  --${color.name}: ${color.value};`);
  }

  let fontIndex = 0;
  for (const font of tokens.fonts) {
    const varName = fontIndex === 0 ? "font-primary" : `font-${fontIndex}`;
    lines.push(`  --${varName}: ${font.fontFamily};`);
    if (font.fontSize) lines.push(`  --${varName}-size: ${font.fontSize}px;`);
    if (font.fontWeight) lines.push(`  --${varName}-weight: ${font.fontWeight};`);
    fontIndex++;
  }

  let spacingIndex = 0;
  for (const space of tokens.spacing.slice(0, 12)) {
    lines.push(`  --spacing-${spacingIndex}: ${space.value};`);
    spacingIndex++;
  }

  let radiusIndex = 0;
  for (const radius of (tokens.radii || []).slice(0, 8)) {
    lines.push(`  --radius-${radiusIndex}: ${radius.value};`);
    radiusIndex++;
  }

  lines.push("}");
  return lines.join("\n");
}

export function extractGlobalVars(elements: Iterable<{ id: string; styles: IRStyles }>): GlobalVarsExtraction {
  const elementsArray = Array.from(elements);
  const tokens: McpDesignTokens = {
    colors: extractColors(elementsArray),
    fonts: extractFonts(elementsArray),
    spacing: extractSpacing(elementsArray),
    radii: extractRadii(elementsArray),
    shadows: extractShadows(elementsArray),
    gradients: extractGradients(elementsArray),
    elementCount: elementsArray.length,
  };

  return {
    cssVariables: generateCssVariables(tokens),
    tokens,
  };
}

export function extractColorVars(elements: Iterable<{ id: string; styles: IRStyles }>): McpDesignTokens["colors"] {
  return extractColors(elements);
}

export function extractFontVars(elements: Iterable<{ id: string; styles: IRStyles }>): McpDesignTokens["fonts"] {
  return extractFonts(elements);
}

export function extractSpacingVars(elements: Iterable<{ id: string; styles: IRStyles }>): McpDesignTokens["spacing"] {
  return extractSpacing(elements);
}
