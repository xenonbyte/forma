import type { NormalizeArtifactInput } from "@xenonbyte/forma-viewer";

/**
 * Desktop artifact 形状(与 preload forma.d.ts 的 FormaArtifact 同构;
 * 此处显式声明以免依赖 forma.d.ts 的模块作用域)。
 */
export interface FormaArtifact {
  id: string;
  kind: string;
  title: string;
  preview_url?: string;
  updated_at: string;
  requirement_id?: string;
  page_id?: string;
  variant?: string;
  current_version?: number;
}

/** 按平台的默认画布尺寸(后端 manifest 暂无 width/height;P8/P9 共用此映射)。 */
const PLATFORM_CANVAS: Record<string, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 834, height: 1112 },
  desktop: { width: 1280, height: 800 },
  web: { width: 1280, height: 800 }
};

export function canvasSizeForPlatform(platform: string | undefined): { width: number; height: number } {
  return PLATFORM_CANVAS[platform ?? "web"] ?? PLATFORM_CANVAS.web;
}

export interface MapArtifactsInput {
  artifacts: FormaArtifact[];
  /** requirement.pages 的 page_id→name(用于 tile pageName)。 */
  pages: Array<{ page_id: string; name: string }>;
  platform: string | undefined;
}

/**
 * 宿主 artifact 列表 → viewer 中性输入。只取 design-page 且 page_id/variant/current_version
 * 齐全者(这三者必须来自读取面,不得从 URL/标题推断)。width/height 按平台默认。
 */
export function mapArtifactsToViewerInputs(input: MapArtifactsInput): NormalizeArtifactInput[] {
  const pageName = new Map(input.pages.map((p) => [p.page_id, p.name]));
  const { width, height } = canvasSizeForPlatform(input.platform);
  const result: NormalizeArtifactInput[] = [];
  for (const a of input.artifacts) {
    if (a.kind !== "design-page") continue;
    if (!a.page_id || !a.variant || typeof a.current_version !== "number") continue;
    result.push({
      artifactId: a.id,
      kind: "design-page",
      pageId: a.page_id,
      pageName: pageName.get(a.page_id) ?? a.page_id,
      variant: a.variant,
      title: a.title,
      version: a.current_version,
      width,
      height
    });
  }
  return result;
}
