import type {
  DesignSnapshotManifest,
  DesignSnapshotTileDescriptor,
  IRElement,
  IntermediateRepresentation,
  SnapshotAssetDescriptor,
  SnapshotBounds,
  SnapshotFontDescriptor,
  SnapshotOutputFormat,
  SnapshotViewport,
} from '@vzi-core/types';
import { TileManager } from '../tile/TileManager';

export interface SnapshotManifestOptions {
  format?: SnapshotOutputFormat;
  outputDir?: string;
  fullImageName?: string;
  tileDirectory?: string;
  tileSize?: number;
  pixelRatio?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  viewportScale?: number;
  backgroundColor?: string;
  fontStatuses?: Record<string, SnapshotFontDescriptor['status']>;
  assetStatuses?: Record<string, SnapshotAssetDescriptor['status']>;
}

export interface SnapshotRevisionInput {
  contentBounds: SnapshotBounds;
  viewport: SnapshotViewport;
  backgroundColor: string;
}

const DEFAULT_FULL_IMAGE_NAME = 'full';
const DEFAULT_TILE_DIRECTORY = 'tiles';
const DEFAULT_OUTPUT_DIR = 'snapshots';
const DEFAULT_TILE_SIZE = 512;
const DEFAULT_PIXEL_RATIO = 1;

type FlatIRLike = Pick<IntermediateRepresentation, 'rootElementId' | 'elements' | 'metadata'>;

function getElementAssetSource(element: IRElement): string | null {
  if (typeof element.imageData?.src === 'string' && element.imageData.src.trim().length > 0) {
    return element.imageData.src.trim();
  }

  if (typeof element.source?.src === 'string' && element.source.src.trim().length > 0) {
    return element.source.src.trim();
  }

  return null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseNumber(value: unknown): number | null {
  if (isFiniteNumber(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toPosixPath(...parts: string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .join('/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\.\//, '');
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `snap-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function extractBackgroundImageUrls(backgroundImage: string): string[] {
  const urls: string[] = [];
  const matcher = /url\((['"]?)(.*?)\1\)/gi;
  let match: RegExpExecArray | null;

  match = matcher.exec(backgroundImage);
  while (match) {
    const candidate = match[2]?.trim();
    if (candidate) {
      urls.push(candidate);
    }
    match = matcher.exec(backgroundImage);
  }

  return urls;
}

function isTransparentColor(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  return normalized === 'transparent'
    || normalized === 'rgba(0,0,0,0)'
    || normalized === 'rgb(0,0,0,0)'
    || normalized === '#0000'
    || normalized === '#00000000'
    || normalized === 'hsla(0,0%,0%,0)';
}

function getElementList(ir: FlatIRLike): IRElement[] {
  return Object.values(ir.elements ?? {});
}

function normalizeElementForRevision(element: IRElement): Record<string, unknown> {
  return {
    id: element.id,
    parentId: element.parentId,
    type: element.type,
    bounds: {
      x: element.bounds.x,
      y: element.bounds.y,
      width: element.bounds.width,
      height: element.bounds.height,
    },
    styles: Object.keys(element.styles)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, string | number | null>>((result, key) => {
        const value = element.styles[key];
        if (typeof value === 'string' || typeof value === 'number' || value === null) {
          result[key] = value;
        }
        return result;
      }, {}),
    textContent: element.textContent ?? null,
    svgData: element.svgData ?? null,
    imageData: element.imageData
      ? {
          src: element.imageData.src,
          format: element.imageData.format ?? null,
        }
      : null,
  };
}

function resolveRootElement(ir: FlatIRLike): IRElement | null {
  const rootElementId = ir.rootElementId;
  if (rootElementId && ir.elements[rootElementId]) {
    return ir.elements[rootElementId] ?? null;
  }

  return getElementList(ir)[0] ?? null;
}

export function calculateSnapshotContentBounds(ir: FlatIRLike): SnapshotBounds {
  const elements = getElementList(ir);
  if (elements.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const element of elements) {
    minX = Math.min(minX, element.bounds.x);
    minY = Math.min(minY, element.bounds.y);
    maxX = Math.max(maxX, element.bounds.x + element.bounds.width);
    maxY = Math.max(maxY, element.bounds.y + element.bounds.height);
  }

  return {
    x: Number.isFinite(minX) ? minX : 0,
    y: Number.isFinite(minY) ? minY : 0,
    width: Math.max(1, Math.ceil(maxX - minX)),
    height: Math.max(1, Math.ceil(maxY - minY)),
  };
}

export function calculateSnapshotViewport(
  ir: FlatIRLike,
  options: Pick<SnapshotManifestOptions, 'viewportWidth' | 'viewportHeight' | 'viewportScale'> = {}
): SnapshotViewport {
  const rootElement = resolveRootElement(ir);
  const metadataViewport = ir.metadata?.viewport as { width?: unknown; height?: unknown } | undefined;
  const contentBounds = calculateSnapshotContentBounds(ir);

  const width = options.viewportWidth
    ?? parseNumber(metadataViewport?.width)
    ?? parseNumber(ir.metadata?.viewportWidth)
    ?? rootElement?.bounds.width
    ?? contentBounds.width;
  const height = options.viewportHeight
    ?? parseNumber(metadataViewport?.height)
    ?? parseNumber(ir.metadata?.viewportHeight)
    ?? rootElement?.bounds.height
    ?? contentBounds.height;

  return {
    width: Math.max(1, Math.ceil(width)),
    height: Math.max(1, Math.ceil(height)),
    scale: options.viewportScale ?? 1,
  };
}

export function resolveSnapshotBackground(
  ir: FlatIRLike,
  overrideColor?: string
): string {
  if (overrideColor && overrideColor.trim().length > 0) {
    return overrideColor;
  }

  const rootElement = resolveRootElement(ir);
  const rootBackground = rootElement?.styles.backgroundColor;
  if (typeof rootBackground === 'string' && rootBackground.trim().length > 0 && !isTransparentColor(rootBackground)) {
    return rootBackground;
  }

  for (const element of getElementList(ir)) {
    const backgroundColor = element.styles.backgroundColor;
    if (typeof backgroundColor === 'string' && backgroundColor.trim().length > 0 && !isTransparentColor(backgroundColor)) {
      return backgroundColor;
    }
  }

  return '#ffffff';
}

export function collectSnapshotFonts(
  ir: FlatIRLike,
  statuses: Record<string, SnapshotFontDescriptor['status']> = {}
): SnapshotFontDescriptor[] {
  const families = new Set<string>();

  for (const element of getElementList(ir)) {
    const family = element.styles.fontFamily;
    if (typeof family === 'string' && family.trim().length > 0) {
      families.add(family.trim());
    }
  }

  return [...families]
    .sort((left, right) => left.localeCompare(right))
    .map((family) => ({
      family,
      status: statuses[family] ?? 'ready',
    }));
}

export function collectSnapshotAssets(
  ir: FlatIRLike,
  statuses: Record<string, SnapshotAssetDescriptor['status']> = {}
): SnapshotAssetDescriptor[] {
  const assets = new Map<string, SnapshotAssetDescriptor>();

  for (const element of getElementList(ir)) {
    const assetSource = getElementAssetSource(element);
    if (assetSource) {
      const src = assetSource;
      const kind = /\.svg(?:$|[?#&])/i.test(src) ? 'svg' : 'image';
      assets.set(`src:${src}`, {
        id: `asset-${assets.size + 1}`,
        src,
        kind,
        status: statuses[src] ?? 'ready',
      });
    }

    if (typeof element.styles.backgroundImage === 'string') {
      for (const src of extractBackgroundImageUrls(element.styles.backgroundImage)) {
        assets.set(`background:${src}`, {
          id: `asset-${assets.size + 1}`,
          src,
          kind: 'background-image',
          status: statuses[src] ?? 'ready',
        });
      }
    }
  }

  return [...assets.values()].sort((left, right) => left.src.localeCompare(right.src));
}

export function createSnapshotRevision(
  ir: FlatIRLike,
  input: SnapshotRevisionInput
): string {
  const normalized = {
    elements: getElementList(ir)
      .map((element) => normalizeElementForRevision(element))
      .sort((left, right) => {
        const leftId = typeof left.id === 'string' ? left.id : '';
        const rightId = typeof right.id === 'string' ? right.id : '';
        return leftId.localeCompare(rightId);
      }),
    contentBounds: input.contentBounds,
    viewport: input.viewport,
    backgroundColor: input.backgroundColor,
  };

  return hashString(stableSerialize(normalized));
}

export function createSnapshotTileDescriptors(
  contentBounds: SnapshotBounds,
  revision: string,
  options: Pick<SnapshotManifestOptions, 'format' | 'outputDir' | 'tileDirectory' | 'tileSize' | 'pixelRatio'> = {}
): DesignSnapshotTileDescriptor[] {
  const format = options.format ?? 'png';
  const tileSize = options.tileSize ?? DEFAULT_TILE_SIZE;
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const tileDirectory = options.tileDirectory ?? DEFAULT_TILE_DIRECTORY;
  const pixelRatio = Math.max(1, options.pixelRatio ?? DEFAULT_PIXEL_RATIO);
  const tileManager = new TileManager(tileSize, 0);
  const tiles = tileManager.getTilesForRect(contentBounds);

  return tiles
    .map((tile) => {
      const world = tileManager.tileToWorld(tile);
      const width = Math.min(tileSize, contentBounds.x + contentBounds.width - world.x);
      const height = Math.min(tileSize, contentBounds.y + contentBounds.height - world.y);
      const id = `tile-${tile.x}-${tile.y}`;

      return {
        id,
        x: world.x,
        y: world.y,
        width: Math.max(1, Math.ceil(width)),
        height: Math.max(1, Math.ceil(height)),
        pixelRatio,
        path: toPosixPath(outputDir, tileDirectory, `${id}.${format}`),
        format,
        revision,
      };
    })
    .filter((tile) => tile.width > 0 && tile.height > 0)
    .sort((left, right) => (left.y - right.y) || (left.x - right.x));
}

export function createDesignSnapshotManifest(
  ir: FlatIRLike,
  options: SnapshotManifestOptions = {}
): DesignSnapshotManifest {
  const format = options.format ?? 'png';
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const fullImageName = options.fullImageName ?? DEFAULT_FULL_IMAGE_NAME;
  const contentBounds = calculateSnapshotContentBounds(ir);
  const viewport = calculateSnapshotViewport(ir, options);
  const backgroundColor = resolveSnapshotBackground(ir, options.backgroundColor);
  const pixelRatio = Math.max(1, options.pixelRatio ?? DEFAULT_PIXEL_RATIO);
  const revision = createSnapshotRevision(ir, {
    contentBounds,
    viewport,
    backgroundColor,
  });

  const fullWidth = Math.max(viewport.width, Math.ceil(contentBounds.x + contentBounds.width));
  const fullHeight = Math.max(viewport.height, Math.ceil(contentBounds.y + contentBounds.height));

  return {
    schemaVersion: '1.0',
    revision,
    hash: revision,
    viewport,
    background: {
      color: backgroundColor,
    },
    contentBounds,
    fullImage: {
      path: toPosixPath(outputDir, `${fullImageName}.${format}`),
      format,
      width: Math.max(1, fullWidth),
      height: Math.max(1, fullHeight),
      pixelRatio,
      revision,
    },
    tiles: createSnapshotTileDescriptors(contentBounds, revision, options),
    fonts: collectSnapshotFonts(ir, options.fontStatuses),
    assets: collectSnapshotAssets(ir, options.assetStatuses),
  };
}
