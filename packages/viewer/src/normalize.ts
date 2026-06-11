import { layoutTiles } from "./layout.js";
import type { ArtifactKind, ViewerEntry, ViewerGroup, ViewerModel, ViewerTile } from "./model.js";

/** 传输中性的单个 artifact 输入(web/desktop 各自映射到此)。 */
export interface NormalizeArtifactInput {
  artifactId: string;
  kind: ArtifactKind;
  pageId: string;
  pageName: string;
  variant: string;
  title: string;
  version: number;
  width: number;
  height: number;
  /** 设备平台(可选);透传到 tile 用于平台图标。 */
  platform?: string;
  /** bundle 内子文档相对路径;设了则 htmlBundle 解析为该 asset 而非 bundle 入口。 */
  bundlePath?: string;
}

export interface BuildViewerModelInput {
  entry: ViewerEntry;
  artifacts: NormalizeArtifactInput[];
  /**
   * 画布布局:"rows"(默认)= 每个 page group 一行;"single-row" = 所有 tile 同一横行,
   * 让设计稿像标注那样横向排。
   */
  layout?: "rows" | "single-row";
}

function tileId(a: NormalizeArtifactInput): string {
  return `${a.artifactId}:${a.version}:${a.variant}`;
}

/**
 * 把中性 artifact 列表规范化为 ViewerModel:
 * - 按首次出现顺序保持页分组顺序;组内按 variant 字典序排序(default 优先)。
 * - 为每个 tile 生成不透明 htmlBundle / previewImages(1x/2x) 引用。
 * - 调 layoutTiles 计算非重叠画布坐标。
 */
export function buildViewerModel(input: BuildViewerModelInput): ViewerModel {
  const tiles: ViewerTile[] = input.artifacts.map((a) => ({
    id: tileId(a),
    kind: a.kind,
    pageId: a.pageId,
    pageName: a.pageName,
    variant: a.variant,
    title: a.title,
    version: a.version,
    width: a.width,
    height: a.height,
    ...(a.platform !== undefined ? { platform: a.platform } : {}),
    htmlBundle:
      a.bundlePath !== undefined
        ? { artifactId: a.artifactId, version: a.version, kind: "asset" as const, path: a.bundlePath }
        : { artifactId: a.artifactId, version: a.version, kind: "bundle" as const },
    previewImages: buildPreviewRefs(a),
  }));

  const groups = buildGroups(tiles);
  const positioned = layoutTiles(tiles, groups, input.layout === "single-row");

  return { entry: input.entry, tiles: positioned, groups };
}

function buildPreviewRefs(a: NormalizeArtifactInput): ViewerTile["previewImages"] {
  return {
    "1x": { artifactId: a.artifactId, version: a.version, kind: "preview", density: "1x" },
    "2x": { artifactId: a.artifactId, version: a.version, kind: "preview", density: "2x" },
  };
}

function buildGroups(tiles: ViewerTile[]): ViewerGroup[] {
  const order: string[] = [];
  const byPage = new Map<string, ViewerTile[]>();
  for (const tile of tiles) {
    if (!byPage.has(tile.pageId)) {
      byPage.set(tile.pageId, []);
      order.push(tile.pageId);
    }
    byPage.get(tile.pageId)!.push(tile);
  }

  return order.map((pageId) => {
    const pageTiles = byPage.get(pageId)!;
    const sorted = [...pageTiles].sort(compareVariant);
    return {
      pageId,
      pageName: pageTiles[0].pageName,
      tileIds: sorted.map((t) => t.id),
    };
  });
}

/** "default" 永远排首位,其余按字典序。 */
function compareVariant(a: ViewerTile, b: ViewerTile): number {
  if (a.variant === b.variant) return 0;
  if (a.variant === "default") return -1;
  if (b.variant === "default") return 1;
  return a.variant < b.variant ? -1 : 1;
}
