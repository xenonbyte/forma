/**
 * 样式提取器
 *
 * 在浏览器上下文中提取元素的计算样式
 */

/**
 * 提取元素样式
 *
 * 注意：此函数设计为在浏览器上下文中执行（Puppeteer page.evaluate）
 */
export function extractStyles(element: Element, computedStyle: CSSStyleDeclaration): Record<string, string> {
  const styles: Record<string, string> = {};

  // 定义要提取的样式属性
  const styleProps = [
    "display",
    "position",
    "top",
    "right",
    "bottom",
    "left",
    "width",
    "height",
    "margin",
    "padding",
    "border",
    "backgroundColor",
    "color",
    "fontSize",
    "fontFamily",
    "fontWeight",
    "lineHeight",
    "textAlign",
    "opacity",
    "zIndex",
    "overflow",
    "flexDirection",
    "justifyContent",
    "alignItems",
    "gap",
    "borderRadius",
    "boxShadow",
    "transform",
    // 背景相关属性
    "backgroundImage",
    "backgroundSize",
    "backgroundPosition",
    "backgroundRepeat",
    "backgroundClip",
    "backgroundOrigin",
  ];

  for (const prop of styleProps) {
    // 转换 camelCase 到 kebab-case（getPropertyValue 需要 kebab-case）
    const kebabProp = prop.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
    let value = computedStyle.getPropertyValue(kebabProp);

    if (value && value !== "initial" && value !== "inherit") {
      // 修复 boxShadow 格式：Puppeteer 返回颜色在前，需要转换为标准格式（颜色在后）
      if (prop === "boxShadow" && value !== "none") {
        const colorFirstMatch = value.match(/^(rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-fA-F]+)\s+(.+)$/);
        if (colorFirstMatch) {
          // 移除颜色值中的空格，避免渲染器的 split(/\s+/) 把 rgba() 分割开
          const color = colorFirstMatch[1].replace(/\s+/g, "");
          value = `${colorFirstMatch[2]} ${color}`;
        }
      }

      styles[prop] = value;
    }
  }

  return styles;
}
