import { useCallback, useEffect, useMemo, useState } from "react";

import {
  apiClient,
  formatApiError,
  type ApiErrorInfo,
  type FormaApiClient,
  type StyleMetadata,
  type StyleVariables,
  type SyncStatusPayload
} from "../api.js";
import { StatePanel } from "../components/Layout.js";
import { StyleCard } from "../components/StyleCard.js";

export interface StyleLibraryProps {
  client?: Pick<FormaApiClient, "getSyncStatus" | "listStyles" | "syncStyles">;
}

type StyleLibraryState = { status: "error"; error: ApiErrorInfo } | { status: "loading" } | { status: "ready"; styles: StyleMetadata[] };
type CategoryFilter = "all" | string;
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
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [filter, setFilter] = useState<VariableFilter>("all");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<StyleLibraryState>({ status: "loading" });
  const [syncStatus, setSyncStatus] = useState<SyncStatusPayload>();
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
    let cancelled = false;

    loadStyles();
    client
      .getSyncStatus()
      .then((status) => {
        if (!cancelled) {
          setSyncStatus(status);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSyncStatus({ error: { message: formatApiError(error).message, phase: "cleanup" }, status: "failed" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, loadStyles]);

  useEffect(() => {
    if (syncStatus?.status !== "running") {
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      client
        .getSyncStatus()
        .then((status) => {
          if (cancelled) {
            return;
          }

          setSyncStatus(status);
          if (status.status === "idle" && status.last_sync) {
            void loadStyles(false);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setSyncStatus({ error: { message: formatApiError(error).message, phase: "cleanup" }, status: "failed" });
          }
        });
    }, 2000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [client, loadStyles, syncStatus]);

  const handleSync = async () => {
    try {
      await client.syncStyles();
      const status = await client.getSyncStatus();
      setSyncStatus(status);
    } catch (error: unknown) {
      setSyncStatus({ error: { message: formatApiError(error).message, phase: "cleanup" }, status: "failed" });
    }
  };

  const categories = useMemo(() => (state.status === "ready" ? getStyleCategories(state.styles) : ["all"]), [state]);
  const filteredStyles = useMemo(
    () => (state.status === "ready" ? filterStylesByControls(state.styles, { category, query, variableFilter: filter }) : []),
    [category, filter, query, state]
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

  if (state.styles.length === 0) {
    return (
      <StatePanel state="empty" title="No styles">
        Installed styles will appear here.
      </StatePanel>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_12rem_10rem_11rem]">
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
        <div className="grid gap-1 text-sm font-medium text-zinc-700">
          Sync
          <button
            className="rounded-md border border-zinc-200 bg-zinc-950 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
            data-sync-button="true"
            disabled={syncStatus?.status === "running"}
            onClick={handleSync}
            type="button"
          >
            {syncButtonLabel(syncStatus)}
          </button>
        </div>
      </div>

      {syncSummary(syncStatus) ? <p className="text-sm text-zinc-600">{syncSummary(syncStatus)}</p> : null}
      {syncStatus?.status === "failed" ? <p className="text-sm text-red-600">{syncStatus.error.message}</p> : null}

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

export function syncButtonLabel(status: SyncStatusPayload | undefined): string {
  if (status?.status === "running") {
    return `同步中... (${status.progress.current}/${status.progress.total})`;
  }

  if (status?.status === "failed") {
    return "同步失败，重试";
  }

  return "一键同步";
}

export function syncSummary(status: SyncStatusPayload | undefined): string | undefined {
  if (status?.status !== "idle" || !status.last_sync) {
    return undefined;
  }

  return `total ${status.last_sync.styles_total}, added ${status.last_sync.styles_added}, updated ${status.last_sync.styles_updated}, failed ${status.last_sync.styles_failed}`;
}

export function getStyleCategories(styles: StyleMetadata[]): string[] {
  return ["all", ...Array.from(new Set(styles.map((style) => styleCategory(style)).filter(Boolean))).sort((left, right) => left.localeCompare(right))];
}

export function filterStylesByControls(
  styles: StyleMetadata[],
  controls: { category: string; query: string; variableFilter: string }
): StyleMetadata[] {
  const normalizedQuery = controls.query.trim().toLowerCase();
  return styles.filter((style) => {
    const matchesQuery =
      normalizedQuery.length === 0 || style.name.toLowerCase().includes(normalizedQuery) || style.description.toLowerCase().includes(normalizedQuery);
    const complete = hasCompleteVariables(style);
    const matchesFilter =
      controls.variableFilter === "all" ||
      (controls.variableFilter === "complete" && complete) ||
      (controls.variableFilter === "missing" && !complete);
    const matchesCategory = controls.category === "all" || styleCategory(style) === controls.category;
    return matchesQuery && matchesFilter && matchesCategory;
  });
}

function styleCategory(style: StyleMetadata): string {
  const [, category] = style.design_md_path.split("/");
  return category || style.name.split(/\s+/)[0]?.toLowerCase() || style.name.toLowerCase();
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
