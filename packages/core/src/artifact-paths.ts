import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { FormaError } from './errors.js';
import { isSameOrChildPath } from './path-boundary.js';

const PRODUCT_ID_PATTERN = /^P-[a-f0-9]{6}$/;
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function getProductOdProjectDir(productsRoot: string, productId: string): string {
  return safeArtifactPath(productsRoot, validateProductId(productId), 'od-project');
}

export function getArtifactsDir(productsRoot: string, productId: string): string {
  return safeArtifactPath(productsRoot, validateProductId(productId), 'od-project', 'artifacts');
}

export function getArtifactDir(
  productsRoot: string,
  productId: string,
  artifactId: string,
): string {
  return safeArtifactPath(
    productsRoot,
    validateProductId(productId),
    'od-project',
    'artifacts',
    validateArtifactId(artifactId),
  );
}

export function getArtifactManifestPath(
  productsRoot: string,
  productId: string,
  artifactId: string,
): string {
  return safeArtifactPath(
    productsRoot,
    validateProductId(productId),
    'od-project',
    'artifacts',
    validateArtifactId(artifactId),
    'manifest.json',
  );
}

export function getArtifactTmpDir(productsRoot: string, productId: string): string {
  const randomSuffix = randomBytes(4).toString('hex');
  return safeArtifactPath(productsRoot, validateProductId(productId), 'od-project', 'artifacts', `.tmp-${randomSuffix}`);
}

export function getArtifactPreviewPath(
  productsRoot: string,
  productId: string,
  artifactId: string,
  resolution: '1x' | '2x',
): string {
  return safeArtifactPath(
    productsRoot,
    validateProductId(productId),
    'od-project',
    'artifacts',
    validateArtifactId(artifactId),
    'preview',
    `${resolution}.png`,
  );
}

export function getOdProjectManifestPath(productsRoot: string, productId: string): string {
  return safeArtifactPath(productsRoot, validateProductId(productId), 'od-project', 'manifest.json');
}

function validateProductId(productId: string): string {
  if (!PRODUCT_ID_PATTERN.test(productId)) {
    throw new FormaError('ARTIFACT_INVALID_INPUT', 'Invalid product id', { productId });
  }
  return productId;
}

function validateArtifactId(artifactId: string): string {
  if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
    throw new FormaError('ARTIFACT_INVALID_INPUT', 'Invalid artifact id', { artifactId });
  }
  return artifactId;
}

function validateVersion(version: number): string {
  if (!Number.isInteger(version) || version < 1) {
    throw new FormaError('ARTIFACT_INVALID_INPUT', 'Invalid artifact version', { version });
  }
  return `v${version}`;
}

export function getArtifactVersionDir(
  productsRoot: string, productId: string, artifactId: string, version: number,
): string {
  return safeArtifactPath(
    productsRoot, validateProductId(productId), 'od-project', 'artifacts',
    validateArtifactId(artifactId), validateVersion(version),
  );
}

export function getArtifactVersionManifestPath(
  productsRoot: string, productId: string, artifactId: string, version: number,
): string {
  return safeArtifactPath(
    productsRoot, validateProductId(productId), 'od-project', 'artifacts',
    validateArtifactId(artifactId), validateVersion(version), 'manifest.json',
  );
}

export function getArtifactVersionAssetsDir(
  productsRoot: string, productId: string, artifactId: string, version: number,
): string {
  return safeArtifactPath(
    productsRoot, validateProductId(productId), 'od-project', 'artifacts',
    validateArtifactId(artifactId), validateVersion(version), 'assets',
  );
}

export function getArtifactVersionPreviewPath(
  productsRoot: string, productId: string, artifactId: string, version: number, resolution: '1x' | '2x',
): string {
  return safeArtifactPath(
    productsRoot, validateProductId(productId), 'od-project', 'artifacts',
    validateArtifactId(artifactId), validateVersion(version), 'preview', `${resolution}.png`,
  );
}

function safeArtifactPath(productsRoot: string, ...segments: string[]): string {
  const path = join(productsRoot, ...segments);
  const root = resolve(productsRoot);
  const resolved = resolve(path);
  if (!isSameOrChildPath(root, resolved)) {
    throw new FormaError('ARTIFACT_INVALID_INPUT', 'Artifact path escapes products root', {
      productsRoot,
      path,
    });
  }
  return path;
}
