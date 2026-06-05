/**
 * VZI 样式转 CSS 转换器
 *
 * 将 IRStyles 对象转换为 CSS 字符串
 */

import type { IRStyles, IRStyleValue } from "@vzi-core/types";

/**
 * CSS 属性映射表（VZI 属性名 → CSS 属性名）
 */
const CSS_PROPERTY_MAP: Record<string, string> = {
  // 布局
  display: "display",
  position: "position",
  top: "top",
  right: "right",
  bottom: "bottom",
  left: "left",
  width: "width",
  height: "height",
  minWidth: "min-width",
  minHeight: "min-height",
  maxWidth: "max-width",
  maxHeight: "max-height",

  // 间距
  margin: "margin",
  marginTop: "margin-top",
  marginRight: "margin-right",
  marginBottom: "margin-bottom",
  marginLeft: "margin-left",
  padding: "padding",
  paddingTop: "padding-top",
  paddingRight: "padding-right",
  paddingBottom: "padding-bottom",
  paddingLeft: "padding-left",
  gap: "gap",
  rowGap: "row-gap",
  columnGap: "column-gap",

  // Flexbox
  flex: "flex",
  flexWrap: "flex-wrap",
  flexDirection: "flex-direction",
  justifyContent: "justify-content",
  alignItems: "align-items",
  alignContent: "align-content",
  flexGrow: "flex-grow",
  flexShrink: "flex-shrink",
  flexBasis: "flex-basis",

  // Grid
  grid: "grid",
  gridTemplate: "grid-template",
  gridTemplateColumns: "grid-template-columns",
  gridTemplateRows: "grid-template-rows",
  gridTemplateAreas: "grid-template-areas",
  gridArea: "grid-area",
  gridRow: "grid-row",
  gridColumn: "grid-column",
  gridGap: "grid-gap",
  placeItems: "place-items",
  placeContent: "place-content",

  // 边框
  border: "border",
  borderTop: "border-top",
  borderRight: "border-right",
  borderBottom: "border-bottom",
  borderLeft: "border-left",
  borderWidth: "border-width",
  borderStyle: "border-style",
  borderColor: "border-color",
  borderRadius: "border-radius",
  borderTopLeftRadius: "border-top-left-radius",
  borderTopRightRadius: "border-top-right-radius",
  borderBottomLeftRadius: "border-bottom-left-radius",
  borderBottomRightRadius: "border-bottom-right-radius",

  // 背景
  background: "background",
  backgroundColor: "background-color",
  backgroundImage: "background-image",
  backgroundSize: "background-size",
  backgroundPosition: "background-position",
  backgroundRepeat: "background-repeat",

  // 文本
  color: "color",
  fontSize: "font-size",
  fontFamily: "font-family",
  fontWeight: "font-weight",
  fontStyle: "font-style",
  lineHeight: "line-height",
  letterSpacing: "letter-spacing",
  textAlign: "text-align",
  textDecoration: "text-decoration",
  textTransform: "text-transform",
  whiteSpace: "white-space",
  wordBreak: "word-break",

  // 效果
  opacity: "opacity",
  mixBlendMode: "mix-blend-mode",
  boxShadow: "box-shadow",
  textShadow: "text-shadow",
  filter: "filter",
  backdropFilter: "backdrop-filter",
  transform: "transform",
  transition: "transition",

  // 层级
  zIndex: "z-index",
  overflow: "overflow",
  overflowX: "overflow-x",
  overflowY: "overflow-y",

  // 其他
  cursor: "cursor",
  pointerEvents: "pointer-events",
  visibility: "visibility",
  objectFit: "object-fit",
  objectPosition: "object-position",
  aspectRatio: "aspect-ratio",
};

/**
 * 需要添加 px 单位的属性
 */
const PIXEL_PROPERTIES = new Set([
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "top",
  "right",
  "bottom",
  "left",
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
  "borderWidth",
  "borderRadius",
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "gap",
  "rowGap",
  "columnGap",
  "gridGap",
]);

/**
 * 格式化单个 CSS 属性值
 */
function formatValue(property: string, value: IRStyleValue): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  // 数字类型需要判断是否添加 px 单位
  if (typeof value === "number") {
    // 0 不需要单位
    if (value === 0) {
      return "0";
    }
    // 需要添加 px 单位的属性
    if (PIXEL_PROPERTIES.has(property)) {
      return `${value}px`;
    }
    // 其他数字属性（如 opacity, zIndex, flex-grow 等）
    return String(value);
  }

  // 字符串类型：检查是否为纯数字字符串
  if (typeof value === "string") {
    // 如果是纯数字字符串且属性需要 px 单位
    if (/^-?\d+(\.\d+)?$/.test(value) && PIXEL_PROPERTIES.has(property)) {
      const numValue = parseFloat(value);
      // 0 不需要单位
      if (numValue === 0) {
        return "0";
      }
      return `${numValue}px`;
    }
    // 其他字符串直接返回
    return value;
  }

  // 其他类型
  return String(value);
}

/**
 * 将 IRStyles 转换为 CSS 字符串
 *
 * @param styles - IR 样式对象
 * @returns CSS 字符串
 *
 * @example
 * ```typescript
 * const css = stylesToCss({
 *   backgroundColor: '#ffffff',
 *   fontSize: 16,
 *   padding: 10
 * });
 * // 输出: "background-color: #ffffff; font-size: 16px; padding: 10px;"
 * ```
 */
export function stylesToCss(styles: IRStyles): string {
  const cssParts: string[] = [];

  for (const [property, value] of Object.entries(styles)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }

    // 获取 CSS 属性名
    const cssProperty = CSS_PROPERTY_MAP[property] || property;

    // 格式化值
    const formattedValue = formatValue(property, value);
    if (!formattedValue) {
      continue;
    }

    cssParts.push(`${cssProperty}: ${formattedValue}`);
  }

  return cssParts.join("; ");
}

/**
 * 转换填充样式为 CSS
 *
 * @param styles - IR 样式对象
 * @returns CSS 背景属性字符串
 */
export function fillStyleToCss(styles: IRStyles): string {
  const fillProperties = [
    "background",
    "backgroundColor",
    "backgroundImage",
    "backgroundSize",
    "backgroundPosition",
    "backgroundRepeat",
  ];
  const filteredStyles: IRStyles = {};

  for (const prop of fillProperties) {
    if (styles[prop] !== undefined) {
      filteredStyles[prop] = styles[prop];
    }
  }

  return stylesToCss(filteredStyles);
}

/**
 * 转换描边样式为 CSS
 *
 * @param styles - IR 样式对象
 * @returns CSS 边框属性字符串
 */
export function strokeStyleToCss(styles: IRStyles): string {
  const strokeProperties = [
    "border",
    "borderWidth",
    "borderStyle",
    "borderColor",
    "borderRadius",
    "borderTop",
    "borderRight",
    "borderBottom",
    "borderLeft",
  ];
  const filteredStyles: IRStyles = {};

  for (const prop of strokeProperties) {
    if (styles[prop] !== undefined) {
      filteredStyles[prop] = styles[prop];
    }
  }

  return stylesToCss(filteredStyles);
}

/**
 * 转换阴影样式为 CSS
 *
 * @param styles - IR 样式对象
 * @returns CSS 阴影属性字符串
 */
export function shadowStyleToCss(styles: IRStyles): string {
  const shadowProperties = ["boxShadow", "textShadow"];
  const filteredStyles: IRStyles = {};

  for (const prop of shadowProperties) {
    if (styles[prop] !== undefined) {
      filteredStyles[prop] = styles[prop];
    }
  }

  return stylesToCss(filteredStyles);
}

/**
 * 转换文字样式为 CSS
 *
 * @param styles - IR 样式对象
 * @returns CSS 文字属性字符串
 */
export function textStyleToCss(styles: IRStyles): string {
  const textProperties = [
    "color",
    "fontSize",
    "fontFamily",
    "fontWeight",
    "fontStyle",
    "lineHeight",
    "letterSpacing",
    "textAlign",
    "textDecoration",
    "textTransform",
    "whiteSpace",
    "wordBreak",
  ];
  const filteredStyles: IRStyles = {};

  for (const prop of textProperties) {
    if (styles[prop] !== undefined) {
      filteredStyles[prop] = styles[prop];
    }
  }

  return stylesToCss(filteredStyles);
}

/**
 * 生成 CSS 类定义
 *
 * @param className - 类名
 * @param styles - IR 样式对象
 * @returns CSS 类定义字符串
 */
export function generateCssClass(className: string, styles: IRStyles): string {
  const cssContent = stylesToCss(styles);
  if (!cssContent) {
    return "";
  }

  return `.${className} {\n  ${cssContent};\n}`;
}
