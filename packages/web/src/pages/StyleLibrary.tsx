import { useCallback, useEffect, useMemo, useState } from "react";

import {
  apiClient,
  formatApiError,
  type ApiErrorInfo,
  type BrandStyleContent,
  type FormaApiClient,
  type StyleMetadata
} from "../api.js";
import { StatePanel } from "../components/Layout.js";
import { StyleCard } from "../components/StyleCard.js";
import { extractStyleVisualTokens, type StyleVisualTokens } from "../utils/styleVisualTokens.js";

export interface StyleLibraryProps {
  client?: Pick<FormaApiClient, "getStyle" | "listStyles">;
}

type StyleLibraryState =
  | { status: "error"; error: ApiErrorInfo }
  | { status: "loading" }
  | { status: "ready"; styles: StyleMetadata[]; visualTokensByStyleName: Record<string, StyleVisualTokens> };

export function StyleLibrary({ client = apiClient }: StyleLibraryProps) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<StyleLibraryState>({ status: "loading" });

  const loadStyles = useCallback(
    async (showLoading = true) => {
      if (showLoading) {
        setState({ status: "loading" });
      }

      try {
        const styles = await client.listStyles();
        const visualTokensByStyleName = await loadStyleVisualTokens(client, styles);
        setState({ status: "ready", styles, visualTokensByStyleName });
      } catch (error: unknown) {
        setState({ error: formatApiError(error), status: "error" });
      }
    },
    [client]
  );

  useEffect(() => {
    void loadStyles();
  }, [client, loadStyles]);

  const filteredStyles = useMemo(
    () => (state.status === "ready" ? filterStylesByControls(state.styles, { query }) : []),
    [query, state]
  );

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title="Style library">
        Loading installed style metadata.
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel state="error" title="Style library unavailable">
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  return (
    <div className="space-y-5">
      <div className="max-w-xl">
        <label className="grid gap-1 text-sm font-medium text-zinc-700">
          Search
          <input className={inputClasses} onChange={(event) => setQuery(event.target.value)} placeholder="Name or description" value={query} />
        </label>
      </div>

      {state.styles.length === 0 ? (
        <StatePanel state="empty" title="No styles">
          Installed styles will appear here.
        </StatePanel>
      ) : filteredStyles.length === 0 ? (
        <StatePanel state="empty" title="No styles match">
          Adjust search.
        </StatePanel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredStyles.map((style) => (
            <StyleCard
              href={`/styles/${encodeURIComponent(style.name)}`}
              key={style.name}
              style={style}
              visualTokens={state.visualTokensByStyleName[style.name]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function filterStylesByControls(
  styles: StyleMetadata[],
  controls: { query: string }
): StyleMetadata[] {
  const normalizedQuery = controls.query.trim().toLowerCase();
  return styles.filter((style) => {
    return normalizedQuery.length === 0 || style.name.toLowerCase().includes(normalizedQuery) || style.description.toLowerCase().includes(normalizedQuery);
  });
}

const inputClasses =
  "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 shadow-sm transition placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

async function loadStyleVisualTokens(
  client: Pick<FormaApiClient, "getStyle">,
  styles: StyleMetadata[]
): Promise<Record<string, StyleVisualTokens>> {
  const settled = await Promise.allSettled(
    styles.map(async (style): Promise<[string, StyleVisualTokens]> => {
      const detail: BrandStyleContent = await client.getStyle(style.name);
      return [style.name, extractStyleVisualTokens({ designMd: detail.designMd, tokensCss: detail.tokensCss })];
    })
  );

  return Object.fromEntries(
    settled.flatMap((result) => {
      if (result.status === "fulfilled") {
        return [result.value];
      }
      return [];
    })
  );
}
