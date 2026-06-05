/**
 * SVG 矢量数据提取器
 *
 * 在浏览器上下文中提取 SVG 元素的矢量信息
 */

import type { SVGData, SVGPath, SVGCircle, SVGRect, SVGPolygon } from "@vzi-core/types";

/**
 * 提取 SVG 矢量数据
 *
 * 注意：此函数设计为在浏览器上下文中执行（Puppeteer page.evaluate）
 */
export function extractSVGData(svgElement: SVGSVGElement): SVGData | undefined {
  if (!svgElement || svgElement.tagName.toLowerCase() !== "svg") {
    return undefined;
  }

  const computedStyle = window.getComputedStyle(svgElement);
  const currentColor = computedStyle.color;

  // 提取 viewBox
  let viewBox = svgElement.getAttribute("viewBox") || undefined;

  // 如果没有 viewBox，根据 width/height 生成
  if (!viewBox) {
    const width = svgElement.width.baseVal.value || parseFloat(svgElement.getAttribute("width") || "0");
    const height = svgElement.height.baseVal.value || parseFloat(svgElement.getAttribute("height") || "0");
    if (width > 0 && height > 0) {
      viewBox = `0 0 ${width} ${height}`;
    }
  }

  // 提取 preserveAspectRatio
  const preserveAspectRatio = svgElement.getAttribute("preserveAspectRatio") || undefined;

  // 提取所有形状元素
  const paths: SVGPath[] = [];
  const circles: SVGCircle[] = [];
  const rects: SVGRect[] = [];
  const polygons: SVGPolygon[] = [];

  // 递归遍历 SVG 元素树
  function traverseElement(element: Element, inheritedFill?: string, inheritedStroke?: string): void {
    const tagName = element.tagName.toLowerCase();
    const computedStyle = window.getComputedStyle(element);

    // 获取填充和描边（继承或当前）
    let fill = element.getAttribute("fill") || inheritedFill;
    let stroke = element.getAttribute("stroke") || inheritedStroke;

    // 处理 currentColor
    if (fill === "currentColor") {
      fill = currentColor;
    }
    if (stroke === "currentColor") {
      stroke = currentColor;
    }

    // 从 computed style 获取（如果属性未设置）
    if (!fill && computedStyle.fill && computedStyle.fill !== "none") {
      fill = computedStyle.fill;
    }
    if (!stroke && computedStyle.stroke && computedStyle.stroke !== "none") {
      stroke = computedStyle.stroke;
    }

    const strokeWidth = parseFloat(element.getAttribute("stroke-width") || computedStyle.strokeWidth || "0");
    const opacity = parseFloat(element.getAttribute("opacity") || computedStyle.opacity || "1");

    // 提取不同类型的元素
    if (tagName === "path") {
      const d = element.getAttribute("d");
      if (d) {
        const fillRule = (element.getAttribute("fill-rule") || computedStyle.fillRule || "nonzero") as
          | "nonzero"
          | "evenodd";
        paths.push({
          d,
          fill: fill !== "none" ? fill : undefined,
          stroke: stroke !== "none" ? stroke : undefined,
          strokeWidth: strokeWidth > 0 ? strokeWidth : undefined,
          fillRule,
          opacity: opacity < 1 ? opacity : undefined,
        });
      }
    } else if (tagName === "circle") {
      const cx = parseFloat(element.getAttribute("cx") || "0");
      const cy = parseFloat(element.getAttribute("cy") || "0");
      const r = parseFloat(element.getAttribute("r") || "0");
      if (r > 0) {
        circles.push({
          cx,
          cy,
          r,
          fill: fill !== "none" ? fill : undefined,
          stroke: stroke !== "none" ? stroke : undefined,
          strokeWidth: strokeWidth > 0 ? strokeWidth : undefined,
          opacity: opacity < 1 ? opacity : undefined,
        });
      }
    } else if (tagName === "rect") {
      const x = parseFloat(element.getAttribute("x") || "0");
      const y = parseFloat(element.getAttribute("y") || "0");
      const width = parseFloat(element.getAttribute("width") || "0");
      const height = parseFloat(element.getAttribute("height") || "0");
      const rx = parseFloat(element.getAttribute("rx") || "0");
      const ry = parseFloat(element.getAttribute("ry") || "0");
      if (width > 0 && height > 0) {
        rects.push({
          x,
          y,
          width,
          height,
          rx: rx > 0 ? rx : undefined,
          ry: ry > 0 ? ry : undefined,
          fill: fill !== "none" ? fill : undefined,
          stroke: stroke !== "none" ? stroke : undefined,
          strokeWidth: strokeWidth > 0 ? strokeWidth : undefined,
          opacity: opacity < 1 ? opacity : undefined,
        });
      }
    } else if (tagName === "polygon" || tagName === "polyline") {
      const points = element.getAttribute("points");
      if (points) {
        polygons.push({
          points,
          fill: fill !== "none" ? fill : undefined,
          stroke: stroke !== "none" ? stroke : undefined,
          strokeWidth: strokeWidth > 0 ? strokeWidth : undefined,
          opacity: opacity < 1 ? opacity : undefined,
        });
      }
    } else if (tagName === "g") {
      // 递归处理分组，传递继承的样式
      for (const child of element.children) {
        traverseElement(child, fill, stroke);
      }
      return; // 不继续处理 g 的子元素
    }

    // 递归处理子元素
    for (const child of element.children) {
      traverseElement(child, fill, stroke);
    }
  }

  // 开始遍历
  traverseElement(svgElement);

  // 如果没有任何形状，返回 undefined
  if (
    paths.length === 0 &&
    (!circles || circles.length === 0) &&
    (!rects || rects.length === 0) &&
    (!polygons || polygons.length === 0)
  ) {
    return undefined;
  }

  const svgData: SVGData = {
    viewBox,
    preserveAspectRatio,
    paths,
  };

  if (circles && circles.length > 0) {
    svgData.circles = circles;
  }
  if (rects && rects.length > 0) {
    svgData.rects = rects;
  }
  if (polygons && polygons.length > 0) {
    svgData.polygons = polygons;
  }

  return svgData;
}
