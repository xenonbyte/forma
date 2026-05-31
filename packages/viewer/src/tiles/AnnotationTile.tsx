import type { PositionedTile, ResourceResolver } from "../model.js";

export interface AnnotationTileProps {
  tile: PositionedTile;
  resolver: ResourceResolver;
}

/**
 * 标注画布瓦片:渲染该 artifact 版本的 PNG 预览,用 src/srcSet 保留 1x/2x LOD。
 * 标注内容(右侧 slot)本期不实现,这里只是 PNG 底图。
 */
export function AnnotationTile({ tile, resolver }: AnnotationTileProps): React.ReactElement {
  const src = resolver.resolve(tile.previewImages["1x"]);
  const srcSet = `${resolver.resolve(tile.previewImages["2x"])} 2x`;
  return (
    <img
      src={src}
      srcSet={srcSet}
      alt={tile.title}
      width={tile.width}
      height={tile.height}
      style={{ display: "block", background: "#fff" }}
    />
  );
}
