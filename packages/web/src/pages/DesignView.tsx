import { useEffect, useMemo, useState } from "react";

import {
  apiClient,
  formatApiError,
  type ActiveDesignSession,
  type ApiErrorInfo,
  type FormaApiClient,
  type ProductComponentLibrary,
  type RequirementDesignCanvas,
  type RequirementDesignIndexStatus,
  type RequirementDesignScene
} from "../api.js";
import { useT } from "../LocaleContext.js";
import { DesignSceneCanvas } from "../components/DesignSceneCanvas.js";
import { DesignSessionPanel } from "../components/DesignSessionPanel.js";
import { PrimaryActionLink, StatePanel, WorkSurface } from "../components/Layout.js";
import { PropertyPanel } from "../components/PropertyPanel.js";

export interface DesignViewProps {
  client?: Pick<FormaApiClient, "getRequirementDesignCanvas" | "getRequirementDesignScene"> &
    Partial<Pick<FormaApiClient, "getActiveRequirementDesignSession" | "getProductComponentLibrary">>;
  params: Record<string, string>;
}

type DesignState =
  | { status: "loading" }
  | { status: "error"; error: ApiErrorInfo }
  | { status: "index"; canvas: RequirementDesignCanvas; indexStatus: Exclude<RequirementDesignIndexStatus, "complete" | "stale"> }
  | {
      activeSession: ActiveDesignSession | null;
      canvas: RequirementDesignCanvas;
      componentLibrary: ProductComponentLibrary | null;
      indexStatus: "complete" | "stale";
      scene: RequirementDesignScene;
      status: "ready";
    };

export function DesignView({ client = apiClient, params }: DesignViewProps) {
  const t = useT();
  const productId = params.productId ?? "";
  const requirementId = params.reqId ?? params.requirementId ?? "";
  const pageId = useMemo(() => selectedPageIdFromLocation(), []);
  const [state, setState] = useState<DesignState>({ status: "loading" });
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    client
      .getRequirementDesignCanvas(productId, requirementId)
      .then(async (canvas) => {
        const indexStatus = designIndexStatus(canvas);
        if (indexStatus !== "complete" && indexStatus !== "stale") {
          if (!cancelled) {
            setState({ canvas, indexStatus, status: "index" });
          }
          return;
        }
        const [scene, activeSession, componentLibrary] = await Promise.all([
          client.getRequirementDesignScene(productId, requirementId),
          client.getActiveRequirementDesignSession ? client.getActiveRequirementDesignSession(productId, requirementId).catch(() => null) : Promise.resolve(null),
          client.getProductComponentLibrary ? client.getProductComponentLibrary(productId).catch(() => null) : Promise.resolve(null)
        ]);
        if (!cancelled) {
          setState({ activeSession, canvas, componentLibrary, indexStatus, scene, status: "ready" });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ error: formatApiError(error), status: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, productId, requirementId]);

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title={t("design.view")}>
        {t("requirement.loading")}
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel action={<PrimaryActionLink href={`/products/${productId}/requirements/${requirementId}`}>{t("requirement.records")}</PrimaryActionLink>} state="error" title={t("design.canvasUnavailable")}>
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  if (state.status === "index") {
    return (
      <StatePanel state={state.indexStatus === "recovery_required" ? "error" : "empty"} title={indexStateTitle(state.indexStatus)}>
        <div className="space-y-2">
          <p className="font-mono text-xs text-zinc-500">{state.canvas.product_id} / {state.canvas.requirement_id}</p>
          {state.indexStatus === "incomplete" ? (
            <p>{state.canvas.pages.map((page) => page.page_id).join(", ")}</p>
          ) : null}
        </div>
      </StatePanel>
    );
  }

  const selectedPage = pageId ?? state.scene.pages[0]?.page_id;
  const pageNodes = (selectedPage ? state.scene.pages.find((page) => page.page_id === selectedPage) : state.scene.pages[0])?.nodes ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{statusLabel(state.indexStatus)}</p>
          <h2 className="mt-1 text-lg font-semibold tracking-normal text-zinc-950">{requirementId}</h2>
        </div>
        <a className={secondaryLinkClasses} href={`/products/${productId}/requirements/${requirementId}`}>
          {t("requirement.records")}
        </a>
      </div>

      <div className="grid gap-5 md:grid-cols-[minmax(480px,1fr)_minmax(320px,24rem)]" data-design-view-layout="responsive">
        <div className="space-y-5">
          {state.indexStatus === "stale" ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Stale</p>
          ) : null}
          <WorkSurface title={t("design.canvas")}>
            <DesignSceneCanvas
              canvasPages={state.canvas.pages}
              onHoverNodeId={setHoveredNodeId}
              onSelectionChange={setSelectedNodeIds}
              productId={productId}
              requirementId={requirementId}
              scene={state.scene}
              selectedNodeIds={selectedNodeIds}
              selectedPageId={selectedPage}
            />
          </WorkSurface>
        </div>
        <div className="space-y-5">
          <WorkSurface title={t("design.properties")}>
            <PropertyPanel
              hoveredNodeId={hoveredNodeId}
              nodes={pageNodes}
              productId={productId}
              requirementId={requirementId}
              selectedNodeIds={selectedNodeIds}
            />
          </WorkSurface>
          <WorkSurface title={t("design.session")}>
            <DesignSessionPanel canvas={state.canvas} componentLibrary={state.componentLibrary} session={state.activeSession} />
          </WorkSurface>
        </div>
      </div>
    </div>
  );
}

function designIndexStatus(canvas: RequirementDesignCanvas): RequirementDesignIndexStatus {
  if (canvas.index_status) {
    return canvas.index_status;
  }
  if (canvas.status === "complete") {
    return canvas.pages.some((page) => page.status !== "done") ? "incomplete" : "complete";
  }
  if (canvas.status === "invalid") {
    return "recovery_required";
  }
  return "missing";
}

function indexStateTitle(status: Exclude<RequirementDesignIndexStatus, "complete" | "stale">): string {
  switch (status) {
    case "incomplete":
      return "Index incomplete";
    case "recovery_required":
      return "Recovery required";
    case "missing":
      return "Index required";
  }
}

function statusLabel(status: "complete" | "stale"): string {
  return status === "complete" ? "Complete" : "Stale";
}

function selectedPageIdFromLocation(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const value = new URL(window.location.href).searchParams.get("page_id");
  return value ?? undefined;
}

const secondaryLinkClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
