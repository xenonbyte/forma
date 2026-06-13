import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, buildViewerModel } from "@xenonbyte/forma-viewer";
import type { ViewerModel } from "@xenonbyte/forma-viewer";

import { formatApiError, type ApiErrorInfo, type FormaApiClient, type Product, type ArtifactDetail } from "../api.js";
import { useT } from "../LocaleContext.js";
import { PrimaryActionLink, StatePanel } from "../components/Layout.js";
import { mapComponentLibraryUnits, type ComponentLibraryUnit } from "../viewer/componentLibraryMapper.js";
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
  onBreadcrumbLabel?: (key: string, label: string) => void;
  params: Record<string, string>;
}

// ── view state ─────────────────────────────────────────────────────────────────

type ViewState =
  | { status: "loading" }
  | { status: "error"; error: ApiErrorInfo }
  | { status: "empty" }
  | { status: "no-units" }
  | { status: "ready"; model: ViewerModel };

// ── component ──────────────────────────────────────────────────────────────────

export function BrandResources({ client, onBreadcrumbLabel, params }: BrandResourcesProps) {
  const t = useT();
  const productId = params.productId ?? "";
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

    async function load() {
      let product: Product;
      try {
        product = await client.getProduct(productId);
      } catch (error: unknown) {
        if (!cancelled) {
          console.warn("failed to load product label for brand canvas shell", formatApiError(error));
          onBreadcrumbLabelRef.current?.(`product:${productId}`, tRef.current("canvas.productUnavailable"));
          setState({ status: "error", error: formatApiError(error) });
        }
        return;
      }
      onBreadcrumbLabelRef.current?.(`product:${productId}`, product.name);

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

      const units = (detail.manifest.forma?.units ?? []) as ComponentLibraryUnit[];
      if (units.length === 0) {
        if (!cancelled) {
          setState({ status: "no-units" });
        }
        return;
      }

      const inputs = mapComponentLibraryUnits({ artifactId, version, platform: product.platform, units });
      const model = buildViewerModel({ entry: "page", artifacts: inputs });

      if (!cancelled) {
        setState({ status: "ready", model });
      }
    }

    load().catch((error: unknown) => {
      if (!cancelled) {
        console.warn("failed to load brand resources", formatApiError(error));
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

  // ── no-units: library exists but has no units — prompt regeneration ──

  if (state.status === "no-units") {
    return (
      <StatePanel state="empty" title={t("brand.resources")}>
        {t("brand.noUnitsHelp")}
      </StatePanel>
    );
  }

  // ── ready ──

  return (
    <div className="relative h-full w-full overflow-hidden bg-white" data-testid="brand-tile">
      <div className="absolute right-4 top-4 z-10">
        <PrimaryActionLink href={`/products/${productId}/brand-assets`}>{t("action.brandAssets")}</PrimaryActionLink>
      </div>
      <Canvas model={state.model} mode="design" resolver={resolver} />
    </div>
  );
}
