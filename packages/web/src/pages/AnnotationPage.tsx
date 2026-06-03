import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasKitSurface } from "@vzi-core/renderer";
import type { CanvasKitViewportState } from "@vzi-core/renderer";
import { VZIDecoder } from "@vzi-core/format";
import type { VZIContent } from "@vzi-core/format";
import { apiClient, formatApiError, type FormaApiClient, type HandoffPage } from "../api.js";
import { useT } from "../LocaleContext.js";
import { PrimaryActionLink, StatePanel } from "../components/Layout.js";
import {
  composeAnnotationCanvas,
  withMissingResourcePlaceholders,
  type AdapterCanvasPageInput,
  type AdapterPageInput,
  type PageFrame,
  type ResourceRef,
  type ResourceError,
} from "./annotation-adapter.js";

export interface AnnotationPageProps {
  client?: FormaApiClient;
  params: { productId: string; reqId: string };
  /** Injectable for tests; defaults to fetching the route as bytes. */
  fetchVzi?: (url: string) => Promise<Uint8Array>;
  /** Injectable for tests; defaults to HEAD for same-origin local artifact routes. */
  checkResourceUrl?: (url: string) => Promise<boolean>;
}

interface PageLoadError {
  pageId: string;
  artifactId: string;
  variant: string;
  title: string;
  reason: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready"; pages: AdapterCanvasPageInput[]; pageErrors: PageLoadError[]; missingResources: ResourceError[] };

async function defaultFetchVzi(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function defaultCheckResourceUrl(url: string): Promise<boolean> {
  // Only validate rewritten local API artifact URLs. Unsafe, remote, file:, and
  // absolute disk refs were already rejected by the adapter and must not fetch.
  if (!url.startsWith("/api/products/")) return true;
  const head = await fetch(url, { method: "HEAD" });
  if (head.ok) return true;
  if (head.status !== 405) return false;
  const get = await fetch(url);
  return get.ok;
}

async function validateResourceUrls(
  refs: ResourceRef[],
  checkResourceUrl: (url: string) => Promise<boolean>,
): Promise<ResourceError[]> {
  const errors: ResourceError[] = [];
  for (const ref of refs) {
    if (!ref.url.startsWith("/api/products/")) continue;
    let ok = false;
    try {
      ok = await checkResourceUrl(ref.url);
    } catch {
      ok = false;
    }
    if (!ok) {
      errors.push({
        artifactId: ref.artifactId,
        pageId: ref.pageId,
        path: ref.path,
        reason: "missing resource",
      });
    }
  }
  return errors;
}

function decodeVzi(bytes: Uint8Array): VZIContent {
  const decoder = new VZIDecoder({ enableErrorRecovery: true });
  const result = decoder.decode(bytes);
  const fatal = result.errors.filter((e) => e.fatal);
  if (fatal.length > 0) {
    throw new Error(fatal.map((e) => e.message).join("; "));
  }
  return result.content;
}

/** Initial fit-to-content viewport: scale so the whole tiled canvas is visible, centered. */
function fitViewport(cw: number, ch: number, vw: number, vh: number): CanvasKitViewportState {
  if (cw <= 0 || ch <= 0) return { offsetX: 0, offsetY: 0, scale: 1 };
  const pad = 0.92;
  const scale = Math.max(0.05, Math.min((vw / cw) * pad, (vh / ch) * pad, 1));
  return { offsetX: (vw - cw * scale) / 2, offsetY: Math.max(28, (vh - ch * scale) / 2), scale };
}

export function AnnotationPage({
  client = apiClient,
  params,
  fetchVzi = defaultFetchVzi,
  checkResourceUrl = defaultCheckResourceUrl,
}: AnnotationPageProps) {
  const t = useT();
  const { productId, reqId } = params;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 1200, height: 800 });
  const [viewport, setViewport] = useState<CanvasKitViewportState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setViewport(null);
    setSelectedId(null);
    void (async () => {
      try {
        const handoff = await client.getRequirementHandoff(productId, reqId);
        if (cancelled) return;
        if (handoff.pages.length === 0) {
          setState({ status: "empty" });
          return;
        }
        const pages: AdapterCanvasPageInput[] = [];
        const pageErrors: PageLoadError[] = [];
        for (const page of handoff.pages) {
          try {
            const bytes = await fetchVzi(page.vziUrl);
            pages.push(toAdapterInput(page, decodeVzi(bytes)));
          } catch (e) {
            pageErrors.push({
              pageId: page.pageId,
              artifactId: page.artifactId,
              variant: page.variant,
              title: page.title,
              reason: e instanceof Error ? e.message : String(e),
            });
            pages.push({
              status: "failed",
              pageId: page.pageId,
              artifactId: page.artifactId,
              variant: page.variant,
              title: page.title,
              errorReason: e instanceof Error ? e.message : String(e),
            });
          }
        }
        if (cancelled) return;
        const initial = composeAnnotationCanvas(pages);
        const missingResources = await validateResourceUrls(initial.resourceRefs, checkResourceUrl);
        if (cancelled) return;
        setState({ status: "ready", pages, pageErrors, missingResources });
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: formatApiError(e).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, productId, reqId, fetchVzi, checkResourceUrl]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const composed = useMemo(() => {
    if (state.status !== "ready") return null;
    return composeAnnotationCanvas(state.pages);
  }, [state]);

  const missingResourceUrls = useMemo(() => {
    if (state.status !== "ready" || !composed) return new Set<string>();
    const missingPaths = new Set(state.missingResources.map((e) => `${e.artifactId}\0${e.pageId}\0${e.path}`));
    return new Set(
      composed.resourceRefs
        .filter((ref) => missingPaths.has(`${ref.artifactId}\0${ref.pageId}\0${ref.path}`))
        .map((ref) => ref.url),
    );
  }, [composed, state]);

  // Initial fit-to-content once we have both composed content and a measured size.
  useEffect(() => {
    if (!composed || composed.contentWidth <= 0) return;
    setViewport((prev) => prev ?? fitViewport(composed.contentWidth, composed.contentHeight, size.width, size.height));
  }, [composed, size.width, size.height]);

  const backLink = `/products/${productId}/requirements/${reqId}`;

  if (state.status === "loading") {
    return <StatePanel state="empty" title={t("annotation.loading")}>…</StatePanel>;
  }
  if (state.status === "error") {
    return (
      <StatePanel
        action={<PrimaryActionLink href={backLink}>{t("action.backToProduct")}</PrimaryActionLink>}
        state="error"
        title={state.message}
      >
        {state.message}
      </StatePanel>
    );
  }
  if (state.status === "empty") {
    return (
      <StatePanel
        action={<PrimaryActionLink href={backLink}>{t("action.backToProduct")}</PrimaryActionLink>}
        state="empty"
        title={t("annotation.empty")}
      >
        {t("annotation.emptyHelp")}
      </StatePanel>
    );
  }

  const resourceErrors: ResourceError[] = [
    ...(composed?.errors ?? []),
    ...state.missingResources,
  ];
  const readyPageCount = state.pages.filter((p) => p.status !== "failed").length;
  const allFailed = readyPageCount === 0 && state.pageErrors.length > 0;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-2">
      <div className="flex items-center justify-between">
        <a className="text-sm text-zinc-600 underline" href={backLink}>{t("action.backToProduct")}</a>
        <span className="text-xs text-zinc-500">
          {readyPageCount} {t("requirement.pageCount")}
          {selectedId ? ` · ${t("annotation.selected")}: ${selectedId}` : ""}
        </span>
      </div>

      {allFailed ? (
        <StatePanel state="error" title={t("requirement.listUnavailable")}>
          {state.pageErrors.map((e) => `${e.pageId}: ${e.reason}`).join("; ")}
        </StatePanel>
      ) : (
        <div ref={containerRef} className="relative flex-1 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
          {composed ? (
            <CanvasKitSurface
              elements={withMissingResourcePlaceholders(composed.elements, missingResourceUrls)}
              width={size.width}
              height={size.height}
              interactive
              panOnPrimaryDrag
              backgroundColor="#f5f5f5"
              selectedElementId={selectedId}
              {...(viewport ? { viewport } : {})}
              onViewportChange={setViewport}
              onSelectElement={(el) => setSelectedId(el ? el.id : null)}
            />
          ) : null}
          {viewport ? <PageFrameOverlays frames={composed?.frames ?? []} viewport={viewport} t={t} /> : null}
        </div>
      )}

      {(state.pageErrors.length > 0 || resourceErrors.length > 0) && !allFailed ? (
        <div className="max-h-32 overflow-auto rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {state.pageErrors.map((e) => (
            <p key={`p-${e.artifactId}-${e.pageId}`}>⚠ {e.pageId} ({e.artifactId}): {e.reason}</p>
          ))}
          {resourceErrors.map((e, i) => (
            <p key={`r-${i}`}>⚠ {e.pageId} ({e.artifactId}) {e.path}: {e.reason}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Per-page labels and failed-page markers, positioned in screen space from the live viewport transform. */
function PageFrameOverlays({
  frames,
  viewport,
  t,
}: {
  frames: PageFrame[];
  viewport: CanvasKitViewportState;
  t: (key: string) => string;
}) {
  return (
    <>
      {frames.map((f) => (
        <div
          key={`${f.artifactId}-${f.pageId}`}
          className={
            f.status === "error"
              ? "pointer-events-none absolute z-10 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 shadow-sm"
              : "pointer-events-none absolute z-10 truncate rounded bg-white/85 px-2 py-0.5 text-xs font-medium text-zinc-700 shadow-sm"
          }
          style={{
            left: f.x * viewport.scale + viewport.offsetX,
            top: Math.max(2, viewport.offsetY - 22),
            maxWidth: Math.max(40, f.width * viewport.scale),
          }}
        >
          {f.title}
          {f.variant && f.variant !== "default" ? ` · ${f.variant}` : ""}
          {f.status === "error" ? ` · ${t("annotation.pageFailed")}: ${f.errorReason ?? ""}` : ""}
        </div>
      ))}
    </>
  );
}

function toAdapterInput(page: HandoffPage, content: VZIContent): AdapterPageInput {
  return {
    pageId: page.pageId,
    artifactId: page.artifactId,
    variant: page.variant,
    title: page.title,
    content,
    urls: { iconBaseUrl: page.iconBaseUrl, bundleBaseUrl: page.bundleBaseUrl },
  };
}
