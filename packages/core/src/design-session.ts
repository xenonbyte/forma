import { createHash, randomBytes } from "node:crypto";
import { access, copyFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { getProductComponentLibrary } from "./components.js";
import { validateComponentCommitTarget } from "./component-session.js";
import { FormaError } from "./errors.js";
import { PencilAppSessionAdapter, rejectPathLikeParameters, type PencilInteractiveProcessFactory } from "./pencil-adapter.js";
import { defaultPencilRunner, type PencilRunner } from "./pencil.js";
import { productIdSchema } from "./product.js";
import { getPencilMutationLock, getProductMutationLock } from "./product-mutation-lock.js";
import { requirementIdSchema } from "./requirement.js";
import { deriveAllowedSemanticSurface } from "./semantic-scope.js";
import { parseSessionId, sessionIdSchema } from "./session-id.js";
import { readYaml, writeYamlAtomic } from "./yaml.js";

type RequirementOperation = "generate" | "refine" | "rebuild" | "rollback" | "component_refresh";
type SessionStatus =
  | "running"
  | "blocked_manual_edit"
  | "failed_operation"
  | "committing"
  | "committed"
  | "failed_commit"
  | "commit_recovery_required"
  | "discarded"
  | "recoverable";

const relativePathSchema = z.string().min(1).refine((value) => !isAbsolute(value) && !value.split(/[\\/]+/).includes(".."));
const sessionStatusSchema = z.enum([
  "running",
  "blocked_manual_edit",
  "failed_operation",
  "committing",
  "committed",
  "failed_commit",
  "commit_recovery_required",
  "discarded",
  "recoverable"
]);

const persistedSessionSchema = z.object({
  schema_version: z.literal(1),
  session_id: sessionIdSchema,
  scope: z.literal("requirement_canvas"),
  product_id: productIdSchema,
  requirement_id: requirementIdSchema,
  session_dir_relative: relativePathSchema,
  session_dir: relativePathSchema.optional(),
  operation: z.string(),
  mode: z.literal("app"),
  canvas_file: relativePathSchema,
  canvas_path: relativePathSchema.optional(),
  staging_file: relativePathSchema,
  staging_path: relativePathSchema.optional(),
  pencil_binding_id: z.string(),
  pencil_command: z.string(),
  pencil_version: z.string(),
  base_canvas_revision: z.string().optional(),
  started_revision: z.string(),
  last_saved_revision: z.string(),
  last_controlled_revision: z.string(),
  operation_log_file_relative: relativePathSchema,
  operation_log_file: relativePathSchema.optional(),
  semantic_scope_file_relative: relativePathSchema,
  semantic_scope_file: relativePathSchema.optional(),
  started_at: z.string(),
  updated_at: z.string(),
  pid: z.number(),
  status: sessionStatusSchema
});

type RequirementSessionPersistedRecord = z.infer<typeof persistedSessionSchema>;
type RequirementSessionRecord = Omit<
  RequirementSessionPersistedRecord,
  "session_dir" | "canvas_path" | "staging_path" | "operation_log_file" | "semantic_scope_file"
> & {
  session_dir: string;
  canvas_path: string;
  staging_path: string;
  operation_log_file: string;
  semantic_scope_file: string;
  status: SessionStatus;
};

const componentRecoverySessionSchema = z.object({
  schema_version: z.literal(1),
  session_id: sessionIdSchema,
  scope: z.literal("product_component_library"),
  product_id: productIdSchema,
  session_dir_relative: relativePathSchema,
  session_dir: relativePathSchema.optional(),
  operation: z.enum(["generate", "refine", "change_style"]),
  seed_components: z.array(z.unknown()).optional(),
  mode: z.literal("app"),
  canvas_file: relativePathSchema,
  canvas_path: relativePathSchema.optional(),
  staging_file: relativePathSchema,
  staging_path: relativePathSchema.optional(),
  pencil_binding_id: z.string().min(1),
  pencil_command: z.string(),
  pencil_version: z.string(),
  previous_version: z.number().int().min(0),
  target_version: z.number().int().min(1),
  base_canvas_revision: z.string().optional(),
  started_revision: z.string(),
  last_saved_revision: z.string(),
  last_controlled_revision: z.string(),
  operation_log_file_relative: relativePathSchema,
  operation_log_file: relativePathSchema.optional(),
  started_at: z.string(),
  updated_at: z.string(),
  pid: z.number(),
  status: sessionStatusSchema
}).strict();

type ComponentRecoverySessionPersistedRecord = z.infer<typeof componentRecoverySessionSchema>;
type ComponentRecoverySessionRecord = Omit<ComponentRecoverySessionPersistedRecord, "session_dir" | "canvas_path" | "staging_path" | "operation_log_file"> & {
  session_dir: string;
  canvas_path: string;
  staging_path: string;
  operation_log_file: string;
  status: SessionStatus;
};

export interface BeginRequirementDesignSessionInput {
  home: string;
  product_id: string;
  requirement_id: string;
  operation: RequirementOperation;
  runner?: PencilRunner;
  processFactory?: PencilInteractiveProcessFactory;
}

export interface BeginRequirementDesignSessionResult {
  session_id: string;
  pencil_binding_id: string;
  canvas_path: string;
  staging_path: string;
  canvas_state: "existing" | "created_empty";
  mode: "app";
}

export async function beginRequirementDesignSession(input: BeginRequirementDesignSessionInput): Promise<BeginRequirementDesignSessionResult> {
  const home = resolve(input.home);
  const productId = parseProductId(input.product_id);
  const requirementId = parseRequirementId(input.requirement_id);
  const runner = input.runner ?? defaultPencilRunner;
  const appAdapter = new PencilAppSessionAdapter({ home, runner, processFactory: input.processFactory });
  await appAdapter.preflight();

  const componentLibrary = await getProductComponentLibrary(home, productId);
  if (componentLibrary.status !== "complete") {
    throw componentLibraryError(productId, componentLibrary.status, { ...componentLibrary });
  }

  const lock = getProductMutationLock(home);
  return await lock.run({ operation: "begin_requirement_design_session", product_id: productId, scope: "requirement_canvas" }, async () =>
    getPencilMutationLock(home).run({ operation: "begin_requirement_design_session", product_id: productId, scope: "pencil" }, async () => {
    const sessionId = `S-${randomBytes(8).toString("hex")}`;
    const productLease = join(home, "data", productId, "sessions", "active-design-session.yaml");
    const localLease = join(home, "data", productId, requirementId, "sessions", "active.yaml");
    if (await pathExists(productLease) || await pathExists(localLease)) {
      throw new FormaError("DESIGN_SESSION_ACTIVE", "Design session is already active", { product_id: productId });
    }

    const requirementDir = join(home, "data", productId, requirementId);
    const sessionDir = join(requirementDir, "sessions", sessionId);
    const canvasPath = join(requirementDir, "design.pen");
    const stagingPath = join(sessionDir, "staging.design.pen");
    const operationLogFile = join(sessionDir, "operations.jsonl");
    const semanticScopeFile = join(sessionDir, "semantic_scope.yaml");
    let canvasState: "existing" | "created_empty" = "created_empty";
    let baseCanvasRevision: string | undefined;

    await mkdir(sessionDir, { recursive: true });
    await writeFile(operationLogFile, "", "utf8");
    if (await pathExists(canvasPath)) {
      await copyFile(canvasPath, stagingPath);
      baseCanvasRevision = await hashFile(canvasPath);
      canvasState = "existing";
    } else {
      await writeFile(stagingPath, minimalLegalPen(), "utf8");
    }
    try {
      await writeRequirementSemanticScope({ home, productId, requirementId, semanticScopeFile, stagingPath });
    } catch (error) {
      await rollbackBegin({ productLease, localLease, stagingPath, sessionDir, sessionId });
      await rmdir(dirname(sessionDir)).catch(() => undefined);
      throw error;
    }
    const nowBeforeOpen = new Date().toISOString();
    await writeRawLease(productLease, {
      session_id: sessionId,
      scope: "requirement_canvas",
      owner_path: rel(home, localLease),
      local_active_path: rel(home, localLease),
      canvas_path: rel(home, canvasPath),
      staging_path: rel(home, stagingPath),
      status: "created",
      updated_at: nowBeforeOpen
    });
    await writeRawLease(localLease, {
      session_id: sessionId,
      scope: "requirement_canvas",
      canvas_path: rel(home, canvasPath),
      staging_path: rel(home, stagingPath),
      status: "created",
      updated_at: nowBeforeOpen
    });

    let binding;
    try {
      binding = await appAdapter.openSession({ session_id: sessionId, staging_path: stagingPath });
      const revision = await hashFile(stagingPath);
      const now = new Date().toISOString();
      const record: RequirementSessionRecord = {
        schema_version: 1,
        session_id: sessionId,
        scope: "requirement_canvas",
        product_id: productId,
        requirement_id: requirementId,
        session_dir_relative: rel(home, sessionDir),
        session_dir: sessionDir,
        operation: input.operation,
        mode: "app",
        canvas_file: rel(home, canvasPath),
        canvas_path: canvasPath,
        staging_file: rel(home, stagingPath),
        staging_path: stagingPath,
        pencil_binding_id: binding.pencil_binding_id,
        pencil_command: binding.command,
        pencil_version: binding.version,
        ...(baseCanvasRevision ? { base_canvas_revision: baseCanvasRevision } : {}),
        started_revision: revision,
        last_saved_revision: revision,
        last_controlled_revision: revision,
        operation_log_file_relative: rel(home, operationLogFile),
        operation_log_file: operationLogFile,
        semantic_scope_file_relative: rel(home, semanticScopeFile),
        semantic_scope_file: semanticScopeFile,
        started_at: now,
        updated_at: now,
        pid: binding.pid,
        status: "running"
      };
      await writeLease(home, productLease, record, localLease);
      await writeLease(home, localLease, record);
      await writeYamlAtomic(join(sessionDir, "design_session.yaml"), serializeRequirementSessionRecord(home, record));
      return {
        session_id: sessionId,
        pencil_binding_id: binding.pencil_binding_id,
        canvas_path: canvasPath,
        staging_path: stagingPath,
        canvas_state: canvasState,
        mode: "app" as const
      };
    } catch (error) {
      if (binding) {
        await appAdapter.closeBinding(binding.pencil_binding_id).catch(() => undefined);
      }
      const cleanup = await rollbackBegin({ productLease, localLease, stagingPath, sessionDir, sessionId });
      const failedDir = join(requirementDir, "sessions", "failed-begins");
      await writeYamlAtomic(join(failedDir, `${sessionId}.yaml`), {
        session_id: sessionId,
        status: "failed_begin",
        error_code: error instanceof FormaError ? error.code : "PENCIL_APP_REQUIRED",
        failed_phase: error instanceof FormaError ? error.details.failed_phase ?? "open_app" : "open_app",
        command: `pencil interactive --app desktop --in ${stagingPath}`,
        reason: errorMessage(error),
        cleanup_status: cleanup,
        pencil_version: error instanceof FormaError ? error.details.pencil_version : undefined
      }).catch(async (writeError: unknown) => {
        await mkdir(failedDir, { recursive: true }).catch(() => undefined);
        await writeFile(join(failedDir, `${sessionId}.warning.log`), `failed_begin_summary_write_failed:${errorMessage(writeError)}\n`, "utf8").catch(() => undefined);
      });
      const details = {
        session_id: sessionId,
        failed_phase: error instanceof FormaError ? error.details.failed_phase ?? "open_app" : "open_app",
        command: `pencil interactive --app desktop --in ${stagingPath}`,
        reason: errorMessage(error),
        cleanup_status: cleanup,
        ...(error instanceof FormaError && error.details.pencil_version ? { pencil_version: error.details.pencil_version } : {})
      };
      throw new FormaError("PENCIL_APP_REQUIRED", "Pencil App is required", details);
    }
    }));
}

export interface ApplyRequirementDesignOperationsInput {
  home: string;
  session_id: string;
  runner?: PencilRunner;
  processFactory?: PencilInteractiveProcessFactory;
  operations: Array<{
    tool: "batch_design";
    args: Record<string, unknown>;
    target_node_ids?: string[];
    intent: string;
  }>;
}

export async function applyRequirementDesignOperations(input: ApplyRequirementDesignOperationsInput): Promise<{
  session_id: string;
  sequence_start: number;
  sequence_end: number;
  before_revision: string;
  after_revision: string;
}> {
  const home = resolve(input.home);
  const runner = input.runner ?? defaultPencilRunner;
  const adapter = new PencilAppSessionAdapter({ home, runner, processFactory: input.processFactory });
  for (const operation of input.operations) {
    if (operation.tool !== "batch_design") {
      throw new FormaError("INVALID_INPUT", "Requirement sessions only allow batch_design", { tool: operation.tool });
    }
    rejectPathLikeParameters(operation.args);
  }

  const { record, file } = await findRequirementSession(home, input.session_id);
  return await getProductMutationLock(home).run({ operation: "apply_requirement_design_operations", product_id: record.product_id, session_id: record.session_id, scope: record.scope }, async () =>
    getPencilMutationLock(home).run({ operation: "apply_requirement_design_operations", product_id: record.product_id, session_id: record.session_id, scope: "pencil" }, async () => {
  if (record.status !== "running" && record.status !== "failed_operation") {
    throw new FormaError("INVALID_INPUT", "Session cannot apply operations", { status: record.status });
  }

  try {
    await adapter.assertLiveBinding(record.pencil_binding_id, record.staging_path);
    await adapter.controlledSave(record.pencil_binding_id);
  } catch (error) {
    if (error instanceof FormaError && error.code === "PENCIL_APP_REQUIRED") {
      await updateSessionRecord(home, file, { ...record, status: "recoverable", updated_at: new Date().toISOString() });
    }
    throw error;
  }
  const beforeRevision = await hashFile(record.staging_path);
  if (beforeRevision !== record.last_controlled_revision) {
    await updateSessionRecord(home, file, { ...record, status: "blocked_manual_edit", updated_at: new Date().toISOString() });
    throw new FormaError("MANUAL_EDIT_DETECTED", "Current canvas has uncontrolled changes", { session_id: input.session_id });
  }

  const sequenceStart = await nextOperationSequence(record.operation_log_file);
  const retryOfSequence = record.status === "failed_operation" ? await latestFailedSequence(record.operation_log_file) : undefined;
  let sequence = sequenceStart;
  let currentRecord = record;
  let afterRevision = beforeRevision;
  for (const operation of input.operations) {
    const operationBeforeRevision = currentRecord.last_controlled_revision;
    const pendingEntry = {
      sequence,
      tool: operation.tool,
      args: operation.args,
      target_node_ids: operation.target_node_ids ?? [],
      intent: operation.intent,
      before_revision: operationBeforeRevision,
      status: "pending",
      pencil_binding_id: currentRecord.pencil_binding_id,
      ...(retryOfSequence ? { retry_of_sequence: retryOfSequence } : {})
    };
    let saveSucceeded = false;
    try {
      await appendJsonl(currentRecord.operation_log_file, pendingEntry);
      await adapter.executeWriteTool(currentRecord.pencil_binding_id, operation.tool, operation.args);
      await adapter.controlledSave(currentRecord.pencil_binding_id);
      saveSucceeded = true;
      afterRevision = await hashFile(currentRecord.staging_path);
      await replaceJsonlBySequence(currentRecord.operation_log_file, sequence, (entry) => ({
        ...entry,
        status: "applied",
        after_revision: afterRevision,
        applied_at: new Date().toISOString()
      }));
      currentRecord = {
        ...currentRecord,
        status: "running",
        last_saved_revision: afterRevision,
        last_controlled_revision: afterRevision,
        updated_at: new Date().toISOString()
      };
      await updateSessionRecord(home, file, currentRecord);
      sequence += 1;
    } catch (error) {
      const failedRevision = saveSucceeded
        ? await hashFile(currentRecord.staging_path).catch(() => currentRecord.last_controlled_revision)
        : currentRecord.last_controlled_revision;
      await replaceJsonlBySequence(currentRecord.operation_log_file, sequence, (entry) => ({
        ...pendingEntry,
        ...entry,
        status: "failed",
        error: errorMessage(error),
        failed_at: new Date().toISOString()
      }));
      await updateSessionRecord(home, file, {
        ...currentRecord,
        status: "failed_operation",
        last_saved_revision: failedRevision,
        last_controlled_revision: failedRevision,
        updated_at: new Date().toISOString()
      });
      throw error;
    }
  }

  return { session_id: input.session_id, sequence_start: sequenceStart, sequence_end: sequence - 1, before_revision: beforeRevision, after_revision: afterRevision };
    }));
}

export interface RequirementCommitCandidate {
  target_file: string;
  candidate_file: string;
  replacement_kind: string;
  restore_order: number;
  old_hash?: string;
  old_file_missing?: boolean;
  candidate_hash?: string;
}

export async function commitRequirementDesignSessionWithCandidates(input: {
  home: string;
  session_id: string;
  runner?: PencilRunner;
  processFactory?: PencilInteractiveProcessFactory;
  candidates?: RequirementCommitCandidate[];
}): Promise<{ session_id: string; status: "committed" }> {
  const home = resolve(input.home);
  if (!input.candidates || input.candidates.length === 0) {
    throw new FormaError("INVALID_INPUT", "Complete candidate set is required", { session_id: input.session_id });
  }
  const candidates = input.candidates;
  const { record, file } = await findRequirementSession(home, input.session_id);
  const adapter = new PencilAppSessionAdapter({ home, runner: input.runner ?? defaultPencilRunner, processFactory: input.processFactory });
  return await getProductMutationLock(home).run({ operation: "commit_requirement_design_session", product_id: record.product_id, session_id: record.session_id, scope: record.scope }, async () =>
    getPencilMutationLock(home).run({ operation: "commit_requirement_design_session", product_id: record.product_id, session_id: record.session_id, scope: "pencil" }, async () => {
  if (record.status !== "running") {
    throw new FormaError("INVALID_INPUT", "Session is not running", { status: record.status });
  }
  try {
    await adapter.assertLiveBinding(record.pencil_binding_id, record.staging_path);
    await adapter.controlledSave(record.pencil_binding_id);
  } catch (error) {
    if (error instanceof FormaError && error.code === "PENCIL_APP_REQUIRED") {
      await updateSessionRecord(home, file, { ...record, status: "recoverable", updated_at: new Date().toISOString() });
    }
    throw error;
  }
  const stagingRevision = await hashFile(record.staging_path);
  if (stagingRevision !== record.last_controlled_revision) {
    await updateSessionRecord(home, file, { ...record, status: "blocked_manual_edit", updated_at: new Date().toISOString() });
    throw new FormaError("MANUAL_EDIT_DETECTED", "Current canvas has uncontrolled changes", { session_id: input.session_id });
  }
  const canvasStat = await lstat(record.canvas_path).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (record.base_canvas_revision) {
    if (!canvasStat?.isFile() || canvasStat.isSymbolicLink()) {
      throw new FormaError("DESIGN_CANVAS_CHANGED", "Formal canvas changed since session began", { canvas_path: record.canvas_path });
    }
    if (await hashFile(record.canvas_path) !== record.base_canvas_revision) {
      throw new FormaError("DESIGN_CANVAS_CHANGED", "Formal canvas changed since session began", { canvas_path: record.canvas_path });
    }
  } else if (canvasStat) {
    throw new FormaError("DESIGN_CANVAS_CHANGED", "Formal canvas changed since session began", { canvas_path: record.canvas_path });
  }

  const journalPath = join(record.session_dir, "commit-journal.yaml");
  const backupDir = join(record.session_dir, "backup");
  const validatedCandidateDir = join(record.session_dir, "validated-candidates");
  await mkdir(backupDir, { recursive: true });
  await mkdir(validatedCandidateDir, { recursive: true });
  const entries = [];
  for (const candidate of candidates.sort((a, b) => a.restore_order - b.restore_order)) {
    if (
      !candidate.candidate_hash ||
      !candidate.replacement_kind ||
      typeof candidate.restore_order !== "number"
    ) {
      throw new FormaError("INVALID_INPUT", "Complete candidate metadata is required", {
        target_file: candidate.target_file,
        replacement_kind: candidate.replacement_kind
      });
    }
    const targetPath = resolveInside(home, candidate.target_file);
    const targetState = await validateRequirementCommitTarget(home, record, targetPath, candidate.target_file);
    const candidatePath = resolveInside(home, candidate.candidate_file);
    if (!isSameOrChildPath(record.session_dir, candidatePath)) {
      throw new FormaError("INVALID_INPUT", "Candidate file must be under the session directory", { candidate_file: candidate.candidate_file });
    }
    const realSessionDir = await realpath(record.session_dir);
    const candidateStat = await lstat(candidatePath);
    if (!candidateStat.isFile()) {
      throw new FormaError("INVALID_INPUT", "Candidate file must be a regular file", { candidate_file: candidate.candidate_file });
    }
    const realCandidatePath = await realpath(candidatePath);
    if (!isSameOrChildPath(realSessionDir, realCandidatePath)) {
      throw new FormaError("INVALID_INPUT", "Candidate file real path must be under the session directory", { candidate_file: candidate.candidate_file });
    }
    const validatedCandidatePath = join(validatedCandidateDir, `${candidate.restore_order}-${basename(candidatePath)}`);
    await copyFile(realCandidatePath, validatedCandidatePath);
    const oldExists = targetState.exists;
    const oldHash = targetState.exists ? targetState.hash : undefined;
    const candidateHash = await hashFile(validatedCandidatePath);
    if (candidate.candidate_hash && candidate.candidate_hash !== candidateHash) {
      throw new FormaError("INVALID_INPUT", "Candidate hash does not match candidate file", { candidate_file: candidate.candidate_file });
    }
    if (!oldExists) {
      if (candidate.old_file_missing !== true) {
        throw new FormaError("INVALID_INPUT", "Candidate old metadata must mark missing target", { target_file: candidate.target_file });
      }
    } else {
      if (candidate.old_file_missing === true) {
        throw new FormaError("INVALID_INPUT", "Candidate old metadata claims missing target but target exists", { target_file: candidate.target_file });
      }
      if (!candidate.old_hash) {
        throw new FormaError("INVALID_INPUT", "Candidate old hash is required for existing target", { target_file: candidate.target_file });
      }
      if (candidate.old_hash !== oldHash) {
        throw new FormaError("INVALID_INPUT", "Candidate old hash does not match target", { target_file: candidate.target_file });
      }
    }
    const backupFile = join(backupDir, `${candidate.restore_order}-${targetPath.split("/").at(-1) ?? "file"}.bak`);
    if (oldExists) {
      await copyFile(targetPath, backupFile);
    }
    entries.push({
      ...candidate,
      target_file: rel(home, targetPath),
      candidate_file: rel(home, validatedCandidatePath),
      old_hash: oldHash,
      old_file_missing: !oldExists,
      candidate_hash: candidateHash,
      backup_file: oldExists ? rel(home, backupFile) : undefined,
      status: "pending"
    });
  }
  await writeYamlAtomic(journalPath, { schema_version: 1, session_id: input.session_id, scope: "requirement_canvas", status: "committing", entries });
  await updateSessionRecord(home, file, { ...record, status: "committing", updated_at: new Date().toISOString() });

  try {
    for (const entry of entries) {
      await mkdir(dirname(resolveInside(home, entry.target_file)), { recursive: true });
      const target = resolveInside(home, entry.target_file);
      const tempTarget = join(dirname(target), `.forma-${randomBytes(8).toString("hex")}.tmp`);
      await copyFile(resolveInside(home, entry.candidate_file), tempTarget);
      await rename(tempTarget, target);
      if (await hashFile(target) !== entry.candidate_hash) {
        throw new Error(`target hash mismatch after promotion: ${entry.target_file}`);
      }
    }
  } catch (error) {
    const recovery = await restoreJournalEntries(home, record, entries);
    const status = recovery.failed_files.length > 0 ? "commit_recovery_required" : "failed_commit";
    await writeYamlAtomic(journalPath, { schema_version: 1, session_id: input.session_id, scope: "requirement_canvas", status, entries });
    await updateSessionRecord(home, file, { ...record, status, updated_at: new Date().toISOString() });
    if (status === "commit_recovery_required") {
      throw new FormaError("DESIGN_COMMIT_RECOVERY_REQUIRED", "Design commit recovery required", { session_id: input.session_id, failed_files: recovery.failed_files });
    }
    throw error;
  }
  await writeYamlAtomic(journalPath, { schema_version: 1, session_id: input.session_id, scope: "requirement_canvas", status: "committed", entries });
  await updateSessionRecord(home, file, { ...record, status: "committed", updated_at: new Date().toISOString() });
  await clearRequirementLeases(home, record);
  await adapter.closeBinding(record.pencil_binding_id);
  return { session_id: input.session_id, status: "committed" };
    }));
}

export async function recoverDesignCommitJournal(input: {
  home: string;
  session_id: string;
  scope: "requirement_canvas" | "product_component_library";
}): Promise<{ session_id: string; scope: string; status: "failed_commit" | "commit_recovery_required"; restored_files: Array<{ path: string; old_hash: string; restore_status: "restored" | "already_restored" }>; failed_files: Array<{ path: string; reason: string }> }> {
  const home = resolve(input.home);
  const journalPath = await findCommitJournal(home, input.session_id, input.scope);
  const journal = await readYaml<{ status?: string; entries: RecoveryJournalEntry[] }>(journalPath);
  const session = input.scope === "requirement_canvas"
    ? { scope: "requirement_canvas" as const, ...(await findRequirementSession(home, input.session_id)) }
    : { scope: "product_component_library" as const, ...(await findComponentSessionRecord(home, input.session_id)) };
  const canRecover = session.record.status === "commit_recovery_required" || journal.status === "committing";
  if (!canRecover) {
    throw new FormaError("INVALID_INPUT", "Commit journal recovery requires commit_recovery_required session status or committing journal status", {
      session_id: input.session_id,
      status: session.record.status,
      journal_status: journal.status
    });
  }
  const validation = await validateRecoveryJournalEntries(home, input.scope, session.record, journal.entries);
  if (validation.failed_files.length > 0) {
    await writeYamlAtomic(journalPath, { ...journal, status: "restore_failed" });
    await updateRecoverySessionStatus(home, session, "commit_recovery_required");
    return { session_id: input.session_id, scope: input.scope, status: "commit_recovery_required", restored_files: [], failed_files: validation.failed_files };
  }
  const restored = [];
  const failed = [];
  for (const entry of validation.entries) {
    const target = entry.target;
    try {
      if (entry.old_file_missing) {
        await rm(target, { force: true });
        restored.push({ path: target, old_hash: "missing", restore_status: "restored" as const });
        continue;
      }
      const targetStat = await lstat(target).catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
        throw error;
      });
      if (targetStat && (targetStat.isSymbolicLink() || !targetStat.isFile())) {
        throw new Error("restore target is not a regular file");
      }
      if (targetStat && await hashFile(target) === entry.old_hash) {
        restored.push({ path: target, old_hash: entry.old_hash, restore_status: "already_restored" as const });
        continue;
      }
      const tempTarget = join(dirname(target), `.forma-restore-${randomBytes(8).toString("hex")}.tmp`);
      await restoreVerifiedBackup(entry.backup, tempTarget, target, entry.old_hash);
      if (await hashFile(target) !== entry.old_hash) {
        throw new Error("restored hash mismatch");
      }
      restored.push({ path: target, old_hash: entry.old_hash, restore_status: "restored" as const });
    } catch (error) {
      failed.push({ path: target, reason: errorMessage(error) });
    }
  }
  const status = failed.length > 0 ? "commit_recovery_required" : "failed_commit";
  await writeYamlAtomic(journalPath, { ...journal, status: status === "failed_commit" ? "restored" : "restore_failed" });
  await updateRecoverySessionStatus(home, session, status);
  return { session_id: input.session_id, scope: input.scope, status, restored_files: restored, failed_files: failed };
}

export async function discardRequirementDesignSession(input: { home: string; session_id: string }): Promise<{ session_id: string; status: "discarded" }> {
  const home = resolve(input.home);
  const { record, file } = await findRequirementSession(home, input.session_id);
  return await getProductMutationLock(home).run({ operation: "discard_requirement_design_session", product_id: record.product_id, session_id: record.session_id, scope: record.scope }, async () =>
    getPencilMutationLock(home).run({ operation: "discard_requirement_design_session", product_id: record.product_id, session_id: record.session_id, scope: "pencil" }, async () => {
      const warningFile = join(record.session_dir, "lease-cleanup-warnings.jsonl");
      await assertRequirementDiscardLeasesMatch(home, record, warningFile);
      await assertRequirementDiscardJournalPath(record.session_dir);
      const allowDisconnectedDiscard = record.status === "failed_commit" || record.status === "recoverable";
      const adapter = new PencilAppSessionAdapter({ home, runner: defaultPencilRunner });
      if (!allowDisconnectedDiscard) {
        try {
          await adapter.assertLiveBinding(record.pencil_binding_id, record.staging_path);
        } catch (error) {
          if (error instanceof FormaError && error.code === "PENCIL_APP_REQUIRED") {
            await updateSessionRecord(home, file, { ...record, status: "recoverable", updated_at: new Date().toISOString() });
          }
          throw error;
        }
      }
      await rm(record.staging_path, { force: true });
      await updateSessionRecord(home, file, { ...record, status: "discarded", updated_at: new Date().toISOString() });
      await clearRequirementLeases(home, record);
      if (!allowDisconnectedDiscard) {
        await adapter.closeBinding(record.pencil_binding_id);
      }
      return { session_id: input.session_id, status: "discarded" as const };
    }));
}

export async function readDesignStartupRecoveryState(homeInput: string): Promise<{ items: Array<Record<string, unknown>> }> {
  const home = resolve(homeInput);
  const items: Array<Record<string, unknown>> = [];
  const dataDir = join(home, "data");
  const libraryDir = join(home, "library");
  await scanRequirementSessions(dataDir, items);
  await scanComponentSessions(libraryDir, items);
  items.sort((a, b) => Number(b.kind === "commit_journal") - Number(a.kind === "commit_journal"));
  return { items };
}

async function scanRequirementSessions(dataDir: string, items: Array<Record<string, unknown>>): Promise<void> {
  for (const productId of await safeReaddir(dataDir)) {
    const productDir = join(dataDir, productId);
    if (!await isDirectoryPath(productDir)) continue;
    if (await pathExists(join(productDir, "sessions", "active-design-session.yaml"))) {
      items.push({ kind: "product_active_design_lease", product_id: productId, path: join(productDir, "sessions", "active-design-session.yaml") });
    }
    for (const requirementId of await safeReaddir(productDir)) {
      if (requirementId === "sessions" || requirementId.startsWith("D-")) continue;
      const requirementDir = join(productDir, requirementId);
      if (!await isDirectoryPath(requirementDir)) continue;
      for (const entry of await safeReaddir(requirementDir)) {
        if (entry.startsWith(".index-stage-") && await pathExists(join(requirementDir, entry, "index-journal.yaml"))) {
          items.push({ kind: "requirement_index_journal", product_id: productId, requirement_id: requirementId, path: join(requirementDir, entry, "index-journal.yaml") });
        }
      }
      const sessionsDir = join(productDir, requirementId, "sessions");
      if (await pathExists(join(sessionsDir, "active.yaml"))) {
        items.push({ kind: "requirement_active_session", product_id: productId, requirement_id: requirementId, path: join(sessionsDir, "active.yaml") });
      }
      for (const sessionId of await safeReaddir(sessionsDir)) {
        if (sessionId === "active.yaml" || sessionId.startsWith(".")) continue;
        const sessionDir = join(sessionsDir, sessionId);
        if (await pathExists(join(sessionDir, "commit-journal.yaml"))) {
          const item = await commitJournalRecoveryItem(join(sessionDir, "commit-journal.yaml"), {
            scope: "requirement_canvas",
            product_id: productId,
            requirement_id: requirementId,
            session_id: sessionId
          });
          if (item) items.push(item);
        } else if (await pathExists(join(sessionDir, "design_session.yaml"))) {
          items.push({ kind: "session_file", scope: "requirement_canvas", product_id: productId, requirement_id: requirementId, session_id: sessionId, path: join(sessionDir, "design_session.yaml") });
        }
      }
    }
  }
}

async function scanComponentSessions(libraryDir: string, items: Array<Record<string, unknown>>): Promise<void> {
  for (const entry of await safeReaddir(libraryDir)) {
    if (!entry.endsWith(".sessions")) continue;
    const productId = entry.slice(0, -".sessions".length);
    const sessionsDir = join(libraryDir, entry);
    if (await pathExists(join(sessionsDir, "active.yaml"))) {
      items.push({ kind: "component_active_session", product_id: productId, path: join(sessionsDir, "active.yaml") });
    }
    for (const sessionId of await safeReaddir(sessionsDir)) {
      if (sessionId === "active.yaml" || sessionId.startsWith(".")) continue;
      const sessionDir = join(sessionsDir, sessionId);
      if (await pathExists(join(sessionDir, "commit-journal.yaml"))) {
        const item = await commitJournalRecoveryItem(join(sessionDir, "commit-journal.yaml"), {
          scope: "product_component_library",
          product_id: productId,
          session_id: sessionId
        });
        if (item) items.push(item);
      } else if (await pathExists(join(sessionDir, "design_session.yaml"))) {
        items.push({ kind: "session_file", scope: "product_component_library", product_id: productId, session_id: sessionId, path: join(sessionDir, "design_session.yaml") });
      }
    }
  }
}

const terminalCommitJournalStatuses = new Set(["committed", "restored", "failed_commit", "discarded"]);

async function commitJournalRecoveryItem(journalPath: string, base: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  const journal: { status?: string; entries?: Array<{ target_file?: string }> } = await readYaml<{ status?: string; entries?: Array<{ target_file?: string }> }>(journalPath).catch(() => ({}));
  if (typeof journal.status === "string" && terminalCommitJournalStatuses.has(journal.status)) {
    return undefined;
  }
  return {
    kind: "commit_journal",
    error_code: "DESIGN_COMMIT_RECOVERY_REQUIRED",
    journal_path: journalPath,
    affected_files: (journal.entries ?? []).map((entry: { target_file?: string }) => entry.target_file).filter((value: string | undefined): value is string => typeof value === "string"),
    path: journalPath,
    ...base
  };
}

async function writeLease(home: string, file: string, record: RequirementSessionRecord, localActivePath?: string): Promise<void> {
  await writeYamlAtomic(file, {
    session_id: record.session_id,
    scope: record.scope,
    ...(localActivePath ? { owner_path: rel(home, localActivePath), local_active_path: rel(home, localActivePath) } : {}),
    canvas_path: record.canvas_file,
    staging_path: record.staging_file,
    status: record.status,
    updated_at: record.updated_at
  });
}

async function writeRawLease(file: string, lease: Record<string, unknown>): Promise<void> {
  await writeYamlAtomic(file, lease);
}

async function writeRequirementSemanticScope(input: {
  home: string;
  productId: string;
  requirementId: string;
  semanticScopeFile: string;
  stagingPath: string;
}): Promise<void> {
  try {
    const surface = await deriveAllowedSemanticSurface({
      home: input.home,
      product_id: input.productId,
      requirement_id: input.requirementId,
      language: "default"
    });
    await writeYamlAtomic(input.semanticScopeFile, {
      ...surface,
      staging_revision: await hashFile(input.stagingPath)
    });
  } catch (error) {
    throw new FormaError("INVALID_INPUT", "Semantic scope derivation failed", {
      failed_phase: "semantic_scope_derivation",
      product_id: input.productId,
      requirement_id: input.requirementId,
      reason: errorMessage(error)
    });
  }
}

async function rollbackBegin(input: { productLease: string; localLease: string; stagingPath: string; sessionDir: string; sessionId: string }): Promise<"completed" | "partial"> {
  let partial = false;
  for (const action of [
    () => clearLeaseIfMatches(input.productLease, input.sessionId, join(dirname(input.sessionDir), "failed-begins", `${input.sessionId}.warnings.jsonl`)),
    () => clearLeaseIfMatches(input.localLease, input.sessionId, join(dirname(input.sessionDir), "failed-begins", `${input.sessionId}.warnings.jsonl`)),
    () => rm(input.stagingPath, { force: true }),
    () => rm(input.sessionDir, { recursive: true, force: true })
  ]) {
    try {
      await action();
    } catch {
      partial = true;
    }
  }
  return partial ? "partial" : "completed";
}

async function clearRequirementLeases(home: string, record: RequirementSessionRecord): Promise<void> {
  const warningFile = join(record.session_dir, "lease-cleanup-warnings.jsonl");
  await clearLeaseIfMatches(join(home, "data", record.product_id, "sessions", "active-design-session.yaml"), record.session_id, warningFile);
  await clearLeaseIfMatches(join(home, "data", record.product_id, record.requirement_id, "sessions", "active.yaml"), record.session_id, warningFile);
}

async function assertRequirementDiscardLeasesMatch(home: string, record: RequirementSessionRecord, warningFile: string): Promise<void> {
  const productLeasePath = join(home, "data", record.product_id, "sessions", "active-design-session.yaml");
  const expectedLocalLeasePath = join(home, "data", record.product_id, record.requirement_id, "sessions", "active.yaml");
  const expectedLocalLeaseRelative = rel(home, expectedLocalLeasePath);
  const productLease = await readYaml<Record<string, unknown>>(productLeasePath).catch(() => undefined);
  const productPointerPath = typeof productLease?.local_active_path === "string"
    ? resolveInside(home, productLease.local_active_path)
    : undefined;
  const ownerPointerPath = typeof productLease?.owner_path === "string"
    ? resolveInside(home, productLease.owner_path)
    : undefined;
  const pointerMismatch =
    productLease?.owner_path !== expectedLocalLeaseRelative ||
    productLease?.local_active_path !== expectedLocalLeaseRelative ||
    productPointerPath !== expectedLocalLeasePath ||
    ownerPointerPath !== expectedLocalLeasePath;
  if (pointerMismatch) {
    await recordRequirementLeaseMismatch(warningFile, productLeasePath, expectedRequirementLease(record, expectedLocalLeaseRelative), productLease);
    throw new FormaError("INVALID_INPUT", "Requirement product lease local active pointer does not match discard request", {
      session_id: record.session_id,
      lease_path: productLeasePath,
      expected_local_active_path: expectedLocalLeaseRelative,
      actual_owner_path: productLease?.owner_path,
      actual_local_active_path: productLease?.local_active_path
    });
  }

  await assertRequirementLeaseMatches(productLeasePath, productLease, expectedRequirementLease(record, expectedLocalLeaseRelative), warningFile);
  const localLeasePath = productPointerPath;
  if (!localLeasePath) {
    await recordRequirementLeaseMismatch(warningFile, productLeasePath, expectedRequirementLease(record, expectedLocalLeaseRelative), productLease);
    throw new FormaError("INVALID_INPUT", "Requirement product lease local active pointer is missing", {
      session_id: record.session_id,
      lease_path: productLeasePath
    });
  }
  const localLease = await readYaml<Record<string, unknown>>(localLeasePath).catch(() => undefined);
  await assertRequirementLeaseMatches(localLeasePath, localLease, expectedRequirementLease(record), warningFile);
}

async function assertRequirementLeaseMatches(
  file: string,
  lease: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
  warningFile: string
): Promise<void> {
  const mismatch = Object.entries(expected).some(([key, value]) => lease?.[key] !== value);
  if (mismatch) {
    await appendJsonl(warningFile, {
      warning: "LEASE_RELEASE_MISMATCH",
      lease_path: file,
      expected,
      actual: lease ?? null
    });
    throw new FormaError("INVALID_INPUT", "Requirement session lease does not match discard request", {
      session_id: expected.session_id,
      lease_path: file,
      expected,
      actual: lease ?? null
    });
  }
}

async function assertRequirementDiscardJournalPath(sessionDir: string): Promise<void> {
  const journalPath = join(sessionDir, "commit-journal.yaml");
  const stat = await lstat(journalPath).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (stat && (stat.isSymbolicLink() || !stat.isFile())) {
    throw new FormaError("INVALID_INPUT", "Requirement commit journal path is invalid", {
      journal_path: journalPath
    });
  }
}

function expectedRequirementLease(record: RequirementSessionRecord, localActivePath?: string): Record<string, unknown> {
  const expected = {
    session_id: record.session_id,
    scope: record.scope,
    ...(localActivePath ? { owner_path: localActivePath, local_active_path: localActivePath } : {}),
    canvas_path: record.canvas_file,
    staging_path: record.staging_file
  };
  return expected;
}

async function recordRequirementLeaseMismatch(
  warningFile: string,
  file: string,
  expected: Record<string, unknown>,
  actual: Record<string, unknown> | undefined
): Promise<void> {
  await appendJsonl(warningFile, {
    warning: "LEASE_RELEASE_MISMATCH",
    lease_path: file,
    expected,
    actual: actual ?? null
  });
}

async function clearLeaseIfMatches(file: string, sessionId: string, warningFile: string): Promise<void> {
  const lease = await readYaml<Record<string, unknown>>(file).catch(() => undefined);
  if (!lease || lease.session_id !== sessionId) {
    if (lease) {
      await appendJsonl(warningFile, {
        warning: "LEASE_RELEASE_MISMATCH",
        lease_path: file,
        expected_session_id: sessionId,
        actual_session_id: lease.session_id
      });
    }
    return;
  }
  await rm(file, { force: true });
}

async function findRequirementSession(home: string, sessionId: string): Promise<{ record: RequirementSessionRecord; file: string }> {
  const parsedSessionId = parseSessionId(sessionId);
  const dataDir = join(home, "data");
  for (const productId of await safeReaddir(dataDir)) {
    const productDir = join(dataDir, productId);
    for (const requirementId of await safeReaddir(productDir)) {
      if (requirementId === "sessions" || requirementId.startsWith("D-")) continue;
      const file = join(productDir, requirementId, "sessions", parsedSessionId, "design_session.yaml");
      if (await pathExists(file)) {
        return { file, record: await readRequirementSessionRecord(home, file) };
      }
    }
  }
  throw new FormaError("INVALID_INPUT", "Design session not found", { session_id: parsedSessionId });
}

async function findCommitJournal(home: string, sessionId: string, scope: string): Promise<string> {
  const parsedSessionId = parseSessionId(sessionId);
  if (scope === "requirement_canvas") {
    const dataDir = join(home, "data");
    for (const productId of await safeReaddir(dataDir)) {
      const productDir = join(dataDir, productId);
      for (const requirementId of await safeReaddir(productDir)) {
        if (requirementId === "sessions" || requirementId.startsWith("D-")) continue;
        const journalPath = join(productDir, requirementId, "sessions", parsedSessionId, "commit-journal.yaml");
        if (await pathExists(journalPath)) return journalPath;
      }
    }
  } else if (scope === "product_component_library") {
    const libraryDir = join(home, "library");
    for (const entry of await safeReaddir(libraryDir)) {
      if (!entry.endsWith(".sessions")) continue;
      const journalPath = join(libraryDir, entry, parsedSessionId, "commit-journal.yaml");
      if (await pathExists(journalPath)) return journalPath;
    }
  }
  throw new FormaError("INVALID_INPUT", "Commit journal not found", { session_id: parsedSessionId, scope });
}

async function findComponentSessionRecord(home: string, sessionId: string): Promise<{ record: ComponentRecoverySessionRecord; file: string }> {
  const parsedSessionId = parseSessionId(sessionId);
  const libraryDir = join(home, "library");
  for (const entry of await safeReaddir(libraryDir)) {
    if (!entry.endsWith(".sessions")) continue;
    const file = join(libraryDir, entry, parsedSessionId, "design_session.yaml");
    if (await pathExists(file)) {
      return { file, record: await readComponentRecoverySessionRecord(home, file) };
    }
  }
  throw new FormaError("INVALID_INPUT", "Component session not found", { session_id: parsedSessionId });
}

type RecoveryJournalEntry = {
  target_file?: unknown;
  backup_file?: unknown;
  old_hash?: unknown;
  old_file_missing?: unknown;
  restore_order?: unknown;
  replacement_kind?: unknown;
};

type RecoverySessionContext =
  | { scope: "requirement_canvas"; record: RequirementSessionRecord; file: string }
  | { scope: "product_component_library"; record: ComponentRecoverySessionRecord; file: string };

type ValidatedRecoveryJournalEntry = {
  target: string;
  backup: string;
  old_hash: string;
  old_file_missing: false;
  restore_order: number;
} | {
  target: string;
  old_file_missing: true;
  restore_order: number;
};

async function validateRecoveryJournalEntries(
  home: string,
  scope: "requirement_canvas" | "product_component_library",
  record: RequirementSessionRecord | ComponentRecoverySessionRecord,
  entries: RecoveryJournalEntry[]
): Promise<{ entries: ValidatedRecoveryJournalEntry[]; failed_files: Array<{ path: string; reason: string }> }> {
  if (!Array.isArray(entries)) {
    return { entries: [], failed_files: [{ path: "commit-journal.yaml", reason: "journal entries missing" }] };
  }
  const validated: ValidatedRecoveryJournalEntry[] = [];
  const failed_files: Array<{ path: string; reason: string }> = [];
  for (const entry of entries) {
    let target = typeof entry?.target_file === "string" ? entry.target_file : "unknown";
    try {
      if (!entry || typeof entry !== "object" || typeof entry.target_file !== "string" || typeof entry.restore_order !== "number") {
        throw new Error("journal entry metadata missing");
      }
      target = resolveInside(home, entry.target_file);
      if (scope === "requirement_canvas") {
        await validateRequirementCommitTarget(home, record as RequirementSessionRecord, target, entry.target_file);
      } else {
        await validateComponentRecoveryCommitTarget(home, record as ComponentRecoverySessionRecord, target, entry.target_file, entry.replacement_kind);
      }
      if (entry.old_file_missing === true) {
        validateRecoveryOldFileMissing(scope, record, entry.replacement_kind);
        validated.push({ target, old_file_missing: true, restore_order: entry.restore_order });
        continue;
      }
      if (typeof entry.backup_file !== "string" || typeof entry.old_hash !== "string") {
        throw new Error("backup metadata missing");
      }
      const backup = await validateRecoveryBackupFile(home, record.session_dir, entry.backup_file);
      validated.push({
        target,
        backup,
        old_hash: entry.old_hash,
        old_file_missing: false,
        restore_order: entry.restore_order
      });
    } catch (error) {
      failed_files.push({ path: target, reason: errorMessage(error) });
    }
  }
  return { entries: validated.sort((a, b) => b.restore_order - a.restore_order), failed_files };
}

function validateRecoveryOldFileMissing(
  scope: "requirement_canvas" | "product_component_library",
  record: RequirementSessionRecord | ComponentRecoverySessionRecord,
  replacementKind: unknown
): void {
  if (scope === "requirement_canvas") {
    if ((record as RequirementSessionRecord).base_canvas_revision) {
      throw new FormaError("INVALID_INPUT", "Recovery journal cannot mark an existing baseline canvas as missing", {
        expected: "backup_file and old_hash"
      });
    }
    return;
  }

  const componentRecord = record as ComponentRecoverySessionRecord;
  if (replacementKind === "component_version") {
    return;
  }
  if ((replacementKind === "component_latest" || replacementKind === "component_metadata") && componentRecord.previous_version === 0) {
    return;
  }
  if (replacementKind === "component_latest" || replacementKind === "component_metadata") {
    throw new FormaError("INVALID_INPUT", "Recovery journal cannot mark existing component baseline files as missing", {
      replacement_kind: replacementKind,
      previous_version: componentRecord.previous_version,
      expected: "backup_file and old_hash"
    });
  }
  throw new FormaError("INVALID_INPUT", "Component replacement kind is invalid", {
    replacement_kind: replacementKind
  });
}

async function validateComponentRecoveryCommitTarget(
  home: string,
  record: ComponentRecoverySessionRecord,
  target: string,
  targetFile: string,
  replacementKind: unknown
): Promise<void> {
  if (typeof replacementKind !== "string") {
    throw new FormaError("INVALID_INPUT", "Component replacement kind is invalid", {
      target_file: targetFile,
      replacement_kind: replacementKind
    });
  }
  await validateComponentCommitTarget(home, target, replacementKind);
  const expectedTarget = expectedComponentRecoveryTarget(home, record, replacementKind);
  if (target !== expectedTarget) {
    throw new FormaError("INVALID_INPUT", "Component commit target does not match the recovered session", {
      target_file: targetFile,
      expected_target_file: rel(home, expectedTarget),
      replacement_kind: replacementKind
    });
  }
}

function expectedComponentRecoveryTarget(home: string, record: ComponentRecoverySessionRecord, replacementKind: string): string {
  if (replacementKind === "component_version") {
    return join(home, "library", `${record.product_id}.versions`, `${record.target_version}.lib.pen`);
  }
  if (replacementKind === "component_latest") {
    return join(home, "library", `${record.product_id}.lib.pen`);
  }
  if (replacementKind === "component_metadata") {
    return join(home, "library", `${record.product_id}.components.yaml`);
  }
  throw new FormaError("INVALID_INPUT", "Component replacement kind is invalid", {
    replacement_kind: replacementKind
  });
}

async function validateRecoveryBackupFile(home: string, sessionDir: string, backupFile: string): Promise<string> {
  const backupPath = resolveInside(home, backupFile);
  const backupDir = join(sessionDir, "backup");
  if (backupPath === backupDir || !isSameOrChildPath(backupDir, backupPath)) {
    throw new FormaError("INVALID_INPUT", "Recovery backup file must be under the session backup directory", {
      backup_file: backupFile,
      expected_backup_dir: rel(home, backupDir)
    });
  }
  const backupDirStat = await lstat(backupDir);
  if (backupDirStat.isSymbolicLink() || !backupDirStat.isDirectory()) {
    throw new FormaError("INVALID_INPUT", "Recovery backup directory must be a real directory", {
      backup_dir: rel(home, backupDir)
    });
  }
  const backupStat = await lstat(backupPath);
  if (backupStat.isSymbolicLink() || !backupStat.isFile()) {
    throw new FormaError("INVALID_INPUT", "Recovery backup file must be a regular file", {
      backup_file: backupFile
    });
  }
  const backupDirReal = await realpath(backupDir);
  const backupReal = await realpath(backupPath);
  if (!isSameOrChildPath(backupDirReal, backupReal)) {
    throw new FormaError("INVALID_INPUT", "Recovery backup file real path must stay under the session backup directory", {
      backup_file: backupFile,
      expected_backup_dir: rel(home, backupDir)
    });
  }
  return backupPath;
}

async function updateRecoverySessionStatus(home: string, session: RecoverySessionContext, status: "failed_commit" | "commit_recovery_required"): Promise<void> {
  if (session.scope === "requirement_canvas") {
    const updated: RequirementSessionRecord = { ...session.record, status, updated_at: new Date().toISOString() };
    await updateSessionRecord(home, session.file, updated);
  } else {
    const updated: ComponentRecoverySessionRecord = { ...session.record, status, updated_at: new Date().toISOString() };
    await writeYamlAtomic(session.file, serializeComponentRecoverySessionRecord(home, updated));
  }
}

async function readComponentRecoverySessionRecord(home: string, file: string): Promise<ComponentRecoverySessionRecord> {
  const raw = await readYaml<unknown>(file);
  const parsed = componentRecoverySessionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FormaError("INVALID_INPUT", "Component session metadata is invalid", { path: file });
  }
  const persisted = parsed.data;
  const sessionDir = dirname(file);
  const expectedSessionDirRelative = rel(home, sessionDir);
  const expectedSessionDir = join(home, "library", `${persisted.product_id}.sessions`, persisted.session_id);
  if (sessionDir !== expectedSessionDir || persisted.session_dir_relative !== expectedSessionDirRelative || persisted.session_dir !== persisted.session_dir_relative) {
    throw new FormaError("INVALID_INPUT", "Component session directory metadata is invalid", {
      session_id: persisted.session_id,
      expected_session_dir: expectedSessionDirRelative,
      session_dir_relative: persisted.session_dir_relative,
      session_dir: persisted.session_dir
    });
  }
  const canvasPath = resolveInside(home, persisted.canvas_file);
  const stagingPath = resolveInside(home, persisted.staging_file);
  const operationLogFile = resolveInside(home, persisted.operation_log_file_relative);
  const pathPairs = [
    ["canvas_path", persisted.canvas_path, persisted.canvas_file],
    ["staging_path", persisted.staging_path, persisted.staging_file],
    ["operation_log_file", persisted.operation_log_file, persisted.operation_log_file_relative]
  ] as const;
  for (const [field, actual, expected] of pathPairs) {
    if (actual !== expected) {
      throw new FormaError("INVALID_INPUT", "Component session path metadata is invalid", {
        session_id: persisted.session_id,
        field,
        expected,
        actual
      });
    }
  }
  if (canvasPath !== join(home, "library", `${persisted.product_id}.lib.pen`) || dirname(stagingPath) !== sessionDir || dirname(operationLogFile) !== sessionDir) {
    throw new FormaError("INVALID_INPUT", "Component session operational paths must match the discovered session directory", {
      session_id: persisted.session_id,
      session_dir: expectedSessionDirRelative
    });
  }
  return {
    ...persisted,
    session_dir: sessionDir,
    canvas_path: canvasPath,
    staging_path: stagingPath,
    operation_log_file: operationLogFile
  };
}

function serializeComponentRecoverySessionRecord(home: string, record: ComponentRecoverySessionRecord): ComponentRecoverySessionPersistedRecord {
  return componentRecoverySessionSchema.parse({
    ...record,
    session_dir_relative: rel(home, record.session_dir),
    session_dir: rel(home, record.session_dir),
    canvas_file: rel(home, record.canvas_path),
    canvas_path: rel(home, record.canvas_path),
    staging_file: rel(home, record.staging_path),
    staging_path: rel(home, record.staging_path),
    operation_log_file_relative: rel(home, record.operation_log_file),
    operation_log_file: rel(home, record.operation_log_file)
  });
}

async function readRequirementSessionRecord(home: string, file: string): Promise<RequirementSessionRecord> {
  const raw = await readYaml<unknown>(file);
  const parsed = persistedSessionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FormaError("INVALID_INPUT", "Requirement session metadata is invalid", { path: file });
  }
  const persisted = parsed.data;
  const sessionDir = dirname(file);
  const expectedSessionDirRelative = rel(home, sessionDir);
  const expectedSessionDir = join(home, "data", persisted.product_id, persisted.requirement_id, "sessions", persisted.session_id);
  if (sessionDir !== expectedSessionDir || persisted.session_dir_relative !== expectedSessionDirRelative || persisted.session_dir !== persisted.session_dir_relative) {
    throw new FormaError("INVALID_INPUT", "Requirement session directory metadata is invalid", {
      session_id: persisted.session_id,
      expected_session_dir: expectedSessionDirRelative,
      session_dir_relative: persisted.session_dir_relative,
      session_dir: persisted.session_dir
    });
  }
  const canvasPath = resolveInside(home, persisted.canvas_file);
  const stagingPath = resolveInside(home, persisted.staging_file);
  const operationLogFile = resolveInside(home, persisted.operation_log_file_relative);
  const semanticScopeFile = resolveInside(home, persisted.semantic_scope_file_relative);
  const pathPairs = [
    ["canvas_path", persisted.canvas_path, persisted.canvas_file],
    ["staging_path", persisted.staging_path, persisted.staging_file],
    ["operation_log_file", persisted.operation_log_file, persisted.operation_log_file_relative],
    ["semantic_scope_file", persisted.semantic_scope_file, persisted.semantic_scope_file_relative]
  ] as const;
  for (const [field, actual, expected] of pathPairs) {
    if (actual !== expected) {
      throw new FormaError("INVALID_INPUT", "Requirement session path metadata is invalid", {
        session_id: persisted.session_id,
        field,
        expected,
        actual
      });
    }
  }
  if (dirname(stagingPath) !== sessionDir || dirname(operationLogFile) !== sessionDir || dirname(semanticScopeFile) !== sessionDir) {
    throw new FormaError("INVALID_INPUT", "Requirement session operational paths must stay inside the discovered session directory", {
      session_id: persisted.session_id,
      session_dir: expectedSessionDirRelative
    });
  }
  return {
    ...persisted,
    session_dir: sessionDir,
    canvas_path: canvasPath,
    staging_path: stagingPath,
    operation_log_file: operationLogFile,
    semantic_scope_file: semanticScopeFile
  };
}

function serializeRequirementSessionRecord(home: string, record: RequirementSessionRecord): RequirementSessionPersistedRecord {
  return persistedSessionSchema.parse({
    ...record,
    session_dir: rel(home, record.session_dir),
    canvas_path: record.canvas_file,
    staging_path: record.staging_file,
    operation_log_file: record.operation_log_file_relative,
    semantic_scope_file: record.semantic_scope_file_relative,
    session_dir_relative: rel(home, record.session_dir),
    canvas_file: rel(home, record.canvas_path),
    staging_file: rel(home, record.staging_path),
    operation_log_file_relative: rel(home, record.operation_log_file),
    semantic_scope_file_relative: rel(home, record.semantic_scope_file)
  });
}

async function updateSessionRecord(home: string, file: string, record: RequirementSessionRecord): Promise<void> {
  await writeYamlAtomic(file, serializeRequirementSessionRecord(home, record));
}

async function nextOperationSequence(file: string): Promise<number> {
  const raw = await readFile(file, "utf8").catch(() => "");
  return raw.split(/\r?\n/).filter((line) => line.trim()).length + 1;
}

async function latestFailedSequence(file: string): Promise<number | undefined> {
  const raw = await readFile(file, "utf8").catch(() => "");
  const entries = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const failed = entries.reverse().find((entry) => entry.status === "failed" && typeof entry.sequence === "number");
  return failed?.sequence as number | undefined;
}

async function appendJsonl(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value)}\n`, { flag: "a" });
}

async function replaceJsonlBySequence(file: string, sequence: number, updater: (entry: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const raw = await readFile(file, "utf8").catch(() => "");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  let replaced = false;
  const updated = lines.map((line) => {
    const entry = JSON.parse(line) as Record<string, unknown>;
    if (entry.sequence !== sequence) {
      return line;
    }
    replaced = true;
    return JSON.stringify(updater(entry));
  });
  if (!replaced) {
    updated.push(JSON.stringify(updater({ sequence })));
  }
  await writeFile(file, `${updated.join("\n")}\n`, "utf8");
}

async function restoreJournalEntries(
  home: string,
  record: RequirementSessionRecord,
  entries: Array<{ target_file: string; backup_file?: string; old_hash?: string; old_file_missing?: boolean; restore_order: number }>
): Promise<{ failed_files: Array<{ path: string; reason: string }> }> {
  const failed_files = [];
  for (const entry of [...entries].sort((a, b) => b.restore_order - a.restore_order)) {
    const target = resolveInside(home, entry.target_file);
    try {
      await validateRequirementCommitTarget(home, record, target, entry.target_file);
      if (entry.old_file_missing) {
        await rm(target, { force: true });
      } else if (entry.backup_file) {
        const tempTarget = join(dirname(target), `.forma-restore-${randomBytes(8).toString("hex")}.tmp`);
        if (!entry.old_hash) {
          throw new Error("backup metadata missing");
        }
        await restoreVerifiedBackup(resolveInside(home, entry.backup_file), tempTarget, target, entry.old_hash);
      } else {
        throw new Error("backup metadata missing");
      }
      if (entry.old_hash && await hashFile(target) !== entry.old_hash) {
        throw new Error("restored hash mismatch");
      }
    } catch (error) {
      failed_files.push({ path: target, reason: errorMessage(error) });
    }
  }
  return { failed_files };
}

async function validateRequirementCommitTarget(
  home: string,
  record: RequirementSessionRecord,
  targetPath: string,
  targetFile: string
): Promise<{ exists: false } | { exists: true; hash: string }> {
  const requirementDir = dirname(record.canvas_path);
  const allowedTarget =
    targetPath === record.canvas_path ||
    targetPath === join(requirementDir, "design.yaml") ||
    targetPath === join(requirementDir, "requirement.yaml") ||
    isSameOrChildPath(join(requirementDir, "previews"), targetPath) ||
    isSameOrChildPath(join(requirementDir, "history"), targetPath);
  if (!allowedTarget || targetPath.split("/").some((part) => /^D-[A-Za-z0-9]/.test(part))) {
    throw new FormaError("INVALID_INPUT", "Requirement commit target must stay under requirement-level design state for the active requirement design canvas", {
      target_file: targetFile,
      expected_requirement_dir: rel(home, requirementDir)
    });
  }
  const homeReal = await realpath(home);
  await mkdir(dirname(targetPath), { recursive: true });
  const targetParentReal = await realpath(dirname(targetPath));
  const expectedRequirementReal = await realpath(requirementDir);
  if (!isSameOrChildPath(expectedRequirementReal, targetParentReal) || !isSameOrChildPath(homeReal, targetParentReal)) {
    throw new FormaError("INVALID_INPUT", "Requirement commit target parent is invalid", {
      target_file: targetFile,
      expected_parent: rel(home, requirementDir)
    });
  }
  const stat = await lstat(targetPath).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!stat) return { exists: false };
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new FormaError("INVALID_INPUT", "Requirement commit target must be a regular file", {
      target_file: targetFile
    });
  }
  return { exists: true, hash: await hashFile(targetPath) };
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return [];
    }
    throw error;
  }
}

async function isDirectoryPath(path: string): Promise<boolean> {
  const stat = await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return undefined;
    throw error;
  });
  return stat?.isDirectory() === true;
}

async function hashFile(file: string): Promise<string> {
  return `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
}

async function restoreVerifiedBackup(backup: string, tempTarget: string, target: string, oldHash: string): Promise<void> {
  try {
    await copyFile(backup, tempTarget);
    if (await hashFile(tempTarget) !== oldHash) {
      throw new Error("backup hash mismatch");
    }
    await rename(tempTarget, target);
  } finally {
    await rm(tempTarget, { force: true });
  }
}

function resolveInside(home: string, relativePath: string): string {
  const resolved = resolve(home, relativePath);
  if (resolved !== home && !resolved.startsWith(`${home}/`)) {
    throw new FormaError("INVALID_INPUT", "Path escapes Forma home", { path: relativePath });
  }
  return resolved;
}

function isSameOrChildPath(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function rel(home: string, file: string): string {
  return relative(home, file);
}

function parseProductId(productId: string): string {
  const parsed = productIdSchema.safeParse(productId);
  if (!parsed.success) {
    throw new FormaError("INVALID_INPUT", "Product id is invalid", { product_id: productId });
  }
  return parsed.data;
}

function parseRequirementId(requirementId: string): string {
  const parsed = requirementIdSchema.safeParse(requirementId);
  if (!parsed.success) {
    throw new FormaError("INVALID_INPUT", "Requirement id is invalid", { requirement_id: requirementId });
  }
  return parsed.data;
}

function minimalLegalPen(): string {
  return `${JSON.stringify({ schema_version: 1, children: [{ id: "root", type: "frame", name: "Empty canvas" }] }, null, 2)}\n`;
}

function componentLibraryError(productId: string, status: string, details: Record<string, unknown>): FormaError {
  const payload = {
    product_id: productId,
    status,
    components_yaml_path: details.metadata_path,
    required_action: "generate_components",
    ...details
  };
  if (status === "metadata_missing") {
    return new FormaError("COMPONENT_LIBRARY_METADATA_MISSING", "Product component library metadata is missing", payload);
  }
  if (status === "missing" || status === "version_snapshot_missing") {
    return new FormaError("COMPONENT_LIBRARY_VERSION_MISSING", "Product component library version snapshot is missing", payload);
  }
  if (status === "latest_file_missing") {
    return new FormaError("COMPONENT_LIBRARY_LATEST_MISSING", "Product component library latest file is missing", payload);
  }
  return new FormaError("COMPONENT_LIBRARY_INVALID", "Product component library is invalid", payload);
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return false;
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
