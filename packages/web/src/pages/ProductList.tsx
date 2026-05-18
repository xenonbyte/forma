import { useEffect, useState } from "react";

import {
  apiClient,
  formatApiError,
  type ApiErrorInfo,
  type FormaApiClient,
  type Product,
  type ProductIndexEntry,
  type RequirementWithDocument
} from "../api.js";
import { useT } from "../LocaleContext.js";
import { PrimaryActionLink, StatePanel } from "../components/Layout.js";
import { StatusBadge, type ConfigStatus } from "../components/StatusBadge.js";

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
  productDetails?: Record<string, ProductDetailSummary>;
  products: ProductIndexEntry[];
  requirementSummaries: Record<string, RequirementSummary>;
}

type LoadState =
  | { status: "error"; error: ApiErrorInfo }
  | { status: "loading" }
  | { data: ProductListData; status: "ready" };

export function ProductList() {
  const t = useT();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    loadProductListData()
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
  }, []);

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title={t("product.index")}>
        {t("product.indexLoading")}
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

export function ProductListContent({ productDetails = {}, products, requirementSummaries }: ProductListContentProps) {
  const t = useT();

  if (products.length === 0) {
    return (
      <div className="space-y-5">
        <StatePanel action={<PrimaryActionLink href="/products/new">{t("action.newProduct")}</PrimaryActionLink>} state="empty" title={t("product.noProducts")}>
          {t("product.noProductsHelp")}
        </StatePanel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-6 text-zinc-600">{products.length} {t("product.loaded")}</p>
        <PrimaryActionLink href="/products/new">{t("action.newProduct")}</PrimaryActionLink>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {products.map((product) => (
          <ProductCard
            detail={productDetails[product.id]}
            key={product.id}
            product={product}
            requirementSummary={requirementSummaries[product.id]}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

function ProductCard({
  detail,
  product,
  requirementSummary,
  t
}: {
  detail?: ProductDetailSummary;
  product: ProductIndexEntry;
  requirementSummary?: RequirementSummary;
  t: (key: string) => string;
}) {
  const detailProduct = detail?.product;
  const configStatus = getConfigStatus(detailProduct);
  const latest = requirementSummary?.latest;

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-normal text-zinc-950">{product.name}</h2>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-600">{product.description || t("product.noDescription")}</p>
        </div>
        <StatusBadge status={configStatus} />
      </div>

      <dl className="mt-4 grid gap-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-zinc-500">{t("product.id")}</dt>
          <dd className="font-mono text-xs text-zinc-700">{product.id}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-zinc-500">{t("requirement.records")}</dt>
          <dd className="font-medium text-zinc-800">{requirementLabel(requirementSummary, t)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-zinc-500">{t("product.latestStatus")}</dt>
          <dd>{latest ? <StatusBadge status={latest.status} /> : <StatusBadge status="not_loaded" />}</dd>
        </div>
      </dl>

      {detail?.error ? <p className="mt-3 text-xs leading-5 text-red-700">{detail.error.error_code} - {t("product.configRequestFailed")}</p> : null}
      {requirementSummary?.error ? (
        <p className="mt-3 text-xs leading-5 text-red-700">{requirementSummary.error.error_code} - {t("requirement.requestFailed")}</p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <a className={secondaryLinkClasses} href={`/products/${product.id}`}>
          {t("action.open")}
        </a>
        <a className={secondaryLinkClasses} href={latest ? `/products/${product.id}/baseline` : `/products/${product.id}#new-requirement`}>
          {latest ? t("action.baseline") : t("action.createRequirement")}
        </a>
      </div>
    </article>
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
    return "initialized";
  }

  return "configuration_incomplete";
}

function isListConfigurationComplete(product: Product): boolean {
  return Boolean(
    product.platform &&
      product.style &&
      product.languages &&
      product.languages.length > 0 &&
      product.default_language &&
      product.languages.includes(product.default_language) &&
      product.components_initialized
  );
}

const secondaryLinkClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
