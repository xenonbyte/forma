import type { NormalizeArtifactInput } from "@xenonbyte/forma-viewer";
import type { Platform } from "../api.js";
import { canvasSizeForPlatform } from "./mapArtifacts.js";

/**
 * BC3 (SPEC-BEHAVIOR-015): product-level mapper for the brand-resources page.
 *
 * This mapper intentionally does NOT reuse `mapArtifactsToViewerInputs`, which
 * has a design-page premise requiring page_id/variant from the artifact record.
 * Here we synthesise those fields from the product-level pointer directly.
 *
 * Group key is fixed: "brand-resources".
 */

export interface MapBrandResourcesInput {
  /** component-library artifact id resolved from product.designSystemArtifactId. */
  artifactId: string;
  /** Artifact title (from ArtifactDetail.manifest.title). */
  title: string;
  /** current_version from ArtifactDetail.current_version. */
  version: number;
  /** product.platform — used to derive canvas size consistently. */
  platform: Platform | undefined;
}

/**
 * Maps a single component-library artifact to a `NormalizeArtifactInput` with:
 * - `kind`: "component-library"
 * - `pageId` / `pageName`: fixed "brand-resources"
 * - `variant`: "default"
 * - `width` / `height`: from `canvasSizeForPlatform(platform)`
 */
export function mapBrandResourcesArtifact(input: MapBrandResourcesInput): NormalizeArtifactInput {
  const { width, height } = canvasSizeForPlatform(input.platform);
  return {
    artifactId: input.artifactId,
    kind: "component-library",
    pageId: "brand-resources",
    pageName: "brand-resources",
    variant: "default",
    title: input.title,
    version: input.version,
    width,
    height,
  };
}
