import type { ArtifactFormaExtension } from "./artifact-manifest.js";

type Result = { ok: true } | { ok: false; error: string };

/**
 * manifest.forma.assets 是权威视图；supportingFiles 是扁平路径索引（od v1 原字段）。
 * 约束：每个 asset.path 必须出现在 supportingFiles 中，避免双源漂移。
 */
export function validateAssetsAgainstSupportingFiles(
  forma: Pick<ArtifactFormaExtension, "assets">,
  supportingFiles: string[] | undefined,
): Result {
  const assets = forma.assets ?? [];
  if (assets.length === 0) return { ok: true };
  const index = new Set(supportingFiles ?? []);
  for (const a of assets) {
    if (!index.has(a.path)) {
      return { ok: false, error: `forma.assets path missing from supportingFiles: ${a.path}` };
    }
  }
  return { ok: true };
}
