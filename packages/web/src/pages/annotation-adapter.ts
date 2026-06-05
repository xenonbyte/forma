import type { VZIContent } from "@vzi-core/format";
import {
  buildCanvasKitElementTree,
  type FlatIRDocumentLike,
  type FlatIRElementLike,
  type IRElement,
} from "@vzi-core/renderer";

export interface PageAssetUrls {
  iconBaseUrl: string;
  bundleBaseUrl: string;
}

export interface ResourceError {
  artifactId: string;
  pageId: string;
  path: string;
  reason: string;
}

export interface ResourceRef {
  artifactId: string;
  pageId: string;
  path: string;
  kind: "icon" | "bundle";
  url: string;
}

interface RewriteCtx {
  artifactId: string;
  pageId: string;
  variant?: string;
  namespaceIds?: boolean;
  resourceRefs?: ResourceRef[];
}

function stripDotSlash(p: string): string {
  return p.replace(/^\.\//, "");
}

function stripIconsPrefix(rel: string): string {
  return rel.replace(/^icons\//, "");
}

function trackLocalResource(url: string, kind: "icon" | "bundle", path: string, ctx: RewriteCtx): string {
  ctx.resourceRefs?.push({ artifactId: ctx.artifactId, pageId: ctx.pageId, path, kind, url });
  return url;
}

function pushResourceError(
  errors: Array<Partial<ResourceError> & { reason: string }>,
  ctx: RewriteCtx,
  path: string,
  reason: string,
): void {
  errors.push({ artifactId: ctx.artifactId, pageId: ctx.pageId, path, reason });
}

function safeRelativePath(
  raw: string,
  ctx: RewriteCtx,
  errors: Array<Partial<ResourceError> & { reason: string }>,
): string | undefined {
  const rel = stripDotSlash(raw).trim();
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    pushResourceError(errors, ctx, raw, "malformed resource path");
    return undefined;
  }
  const parts = decoded.split("/");
  if (
    rel.length === 0 ||
    rel.includes("\\") ||
    decoded.includes("\\") ||
    decoded.startsWith("/") ||
    /^https?:\/\//i.test(decoded) ||
    decoded.startsWith("file:") ||
    parts.some((part) => {
      if (part.length === 0 || part === "..") return true;
      let inner = part;
      try {
        inner = decodeURIComponent(part);
      } catch {
        return true;
      }
      return inner === ".." || inner.includes("/") || inner.includes("\\");
    })
  ) {
    pushResourceError(errors, ctx, raw, "unsafe relative resource path");
    return undefined;
  }
  return rel;
}

function bundleVersionSegment(bundleBaseUrl: string): string | undefined {
  const match = bundleBaseUrl.match(/\/versions\/([1-9]\d*)\/bundle\/?$/);
  return match ? `v${match[1]}` : undefined;
}

function artifactVersionFileRelativePath(
  raw: string,
  urls: PageAssetUrls,
  ctx: RewriteCtx,
  errors: Array<Partial<ResourceError> & { reason: string }>,
): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    pushResourceError(errors, ctx, raw, "malformed file: resource URL");
    return undefined;
  }
  if (parsed.hostname && parsed.hostname !== "localhost") {
    pushResourceError(errors, ctx, raw, "file: resource not allowed");
    return undefined;
  }
  const versionSegment = bundleVersionSegment(urls.bundleBaseUrl);
  if (!versionSegment) {
    pushResourceError(errors, ctx, raw, "file: resource not allowed");
    return undefined;
  }

  const encodedSegments = parsed.pathname.split("/").filter((part) => part.length > 0);
  const decodedSegments: string[] = [];
  for (const segment of encodedSegments) {
    try {
      decodedSegments.push(decodeURIComponent(segment));
    } catch {
      pushResourceError(errors, ctx, raw, "malformed file: resource path");
      return undefined;
    }
  }

  for (let i = 0; i <= decodedSegments.length - 5; i += 1) {
    if (
      decodedSegments[i] !== "od-project" ||
      decodedSegments[i + 1] !== "artifacts" ||
      decodedSegments[i + 2] !== ctx.artifactId ||
      decodedSegments[i + 3] !== versionSegment
    ) {
      continue;
    }
    const rel = safeRelativePath(encodedSegments.slice(i + 4).join("/"), ctx, errors);
    return rel ? `${rel}${parsed.search}${parsed.hash}` : undefined;
  }

  pushResourceError(errors, ctx, raw, "file: resource not allowed");
  return undefined;
}

/**
 * Resolve a VZI element resource reference to a Web URL.
 * - data: preserved
 * - metadata.iconRelativePath / icons/* → iconBaseUrl
 * - assets/* or other bundle-relative → bundleBaseUrl
 * - file: under the same artifact version directory → bundleBaseUrl
 * - http(s), other file:, absolute disk path, unresolvable → recorded violation, dropped
 */
export function rewriteResourceUrl(
  raw: string | undefined,
  metadata: Record<string, unknown> | undefined,
  urls: PageAssetUrls,
  ctx: RewriteCtx,
  errors: Array<Partial<ResourceError> & { reason: string }>,
): string | undefined {
  const iconRel = metadata?.["iconRelativePath"];
  if (typeof iconRel === "string" && iconRel.length > 0) {
    const safeIconRel = safeRelativePath(iconRel, ctx, errors);
    return safeIconRel
      ? trackLocalResource(`${urls.iconBaseUrl}${stripIconsPrefix(safeIconRel)}`, "icon", safeIconRel, ctx)
      : undefined;
  }
  if (!raw || raw.length === 0) return undefined;
  if (/^data:/i.test(raw)) return raw;

  if (/^https?:\/\//i.test(raw)) {
    pushResourceError(errors, ctx, raw, "remote http(s) resource not allowed");
    return undefined;
  }
  if (/^file:/i.test(raw)) {
    const rel = artifactVersionFileRelativePath(raw, urls, ctx, errors);
    return rel ? trackLocalResource(`${urls.bundleBaseUrl}${rel}`, "bundle", rel, ctx) : undefined;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    pushResourceError(errors, ctx, raw, "unsupported resource protocol");
    return undefined;
  }
  if (raw.startsWith("/")) {
    pushResourceError(errors, ctx, raw, "absolute path not allowed");
    return undefined;
  }

  const rel = safeRelativePath(raw, ctx, errors);
  if (!rel) return undefined;
  if (rel.startsWith("icons/")) {
    return trackLocalResource(`${urls.iconBaseUrl}${stripIconsPrefix(rel)}`, "icon", rel, ctx);
  }
  // assets/* and any other relative ref resolve against the version bundle
  return trackLocalResource(`${urls.bundleBaseUrl}${rel}`, "bundle", rel, ctx);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readSrc(el: Record<string, unknown>): string | undefined {
  const imageData = asRecord(el["imageData"]);
  const source = asRecord(el["source"]);
  if (typeof el["src"] === "string") return el["src"] as string;
  if (typeof imageData["src"] === "string") return imageData["src"] as string;
  if (typeof source["src"] === "string") return source["src"] as string;
  return undefined;
}

function namespaceElementId(id: string, ctx: RewriteCtx): string {
  if (!ctx.namespaceIds) return id;
  const variantPart = ctx.variant && ctx.variant !== "default" ? `/${ctx.variant}` : "";
  return `${ctx.artifactId}/${ctx.pageId}${variantPart}/${id}`;
}

function readImageAssetUrl(metadata: Record<string, unknown>, imageUrls: Map<string, string>): string | undefined {
  for (const key of ["iconAssetId", "imageAssetId", "assetId"]) {
    const id = metadata[key];
    if (typeof id === "string") {
      const url = imageUrls.get(id);
      if (url) return url;
    }
  }
  return undefined;
}

const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi;

function rewriteCssUrlReferences(
  value: string,
  urls: PageAssetUrls,
  ctx: RewriteCtx,
  errors: Array<Partial<ResourceError> & { reason: string }>,
): string | undefined {
  let sawUrl = false;
  let unsafeUrl = false;
  const rewritten = value.replace(
    CSS_URL_RE,
    (match, doubleQuoted: string | undefined, singleQuoted: string | undefined, bare: string | undefined) => {
      sawUrl = true;
      const raw = (doubleQuoted ?? singleQuoted ?? bare ?? "").trim();
      if (raw.startsWith("data:")) return match;
      const mapped = rewriteResourceUrl(raw, undefined, urls, ctx, errors);
      if (!mapped) {
        unsafeUrl = true;
        return "";
      }
      return `url("${mapped}")`;
    },
  );
  if (!sawUrl) return value;
  return unsafeUrl ? undefined : rewritten;
}

function rewriteStyleResourceUrls(
  styles: Record<string, unknown>,
  urls: PageAssetUrls,
  ctx: RewriteCtx,
  errors: Array<Partial<ResourceError> & { reason: string }>,
): Record<string, unknown> {
  const rewritten = { ...styles };
  const backgroundImage = rewritten["backgroundImage"];
  if (typeof backgroundImage === "string") {
    const next = rewriteCssUrlReferences(backgroundImage, urls, ctx, errors);
    if (typeof next === "string") {
      rewritten["backgroundImage"] = next;
    } else {
      delete rewritten["backgroundImage"];
    }
  }
  return rewritten;
}

function rewriteImageAssetUrls(
  content: VZIContent,
  urls: PageAssetUrls,
  ctx: RewriteCtx,
  errors: Array<Partial<ResourceError> & { reason: string }>,
): Map<string, string> {
  const rewritten = new Map<string, string>();
  for (const [assetId, asset] of content.images.entries()) {
    const rec = asset as unknown as Record<string, unknown>;
    const rawUrl = typeof rec["url"] === "string" ? (rec["url"] as string) : undefined;
    const mapped = rewriteResourceUrl(rawUrl, undefined, urls, ctx, errors);
    if (mapped) rewritten.set(assetId, mapped);
  }
  return rewritten;
}

/** Convert a decoded VZIContent (Map of flat elements) into a FlatIRDocumentLike, rewriting resource URLs. */
export function vziContentToFlatDoc(
  content: VZIContent,
  urls: PageAssetUrls,
  ctx: RewriteCtx,
  errors: Array<Partial<ResourceError> & { reason: string }>,
): FlatIRDocumentLike {
  const elements: Record<string, FlatIRElementLike> = {};
  const imageUrls = rewriteImageAssetUrls(content, urls, ctx, errors);
  for (const [id, rawEl] of content.elements.entries()) {
    const el = rawEl as unknown as Record<string, unknown>;
    const metadata = asRecord(el["metadata"]);
    const rewritten =
      readImageAssetUrl(metadata, imageUrls) ?? rewriteResourceUrl(readSrc(el), metadata, urls, ctx, errors);
    const mappedId = namespaceElementId(id, ctx);
    const parentId = typeof el["parentId"] === "string" ? namespaceElementId(el["parentId"] as string, ctx) : null;
    elements[mappedId] = {
      id: mappedId,
      parentId,
      type: typeof el["type"] === "string" ? (el["type"] as string) : "container",
      bounds: el["bounds"] as FlatIRElementLike["bounds"],
      styles: rewriteStyleResourceUrls(asRecord(el["styles"]), urls, ctx, errors),
      textContent: typeof el["textContent"] === "string" ? (el["textContent"] as string) : undefined,
      svgData: el["svgData"],
      ...(rewritten ? { src: rewritten } : {}),
    };
  }
  return { elements };
}

/** Recursively shift every element's bounds.x by dx (CanvasKit draws at absolute bounds). */
export function translateTree(elements: IRElement[], dx: number): void {
  for (const el of elements) {
    el.bounds = { ...el.bounds, x: el.bounds.x + dx };
    if (el.children && el.children.length > 0) translateTree(el.children, dx);
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function pageSize(content: VZIContent): { width: number; height: number } {
  const meta = content.metadata as unknown as Record<string, unknown>;
  const vp = asRecord(meta["formaViewport"]);
  let width = isFiniteNumber(vp["width"]) ? (vp["width"] as number) : 0;
  let height = isFiniteNumber(vp["height"]) ? (vp["height"] as number) : 0;
  if (width <= 0 || height <= 0) {
    let maxX = 0;
    let maxY = 0;
    for (const rawEl of content.elements.values()) {
      const b = asRecord((rawEl as unknown as Record<string, unknown>)["bounds"]);
      const x = isFiniteNumber(b["x"]) ? (b["x"] as number) : 0;
      const y = isFiniteNumber(b["y"]) ? (b["y"] as number) : 0;
      const w = isFiniteNumber(b["width"]) ? (b["width"] as number) : 0;
      const h = isFiniteNumber(b["height"]) ? (b["height"] as number) : 0;
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
    if (width <= 0) width = Math.ceil(maxX);
    if (height <= 0) height = Math.ceil(maxY);
  }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

export interface AdapterPageInput {
  status?: "ready";
  pageId: string;
  artifactId: string;
  variant: string;
  title: string;
  content: VZIContent;
  urls: PageAssetUrls;
}

export interface AdapterFailedPageInput {
  status: "failed";
  pageId: string;
  artifactId: string;
  variant: string;
  title: string;
  errorReason: string;
  width?: number;
  height?: number;
}

export type AdapterCanvasPageInput = AdapterPageInput | AdapterFailedPageInput;

export interface PageFrame {
  pageId: string;
  artifactId: string;
  variant: string;
  title: string;
  x: number;
  width: number;
  height: number;
  status: "ready" | "error";
  errorReason?: string;
}

export interface ComposedCanvas {
  elements: IRElement[];
  frames: PageFrame[];
  errors: ResourceError[];
  resourceRefs: ResourceRef[];
  contentWidth: number;
  contentHeight: number;
}

const FAILED_PAGE_FRAME = { width: 390, height: 800 };

function isFailedPage(page: AdapterCanvasPageInput): page is AdapterFailedPageInput {
  return page.status === "failed";
}

function hasDuplicateElementIds(pages: AdapterCanvasPageInput[]): boolean {
  const seen = new Set<string>();
  for (const page of pages) {
    if (isFailedPage(page)) continue;
    for (const id of page.content.elements.keys()) {
      if (seen.has(id)) return true;
      seen.add(id);
    }
  }
  return false;
}

/** Tile each page's CanvasKit tree horizontally onto one IRElement[] (single WebGL context). */
export function composeAnnotationCanvas(pages: AdapterCanvasPageInput[], gap = 80): ComposedCanvas {
  const elements: IRElement[] = [];
  const frames: PageFrame[] = [];
  const errors: ResourceError[] = [];
  const resourceRefs: ResourceRef[] = [];
  let xCursor = 0;
  let maxHeight = 0;
  const namespaceIds = hasDuplicateElementIds(pages);

  for (const page of pages) {
    if (isFailedPage(page)) {
      const width = page.width ?? FAILED_PAGE_FRAME.width;
      const height = page.height ?? FAILED_PAGE_FRAME.height;
      frames.push({
        pageId: page.pageId,
        artifactId: page.artifactId,
        variant: page.variant,
        title: page.title,
        x: xCursor,
        width,
        height,
        status: "error",
        errorReason: page.errorReason,
      });
      maxHeight = Math.max(maxHeight, height);
      xCursor += width + gap;
      continue;
    }

    const ctx = { artifactId: page.artifactId, pageId: page.pageId, variant: page.variant, namespaceIds, resourceRefs };
    const doc = vziContentToFlatDoc(page.content, page.urls, ctx, errors);
    const tree = buildCanvasKitElementTree(doc);
    const { width, height } = pageSize(page.content);
    translateTree(tree, xCursor);
    elements.push(...tree);
    frames.push({
      pageId: page.pageId,
      artifactId: page.artifactId,
      variant: page.variant,
      title: page.title,
      x: xCursor,
      width,
      height,
      status: "ready",
    });
    maxHeight = Math.max(maxHeight, height);
    xCursor += width + gap;
  }

  return {
    elements,
    frames,
    errors,
    resourceRefs,
    contentWidth: xCursor > 0 ? xCursor - gap : 0,
    contentHeight: maxHeight,
  };
}

function markElementMissing(el: IRElement): IRElement {
  return {
    ...el,
    src: undefined,
    svgData: undefined,
    styles: {
      ...el.styles,
      backgroundColor: "#fee2e2",
      borderColor: "#f59e0b",
      borderWidth: 1,
    },
  };
}

export function withMissingResourcePlaceholders(elements: IRElement[], missingUrls: Set<string>): IRElement[] {
  if (missingUrls.size === 0) return elements;
  return elements.map((el) => {
    const children = el.children ? withMissingResourcePlaceholders(el.children, missingUrls) : el.children;
    const next = children ? { ...el, children } : el;
    return typeof next.src === "string" && missingUrls.has(next.src) ? markElementMissing(next) : next;
  });
}
