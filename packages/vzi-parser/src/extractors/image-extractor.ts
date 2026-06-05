/**
 * 图片数据提取器
 *
 * 在浏览器上下文中提取图片元素的元数据
 */

import type { ImageData } from "@vzi-core/types";

/**
 * 提取图片数据
 *
 * 注意：此函数设计为在浏览器上下文中执行（Puppeteer page.evaluate）
 */
export function extractImageData(imgElement: HTMLImageElement): ImageData | undefined {
  if (!imgElement || imgElement.tagName.toLowerCase() !== "img") {
    return undefined;
  }

  // 获取图片源（优先使用 currentSrc，它会考虑 srcset）
  const src = imgElement.currentSrc || imgElement.src;

  if (!src) {
    return undefined;
  }

  // 检测是否为 base64
  const isBase64 = src.startsWith("data:");

  // 从 src 推断格式
  let format: ImageData["format"];
  if (isBase64) {
    // 从 data URL 提取格式
    const match = src.match(/^data:image\/(png|jpg|jpeg|svg\+xml|webp|gif|bmp)/i);
    if (match) {
      const formatStr = match[1].toLowerCase();
      if (formatStr === "svg+xml") {
        format = "svg";
      } else {
        format = formatStr as ImageData["format"];
      }
    }
  } else {
    // 从 URL 提取格式
    const match = src.match(/\.(png|jpg|jpeg|svg|webp|gif|bmp)(\?|#|$)/i);
    if (match) {
      format = match[1].toLowerCase() as ImageData["format"];
    }
  }

  // 获取图片原始尺寸
  let naturalWidth = imgElement.naturalWidth;
  let naturalHeight = imgElement.naturalHeight;

  // 如果图片未加载或加载失败，使用显示尺寸作为后备
  if (naturalWidth === 0 || naturalHeight === 0) {
    naturalWidth = imgElement.width || 0;
    naturalHeight = imgElement.height || 0;
  }

  // 获取 alt 文本
  const alt = imgElement.alt || undefined;

  return {
    src,
    naturalWidth,
    naturalHeight,
    format,
    isBase64,
    alt,
  };
}
