import type { DesignStatus, RequirementStatus } from "../api.js";

export type ConfigStatus = "configuration_incomplete" | "configured" | "initialized" | "not_initialized" | "not_loaded" | "unconfigured";
export type StatusBadgeStatus = ConfigStatus | DesignStatus | RequirementStatus;

export interface StatusBadgeProps {
  label?: string;
  status: StatusBadgeStatus;
}

const statusTone: Record<StatusBadgeStatus, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  archived: "border-zinc-200 bg-zinc-100 text-zinc-600",
  configuration_incomplete: "border-amber-200 bg-amber-50 text-amber-700",
  configured: "border-sky-200 bg-sky-50 text-sky-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  empty: "border-zinc-200 bg-white text-zinc-600",
  expired: "border-zinc-200 bg-zinc-100 text-zinc-600",
  initialized: "border-emerald-200 bg-emerald-50 text-emerald-700",
  not_initialized: "border-amber-200 bg-amber-50 text-amber-700",
  not_loaded: "border-zinc-200 bg-zinc-100 text-zinc-600",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  submitted: "border-sky-200 bg-sky-50 text-sky-700",
  unconfigured: "border-red-200 bg-red-50 text-red-700"
};

const statusLabel: Record<StatusBadgeStatus, string> = {
  active: "Active",
  archived: "Archived",
  configuration_incomplete: "Configuration incomplete",
  configured: "Configured",
  done: "Done",
  empty: "Empty",
  expired: "Expired",
  initialized: "Initialized",
  not_initialized: "Not initialized",
  not_loaded: "Not loaded",
  pending: "Pending",
  submitted: "Submitted",
  unconfigured: "Unconfigured"
};

export function StatusBadge({ label, status }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold leading-none ${statusTone[status]}`}>
      {label ?? statusLabel[status]}
    </span>
  );
}
