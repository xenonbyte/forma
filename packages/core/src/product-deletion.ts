import { randomBytes } from "node:crypto";
import { access, copyFile, mkdir, realpath, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { z } from "zod";
import { getProductComponentLibrary } from "./components.js";
import { FormaError } from "./errors.js";
import { productIdSchema, type ProductService } from "./product.js";
import { getRequirementDesign } from "./requirement-design.js";
import { readYaml, writeYamlAtomic } from "./yaml.js";

export interface DeleteProductInput {
  product_id: string;
  confirm_product_id: string;
}

export interface DeleteProductResult {
  product_id: string;
  deleted: true;
  session_cleared: boolean;
  cleanup_pending: boolean;
  recovery_warnings: string[];
}

export interface ProductDeletionRecoveryResult {
  recovered: number;
  cleaned: number;
  warnings: string[];
}

export type ProductDeletionPhase = "created" | "backed_up" | "session_written" | "index_written" | "moved" | "committed";

export interface ProductDeletionState {
  schema_version: 1;
  operation_id: string;
  product_id: string;
  created_at: string;
  updated_at: string;
  committed: boolean;
  phase: ProductDeletionPhase;
  backups: { products_yaml: "backups/products.yaml"; session_yaml?: "backups/session.yaml" };
  moved_paths: Array<{
    kind: "product_data" | "component_library" | "component_library_latest" | "component_library_metadata" | "component_library_versions" | "component_library_sessions";
    original_path: string;
    staged_path: string;
    required: boolean;
  }>;
  missing_paths: string[];
  session_was_current: boolean;
  warnings: string[];
}

export interface ProductDeletionHooks {
  afterPhasePersisted?: (state: ProductDeletionState) => Promise<void> | void;
  beforeMovePath?: (entry: ProductDeletionState["moved_paths"][number], state: ProductDeletionState) => Promise<void> | void;
  beforeCleanupOperationDir?: (operationDir: string, state: ProductDeletionState) => Promise<void> | void;
}

export interface ProductDeletionRuntime {
  home: string;
  products: ProductService;
  hooks?: ProductDeletionHooks;
}

const phaseSchema = z.enum(["created", "backed_up", "session_written", "index_written", "moved", "committed"]);

const relativePathSchema = z.string().min(1).refine((value) => !isAbsolute(value) && !normalize(value).split(/[\\/]/).includes(".."), {
  message: "path must be relative"
});

const movedPathSchema = z.object({
  kind: z.enum(["product_data", "component_library", "component_library_latest", "component_library_metadata", "component_library_versions", "component_library_sessions"]),
  original_path: relativePathSchema,
  staged_path: relativePathSchema,
  required: z.boolean()
}).strict();

const productDeletionStateSchema = z.object({
  schema_version: z.literal(1),
  operation_id: z.string().min(1),
  product_id: productIdSchema,
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  committed: z.boolean(),
  phase: phaseSchema,
  backups: z.object({
    products_yaml: z.literal("backups/products.yaml"),
    session_yaml: z.literal("backups/session.yaml").optional()
  }).strict(),
  moved_paths: z.array(movedPathSchema),
  missing_paths: z.array(relativePathSchema),
  session_was_current: z.boolean(),
  warnings: z.array(z.string())
}).strict().superRefine((state, context) => {
  if (state.committed !== (state.phase === "committed")) {
    context.addIssue({
      code: "custom",
      message: "committed must be true only when phase is committed",
      path: ["committed"]
    });
  }
});

const productIndexSchema = z.object({
  products: z.array(z.object({
    id: productIdSchema,
    name: z.string().min(1),
    description: z.string()
  }).strict())
}).strict();

type ProductDeletionStateInput = Omit<ProductDeletionState, "updated_at">;
const nonTerminalDesignSessionStatuses = new Set([
  "running",
  "recoverable",
  "failed_operation",
  "failed_commit",
  "blocked_manual_edit",
  "commit_recovery_required"
]);

export function validateDeleteProductInput(input: DeleteProductInput): string {
  if (typeof input.product_id !== "string" || input.product_id.trim().length === 0) {
    throw new FormaError("INVALID_INPUT", "product_id is required", { field: "product_id" });
  }
  const parsedProductId = productIdSchema.safeParse(input.product_id);
  if (!parsedProductId.success) {
    throw new FormaError("INVALID_INPUT", "product_id is invalid", { product_id: input.product_id });
  }
  if (input.confirm_product_id !== input.product_id) {
    throw new FormaError("INVALID_INPUT", "confirm_product_id must match product_id", {
      product_id: input.product_id,
      confirm_product_id: input.confirm_product_id
    });
  }
  return parsedProductId.data;
}

export async function deleteProductLocked(
  runtime: ProductDeletionRuntime,
  input: DeleteProductInput
): Promise<DeleteProductResult> {
  const productId = input.product_id;
  const recovery = await recoverPendingProductDeletesLocked(runtime);
  await runtime.products.getProduct(productId);
  await assertNoBlockingDesignSession(runtime.home, productId);

  const operationId = `delete-${Date.now()}-${randomBytes(6).toString("hex")}`;
  const operationDir = join(runtime.home, "tmp", "deletions", operationId);
  const now = new Date().toISOString();
  let state: ProductDeletionState = {
    schema_version: 1,
    operation_id: operationId,
    product_id: productId,
    created_at: now,
    updated_at: now,
    committed: false,
    phase: "created",
    backups: { products_yaml: "backups/products.yaml" },
    moved_paths: [],
    missing_paths: [],
    session_was_current: false,
    warnings: []
  };

  try {
    await mkdir(dirname(operationDir), { recursive: true });
    await mkdir(operationDir);
    await writeStateAtomic(operationDir, state);
    await runtime.hooks?.afterPhasePersisted?.(state);
  } catch (error) {
    await rm(operationDir, { recursive: true, force: true });
    throw error;
  }

  try {
    const backupsDir = join(operationDir, "backups");
    await mkdir(backupsDir, { recursive: true });
    await copyFileAtomic(join(runtime.home, "data", "products.yaml"), join(operationDir, "backups", "products.yaml"));

    const sessionFile = join(runtime.home, "session.yaml");
    const sessionExists = await pathExists(sessionFile);
    if (sessionExists) {
      await copyFileAtomic(sessionFile, join(operationDir, "backups", "session.yaml"));
      state = { ...state, backups: { products_yaml: "backups/products.yaml", session_yaml: "backups/session.yaml" } };
    }

    const session = sessionExists ? await readYaml<{ current_product: string | null }>(sessionFile) : { current_product: null };
    const productData = join("data", productId);
    const libraryFile = join("library", `${productId}.lib.pen`);
    const libraryMetadata = join("library", `${productId}.components.yaml`);
    const libraryVersions = join("library", `${productId}.versions`);
    const librarySessions = join("library", `${productId}.sessions`);
    const movedPaths: ProductDeletionState["moved_paths"] = [];
    const missingPaths: string[] = [];
    if (await pathExists(join(runtime.home, productData))) {
      movedPaths.push({
        kind: "product_data",
        original_path: productData,
        staged_path: join("staged", "data", productId),
        required: true
      });
    } else {
      missingPaths.push(productData);
    }
    const componentLibraryFile = runtime.products.componentLibraryFile(productId);
    if (await pathExists(componentLibraryFile)) {
      movedPaths.push({
        kind: "component_library_latest",
        original_path: libraryFile,
        staged_path: join("staged", "library", `${productId}.lib.pen`),
        required: false
      });
    } else {
      missingPaths.push(libraryFile);
    }
    for (const entry of [
      { kind: "component_library_metadata" as const, original_path: libraryMetadata, staged_path: join("staged", "library", `${productId}.components.yaml`) },
      { kind: "component_library_versions" as const, original_path: libraryVersions, staged_path: join("staged", "library", `${productId}.versions`) },
      { kind: "component_library_sessions" as const, original_path: librarySessions, staged_path: join("staged", "library", `${productId}.sessions`) }
    ]) {
      if (await pathExists(join(runtime.home, entry.original_path))) {
        movedPaths.push({ ...entry, required: false });
      } else {
        missingPaths.push(entry.original_path);
      }
    }

    state = await persistState(operationDir, {
      ...state,
      phase: "backed_up",
      moved_paths: movedPaths,
      missing_paths: missingPaths,
      session_was_current: session.current_product === productId
    });
    await runtime.hooks?.afterPhasePersisted?.(state);

    if (state.session_was_current) {
      await writeYamlAtomic(sessionFile, { current_product: null });
      state = await persistState(operationDir, { ...state, phase: "session_written" });
      await runtime.hooks?.afterPhasePersisted?.(state);
    }

    const indexFile = join(runtime.home, "data", "products.yaml");
    const index = productIndexSchema.parse(await readYaml(indexFile));
    await writeYamlAtomic(indexFile, {
      products: index.products.filter((product) => product.id !== productId)
    });
    state = await persistState(operationDir, { ...state, phase: "index_written" });
    await runtime.hooks?.afterPhasePersisted?.(state);

    for (const entry of state.moved_paths) {
      await runtime.hooks?.beforeMovePath?.(entry, state);
      await movePlannedPath(runtime.home, operationDir, entry);
    }
    state = await persistState(operationDir, { ...state, phase: "moved" });
    await runtime.hooks?.afterPhasePersisted?.(state);

    state = await persistState(operationDir, { ...state, committed: true, phase: "committed" });
    await runtime.hooks?.afterPhasePersisted?.(state);

    try {
      await runtime.hooks?.beforeCleanupOperationDir?.(operationDir, state);
      await rm(operationDir, { recursive: true, force: true });
      return {
        product_id: productId,
        deleted: true,
        session_cleared: state.session_was_current,
        cleanup_pending: false,
        recovery_warnings: recovery.warnings
      };
    } catch (error) {
      return {
        product_id: productId,
        deleted: true,
        session_cleared: state.session_was_current,
        cleanup_pending: true,
        recovery_warnings: [
          ...recovery.warnings,
          `Product deletion cleanup failed for tmp/deletions/${state.operation_id}: ${sanitizePathDiagnostic(
            errorMessage(error),
            runtime.home,
            operationDir,
            state.operation_id
          )}`
        ]
      };
    }
  } catch (error) {
    try {
      await rollbackOperation(runtime.home, operationDir);
    } catch (rollbackError) {
      throw new FormaError("PRODUCT_DELETION_RECOVERY_FAILED", "Product deletion failed and rollback failed", {
        ...originalErrorDetails(error),
        rollback_error: errorMessage(rollbackError),
        operation_id: state.operation_id,
        product_id: productId
      });
    }
    throw error;
  }
}

export async function recoverPendingProductDeletesLocked(
  runtime: ProductDeletionRuntime
): Promise<ProductDeletionRecoveryResult> {
  const deletionsDir = join(runtime.home, "tmp", "deletions");
  const entries = await readdir(deletionsDir, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const result: ProductDeletionRecoveryResult = { recovered: 0, cleaned: 0, warnings: [] };

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const operationDir = join(deletionsDir, entry.name);
    const stateResult = await readState(operationDir);

    if (stateResult.status !== "valid") {
      if (await isProvablyEmptyOperationDir(operationDir)) {
        result.warnings.push(`Removed incomplete product deletion operation ${entry.name}: missing or corrupt state`);
        await rm(operationDir, { recursive: true, force: true });
        result.cleaned += 1;
        continue;
      }
      throw recoveryFailed("Product deletion recovery failed: missing or corrupt state", { operation_dir: operationDir });
    }

    const state = stateResult.state;
    if (state.committed === true) {
      await runtime.hooks?.beforeCleanupOperationDir?.(operationDir, state);
      await rm(operationDir, { recursive: true, force: true });
      result.cleaned += 1;
      result.warnings.push(...state.warnings);
      continue;
    }

    const rollbackWarnings = await rollbackOperation(runtime.home, operationDir, state);
    result.recovered += 1;
    result.warnings.push(...state.warnings, ...rollbackWarnings);
  }

  return result;
}

async function rollbackOperation(home: string, operationDir: string, knownState?: ProductDeletionState): Promise<string[]> {
  const state = knownState ?? (await requireValidState(operationDir));
  if (state.committed === true) {
    return [];
  }

  if (state.phase === "created") {
    await rm(operationDir, { recursive: true, force: true });
    return [];
  }

  const warnings: string[] = [];
  for (const entry of state.moved_paths) {
    const originalPath = resolveInside(home, entry.original_path);
    const stagedPath = resolveInside(operationDir, entry.staged_path);
    const originalExists = await pathExists(originalPath);
    const stagedExists = await pathExists(stagedPath);

    if (stagedExists && !originalExists) {
      await mkdir(dirname(originalPath), { recursive: true });
      await rename(stagedPath, originalPath);
    } else if (stagedExists && originalExists) {
      warnings.push(`Product deletion rollback found duplicate staged path ${entry.staged_path}; preserving ${entry.original_path}`);
    } else if (!stagedExists && !originalExists && entry.required) {
      throw recoveryFailed("Product deletion recovery failed: required moved path is missing", {
        operation_id: state.operation_id,
        product_id: state.product_id,
        original_path: entry.original_path,
        staged_path: entry.staged_path
      });
    }
  }

  await restoreBackup(home, operationDir, state.backups.products_yaml, join(home, "data", "products.yaml"));
  if (state.backups.session_yaml) {
    await restoreBackup(home, operationDir, state.backups.session_yaml, join(home, "session.yaml"));
  }

  await rm(operationDir, { recursive: true, force: true });
  return warnings;
}

async function movePlannedPath(
  home: string,
  operationDir: string,
  entry: ProductDeletionState["moved_paths"][number]
): Promise<void> {
  const originalPath = resolveInside(home, entry.original_path);
  const stagedPath = resolveInside(operationDir, entry.staged_path);
  const originalExists = await pathExists(originalPath);
  const stagedExists = await pathExists(stagedPath);
  if (!originalExists) {
    if (stagedExists || !entry.required) {
      return;
    }
    throw recoveryFailed("Product deletion failed: required path disappeared before move", {
      original_path: entry.original_path,
      staged_path: entry.staged_path
    });
  }

  await mkdir(dirname(stagedPath), { recursive: true });
  await rename(originalPath, stagedPath);
}

async function restoreBackup(home: string, operationDir: string, backupPath: string, destination: string): Promise<void> {
  const source = resolveInside(operationDir, backupPath);
  if (!(await pathExists(source))) {
    throw recoveryFailed("Product deletion recovery failed: backup is missing", { backup_path: backupPath });
  }
  await copyFileAtomic(source, destination);
}

async function assertNoBlockingDesignSession(home: string, productId: string): Promise<void> {
  const activePath = join(home, "data", productId, "sessions", "active-design-session.yaml");
  if (!(await pathExists(activePath))) {
    return;
  }
  let active: Record<string, unknown>;
  try {
    active = await readYaml<Record<string, unknown>>(activePath);
  } catch (error) {
    throw new FormaError("LOCK_CORRUPT", "Active design session lock is corrupt", {
      product_id: productId,
      local_active_path: activePath,
      cause: errorMessage(error)
    });
  }

  const status = typeof active.status === "string" ? active.status : "running";
  const details = {
    session_id: stringOrNull(active.session_id),
    scope: stringOrNull(active.scope),
    owner_path: stringOrNull(active.owner_path),
    local_active_path: stringOrNull(active.local_active_path),
    canvas_path: stringOrNull(active.canvas_path),
    staging_path: stringOrNull(active.staging_path),
    status
  };
  const corruptionCode = status === "failed_commit" || status === "commit_recovery_required"
    ? "DESIGN_COMMIT_RECOVERY_REQUIRED"
    : "LOCK_CORRUPT";
  const sessionId = requireActiveString(active.session_id, "session_id", corruptionCode, details);
  const localActivePath = await validateLeasePath(home, active.local_active_path, "local_active_path", corruptionCode, details);
  await validateLeasePath(home, active.owner_path, "owner_path", corruptionCode, details);
  await validateLeasePath(home, active.canvas_path, "canvas_path", corruptionCode, details);
  await validateLeasePath(home, active.staging_path, "staging_path", corruptionCode, details);
  let localActive: Record<string, unknown>;
  try {
    localActive = await readYaml<Record<string, unknown>>(localActivePath);
  } catch (error) {
    throw new FormaError(corruptionCode, "Local active design session lock is corrupt", {
      ...details,
      local_active_path: localActivePath,
      cause: errorMessage(error)
    });
  }
  if (localActive.session_id !== sessionId) {
    throw new FormaError(corruptionCode, "Active design session lock is inconsistent with local active file", {
      ...details,
      local_active_path: localActivePath,
      local_session_id: stringOrNull(localActive.session_id)
    });
  }

  const checkedDetails = { ...details, local_active_path: localActivePath };
  if (nonTerminalDesignSessionStatuses.has(status)) {
    throw new FormaError("DESIGN_SESSION_ACTIVE", "Design session is active", checkedDetails);
  }
  if (status === "committed" || status === "discarded") {
    if (typeof active.audit_link !== "string" || active.audit_link.length === 0) {
      throw new FormaError("DESIGN_SESSION_AUDIT_LINK_MISSING", "Design session audit link is missing", checkedDetails);
    }
    await validateLeasePath(home, active.audit_link, "audit_link", "DESIGN_SESSION_AUDIT_LINK_MISSING", checkedDetails);
    const sessionRecordPath = await validateLeasePath(
      home,
      typeof localActive.session_record_path === "string"
        ? localActive.session_record_path
        : `${String(active.staging_path)}/design_session.yaml`,
      "session_record_path",
      corruptionCode,
      checkedDetails
    );
    const sessionRecord = await readDesignSessionRecord(sessionRecordPath, corruptionCode, checkedDetails);
    if (sessionRecord.session_id !== sessionId) {
      throw new FormaError(corruptionCode, "Design session record does not match active lease", {
        ...checkedDetails,
        session_record_path: sessionRecordPath,
        record_session_id: sessionRecord.session_id
      });
    }
    if (nonTerminalDesignSessionStatuses.has(sessionRecord.status)) {
      throw new FormaError("DESIGN_SESSION_ACTIVE", "Design session is active", {
        ...checkedDetails,
        status: sessionRecord.status,
        session_record_path: sessionRecordPath
      });
    }
    if (sessionRecord.status !== "committed" && sessionRecord.status !== "discarded") {
      throw new FormaError("LOCK_CORRUPT", "Design session record has an invalid status", {
        ...checkedDetails,
        status: sessionRecord.status,
        session_record_path: sessionRecordPath
      });
    }
    if (!(await hasFormalAuditLink(home, productId, sessionId, active.audit_link))) {
      throw new FormaError("DESIGN_SESSION_AUDIT_LINK_MISSING", "Design session audit link is missing", {
        ...checkedDetails,
        audit_link: active.audit_link,
        session_record_path: sessionRecordPath
      });
    }
    return;
  }
  throw new FormaError("LOCK_CORRUPT", "Active design session lock has an invalid status", checkedDetails);
}

async function readDesignSessionRecord(
  sessionRecordPath: string,
  code: "LOCK_CORRUPT" | "DESIGN_COMMIT_RECOVERY_REQUIRED",
  details: Record<string, unknown>
): Promise<{ session_id: string; status: string }> {
  let record: Record<string, unknown>;
  try {
    record = await readYaml<Record<string, unknown>>(sessionRecordPath);
  } catch (error) {
    throw new FormaError(code, "Design session record is corrupt", {
      ...details,
      session_record_path: sessionRecordPath,
      cause: errorMessage(error)
    });
  }
  return {
    session_id: requireActiveString(record.session_id, "session_id", code, details),
    status: typeof record.status === "string" ? record.status : "running"
  };
}

async function hasFormalAuditLink(home: string, productId: string, sessionId: string, auditLink: string): Promise<boolean> {
  return (await requirementHistoryHasAuditLink(home, productId, sessionId, auditLink))
    || (await componentVersionHasAuditLink(home, productId, sessionId, auditLink));
}

async function requirementHistoryHasAuditLink(home: string, productId: string, sessionId: string, auditLink: string): Promise<boolean> {
  const productDir = join(home, "data", productId);
  const entries = await readdir(productDir, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^R-[a-f0-9]{8}$/.test(entry.name)) {
      continue;
    }
    const design = await getRequirementDesign(home, productId, entry.name);
    if (design.status === "missing") {
      continue;
    }
    if (design.status === "invalid") {
      continue;
    }
    if (design.history.some((item) => recordHasAuditLink(item, sessionId, auditLink))) {
      return true;
    }
  }
  return false;
}

async function componentVersionHasAuditLink(home: string, productId: string, sessionId: string, auditLink: string): Promise<boolean> {
  const componentLibrary = await getProductComponentLibrary(home, productId);
  if (componentLibrary.status !== "complete") {
    return false;
  }
  const current = componentLibrary.current_version_record;
  return current?.session_id === sessionId && current.audit_link === auditLink;
}

function recordHasAuditLink(value: unknown, sessionId: string, auditLink: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.session_id === sessionId && record.audit_link === auditLink;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requireActiveString(
  value: unknown,
  field: string,
  code: "LOCK_CORRUPT" | "DESIGN_COMMIT_RECOVERY_REQUIRED",
  details: Record<string, unknown>
): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new FormaError(code, "Active design session lock is corrupt", { ...details, field });
}

async function validateLeasePath(
  home: string,
  value: unknown,
  field: string,
  code: "LOCK_CORRUPT" | "DESIGN_COMMIT_RECOVERY_REQUIRED" | "DESIGN_SESSION_AUDIT_LINK_MISSING",
  details: Record<string, unknown>
): Promise<string> {
  const raw = requireActiveString(value, field, code === "DESIGN_SESSION_AUDIT_LINK_MISSING" ? "LOCK_CORRUPT" : code, details);
  if (isAbsolute(raw)) {
    throw new FormaError(code, "Active design session path is outside the current home", { ...details, field, path: raw });
  }
  const resolvedHome = resolve(home);
  const resolved = resolve(resolvedHome, raw);
  if (resolved !== resolvedHome && !resolved.startsWith(`${resolvedHome}/`)) {
    throw new FormaError(code, "Active design session path is outside the current home", { ...details, field, path: raw });
  }
  try {
    const realHome = await realpath(resolvedHome);
    const real = await realpath(resolved);
    if (real !== realHome && !real.startsWith(`${realHome}/`)) {
      throw new FormaError(code, "Active design session path is outside the current home", { ...details, field, path: raw });
    }
    return real;
  } catch (error) {
    if (error instanceof FormaError) {
      throw error;
    }
    throw new FormaError(code, "Active design session path is missing or unreadable", {
      ...details,
      field,
      path: raw,
      cause: errorMessage(error)
    });
  }
}

async function persistState(operationDir: string, state: ProductDeletionStateInput): Promise<ProductDeletionState> {
  const next = productDeletionStateSchema.parse({ ...state, updated_at: new Date().toISOString() });
  await writeStateAtomic(operationDir, next);
  return next;
}

async function writeStateAtomic(operationDir: string, state: ProductDeletionState): Promise<void> {
  await mkdir(operationDir, { recursive: true });
  const tempFile = join(operationDir, `.state-${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(tempFile, JSON.stringify(state, null, 2), "utf8");
    await rename(tempFile, join(operationDir, "state.json"));
  } catch (error) {
    await rm(tempFile, { force: true });
    throw error;
  }
}

async function copyFileAtomic(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const tempFile = join(dirname(destination), `.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await copyFile(source, tempFile);
    await rename(tempFile, destination);
  } catch (error) {
    await rm(tempFile, { force: true });
    throw error;
  }
}

async function requireValidState(operationDir: string): Promise<ProductDeletionState> {
  const result = await readState(operationDir);
  if (result.status === "valid") {
    return result.state;
  }
  throw recoveryFailed("Product deletion recovery failed: missing or corrupt state", { operation_dir: operationDir });
}

async function readState(operationDir: string): Promise<{ status: "valid"; state: ProductDeletionState } | { status: "missing" | "corrupt" }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(operationDir, "state.json"), "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { status: "missing" };
    }
    return { status: "corrupt" };
  }

  const result = productDeletionStateSchema.safeParse(parsed);
  if (!result.success) {
    return { status: "corrupt" };
  }
  return { status: "valid", state: result.data };
}

async function isProvablyEmptyOperationDir(operationDir: string): Promise<boolean> {
  const entries = await readdir(operationDir, { withFileTypes: true });
  return entries.every((entry) => {
    if (entry.isDirectory()) {
      return false;
    }
    return entry.name.includes("state") && entry.name.endsWith(".tmp");
  });
}

function resolveInside(base: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw recoveryFailed("Product deletion recovery failed: absolute path in state", { path: relativePath });
  }
  const resolvedBase = resolve(base);
  const resolved = resolve(resolvedBase, relativePath);
  if (resolved !== resolvedBase && !resolved.startsWith(`${resolvedBase}/`)) {
    throw recoveryFailed("Product deletion recovery failed: path escapes operation boundary", { path: relativePath });
  }
  return resolved;
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function recoveryFailed(message: string, details: Record<string, unknown>): FormaError {
  return new FormaError("PRODUCT_DELETION_RECOVERY_FAILED", message, details);
}

function originalErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof FormaError) {
    return {
      error_code: error.code,
      message: error.message,
      cause: error.details
    };
  }
  if (error instanceof Error) {
    return {
      error_code: error.name,
      message: error.message,
      cause: error.cause === undefined ? undefined : String(error.cause)
    };
  }
  return {
    error_code: "UNKNOWN",
    message: String(error),
    cause: undefined
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof FormaError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function sanitizePathDiagnostic(message: string, home: string, operationDir: string, operationId: string): string {
  return message
    .split(operationDir).join(`tmp/deletions/${operationId}`)
    .split(home).join("<forma_home>");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
