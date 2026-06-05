import type { Annotation, VZIContent } from "@vzi-core/format";
import type { IRBounds, IRElement, IRStyles, IntermediateRepresentation } from "@vzi-core/types";

export type OutputFormat = "json" | "markdown";

export interface McpSourceSummary {
  tagName?: string;
  className?: string;
  id?: string;
  role?: string;
  name?: string;
  href?: string;
  rawHref?: string;
  src?: string;
  alt?: string;
  target?: string;
  rel?: string;
  landmark?: "header" | "main" | "footer" | "navigation" | "section" | "aside" | "none";
  componentRole?: "primary-cta" | "secondary-cta" | "nav-link" | "body-text" | "media" | "container" | "other";
  intent?: "navigate" | "submit" | "open" | "download" | "none";
  actionType?: "link" | "button" | "none";
  targetRoute?: string;
  importance?: "high" | "medium" | "low";
  assetId?: string;
  stateClasses?: {
    hover?: string[];
    focus?: string[];
    active?: string[];
  };
}

export interface McpElementNode {
  id: string;
  stableId?: string;
  type: string;
  parentId: string | null;
  bounds: IRBounds;
  css: string;
  styles: IRStyles;
  textContent?: string;
  children?: string[];
  path?: string[];
  depth?: number;
  order?: number;
  source?: McpSourceSummary;
}

export interface McpDesignTokens {
  colors: Array<{
    name: string;
    value: string;
    category:
      | "primary"
      | "secondary"
      | "accent"
      | "background"
      | "text"
      | "border"
      | "danger"
      | "success"
      | "warning"
      | "other";
    frequency: number;
  }>;
  fonts: Array<{
    fontFamily: string;
    fontSize?: number;
    fontWeight?: number;
    lineHeight?: number;
    letterSpacing?: number;
    frequency: number;
  }>;
  spacing: Array<{
    value: string;
    frequency: number;
  }>;
  radii?: Array<{
    value: string;
    frequency: number;
  }>;
  shadows?: Array<{
    value: string;
    frequency: number;
  }>;
  gradients?: Array<{
    value: string;
    frequency: number;
  }>;
  elementCount?: number;
}

export interface McpStyleAnnotation {
  elementId: string;
  margin?: string;
  padding?: string;
  gap?: string;
  rowGap?: string;
  columnGap?: string;
}

export interface McpOverview {
  title: string;
  canvasSize: {
    width: number;
    height: number;
  };
  elementCount: number;
  complexity: "simple" | "medium" | "complex";
  version: string;
  createdAt: string;
  hasErrors: boolean;
  errorCount: number;
}

export interface McpElementList {
  elements: Array<{
    id: string;
    stableId?: string;
    type: string;
    bounds: IRBounds;
    css: string;
    textContent?: string;
    path?: string[];
    depth?: number;
    order?: number;
    source?: McpSourceSummary;
  }>;
  total: number;
  filteredBy?: string;
}

export interface McpElementDetail {
  id: string;
  stableId?: string;
  type: string;
  bounds: IRBounds;
  css: string;
  styles: IRStyles;
  textContent?: string;
  parentId: string | null;
  children: string[];
  path?: string[];
  depth?: number;
  order?: number;
  source?: McpSourceSummary;
}

export interface McpSearchResult {
  query: string;
  type?: string | null;
  elements: Array<{
    id: string;
    stableId?: string;
    type: string;
    bounds: IRBounds;
    textContent?: string;
    css: string;
    path?: string[];
    depth?: number;
    order?: number;
    source?: McpSourceSummary;
  }>;
  total: number;
}

export interface McpTokensOutput {
  colors?: McpDesignTokens["colors"];
  fonts?: McpDesignTokens["fonts"];
  spacing?: McpDesignTokens["spacing"];
  radii?: McpDesignTokens["radii"];
  shadows?: McpDesignTokens["shadows"];
  gradients?: McpDesignTokens["gradients"];
  elementCount: number;
}

export interface McpAnnotationsOutput {
  annotations: Annotation[];
  styleHints: McpStyleAnnotation[];
  spacingSummary?: {
    marginCount: number;
    paddingCount: number;
    gapCount: number;
    rowGapCount: number;
    columnGapCount: number;
  };
  elementId?: string | null;
  total: number;
}

export interface McpUiHints {
  order: string[];
  childrenByParent: Record<string, string[]>;
  depthById: Record<string, number>;
  pathById: Record<string, string[]>;
  stableIdById?: Record<string, string>;
}

export interface McpAsset {
  id: string;
  type: "image" | "icon" | "other";
  mimeType?: string;
  source: "url" | "data-url" | "inline" | "unknown";
  uri: string;
  rawUri?: string;
  normalizedUri?: string;
  width?: number;
  height?: number;
  extension?: string;
  references: string[];
}

export interface McpResponsiveSnapshot {
  id: string;
  label: "desktop" | "tablet" | "mobile" | "custom";
  viewportWidth: number;
  viewportHeight: number;
  derivedFrom?: "source-viewport" | "breakpoint-class" | "heuristic";
  breakpoint?: "sm" | "md" | "lg" | "xl" | "2xl";
}

export interface McpQualityMetrics {
  annotation: {
    total: number;
    zeroPositionCount: number;
    zeroPositionRatio: number;
  };
  tokens: {
    colorCategoryDiversity: number;
    spacingTokenCount: number;
    fontTokenCount: number;
    radiusTokenCount: number;
    shadowTokenCount: number;
    gradientTokenCount: number;
  };
  textCoverage: {
    sourceCount: number;
    extractedCount: number;
    recall: number;
  };
}

export interface McpExtractData {
  metadata: VZIContent["metadata"];
  ir: IntermediateRepresentation;
  tokens: {
    colors: McpDesignTokens["colors"];
    fonts: McpDesignTokens["fonts"];
    spacing: McpDesignTokens["spacing"];
    radii?: McpDesignTokens["radii"];
    shadows?: McpDesignTokens["shadows"];
    gradients?: McpDesignTokens["gradients"];
  };
  annotations: McpAnnotationsOutput;
  source?: {
    type: "file" | "url" | "figma";
    identifier: string;
    capturedAt: number;
  };
  uiHints: McpUiHints;
  assets?: McpAsset[];
  responsive?: {
    snapshots: McpResponsiveSnapshot[];
  };
  quality: McpQualityMetrics;
}

export interface McpExtractPayload {
  version: string;
  type: "html-extract" | "vzi-extract" | "figma-extract";
  data: McpExtractData;
  metadata: {
    extractedAt: string;
    sourceType: "html" | "vzi" | "figma";
  };
}

export interface McpQueryOptions {
  format: OutputFormat;
  depth?: number;
  typeFilter?: string;
  includeCss?: boolean;
}

export interface GlobalVarsExtraction {
  cssVariables: string;
  tokens: McpDesignTokens;
}

export type McpQueryResult =
  | McpOverview
  | McpElementList
  | McpElementDetail
  | McpSearchResult
  | McpTokensOutput
  | McpAnnotationsOutput
  | McpElementNode;

export type McpElementEntries = [string, IRElement][];
