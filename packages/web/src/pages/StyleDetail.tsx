import { useEffect, useState } from "react";

import { apiClient, formatApiError, type ApiErrorInfo, type FormaApiClient, type StyleDetailPayload, type StylePreviewPayload } from "../api.js";
import { PrimaryActionLink, StatePanel, WorkSurface } from "../components/Layout.js";

export interface StyleDetailProps {
  client?: Pick<FormaApiClient, "getStyle" | "getStylePreview">;
  params: Record<string, string>;
}

type StyleDetailState =
  | { status: "error"; error: ApiErrorInfo }
  | { status: "loading" }
  | { preview?: StylePreviewPayload; previewError?: ApiErrorInfo; status: "ready"; style: StyleDetailPayload };

export function StyleDetail({ client = apiClient, params }: StyleDetailProps) {
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
      <StatePanel state="loading" title="Style detail">
        Loading style metadata, preview metadata, and DESIGN.md.
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel action={<PrimaryActionLink href="/styles">Styles</PrimaryActionLink>} state="error" title="Style unavailable">
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  const variables = Object.entries(state.style.metadata.variables ?? {});
  const hasContent = state.style.designMd.trim().length > 0 || variables.length > 0;

  if (!hasContent) {
    return (
      <StatePanel action={<PrimaryActionLink href="/styles">Styles</PrimaryActionLink>} state="empty" title="Empty style">
        No variables or DESIGN.md content are stored for this style.
      </StatePanel>
    );
  }

  const imageUrl = state.preview?.image_url;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-5">
        <div className="flex justify-start">
          <a className={secondaryLinkClasses} href="/styles">
            Back to styles
          </a>
        </div>

        <WorkSurface title="Preview">
          {imageUrl && !imageFailed ? (
            <img
              alt={`${state.style.metadata.name} preview`}
              className="aspect-[4/3] w-full rounded-md border border-zinc-200 bg-zinc-50 object-contain"
              onError={() => setImageFailed(true)}
              src={imageUrl}
            />
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 text-sm font-medium text-zinc-500">
              Preview unavailable
            </div>
          )}
          {state.previewError ? <p className="mt-3 text-sm text-red-700">{state.previewError.error_code} - Preview metadata unavailable</p> : null}
        </WorkSurface>

        <WorkSurface title="DESIGN.md">
          <pre className="max-h-[42rem] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm leading-6 text-zinc-800">
            {state.style.designMd || "Empty"}
          </pre>
        </WorkSurface>
      </div>

      <WorkSurface title="Variables">
        {variables.length === 0 ? (
          <p className="text-sm text-zinc-500">No variables are defined.</p>
        ) : (
          <div className="divide-y divide-zinc-200">
            {variables.map(([key, value]) => (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 py-2 text-sm" key={key}>
                <span className="truncate font-mono text-xs text-zinc-500">{key}</span>
                <span className="truncate font-medium text-zinc-800">{value}</span>
              </div>
            ))}
          </div>
        )}
      </WorkSurface>
    </div>
  );
}

const secondaryLinkClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
