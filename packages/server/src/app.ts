import { homedir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { createFormaStore, FormaError } from "@xenonbyte/forma-core";
import { registerRoutes, RouteHttpError, type FormaStore } from "./routes.js";

export interface BuildServerOptions {
  store?: FormaStore;
  home?: string;
  bundledStylesDir?: string;
}

export type FormaServer = FastifyInstance;

export function buildServer(options: BuildServerOptions = {}): FormaServer {
  const app = Fastify();
  const store = options.store ?? createFormaStore({
    home: options.home ?? defaultFormaHome(),
    bundledStylesDir: options.bundledStylesDir
  });

  app.setErrorHandler((error, _request, reply) => {
    const payload = toErrorPayload(error);
    reply.status(statusForError(error)).send(payload);
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      error_code: "NOT_FOUND",
      message: "Route not found",
      details: {}
    });
  });

  registerRoutes(app, store);
  return app;
}

function defaultFormaHome(): string {
  return process.env.FORMA_HOME ?? join(homedir(), ".forma");
}

function statusForError(error: unknown): number {
  if (error instanceof RouteHttpError) {
    return error.statusCode;
  }
  if (error instanceof FormaError) {
    if (error.code.startsWith("PENCIL_")) {
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
