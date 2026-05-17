import { constants } from "node:fs";
import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AssetCopy {
  label: string;
  source: string;
  target: string;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliAssetsDir = resolve(repoRoot, "packages/cli/dist/assets");
const assetCopies: AssetCopy[] = [
  {
    label: "agent templates",
    source: resolve(repoRoot, "packages/agent/templates"),
    target: resolve(repoRoot, "packages/cli/dist/assets/agent/templates")
  },
  {
    label: "styles",
    source: resolve(repoRoot, "styles"),
    target: resolve(repoRoot, "packages/cli/dist/assets/styles")
  },
  {
    label: "web dist",
    source: resolve(repoRoot, "packages/web/dist"),
    target: resolve(repoRoot, "packages/cli/dist/assets/web")
  }
];

export async function copyAssets(copies: AssetCopy[] = assetCopies): Promise<void> {
  for (const copy of copies) {
    assertSafeAssetTarget(copy.target);
    if (!(await pathExists(copy.source))) {
      console.log(`skip ${copy.label}: ${copy.source} does not exist`);
      continue;
    }

    await mkdir(dirname(copy.target), { recursive: true });
    await rm(copy.target, { recursive: true, force: true });
    await cp(copy.source, copy.target, { recursive: true });
    console.log(`copied ${copy.label}: ${copy.source} -> ${copy.target}`);
  }
}

function assertSafeAssetTarget(target: string): void {
  const relativeTarget = relative(cliAssetsDir, resolve(target));
  if (relativeTarget === "" || relativeTarget.startsWith("..") || relativeTarget.startsWith("/")) {
    throw new Error(`Refusing to copy assets outside ${cliAssetsDir}: ${target}`);
  }
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  copyAssets().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
