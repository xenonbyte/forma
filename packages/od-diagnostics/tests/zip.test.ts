import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildDiagnosticsZip } from "../src/zip.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "diagnostics-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("buildDiagnosticsZip", () => {
  it("packages logs with redacted manifest and machine info", async () => {
    const logPath = join(tempDir, "daemon.log");
    await writeFile(logPath, "GET /api?token=abc123 ok\n", "utf8");

    const result = await buildDiagnosticsZip({
      context: {
        app: { name: "open-design", version: "1.2.3", packaged: false },
        source: "test",
        namespace: "default",
      },
      sources: [{ name: "logs/daemon/latest.log", absolutePath: logPath, kind: "text" }],
      redaction: { username: "alice" },
    });

    const zip = await JSZip.loadAsync(result.zip);
    const log = await zip.file("logs/daemon/latest.log")!.async("string");
    expect(log).toContain("token=[REDACTED]");

    const manifest = JSON.parse(await zip.file("summary/manifest.json")!.async("string"));
    expect(manifest.app.name).toBe("open-design");
    expect(manifest.namespace).toBe("default");
    expect(manifest.files[0].name).toBe("logs/daemon/latest.log");
    expect(manifest.warnings).toEqual([]);

    const machine = JSON.parse(await zip.file("summary/machine-info.json")!.async("string"));
    expect(typeof machine.platform).toBe("string");
  });

  it("excludes media-config.yaml content from the export, keeping only masked metadata", async () => {
    // A media-config.yaml-shaped fixture carrying a distinctive fake key.
    const mediaConfigPath = join(tempDir, "media-config.yaml");
    await writeFile(
      mediaConfigPath,
      ["providers:", "  volcengine:", '    api_key: "sk-test-1234abcd"', "    base_url: https://x"].join("\n"),
      "utf8",
    );
    // A normal log that incidentally references the same key value, to prove
    // line-level redaction still applies to NON-excluded files.
    const logPath = join(tempDir, "daemon.log");
    await writeFile(logPath, "loaded provider with api_key=sk-test-1234abcd ok\n", "utf8");

    const result = await buildDiagnosticsZip({
      context: { app: { name: "forma" }, source: "test" },
      sources: [
        { name: "config/media-config.yaml", absolutePath: mediaConfigPath, kind: "text" },
        { name: "logs/daemon/latest.log", absolutePath: logPath, kind: "text" },
      ],
    });

    const zip = await JSZip.loadAsync(result.zip);

    // The raw config file is replaced by an excluded-placeholder, never its bytes.
    const configEntry = zip.file("config/media-config.yaml");
    expect(configEntry).not.toBeNull();
    const configContent = await configEntry!.async("string");
    expect(configContent).not.toContain("sk-test-1234abcd");
    expect(configContent.toLowerCase()).toContain("excluded");

    // The whole zip — across every entry — must not contain the raw key string.
    for (const name of Object.keys(zip.files)) {
      if (zip.files[name].dir) continue;
      const content = await zip.file(name)!.async("string");
      expect(content).not.toContain("sk-test-1234abcd");
    }

    // The ordinary log is still present but with the key redacted in-line.
    const log = await zip.file("logs/daemon/latest.log")!.async("string");
    expect(log).toContain("api_key=[REDACTED]");
    expect(log).not.toContain("sk-test-1234abcd");
  });

  it("records a warning placeholder when a file cannot be read", async () => {
    const result = await buildDiagnosticsZip({
      context: {
        app: { name: "open-design" },
        source: "test",
      },
      sources: [{ name: "logs/missing.log", absolutePath: join(tempDir, "no-such.log"), kind: "text" }],
    });

    const zip = await JSZip.loadAsync(result.zip);
    const placeholder = await zip.file("logs/missing.log")!.async("string");
    expect(placeholder).toContain("file unavailable");
    expect(result.manifest.warnings.length).toBe(1);
  });
});
