import type { ActiveDesignSession, ProductComponentLibrary, RequirementDesignCanvas } from "../api.js";
import { useT } from "../LocaleContext.js";

export interface DesignSessionPanelProps {
  canvas?: RequirementDesignCanvas | null;
  componentLibrary?: ProductComponentLibrary | null;
  session?: ActiveDesignSession | null;
}

export function DesignSessionPanel({ canvas, componentLibrary, session }: DesignSessionPanelProps) {
  const t = useT();
  const status = session?.status ?? "none";

  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{t("design.mainCanvas")}</p>
        <p className="mt-1 font-mono text-xs text-zinc-800">design.pen</p>
        <div className="mt-3 grid gap-2">
          <Fact label={t("design.indexResult")} value={canvas?.index_status ?? canvas?.status ?? "not_loaded"} />
          <Fact label={t("design.componentPinned")} value={formatVersion(canvas?.component_library_version)} />
          <Fact label={t("design.componentLatest")} value={formatVersion(componentLibrary?.current_version)} />
        </div>
      </div>

      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{t("design.session")}</p>
        {status === "none" ? (
          <p className="mt-2 text-zinc-500">{t("design.sessionNone")}</p>
        ) : (
          <div className="mt-3 grid gap-2">
            <Fact label={t("design.sessionStatus")} value={status} />
            <Fact label={t("design.sessionOperation")} value={sessionString(session, "operation")} />
            <Fact label={t("design.pageFrame")} value={sessionString(session, "page_id")} />
            <Fact label={t("design.sessionElapsed")} value={formatElapsed(session?.elapsed_ms)} />
            <Fact label={t("design.sessionLockOwner")} value={formatLockOwner(session?.lock_owner)} />
            <Fact label={t("design.qualityResult")} value={sessionString(session, "quality_result")} />
            <Fact label={t("design.aiScreenshotReview")} value={sessionString(session, "screenshot_review_status")} />
          </div>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-zinc-500">{label} </span>
      <span className="min-w-0 truncate font-mono text-xs text-zinc-800">{value}</span>
    </div>
  );
}

function formatVersion(value: number | undefined): string {
  return typeof value === "number" ? `v${value}` : "not_loaded";
}

function sessionString(session: ActiveDesignSession | null | undefined, key: string): string {
  const value = session?.[key];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "not_loaded";
}

function formatElapsed(value: unknown): string {
  const milliseconds = typeof value === "number" ? value : 0;
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatLockOwner(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "not_loaded";
  }
  const record = value as Record<string, unknown>;
  return Object.entries(record)
    .filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
    .map(([key, item]) => `${key}:${String(item)}`)
    .join(" ");
}
