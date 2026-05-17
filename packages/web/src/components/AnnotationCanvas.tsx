import { useEffect, useMemo, useRef, useState } from "react";

import type { AnnotationNode } from "../api.js";

export interface AnnotationCanvasProps {
  imageUrl?: string;
  nodes: AnnotationNode[];
  onHoverNode?: (node: AnnotationNode | null) => void;
  onSelectNode?: (node: AnnotationNode) => void;
  selectedNodeId?: string;
  selectedNodeIds?: string[];
  spacing?: NodeSpacingMeasurement | null;
}

export interface AnnotationSceneOptions {
  container: HTMLElement;
  imageUrl?: string;
  nodes: AnnotationNode[];
  onHoverNode?: (node: AnnotationNode | null) => void;
  onSelectNode?: (node: AnnotationNode) => void;
  selectedNodeIds?: string[];
  size: CanvasSize;
  spacing?: NodeSpacingMeasurement | null;
}

export interface AnnotationScene {
  dispose(): void;
  leafer: LeaferInstance;
}

export interface LeaferRuntime {
  Leafer: new (config: Record<string, unknown>) => LeaferInstance;
  PointerEvent: {
    CLICK: string;
    ENTER: string;
    LEAVE: string;
  };
  Rect: new (config: Record<string, unknown>) => LeaferRect;
}

interface CanvasSize {
  height: number;
  width: number;
}

export interface NodeSpacingMeasurement {
  fromCenter: Point;
  fromId: string;
  horizontal: SpacingAxisMeasurement;
  toCenter: Point;
  toId: string;
  vertical: SpacingAxisMeasurement;
}

interface Point {
  x: number;
  y: number;
}

export interface SpacingAxisMeasurement {
  mode: "center-delta" | "edge-gap";
  value: number;
}

interface LeaferInstance {
  add(rect: LeaferRect): void;
  destroy(): void;
  lockLayout?: () => void;
  requestRender?: () => void;
  unlockLayout?: () => void;
}

interface LeaferRect {
  on(eventName: string, handler: () => void): unknown;
  stroke?: string;
  strokeWidth?: number;
}

const selectedStroke = "#d97706";
const hoverStroke = "#2563eb";
const transparentFill = "rgba(245, 158, 11, 0.01)";
const transparentStroke = "rgba(245, 158, 11, 0)";
const spacingStroke = "#2563eb";

export function AnnotationCanvas({
  imageUrl,
  nodes,
  onHoverNode,
  onSelectNode,
  selectedNodeId,
  selectedNodeIds,
  spacing
}: AnnotationCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const selectedIds = selectedNodeIds ?? (selectedNodeId ? [selectedNodeId] : []);
  const selectedIdsKey = selectedIds.join("\u0000");
  const size = useMemo(() => resolveCanvasSize(nodes), [nodes]);
  const selectedNodes = useMemo(
    () => selectedIds.map((id) => nodes.find((node) => node.id === id)).filter((node): node is AnnotationNode => Boolean(node)),
    [nodes, selectedIdsKey]
  );
  const resolvedSpacing = useMemo(
    () => spacing ?? (selectedNodes.length === 2 ? calculateNodeSpacing(selectedNodes[0], selectedNodes[1]) : null),
    [selectedNodes, spacing]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || nodes.length === 0) {
      return undefined;
    }

    let disposed = false;
    let scene: AnnotationScene | null = null;
    setRuntimeError(null);
    container.replaceChildren();
    void loadLeaferRuntime()
      .then((runtime) => {
        if (disposed) {
          return;
        }
        scene = mountAnnotationCanvasScene(
          {
            container,
            imageUrl,
            nodes,
            onHoverNode,
            onSelectNode,
            selectedNodeIds: selectedIds,
            size,
            spacing: resolvedSpacing
          },
          runtime
        );
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setRuntimeError(error instanceof Error ? error.message : "Annotation runtime failed");
        }
      });

    return () => {
      disposed = true;
      scene?.dispose();
      container.replaceChildren();
    };
  }, [imageUrl, nodes, onHoverNode, onSelectNode, resolvedSpacing, selectedIdsKey, size]);

  return (
    <div className="space-y-3">
      <div
        aria-label="Annotation canvas"
        className="relative w-full overflow-hidden rounded-md border border-zinc-200 bg-zinc-100"
        style={{ aspectRatio: `${size.width} / ${size.height}` }}
      >
        {!imageUrl ? (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm font-medium text-zinc-500">
            Preview image unavailable
          </div>
        ) : null}
        <div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full" ref={containerRef} />
        {nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 px-4 text-center text-sm font-medium text-zinc-500">
            No annotation nodes
          </div>
        ) : null}
        {runtimeError ? (
          <div className="absolute inset-x-3 top-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            Annotation runtime unavailable: {runtimeError}
          </div>
        ) : null}
        {runtimeError && imageUrl ? (
          <img alt="Design preview fallback" className="absolute inset-0 h-full w-full object-contain" src={imageUrl} />
        ) : null}
        <div className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] rounded-md border border-zinc-200 bg-white/95 px-2.5 py-1.5 text-xs shadow-sm">
          <span className="font-medium text-zinc-700">{nodes.length} nodes</span>
          {selectedNodes.length > 0 ? <span className="ml-2 text-zinc-500">Selected: {selectedNodes.map((node) => node.name).join(", ")}</span> : null}
        </div>
      </div>
    </div>
  );
}

export function mountAnnotationCanvasScene({
  container,
  imageUrl,
  nodes,
  onHoverNode,
  onSelectNode,
  selectedNodeIds = [],
  size,
  spacing
}: AnnotationSceneOptions, runtime: LeaferRuntime): AnnotationScene {
  const leafer = new runtime.Leafer({
    fill: "rgba(255, 255, 255, 0)",
    height: size.height,
    hittable: true,
    view: container,
    wheel: { zoomMode: "mouse", moveSpeed: 0.5, zoomSpeed: 0.5 },
    width: size.width
  });

  leafer.lockLayout?.();
  if (imageUrl) {
    leafer.add(
      new runtime.Rect({
        fill: { type: "image", url: imageUrl, mode: "fit" },
        height: size.height,
        hitSelf: false,
        hittable: false,
        name: "preview-image",
        width: size.width,
        x: 0,
        y: 0
      })
    );
  }

  for (const node of nodes) {
    if (!isDrawableNode(node)) {
      continue;
    }

    const selected = selectedNodeIds.includes(node.id);
    const rect = new runtime.Rect({
      cursor: "pointer",
      data: { nodeId: node.id },
      fill: transparentFill,
      height: node.height,
      hitFill: "all",
      name: node.id,
      stroke: selected ? selectedStroke : transparentStroke,
      strokeWidth: selected ? 3 : 1,
      width: node.width,
      x: node.x,
      y: node.y
    });

    rect.on(runtime.PointerEvent.ENTER, () => {
      applyRectState(rect, true, selected);
      onHoverNode?.(node);
      leafer.requestRender?.();
    });
    rect.on(runtime.PointerEvent.LEAVE, () => {
      applyRectState(rect, false, selected);
      onHoverNode?.(null);
      leafer.requestRender?.();
    });
    rect.on(runtime.PointerEvent.CLICK, () => {
      onSelectNode?.(node);
    });
    leafer.add(rect);
  }
  if (spacing) {
    addSpacingOverlay(leafer, runtime, spacing);
  }
  leafer.unlockLayout?.();

  return {
    leafer,
    dispose: () => {
      leafer.destroy();
    }
  };
}

async function loadLeaferRuntime(): Promise<LeaferRuntime> {
  const runtime = await import("leafer-ui");
  return {
    Leafer: runtime.Leafer as LeaferRuntime["Leafer"],
    PointerEvent: {
      CLICK: runtime.PointerEvent.CLICK,
      ENTER: runtime.PointerEvent.ENTER,
      LEAVE: runtime.PointerEvent.LEAVE
    },
    Rect: runtime.Rect as LeaferRuntime["Rect"]
  };
}

function applyRectState(rect: LeaferRect, hovered: boolean, selected: boolean): void {
  rect.stroke = selected ? selectedStroke : hovered ? hoverStroke : transparentStroke;
  rect.strokeWidth = selected ? 3 : hovered ? 2 : 1;
}

export function calculateNodeSpacing(from: AnnotationNode, to: AnnotationNode): NodeSpacingMeasurement {
  const fromCenter = centerOf(from);
  const toCenter = centerOf(to);
  return {
    fromCenter,
    fromId: from.id,
    horizontal: axisSpacing(from.x, from.x + from.width, to.x, to.x + to.width, fromCenter.x, toCenter.x),
    toCenter,
    toId: to.id,
    vertical: axisSpacing(from.y, from.y + from.height, to.y, to.y + to.height, fromCenter.y, toCenter.y)
  };
}

function addSpacingOverlay(leafer: LeaferInstance, runtime: LeaferRuntime, spacing: NodeSpacingMeasurement): void {
  const horizontalX = Math.min(spacing.fromCenter.x, spacing.toCenter.x);
  const horizontalWidth = Math.max(2, Math.abs(spacing.toCenter.x - spacing.fromCenter.x));
  const horizontalY = (spacing.fromCenter.y + spacing.toCenter.y) / 2 - 1;
  leafer.add(
    new runtime.Rect({
      fill: spacingStroke,
      height: 2,
      hitSelf: false,
      hittable: false,
      name: "spacing-horizontal",
      opacity: 0.8,
      width: horizontalWidth,
      x: horizontalX,
      y: horizontalY
    })
  );

  const verticalY = Math.min(spacing.fromCenter.y, spacing.toCenter.y);
  const verticalHeight = Math.max(2, Math.abs(spacing.toCenter.y - spacing.fromCenter.y));
  const verticalX = (spacing.fromCenter.x + spacing.toCenter.x) / 2 - 1;
  leafer.add(
    new runtime.Rect({
      fill: spacingStroke,
      height: verticalHeight,
      hitSelf: false,
      hittable: false,
      name: "spacing-vertical",
      opacity: 0.8,
      width: 2,
      x: verticalX,
      y: verticalY
    })
  );
}

function axisSpacing(fromStart: number, fromEnd: number, toStart: number, toEnd: number, fromCenter: number, toCenter: number): SpacingAxisMeasurement {
  if (fromEnd <= toStart) {
    return { mode: "edge-gap", value: roundMeasurement(toStart - fromEnd) };
  }
  if (toEnd <= fromStart) {
    return { mode: "edge-gap", value: roundMeasurement(fromStart - toEnd) };
  }
  return { mode: "center-delta", value: roundMeasurement(toCenter - fromCenter) };
}

function centerOf(node: AnnotationNode): Point {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2
  };
}

function roundMeasurement(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveCanvasSize(nodes: AnnotationNode[]): CanvasSize {
  const root = nodes.find((node) => !node.parent_id && node.width > 0 && node.height > 0);
  if (root) {
    return {
      height: normalizeDimension(root.height),
      width: normalizeDimension(root.width)
    };
  }

  const width = Math.max(1, ...nodes.map((node) => node.x + node.width));
  const height = Math.max(1, ...nodes.map((node) => node.y + node.height));
  return {
    height: normalizeDimension(height || 720),
    width: normalizeDimension(width || 1280)
  };
}

function normalizeDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 1;
}

function isDrawableNode(node: AnnotationNode): boolean {
  return Number.isFinite(node.x) && Number.isFinite(node.y) && node.width > 0 && node.height > 0;
}
