import { createHash, randomBytes } from "node:crypto";
import { access, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { componentLibraryMetadataSchema, getProductComponentLibrary, type ComponentLibraryMetadata } from "./components.js";
import { indexRequirementComponentUsageDocument } from "./component-usage.js";
import { FormaError } from "./errors.js";
import { PencilAppSessionAdapter, rejectPathLikeParameters, type PencilInteractiveProcessFactory } from "./pencil-adapter.js";
import { defaultPencilRunner, type PencilRunner } from "./pencil.js";
import { parsePenDocument, walkPenNodes } from "./pen-model.js";
import { productIdSchema } from "./product.js";
import { getPencilMutationLock, getProductMutationLock } from "./product-mutation-lock.js";
import { requirementSchema } from "./requirement.js";
import { parseSessionId, sessionIdSchema } from "./session-id.js";
import { readYaml, readYamlAs, writeYamlAtomic } from "./yaml.js";

export interface ProductComponentSeed {
  component_key: string;
  name?: string;
  semantic_contract_hash?: string;
  source?: string;
  required_by?: Array<{ requirement_id: string; page_id?: string }>;
}

type ComponentSessionStatus =
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
const componentSessionSchema = z.object({
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
  status: z.enum([
    "running",
    "blocked_manual_edit",
    "failed_operation",
    "committing",
    "committed",
    "failed_commit",
    "commit_recovery_required",
    "discarded",
    "recoverable"
  ])
});

type ComponentSessionPersistedRecord = z.infer<typeof componentSessionSchema>;
type ComponentSessionRecord = Omit<ComponentSessionPersistedRecord, "session_dir" | "canvas_path" | "staging_path" | "operation_log_file"> & {
  session_dir: string;
  canvas_path: string;
  staging_path: string;
  operation_log_file: string;
  status: ComponentSessionStatus;
};

export async function beginProductComponentSession(input: {
  home: string;
  product_id: string;
  operation: "generate" | "refine" | "change_style";
  seed_components?: ProductComponentSeed[];
  newly_required_component_keys?: string[];
  runner?: PencilRunner;
  processFactory?: PencilInteractiveProcessFactory;
}): Promise<{ session_id: string; pencil_binding_id: string; canvas_path: string; staging_path: string; mode: "app" }> {
  if (input.operation === "generate" && (!input.seed_components || input.seed_components.length === 0)) {
    throw new FormaError("COMPONENT_SEED_REQUIRED", "seed_components are required for component generation", { required: "seed_components" });
  }
  const seedKeys = new Set((input.seed_components ?? []).map((seed) => seed.component_key));
  const missingSeedKeys = (input.newly_required_component_keys ?? []).filter((key) => !seedKeys.has(key));
  if (missingSeedKeys.length > 0) {
    throw new FormaError("COMPONENT_SEED_REQUIRED", "Newly required component keys must have explicit seeds", {
      missing_component_keys: missingSeedKeys
    });
  }
  const home = resolve(input.home);
  const productId = parseProductId(input.product_id);
  const runner = input.runner ?? defaultPencilRunner;
  const adapter = new PencilAppSessionAdapter({ home, runner, processFactory: input.processFactory });
  await adapter.preflight();
  const versionPlan = await readComponentVersionPlan(home, productId, input.operation);

  return getProductMutationLock(home).run({ operation: "begin_product_component_session", product_id: productId, scope: "product_component_library" }, async () =>
    getPencilMutationLock(home).run({ operation: "begin_product_component_session", product_id: productId, scope: "pencil" }, async () => {
    const sessionId = `S-${randomBytes(8).toString("hex")}`;
    const sessionsRoot = join(home, "library", `${productId}.sessions`);
    const activeFile = join(sessionsRoot, "active.yaml");
    const productLease = join(home, "data", productId, "sessions", "active-design-session.yaml");
    if (await hasNonTerminalLease(activeFile) || await hasNonTerminalLease(productLease)) {
      throw new FormaError("DESIGN_SESSION_ACTIVE", "Design session is already active", { product_id: productId });
    }
    const sessionDir = join(sessionsRoot, sessionId);
    const canvasPath = join(home, "library", `${productId}.lib.pen`);
    const stagingPath = join(sessionDir, "staging.lib.pen");
    let baseCanvasRevision: string | undefined;
    await mkdir(sessionDir, { recursive: true });
    if (await pathExists(canvasPath)) {
      await copyFile(canvasPath, stagingPath);
      baseCanvasRevision = await hashFile(canvasPath);
    } else {
      await writeFile(stagingPath, JSON.stringify({ schema_version: 1, children: [{ id: "components", type: "frame" }] }, null, 2));
    }
    const nowBeforeOpen = new Date().toISOString();
    await writeYamlAtomic(activeFile, {
      session_id: sessionId,
      scope: "product_component_library",
      canvas_path: relative(home, canvasPath),
      staging_path: relative(home, stagingPath),
      status: "created",
      updated_at: nowBeforeOpen
    });
    await writeYamlAtomic(productLease, {
      session_id: sessionId,
      scope: "product_component_library",
      owner_path: relative(home, activeFile),
      local_active_path: relative(home, activeFile),
      canvas_path: relative(home, canvasPath),
      staging_path: relative(home, stagingPath),
      status: "created",
      updated_at: nowBeforeOpen
    });
    let binding;
    try {
      binding = await adapter.openSession({ session_id: sessionId, staging_path: stagingPath, expected_session_dir: sessionDir });
    } catch (error) {
      const cleanup = await rollbackComponentBegin({ productLease, activeFile, stagingPath, sessionDir, sessionId });
      const failedDir = join(sessionsRoot, "failed-begins");
      const failedReason = error instanceof FormaError && typeof error.details.reason === "string" ? error.details.reason : errorMessage(error);
      await writeYamlAtomic(join(failedDir, `${sessionId}.yaml`), {
        session_id: sessionId,
        status: "failed_begin",
        error_code: error instanceof FormaError ? error.code : "PENCIL_APP_REQUIRED",
        failed_phase: error instanceof FormaError ? error.details.failed_phase ?? "open_app" : "open_app",
        command: `pencil interactive --app desktop --in ${stagingPath}`,
        reason: failedReason,
        cleanup_status: cleanup,
        pencil_version: error instanceof FormaError ? error.details.pencil_version : undefined
      }).catch(async (writeError: unknown) => {
        await mkdir(failedDir, { recursive: true }).catch(() => undefined);
        await writeFile(join(failedDir, `${sessionId}.warning.log`), `failed_begin_summary_write_failed:${errorMessage(writeError)}\n`, "utf8").catch(() => undefined);
      });
      throw new FormaError("PENCIL_APP_REQUIRED", "Pencil App is required", {
        session_id: sessionId,
        failed_phase: error instanceof FormaError ? error.details.failed_phase ?? "open_app" : "open_app",
        command: `pencil interactive --app desktop --in ${stagingPath}`,
        reason: failedReason,
        cleanup_status: cleanup,
        ...(error instanceof FormaError && error.details.pencil_version ? { pencil_version: error.details.pencil_version } : {})
      });
    }
    try {
      const revision = await hashFile(stagingPath);
      const now = new Date().toISOString();
      const record: ComponentSessionRecord = {
        schema_version: 1,
        session_id: sessionId,
        scope: "product_component_library",
        product_id: productId,
        session_dir_relative: relative(home, sessionDir),
        session_dir: sessionDir,
        operation: input.operation,
        seed_components: input.seed_components ?? [],
        mode: "app",
        canvas_file: relative(home, canvasPath),
        canvas_path: canvasPath,
        staging_file: relative(home, stagingPath),
        staging_path: stagingPath,
        pencil_binding_id: binding.pencil_binding_id,
        pencil_command: binding.command,
        pencil_version: binding.version,
        previous_version: versionPlan.previous_version,
        target_version: versionPlan.target_version,
        ...(baseCanvasRevision ? { base_canvas_revision: baseCanvasRevision } : {}),
        started_revision: revision,
        last_saved_revision: revision,
        last_controlled_revision: revision,
        operation_log_file_relative: relative(home, join(sessionDir, "operations.jsonl")),
        operation_log_file: join(sessionDir, "operations.jsonl"),
        started_at: now,
        updated_at: now,
        pid: binding.pid,
        status: "running"
      };
      await writeFile(record.operation_log_file, "");
      await writeYamlAtomic(activeFile, {
        session_id: sessionId,
        scope: "product_component_library",
        canvas_path: record.canvas_file,
        staging_path: record.staging_file,
        status: "running",
        updated_at: now
      });
      await writeYamlAtomic(join(home, "data", productId, "sessions", "active-design-session.yaml"), {
        session_id: sessionId,
        scope: "product_component_library",
        owner_path: relative(home, activeFile),
        local_active_path: relative(home, activeFile),
        canvas_path: record.canvas_file,
        staging_path: record.staging_file,
        status: "running",
        updated_at: now
      });
      await writeYamlAtomic(join(sessionDir, "design_session.yaml"), serializeComponentSessionRecord(home, record));
      return { session_id: sessionId, pencil_binding_id: binding.pencil_binding_id, canvas_path: canvasPath, staging_path: stagingPath, mode: "app" as const };
    } catch (error) {
      await adapter.closeBinding(binding.pencil_binding_id).catch(() => undefined);
      await rollbackComponentBegin({ productLease, activeFile, stagingPath, sessionDir, sessionId });
      throw error;
    }
    }));
}

function parseProductId(productId: string): string {
  const parsed = productIdSchema.safeParse(productId);
  if (!parsed.success) {
    throw new FormaError("INVALID_INPUT", "Product id is invalid", { product_id: productId });
  }
  return parsed.data;
}

export async function applyProductComponentOperations(input: {
  home: string;
  session_id: string;
  operations: Array<{ tool: "batch_design" | "set_variables"; args: Record<string, unknown>; target_node_ids?: string[]; intent: string }>;
  runner?: PencilRunner;
  processFactory?: PencilInteractiveProcessFactory;
}): Promise<{ session_id: string; status: "running" }> {
  for (const operation of input.operations) {
    if (operation.tool !== "batch_design" && operation.tool !== "set_variables") {
      throw new FormaError("INVALID_INPUT", "Component sessions allow batch_design and set_variables only", { tool: operation.tool });
    }
    rejectPathLikeParameters(operation.args);
  }
  const home = resolve(input.home);
  const { file: sessionFile, record } = await findComponentSession(home, input.session_id);
  const adapter = new PencilAppSessionAdapter({ home, runner: input.runner ?? defaultPencilRunner, processFactory: input.processFactory });
  return await getProductMutationLock(home).run({ operation: "apply_product_component_operations", product_id: record.product_id, session_id: record.session_id, scope: "product_component_library" }, async () =>
    getPencilMutationLock(home).run({ operation: "apply_product_component_operations", product_id: record.product_id, session_id: record.session_id, scope: "pencil" }, async () => {
  if (record.status !== "running" && record.status !== "failed_operation") {
    throw new FormaError("INVALID_INPUT", "Session cannot apply operations", { status: record.status });
  }
  const stagingPath = record.staging_path;
  try {
    await adapter.assertLiveBinding(record.pencil_binding_id, stagingPath);
    await adapter.controlledSave(record.pencil_binding_id);
  } catch (error) {
    if (error instanceof FormaError && error.code === "PENCIL_APP_REQUIRED") {
      await writeComponentSessionRecord(home, sessionFile, { ...record, status: "recoverable", updated_at: new Date().toISOString() });
    }
    throw error;
  }
  const before = await hashFile(stagingPath);
  if (before !== record.last_controlled_revision) {
    await writeComponentSessionRecord(home, sessionFile, { ...record, status: "blocked_manual_edit", updated_at: new Date().toISOString() });
    throw new FormaError("MANUAL_EDIT_DETECTED", "Current component canvas has uncontrolled changes", { session_id: record.session_id });
  }
  let currentRecord = record;
  let sequence = await nextComponentOperationSequence(record.operation_log_file);
  const retryOfSequence = record.status === "failed_operation" ? await latestComponentFailedSequence(record.operation_log_file) : undefined;
  for (const operation of input.operations) {
    const pendingEntry = {
      sequence,
      tool: operation.tool,
      args: operation.args,
      target_node_ids: operation.target_node_ids ?? [],
      intent: operation.intent,
      before_revision: currentRecord.last_controlled_revision,
      status: "pending",
      pencil_binding_id: currentRecord.pencil_binding_id,
      ...(retryOfSequence ? { retry_of_sequence: retryOfSequence } : {})
    };
    let saveSucceeded = false;
    try {
      await appendComponentJsonl(currentRecord.operation_log_file, pendingEntry);
      await adapter.executeWriteTool(currentRecord.pencil_binding_id, operation.tool, operation.args);
      await adapter.controlledSave(currentRecord.pencil_binding_id);
      saveSucceeded = true;
      const after = await hashFile(stagingPath);
      await replaceComponentJsonlBySequence(currentRecord.operation_log_file, sequence, (entry) => ({
        ...entry,
        status: "applied",
        after_revision: after,
        applied_at: new Date().toISOString()
      }));
      currentRecord = {
        ...currentRecord,
        status: "running",
        last_saved_revision: after,
        last_controlled_revision: after,
        updated_at: new Date().toISOString()
      };
      await writeComponentSessionRecord(home, sessionFile, currentRecord);
      sequence += 1;
    } catch (error) {
      const failedRevision = saveSucceeded
        ? await hashFile(stagingPath).catch(() => currentRecord.last_controlled_revision)
        : currentRecord.last_controlled_revision;
      await replaceComponentJsonlBySequence(currentRecord.operation_log_file, sequence, (entry) => ({
        ...pendingEntry,
        ...entry,
        status: "failed",
        error: errorMessage(error),
        failed_at: new Date().toISOString()
      }));
      await writeComponentSessionRecord(home, sessionFile, {
        ...currentRecord,
        status: "failed_operation",
        last_saved_revision: failedRevision,
        last_controlled_revision: failedRevision,
        updated_at: new Date().toISOString()
      });
      throw error;
    }
  }
  return { session_id: record.session_id, status: "running" as const };
    }));
}

export async function commitProductComponentSession(input: { home: string; session_id: string; processFactory?: PencilInteractiveProcessFactory }): Promise<{ session_id: string; status: "committed" }> {
  const home = resolve(input.home);
  const { file: sessionFile, record } = await findComponentSession(home, input.session_id);
  if (record.status !== "running") {
    throw new FormaError("INVALID_INPUT", "Session is not running", { status: record.status });
  }
  const adapter = new PencilAppSessionAdapter({ home, runner: defaultPencilRunner, processFactory: input.processFactory });
  return await getProductMutationLock(home).run({ operation: "commit_product_component_session", product_id: record.product_id, session_id: record.session_id, scope: "product_component_library" }, async () =>
    getPencilMutationLock(home).run({ operation: "commit_product_component_session", product_id: record.product_id, session_id: record.session_id, scope: "pencil" }, async () => {
  const stagingPath = record.staging_path;
  try {
    await adapter.assertLiveBinding(record.pencil_binding_id, stagingPath);
    await adapter.controlledSave(record.pencil_binding_id);
  } catch (error) {
    if (error instanceof FormaError && error.code === "PENCIL_APP_REQUIRED") {
      await writeComponentSessionRecord(home, sessionFile, { ...record, status: "recoverable", updated_at: new Date().toISOString() });
    }
    throw error;
  }
  const controlledRevision = await hashFile(stagingPath);
  if (controlledRevision !== record.last_controlled_revision) {
    await writeComponentSessionRecord(home, sessionFile, { ...record, status: "blocked_manual_edit", updated_at: new Date().toISOString() });
    throw new FormaError("MANUAL_EDIT_DETECTED", "Current component canvas has uncontrolled changes", { session_id: record.session_id });
  }
  validateComponentSeeds(record.seed_components);
  const canvasPath = record.canvas_path;
  const version = Number(record.target_version);
  if (!Number.isInteger(version) || version < 1) {
    throw new FormaError("INVALID_INPUT", "Component session target_version is invalid", { session_id: record.session_id, target_version: record.target_version });
  }
  const versionFile = join(home, "library", `${record.product_id}.versions`, `${version}.lib.pen`);
  const metadataPath = join(home, "library", `${record.product_id}.components.yaml`);
  const metadataCandidate = join(dirname(sessionFile), "candidate.components.yaml");
  const checksum = await hashFile(stagingPath);
  await mkdir(dirname(versionFile), { recursive: true });
  await validateComponentCommitTarget(home, versionFile, "component_version");
  await validateComponentCommitTarget(home, metadataPath, "component_metadata");
  const existingMetadata = await assertComponentCommitBaseline(home, record, metadataPath, canvasPath);
  const existingVersions = existingMetadata?.versions ?? [];
  if (await pathExists(versionFile) || existingVersions.some((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).version === version)) {
    throw new FormaError("INVALID_INPUT", "Component target version is already occupied", {
      session_id: record.session_id,
      product_id: record.product_id,
      target_version: version,
      version_file: relative(home, versionFile)
    });
  }
  await writeYamlAtomic(metadataCandidate, {
    product_id: record.product_id,
    current_version: version,
    latest_file: `${record.product_id}.lib.pen`,
    versions: [
      ...existingVersions,
      {
        version,
        file: `${record.product_id}.versions/${version}.lib.pen`,
        checksum,
        components: componentMetadataFromSeeds(record.seed_components),
        session_id: record.session_id,
        audit_link: relative(home, sessionFile)
      }
    ]
  });
  const metadataCandidateHash = await hashFile(metadataCandidate);
  const journalPath = join(dirname(sessionFile), "commit-journal.yaml");
  const backupDir = join(dirname(sessionFile), "backup");
  await mkdir(backupDir, { recursive: true });
  const entries = await prepareComponentCommitEntries(home, [
    {
      targetPath: versionFile,
      candidatePath: stagingPath,
      candidateHash: checksum,
      backupPath: join(backupDir, `1-${version}.lib.pen.bak`),
      replacementKind: "component_version",
      restoreOrder: 1
    },
    {
      targetPath: canvasPath,
      candidatePath: stagingPath,
      candidateHash: checksum,
      backupPath: join(backupDir, "2-latest.lib.pen.bak"),
      replacementKind: "component_latest",
      restoreOrder: 2
    },
    {
      targetPath: metadataPath,
      candidatePath: metadataCandidate,
      candidateHash: metadataCandidateHash,
      backupPath: join(backupDir, "3-components.yaml.bak"),
      replacementKind: "component_metadata",
      restoreOrder: 3
    }
  ]);
  await writeYamlAtomic(journalPath, {
    schema_version: 1,
    session_id: record.session_id,
    scope: "product_component_library",
    status: "committing",
    entries
  });
  await writeComponentSessionRecord(home, sessionFile, { ...record, status: "committing", updated_at: new Date().toISOString() });
  try {
    for (const entry of entries.sort((a, b) => a.restore_order - b.restore_order)) {
      const target = resolveInside(home, entry.target_file);
      await validateComponentCommitTarget(home, target, entry.replacement_kind);
      const tempTarget = join(dirname(target), `.forma-${randomBytes(8).toString("hex")}.tmp`);
      await copyFile(resolveInside(home, entry.candidate_file), tempTarget);
      await rename(tempTarget, target);
      entry.status = "promoted";
      await writeYamlAtomic(journalPath, { schema_version: 1, session_id: record.session_id, scope: "product_component_library", status: "committing", entries });
      if (await hashFile(target) !== entry.candidate_hash) {
        throw new Error("component commit verification failed");
      }
    }
  } catch (error) {
    const recovery = await restoreComponentCommitEntries(home, entries);
    if (recovery.failed_files.length > 0) {
      await writeComponentSessionRecord(home, sessionFile, { ...record, status: "commit_recovery_required", updated_at: new Date().toISOString() });
      await writeYamlAtomic(journalPath, { schema_version: 1, session_id: record.session_id, scope: "product_component_library", status: "restore_failed", entries, failed_files: recovery.failed_files });
      throw new FormaError("DESIGN_COMMIT_RECOVERY_REQUIRED", "Product component commit recovery required", { session_id: record.session_id });
    }
    await writeComponentSessionRecord(home, sessionFile, { ...record, status: "failed_commit", updated_at: new Date().toISOString() });
    await writeYamlAtomic(journalPath, { schema_version: 1, session_id: record.session_id, scope: "product_component_library", status: "restored", entries });
    throw error;
  }
  await writeYamlAtomic(journalPath, { schema_version: 1, session_id: record.session_id, scope: "product_component_library", status: "committed", entries });
  await writeComponentSessionRecord(home, sessionFile, { ...record, status: "committed", updated_at: new Date().toISOString() });
  const warningFile = join(dirname(sessionFile), "lease-cleanup-warnings.jsonl");
  await clearLeaseIfMatches(join(home, "library", `${record.product_id}.sessions`, "active.yaml"), record.session_id, warningFile);
  await clearLeaseIfMatches(join(home, "data", record.product_id, "sessions", "active-design-session.yaml"), record.session_id, warningFile);
  await adapter.closeBinding(record.pencil_binding_id);
  return { session_id: record.session_id, status: "committed" as const };
    }));
}

export async function discardProductComponentSession(input: {
  home: string;
  session_id: string;
  processFactory?: PencilInteractiveProcessFactory;
}): Promise<{ session_id: string; status: "discarded" }> {
  const home = resolve(input.home);
  const { file: sessionFile, record } = await findComponentSession(home, input.session_id);
  const adapter = new PencilAppSessionAdapter({ home, runner: defaultPencilRunner, processFactory: input.processFactory });
  return await getProductMutationLock(home).run({ operation: "discard_product_component_session", product_id: record.product_id, session_id: record.session_id, scope: "product_component_library" }, async () =>
    getPencilMutationLock(home).run({ operation: "discard_product_component_session", product_id: record.product_id, session_id: record.session_id, scope: "pencil" }, async () => {
      const warningFile = join(dirname(sessionFile), "lease-cleanup-warnings.jsonl");
      await assertComponentDiscardLeaseMatches(join(home, "data", record.product_id, "sessions", "active-design-session.yaml"), record.session_id, record, warningFile);
      await assertComponentDiscardLeaseMatches(join(home, "library", `${record.product_id}.sessions`, "active.yaml"), record.session_id, record, warningFile);
      await assertDiscardJournalPath(record.session_dir);
      const allowDisconnectedDiscard = record.status === "failed_commit" || record.status === "recoverable";
      if (!allowDisconnectedDiscard) {
        try {
          await adapter.assertLiveBinding(record.pencil_binding_id, record.staging_path);
        } catch (error) {
          if (error instanceof FormaError && error.code === "PENCIL_APP_REQUIRED") {
            await writeComponentSessionRecord(home, sessionFile, { ...record, status: "recoverable", updated_at: new Date().toISOString() });
          }
          throw error;
        }
      }
      await rm(record.staging_path, { force: true });
      await writeComponentSessionRecord(home, sessionFile, { ...record, status: "discarded", updated_at: new Date().toISOString() });
      await clearLeaseIfMatches(join(home, "library", `${record.product_id}.sessions`, "active.yaml"), record.session_id, warningFile);
      await clearLeaseIfMatches(join(home, "data", record.product_id, "sessions", "active-design-session.yaml"), record.session_id, warningFile);
      if (!allowDisconnectedDiscard) {
        await adapter.closeBinding(record.pencil_binding_id);
      }
      return { session_id: record.session_id, status: "discarded" as const };
    }));
}

export async function refreshRequirementComponents(input: {
  home: string;
  session_id: string;
  target_component_library_version?: number;
  page_ids?: string[];
}): Promise<{
  session_id: string;
  status: "planned";
  operations: Array<{ tool: "batch_design"; args: Record<string, unknown>; target_node_ids: string[]; intent: "component_refresh" }>;
}> {
  const home = resolve(input.home);
  const record = await findLooseRequirementSession(home, input.session_id);
  const library = await getProductComponentLibrary(home, record.product_id);
  if (library.status !== "complete" || !library.current_version) {
    throw new FormaError("COMPONENT_LIBRARY_INVALID", "Current component library is not refreshable", {
      product_id: record.product_id,
      status: library.status
    });
  }
  const targetVersion = input.target_component_library_version ?? library.current_version;
  if (targetVersion !== library.current_version) {
    throw new FormaError("COMPONENT_LIBRARY_VERSION_MISSING", "Target component library version is not pinned as current", {
      requested_version: targetVersion,
      current_version: library.current_version
    });
  }
  const requirement = await readYamlAs(join(home, "data", record.product_id, record.requirement_id, "requirement.yaml"), requirementSchema);
  const requestedPageIds = new Set(input.page_ids ?? requirement.pages.map((page) => page.page_id));
  const explicitNotDone = requirement.pages.filter((page) => requestedPageIds.has(page.page_id) && page.design_status !== "done");
  if (explicitNotDone.length > 0) {
    throw new FormaError("COMPONENT_REFRESH_PARTIAL_BLOCKED", "Component refresh requires every requested page to be done", {
      blocked_pages: explicitNotDone.map((page) => page.page_id),
      candidate_pages: [...requestedPageIds],
      scope: { page_ids: [...requestedPageIds] }
    });
  }
  const stagingDocument = parsePenDocument(await readFile(record.staging_path, "utf8"));
  const usage = await indexRequirementComponentUsageDocument({
    home,
    product_id: record.product_id,
    requirement_id: record.requirement_id,
    document: stagingDocument
  });
  const requestedUsage = usage.usages.filter((item) => requestedPageIds.has(item.page_id ?? ""));
  const unmapped = requestedUsage.filter((item) => item.ref_target && !item.ref_target.startsWith(`Components - Snapshot v${targetVersion}/`));
  if (unmapped.length > 0) {
    throw new FormaError("COMPONENT_LIBRARY_UNMAPPED", "Component refresh requires mapped current snapshot usage", {
      blocked_usages: unmapped,
      candidate_pages: [...requestedPageIds],
      scope: { page_ids: [...requestedPageIds] }
    });
  }
  const unlinked = usage.usages.filter((item) => requestedPageIds.has(item.page_id ?? "") && item.status === "unlinked");
  if (unlinked.length > 0) {
    throw new FormaError("COMPONENT_USAGE_UNLINKED", "Component refresh has unlinked usage", {
      blocked_usages: unlinked,
      candidate_pages: [...requestedPageIds],
      scope: { page_ids: [...requestedPageIds] }
    });
  }
  const semanticChangedNodes = walkPenNodes(stagingDocument.children).filter((node) => {
    if (!requestedUsage.some((item) => item.node_id === node.id)) {
      return false;
    }
    const metadata = node.metadata ?? {};
    return metadata.semantic_contract_changed === true
      || (typeof metadata.semantic_contract_hash === "string"
        && typeof metadata.library_semantic_contract_hash === "string"
        && metadata.semantic_contract_hash !== metadata.library_semantic_contract_hash);
  });
  if (semanticChangedNodes.length > 0) {
    throw new FormaError("COMPONENT_CONTRACT_CHANGED", "Component refresh has semantic contract changes", {
      blocked_usages: semanticChangedNodes.map((node) => node.id),
      candidate_pages: [...requestedPageIds],
      scope: { page_ids: [...requestedPageIds] }
    });
  }
  const overrideConflictNodes = walkPenNodes(stagingDocument.children).filter((node) => {
    if (!requestedUsage.some((item) => item.node_id === node.id)) {
      return false;
    }
    const metadata = node.metadata ?? {};
    return metadata.override_conflict === true
      || (Array.isArray(metadata.overrides)
        && metadata.overrides.some((item) => ["semantic", "children", "ref_target", "component_key"].includes(String(item))));
  });
  if (overrideConflictNodes.length > 0) {
    throw new FormaError("COMPONENT_OVERRIDE_CONFLICT", "Component refresh has override conflicts", {
      blocked_usages: overrideConflictNodes.map((node) => node.id),
      candidate_pages: [...requestedPageIds],
      scope: { page_ids: [...requestedPageIds] }
    });
  }
  const operations = requestedUsage
    .filter((item) => item.status === "linked" && requestedPageIds.has(item.page_id ?? ""))
    .map((item) => ({
      tool: "batch_design" as const,
      args: {
        refresh_component_instance: item.node_id,
        component_key: item.component_key,
        target_component_library_version: targetVersion
      },
      target_node_ids: [item.node_id],
      intent: "component_refresh" as const
    }));
  return { session_id: record.session_id, status: "planned", operations };
}

async function findComponentSession(home: string, sessionId: string): Promise<{ file: string; record: ComponentSessionRecord }> {
  const file = await findComponentSessionFile(home, sessionId);
  return { file, record: await readComponentSessionRecord(home, file) };
}

async function findLooseRequirementSession(home: string, sessionId: string): Promise<{
  session_id: string;
  product_id: string;
  requirement_id: string;
  status: string;
  staging_path: string;
}> {
  const parsedSessionId = parseSessionId(sessionId);
  const dataDir = join(home, "data");
  for (const productId of await readdir(dataDir).catch(() => [])) {
    const productDir = join(dataDir, productId);
    for (const requirementId of await readdir(productDir).catch(() => [])) {
      if (requirementId === "sessions" || requirementId.startsWith("D-")) continue;
      const file = join(productDir, requirementId, "sessions", parsedSessionId, "design_session.yaml");
      if (!await pathExists(file)) continue;
      const raw = await readYaml<Record<string, unknown>>(file);
      if (raw.scope !== "requirement_canvas" || raw.session_id !== parsedSessionId || raw.product_id !== productId || raw.requirement_id !== requirementId) {
        throw new FormaError("INVALID_INPUT", "Requirement session metadata is invalid", { session_id: parsedSessionId });
      }
      if (raw.status !== "running") {
        throw new FormaError("INVALID_INPUT", "Requirement session is not running", { session_id: parsedSessionId, status: raw.status });
      }
      const stagingFile = typeof raw.staging_file === "string" ? raw.staging_file : undefined;
      if (!stagingFile) {
        throw new FormaError("INVALID_INPUT", "Requirement session metadata is invalid", { session_id: parsedSessionId });
      }
      return { session_id: parsedSessionId, product_id: productId, requirement_id: requirementId, status: String(raw.status), staging_path: join(home, stagingFile) };
    }
  }
  throw new FormaError("INVALID_INPUT", "Requirement session not found", { session_id: parsedSessionId });
}

async function findComponentSessionFile(home: string, sessionId: string): Promise<string> {
  const parsedSessionId = parseSessionId(sessionId);
  const library = join(home, "library");
  const entries = await import("node:fs/promises").then((fs) => fs.readdir(library).catch(() => []));
  for (const entry of entries) {
    if (!entry.endsWith(".sessions")) continue;
    const file = join(library, entry, parsedSessionId, "design_session.yaml");
    if (await pathExists(file)) return file;
  }
  throw new FormaError("INVALID_INPUT", "Component session not found", { session_id: parsedSessionId });
}

async function readComponentSessionRecord(home: string, file: string): Promise<ComponentSessionRecord> {
  const raw = await readYaml<unknown>(file);
  const parsed = componentSessionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FormaError("INVALID_INPUT", "Component session metadata is invalid", { path: file });
  }
  const persisted = parsed.data;
  const sessionDir = dirname(file);
  const expectedSessionDirRelative = relative(home, sessionDir);
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
  if (dirname(stagingPath) !== sessionDir || dirname(operationLogFile) !== sessionDir) {
    throw new FormaError("INVALID_INPUT", "Component session operational paths must stay inside the discovered session directory", {
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

function serializeComponentSessionRecord(home: string, record: ComponentSessionRecord): ComponentSessionPersistedRecord {
  return componentSessionSchema.parse({
    ...record,
    session_dir_relative: relative(home, record.session_dir),
    session_dir: relative(home, record.session_dir),
    canvas_file: relative(home, record.canvas_path),
    canvas_path: relative(home, record.canvas_path),
    staging_file: relative(home, record.staging_path),
    staging_path: relative(home, record.staging_path),
    operation_log_file_relative: relative(home, record.operation_log_file),
    operation_log_file: relative(home, record.operation_log_file)
  });
}

async function writeComponentSessionRecord(home: string, file: string, record: ComponentSessionRecord): Promise<void> {
  await writeYamlAtomic(file, serializeComponentSessionRecord(home, record));
}

async function nextComponentOperationSequence(file: string): Promise<number> {
  const raw = await readFile(file, "utf8").catch(() => "");
  return raw.split(/\r?\n/).filter((line) => line.trim()).length + 1;
}

async function latestComponentFailedSequence(file: string): Promise<number | undefined> {
  const raw = await readFile(file, "utf8").catch(() => "");
  const entries = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const failed = entries.reverse().find((entry) => entry.status === "failed" && typeof entry.sequence === "number");
  return failed?.sequence as number | undefined;
}

async function appendComponentJsonl(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value)}\n`, { flag: "a" });
}

async function replaceComponentJsonlBySequence(file: string, sequence: number, updater: (entry: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
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

async function rollbackComponentBegin(input: { productLease: string; activeFile: string; stagingPath: string; sessionDir: string; sessionId: string }): Promise<"completed" | "partial"> {
  let partial = false;
  for (const action of [
    () => clearLeaseIfMatches(input.productLease, input.sessionId, join(dirname(input.sessionDir), "failed-begins", `${input.sessionId}.warnings.jsonl`)),
    () => clearLeaseIfMatches(input.activeFile, input.sessionId, join(dirname(input.sessionDir), "failed-begins", `${input.sessionId}.warnings.jsonl`)),
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

interface ComponentCommitEntry {
  target_file: string;
  candidate_file: string;
  candidate_hash: string;
  old_hash?: string;
  old_file_missing?: boolean;
  backup_file?: string;
  replacement_kind: string;
  restore_order: number;
  status?: "promoted";
}

async function readComponentVersionPlan(
  home: string,
  productId: string,
  operation: "generate" | "refine" | "change_style"
): Promise<{ previous_version: number; target_version: number }> {
  const metadataPath = join(home, "library", `${productId}.components.yaml`);
  if (!(await pathExists(metadataPath))) {
    if (operation === "generate") {
      const library = await getProductComponentLibrary(home, productId);
      if (library.status !== "missing") {
        throw componentLibraryError(productId, library.status, {
          ...library,
          components_yaml_path: metadataPath
        });
      }
      return { previous_version: 0, target_version: 1 };
    }
    throw new FormaError("COMPONENT_LIBRARY_METADATA_MISSING", "Component library metadata is missing", {
      product_id: productId,
      components_yaml_path: metadataPath,
      required_action: "generate_components"
    });
  }
  const library = await getProductComponentLibrary(home, productId);
  if (library.status !== "complete" || !library.current_version || !library.current_version_record) {
    throw componentLibraryError(productId, library.status, {
      ...library,
      components_yaml_path: metadataPath
    });
  }
  const metadata = await readStrictComponentMetadata(home, productId, metadataPath);
  const currentVersion = metadata.current_version;
  if (!metadata.versions.some((entry) => entry.version === currentVersion)) {
    throw new FormaError("COMPONENT_LIBRARY_INVALID", "Component library current version record is missing", {
      product_id: productId,
      components_yaml_path: metadataPath,
      current_version: currentVersion,
      required_action: "generate_components"
    });
  }
  const occupiedVersions = new Set<number>();
  for (const entry of metadata.versions) {
    occupiedVersions.add(entry.version);
  }
  const versionsDir = join(home, "library", `${productId}.versions`);
  for (const entry of await readdir(versionsDir).catch(() => [])) {
    const match = /^(\d+)\.lib\.pen$/.exec(entry);
    if (match) {
      occupiedVersions.add(Number(match[1]));
    }
  }
  let targetVersion = Number(currentVersion) + 1;
  while (occupiedVersions.has(targetVersion)) {
    targetVersion += 1;
  }
  return { previous_version: Number(currentVersion), target_version: targetVersion };
}

function componentMetadataFromSeeds(value: unknown): Array<{ key: string; name?: string; description?: string }> {
  const seeds = Array.isArray(value) ? value : [];
  return seeds.map((seed) => {
    const record = seed as Record<string, unknown>;
    return {
      key: String(record.component_key),
      ...(typeof record.name === "string" ? { name: record.name } : {}),
      ...(typeof record.description === "string" ? { description: record.description } : {})
    };
  });
}

async function prepareComponentCommitEntries(
  home: string,
  targets: Array<{
    targetPath: string;
    candidatePath: string;
    candidateHash: string;
    backupPath: string;
    replacementKind: string;
    restoreOrder: number;
  }>
): Promise<ComponentCommitEntry[]> {
  const entries: ComponentCommitEntry[] = [];
  for (const target of targets) {
    if (await hashFile(target.candidatePath) !== target.candidateHash) {
      throw new FormaError("INVALID_INPUT", "Component commit candidate hash mismatch", {
        candidate_file: relative(home, target.candidatePath)
      });
    }
    const targetState = await validateComponentCommitTarget(home, target.targetPath, target.replacementKind);
    const base = {
      target_file: relative(home, target.targetPath),
      candidate_file: relative(home, target.candidatePath),
      candidate_hash: target.candidateHash,
      replacement_kind: target.replacementKind,
      restore_order: target.restoreOrder
    };
    if (targetState.exists) {
      if (target.replacementKind === "component_version") {
        throw new FormaError("INVALID_INPUT", "Component target version file must not already exist", {
          target_file: relative(home, target.targetPath)
        });
      }
      const oldHash = await hashFile(target.targetPath);
      await copyFile(target.targetPath, target.backupPath);
      if (await hashFile(target.backupPath) !== oldHash) {
        throw new FormaError("INVALID_INPUT", "Component commit backup verification failed", {
          target_file: relative(home, target.targetPath)
        });
      }
      entries.push({
        ...base,
        old_hash: oldHash,
        backup_file: relative(home, target.backupPath)
      });
    } else {
      entries.push({
        ...base,
        old_file_missing: true
      });
    }
  }
  return entries;
}

async function assertComponentCommitBaseline(
  home: string,
  record: ComponentSessionRecord,
  metadataPath: string,
  canvasPath: string
): Promise<ComponentLibraryMetadata | undefined> {
  const metadataExists = await pathExists(metadataPath);
  const existingMetadata = metadataExists
    ? await readStrictComponentMetadata(home, record.product_id, metadataPath).catch((error: unknown) => {
      throw new FormaError("INVALID_INPUT", "Component metadata baseline is unreadable", {
        session_id: record.session_id,
        product_id: record.product_id,
        components_yaml_path: relative(home, metadataPath),
        reason: errorMessage(error)
      });
    })
    : undefined;
  const currentVersion = existingMetadata?.current_version;
  if (record.previous_version === 0) {
    if (metadataExists) {
      throw new FormaError("INVALID_INPUT", "Component metadata baseline changed since session begin", {
        session_id: record.session_id,
        product_id: record.product_id,
        expected_current_version: 0,
        actual_current_version: currentVersion ?? null,
        components_yaml_path: relative(home, metadataPath)
      });
    }
    if (await pathExists(canvasPath)) {
      throw new FormaError("INVALID_INPUT", "Component latest baseline changed since session begin", {
        session_id: record.session_id,
        product_id: record.product_id,
        expected_latest_file_missing: true,
        latest_file: relative(home, canvasPath)
      });
    }
    return undefined;
  }
  if (!metadataExists || currentVersion !== record.previous_version) {
    throw new FormaError("INVALID_INPUT", "Component metadata baseline changed since session begin", {
      session_id: record.session_id,
      product_id: record.product_id,
      expected_current_version: record.previous_version,
      actual_current_version: currentVersion ?? null,
      components_yaml_path: relative(home, metadataPath)
    });
  }
  if (!existingMetadata) {
    throw new FormaError("INVALID_INPUT", "Component metadata baseline is missing", {
      session_id: record.session_id,
      product_id: record.product_id,
      expected_current_version: record.previous_version,
      components_yaml_path: relative(home, metadataPath)
    });
  }
  if (!existingMetadata.versions.some((entry) => entry.version === record.previous_version)) {
    throw new FormaError("INVALID_INPUT", "Component metadata baseline changed since session begin", {
      session_id: record.session_id,
      product_id: record.product_id,
      expected_current_version: record.previous_version,
      actual_current_version: currentVersion ?? null,
      components_yaml_path: relative(home, metadataPath)
    });
  }
  const latestState = await validateComponentCommitTarget(home, canvasPath, "component_latest");
  if (!latestState.exists) {
    throw new FormaError("INVALID_INPUT", "Component latest baseline changed since session begin", {
      session_id: record.session_id,
      product_id: record.product_id,
      expected_latest_hash: record.base_canvas_revision ?? record.started_revision,
      actual_latest_missing: true,
      latest_file: relative(home, canvasPath)
    });
  }
  const expectedLatestHash = record.base_canvas_revision ?? record.started_revision;
  const latestHash = await hashFile(canvasPath);
  if (latestHash !== expectedLatestHash) {
    throw new FormaError("INVALID_INPUT", "Component latest baseline changed since session begin", {
      session_id: record.session_id,
      product_id: record.product_id,
      expected_latest_hash: expectedLatestHash,
      actual_latest_hash: latestHash,
      latest_file: relative(home, canvasPath)
    });
  }
  const library = await getProductComponentLibrary(home, record.product_id);
  if (library.status !== "complete" || !library.current_version_record || library.current_version_record.version !== record.previous_version) {
    throw new FormaError("INVALID_INPUT", "Component metadata baseline is invalid", {
      session_id: record.session_id,
      product_id: record.product_id,
      expected_current_version: record.previous_version,
      actual_current_version: library.current_version ?? null,
      status: library.status,
      components_yaml_path: relative(home, metadataPath),
      reason: library.error
    });
  }
  return existingMetadata;
}

async function readStrictComponentMetadata(home: string, productId: string, metadataPath: string): Promise<ComponentLibraryMetadata> {
  try {
    const metadata = await readYamlAs(metadataPath, componentLibraryMetadataSchema);
    if (metadata.product_id !== productId) {
      throw new Error("metadata product_id mismatch");
    }
    return metadata;
  } catch (error) {
    throw new FormaError("COMPONENT_LIBRARY_INVALID", "Component library metadata is invalid", {
      product_id: productId,
      components_yaml_path: relative(home, metadataPath),
      reason: errorMessage(error),
      required_action: "generate_components"
    });
  }
}

async function restoreComponentCommitEntries(
  home: string,
  entries: ComponentCommitEntry[]
): Promise<{ failed_files: Array<{ path: string; reason: string }> }> {
  const failed: Array<{ path: string; reason: string }> = [];
  for (const entry of [...entries].sort((a, b) => b.restore_order - a.restore_order)) {
    const target = resolveInside(home, entry.target_file);
    try {
      if (entry.old_file_missing) {
        await validateComponentCommitTarget(home, target, entry.replacement_kind);
        await rm(target, { force: true });
        continue;
      }
      if (!entry.backup_file || !entry.old_hash) {
        failed.push({ path: entry.target_file, reason: "missing_backup" });
        continue;
      }
      await validateComponentCommitTarget(home, target, entry.replacement_kind);
      const tempTarget = join(dirname(target), `.forma-restore-${randomBytes(8).toString("hex")}.tmp`);
      await restoreVerifiedBackup(resolveInside(home, entry.backup_file), tempTarget, target, entry.old_hash);
      if (await hashFile(target) !== entry.old_hash) {
        failed.push({ path: entry.target_file, reason: "restore_hash_mismatch" });
      }
    } catch (error) {
      failed.push({ path: entry.target_file, reason: errorMessage(error) });
    }
  }
  return { failed_files: failed };
}

export async function validateComponentCommitTarget(
  home: string,
  targetPath: string,
  replacementKind: string
): Promise<{ exists: boolean }> {
  const target = resolveInside(home, relative(home, targetPath));
  const relativeTarget = relative(home, target);
  const parsed = parseComponentTargetPath(relativeTarget, replacementKind);
  const expectedParent = replacementKind === "component_version"
    ? join(home, "library", `${parsed.productId}.versions`)
    : join(home, "library");
  const parentReal = await realpath(dirname(target));
  const expectedParentReal = await realpath(expectedParent);
  const libraryReal = await realpath(join(home, "library"));
  if (parentReal !== expectedParentReal || !isSameOrChildPath(libraryReal, parentReal)) {
    throw new FormaError("INVALID_INPUT", "Component commit target parent is invalid", {
      target_file: relativeTarget,
      replacement_kind: replacementKind
    });
  }
  const stat = await lstat(target).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!stat) return { exists: false };
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new FormaError("INVALID_INPUT", "Component commit target must be a regular file", {
      target_file: relativeTarget,
      replacement_kind: replacementKind
    });
  }
  return { exists: true };
}

function parseComponentTargetPath(relativeTarget: string, replacementKind: string): { productId: string; version?: number } {
  if (replacementKind === "component_latest") {
    const match = /^library\/(P-[a-f0-9]{6})\.lib\.pen$/.exec(relativeTarget);
    if (!match || !productIdSchema.safeParse(match[1]).success) {
      throw new FormaError("INVALID_INPUT", "Component latest target path is invalid", { target_file: relativeTarget });
    }
    return { productId: match[1] };
  }
  if (replacementKind === "component_metadata") {
    const match = /^library\/(P-[a-f0-9]{6})\.components\.yaml$/.exec(relativeTarget);
    if (!match || !productIdSchema.safeParse(match[1]).success) {
      throw new FormaError("INVALID_INPUT", "Component metadata target path is invalid", { target_file: relativeTarget });
    }
    return { productId: match[1] };
  }
  if (replacementKind === "component_version") {
    const match = /^library\/(P-[a-f0-9]{6})\.versions\/([1-9]\d*)\.lib\.pen$/.exec(relativeTarget);
    if (!match || !productIdSchema.safeParse(match[1]).success) {
      throw new FormaError("INVALID_INPUT", "Component version target path is invalid", { target_file: relativeTarget });
    }
    return { productId: match[1], version: Number(match[2]) };
  }
  throw new FormaError("INVALID_INPUT", "Component replacement kind is invalid", {
    target_file: relativeTarget,
    replacement_kind: replacementKind
  });
}

async function assertComponentDiscardLeaseMatches(
  file: string,
  sessionId: string,
  record: Record<string, unknown>,
  warningFile: string
): Promise<void> {
  const lease = await readYaml<Record<string, unknown>>(file).catch(() => undefined);
  const expected = {
    session_id: sessionId,
    scope: "product_component_library",
    canvas_path: String(record.canvas_file),
    staging_path: String(record.staging_file)
  };
  const mismatch =
    !lease ||
    lease.session_id !== expected.session_id ||
    lease.scope !== expected.scope ||
    lease.canvas_path !== expected.canvas_path ||
    lease.staging_path !== expected.staging_path;
  if (mismatch) {
    await writeFile(warningFile, `${JSON.stringify({
      warning: "LEASE_RELEASE_MISMATCH",
      lease_path: file,
      expected,
      actual: lease ?? null
    })}\n`, { flag: "a" });
    throw new FormaError("INVALID_INPUT", "Component session lease does not match discard request", {
      session_id: sessionId,
      lease_path: file,
      expected,
      actual: lease ?? null
    });
  }
}

async function assertDiscardJournalPath(sessionDir: string): Promise<void> {
  const journalPath = join(sessionDir, "commit-journal.yaml");
  const stat = await lstat(journalPath).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (stat && (stat.isSymbolicLink() || !stat.isFile())) {
    throw new FormaError("INVALID_INPUT", "Component commit journal path is invalid", {
      journal_path: journalPath
    });
  }
}

async function clearLeaseIfMatches(file: string, sessionId: string, warningFile: string): Promise<void> {
  const lease = await readYaml<Record<string, unknown>>(file).catch(() => undefined);
  if (!lease || lease.session_id !== sessionId) {
    if (lease) {
      await writeFile(warningFile, `${JSON.stringify({ warning: "LEASE_RELEASE_MISMATCH", lease_path: file, expected_session_id: sessionId, actual_session_id: lease.session_id })}\n`, { flag: "a" });
    }
    return;
  }
  await rm(file, { force: true });
}

async function hasNonTerminalLease(file: string): Promise<boolean> {
  let lease: Record<string, unknown>;
  try {
    const value = await readYaml<unknown>(file);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("active lease is not an object");
    }
    lease = value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw new FormaError("DESIGN_SESSION_ACTIVE", "Design session active lease is unreadable", {
      lease_path: file,
      reason: errorMessage(error)
    });
  }
  return lease.status !== "committed" && lease.status !== "discarded";
}

function validateComponentSeeds(value: unknown): void {
  const seeds = Array.isArray(value) ? value : [];
  const keys = new Set<string>();
  for (const seed of seeds) {
    if (!seed || typeof seed !== "object") {
      throw new FormaError("COMPONENT_LIBRARY_INVALID", "Component metadata is invalid", { reason: "seed_invalid" });
    }
    const componentKey = (seed as Record<string, unknown>).component_key;
    if (typeof componentKey !== "string" || componentKey.length === 0) {
      throw new FormaError("COMPONENT_LIBRARY_INVALID", "Component metadata is invalid", { reason: "component_key_missing" });
    }
    if (keys.has(componentKey)) {
      throw new FormaError("COMPONENT_LIBRARY_INVALID", "Component keys must be unique", { component_key: componentKey });
    }
    keys.add(componentKey);
    const hash = (seed as Record<string, unknown>).semantic_contract_hash;
    if (hash !== undefined && (typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(hash))) {
      throw new FormaError("COMPONENT_LIBRARY_INVALID", "Semantic contract hash is invalid", { component_key: componentKey });
    }
  }
}

function componentLibraryError(productId: string, status: string, details: Record<string, unknown>): FormaError {
  const payload = {
    product_id: productId,
    status,
    components_yaml_path: details.components_yaml_path ?? details.metadata_path,
    required_action: "generate_components",
    ...details
  };
  if (status === "metadata_missing") {
    return new FormaError("COMPONENT_LIBRARY_METADATA_MISSING", "Component library metadata is missing", payload);
  }
  if (status === "missing" || status === "version_snapshot_missing") {
    return new FormaError("COMPONENT_LIBRARY_VERSION_MISSING", "Component library version snapshot is missing", payload);
  }
  if (status === "latest_file_missing") {
    return new FormaError("COMPONENT_LIBRARY_LATEST_MISSING", "Component library latest file is missing", payload);
  }
  return new FormaError("COMPONENT_LIBRARY_INVALID", "Component library is invalid", payload);
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

async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
