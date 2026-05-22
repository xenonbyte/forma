import { readFile } from "node:fs/promises";
import { FormaError } from "./errors.js";
import { parsePenDocument, walkPenNodes, type PenDocument, type PenNode } from "./pen-model.js";
import { validateSemanticScope, type AllowedSemanticSurface, type SemanticScopeViolation } from "./semantic-scope.js";

export type DesignHardCheckCode =
  | "PENCIL_SCHEMA_INVALID"
  | "PENCIL_COLOR_INVALID"
  | "PENCIL_PROPERTY_INVALID"
  | "DESIGN_LAYOUT_INVALID"
  | "DESIGN_SCOPE_VIOLATION"
  | "PREVIEW_EXPORT_FAILED";

export interface DesignQualityIssue {
  code: DesignHardCheckCode;
  node_id?: string;
  path?: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface LayoutSnapshotDetails {
  scanned_node_count: number;
  expanded_parent_count: number;
  truncated_parent_count: number;
  elapsed_ms: number;
  limits: {
    timeout_ms: 120_000;
    max_expanded_parent_nodes: 500;
    max_layout_nodes: 5000;
  };
  limit_hit?: "timeout" | "expanded_parent_nodes" | "layout_nodes" | "incomplete_scan";
}

export interface DesignQualityReport {
  status: "passed" | "warning" | "blocked";
  hard_checks: {
    issues: DesignQualityIssue[];
    layout_snapshot_details?: LayoutSnapshotDetails;
  };
  warnings: string[];
  ai_visual_review?: {
    status: "warning" | "skipped";
    reason?: "model_has_no_vision" | "screenshot_failed" | "timeout" | "not_requested";
    metadata?: Record<string, unknown>;
  };
}

export interface LayoutSnapshotNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: LayoutSnapshotNode[];
  truncated?: boolean;
  omittedDescendants?: boolean;
  metadata?: Record<string, unknown>;
  clip?: boolean;
  rotation?: number;
  textGrowth?: "fixed" | "auto_width" | "auto_height" | "auto";
  text?: string;
}

export interface SessionDesignContextAdapter {
  sessionGetEditorState(bindingId: string, args: { include_schema: true }, expectedStagingPath?: string): Promise<unknown>;
  sessionGetGuidelines(bindingId: string, args: { category: string; name: string }, expectedStagingPath?: string): Promise<unknown>;
  sessionGetVariables(bindingId: string, expectedStagingPath?: string): Promise<unknown>;
}

const colorKeys = new Set(["fill", "strokeFill", "stroke_fill", "effectColor", "effect_color", "textColor", "text_color", "iconColor", "icon_color", "color"]);
const scalarPropertyKeys = new Set(["letterSpacing", "letter_spacing", "padding", "gap", "cornerRadius", "corner_radius"]);
const allowedSkippedReasons = new Set(["model_has_no_vision", "screenshot_failed", "timeout"]);

export async function runDesignQualityPipeline(input: {
  pen_file?: string;
  document?: PenDocument;
  semantic_scope?: AllowedSemanticSurface;
  layout_snapshot?: LayoutSnapshotNode;
  preview_export?: { status: "passed" } | { status: "failed"; reason: string };
  ai_visual_review?: DesignQualityReport["ai_visual_review"];
}): Promise<DesignQualityReport> {
  const issues: DesignQualityIssue[] = [];
  let document: PenDocument | undefined = input.document;
  if (!document) {
    try {
      if (!input.pen_file) {
        throw new Error("pen_file is required");
      }
      document = parsePenDocument(await readFile(input.pen_file, "utf8"));
    } catch (error) {
      issues.push({ code: "PENCIL_SCHEMA_INVALID", message: errorMessage(error) });
    }
  }

  if (document) {
    issues.push(...validateColorFormats(document));
    issues.push(...validatePropertyCompatibility(document));
    if (input.semantic_scope) {
      const semantic = validateSemanticScope({ document, scope: input.semantic_scope });
      if (semantic.status === "blocked") {
        issues.push(...semantic.violations.map((violation) => semanticViolationIssue(violation)));
      }
    }
  }

  const layout = input.layout_snapshot ? validateLayoutSnapshot(input.layout_snapshot) : undefined;
  if (layout?.issue) {
    issues.push(layout.issue);
  }
  if (input.preview_export?.status === "failed") {
    issues.push({ code: "PREVIEW_EXPORT_FAILED", message: input.preview_export.reason });
  }

  const warnings: string[] = [];
  if (issues.length === 0 && input.ai_visual_review?.status === "warning") {
    warnings.push("AI_VISUAL_REVIEW_WARNING");
  } else if (issues.length === 0 && input.ai_visual_review?.status === "skipped" && input.ai_visual_review.reason && allowedSkippedReasons.has(input.ai_visual_review.reason)) {
    warnings.push("AI_VISUAL_REVIEW_SKIPPED");
  }

  return {
    status: issues.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "passed",
    hard_checks: {
      issues,
      ...(layout ? { layout_snapshot_details: layout.details } : {})
    },
    warnings,
    ...(input.ai_visual_review ? { ai_visual_review: input.ai_visual_review } : {})
  };
}

export async function loadRequiredPencilDesignContext(input: {
  adapter: SessionDesignContextAdapter;
  binding_id: string;
  expected_staging_path?: string;
  platform: string;
  table_heavy?: boolean;
}): Promise<{
  editor_state: unknown;
  guidelines: unknown[];
  variables: unknown;
}> {
  const missing: string[] = [];
  const guidelines = [];
  let editor_state: unknown;
  let variables: unknown;
  try {
    editor_state = await input.adapter.sessionGetEditorState(input.binding_id, { include_schema: true }, input.expected_staging_path);
  } catch {
    missing.push("editor_state_schema");
  }
  for (const name of ["Design System", input.platform, ...(input.table_heavy ? ["Table"] : [])]) {
    try {
      guidelines.push(await input.adapter.sessionGetGuidelines(input.binding_id, { category: "guide", name }, input.expected_staging_path));
    } catch {
      missing.push(name);
    }
  }
  try {
    variables = await input.adapter.sessionGetVariables(input.binding_id, input.expected_staging_path);
  } catch {
    missing.push("variables");
  }
  if (missing.length > 0) {
    throw new FormaError("PENCIL_CAPABILITY_UNAVAILABLE", "Required Pencil design context is unavailable", {
      failed_phase: "guideline_load",
      missing_guidelines: missing
    });
  }
  return { editor_state, guidelines, variables };
}

export function assertDesignQualityPassed(report: DesignQualityReport): void {
  if (report.status === "blocked") {
    const first = report.hard_checks.issues[0];
    throw new FormaError(first?.code ?? "INVALID_INPUT", first?.message ?? "Design quality blocked", first?.details ?? {});
  }
}

export function validateColorFormats(document: PenDocument): DesignQualityIssue[] {
  const issues: DesignQualityIssue[] = [];
  for (const node of walkPenNodes(document.children)) {
    scanRecord(node, (path, key, value) => {
      if (!colorKeys.has(key)) {
        return;
      }
      for (const color of collectColorValues(value)) {
        if (!isAllowedColor(color)) {
          issues.push({ code: "PENCIL_COLOR_INVALID", node_id: node.id, path, message: `Invalid Pencil color: ${color}` });
        }
      }
    });
  }
  return issues;
}

export function validatePropertyCompatibility(document: PenDocument): DesignQualityIssue[] {
  const issues: DesignQualityIssue[] = [];
  for (const node of walkPenNodes(document.children)) {
    scanRecord(node, (path, key, value) => {
      if (scalarPropertyKeys.has(key) && Array.isArray(value)) {
        issues.push({ code: "PENCIL_PROPERTY_INVALID", node_id: node.id, path, message: `${key} does not accept array values` });
      }
    });
  }
  return issues;
}

export function validateLayoutSnapshot(root: LayoutSnapshotNode, time: number | { started_at_ms?: number; now_ms?: number } = Date.now()): {
  details: LayoutSnapshotDetails;
  issue?: DesignQualityIssue;
} {
  const started = typeof time === "number" ? time : time.started_at_ms ?? Date.now();
  const now = () => typeof time === "number" ? Date.now() : time.now_ms ?? Date.now();
  const queue: Array<{ node: LayoutSnapshotNode; clipRect?: Rect }> = [{ node: root }];
  let scanned = 0;
  let expanded = 0;
  let truncated = 0;
  let issue: DesignQualityIssue | undefined;
  while (queue.length > 0) {
    const { node, clipRect } = queue.shift()!;
    scanned += 1;
    if (node.truncated || node.omittedDescendants) {
      truncated += 1;
    }
    if (!isFiniteBox(node)) {
      issue = issue ?? { code: "DESIGN_LAYOUT_INVALID", node_id: node.id, message: "Layout node has unsupported critical geometry" };
      continue;
    }
    const rect = nodeRect(node);
    if (node.width !== undefined && node.height !== undefined && (node.width <= 0 || node.height <= 0)) {
      issue = issue ?? { code: "DESIGN_LAYOUT_INVALID", node_id: node.id, message: "Layout node has critical visible area under 95%" };
    }
    if (clipRect) {
      const ratio = rectArea(intersection(rect, clipRect)) / Math.max(1, rectArea(rect));
      if (!isDecorativeNode(node) && ratio < 0.95) {
        issue = issue ?? { code: "DESIGN_LAYOUT_INVALID", node_id: node.id, message: "Layout node has critical visible area under 95%", details: { visible_area_ratio: ratio } };
      }
    }
    if (isFixedSizeTextOverflowUncertain(node)) {
      issue = issue ?? { code: "DESIGN_LAYOUT_INVALID", node_id: node.id, message: "Fixed-size text overflow cannot be proven safe" };
    }
    const children = node.children ?? [];
    if (children.length > 0) {
      expanded += 1;
      issue = issue ?? validateSiblingLayout(children);
      const nextClip = node.clip === true ? intersectOptional(clipRect, rect) : clipRect;
      queue.push(...children.map((child) => ({ node: child, clipRect: nextClip })));
    }
    if (scanned > 5000) {
      issue = issue ?? { code: "DESIGN_LAYOUT_INVALID", message: "Layout node limit exceeded", details: { limit_hit: "layout_nodes" } };
      break;
    }
    if (expanded > 500) {
      issue = issue ?? { code: "DESIGN_LAYOUT_INVALID", message: "Expanded parent limit exceeded", details: { limit_hit: "expanded_parent_nodes" } };
      break;
    }
    if (now() - started > 120_000) {
      issue = issue ?? { code: "DESIGN_LAYOUT_INVALID", message: "Layout snapshot timed out", details: { limit_hit: "timeout" } };
      break;
    }
  }
  if (truncated > 0) {
    issue = issue ?? { code: "DESIGN_LAYOUT_INVALID", message: "Layout snapshot scan is incomplete", details: { limit_hit: "incomplete_scan" } };
  }
  return {
    details: {
      scanned_node_count: scanned,
      expanded_parent_count: expanded,
      truncated_parent_count: truncated,
      elapsed_ms: Math.max(0, now() - started),
      limits: {
        timeout_ms: 120_000,
        max_expanded_parent_nodes: 500,
        max_layout_nodes: 5000
      },
      ...(issue?.details?.limit_hit ? { limit_hit: issue.details.limit_hit as LayoutSnapshotDetails["limit_hit"] } : {})
    },
    ...(issue ? { issue } : {})
  };
}

export function planColorRepairOperations(document: PenDocument): Array<{ tool: "batch_design"; args: Record<string, unknown>; target_node_ids: string[]; intent: "quality_repair" }> {
  const operations = [];
  for (const node of walkPenNodes(document.children)) {
    const repairs: Record<string, string> = {};
    scanRecord(node, (path, key, value) => {
      if (!colorKeys.has(key) || typeof value !== "string") {
        return;
      }
      const converted = convertCssRgbColor(value);
      if (converted) {
        repairs[path] = converted;
      }
    });
    if (Object.keys(repairs).length > 0) {
      operations.push({
        tool: "batch_design" as const,
        args: { node_id: node.id, set: repairs },
        target_node_ids: [node.id],
        intent: "quality_repair" as const
      });
    }
  }
  return operations;
}

function semanticViolationIssue(violation: SemanticScopeViolation): DesignQualityIssue {
  return {
    code: "DESIGN_SCOPE_VIOLATION",
    node_id: violation.node_id,
    message: violation.code,
    details: { violation }
  };
}

function scanRecord(value: unknown, visit: (path: string, key: string, value: unknown) => void, path = ""): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanRecord(item, visit, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    visit(childPath, key, child);
    scanRecord(child, visit, childPath);
  }
}

function collectColorValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectColorValues);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(collectColorValues);
  }
  return [];
}

function isAllowedColor(value: string): boolean {
  return /^\$--[A-Za-z0-9_-]+$/.test(value) || /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value);
}

function convertCssRgbColor(value: string): string | undefined {
  const match = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const parts = match[1]!.split(",").map((part) => part.trim());
  if (parts.length !== 3 && parts.length !== 4) {
    return undefined;
  }
  const [r, g, b] = parts.slice(0, 3).map((part) => Number(part));
  if (![r, g, b].every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return undefined;
  }
  const alpha = parts[3] === undefined ? undefined : Math.round(Number(parts[3]) * 255);
  if (alpha !== undefined && (!Number.isInteger(alpha) || alpha < 0 || alpha > 255)) {
    return undefined;
  }
  return `#${hex(r)}${hex(g)}${hex(b)}${alpha === undefined ? "" : hex(alpha)}`;
}

function isFiniteBox(node: LayoutSnapshotNode): boolean {
  return [node.x, node.y, node.width, node.height].every((value) => typeof value === "number" && Number.isFinite(value));
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function validateSiblingLayout(children: LayoutSnapshotNode[]): DesignQualityIssue | undefined {
  for (let leftIndex = 0; leftIndex < children.length; leftIndex += 1) {
    const left = children[leftIndex]!;
    if (!isFiniteBox(left)) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < children.length; rightIndex += 1) {
      const right = children[rightIndex]!;
      if (!isFiniteBox(right)) continue;
      const overlap = intersection(nodeRect(left), nodeRect(right));
      const overlapArea = rectArea(overlap);
      if (overlapArea <= 0) continue;
      const leftDecorative = isDecorativeNode(left);
      const rightDecorative = isDecorativeNode(right);
      if (!leftDecorative && !rightDecorative) {
        const smallerArea = Math.max(1, Math.min(rectArea(nodeRect(left)), rectArea(nodeRect(right))));
        const ratio = overlapArea / smallerArea;
        if (ratio > 0.25) {
          return {
            code: "DESIGN_LAYOUT_INVALID",
            node_id: `${left.id},${right.id}`,
            message: "Critical layout nodes overlap",
            details: { overlap_area: overlapArea, overlap_ratio: ratio }
          };
        }
        continue;
      }
      const decorative = leftDecorative ? left : right;
      const ratio = overlapArea / Math.max(1, rectArea(nodeRect(decorative)));
      if (ratio > 0.1) {
        return {
          code: "DESIGN_LAYOUT_INVALID",
          node_id: decorative.id,
          message: "Decorative layout overlap exceeds 10%",
          details: { overlap_ratio: ratio }
        };
      }
      if (!isSafeDecorativeCoverage(decorative)) {
        return {
          code: "DESIGN_LAYOUT_INVALID",
          node_id: decorative.id,
          message: "Decorative overlap cannot be proven safe",
          details: { overlap_ratio: ratio }
        };
      }
    }
  }
  return undefined;
}

function nodeRect(node: LayoutSnapshotNode): Rect {
  return {
    x: node.x!,
    y: node.y!,
    width: node.width!,
    height: node.height!
  };
}

function intersection(left: Rect, right: Rect): Rect {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

function intersectOptional(left: Rect | undefined, right: Rect): Rect {
  return left ? intersection(left, right) : right;
}

function rectArea(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function isDecorativeNode(node: LayoutSnapshotNode): boolean {
  return node.metadata?.decorative === true || node.metadata?.semantic === "decorative";
}

function isSafeDecorativeCoverage(node: LayoutSnapshotNode): boolean {
  return node.metadata?.safe_overlap === true || node.metadata?.safe_coverage === true;
}

function isFixedSizeTextOverflowUncertain(node: LayoutSnapshotNode): boolean {
  if (typeof node.text !== "string" || node.text.length === 0) {
    return false;
  }
  if (node.textGrowth !== "fixed") {
    return false;
  }
  if (typeof node.width !== "number" || typeof node.height !== "number") {
    return true;
  }
  const approximateCapacity = Math.max(1, Math.floor(node.width / 7) * Math.max(1, Math.floor(node.height / 14)));
  return node.text.length > approximateCapacity;
}

function hex(value: number): string {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
