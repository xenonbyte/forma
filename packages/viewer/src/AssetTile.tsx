export interface AssetTileProps {
  /** Asset display name (also used as the thumbnail alt text). */
  name: string;
  /** Resolved thumbnail URL — the served brand-asset file. */
  src: string;
  /** Intrinsic pixel width, shown in the size label. */
  width: number;
  /** Intrinsic pixel height, shown in the size label. */
  height: number;
  /** When true, render the stale badge (asset brand_style drifted from product). */
  stale?: boolean;
  /** Localized stale-badge label; defaults to an English fallback so the lib stays i18n-free. */
  staleLabel?: string;
  /** Localized download-button label; defaults to an English fallback. */
  downloadLabel?: string;
  /** Triggered when the user clicks the download control. */
  onDownload: () => void;
}

/**
 * 品牌资产瓦片:缩略图 + 尺寸标签 + 下载按钮 + 可选「过期」徽标。
 * 纯展示组件 —— 不取数、不依赖 web 层;src 由调用方解析为可访问的 URL。
 * stale 由 web 层按 asset.brand_style !== product.brand_style 计算后传入(D11:仅视觉提示,不自动重生成)。
 */
export function AssetTile({
  name,
  src,
  width,
  height,
  stale = false,
  staleLabel = "May be stale",
  downloadLabel = "Download",
  onDownload,
}: AssetTileProps): React.ReactElement {
  return (
    <div
      data-testid="asset-tile"
      style={{
        position: "relative",
        display: "inline-flex",
        flexDirection: "column",
        gap: 6,
        padding: 8,
        borderRadius: 10,
        border: "1px solid #e4e4e7",
        background: "#fff",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      {stale && (
        <span
          data-testid="asset-tile-stale"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 1,
            padding: "2px 8px",
            borderRadius: 9999,
            fontSize: 11,
            fontWeight: 600,
            lineHeight: "1.4",
            color: "#92400e",
            background: "#fef3c7",
            border: "1px solid #fcd34d",
          }}
        >
          {staleLabel}
        </span>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 160,
          height: 160,
          borderRadius: 8,
          overflow: "hidden",
          background: "#fafafa",
        }}
      >
        <img
          src={src}
          alt={name}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "#52525b",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {width}×{height}
        </span>
        <button
          type="button"
          data-testid="asset-tile-download"
          onClick={onDownload}
          aria-label={`${downloadLabel} ${name}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid #d4d4d8",
            background: "#fff",
            fontSize: 12,
            fontWeight: 600,
            color: "#3f3f46",
            cursor: "pointer",
          }}
        >
          {downloadLabel}
        </button>
      </div>
    </div>
  );
}
