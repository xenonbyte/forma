import { useEffect, useState } from "react";

import { formatApiError, type ApiErrorInfo } from "../api.js";
import { useT } from "../LocaleContext.js";
import { StatePanel } from "../components/Layout.js";

// Local types — NOT imported from api.ts (api.ts will be updated in D1-05)
export interface ArtifactSummary {
  id: string;
  kind: string;
  requirement_id?: string;
  title: string;
  preview_url?: string;
  source_skill_id?: string;
  superseded?: boolean;
  updated_at: string;
}

export interface DesignViewClientDep {
  listProductArtifacts(productId: string, kind?: string): Promise<{ artifacts: ArtifactSummary[] }>;
}

export interface DesignViewProps {
  client: DesignViewClientDep;
  params: Record<string, string>;
}

type ViewState =
  | { status: "loading" }
  | { status: "error"; error: ApiErrorInfo }
  | { status: "ready"; artifacts: ArtifactSummary[] };

export function DesignView({ client, params }: DesignViewProps) {
  const t = useT();
  const productId = params.productId ?? "";
  const requirementId = params.reqId ?? params.requirementId ?? "";
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [lightboxArtifact, setLightboxArtifact] = useState<ArtifactSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    client
      .listProductArtifacts(productId, "html")
      .then(({ artifacts }) => {
        if (!cancelled) {
          setState({ status: "ready", artifacts: filterDesignArtifacts(artifacts, requirementId) });
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

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title={t("design.view")}>
        {t("requirement.loading")}
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel state="error" title={t("design.canvasUnavailable")}>
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  const { artifacts } = state;

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{t("design.view")}</p>
          {requirementId ? (
            <h2 className="mt-1 text-lg font-semibold tracking-normal text-zinc-950">{requirementId}</h2>
          ) : null}
        </div>
      </div>

      {/* Empty state */}
      {artifacts.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-zinc-500">No designs yet</p>
        </div>
      ) : (
        /* PNG grid */
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" role="list">
          {artifacts.map((artifact) => {
            const previewSrc = artifactPreviewUrl(productId, artifact.id, "1x");
            return (
              <li key={artifact.id}>
                <button
                  className="group w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:border-amber-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                  onClick={() => setLightboxArtifact(artifact)}
                  type="button"
                >
                  <img
                    alt={artifact.title}
                    className="h-40 w-full object-cover object-top transition group-hover:opacity-90"
                    src={previewSrc}
                  />
                  <div className="border-t border-zinc-100 px-3 py-2 text-left">
                    <p className="truncate text-xs font-medium text-zinc-700">{artifact.title}</p>
                    <p className="mt-0.5 truncate text-xs text-zinc-400">{artifact.kind}</p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Lightbox */}
      {lightboxArtifact ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          data-lightbox-overlay="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setLightboxArtifact(null);
            }
          }}
          role="dialog"
          aria-label={lightboxArtifact.title}
          aria-modal="true"
        >
          <div className="relative max-h-full max-w-4xl overflow-auto rounded-lg bg-white shadow-2xl">
            <button
              aria-label="Close"
              className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-zinc-700 shadow transition hover:bg-white hover:text-zinc-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
              onClick={() => setLightboxArtifact(null)}
              type="button"
            >
              ×
            </button>
            <img
              alt={lightboxArtifact.title}
              className="block max-h-[80vh] w-auto rounded-lg"
              src={artifactPreviewUrl(productId, lightboxArtifact.id, "2x")}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function artifactPreviewUrl(productId: string, artifactId: string, resolution: "1x" | "2x"): string {
  return `/api/products/${encodeURIComponent(productId)}/artifacts/${encodeURIComponent(artifactId)}/preview/${resolution}`;
}

function filterDesignArtifacts(artifacts: ArtifactSummary[], requirementId: string): ArtifactSummary[] {
  return artifacts.filter((artifact) => {
    if (nonDesignGridKinds.has(artifact.kind)) {
      return false;
    }
    return requirementId ? artifact.requirement_id === requirementId : true;
  });
}

const nonDesignGridKinds = new Set(["design-system", "component-library"]);
