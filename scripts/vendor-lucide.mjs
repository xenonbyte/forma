#!/usr/bin/env node
/**
 * vendor-lucide.mjs
 *
 * Vendors the full Lucide icon set from the `lucide-static` devDependency into
 * a single committed JSON product so the build/runtime never needs network or
 * the dev dependency at install time.
 *
 * Pinned source: lucide-static@1.18.0 (ISC License, https://lucide.dev).
 * Re-running this script regenerates packages/core/assets/lucide-icons.json
 * deterministically (icon names sorted alphabetically, tags sorted, 2-space
 * JSON). Byte-identical output across runs is required by the idempotence
 * check in PLAN-TASK-013.
 *
 * lucide-static@1.18.0 on-disk layout (inspected, not assumed):
 *   - icons/<name>.svg   : 1964 raw SVG files (currentColor, stroke-width=2).
 *   - tags.json          : { [name]: string[] } search tags for 1715 canonical
 *                          icons. The 249 SVG-only names are deprecated aliases
 *                          (e.g. alert-circle -> circle-alert) with no tags.
 *   - NO categories file ships in 1.18.0, so `categories` is always [] (kept in
 *     the shape per the SPEC-BEHAVIOR-005 skeleton for forward compatibility).
 *
 * Output shape: { [name]: { svg: string, tags: string[], categories: string[] } }
 *
 * Usage: node scripts/vendor-lucide.mjs
 */

import { createRequire } from "node:module";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lucidePackageJson = require.resolve("lucide-static/package.json");
const lucideRoot = dirname(lucidePackageJson);
const iconsDir = resolve(lucideRoot, "icons");
const tagsPath = resolve(lucideRoot, "tags.json");

const outputPath = resolve(repoRoot, "packages/core/assets/lucide-icons.json");

async function main() {
  const pkg = JSON.parse(await readFile(lucidePackageJson, "utf8"));
  if (pkg.version !== "1.18.0") {
    throw new Error(
      `vendor-lucide.mjs is pinned to lucide-static@1.18.0 but found ${pkg.version}. ` +
        "Update the header comment and re-validate the layout before bumping.",
    );
  }

  const tags = JSON.parse(await readFile(tagsPath, "utf8"));
  const entries = await readdir(iconsDir, { withFileTypes: true });
  const iconNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".svg"))
    .map((entry) => entry.name.slice(0, -".svg".length))
    .sort();

  if (iconNames.length === 0) {
    throw new Error(`No SVG icons found under ${iconsDir}`);
  }

  /** @type {Record<string, { svg: string; tags: string[]; categories: string[] }>} */
  const result = {};
  for (const name of iconNames) {
    const svg = (await readFile(resolve(iconsDir, `${name}.svg`), "utf8")).trim();
    const iconTags = Array.isArray(tags[name]) ? [...tags[name]].sort() : [];
    result[name] = { svg, tags: iconTags, categories: [] };
  }

  // Stable 2-space JSON with a trailing newline; keys already sorted above.
  const json = `${JSON.stringify(result, null, 2)}\n`;
  await writeFile(outputPath, json, "utf8");

  console.log(`vendored ${iconNames.length} Lucide icons -> ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
