import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function getProductOdProjectDir(productsRoot: string, productId: string): string {
  return join(productsRoot, productId, 'od-project');
}

export function getArtifactsDir(productsRoot: string, productId: string): string {
  return join(productsRoot, productId, 'od-project', 'artifacts');
}

export function getArtifactDir(
  productsRoot: string,
  productId: string,
  artifactId: string,
): string {
  return join(productsRoot, productId, 'od-project', 'artifacts', artifactId);
}

export function getArtifactManifestPath(
  productsRoot: string,
  productId: string,
  artifactId: string,
): string {
  return join(
    productsRoot,
    productId,
    'od-project',
    'artifacts',
    artifactId,
    'manifest.json',
  );
}

export function getArtifactTmpDir(productsRoot: string, productId: string): string {
  const randomSuffix = randomBytes(4).toString('hex');
  return join(productsRoot, productId, 'od-project', 'artifacts', `.tmp-${randomSuffix}`);
}

export function getArtifactPreviewPath(
  productsRoot: string,
  productId: string,
  artifactId: string,
  resolution: '1x' | '2x',
): string {
  return join(
    productsRoot,
    productId,
    'od-project',
    'artifacts',
    artifactId,
    'preview',
    `${resolution}.png`,
  );
}

export function getOdProjectManifestPath(productsRoot: string, productId: string): string {
  return join(productsRoot, productId, 'od-project', 'manifest.json');
}
