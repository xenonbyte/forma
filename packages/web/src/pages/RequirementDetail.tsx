import { useEffect, useState } from "react";

import { apiClient, formatApiError, type ApiErrorInfo, type FormaApiClient, type RequirementWithDocument } from "../api.js";
import { PrimaryActionLink, StatePanel, WorkSurface } from "../components/Layout.js";
import { StatusBadge } from "../components/StatusBadge.js";

export interface RequirementDetailProps {
  client?: Pick<FormaApiClient, "getRequirement">;
  params: Record<string, string>;
}

type RequirementState = { status: "error"; error: ApiErrorInfo } | { status: "loading" } | { requirement: RequirementWithDocument; status: "ready" };

export function RequirementDetail({ client = apiClient, params }: RequirementDetailProps) {
  const productId = params.productId ?? "";
  const requirementId = params.reqId ?? "";
  const [state, setState] = useState<RequirementState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    client
      .getRequirement(productId, requirementId)
      .then((requirement) => {
        if (!cancelled) {
          setState({ requirement, status: "ready" });
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
      <StatePanel state="loading" title="Requirement">
        Loading requirement document and page records.
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel action={<PrimaryActionLink href={`/products/${productId}`}>Product</PrimaryActionLink>} state="error" title="Requirement unavailable">
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  const requirement = state.requirement;
  const hasDocument = requirement.document_md.trim().length > 0;
  const noUiChanges = requirement.ui_affected === false;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={requirement.status} />
            {noUiChanges ? (
              <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold leading-none text-zinc-700">
                No UI changes
              </span>
            ) : null}
            <span className="font-mono text-xs text-zinc-500">{requirement.id}</span>
          </div>
          <a className={secondaryLinkClasses} href={`/products/${productId}`}>
            Back to product
          </a>
        </div>

        {hasDocument ? (
          <WorkSurface title="Requirement document">
            <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm leading-6 text-zinc-800">
              {requirement.document_md}
            </pre>
          </WorkSurface>
        ) : (
          <StatePanel state="empty" title="Requirement document">
            No markdown document is stored for this requirement.
          </StatePanel>
        )}

        {requirement.pages.length === 0 ? (
          <StatePanel state="empty" title="Requirement pages">
            No page records are attached to this requirement.
          </StatePanel>
        ) : (
          <WorkSurface title="Requirement pages">
            <div className="divide-y divide-zinc-200">
              {requirement.pages.map((page) => (
                <article className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_8rem_10rem]" key={page.page_id}>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-zinc-950">{page.name}</h2>
                    <p className="mt-1 font-mono text-xs text-zinc-500">{page.page_id}</p>
                    <p className="mt-1 text-xs text-zinc-500">Baseline: {page.baseline_page}</p>
                  </div>
                  <div className="flex items-center">
                    {noUiChanges ? <span className="text-sm text-zinc-500">No UI changes</span> : <StatusBadge status={page.design_status} />}
                  </div>
                  <div className="flex items-center">
                    {noUiChanges ? (
                      <span className="text-sm text-zinc-500">No design action</span>
                    ) : page.design_id ? (
                      <a className={secondaryLinkClasses} href={`/products/${productId}/requirements/${requirement.id}/designs/${page.design_id}`}>
                        Open design
                      </a>
                    ) : (
                      <span className="text-sm text-zinc-500">No design</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </WorkSurface>
        )}
      </div>

      <div className="space-y-3">
        {noUiChanges ? null : (
          <WorkSurface title="Design history">
            {requirement.pages.some((page) => page.design_id) ? (
              <div className="space-y-2">
                {requirement.pages
                  .filter((page) => page.design_id)
                  .map((page) => (
                    <a
                      className={secondaryLinkClasses}
                      href={`/products/${productId}/requirements/${requirement.id}/designs/${page.design_id}`}
                      key={page.design_id}
                    >
                      {page.design_id}
                    </a>
                  ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No design IDs are present.</p>
            )}
          </WorkSurface>
        )}
        <WorkSurface title="Navigation">
          {requirement.navigation.length === 0 ? (
            <p className="text-sm text-zinc-500">No navigation edges are attached.</p>
          ) : (
            <div className="space-y-2">
              {requirement.navigation.map((edge, index) => (
                <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm" key={`${edge.from}-${edge.to}-${index}`}>
                  <span className="font-mono text-zinc-700">{edge.from}</span>
                  <span className="px-2 text-zinc-400">to</span>
                  <span className="font-mono text-zinc-700">{edge.to}</span>
                  {edge.label ? <span className="ml-2 text-zinc-500">{edge.label}</span> : null}
                </div>
              ))}
            </div>
          )}
        </WorkSurface>
      </div>
    </div>
  );
}

const secondaryLinkClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
