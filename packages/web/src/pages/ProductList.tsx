import { useEffect, useState } from "react";

import {
  apiClient,
  formatApiError,
  type ApiErrorInfo,
  type DeleteProductResult,
  type FormaApiClient,
  type Product,
  type ProductIndexEntry,
  type RequirementWithDocument
} from "../api.js";
import { useT } from "../LocaleContext.js";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog.js";
import { PrimaryActionLink, StatePanel } from "../components/Layout.js";
import { SkeletonList } from "../components/Skeleton.js";
import { StatusBadge, type ConfigStatus } from "../components/StatusBadge.js";
import type { ProductDeleteNavigationState } from "./ProductDetail.js";

export interface RequirementSummary {
  count: number;
  error?: ApiErrorInfo;
  latest?: RequirementWithDocument;
}

export interface ProductDetailSummary {
  error?: ApiErrorInfo;
  product?: Product;
}

export interface ProductListData {
  productDetails: Record<string, ProductDetailSummary>;
  products: ProductIndexEntry[];
  requirementSummaries: Record<string, RequirementSummary>;
}

export interface ProductListContentProps {
  client?: Pick<FormaApiClient, "deleteProduct">;
  initialDeleteNotice?: DeleteNotice | null;
  productDetails?: Record<string, ProductDetailSummary>;
  products: ProductIndexEntry[];
  requirementSummaries: Record<string, RequirementSummary>;
}

export interface ProductListProps {
  client?: Pick<FormaApiClient, "deleteProduct" | "getProduct" | "listProducts" | "listRequirements">;
  hash?: string;
  navigationState?: unknown;
}

type LoadState =
  | { status: "error"; error: ApiErrorInfo }
  | { status: "loading" }
  | { data: ProductListData; status: "ready" };

export function ProductList({ client = apiClient, navigationState }: ProductListProps = {}) {
  const t = useT();
  const initialDeleteNotice = productDeleteNoticeFromNavigationState(navigationState);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    loadProductListData(client)
      .then((data) => {
        if (!cancelled) {
          setState({ data, status: "ready" });
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
  }, [client]);

  useEffect(() => {
    if (initialDeleteNotice && canUseDom()) {
      window.history.replaceState({}, "", window.location.href);
    }
  }, [initialDeleteNotice]);

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title={t("product.index")}>
        <SkeletonList />
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel action={<PrimaryActionLink href="/products/new">{t("action.newProduct")}</PrimaryActionLink>} state="error" title={t("product.indexUnavailable")}>
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  return (
    <ProductListContent
      client={client}
      initialDeleteNotice={initialDeleteNotice}
      productDetails={state.data.productDetails}
      products={state.data.products}
      requirementSummaries={state.data.requirementSummaries}
    />
  );
}

export async function loadProductListData(client: Pick<FormaApiClient, "getProduct" | "listProducts" | "listRequirements"> = apiClient): Promise<ProductListData> {
  const products = await client.listProducts();
  const entries = await Promise.all(
    products.map(async (product) => {
      const [detail, requirements] = await Promise.all([loadProductDetail(client, product.id), loadRequirementSummary(client, product.id)]);
      return [product.id, detail, requirements] as const;
    })
  );

  return {
    productDetails: Object.fromEntries(entries.map(([productId, detail]) => [productId, detail])),
    products,
    requirementSummaries: Object.fromEntries(entries.map(([productId, , summary]) => [productId, summary]))
  };
}

interface DeleteNotice {
  productId: string;
  result: DeleteProductResult;
}

export function ProductListContent({ client, initialDeleteNotice = null, productDetails = {}, products, requirementSummaries }: ProductListContentProps) {
  const t = useT();
  const [deleteError, setDeleteError] = useState<ApiErrorInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [items, setItems] = useState(products);
  const [notice, setNotice] = useState<DeleteNotice | null>(initialDeleteNotice);
  const [pendingDeleteProduct, setPendingDeleteProduct] = useState<ProductIndexEntry | null>(null);

  useEffect(() => {
    setItems(products);
  }, [products]);

  useEffect(() => {
    if (initialDeleteNotice) {
      setNotice(initialDeleteNotice);
    }
  }, [initialDeleteNotice]);

  if (items.length === 0) {
    return (
      <div className="space-y-5">
        {notice ? <ProductDeleteNotice notice={notice} t={t} /> : null}
        <StatePanel action={<PrimaryActionLink href="/products/new">{t("action.newProduct")}</PrimaryActionLink>} state="empty" title={t("product.noProducts")}>
          <div className="flex items-center gap-3">
            <EmptyProductsIllustration label={t("product.emptyIllustration")} />
            <p>{t("product.noProductsHelp")}</p>
          </div>
        </StatePanel>
      </div>
    );
  }

  async function handleDeleteConfirm(confirmProductId: string) {
    if (!client || !pendingDeleteProduct) {
      return;
    }

    const productId = pendingDeleteProduct.id;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await client.deleteProduct(productId, { confirm_product_id: confirmProductId });
      setItems((current) => current.filter((product) => product.id !== productId));
      setNotice({ productId, result });
      setPendingDeleteProduct(null);
    } catch (error: unknown) {
      setDeleteError(formatApiError(error));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      {notice ? <ProductDeleteNotice notice={notice} t={t} /> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-6 text-zinc-600">{items.length} {t("product.loaded")}</p>
        <PrimaryActionLink href="/products/new">{t("action.newProduct")}</PrimaryActionLink>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((product) => (
          <ProductCard
            detail={productDetails[product.id]}
            key={product.id}
            onDelete={() => {
              setDeleteError(null);
              setPendingDeleteProduct(product);
            }}
            product={product}
            requirementSummary={requirementSummaries[product.id]}
            t={t}
          />
        ))}
      </div>

      {pendingDeleteProduct ? (
        <ConfirmDeleteDialog
          busy={deleting}
          error={deleteError}
          onCancel={() => {
            if (!deleting) {
              setPendingDeleteProduct(null);
              setDeleteError(null);
            }
          }}
          onConfirm={(productId) => void handleDeleteConfirm(productId)}
          open={true}
          product={pendingDeleteProduct}
        />
      ) : null}
    </div>
  );
}

function ProductCard({
  detail,
  onDelete,
  product,
  requirementSummary,
  t
}: {
  detail?: ProductDetailSummary;
  onDelete(): void;
  product: ProductIndexEntry;
  requirementSummary?: RequirementSummary;
  t: (key: string) => string;
}) {
  const detailProduct = detail?.product;
  const configStatus = getConfigStatus(detailProduct);
  const latest = requirementSummary?.latest;

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-[0_1px_3px_rgba(24,24,27,0.10)]" data-product-card="true">
      <div className="flex h-full">
        <div aria-hidden="true" className={`w-1 shrink-0 ${statusStripeTone[configStatus]}`} data-product-status-stripe={configStatus} />
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[11px] font-semibold uppercase leading-4 tracking-normal text-zinc-500">{product.id}</p>
              <h2 className="mt-1 truncate text-base font-semibold tracking-normal text-zinc-950">{product.name}</h2>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-600">{product.description || t("product.noDescription")}</p>
            </div>
            <StatusBadge status={configStatus} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className={inlineBadgeClasses} data-product-inline-badge="requirements">
              <span className="text-zinc-500">{t("requirement.records")}</span>
              <span className="font-semibold text-zinc-900">{requirementLabel(requirementSummary, t)}</span>
            </span>
            <span className={inlineBadgeClasses} data-product-inline-badge="latest-status">
              <span className="text-zinc-500">{t("product.latestStatus")}</span>
              {latest ? <StatusBadge status={latest.status} /> : <StatusBadge status="not_loaded" />}
            </span>
          </div>

          {detail?.error ? <p className="mt-3 text-xs leading-5 text-red-700">{detail.error.error_code} - {t("product.configRequestFailed")}</p> : null}
          {requirementSummary?.error ? (
            <p className="mt-3 text-xs leading-5 text-red-700">{requirementSummary.error.error_code} - {t("requirement.requestFailed")}</p>
          ) : null}

          <div className="mt-auto grid gap-2 pt-4 sm:grid-cols-3">
            <a className={secondaryLinkClasses} href={`/products/${product.id}`}>
              {t("action.open")}
            </a>
            <a className={secondaryLinkClasses} href={latest ? `/products/${product.id}/baseline` : `/products/${product.id}#new-requirement`}>
              {latest ? t("action.baseline") : t("action.createRequirement")}
            </a>
            <button className={dangerLinkClasses} data-product-delete={product.id} onClick={onDelete} type="button">
              {t("action.delete")}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ProductDeleteNotice({ notice, t }: { notice: DeleteNotice; t: (key: string) => string }) {
  return (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
      <p className="font-semibold">{t("product.deleteSuccess")} {notice.productId}</p>
      <div className="mt-1 grid gap-1">
        {notice.result.session_cleared ? <p>{t("product.deleteSessionCleared")}</p> : null}
        {notice.result.cleanup_pending ? <p>{t("product.deleteCleanupPending")}</p> : null}
        {notice.result.recovery_warnings.length > 0 ? (
          <p>{t("product.deleteRecoveryWarnings")}: {notice.result.recovery_warnings.join("; ")}</p>
        ) : null}
      </div>
    </section>
  );
}

function productDeleteNoticeFromNavigationState(navigationState: unknown): DeleteNotice | null {
  if (!isRecord(navigationState)) {
    return null;
  }

  const deleteState = navigationState.productDelete;
  if (!isProductDeleteNavigationState(deleteState)) {
    return null;
  }

  return {
    productId: deleteState.productId,
    result: {
      product_id: deleteState.productId,
      deleted: true,
      session_cleared: deleteState.sessionCleared,
      cleanup_pending: deleteState.cleanupPending,
      recovery_warnings: deleteState.recoveryWarnings
    }
  };
}

function isProductDeleteNavigationState(value: unknown): value is ProductDeleteNavigationState {
  return (
    isRecord(value) &&
    typeof value.productId === "string" &&
    typeof value.sessionCleared === "boolean" &&
    typeof value.cleanupPending === "boolean" &&
    Array.isArray(value.recoveryWarnings) &&
    value.recoveryWarnings.every((warning) => typeof warning === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function canUseDom(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function EmptyProductsIllustration({ label }: { label: string }) {
  return (
    <svg
      aria-label={label}
      className="h-14 w-14 shrink-0 text-amber-600"
      data-empty-illustration="products"
      fill="none"
      role="img"
      viewBox="0 0 56 56"
    >
      <rect className="text-amber-50" fill="currentColor" height="44" rx="10" width="44" x="6" y="6" />
      <path d="M17 19h22M17 28h22M17 37h12" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
      <path d="M14 14h28v28H14z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

async function loadProductDetail(client: Pick<FormaApiClient, "getProduct">, productId: string): Promise<ProductDetailSummary> {
  try {
    return { product: await client.getProduct(productId) };
  } catch (error: unknown) {
    return { error: formatApiError(error) };
  }
}

async function loadRequirementSummary(client: Pick<FormaApiClient, "listRequirements">, productId: string): Promise<RequirementSummary> {
  try {
    const requirements = await client.listRequirements(productId);
    return {
      count: requirements.length,
      latest: latestRequirement(requirements)
    };
  } catch (error: unknown) {
    return {
      count: 0,
      error: formatApiError(error)
    };
  }
}

function latestRequirement(requirements: RequirementWithDocument[]): RequirementWithDocument | undefined {
  return [...requirements].sort((left, right) => requirementTimestamp(right) - requirementTimestamp(left) || left.id.localeCompare(right.id))[0];
}

function requirementTimestamp(requirement: RequirementWithDocument): number {
  return Date.parse(requirement.updated_at || requirement.created_at) || 0;
}

function requirementLabel(summary: RequirementSummary | undefined, t: (key: string) => string): string {
  if (!summary) {
    return t("status.not_loaded").toLowerCase();
  }

  return `${summary.count} ${summary.count === 1 ? t("requirement.recordCountSingular") : t("requirement.recordCount")}`;
}

function getConfigStatus(product: Product | undefined): ConfigStatus {
  if (!product) {
    return "not_loaded";
  }

  if (isListConfigurationComplete(product)) {
    return "configured";
  }

  return "configuration_incomplete";
}

function isListConfigurationComplete(product: Product): boolean {
  return Boolean(
    product.platform &&
      product.brand_style &&
      product.languages &&
      product.languages.length > 0 &&
      product.default_language &&
      product.languages.includes(product.default_language)
  );
}

const inlineBadgeClasses = "inline-flex min-h-8 items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs";
const secondaryLinkClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const dangerLinkClasses =
  "inline-flex items-center justify-center rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 hover:text-red-800 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500";
const statusStripeTone: Record<ConfigStatus, string> = {
  configuration_incomplete: "bg-amber-400",
  configured: "bg-sky-400",
  initialized: "bg-emerald-400",
  not_initialized: "bg-amber-400",
  not_loaded: "bg-zinc-300",
  unconfigured: "bg-red-400"
};
