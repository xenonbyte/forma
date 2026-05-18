import { createHash } from "node:crypto";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { PencilRunner } from "./pencil.js";
import { styleVariablesSchema, type StyleVariables } from "./styles.js";

export type CommandRunner = PencilRunner;

export const syncPhases = ["git_clone", "scanning", "extracting_variables", "rendering_previews", "updating_index", "cleanup"] as const;
export type SyncPhase = (typeof syncPhases)[number];

export const syncStatusSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("idle"),
    last_sync: z
      .object({
        completed_at: z.string(),
        styles_total: z.number().int().nonnegative(),
        styles_updated: z.number().int().nonnegative(),
        styles_added: z.number().int().nonnegative(),
        styles_failed: z.number().int().nonnegative(),
        duration_ms: z.number().int().nonnegative()
      })
      .optional()
  }),
  z.object({
    status: z.literal("running"),
    task_id: z.string().min(1),
    started_at: z.string(),
    progress: z.object({
      phase: z.enum(syncPhases),
      current: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      current_style: z.string().optional()
    })
  }),
  z.object({
    status: z.literal("failed"),
    task_id: z.string().min(1).optional(),
    error: z.object({
      phase: z.enum(syncPhases),
      message: z.string()
    })
  })
]);

export const syncPhaseSchema = z.enum(syncPhases);
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export interface ScannedStyleDirectory {
  name: string;
  designMdPath: string;
}

const defaultStyleVariables: StyleVariables = {
  primary: "#3b82f6",
  background: "#FFFFFF",
  "text-primary": "#111827",
  "font-heading": "Inter",
  "font-body": "Inter",
  "border-radius": "8",
  "spacing-unit": "8"
};

const variableKeyMap: Record<string, keyof StyleVariables> = {
  primary: "primary",
  background: "background",
  canvas: "background",
  foreground: "text-primary",
  ink: "text-primary",
  "text primary": "text-primary",
  "heading font": "font-heading",
  "body font": "font-body",
  "corner radius": "border-radius",
  "base spacing": "spacing-unit",
  md: "border-radius",
  xs: "spacing-unit"
};

type Classification = "AI 产品" | "工具类" | "电商" | "金融" | "社交" | "健康" | "其他";

export async function scanStyleDirectories(root: string): Promise<ScannedStyleDirectory[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_"))
    .sort((a, b) => a.name.localeCompare(b.name));

  const styles: ScannedStyleDirectory[] = [];
  for (const directory of directories) {
    const designMdPath = join(root, directory.name, "DESIGN.md");
    if (await fileExists(designMdPath)) {
      styles.push({ name: directory.name, designMdPath });
    }
  }

  return styles;
}

export function extractVariablesFromDesignMd(markdown: string): StyleVariables {
  const variables: StyleVariables = { ...defaultStyleVariables };
  const context: string[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*---\s*$/.test(line)) {
      context.length = 0;
      continue;
    }

    const match = /^(\s*)([A-Za-z][A-Za-z -]*):\s*(.*?)\s*$/.exec(line);
    if (!match) {
      continue;
    }

    const indent = match[1].length;
    const key = match[2].trim().toLowerCase();
    const rawValue = match[3].trim();
    const level = indent / 2;
    const parent = level > 0 ? context[level - 1] : undefined;
    context[level] = key;
    context.length = level + 1;

    if (!rawValue) {
      continue;
    }

    const variableKey = variableKeyForParsedLine(parent, key);
    if (variableKey) {
      variables[variableKey] = normalizeVariableValue(rawValue, variableKey);
    }
  }

  return styleVariablesSchema.parse(variables);
}

export function classifyStyle(markdown: string): Classification {
  const text = markdown.toLowerCase();
  if (/\b(ai|llm|chat|assistant)\b/.test(text)) {
    return "AI 产品";
  }
  if (/\b(tool|productivity|project|task)\b/.test(text)) {
    return "工具类";
  }
  if (/\b(shop|commerce|retail|store|checkout|ecommerce)\b/.test(text)) {
    return "电商";
  }
  if (/\b(finance|bank|payment|trading)\b/.test(text)) {
    return "金融";
  }
  if (/\b(social|community|message)\b/.test(text)) {
    return "社交";
  }
  if (/\b(health|medical|fitness)\b/.test(text)) {
    return "健康";
  }
  return "其他";
}

export function describeStyle(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let bodyStart = 0;

  if (lines[0]?.trim() === "---") {
    for (let index = 1; index < lines.length; index += 1) {
      const trimmed = lines[index].trim();
      if (trimmed === "---") {
        bodyStart = index + 1;
        break;
      }

      const description = /^description:\s*(.+?)\s*$/.exec(trimmed);
      if (description) {
        return normalizeDescription(description[1]).slice(0, 50);
      }
    }
  }

  for (const line of lines.slice(bodyStart)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      return trimmed.slice(0, 50);
    }
  }

  return "Style generated from DESIGN.md";
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function variableKeyForParsedLine(parent: string | undefined, key: string): keyof StyleVariables | undefined {
  if (parent === "colors") {
    return variableKeyMap[key];
  }
  if (parent === "rounded" && key === "md") {
    return "border-radius";
  }
  if (parent === "spacing" && key === "xs") {
    return "spacing-unit";
  }
  if (!parent) {
    return variableKeyMap[key];
  }
  if (key === "fontfamily" && parent === "hero-display") {
    return "font-heading";
  }
  if (key === "fontfamily" && parent === "body") {
    return "font-body";
  }
  return undefined;
}

function normalizeVariableValue(value: string, variableKey: keyof StyleVariables): string {
  const unquoted = value.replace(/^["']|["']$/g, "").trim();
  if (variableKey === "border-radius" || variableKey === "spacing-unit") {
    return unquoted.replace(/px$/i, "").trim();
  }
  if (variableKey === "font-heading" || variableKey === "font-body") {
    return unquoted.split(",")[0].trim();
  }
  return unquoted;
}

function normalizeDescription(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}
