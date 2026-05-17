import { useEffect, useMemo, useState } from "react";

import { apiClient, formatApiError, type ApiErrorInfo, type FormaApiClient, type StyleMetadata, type StyleVariables } from "../api.js";
import { StatePanel } from "../components/Layout.js";
import { StyleCard } from "../components/StyleCard.js";

export interface StyleLibraryProps {
  client?: Pick<FormaApiClient, "listStyles">;
}

type StyleLibraryState = { status: "error"; error: ApiErrorInfo } | { status: "loading" } | { status: "ready"; styles: StyleMetadata[] };
type VariableFilter = "all" | "complete" | "missing";
type ViewMode = "grid" | "list";

const requiredVariables: Array<keyof StyleVariables> = [
  "primary",
  "background",
  "text-primary",
  "font-heading",
  "font-body",
  "border-radius",
  "spacing-unit"
];

export function StyleLibrary({ client = apiClient }: StyleLibraryProps) {
  const [filter, setFilter] = useState<VariableFilter>("all");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<StyleLibraryState>({ status: "loading" });
  const [view, setView] = useState<ViewMode>("grid");

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    client
      .listStyles()
      .then((styles) => {
        if (!cancelled) {
          setState({ status: "ready", styles });
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
  }, [client]);

  const filteredStyles = useMemo(() => {
    if (state.status !== "ready") {
      return [];
    }

    const normalizedQuery = query.trim().toLowerCase();
    return state.styles.filter((style) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        style.name.toLowerCase().includes(normalizedQuery) ||
        style.description.toLowerCase().includes(normalizedQuery);
      const complete = hasCompleteVariables(style);
      const matchesFilter = filter === "all" || (filter === "complete" && complete) || (filter === "missing" && !complete);
      return matchesQuery && matchesFilter;
    });
  }, [filter, query, state]);

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

  if (state.styles.length === 0) {
    return (
      <StatePanel state="empty" title="No styles">
        Installed styles will appear here.
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
          Variables
          <select className={inputClasses} onChange={(event) => setFilter(event.target.value as VariableFilter)} value={filter}>
            <option value="all">All styles</option>
            <option value="complete">Complete</option>
            <option value="missing">Missing</option>
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

      {filteredStyles.length === 0 ? (
        <StatePanel state="empty" title="No styles match">
          Adjust search or variable filter.
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

function hasCompleteVariables(style: StyleMetadata): boolean {
  return requiredVariables.every((key) => typeof style.variables?.[key] === "string" && style.variables[key].length > 0);
}

function modeButtonClasses(active: boolean): string {
  return `rounded-md px-2 py-1.5 text-sm font-medium transition active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 ${
    active ? "bg-amber-500 text-zinc-950" : "bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950"
  }`;
}

const inputClasses =
  "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 shadow-sm transition placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
