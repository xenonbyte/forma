import { randomBytes } from "node:crypto";
import { lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { FormaError } from "./errors.js";
import { hashFile } from "./file-hash.js";
import { ensureParentInsideDirectory, realpathInsideDirectory } from "./path-boundary.js";
import { isRecord } from "./pen-model.js";

const sanitizedCandidateBasename = "staging.no-guard.pen";

export interface SessionBindingGuardNode {
  id: string;
  type: "frame";
  name: "__forma_session_binding_guard__";
  x: -100000;
  y: -100000;
  width: 1;
  height: 1;
  visible: false;
  metadata: {
    type: "forma";
    kind: "session_binding_guard";
    session_id: string;
  };
  children: [];
}

export function createSessionBindingGuard(sessionId: string, randomHex = randomBytes(12).toString("hex")): SessionBindingGuardNode {
  const safeSessionId = sessionId.replace(/[^A-Za-z0-9_-]/g, "_");
  const safeRandom = randomHex.replace(/[^A-Za-z0-9_-]/g, "");
  if (safeRandom.length < 24) {
    throw new FormaError("INVALID_INPUT", "Session binding guard random suffix is too short", { session_id: sessionId });
  }
  return {
    id: `formaSessionBindingGuard${safeSessionId}_${safeRandom}`,
    type: "frame",
    name: "__forma_session_binding_guard__",
    x: -100000,
    y: -100000,
    width: 1,
    height: 1,
    visible: false,
    metadata: {
      type: "forma",
      kind: "session_binding_guard",
      session_id: sessionId
    },
    children: []
  };
}

export async function insertSessionBindingGuard(stagingPath: string, guard: SessionBindingGuardNode): Promise<void> {
  const document = parseMutablePenDocument(await readFile(stagingPath, "utf8"));
  if (document.children.some((node) => isRecord(node) && node.id === guard.id)) {
    throw new FormaError("PEN_FILE_INVALID", "Session binding guard already exists", { guard_id: guard.id });
  }
  if (document.children.some((node) => isSessionBindingGuardNode(node) && node.metadata.session_id === guard.metadata.session_id)) {
    throw new FormaError("PEN_FILE_INVALID", "Session already has a binding guard", { session_id: guard.metadata.session_id });
  }
  document.children.push(guard);
  await writeFile(stagingPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

export async function createSanitizedCommitCandidate(input: {
  source_staging_path: string;
  candidate_path: string;
  binding_guard_id: string;
  expected_source_hash: string;
}): Promise<{ candidate_path: string; candidate_hash: string }> {
  const sessionDir = dirname(input.source_staging_path);
  const source = await realpathInsideDirectory({
    path: input.source_staging_path,
    expectedDirectory: sessionDir,
    field: "source_staging_path",
    requireFile: true,
    requirePen: true
  });
  await ensureParentInsideDirectory(input.candidate_path, source.expectedDirectory, "candidate_path");
  await validateSanitizedCandidatePath(input.candidate_path, source.path);
  const sourceHash = await hashFile(source.path);
  if (sourceHash !== input.expected_source_hash) {
    throw new FormaError("INVALID_INPUT", "Sanitized candidate source hash mismatch", {
      expected_source_hash: input.expected_source_hash,
      actual_source_hash: sourceHash
    });
  }
  const document = parseMutablePenDocument(await readFile(source.path, "utf8"));
  const guardIndex = document.children.findIndex((node) => isRecord(node) && node.id === input.binding_guard_id);
  if (guardIndex === -1) {
    throw new FormaError("PEN_FILE_INVALID", "Binding guard was not found in staging document", {
      binding_guard_id: input.binding_guard_id
    });
  }
  const guard = document.children[guardIndex];
  if (!isSessionBindingGuardNode(guard)) {
    throw new FormaError("PEN_FILE_INVALID", "Binding guard target is not a session binding guard", {
      binding_guard_id: input.binding_guard_id
    });
  }
  document.children.splice(guardIndex, 1);
  if (containsSessionBindingGuard(document.children)) {
    throw new FormaError("PEN_FILE_INVALID", "Sanitized candidate still contains a session binding guard", {
      binding_guard_id: input.binding_guard_id
    });
  }
  await writeSanitizedCandidate(input.candidate_path, `${JSON.stringify(document, null, 2)}\n`);
  return { candidate_path: input.candidate_path, candidate_hash: await hashFile(input.candidate_path) };
}

export async function penDocumentHasSessionBindingGuard(file: string): Promise<boolean> {
  return containsSessionBindingGuard(parseMutablePenDocument(await readFile(file, "utf8")).children);
}

function parseMutablePenDocument(raw: string): { children: unknown[]; [key: string]: unknown } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new FormaError("PEN_FILE_INVALID", "Pencil document must be valid JSON", {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!isRecord(parsed)) {
    throw new FormaError("PEN_FILE_INVALID", "Pencil document must be an object", {
      cause: "document is not an object"
    });
  }
  if (!Array.isArray(parsed.children)) {
    throw new FormaError("PEN_FILE_INVALID", "Pencil document must contain children[]", {
      cause: "children is missing or not an array"
    });
  }
  return { ...parsed, children: [...parsed.children] };
}

function containsSessionBindingGuard(nodes: unknown[]): boolean {
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    if (typeof node.id === "string" && node.id.startsWith("formaSessionBindingGuard")) return true;
    if (isRecord(node.metadata) && node.metadata.kind === "session_binding_guard") return true;
    if (Array.isArray(node.children) && containsSessionBindingGuard(node.children)) return true;
  }
  return false;
}

function isSessionBindingGuardNode(node: unknown): node is SessionBindingGuardNode {
  return isRecord(node)
    && typeof node.id === "string"
    && node.id.startsWith("formaSessionBindingGuard")
    && isRecord(node.metadata)
    && node.metadata.kind === "session_binding_guard"
    && typeof node.metadata.session_id === "string";
}

async function validateSanitizedCandidatePath(candidatePath: string, sourcePath: string): Promise<void> {
  if (basename(candidatePath) !== sanitizedCandidateBasename) {
    throw new FormaError("INVALID_INPUT", "Sanitized candidate path must end with staging.no-guard.pen", {
      field: "candidate_path",
      path: candidatePath
    });
  }
  const existingStat = await lstatIfExists(candidatePath, "candidate_path");
  if (existingStat?.isSymbolicLink()) {
    throw new FormaError("INVALID_INPUT", "Sanitized candidate path must not be a symlink", {
      field: "candidate_path",
      path: candidatePath
    });
  }
  if (existingStat && !existingStat.isFile()) {
    throw new FormaError("INVALID_INPUT", "Sanitized candidate path must be a regular file", {
      field: "candidate_path",
      path: candidatePath
    });
  }
  const candidateReal = existingStat
    ? await readRealpath(candidatePath, "candidate_path", "Sanitized candidate path is invalid")
    : resolve(await readRealpath(dirname(candidatePath), "candidate_path", "Sanitized candidate parent path is invalid"), sanitizedCandidateBasename);
  if (candidateReal === sourcePath) {
    throw new FormaError("INVALID_INPUT", "Sanitized candidate must not overwrite source staging", {
      field: "candidate_path",
      source_staging_path: sourcePath,
      candidate_path: candidatePath
    });
  }
}

async function writeSanitizedCandidate(candidatePath: string, content: string): Promise<void> {
  const tempPath = resolve(dirname(candidatePath), `.staging.no-guard.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, candidatePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function lstatIfExists(path: string, field: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    const code = fsErrorCode(error);
    if (code === "ENOENT") {
      return undefined;
    }
    throwInvalidPathError(error, "Sanitized candidate path is invalid", { field, path });
  }
}

async function readRealpath(path: string, field: string, message: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    throwInvalidPathError(error, message, { field, path });
  }
}

function throwInvalidPathError(error: unknown, message: string, details: Record<string, unknown>): never {
  if (error instanceof FormaError) {
    throw error;
  }
  const code = fsErrorCode(error);
  if (code) {
    throw new FormaError("INVALID_INPUT", message, {
      ...details,
      fs_error_code: code,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  throw error;
}

function fsErrorCode(error: unknown): string | undefined {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
    ? error.code
    : undefined;
}
