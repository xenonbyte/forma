import { homedir } from "node:os";
import { access, readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { createFormaStore, FormaError } from "@xenonbyte/forma-core";
import { registerRoutes, RouteHttpError, type FormaStore } from "./routes.js";

export interface BuildServerOptions {
  store?: FormaStore;
  home?: string;
  bundledStylesDir?: string;
  webAssetsDir?: string;
}

export type FormaServer = FastifyInstance;

export function buildServer(options: BuildServerOptions = {}): FormaServer {
  const app = Fastify();
  const store = (options.store ?? createFormaStore({
    home: options.home ?? defaultFormaHome(),
    bundledStylesDir: options.bundledStylesDir
  })) as FormaStore;

  app.setErrorHandler((error, _request, reply) => {
    const payload = toErrorPayload(error);
    reply.status(statusForError(error)).send(payload);
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (options.webAssetsDir && canServeWebAsset(request.method, request.url)) {
      if (pathname(request.url) === "/favicon.ico") {
        reply.status(204).send();
        return;
      }

      const asset = await readWebAsset(options.webAssetsDir, request.url);
      if (asset) {
        reply.type(asset.contentType).send(request.method === "HEAD" ? undefined : asset.content);
        return;
      }
    }

    reply.status(404).send({
      error_code: "NOT_FOUND",
      message: "Route not found",
      details: {}
    });
  });

  void store.sync.recoverFromCrash().catch(() => undefined);

  registerRoutes(app, store);
  return app;
}

function canServeWebAsset(method: string, url: string): boolean {
  const requestPath = pathname(url);
  return (method === "GET" || method === "HEAD") && requestPath !== "/api" && !requestPath.startsWith("/api/");
}

async function readWebAsset(webAssetsDir: string, url: string): Promise<{ content: Buffer; contentType: string } | undefined> {
  const root = resolve(webAssetsDir);
  const requestPath = pathname(url);
  const assetPath = requestPath === "/" ? "" : requestPath.replace(/^\/+/, "");
  const resolvedAsset = resolve(root, assetPath);
  const resolvedIndex = resolve(root, "index.html");

  if (assetPath) {
    if (!isInside(root, resolvedAsset)) {
      return undefined;
    }
    if (extname(resolvedAsset)) {
      const file = await readFileIfExists(resolvedAsset);
      if (file) {
        return { content: file, contentType: contentTypeFor(resolvedAsset) };
      }
      return undefined;
    }
    if (isStaticAssetPath(assetPath)) {
      return undefined;
    }
  }

  const index = await readFileIfExists(resolvedIndex);
  return index ? { content: index, contentType: "text/html; charset=utf-8" } : undefined;
}

function pathname(url: string): string {
  try {
    return decodeURIComponent(new URL(url, "http://forma.local").pathname);
  } catch {
    return "/";
  }
}

function isInside(root: string, file: string): boolean {
  return file === root || file.startsWith(`${root}${sep}`);
}

function isStaticAssetPath(assetPath: string): boolean {
  return assetPath === "assets" || assetPath.startsWith("assets/");
}

async function readFileIfExists(file: string): Promise<Buffer | undefined> {
  try {
    await access(file);
    return await readFile(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return undefined;
    }
    throw error;
  }
}

function contentTypeFor(file: string): string {
  switch (extname(file)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function defaultFormaHome(): string {
  return process.env.FORMA_HOME ?? join(homedir(), ".forma");
}

function statusForError(error: unknown): number {
  if (error instanceof RouteHttpError) {
    return error.statusCode;
  }
  if (error instanceof FormaError) {
    if (error.code === "SYNC_ALREADY_RUNNING") {
      return 409;
    }
    if (error.code === "SYNC_GIT_NOT_FOUND" || error.code.startsWith("PENCIL_")) {
      return 503;
    }
    if (error.code.endsWith("_NOT_FOUND") || error.code === "HISTORY_FILE_MISSING" || error.code === "NODE_NOT_FOUND") {
      return 404;
    }
    if (
      error.code === "REQUIREMENT_STATUS_INVALID" ||
      error.code === "PRODUCT_CONFIG_INCOMPLETE" ||
      error.code === "PAGE_NOT_OWNED" ||
      error.code === "PAGE_NOT_DONE" ||
      error.code === "DESIGN_MODE_INVALID" ||
      error.code === "VERSION_TOO_LOW"
    ) {
      return 409;
    }
    return 400;
  }
  if (isFastifyInputError(error)) {
    return 400;
  }
  if (isZodLikeError(error)) {
    return 400;
  }
  return 500;
}

function toErrorPayload(error: unknown): { error_code: string; message: string; details: Record<string, unknown> } {
  if (error instanceof RouteHttpError) {
    return { error_code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof FormaError) {
    return error.toJSON();
  }
  if (isFastifyInputError(error)) {
    return { error_code: "INVALID_INPUT", message: error.message, details: {} };
  }
  if (isZodLikeError(error)) {
    return { error_code: "INVALID_INPUT", message: "Invalid request input", details: { issues: error.issues } };
  }
  return { error_code: "INTERNAL_ERROR", message: "Unexpected server error", details: {} };
}

function isFastifyInputError(error: unknown): error is Error & { statusCode: number } {
  return error instanceof Error && "statusCode" in error && error.statusCode === 400;
}

function isZodLikeError(error: unknown): error is Error & { issues: unknown[] } {
  return error instanceof Error && "issues" in error && Array.isArray(error.issues);
}
