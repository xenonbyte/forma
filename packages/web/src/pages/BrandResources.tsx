import { useEffect, useMemo, useState } from "react";
import { Canvas, buildViewerModel } from "@xenonbyte/forma-viewer";
import type { ViewerModel } from "@xenonbyte/forma-viewer";

import { formatApiError, type ApiErrorInfo, type FormaApiClient, type Product, type ArtifactDetail } from "../api.js";
import { useT } from "../LocaleContext.js";
import { StatePanel } from "../components/Layout.js";
import { mapBrandResourcesArtifact } from "../viewer/brandResourcesMapper.js";
import { createWebResourceResolver } from "../viewer/resolver.js";

// ── client shape ──────────────────────────────────────────────────────────────

/**
 * BC3: narrow FormaApiClient slice needed by BrandResources.
 * Tests inject a fake that implements only these three methods.
 */
export type BrandResourcesClient = Pick<
  FormaApiClient,
  "getProduct" | "getProductArtifact" | "getArtifactVersionBundleAssetUrl"
>;

export interface BrandResourcesProps {
  client: BrandResourcesClient;
  params: Record<string, string>;
}

// ── view state ─────────────────────────────────────────────────────────────────

type ViewState =
  | { status: "loading" }
  | { status: "error"; error: ApiErrorInfo }
  | { status: "empty" }
  | {
      status: "ready";
      model: ViewerModel;
      /** Served URL for the product icon; undefined when manifest.forma.productIcon is absent. */
      iconUrl: string | undefined;
    };

// ── component ──────────────────────────────────────────────────────────────────

export function BrandResources({ client, params }: BrandResourcesProps) {
  const t = useT();
  const productId = params.productId ?? "";
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const resolver = useMemo(() => createWebResourceResolver(productId), [productId]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    async function load() {
      const product: Product = await client.getProduct(productId);

      if (!product.designSystemArtifactId) {
        if (!cancelled) {
          setState({ status: "empty" });
        }
        return;
      }

      const artifactId = product.designSystemArtifactId;
      const detail: ArtifactDetail = await client.getProductArtifact(productId, artifactId);
      const version = detail.current_version;

      if (typeof version !== "number") {
        // Artifact exists but has no versioned bundle yet — treat as empty.
        if (!cancelled) {
          setState({ status: "empty" });
        }
        return;
      }

      const input = mapBrandResourcesArtifact({
        artifactId,
        title: detail.manifest.title,
        version,
        platform: product.platform,
      });

      const model = buildViewerModel({ entry: "page", artifacts: [input] });

      // Resolve product icon from manifest.forma.productIcon (RISK-MIG-003 tolerance: optional).
      const primaryPath = detail.manifest.forma?.productIcon?.primary;
      const iconUrl = primaryPath
        ? client.getArtifactVersionBundleAssetUrl(productId, artifactId, version, primaryPath)
        : undefined;

      if (!cancelled) {
        setState({ status: "ready", model, iconUrl });
      }
    }

    load().catch((error: unknown) => {
      if (!cancelled) {
        setState({ status: "error", error: formatApiError(error) });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [client, productId]);

  // ── loading ──

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title={t("brand.resources")}>
        {t("brand.loading")}
      </StatePanel>
    );
  }

  // ── error ──

  if (state.status === "error") {
    return (
      <StatePanel state="error" title={t("brand.resources")}>
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  // ── empty: pointer unset — prompt to run fm-refine-components ──

  if (state.status === "empty") {
    return (
      <StatePanel state="empty" title={t("brand.resources")}>
        {t("brand.noPointerHelp")}
      </StatePanel>
    );
  }

  // ── ready ──

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      {/* Product icon tile: page-level img from manifest.forma.productIcon — NOT parsed from HTML */}
      {state.iconUrl !== undefined ? (
        <div className="flex items-center gap-3">
          <img
            alt={t("brand.productIcon")}
            className="h-12 w-12 rounded-lg border border-zinc-200 object-contain bg-white p-1 shadow-sm"
            data-testid="product-icon-tile"
            src={state.iconUrl}
          />
        </div>
      ) : null}

      {/* Component-library canvas: brand-tile wraps the Canvas */}
      <div
        className="relative flex-1 overflow-hidden rounded-lg border border-zinc-200 bg-white"
        data-testid="brand-tile"
      >
        <Canvas model={state.model} mode="design" resolver={resolver} />
      </div>
    </div>
  );
}
