import { useEffect, useMemo, useState } from "react";

import {
  apiClient,
  formatApiError,
  type AnnotationNode,
  type ApiErrorInfo,
  type DesignDiffPayload,
  type FormaApiClient
} from "../api.js";
import { StatePanel } from "./Layout.js";

export interface DiffViewerProps {
  designId: string;
  fromVersion: number;
  toVersion: number;
}

export type DiffViewerState =
  | { error: ApiErrorInfo; status: "error" }
  | { status: "loading" }
  | { diff: DesignDiffPayload; status: "ready" };

interface DiffViewerRuntimeProps extends DiffViewerProps {
  client?: Pick<FormaApiClient, "getDesignDiff">;
}

type DiffRow =
  | { id: string; kind: "Added" | "Removed"; node: AnnotationNode }
  | { after: AnnotationNode; before: AnnotationNode; id: string; kind: "Modified" };

export function DiffViewer({ client = apiClient, designId, fromVersion, toVersion }: DiffViewerRuntimeProps) {
  const [state, setState] = useState<DiffViewerState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    client
      .getDesignDiff(designId, fromVersion, toVersion)
      .then((diff) => {
        if (!cancelled) {
          setState({ diff, status: "ready" });
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
  }, [client, designId, fromVersion, toVersion]);

  return <DiffViewerContent fromVersion={fromVersion} state={state} toVersion={toVersion} />;
}

export function DiffViewerContent({ fromVersion, state, toVersion }: { fromVersion: number; state: DiffViewerState; toVersion: number }) {
  const rows = useMemo(() => (state.status === "ready" ? diffRows(state.diff) : []), [state]);

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title="Loading design diff">
        Fetching visual previews and structural node changes.
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel state="error" title="Diff unavailable">
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  const empty = rows.length === 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <PreviewImage alt={`Version ${fromVersion} preview`} label={`v${fromVersion}`} src={state.diff.visual.from_image_url} />
        <PreviewImage alt={`Version ${toVersion} preview`} label={`v${toVersion}`} src={state.diff.visual.to_image_url} />
      </div>

      {empty ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-4 text-sm font-medium text-zinc-600">No structural changes</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-zinc-200">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-normal text-zinc-500">
              <tr>
                <th className="px-3 py-2">Change</th>
                <th className="px-3 py-2">Node</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Geometry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 bg-white">
              {rows.map((row) => (
                <tr key={`${row.kind}-${row.id}`}>
                  <td className="px-3 py-2">
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${diffTone[row.kind]}`}>{row.kind}</span>
                  </td>
                  <td className="min-w-48 px-3 py-2">
                    <div className="font-medium text-zinc-950">{row.kind === "Modified" ? row.after.name : row.node.name}</div>
                    <div className="font-mono text-xs text-zinc-500">{row.id}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-700">{row.kind === "Modified" ? row.after.type : row.node.type}</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-700">{geometryLabel(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PreviewImage({ alt, label, src }: { alt: string; label: string; src: string }) {
  return (
    <figure className="min-w-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
        <figcaption className="font-mono text-xs font-semibold uppercase tracking-normal text-zinc-500">{label}</figcaption>
      </div>
      <div className="aspect-[16/10] bg-white">
        <img alt={alt} className="h-full w-full object-contain" src={src} />
      </div>
    </figure>
  );
}

function diffRows(diff: DesignDiffPayload): DiffRow[] {
  return [
    ...diff.added.map((node) => ({ id: node.id, kind: "Added" as const, node })),
    ...diff.removed.map((node) => ({ id: node.id, kind: "Removed" as const, node })),
    ...diff.modified.map((item) => ({ after: item.after, before: item.before, id: item.id, kind: "Modified" as const }))
  ];
}

function geometryLabel(row: DiffRow): string {
  if (row.kind === "Modified") {
    return `${sizeLabel(row.before)} -> ${sizeLabel(row.after)}`;
  }
  return `${row.node.x},${row.node.y} / ${sizeLabel(row.node)}`;
}

function sizeLabel(node: AnnotationNode): string {
  return `${node.width}x${node.height}`;
}

const diffTone = {
  Added: "bg-emerald-50 text-emerald-700",
  Modified: "bg-amber-50 text-amber-700",
  Removed: "bg-red-50 text-red-700"
};
