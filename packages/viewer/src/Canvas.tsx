import { useEffect } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useReactFlow,
  useNodesState,
  type Node,
  type NodeProps,
  type NodeTypes,
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
  /** 初始选中的 tile id;用于测试及外部预选定(BC3 等)。设置后该 tile 以 selected 状态初始渲染。 */
  defaultSelectedTileId?: string | null;
}

/** 自定义节点 data 载荷。 */
interface TileNodeData extends Record<string, unknown> {
  tile: PositionedTile;
  mode: CanvasMode;
  resolver: ResourceResolver;
}
type TileNode = Node<TileNodeData, "tile">;

/**
 * 选中框:选中 tile 时渲染在 tile 之上,对齐 annotation FocusFrame 的视觉风格。
 * 使用 pointer-events:none 避免遮挡点击。
 */
function SelectionFrame(): React.ReactElement {
  return (
    <div
      data-testid="selection-frame"
      style={{
        position: "absolute",
        inset: -6,
        borderRadius: 8,
        border: "2px solid #1d4ed8",
        background: "rgba(219,234,254,0.15)",
        pointerEvents: "none",
        boxShadow: "0 0 0 1px rgba(29,78,216,0.12)",
      }}
    />
  );
}

/** React Flow 自定义节点:按模式选渲染器;设计模式附加 title 标签 + 选中框。*/
function TileNodeComponent({ data, selected }: NodeProps<TileNode>): React.ReactElement {
  if (data.mode === "design") {
    return (
      <div style={{ position: "relative" }}>
        {/* 每 tile 标题标签:左对齐,浮于 tile 顶边上方 — 对齐 PageFrameOverlays 风格。
            focused → blue-700 (#1d4ed8);默认 → zinc-600 (#52525b),与 annotation AA palette 一致。*/}
        <div
          data-testid="tile-title"
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            marginBottom: 6,
            fontSize: 12,
            fontWeight: 500,
            lineHeight: "1.4",
            color: selected ? "#1d4ed8" : "#52525b",
            maxWidth: 240,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          {data.tile.title}
        </div>
        <DesignTile tile={data.tile} resolver={data.resolver} />
        {selected && <SelectionFrame />}
      </div>
    );
  }
  return <AnnotationTile tile={data.tile} resolver={data.resolver} />;
}

const nodeTypes: NodeTypes = { tile: TileNodeComponent };

/** 由 tile 数据派生节点(不含选中态 — 选中态由 React Flow store 拥有)。 */
function buildTileNodes(tiles: PositionedTile[], mode: CanvasMode, resolver: ResourceResolver): TileNode[] {
  return tiles.map((tile) => ({
    id: tile.id,
    type: "tile",
    position: { x: tile.x, y: tile.y },
    data: { tile, mode, resolver },
    width: tile.width,
    height: tile.height,
    draggable: false,
    selectable: true,
    connectable: false,
  }));
}

function CanvasInner({ model, mode, resolver, locateTileId, locateRequestId, defaultSelectedTileId }: CanvasProps): React.ReactElement {
  const rf = useReactFlow();
  // React Flow owns selection (via onNodesChange). defaultSelectedTileId only SEEDS the
  // initial state once; click-selection thereafter flows through onNodesChange and is
  // preserved across model refreshes below — it is never re-applied from the prop.
  const [nodes, setNodes, onNodesChange] = useNodesState<TileNode>(
    buildTileNodes(model.tiles, mode, resolver).map((n) => ({
      ...n,
      selected: defaultSelectedTileId != null && n.id === defaultSelectedTileId,
    })),
  );

  // Re-derive nodes when the underlying tile data changes, preserving the live
  // selection so a model refresh never clobbers the user's current selection.
  useEffect(() => {
    setNodes((prev) => {
      const selectedIds = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      return buildTileNodes(model.tiles, mode, resolver).map((n) => ({ ...n, selected: selectedIds.has(n.id) }));
    });
  }, [model.tiles, mode, resolver, setNodes]);

  useEffect(() => {
    if (!locateTileId) return;
    const tile = model.tiles.find((t) => t.id === locateTileId);
    if (!tile) return;
    // 居中到 tile 中心。setCenter(x, y, { zoom?, duration? }) 已按 @xyflow/react v12 核实。
    rf.setCenter(tile.x + tile.width / 2, tile.y + tile.height / 2, { zoom: 1, duration: 300 });
  }, [locateRequestId, locateTileId, model.tiles, rf]);

  // 只渲视口内 tile;不要默认 fitView,否则全图缩进视口会破坏离屏卸载验收。
  // pan/zoom feel 与 annotation canvas 对齐:滚轮缩放 + 左键拖拽平移。
  return (
    <ReactFlow
      nodes={nodes}
      onNodesChange={onNodesChange}
      edges={[]}
      nodeTypes={nodeTypes}
      onlyRenderVisibleElements
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      panOnDrag
      zoomOnScroll
      panOnScroll={false}
      minZoom={0.1}
      maxZoom={4}
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
