import { createHash } from "node:crypto";
import { access, copyFile, lstat, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readYaml, readYamlUnknown, writeYamlAtomic } from "./yaml.js";

type SemanticContractCoverage = "minimal" | "explicit";
interface SemanticContractItem {
  key: string;
  label: string;
}
interface SemanticContract {
  actions: SemanticContractItem[];
  allowed_copy: string[];
  component_keys: string[];
  fields: SemanticContractItem[];
  navigation: Array<{ target_page_id: string; label?: string }>;
}
interface SemanticContractConflict {
  page_id: string;
  type: "action" | "field";
  key: string;
  labels: string[];
}

function buildSemanticContractForPage(input: unknown): {
  semantic_contract: SemanticContract;
  semantic_contract_coverage: SemanticContractCoverage;
} {
  const record = asRecord(input);
  const page = asRecord(record.page);
  const pageId = stringValue(page.page_id) ?? "";
  const contract = emptySemanticContract();

  mergeSemanticItems(contract.fields, semanticItems(page.declared_fields));
  mergeSemanticItems(contract.actions, semanticItems(page.declared_actions));
  mergeStrings(contract.component_keys, arrayOfStrings(page.declared_component_keys));
  mergeStrings(
    contract.allowed_copy,
    arrayOfRecords(page.copy)
      .map((item) => stringValue(item.text))
      .filter(isDefinedString),
  );

  for (const rule of arrayOfRecords(record.product_rules)) {
    const rulePageId = stringValue(rule.page_id);
    if (rulePageId !== undefined && rulePageId !== pageId) {
      continue;
    }
    const semantic = asRecord(rule.semantic);
    mergeSemanticItems(contract.fields, semanticItems(semantic.fields));
    mergeSemanticItems(contract.actions, semanticItems(semantic.actions));
    mergeStrings(contract.component_keys, arrayOfStrings(semantic.component_keys));
    mergeStrings(contract.allowed_copy, arrayOfStrings(semantic.allowed_copy));
  }

  for (const edge of arrayOfRecords(record.navigation)) {
    if (stringValue(edge.from) === pageId) {
      addNavigationTarget(contract.navigation, {
        target_page_id: stringValue(edge.to) ?? "",
        label: stringValue(edge.label),
      });
    }
  }

  return { semantic_contract: contract, semantic_contract_coverage: "minimal" };
}

function buildBaselineSemanticContractCandidate(input: unknown): {
  ok: boolean;
  code?: "BASELINE_SEMANTIC_CONTRACT_CONFLICT";
  conflicts: SemanticContractConflict[];
  pages: Array<{
    id: string;
    semantic_contract: SemanticContract;
    semantic_contract_coverage: SemanticContractCoverage;
  }>;
} {
  const record = asRecord(input);
  const conflicts: SemanticContractConflict[] = [];
  const pages = arrayOfRecords(record.pages).map((page) => {
    const pageId = stringValue(page.id) ?? "";
    const contract = emptySemanticContract();

    if (isRecord(page.semantic_contract)) {
      mergeSemanticContract(contract, page.semantic_contract as unknown as SemanticContract, pageId, conflicts);
    }
    for (const source of arrayOfRecords(page.source_semantic_contracts)) {
      if (isRecord(source.semantic_contract)) {
        mergeSemanticContract(contract, source.semantic_contract as unknown as SemanticContract, pageId, conflicts);
      }
    }
    mergeSemanticItems(contract.fields, semanticItems(page.declared_fields), pageId, conflicts, "field");
    mergeSemanticItems(contract.actions, semanticItems(page.declared_actions), pageId, conflicts, "action");
    mergeStrings(contract.component_keys, arrayOfStrings(page.declared_component_keys));
    mergeStrings(
      contract.allowed_copy,
      arrayOfRecords(page.copy)
        .map((item) => stringValue(item.text))
        .filter(isDefinedString),
    );

    for (const edge of arrayOfRecords(record.navigation)) {
      if (stringValue(edge.from) === pageId) {
        addNavigationTarget(contract.navigation, {
          target_page_id: stringValue(edge.to) ?? "",
          label: stringValue(edge.label),
        });
      }
    }

    return {
      id: pageId,
      semantic_contract: contract,
      semantic_contract_coverage: "minimal" as const,
    };
  });

  return {
    ok: conflicts.length === 0,
    code: conflicts.length === 0 ? undefined : "BASELINE_SEMANTIC_CONTRACT_CONFLICT",
    conflicts,
    pages,
  };
}

export const V6_SCHEMA_NORMALIZER_VERSION = "v6-stage-01";
const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as {
  dump(value: unknown, options?: { noRefs?: boolean; sortKeys?: boolean }): string;
};

export type SchemaNormalizationMode = "normal" | "preflight_only" | "recovery_only";
export type SchemaNormalizationStatus = "committed" | "preflight_required" | "recovery_required" | "restored";
export type SchemaNormalizationRestoreStatus =
  | "none"
  | "journal_selection_ambiguous"
  | "no_runtime_writes"
  | "manifest_unavailable"
  | "backup_hash_mismatch"
  | "restore_failed"
  | "restored";
export type SchemaNormalizationStateCode =
  | "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED"
  | "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED";

export interface SchemaNormalizationFailedFile {
  runtime_path: string;
  backup_path?: string;
  reason: string;
  restore_status?: "pending" | "restored" | "already_restored" | "failed";
}

export type SchemaNormalizationRecoveryAction =
  | "run_schema_normalization_dry_run"
  | "run_v6_schema_cutover"
  | "recover_v6_normalization_journal"
  | "restore_v6_normalization_backup";

export interface SchemaNormalizationRecoveryState {
  mode: SchemaNormalizationMode;
  status: SchemaNormalizationStatus;
  code?: SchemaNormalizationStateCode;
  message: string;
  home: string;
  committed_marker_file?: string;
  active_marker_file?: string;
  preflight_report_file?: string;
  preflight_status?: "missing" | "stale" | "failed" | "passed";
  preflight_reason?:
    | "report_missing"
    | "report_failed"
    | "report_stale"
    | "report_selection_ambiguous"
    | "report_path_outside_home"
    | "explicit_report_not_latest";
  backup_dir?: string;
  journal_path?: string;
  manifest_path?: string;
  manifest_hash?: string;
  normalizer_version?: string;
  restore_status: SchemaNormalizationRestoreStatus;
  failed_files: SchemaNormalizationFailedFile[];
  recovery_actions: SchemaNormalizationRecoveryAction[];
  report?: {
    status?: "passed" | "failed" | "committed" | "restored";
    report_file?: string;
    backup_dir?: string;
    journal_path?: string;
    rewritten_file_count?: number;
    generated_requirement_contract_count?: number;
    generated_baseline_contract_count?: number;
    strict_schema_status?: "passed" | "failed";
  };
}

export class SchemaNormalizationStartupError extends Error {
  readonly code: SchemaNormalizationStateCode;

  constructor(public readonly state: SchemaNormalizationRecoveryState) {
    super(state.message);
    this.name = "SchemaNormalizationStartupError";
    this.code = state.code ?? "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED";
  }
}

export function isSchemaNormalizationStartupError(error: unknown): error is SchemaNormalizationStartupError {
  return error instanceof SchemaNormalizationStartupError;
}

export class SchemaNormalizationRecoveryError extends Error {
  readonly code = "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED";

  constructor(
    public readonly result: SchemaNormalizationRecoveryResult,
    message = "v6 schema normalization recovery is required",
  ) {
    super(message);
    this.name = "SchemaNormalizationRecoveryError";
  }
}

export type SchemaNormalizationPreflightStatus = "passed" | "failed";
export type SchemaNormalizationStrictSchemaStatus = "passed" | "failed";
export type SchemaNormalizationValidatorSource = "runtime_schema" | "preflight_candidate_validator";
export type SchemaNormalizationCandidateValidationStatus = "passed" | "failed";

export interface SchemaNormalizationDiagnostic {
  code: string;
  path: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface SchemaNormalizationCandidateManifestEntry {
  path: string;
  old_hash: string | null;
  candidate_hash: string;
  candidate?: Record<string, unknown>;
  validator_source: SchemaNormalizationValidatorSource;
  validation_status: SchemaNormalizationCandidateValidationStatus;
  deleted_field_counts: Record<string, number>;
  generated_contract_coverage: SemanticContractCoverage[];
}

export interface SchemaNormalizationPreflightReport {
  created_at: string;
  report_dir: string;
  report_file: string;
  normalizer_version: string;
  home_hash: string;
  status: SchemaNormalizationPreflightStatus;
  strict_schema_status: SchemaNormalizationStrictSchemaStatus;
  candidate_manifest_hash: string;
  candidates: SchemaNormalizationCandidateManifestEntry[];
  field_removal_counts: Record<string, number>;
  generated_requirement_contract_count: number;
  generated_baseline_contract_count: number;
  coverage_summaries: Record<string, number>;
  schema_validation_diagnostics: SchemaNormalizationDiagnostic[];
}

export interface SchemaNormalizationUnsupportedModeResult {
  status: "failed";
  code: "SCHEMA_NORMALIZATION_UNSUPPORTED_MODE";
  mode: "cutover";
  home: string;
  message: string;
}

export interface SchemaNormalizationCutoverResult {
  status: "committed" | "failed";
  code?: SchemaNormalizationStateCode;
  home: string;
  message: string;
  preflight_status?: SchemaNormalizationRecoveryState["preflight_status"];
  preflight_reason?:
    | SchemaNormalizationRecoveryState["preflight_reason"]
    | "normalizer_version_mismatch"
    | "candidate_manifest_mismatch";
  strict_schema_status?: SchemaNormalizationStrictSchemaStatus;
  backup_dir?: string;
  journal_path?: string;
  manifest_path?: string;
  rewritten_file_count?: number;
}

export interface SchemaNormalizationRecoveryResult {
  status: "restored" | "recovery_required";
  code?: SchemaNormalizationStateCode;
  home: string;
  backup_dir: string;
  restore_status: SchemaNormalizationRestoreStatus;
  restored_file_count: number;
  failed_files: SchemaNormalizationFailedFile[];
  recovery_actions?: SchemaNormalizationRecoveryAction[];
}

export interface SchemaNormalizationPreflightOptions {
  mode: "preflight";
  createdAt?: string;
}

export interface SchemaNormalizationCutoverOptions {
  mode: "cutover";
  createdAt?: string;
  reportPath?: string;
  hooks?: {
    afterJournalCreated?: () => Promise<void> | void;
    mutateCandidateBeforeWrite?: (
      candidate: SchemaNormalizationCandidateManifestEntry,
    ) => Record<string, unknown> | undefined;
  };
}

export type NormalizeFormaHomeForV6Options = SchemaNormalizationPreflightOptions | SchemaNormalizationCutoverOptions;

export type SchemaNormalizationPreflightResult =
  | { ok: true; report: SchemaNormalizationPreflightReport; report_path: string }
  | { ok: false; state: SchemaNormalizationRecoveryState };

interface CandidateBuildResult {
  candidate: Record<string, unknown>;
  deletedFieldCounts: Record<string, number>;
  generatedCoverage: SemanticContractCoverage[];
  diagnostics: SchemaNormalizationDiagnostic[];
}

interface RequirementPageRef {
  requirementId: string;
  page: Record<string, unknown>;
}

interface ProductRuleRef {
  page_id?: string;
  semantic?: {
    fields?: Array<{ key: string; label: string }>;
    actions?: Array<{ key: string; label: string }>;
    component_keys?: string[];
    allowed_copy?: string[];
  };
}

type JournalSelection =
  | {
      ok: true;
      journal?: Record<string, unknown>;
      journal_file?: string;
    }
  | {
      ok: false;
      state: SchemaNormalizationRecoveryState;
    };

export function normalizeFormaHomeForV6(
  home: string,
  options: SchemaNormalizationPreflightOptions,
): Promise<SchemaNormalizationPreflightReport>;
export function normalizeFormaHomeForV6(
  home: string,
  options: SchemaNormalizationCutoverOptions,
): Promise<SchemaNormalizationCutoverResult>;
export async function normalizeFormaHomeForV6(
  home: string,
  options: NormalizeFormaHomeForV6Options,
): Promise<
  SchemaNormalizationPreflightReport | SchemaNormalizationCutoverResult | SchemaNormalizationUnsupportedModeResult
> {
  const resolvedHome = resolve(home);
  if (options.mode === "cutover") {
    const createdAt = options.createdAt ?? new Date().toISOString();
    assertSafeTimestampSegment(createdAt);
    return runV6SchemaCutover(resolvedHome, createdAt, options.reportPath, options.hooks);
  }

  const createdAt = options.createdAt ?? new Date().toISOString();
  assertSafeTimestampSegment(createdAt);
  const report = await buildPreflightReport(resolvedHome, createdAt);
  await writeYamlAtomic(join(resolvedHome, report.report_file), report);
  return report;
}

async function buildPreflightReport(
  resolvedHome: string,
  createdAt: string,
): Promise<SchemaNormalizationPreflightReport> {
  const reportDir = `normalization-preflight/v6-${createdAt}`;
  const reportFile = `${reportDir}/report.yaml`;
  assertResolvedPathUnder(
    join(resolvedHome, reportFile),
    join(resolvedHome, "normalization-preflight"),
    "preflight report path",
  );
  await assertSafePreflightReportTarget(resolvedHome, reportFile);
  const productIds = await listProductIds(resolvedHome);
  const requirementPagesByBaseline = new Map<string, RequirementPageRef[]>();
  const candidates: SchemaNormalizationCandidateManifestEntry[] = [];
  const diagnostics: SchemaNormalizationDiagnostic[] = [];
  const fieldRemovalCounts: Record<string, number> = {};
  let generatedRequirementContractCount = 0;
  let generatedBaselineContractCount = 0;
  const coverageSummaries: Record<string, number> = {};

  for (const productId of productIds) {
    const productFile = `data/${productId}/product.yaml`;
    await assertSafeRuntimePath(resolvedHome, `data/${productId}`, "runtime path");
    let productRules: ProductRuleRef[] = [];
    const productAbs = await assertSafeRuntimePath(resolvedHome, productFile, "runtime path");
    if (await fileExists(productAbs)) {
      const oldProduct = asRecord(await readYamlUnknown(productAbs));
      productRules = extractProductRules(oldProduct);
      const built = buildProductCandidate(productFile, oldProduct);
      diagnostics.push(...built.diagnostics);
      mergeCounts(fieldRemovalCounts, built.deletedFieldCounts);
      candidates.push(await toCandidateEntry(resolvedHome, productFile, oldProduct, built));
    }

    const baselineFile = `data/${productId}/baseline/baseline.yaml`;
    const baselineAbs = await assertSafeRuntimePath(resolvedHome, baselineFile, "runtime path");
    const oldBaseline = (await fileExists(baselineAbs)) ? asRecord(await readYamlUnknown(baselineAbs)) : undefined;
    const baselineLabels = baselineLabelsById(oldBaseline);
    const requirementFiles = await listRequirementFiles(resolvedHome, productId);
    for (const requirementFile of requirementFiles) {
      const requirementAbs = await assertSafeRuntimePath(resolvedHome, requirementFile, "runtime path");
      const oldRequirement = asRecord(await readYamlUnknown(requirementAbs));
      for (const page of arrayOfRecords(oldRequirement.pages)) {
        const baselinePage = stringValue(page.baseline_page);
        if (baselinePage !== undefined) {
          const key = `${productId}\u0000${baselinePage}`;
          requirementPagesByBaseline.set(key, [
            ...(requirementPagesByBaseline.get(key) ?? []),
            { requirementId: stringValue(oldRequirement.id) ?? "", page },
          ]);
        }
      }

      const built = buildRequirementCandidate(requirementFile, oldRequirement, productRules, baselineLabels);
      generatedRequirementContractCount += built.generatedCoverage.length;
      for (const coverage of built.generatedCoverage) {
        coverageSummaries[`requirement_${coverage}`] = (coverageSummaries[`requirement_${coverage}`] ?? 0) + 1;
      }
      diagnostics.push(...built.diagnostics);
      mergeCounts(fieldRemovalCounts, built.deletedFieldCounts);
      candidates.push(await toCandidateEntry(resolvedHome, requirementFile, oldRequirement, built));

      const translationFile = `${dirname(requirementFile)}/copy-translations.yaml`;
      const translationAbs = await assertSafeRuntimePath(resolvedHome, translationFile, "runtime path");
      if (await fileExists(translationAbs)) {
        const oldTranslations = asRecord(await readYamlUnknown(translationAbs));
        const translationCandidate = buildCopyTranslationsCandidate(translationFile, oldTranslations);
        diagnostics.push(...translationCandidate.diagnostics);
        candidates.push(await toCandidateEntry(resolvedHome, translationFile, oldTranslations, translationCandidate));
      }
    }

    if (oldBaseline !== undefined) {
      const built = buildBaselineCandidate(productId, baselineFile, oldBaseline, requirementPagesByBaseline);
      generatedBaselineContractCount += built.generatedCoverage.length;
      for (const coverage of built.generatedCoverage) {
        coverageSummaries[`baseline_${coverage}`] = (coverageSummaries[`baseline_${coverage}`] ?? 0) + 1;
      }
      diagnostics.push(...built.diagnostics);
      mergeCounts(fieldRemovalCounts, built.deletedFieldCounts);
      candidates.push(await toCandidateEntry(resolvedHome, baselineFile, oldBaseline, built));
    }
  }

  const candidateManifestHash = hashUnknown(
    candidates.map((candidate) => ({
      path: candidate.path,
      candidate_hash: candidate.candidate_hash,
      validation_status: candidate.validation_status,
      validator_source: candidate.validator_source,
    })),
  );
  const strictSchemaStatus: SchemaNormalizationStrictSchemaStatus =
    candidates.every((candidate) => candidate.validation_status === "passed") && diagnostics.length === 0
      ? "passed"
      : "failed";
  const report: SchemaNormalizationPreflightReport = {
    created_at: createdAt,
    report_dir: reportDir,
    report_file: reportFile,
    normalizer_version: V6_SCHEMA_NORMALIZER_VERSION,
    home_hash: await hashHomeRuntimeYaml(resolvedHome),
    status: strictSchemaStatus,
    strict_schema_status: strictSchemaStatus,
    candidate_manifest_hash: candidateManifestHash,
    candidates,
    field_removal_counts: fieldRemovalCounts,
    generated_requirement_contract_count: generatedRequirementContractCount,
    generated_baseline_contract_count: generatedBaselineContractCount,
    coverage_summaries: coverageSummaries,
    schema_validation_diagnostics: diagnostics,
  };

  return report;
}

async function runV6SchemaCutover(
  resolvedHome: string,
  createdAt: string,
  reportPath: string | undefined,
  hooks: SchemaNormalizationCutoverOptions["hooks"] = {},
): Promise<SchemaNormalizationCutoverResult> {
  const selected =
    reportPath === undefined
      ? await readLatestV6NormalizationPreflightReport(resolvedHome)
      : await readV6NormalizationPreflightReport(resolvedHome, reportPath);
  if (!selected.ok) {
    return cutoverPreflightFailure(resolvedHome, selected.state);
  }
  if (reportPath !== undefined) {
    const latest = await readLatestV6NormalizationPreflightReport(resolvedHome);
    if (!latest.ok) {
      return cutoverPreflightFailure(resolvedHome, latest.state);
    }
    if (resolve(latest.report_path) !== resolve(selected.report_path)) {
      return cutoverPreflightFailure(
        resolvedHome,
        preflightRequiredState(resolvedHome, "stale", "explicit_report_not_latest"),
      );
    }
  }
  if (selected.report.status !== "passed" || selected.report.strict_schema_status !== "passed") {
    return cutoverPreflightFailure(resolvedHome, preflightRequiredState(resolvedHome, "failed", "report_failed"));
  }
  if (selected.report.normalizer_version !== V6_SCHEMA_NORMALIZER_VERSION) {
    return cutoverPreflightFailure(resolvedHome, preflightRequiredState(resolvedHome, "stale", "report_stale"));
  }

  const current = await buildPreflightReport(resolvedHome, createdAt);
  if (selected.report.home_hash !== current.home_hash) {
    return cutoverPreflightFailure(resolvedHome, preflightRequiredState(resolvedHome, "stale", "report_stale"));
  }
  if (selected.report.candidate_manifest_hash !== current.candidate_manifest_hash) {
    return cutoverPreflightFailure(resolvedHome, preflightRequiredState(resolvedHome, "stale", "report_stale"));
  }

  const rewrittenCandidates = current.candidates.filter(
    (candidate) => candidate.old_hash !== null && candidate.old_hash !== candidate.candidate_hash,
  );
  const backupDir = `normalization-backups/v6-${createdAt}`;
  const backupAbs = join(resolvedHome, backupDir);
  await assertSafeBackupTarget(resolvedHome, backupAbs);
  await mkdir(backupAbs, { recursive: true });

  const backedUpAt = new Date().toISOString();
  const manifestFiles = [];
  for (const candidate of rewrittenCandidates) {
    const runtimeAbs = await assertSafeRuntimePath(resolvedHome, candidate.path, "runtime path");
    const backupPath = `${backupDir}/${candidate.path}`;
    const backupFile = assertBackupRelativePath(resolvedHome, backupDir, backupPath);
    await mkdir(dirname(backupFile), { recursive: true });
    await copyFile(runtimeAbs, backupFile);
    manifestFiles.push({
      runtime_path: candidate.path,
      backup_path: backupPath,
      sha256: candidate.old_hash,
      file_size: (await stat(backupFile)).size,
      backed_up_at: backedUpAt,
      normalizer_version: V6_SCHEMA_NORMALIZER_VERSION,
      deleted_field_counts: candidate.deleted_field_counts,
    });
  }

  const manifestHash = hashUnknown({ files: manifestFiles, normalizer_version: V6_SCHEMA_NORMALIZER_VERSION });
  const manifestPath = `${backupDir}/manifest.yaml`;
  await writeYamlAtomic(join(resolvedHome, manifestPath), {
    manifest_hash: manifestHash,
    normalizer_version: V6_SCHEMA_NORMALIZER_VERSION,
    backup_dir: backupDir,
    created_at: createdAt,
    files: manifestFiles,
  });

  const journalPath = `${backupDir}/normalization-journal.yaml`;
  const journal: {
    created_at: string;
    backup_dir: string;
    manifest_path: string;
    manifest_hash: string;
    normalizer_version: string;
    status: string;
    rewritten_files: Array<{
      runtime_path: string;
      backup_path: string;
      old_hash: string | null;
      candidate_hash: string | null;
      write_status: string;
      validation_status: string;
      restore_status: string;
      last_error: string | null;
    }>;
  } = {
    created_at: createdAt,
    backup_dir: backupDir,
    manifest_path: manifestPath,
    manifest_hash: manifestHash,
    normalizer_version: V6_SCHEMA_NORMALIZER_VERSION,
    status: "created",
    rewritten_files: rewrittenCandidates.map((candidate) => ({
      runtime_path: candidate.path,
      backup_path: `${backupDir}/${candidate.path}`,
      old_hash: candidate.old_hash,
      candidate_hash: null,
      write_status: "not_started",
      validation_status: "not_started",
      restore_status: "none",
      last_error: null,
    })),
  };
  await writeYamlAtomic(join(resolvedHome, journalPath), journal);

  const activeMarker = join(resolvedHome, ".v6-schema-cutover-active");
  const committedMarker = join(resolvedHome, ".v6-schema-cutover-committed");
  try {
    await hooks.afterJournalCreated?.();
    for (const file of manifestFiles) {
      const backupHash = hashBuffer(
        await readFile(assertBackupRelativePath(resolvedHome, backupDir, file.backup_path)),
      );
      if (backupHash !== file.sha256) {
        throw new Error(`normalization-backups hash mismatch for ${file.runtime_path}`);
      }
    }
    journal.status = "backed_up";
    await writeYamlAtomic(join(resolvedHome, journalPath), journal);
    await writeFile(activeMarker, `${createdAt}\n`, "utf8");
    journal.status = "writing";
    await writeYamlAtomic(join(resolvedHome, journalPath), journal);

    for (const candidate of rewrittenCandidates) {
      const entry = journal.rewritten_files.find((file) => file.runtime_path === candidate.path);
      try {
        const candidateToWrite = hooks.mutateCandidateBeforeWrite?.(candidate) ?? candidate.candidate ?? {};
        const runtimeFile = await assertSafeRuntimePath(resolvedHome, candidate.path, "runtime path");
        await writeYamlAtomic(runtimeFile, candidateToWrite);
        if (entry) {
          await assertSafeRuntimePath(resolvedHome, candidate.path, "runtime path");
          const actualCandidateHash = hashBuffer(await readFile(runtimeFile));
          entry.candidate_hash = actualCandidateHash;
          if (actualCandidateHash !== candidate.candidate_hash) {
            entry.write_status = "failed";
            entry.last_error = `candidate hash mismatch for ${candidate.path}`;
            journal.status = "recovery_required";
            await writeYamlAtomic(join(resolvedHome, journalPath), journal);
            throw new Error(`candidate hash mismatch for ${candidate.path}`);
          }
          entry.write_status = "written";
        }
      } catch (error) {
        if (entry) {
          entry.write_status = "failed";
          entry.last_error = errorMessage(error);
        }
        journal.status = "recovery_required";
        await writeYamlAtomic(join(resolvedHome, journalPath), journal);
        throw error;
      }
    }

    journal.status = "validating";
    await writeYamlAtomic(join(resolvedHome, journalPath), journal);
    const validationReport = await buildPreflightReport(resolvedHome, createdAt);
    if (validationReport.strict_schema_status !== "passed") {
      for (const entry of journal.rewritten_files) {
        entry.validation_status = "failed";
        entry.last_error = "strict candidate validation failed";
      }
      journal.status = "recovery_required";
      await writeYamlAtomic(join(resolvedHome, journalPath), journal);
      throw new Error("strict candidate validation failed after cutover rewrite");
    }
    for (const entry of journal.rewritten_files) {
      entry.validation_status = "passed";
    }
    journal.status = "committed";
    await writeYamlAtomic(join(resolvedHome, journalPath), journal);

    await writeYamlAtomic(join(resolvedHome, "normalization_report.yaml"), {
      status: "committed",
      strict_schema_status: "passed",
      created_at: createdAt,
      normalizer_version: V6_SCHEMA_NORMALIZER_VERSION,
      backup_dir: backupDir,
      manifest_path: manifestPath,
      manifest_hash: manifestHash,
      journal_path: journalPath,
      rewritten_file_count: rewrittenCandidates.length,
      generated_requirement_contract_count: validationReport.generated_requirement_contract_count,
      generated_baseline_contract_count: validationReport.generated_baseline_contract_count,
    });
    await rm(activeMarker, { force: true });
    await writeFile(committedMarker, `${createdAt}\n`, "utf8");
    return {
      status: "committed",
      home: resolvedHome,
      message: "v6 schema normalization committed",
      strict_schema_status: "passed",
      backup_dir: backupDir,
      manifest_path: manifestPath,
      journal_path: journalPath,
      rewritten_file_count: rewrittenCandidates.length,
    };
  } catch (error) {
    if (await fileExists(join(resolvedHome, journalPath))) {
      const failedJournal = asRecord(await readYamlUnknown(join(resolvedHome, journalPath)));
      if (stringValue(failedJournal.status) !== "recovery_required") {
        failedJournal.previous_status = stringValue(failedJournal.status);
        failedJournal.status = "recovery_required";
        await writeYamlAtomic(join(resolvedHome, journalPath), failedJournal);
      }
    }
    throw error;
  }
}

function cutoverPreflightFailure(
  home: string,
  state: SchemaNormalizationRecoveryState,
): SchemaNormalizationCutoverResult {
  return {
    status: "failed",
    code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
    home,
    message: state.message,
    preflight_status: state.preflight_status,
    preflight_reason: state.preflight_reason,
  };
}

export async function listV6NormalizationPreflightReports(
  home: string,
): Promise<Array<{ report: SchemaNormalizationPreflightReport; report_path: string }>> {
  const resolvedHome = resolve(home);
  const preflightDir = join(resolvedHome, "normalization-preflight");
  const entries = await readDirIfExists(preflightDir);
  const selected: Array<{ report: SchemaNormalizationPreflightReport; report_path: string }> = [];
  for (const entry of entries.filter((name) => name.startsWith("v6-")).sort()) {
    const reportPath = join(preflightDir, entry, "report.yaml");
    const result = await readV6NormalizationPreflightReport(resolvedHome, reportPath);
    if (result.ok) {
      selected.push({ report: result.report, report_path: reportPath });
    }
  }
  return sortReports(selected);
}

export async function readLatestV6NormalizationPreflightReport(
  home: string,
): Promise<SchemaNormalizationPreflightResult> {
  const resolvedHome = resolve(home);
  const preflightDir = join(resolvedHome, "normalization-preflight");
  const entries = await readDirIfExists(preflightDir);
  const reports: Array<{ report: SchemaNormalizationPreflightReport; report_path: string }> = [];
  for (const entry of entries.filter((name) => name.startsWith("v6-")).sort()) {
    const reportPath = join(preflightDir, entry, "report.yaml");
    const result = await readV6NormalizationPreflightReport(resolvedHome, reportPath);
    if (!result.ok) {
      return result;
    }
    reports.push({ report: result.report, report_path: reportPath });
  }

  if (reports.length === 0) {
    return { ok: false, state: preflightRequiredState(resolvedHome, "missing", "report_missing") };
  }

  const sorted = sortReports(reports);
  const latestTimestamp = sorted[0]?.report.created_at;
  const latest = sorted.filter((item) => item.report.created_at === latestTimestamp);
  if (latest.length > 1 && hasReportConflict(latest.map((item) => item.report))) {
    return { ok: false, state: preflightRequiredState(resolvedHome, "stale", "report_selection_ambiguous") };
  }
  return { ok: true, report: sorted[0].report, report_path: sorted[0].report_path };
}

export async function readV6NormalizationPreflightReport(
  home: string,
  reportPath: string,
): Promise<SchemaNormalizationPreflightResult> {
  const resolvedHome = resolve(home);
  const resolvedReport = resolve(reportPath);
  const preflightDir = join(resolvedHome, "normalization-preflight");
  if (!(await isPathUnderExistingDir(resolvedReport, preflightDir))) {
    return { ok: false, state: preflightRequiredState(resolvedHome, "stale", "report_path_outside_home") };
  }

  let report: SchemaNormalizationPreflightReport;
  try {
    report = asPreflightReport(await readYaml<SchemaNormalizationPreflightReport>(resolvedReport));
  } catch {
    return { ok: false, state: preflightRequiredState(resolvedHome, "stale", "report_selection_ambiguous") };
  }

  if (!(await isSelfConsistentReport(resolvedHome, resolvedReport, report))) {
    return { ok: false, state: preflightRequiredState(resolvedHome, "stale", "report_selection_ambiguous") };
  }

  return { ok: true, report, report_path: resolvedReport };
}

export async function readSchemaNormalizationRecoveryState(home: string): Promise<SchemaNormalizationRecoveryState> {
  const resolvedHome = resolve(home);
  const activeMarker = join(resolvedHome, ".v6-schema-cutover-active");
  const committedMarker = join(resolvedHome, ".v6-schema-cutover-committed");
  const normalizationReport = await readNormalizationReport(resolvedHome);
  const activeExists = await fileExists(activeMarker);
  const committedExists = await fileExists(committedMarker);
  const journalSelection = await selectLatestJournal(resolvedHome);
  if (!journalSelection.ok) {
    return journalSelection.state;
  }

  if (journalSelection.journal !== undefined) {
    const journal = journalSelection.journal;
    const status = stringValue(journal.status);
    const artifactStatus = await validateJournalArtifacts(resolvedHome, journal, journalSelection.journal_file);
    if (artifactStatus !== undefined) {
      return artifactStatus;
    }
    const restoreStatus = restoreStatusForJournal(journal);
    if (status === "created" || status === "backed_up") {
      if (restoreStatus === "no_runtime_writes") {
        return recoveryRequiredState(resolvedHome, {
          restore_status: "no_runtime_writes",
          backup_dir: stringValue(journal.backup_dir),
          journal_path:
            journalSelection.journal_file === undefined
              ? undefined
              : toHomeRelative(resolvedHome, journalSelection.journal_file),
          manifest_path: stringValue(journal.manifest_path),
          manifest_hash: stringValue(journal.manifest_hash),
          normalizer_version: stringValue(journal.normalizer_version),
          failed_files: [],
        });
      }
    }
    if (status === "writing" || status === "validating" || status === "recovery_required") {
      return recoveryRequiredState(resolvedHome, {
        restore_status: "restore_failed",
        backup_dir: stringValue(journal.backup_dir),
        journal_path:
          journalSelection.journal_file === undefined
            ? undefined
            : toHomeRelative(resolvedHome, journalSelection.journal_file),
        manifest_path: stringValue(journal.manifest_path),
        manifest_hash: stringValue(journal.manifest_hash),
        normalizer_version: stringValue(journal.normalizer_version),
        failed_files: failedFilesFromJournal(journal),
      });
    }
  }

  if (activeExists) {
    return recoveryRequiredState(resolvedHome, {
      restore_status: "manifest_unavailable",
      active_marker_file: toHomeRelative(resolvedHome, activeMarker),
      failed_files: [],
    });
  }

  if (committedExists) {
    return {
      mode: "normal",
      status: "committed",
      message: "v6 schema normalization committed",
      home: resolvedHome,
      committed_marker_file: toHomeRelative(resolvedHome, committedMarker),
      restore_status: "none",
      failed_files: [],
      recovery_actions: [],
      report: normalizationReport,
    };
  }

  const latestReport = await readLatestV6NormalizationPreflightReport(resolvedHome);
  if (!latestReport.ok) {
    return latestReport.state;
  }

  return preflightRequiredState(
    resolvedHome,
    latestReport.report.status === "passed" && latestReport.report.strict_schema_status === "passed"
      ? "passed"
      : "failed",
    latestReport.report.status === "passed" && latestReport.report.strict_schema_status === "passed"
      ? undefined
      : "report_failed",
    {
      preflight_report_file: latestReport.report.report_file,
      report: {
        status: latestReport.report.status,
        report_file: latestReport.report.report_file,
        generated_requirement_contract_count: latestReport.report.generated_requirement_contract_count,
        generated_baseline_contract_count: latestReport.report.generated_baseline_contract_count,
        strict_schema_status: latestReport.report.strict_schema_status,
      },
    },
  );
}

export async function recoverV6NormalizationJournal(
  home: string,
  backupDir: string,
): Promise<SchemaNormalizationRecoveryResult> {
  const resolvedHome = resolve(home);
  const backup = await resolveBackupDirUnderHome(resolvedHome, backupDir);
  const journalFile = join(backup.absolute, "normalization-journal.yaml");
  const journal = await readRecoveryYaml(resolvedHome, backup.relative, journalFile, "journal", "manifest_unavailable");
  const rewrittenFiles = arrayOfRecords(journal.rewritten_files);
  const noRuntimeWrites =
    rewrittenFiles.length === 0 ||
    rewrittenFiles.every((file) => stringValue(file.write_status) === "not_started" && file.candidate_hash === null);

  if (noRuntimeWrites) {
    journal.status = "restored";
    for (const entry of rewrittenFiles) {
      entry.restore_status = "already_restored";
    }
    await writeYamlAtomic(journalFile, journal);
    await rm(join(resolvedHome, ".v6-schema-cutover-active"), { force: true });
    await writeYamlAtomic(join(resolvedHome, "normalization_report.yaml"), {
      status: "restored",
      restored_at: new Date().toISOString(),
      backup_dir: backup.relative,
      journal_path: `${backup.relative}/normalization-journal.yaml`,
      restored_file_count: 0,
    });
    return {
      status: "restored",
      home: resolvedHome,
      backup_dir: backup.relative,
      restore_status: "no_runtime_writes",
      restored_file_count: 0,
      failed_files: [],
    };
  }

  try {
    const manifest = await readTrustedManifest(resolvedHome, backup);
    const files = arrayOfRecords(manifest.files);
    const restored = await restoreManifestRuntimeFiles(resolvedHome, backup, files);
    journal.status = "restored";
    for (const entry of rewrittenFiles) {
      entry.restore_status = "restored";
    }
    await writeYamlAtomic(journalFile, journal);
    await rm(join(resolvedHome, ".v6-schema-cutover-active"), { force: true });
    await writeYamlAtomic(join(resolvedHome, "normalization_report.yaml"), {
      status: "restored",
      restored_at: new Date().toISOString(),
      backup_dir: backup.relative,
      journal_path: `${backup.relative}/normalization-journal.yaml`,
      restored_file_count: restored,
    });
    return {
      status: "restored",
      home: resolvedHome,
      backup_dir: backup.relative,
      restore_status: "restored",
      restored_file_count: restored,
      failed_files: [],
    };
  } catch (error) {
    throw asRecoveryError(resolvedHome, backup.relative, error, "restore_failed", "", undefined);
  }
}

export async function restoreV6NormalizationBackup(
  home: string,
  backupDir: string,
  options: { confirm: string },
): Promise<SchemaNormalizationRecoveryResult> {
  if (options.confirm !== "restore_v6_backup") {
    throw new Error("restore-v6-normalization-backup requires --confirm restore_v6_backup");
  }
  const resolvedHome = resolve(home);
  const backup = await resolveBackupDirUnderHome(resolvedHome, backupDir);
  const captureRoot = join(backup.absolute, "rollback-capture");

  try {
    const manifest = await readTrustedManifest(resolvedHome, backup);
    const files = arrayOfRecords(manifest.files);
    for (const file of files) {
      const runtimePath = requiredManifestString(file, "runtime_path");
      const runtimeFile = assertRuntimeRelativePath(resolvedHome, runtimePath, "runtime path");
      if (await fileExists(runtimeFile)) {
        const captureFile = assertBackupFileUnderDir(captureRoot, runtimePath);
        await mkdir(dirname(captureFile), { recursive: true });
        await copyFile(runtimeFile, captureFile);
      }
    }
    const restored = await restoreManifestRuntimeFiles(resolvedHome, backup, files);
    await validateOldSchemaSmoke(resolvedHome, backup.relative, files);
    await writeYamlAtomic(join(resolvedHome, "normalization_report.yaml"), {
      status: "restored",
      restored_at: new Date().toISOString(),
      backup_dir: backup.relative,
      restored_file_count: restored,
    });
    const journalFile = join(backup.absolute, "normalization-journal.yaml");
    if (await fileExists(journalFile)) {
      const journal = await readRecoveryYaml(
        resolvedHome,
        backup.relative,
        journalFile,
        "journal",
        "manifest_unavailable",
      );
      journal.status = "restored";
      await writeYamlAtomic(journalFile, journal);
    }
    await rm(join(resolvedHome, ".v6-schema-cutover-active"), { force: true });
    await rm(join(resolvedHome, ".v6-schema-cutover-committed"), { force: true });
    return {
      status: "restored",
      home: resolvedHome,
      backup_dir: backup.relative,
      restore_status: "restored",
      restored_file_count: restored,
      failed_files: [],
    };
  } catch (error) {
    await writeFile(
      join(resolvedHome, ".v6-schema-cutover-active"),
      `restore failed: ${errorMessage(error)}\n`,
      "utf8",
    );
    throw asRecoveryError(resolvedHome, backup.relative, error, "restore_failed", "", undefined);
  }
}

async function restoreManifestRuntimeFiles(
  home: string,
  backup: { absolute: string; relative: string },
  files: Record<string, unknown>[],
): Promise<number> {
  let restored = 0;
  for (const file of files) {
    const runtimePath = requiredManifestString(file, "runtime_path");
    const backupPath = requiredManifestString(file, "backup_path");
    const expectedHash = requiredManifestString(file, "sha256");
    const runtimeFile = await assertSafeRuntimeRestoreTarget(home, backup.relative, runtimePath);
    const backupFile = await assertSafeBackupFile(home, backup, backupPath);
    const backupHash = hashBuffer(await readFile(backupFile));
    if (backupHash !== expectedHash) {
      throw recoveryError(
        home,
        backup.relative,
        "backup_hash_mismatch",
        runtimePath,
        backupPath,
        `backup hash mismatch for ${runtimePath}`,
      );
    }
    await mkdir(dirname(runtimeFile), { recursive: true });
    await copyFile(backupFile, runtimeFile);
    restored += 1;
  }
  return restored;
}

async function validateOldSchemaSmoke(
  home: string,
  backupDir: string,
  files: Record<string, unknown>[],
): Promise<void> {
  for (const file of files) {
    const runtimePath = requiredManifestString(file, "runtime_path");
    const value = asRecord(await readYamlUnknown(assertRuntimeRelativePath(home, runtimePath, "runtime path")));
    const fail = (message: string): never => {
      throw recoveryError(
        home,
        backupDir,
        "restore_failed",
        runtimePath,
        undefined,
        `old schema smoke check failed for ${runtimePath}: ${message}`,
      );
    };
    if (runtimePath.endsWith("/product.yaml")) {
      if (typeof value.id !== "string" || typeof value.name !== "string") {
        fail("product id and name must be strings");
      }
      continue;
    }
    if (runtimePath.endsWith("/requirement.yaml")) {
      if (typeof value.id !== "string" || typeof value.product_id !== "string" || !Array.isArray(value.pages)) {
        fail("requirement id, product_id, and pages[] are required");
      }
      for (const page of arrayOfRecords(value.pages)) {
        if (typeof page.page_id !== "string") {
          fail("requirement pages[].page_id must be a string");
        }
      }
      continue;
    }
    if (runtimePath.endsWith("/baseline/baseline.yaml")) {
      if (typeof value.product_id !== "string" || !Array.isArray(value.pages)) {
        fail("baseline product_id and pages[] are required");
      }
      continue;
    }
    if (runtimePath.endsWith("/copy-translations.yaml") && !Array.isArray(value.translations)) {
      fail("copy translations[] is required");
    }
  }
}

async function readTrustedManifest(
  home: string,
  backup: { absolute: string; relative: string },
): Promise<Record<string, unknown>> {
  const manifestFile = join(backup.absolute, "manifest.yaml");
  const manifest = await readRecoveryYaml(home, backup.relative, manifestFile, "manifest", "manifest_unavailable");
  const manifestHash = stringValue(manifest.manifest_hash);
  const files = arrayOfRecords(manifest.files);
  const expectedHash = hashUnknown({
    files,
    normalizer_version: stringValue(manifest.normalizer_version) ?? V6_SCHEMA_NORMALIZER_VERSION,
  });
  if (manifestHash !== expectedHash) {
    throw recoveryError(home, backup.relative, "manifest_unavailable", "", undefined, "manifest hash mismatch");
  }
  for (const file of files) {
    await assertSafeRuntimeRestoreTarget(home, backup.relative, requiredManifestString(file, "runtime_path"));
    await assertSafeBackupFile(home, backup, requiredManifestString(file, "backup_path"));
  }
  return manifest;
}

async function readRecoveryYaml(
  home: string,
  backupDir: string,
  file: string,
  artifact: string,
  restoreStatus: SchemaNormalizationRestoreStatus,
): Promise<Record<string, unknown>> {
  try {
    return asRecord(await readYamlUnknown(file));
  } catch (error) {
    throw recoveryError(
      home,
      backupDir,
      restoreStatus,
      "",
      toHomeRelative(home, file),
      `${artifact} unavailable or corrupt: ${errorMessage(error)}`,
    );
  }
}

async function assertSafeRuntimeRestoreTarget(home: string, backupDir: string, runtimePath: string): Promise<string> {
  const runtimeFile = assertRuntimeRelativePath(home, runtimePath, "runtime path");
  try {
    await assertNoSymlinkPathSegments(home, runtimeFile, "runtime path");
  } catch (error) {
    throw recoveryError(home, backupDir, "restore_failed", runtimePath, undefined, errorMessage(error));
  }
  return runtimeFile;
}

async function assertSafeBackupFile(
  home: string,
  backup: { absolute: string; relative: string },
  backupPath: string,
): Promise<string> {
  const backupFile = assertBackupRelativePath(home, backup.relative, backupPath);
  try {
    await assertNoSymlinkPathSegments(backup.absolute, backupFile, "backup path");
  } catch (error) {
    throw recoveryError(home, backup.relative, "restore_failed", "", backupPath, errorMessage(error));
  }
  return backupFile;
}

async function assertNoSymlinkPathSegments(root: string, file: string, label: string): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedFile = resolve(file);
  assertResolvedPathUnderLabel(resolvedFile, resolvedRoot, label, resolvedRoot);
  const rel = relative(resolvedRoot, resolvedFile);
  const segments = rel.split(/[\\/]/u).filter(Boolean);
  let current = resolvedRoot;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new Error(`${label} contains a symlink: ${relative(resolvedRoot, current)}`);
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
}

function recoveryError(
  home: string,
  backupDir: string,
  restoreStatus: SchemaNormalizationRestoreStatus,
  runtimePath: string,
  backupPath: string | undefined,
  reason: string,
): SchemaNormalizationRecoveryError {
  return new SchemaNormalizationRecoveryError(
    {
      status: "recovery_required",
      code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
      home,
      backup_dir: backupDir,
      restore_status: restoreStatus,
      restored_file_count: 0,
      recovery_actions: ["recover_v6_normalization_journal", "restore_v6_normalization_backup"],
      failed_files: [
        {
          runtime_path: runtimePath,
          backup_path: backupPath,
          reason,
          restore_status: "pending",
        },
      ],
    },
    reason,
  );
}

function asRecoveryError(
  home: string,
  backupDir: string,
  error: unknown,
  restoreStatus: SchemaNormalizationRestoreStatus,
  runtimePath: string,
  backupPath: string | undefined,
): SchemaNormalizationRecoveryError {
  if (error instanceof SchemaNormalizationRecoveryError) {
    return error;
  }
  return recoveryError(home, backupDir, restoreStatus, runtimePath, backupPath, errorMessage(error));
}

async function readNormalizationReport(home: string): Promise<SchemaNormalizationRecoveryState["report"] | undefined> {
  const reportFile = join(home, "normalization_report.yaml");
  if (!(await fileExists(reportFile))) {
    return undefined;
  }
  const report = asRecord(await readYamlUnknown(reportFile));
  const status = stringValue(report.status);
  const strictSchemaStatus = stringValue(report.strict_schema_status);
  return {
    status:
      status === "passed" || status === "failed" || status === "committed" || status === "restored"
        ? status
        : undefined,
    backup_dir: stringValue(report.backup_dir),
    journal_path: stringValue(report.journal_path),
    rewritten_file_count: numberValue(report.rewritten_file_count),
    strict_schema_status:
      strictSchemaStatus === "passed" || strictSchemaStatus === "failed" ? strictSchemaStatus : undefined,
  };
}

function buildProductCandidate(path: string, product: Record<string, unknown>): CandidateBuildResult {
  const candidate = { ...product };
  const diagnostics: SchemaNormalizationDiagnostic[] = [];
  const deletedFieldCounts: Record<string, number> = {};
  if ("components_initialized" in candidate) {
    delete candidate.components_initialized;
    deletedFieldCounts.components_initialized = 1;
  }
  validateAllowedFields(path, candidate, allowedProductFields, "PRODUCT_UNKNOWN_FIELD", diagnostics);
  validateProductSemantic(path, candidate, diagnostics);
  return { candidate, deletedFieldCounts, generatedCoverage: [], diagnostics };
}

function extractProductRules(product: Record<string, unknown>): ProductRuleRef[] {
  return arrayOfRecords(product.rules).map((rule) => ({
    page_id: stringValue(rule.page_id),
    semantic: isRecord(rule.semantic)
      ? {
          fields: semanticItems(rule.semantic.fields),
          actions: semanticItems(rule.semantic.actions),
          component_keys: arrayOfStrings(rule.semantic.component_keys),
          allowed_copy: arrayOfStrings(rule.semantic.allowed_copy),
        }
      : undefined,
  }));
}

function baselineLabelsById(baseline: Record<string, unknown> | undefined): Map<string, string> {
  const labels = new Map<string, string>();
  for (const page of arrayOfRecords(baseline?.pages)) {
    const id = stringValue(page.id);
    const name = stringValue(page.name);
    if (id !== undefined && name !== undefined) {
      labels.set(id, name);
    }
  }
  return labels;
}

function buildRequirementCandidate(
  path: string,
  requirement: Record<string, unknown>,
  productRules: ProductRuleRef[],
  baselineLabels: Map<string, string>,
): CandidateBuildResult {
  const diagnostics: SchemaNormalizationDiagnostic[] = [];
  const deletedFieldCounts: Record<string, number> = {};
  const navigation = arrayOfRecords(requirement.navigation).map((edge) => ({
    from: stringValue(edge.from) ?? "",
    to: stringValue(edge.to) ?? "",
    label: stringValue(edge.label),
  }));
  const pages = arrayOfRecords(requirement.pages).map((page) => {
    const nextPage = { ...page };
    for (const field of ["design_id", "design_metadata", "pen_path", "preview_file", "preview_path", "preview_url"]) {
      if (field in nextPage) {
        delete nextPage[field];
        deletedFieldCounts[field] = (deletedFieldCounts[field] ?? 0) + 1;
      }
    }
    if (!isRecord(nextPage.semantic_contract)) {
      const built = buildSemanticContractForPage({
        page: {
          page_id: stringValue(nextPage.page_id) ?? "",
          name: stringValue(nextPage.name),
          copy: arrayOfRecords(nextPage.copy).map((item) => ({ text: stringValue(item.text) })),
          declared_fields: semanticItems(nextPage.declared_fields),
          declared_actions: semanticItems(nextPage.declared_actions),
          declared_component_keys: arrayOfStrings(nextPage.declared_component_keys),
        },
        navigation,
        product_rules: productRules,
        baseline_label: baselineLabels.get(stringValue(nextPage.baseline_page) ?? ""),
      });
      nextPage.semantic_contract = built.semantic_contract;
      nextPage.semantic_contract_coverage = built.semantic_contract_coverage;
    }
    return nextPage;
  });
  const candidate = { ...requirement, pages };
  validateAllowedFields(path, candidate, allowedRequirementFields, "REQUIREMENT_UNKNOWN_FIELD", diagnostics);
  validateRequirementCandidate(path, candidate, diagnostics);
  const generatedCoverage = pages
    .filter((page) => !isRecord(page.semantic_contract) || page.semantic_contract_coverage === "minimal")
    .map(() => "minimal" as const);
  return { candidate, deletedFieldCounts, generatedCoverage, diagnostics };
}

function buildBaselineCandidate(
  productId: string,
  path: string,
  baseline: Record<string, unknown>,
  requirementPagesByBaseline: Map<string, RequirementPageRef[]>,
): CandidateBuildResult {
  const diagnostics: SchemaNormalizationDiagnostic[] = [];
  const pages = arrayOfRecords(baseline.pages);
  const candidatePages = pages.map((page) => {
    if (isRecord(page.semantic_contract)) {
      return page;
    }
    const key = `${productId}\u0000${stringValue(page.id) ?? ""}`;
    const source_semantic_contracts = (requirementPagesByBaseline.get(key) ?? [])
      .filter((source) => isRecord(source.page.semantic_contract))
      .map((source) => ({
        source_requirement: source.requirementId,
        page_id: stringValue(source.page.page_id) ?? "",
        semantic_contract: source.page.semantic_contract as SemanticContract,
      }));
    return { ...page, source_semantic_contracts };
  });
  if (candidatePages.every((page) => isRecord(page.semantic_contract))) {
    const candidate = { ...baseline, pages: candidatePages };
    validateAllowedFields(path, candidate, allowedBaselineFields, "BASELINE_UNKNOWN_FIELD", diagnostics);
    validateBaselineCandidate(path, candidate, diagnostics);
    return { candidate, deletedFieldCounts: {}, generatedCoverage: [], diagnostics };
  }

  const built = buildBaselineSemanticContractCandidate({
    product_id: productId,
    pages: candidatePages.map((page) => ({
      id: stringValue(page.id) ?? "",
      name: stringValue(page.name),
      copy: arrayOfRecords(page.copy).map((item) => ({ text: stringValue(item.text) })),
      semantic_contract: isRecord(page.semantic_contract)
        ? (page.semantic_contract as unknown as SemanticContract)
        : undefined,
      semantic_contract_coverage: semanticCoverageValue(page.semantic_contract_coverage),
      declared_fields: semanticItems(page.declared_fields),
      declared_actions: semanticItems(page.declared_actions),
      declared_component_keys: arrayOfStrings(page.declared_component_keys),
      source_requirements: arrayOfStrings(page.source_requirements),
      source_semantic_contracts: Array.isArray(page.source_semantic_contracts)
        ? (page.source_semantic_contracts as Array<{
            source_requirement: string;
            page_id: string;
            semantic_contract: SemanticContract;
          }>)
        : undefined,
    })),
    navigation: arrayOfRecords(baseline.navigation).map((edge) => ({
      from: stringValue(edge.from) ?? "",
      to: stringValue(edge.to) ?? "",
      label: stringValue(edge.label),
    })),
  });

  if (!built.ok) {
    diagnostics.push({
      code: built.code ?? "BASELINE_SEMANTIC_CONTRACT_CONFLICT",
      path,
      message: "baseline semantic contract aggregate contains conflicting labels",
      details: { conflicts: built.conflicts },
    });
  }

  const nextPagesById = new Map(built.pages.map((page) => [page.id, page]));
  const nextPages = pages.map((page) => {
    if (isRecord(page.semantic_contract)) {
      return page;
    }
    const generated = nextPagesById.get(stringValue(page.id) ?? "");
    return {
      ...page,
      semantic_contract: generated?.semantic_contract,
      semantic_contract_coverage: generated?.semantic_contract_coverage,
    };
  });
  const candidate = { ...baseline, pages: nextPages };
  validateAllowedFields(path, candidate, allowedBaselineFields, "BASELINE_UNKNOWN_FIELD", diagnostics);
  validateBaselineCandidate(path, candidate, diagnostics);
  const generatedCoverage = nextPages
    .filter((page) => page.semantic_contract_coverage === "minimal")
    .map(() => "minimal" as const);
  return { candidate, deletedFieldCounts: {}, generatedCoverage, diagnostics };
}

function buildCopyTranslationsCandidate(path: string, translations: Record<string, unknown>): CandidateBuildResult {
  const diagnostics: SchemaNormalizationDiagnostic[] = [];
  validateAllowedFields(
    path,
    translations,
    allowedCopyTranslationFields,
    "COPY_TRANSLATIONS_UNKNOWN_FIELD",
    diagnostics,
  );
  if (!Array.isArray(translations.translations)) {
    diagnostics.push({
      code: "COPY_TRANSLATIONS_INVALID",
      path,
      message: "copy-translations.yaml must contain translations[]",
    });
  }
  for (const [pageIndex, page] of arrayOfRecords(translations.translations).entries()) {
    if (typeof page.page_id !== "string" || !Array.isArray(page.entries)) {
      diagnostics.push({
        code: "COPY_TRANSLATIONS_INVALID",
        path,
        message: `translations[${pageIndex}] must contain page_id and entries[]`,
      });
      continue;
    }
    for (const [entryIndex, entry] of arrayOfRecords(page.entries).entries()) {
      if (typeof entry.context !== "string" || !isRecord(entry.texts)) {
        diagnostics.push({
          code: "COPY_TRANSLATIONS_INVALID",
          path,
          message: `translations[${pageIndex}].entries[${entryIndex}] must contain context and texts`,
        });
        continue;
      }
      for (const [language, text] of Object.entries(entry.texts)) {
        if (typeof text !== "string") {
          diagnostics.push({
            code: "COPY_TRANSLATIONS_INVALID",
            path,
            message: `translations[${pageIndex}].entries[${entryIndex}].texts.${language} must be a string`,
          });
        }
      }
    }
  }
  return { candidate: translations, deletedFieldCounts: {}, generatedCoverage: [], diagnostics };
}

function buildPageLevelDesignMetadataCandidate(
  path: string,
  designMetadata: Record<string, unknown>,
): CandidateBuildResult {
  return {
    candidate: designMetadata,
    deletedFieldCounts: {},
    generatedCoverage: [],
    diagnostics: [
      {
        code: "PAGE_LEVEL_DESIGN_METADATA_DEPRECATED",
        path,
        message: "page-level D-* design metadata is deprecated in v6",
      },
    ],
  };
}

async function toCandidateEntry(
  home: string,
  path: string,
  oldObject: Record<string, unknown>,
  built: CandidateBuildResult,
): Promise<SchemaNormalizationCandidateManifestEntry> {
  return {
    path,
    old_hash: (await fileExists(join(home, path))) ? hashBuffer(await readFile(join(home, path))) : null,
    candidate_hash: hashSerializedYaml(built.candidate),
    candidate: built.candidate,
    validator_source: "preflight_candidate_validator",
    validation_status: built.diagnostics.length === 0 ? "passed" : "failed",
    deleted_field_counts: built.deletedFieldCounts,
    generated_contract_coverage: built.generatedCoverage,
  };
}

function validateProductSemantic(
  path: string,
  product: Record<string, unknown>,
  diagnostics: SchemaNormalizationDiagnostic[],
): void {
  for (const [index, rule] of arrayOfRecords(product.rules).entries()) {
    if (rule.semantic === undefined) {
      continue;
    }
    if (!isRecord(rule.semantic) || !isSemanticRuleShape(rule.semantic)) {
      diagnostics.push({
        code: "PRODUCT_SEMANTIC_INVALID",
        path,
        message: `rules[${index}].semantic must contain valid semantic arrays`,
      });
    }
  }
}

function validateRequirementCandidate(
  path: string,
  requirement: Record<string, unknown>,
  diagnostics: SchemaNormalizationDiagnostic[],
): void {
  for (const [index, page] of arrayOfRecords(requirement.pages).entries()) {
    validateAllowedFields(
      path,
      page,
      allowedRequirementPageFields,
      "REQUIREMENT_PAGE_UNKNOWN_FIELD",
      diagnostics,
      `pages[${index}]`,
    );
    validateOptionalSemanticItems(
      path,
      `pages[${index}].declared_fields`,
      page.declared_fields,
      "REQUIREMENT_DECLARED_FIELDS_INVALID",
      diagnostics,
    );
    validateOptionalSemanticItems(
      path,
      `pages[${index}].declared_actions`,
      page.declared_actions,
      "REQUIREMENT_DECLARED_ACTIONS_INVALID",
      diagnostics,
    );
    validateOptionalStringArray(
      path,
      `pages[${index}].declared_component_keys`,
      page.declared_component_keys,
      "REQUIREMENT_DECLARED_COMPONENT_KEYS_INVALID",
      diagnostics,
    );
    if (!isRecord(page.semantic_contract)) {
      diagnostics.push({
        code: "REQUIREMENT_PAGE_SEMANTIC_CONTRACT_REQUIRED",
        path,
        message: `pages[${index}].semantic_contract is required`,
      });
    } else if (!isSemanticContractShape(page.semantic_contract)) {
      diagnostics.push({
        code: "REQUIREMENT_PAGE_SEMANTIC_CONTRACT_INVALID",
        path,
        message: `pages[${index}].semantic_contract is invalid`,
      });
    }
    if (
      page.semantic_contract_coverage !== undefined &&
      page.semantic_contract_coverage !== "minimal" &&
      page.semantic_contract_coverage !== "explicit"
    ) {
      diagnostics.push({
        code: "REQUIREMENT_PAGE_SEMANTIC_CONTRACT_COVERAGE_INVALID",
        path,
        message: `pages[${index}].semantic_contract_coverage is invalid`,
      });
    }
  }
}

function validateBaselineCandidate(
  path: string,
  baseline: Record<string, unknown>,
  diagnostics: SchemaNormalizationDiagnostic[],
): void {
  for (const [index, page] of arrayOfRecords(baseline.pages).entries()) {
    validateAllowedFields(
      path,
      page,
      allowedBaselinePageFields,
      "BASELINE_PAGE_UNKNOWN_FIELD",
      diagnostics,
      `pages[${index}]`,
    );
    if (!isRecord(page.semantic_contract)) {
      diagnostics.push({
        code: "BASELINE_PAGE_SEMANTIC_CONTRACT_REQUIRED",
        path,
        message: `pages[${index}].semantic_contract is required`,
      });
    } else if (!isSemanticContractShape(page.semantic_contract)) {
      diagnostics.push({
        code: "BASELINE_SEMANTIC_CONTRACT_INVALID",
        path,
        message: `pages[${index}].semantic_contract is invalid`,
      });
    }
    if (
      page.semantic_contract_coverage !== undefined &&
      page.semantic_contract_coverage !== "minimal" &&
      page.semantic_contract_coverage !== "explicit"
    ) {
      diagnostics.push({
        code: "BASELINE_SEMANTIC_CONTRACT_COVERAGE_INVALID",
        path,
        message: `pages[${index}].semantic_contract_coverage is invalid`,
      });
    }
  }
}

function isSemanticRuleShape(semantic: Record<string, unknown>): boolean {
  return (
    (semantic.fields === undefined || isSemanticItemsShape(semantic.fields)) &&
    (semantic.actions === undefined || isSemanticItemsShape(semantic.actions)) &&
    (semantic.component_keys === undefined || isStringArrayShape(semantic.component_keys)) &&
    (semantic.allowed_copy === undefined || isStringArrayShape(semantic.allowed_copy))
  );
}

function isSemanticContractShape(contract: Record<string, unknown>): boolean {
  return (
    isSemanticItemsShape(contract.fields) &&
    isSemanticItemsShape(contract.actions) &&
    isNavigationShape(contract.navigation) &&
    isStringArrayShape(contract.component_keys) &&
    isStringArrayShape(contract.allowed_copy)
  );
}

function validateOptionalSemanticItems(
  path: string,
  fieldPath: string,
  value: unknown,
  code: string,
  diagnostics: SchemaNormalizationDiagnostic[],
): void {
  if (value !== undefined && !isSemanticItemsShape(value)) {
    diagnostics.push({ code, path, message: `${fieldPath} must be an array of key/label objects` });
  }
}

function validateOptionalStringArray(
  path: string,
  fieldPath: string,
  value: unknown,
  code: string,
  diagnostics: SchemaNormalizationDiagnostic[],
): void {
  if (value !== undefined && !isStringArrayShape(value)) {
    diagnostics.push({ code, path, message: `${fieldPath} must be an array of strings` });
  }
}

const allowedProductFields = new Set([
  "id",
  "name",
  "description",
  "platform",
  "style",
  "languages",
  "default_language",
]);
const allowedRequirementFields = new Set([
  "id",
  "product_id",
  "title",
  "status",
  "ui_affected",
  "created_at",
  "updated_at",
  "pages",
  "navigation",
]);
const allowedRequirementPageFields = new Set([
  "page_id",
  "name",
  "baseline_page",
  "design_status",
  "change_type",
  "change_summary",
  "features",
  "copy",
  "fields",
  "interactions",
  "declared_fields",
  "declared_actions",
  "declared_component_keys",
  "semantic_contract",
  "semantic_contract_coverage",
]);
const allowedBaselineFields = new Set(["product_id", "pages", "navigation"]);
const allowedBaselinePageFields = new Set([
  "id",
  "name",
  "features",
  "copy",
  "fields",
  "interactions",
  "source_requirements",
  "semantic_contract",
  "semantic_contract_coverage",
]);
const allowedCopyTranslationFields = new Set(["translations"]);

function validateAllowedFields(
  path: string,
  value: Record<string, unknown>,
  allowed: Set<string>,
  code: string,
  diagnostics: SchemaNormalizationDiagnostic[],
  prefix?: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      diagnostics.push({
        code,
        path,
        message: `${prefix ? `${prefix}.` : ""}${key} is not a documented v6 runtime field`,
      });
    }
  }
}

function semanticCoverageValue(value: unknown): SemanticContractCoverage | undefined {
  return value === "minimal" || value === "explicit" ? value : undefined;
}

function emptySemanticContract(): SemanticContract {
  return {
    actions: [],
    allowed_copy: [],
    component_keys: [],
    fields: [],
    navigation: [],
  };
}

function mergeSemanticContract(
  target: SemanticContract,
  source: SemanticContract,
  pageId: string,
  conflicts: SemanticContractConflict[],
): void {
  mergeSemanticItems(target.fields, semanticItems(source.fields), pageId, conflicts, "field");
  mergeSemanticItems(target.actions, semanticItems(source.actions), pageId, conflicts, "action");
  mergeStrings(target.component_keys, arrayOfStrings(source.component_keys));
  mergeStrings(target.allowed_copy, arrayOfStrings(source.allowed_copy));
  for (const item of arrayOfRecords(source.navigation)) {
    addNavigationTarget(target.navigation, {
      target_page_id: stringValue(item.target_page_id) ?? "",
      label: stringValue(item.label),
    });
  }
}

function mergeSemanticItems(
  target: SemanticContractItem[],
  items: SemanticContractItem[],
  pageId?: string,
  conflicts?: SemanticContractConflict[],
  type?: "action" | "field",
): void {
  for (const item of items) {
    const existing = target.find((candidate) => candidate.key === item.key);
    if (existing === undefined) {
      target.push(item);
      continue;
    }
    if (existing.label !== item.label && pageId !== undefined && conflicts !== undefined && type !== undefined) {
      const labels = [existing.label, item.label].sort();
      if (
        !conflicts.some(
          (conflict) =>
            conflict.page_id === pageId &&
            conflict.type === type &&
            conflict.key === item.key &&
            conflict.labels.join("\u0000") === labels.join("\u0000"),
        )
      ) {
        conflicts.push({ page_id: pageId, type, key: item.key, labels });
      }
    }
  }
}

function mergeStrings(target: string[], values: string[]): void {
  for (const value of values) {
    if (value.length > 0 && !target.includes(value)) {
      target.push(value);
    }
  }
}

function addNavigationTarget(
  target: SemanticContract["navigation"],
  item: { target_page_id: string; label?: string },
): void {
  if (item.target_page_id.length === 0) {
    return;
  }
  if (!target.some((existing) => existing.target_page_id === item.target_page_id && existing.label === item.label)) {
    target.push(item);
  }
}

function isDefinedString(value: string | undefined): value is string {
  return value !== undefined;
}

function isSemanticItemsShape(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.key === "string" &&
        item.key.length > 0 &&
        typeof item.label === "string" &&
        item.label.length > 0,
    )
  );
}

function isNavigationShape(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.target_page_id === "string" &&
        item.target_page_id.length > 0 &&
        (item.label === undefined || typeof item.label === "string"),
    )
  );
}

function isStringArrayShape(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

async function listProductIds(home: string): Promise<string[]> {
  const dataDir = join(home, "data");
  await assertSafeRuntimePath(home, "data", "runtime path");
  const entries = await readDirIfExists(dataDir);
  return entries.filter((entry) => entry.startsWith("P-")).sort();
}

async function listRequirementFiles(home: string, productId: string): Promise<string[]> {
  const productDir = join(home, "data", productId);
  await assertSafeRuntimePath(home, `data/${productId}`, "runtime path");
  const entries = await readDirIfExists(productDir);
  return entries
    .filter((entry) => entry.startsWith("R-"))
    .map((entry) => `data/${productId}/${entry}/requirement.yaml`)
    .sort();
}

async function listPageLevelDesignMetadataFiles(home: string, requirementDir: string): Promise<string[]> {
  const entries = await readDirIfExists(join(home, requirementDir));
  const files: string[] = [];
  for (const entry of entries.filter((name) => /^D-[a-f0-9]{8}$/.test(name)).sort()) {
    const file = `${requirementDir}/${entry}/design.yaml`;
    if (await fileExists(join(home, file))) {
      files.push(file);
    }
  }
  return files;
}

async function hashHomeRuntimeYaml(home: string): Promise<string> {
  const files: Array<{ path: string; hash: string }> = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      const rel = toHomeRelative(home, file);
      const info = await lstat(file);
      if (info.isSymbolicLink()) {
        throw new Error(`runtime path contains a symlink: ${rel}`);
      }
      if (info.isDirectory()) {
        await visit(file);
      } else if (file.endsWith(".yaml")) {
        if (!rel.startsWith("normalization-preflight/") && !rel.startsWith("normalization-backups/")) {
          files.push({ path: rel, hash: hashBuffer(await readFile(file)) });
        }
      }
    }
  }
  if (await fileExists(join(home, "data"))) {
    await visit(await assertSafeRuntimePath(home, "data", "runtime path"));
  }
  return hashUnknown(files.sort((a, b) => a.path.localeCompare(b.path)));
}

async function hasRuntimeYamlNeedingNormalization(home: string): Promise<boolean> {
  async function visit(dir: string): Promise<boolean> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (await visit(file)) {
          return true;
        }
      } else if (file.endsWith(".yaml")) {
        return true;
      }
    }
    return false;
  }

  const dataDir = join(home, "data");
  return (await fileExists(dataDir)) ? visit(dataDir) : false;
}

async function selectLatestJournal(home: string): Promise<JournalSelection> {
  const backupsDir = join(home, "normalization-backups");
  if (await pathExists(backupsDir)) {
    const backupsRoot = await lstat(backupsDir);
    if (backupsRoot.isSymbolicLink() || !backupsRoot.isDirectory()) {
      return {
        ok: false,
        state: recoveryRequiredState(home, { restore_status: "journal_selection_ambiguous", failed_files: [] }),
      };
    }
  }
  const entries = await readDirIfExists(backupsDir);
  const journals: Array<{ journal: Record<string, unknown>; journal_file: string }> = [];
  for (const entry of entries.filter((name) => name.startsWith("v6-")).sort()) {
    const backupDir = join(backupsDir, entry);
    const backupDirStat = await lstat(backupDir);
    if (backupDirStat.isSymbolicLink() || !backupDirStat.isDirectory()) {
      return {
        ok: false,
        state: recoveryRequiredState(home, { restore_status: "journal_selection_ambiguous", failed_files: [] }),
      };
    }
    const journalFile = join(backupsDir, entry, "normalization-journal.yaml");
    if (!(await pathExists(journalFile))) {
      continue;
    }
    const journalFileStat = await lstat(journalFile);
    if (journalFileStat.isSymbolicLink() || !journalFileStat.isFile()) {
      return {
        ok: false,
        state: recoveryRequiredState(home, { restore_status: "journal_selection_ambiguous", failed_files: [] }),
      };
    }
    if (!(await isPathUnderExistingDir(journalFile, backupDir))) {
      return {
        ok: false,
        state: recoveryRequiredState(home, { restore_status: "journal_selection_ambiguous", failed_files: [] }),
      };
    }
    let journal: Record<string, unknown>;
    try {
      journal = asRecord(await readYamlUnknown(journalFile));
    } catch {
      return {
        ok: false,
        state: recoveryRequiredState(home, { restore_status: "journal_selection_ambiguous", failed_files: [] }),
      };
    }
    if (!isSelfConsistentJournal(home, journalFile, journal)) {
      return {
        ok: false,
        state: recoveryRequiredState(home, { restore_status: "journal_selection_ambiguous", failed_files: [] }),
      };
    }
    journals.push({ journal, journal_file: journalFile });
  }
  const nonTerminal = journals.filter((item) =>
    ["created", "backed_up", "writing", "validating", "recovery_required"].includes(
      stringValue(item.journal.status) ?? "",
    ),
  );
  if (nonTerminal.length > 1) {
    return {
      ok: false,
      state: recoveryRequiredState(home, { restore_status: "journal_selection_ambiguous", failed_files: [] }),
    };
  }
  journals.sort(
    (a, b) =>
      compareDesc(stringValue(a.journal.created_at) ?? "", stringValue(b.journal.created_at) ?? "") ||
      compareDesc(stringValue(a.journal.backup_dir) ?? "", stringValue(b.journal.backup_dir) ?? ""),
  );
  const latest = journals[0];
  return latest === undefined ? { ok: true } : { ok: true, journal: latest.journal, journal_file: latest.journal_file };
}

async function validateJournalArtifacts(
  home: string,
  journal: Record<string, unknown>,
  journalFile: string | undefined,
): Promise<SchemaNormalizationRecoveryState | undefined> {
  const manifestPath = stringValue(journal.manifest_path);
  const journalManifestHash = stringValue(journal.manifest_hash);
  const backupDir = stringValue(journal.backup_dir);
  if (
    manifestPath === undefined ||
    journalManifestHash === undefined ||
    backupDir === undefined ||
    manifestPath !== `${backupDir}/manifest.yaml`
  ) {
    return recoveryRequiredState(home, {
      restore_status: "manifest_unavailable",
      ...journalStateFields(home, journal, journalFile),
      failed_files: [],
    });
  }

  const manifestFile = join(home, manifestPath);
  if (!(await isPathUnderExistingDir(manifestFile, join(home, backupDir)))) {
    return recoveryRequiredState(home, {
      restore_status: "manifest_unavailable",
      ...journalStateFields(home, journal, journalFile),
      failed_files: [],
    });
  }
  if (!(await fileExists(manifestFile))) {
    return recoveryRequiredState(home, {
      restore_status: "manifest_unavailable",
      ...journalStateFields(home, journal, journalFile),
      failed_files: [],
    });
  }

  const manifest = asRecord(await readYamlUnknown(manifestFile));
  if (stringValue(manifest.manifest_hash) !== journalManifestHash) {
    return recoveryRequiredState(home, {
      restore_status: "manifest_unavailable",
      ...journalStateFields(home, journal, journalFile),
      failed_files: [],
    });
  }

  const failedBackups: SchemaNormalizationFailedFile[] = [];
  for (const file of arrayOfRecords(journal.rewritten_files)) {
    if (stringValue(file.write_status) === "not_started" && file.candidate_hash === null) {
      continue;
    }
    const backupPath = stringValue(file.backup_path);
    const oldHash = stringValue(file.old_hash);
    if (backupPath === undefined || oldHash === undefined) {
      continue;
    }
    const backupFile = join(home, backupPath);
    if (!(await isPathUnderExistingDir(backupFile, join(home, "normalization-backups")))) {
      failedBackups.push({
        runtime_path: stringValue(file.runtime_path) ?? "",
        backup_path: backupPath,
        reason: "backup path is outside normalization-backups",
        restore_status: "pending",
      });
      continue;
    }
    try {
      const actualHash = hashBuffer(await readFile(backupFile));
      if (actualHash !== oldHash) {
        failedBackups.push({
          runtime_path: stringValue(file.runtime_path) ?? "",
          backup_path: backupPath,
          reason: "backup hash mismatch",
          restore_status: "pending",
        });
      }
    } catch {
      failedBackups.push({
        runtime_path: stringValue(file.runtime_path) ?? "",
        backup_path: backupPath,
        reason: "backup file unavailable",
        restore_status: "pending",
      });
    }
  }

  if (failedBackups.length > 0) {
    return recoveryRequiredState(home, {
      restore_status: "backup_hash_mismatch",
      ...journalStateFields(home, journal, journalFile),
      failed_files: failedBackups,
    });
  }

  return undefined;
}

function journalStateFields(
  home: string,
  journal: Record<string, unknown>,
  journalFile: string | undefined,
): Partial<SchemaNormalizationRecoveryState> {
  return {
    backup_dir: stringValue(journal.backup_dir),
    journal_path: journalFile === undefined ? undefined : toHomeRelative(home, journalFile),
    manifest_path: stringValue(journal.manifest_path),
    manifest_hash: stringValue(journal.manifest_hash),
    normalizer_version: stringValue(journal.normalizer_version),
  };
}

function restoreStatusForJournal(journal: Record<string, unknown>): SchemaNormalizationRestoreStatus {
  const rewrittenFiles = arrayOfRecords(journal.rewritten_files);
  if (rewrittenFiles.length === 0) {
    return "no_runtime_writes";
  }
  return rewrittenFiles.every(
    (file) => stringValue(file.write_status) === "not_started" && file.candidate_hash === null,
  )
    ? "no_runtime_writes"
    : "restore_failed";
}

function failedFilesFromJournal(journal: Record<string, unknown>): SchemaNormalizationFailedFile[] {
  return arrayOfRecords(journal.rewritten_files).map((file) => ({
    runtime_path: stringValue(file.runtime_path) ?? "",
    backup_path: stringValue(file.backup_path),
    reason: stringValue(file.last_error) ?? "journal requires recovery",
    restore_status: "pending",
  }));
}

function isSelfConsistentJournal(home: string, journalFile: string, journal: Record<string, unknown>): boolean {
  const createdAt = stringValue(journal.created_at);
  const backupDir = stringValue(journal.backup_dir);
  const manifestPath = stringValue(journal.manifest_path);
  const manifestHash = stringValue(journal.manifest_hash);
  const normalizerVersion = stringValue(journal.normalizer_version);
  if (
    createdAt === undefined ||
    backupDir === undefined ||
    manifestPath === undefined ||
    manifestHash === undefined ||
    normalizerVersion === undefined
  ) {
    return false;
  }
  if (basename(dirname(journalFile)) !== `v6-${createdAt}` || backupDir !== `normalization-backups/v6-${createdAt}`) {
    return false;
  }
  return !isAbsolute(backupDir) && !isAbsolute(manifestPath) && resolve(home, backupDir) === dirname(journalFile);
}

function asPreflightReport(value: unknown): SchemaNormalizationPreflightReport {
  const report = asRecord(value) as unknown as SchemaNormalizationPreflightReport;
  if (
    typeof report.created_at !== "string" ||
    typeof report.report_dir !== "string" ||
    typeof report.report_file !== "string" ||
    typeof report.normalizer_version !== "string" ||
    typeof report.home_hash !== "string" ||
    typeof report.status !== "string" ||
    typeof report.strict_schema_status !== "string" ||
    typeof report.candidate_manifest_hash !== "string" ||
    !Array.isArray(report.candidates)
  ) {
    throw new Error("Invalid preflight report");
  }
  return report;
}

async function isSelfConsistentReport(
  home: string,
  reportPath: string,
  report: SchemaNormalizationPreflightReport,
): Promise<boolean> {
  if (basename(dirname(reportPath)) !== `v6-${report.created_at}`) {
    return false;
  }
  if (isAbsolute(report.report_dir) || isAbsolute(report.report_file)) {
    return false;
  }
  if (report.report_dir !== `normalization-preflight/v6-${report.created_at}`) {
    return false;
  }
  if (report.report_file !== `${report.report_dir}/report.yaml`) {
    return false;
  }
  const realReport = await realpath(reportPath);
  const realDeclared = await realpath(join(home, report.report_file));
  return (
    realReport === realDeclared && (await isPathUnderExistingDir(realReport, join(home, "normalization-preflight")))
  );
}

function hasReportConflict(reports: SchemaNormalizationPreflightReport[]): boolean {
  const identities = new Set(
    reports.map((report) =>
      stableStringify({
        status: report.status,
        strict_schema_status: report.strict_schema_status,
        home_hash: report.home_hash,
        candidate_manifest_hash: report.candidate_manifest_hash,
        validator_identity: report.candidates.map((candidate) => candidate.validator_source).sort(),
      }),
    ),
  );
  return identities.size > 1;
}

function sortReports(
  reports: Array<{ report: SchemaNormalizationPreflightReport; report_path: string }>,
): Array<{ report: SchemaNormalizationPreflightReport; report_path: string }> {
  return [...reports].sort(
    (a, b) =>
      compareDesc(a.report.created_at, b.report.created_at) || compareDesc(a.report.report_file, b.report.report_file),
  );
}

function preflightRequiredState(
  home: string,
  preflightStatus: NonNullable<SchemaNormalizationRecoveryState["preflight_status"]>,
  preflightReason?: SchemaNormalizationRecoveryState["preflight_reason"],
  extra: Partial<SchemaNormalizationRecoveryState> = {},
): SchemaNormalizationRecoveryState {
  return {
    mode: "preflight_only",
    status: "preflight_required",
    code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
    message: "v6 schema normalization preflight is required",
    home,
    preflight_status: preflightStatus,
    preflight_reason: preflightReason,
    restore_status: "none",
    failed_files: [],
    recovery_actions: ["run_schema_normalization_dry_run", "run_v6_schema_cutover"],
    ...extra,
  };
}

function recoveryRequiredState(
  home: string,
  extra: Partial<SchemaNormalizationRecoveryState> & { restore_status: SchemaNormalizationRestoreStatus },
): SchemaNormalizationRecoveryState {
  return {
    mode: "recovery_only",
    status: "recovery_required",
    code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
    message: "v6 schema normalization recovery is required",
    home,
    failed_files: extra.failed_files ?? [],
    recovery_actions: ["recover_v6_normalization_journal", "restore_v6_normalization_backup"],
    ...extra,
  };
}

async function isPathUnderExistingDir(file: string, dir: string): Promise<boolean> {
  try {
    const realFile = await realpath(file);
    const realDir = await realpath(dir);
    const rel = relative(realDir, realFile);
    return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
  } catch {
    return false;
  }
}

async function assertSafePreflightReportTarget(home: string, reportFile: string): Promise<void> {
  const realHome = await realpath(home);
  const preflightDir = join(home, "normalization-preflight");
  const reportDir = dirname(join(home, reportFile));

  if (await pathExists(preflightDir)) {
    const preflightStat = await lstat(preflightDir);
    if (preflightStat.isSymbolicLink() || !preflightStat.isDirectory()) {
      throw new Error("normalization-preflight must be a real directory under Forma home");
    }
    assertResolvedPathUnder(await realpath(preflightDir), realHome, "normalization-preflight");
  }

  if (await pathExists(reportDir)) {
    const reportDirStat = await lstat(reportDir);
    if (reportDirStat.isSymbolicLink() || !reportDirStat.isDirectory()) {
      throw new Error("normalization-preflight report directory must be a real directory under Forma home");
    }
    assertResolvedPathUnder(await realpath(reportDir), realHome, "normalization-preflight report directory");
  }
}

async function assertSafeBackupTarget(home: string, backupDir: string): Promise<void> {
  const realHome = await realpath(home);
  const backupsDir = join(home, "normalization-backups");
  if (await pathExists(backupsDir)) {
    const backupsStat = await lstat(backupsDir);
    if (backupsStat.isSymbolicLink() || !backupsStat.isDirectory()) {
      throw new Error("normalization-backups must be a real directory under Forma home");
    }
    assertResolvedPathUnderLabel(await realpath(backupsDir), realHome, "normalization-backups", "Forma home");
  }
  assertResolvedPathUnderLabel(backupDir, backupsDir, "backup directory", "normalization-backups");
  await assertNoSymlinkPathSegments(home, backupDir, "backup directory");
}

function assertSafeTimestampSegment(value: string): void {
  if (
    value.length === 0 ||
    value.includes("/") ||
    value.includes("\\") ||
    value === "." ||
    value === ".." ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("createdAt must be a single safe path segment");
  }
}

function assertResolvedPathUnder(file: string, dir: string, label: string): void {
  assertResolvedPathUnderLabel(file, dir, label, "normalization-preflight");
}

function assertResolvedPathUnderLabel(file: string, dir: string, label: string, parentLabel: string): void {
  const resolvedFile = resolve(file);
  const resolvedDir = resolve(dir);
  const rel = relative(resolvedDir, resolvedFile);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${label} must stay under ${parentLabel}`);
  }
}

function assertRuntimeRelativePath(home: string, runtimePath: string, label: string): string {
  if (isAbsolute(runtimePath) || runtimePath.length === 0) {
    throw new Error(`${label} must be relative`);
  }
  const resolved = resolve(home, runtimePath);
  assertResolvedPathUnderLabel(resolved, home, label, "Forma home");
  return resolved;
}

async function assertSafeRuntimePath(home: string, runtimePath: string, label: string): Promise<string> {
  const resolved = assertRuntimeRelativePath(home, runtimePath, label);
  await assertNoSymlinkPathSegments(home, resolved, label);
  return resolved;
}

function assertBackupRelativePath(home: string, backupDir: string, backupPath: string): string {
  if (isAbsolute(backupPath) || backupPath.length === 0) {
    throw new Error("backup path must be relative");
  }
  const backupRoot = resolve(home, backupDir);
  const resolved = resolve(home, backupPath);
  assertResolvedPathUnderLabel(resolved, backupRoot, "backup path", "backup directory");
  return resolved;
}

function assertBackupFileUnderDir(root: string, relativePath: string): string {
  if (isAbsolute(relativePath) || relativePath.length === 0) {
    throw new Error("rollback capture path must be relative");
  }
  const resolved = resolve(root, relativePath);
  assertResolvedPathUnderLabel(resolved, root, "rollback capture path", "rollback-capture");
  return resolved;
}

async function resolveBackupDirUnderHome(
  home: string,
  backupDir: string,
): Promise<{ absolute: string; relative: string }> {
  const requested = isAbsolute(backupDir) ? resolve(backupDir) : resolve(home, backupDir);
  const backupsRoot = join(home, "normalization-backups");
  const realRequested = await realpath(requested);
  const realBackupsRoot = await realpath(backupsRoot);
  const rel = relative(realBackupsRoot, realRequested);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("backup-dir must stay under the current Forma home normalization-backups directory");
  }
  const requestedStat = await lstat(requested);
  if (requestedStat.isSymbolicLink() || !requestedStat.isDirectory()) {
    throw new Error("backup-dir must be a real directory");
  }
  return { absolute: requested, relative: toHomeRelative(home, requested) };
}

function requiredManifestString(file: Record<string, unknown>, key: string): string {
  const value = stringValue(file[key]);
  if (value === undefined) {
    throw new Error(`manifest file entry missing ${key}`);
  }
  return value;
}

function semanticItems(value: unknown): Array<{ key: string; label: string }> {
  return arrayOfRecords(value)
    .map((item) => ({ key: stringValue(item.key) ?? "", label: stringValue(item.label) ?? "" }))
    .filter((item) => item.key.length > 0 && item.label.length > 0);
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

async function readDirIfExists(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function toHomeRelative(home: string, file: string): string {
  return relative(home, file).split("/").join("/");
}

function hashUnknown(value: unknown): string {
  return hashBuffer(Buffer.from(stableStringify(value)));
}

function hashSerializedYaml(value: unknown): string {
  return hashBuffer(Buffer.from(yaml.dump(value, { noRefs: true, sortKeys: true })));
}

function hashBuffer(buffer: Buffer): string {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareDesc(a: string, b: string): number {
  return b.localeCompare(a);
}
