import { createHash } from "node:crypto";
import { access, lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { z } from "zod";
import { readYamlAs } from "./yaml.js";

const productIdSchema = z.string().regex(/^P-[a-f0-9]{6}$/);
const checksumSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const componentMetadataItemSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional()
}).strict();

const componentLibraryVersionSchema = z.object({
  version: z.number().int().positive(),
  file: z.string().min(1),
  checksum: checksumSchema,
  components: z.array(componentMetadataItemSchema),
  session_id: z.string().min(1).optional(),
  audit_link: z.string().min(1).optional()
}).strict();

export const componentLibraryMetadataSchema = z.object({
  product_id: productIdSchema,
  current_version: z.number().int().positive(),
  latest_file: z.string().min(1),
  versions: z.array(componentLibraryVersionSchema)
}).strict();
export type ComponentLibraryMetadata = z.infer<typeof componentLibraryMetadataSchema>;

export type ProductComponentLibraryStatus =
  | "missing"
  | "complete"
  | "metadata_missing"
  | "version_snapshot_missing"
  | "latest_file_missing"
  | "invalid";

export interface ProductComponentLibraryReadModel {
  status: ProductComponentLibraryStatus;
  product_id: string;
  current_version?: number;
  current_version_record?: z.infer<typeof componentLibraryVersionSchema>;
  metadata_path: string;
  latest_path: string;
  version_snapshot_path?: string;
  components: Array<z.infer<typeof componentMetadataItemSchema>>;
  error?: string;
}

export async function getProductComponentLibrary(home: string, productId: string): Promise<ProductComponentLibraryReadModel> {
  const parsedProductId = productIdSchema.parse(productId);
  const resolvedHome = resolve(home);
  const libraryRoot = join(resolvedHome, "library");
  const metadataPath = join(libraryRoot, `${parsedProductId}.components.yaml`);
  const latestPath = join(libraryRoot, `${parsedProductId}.lib.pen`);

  const metadataExists = await pathExists(metadataPath);
  const latestExists = await pathExists(latestPath);
  const versionsRootExists = await pathExists(join(libraryRoot, `${parsedProductId}.versions`));
  const base = {
    product_id: parsedProductId,
    metadata_path: metadataPath,
    latest_path: latestPath,
    components: []
  };

  if (!metadataExists) {
    return { ...base, status: latestExists || versionsRootExists ? "metadata_missing" : "missing" };
  }

  try {
    await assertRegularFileUnderRoot(libraryRoot, metadataPath);
    const metadata = await readYamlAs(metadataPath, componentLibraryMetadataSchema);
    if (metadata.product_id !== parsedProductId) {
      return { ...base, status: "invalid", error: "metadata product_id mismatch" };
    }
    if (!isSafeRelativePath(metadata.latest_file) || metadata.latest_file !== `${parsedProductId}.lib.pen`) {
      return { ...base, status: "invalid", error: "latest_file must be the product library file" };
    }

    const current = metadata.versions.find((version) => version.version === metadata.current_version);
    if (!current) {
      return { ...base, status: "invalid", current_version: metadata.current_version, error: "current version is missing from metadata" };
    }
    if (!isSafeRelativePath(current.file) || current.file !== `${parsedProductId}.versions/${current.version}.lib.pen`) {
      return { ...base, status: "invalid", current_version: metadata.current_version, error: "version snapshot path is invalid" };
    }

    const expectedVersionPath = join(libraryRoot, current.file);
    if (!(await pathExists(expectedVersionPath))) {
      return {
        ...base,
        status: "version_snapshot_missing",
        current_version: metadata.current_version,
        version_snapshot_path: expectedVersionPath,
        components: current.components
      };
    }
    if (!(await pathExists(latestPath))) {
      return {
        ...base,
        status: "latest_file_missing",
        current_version: metadata.current_version,
        version_snapshot_path: expectedVersionPath,
        components: current.components
      };
    }

    await assertRegularFileUnderRoot(libraryRoot, expectedVersionPath);
    await assertRegularFileUnderRoot(libraryRoot, latestPath);
    const snapshotBytes = await readFile(expectedVersionPath);
    const latestBytes = await readFile(latestPath);
    const snapshotChecksum = sha256(snapshotBytes);
    if (snapshotChecksum !== current.checksum || sha256(latestBytes) !== current.checksum) {
      return {
        ...base,
        status: "invalid",
        current_version: metadata.current_version,
        version_snapshot_path: expectedVersionPath,
        components: current.components,
        error: "component library checksum mismatch"
      };
    }

    return {
      ...base,
      status: "complete",
      current_version: metadata.current_version,
      current_version_record: current,
      version_snapshot_path: expectedVersionPath,
      components: current.components
    };
  } catch (error) {
    return {
      ...base,
      status: "invalid",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function assertRegularFileUnderRoot(root: string, file: string): Promise<void> {
  const [rootReal, fileInfo] = await Promise.all([realpath(root), lstat(file)]);
  const fileReal = await realpath(file);
  if (fileReal !== rootReal && !fileReal.startsWith(`${rootReal}/`)) {
    throw new Error(`file realpath escapes library root: ${file}`);
  }
  const targetInfo = fileInfo.isSymbolicLink() ? await stat(fileReal) : fileInfo;
  if (!targetInfo.isFile()) {
    throw new Error(`file is not a regular file: ${file}`);
  }
}

function isSafeRelativePath(value: string): boolean {
  return !isAbsolute(value) && !normalize(value).split(/[\\/]/).includes("..");
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
