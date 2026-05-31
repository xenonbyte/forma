import type { ViewerModel } from "./model.js";

export interface DesignListProps {
  model: ViewerModel;
  /** 点击某 variant 行 → 通知外壳定位/跳转到对应 tile。 */
  onLocate: (tileId: string) => void;
}

/** 左侧设计稿列表:按 page 分组,组内列 variant;点击行触发定位。 */
export function DesignList({ model, onLocate }: DesignListProps): React.ReactElement {
  const tileById = new Map(model.tiles.map((t) => [t.id, t]));
  return (
    <nav aria-label="设计稿列表" style={{ overflowY: "auto", height: "100%", padding: 8 }}>
      {model.groups.map((group) => (
        <section key={group.pageId} style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: "4px 0" }}>{group.pageName}</h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {group.tileIds.map((tileId) => {
              const tile = tileById.get(tileId);
              return (
                <li key={tileId}>
                  <button
                    type="button"
                    data-tile-id={tileId}
                    onClick={() => onLocate(tileId)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "4px 8px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: 12
                    }}
                  >
                    {tile?.variant ?? tileId}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
