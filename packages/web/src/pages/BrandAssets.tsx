import { useEffect, useMemo, useRef, useState } from "react";
import { AssetTile } from "@xenonbyte/forma-viewer";

import { formatApiError, type ApiErrorInfo, type BrandAssetView, type FormaApiClient, type Product } from "../api.js";
import { useT } from "../LocaleContext.js";
import { StatePanel, WorkSurface } from "../components/Layout.js";

// ── client shape ──────────────────────────────────────────────────────────────

/**
 * Narrow FormaApiClient slice the BrandAssets page needs. Tests inject a fake
 * implementing only these four members (one fetch + the product + two URL builders).
 */
export type BrandAssetsClient = Pick<
  FormaApiClient,
  "getProduct" | "getBrandAssets" | "getBrandAssetFileUrl" | "getBrandAssetsExportUrl"
>;

export interface BrandAssetsProps {
  client: BrandAssetsClient;
  onBreadcrumbLabel?: (key: string, label: string) => void;
  params: Record<string, string>;
}

// ── view state ─────────────────────────────────────────────────────────────────

type ViewState =
  | { status: "loading" }
  | { status: "error"; error: ApiErrorInfo }
  | { status: "ready"; product: Product; assets: BrandAssetView[] };

// ── component ──────────────────────────────────────────────────────────────────

export function BrandAssets({ client, onBreadcrumbLabel, params }: BrandAssetsProps) {
  const t = useT();
  const productId = params.productId ?? "";
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const onBreadcrumbLabelRef = useRef(onBreadcrumbLabel);
  onBreadcrumbLabelRef.current = onBreadcrumbLabel;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    async function load() {
      const [product, list] = await Promise.all([client.getProduct(productId), client.getBrandAssets(productId)]);
      if (cancelled) return;
      onBreadcrumbLabelRef.current?.(`product:${productId}`, product.name);
      setState({ status: "ready", product, assets: list.assets });
    }

    load().catch((error: unknown) => {
      if (!cancelled) {
        console.warn("failed to load brand assets", formatApiError(error));
        setState({ status: "error", error: formatApiError(error) });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [client, productId]);

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title={t("brandAssets.title")}>
        {t("brandAssets.loading")}
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel state="error" title={t("brandAssets.title")}>
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  // ── ready ──

  if (state.assets.length === 0) {
    return (
      <StatePanel state="empty" title={t("brandAssets.title")}>
        {t("brandAssets.empty")}
      </StatePanel>
    );
  }

  return <BrandAssetsReady assets={state.assets} client={client} product={state.product} productId={productId} />;
}

// ── ready surface ────────────────────────────────────────────────────────────────

interface BrandAssetsReadyProps {
  assets: BrandAssetView[];
  client: BrandAssetsClient;
  product: Product;
  productId: string;
}

function BrandAssetsReady({ assets, client, product, productId }: BrandAssetsReadyProps) {
  const t = useT();
  const exportHref = client.getBrandAssetsExportUrl(productId);

  // Dynamic kind grouping: render whatever kinds are present, preserving first-seen order.
  // M5 store-shot/poster show up automatically once the data exists — no code change here.
  const groups = useMemo(() => groupByKind(assets), [assets]);

  function downloadFile(url: string, name: string) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  return (
    <WorkSurface
      title={t("brandAssets.title")}
      actions={
        <a
          data-testid="brand-assets-export"
          download
          href={exportHref}
          className="inline-flex items-center justify-center rounded-md bg-amber-500 px-3 py-2 text-sm font-semibold text-zinc-950 shadow-sm transition hover:bg-amber-400 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
        >
          {t("brandAssets.exportAll")}
        </a>
      }
    >
      <div className="grid gap-8">
        {groups.map((group) => (
          <section data-testid="asset-group" data-kind={group.kind} key={group.kind}>
            <h3 className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
              {kindLabel(t, group.kind)}
            </h3>
            <div className="mt-3 flex flex-wrap gap-4">
              {group.assets.flatMap((asset) => {
                const stale = asset.brand_style !== product.brand_style;
                return asset.files.map((file) => {
                  const url = client.getBrandAssetFileUrl(productId, file.path);
                  const fileName = file.path.split("/").pop() ?? asset.name;
                  return (
                    <AssetTile
                      key={file.path}
                      name={asset.name}
                      src={url}
                      width={file.width}
                      height={file.height}
                      stale={stale}
                      staleLabel={t("brandAssets.stale")}
                      downloadLabel={t("brandAssets.download")}
                      onDownload={() => downloadFile(url, fileName)}
                    />
                  );
                });
              })}
            </div>
          </section>
        ))}
      </div>
    </WorkSurface>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────────

interface KindGroup {
  kind: string;
  assets: BrandAssetView[];
}

/** Group assets by manifest kind, preserving the order each kind first appears. */
function groupByKind(assets: BrandAssetView[]): KindGroup[] {
  const order: string[] = [];
  const byKind = new Map<string, BrandAssetView[]>();
  for (const asset of assets) {
    const bucket = byKind.get(asset.kind);
    if (bucket) {
      bucket.push(asset);
    } else {
      order.push(asset.kind);
      byKind.set(asset.kind, [asset]);
    }
  }
  return order.map((kind) => ({ kind, assets: byKind.get(kind) ?? [] }));
}

/** Localized group heading; falls back to the raw kind for kinds without a label. */
function kindLabel(t: (key: string) => string, kind: string): string {
  const key = `brandAssets.kind.${kind}`;
  const label = t(key);
  return label === key ? kind : label;
}
