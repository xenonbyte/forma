import { useCallback, useEffect, useMemo, useState } from "react";

import {
  apiClient,
  formatApiError,
  type ApiErrorInfo,
  type FormaApiClient,
  type StyleMetadata
} from "../api.js";
import { StatePanel } from "../components/Layout.js";
import { StyleCard } from "../components/StyleCard.js";

export interface StyleLibraryProps {
  client?: Pick<FormaApiClient, "listStyles">;
}

type StyleLibraryState = { status: "error"; error: ApiErrorInfo } | { status: "loading" } | { status: "ready"; styles: StyleMetadata[] };
type CategoryFilter = "all" | string;
type ViewMode = "grid" | "list";

export function StyleLibrary({ client = apiClient }: StyleLibraryProps) {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<StyleLibraryState>({ status: "loading" });
  const [view, setView] = useState<ViewMode>("grid");

  const loadStyles = useCallback(
    async (showLoading = true) => {
      if (showLoading) {
        setState({ status: "loading" });
      }

      try {
        const styles = await client.listStyles();
        setState({ status: "ready", styles });
      } catch (error: unknown) {
        setState({ error: formatApiError(error), status: "error" });
      }
    },
    [client]
  );

  useEffect(() => {
    void loadStyles();
  }, [client, loadStyles]);

  const categories = useMemo(() => (state.status === "ready" ? getStyleCategories(state.styles) : ["all"]), [state]);
  const filteredStyles = useMemo(
    () => (state.status === "ready" ? filterStylesByControls(state.styles, { category, query }) : []),
    [category, query, state]
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
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_10rem]">
        <label className="grid gap-1 text-sm font-medium text-zinc-700">
          Search
          <input className={inputClasses} onChange={(event) => setQuery(event.target.value)} placeholder="Name or description" value={query} />
        </label>
        <label className="grid gap-1 text-sm font-medium text-zinc-700">
          Category
          <select className={inputClasses} onChange={(event) => setCategory(event.target.value)} value={category}>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item === "all" ? "All categories" : item}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-1 text-sm font-medium text-zinc-700">
          View
          <div className="grid grid-cols-2 gap-1 rounded-md border border-zinc-200 bg-white p-1">
            <button className={modeButtonClasses(view === "grid")} onClick={() => setView("grid")} type="button">
              Grid
            </button>
            <button className={modeButtonClasses(view === "list")} onClick={() => setView("list")} type="button">
              List
            </button>
          </div>
        </div>
      </div>

      {state.styles.length === 0 ? (
        <StatePanel state="empty" title="No styles">
          Installed styles will appear here.
        </StatePanel>
      ) : filteredStyles.length === 0 ? (
        <StatePanel state="empty" title="No styles match">
          Adjust search or category filter.
        </StatePanel>
      ) : (
        <div className={view === "grid" ? "grid gap-4 md:grid-cols-2 xl:grid-cols-3" : "grid gap-3"}>
          {filteredStyles.map((style) => (
            <StyleCard href={`/styles/${encodeURIComponent(style.name)}`} key={style.name} style={style} />
          ))}
        </div>
      )}
    </div>
  );
}

export function getStyleCategories(styles: StyleMetadata[]): string[] {
  return ["all", ...Array.from(new Set(styles.map((style) => styleCategory(style)).filter(Boolean))).sort((left, right) => left.localeCompare(right))];
}

export function filterStylesByControls(
  styles: StyleMetadata[],
  controls: { category: string; query: string }
): StyleMetadata[] {
  const normalizedQuery = controls.query.trim().toLowerCase();
  return styles.filter((style) => {
    const matchesQuery =
      normalizedQuery.length === 0 || style.name.toLowerCase().includes(normalizedQuery) || style.description.toLowerCase().includes(normalizedQuery);
    const matchesCategory = controls.category === "all" || styleCategory(style) === controls.category;
    return matchesQuery && matchesCategory;
  });
}

function styleCategory(style: StyleMetadata): string {
  if (style.category) return style.category;
  const [, category] = style.design_md_path.split("/");
  return category || style.name.split(/\s+/)[0]?.toLowerCase() || style.name.toLowerCase();
}

function modeButtonClasses(active: boolean): string {
  return `rounded-md px-2 py-1.5 text-sm font-medium transition active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 ${
    active ? "bg-amber-500 text-zinc-950" : "bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950"
  }`;
}

const inputClasses =
  "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 shadow-sm transition placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
