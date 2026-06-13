#!/usr/bin/env node
/**
 * copy-core-assets.mjs
 *
 * Copies packages/core/assets/ into packages/core/dist/assets/ after the core
 * TypeScript build. This is the packaging half of PLAN-TASK-013 Option A: core's
 * published `files` whitelist stays ["dist"], so any runtime asset (the vendored
 * lucide-icons.json) must live under dist/ to ship in the npm tarball. The built
 * dist/icon-search.js resolves the JSON at ./assets/lucide-icons.json.
 *
 * Run automatically by `pnpm --filter @xenonbyte/forma-core build`.
 */

import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "packages", "core");
const assetsDir = resolve(coreRoot, "assets");
const distAssetsDir = resolve(coreRoot, "dist", "assets");

async function main() {
  const entries = await readdir(assetsDir).catch((error) => {
    throw new Error(`core assets dir is missing or unreadable (${assetsDir}): ${error}`);
  });
  if (entries.length === 0) {
    throw new Error(`core assets dir is empty (${assetsDir}); did vendor-lucide.mjs run?`);
  }

  // Clear stale target first so dist/assets/ is a clean mirror of source.
  await rm(distAssetsDir, { recursive: true, force: true });
  await mkdir(distAssetsDir, { recursive: true });
  await cp(assetsDir, distAssetsDir, { recursive: true });
  console.log(`copied core assets: ${assetsDir} -> ${distAssetsDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
