import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";

import type { RequirementDesignCanvasPage, RequirementDesignScene, RequirementDesignSceneNode, RequirementDesignScenePage } from "../api.js";
import { useT } from "../LocaleContext.js";

export interface DesignSceneCanvasProps {
  canvasPages?: RequirementDesignCanvasPage[];
  onHoverNodeId?: (nodeId: string | null) => void;
  onSelectionChange?: (nodeIds: string[]) => void;
  productId: string;
  requirementId: string;
  scene: RequirementDesignScene;
  selectedNodeIds?: string[];
  selectedPageId?: string;
}

export interface DesignSceneOptions {
  nodes: RequirementDesignSceneNode[];
  onHoverNodeId?: (nodeId: string | null) => void;
  onSelectNodeId?: (nodeId: string) => void;
  pageSize: SceneSize;
  selectedNodeIds: string[];
  view: HTMLElement;
}

export interface DesignScene {
  dispose(): void;
  leafer: LeaferInstance;
}

interface LeaferRuntime {
  Frame: new (config: Record<string, unknown>) => LeaferElement;
  Leafer: new (config: Record<string, unknown>) => LeaferInstance;
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

interface SceneSize {
  height: number;
  width: number;
}

interface SceneRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

type ViewAction = "fitPage" | "fitSelection" | "resetView" | null;

const selectedStroke = "#d97706";
const hoverStroke = "#2563eb";
const defaultStroke = "#d4d4d8";
const defaultFill = "#ffffff";
const transparentFill = "rgba(245, 158, 11, 0.02)";
const minZoom = 0.25;
const maxZoom = 4;

export function DesignSceneCanvas({
  canvasPages = [],
  onHoverNodeId,
  onSelectionChange,
  productId,
  requirementId,
  scene,
  selectedNodeIds,
  selectedPageId
}: DesignSceneCanvasProps) {
  const t = useT();
  const viewRef = useRef<HTMLDivElement | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [internalSelectedIds, setInternalSelectedIds] = useState<string[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [viewAction, setViewAction] = useState<ViewAction>(null);
  const [selectionBox, setSelectionBox] = useState<{ start: ScenePoint; current: ScenePoint } | null>(null);
  const selectionBoxRef = useRef<{ start: ScenePoint; current: ScenePoint } | null>(null);
  const selectedIds = selectedNodeIds ?? internalSelectedIds;
  const selectedIdsKey = selectedIds.join("\u0000");
  const page = useMemo(() => selectedScenePage(scene, selectedPageId), [scene, selectedPageId]);
  const pageSize = useMemo(() => resolvePageSize(page), [page]);
  const canvasPage = canvasPages.find((candidate) => candidate.page_id === page.page_id);
  const warnings = useMemo(() => collectUnsupportedProperties(scene, page), [scene, page]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return undefined;
    }

    let disposed = false;
    let sceneHandle: DesignScene | null = null;
    setRuntimeError(null);
    view.replaceChildren();

    void loadLeaferRuntime()
      .then((runtime) => {
        if (disposed) {
          return;
        }
        sceneHandle = mountDesignScene(
          {
            nodes: page.nodes,
            onHoverNodeId: handleRuntimeHover,
            onSelectNodeId: (nodeId) => setSelection([nodeId]),
            pageSize,
            selectedNodeIds: selectedIds,
            view
          },
          runtime
        );
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setRuntimeError(error instanceof Error ? error.message : t("design.canvasUnavailable"));
        }
      });

    return () => {
      disposed = true;
      sceneHandle?.dispose();
      view.replaceChildren();
    };
  }, [page, pageSize, selectedIdsKey]);

  function setSelection(next: string[]) {
    if (!selectedNodeIds) {
      setInternalSelectedIds(next);
    }
    onSelectionChange?.(next);
  }

  function handleRuntimeHover(nodeId: string | null) {
    setHoveredNodeId(nodeId);
    onHoverNodeId?.(nodeId);
  }

  function changeZoom(delta: number) {
    setZoom((current) => clampZoom(roundZoom(current + delta)));
    setViewAction(null);
  }

  function fitPage() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setViewAction("fitPage");
  }

  function fitSelection() {
    setViewAction("fitSelection");
    if (selectedIds.length === 0) {
      fitPage();
      return;
    }
    setZoom(1.15);
  }

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setViewAction("resetView");
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 240 : 48;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setPan((current) => ({
        x: current.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
        y: current.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0)
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
      if (selectedIds.length > 0) {
        fitSelection();
      } else {
        fitPage();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSelection([]);
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    changeZoom(event.deltaY > 0 ? -0.1 : 0.1);
  }

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    const point = scenePointFromEvent(event.currentTarget, event);
    const next = { current: point, start: point };
    selectionBoxRef.current = next;
    setSelectionBox(next);
  }

  function handleMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    const activeBox = selectionBoxRef.current;
    if (!activeBox) {
      return;
    }
    const next = { ...activeBox, current: scenePointFromEvent(event.currentTarget, event) };
    selectionBoxRef.current = next;
    setSelectionBox(next);
  }

  function handleMouseUp(event: ReactMouseEvent<HTMLDivElement>) {
    const activeBox = selectionBoxRef.current;
    if (!activeBox) {
      return;
    }
    const current = scenePointFromEvent(event.currentTarget, event);
    const box = rectFromPoints(activeBox.start, current);
    const next = page.nodes.filter((node) => pointInsideRect(centerOfRect(nodeRect(node)), box)).map((node) => node.id);
    setSelection(next);
    selectionBoxRef.current = null;
    setSelectionBox(null);
  }

  const preview = previewEntry(productId, requirementId, page, canvasPage, t);
  const describedBy = "scene-canvas-status scene-canvas-warnings";
  const pageNodes = page.nodes;

  return (
    <div className="space-y-4" data-design-scene-canvas="true">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton label={t("action.zoomOut")} onClick={() => changeZoom(-0.25)}>-</IconButton>
        <IconButton label={t("action.zoomIn")} onClick={() => changeZoom(0.25)}>+</IconButton>
        <IconButton label={t("action.fitPage")} onClick={fitPage}>[]</IconButton>
        <IconButton label={t("action.fitSelection")} onClick={fitSelection}>[.]</IconButton>
        <IconButton label={t("action.zoomOne")} onClick={() => setZoom(1)}>1</IconButton>
        <IconButton label={t("action.resetView")} onClick={resetView}>R</IconButton>
        <IconButton label={t("action.clearSelection")} onClick={() => setSelection([])}>X</IconButton>
        {preview.kind === "link" ? (
          <a className={controlLinkClasses} href={preview.href} title={t("action.openPreview")}>
            {t("design.preview")}
          </a>
        ) : (
          <span className={disabledControlClasses} title={preview.title}>{preview.label}</span>
        )}
      </div>

      <div
        aria-describedby={describedBy}
        aria-label={t("design.canvas")}
        className="relative min-h-[360px] w-full overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
        onKeyDown={handleKeyDown}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        role="application"
        style={{ aspectRatio: `${pageSize.width} / ${pageSize.height}` }}
        tabIndex={0}
      >
        <div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full" ref={viewRef} />
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 origin-top-left"
          data-scene-layer="dom"
          style={{ height: pageSize.height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: pageSize.width }}
        >
          {pageNodes.map((node) => {
            const rect = nodeRect(node);
            const selected = selectedIds.includes(node.id);
            return (
              <button
                aria-label={node.name ?? node.id}
                className={`absolute overflow-hidden rounded-[4px] border text-left text-[10px] leading-tight text-transparent ${
                  selected ? "border-amber-500 bg-amber-50/20" : "border-transparent bg-transparent hover:border-blue-500"
                }`}
                data-node-id={node.id}
                key={node.id}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelection([node.id]);
                }}
                onMouseEnter={() => handleRuntimeHover(node.id)}
                onMouseLeave={() => handleRuntimeHover(null)}
                style={{ height: rect.height, left: rect.x, top: rect.y, width: rect.width }}
                type="button"
              >
                {node.name ?? node.id}
              </button>
            );
          })}
          {selectionBox ? <SelectionBox box={rectFromPoints(selectionBox.start, selectionBox.current)} /> : null}
        </div>
        {runtimeError ? (
          <div className="absolute inset-x-3 top-3 z-20 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {t("design.canvasUnavailable")}: {runtimeError}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 text-sm md:grid-cols-[minmax(0,1fr)_18rem]">
        <div id="scene-canvas-status" className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-zinc-700">
          <span className="font-medium text-zinc-950">{page.page_id}</span>
          <span className="ml-3">{t("design.pageFrame")}: <span className="font-mono">{page.frame_id ?? "none"}</span></span>
          <span className="ml-3">Zoom {Math.round(zoom * 100)}%</span>
          <span className="ml-3">Pan {Math.round(pan.x)}, {Math.round(pan.y)}</span>
          <span className="ml-3">{selectedIds.length} selected</span>
          {viewAction ? <span className="ml-3">{viewActionLabel(viewAction, t)}</span> : null}
        </div>
        <div id="scene-canvas-warnings" className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-zinc-700">
          <span className="font-medium text-zinc-950">{t("design.rendererWarnings")}</span>
          <span className="ml-2 font-mono text-xs">scene_unsupported_property</span>
          <span className="ml-2">{warnings.length}</span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          <h3 className="text-sm font-semibold tracking-normal text-zinc-950">{t("design.nodeList")}</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {pageNodes.map((node) => (
              <button
                className={`min-w-0 rounded-md border px-3 py-2 text-left text-sm transition ${
                  selectedIds.includes(node.id)
                    ? "border-amber-300 bg-amber-50 text-zinc-950"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-amber-200 hover:bg-amber-50"
                }`}
                data-node-id={node.id}
                key={node.id}
                onClick={() => setSelection([node.id])}
                type="button"
              >
                <span className="block truncate font-medium">{node.name ?? node.id}</span>
                <span className="mt-1 block truncate font-mono text-xs text-zinc-500">{node.id}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold tracking-normal text-zinc-950">{t("design.unsupportedProperties")}</h3>
          {warnings.length === 0 ? (
            <p className="mt-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-500">0</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {warnings.map((warning) => (
                <li className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" key={`${warning.node_id}-${warning.property}`}>
                  <span className="font-mono text-xs">{warning.node_id}</span>
                  <span className="ml-2">{warning.property}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {hoveredNodeId ? <p className="sr-only">Hover {hoveredNodeId}</p> : null}
    </div>
  );

  function scenePointFromEvent(element: HTMLElement, event: Pick<MouseEvent, "clientX" | "clientY">): ScenePoint {
    const bounds = element.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - pan.x) / zoom,
      y: (event.clientY - bounds.top - pan.y) / zoom
    };
  }
}

export function mountDesignScene({ nodes, onHoverNodeId, onSelectNodeId, pageSize, selectedNodeIds, view }: DesignSceneOptions, runtime: LeaferRuntime): DesignScene {
  const leafer = new runtime.Leafer({
    fill: "#f4f4f5",
    height: pageSize.height,
    hittable: true,
    smooth: true,
    view,
    wheel: { zoomMode: "mouse", moveSpeed: 0.5, zoomSpeed: 0.5 },
    width: pageSize.width
  });

  try {
    leafer.lockLayout?.();
    for (const node of nodes) {
      if (!isDrawableNode(node)) {
        continue;
      }
      const selected = selectedNodeIds.includes(node.id);
      const element = createNodeElement(node, selected, runtime);
      element.on?.(runtime.PointerEvent.ENTER, () => {
        element.stroke = selected ? selectedStroke : hoverStroke;
        element.strokeWidth = selected ? 3 : 2;
        onHoverNodeId?.(node.id);
        leafer.requestRender?.();
      });
      element.on?.(runtime.PointerEvent.LEAVE, () => {
        element.stroke = selected ? selectedStroke : node.stroke ?? defaultStroke;
        element.strokeWidth = selected ? 3 : nodeNumber(node, "strokeWidth", "stroke_width") ?? 1;
        onHoverNodeId?.(null);
        leafer.requestRender?.();
      });
      element.on?.(runtime.PointerEvent.CLICK, () => {
        onSelectNodeId?.(node.id);
      });
      leafer.add(element);
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
    }
  };
}

function createNodeElement(node: RequirementDesignSceneNode, selected: boolean, runtime: LeaferRuntime): LeaferElement {
  const rect = nodeRect(node);
  const baseConfig = {
    cornerRadius: nodeNumber(node, "cornerRadius", "corner_radius") ?? 0,
    cursor: "pointer",
    data: { nodeId: node.id },
    fill: nodeFill(node),
    height: rect.height,
    name: `node-${node.id}`,
    opacity: nodeNumber(node, "opacity") ?? 1,
    rotation: nodeNumber(node, "rotation") ?? 0,
    stroke: selected ? selectedStroke : node.stroke ?? defaultStroke,
    strokeWidth: selected ? 3 : nodeNumber(node, "strokeWidth", "stroke_width") ?? 1,
    width: rect.width,
    x: rect.x,
    y: rect.y
  };

  if (node.type === "text" || node.text) {
    return new runtime.Text({
      ...baseConfig,
      text: node.text ?? node.name ?? node.id,
      textAlign: "left",
      verticalAlign: "middle"
    });
  }
  if (node.type === "frame") {
    return new runtime.Frame(baseConfig);
  }
  return new runtime.Rect(baseConfig);
}

function nodeFill(node: RequirementDesignSceneNode): unknown {
  if (node.image) {
    return { mode: "fit", type: "image", url: node.image };
  }
  if (node.fill) {
    return node.fill;
  }
  return node.type === "frame" ? defaultFill : transparentFill;
}

function selectedScenePage(scene: RequirementDesignScene, selectedPageId?: string): RequirementDesignScenePage {
  return scene.pages.find((page) => page.page_id === selectedPageId) ?? scene.pages[0] ?? { nodes: [], page_id: "unknown", preview: { status: "missing" } };
}

function resolvePageSize(page: RequirementDesignScenePage): SceneSize {
  const frame = page.frame_id ? page.nodes.find((node) => node.id === page.frame_id) : undefined;
  const root = frame ?? page.nodes.find((node) => !node.parent_id && isDrawableNode(node));
  if (root) {
    return { height: Math.max(1, Math.ceil(nodeNumber(root, "height") ?? 720)), width: Math.max(1, Math.ceil(nodeNumber(root, "width") ?? 1280)) };
  }
  const bounds = page.nodes.reduce(
    (current, node) => {
      const rect = nodeRect(node);
      return { height: Math.max(current.height, rect.y + rect.height), width: Math.max(current.width, rect.x + rect.width) };
    },
    { height: 720, width: 1280 }
  );
  return { height: Math.ceil(bounds.height), width: Math.ceil(bounds.width) };
}

function isDrawableNode(node: RequirementDesignSceneNode): boolean {
  return Number.isFinite(nodeNumber(node, "x")) && Number.isFinite(nodeNumber(node, "y")) && (nodeNumber(node, "width") ?? 0) > 0 && (nodeNumber(node, "height") ?? 0) > 0;
}

function nodeRect(node: RequirementDesignSceneNode): SceneRect {
  return {
    height: Math.max(1, nodeNumber(node, "height") ?? 44),
    width: Math.max(1, nodeNumber(node, "width") ?? 160),
    x: nodeNumber(node, "x") ?? 0,
    y: nodeNumber(node, "y") ?? 0
  };
}

function nodeNumber(node: RequirementDesignSceneNode, ...keys: Array<keyof RequirementDesignSceneNode>): number | undefined {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function collectUnsupportedProperties(scene: RequirementDesignScene, page: RequirementDesignScenePage): Array<{ node_id: string; property: string }> {
  const warnings = new Map<string, { node_id: string; property: string }>();
  for (const warning of scene.unsupported_properties) {
    warnings.set(`${warning.node_id}\u0000${warning.property}`, warning);
  }
  for (const node of page.nodes) {
    for (const property of node.unsupported_properties ?? []) {
      warnings.set(`${node.id}\u0000${property}`, { node_id: node.id, property });
    }
  }
  return [...warnings.values()];
}

function previewEntry(
  productId: string,
  requirementId: string,
  page: RequirementDesignScenePage,
  canvasPage: RequirementDesignCanvasPage | undefined,
  t: (key: string) => string
): { href: string; kind: "link"; label: string; title: string } | { kind: "disabled"; label: string; title: string } {
  if (canvasPage?.status === "pending") {
    return { kind: "disabled", label: t("design.previewPending"), title: t("design.previewPending") };
  }
  if (page.preview.status === "exported") {
    const href = `/api/products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}/design/preview/${encodeURIComponent(page.page_id)}/file`;
    const label = canvasPage?.status === "expired" ? t("design.previewExpired") : t("design.preview");
    return { href, kind: "link", label, title: t("action.openPreview") };
  }
  return { kind: "disabled", label: t("design.previewMissing"), title: t("design.previewMissing") };
}

function viewActionLabel(action: ViewAction, t: (key: string) => string): string | null {
  if (action === "fitPage") {
    return t("action.fitPage");
  }
  if (action === "fitSelection") {
    return t("action.fitSelection");
  }
  if (action === "resetView") {
    return t("action.resetView");
  }
  return null;
}

interface ScenePoint {
  x: number;
  y: number;
}

function rectFromPoints(start: ScenePoint, current: ScenePoint): SceneRect {
  return {
    height: Math.abs(current.y - start.y),
    width: Math.abs(current.x - start.x),
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y)
  };
}

function rectsIntersect(first: SceneRect, second: SceneRect): boolean {
  return first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y;
}

function centerOfRect(rect: SceneRect): ScenePoint {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}

function pointInsideRect(point: ScenePoint, rect: SceneRect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function SelectionBox({ box }: { box: SceneRect }) {
  return (
    <div
      className="absolute border border-amber-500 bg-amber-300/20"
      style={{ height: box.height, left: box.x, top: box.y, width: box.width }}
    />
  );
}

function IconButton({ children, label, onClick }: { children: string; label: string; onClick: () => void }) {
  return (
    <button aria-label={label} className={controlButtonClasses} onClick={onClick} title={label} type="button">
      {children}
    </button>
  );
}

function clampZoom(value: number): number {
  return Math.min(maxZoom, Math.max(minZoom, value));
}

function roundZoom(value: number): number {
  return Math.round(value * 100) / 100;
}

async function loadLeaferRuntime(): Promise<LeaferRuntime> {
  const runtime = await import("leafer-ui");
  return {
    Frame: runtime.Frame as LeaferRuntime["Frame"],
    Leafer: runtime.Leafer as LeaferRuntime["Leafer"],
    PointerEvent: {
      CLICK: runtime.PointerEvent.CLICK,
      ENTER: runtime.PointerEvent.ENTER,
      LEAVE: runtime.PointerEvent.LEAVE
    },
    Rect: runtime.Rect as LeaferRuntime["Rect"],
    Text: runtime.Text as LeaferRuntime["Text"]
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

const focusClasses = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const controlButtonClasses =
  "inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-white text-xs font-semibold text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 " +
  focusClasses;
const controlLinkClasses =
  "inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 " +
  focusClasses;
const disabledControlClasses =
  "inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-500";
