import { mkdir, mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderArtifactPreview } from "../src/preview-renderer.js";

// 最小合法 1x1 PNG
const DOT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJgQ2EAAAAAElFTkSuQmCC",
  "base64",
);

function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const roots: string[] = [];
async function makeBundle(html: string, withDot = true): Promise<{ bundleDir: string; outDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "forma-preview-"));
  roots.push(root);
  const bundleDir = join(root, "bundle");
  await mkdir(join(bundleDir, "assets"), { recursive: true });
  await writeFile(join(bundleDir, "index.html"), html, "utf8");
  if (withDot) await writeFile(join(bundleDir, "assets", "dot.png"), DOT_PNG);
  return { bundleDir, outDir: join(root, "out") };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("P3 renderArtifactPreview", () => {
  it("renders 1x + 2x PNGs from a bundle via file:// (relative asset resolves)", async () => {
    const { bundleDir, outDir } = await makeBundle(
      '<!doctype html><html><body style="margin:0"><img src="assets/dot.png"></body></html>',
    );
    const result = await renderArtifactPreview({ bundleDir, outDir, viewport: { width: 400, height: 300 } });
    expect(result.files["1x"].endsWith("1x.png")).toBe(true);
    expect(result.files["2x"].endsWith("2x.png")).toBe(true);

    const oneX = await readFile(result.files["1x"]);
    const twoX = await readFile(result.files["2x"]);
    expect((await stat(result.files["1x"])).size).toBeGreaterThan(0);
    const a = pngSize(oneX);
    const b = pngSize(twoX);
    expect(a.width).toBe(400);
    expect(a.height).toBe(300);
    expect(b.width).toBe(800);
    expect(b.height).toBe(600);
  }, 60000);

  it("throws PREVIEW_RENDER_FAILED when a relative asset is missing (proves not bare setContent)", async () => {
    const { bundleDir, outDir } = await makeBundle(
      '<!doctype html><html><body><img src="assets/missing.png"></body></html>',
      false,
    );
    await expect(renderArtifactPreview({ bundleDir, outDir })).rejects.toThrow(/PREVIEW_RENDER_FAILED|failed to load/i);
  }, 60000);

  it("throws when the entry file does not exist", async () => {
    const { bundleDir, outDir } = await makeBundle("<html></html>");
    await expect(renderArtifactPreview({ bundleDir, outDir, entry: "nope.html" })).rejects.toThrow();
  }, 60000);
});
