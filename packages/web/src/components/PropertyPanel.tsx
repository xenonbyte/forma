import { useState } from "react";

import type { AnnotationNode } from "../api.js";

export interface PropertyPanelProps {
  designId?: string;
  hoveredNode?: AnnotationNode | null;
  selectedNode?: AnnotationNode | null;
}

type CopyState = { label: string; status: "copied" | "error" } | null;

const focusClasses = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const copyButtonClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 " +
  focusClasses;

export function PropertyPanel({ designId, hoveredNode, selectedNode }: PropertyPanelProps) {
  const [copyState, setCopyState] = useState<CopyState>(null);
  const activeNode = selectedNode ?? hoveredNode ?? null;

  if (!activeNode) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-zinc-600">Select a canvas node to inspect its dimensions, style, and export metadata.</p>
        <div className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-zinc-500">No node selected</div>
      </div>
    );
  }

  const rows = propertyRows(activeNode);
  const copyAvailable = canUseClipboard();

  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{selectedNode ? "Selected node" : "Hovered node"}</p>
        <h2 className="mt-1 truncate text-base font-semibold text-zinc-950">{activeNode.name}</h2>
        <p className="mt-1 truncate font-mono text-xs text-zinc-500">{activeNode.id}</p>
      </div>

      <div className="divide-y divide-zinc-200 rounded-md border border-zinc-200">
        {rows.map((row) => (
          <div className="grid grid-cols-[7rem_minmax(0,1fr)_4.25rem] items-center gap-2 px-3 py-2 text-sm" key={row.label}>
            <span className="text-zinc-500">{row.label}</span>
            <span className="min-w-0 truncate font-mono text-xs text-zinc-800">{row.value}</span>
            <button
              aria-label={`Copy ${row.label}`}
              className={copyButtonClasses}
              disabled={!copyAvailable}
              onClick={() => void copyValue(row.label, row.value, setCopyState)}
              type="button"
            >
              Copy
            </button>
          </div>
        ))}
      </div>

      {copyState ? (
        <p className={copyState.status === "copied" ? "text-xs font-medium text-emerald-700" : "text-xs font-medium text-red-700"}>
          {copyState.status === "copied" ? `${copyState.label} copied` : "Clipboard unavailable"}
        </p>
      ) : null}

      {designId && selectedNode ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">Export metadata</p>
          <div className="flex flex-wrap gap-2">
            {(["png", "svg"] as const).map((format) => (
              <a
                className={`inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium uppercase text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 ${focusClasses}`}
                href={`/api/designs/${encodeURIComponent(designId)}/export?${new URLSearchParams({ node_id: selectedNode.id, format }).toString()}`}
                key={format}
              >
                {format}
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function propertyRows(node: AnnotationNode): Array<{ label: string; value: string }> {
  return [
    { label: "ID", value: node.id },
    { label: "Type", value: node.type },
    { label: "Parent", value: node.parent_id ?? "None" },
    { label: "Position", value: `${node.x}, ${node.y}` },
    { label: "Size", value: `${node.width} x ${node.height}` },
    { label: "Fill", value: node.fill ?? "None" },
    { label: "Stroke", value: node.stroke ?? "None" },
    { label: "Font", value: [node.fontFamily, node.fontSize ? `${node.fontSize}px` : undefined].filter(Boolean).join(" ") || "None" },
    { label: "Content", value: node.content ?? "None" }
  ];
}

async function copyValue(label: string, value: string, setCopyState: (state: CopyState) => void): Promise<void> {
  if (!canUseClipboard()) {
    setCopyState({ label, status: "error" });
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    setCopyState({ label, status: "copied" });
  } catch {
    setCopyState({ label, status: "error" });
  }
}

function canUseClipboard(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.clipboard?.writeText);
}
