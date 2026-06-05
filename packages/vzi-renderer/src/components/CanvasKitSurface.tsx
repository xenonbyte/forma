/**
 * CanvasKit 基础渲染层组件
 *
 * 从 Playground 抽离的核心能力：
 * - CanvasKit 初始化与生命周期管理
 * - 视口缩放/平移
 * - 元素命中（选中/悬停）
 * - 标注层渲染
 */

import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { IntermediateRepresentation } from "@vzi-core/types";
import { CanvasKitRenderer } from "../canvaskit/CanvasKitRenderer";
import { FontManager } from "../canvaskit/FontManager";
import { resetCanvasKitRuntime } from "../canvaskit/RuntimeReset";
import { CanvasAnnotationRenderer } from "../canvaskit/annotations/AnnotationRenderer";
import { sortCanvasKitTree } from "../canvaskit/render-order";
import { HitTestIndex } from "../canvaskit/HitTestIndex";
import type {
  AnnotationElement,
  AnnotationTheme,
  PartialAnnotationStyleConfig,
  ViewportConfig,
} from "../canvaskit/annotations/types";
import { resolveAnnotationStyleConfig } from "../canvaskit/annotations";
import type { IRElement } from "../canvaskit/renderers/types";

type FlatElementBounds = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export interface FlatIRElementLike {
  id?: string;
  parentId?: string | null;
  type?: string;
  bounds?: FlatElementBounds;
  styles?: Record<string, unknown>;
  textContent?: string;
  svgData?: unknown;
  src?: string;
  imageData?: {
    src?: string;
  };
  source?: {
    src?: string;
  };
}

export interface FlatIRDocumentLike {
  rootElementId?: string;
  elements?: Record<string, FlatIRElementLike>;
}

export interface CanvasKitViewportState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface CanvasKitSurfaceProps {
  /**
   * 树形元素（优先使用）
   */
  elements?: IRElement[];
  /**
   * 扁平 IR 文档（会自动转换为树形）
   */
  ir?: IntermediateRepresentation | FlatIRDocumentLike;
  /**
   * 组件宽度（像素）
   */
  width: number;
  /**
   * 组件高度（像素）
   */
  height: number;
  /**
   * 画布背景色
   */
  backgroundColor?: string;
  /**
   * 是否显示标注
   */
  showAnnotations?: boolean;
  /**
   * 是否启用交互（缩放/平移/选中/悬停）
   */
  interactive?: boolean;
  /**
   * 是否允许鼠标左键拖动画布
   */
  panOnPrimaryDrag?: boolean;
  /**
   * 最小缩放
   */
  minScale?: number;
  /**
   * 最大缩放
   */
  maxScale?: number;
  /**
   * 受控视口
   */
  viewport?: CanvasKitViewportState;
  /**
   * 非受控初始视口
   */
  defaultViewport?: CanvasKitViewportState;
  /**
   * 视口变化回调
   */
  onViewportChange?: (viewport: CanvasKitViewportState) => void;
  /**
   * 受控选中元素 ID
   */
  selectedElementId?: string | null;
  /**
   * 受控悬停元素 ID
   */
  hoveredElementId?: string | null;
  /**
   * 选中回调
   */
  onSelectElement?: (element: IRElement | null) => void;
  /**
   * 悬停回调
   */
  onHoverElement?: (element: IRElement | null) => void;
  /**
   * 自定义标注元素（可选）
   */
  annotationElements?: AnnotationElement[];
  /**
   * 简化标注主题
   */
  annotationTheme?: AnnotationTheme;
  /**
   * 标注样式覆盖
   */
  annotationStyles?: PartialAnnotationStyleConfig;
  /**
   * 标注视口配置覆盖
   */
  annotationViewport?: Partial<ViewportConfig>;
  /**
   * CanvasKit 初始化选项
   */
  useWebGL?: boolean;
  devicePixelRatio?: number;
  /**
   * 渲染生命周期回调
   */
  onReady?: () => void;
  onRenderError?: (error: Error) => void;
  onRenderComplete?: (stats?: { durationMs: number }) => void;
  /**
   * 样式
   */
  className?: string;
  style?: CSSProperties;
}

const DEFAULT_VIEWPORT: CanvasKitViewportState = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeBounds(bounds: FlatElementBounds | undefined): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: isFiniteNumber(bounds?.x) ? bounds!.x : 0,
    y: isFiniteNumber(bounds?.y) ? bounds!.y : 0,
    width: isFiniteNumber(bounds?.width) ? bounds!.width : 0,
    height: isFiniteNumber(bounds?.height) ? bounds!.height : 0,
  };
}

function normalizeStyles(styles: Record<string, unknown> | undefined): IRElement["styles"] {
  if (!styles) {
    return {};
  }

  const normalized: Record<string, string | number | undefined> = {};
  for (const [key, value] of Object.entries(styles)) {
    if (typeof value === "string" || typeof value === "number" || value === undefined) {
      normalized[key] = value;
    }
  }
  return normalized;
}

/**
 * 将扁平 IR 转换为 CanvasKit 可渲染的树形元素
 */
export function buildCanvasKitElementTree(ir: FlatIRDocumentLike | IntermediateRepresentation): IRElement[] {
  const sourceElements = ir.elements ?? {};
  const elementMap = new Map<string, IRElement>();

  for (const [fallbackId, rawElement] of Object.entries(sourceElements)) {
    const id = typeof rawElement.id === "string" && rawElement.id.trim().length > 0 ? rawElement.id : fallbackId;
    const svgData =
      rawElement.svgData == null
        ? undefined
        : typeof rawElement.svgData === "string"
          ? rawElement.svgData
          : JSON.stringify(rawElement.svgData);

    const element: IRElement = {
      id,
      type: typeof rawElement.type === "string" ? rawElement.type : "container",
      bounds: normalizeBounds(rawElement.bounds),
      styles: normalizeStyles(rawElement.styles),
      textContent: typeof rawElement.textContent === "string" ? rawElement.textContent : undefined,
      children: [],
      svgData,
      src:
        typeof rawElement.src === "string"
          ? rawElement.src
          : typeof rawElement.imageData?.src === "string"
            ? rawElement.imageData.src
            : typeof rawElement.source?.src === "string"
              ? rawElement.source.src
              : undefined,
    };
    elementMap.set(id, element);
  }

  const rootElements: IRElement[] = [];
  for (const [fallbackId, rawElement] of Object.entries(sourceElements)) {
    const id = typeof rawElement.id === "string" && rawElement.id.trim().length > 0 ? rawElement.id : fallbackId;
    const element = elementMap.get(id);
    if (!element) {
      continue;
    }

    const parentId = typeof rawElement.parentId === "string" ? rawElement.parentId : null;
    if (!parentId || !elementMap.has(parentId)) {
      rootElements.push(element);
      continue;
    }

    const parent = elementMap.get(parentId);
    if (!parent) {
      rootElements.push(element);
      continue;
    }
    parent.children = parent.children ?? [];
    parent.children.push(element);
  }

  const rootElementId = typeof ir.rootElementId === "string" ? ir.rootElementId : undefined;
  if (rootElementId && elementMap.has(rootElementId)) {
    const root = elementMap.get(rootElementId);
    return root ? sortCanvasKitTree([root]) : sortCanvasKitTree(rootElements);
  }

  return sortCanvasKitTree(rootElements);
}

/**
 * 扁平化树形元素，适用于命中检测与标注
 */
export function flattenCanvasKitElements(elements: IRElement[]): IRElement[] {
  const flattened: IRElement[] = [];

  const visit = (element: IRElement): void => {
    flattened.push(element);
    if (element.children && element.children.length > 0) {
      element.children.forEach(visit);
    }
  };

  elements.forEach(visit);
  return flattened;
}

/**
 * 将 CanvasKit 元素转换为标注元素
 */
export function toCanvasKitAnnotationElement(element: IRElement): AnnotationElement {
  return {
    id: element.id,
    name: element.id,
    bounds: {
      top: element.bounds.y,
      left: element.bounds.x,
      bottom: element.bounds.y + element.bounds.height,
      right: element.bounds.x + element.bounds.width,
      width: element.bounds.width,
      height: element.bounds.height,
    },
  };
}

export const CanvasKitSurface: React.FC<CanvasKitSurfaceProps> = memo(
  ({
    elements,
    ir,
    width,
    height,
    backgroundColor = "#f5f5f5",
    showAnnotations = true,
    interactive = true,
    panOnPrimaryDrag = true,
    minScale = 0.1,
    maxScale = 5,
    viewport,
    defaultViewport,
    onViewportChange,
    selectedElementId,
    hoveredElementId,
    onSelectElement,
    onHoverElement,
    annotationElements,
    annotationTheme,
    annotationStyles,
    annotationViewport,
    useWebGL = true,
    devicePixelRatio,
    onReady,
    onRenderError,
    onRenderComplete,
    className,
    style,
  }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<CanvasKitRenderer | null>(null);
    const annotationRendererRef = useRef<CanvasAnnotationRenderer | null>(null);

    const [rendererReady, setRendererReady] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    const [internalViewport, setInternalViewport] = useState<CanvasKitViewportState>(
      defaultViewport ?? DEFAULT_VIEWPORT,
    );
    const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
    const [internalHoveredId, setInternalHoveredId] = useState<string | null>(null);

    const viewportState = viewport ?? internalViewport;
    const viewportStateRef = useRef<CanvasKitViewportState>(viewportState);
    const activeSelectedId = selectedElementId ?? internalSelectedId;
    const activeHoveredId = hoveredElementId ?? internalHoveredId;

    const renderElements = useMemo<IRElement[]>(() => {
      if (elements && elements.length > 0) {
        return elements;
      }
      if (ir) {
        return buildCanvasKitElementTree(ir);
      }
      return [];
    }, [elements, ir]);

    const flattenedElements = useMemo(() => flattenCanvasKitElements(renderElements), [renderElements]);
    const hitTestElements = flattenedElements;

    // M6: 构建空间索引用于高效命中测试
    const hitTestIndex = useMemo(() => {
      const index = new HitTestIndex();
      index.build(flattenedElements);
      return index;
    }, [flattenedElements]);

    const elementById = useMemo(() => {
      const map = new Map<string, IRElement>();
      flattenedElements.forEach((element) => {
        map.set(element.id, element);
      });
      return map;
    }, [flattenedElements]);

    const resolvedAnnotationElements = useMemo(
      () => annotationElements ?? flattenedElements.map(toCanvasKitAnnotationElement),
      [annotationElements, flattenedElements],
    );
    const resolvedAnnotationStyles = useMemo(
      () => resolveAnnotationStyleConfig(annotationTheme, annotationStyles),
      [annotationTheme, annotationStyles],
    );

    const dragStartRef = useRef({ x: 0, y: 0 });
    const lastPointerRef = useRef({ x: 0, y: 0 });
    const suppressClickRef = useRef(false);
    const latestPerformRenderRef = useRef<(() => Promise<void>) | null>(null);
    const fontRefreshTimerRef = useRef<number | null>(null);
    const renderFrameRef = useRef<number | null>(null);
    const renderQueuedRef = useRef(false);
    const renderInFlightRef = useRef(false);
    const fatalErrorRef = useRef(false);
    const runtimeResetRef = useRef(false);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    const touchDraggingRef = useRef(false);
    const touchGestureRef = useRef<{ midpointX: number; midpointY: number; distance: number } | null>(null);

    const commitViewport = useCallback(
      (next: CanvasKitViewportState) => {
        if (viewport === undefined) {
          setInternalViewport(next);
        }
        onViewportChange?.(next);
      },
      [viewport, onViewportChange],
    );

    useEffect(() => {
      viewportStateRef.current = viewportState;
    }, [viewportState]);

    const updateViewport = useCallback(
      (updater: (prev: CanvasKitViewportState) => CanvasKitViewportState) => {
        commitViewport(updater(viewportStateRef.current));
      },
      [commitViewport],
    );

    const commitSelectedElement = useCallback(
      (element: IRElement | null) => {
        const nextId = element?.id ?? null;
        if (selectedElementId === undefined) {
          setInternalSelectedId(nextId);
        }
        onSelectElement?.(element);
      },
      [selectedElementId, onSelectElement],
    );

    const commitHoveredElement = useCallback(
      (element: IRElement | null) => {
        const nextId = element?.id ?? null;
        if (hoveredElementId === undefined) {
          setInternalHoveredId(nextId);
        }
        onHoverElement?.(element);
      },
      [hoveredElementId, onHoverElement],
    );

    const getCanvasPoint = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }

      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    }, []);

    const resolveCanvasPointOrCenter = useCallback(
      (clientX: number, clientY: number): { x: number; y: number } | null => {
        const canvas = canvasRef.current;
        if (!canvas) {
          return null;
        }
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const isInside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
        const localX = isInside ? clientX - rect.left : rect.width / 2;
        const localY = isInside ? clientY - rect.top : rect.height / 2;
        return {
          x: localX * scaleX,
          y: localY * scaleY,
        };
      },
      [],
    );

    const disposeRendererResources = useCallback(() => {
      annotationRendererRef.current?.dispose();
      annotationRendererRef.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
      setRendererReady(false);
    }, []);

    const handleRendererFailure = useCallback(
      (error: Error) => {
        const message = error.message.toLowerCase();
        const isFatal = /aborted|webgl|context/.test(message);

        if (isFatal) {
          fatalErrorRef.current = true;
          renderQueuedRef.current = false;
          renderInFlightRef.current = false;
          if (renderFrameRef.current !== null) {
            window.cancelAnimationFrame(renderFrameRef.current);
            renderFrameRef.current = null;
          }
          disposeRendererResources();
          if (!runtimeResetRef.current) {
            runtimeResetRef.current = true;
            resetCanvasKitRuntime();
          }
        }

        onRenderError?.(error);
      },
      [disposeRendererResources, onRenderError],
    );

    const findElementAtCanvasPoint = useCallback(
      (canvasX: number, canvasY: number): IRElement | null => {
        const worldX = (canvasX - viewportState.offsetX) / viewportState.scale;
        const worldY = (canvasY - viewportState.offsetY) / viewportState.scale;

        // M6: 优先使用空间索引进行 O(log n) 查询
        if (hitTestIndex.isReady()) {
          const element = hitTestIndex.queryTopElementAtPoint(worldX, worldY);
          if (element) {
            return element;
          }
        }

        // Fallback: 线性扫描 O(n)（索引未就绪或构建失败时）
        for (let i = hitTestElements.length - 1; i >= 0; i -= 1) {
          const el = hitTestElements[i];
          const { x, y, width: elementWidth, height: elementHeight } = el.bounds;
          if (worldX >= x && worldX <= x + elementWidth && worldY >= y && worldY <= y + elementHeight) {
            return el;
          }
        }
        return null;
      },
      [hitTestIndex, hitTestElements, viewportState],
    );

    const performRender = useCallback(async () => {
      if (fatalErrorRef.current) {
        return;
      }

      const renderer = rendererRef.current;
      if (!renderer) {
        return;
      }

      try {
        const renderStartedAt =
          typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();

        await renderer.render(renderElements, {
          clear: true,
          backgroundColor,
          transform: {
            translateX: viewportState.offsetX,
            translateY: viewportState.offsetY,
            scale: viewportState.scale,
          },
        });

        const annotationRenderer = annotationRendererRef.current;
        if (showAnnotations && annotationRenderer) {
          const latestCanvas = renderer.getCanvas();
          if (latestCanvas) {
            annotationRenderer.setCanvas(latestCanvas);
          }
          annotationRenderer.setOffset(viewportState.offsetX, viewportState.offsetY);
          annotationRenderer.setScale(viewportState.scale);
          annotationRenderer.setSelectedElementById(activeSelectedId);
          annotationRenderer.setHoveredElementById(activeHoveredId);
          annotationRenderer.render();
        }

        renderer.flush();
        const renderCompletedAt =
          typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
        onRenderComplete?.({
          durationMs: Math.max(0, renderCompletedAt - renderStartedAt),
        });
      } catch (error) {
        const renderError = error instanceof Error ? error : new Error(String(error));
        handleRendererFailure(renderError);
      }
    }, [
      renderElements,
      backgroundColor,
      viewportState,
      showAnnotations,
      activeSelectedId,
      activeHoveredId,
      onRenderComplete,
      handleRendererFailure,
    ]);

    useEffect(() => {
      latestPerformRenderRef.current = performRender;
    }, [performRender]);

    const requestRender = useCallback(() => {
      if (fatalErrorRef.current) {
        return;
      }

      renderQueuedRef.current = true;
      if (renderFrameRef.current !== null) {
        return;
      }

      renderFrameRef.current = window.requestAnimationFrame(() => {
        renderFrameRef.current = null;

        if (renderInFlightRef.current) {
          return;
        }

        const run = async (): Promise<void> => {
          renderInFlightRef.current = true;
          try {
            while (renderQueuedRef.current) {
              renderQueuedRef.current = false;
              await latestPerformRenderRef.current?.();
            }
          } finally {
            renderInFlightRef.current = false;
            if (renderQueuedRef.current) {
              requestRender();
            }
          }
        };

        void run();
      });
    }, []);

    useEffect(() => {
      if (!rendererReady) {
        return;
      }

      const fontManager = FontManager.getInstance();
      const unsubscribe = fontManager.subscribeFontReady(() => {
        if (fontRefreshTimerRef.current !== null) {
          return;
        }

        fontRefreshTimerRef.current = window.setTimeout(() => {
          fontRefreshTimerRef.current = null;
          requestRender();
        }, 0);
      });

      return () => {
        unsubscribe();
        if (fontRefreshTimerRef.current !== null) {
          window.clearTimeout(fontRefreshTimerRef.current);
          fontRefreshTimerRef.current = null;
        }
        if (renderFrameRef.current !== null) {
          window.cancelAnimationFrame(renderFrameRef.current);
          renderFrameRef.current = null;
        }
        renderQueuedRef.current = false;
      };
    }, [rendererReady, requestRender]);

    useEffect(() => {
      let mounted = true;
      fatalErrorRef.current = false;
      runtimeResetRef.current = false;
      renderQueuedRef.current = false;
      renderInFlightRef.current = false;

      const initRenderer = async (): Promise<void> => {
        const canvas = canvasRef.current;
        if (!canvas) {
          return;
        }

        const renderer = new CanvasKitRenderer();
        try {
          await renderer.init(canvas, {
            useWebGL,
            devicePixelRatio: devicePixelRatio ?? (typeof window !== "undefined" ? window.devicePixelRatio : 1),
          });
          renderer.resize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));

          const canvasKit = renderer.getCanvasKit();
          const canvasInstance = renderer.getCanvas();
          if (!canvasKit || !canvasInstance) {
            throw new Error("CanvasKit 初始化失败：未获取到 Canvas 或 CanvasKit 实例");
          }

          const annotationRenderer = new CanvasAnnotationRenderer({
            canvasKit,
            canvas: canvasInstance,
            styles: resolvedAnnotationStyles,
            viewport: {
              viewportWidth: width,
              viewportHeight: height,
              ...annotationViewport,
            },
          });
          annotationRenderer.setElements(resolvedAnnotationElements);

          if (!mounted) {
            annotationRenderer.dispose();
            renderer.dispose();
            return;
          }

          rendererRef.current = renderer;
          annotationRendererRef.current = annotationRenderer;
          setRendererReady(true);
          onReady?.();
        } catch (error) {
          const initError = error instanceof Error ? error : new Error(String(error));
          renderer.dispose();
          if (mounted) {
            setRendererReady(false);
            handleRendererFailure(initError);
          }
        }
      };

      void initRenderer();

      return () => {
        mounted = false;
        setRendererReady(false);
        annotationRendererRef.current?.dispose();
        annotationRendererRef.current = null;
        rendererRef.current?.dispose();
        rendererRef.current = null;
      };
    }, [devicePixelRatio, onReady, handleRendererFailure, useWebGL]);

    useEffect(() => {
      const renderer = rendererRef.current;
      if (!renderer || !rendererReady) {
        return;
      }

      try {
        renderer.resize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));

        const annotationRenderer = annotationRendererRef.current;
        if (annotationRenderer) {
          const latestCanvas = renderer.getCanvas();
          if (latestCanvas) {
            annotationRenderer.setCanvas(latestCanvas);
          }
          annotationRenderer.setViewportConfig({
            viewportWidth: width,
            viewportHeight: height,
            ...annotationViewport,
          });
        }
      } catch (error) {
        const resizeError = error instanceof Error ? error : new Error(String(error));
        handleRendererFailure(resizeError);
        return;
      }

      requestRender();
    }, [annotationViewport, handleRendererFailure, height, rendererReady, requestRender, width]);

    useEffect(() => {
      const annotationRenderer = annotationRendererRef.current;
      if (!annotationRenderer) {
        return;
      }
      try {
        annotationRenderer.setElements(resolvedAnnotationElements);
        annotationRenderer.updateStyles(resolvedAnnotationStyles);
      } catch (error) {
        const annotationError = error instanceof Error ? error : new Error(String(error));
        handleRendererFailure(annotationError);
        return;
      }
      requestRender();
    }, [handleRendererFailure, requestRender, resolvedAnnotationElements, resolvedAnnotationStyles]);

    useEffect(() => {
      if (!rendererReady) {
        return;
      }
      requestRender();
    }, [
      rendererReady,
      requestRender,
      viewportState,
      activeHoveredId,
      activeSelectedId,
      renderElements,
      backgroundColor,
      showAnnotations,
    ]);

    useEffect(() => {
      if (activeSelectedId && !elementById.has(activeSelectedId)) {
        commitSelectedElement(null);
      }
    }, [activeSelectedId, commitSelectedElement, elementById]);

    useEffect(() => {
      if (activeHoveredId && !elementById.has(activeHoveredId)) {
        commitHoveredElement(null);
      }
    }, [activeHoveredId, commitHoveredElement, elementById]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !interactive) {
        return;
      }

      const handleWheel = (event: WheelEvent) => {
        event.preventDefault();

        if (event.ctrlKey || event.metaKey) {
          const anchor = resolveCanvasPointOrCenter(event.clientX, event.clientY);
          if (!anchor) {
            return;
          }
          const scaleFactor = 1 - event.deltaY * 0.01;

          updateViewport((prev) => {
            const nextScale = Math.max(minScale, Math.min(maxScale, prev.scale * scaleFactor));
            const ratio = nextScale / prev.scale;
            return {
              offsetX: anchor.x - (anchor.x - prev.offsetX) * ratio,
              offsetY: anchor.y - (anchor.y - prev.offsetY) * ratio,
              scale: nextScale,
            };
          });
          return;
        }

        updateViewport((prev) => ({
          ...prev,
          offsetX: prev.offsetX - event.deltaX,
          offsetY: prev.offsetY - event.deltaY,
        }));
      };

      canvas.addEventListener("wheel", handleWheel, { passive: false });
      return () => {
        canvas.removeEventListener("wheel", handleWheel);
      };
    }, [interactive, maxScale, minScale, resolveCanvasPointOrCenter, updateViewport]);

    const handleMouseDown = useCallback(
      (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (!interactive || !panOnPrimaryDrag || event.button !== 0) {
          return;
        }
        dragStartRef.current = { x: event.clientX, y: event.clientY };
        lastPointerRef.current = { x: event.clientX, y: event.clientY };
      },
      [interactive, panOnPrimaryDrag],
    );

    const handleMouseMove = useCallback(
      (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (!interactive) {
          return;
        }

        const point = getCanvasPoint(event.clientX, event.clientY);
        if (!point) {
          return;
        }

        if (event.buttons === 0 && showAnnotations) {
          const nextElement = findElementAtCanvasPoint(point.x, point.y);
          if ((nextElement?.id ?? null) !== activeHoveredId) {
            commitHoveredElement(nextElement);
          }
        }

        if (event.buttons !== 1 || !panOnPrimaryDrag) {
          return;
        }

        const dx = event.clientX - lastPointerRef.current.x;
        const dy = event.clientY - lastPointerRef.current.y;

        if (isDragging) {
          updateViewport((prev) => ({
            ...prev,
            offsetX: prev.offsetX + dx,
            offsetY: prev.offsetY + dy,
          }));
        } else {
          const moveDistance = Math.sqrt(
            (event.clientX - dragStartRef.current.x) ** 2 + (event.clientY - dragStartRef.current.y) ** 2,
          );
          if (moveDistance > 3) {
            setIsDragging(true);
          }
        }

        lastPointerRef.current = { x: event.clientX, y: event.clientY };
      },
      [
        activeHoveredId,
        commitHoveredElement,
        findElementAtCanvasPoint,
        getCanvasPoint,
        interactive,
        isDragging,
        showAnnotations,
        updateViewport,
        panOnPrimaryDrag,
      ],
    );

    const handleMouseUp = useCallback(() => {
      if (!interactive) {
        return;
      }

      const wasDragging = isDragging;
      setTimeout(() => setIsDragging(false), 0);

      if (wasDragging) {
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 120);
      }
    }, [interactive, isDragging]);

    const handleMouseLeave = useCallback(() => {
      commitHoveredElement(null);
      handleMouseUp();
    }, [commitHoveredElement, handleMouseUp]);

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (!interactive || suppressClickRef.current) {
          return;
        }

        const point = getCanvasPoint(event.clientX, event.clientY);
        if (!point) {
          return;
        }

        const element = findElementAtCanvasPoint(point.x, point.y);
        commitSelectedElement(element);
      },
      [commitSelectedElement, findElementAtCanvasPoint, getCanvasPoint, interactive],
    );

    const handleTouchStart = useCallback(
      (event: React.TouchEvent<HTMLCanvasElement>) => {
        if (!interactive) {
          return;
        }
        if (event.touches.length === 1) {
          const touch = event.touches[0];
          touchStartRef.current = { x: touch.clientX, y: touch.clientY };
          touchDraggingRef.current = false;
          touchGestureRef.current = null;
          return;
        }
        if (event.touches.length === 2) {
          const [firstTouch, secondTouch] = Array.from(event.touches);
          touchStartRef.current = null;
          touchDraggingRef.current = false;
          touchGestureRef.current = {
            midpointX: (firstTouch.clientX + secondTouch.clientX) / 2,
            midpointY: (firstTouch.clientY + secondTouch.clientY) / 2,
            distance: Math.hypot(secondTouch.clientX - firstTouch.clientX, secondTouch.clientY - firstTouch.clientY),
          };
        }
      },
      [interactive],
    );

    const handleTouchMove = useCallback(
      (event: React.TouchEvent<HTMLCanvasElement>) => {
        if (!interactive) {
          return;
        }
        if (event.touches.length === 1 && touchStartRef.current) {
          const touch = event.touches[0];
          const totalDx = touch.clientX - touchStartRef.current.x;
          const totalDy = touch.clientY - touchStartRef.current.y;
          const totalDistance = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
          if (totalDistance > 4) {
            touchDraggingRef.current = true;
          }
          return;
        }
        if (event.touches.length !== 2 || !touchGestureRef.current) {
          return;
        }

        const [firstTouch, secondTouch] = Array.from(event.touches);
        const midpointX = (firstTouch.clientX + secondTouch.clientX) / 2;
        const midpointY = (firstTouch.clientY + secondTouch.clientY) / 2;
        const distance = Math.hypot(secondTouch.clientX - firstTouch.clientX, secondTouch.clientY - firstTouch.clientY);
        const lastGesture = touchGestureRef.current;
        const anchor = resolveCanvasPointOrCenter(midpointX, midpointY);
        if (!anchor) {
          return;
        }

        const deltaX = midpointX - lastGesture.midpointX;
        const deltaY = midpointY - lastGesture.midpointY;
        const scaleFactor = lastGesture.distance > 0 ? distance / lastGesture.distance : 1;

        updateViewport((prev) => {
          const pannedViewport = {
            ...prev,
            offsetX: prev.offsetX + deltaX,
            offsetY: prev.offsetY + deltaY,
          };
          if (!Number.isFinite(scaleFactor) || Math.abs(scaleFactor - 1) < 0.001) {
            return pannedViewport;
          }
          const nextScale = Math.max(minScale, Math.min(maxScale, pannedViewport.scale * scaleFactor));
          const ratio = nextScale / pannedViewport.scale;
          return {
            offsetX: anchor.x - (anchor.x - pannedViewport.offsetX) * ratio,
            offsetY: anchor.y - (anchor.y - pannedViewport.offsetY) * ratio,
            scale: nextScale,
          };
        });

        touchGestureRef.current = {
          midpointX,
          midpointY,
          distance,
        };
      },
      [interactive, maxScale, minScale, resolveCanvasPointOrCenter, updateViewport],
    );

    const handleTouchEnd = useCallback(
      (event: React.TouchEvent<HTMLCanvasElement>) => {
        if (!interactive) {
          return;
        }

        if (event.touches.length < 2) {
          touchGestureRef.current = null;
        }

        const changedTouch = event.changedTouches[0];
        if (changedTouch && event.touches.length === 0 && !touchDraggingRef.current && touchStartRef.current) {
          const point = getCanvasPoint(changedTouch.clientX, changedTouch.clientY);
          if (point) {
            const element = findElementAtCanvasPoint(point.x, point.y);
            commitSelectedElement(element);
          }
        }

        touchStartRef.current = null;
        touchDraggingRef.current = false;
      },
      [commitSelectedElement, findElementAtCanvasPoint, getCanvasPoint, interactive],
    );

    const canvasWidth = Math.max(1, Math.round(width));
    const canvasHeight = Math.max(1, Math.round(height));
    const cursor = !interactive
      ? "default"
      : isDragging
        ? "grabbing"
        : showAnnotations
          ? "crosshair"
          : panOnPrimaryDrag
            ? "grab"
            : "default";

    return (
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        className={className}
        style={{
          width: `${canvasWidth}px`,
          height: `${canvasHeight}px`,
          display: "block",
          cursor,
          touchAction: "none",
          ...style,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        aria-label="CanvasKit Surface"
        data-renderer-ready={rendererReady ? "true" : "false"}
      />
    );
  },
);

CanvasKitSurface.displayName = "CanvasKitSurface";
