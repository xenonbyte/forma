import type { PositionedTile, ViewerGroup, ViewerTile } from "./model.js";

/** tile 之间的画布间距(px)。 */
export const TILE_GAP = 80;

/**
 * 把 tiles 按 group 布到无限画布:
 * - 每个 group 一行(page 一行)。
 * - 行内 tile 从左到右按 group.tileIds 顺序排,水平间距 TILE_GAP。
 * - 行高 = 该行最高 tile + TILE_GAP;行 y 依次累加。
 */
export function layoutTiles(tiles: ViewerTile[], groups: ViewerGroup[]): PositionedTile[] {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const positioned: PositionedTile[] = [];
  let rowY = 0;

  for (const group of groups) {
    let cursorX = 0;
    let rowHeight = 0;
    for (const tileId of group.tileIds) {
      const tile = byId.get(tileId);
      if (!tile) continue;
      positioned.push({ ...tile, x: cursorX, y: rowY });
      cursorX += tile.width + TILE_GAP;
      rowHeight = Math.max(rowHeight, tile.height);
    }
    rowY += rowHeight + TILE_GAP;
  }

  return positioned;
}
