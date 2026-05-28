import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ArtifactManifest } from './artifact-manifest.js';
import {
  getArtifactDir,
  getArtifactManifestPath,
  getArtifactTmpDir,
  getArtifactsDir,
} from './artifact-paths.js';
import { FormaError } from './errors.js';
import type { ProductMutationLock } from './product-mutation-lock.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RetentionHook = (artifactId: string, productId: string) => Promise<void>;

export interface WriteArtifactInput {
  productId: string;
  manifest: ArtifactManifest;
  files: Map<string, Buffer>;
  retentionHook?: RetentionHook;
  /** TEST ONLY: override the generated artifact ID for collision simulation */
  __forceNanoid?: string;
}

export interface ArtifactStore {
  writeArtifact(input: WriteArtifactInput): Promise<{ artifactId: string; etag: string }>;
  readArtifact(productId: string, artifactId: string): Promise<{ manifest: ArtifactManifest; etag: string }>;
  listArtifacts(productId: string): Promise<Array<{ artifactId: string; etag: string }>>;
  deleteArtifact(productId: string, artifactId: string): Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateArtifactId(): string {
  // 16 alphanumeric chars — same character space as nanoid default alphabet
  return randomBytes(12).toString('base64url').slice(0, 16);
}

function computeEtag(manifestJson: string): string {
  return createHash('sha256').update(Buffer.from(manifestJson, 'utf8')).digest('hex');
}

async function dirExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ─── Implementation ───────────────────────────────────────────────────────────

class ArtifactStoreImpl implements ArtifactStore {
  private readonly _rename: typeof rename;

  constructor(
    private readonly productsRoot: string,
    private readonly lock: ProductMutationLock,
    renameFn: typeof rename = rename,
  ) {
    this._rename = renameFn;
  }

  async writeArtifact(input: WriteArtifactInput): Promise<{ artifactId: string; etag: string }> {
    const { productId, manifest, files, retentionHook, __forceNanoid } = input;

    return this.lock.run({ operation: 'write_artifact', product_id: productId }, async () => {
      const artifactId = __forceNanoid ?? generateArtifactId();
      const artifactDir = getArtifactDir(this.productsRoot, productId, artifactId);

      // Check collision
      if (await dirExists(artifactDir)) {
        throw new FormaError(
          'ARTIFACT_ALREADY_EXISTS',
          `Artifact already exists: ${artifactId}`,
          { artifactId, productId },
        );
      }

      // Ensure artifacts dir exists
      const artifactsDir = getArtifactsDir(this.productsRoot, productId);
      await mkdir(artifactsDir, { recursive: true });

      // Create tmp dir
      const tmpDir = getArtifactTmpDir(this.productsRoot, productId);
      await mkdir(tmpDir, { recursive: true });

      try {
        // Write all files into tmp dir
        for (const [relativePath, content] of files) {
          const destPath = join(tmpDir, relativePath);
          await mkdir(dirname(destPath), { recursive: true });
          await writeFile(destPath, content);
        }

        // Write manifest.json into tmp dir
        const manifestJson = JSON.stringify(manifest, null, 2);
        const manifestPath = join(tmpDir, 'manifest.json');
        await writeFile(manifestPath, manifestJson, 'utf8');

        // Compute ETag
        const etag = computeEtag(manifestJson);

        // Atomic rename
        try {
          await this._rename(tmpDir, artifactDir);
        } catch (err) {
          await rm(tmpDir, { recursive: true, force: true });
          throw new FormaError(
            'ARTIFACT_WRITE_FAIL',
            `Failed to rename artifact tmp dir to final location: ${artifactId}`,
            { artifactId, productId, cause: String(err) },
          );
        }

        // Call retention hook (no-op if not provided)
        if (retentionHook) {
          await retentionHook(artifactId, productId);
        }

        console.log('[artifact-store] written:', artifactId);
        return { artifactId, etag };
      } catch (err) {
        // Clean up tmp dir if it still exists (e.g., error before rename attempt)
        await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
        throw err;
      }
    });
  }

  async readArtifact(
    productId: string,
    artifactId: string,
  ): Promise<{ manifest: ArtifactManifest; etag: string }> {
    const manifestPath = getArtifactManifestPath(this.productsRoot, productId, artifactId);

    let manifestJson: string;
    try {
      manifestJson = await readFile(manifestPath, 'utf8');
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        throw new FormaError(
          'ARTIFACT_NOT_FOUND',
          `Artifact not found: ${artifactId}`,
          { artifactId, productId },
        );
      }
      throw err;
    }

    const manifest = JSON.parse(manifestJson) as ArtifactManifest;
    const etag = computeEtag(manifestJson);
    return { manifest, etag };
  }

  async listArtifacts(
    productId: string,
  ): Promise<Array<{ artifactId: string; etag: string }>> {
    const artifactsDir = getArtifactsDir(this.productsRoot, productId);

    let entries: string[];
    try {
      entries = await readdir(artifactsDir);
    } catch {
      return [];
    }

    const results: Array<{ artifactId: string; etag: string }> = [];

    for (const entry of entries) {
      // Skip tmp dirs
      if (entry.startsWith('.tmp-')) continue;

      const manifestPath = getArtifactManifestPath(this.productsRoot, productId, entry);
      try {
        const manifestJson = await readFile(manifestPath, 'utf8');
        const etag = computeEtag(manifestJson);
        results.push({ artifactId: entry, etag });
      } catch {
        // Skip artifacts with missing or unreadable manifests
      }
    }

    return results;
  }

  async deleteArtifact(productId: string, artifactId: string): Promise<void> {
    const artifactDir = getArtifactDir(this.productsRoot, productId, artifactId);

    if (!(await dirExists(artifactDir))) {
      throw new FormaError(
        'ARTIFACT_NOT_FOUND',
        `Artifact not found: ${artifactId}`,
        { artifactId, productId },
      );
    }

    await rm(artifactDir, { recursive: true, force: true });
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createArtifactStore(
  productsRoot: string,
  lock: ProductMutationLock,
  options?: { _rename?: typeof rename },
): ArtifactStore {
  return new ArtifactStoreImpl(productsRoot, lock, options?._rename ?? rename);
}
