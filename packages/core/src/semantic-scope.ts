import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { baselineSchema, type ProductBaseline } from "./baseline.js";
import { getProductComponentLibrary } from "./components.js";
import { FormaError } from "./errors.js";
import { parsePenDocument, walkPenNodes, type PenDocument, type PenNode } from "./pen-model.js";
import type { Product } from "./product.js";
import { requirementSchema, type Requirement } from "./requirement.js";
import { readYaml, readYamlAs, writeYamlAtomic } from "./yaml.js";

export const allowedSemanticSurfaceSchema = z.object({
  schema_version: z.literal(1),
  product_id: z.string().min(1),
  requirement_id: z.string().min(1),
  language: z.string().min(1),
  page_ids: z.array(z.string().min(1)),
  allowed_copy: z.array(z.string()),
  action_keys: z.array(z.string().min(1)),
  navigation_targets: z.array(z.string().min(1)),
  field_keys: z.array(z.string().min(1)),
  component_keys: z.array(z.string().min(1)),
  visual_states: z.array(z.string().min(1)),
  existing_node_ids: z.array(z.string().min(1)),
  baseline_node_ids: z.array(z.string().min(1)),
  source_inputs: z.object({
    requirement_hash: z.string().min(1),
    translations_hash: z.string().min(1),
    rules_hash: z.string().min(1),
    baseline_hash: z.string().min(1),
    product_hash: z.string().min(1),
    component_library_hash: z.string().min(1),
    current_design_hash: z.string().min(1)
  }).strict(),
  source_contract_hash: z.string().min(1),
  staging_revision: z.string().min(1).optional()
}).strict();

export type AllowedSemanticSurface = z.infer<typeof allowedSemanticSurfaceSchema>;

export interface SemanticScopeViolation {
  node_id: string;
  code:
    | "COPY_NOT_ALLOWED"
    | "ACTION_NOT_ALLOWED"
    | "NAVIGATION_NOT_ALLOWED"
    | "FIELD_NOT_ALLOWED"
    | "COMPONENT_NOT_ALLOWED"
    | "DECORATIVE_HAS_BUSINESS_SEMANTICS"
    | "UNCLASSIFIED_BUSINESS_SEMANTICS";
  value?: string;
}

export async function deriveAllowedSemanticSurface(input: {
  home: string;
  product_id: string;
  requirement_id: string;
  language: string;
  current_design?: PenDocument;
}): Promise<AllowedSemanticSurface> {
  const home = resolve(input.home);
  const requirementFile = join(home, "data", input.product_id, input.requirement_id, "requirement.yaml");
  const translationsFile = join(home, "data", input.product_id, input.requirement_id, "copy-translations.yaml");
  const rulesFile = join(home, "data", input.product_id, "baseline", "rules.yaml");
  const baselineFile = join(home, "data", input.product_id, "baseline", "baseline.yaml");
  const productFile = join(home, "data", input.product_id, "product.yaml");
  const requirement = await readYamlAs(requirementFile, requirementSchema);
  const translations = await readOptionalYaml<Record<string, unknown>>(translationsFile, { translations: [] });
  const rules = await readOptionalYaml<Record<string, unknown>>(rulesFile, { rules: [] });
  const baseline = await readOptionalBaseline(baselineFile, input.product_id);
  const product = await readOptionalYaml<Product | Record<string, unknown>>(productFile, {});
  const componentLibrary = await getProductComponentLibrary(home, input.product_id);
  const componentKeys = new Set(componentLibrary.status === "complete" ? componentLibrary.components.map((component) => component.key) : []);
  const ruleSemantic = readRuleSemantic(rules);
  const translatedCopy = readTranslatedCopy(translations, input.language);
  const declaredComponentKeys = [
    ...requirement.pages.flatMap((page) => [
      ...(page.declared_component_keys ?? []),
      ...page.semantic_contract.component_keys
    ]),
    ...baseline.pages.flatMap((page) => page.semantic_contract.component_keys),
    ...ruleSemantic.component_keys
  ];
  const allowedComponents = declaredComponentKeys.filter((key) => componentKeys.has(key));
  const currentNodes = input.current_design ? walkPenNodes(input.current_design.children).map((node) => node.id) : [];
  const sourceInputs = {
    requirement_hash: stableHash(requirement),
    translations_hash: stableHash(translations),
    rules_hash: stableHash(rules),
    baseline_hash: stableHash(baseline),
    product_hash: stableHash(product),
    component_library_hash: stableHash(componentLibrary.status === "complete" ? {
      current_version: componentLibrary.current_version,
      components: componentLibrary.components
    } : { status: componentLibrary.status }),
    current_design_hash: stableHash(input.current_design ? walkPenNodes(input.current_design.children).map((node) => ({
      id: node.id,
      metadata: node.metadata
    })) : [])
  };

  return allowedSemanticSurfaceSchema.parse({
    schema_version: 1,
    product_id: input.product_id,
    requirement_id: input.requirement_id,
    language: input.language,
    page_ids: requirement.pages.map((page) => page.page_id),
    allowed_copy: dedupe([
      ...requirement.pages.flatMap((page) => [
        page.name,
        ...(page.copy ?? []).map((copy) => copy.text),
        ...page.semantic_contract.allowed_copy
      ]),
      ...baseline.pages.flatMap((page) => [
        page.name,
        ...page.copy.map((copy) => copy.text),
        ...page.semantic_contract.allowed_copy
      ]),
      ...ruleSemantic.allowed_copy,
      ...translatedCopy
    ]),
    action_keys: dedupe(requirement.pages.flatMap((page) => [
      ...(page.declared_actions ?? []).map((action) => action.key),
      ...page.semantic_contract.actions.map((action) => action.key),
      ...baseline.pages.flatMap((baselinePage) => baselinePage.semantic_contract.actions.map((action) => action.key)),
      ...ruleSemantic.action_keys
    ])),
    navigation_targets: dedupe([
      ...requirement.navigation.flatMap((item) => [item.from, item.to]),
      ...baseline.navigation.flatMap((item) => [item.from, item.to]),
      ...requirement.pages.flatMap((page) => page.semantic_contract.navigation.map((item) => item.target_page_id)),
      ...baseline.pages.flatMap((page) => page.semantic_contract.navigation.map((item) => item.target_page_id))
    ]),
    field_keys: dedupe(requirement.pages.flatMap((page) => [
      ...(page.declared_fields ?? []).map((field) => field.key),
      ...page.semantic_contract.fields.map((field) => field.key),
      ...baseline.pages.flatMap((baselinePage) => baselinePage.semantic_contract.fields.map((field) => field.key)),
      ...ruleSemantic.field_keys
    ])),
    component_keys: dedupe(allowedComponents),
    visual_states: ["default", "hover", "focus", "active", "disabled", "empty", "loading", "error"],
    existing_node_ids: dedupe(currentNodes),
    baseline_node_ids: dedupe([
      ...requirement.pages.map((page) => page.baseline_page),
      ...baseline.pages.map((page) => page.id)
    ]),
    source_inputs: sourceInputs,
    source_contract_hash: stableHash(sourceInputs)
  });
}

export async function writeSemanticScope(input: {
  file: string;
  surface: AllowedSemanticSurface;
}): Promise<void> {
  await writeYamlAtomic(input.file, input.surface);
}

export async function readSemanticScope(file: string): Promise<AllowedSemanticSurface> {
  return readYamlAs(file, allowedSemanticSurfaceSchema);
}

export async function assertSemanticScopeCurrent(input: {
  home: string;
  product_id: string;
  requirement_id: string;
  scope: AllowedSemanticSurface;
  current_design?: PenDocument;
}): Promise<void> {
  const current = await deriveAllowedSemanticSurface({
    home: input.home,
    product_id: input.product_id,
    requirement_id: input.requirement_id,
    language: input.scope.language,
    current_design: input.current_design
  });
  const currentHash = current.source_contract_hash;
  if (currentHash !== input.scope.source_contract_hash) {
    throw new FormaError("SEMANTIC_SCOPE_CHANGED", "Semantic scope changed after the design session began", {
      expected: input.scope.source_contract_hash,
      actual: currentHash
    });
  }
}

export function validateSemanticScope(input: {
  document: PenDocument;
  scope: AllowedSemanticSurface;
}): { status: "passed" } | { status: "blocked"; code: "DESIGN_SCOPE_VIOLATION"; violations: SemanticScopeViolation[] } {
  const violations: SemanticScopeViolation[] = [];
  const allowedCopy = new Set(input.scope.allowed_copy);
  const actions = new Set(input.scope.action_keys);
  const navigation = new Set(input.scope.navigation_targets);
  const fields = new Set(input.scope.field_keys);
  const components = new Set(input.scope.component_keys);

  for (const node of walkPenNodes(input.document.children)) {
    const metadata = node.metadata ?? {};
    const semantic = typeof metadata.semantic === "string" ? metadata.semantic : undefined;
    const decorative = metadata.decorative === true || semantic === "decorative";
    const text = typeof node.text === "string" ? node.text : typeof metadata.copy === "string" ? metadata.copy : undefined;
    if (decorative && hasBusinessSemantic(metadata)) {
      violations.push({ node_id: node.id, code: "DECORATIVE_HAS_BUSINESS_SEMANTICS" });
      continue;
    }
    if (decorative) {
      continue;
    }
    if (text && isBusinessText(text) && !allowedCopy.has(text)) {
      violations.push({ node_id: node.id, code: "COPY_NOT_ALLOWED", value: text });
    }
    pushUnclassifiedBusinessSemantics(violations, node, metadata);
    pushIfMissing(violations, node, metadata.action_key, actions, "ACTION_NOT_ALLOWED");
    pushIfMissing(violations, node, metadata.navigation_target, navigation, "NAVIGATION_NOT_ALLOWED");
    pushIfMissing(violations, node, metadata.field_key, fields, "FIELD_NOT_ALLOWED");
    pushIfMissing(violations, node, metadata.component_key, components, "COMPONENT_NOT_ALLOWED");
  }
  return violations.length > 0 ? { status: "blocked", code: "DESIGN_SCOPE_VIOLATION", violations } : { status: "passed" };
}

export async function validateSemanticScopeFile(input: {
  pen_file: string;
  semantic_scope_file: string;
}): Promise<ReturnType<typeof validateSemanticScope>> {
  const [penRaw, scope] = await Promise.all([readFile(input.pen_file, "utf8"), readSemanticScope(input.semantic_scope_file)]);
  return validateSemanticScope({ document: parsePenDocument(penRaw), scope });
}

function pushIfMissing(
  violations: SemanticScopeViolation[],
  node: PenNode,
  value: unknown,
  allowed: Set<string>,
  code: SemanticScopeViolation["code"]
): void {
  if (typeof value === "string" && value.length > 0 && !allowed.has(value)) {
    violations.push({ node_id: node.id, code, value });
  }
}

function hasBusinessSemantic(metadata: Record<string, unknown>): boolean {
  return ["action_key", "navigation_target", "field_key", "component_key", "business_key", "intent_key"].some((key) => typeof metadata[key] === "string")
    || ["action", "navigation", "field", "component_instance"].includes(String(metadata.kind ?? ""));
}

function isBusinessText(value: string): boolean {
  return value.trim().length > 0 && /[\p{L}\p{N}]/u.test(value);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

async function readOptionalYaml<T>(file: string, fallback: T): Promise<T> {
  if (!await fileExists(file)) {
    return fallback;
  }
  return readYaml<T>(file);
}

async function readOptionalBaseline(file: string, productId: string): Promise<ProductBaseline> {
  if (!await fileExists(file)) {
    return { product_id: productId, pages: [], navigation: [] };
  }
  return readYamlAs(file, baselineSchema);
}

function readTranslatedCopy(value: Record<string, unknown>, language: string): string[] {
  const pages = Array.isArray(value.translations) ? value.translations : [];
  return pages.flatMap((page) => {
    if (!isRecord(page) || !Array.isArray(page.entries)) {
      return [];
    }
    return page.entries.flatMap((entry) => {
      if (!isRecord(entry) || entry.outdated === true || !isRecord(entry.texts)) {
        return [];
      }
      const text = entry.texts[language];
      return typeof text === "string" && text.length > 0 ? [text] : [];
    });
  });
}

function readRuleSemantic(value: Record<string, unknown>): {
  allowed_copy: string[];
  action_keys: string[];
  field_keys: string[];
  component_keys: string[];
} {
  const rules = Array.isArray(value.rules) ? value.rules : [];
  return {
    allowed_copy: rules.flatMap((rule) => isRecord(rule.semantic) && Array.isArray(rule.semantic.allowed_copy) ? rule.semantic.allowed_copy.filter(isString) : []),
    action_keys: rules.flatMap((rule) => isRecord(rule.semantic) && Array.isArray(rule.semantic.actions) ? rule.semantic.actions.map(readKey).filter(isString) : []),
    field_keys: rules.flatMap((rule) => isRecord(rule.semantic) && Array.isArray(rule.semantic.fields) ? rule.semantic.fields.map(readKey).filter(isString) : []),
    component_keys: rules.flatMap((rule) => isRecord(rule.semantic) && Array.isArray(rule.semantic.component_keys) ? rule.semantic.component_keys.filter(isString) : [])
  };
}

function pushUnclassifiedBusinessSemantics(violations: SemanticScopeViolation[], node: PenNode, metadata: Record<string, unknown>): void {
  const kind = typeof metadata.kind === "string" ? metadata.kind : undefined;
  if (kind === "action" && typeof metadata.action_key !== "string") {
    violations.push({ node_id: node.id, code: "UNCLASSIFIED_BUSINESS_SEMANTICS", value: "action" });
  }
  if (kind === "navigation" && typeof metadata.navigation_target !== "string") {
    violations.push({ node_id: node.id, code: "UNCLASSIFIED_BUSINESS_SEMANTICS", value: "navigation" });
  }
  if (kind === "field" && typeof metadata.field_key !== "string") {
    violations.push({ node_id: node.id, code: "UNCLASSIFIED_BUSINESS_SEMANTICS", value: "field" });
  }
  if (kind === "component_instance" && typeof metadata.component_key !== "string") {
    violations.push({ node_id: node.id, code: "UNCLASSIFIED_BUSINESS_SEMANTICS", value: "component_instance" });
  }
  if ((typeof metadata.business_key === "string" || typeof metadata.intent_key === "string") && !hasKnownBusinessKey(metadata)) {
    violations.push({ node_id: node.id, code: "UNCLASSIFIED_BUSINESS_SEMANTICS", value: String(metadata.business_key ?? metadata.intent_key) });
  }
}

function hasKnownBusinessKey(metadata: Record<string, unknown>): boolean {
  return ["action_key", "navigation_target", "field_key", "component_key"].some((key) => typeof metadata[key] === "string");
}

function stableHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(sortStable(value))).digest("hex")}`;
}

function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortStable);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortStable(child)]));
}

function readKey(value: unknown): string | undefined {
  return isRecord(value) && typeof value.key === "string" ? value.key : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
