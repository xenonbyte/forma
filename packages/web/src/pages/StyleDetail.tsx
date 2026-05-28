import { useEffect, useState } from "react";

import { apiClient, formatApiError, type ApiErrorInfo, type FormaApiClient, type StyleDetailPayload, type StylePreviewPayload } from "../api.js";
import { PrimaryActionLink, StatePanel, WorkSurface } from "../components/Layout.js";
import { StylePreviewPanel } from "../components/StylePreviewPanel.js";
import { TokenCard } from "../components/TokenCard.js";
import { useT } from "../LocaleContext.js";

export interface StyleDetailProps {
  client?: Pick<FormaApiClient, "getStyle" | "getStylePreview">;
  params: Record<string, string>;
}

type StyleDetailState =
  | { status: "error"; error: ApiErrorInfo }
  | { status: "loading" }
  | { preview?: StylePreviewPayload; previewError?: ApiErrorInfo; status: "ready"; style: StyleDetailPayload };

export function StyleDetail({ client = apiClient, params }: StyleDetailProps) {
  const tx = useT();
  const styleName = params.name ?? "";
  const [imageFailed, setImageFailed] = useState(false);
  const [state, setState] = useState<StyleDetailState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setImageFailed(false);
    setState({ status: "loading" });

    client
      .getStyle(styleName)
      .then(async (style) => {
        let preview: StylePreviewPayload | undefined;
        let previewError: ApiErrorInfo | undefined;
        try {
          preview = await client.getStylePreview(styleName);
        } catch (error: unknown) {
          previewError = formatApiError(error);
        }

        if (!cancelled) {
          setState({ preview, previewError, status: "ready", style });
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

  const variables = Object.entries(state.style.metadata.variables ?? {});
  const imageUrl = isStylePreviewImageUrl(state.preview?.image_url) ? state.preview?.image_url : undefined;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-5">
        <div className="flex justify-start">
          <a className={secondaryLinkClasses} href="/styles">
            {tx("action.backToStyles")}
          </a>
        </div>

        <StylePreviewPanel designMd={state.style.designMd} metadata={state.style.metadata} previewType="web" />

        {imageUrl ? (
          <WorkSurface title={tx("style.detail.staticPreview")}>
            {!imageFailed ? (
              <img
                alt={`${state.style.metadata.name} ${tx("style.detail.staticPreviewAlt")}`}
                className="aspect-[4/3] w-full rounded-md border border-zinc-200 bg-zinc-50 object-contain"
                onError={() => setImageFailed(true)}
                src={imageUrl}
              />
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 text-sm font-medium text-zinc-500">
                {tx("style.detail.staticPreviewUnavailable")}
              </div>
            )}
            {state.previewError ? (
              <p className="mt-3 text-sm text-red-700">
                {state.previewError.error_code} - {tx("style.detail.previewMetadataUnavailable")}
              </p>
            ) : null}
          </WorkSurface>
        ) : state.previewError ? (
          <p className="text-sm text-red-700">
            {state.previewError.error_code} - {tx("style.detail.previewMetadataUnavailable")}
          </p>
        ) : null}

        <WorkSurface title={tx("style.detail.designMd")}>
          <pre className="max-h-[42rem] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm leading-6 text-zinc-800">
            {state.style.designMd || tx("style.detail.designMdEmpty")}
          </pre>
        </WorkSurface>
      </div>

      <WorkSurface title={tx("style.detail.variables")}>
        {variables.length === 0 ? (
          <p className="text-sm text-zinc-500">{tx("style.detail.emptyVariables")}</p>
        ) : (
          <div className="divide-y divide-zinc-200">
            {variables.map(([key, value]) => (
              <TokenCard key={key} name={key} value={value} />
            ))}
          </div>
        )}
      </WorkSurface>
    </div>
  );
}

export function isStylePreviewImageUrl(imageUrl: string | undefined): imageUrl is string {
  return typeof imageUrl === "string" && /^\/api\/styles\/[^/]+\/preview\/image(?:[?#].*)?$/.test(imageUrl);
}

const secondaryLinkClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
