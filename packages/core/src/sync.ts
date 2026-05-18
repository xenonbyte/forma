import { createHash } from "node:crypto";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { PencilRunner } from "./pencil.js";
import { styleVariablesSchema, type StyleVariables } from "./styles.js";

export type CommandRunner = PencilRunner;

export const syncPhaseSchema = z.enum(["scan", "pull", "write", "index"]);

export const syncStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("idle") }),
  z.object({
    status: z.literal("running"),
    phase: syncPhaseSchema,
    started_at: z.string(),
    message: z.string().optional()
  }),
  z.object({
    status: z.literal("completed"),
    completed_at: z.string(),
    styles_synced: z.number().int().nonnegative()
  }),
  z.object({
    status: z.literal("failed"),
    failed_at: z.string(),
    message: z.string()
  })
]);

export type SyncPhase = z.infer<typeof syncPhaseSchema>;
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
  foreground: "text-primary",
  "text primary": "text-primary",
  "heading font": "font-heading",
  "body font": "font-body",
  "corner radius": "border-radius",
  "base spacing": "spacing-unit"
};

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

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z][A-Za-z -]*):\s*(.+?)\s*$/.exec(line);
    if (!match) {
      continue;
    }

    const variableKey = variableKeyMap[match[1].trim().toLowerCase()];
    if (variableKey) {
      variables[variableKey] = match[2].trim();
    }
  }

  return styleVariablesSchema.parse(variables);
}

export function classifyStyle(markdown: string): "AI 产品" | "电商" | "其他" {
  const text = markdown.toLowerCase();
  if (/\b(ai|llm|chat|assistant)\b/.test(text)) {
    return "AI 产品";
  }
  if (/\b(retail|store|checkout|ecommerce|shop)\b/.test(text)) {
    return "电商";
  }
  return "其他";
}

export function describeStyle(markdown: string): string {
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      return trimmed;
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
