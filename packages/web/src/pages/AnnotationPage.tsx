import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasKitSurface } from "@vzi-core/renderer";
import type { CanvasKitViewportState } from "@vzi-core/renderer";
import type { VZIContent } from "@vzi-core/format";
import { apiClient, formatApiError, type FormaApiClient, type HandoffPage } from "../api.js";
import { PlatformIcon } from "@xenonbyte/forma-viewer";
import { useT } from "../LocaleContext.js";
import { StatePanel } from "../components/Layout.js";
import {
  composeAnnotationCanvas,
  withMissingResourcePlaceholders,
  type AdapterCanvasPageInput,
  type AdapterPageInput,
  type PageFrame,
  type ResourceRef,
  type ResourceError,
} from "./annotation-adapter.js";

interface DecodedPageContent {
  metadata: Record<string, unknown>;
  elements: Map<string, unknown>;
  images: Map<string, unknown>;
}

export interface AnnotationPageProps {
  client?: FormaApiClient;
  onBreadcrumbLabel?: (key: string, label: string) => void;
  params: { productId: string; reqId: string };
  /** Injectable for tests; defaults to fetching the decoded-content route as JSON. */
  fetchContent?: (url: string) => Promise<DecodedPageContent>;
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
  | {
      status: "ready";
      pages: AdapterCanvasPageInput[];
      pageErrors: PageLoadError[];
      missingResources: ResourceError[];
    };

const FALLBACK_CANVAS_SIZE = { width: 1200, height: 800 };

async function defaultFetchContent(url: string): Promise<DecodedPageContent> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as {
    metadata?: Record<string, unknown>;
    elements?: Array<[string, unknown]>;
    images?: Array<[string, unknown]>;
  };
  return {
    metadata: json.metadata ?? {},
    elements: new Map(json.elements ?? []),
    images: new Map(json.images ?? []),
  };
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
  t: (key: string) => string,
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
        reason: t("annotation.resourceMissing"),
      });
    }
  }
  return errors;
}

/**
 * Initial fit-to-content viewport. The renderer's offset/scale live in DEVICE
 * pixels (CanvasKitSurface scales its backing store by devicePixelRatio), so we
 * fit in device-pixel space; overlays convert back to CSS px with `/dpr`.
 */
function fitViewport(cw: number, ch: number, vwCss: number, vhCss: number, dpr: number): CanvasKitViewportState {
  if (cw <= 0 || ch <= 0) return { offsetX: 0, offsetY: 0, scale: 1 };
  const pad = 0.92;
  const vw = vwCss * dpr;
  const vh = vhCss * dpr;
  // Cap at `dpr` (= 1 CSS px per world unit) so small content isn't upscaled.
  const scale = Math.max(0.05, Math.min((vw / cw) * pad, (vh / ch) * pad, dpr));
  return { offsetX: (vw - cw * scale) / 2, offsetY: Math.max(28 * dpr, (vh - ch * scale) / 2), scale };
}

export function AnnotationPage({
  client = apiClient,
  onBreadcrumbLabel,
  params,
  fetchContent = defaultFetchContent,
  checkResourceUrl = defaultCheckResourceUrl,
}: AnnotationPageProps) {
  const t = useT();
  const { productId, reqId } = params;
  // Stable refs so the effect closure can read latest values without re-triggering.
  const tRef = useRef(t);
  tRef.current = t;
  const onBreadcrumbLabelRef = useRef(onBreadcrumbLabel);
  onBreadcrumbLabelRef.current = onBreadcrumbLabel;
  // Renderer offset/scale are in device pixels; overlays divide positions by dpr.
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>(FALLBACK_CANVAS_SIZE);
  const [hasMeasuredSize, setHasMeasuredSize] = useState(false);
  const [viewport, setViewport] = useState<CanvasKitViewportState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setSize(FALLBACK_CANVAS_SIZE);
    setHasMeasuredSize(false);
    setViewport(null);
    setSelectedId(null);
    setHoveredId(null);
    function reportProductLabel() {
      if (!client.getProduct) {
        return;
      }
      void client
        .getProduct(productId)
        .then((p) => {
          if (cancelled) return;
          setPlatform(p.platform);
          onBreadcrumbLabelRef.current?.(`product:${productId}`, p.name);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          console.warn("failed to load product label for annotation canvas shell", formatApiError(error));
          onBreadcrumbLabelRef.current?.(`product:${productId}`, tRef.current("canvas.productUnavailable"));
        });
    }
    void (async () => {
      try {
        const handoff = await client.getRequirementHandoff(productId, reqId);
        if (cancelled) return;
        reportProductLabel();
        if (handoff.pages.length === 0) {
          setState({ status: "empty" });
          return;
        }
        const pages: AdapterCanvasPageInput[] = [];
        const pageErrors: PageLoadError[] = [];
        for (const page of handoff.pages) {
          try {
            const content = await fetchContent(page.contentUrl);
            pages.push(toAdapterInput(page, content));
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
        const missingResources = await validateResourceUrls(initial.resourceRefs, checkResourceUrl, tRef.current);
        if (cancelled) return;
        setState({ status: "ready", pages, pageErrors, missingResources });
      } catch (e) {
        if (!cancelled) {
          console.warn("failed to load annotation canvas", formatApiError(e).message);
          setState({ status: "error", message: formatApiError(e).message });
          // Handoff load failed before the product fetch ran — report an explicit shell
          // label so the canvas top bar doesn't stay stuck on "Loading product".
          onBreadcrumbLabelRef.current?.(`product:${productId}`, tRef.current("canvas.productUnavailable"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, productId, reqId, fetchContent, checkResourceUrl]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const applyMeasuredSize = (width: number, height: number) => {
      const next = { width: Math.max(1, width), height: Math.max(1, height) };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
      setHasMeasuredSize(true);
    };
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      applyMeasuredSize(rect.width, rect.height);
    }
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) applyMeasuredSize(rect.width, rect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [state.status]);

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

  const surfaceElements = useMemo(() => {
    if (!composed) return [];
    return withMissingResourcePlaceholders(composed.elements, missingResourceUrls);
  }, [composed, missingResourceUrls]);

  // Initial fit-to-content once we have both composed content and a measured size.
  useEffect(() => {
    if (!composed || composed.contentWidth <= 0 || !hasMeasuredSize) return;
    setViewport(
      (prev) => prev ?? fitViewport(composed.contentWidth, composed.contentHeight, size.width, size.height, dpr),
    );
  }, [composed, hasMeasuredSize, size.width, size.height, dpr]);

  if (state.status === "loading") {
    return (
      <StatePanel state="empty" title={t("annotation.loading")}>
        …
      </StatePanel>
    );
  }
  if (state.status === "error") {
    return (
      <StatePanel
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
        state="empty"
        title={t("annotation.empty")}
      >
        {t("annotation.emptyHelp")}
      </StatePanel>
    );
  }

  const resourceErrors: ResourceError[] = [...(composed?.errors ?? []), ...state.missingResources];
  const readyPageCount = state.pages.filter((p) => p.status !== "failed").length;
  const allFailed = readyPageCount === 0 && state.pageErrors.length > 0;
  // Focused pages get a frosted focus frame + a blue title label. Both the
  // selected element's page AND the hovered element's page focus, independently
  // of each other — so up to two design drafts can be focused at once, and a
  // hovered page focuses whether or not anything else is selected.
  const focusedKeys = new Set<string>();
  {
    const allFrames = composed?.frames ?? [];
    const selKey = pageKeyForElement(selectedId, allFrames, state.pages);
    if (selKey) focusedKeys.add(selKey);
    const hovKey = pageKeyForElement(hoveredId, allFrames, state.pages);
    if (hovKey) focusedKeys.add(hovKey);
  }
  const focusedFrames = (composed?.frames ?? []).filter((f) => focusedKeys.has(frameKey(f)));

  return (
    <div className="relative flex h-full w-full flex-col">
      {allFailed ? (
        <StatePanel state="error" title={t("requirement.listUnavailable")}>
          {state.pageErrors.map((e) => `${e.pageId}: ${e.reason}`).join("; ")}
        </StatePanel>
      ) : (
        <div
          ref={containerRef}
          className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-200"
          style={{ background: "#ffffff" }}
        >
          {/* z0: fixed dot-grid texture over the light/white canvas. */}
          <div
            className="pointer-events-none absolute inset-0 z-0"
            style={{
              backgroundImage: "radial-gradient(circle, rgba(0,0,0,0.10) 1px, transparent 1.5px)",
              backgroundSize: "22px 22px",
            }}
          />
          {/* z10: frosted focus frame(s) behind the canvas — one per focused page
               (selected page, and the hovered page while measuring distance). */}
          {viewport
            ? focusedFrames.map((f) => (
                <FocusFrame key={`${f.artifactId}-${f.pageId}`} frame={f} viewport={viewport} dpr={dpr} />
              ))
            : null}
          {/* z20: transparent CanvasKit canvas (backgroundColor "" → transparent clear) so the
               light dot grid and the frosted frame behind show through the empty areas. */}
          <div className="absolute inset-0 z-20">
            {composed ? (
              <CanvasKitSurface
                elements={surfaceElements}
                width={size.width}
                height={size.height}
                interactive
                panOnPrimaryDrag
                backgroundColor=""
                selectedElementId={selectedId}
                {...(viewport ? { viewport } : {})}
                onViewportChange={setViewport}
                onSelectElement={(el) => setSelectedId(el ? el.id : null)}
                onHoverElement={(el) => setHoveredId(el ? el.id : null)}
              />
            ) : null}
          </div>
          {/* z30: per-page title labels. */}
          {viewport ? (
            <PageFrameOverlays
              frames={composed?.frames ?? []}
              viewport={viewport}
              dpr={dpr}
              focusedKeys={focusedKeys}
              platform={platform}
              t={t}
            />
          ) : null}
        </div>
      )}

      {(state.pageErrors.length > 0 || resourceErrors.length > 0) && !allFailed ? (
        <div className="max-h-32 overflow-auto rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {state.pageErrors.map((e) => (
            <p key={`p-${e.artifactId}-${e.pageId}`}>
              ⚠ {e.pageId} ({e.artifactId}): {e.reason}
            </p>
          ))}
          {resourceErrors.map((e, i) => (
            <p key={`r-${i}`}>
              ⚠ {e.pageId} ({e.artifactId}) {e.path}: {e.reason}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function frameKey(f: { artifactId: string; pageId: string }): string {
  return `${f.artifactId}\0${f.pageId}`;
}

/**
 * The page that owns a given element id. Namespaced ids carry an
 * `artifactId/pageId/...` prefix (multi-page collisions); otherwise fall back to
 * whichever page's decoded content holds the raw id.
 */
function pageKeyForElement(
  elementId: string | null,
  frames: PageFrame[],
  pages: AdapterCanvasPageInput[],
): string | null {
  if (!elementId) return null;
  for (const f of frames) {
    if (elementId.startsWith(`${f.artifactId}/${f.pageId}/`)) return frameKey(f);
  }
  for (const p of pages) {
    if (p.status === "failed") continue;
    const elements = (p.content as unknown as { elements?: Map<string, unknown> }).elements;
    if (elements && typeof elements.has === "function" && elements.has(elementId)) {
      return frameKey(p);
    }
  }
  return null;
}

// Focus-frame geometry (CSS px). The TOP pad is larger so the title label sits
// INSIDE the frosted panel (see 22.png); the other three sides hug the design
// tighter. The label is parked FOCUS_LABEL_TOP above the page top (inside the panel).
const FOCUS_PAD_X = 10;
const FOCUS_PAD_TOP = 40;
const FOCUS_PAD_BOTTOM = 10;
const FOCUS_RADIUS = 12;
const FOCUS_LABEL_TOP = FOCUS_PAD_TOP - 12;

/**
 * Frosted-glass focus frame drawn BEHIND the (transparent) canvas, anchored to
 * the focused page's screen rect plus padding. Its margin ring shows through the
 * canvas's transparent area around the design; the design itself covers its center.
 * The taller top band wraps the title label.
 */
function FocusFrame({ frame, viewport, dpr }: { frame: PageFrame; viewport: CanvasKitViewportState; dpr: number }) {
  const pageLeft = (frame.x * viewport.scale + viewport.offsetX) / dpr;
  const pageTop = viewport.offsetY / dpr;
  const pageWidth = (frame.width * viewport.scale) / dpr;
  const pageHeight = (frame.height * viewport.scale) / dpr;
  return (
    <div
      className="pointer-events-none absolute z-10 border border-zinc-200/80 shadow-lg"
      style={{
        left: pageLeft - FOCUS_PAD_X,
        top: pageTop - FOCUS_PAD_TOP,
        width: pageWidth + FOCUS_PAD_X * 2,
        height: pageHeight + FOCUS_PAD_TOP + FOCUS_PAD_BOTTOM,
        borderRadius: FOCUS_RADIUS,
        background: "rgba(241,245,249,0.85)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    />
  );
}

/**
 * Per-page title labels — plain text, left-aligned just above each page top.
 * Blue when the page is focused; muted gray otherwise. Failed pages keep an
 * amber chip. Positions track the live viewport transform (device px → CSS px
 * via /dpr); constant screen size, not sticky (clipped by the container).
 */
function PageFrameOverlays({
  frames,
  viewport,
  dpr,
  focusedKeys,
  platform,
  t,
}: {
  frames: PageFrame[];
  viewport: CanvasKitViewportState;
  dpr: number;
  focusedKeys: Set<string>;
  platform?: string;
  t: (key: string) => string;
}) {
  return (
    <>
      {frames.map((f) => {
        const focused = f.status !== "error" && focusedKeys.has(frameKey(f));
        const left = (f.x * viewport.scale + viewport.offsetX) / dpr;
        // Focused: park the label inside the frosted panel's top band. Otherwise
        // it floats just above the page in the light canvas margin.
        const top = viewport.offsetY / dpr - (focused ? FOCUS_LABEL_TOP : 24);
        const suffix = f.variant && f.variant !== "default" ? ` · ${f.variant}` : "";
        if (f.status === "error") {
          return (
            <div
              key={`${f.artifactId}-${f.pageId}`}
              className="pointer-events-none absolute z-30 truncate rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 shadow-sm"
              style={{ left, top, maxWidth: 240 }}
            >
              {f.title}
              {suffix}
              {` · ${t("annotation.pageFailed")}: ${f.errorReason ?? ""}`}
            </div>
          );
        }
        if (focused) {
          return (
            <div
              key={`${f.artifactId}-${f.pageId}`}
              className="pointer-events-none absolute z-30 flex items-center gap-1 truncate text-xs font-medium text-indigo-600"
              style={{ left, top, maxWidth: 240 }}
            >
              <PlatformIcon platform={platform} />
              <span>
                {f.title}
                {suffix}
              </span>
            </div>
          );
        }
        return (
          <div
            key={`${f.artifactId}-${f.pageId}`}
            className="pointer-events-none absolute z-30 truncate text-xs font-medium text-zinc-600"
            style={{ left, top, maxWidth: 240 }}
          >
            {f.title}
            {suffix}
          </div>
        );
      })}
    </>
  );
}

function toAdapterInput(page: HandoffPage, content: DecodedPageContent): AdapterPageInput {
  return {
    pageId: page.pageId,
    artifactId: page.artifactId,
    variant: page.variant,
    title: page.title,
    content: content as unknown as VZIContent,
    urls: { iconBaseUrl: page.iconBaseUrl, bundleBaseUrl: page.bundleBaseUrl },
  };
}
