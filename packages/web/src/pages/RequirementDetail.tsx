import { useEffect, useRef, useState } from "react";

import {
  apiClient,
  formatApiError,
  type ApiErrorInfo,
  type ArtifactSummary,
  type FormaApiClient,
  type RequirementWithDocument,
} from "../api.js";
import { useT } from "../LocaleContext.js";
import { StatePanel, WorkSurface } from "../components/Layout.js";
import { StatusBadge } from "../components/StatusBadge.js";

export interface RequirementDetailProps {
  client?: Pick<FormaApiClient, "getRequirement" | "listProductArtifacts">;
  onBreadcrumbLabel?: (key: string, label: string) => void;
  params: Record<string, string>;
}

type RequirementState =
  | { status: "error"; error: ApiErrorInfo }
  | { status: "loading" }
  | { artifacts: ArtifactSummary[]; requirement: RequirementWithDocument; status: "ready" };

export function RequirementDetail({ client = apiClient, onBreadcrumbLabel, params }: RequirementDetailProps) {
  const t = useT();
  const productId = params.productId ?? "";
  const requirementId = params.reqId ?? "";
  const [state, setState] = useState<RequirementState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    client
      .getRequirement(productId, requirementId)
      .then(async (requirement) => {
        const artifactsResult = await client
          .listProductArtifacts(productId, "html")
          .catch((error: unknown) => {
            console.warn("listProductArtifacts failed; open-design action disabled", error);
            return { artifacts: [] as ArtifactSummary[] };
          });
        if (!cancelled) {
          setState({ artifacts: artifactsResult.artifacts, requirement, status: "ready" });
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
  }, [client, productId, requirementId]);

  useEffect(() => {
    if (state.status === "ready") {
      onBreadcrumbLabel?.(`requirement:${requirementId}`, state.requirement.title || requirementId);
    }
  }, [onBreadcrumbLabel, requirementId, state]);

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title={t("requirement.records")}>
        {t("requirement.loading")}
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel state="error" title={t("requirement.unavailable")}>
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  const requirement = state.requirement;
  const hasDocument = requirement.document_md.trim().length > 0;
  const noUiChanges = requirement.ui_affected === false;
  const designEnabled =
    !noUiChanges && state.artifacts.some((artifact) => artifact.requirement_id === requirementId);
  const designHref = `/products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}/design`;

  const documentActions = (
    <div className="flex items-center gap-2">
      <CopyDocumentButton text={requirement.document_md} />
      <OpenDesignAction enabled={designEnabled} href={designHref} />
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={requirement.status} />
        {noUiChanges ? (
          <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold leading-none text-zinc-700">
            {t("requirement.noUiChanges")}
          </span>
        ) : null}
        <span className="font-mono text-xs text-zinc-500">{requirement.id}</span>
      </div>

      {hasDocument ? (
        <WorkSurface actions={documentActions} title={t("requirement.document")}>
          <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm leading-6 text-zinc-800">
            {requirement.document_md}
          </pre>
        </WorkSurface>
      ) : (
        <StatePanel action={documentActions} state="empty" title={t("requirement.document")}>
          {t("requirement.documentEmpty")}
        </StatePanel>
      )}
    </div>
  );
}

function CopyDocumentButton({ text }: { text: string }) {
  const t = useT();
  const [copyState, setCopyState] = useState<"copied" | "failed" | "idle">("idle");
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revertTimerRef.current !== null) {
        clearTimeout(revertTimerRef.current);
      }
    };
  }, []);

  const disabled = text.trim().length === 0;

  const handleCopy = async () => {
    if (revertTimerRef.current !== null) {
      clearTimeout(revertTimerRef.current);
      revertTimerRef.current = null;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      revertTimerRef.current = setTimeout(() => {
        revertTimerRef.current = null;
        setCopyState("idle");
      }, 2000);
    } catch {
      setCopyState("failed");
      revertTimerRef.current = setTimeout(() => {
        revertTimerRef.current = null;
        setCopyState("idle");
      }, 2000);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-live="polite"
        className={copyState === "failed" ? "text-xs font-medium text-red-600" : "sr-only"}
      >
        {copyState === "copied" ? t("action.copied") : copyState === "failed" ? t("action.copyFailed") : ""}
      </span>
      <button
        aria-label={t("action.copyDocument")}
        className={iconButtonClasses}
        disabled={disabled}
        onClick={() => void handleCopy()}
        title={t("action.copyDocument")}
        type="button"
      >
        {copyState === "copied" ? <CheckIcon /> : <CopyIcon />}
      </button>
    </span>
  );
}

function OpenDesignAction({ enabled, href }: { enabled: boolean; href: string }) {
  const t = useT();

  if (!enabled) {
    return (
      <button
        aria-label={t("action.openDesign")}
        className={iconButtonClasses}
        disabled
        title={t("requirement.openDesignDisabled")}
        type="button"
      >
        <OpenDesignIcon />
      </button>
    );
  }

  return (
    <a aria-label={t("action.openDesign")} className={iconButtonClasses} href={href} title={t("action.openDesign")}>
      <OpenDesignIcon />
    </a>
  );
}

const iconButtonClasses =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:border-zinc-200 disabled:hover:bg-white";

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <rect height="13" rx="2" width="13" x="9" y="9" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function OpenDesignIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}
