import { useEffect, useState } from "react";

import {
  apiClient,
  formatApiError,
  type ApiErrorInfo,
  type CopyItem,
  type FormaApiClient,
  type PageCopyPayload,
  type ProductBaseline,
} from "../api.js";
import { useT } from "../LocaleContext.js";
import { StatePanel, WorkSurface } from "../components/Layout.js";
import { NavigationGraph } from "../components/NavigationGraph.js";

export interface BaselineViewProps {
  client?: Pick<FormaApiClient, "getBaseline" | "getPageCopy">;
  params: Record<string, string>;
}

type BaselineState =
  | { status: "error"; error: ApiErrorInfo }
  | { status: "loading" }
  | { baseline: ProductBaseline; status: "ready" };
type BaselineTab = "graph" | "list";
type BaselineNavigationDisplayEdge = ProductBaseline["navigation"][number] & { trigger?: string };
type BaselinePage = ProductBaseline["pages"][number];
type PageCopyState =
  | { status: "error"; error: ApiErrorInfo }
  | { copy: PageCopyPayload; status: "ready" }
  | { status: "loading" };

export function BaselineView({ client = apiClient, params }: BaselineViewProps) {
  const t = useT();
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
      <StatePanel state="loading" title={t("action.baseline")}>
        {t("baseline.loading")}
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel state="error" title={t("baseline.unavailable")}>
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  if (state.baseline.pages.length === 0 && state.baseline.navigation.length === 0) {
    return (
      <StatePanel state="empty" title={t("baseline.emptyBaseline")}>
        {t("baseline.emptyGenerated")}
      </StatePanel>
    );
  }

  return <BaselineContent baseline={state.baseline} client={client} productId={productId} />;
}

export function BaselineContent({
  baseline,
  client,
  productId,
}: {
  baseline: ProductBaseline;
  client: Pick<FormaApiClient, "getPageCopy">;
  productId: string;
}) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<BaselineTab>("list");
  const [pageCopyStates, setPageCopyStates] = useState<Record<string, PageCopyState>>({});

  useEffect(() => {
    if (activeTab !== "list") {
      return undefined;
    }

    let cancelled = false;
    setPageCopyStates(
      Object.fromEntries(baseline.pages.map((page) => [page.id, { status: "loading" } satisfies PageCopyState])),
    );

    Promise.all(
      baseline.pages.map(async (page) => {
        try {
          const copy = await client.getPageCopy(productId, page.id);
          return [page.id, { copy, status: "ready" } satisfies PageCopyState] as const;
        } catch (error: unknown) {
          return [page.id, { error: formatApiError(error), status: "error" } satisfies PageCopyState] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) {
        setPageCopyStates(Object.fromEntries(entries));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, baseline.pages, client, productId]);

  return (
    <div className="space-y-5">
      <div
        className="inline-flex rounded-md border border-zinc-200 bg-white p-1 shadow-sm"
        role="tablist"
        aria-label={t("baseline.view")}
      >
        {(["list", "graph"] as BaselineTab[]).map((tab) => (
          <button
            aria-selected={activeTab === tab}
            className={`rounded px-3 py-1.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 ${
              activeTab === tab ? "bg-amber-100 text-zinc-950" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950"
            }`}
            key={tab}
            onClick={() => setActiveTab(tab)}
            role="tab"
            type="button"
          >
            {tab === "list" ? t("baseline.list") : t("baseline.graph")}
          </button>
        ))}
      </div>

      {activeTab === "list" ? (
        <>
          <WorkSurface title={t("baseline.functionalPages")}>
            <div className="divide-y divide-zinc-200">
              {baseline.pages.map((page) => (
                <article className="grid gap-3 py-4 lg:grid-cols-[16rem_minmax(0,1fr)_16rem]" key={page.id}>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-zinc-950">{page.name}</h2>
                    <p className="mt-1 font-mono text-xs text-zinc-500">{page.id}</p>
                  </div>
                  <div data-page-content={page.id}>
                    <dl className="grid gap-2 text-sm text-zinc-700">
                      <Fact label={t("baseline.features")} value={page.features || t("baseline.empty")} />
                      <Fact label={t("baseline.fields")} value={page.fields || t("baseline.empty")} />
                      <Fact label={t("baseline.interactions")} value={page.interactions || t("baseline.empty")} />
                    </dl>
                    <PageCopyTable copyState={pageCopyStates[page.id]} page={page} />
                  </div>
                  <div data-page-rail={page.id}>
                    <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
                      {t("baseline.sources")}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {page.source_requirements.length > 0 ? (
                        page.source_requirements.map((requirementId) => (
                          <a
                            className={pillLinkClasses}
                            href={`/products/${productId}/requirements/${requirementId}`}
                            key={requirementId}
                          >
                            {requirementId}
                          </a>
                        ))
                      ) : (
                        <span className="text-sm text-zinc-500">{t("baseline.none")}</span>
                      )}
                    </div>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-normal text-zinc-500">
                      {t("baseline.actions")}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <a
                        className={pageActionLinkClasses}
                        href={`/api/products/${productId}/baseline/pages/${encodeURIComponent(page.id)}/image`}
                      >
                        {t("action.preview")}
                      </a>
                      <a
                        className={pageActionLinkClasses}
                        href={`/api/products/${productId}/baseline/pages/${encodeURIComponent(page.id)}/annotations`}
                      >
                        {t("action.annotations")}
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </WorkSurface>

          <WorkSurface title={t("requirement.navigation")}>
            {baseline.navigation.length === 0 ? (
              <p className="text-sm text-zinc-500">{t("baseline.emptyNavigation")}</p>
            ) : (
              <div className="divide-y divide-zinc-200">
                {baseline.navigation.map((edge, index) => (
                  <div
                    className="grid gap-3 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)_12rem]"
                    key={`${edge.from}-${edge.to}-${index}`}
                  >
                    <span className="truncate font-mono text-zinc-700">{edge.from}</span>
                    <span className="text-zinc-400">{t("common.to")}</span>
                    <span className="truncate font-mono text-zinc-700">{edge.to}</span>
                    <span className="truncate text-zinc-500">{navigationEdgeLabel(edge, t)}</span>
                  </div>
                ))}
              </div>
            )}
          </WorkSurface>
        </>
      ) : (
        <WorkSurface title={t("baseline.navigationGraph")}>
          <NavigationGraph pages={baseline.pages} navigation={baseline.navigation} />
        </WorkSurface>
      )}
    </div>
  );
}

function PageCopyTable({ copyState, page }: { copyState: PageCopyState | undefined; page: BaselinePage }) {
  const t = useT();
  const routeCopy = copyState?.status === "ready" ? copyState.copy : undefined;
  const defaultCopy =
    routeCopy && routeCopy.default_language_copy.length > 0 ? routeCopy.default_language_copy : page.copy;
  const translations = routeCopy?.translations ?? [];
  const contexts = uniqueValues([
    ...defaultCopy.map((item) => item.context),
    ...translations.map((entry) => entry.context),
  ]);
  const languages = uniqueValues(translations.flatMap((entry) => Object.keys(entry.texts)));

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{t("baseline.copy")}</p>
        {copyState?.status === "loading" ? (
          <span className="text-xs text-zinc-500">{t("baseline.loadingCopy")}</span>
        ) : null}
      </div>
      {copyState?.status === "error" ? (
        <p className="mt-2 text-sm text-red-700">
          {copyState.error.error_code} - {t("baseline.copyUnavailable")}
        </p>
      ) : null}

      {contexts.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{t("baseline.emptyCopyEntries")}</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-md border border-zinc-200">
          <table className="min-w-full divide-y divide-zinc-200 text-left text-sm" data-copy-table={page.id}>
            <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-normal text-zinc-500">
              <tr>
                <th className={tableHeaderClasses} scope="col">
                  {t("baseline.tableContext")}
                </th>
                <th className={tableHeaderClasses} scope="col">
                  {t("baseline.defaultCopy")}
                </th>
                {languages.map((language) => (
                  <th className={tableHeaderClasses} key={language} scope="col">
                    {language}
                  </th>
                ))}
                <th className={tableHeaderClasses} scope="col">
                  {t("baseline.status")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 bg-white">
              {contexts.map((context) => {
                const translation = translations.find((entry) => entry.context === context);
                const outdated = translation?.outdated === true;
                return (
                  <tr
                    className={outdated ? "bg-amber-50" : undefined}
                    data-outdated-copy={outdated ? "true" : undefined}
                    key={context}
                  >
                    <td className={`${tableCellClasses} font-mono text-xs text-zinc-700`}>{context}</td>
                    <td className={tableCellClasses}>{copyTextForContext(defaultCopy, context)}</td>
                    {languages.map((language) => (
                      <td className={tableCellClasses} key={language}>
                        {translation?.texts[language] ?? ""}
                      </td>
                    ))}
                    <td className={tableCellClasses}>
                      {outdated ? (
                        <span className="inline-flex rounded-md border border-amber-200 bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                          {t("baseline.outdated")}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-500">{t("baseline.current")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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

function navigationEdgeLabel(edge: BaselineNavigationDisplayEdge, t: (key: string) => string): string {
  return edge.trigger ?? edge.label ?? t("baseline.noLabel");
}

function copyTextForContext(copy: CopyItem[], context: string): string {
  return copy.find((item) => item.context === context)?.text ?? "";
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values));
}

const pillLinkClasses =
  "inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const pageActionLinkClasses =
  "inline-flex items-center rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const tableHeaderClasses = "px-3 py-2";
const tableCellClasses = "px-3 py-2 align-top text-zinc-800";
