import type { PositionedTile, ResourceResolver } from "../model.js";

export interface DesignTileProps {
  tile: PositionedTile;
  resolver: ResourceResolver;
}

/**
 * 设计画布瓦片:在沙箱 iframe 里渲染自包含静态 HTML。
 * sandbox 明确不含 allow-scripts —— 设计稿是纯静态产物,禁止脚本执行。
 */
export function DesignTile({ tile, resolver }: DesignTileProps): React.ReactElement {
  const src = resolver.resolve(tile.htmlBundle);
  return (
    <iframe
      title={tile.title}
      src={src}
      width={tile.width}
      height={tile.height}
      // 允许同源资源读取与表单展示,但不含 allow-scripts。
      sandbox="allow-same-origin allow-forms"
      style={{ border: "none", display: "block", background: "#fff" }}
    />
  );
}
