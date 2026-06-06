import { describe, expect, it } from "vitest";
import { renderArtifactPreview } from "../src/preview-renderer.js";
import { contrastRatio } from "../src/quality/contrast.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

describe("extractDom via renderArtifactPreview", () => {
  it("returns a snapshot of rendered text nodes with computed color/font", async () => {
    const bundleDir = join(tmpdir(), `forma-snap-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <h1 style="color:#111111;font-size:32px;font-family:Inter">Title</h1>
         <p style="color:#777777;font-size:16px;font-family:Inter">Body text here</p>
       </body></html>`,
      "utf8",
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      expect(result.snapshot).toBeDefined();
      const nodes = result.snapshot!.textNodes;
      // both the h1 and p carry direct text
      const sizes = nodes.map((n) => n.fontSizePx).sort((a, b) => a - b);
      expect(sizes).toContain(16);
      expect(sizes).toContain(32);
      // h1 color is near-black, on a white effective background
      const title = nodes.find((n) => n.text.includes("Title"));
      expect(title).toBeDefined();
      expect(title!.color[0]).toBeLessThan(40);
      expect(title!.backgroundColor.slice(0, 3)).toEqual([255, 255, 255]);
      expect(title!.backgroundSolid).toBe(true);
      expect(title!.fontFamily).toContain("inter");
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it("omits snapshot when extractDom is not set", async () => {
    const bundleDir = join(tmpdir(), `forma-snap2-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(bundleDir, "index.html"), `<!doctype html><body style="margin:0"><p>hi</p></body>`, "utf8");
    try {
      const result = await renderArtifactPreview({ bundleDir, outDir });
      expect(result.snapshot).toBeUndefined();
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it("composites translucent ancestor backgrounds before snapshotting contrast inputs", async () => {
    const bundleDir = join(tmpdir(), `forma-snap3-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <section style="background:rgba(0,0,0,0.5)">
           <p style="color:#ffffff;font-size:16px;font-family:Inter">Overlay copy</p>
         </section>
       </body></html>`,
      "utf8",
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const copy = result.snapshot!.textNodes.find((n) => n.text.includes("Overlay copy"));
      expect(copy).toBeDefined();
      expect(copy!.backgroundColor.slice(0, 3)).toEqual([128, 128, 128]);
      expect(copy!.backgroundSolid).toBe(true);
      const ratio = contrastRatio(
        [copy!.color[0], copy!.color[1], copy!.color[2]],
        [copy!.backgroundColor[0], copy!.backgroundColor[1], copy!.backgroundColor[2]],
      );
      expect(ratio).toBeLessThan(4.5);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it("marks text over a CSS gradient/background-image as non-solid (not a white fallback)", async () => {
    const bundleDir = join(tmpdir(), `forma-snap4-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <section style="background:linear-gradient(#000000,#333333)">
           <p style="color:#ffffff;font-size:16px;font-family:Inter">On gradient</p>
         </section>
       </body></html>`,
      "utf8",
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const onGradient = result.snapshot!.textNodes.find((n) => n.text.includes("On gradient"));
      expect(onGradient).toBeDefined();
      expect(onGradient!.backgroundSolid).toBe(false);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it("captures only direct text per element (does not re-absorb a styled child's text)", async () => {
    const bundleDir = join(tmpdir(), `forma-snap6-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <p style="color:#111111;font-size:16px;font-family:Inter">Hello <strong style="color:#222222">world</strong></p>
       </body></html>`,
      "utf8",
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const nodes = result.snapshot!.textNodes;
      const p = nodes.find((n) => n.tag === "p");
      const strong = nodes.find((n) => n.tag === "strong");
      expect(p).toBeDefined();
      expect(strong).toBeDefined();
      // the <p> entry holds only its own direct text, NOT the child's "world"
      expect(p!.text).toBe("Hello");
      expect(strong!.text).toBe("world");
      // "world" appears exactly once across the snapshot (no double count)
      expect(nodes.filter((n) => n.text.includes("world"))).toHaveLength(1);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it("captures rendered text from form controls (submit value, placeholder)", async () => {
    const bundleDir = join(tmpdir(), `forma-snap5-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <input type="submit" value="Save Changes" style="color:#111111;font-size:14px;font-family:Inter">
         <input type="text" placeholder="Search here" style="color:#111111;font-size:14px;font-family:Inter">
       </body></html>`,
      "utf8",
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const nodes = result.snapshot!.textNodes;
      const submit = nodes.find((n) => n.text === "Save Changes");
      expect(submit).toBeDefined();
      expect(submit!.tag).toBe("input");
      expect(submit!.color[0]).toBeLessThan(40); // near-#111
      expect(submit!.backgroundSolid).toBe(true);
      const placeholder = nodes.find((n) => n.text === "Search here");
      expect(placeholder).toBeDefined();
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it("resolves modern CSS colors (oklch/color-mix) to real sRGB, not silent black", async () => {
    const bundleDir = join(tmpdir(), `forma-snap7-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <p style="color:oklch(0.7 0.15 250);font-size:16px;font-family:Inter">Oklch blue</p>
         <p style="color:color-mix(in srgb, red 50%, blue 50%);font-size:16px;font-family:Inter">Mixed</p>
       </body></html>`,
      "utf8",
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const nodes = result.snapshot!.textNodes;
      const oklch = nodes.find((n) => n.text.includes("Oklch"));
      const mixed = nodes.find((n) => n.text.includes("Mixed"));
      expect(oklch).toBeDefined();
      expect(mixed).toBeDefined();
      // Not silently parsed as opaque black: real resolved color, alpha 1.
      expect(oklch!.color[0] + oklch!.color[1] + oklch!.color[2]).toBeGreaterThan(0);
      expect(oklch!.color[3]).toBe(1);
      // oklch hue 250 is blue-ish: blue channel dominates red.
      expect(oklch!.color[2]).toBeGreaterThan(oklch!.color[0]);
      expect(mixed!.color[0] + mixed!.color[1] + mixed!.color[2]).toBeGreaterThan(0);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it("excludes text hidden by an ancestor display:none", async () => {
    const bundleDir = join(tmpdir(), `forma-snap8-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <div style="display:none"><p style="color:#aaaaaa;font-size:16px;font-family:Inter">hidden template text</p></div>
         <p style="color:#111111;font-size:16px;font-family:Inter">visible text</p>
       </body></html>`,
      "utf8",
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const nodes = result.snapshot!.textNodes;
      expect(nodes.some((n) => n.text.includes("visible text"))).toBe(true);
      expect(nodes.some((n) => n.text.includes("hidden template text"))).toBe(false);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it('does not capture non-text input values (checkbox value="on") as snapshot text', async () => {
    const bundleDir = join(tmpdir(), `forma-snap9-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <input type="checkbox" checked>
         <input type="radio" name="r" checked>
         <input type="range" min="0" max="10" value="7">
         <input type="submit" value="Submit it" style="color:#111111;font-size:14px;font-family:Inter">
       </body></html>`,
      "utf8",
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const nodes = result.snapshot!.textNodes;
      // checkbox/radio submit value "on" and range value "7" are not drawn text.
      expect(nodes.some((n) => n.text === "on")).toBe(false);
      expect(nodes.some((n) => n.text === "7")).toBe(false);
      // the real button label is still captured.
      expect(nodes.some((n) => n.text === "Submit it")).toBe(true);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it("folds CSS opacity into the captured foreground alpha", async () => {
    const bundleDir = join(tmpdir(), `forma-snap10-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <div style="opacity:0.5">
           <p style="color:#111111;opacity:0.4;font-size:16px;font-family:Inter">Faded copy</p>
         </div>
         <p style="color:#111111;opacity:0;font-size:16px;font-family:Inter">Invisible copy</p>
         <p style="color:#111111;font-size:16px;font-family:Inter">Full copy</p>
       </body></html>`,
      "utf8",
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const nodes = result.snapshot!.textNodes;
      const faded = nodes.find((n) => n.text === "Faded copy");
      const invisible = nodes.find((n) => n.text === "Invisible copy");
      const full = nodes.find((n) => n.text === "Full copy");
      expect(faded).toBeDefined();
      // 0.5 (ancestor) * 0.4 (self) = 0.2
      expect(faded!.color[3]).toBeCloseTo(0.2, 2);
      expect(invisible!.color[3]).toBe(0);
      expect(full!.color[3]).toBe(1);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it("marks text under a faded group (ancestor opacity<1 painting a background) as non-solid", async () => {
    const bundleDir = join(tmpdir(), `forma-snap13-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <section style="opacity:0.5;background:#000000">
           <p style="color:#ffffff;font-size:16px;font-family:Inter">Faded group text</p>
         </section>
       </body></html>`,
      "utf8",
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const copy = result.snapshot!.textNodes.find((n) => n.text.includes("Faded group text"));
      expect(copy).toBeDefined();
      // The black backdrop renders faded (gray over white), so it is not a single
      // solid color — must not be judged as opaque black (which would false-pass).
      expect(copy!.backgroundSolid).toBe(false);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it("captures the selected option label of a <select>", async () => {
    const bundleDir = join(tmpdir(), `forma-snap11-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <select style="color:#111111;font-size:14px;font-family:Inter">
           <option value="a">Apple</option>
           <option value="b" selected>Banana</option>
         </select>
       </body></html>`,
      "utf8",
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const nodes = result.snapshot!.textNodes;
      const select = nodes.find((n) => n.tag === "select");
      expect(select).toBeDefined();
      expect(select!.text).toBe("Banana");
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it("samples rootCorners: a rounded full-bleed root container is detected", async () => {
    const bundleDir = join(tmpdir(), `forma-snap14-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <div style="width:100%;min-height:100vh;border-radius:24px;background:#f0f0f0">
           <p style="color:#111111;font-size:16px;font-family:Inter;margin:0">Rounded shell</p>
         </div>
       </body></html>`,
      "utf8",
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const corners = result.snapshot!.rootCorners;
      expect(corners).toBeDefined();
      // body is always sampled, with square corners here
      const body = corners!.find((c) => c.tag === "body");
      expect(body).toBeDefined();
      expect(body!.coversViewport).toBe(true);
      expect(body!.radiusPx).toEqual([0, 0, 0, 0]);
      // the full-width child is sampled and its rounding detected on all corners
      const shell = corners!.find((c) => c.tag === "div");
      expect(shell).toBeDefined();
      expect(shell!.radiusPx).toEqual([24, 24, 24, 24]);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it("samples rootCorners: a square root container reports all-zero radii", async () => {
    const bundleDir = join(tmpdir(), `forma-snap15-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <div style="width:100%;min-height:100vh;background:#f0f0f0">
           <p style="color:#111111;font-size:16px;font-family:Inter;margin:0">Square shell</p>
         </div>
       </body></html>`,
      "utf8",
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const corners = result.snapshot!.rootCorners;
      expect(corners).toBeDefined();
      expect(corners!.length).toBeGreaterThanOrEqual(2); // body + the full-width div
      for (const c of corners!) expect(c.radiusPx).toEqual([0, 0, 0, 0]);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it("samples rootCorners: a percentage border-radius is recorded as non-zero px", async () => {
    const bundleDir = join(tmpdir(), `forma-snap16-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#ffffff">
         <div style="width:100%;min-height:100vh;border-radius:5%;background:#f0f0f0">
           <p style="color:#111111;font-size:16px;font-family:Inter;margin:0">Percent rounded shell</p>
         </div>
       </body></html>`,
      "utf8",
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const corners = result.snapshot!.rootCorners;
      const shell = corners!.find((c) => c.tag === "div");
      expect(shell).toBeDefined();
      for (const r of shell!.radiusPx) expect(r).toBeGreaterThan(0);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);

  it("includes text rendered directly under <body>", async () => {
    const bundleDir = join(tmpdir(), `forma-snap12-${randomBytes(6).toString("hex")}`);
    const outDir = join(bundleDir, "preview");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#ffffff;color:#111111;font-size:16px;font-family:Inter">Hello body</body></html>`,
      "utf8",
    );

    try {
      const result = await renderArtifactPreview({ bundleDir, outDir, extractDom: true });
      const nodes = result.snapshot!.textNodes;
      const body = nodes.find((n) => n.tag === "body");
      expect(body).toBeDefined();
      expect(body!.text).toBe("Hello body");
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 60000);
});
