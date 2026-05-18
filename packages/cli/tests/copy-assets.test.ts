import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertBuiltInStyles } from "../../../scripts/copy-assets.ts";

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
    await mkdir(resolve("styles"), { recursive: true });

    const styles = await assertBuiltInStyles(resolve("styles"));

    expect(styles.length).toBeGreaterThanOrEqual(50);
    expect(styles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "linear", designMdPath: "styles/linear/DESIGN.md" }),
        expect.objectContaining({ name: "claude", designMdPath: "styles/claude/DESIGN.md" })
      ])
    );
  });
});
