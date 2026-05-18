import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyStyle,
  describeStyle,
  extractVariablesFromDesignMd,
  scanStyleDirectories,
  sha256Hex,
  syncStatusSchema
} from "../src/sync.js";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "forma-sync-test-"));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("style sync pure helpers", () => {
  it("scans only first-level style directories with DESIGN.md", async () => {
    const root = await tempDir();
    await mkdir(join(root, "linear"), { recursive: true });
    await mkdir(join(root, "_template"), { recursive: true });
    await mkdir(join(root, ".hidden"), { recursive: true });
    await mkdir(join(root, "nested", "deep"), { recursive: true });
    await writeFile(join(root, "linear", "DESIGN.md"), "# Linear\n");
    await writeFile(join(root, "_template", "DESIGN.md"), "# Template\n");
    await writeFile(join(root, ".hidden", "DESIGN.md"), "# Hidden\n");
    await writeFile(join(root, "nested", "deep", "DESIGN.md"), "# Deep\n");

    await expect(scanStyleDirectories(root)).resolves.toEqual([{ name: "linear", designMdPath: join(root, "linear", "DESIGN.md") }]);
  });

  it("extracts variables and fills deterministic defaults", () => {
    expect(
      extractVariablesFromDesignMd(`
# Demo
primary: #5E6AD2
background: #FAFAFA
foreground: #111827
heading font: Inter
body font: Source Sans
corner radius: 12
base spacing: 10
`)
    ).toEqual({
      primary: "#5E6AD2",
      background: "#FAFAFA",
      "text-primary": "#111827",
      "font-heading": "Inter",
      "font-body": "Source Sans",
      "border-radius": "12",
      "spacing-unit": "10"
    });

    expect(extractVariablesFromDesignMd("# Sparse")).toEqual({
      primary: "#3b82f6",
      background: "#FFFFFF",
      "text-primary": "#111827",
      "font-heading": "Inter",
      "font-body": "Inter",
      "border-radius": "8",
      "spacing-unit": "8"
    });
  });

  it("extracts variables from DESIGN.md front matter tokens", () => {
    expect(
      extractVariablesFromDesignMd(`---
colors:
  primary: "#0066cc"
  canvas: "#ffffff"
  ink: "#1d1d1f"
typography:
  hero-display:
    fontFamily: "SF Pro Display, system-ui, sans-serif"
  body:
    fontFamily: "SF Pro Text, system-ui, sans-serif"
rounded:
  md: 11px
spacing:
  xs: 8px
---
# Demo
`)
    ).toEqual({
      primary: "#0066cc",
      background: "#ffffff",
      "text-primary": "#1d1d1f",
      "font-heading": "SF Pro Display",
      "font-body": "SF Pro Text",
      "border-radius": "11",
      "spacing-unit": "8"
    });
  });

  it("classifies and describes style documents", () => {
    expect(classifyStyle("An AI assistant for LLM chat")).toBe("AI 产品");
    expect(classifyStyle("Project task productivity tool")).toBe("工具类");
    expect(classifyStyle("Retail store checkout")).toBe("电商");
    expect(classifyStyle("Finance bank payment dashboard")).toBe("金融");
    expect(classifyStyle("Social community message feed")).toBe("社交");
    expect(classifyStyle("Health medical fitness tracker")).toBe("健康");
    expect(classifyStyle("Plain editorial layout")).toBe("其他");
    expect(describeStyle("# Title\n\nA focused product interface with dense controls.\nSecond line")).toBe(
      "A focused product interface with dense controls."
    );
    expect(describeStyle("# Title\n\n123456789012345678901234567890123456789012345678901234567890")).toBe(
      "12345678901234567890123456789012345678901234567890"
    );
    expect(
      describeStyle(`---
description: "A photography-first interface with immersive gallery controls and editorial spacing."
colors:
  primary: "#0066cc"
---
# Title

Body copy should not win over front matter description.`)
    ).toBe("A photography-first interface with immersive galle");
    expect(
      describeStyle(`---
colors:
  primary: "#0066cc"
---
# Title

Body copy should be used after front matter.`)
    ).toBe("Body copy should be used after front matter.");
    expect(
      describeStyle(`---
colors:
  primary: "#0066cc"
---
# Title`)
    ).toBe("Style generated from DESIGN.md");
    expect(describeStyle("# Title")).toBe("Style generated from DESIGN.md");
  });

  it("computes stable sha256 and validates status shapes", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(syncStatusSchema.parse({ status: "idle" })).toEqual({ status: "idle" });
    expect(
      syncStatusSchema.parse({
        status: "idle",
        last_sync: {
          completed_at: "2026-05-18T00:00:00.000Z",
          styles_total: 3,
          styles_updated: 2,
          styles_added: 1,
          styles_failed: 0,
          duration_ms: 1250
        }
      })
    ).toEqual({
      status: "idle",
      last_sync: {
        completed_at: "2026-05-18T00:00:00.000Z",
        styles_total: 3,
        styles_updated: 2,
        styles_added: 1,
        styles_failed: 0,
        duration_ms: 1250
      }
    });
    expect(
      syncStatusSchema.parse({
        status: "running",
        task_id: "sync-1",
        started_at: "2026-05-18T00:00:00.000Z",
        progress: {
          phase: "extracting_variables",
          current: 1,
          total: 3,
          current_style: "linear"
        }
      })
    ).toEqual({
      status: "running",
      task_id: "sync-1",
      started_at: "2026-05-18T00:00:00.000Z",
      progress: {
        phase: "extracting_variables",
        current: 1,
        total: 3,
        current_style: "linear"
      }
    });
    expect(
      syncStatusSchema.parse({
        status: "failed",
        task_id: "sync-1",
        error: {
          phase: "git_clone",
          message: "git not found"
        }
      })
    ).toEqual({
      status: "failed",
      task_id: "sync-1",
      error: {
        phase: "git_clone",
        message: "git not found"
      }
    });
  });
});
