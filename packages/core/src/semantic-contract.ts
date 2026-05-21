export type SemanticContractCoverage = "explicit" | "minimal";
export type SemanticContractGeneratedSource = "explicit" | "minimal";

export interface SemanticContractField {
  key: string;
  label: string;
}

export interface SemanticContractAction {
  key: string;
  label: string;
}

export interface SemanticContractNavigationTarget {
  target_page_id: string;
  label?: string;
}

export interface SemanticContract {
  fields: SemanticContractField[];
  actions: SemanticContractAction[];
  navigation: SemanticContractNavigationTarget[];
  component_keys: string[];
  allowed_copy: string[];
}

export interface SemanticContractConflictDetail {
  kind: "field" | "action";
  key: string;
  labels: string[];
}

export interface PageSemanticContractInput {
  page: {
    page_id: string;
    name?: string;
    copy?: Array<{ text?: string }>;
    semantic_contract?: SemanticContract;
    semantic_contract_coverage?: SemanticContractCoverage;
    declared_fields?: SemanticContractField[];
    declared_actions?: SemanticContractAction[];
    declared_component_keys?: string[];
  };
  navigation?: Array<{ from: string; to: string; label?: string }>;
  product_rules?: Array<{
    page_id?: string;
    semantic?: {
      fields?: SemanticContractField[];
      actions?: SemanticContractAction[];
      component_keys?: string[];
      allowed_copy?: string[];
    };
  }>;
  baseline_label?: string;
}

export interface PageSemanticContractResult {
  semantic_contract: SemanticContract;
  semantic_contract_coverage: SemanticContractCoverage;
  generated_source: SemanticContractGeneratedSource;
  conflicts: SemanticContractConflictDetail[];
}

export interface BaselineSemanticSourceContract {
  source_requirement: string;
  page_id: string;
  semantic_contract: SemanticContract;
}

export interface BaselineSemanticCandidatePageInput {
  id: string;
  name?: string;
  copy?: Array<{ text?: string }>;
  semantic_contract?: SemanticContract;
  semantic_contract_coverage?: SemanticContractCoverage;
  declared_fields?: SemanticContractField[];
  declared_actions?: SemanticContractAction[];
  declared_component_keys?: string[];
  source_requirements?: string[];
  source_semantic_contracts?: BaselineSemanticSourceContract[];
}

export interface BaselineSemanticContractCandidateInput {
  product_id: string;
  pages: BaselineSemanticCandidatePageInput[];
  navigation?: Array<{ from: string; to: string; label?: string }>;
}

export interface BaselineSemanticContractCandidatePage {
  id: string;
  semantic_contract: SemanticContract;
  semantic_contract_coverage: SemanticContractCoverage;
}

export type BaselineSemanticContractCandidateResult =
  | {
      ok: true;
      conflicts: [];
      pages: BaselineSemanticContractCandidatePage[];
    }
  | {
      ok: false;
      code: "BASELINE_SEMANTIC_CONTRACT_CONFLICT";
      conflicts: SemanticContractConflictDetail[];
      pages: BaselineSemanticContractCandidatePage[];
    };

export function buildSemanticContractForPage(input: PageSemanticContractInput): PageSemanticContractResult {
  if (input.page.semantic_contract !== undefined) {
    return {
      semantic_contract: input.page.semantic_contract,
      semantic_contract_coverage: input.page.semantic_contract_coverage ?? "explicit",
      generated_source: "explicit",
      conflicts: []
    };
  }

  const rules = (input.product_rules ?? []).filter((rule) => rule.page_id === undefined || rule.page_id === input.page.page_id);
  const semantic_contract: SemanticContract = {
    fields: dedupeByKey([
      ...(input.page.declared_fields ?? []),
      ...rules.flatMap((rule) => rule.semantic?.fields ?? [])
    ]),
    actions: dedupeByKey([
      ...(input.page.declared_actions ?? []),
      ...rules.flatMap((rule) => rule.semantic?.actions ?? [])
    ]),
    navigation: dedupeNavigation(
      (input.navigation ?? [])
        .filter((edge) => edge.from === input.page.page_id)
        .map((edge) => ({ target_page_id: edge.to, label: edge.label }))
    ),
    component_keys: dedupeStrings([
      ...(input.page.declared_component_keys ?? []),
      ...rules.flatMap((rule) => rule.semantic?.component_keys ?? [])
    ]),
    allowed_copy: dedupeStrings([
      input.page.name,
      ...(input.page.copy ?? []).map((item) => item.text),
      input.baseline_label,
      ...rules.flatMap((rule) => rule.semantic?.allowed_copy ?? [])
    ])
  };

  return {
    semantic_contract,
    semantic_contract_coverage: "minimal",
    generated_source: "minimal",
    conflicts: []
  };
}

export function buildBaselineSemanticContractCandidate(
  input: BaselineSemanticContractCandidateInput
): BaselineSemanticContractCandidateResult {
  const conflicts: SemanticContractConflictDetail[] = [];
  const pages = input.pages.map((page) => {
    const explicit = page.semantic_contract;
    const sourceContracts = page.source_semantic_contracts?.map((source) => source.semantic_contract) ?? [];
    const conflictInputs = explicit === undefined ? sourceContracts : [explicit, ...sourceContracts];
    conflicts.push(...findKeyLabelConflicts(conflictInputs));

    if (explicit !== undefined) {
      return {
        id: page.id,
        semantic_contract: explicit,
        semantic_contract_coverage: page.semantic_contract_coverage ?? "explicit"
      };
    }

    const semantic_contract: SemanticContract = {
      fields: dedupeByKey([
        ...(page.declared_fields ?? []),
        ...sourceContracts.flatMap((contract) => contract.fields)
      ]),
      actions: dedupeByKey([
        ...(page.declared_actions ?? []),
        ...sourceContracts.flatMap((contract) => contract.actions)
      ]),
      navigation: dedupeNavigation(
        (input.navigation ?? [])
          .filter((edge) => edge.from === page.id)
          .map((edge) => ({ target_page_id: edge.to, label: edge.label }))
      ),
      component_keys: dedupeStrings([
        ...(page.declared_component_keys ?? []),
        ...sourceContracts.flatMap((contract) => contract.component_keys)
      ]),
      allowed_copy: dedupeStrings([
        page.name,
        ...(page.copy ?? []).map((item) => item.text),
        ...sourceContracts.flatMap((contract) => contract.allowed_copy)
      ])
    };

    return {
      id: page.id,
      semantic_contract,
      semantic_contract_coverage: "minimal" as const
    };
  });

  const uniqueConflicts = dedupeConflicts(conflicts);
  if (uniqueConflicts.length > 0) {
    return {
      ok: false,
      code: "BASELINE_SEMANTIC_CONTRACT_CONFLICT",
      conflicts: uniqueConflicts,
      pages
    };
  }

  return { ok: true, conflicts: [], pages };
}

function dedupeByKey<T extends { key: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const next: T[] = [];
  for (const item of items) {
    if (!item.key || seen.has(item.key)) {
      continue;
    }
    seen.add(item.key);
    next.push(item);
  }
  return next;
}

function dedupeNavigation(items: SemanticContractNavigationTarget[]): SemanticContractNavigationTarget[] {
  const seen = new Set<string>();
  const next: SemanticContractNavigationTarget[] = [];
  for (const item of items) {
    const key = `${item.target_page_id}\u0000${item.label ?? ""}`;
    if (!item.target_page_id || seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(item);
  }
  return next;
}

function dedupeStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    if (value === undefined || value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    next.push(value);
  }
  return next;
}

function findKeyLabelConflicts(contracts: SemanticContract[]): SemanticContractConflictDetail[] {
  return [
    ...findConflictsForKind("field", contracts.flatMap((contract) => contract.fields)),
    ...findConflictsForKind("action", contracts.flatMap((contract) => contract.actions))
  ];
}

function findConflictsForKind(
  kind: SemanticContractConflictDetail["kind"],
  items: Array<{ key: string; label: string }>
): SemanticContractConflictDetail[] {
  const labelsByKey = new Map<string, string[]>();
  for (const item of items) {
    const labels = labelsByKey.get(item.key) ?? [];
    if (!labels.includes(item.label)) {
      labels.push(item.label);
    }
    labelsByKey.set(item.key, labels);
  }

  return [...labelsByKey.entries()]
    .filter(([, labels]) => labels.length > 1)
    .map(([key, labels]) => ({ kind, key, labels }));
}

function dedupeConflicts(conflicts: SemanticContractConflictDetail[]): SemanticContractConflictDetail[] {
  const seen = new Set<string>();
  const next: SemanticContractConflictDetail[] = [];
  for (const conflict of conflicts) {
    const key = `${conflict.kind}\u0000${conflict.key}\u0000${conflict.labels.join("\u0000")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(conflict);
  }
  return next;
}
