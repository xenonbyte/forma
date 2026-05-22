import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { FormaError } from "./errors.js";

export function isSameOrChildPath(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export async function realpathInsideDirectory(input: {
  path: string;
  expectedDirectory: string;
  field: string;
  requireFile?: boolean;
  requirePen?: boolean;
}): Promise<{ path: string; expectedDirectory: string }> {
  const expectedDirectory = await realpath(input.expectedDirectory);
  const path = await realpath(input.path);
  if (!isSameOrChildPath(expectedDirectory, path)) {
    throw new FormaError("INVALID_INPUT", "Path must stay inside the expected session directory", {
      field: input.field,
      expected_session_dir: expectedDirectory,
      path
    });
  }
  if (input.requirePen && extname(path) !== ".pen") {
    throw new FormaError("INVALID_INPUT", "Session staging file must be a .pen file", { field: input.field, path });
  }
  if (input.requireFile) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new FormaError("INVALID_INPUT", "Session path must be a regular file", { field: input.field, path });
    }
  }
  return { path, expectedDirectory };
}

export async function ensureParentInsideDirectory(file: string, expectedDirectory: string, field: string): Promise<void> {
  const expectedReal = await realpath(expectedDirectory);
  const parentResolved = resolve(dirname(file));
  const parentCanonical = await realpathWithMissingTail(parentResolved);
  if (!isSameOrChildPath(expectedReal, parentCanonical)) {
    throw new FormaError("INVALID_INPUT", "Output parent must stay inside the expected session directory", {
      field,
      expected_session_dir: expectedReal,
      path: file
    });
  }
  await mkdir(parentResolved, { recursive: true });
  const parentReal = await realpath(parentResolved);
  if (!isSameOrChildPath(expectedReal, parentReal)) {
    throw new FormaError("INVALID_INPUT", "Output parent must stay inside the expected session directory", {
      field,
      expected_session_dir: expectedReal,
      path: file
    });
  }
}

async function realpathWithMissingTail(path: string): Promise<string> {
  const missingTail: string[] = [];
  let current = path;
  while (true) {
    try {
      return resolve(await realpath(current), ...missingTail);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) {
        throw error;
      }
      missingTail.unshift(relative(parent, current));
      current = parent;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error.code === "ENOENT" || error.code === "ENOTDIR");
}
