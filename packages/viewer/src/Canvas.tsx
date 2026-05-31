import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useReactFlow,
  type Node,
  type NodeProps,
  type NodeTypes
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { CanvasMode, PositionedTile, ResourceResolver, ViewerModel } from "./model.js";
import { DesignTile } from "./tiles/DesignTile.js";
import { AnnotationTile } from "./tiles/AnnotationTile.js";

export interface CanvasProps {
  model: ViewerModel;
  mode: CanvasMode;
  resolver: ResourceResolver;
  /** 外部要求定位到的 tile id;变化时居中到该 tile。 */
  locateTileId?: string | null;
  /** 定位请求序号;同一 tile 重复定位时递增以强制重新居中。 */
  locateRequestId?: number;
}

/** 自定义节点 data 载荷。 */
interface TileNodeData extends Record<string, unknown> {
  tile: PositionedTile;
  mode: CanvasMode;
  resolver: ResourceResolver;
}
type TileNode = Node<TileNodeData, "tile">;

/** React Flow 自定义节点:按模式选渲染器。 */
function TileNodeComponent({ data }: NodeProps<TileNode>): React.ReactElement {
  return data.mode === "design" ? (
    <DesignTile tile={data.tile} resolver={data.resolver} />
  ) : (
    <AnnotationTile tile={data.tile} resolver={data.resolver} />
  );
}

// monorepo 内 @types/react 18(desktop)与 19(viewer)并存,@xyflow/react 不声明
// @types/react peer,其 NodeTypes 经类型解析落到 @types/react@18 的 ReactNode(无 bigint),
// 与 viewer 的 19 不兼容。运行时只有单份 react@19、@xyflow 12 完整支持 React 19,故此处
// 仅做类型层断言消除跨版本 @types 摩擦。
const nodeTypes = { tile: TileNodeComponent } as NodeTypes;

function CanvasInner({ model, mode, resolver, locateTileId, locateRequestId }: CanvasProps): React.ReactElement {
  const rf = useReactFlow();
  const nodes = useMemo<TileNode[]>(
    () =>
      model.tiles.map((tile) => ({
        id: tile.id,
        type: "tile",
        position: { x: tile.x, y: tile.y },
        data: { tile, mode, resolver },
        width: tile.width,
        height: tile.height,
        draggable: false,
        selectable: true,
        connectable: false
      })),
    [model.tiles, mode, resolver]
  );

  useEffect(() => {
    if (!locateTileId) return;
    const tile = model.tiles.find((t) => t.id === locateTileId);
    if (!tile) return;
    // 居中到 tile 中心。setCenter(x, y, { zoom?, duration? }) 已按 @xyflow/react v12 核实。
    rf.setCenter(tile.x + tile.width / 2, tile.y + tile.height / 2, { zoom: 1, duration: 300 });
  }, [locateRequestId, locateTileId, model.tiles, rf]);

  // 只渲视口内 tile;不要默认 fitView,否则全图缩进视口会破坏离屏卸载验收。
  return (
    <ReactFlow
      nodes={nodes}
      edges={[]}
      nodeTypes={nodeTypes}
      onlyRenderVisibleElements
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      proOptions={{ hideAttribution: false }}
    >
      <Background />
    </ReactFlow>
  );
}

export function Canvas(props: CanvasProps): React.ReactElement {
  return (
    <ReactFlowProvider>
      <div style={{ width: "100%", height: "100%" }}>
        <CanvasInner {...props} />
      </div>
    </ReactFlowProvider>
  );
}
