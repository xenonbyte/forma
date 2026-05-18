import { useEffect, useMemo, useRef, useState } from "react";

import type { BaselinePage } from "../api.js";
import { countFeatures, layoutNavigationGraph, type ForceLayoutResult } from "../lib/force-layout.js";

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

const selectedStroke = "#d97706";
const nodeStroke = "#d4d4d8";
const hoverStroke = "#2563eb";
const nodeFill = "#ffffff";
const selectedFill = "#fffbeb";

export function normalizeNavigation(input: NavigationGraphNavigationInput[]): NavigationGraphEdge[] {
  return input.map((edge) => ({
    from: edge.from,
    label: edge.trigger ?? edge.label ?? "No label",
    to: edge.to
  }));
}

export function NavigationGraph({ pages, navigation }: NavigationGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? null;
  const normalizedNavigation = useMemo(() => normalizeNavigation(navigation), [navigation]);
  const layout = useMemo(
    () =>
      layoutNavigationGraph({
        nodes: pages.map((page) => ({ id: page.id, label: page.name, featureCount: countFeatures(page.features) })),
        edges: normalizedNavigation
      }),
    [normalizedNavigation, pages]
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
            selectedPageId
          },
          runtime
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
      <div
        aria-label="Navigation graph"
        className="relative h-[560px] w-full overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
      >
        <div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full" ref={containerRef} />
        {runtimeError ? (
          <div className="absolute inset-x-3 top-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            Navigation graph unavailable: {runtimeError}
          </div>
        ) : null}
      </div>

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
}

function mountNavigationGraphScene({ container, layout, onSelectPage, selectedPageId }: NavigationGraphSceneOptions, runtime: LeaferRuntime): NavigationGraphScene {
  const leafer = new runtime.Leafer({
    fill: "#fafafa",
    height: layout.height,
    hittable: true,
    view: container,
    width: layout.width
  });

  try {
    leafer.lockLayout?.();

    for (const edge of layout.edges) {
      leafer.add(
        new runtime.Path({
          hitSelf: false,
          hittable: false,
          name: `edge-${edge.from}-${edge.to}`,
          path: [
            ["M", edge.source.x, edge.source.y],
            ["L", edge.target.x, edge.target.y]
          ],
          stroke: "#a1a1aa",
          strokeWidth: 1.5
        })
      );
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
          x: (edge.source.x + edge.target.x) / 2 - 80,
          y: (edge.source.y + edge.target.y) / 2 - 18
        })
      );
    }

    for (const node of layout.nodes) {
      const selected = node.id === selectedPageId;
      const width = Math.max(128, node.radius * 3.4);
      const height = 52;
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
        y: node.y - height / 2
      });

      rect.on?.(runtime.PointerEvent.ENTER, () => {
        if (!selected) {
          rect.stroke = hoverStroke;
          rect.strokeWidth = 2;
        }
        leafer.requestRender?.();
      });
      rect.on?.(runtime.PointerEvent.LEAVE, () => {
        rect.stroke = selected ? selectedStroke : nodeStroke;
        rect.strokeWidth = selected ? 2 : 1;
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
          text: node.label,
          textAlign: "center",
          textOverflow: "ellipsis",
          width: width - 16,
          x: node.x - width / 2 + 8,
          y: node.y - 9
        })
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
    }
  };
}

async function loadLeaferRuntime(): Promise<LeaferRuntime> {
  const runtime = await import("leafer-ui");
  return {
    Leafer: runtime.Leafer as LeaferRuntime["Leafer"],
    Path: runtime.Path as LeaferRuntime["Path"],
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
