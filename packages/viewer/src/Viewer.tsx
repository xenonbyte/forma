import { useState } from "react";
import { Canvas } from "./Canvas.js";
import { DesignList } from "./DesignList.js";
import { AnnotationSlot } from "./AnnotationSlot.js";
import type { CanvasMode, ResourceResolver, ViewerModel } from "./model.js";

export interface ViewerProps {
  model: ViewerModel;
  resolver: ResourceResolver;
}

/** 顶层只读查看器:左 设计稿列表 / 中 画布 / 右 标注 slot + 画布模式切换。 */
export function Viewer({ model, resolver }: ViewerProps): React.ReactElement {
  const [mode, setMode] = useState<CanvasMode>("design");
  const [locateTileId, setLocateTileId] = useState<string | null>(null);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 280px", height: "100%", width: "100%" }}>
      <div style={{ borderRight: "1px solid #eee", minWidth: 0 }}>
        <DesignList model={model} onLocate={setLocateTileId} />
      </div>
      <div style={{ position: "relative", minWidth: 0 }}>
        <div style={{ position: "absolute", top: 8, right: 8, zIndex: 10, display: "flex", gap: 4 }}>
          <button
            type="button"
            data-action="mode-design"
            onClick={() => setMode("design")}
            aria-pressed={mode === "design"}
          >
            设计
          </button>
          <button
            type="button"
            data-action="mode-annotation"
            onClick={() => setMode("annotation")}
            aria-pressed={mode === "annotation"}
          >
            标注
          </button>
        </div>
        <Canvas model={model} mode={mode} resolver={resolver} locateTileId={locateTileId} />
      </div>
      <div style={{ borderLeft: "1px solid #eee", minWidth: 0 }}>
        <AnnotationSlot />
      </div>
    </div>
  );
}
