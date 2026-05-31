import { useEffect, useState } from "react";

import { apiClient, formatApiError, type ApiErrorInfo, type BrandStyleContent, type FormaApiClient } from "../api.js";
import { PrimaryActionLink, StatePanel, WorkSurface } from "../components/Layout.js";
import { useT } from "../LocaleContext.js";

export interface StyleDetailProps {
  client?: Pick<FormaApiClient, "getStyle">;
  params: Record<string, string>;
}

type StyleDetailState =
  | { status: "error"; error: ApiErrorInfo }
  | { status: "loading" }
  | { status: "ready"; style: BrandStyleContent };

export function StyleDetail({ client = apiClient, params }: StyleDetailProps) {
  const tx = useT();
  const styleName = params.name ?? "";
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
      <StatePanel action={<PrimaryActionLink href="/styles">{tx("nav.styles")}</PrimaryActionLink>} state="error" title={tx("style.detail.unavailableTitle")}>
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-start">
        <a className={secondaryLinkClasses} href="/styles">
          {tx("action.backToStyles")}
        </a>
      </div>

      <WorkSurface title={tx("style.detail.designMd")}>
        <pre className="max-h-[42rem] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm leading-6 text-zinc-800">
          {state.style.designMd || tx("style.detail.designMdEmpty")}
        </pre>
      </WorkSurface>

      <WorkSurface title="Tokens">
        <pre className="max-h-[42rem] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm leading-6 text-zinc-800">
          {state.style.tokensCss}
        </pre>
      </WorkSurface>

      <WorkSurface title="Components">
        <iframe
          sandbox="allow-same-origin"
          srcDoc={state.style.componentsHtml}
          style={{ border: "none", height: 480, width: "100%" }}
          title="components"
        />
      </WorkSurface>
    </div>
  );
}

const secondaryLinkClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
