import type { RequirementDesignSceneNode } from "../api.js";
import { useT } from "../LocaleContext.js";

export interface PropertyPanelProps {
  hoveredNodeId?: string | null;
  nodes: RequirementDesignSceneNode[];
  productId: string;
  requirementId: string;
  selectedNodeIds?: string[];
}

export interface SceneNodeSpacingMeasurement {
  fromCenter: ScenePoint;
  fromId: string;
  horizontal: SpacingAxisMeasurement;
  toCenter: ScenePoint;
  toId: string;
  vertical: SpacingAxisMeasurement;
}

export interface SpacingAxisMeasurement {
  mode: "center-delta" | "edge-gap";
  value: number;
}

interface ScenePoint {
  x: number;
  y: number;
}

const focusClasses = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const exportLinkClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium uppercase text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 " +
  focusClasses;

export function PropertyPanel({ hoveredNodeId, nodes, productId, requirementId, selectedNodeIds = [] }: PropertyPanelProps) {
  const t = useT();
  const selectedNodes = selectedNodeIds.map((id) => nodes.find((node) => node.id === id)).filter((node): node is RequirementDesignSceneNode => Boolean(node));
  const hoveredNode = hoveredNodeId ? nodes.find((node) => node.id === hoveredNodeId) ?? null : null;
  const activeNode = selectedNodes[0] ?? hoveredNode ?? null;
  const spacing = selectedNodes.length === 2 ? calculateSceneNodeSpacing(selectedNodes[0], selectedNodes[1]) : null;

  if (!activeNode) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-zinc-600">{t("design.emptySelection")}</p>
        <div className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-zinc-500">{t("design.emptySelection")}</div>
      </div>
    );
  }

  const rows = propertyRows(activeNode, nodes, t);

  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{t("design.selectedNode")}</p>
        <h2 className="mt-1 truncate text-base font-semibold text-zinc-950">{activeNode.name ?? activeNode.id}</h2>
        <p className="mt-1 truncate font-mono text-xs text-zinc-500">node_id {activeNode.id}</p>
      </div>

      <div className="divide-y divide-zinc-200 rounded-md border border-zinc-200">
        {rows.map((row) => (
          <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-sm" key={row.label}>
            <span className="text-zinc-500">{row.label}</span>
            <span className="min-w-0 truncate font-mono text-xs text-zinc-800">{row.value}</span>
          </div>
        ))}
      </div>

      {spacing ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{t("design.spacing")}</p>
          <p className="mt-1 truncate text-zinc-700">
            {(selectedNodes[0].name ?? selectedNodes[0].id)} to {(selectedNodes[1].name ?? selectedNodes[1].id)}
          </p>
          <dl className="mt-3 grid gap-2">
            <SpacingFact label="Horizontal" measurement={spacing.horizontal} />
            <SpacingFact label="Vertical" measurement={spacing.vertical} />
          </dl>
        </div>
      ) : null}

      {activeNode.unsupported_properties.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <p className="text-xs font-semibold uppercase tracking-normal">{t("design.unsupportedProperties")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {activeNode.unsupported_properties.map((property) => (
              <li key={property}>{property}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{t("design.export")}</p>
        <div className="flex flex-wrap gap-2">
          {(["png", "svg"] as const).map((format) => (
            <a
              className={exportLinkClasses}
              href={`/api/products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}/design/export?${new URLSearchParams({ node_id: activeNode.id, format }).toString()}`}
              key={format}
            >
              {format}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function propertyRows(node: RequirementDesignSceneNode, nodes: RequirementDesignSceneNode[], t: (key: string) => string): Array<{ label: string; value: string }> {
  return [
    { label: t("design.pencilPath"), value: buildSceneNodePath(node, nodes) },
    { label: "node_id", value: node.id },
    { label: "Type", value: node.type ?? "none" },
    { label: t("design.geometry"), value: formatGeometry(node) },
    { label: "Text", value: node.text ?? "none" },
    { label: "Image", value: node.image ?? "none" },
    { label: "Fill", value: node.fill ?? "none" },
    { label: "Stroke", value: node.stroke ?? "none" },
    { label: "Component", value: node.component_key ?? "none" },
    { label: "Ref", value: node.ref_target ?? "none" },
    { label: t("design.usageIndex"), value: formatUnknownRecord(node.usage_index) }
  ];
}

export function buildSceneNodePath(node: RequirementDesignSceneNode, nodes: RequirementDesignSceneNode[]): string {
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const chain: RequirementDesignSceneNode[] = [];
  const seen = new Set<string>();
  let current: RequirementDesignSceneNode | undefined = node;

  while (current && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }

  return chain
    .reverse()
    .map((item) => item.name || item.id)
    .join(" / ");
}

export function calculateSceneNodeSpacing(from: RequirementDesignSceneNode, to: RequirementDesignSceneNode): SceneNodeSpacingMeasurement {
  const fromRect = nodeRect(from);
  const toRect = nodeRect(to);
  const fromCenter = centerOf(fromRect);
  const toCenter = centerOf(toRect);
  return {
    fromCenter,
    fromId: from.id,
    horizontal: axisSpacing(fromRect.x, fromRect.x + fromRect.width, toRect.x, toRect.x + toRect.width, fromCenter.x, toCenter.x),
    toCenter,
    toId: to.id,
    vertical: axisSpacing(fromRect.y, fromRect.y + fromRect.height, toRect.y, toRect.y + toRect.height, fromCenter.y, toCenter.y)
  };
}

function axisSpacing(fromStart: number, fromEnd: number, toStart: number, toEnd: number, fromCenter: number, toCenter: number): SpacingAxisMeasurement {
  if (fromEnd <= toStart) {
    return { mode: "edge-gap", value: roundMeasurement(toStart - fromEnd) };
  }
  if (toEnd <= fromStart) {
    return { mode: "edge-gap", value: roundMeasurement(fromStart - toEnd) };
  }
  return { mode: "center-delta", value: roundMeasurement(toCenter - fromCenter) };
}

function centerOf(rect: { height: number; width: number; x: number; y: number }): ScenePoint {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}

function nodeRect(node: RequirementDesignSceneNode): { height: number; width: number; x: number; y: number } {
  return {
    height: Math.max(0, node.height ?? 0),
    width: Math.max(0, node.width ?? 0),
    x: node.x ?? 0,
    y: node.y ?? 0
  };
}

function formatGeometry(node: RequirementDesignSceneNode): string {
  const rect = nodeRect(node);
  return `${rect.x}, ${rect.y} / ${rect.width} x ${rect.height}`;
}

function formatUnknownRecord(value: Record<string, unknown> | undefined): string {
  if (!value || Object.keys(value).length === 0) {
    return "none";
  }
  return Object.entries(value)
    .map(([key, item]) => `${key}:${String(item)}`)
    .join(" ");
}

function SpacingFact({ label, measurement }: { label: string; measurement: SpacingAxisMeasurement }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-mono text-xs text-zinc-800">{formatSpacing(measurement)}</dd>
    </div>
  );
}

function formatSpacing(measurement: SpacingAxisMeasurement): string {
  return `${measurement.value}px ${measurement.mode === "edge-gap" ? "edge gap" : "center delta"}`;
}

function roundMeasurement(value: number): number {
  return Math.round(value * 100) / 100;
}
