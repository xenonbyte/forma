import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { FormaError } from "./errors.js";
import { hashFile } from "./file-hash.js";
import { ensureParentInsideDirectory, realpathInsideDirectory } from "./path-boundary.js";
import { isRecord } from "./pen-model.js";

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
  const sourceHash = await hashFile(source.path);
  if (sourceHash !== input.expected_source_hash) {
    throw new FormaError("INVALID_INPUT", "Sanitized candidate source hash mismatch", {
      expected_source_hash: input.expected_source_hash,
      actual_source_hash: sourceHash
    });
  }
  const document = parseMutablePenDocument(await readFile(source.path, "utf8"));
  const before = document.children.length;
  document.children = document.children.filter((node) => !(isRecord(node) && node.id === input.binding_guard_id));
  if (document.children.length !== before - 1) {
    throw new FormaError("PEN_FILE_INVALID", "Binding guard was not found in staging document", {
      binding_guard_id: input.binding_guard_id
    });
  }
  if (containsSessionBindingGuard(document.children)) {
    throw new FormaError("PEN_FILE_INVALID", "Sanitized candidate still contains a session binding guard", {
      binding_guard_id: input.binding_guard_id
    });
  }
  await mkdir(dirname(input.candidate_path), { recursive: true });
  await writeFile(input.candidate_path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { candidate_path: input.candidate_path, candidate_hash: await hashFile(input.candidate_path) };
}

export async function penDocumentHasSessionBindingGuard(file: string): Promise<boolean> {
  return containsSessionBindingGuard(parseMutablePenDocument(await readFile(file, "utf8")).children);
}

function parseMutablePenDocument(raw: string): { children: unknown[]; [key: string]: unknown } {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.children)) {
    throw new FormaError("PEN_FILE_INVALID", "Pencil document must contain children[]");
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
