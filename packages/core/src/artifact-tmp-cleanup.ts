import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Called at createFormaStore startup to remove stale .tmp-* artifact dirs
// (left from interrupted writes). Errors are non-fatal — logged as warnings.
export function cleanupArtifactTmpDirs(productsRoot: string): void {
  let productIds: string[];
  try {
    productIds = readdirSync(productsRoot);
  } catch {
    // productsRoot doesn't exist yet — first run, nothing to clean
    return;
  }

  for (const productId of productIds) {
    const artifactsDir = join(productsRoot, productId, 'od-project', 'artifacts');
    let entries: string[];
    try {
      entries = readdirSync(artifactsDir);
    } catch {
      continue; // product has no od-project yet
    }

    for (const entry of entries) {
      if (!entry.startsWith('.tmp-')) continue;
      const tmpPath = join(artifactsDir, entry);
      try {
        rmSync(tmpPath, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[forma] artifact-tmp-cleanup: failed to remove ${tmpPath}:`, err);
      }
    }
  }
}
