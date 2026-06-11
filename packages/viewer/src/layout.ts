import type { PositionedTile, ViewerGroup, ViewerTile } from "./model.js";

/** tile 之间的画布间距(px)。 */
export const TILE_GAP = 80;

/**
 * 把 tiles 按 group 布到无限画布:
 * - 默认(singleRow=false):每个 group 一行(page 一行),行 y 依次累加。
 * - singleRow=true:所有 tile 排在同一横行(跨 group 累加 x、y 恒为 0),
 *   用于设计稿/品牌画布让设计稿像标注那样横向排。
 * - 行内 tile 从左到右按 group.tileIds 顺序排,水平间距 TILE_GAP。
 */
export function layoutTiles(tiles: ViewerTile[], groups: ViewerGroup[], singleRow = false): PositionedTile[] {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const positioned: PositionedTile[] = [];
  let rowY = 0;
  let cursorX = 0;

  for (const group of groups) {
    if (!singleRow) cursorX = 0;
    let rowHeight = 0;
    for (const tileId of group.tileIds) {
      const tile = byId.get(tileId);
      if (!tile) continue;
      positioned.push({ ...tile, x: cursorX, y: rowY });
      cursorX += tile.width + TILE_GAP;
      rowHeight = Math.max(rowHeight, tile.height);
    }
    if (!singleRow) rowY += rowHeight + TILE_GAP;
  }

  return positioned;
}
