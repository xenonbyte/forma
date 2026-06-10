import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, buildViewerModel } from "@xenonbyte/forma-viewer";
import type { ViewerModel } from "@xenonbyte/forma-viewer";

import { formatApiError, type ApiErrorInfo, type FormaApiClient } from "../api.js";
import { useT } from "../LocaleContext.js";
import { StatePanel } from "../components/Layout.js";
import { mapArtifactsToViewerInputs } from "../viewer/mapArtifacts.js";
import { createWebResourceResolver } from "../viewer/resolver.js";

export type DesignViewClient = Pick<FormaApiClient, "getProduct" | "getRequirement" | "listProductArtifacts">;

export interface DesignViewProps {
  client: DesignViewClient;
  onBreadcrumbLabel?: (key: string, label: string) => void;
  params: Record<string, string>;
}

type ViewState =
  | { status: "loading" }
  | { status: "error"; error: ApiErrorInfo }
  | { status: "empty"; uiAffected: boolean }
  | { status: "ready"; model: ViewerModel };

export function DesignView({ client, onBreadcrumbLabel, params }: DesignViewProps) {
  const t = useT();
  const productId = params.productId ?? "";
  const requirementId = params.reqId ?? params.requirementId ?? "";
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const resolver = useMemo(() => createWebResourceResolver(productId), [productId]);
  // Stable refs so the effect closure can read latest values without re-triggering.
  const tRef = useRef(t);
  tRef.current = t;
  const onBreadcrumbLabelRef = useRef(onBreadcrumbLabel);
  onBreadcrumbLabelRef.current = onBreadcrumbLabel;

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
        onBreadcrumbLabelRef.current?.(`product:${productId}`, product.name);
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
        setState({
          status: "ready",
          model: buildViewerModel({ entry: "requirement", artifacts: inputs }),
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.warn("failed to load product label for design canvas shell", formatApiError(error));
          onBreadcrumbLabelRef.current?.(`product:${productId}`, tRef.current("canvas.productUnavailable"));
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

  return (
    <div className="relative h-full w-full overflow-hidden bg-white">
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
  );
}
