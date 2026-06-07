import { useEffect, useState } from "react";

import { formatApiError, type ApiErrorInfo, type FormaApiClient } from "../api.js";
import { useT } from "../LocaleContext.js";
import { PrimaryActionLink, StatePanel } from "../components/Layout.js";

export type VersionCompareClient = Pick<FormaApiClient, "getProductArtifact" | "getArtifactVersionPreviewUrl">;

export interface VersionCompareProps {
  client: VersionCompareClient;
  params: Record<string, string>;
}

type ViewState =
  | { status: "loading" }
  | { status: "error"; error: ApiErrorInfo }
  | { status: "empty"; title: string }
  | { status: "ready"; title: string; versions: number[]; left: number; right: number };

/** F3: read-only side-by-side compare of two immutable artifact versions. */
export function VersionCompare({ client, params }: VersionCompareProps) {
  const t = useT();
  const productId = params.productId ?? "";
  const artifactId = params.artifactId ?? "";
  const [state, setState] = useState<ViewState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    client
      .getProductArtifact(productId, artifactId)
      .then((detail) => {
        if (cancelled) return;
        const versions = [...(detail.versions ?? [])].sort((a, b) => a - b);
        if (versions.length < 2) {
          setState({ status: "empty", title: detail.manifest.title });
          return;
        }
        const current = detail.current_version ?? versions[versions.length - 1];
        const currentIndex = versions.indexOf(current);
        // Default pair: predecessor vs current. When current is the oldest
        // version (e.g. after a rollback to v1), compare current vs the next
        // version instead — the panes must never default to the same image.
        const left = currentIndex > 0 ? versions[currentIndex - 1] : current;
        const right = currentIndex > 0 ? current : versions[currentIndex + 1];
        setState({ status: "ready", title: detail.manifest.title, versions, left, right });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ error: formatApiError(error), status: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, productId, artifactId]);

  const backHref = `/products/${encodeURIComponent(productId)}`;

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title={t("design.compareTitle")}>
        {t("requirement.loading")}
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel
        action={<PrimaryActionLink href={backHref}>{t("action.backToProduct")}</PrimaryActionLink>}
        state="error"
        title={t("design.compareTitle")}
      >
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  if (state.status === "empty") {
    return (
      <StatePanel
        action={<PrimaryActionLink href={backHref}>{t("action.backToProduct")}</PrimaryActionLink>}
        state="empty"
        title={`${t("design.compareTitle")} · ${state.title}`}
      >
        {t("design.compareEmpty")}
      </StatePanel>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="truncate text-sm font-semibold tracking-normal text-zinc-950">
          {t("design.compareTitle")} · {state.title}
        </h2>
        <a
          className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-zinc-600 transition hover:text-zinc-950"
          href={backHref}
        >
          ← {t("action.backToProduct")}
        </a>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ComparePane
          label={t("design.compareLeft")}
          missingText={t("design.comparePreviewMissing")}
          onSelect={(version) => setState((prev) => (prev.status === "ready" ? { ...prev, left: version } : prev))}
          previewUrl={client.getArtifactVersionPreviewUrl(productId, artifactId, state.left, "2x")}
          selected={state.left}
          versions={state.versions}
        />
        <ComparePane
          label={t("design.compareRight")}
          missingText={t("design.comparePreviewMissing")}
          onSelect={(version) => setState((prev) => (prev.status === "ready" ? { ...prev, right: version } : prev))}
          previewUrl={client.getArtifactVersionPreviewUrl(productId, artifactId, state.right, "2x")}
          selected={state.right}
          versions={state.versions}
        />
      </div>
    </div>
  );
}

function ComparePane(props: {
  label: string;
  missingText: string;
  onSelect: (version: number) => void;
  previewUrl: string;
  selected: number;
  versions: number[];
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3">
      <label className="flex items-center gap-2 text-sm text-zinc-600">
        {props.label}
        <select
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm"
          onChange={(event) => {
            setFailed(false);
            props.onSelect(Number(event.target.value));
          }}
          value={String(props.selected)}
        >
          {props.versions.map((version) => (
            <option key={version} value={String(version)}>
              v{version}
            </option>
          ))}
        </select>
      </label>
      {failed ? (
        <div className="flex min-h-48 items-center justify-center text-sm text-zinc-500">{props.missingText}</div>
      ) : (
        <img
          alt={`${props.label} v${props.selected}`}
          className="w-full rounded-md border border-zinc-100"
          key={props.previewUrl}
          onError={() => setFailed(true)}
          src={props.previewUrl}
        />
      )}
    </div>
  );
}
