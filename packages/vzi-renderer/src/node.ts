/**
 * Renderer Node.js entry
 *
 * Provides an offscreen rendering API for Quality Lab and backend jobs.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Canvas, CanvasKit, Surface } from 'canvaskit-wasm';
import type {
  DesignSnapshotManifest,
  DesignSnapshotTileDescriptor,
  IRElement as IRContractElement,
  SnapshotAssetDescriptor,
  SnapshotFontDescriptor,
  SnapshotOutputFormat,
  IntermediateRepresentation,
} from '@vzi-core/types';
import { loadCanvasKit } from './canvaskit/CanvasKitLoader';
import { FontManager } from './canvaskit/FontManager';
import { toCanvasKitColor } from './canvaskit/converters/ColorConverter';
import { createBorderPath, parseBorder } from './canvaskit/converters/BorderConverter';
import { imageRenderer } from './canvaskit/renderers/ImageRenderer';
import { renderElement } from './canvaskit/renderers/RendererRegistry';
import { sortCanvasKitElements } from './canvaskit/render-order';
import type { Bounds, IRElement } from './canvaskit/renderers/types';
import {
  createDesignSnapshotManifest,
  type SnapshotManifestOptions,
} from './snapshot';

type FlatElementBoundsLike = {
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
};

type FlatElementLike = {
  id?: unknown;
  parentId?: unknown;
  type?: unknown;
  bounds?: FlatElementBoundsLike;
  styles?: Record<string, unknown>;
  textContent?: unknown;
  svgData?: unknown;
  src?: unknown;
  imageData?: {
    src?: unknown;
  };
  source?: {
    tagName?: unknown;
    src?: unknown;
  };
};

type FlatIRLike = {
  rootElementId?: unknown;
  metadata?: Record<string, unknown>;
  elements?: Record<string, FlatElementLike>;
};

type SnapshotSourceIR = Pick<IntermediateRepresentation, 'rootElementId' | 'metadata' | 'elements'>;

export interface NodeRenderOptions {
  width?: number;
  height?: number;
  backgroundColor?: string;
  format?: SnapshotOutputFormat;
  translateX?: number;
  translateY?: number;
  assetPlaceholderColor?: string;
  pixelRatio?: number;
  locateFile?: (file: string) => string;
}

export interface NodeRenderResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration: number;
}

export interface SnapshotNodeRenderPlan {
  outputPath: string;
  width: number;
  height: number;
  backgroundColor: string;
  format: SnapshotOutputFormat;
  translateX: number;
  translateY: number;
  pixelRatio: number;
}

export interface SnapshotTileNodeRenderPlan extends SnapshotNodeRenderPlan {
  tile: DesignSnapshotTileDescriptor;
}

export interface SnapshotTileRenderResult extends NodeRenderResult {
  tile: DesignSnapshotTileDescriptor;
}

export interface DesignSnapshotRenderResult {
  manifest: DesignSnapshotManifest;
  fullImage: NodeRenderResult;
  tiles: SnapshotTileRenderResult[];
}

export interface SnapshotNodeRenderOptions extends SnapshotManifestOptions {
  locateFile?: (file: string) => string;
}

interface SnapshotResourceStatusReport {
  fonts: Record<string, SnapshotFontDescriptor['status']>;
  assets: Record<string, SnapshotAssetDescriptor['status']>;
}

const GENERIC_FONT_FAMILY_PATTERN = /(^|,)\s*(serif|sans-serif|monospace|system-ui|cursive|fantasy)\s*($|,)/i;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseNumber(value: unknown, fallback: number): number {
  if (isFiniteNumber(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function isGenericFontFamily(fontFamily: string): boolean {
  return GENERIC_FONT_FAMILY_PATTERN.test(fontFamily);
}

function normalizeBounds(bounds: FlatElementBoundsLike | undefined): Bounds {
  return {
    x: parseNumber(bounds?.x, 0),
    y: parseNumber(bounds?.y, 0),
    width: Math.max(0, parseNumber(bounds?.width, 0)),
    height: Math.max(0, parseNumber(bounds?.height, 0)),
  };
}

function normalizeStyles(styles: Record<string, unknown> | undefined): IRElement['styles'] {
  if (!styles) {
    return {};
  }

  const normalized: Record<string, string | number | undefined> = {};
  for (const [key, value] of Object.entries(styles)) {
    if (typeof value === 'string' || typeof value === 'number' || value === undefined) {
      normalized[key] = value;
    }
  }
  return normalized;
}

function normalizeType(raw: FlatElementLike): string {
  if (typeof raw.type === 'string' && raw.type.trim().length > 0) {
    return raw.type;
  }
  if (typeof raw.source?.tagName === 'string' && raw.source.tagName.trim().length > 0) {
    return raw.source.tagName.toLowerCase();
  }
  return 'container';
}

function normalizeSvgData(raw: unknown): string | undefined {
  if (typeof raw === 'string') {
    return raw;
  }
  if (raw && typeof raw === 'object') {
    try {
      return JSON.stringify(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function normalizeSrc(raw: FlatElementLike): string | undefined {
  if (typeof raw.src === 'string' && raw.src.trim().length > 0) {
    return raw.src;
  }
  if (typeof raw.imageData?.src === 'string' && raw.imageData.src.trim().length > 0) {
    return raw.imageData.src;
  }
  if (typeof raw.source?.src === 'string' && raw.source.src.trim().length > 0) {
    return raw.source.src;
  }
  return undefined;
}

function toSnapshotSource(ir: FlatIRLike): SnapshotSourceIR {
  const elements: Record<string, IRContractElement> = {};

  for (const [fallbackId, rawElement] of Object.entries(ir.elements ?? {})) {
    if (!rawElement || typeof rawElement !== 'object') {
      continue;
    }

    const id = typeof rawElement.id === 'string' && rawElement.id.trim().length > 0
      ? rawElement.id
      : fallbackId;
    if (!id) {
      continue;
    }

    elements[id] = {
      id,
      parentId: typeof rawElement.parentId === 'string' && rawElement.parentId.length > 0
        ? rawElement.parentId
        : null,
      type: (normalizeType(rawElement) as IRContractElement['type']),
      bounds: normalizeBounds(rawElement.bounds),
      styles: normalizeStyles(rawElement.styles),
      textContent: typeof rawElement.textContent === 'string' ? rawElement.textContent : undefined,
      source: rawElement.source && typeof rawElement.source === 'object'
        ? {
            tagName: typeof rawElement.source.tagName === 'string' ? rawElement.source.tagName : undefined,
            src: typeof rawElement.source.src === 'string' ? rawElement.source.src : undefined,
          }
        : undefined,
      imageData: typeof rawElement.imageData?.src === 'string'
        ? {
            src: rawElement.imageData.src,
            naturalWidth: normalizeBounds(rawElement.bounds).width,
            naturalHeight: normalizeBounds(rawElement.bounds).height,
          }
        : undefined,
    };
  }

  return {
    rootElementId: typeof ir.rootElementId === 'string' ? ir.rootElementId : '',
    metadata: ir.metadata,
    elements,
  };
}

function toElementTree(ir: FlatIRLike): IRElement[] {
  const sourceElements = ir.elements ?? {};
  const elementMap = new Map<string, IRElement>();
  const parentMap = new Map<string, string | null>();

  for (const [fallbackId, rawElement] of Object.entries(sourceElements)) {
    if (!rawElement || typeof rawElement !== 'object') {
      continue;
    }

    const id = typeof rawElement.id === 'string' && rawElement.id.trim().length > 0
      ? rawElement.id
      : fallbackId;
    if (!id) {
      continue;
    }

    const element: IRElement = {
      id,
      type: normalizeType(rawElement),
      bounds: normalizeBounds(rawElement.bounds),
      styles: normalizeStyles(rawElement.styles),
      textContent: typeof rawElement.textContent === 'string' ? rawElement.textContent : undefined,
      svgData: normalizeSvgData(rawElement.svgData),
      src: normalizeSrc(rawElement),
      children: [],
    };

    elementMap.set(id, element);
    parentMap.set(id, typeof rawElement.parentId === 'string' && rawElement.parentId.length > 0 ? rawElement.parentId : null);
  }

  const roots: IRElement[] = [];
  for (const [id, element] of elementMap.entries()) {
    const parentId = parentMap.get(id) ?? null;
    if (!parentId || !elementMap.has(parentId) || parentId === id) {
      roots.push(element);
      continue;
    }
    const parent = elementMap.get(parentId);
    if (!parent) {
      roots.push(element);
      continue;
    }
    parent.children = parent.children ?? [];
    parent.children.push(element);
  }

  const sortChildren = (node: IRElement): void => {
    if (!node.children || node.children.length === 0) {
      return;
    }
    node.children = sortCanvasKitElements(node.children);
    for (const child of node.children) {
      sortChildren(child);
    }
  };

  for (const root of roots) {
    sortChildren(root);
  }

  const rootElementId = typeof ir.rootElementId === 'string' ? ir.rootElementId : '';
  if (rootElementId && elementMap.has(rootElementId)) {
    const root = elementMap.get(rootElementId);
    return root ? [root] : sortCanvasKitElements(roots);
  }

  return sortCanvasKitElements(roots);
}

function estimateCanvasSize(
  ir: FlatIRLike,
  explicitWidth?: number,
  explicitHeight?: number
): { width: number; height: number } {
  const metadata = ir.metadata ?? {};
  const viewportMeta = metadata.viewport as { width?: unknown; height?: unknown } | undefined;
  const metadataWidth = parseNumber(viewportMeta?.width ?? metadata.viewportWidth, 0);
  const metadataHeight = parseNumber(viewportMeta?.height ?? metadata.viewportHeight, 0);
  const metadataContentHeight = parseNumber(metadata.contentHeight, 0);

  let width = explicitWidth && explicitWidth > 0 ? explicitWidth : metadataWidth;
  let height = explicitHeight && explicitHeight > 0
    ? explicitHeight
    : Math.max(metadataHeight, metadataContentHeight);

  let maxX = 0;
  let maxY = 0;
  for (const rawElement of Object.values(ir.elements ?? {})) {
    const bounds = normalizeBounds(rawElement?.bounds);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  if (width <= 0) {
    width = Math.max(1, Math.ceil(maxX));
  }
  if (height <= 0) {
    height = Math.max(1, Math.ceil(maxY));
  } else {
    height = Math.max(height, Math.ceil(maxY));
  }

  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  };
}

function collectFontFamilies(elements: IRElement[]): Set<string> {
  const families = new Set<string>();
  const iconFallbackFamilies = ['Material Icons'];

  const isLikelyIconLigature = (text: string, bounds: Bounds): boolean => {
    const normalized = text.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (!/^[a-z0-9_]+$/.test(normalized) || !normalized.includes('_')) {
      return false;
    }
    if (normalized.length < 3 || normalized.length > 40) {
      return false;
    }
    return bounds.width <= 96 && bounds.height <= 96;
  };

  const visit = (element: IRElement): void => {
    const text = typeof element.textContent === 'string' ? element.textContent.trim() : '';
    if (text.length > 0) {
      const family = element.styles.fontFamily;
      if (typeof family === 'string' && family.trim().length > 0) {
        families.add(family);
      }
      if (isLikelyIconLigature(text, element.bounds)) {
        for (const iconFamily of iconFallbackFamilies) {
          families.add(iconFamily);
        }
      }
    }

    if (element.children && element.children.length > 0) {
      for (const child of element.children) {
        visit(child);
      }
    }
  };

  for (const element of elements) {
    visit(element);
  }

  return families;
}

function collectImageSources(elements: IRElement[]): Set<string> {
  const imageSources = new Set<string>();

  const extractBackgroundImageUrls = (backgroundImage: string): string[] => {
    const urls: string[] = [];
    const regex = /url\((['"]?)(.*?)\1\)/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(backgroundImage)) !== null) {
      const url = match[2]?.trim();
      if (url) {
        urls.push(url);
      }
    }
    return urls;
  };

  const visit = (element: IRElement): void => {
    if (typeof element.src === 'string' && element.src.trim().length > 0) {
      imageSources.add(element.src.trim());
    }
    if (typeof element.styles.backgroundImage === 'string') {
      for (const url of extractBackgroundImageUrls(element.styles.backgroundImage)) {
        imageSources.add(url);
      }
    }
    if (element.children && element.children.length > 0) {
      for (const child of element.children) {
        visit(child);
      }
    }
  };

  for (const element of elements) {
    visit(element);
  }

  return imageSources;
}

function isTransparentColor(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  return (
    normalized === 'transparent' ||
    normalized === 'rgba(0,0,0,0)' ||
    normalized === 'rgb(0,0,0,0)' ||
    normalized === '#0000' ||
    normalized === '#00000000' ||
    normalized === 'hsla(0,0%,0%,0)'
  );
}

function inferCanvasBackgroundColor(elements: IRElement[]): string | undefined {
  const queue = [...elements];
  while (queue.length > 0) {
    const element = queue.shift()!;
    const backgroundColor = element.styles.backgroundColor;
    if (typeof backgroundColor === 'string' && backgroundColor.trim().length > 0) {
      if (!isTransparentColor(backgroundColor)) {
        return backgroundColor;
      }
    }
    if (element.children && element.children.length > 0) {
      queue.push(...element.children);
    }
  }
  return undefined;
}

async function preloadResources(
  CanvasKitInstance: CanvasKit,
  elements: IRElement[]
): Promise<SnapshotResourceStatusReport> {
  const fontManager = FontManager.getInstance();
  const fontFamilies = collectFontFamilies(elements);
  const statusReport: SnapshotResourceStatusReport = {
    fonts: {},
    assets: {},
  };

  if (fontFamilies.size > 0) {
    const defaultTypeface = fontManager.getTypefaceSync('sans-serif');
    await Promise.all(
      [...fontFamilies].map(async (fontFamily) => {
        const typeface = await fontManager.getTypeface(fontFamily);
        const isFallback = !!defaultTypeface
          && typeface === defaultTypeface
          && !isGenericFontFamily(fontFamily);
        statusReport.fonts[fontFamily] = isFallback ? 'fallback' : 'ready';
      })
    );
  }

  const imageSources = collectImageSources(elements);
  if (imageSources.size > 0) {
    await Promise.all(
      [...imageSources].map(async (src) => {
        const image = await imageRenderer.loadImage(src, CanvasKitInstance);
        statusReport.assets[src] = image ? 'ready' : 'placeholder';
      })
    );
  }

  return statusReport;
}

function applyClip(canvas: Canvas, CanvasKitInstance: CanvasKit, element: IRElement): void {
  const border = parseBorder(element.styles);
  const clipPath = createBorderPath(element.bounds, border.radius, CanvasKitInstance);
  try {
    canvas.clipPath(clipPath, CanvasKitInstance.ClipOp.Intersect, true);
  } finally {
    clipPath.delete();
  }
}

function shouldClipOverflow(overflow: string | number | undefined): boolean {
  if (typeof overflow !== 'string') {
    return false;
  }
  const normalized = overflow.trim().toLowerCase();
  return normalized === 'hidden' || normalized === 'clip';
}

function renderMissingImagePlaceholder(
  canvas: Canvas,
  CanvasKitInstance: CanvasKit,
  element: IRElement,
  color: string
): void {
  const { x, y, width, height } = element.bounds;
  const fillPaint = new CanvasKitInstance.Paint();
  const strokePaint = new CanvasKitInstance.Paint();
  const linePaint = new CanvasKitInstance.Paint();

  try {
    fillPaint.setAntiAlias(true);
    fillPaint.setStyle(CanvasKitInstance.PaintStyle.Fill);
    fillPaint.setColor(toCanvasKitColor('rgba(0, 0, 0, 0.05)', CanvasKitInstance));

    strokePaint.setAntiAlias(true);
    strokePaint.setStyle(CanvasKitInstance.PaintStyle.Stroke);
    strokePaint.setStrokeWidth(1);
    strokePaint.setColor(toCanvasKitColor(color, CanvasKitInstance));

    linePaint.setAntiAlias(true);
    linePaint.setStyle(CanvasKitInstance.PaintStyle.Stroke);
    linePaint.setStrokeWidth(1);
    linePaint.setColor(toCanvasKitColor(color, CanvasKitInstance));

    const rect = CanvasKitInstance.LTRBRect(x, y, x + width, y + height);
    canvas.drawRect(rect, fillPaint);
    canvas.drawRect(rect, strokePaint);
    canvas.drawLine(x, y, x + width, y + height, linePaint);
    canvas.drawLine(x + width, y, x, y + height, linePaint);
  } finally {
    fillPaint.delete();
    strokePaint.delete();
    linePaint.delete();
  }
}

function shouldRenderImagePlaceholder(element: IRElement): boolean {
  if ((element.type !== 'image' && element.type !== 'img') || typeof element.src !== 'string') {
    return false;
  }

  return !imageRenderer.getCachedImage(element.src);
}

function renderTree(
  canvas: Canvas,
  CanvasKitInstance: CanvasKit,
  elements: IRElement[],
  options: Pick<NodeRenderOptions, 'translateX' | 'translateY' | 'assetPlaceholderColor' | 'pixelRatio'> = {}
): void {
  canvas.save();
  const pixelRatio = Math.max(1, options.pixelRatio ?? 1);
  if (pixelRatio !== 1) {
    canvas.scale(pixelRatio, pixelRatio);
  }
  canvas.translate(options.translateX ?? 0, options.translateY ?? 0);

  const renderNode = (element: IRElement): void => {
    canvas.save();
    try {
      if (shouldClipOverflow(element.styles.overflow)) {
        applyClip(canvas, CanvasKitInstance, element);
      }

      if (shouldRenderImagePlaceholder(element)) {
        renderMissingImagePlaceholder(
          canvas,
          CanvasKitInstance,
          element,
          options.assetPlaceholderColor ?? '#c2410c'
        );
      } else {
        renderElement(canvas, element, CanvasKitInstance);
      }

      if (element.children && element.children.length > 0) {
        const sortedChildren = sortCanvasKitElements(element.children);
        for (const child of sortedChildren) {
          renderNode(child);
        }
      }
    } finally {
      canvas.restore();
    }
  };

  const sortedRoots = sortCanvasKitElements(elements);
  for (const element of sortedRoots) {
    renderNode(element);
  }

  canvas.restore();
}

function deleteSurface(surface: Surface): void {
  try {
    surface.delete();
  } catch {
    // ignore
  }
}

export async function renderIRToImageNode(
  ir: IntermediateRepresentation | FlatIRLike,
  outputPath: string,
  options: NodeRenderOptions = {}
): Promise<NodeRenderResult> {
  const startTime = Date.now();
  let surface: Surface | null = null;
  let image: ReturnType<Surface['makeImageSnapshot']> | null = null;

  try {
    const normalizedIR = (ir && typeof ir === 'object' ? ir : {}) as FlatIRLike;
    const size = estimateCanvasSize(normalizedIR, options.width, options.height);
    const elements = toElementTree(normalizedIR);

    const CanvasKitInstance = await loadCanvasKit({
      locateFile: options.locateFile,
    });
    await FontManager.getInstance().init(CanvasKitInstance);
    await preloadResources(CanvasKitInstance, elements);

    surface = CanvasKitInstance.MakeSurface(size.width, size.height);
    if (!surface) {
      return {
        success: false,
        error: 'Failed to create offscreen CanvasKit surface',
        duration: Date.now() - startTime,
      };
    }

    const canvas = surface.getCanvas();
    const clearColor = options.backgroundColor
      || inferCanvasBackgroundColor(elements)
      || '#ffffff';
    canvas.clear(toCanvasKitColor(clearColor, CanvasKitInstance));

    renderTree(canvas, CanvasKitInstance, elements, options);
    surface.flush();

    image = surface.makeImageSnapshot();
    if (!image) {
      return {
        success: false,
        error: 'Failed to create image snapshot',
        duration: Date.now() - startTime,
      };
    }

    const imageFormat = options.format === 'webp'
      ? CanvasKitInstance.ImageFormat.WEBP
      : CanvasKitInstance.ImageFormat.PNG;
    const encodedBytes = image.encodeToBytes(imageFormat, 100);
    if (!encodedBytes) {
      return {
        success: false,
        error: 'Failed to encode image bytes',
        duration: Date.now() - startTime,
      };
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(encodedBytes));

    return {
      success: true,
      outputPath,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  } finally {
    if (image) {
      image.delete();
    }
    if (surface) {
      deleteSurface(surface);
    }
  }
}

function normalizeSnapshotRenderPath(relativeOrAbsolutePath: string): string {
  return path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.resolve(relativeOrAbsolutePath);
}

export function buildFullSnapshotRenderPlan(
  ir: IntermediateRepresentation | FlatIRLike,
  options: SnapshotManifestOptions = {}
): SnapshotNodeRenderPlan {
  const manifest = createDesignSnapshotManifest(toSnapshotSource(ir as FlatIRLike), options);
  const pixelRatio = Math.max(1, options.pixelRatio ?? 1);

  return {
    outputPath: normalizeSnapshotRenderPath(manifest.fullImage.path),
    width: Math.max(1, Math.round(manifest.fullImage.width * pixelRatio)),
    height: Math.max(1, Math.round(manifest.fullImage.height * pixelRatio)),
    backgroundColor: manifest.background.color,
    format: manifest.fullImage.format,
    translateX: manifest.contentBounds.x < 0 ? -manifest.contentBounds.x : 0,
    translateY: manifest.contentBounds.y < 0 ? -manifest.contentBounds.y : 0,
    pixelRatio,
  };
}

export function buildTileSnapshotRenderPlans(
  ir: IntermediateRepresentation | FlatIRLike,
  options: SnapshotManifestOptions = {}
): SnapshotTileNodeRenderPlan[] {
  const manifest = createDesignSnapshotManifest(toSnapshotSource(ir as FlatIRLike), options);
  const pixelRatio = Math.max(1, options.pixelRatio ?? 1);

  return manifest.tiles.map((tile): SnapshotTileNodeRenderPlan => ({
    tile,
    outputPath: normalizeSnapshotRenderPath(tile.path),
    width: Math.max(1, Math.round(tile.width * pixelRatio)),
    height: Math.max(1, Math.round(tile.height * pixelRatio)),
    backgroundColor: manifest.background.color,
    format: tile.format,
    translateX: -tile.x,
    translateY: -tile.y,
    pixelRatio,
  }));
}

export async function renderDesignSnapshotNode(
  ir: IntermediateRepresentation | FlatIRLike,
  options: SnapshotNodeRenderOptions = {}
): Promise<DesignSnapshotRenderResult> {
  const normalizedIR = (ir && typeof ir === 'object' ? ir : {}) as FlatIRLike;
  const elements = toElementTree(normalizedIR);
  const CanvasKitInstance = await loadCanvasKit({
    locateFile: options.locateFile,
  });
  await FontManager.getInstance().init(CanvasKitInstance);
  const resourceStatuses = await preloadResources(CanvasKitInstance, elements);
  const snapshotSource = toSnapshotSource(normalizedIR);

  const manifest = createDesignSnapshotManifest(snapshotSource, {
    ...options,
    fontStatuses: resourceStatuses.fonts,
    assetStatuses: resourceStatuses.assets,
  });
  const fullPlan = buildFullSnapshotRenderPlan(snapshotSource, {
    ...options,
    fontStatuses: resourceStatuses.fonts,
    assetStatuses: resourceStatuses.assets,
  });
  const tilePlans = buildTileSnapshotRenderPlans(snapshotSource, {
    ...options,
    fontStatuses: resourceStatuses.fonts,
    assetStatuses: resourceStatuses.assets,
  });

  const fullImage = await renderIRToImageNode(normalizedIR, fullPlan.outputPath, {
    width: fullPlan.width,
    height: fullPlan.height,
    backgroundColor: fullPlan.backgroundColor,
    format: fullPlan.format,
    translateX: fullPlan.translateX,
    translateY: fullPlan.translateY,
    pixelRatio: fullPlan.pixelRatio,
    locateFile: options.locateFile,
  });

  const tiles = await Promise.all(
    tilePlans.map(async (plan) => {
      const result = await renderIRToImageNode(normalizedIR, plan.outputPath, {
        width: plan.width,
        height: plan.height,
        backgroundColor: plan.backgroundColor,
        format: plan.format,
        translateX: plan.translateX,
        translateY: plan.translateY,
        pixelRatio: plan.pixelRatio,
        locateFile: options.locateFile,
      });

      return {
        ...result,
        tile: plan.tile,
      };
    })
  );

  return {
    manifest,
    fullImage,
    tiles,
  };
}
