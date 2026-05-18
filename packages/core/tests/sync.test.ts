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

  it("classifies and describes style documents", () => {
    expect(classifyStyle("An AI assistant for LLM chat")).toBe("AI 产品");
    expect(classifyStyle("Retail store checkout")).toBe("电商");
    expect(classifyStyle("Plain editorial layout")).toBe("其他");
    expect(describeStyle("# Title\n\nA focused product interface with dense controls.\nSecond line")).toBe(
      "A focused product interface with dense controls."
    );
  });

  it("computes stable sha256 and validates status shapes", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(syncStatusSchema.parse({ status: "idle" })).toEqual({ status: "idle" });
  });
});
