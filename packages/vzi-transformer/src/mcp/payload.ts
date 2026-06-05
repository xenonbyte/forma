import type { Annotation, VZIContent, VersionCompatibility } from "@vzi-core/format";
import type { IRElement, IntermediateRepresentation } from "@vzi-core/types";
import type { TransformResult } from "../transformer";
import { createMcpQuery } from "./query";
import type { McpExtractPayload, McpQualityMetrics, McpQueryOptions, McpResponsiveSnapshot } from "./types";

const DEFAULT_VERSION_COMPATIBILITY: VersionCompatibility = {
  minReaderVersion: "2.0.0",
  formatVersion: "2.0.0",
  features: [],
};

export interface BuildMcpExtractPayloadOptions {
  version?: string;
  type?: McpExtractPayload["type"];
  sourceType?: McpExtractPayload["metadata"]["sourceType"];
  sourceIdentifier?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  query?: Partial<McpQueryOptions>;
  responsiveSnapshots?: McpResponsiveSnapshot[];
}

function isTransformResult(input: TransformResult | VZIContent): input is TransformResult {
  return !!(input as TransformResult).ir && !!(input as TransformResult).tokens;
}

function inferRootElementId(elements: Record<string, IRElement>): string {
  const entries = Object.entries(elements);
  const root = entries.find(([, element]) => element.parentId == null);
  return root?.[0] ?? entries[0]?.[0] ?? "root";
}

function buildIrFromVziContent(content: VZIContent): IntermediateRepresentation {
  const elements = Object.fromEntries(content.elements.entries()) as Record<string, IRElement>;
  return {
    version: "1.0.0",
    rootElementId: inferRootElementId(elements),
    elements,
    metadata: {
      title: content.metadata.name,
      generatedAt: content.metadata.modifiedAt,
      sourceUrl: content.metadata.source?.url,
      viewport: {
        width: content.metadata.viewportWidth,
        height: content.metadata.viewportHeight,
      },
    },
  };
}

function countZeroPosition(annotations: Annotation[]): number {
  return annotations.filter((annotation) => {
    const position = annotation.position;
    return position.x === 0 && position.y === 0 && position.width === 0 && position.height === 0;
  }).length;
}

function buildQualityMetrics(
  ir: IntermediateRepresentation,
  annotations: Annotation[],
  tokens: ReturnType<ReturnType<typeof createMcpQuery>["getTokens"]>,
): McpQualityMetrics {
  const zeroPositionCount = countZeroPosition(annotations);
  const annotationTotal = annotations.length;
  const textElements = Object.values(ir.elements).filter((element) => {
    return typeof element.textContent === "string" && element.textContent.trim().length > 0;
  });

  const sourceCount = textElements.length;
  const extractedCount = textElements.length;
  const recall = sourceCount === 0 ? 1 : extractedCount / sourceCount;

  return {
    annotation: {
      total: annotationTotal,
      zeroPositionCount,
      zeroPositionRatio: annotationTotal === 0 ? 0 : zeroPositionCount / annotationTotal,
    },
    tokens: {
      colorCategoryDiversity: new Set((tokens.colors || []).map((token) => token.category)).size,
      spacingTokenCount: (tokens.spacing || []).length,
      fontTokenCount: (tokens.fonts || []).length,
      radiusTokenCount: (tokens.radii || []).length,
      shadowTokenCount: (tokens.shadows || []).length,
      gradientTokenCount: (tokens.gradients || []).length,
    },
    textCoverage: {
      sourceCount,
      extractedCount,
      recall,
    },
  };
}

function normalizeString(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function hashStable(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

function sanitizeIdentifier(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function isGenericIdentifier(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === "playground-html" ||
    normalized === "unknown-source" ||
    normalized === "source" ||
    normalized === "document"
  );
}

function buildDerivedIdentifier(
  metadata: VZIContent["metadata"],
  metadataSource: VZIContent["metadata"]["source"] | undefined,
): string {
  const preferred = normalizeString(metadataSource?.url) ?? normalizeString(metadataSource?.title);
  if (preferred && !isGenericIdentifier(preferred)) {
    return preferred;
  }

  const title = sanitizeIdentifier(metadata.name || "document");
  const viewport = `${metadata.viewportWidth}x${metadata.viewportHeight}`;
  const fingerprint = hashStable(
    `${metadata.name}|${metadata.createdAt}|${metadata.modifiedAt}|${metadata.viewportWidth}x${metadata.viewportHeight}`,
  ).slice(0, 8);
  return `${title || "document"}-${viewport}-${fingerprint}`;
}

function normalizeIrForMcp(
  ir: IntermediateRepresentation,
  query: ReturnType<typeof createMcpQuery>,
): IntermediateRepresentation {
  const elements: Record<string, IRElement> = {};
  for (const [id, element] of Object.entries(ir.elements)) {
    const detail = query.getElement(id, 0);
    const normalizedStyles = detail?.styles || element.styles;
    const normalizedSource = detail?.source
      ? ({
          ...(element.source || {}),
          ...detail.source,
        } as IRElement["source"])
      : element.source;

    elements[id] = {
      ...element,
      styles: normalizedStyles,
      source: normalizedSource,
      textContent: detail?.textContent ?? element.textContent,
    };
  }

  return {
    ...ir,
    elements,
  };
}

function normalizeExtractSource(
  source: TransformResult["source"] | undefined,
  options: BuildMcpExtractPayloadOptions,
  metadataSource: VZIContent["metadata"]["source"] | undefined,
  metadata: VZIContent["metadata"],
) {
  const fallbackIdentifier =
    normalizeString(source?.identifier) ??
    normalizeString(options.sourceIdentifier) ??
    normalizeString(metadataSource?.url) ??
    normalizeString(metadataSource?.title) ??
    "unknown-source";
  const rawIdentifier = isGenericIdentifier(fallbackIdentifier)
    ? buildDerivedIdentifier(metadata, metadataSource)
    : fallbackIdentifier;
  const sourceTypeHint = options.sourceType || "html";
  let type: "file" | "url" | "figma" = source?.type || (sourceTypeHint === "figma" ? "figma" : "file");

  if (type === "url" && !isHttpUrl(rawIdentifier)) {
    type = sourceTypeHint === "figma" ? "figma" : "file";
  }
  if (type === "file" && isHttpUrl(rawIdentifier)) {
    type = "url";
  }
  if (sourceTypeHint === "figma") {
    type = "figma";
  }

  return {
    type,
    identifier: rawIdentifier,
    capturedAt: source?.capturedAt || Date.now(),
  };
}

function buildMetadataSource(
  metadataSource: VZIContent["metadata"]["source"] | undefined,
  runtimeSource: TransformResult["source"] | undefined,
  options: BuildMcpExtractPayloadOptions,
): VZIContent["metadata"]["source"] | undefined {
  let url = normalizeString(metadataSource?.url) ?? normalizeString(options.sourceUrl);
  let title = normalizeString(metadataSource?.title) ?? normalizeString(options.sourceTitle);
  const sourceIdentifier = normalizeString(runtimeSource?.identifier) ?? normalizeString(options.sourceIdentifier);

  if (!url && !title && sourceIdentifier) {
    if (runtimeSource?.type === "url" && isHttpUrl(sourceIdentifier)) {
      url = sourceIdentifier;
    } else {
      title = sourceIdentifier;
    }
  }

  if (!url && !title) {
    return undefined;
  }

  return {
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
  };
}

function buildMetadataFeatures(
  existingFeatures: string[] | undefined,
  tokens: ReturnType<ReturnType<typeof createMcpQuery>["getTokens"]>,
  annotations: ReturnType<ReturnType<typeof createMcpQuery>["getAnnotations"]>,
  uiHints: ReturnType<ReturnType<typeof createMcpQuery>["getUiHints"]>,
  assetsCount: number,
): string[] {
  const features = new Set(
    (existingFeatures || [])
      .map((feature) => normalizeString(feature))
      .filter((feature): feature is string => Boolean(feature)),
  );

  if ((tokens.colors || []).length > 0) features.add("mcp.tokens.colors");
  if ((tokens.fonts || []).length > 0) features.add("mcp.tokens.fonts");
  if ((tokens.spacing || []).length > 0) features.add("mcp.tokens.spacing");
  if ((tokens.radii || []).length > 0) features.add("mcp.tokens.radii");
  if ((tokens.shadows || []).length > 0) features.add("mcp.tokens.shadows");
  if ((tokens.gradients || []).length > 0) features.add("mcp.tokens.gradients");
  if (annotations.total > 0) features.add("mcp.annotations");
  if (annotations.styleHints.length > 0) features.add("mcp.annotations.styleHints");
  if (annotations.spacingSummary) features.add("mcp.annotations.spacingSummary");
  if (uiHints.order.length > 0) features.add("mcp.uiHints");
  if (uiHints.stableIdById && Object.keys(uiHints.stableIdById).length > 0) features.add("mcp.stableId");
  if (assetsCount > 0) features.add("mcp.assets");
  features.add("mcp.source.semantic");
  features.add("mcp.responsive");
  features.add("mcp.quality");

  return Array.from(features);
}

function inferResponsiveLabel(width: number): McpResponsiveSnapshot["label"] {
  if (width < 768) return "mobile";
  if (width <= 1024) return "tablet";
  return "desktop";
}

function dedupeResponsiveSnapshots(snapshots: McpResponsiveSnapshot[]): McpResponsiveSnapshot[] {
  const deduped = new Map<string, McpResponsiveSnapshot>();
  for (const snapshot of snapshots) {
    if (!Number.isFinite(snapshot.viewportWidth) || snapshot.viewportWidth <= 0) continue;
    if (!Number.isFinite(snapshot.viewportHeight) || snapshot.viewportHeight <= 0) continue;
    const key = `${snapshot.viewportWidth}x${snapshot.viewportHeight}`;
    if (deduped.has(key)) continue;
    deduped.set(key, {
      ...snapshot,
      id: snapshot.id || `viewport-${snapshot.viewportWidth}x${snapshot.viewportHeight}`,
      label: snapshot.label || inferResponsiveLabel(snapshot.viewportWidth),
    });
  }
  return Array.from(deduped.values());
}

export function buildVziContentFromTransformResult(transformResult: TransformResult): VZIContent {
  const elements = new Map<string, IRElement>(Object.entries(transformResult.ir.elements));

  return {
    header: {
      magic: 0x565a6932,
      version: 0x0002,
      fileSize: BigInt(0),
      elementCount: elements.size,
      blockCount: 0,
      metadataOffset: BigInt(0),
      metadataLength: 0,
      blockIndexOffset: BigInt(0),
      blockIndexLength: 0,
      dataOffset: BigInt(0),
      checksum: new Uint8Array(32),
      reserved: new Uint8Array(168),
    },
    metadata: transformResult.metadata,
    elements,
    sharedStyles: new Map(),
    spatialIndex: {
      rootBlockId: "root-block",
      blocks: new Map(),
      maxDepth: 0,
    },
    colorTokens: transformResult.tokens.colors,
    fontTokens: transformResult.tokens.fontSizes,
    annotations: transformResult.annotations,
    images: new Map(),
    layers: [],
    compatibility: DEFAULT_VERSION_COMPATIBILITY,
  };
}

export function buildMcpExtractPayload(
  input: TransformResult | VZIContent,
  options: BuildMcpExtractPayloadOptions = {},
): McpExtractPayload {
  const fromTransformResult = isTransformResult(input);
  const content = fromTransformResult ? buildVziContentFromTransformResult(input) : input;

  const rawIr = fromTransformResult ? input.ir : buildIrFromVziContent(content);

  const query = createMcpQuery(content, {
    includeCss: false,
    format: "json",
    ...options.query,
  });
  const ir = normalizeIrForMcp(rawIr, query);

  const tokens = query.getTokens("all");
  const annotations = query.getAnnotations();
  const uiHints = query.getUiHints();
  const assets = query.getAssets();
  const responsiveSnapshots = dedupeResponsiveSnapshots(
    options.responsiveSnapshots && options.responsiveSnapshots.length > 0
      ? options.responsiveSnapshots
      : query.getResponsiveSnapshots(),
  );
  const quality = buildQualityMetrics(ir, annotations.annotations, tokens);
  const runtimeSource = fromTransformResult ? input.source : undefined;
  const metadataSource = buildMetadataSource(content.metadata.source, runtimeSource, options);
  const source = normalizeExtractSource(runtimeSource, options, metadataSource, content.metadata);
  const { source: removedSource, ...metadataWithoutSource } = content.metadata;
  void removedSource;
  const metadata = {
    ...metadataWithoutSource,
    features: buildMetadataFeatures(metadataWithoutSource.features, tokens, annotations, uiHints, assets.length),
    ...(metadataSource ? { source: metadataSource } : {}),
  };

  return {
    version: options.version || "1.1.0",
    type: options.type || "html-extract",
    data: {
      metadata,
      ir,
      tokens: {
        colors: tokens.colors || [],
        fonts: tokens.fonts || [],
        spacing: tokens.spacing || [],
        radii: tokens.radii || [],
        shadows: tokens.shadows || [],
        gradients: tokens.gradients || [],
      },
      annotations,
      source,
      uiHints,
      assets,
      responsive: {
        snapshots: [...responsiveSnapshots],
      },
      quality,
    },
    metadata: {
      extractedAt: new Date().toISOString(),
      sourceType: options.sourceType || "html",
    },
  };
}
