import { useEffect, useState } from "react";

import {
  apiClient,
  formatApiError,
  type ApiErrorInfo,
  type FormaApiClient,
  type RequirementWithDocument,
} from "../api.js";
import { useT } from "../LocaleContext.js";
import { StatePanel, WorkSurface } from "../components/Layout.js";
import { StatusBadge } from "../components/StatusBadge.js";
import type { ArtifactSummary } from "./DesignView.js";

export interface RequirementDetailProps {
  client?: Pick<FormaApiClient, "getRequirement"> & {
    listProductArtifacts?: (productId: string, kind?: string) => Promise<{ artifacts: ArtifactSummary[] }>;
  };
  onBreadcrumbLabel?: (key: string, label: string) => void;
  params: Record<string, string>;
}

type RequirementState =
  | { status: "error"; error: ApiErrorInfo }
  | { status: "loading" }
  | { artifacts: ArtifactSummary[]; requirement: RequirementWithDocument; status: "ready" };

export function RequirementDetail({ client = apiClient, onBreadcrumbLabel, params }: RequirementDetailProps) {
  const t = useT();
  const productId = params.productId ?? "";
  const requirementId = params.reqId ?? "";
  const [state, setState] = useState<RequirementState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    client
      .getRequirement(productId, requirementId)
      .then(async (requirement) => {
        const artifactsResult = client.listProductArtifacts
          ? await client.listProductArtifacts(productId, "html").catch(() => ({ artifacts: [] }))
          : { artifacts: [] };
        if (!cancelled) {
          setState({ artifacts: artifactsResult.artifacts, requirement, status: "ready" });
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

  useEffect(() => {
    if (state.status === "ready") {
      onBreadcrumbLabel?.(`requirement:${requirementId}`, state.requirement.title || requirementId);
    }
  }, [onBreadcrumbLabel, requirementId, state]);

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title={t("requirement.records")}>
        {t("requirement.loading")}
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel state="error" title={t("requirement.unavailable")}>
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  const requirement = state.requirement;
  const artifacts = state.artifacts;
  const hasDocument = requirement.document_md.trim().length > 0;
  const noUiChanges = requirement.ui_affected === false;
  const latestArtifact =
    artifacts.find((artifact) => artifact.requirement_id === requirementId && artifact.kind !== "design-system") ??
    null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={requirement.status} />
            {noUiChanges ? (
              <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold leading-none text-zinc-700">
                {t("requirement.noUiChanges")}
              </span>
            ) : null}
            <span className="font-mono text-xs text-zinc-500">{requirement.id}</span>
          </div>
        </div>

        {hasDocument ? (
          <WorkSurface title={t("requirement.document")}>
            <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm leading-6 text-zinc-800">
              {requirement.document_md}
            </pre>
          </WorkSurface>
        ) : (
          <StatePanel state="empty" title={t("requirement.document")}>
            {t("requirement.documentEmpty")}
          </StatePanel>
        )}

        {requirement.pages.length === 0 ? (
          <StatePanel state="empty" title={t("requirement.pages")}>
            {t("requirement.pagesEmpty")}
          </StatePanel>
        ) : (
          <WorkSurface title={t("requirement.pages")}>
            <div className="divide-y divide-zinc-200">
              {requirement.pages.map((page) => (
                <article className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_8rem_10rem]" key={page.page_id}>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-zinc-950">{page.name}</h2>
                    <p className="mt-1 font-mono text-xs text-zinc-500">{page.page_id}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {t("requirement.baseline")}: {page.baseline_page}
                    </p>
                  </div>
                  <div className="flex items-center">
                    {noUiChanges ? (
                      <span className="text-sm text-zinc-500">{t("requirement.noUiChanges")}</span>
                    ) : (
                      <StatusBadge status={page.design_status} />
                    )}
                  </div>
                  <div className="flex items-center">
                    {noUiChanges ? (
                      <span className="text-sm text-zinc-500">{t("requirement.noDesignAction")}</span>
                    ) : (
                      <a
                        className={secondaryLinkClasses}
                        href={`/products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}/design?page_id=${encodeURIComponent(page.page_id)}`}
                      >
                        {t("action.openDesign")}
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </WorkSurface>
        )}
      </div>

      <div className="space-y-3">
        {!noUiChanges ? (
          <WorkSurface title={t("design.artifactPreview")}>
            {latestArtifact ? (
              <div className="space-y-3">
                <img
                  alt={latestArtifact.title}
                  className="max-h-[200px] w-full rounded-md border border-zinc-200 object-contain"
                  src={artifactPreviewUrl(productId, latestArtifact.id, "1x")}
                />
                <a
                  className={secondaryLinkClasses}
                  href={`forma://products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}/artifacts`}
                >
                  {t("action.openInApp")}
                </a>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-zinc-500">{t("design.noArtifactYet")}</p>
                <a
                  className={secondaryLinkClasses}
                  href={`forma://products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}/artifacts`}
                >
                  {t("action.openInApp")}
                </a>
              </div>
            )}
          </WorkSurface>
        ) : null}
        <WorkSurface title={t("requirement.navigation")}>
          {requirement.navigation.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("requirement.navigationEmpty")}</p>
          ) : (
            <div className="space-y-2">
              {requirement.navigation.map((edge, index) => (
                <div
                  className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
                  key={`${edge.from}-${edge.to}-${index}`}
                >
                  <span className="font-mono text-zinc-700">{edge.from}</span>
                  <span className="px-2 text-zinc-400">{t("common.to")}</span>
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

function artifactPreviewUrl(productId: string, artifactId: string, resolution: "1x" | "2x"): string {
  return `/api/products/${encodeURIComponent(productId)}/artifacts/${encodeURIComponent(artifactId)}/preview/${resolution}`;
}
