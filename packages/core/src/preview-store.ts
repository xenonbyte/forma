/**
 * preview-store.ts
 * Read-only module for serving artifact preview PNGs.
 */

import { readFile } from 'node:fs/promises';
import { getArtifactPreviewPath } from './artifact-paths.js';
import { FormaError } from './errors.js';

/**
 * Reads a preview PNG for the given artifact and resolution.
 *
 * @param productsRoot  Absolute path to the products root directory.
 * @param productId     Product identifier.
 * @param artifactId    Artifact identifier (nanoid 16).
 * @param resolution    '1x' or '2x'.
 * @returns Raw PNG data as a Buffer.
 * @throws FormaError('ARTIFACT_NOT_FOUND') if the file does not exist.
 */
export async function readArtifactPreview(
  productsRoot: string,
  productId: string,
  artifactId: string,
  resolution: '1x' | '2x',
): Promise<Buffer> {
  const previewPath = getArtifactPreviewPath(productsRoot, productId, artifactId, resolution);

  try {
    return await readFile(previewPath);
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      throw new FormaError(
        'ARTIFACT_NOT_FOUND',
        `Preview not found: ${artifactId} @ ${resolution}`,
        { productsRoot, productId, artifactId, resolution },
      );
    }
    throw err;
  }
}
