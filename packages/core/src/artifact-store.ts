import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { validateAssetsAgainstSupportingFiles } from "./artifact-assets.js";
import { validateArtifactManifest, validateSupportingPath, type ArtifactManifest } from "./artifact-manifest.js";
import {
  getArtifactDir,
  getArtifactManifestPath,
  getArtifactTmpDir,
  getArtifactsDir,
  getArtifactVersionDir,
  getArtifactVersionManifestPath,
} from "./artifact-paths.js";
import { FormaError } from "./errors.js";
import { isSameOrChildPath } from "./path-boundary.js";
import type { ProductMutationLock } from "./product-mutation-lock.js";

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

export interface WriteArtifactVersionInput {
  productId: string;
  artifactId: string;
  /**
   * Explicit version to write. Omit to allocate the next version (max existing + 1,
   * or 1 when none exist) atomically inside the write lock — this avoids a
   * read-then-write race where two concurrent saves pick the same version.
   */
  version?: number;
  manifest: ArtifactManifest;
  files: Map<string, Buffer>;
  beforeWriteLocked?(input: { productId: string; artifactId: string }): Promise<void> | void;
  afterWriteLocked?(input: {
    productId: string;
    artifactId: string;
    version: number;
    etag: string;
  }): Promise<void> | void;
}

export interface ArtifactStore {
  writeArtifact(input: WriteArtifactInput): Promise<{ artifactId: string; etag: string }>;
  readArtifact(productId: string, artifactId: string): Promise<{ manifest: ArtifactManifest; etag: string }>;
  listArtifacts(productId: string): Promise<Array<{ artifactId: string; etag: string }>>;
  deleteArtifact(productId: string, artifactId: string): Promise<void>;
  writeArtifactVersion(input: WriteArtifactVersionInput): Promise<{ version: number; etag: string }>;
  readArtifactVersion(
    productId: string,
    artifactId: string,
    version: number,
  ): Promise<{ manifest: ArtifactManifest; etag: string }>;
  listArtifactVersions(productId: string, artifactId: string): Promise<number[]>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateArtifactId(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  return Array.from(randomBytes(16), (byte) => alphabet[byte % alphabet.length]).join("");
}

function computeEtag(manifestJson: string): string {
  return createHash("sha256").update(Buffer.from(manifestJson, "utf8")).digest("hex");
}

async function dirExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolveArtifactTmpFilePath(tmpDir: string, relativePath: string): string {
  const safeRelativePath = validateSupportingPath(relativePath);
  if (safeRelativePath === null) {
    throw new FormaError(
      "ARTIFACT_INVALID_INPUT",
      "Artifact file path must be a relative path inside the artifact directory",
      { path: relativePath },
    );
  }

  const tmpRoot = resolve(tmpDir);
  const destPath = resolve(tmpRoot, safeRelativePath);
  if (!isSameOrChildPath(tmpRoot, destPath)) {
    throw new FormaError("ARTIFACT_INVALID_INPUT", "Artifact file path must stay inside the artifact directory", {
      path: relativePath,
    });
  }

  return destPath;
}

function normalizeAndValidateManifest(manifest: ArtifactManifest, artifactId: string): ArtifactManifest {
  const normalized = { ...manifest, id: artifactId };
  const validation = validateArtifactManifest(normalized);
  if (!validation.ok) {
    throw new FormaError("ARTIFACT_INVALID_INPUT", `Invalid artifact manifest: ${validation.error}`, { artifactId });
  }
  const assetsValidation = validateAssetsAgainstSupportingFiles(
    validation.value.forma ?? {},
    validation.value.supportingFiles,
  );
  if (!assetsValidation.ok) {
    throw new FormaError("ARTIFACT_INVALID_INPUT", `Invalid artifact manifest: ${assetsValidation.error}`, {
      artifactId,
    });
  }
  return validation.value;
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

    return this.lock.run({ operation: "write_artifact", product_id: productId }, async () => {
      const artifactId = __forceNanoid ?? generateArtifactId();
      const artifactDir = getArtifactDir(this.productsRoot, productId, artifactId);
      const normalizedManifest = normalizeAndValidateManifest(manifest, artifactId);

      // Check collision
      if (await dirExists(artifactDir)) {
        throw new FormaError("ARTIFACT_ALREADY_EXISTS", `Artifact already exists: ${artifactId}`, {
          artifactId,
          productId,
        });
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
          const destPath = resolveArtifactTmpFilePath(tmpDir, relativePath);
          await mkdir(dirname(destPath), { recursive: true });
          await writeFile(destPath, content);
        }

        // Write manifest.json into tmp dir
        const manifestJson = JSON.stringify(normalizedManifest, null, 2);
        const manifestPath = join(tmpDir, "manifest.json");
        await writeFile(manifestPath, manifestJson, "utf8");

        // Compute ETag
        const etag = computeEtag(manifestJson);

        // Atomic rename
        try {
          await this._rename(tmpDir, artifactDir);
        } catch (err) {
          await rm(tmpDir, { recursive: true, force: true });
          throw new FormaError(
            "ARTIFACT_WRITE_FAIL",
            `Failed to rename artifact tmp dir to final location: ${artifactId}`,
            { artifactId, productId, cause: String(err) },
          );
        }

        // Call retention hook (no-op if not provided)
        if (retentionHook) {
          await retentionHook(artifactId, productId);
        }

        return { artifactId, etag };
      } catch (err) {
        // Clean up tmp dir if it still exists (e.g., error before rename attempt)
        await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
        throw err;
      }
    });
  }

  async readArtifact(productId: string, artifactId: string): Promise<{ manifest: ArtifactManifest; etag: string }> {
    const manifestPath = getArtifactManifestPath(this.productsRoot, productId, artifactId);

    let manifestJson: string;
    try {
      manifestJson = await readFile(manifestPath, "utf8");
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        throw new FormaError("ARTIFACT_NOT_FOUND", `Artifact not found: ${artifactId}`, { artifactId, productId });
      }
      throw err;
    }

    const manifest = JSON.parse(manifestJson) as ArtifactManifest;
    const etag = computeEtag(manifestJson);
    return { manifest, etag };
  }

  async listArtifacts(productId: string): Promise<Array<{ artifactId: string; etag: string }>> {
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
      if (entry.startsWith(".tmp-")) continue;

      try {
        // (a) Try flat root manifest.json first (legacy path)
        const manifestPath = getArtifactManifestPath(this.productsRoot, productId, entry);
        try {
          const manifestJson = await readFile(manifestPath, "utf8");
          const etag = computeEtag(manifestJson);
          results.push({ artifactId: entry, etag });
          continue;
        } catch {
          // Not a flat artifact — fall through to check versioned
        }

        // (b) Check for versioned sub-dirs (vN/)
        const versions = await this.listArtifactVersions(productId, entry);
        if (versions.length > 0) {
          const maxVersion = Math.max(...versions);
          const versionManifestPath = getArtifactVersionManifestPath(this.productsRoot, productId, entry, maxVersion);
          const versionManifestJson = await readFile(versionManifestPath, "utf8");
          const etag = computeEtag(versionManifestJson);
          results.push({ artifactId: entry, etag });
        }
        // If neither flat nor versioned manifest found, skip this entry
      } catch {
        // Skip artifacts with missing or unreadable manifests
      }
    }

    return results;
  }

  async deleteArtifact(productId: string, artifactId: string): Promise<void> {
    const artifactDir = getArtifactDir(this.productsRoot, productId, artifactId);

    if (!(await dirExists(artifactDir))) {
      throw new FormaError("ARTIFACT_NOT_FOUND", `Artifact not found: ${artifactId}`, { artifactId, productId });
    }

    await rm(artifactDir, { recursive: true, force: true });
  }

  async writeArtifactVersion(input: WriteArtifactVersionInput): Promise<{ version: number; etag: string }> {
    const { productId, artifactId, manifest, files, beforeWriteLocked, afterWriteLocked } = input;
    return this.lock.run({ operation: "write_artifact_version", product_id: productId }, async () => {
      await beforeWriteLocked?.({ productId, artifactId });
      // Allocate the version inside the lock so concurrent saves to the same
      // artifact cannot pick the same number (read-then-write race).
      const version = input.version ?? (await this.nextArtifactVersion(productId, artifactId));
      const versionDir = getArtifactVersionDir(this.productsRoot, productId, artifactId, version);
      const normalized = normalizeAndValidateManifest(manifest, artifactId);
      const artifactDir = getArtifactDir(this.productsRoot, productId, artifactId);
      const artifactDirExistedBeforeWrite = await dirExists(artifactDir);

      if (await dirExists(versionDir)) {
        throw new FormaError("ARTIFACT_ALREADY_EXISTS", `Artifact version already exists: ${artifactId} v${version}`, {
          artifactId,
          productId,
          version,
        });
      }
      await mkdir(artifactDir, { recursive: true });

      const tmpDir = getArtifactTmpDir(this.productsRoot, productId);
      await mkdir(tmpDir, { recursive: true });
      try {
        for (const [relativePath, content] of files) {
          const destPath = resolveArtifactTmpFilePath(tmpDir, relativePath);
          await mkdir(dirname(destPath), { recursive: true });
          await writeFile(destPath, content);
        }
        const manifestJson = JSON.stringify(normalized, null, 2);
        await writeFile(join(tmpDir, "manifest.json"), manifestJson, "utf8");
        const etag = computeEtag(manifestJson);
        try {
          await this._rename(tmpDir, versionDir);
        } catch (err) {
          await rm(tmpDir, { recursive: true, force: true });
          throw new FormaError("ARTIFACT_WRITE_FAIL", `Failed to write artifact version: ${artifactId} v${version}`, {
            artifactId,
            productId,
            version,
            cause: String(err),
          });
        }
        // Commit hook (e.g. activating a pointer) runs INSIDE this lock, AFTER the
        // version dir is published. If it throws, the just-published version must
        // not survive: otherwise a failed commit would expose this version as the
        // artifact's max/current. Roll back the version dir, then re-throw so the
        // caller never observes a half-committed state. The v{n} immutability
        // guarantee holds — the dir is only removed when its own commit failed and
        // it was never observed as committed.
        try {
          await afterWriteLocked?.({ productId, artifactId, version, etag });
        } catch (hookErr) {
          await rm(versionDir, { recursive: true, force: true }).catch(() => undefined);
          // First-create rollback: if this call created the artifact dir and this
          // was the only version, drop the now-empty dir too so a failed
          // first-create leaves no on-disk trace. Existing flat legacy artifacts
          // and append rollbacks keep the artifact dir.
          if (
            !artifactDirExistedBeforeWrite &&
            (await this.listArtifactVersions(productId, artifactId).catch(() => [] as number[])).length === 0
          ) {
            await rm(artifactDir, {
              recursive: true,
              force: true,
            }).catch(() => undefined);
          }
          console.warn(
            `[forma] artifact-store: commit hook failed, rolled back ${artifactId} v${version} (product=${productId}):`,
            hookErr,
          );
          throw hookErr;
        }
        return { version, etag };
      } catch (err) {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
        throw err;
      }
    });
  }

  /** Next version number for an artifact: max existing + 1, or 1 when none exist. Caller must hold the write lock. */
  private async nextArtifactVersion(productId: string, artifactId: string): Promise<number> {
    const versions = await this.listArtifactVersions(productId, artifactId);
    return versions.length > 0 ? Math.max(...versions) + 1 : 1;
  }

  async readArtifactVersion(
    productId: string,
    artifactId: string,
    version: number,
  ): Promise<{ manifest: ArtifactManifest; etag: string }> {
    const manifestPath = getArtifactVersionManifestPath(this.productsRoot, productId, artifactId, version);
    let manifestJson: string;
    try {
      manifestJson = await readFile(manifestPath, "utf8");
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        throw new FormaError("ARTIFACT_NOT_FOUND", `Artifact version not found: ${artifactId} v${version}`, {
          artifactId,
          productId,
          version,
        });
      }
      throw err;
    }
    return { manifest: JSON.parse(manifestJson) as ArtifactManifest, etag: computeEtag(manifestJson) };
  }

  async listArtifactVersions(productId: string, artifactId: string): Promise<number[]> {
    const artifactDir = getArtifactDir(this.productsRoot, productId, artifactId);
    let entries: string[];
    try {
      entries = await readdir(artifactDir);
    } catch {
      return [];
    }
    return entries
      .map((e) => /^v(\d+)$/.exec(e))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
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
