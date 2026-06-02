#!/usr/bin/env node
/**
 * check-vzi-renderer-boundary.mjs
 *
 * Verifies that @vzi-core/renderer and canvaskit-wasm are NOT imported
 * by the backend runtime packages (core, server, cli, mcp).
 *
 * The renderer is vendored for future web/desktop use only and must
 * never be pulled into the Node.js backend runtime.
 *
 * Approach to avoid comment false-positives:
 *   1. Strip all block comments (/* ... *\/) using a character-by-character
 *      state machine that handles nested quotes and edge cases correctly.
 *   2. Strip line comments (// ...) from each remaining line.
 *   3. Only then test the remaining text for real import/require patterns.
 *
 * This correctly handles the known comment in packages/mcp/src/vzi-read-layer.ts
 * which mentions @vzi-core/renderer inside a JSDoc block comment.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

// ── Configuration ────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = new URL('..', import.meta.url).pathname;

const SCAN_DIRS = [
  'packages/core/src',
  'packages/server/src',
  'packages/cli/src',
  'packages/mcp/src',
];

const FORBIDDEN_MODULES = ['@vzi-core/renderer', 'canvaskit-wasm'];

const SOURCE_EXTENSIONS = new Set(['.ts', '.mts', '.js', '.mjs']);

// ── Comment stripping ─────────────────────────────────────────────────────────

/**
 * Strips block comments (/* ... *\/) from source text using a state machine.
 * Replaces each block comment character with spaces to preserve line numbers.
 *
 * States: CODE, LINE_COMMENT, BLOCK_COMMENT, STRING_SQ, STRING_DQ, STRING_BT
 */
function stripBlockComments(src) {
  const out = [];
  let i = 0;
  const len = src.length;

  while (i < len) {
    const c = src[i];
    const next = src[i + 1];

    // Enter block comment
    if (c === '/' && next === '*') {
      out.push(' ', ' '); // preserve positions
      i += 2;
      while (i < len) {
        const bc = src[i];
        const bn = src[i + 1];
        if (bc === '*' && bn === '/') {
          out.push(' ', ' ');
          i += 2;
          break;
        }
        // Preserve newlines for line number accuracy
        out.push(bc === '\n' ? '\n' : ' ');
        i++;
      }
      continue;
    }

    // Skip line comments as-is (we'll strip them per-line later)
    if (c === '/' && next === '/') {
      // Copy until end of line
      while (i < len && src[i] !== '\n') {
        out.push(src[i]);
        i++;
      }
      continue;
    }

    // Single-quoted string — skip to avoid treating internal slashes as comments
    if (c === "'") {
      out.push(c);
      i++;
      while (i < len && src[i] !== "'") {
        if (src[i] === '\\') { out.push(src[i]); i++; }
        out.push(src[i] ?? '');
        i++;
      }
      if (i < len) { out.push(src[i]); i++; }
      continue;
    }

    // Double-quoted string
    if (c === '"') {
      out.push(c);
      i++;
      while (i < len && src[i] !== '"') {
        if (src[i] === '\\') { out.push(src[i]); i++; }
        out.push(src[i] ?? '');
        i++;
      }
      if (i < len) { out.push(src[i]); i++; }
      continue;
    }

    // Template literal string
    if (c === '`') {
      out.push(c);
      i++;
      while (i < len && src[i] !== '`') {
        if (src[i] === '\\') { out.push(src[i]); i++; }
        out.push(src[i] ?? '');
        i++;
      }
      if (i < len) { out.push(src[i]); i++; }
      continue;
    }

    out.push(c);
    i++;
  }

  return out.join('');
}

/**
 * Strips // line comments from a single line.
 * Does NOT strip inside strings — but since we already call this AFTER
 * stripBlockComments, the only remaining // sequences are real line comments
 * (or inside string literals that we've already preserved verbatim).
 * For our purposes, stripping // to end-of-line is safe because the import
 * detection regex won't match across lines anyway.
 */
function stripLineComment(line) {
  // Find the first // that's not inside a string literal.
  // Simple heuristic: walk char by char tracking string state.
  let inStr = null;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') { i++; continue; } // skip escaped char
      if (c === inStr) inStr = null;
    } else {
      if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
      if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
    }
  }
  return line;
}

// ── Import detection ──────────────────────────────────────────────────────────

/**
 * Returns true if the stripped line contains a real import or require
 * of the given module specifier.
 */
function lineImportsModule(line, mod) {
  // ESM static:        import ... from 'mod'  or  import ... from "mod"
  // ESM side-effect:   import 'mod'  (no `from`)
  // ESM dynamic:       import('mod') or import("mod")
  // CJS:               require('mod') or require("mod")
  const esc = mod.replace(/[.*+?^${}()|[\]\\@/]/g, '\\$&');
  const pattern = new RegExp(
    `(?:from\\s*['"]\`?${esc}['"]\`?|import\\s*\\(['"]\`?${esc}['"]\`?\\)|require\\s*\\(['"]\`?${esc}['"]\`?\\)|import\\s+['"]\`?${esc}['"]\`?)`
  );
  return pattern.test(line);
}

// ── File collection ───────────────────────────────────────────────────────────

async function collectSourceFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    // Directory may not exist in all configurations
    return files;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name);
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    const fullPath = join(entry.parentPath ?? entry.path ?? dir, entry.name);
    // Exclude tests, dist, node_modules
    if (
      fullPath.includes('/node_modules/') ||
      fullPath.includes('/dist/') ||
      fullPath.includes('/tests/') ||
      fullPath.includes('.test.') ||
      fullPath.includes('.spec.')
    ) continue;
    files.push(fullPath);
  }
  return files;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const violations = [];
  const scannedDirs = [];
  let totalFiles = 0;

  for (const relDir of SCAN_DIRS) {
    const absDir = join(WORKSPACE_ROOT, relDir);
    scannedDirs.push(relDir);
    const files = await collectSourceFiles(absDir);
    totalFiles += files.length;

    for (const filePath of files) {
      const raw = await readFile(filePath, 'utf8');

      // Step 1: strip block comments (preserves line count)
      const noBlockComments = stripBlockComments(raw);

      // Step 2: check line by line (strip line comments per line)
      const lines = noBlockComments.split('\n');
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const strippedLine = stripLineComment(lines[lineIdx]);
        for (const mod of FORBIDDEN_MODULES) {
          if (lineImportsModule(strippedLine, mod)) {
            violations.push({ file: filePath, line: lineIdx + 1, mod });
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('\n✗ VZI renderer boundary VIOLATED — forbidden imports found:\n');
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  [imports ${v.mod}]`);
    }
    console.error('\nThe renderer (@vzi-core/renderer) and canvaskit-wasm must NOT');
    console.error('be imported by core / server / cli / mcp backend packages.');
    console.error('These are vendored for web/desktop rendering only.\n');
    process.exit(1);
  }

  console.log('\n✓ VZI renderer import-boundary check PASSED');
  console.log(`  Scanned ${totalFiles} source files across:`);
  for (const d of scannedDirs) {
    console.log(`    ${d}`);
  }
  console.log('  No forbidden imports of @vzi-core/renderer or canvaskit-wasm found.\n');
}

main().catch((err) => {
  console.error('check-vzi-renderer-boundary: unexpected error:', err);
  process.exit(1);
});
