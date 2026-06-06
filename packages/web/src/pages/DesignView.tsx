import { useEffect, useMemo, useState } from "react";
import { Canvas, buildViewerModel } from "@xenonbyte/forma-viewer";
import type { ViewerModel } from "@xenonbyte/forma-viewer";

import { formatApiError, type ApiErrorInfo, type FormaApiClient } from "../api.js";
import { useT } from "../LocaleContext.js";
import { StatePanel } from "../components/Layout.js";
import { mapArtifactsToViewerInputs } from "../viewer/mapArtifacts.js";
import { createWebResourceResolver } from "../viewer/resolver.js";

/**
 * Legacy artifact summary shape — kept exported only because RequirementDetail
 * still imports it; the canonical type now lives in api.ts (cleanup lands with
 * the RequirementDetail rewrite).
 */
export interface ArtifactSummary {
  id: string;
  kind: string;
  requirement_id?: string;
  title: string;
  preview_url?: string;
  source_skill_id?: string;
  superseded?: boolean;
  updated_at: string;
}

export type DesignViewClient = Pick<FormaApiClient, "getProduct" | "getRequirement" | "listProductArtifacts">;

export interface DesignViewProps {
  client: DesignViewClient;
  params: Record<string, string>;
}

type ViewState =
  | { status: "loading" }
  | { status: "error"; error: ApiErrorInfo }
  | { status: "empty"; uiAffected: boolean }
  | { status: "ready"; model: ViewerModel };

export function DesignView({ client, params }: DesignViewProps) {
  const t = useT();
  const productId = params.productId ?? "";
  const requirementId = params.reqId ?? params.requirementId ?? "";
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const resolver = useMemo(() => createWebResourceResolver(productId), [productId]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    Promise.all([
      client.getProduct(productId),
      client.getRequirement(productId, requirementId),
      client.listProductArtifacts(productId),
    ])
      .then(([product, requirement, artifactList]) => {
        if (cancelled) {
          return;
        }
        const requirementArtifacts = artifactList.artifacts.filter(
          (artifact) => artifact.requirement_id === requirementId,
        );
        const inputs = mapArtifactsToViewerInputs({
          artifacts: requirementArtifacts,
          pages: requirement.pages.map((page) => ({ page_id: page.page_id, name: page.name })),
          platform: product.platform,
        });
        if (inputs.length === 0) {
          setState({ status: "empty", uiAffected: requirement.ui_affected !== false });
          return;
        }
        setState({ status: "ready", model: buildViewerModel({ entry: "requirement", artifacts: inputs }) });
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
      <StatePanel state="error" title={t("design.canvasUnavailable")}>
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  const backHref = `/products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}`;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-2">
      {/* 顶栏:返回需求详情链接 + 需求 ID */}
      <div className="flex items-center justify-between gap-3">
        <a
          className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-zinc-600 transition hover:text-zinc-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
          href={backHref}
        >
          ← {t("action.backToRequirement")}
        </a>
        <h2 className="truncate text-sm font-semibold tracking-normal text-zinc-950">{requirementId}</h2>
      </div>

      <div className="relative flex-1 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {state.status === "empty" ? (
          <div className="flex h-full items-center justify-center p-8">
            <div className="w-full max-w-md">
              <StatePanel state="empty" title={t("design.view")}>
                {state.uiAffected ? t("design.canvasEmpty") : t("design.noUiChanges")}
              </StatePanel>
            </div>
          </div>
        ) : (
          <Canvas model={state.model} mode="design" resolver={resolver} />
        )}
      </div>
    </div>
  );
}
