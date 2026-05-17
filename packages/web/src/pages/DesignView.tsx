import { useCallback, useEffect, useMemo, useState } from "react";

import {
  apiClient,
  formatApiError,
  type AnnotationNode,
  type ApiErrorInfo,
  type DesignHistoryPayload,
  type DesignHistoryVersion,
  type FormaApiClient
} from "../api.js";
import { AnnotationCanvas, calculateNodeSpacing } from "../components/AnnotationCanvas.js";
import { DiffViewer } from "../components/DiffViewer.js";
import { PrimaryActionLink, StatePanel, WorkSurface } from "../components/Layout.js";
import { PropertyPanel } from "../components/PropertyPanel.js";

export interface DesignViewProps {
  client?: Pick<FormaApiClient, "getDesignAnnotations" | "getDesignHistory">;
  params: Record<string, string>;
}

type DesignState =
  | { error: ApiErrorInfo; status: "error" }
  | { status: "loading" }
  | { annotations: AnnotationNode[]; history: DesignHistoryPayload; status: "ready" };

interface VersionSelection {
  fromVersion: number;
  toVersion: number;
}

const focusClasses = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const secondaryLinkClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 " +
  focusClasses;

export function DesignView({ client = apiClient, params }: DesignViewProps) {
  const productId = params.productId ?? "";
  const requirementId = params.reqId ?? "";
  const designId = params.designId ?? "";
  const [state, setState] = useState<DesignState>({ status: "loading" });
  const [hoveredNode, setHoveredNode] = useState<AnnotationNode | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selection, setSelection] = useState<VersionSelection | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setSelectedNodeIds([]);
    setHoveredNode(null);
    setSelection(null);

    Promise.all([client.getDesignAnnotations(designId), client.getDesignHistory(designId)])
      .then(([annotations, history]) => {
        if (!cancelled) {
          setState({ annotations, history, status: "ready" });
          setSelection(defaultVersionSelection(history.versions));
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
  }, [client, designId]);

  const handleHoverNode = useCallback((node: AnnotationNode | null) => setHoveredNode(node), []);
  const handleSelectNode = useCallback((node: AnnotationNode) => setSelectedNodeIds((current) => selectAnnotationNode(current, node.id)), []);

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title="Design">
        Loading annotation data and design history.
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel
        action={<PrimaryActionLink href={`/products/${productId}/requirements/${requirementId}`}>Requirement</PrimaryActionLink>}
        state="error"
        title="Design unavailable"
      >
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  return (
    <DesignContent
      annotations={state.annotations}
      designId={designId}
      history={state.history}
      hoveredNode={hoveredNode}
      onHoverNode={handleHoverNode}
      onSelectNode={handleSelectNode}
      onVersionSelectionChange={setSelection}
      productId={productId}
      requirementId={requirementId}
      selectedNodeIds={selectedNodeIds}
      versionSelection={selection}
    />
  );
}

export function DesignContent({
  annotations,
  designId,
  history,
  hoveredNode,
  onHoverNode,
  onSelectNode,
  onVersionSelectionChange,
  productId,
  requirementId,
  selectedNodeIds = [],
  versionSelection
}: {
  annotations: AnnotationNode[];
  designId: string;
  history: DesignHistoryPayload;
  hoveredNode: AnnotationNode | null;
  onHoverNode: (node: AnnotationNode | null) => void;
  onSelectNode: (node: AnnotationNode) => void;
  onVersionSelectionChange: (selection: VersionSelection) => void;
  productId: string;
  requirementId: string;
  selectedNodeIds?: string[];
  versionSelection: VersionSelection | null;
}) {
  const sortedVersions = useMemo(() => [...history.versions].sort((left, right) => left.version - right.version), [history.versions]);
  const currentVersion = sortedVersions.find((version) => version.current) ?? sortedVersions.at(-1);
  const selectedIdsKey = selectedNodeIds.join("\u0000");
  const selectedNodes = useMemo(
    () => selectedNodeIds.map((id) => annotations.find((node) => node.id === id)).filter((node): node is AnnotationNode => Boolean(node)),
    [annotations, selectedIdsKey]
  );
  const spacing = useMemo(() => (selectedNodes.length === 2 ? calculateNodeSpacing(selectedNodes[0], selectedNodes[1]) : null), [selectedNodes]);
  const activeSelection = versionSelection ?? defaultVersionSelection(sortedVersions);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-xs font-medium text-zinc-600">
            {designId}
          </span>
          <span className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800">
            v{history.current_version}
          </span>
        </div>
        <a className={secondaryLinkClasses} href={`/products/${productId}/requirements/${requirementId}`}>
          Back to requirement
        </a>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <WorkSurface title="Annotation canvas">
          <AnnotationCanvas
            imageUrl={currentVersion?.image_url}
            nodes={annotations}
            onHoverNode={onHoverNode}
            onSelectNode={onSelectNode}
            selectedNodeIds={selectedNodeIds}
            spacing={spacing}
          />
        </WorkSurface>
        <WorkSurface title="Properties">
          <PropertyPanel designId={designId} hoveredNode={hoveredNode} nodes={annotations} selectedNodes={selectedNodes} spacing={spacing} />
        </WorkSurface>
      </div>

      <WorkSurface title="Design diff">
        {sortedVersions.length < 2 || !activeSelection ? (
          <StatePanel state="empty" title="No history to compare">
            This design has fewer than two versions.
          </StatePanel>
        ) : (
          <div className="space-y-4">
            <VersionControls onChange={onVersionSelectionChange} selection={activeSelection} versions={sortedVersions} />
            <DiffViewer designId={designId} fromVersion={activeSelection.fromVersion} toVersion={activeSelection.toVersion} />
          </div>
        )}
      </WorkSurface>
    </div>
  );
}

export function selectAnnotationNode(current: string[], nodeId: string): string[] {
  if (current.includes(nodeId)) {
    return current.filter((id) => id !== nodeId);
  }
  return [...current, nodeId].slice(-2);
}

function VersionControls({
  onChange,
  selection,
  versions
}: {
  onChange: (selection: VersionSelection) => void;
  selection: VersionSelection;
  versions: DesignHistoryVersion[];
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <label className="grid gap-1 text-sm font-medium text-zinc-700">
        From
        <select
          aria-label="From version"
          className={`min-w-36 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 ${focusClasses}`}
          onChange={(event) => onChange({ ...selection, fromVersion: Number(event.currentTarget.value) })}
          value={selection.fromVersion}
        >
          {versions.map((version) => (
            <option key={version.version} value={version.version}>
              v{version.version}
              {version.current ? " current" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium text-zinc-700">
        To
        <select
          aria-label="To version"
          className={`min-w-36 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 ${focusClasses}`}
          onChange={(event) => onChange({ ...selection, toVersion: Number(event.currentTarget.value) })}
          value={selection.toVersion}
        >
          {versions.map((version) => (
            <option key={version.version} value={version.version}>
              v{version.version}
              {version.current ? " current" : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function defaultVersionSelection(versions: DesignHistoryVersion[]): VersionSelection | null {
  if (versions.length < 2) {
    return null;
  }

  const sorted = [...versions].sort((left, right) => left.version - right.version);
  const toVersion = sorted.find((version) => version.current)?.version ?? sorted.at(-1)?.version;
  const toIndex = sorted.findIndex((version) => version.version === toVersion);
  const fromVersion = sorted[Math.max(0, toIndex - 1)]?.version ?? sorted[0]?.version;

  if (!fromVersion || !toVersion) {
    return null;
  }

  return { fromVersion, toVersion };
}
