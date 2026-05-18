import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertBuiltInStyles, assertCopiedBuiltInStyles } from "../../../scripts/copy-assets.ts";

const minimalPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00,
  0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

describe("copy-assets built-in style checks", () => {
  it("requires at least 50 built-in styles", async () => {
    const stylesDir = await mkdtemp(join(tmpdir(), "forma-styles-"));
    await writeFile(
      join(stylesDir, "styles.yaml"),
      [
        "styles:",
        ...Array.from({ length: 49 }, (_, index) => {
          const name = `style-${index}`;
          return [
            `  - name: ${name}`,
            "    description: Test style",
            `    design_md_path: styles/${name}/DESIGN.md`,
            "    variables:",
            "      primary: '#111827'",
            "      background: '#FFFFFF'",
            "      text-primary: '#111827'",
            "      font-heading: Inter",
            "      font-body: Inter",
            "      border-radius: 8px",
            "      spacing-unit: 8px"
          ].join("\n");
        })
      ].join("\n"),
      "utf8"
    );

    await expect(assertBuiltInStyles(stylesDir)).rejects.toThrow("Expected at least 50 built-in styles, found 49");
  });

  it("validates the repository built-in styles", async () => {
    const styles = await assertBuiltInStyles(new URL("../../../styles", import.meta.url));

    expect(styles.length).toBeGreaterThanOrEqual(50);
    expect(styles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "linear", designMdPath: "styles/linear/DESIGN.md" }),
        expect.objectContaining({ name: "claude", designMdPath: "styles/claude/DESIGN.md" })
      ])
    );
  });

  it("fails when a copied style preview is missing", async () => {
    const { sourceStylesDir, copiedStylesDir } = await createCopiedStyleFixture(["style-0", "style-1"]);
    await rm(join(copiedStylesDir, "style-1", "preview@2x.png"));

    await expect(assertCopiedBuiltInStyles(sourceStylesDir, copiedStylesDir)).rejects.toThrow("preview@2x.png");
  });

  it("fails when copied style names do not match source styles", async () => {
    const { sourceStylesDir, copiedStylesDir } = await createCopiedStyleFixture(["style-0", "style-1"]);
    await writeStylesYaml(copiedStylesDir, ["style-0", "stale-style"]);
    await writeStyleFiles(copiedStylesDir, "stale-style");

    await expect(assertCopiedBuiltInStyles(sourceStylesDir, copiedStylesDir)).rejects.toThrow(
      "Copied built-in styles do not match source styles"
    );
  });
});

async function createCopiedStyleFixture(names: string[]) {
  const root = await mkdtemp(join(tmpdir(), "forma-copied-styles-"));
  const sourceStylesDir = join(root, "source");
  const copiedStylesDir = join(root, "copied");

  await writeStylesYaml(sourceStylesDir, names);
  for (const name of names) {
    await writeStyleFiles(sourceStylesDir, name);
  }
  await cp(sourceStylesDir, copiedStylesDir, { recursive: true });

  return { sourceStylesDir, copiedStylesDir };
}

async function writeStylesYaml(stylesDir: string, names: string[]) {
  await mkdir(stylesDir, { recursive: true });
  await writeFile(
    join(stylesDir, "styles.yaml"),
    [
      "styles:",
      ...names.map((name) =>
        [
          `  - name: ${name}`,
          "    description: Test style",
          `    design_md_path: styles/${name}/DESIGN.md`,
          "    variables:",
          "      primary: '#111827'",
          "      background: '#FFFFFF'",
          "      text-primary: '#111827'",
          "      font-heading: Inter",
          "      font-body: Inter",
          "      border-radius: 8px",
          "      spacing-unit: 8px"
        ].join("\n")
      )
    ].join("\n"),
    "utf8"
  );
}

async function writeStyleFiles(stylesDir: string, name: string) {
  await mkdir(join(stylesDir, name), { recursive: true });
  await writeFile(join(stylesDir, name, "DESIGN.md"), `# ${name}\n`, "utf8");
  await writeFile(join(stylesDir, name, "preview@2x.png"), minimalPng);
}
