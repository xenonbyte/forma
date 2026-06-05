/**
 * artifact-urls.ts
 * Shared URL helpers for served artifact resources.
 * Used by MCP read tools (P4.8) and server routes (P4.10).
 */

/**
 * Build the URL for a file inside an artifact bundle.
 * e.g. /api/products/P-aabbcc/artifacts/<aid>/versions/3/bundle/index.html
 */
export function artifactBundleUrl(productId: string, artifactId: string, version: number, relPath: string): string {
  const encodedSegments = relPath.split("/").map(encodeURIComponent).join("/");
  return `/api/products/${encodeURIComponent(productId)}/artifacts/${encodeURIComponent(artifactId)}/versions/${version}/bundle/${encodedSegments}`;
}

/**
 * Build the URL for an artifact preview image.
 * e.g. /api/products/P-aabbcc/artifacts/<aid>/versions/3/preview/2x.png
 */
export function artifactPreviewUrl(productId: string, artifactId: string, version: number, res: "1x" | "2x"): string {
  return `/api/products/${encodeURIComponent(productId)}/artifacts/${encodeURIComponent(artifactId)}/versions/${version}/preview/${res}.png`;
}

/**
 * Derive the per-density file path from a canonical asset path.
 *
 * Rules:
 * - If the canonical path contains `@1x.` (raster multi-density), replace
 *   `@1x.` with `@{d}x.` for each density `d`.
 * - Otherwise (SVG, font, CSS — single-density or no @Nx suffix), return the
 *   path unchanged for all densities.
 */
export function assetDensityPath(canonicalPath: string, density: number): string {
  if (canonicalPath.includes("@1x.")) {
    return canonicalPath.replace("@1x.", `@${density}x.`);
  }
  return canonicalPath;
}
