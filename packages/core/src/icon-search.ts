import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FormaError } from "./errors.js";

/**
 * A single Lucide icon search hit. `svg` is the raw Lucide markup (currentColor
 * inheritance; stroke-width is overridable by the consumer via tokens).
 */
export interface IconHit {
  name: string;
  tags: string[];
  svg: string;
}

interface IconRecord {
  svg: string;
  tags: string[];
  categories: string[];
}

type IconTable = Record<string, IconRecord>;

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * Candidate locations for the vendored lucide-icons.json, in priority order.
 *
 * Packaging strategy (PLAN-TASK-013, Option A): the core build copies
 * packages/core/assets/ into dist/assets/, and core's published `files`
 * whitelist remains ["dist"]. So at runtime in a built/published install the
 * JSON sits next to the compiled icon-search.js at dist/assets/. In a dev
 * vitest run the module resolves from src/, so the sibling assets/ dir at the
 * package root (../assets) is used. Both candidates are checked so resolution
 * is robust across dev (src), built (dist), and published layouts.
 */
const candidatePaths = [
  // Built/published: dist/icon-search.js -> dist/assets/lucide-icons.json
  resolve(moduleDir, "assets/lucide-icons.json"),
  // Dev/vitest: src/icon-search.ts -> ../assets/lucide-icons.json (package root)
  resolve(moduleDir, "../assets/lucide-icons.json"),
];

let cachedTable: IconTable | null = null;
let cachedNames: string[] | null = null;

function loadTable(): { table: IconTable; names: string[] } {
  if (cachedTable && cachedNames) {
    return { table: cachedTable, names: cachedNames };
  }

  const jsonPath = candidatePaths.find((candidate) => existsSync(candidate));
  if (!jsonPath) {
    throw new FormaError(
      "ARTIFACT_NOT_FOUND",
      "Bundled asset lucide-icons.json is missing — this is a packaging/installation defect, not a query error. Run the core build (pnpm --filter @xenonbyte/forma-core build) or reinstall the package.",
      { searched: candidatePaths },
    );
  }

  const table = JSON.parse(readFileSync(jsonPath, "utf8")) as IconTable;
  // Names are already alphabetically sorted by vendor-lucide.mjs, but sort
  // defensively so ranking ties remain deterministic regardless of JSON order.
  const names = Object.keys(table).sort();

  cachedTable = table;
  cachedNames = names;
  return { table, names };
}

/**
 * Search the vendored Lucide icon set.
 *
 * Ranking (SPEC-BEHAVIOR-005): exact name / name-prefix matches first, then
 * substring-in-name matches, then tag matches. Within each tier results are
 * alphabetical for deterministic output. Capped at `limit` (default 10).
 *
 * Throws a FormaError(INVALID_INPUT) on an empty or whitespace-only query.
 * Returns an empty array when nothing matches (not an error).
 */
export function searchIcons(query: string, limit = 10): IconHit[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new FormaError("INVALID_INPUT", "Icon search query must be a non-empty string", {
      query,
    });
  }

  if (limit <= 0) {
    return [];
  }

  const { table, names } = loadTable();

  const prefixHits: string[] = [];
  const substringHits: string[] = [];
  const tagHits: string[] = [];
  const seen = new Set<string>();

  for (const name of names) {
    const lowerName = name.toLowerCase();
    if (lowerName.startsWith(normalized)) {
      prefixHits.push(name);
      seen.add(name);
    } else if (lowerName.includes(normalized)) {
      substringHits.push(name);
      seen.add(name);
    }
  }

  for (const name of names) {
    if (seen.has(name)) {
      continue;
    }
    const record = table[name];
    if (record.tags.some((tag) => tag.toLowerCase().includes(normalized))) {
      tagHits.push(name);
      seen.add(name);
    }
  }

  const ranked = [...prefixHits, ...substringHits, ...tagHits].slice(0, limit);
  return ranked.map((name) => {
    const record = table[name];
    return { name, tags: record.tags, svg: record.svg };
  });
}
