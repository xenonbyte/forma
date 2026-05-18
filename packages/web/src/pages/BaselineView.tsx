import { useEffect, useState } from "react";

import { apiClient, formatApiError, type ApiErrorInfo, type FormaApiClient, type ProductBaseline } from "../api.js";
import { PrimaryActionLink, StatePanel, WorkSurface } from "../components/Layout.js";

export interface BaselineViewProps {
  client?: Pick<FormaApiClient, "getBaseline">;
  params: Record<string, string>;
}

type BaselineState = { status: "error"; error: ApiErrorInfo } | { status: "loading" } | { baseline: ProductBaseline; status: "ready" };

export function BaselineView({ client = apiClient, params }: BaselineViewProps) {
  const productId = params.productId ?? "";
  const [state, setState] = useState<BaselineState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    client
      .getBaseline(productId)
      .then((baseline) => {
        if (!cancelled) {
          setState({ baseline, status: "ready" });
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
  }, [client, productId]);

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title="Baseline">
        Loading functional pages and navigation.
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel action={<PrimaryActionLink href={`/products/${productId}`}>Product</PrimaryActionLink>} state="error" title="Baseline unavailable">
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  if (state.baseline.pages.length === 0 && state.baseline.navigation.length === 0) {
    return (
      <StatePanel action={<PrimaryActionLink href={`/products/${productId}`}>Product</PrimaryActionLink>} state="empty" title="Empty baseline">
        No functional pages or navigation have been generated for this product.
      </StatePanel>
    );
  }

  return <BaselineContent baseline={state.baseline} productId={productId} />;
}

export function BaselineContent({ baseline, productId }: { baseline: ProductBaseline; productId: string }) {
  return (
    <div className="space-y-5">
      <div className="flex justify-start">
        <a className={secondaryLinkClasses} href={`/products/${productId}`}>
          Back to product
        </a>
      </div>

      <WorkSurface title="Functional pages">
        <div className="divide-y divide-zinc-200">
          {baseline.pages.map((page) => (
            <article className="grid gap-3 py-4 lg:grid-cols-[16rem_minmax(0,1fr)_16rem]" key={page.id}>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-zinc-950">{page.name}</h2>
                <p className="mt-1 font-mono text-xs text-zinc-500">{page.id}</p>
              </div>
              <dl className="grid gap-2 text-sm text-zinc-700">
                <Fact label="Features" value={page.features || "Empty"} />
                <Fact label="Copy" value={page.copy || "Empty"} />
                <Fact label="Fields" value={page.fields || "Empty"} />
                <Fact label="Interactions" value={page.interactions || "Empty"} />
              </dl>
              <div>
                <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">Sources</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {page.source_requirements.length > 0 ? (
                    page.source_requirements.map((requirementId) => (
                      <a className={pillLinkClasses} href={`/products/${productId}/requirements/${requirementId}`} key={requirementId}>
                        {requirementId}
                      </a>
                    ))
                  ) : (
                    <span className="text-sm text-zinc-500">None</span>
                  )}
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-normal text-zinc-500">Actions</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <a className={pageActionLinkClasses} href={`/api/products/${productId}/baseline/pages/${encodeURIComponent(page.id)}/image`}>
                    Preview
                  </a>
                  <a className={pageActionLinkClasses} href={`/api/products/${productId}/baseline/pages/${encodeURIComponent(page.id)}/annotations`}>
                    Annotations
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      </WorkSurface>

      <WorkSurface title="Navigation">
        {baseline.navigation.length === 0 ? (
          <p className="text-sm text-zinc-500">No navigation edges are present.</p>
        ) : (
          <div className="divide-y divide-zinc-200">
            {baseline.navigation.map((edge, index) => (
              <div className="grid gap-3 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)_12rem]" key={`${edge.from}-${edge.to}-${index}`}>
                <span className="truncate font-mono text-zinc-700">{edge.from}</span>
                <span className="text-zinc-400">to</span>
                <span className="truncate font-mono text-zinc-700">{edge.to}</span>
                <span className="truncate text-zinc-500">{edge.label ?? "No label"}</span>
              </div>
            ))}
          </div>
        )}
      </WorkSurface>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap text-zinc-800">{value}</dd>
    </div>
  );
}

const secondaryLinkClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const pillLinkClasses =
  "inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const pageActionLinkClasses =
  "inline-flex items-center rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
