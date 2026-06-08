/**
 * doctor.ts — F4: read-only workspace diagnosis.
 *
 * Runs the same product → requirement → translation scan as startup
 * validation (store.ts validateStrictStoreReadModels), but collects every
 * finding instead of failing fast, and additionally reports orphan product
 * directories. Strictly read-only: no locks, no writes, no repairs.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { FormaError } from "./errors.js";
import { requirementSchema } from "./requirement.js";
import { createStrictFormaStore } from "./store.js";
import { readYamlAs } from "./yaml.js";

export interface WorkspaceFinding {
  kind: "schema" | "orphan" | "index";
  product_id?: string;
  requirement_id?: string;
  file?: string;
  error_code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface WorkspaceDiagnosis {
  findings: WorkspaceFinding[];
  products_checked: number;
}

const PRODUCT_DIR_PATTERN = /^P-[a-f0-9]{6}$/;

export async function diagnoseWorkspace(options: { home: string }): Promise<WorkspaceDiagnosis> {
  // createStrictFormaStore (unlike createFormaStore) performs no startup
  // validation and no tmp-dir cleanup — exactly the read-only handle we need.
  const store = createStrictFormaStore({ home: options.home });
  const findings: WorkspaceFinding[] = [];

  let products: Array<{ id: string }>;
  try {
    products = await store.products.listProducts();
  } catch (error) {
    findings.push(toFinding("index", error, { file: "data/products.yaml" }));
    return { findings, products_checked: 0 };
  }

  for (const entry of products) {
    try {
      await store.products.getProduct(entry.id);
    } catch (error) {
      findings.push(toFinding("schema", error, {
        product_id: entry.id,
        file: `data/${entry.id}/product.yaml`,
      }));
      continue;
    }

    const requirementIds = await listRequirementIds(options.home, entry.id, findings);
    for (const requirementId of requirementIds) {
      try {
        const requirement = await readRequirementAt(options.home, entry.id, requirementId);
        if (requirement.product_id !== entry.id) {
          findings.push({
            kind: "schema",
            product_id: entry.id,
            requirement_id: requirementId,
            file: `data/${entry.id}/${requirementId}/requirement.yaml`,
            error_code: "REQUIREMENT_PRODUCT_MISMATCH",
            message: `Requirement directory data/${entry.id}/${requirementId} resolved to product ${requirement.product_id}`,
          });
          continue; // do not check translations against the wrong product tree
        }
      } catch (error) {
        findings.push(toFinding("schema", error, {
          product_id: entry.id,
          requirement_id: requirementId,
          file: `data/${entry.id}/${requirementId}/requirement.yaml`,
        }));
        continue;
      }

      try {
        await readRequirementDocumentAt(options.home, entry.id, requirementId);
      } catch (error) {
        findings.push(toFinding("schema", error, {
          product_id: entry.id,
          requirement_id: requirementId,
          file: `data/${entry.id}/${requirementId}/document.md`,
        }));
      }

      try {
        await store.copy.getTranslations(entry.id, requirementId);
      } catch (error) {
        findings.push(toFinding("schema", error, {
          product_id: entry.id,
          requirement_id: requirementId,
          file: `data/${entry.id}/${requirementId}/copy-translations.yaml`,
        }));
      }
    }
  }

  // Orphans: data/<P-xxxxxx>/ directories missing from the index. The data dir
  // also contains products.yaml and the products/ artifacts tree — both are
  // excluded by the id pattern / directory check.
  const indexed = new Set(products.map((product) => product.id));
  try {
    const entries = await readdir(join(options.home, "data"), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !PRODUCT_DIR_PATTERN.test(entry.name)) continue;
      if (!indexed.has(entry.name)) {
        findings.push({
          kind: "orphan",
          product_id: entry.name,
          file: `data/${entry.name}`,
          error_code: "PRODUCT_NOT_FOUND",
          message: `Product directory data/${entry.name} is not listed in products.yaml`,
        });
      }
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      // data/ exists but cannot be scanned — report instead of faking a clean result.
      findings.push(toFinding("index", error, { file: "data" }));
    }
    // ENOENT → data/ does not exist yet — an empty workspace has nothing to scan.
  }

  return { findings, products_checked: products.length };
}

async function listRequirementIds(home: string, productId: string, findings: WorkspaceFinding[]): Promise<string[]> {
  const productDir = join(home, "data", productId);
  try {
    const entries = await readdir(productDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && /^R-[a-f0-9]{8}$/.test(entry.name)).map((entry) => entry.name);
  } catch (error) {
    findings.push(toFinding("schema", error, { product_id: productId, file: `data/${productId}` }));
    return [];
  }
}

async function readRequirementAt(home: string, productId: string, requirementId: string) {
  return readYamlAs(join(home, "data", productId, requirementId, "requirement.yaml"), requirementSchema);
}

async function readRequirementDocumentAt(home: string, productId: string, requirementId: string): Promise<void> {
  try {
    await readFile(join(home, "data", productId, requirementId, "document.md"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function toFinding(
  kind: "schema" | "index",
  error: unknown,
  scope: { product_id?: string; requirement_id?: string; file?: string },
): WorkspaceFinding {
  if (error instanceof FormaError) {
    return { kind, ...scope, error_code: error.code, message: error.message, details: error.details };
  }
  return {
    kind,
    ...scope,
    error_code: "STRICT_SCHEMA_VALIDATION_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}
