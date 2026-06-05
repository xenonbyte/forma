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
}

export interface BuildViewerModelInput {
  entry: ViewerEntry;
  artifacts: NormalizeArtifactInput[];
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
    htmlBundle: { artifactId: a.artifactId, version: a.version, kind: "bundle" },
    previewImages: buildPreviewRefs(a),
  }));

  const groups = buildGroups(tiles);
  const positioned = layoutTiles(tiles, groups);

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
