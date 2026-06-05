import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { FormaError } from "./errors.js";

export function isSameOrChildPath(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return (
    relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

export async function realpathInsideDirectory(input: {
  path: string;
  expectedDirectory: string;
  field: string;
  requireFile?: boolean;
  requirePen?: boolean;
}): Promise<{ path: string; expectedDirectory: string }> {
  const expectedDirectory = await readRealpath(
    input.expectedDirectory,
    input.field,
    "Expected session directory is invalid",
    {
      expected_session_dir: input.expectedDirectory,
    },
  );
  if (input.requireFile) {
    const stat = await readLstat(input.path, input.field, "Session path must be a regular file", { path: input.path });
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new FormaError("INVALID_INPUT", "Session path must be a regular file", {
        field: input.field,
        path: input.path,
      });
    }
  }
  const path = await readRealpath(input.path, input.field, "Session path is invalid", { path: input.path });
  if (!isSameOrChildPath(expectedDirectory, path)) {
    throw new FormaError("INVALID_INPUT", "Path must stay inside the expected session directory", {
      field: input.field,
      expected_session_dir: expectedDirectory,
      path,
    });
  }
  if (input.requirePen && extname(path) !== ".pen") {
    throw new FormaError("INVALID_INPUT", "Session staging file must be a .pen file", { field: input.field, path });
  }
  return { path, expectedDirectory };
}

export async function ensureParentInsideDirectory(
  file: string,
  expectedDirectory: string,
  field: string,
): Promise<void> {
  const expectedReal = await readRealpath(expectedDirectory, field, "Expected session directory is invalid", {
    expected_session_dir: expectedDirectory,
  });
  const parentResolved = resolve(dirname(file));
  const parentCanonical = await readRealpathWithMissingTail(parentResolved, field, "Output parent path is invalid", {
    path: file,
  });
  if (!isSameOrChildPath(expectedReal, parentCanonical)) {
    throw new FormaError("INVALID_INPUT", "Output parent must stay inside the expected session directory", {
      field,
      expected_session_dir: expectedReal,
      path: file,
    });
  }
  try {
    await mkdir(parentResolved, { recursive: true });
  } catch (error) {
    throwInvalidPathError(error, "Output parent path is invalid", { field, path: file });
  }
  const parentReal = await readRealpath(parentResolved, field, "Output parent path is invalid", { path: file });
  if (!isSameOrChildPath(expectedReal, parentReal)) {
    throw new FormaError("INVALID_INPUT", "Output parent must stay inside the expected session directory", {
      field,
      expected_session_dir: expectedReal,
      path: file,
    });
  }
}

async function readRealpath(
  path: string,
  field: string,
  message: string,
  details: Record<string, unknown>,
): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    throwInvalidPathError(error, message, { field, ...details });
  }
}

async function readLstat(
  path: string,
  field: string,
  message: string,
  details: Record<string, unknown>,
): Promise<Awaited<ReturnType<typeof lstat>>> {
  try {
    return await lstat(path);
  } catch (error) {
    throwInvalidPathError(error, message, { field, ...details });
  }
}

async function readRealpathWithMissingTail(
  path: string,
  field: string,
  message: string,
  details: Record<string, unknown>,
): Promise<string> {
  try {
    return await realpathWithMissingTail(path);
  } catch (error) {
    throwInvalidPathError(error, message, { field, ...details });
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
  const code = fsErrorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
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
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  throw error;
}

function fsErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}
