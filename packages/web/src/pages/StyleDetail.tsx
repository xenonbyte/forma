import { useEffect, useState } from "react";

import { apiClient, formatApiError, type ApiErrorInfo, type BrandStyleContent, type FormaApiClient } from "../api.js";
import { StatePanel } from "../components/Layout.js";
import { useT } from "../LocaleContext.js";

export interface StyleDetailProps {
  client?: Pick<FormaApiClient, "getStyle">;
  params: Record<string, string>;
}

type StyleDetailState =
  | { status: "error"; error: ApiErrorInfo }
  | { status: "loading" }
  | { status: "ready"; style: BrandStyleContent };
type StyleDetailTab = "components" | "design" | "tokens";

export function StyleDetail({ client = apiClient, params }: StyleDetailProps) {
  const tx = useT();
  const styleName = params.name ?? "";
  const [activeTab, setActiveTab] = useState<StyleDetailTab>("components");
  const [state, setState] = useState<StyleDetailState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    client
      .getStyle(styleName)
      .then((style) => {
        if (!cancelled) {
          setState({ status: "ready", style });
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
  }, [client, styleName]);

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title={tx("style.detail.loadingTitle")}>
        {tx("style.detail.loadingBody")}
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel state="error" title={tx("style.detail.unavailableTitle")}>
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  return (
    <section className="min-w-0 rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold tracking-normal text-zinc-950">{state.style.metadata.name}</h2>
        </div>
        <div className="inline-flex shrink-0 rounded-md border border-zinc-200 bg-zinc-50 p-1" role="tablist" aria-label={tx("style.detail.contentTabs")}>
          {(["components", "tokens", "design"] as StyleDetailTab[]).map((tab) => (
            <button
              aria-selected={activeTab === tab}
              className={`rounded px-3 py-1.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 ${
                activeTab === tab ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:bg-white/70 hover:text-zinc-950"
              }`}
              key={tab}
              onClick={() => setActiveTab(tab)}
              role="tab"
              type="button"
            >
              {styleTabLabel(tab, tx)}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        {activeTab === "components" ? (
          <iframe
            sandbox="allow-same-origin"
            srcDoc={state.style.componentsHtml}
            style={{ border: "none", height: 520, width: "100%" }}
            title="components"
          />
        ) : null}
        {activeTab === "tokens" ? (
          <pre className="max-h-[42rem] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm leading-6 text-zinc-800">
            {state.style.tokensCss}
          </pre>
        ) : null}
        {activeTab === "design" ? (
          <pre className="max-h-[42rem] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm leading-6 text-zinc-800">
            {state.style.designMd || tx("style.detail.designMdEmpty")}
          </pre>
        ) : null}
      </div>
    </section>
  );
}

function styleTabLabel(tab: StyleDetailTab, t: (key: string) => string): string {
  if (tab === "components") {
    return t("style.detail.components");
  }
  if (tab === "tokens") {
    return t("style.detail.tokens");
  }
  return t("style.detail.designMd");
}
