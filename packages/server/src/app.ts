import { homedir } from "node:os";
import { timingSafeEqual } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { createFormaStore, FormaError } from "@xenonbyte/forma-core";
import { registerRoutes, RouteHttpError, type FormaRoutesStore } from "./routes.js";

export interface BuildServerOptions {
  store?: FormaServerStore;
  home?: string;
  bundledStylesDir?: string;
  webAssetsDir?: string;
  /**
   * When set, every `/api/*` request must carry `Authorization: Bearer <token>`.
   * Used to protect non-loopback binds and optional authenticated loopback
   * binds (see `index.ts`).
   */
  authToken?: string;
  /** Fastify logger options (e.g. a pino instance/stream for tests). Defaults to disabled. */
  logger?: FastifyServerOptions["logger"];
}

export type FormaServer = FastifyInstance;
export interface FormaServerStore extends FormaRoutesStore {
  recoverPendingProductDeletes(): Promise<{ warnings: string[] }>;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FormaServer> {
  const app = Fastify({ logger: options.logger ?? false });
  const authToken = options.authToken?.trim();
  if (authToken) {
    registerApiBearerAuth(app, authToken);
  }
  let store: FormaServerStore | undefined = options.store;
  if (!store) {
    store = await createFormaStore({
      home: options.home ?? defaultFormaHome(),
      bundledStylesDir: options.bundledStylesDir,
    });
  }

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
        reply.header("X-Content-Type-Options", "nosniff");
        reply.type(asset.contentType).send(request.method === "HEAD" ? undefined : asset.content);
        return;
      }
    }

    reply.status(404).send({
      error_code: "NOT_FOUND",
      message: "Route not found",
      details: {},
    });
  });

  if (!store) {
    throw new Error("Forma store was not initialized");
  }

  const productDeletionRecovery = await store.recoverPendingProductDeletes();
  for (const warning of productDeletionRecovery.warnings) {
    app.log.warn({ warning }, "Forma product deletion recovery warning");
  }

  registerRoutes(app, store, { authenticatedApi: Boolean(authToken) });
  return app;
}

function isApiRequest(url: string): boolean {
  const requestPath = pathname(url);
  return requestPath === "/api" || requestPath.startsWith("/api/");
}

// Reject any /api/* request that does not present `Authorization: Bearer <token>`.
// Static web assets (the SPA shell) are intentionally left open; non-loopback
// deployments are expected to be programmatic API clients (or to inject auth via
// a fronting proxy). Comparison is constant-time to avoid leaking the token.
function registerApiBearerAuth(app: FastifyInstance, token: string): void {
  const expected = Buffer.from(token, "utf8");
  app.addHook("onRequest", async (request, reply) => {
    if (!isApiRequest(request.url)) {
      return;
    }
    const provided = bearerToken(request.headers.authorization);
    if (!provided || !timingSafeEqualToken(expected, provided)) {
      reply.status(401).send({
        error_code: "UNAUTHORIZED",
        message: "Missing or invalid bearer token",
        details: {},
      });
      return reply;
    }
  });
}

function bearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1] : undefined;
}

function timingSafeEqualToken(expected: Buffer, provided: string): boolean {
  const providedBuffer = Buffer.from(provided, "utf8");
  if (providedBuffer.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(expected, providedBuffer);
}

/**
 * True for hosts that only accept connections from the local machine, where the
 * unauthenticated default is safe. Anything else (0.0.0.0, ::, a LAN/public IP)
 * is treated as exposed and requires a bearer token.
 */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) {
    return true;
  }
  const value = host.trim().toLowerCase();
  if (value === "") {
    return false;
  }
  if (value === "localhost") {
    return true;
  }
  if (value === "::1" || value === "::ffff:127.0.0.1") {
    return true;
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value) || /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
}

function canServeWebAsset(method: string, url: string): boolean {
  const requestPath = pathname(url);
  return (
    (method === "GET" || method === "HEAD") &&
    requestPath !== "/api" &&
    !requestPath.startsWith("/api/") &&
    !isRemovedLegacyDesignDetailPath(requestPath)
  );
}

function isRemovedLegacyDesignDetailPath(requestPath: string): boolean {
  return /^\/products\/[^/]+\/requirements\/[^/]+\/designs\/[^/]+\/?$/.test(requestPath);
}

async function readWebAsset(
  webAssetsDir: string,
  url: string,
): Promise<{ content: Buffer; contentType: string } | undefined> {
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
    if (error.code === "PRODUCT_MUTATION_LOCKED" || error.code === "PRODUCT_DELETION_RECOVERY_FAILED") {
      return 409;
    }
    if (error.code === "FORMA_LOCK_TIMEOUT") {
      return 503;
    }
    if (error.code === "FORMA_DESKTOP_CONFIG_UNSUPPORTED") {
      return 500;
    }
    if (error.code.endsWith("_NOT_FOUND")) {
      return 404;
    }
    if (error.code === "REQUIREMENT_STATUS_INVALID" || error.code === "PRODUCT_CONFIG_INCOMPLETE") {
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
