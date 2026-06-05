import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type { BaselinePage } from "../api.js";
import { useT } from "../LocaleContext.js";
import {
  countFeatures,
  layoutNavigationGraph,
  type ForceLayoutEdge,
  type ForceLayoutNode,
  type ForceLayoutResult,
} from "../lib/force-layout.js";

export type NavigationGraphNavigationInput = { from: string; to: string; label?: string; trigger?: string };

export interface NavigationGraphProps {
  pages: BaselinePage[];
  navigation: NavigationGraphNavigationInput[];
}

interface NavigationGraphEdge {
  from: string;
  label: string;
  to: string;
}

interface NavigationGraphSceneOptions {
  container: HTMLElement;
  layout: ForceLayoutResult;
  onSelectPage: (pageId: string) => void;
  selectedPageId: string | null;
}

interface NavigationGraphScene {
  dispose(): void;
  leafer: LeaferInstance;
}

interface LeaferRuntime {
  Leafer: new (config: Record<string, unknown>) => LeaferInstance;
  Path: new (config: Record<string, unknown>) => LeaferElement;
  PointerEvent: {
    CLICK: string;
    ENTER: string;
    LEAVE: string;
  };
  Rect: new (config: Record<string, unknown>) => LeaferElement;
  Text: new (config: Record<string, unknown>) => LeaferElement;
}

interface LeaferInstance {
  add(element: LeaferElement): void;
  destroy(): void;
  lockLayout?: () => void;
  requestRender?: () => void;
  unlockLayout?: () => void;
}

interface LeaferElement {
  fill?: string;
  on?: (eventName: string, handler: () => void) => unknown;
  stroke?: string;
  strokeWidth?: number;
}

type GraphPoint = { x: number; y: number };
type GraphPathCommand = readonly ["M" | "L", number, number] | readonly ["Z"];

interface EdgeGeometry {
  arrowPath: GraphPathCommand[];
  labelPoint: GraphPoint;
  path: GraphPathCommand[];
}

const selectedStroke = "#d97706";
const nodeStroke = "#d4d4d8";
const hoverStroke = "#3B82F6";
const edgeStroke = "#a1a1aa";
const nodeFill = "#ffffff";
const selectedFill = "#fffbeb";
const arrowSize = 6;
const graphButtonClasses =
  "inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-white text-xs font-semibold text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

export function normalizeNavigation(input: NavigationGraphNavigationInput[]): NavigationGraphEdge[] {
  return input.map((edge) => ({
    from: edge.from,
    label: edge.trigger ?? edge.label ?? "No label",
    to: edge.to,
  }));
}

export function NavigationGraph({ pages, navigation }: NavigationGraphProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [viewAction, setViewAction] = useState<"fit" | "reset" | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? null;
  const normalizedNavigation = useMemo(() => normalizeNavigation(navigation), [navigation]);
  const layout = useMemo(
    () =>
      layoutNavigationGraph({
        nodes: pages.map((page) => ({ id: page.id, label: page.name, featureCount: countFeatures(page.features) })),
        edges: normalizedNavigation,
      }),
    [normalizedNavigation, pages],
  );

  useEffect(() => {
    if (selectedPageId && !pages.some((page) => page.id === selectedPageId)) {
      setSelectedPageId(null);
    }
  }, [pages, selectedPageId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || pages.length === 0) {
      return undefined;
    }

    let disposed = false;
    let scene: NavigationGraphScene | null = null;
    setRuntimeError(null);
    container.replaceChildren();

    void loadLeaferRuntime()
      .then((runtime) => {
        if (disposed) {
          return;
        }
        scene = mountNavigationGraphScene(
          {
            container,
            layout,
            onSelectPage: setSelectedPageId,
            selectedPageId,
          },
          runtime,
        );
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setRuntimeError(error instanceof Error ? error.message : "Navigation graph runtime failed");
        }
      });

    return () => {
      disposed = true;
      scene?.dispose();
      container.replaceChildren();
    };
  }, [layout, pages.length, selectedPageId]);

  if (pages.length === 0) {
    return <p className="text-sm text-zinc-500">No baseline pages to graph.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <GraphButton label={t("design.graphZoomOut")} onClick={() => changeZoom(-0.25)}>
          -
        </GraphButton>
        <GraphButton label={t("design.graphZoomIn")} onClick={() => changeZoom(0.25)}>
          +
        </GraphButton>
        <GraphButton label={t("design.graphFit")} onClick={fitGraph}>
          []
        </GraphButton>
        <GraphButton label={t("design.graphZoomOne")} onClick={() => setZoom(1)}>
          1
        </GraphButton>
        <GraphButton label={t("design.graphReset")} onClick={resetGraph}>
          R
        </GraphButton>
      </div>
      <div
        aria-label="Navigation graph"
        aria-describedby="navigation-graph-status"
        className="relative w-full overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
        onKeyDown={handleKeyDown}
        role="application"
        style={{ height: layout.height }}
        tabIndex={0}
      >
        <div
          className="absolute inset-0 origin-top-left [&>canvas]:h-full [&>canvas]:w-full"
          ref={containerRef}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        />
        {runtimeError ? (
          <div className="absolute inset-x-3 top-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            Navigation graph unavailable: {runtimeError}
          </div>
        ) : null}
      </div>

      <p
        id="navigation-graph-status"
        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
      >
        Zoom {Math.round(zoom * 100)}%
        <span className="ml-3">
          Pan {Math.round(pan.x)}, {Math.round(pan.y)}
        </span>
        {viewAction === "fit" ? <span className="ml-3">{t("design.graphFit")}</span> : null}
        {viewAction === "reset" ? <span className="ml-3">{t("design.graphReset")}</span> : null}
      </p>

      {normalizedNavigation.length === 0 ? <p className="text-sm text-zinc-500">暂无页面间导航关系</p> : null}

      <div aria-label="Graph nodes" className="sr-only">
        {pages.map((page) => (
          <button key={page.id} onClick={() => setSelectedPageId(page.id)} type="button">
            {page.name}
          </button>
        ))}
      </div>

      {selectedPage ? (
        <section className="border-t border-zinc-200 pt-4">
          <h3 className="text-sm font-semibold tracking-normal text-zinc-950">{selectedPage.name}</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-700">{selectedPage.features || "Empty"}</p>
        </section>
      ) : null}
    </div>
  );

  function changeZoom(delta: number) {
    setZoom((current) => Math.min(4, Math.max(0.25, Math.round((current + delta) * 100) / 100)));
    setViewAction(null);
  }

  function fitGraph() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setViewAction("fit");
  }

  function resetGraph() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setViewAction("reset");
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 240 : 48;
    if (
      event.key === "ArrowRight" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowUp"
    ) {
      event.preventDefault();
      setPan((current) => ({
        x: current.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
        y: current.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
      }));
      setViewAction(null);
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeZoom(0.25);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      changeZoom(-0.25);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      setZoom(1);
      setViewAction(null);
      return;
    }
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      fitGraph();
    }
  }
}

function GraphButton({ children, label, onClick }: { children: string; label: string; onClick: () => void }) {
  return (
    <button aria-label={label} className={graphButtonClasses} onClick={onClick} title={label} type="button">
      {children}
    </button>
  );
}

function mountNavigationGraphScene(
  { container, layout, onSelectPage, selectedPageId }: NavigationGraphSceneOptions,
  runtime: LeaferRuntime,
): NavigationGraphScene {
  const leafer = new runtime.Leafer({
    fill: "#fafafa",
    height: layout.height,
    hittable: true,
    view: container,
    width: layout.width,
  });

  try {
    leafer.lockLayout?.();
    const nodeBoxes = new Map(layout.nodes.map((node) => [node.id, nodeBoxFor(node)]));
    const edgeElementsByNodeId = new Map<string, LeaferElement[]>();

    for (const edge of layout.edges) {
      const geometry = edgeGeometry(edge, nodeBoxes);
      const edgeLine = new runtime.Path({
        hitSelf: false,
        hittable: false,
        name: `edge-${edge.from}-${edge.to}`,
        path: pathToSvgData(geometry.path),
        stroke: edgeStroke,
        strokeWidth: 1.5,
      });
      const arrow = new runtime.Path({
        fill: edgeStroke,
        hitSelf: false,
        hittable: false,
        name: `edge-arrow-${edge.from}-${edge.to}`,
        path: pathToSvgData(geometry.arrowPath),
      });

      leafer.add(edgeLine);
      leafer.add(arrow);
      registerEdgeElement(edgeElementsByNodeId, edge.from, edgeLine);
      registerEdgeElement(edgeElementsByNodeId, edge.from, arrow);
      registerEdgeElement(edgeElementsByNodeId, edge.to, edgeLine);
      registerEdgeElement(edgeElementsByNodeId, edge.to, arrow);
      leafer.add(
        new runtime.Text({
          fill: "#71717a",
          fontSize: 12,
          fontWeight: 500,
          hittable: false,
          name: `edge-label-${edge.from}-${edge.to}`,
          text: edge.label,
          textAlign: "center",
          width: 160,
          x: geometry.labelPoint.x - 80,
          y: geometry.labelPoint.y - 18,
        }),
      );
    }

    for (const node of layout.nodes) {
      const selected = node.id === selectedPageId;
      const { height, width } = nodeBoxFor(node);
      const rect = new runtime.Rect({
        cornerRadius: 8,
        cursor: "pointer",
        data: { nodeId: node.id },
        fill: selected ? selectedFill : nodeFill,
        height,
        name: `node-${node.id}`,
        stroke: selected ? selectedStroke : nodeStroke,
        strokeWidth: selected ? 2 : 1,
        width,
        x: node.x - width / 2,
        y: node.y - height / 2,
      });

      rect.on?.(runtime.PointerEvent.ENTER, () => {
        if (!selected) {
          rect.stroke = hoverStroke;
          rect.strokeWidth = 2;
        }
        applyEdgeElementsState(edgeElementsByNodeId.get(node.id) ?? [], true);
        leafer.requestRender?.();
      });
      rect.on?.(runtime.PointerEvent.LEAVE, () => {
        rect.stroke = selected ? selectedStroke : nodeStroke;
        rect.strokeWidth = selected ? 2 : 1;
        applyEdgeElementsState(edgeElementsByNodeId.get(node.id) ?? [], false);
        leafer.requestRender?.();
      });
      rect.on?.(runtime.PointerEvent.CLICK, () => {
        onSelectPage(node.id);
      });

      leafer.add(rect);
      leafer.add(
        new runtime.Text({
          fill: "#18181b",
          fontSize: 14,
          fontWeight: 600,
          hittable: false,
          name: `node-label-${node.id}`,
          text: `${node.label}\n(${node.featureCount ?? 0}个功能)`,
          textAlign: "center",
          textOverflow: "ellipsis",
          textWrap: "none",
          width: width - 16,
          x: node.x - width / 2 + 8,
          y: node.y - 18,
        }),
      );
    }

    leafer.unlockLayout?.();
  } catch (error) {
    cleanupFailedScene(leafer);
    throw error;
  }

  return {
    leafer,
    dispose: () => {
      leafer.destroy();
    },
  };
}

function nodeBoxFor(node: ForceLayoutNode): { height: number; width: number } {
  return {
    height: 56,
    width: Math.max(144, node.radius * 3.6),
  };
}

function edgeGeometry(edge: ForceLayoutEdge, nodeBoxes: Map<string, { height: number; width: number }>): EdgeGeometry {
  if (edge.source === edge.target) {
    const box = nodeBoxes.get(edge.source.id) ?? nodeBoxFor(edge.source);
    const start = { x: edge.source.x + box.width / 2, y: edge.source.y };
    const elbowRight = { x: edge.source.x + box.width / 2 + 36, y: edge.source.y };
    const elbowTop = { x: edge.source.x + box.width / 2 + 36, y: edge.source.y - box.height / 2 - 28 };
    const end = { x: edge.source.x, y: edge.source.y - box.height / 2 };
    return {
      arrowPath: trianglePath(end, elbowTop, arrowSize),
      labelPoint: { x: elbowTop.x, y: elbowTop.y },
      path: [
        ["M", start.x, start.y],
        ["L", elbowRight.x, elbowRight.y],
        ["L", elbowTop.x, elbowTop.y],
        ["L", end.x, end.y],
      ],
    };
  }

  const sourceBox = nodeBoxes.get(edge.source.id) ?? nodeBoxFor(edge.source);
  const targetBox = nodeBoxes.get(edge.target.id) ?? nodeBoxFor(edge.target);
  const start = boxBoundaryPoint(edge.source, edge.target, sourceBox);
  const end = boxBoundaryPoint(edge.target, edge.source, targetBox);

  return {
    arrowPath: trianglePath(end, start, arrowSize),
    labelPoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    path: [
      ["M", start.x, start.y],
      ["L", end.x, end.y],
    ],
  };
}

function boxBoundaryPoint(from: ForceLayoutNode, toward: ForceLayoutNode, box: { height: number; width: number }) {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;

  if (dx === 0 && dy === 0) {
    return { x: from.x, y: from.y - box.height / 2 };
  }

  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy),
  );

  return {
    x: roundSceneValue(from.x + dx * scale),
    y: roundSceneValue(from.y + dy * scale),
  };
}

function trianglePath(tip: { x: number; y: number }, tail: { x: number; y: number }, size: number): GraphPathCommand[] {
  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const length = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
  const unitX = dx / length;
  const unitY = dy / length;
  const baseX = tip.x - unitX * size;
  const baseY = tip.y - unitY * size;
  const perpX = -unitY * (size / 2);
  const perpY = unitX * (size / 2);

  return [
    ["M", roundSceneValue(tip.x), roundSceneValue(tip.y)],
    ["L", roundSceneValue(baseX + perpX), roundSceneValue(baseY + perpY)],
    ["L", roundSceneValue(baseX - perpX), roundSceneValue(baseY - perpY)],
    ["Z"],
  ];
}

function pathToSvgData(path: GraphPathCommand[]): string {
  return path.map((command) => (command[0] === "Z" ? "Z" : `${command[0]} ${command[1]} ${command[2]}`)).join(" ");
}

function registerEdgeElement(
  edgeElementsByNodeId: Map<string, LeaferElement[]>,
  nodeId: string,
  element: LeaferElement,
): void {
  const elements = edgeElementsByNodeId.get(nodeId) ?? [];
  if (!elements.includes(element)) {
    elements.push(element);
  }
  edgeElementsByNodeId.set(nodeId, elements);
}

function applyEdgeElementsState(elements: LeaferElement[], highlighted: boolean): void {
  for (const element of elements) {
    if (element.fill !== undefined) {
      element.fill = highlighted ? hoverStroke : edgeStroke;
    }
    if (element.stroke !== undefined) {
      element.stroke = highlighted ? hoverStroke : edgeStroke;
    }
  }
}

function roundSceneValue(value: number): number {
  return Math.round(value * 100) / 100;
}

async function loadLeaferRuntime(): Promise<LeaferRuntime> {
  const runtime = await import("leafer-ui");
  return {
    Leafer: runtime.Leafer as LeaferRuntime["Leafer"],
    Path: runtime.Path as LeaferRuntime["Path"],
    PointerEvent: {
      CLICK: runtime.PointerEvent.CLICK,
      ENTER: runtime.PointerEvent.ENTER,
      LEAVE: runtime.PointerEvent.LEAVE,
    },
    Rect: runtime.Rect as LeaferRuntime["Rect"],
    Text: runtime.Text as LeaferRuntime["Text"],
  };
}

function cleanupFailedScene(leafer: LeaferInstance): void {
  try {
    leafer.unlockLayout?.();
  } catch {
    // Preserve construction errors; cleanup errors are secondary.
  }
  try {
    leafer.destroy();
  } catch {
    // Preserve construction errors; cleanup errors are secondary.
  }
}
