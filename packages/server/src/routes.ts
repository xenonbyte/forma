import { access, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  recoverV6NormalizationJournal,
  restoreV6NormalizationBackup,
  SchemaNormalizationRecoveryError,
  getArtifactDir,
  getFormaPaths,
  type ArtifactManifest,
  type Language,
  type Platform,
  type SchemaNormalizationRecoveryState
} from "@xenonbyte/forma-core";

type UnknownRecord = Record<string, unknown>;

const ALLOWED_MUTATION_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:4173"
]);

export interface FormaRoutesStore {
  home: string;
  artifacts: {
    readArtifact(productId: string, artifactId: string): Promise<{ manifest: ArtifactManifest; etag: string }>;
    listArtifacts(productId: string): Promise<Array<{ artifactId: string }>>;
  };
  copy: {
    getTranslations(productId: string, requirementId: string): Promise<Array<{ page_id: string; entries?: unknown[]; [key: string]: unknown }>>;
  };
  deleteProduct(input: { product_id: string; confirm_product_id: string }): Promise<unknown>;
  products: {
    createProduct(input: { name: string; description: string }): Promise<unknown>;
    getProduct(productId: string): Promise<{ id: string; designSystemArtifactId?: string; requirements?: Record<string, { latestArtifactId?: string }>; [key: string]: unknown }>;
    initProductConfig(productId: string, config: unknown): Promise<unknown>;
    listProducts(): Promise<Array<{ id: string; [key: string]: unknown }>>;
  };
  requirements: {
    archiveRequirement(requirementId: string): Promise<{ id: string; [key: string]: unknown }>;
    createEmptyRequirement(productId: string, title: string): Promise<unknown>;
    getRequirement(input: { requirement_id: string } | { product_id: string }): Promise<{ id: string; product_id: string; pages: unknown[]; [key: string]: unknown }>;
    getRequirementHistory(productId: string): Promise<Array<{ id: string; product_id: string; [key: string]: unknown }>>;
    saveRequirement(input: unknown): Promise<unknown>;
  };
  styles: {
    getStyle(name: string): Promise<{ metadata: { design_md_path: string; [key: string]: unknown }; [key: string]: unknown }>;
    listStyles(): Promise<unknown>;
  };
}

export type FormaStore = FormaRoutesStore;

export class RouteHttpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = "RouteHttpError";
  }
}

export class RouteInputError extends RouteHttpError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("INVALID_INPUT", message, details, 400);
    this.name = "RouteInputError";
  }
}

export function registerPreflightOnlyRoutes(app: FastifyInstance, state: SchemaNormalizationRecoveryState): void {
  app.get("/api/status", async () => ({ schema_normalization: state }));
}

export function registerRecoveryOnlyRoutes(app: FastifyInstance, state: SchemaNormalizationRecoveryState): void {
  app.get("/api/status", async () => ({ schema_normalization: state }));
  app.get("/api/recovery/schema-normalization", async () => state);
  app.post<{ Body: unknown }>("/api/recovery/schema-normalization/recover-journal", async (request) => {
    const body = objectBody(request.body);
    const backupDir = requiredString(body, "backup_dir");
    try {
      return await recoverV6NormalizationJournal(state.home, backupDir);
    } catch (error) {
      throw recoveryInputError(error);
    }
  });
  app.post<{ Body: unknown }>("/api/recovery/schema-normalization/restore-backup", async (request) => {
    const body = objectBody(request.body);
    const backupDir = requiredString(body, "backup_dir");
    const confirm = requiredString(body, "confirm");
    try {
      return await restoreV6NormalizationBackup(state.home, backupDir, { confirm });
    } catch (error) {
      throw recoveryInputError(error);
    }
  });
}

export function sendNormalizationBlocked(reply: FastifyReply, state: SchemaNormalizationRecoveryState): void {
  const preflight = state.code === "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED";
  reply.status(409).send({
    error_code: preflight ? "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED" : "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
    message: preflight ? "Schema normalization preflight required" : "Schema normalization recovery required",
    details: state
  });
}

function recoveryInputError(error: unknown): RouteHttpError {
  if (error instanceof SchemaNormalizationRecoveryError) {
    return new RouteHttpError("SCHEMA_NORMALIZATION_RECOVERY_REQUIRED", error.message, { ...error.result }, 409);
  }
  return new RouteInputError(errorMessage(error));
}

class RouteNotFoundError extends RouteHttpError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(code, message, details, 404);
    this.name = "RouteNotFoundError";
  }
}

// ─── Origin middleware helpers ─────────────────────────────────────────────────

function isMutationMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH";
}

function checkMutationOrigin(request: { method: string; headers: Record<string, string | string[] | undefined>; url: string }, reply: FastifyReply): boolean {
  if (!isMutationMethod(request.method)) {
    return true;
  }

  const origin = request.headers["origin"];
  const originStr = Array.isArray(origin) ? origin[0] : origin;

  const timestamp = new Date().toISOString();
  const route = request.url;
  const formaClient = request.headers["x-forma-client"];
  const formaClientStr = Array.isArray(formaClient) ? formaClient[0] : (formaClient ?? null);

  const allowed = originStr === undefined ? true : (originStr !== "null" && !originStr.startsWith("forma-asset://") && ALLOWED_MUTATION_ORIGINS.has(originStr));

  console.log(JSON.stringify({
    timestamp,
    route,
    origin: originStr ?? null,
    "x-forma-client": formaClientStr,
    allowed
  }));

  if (!allowed) {
    reply.status(403).send({
      error_code: "ARTIFACT_FORBIDDEN_ORIGIN",
      message: "Origin not allowed for mutation routes",
      details: { origin: originStr ?? null }
    });
    return false;
  }

  return true;
}

export function registerRoutes(app: FastifyInstance, store: FormaRoutesStore): void {

  // ─── Product routes ────────────────────────────────────────────────────────

  app.get("/api/products", async () => store.products.listProducts());

  app.post<{ Body: unknown }>("/api/products", async (request, reply) => {
    if (!checkMutationOrigin(request as Parameters<typeof checkMutationOrigin>[0], reply)) return;
    const body = objectBody(request.body);
    return store.products.createProduct({
      name: requiredString(body, "name"),
      description: requiredString(body, "description")
    });
  });

  app.get<{ Params: { id: string } }>("/api/products/:id", async (request) => store.products.getProduct(request.params.id));

  app.delete<{ Params: { id: string }; Body: unknown }>("/api/products/:id", async (request, reply) => {
    if (!checkMutationOrigin(request as Parameters<typeof checkMutationOrigin>[0], reply)) return;
    const body = objectBody(request.body);
    return store.deleteProduct({
      product_id: request.params.id,
      confirm_product_id: requiredString(body, "confirm_product_id")
    });
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/products/:id/config", async (request, reply) => {
    if (!checkMutationOrigin(request as Parameters<typeof checkMutationOrigin>[0], reply)) return;
    const body = objectBody(request.body);
    const style = await store.styles.getStyle(requiredString(body, "style"));
    return store.products.initProductConfig(request.params.id, {
      platform: requiredPlatform(body, "platform"),
      style: style.metadata,
      languages: requiredStringArray(body, "languages") as Language[],
      default_language: requiredString(body, "default_language") as Language
    });
  });

  // ─── Requirement routes ────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>("/api/products/:id/requirements", async (request) =>
    store.requirements.getRequirementHistory(request.params.id)
  );

  app.post<{ Params: { id: string }; Body: unknown }>("/api/products/:id/requirements", async (request, reply) => {
    if (!checkMutationOrigin(request as Parameters<typeof checkMutationOrigin>[0], reply)) return;
    const body = objectBody(request.body);
    requireOnlyFields(body, ["title"]);
    return store.requirements.createEmptyRequirement(request.params.id, requiredString(body, "title"));
  });

  app.post<{ Params: { id: string; reqId: string }; Body: unknown }>("/api/products/:id/requirements/:reqId/save", async (request, reply) => {
    if (!checkMutationOrigin(request as Parameters<typeof checkMutationOrigin>[0], reply)) return;
    await getOwnedRequirement(store, request.params.id, request.params.reqId);
    const body = objectBody(request.body);
    const input = { ...body, requirement_id: request.params.reqId } as Parameters<typeof store.requirements.saveRequirement>[0];
    return store.requirements.saveRequirement(input);
  });

  app.put<{ Params: { id: string; reqId: string } }>("/api/products/:id/requirements/:reqId/archive", async (request, reply) => {
    if (!checkMutationOrigin(request as Parameters<typeof checkMutationOrigin>[0], reply)) return;
    await getOwnedRequirement(store, request.params.id, request.params.reqId);
    const archived = await store.requirements.archiveRequirement(request.params.reqId);
    return store.requirements.getRequirement({ requirement_id: archived.id });
  });

  app.get<{ Params: { id: string; reqId: string } }>("/api/products/:id/requirements/:reqId", async (request) =>
    getOwnedRequirement(store, request.params.id, request.params.reqId)
  );

  // ─── Artifact routes (SPEC-IF-HTTP-001 ~ 003) ─────────────────────────────

  // SPEC-IF-HTTP-001: list artifacts
  app.get<{ Params: { pid: string }; Querystring: { kind?: string; include_superseded?: string } }>(
    "/api/products/:pid/artifacts",
    async (request) => {
      const product = await store.products.getProduct(request.params.pid);
      const pointers = (product.requirements ?? {}) as Record<string, { latestArtifactId?: string }>;
      const currentPointerIds = new Set(Object.values(pointers).map(r => r.latestArtifactId).filter((id): id is string => Boolean(id)));
      const includeSuperseded = request.query.include_superseded === "true";
      const kindFilter = request.query.kind;

      const entries = await store.artifacts.listArtifacts(request.params.pid);
      const artifacts = [];
      for (const { artifactId } of entries) {
        const { manifest } = await store.artifacts.readArtifact(request.params.pid, artifactId);
        if (kindFilter && manifest.kind !== kindFilter) continue;
        const superseded = manifest.requirementId !== undefined && !currentPointerIds.has(artifactId);
        if (!includeSuperseded && superseded) continue;
        artifacts.push({
          id: artifactId,
          kind: manifest.kind,
          title: manifest.title,
          preview_url: `/products/${request.params.pid}/artifacts/${artifactId}/preview/2x.png`,
          updated_at: manifest.updatedAt,
          source_skill_id: manifest.sourceSkillId,
          requirement_id: manifest.requirementId,
          superseded
        });
      }
      return { artifacts };
    }
  );

  // SPEC-IF-HTTP-002: get artifact manifest
  app.get<{ Params: { pid: string; aid: string } }>(
    "/api/products/:pid/artifacts/:aid",
    async (request, reply) => {
      const { manifest, etag } = await store.artifacts.readArtifact(request.params.pid, request.params.aid);
      reply.header("ETag", etag);
      reply.header("Cache-Control", "private, max-age=300");
      return {
        manifest,
        supportingFiles: manifest.supportingFiles ?? [],
        preview_url: `/products/${request.params.pid}/artifacts/${request.params.aid}/preview/2x.png`
      };
    }
  );

  // SPEC-IF-HTTP-003: preview PNG
  app.get<{ Params: { pid: string; aid: string; res: string } }>(
    "/api/products/:pid/artifacts/:aid/preview/:res",
    async (request, reply) => {
      const { res } = request.params;
      if (res !== "1x" && res !== "2x") {
        reply.status(404).send({ error_code: "ARTIFACT_NOT_FOUND", message: "Preview resolution not found", details: {} });
        return;
      }
      const productsDir = getFormaPaths(store.home).productsDir;
      const artifactDir = getArtifactDir(productsDir, request.params.pid, request.params.aid);
      const previewPath = join(artifactDir, "preview", `${res}.png`);
      if (!(await fileExists(previewPath))) {
        reply.status(404).send({ error_code: "ARTIFACT_NOT_FOUND", message: "Preview not found", details: {} });
        return;
      }
      const content = await readFile(previewPath);
      const etag = `"${createHash("sha256").update(content).digest("hex")}"`;
      reply.header("Content-Type", "image/png");
      reply.header("ETag", etag);
      reply.header("Cache-Control", "public, max-age=3600");
      reply.send(content);
    }
  );

  // ─── Style routes ──────────────────────────────────────────────────────────

  app.get("/api/styles", async () => store.styles.listStyles());

  app.get<{ Params: { name: string } }>("/api/styles/:name", async (request) => store.styles.getStyle(request.params.name));
}

// ─── Private helpers ───────────────────────────────────────────────────────────

function objectBody(body: unknown): UnknownRecord {
  if (!isRecord(body)) {
    throw new RouteInputError("Request body must be a JSON object");
  }
  return body;
}

function requiredString(input: UnknownRecord, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RouteInputError(`Missing required field: ${field}`, { field });
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredPlatform(input: UnknownRecord, field: string): Platform {
  const value = requiredString(input, field);
  if (value !== "mobile" && value !== "desktop" && value !== "tablet" && value !== "web") {
    throw new RouteInputError(`Invalid field: ${field}`, { field, value });
  }
  return value;
}

function requiredStringArray(input: UnknownRecord, field: string): string[] {
  const value = input[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new RouteInputError(`Missing required field: ${field}`, { field });
  }
  return value;
}

function requireOnlyFields(input: UnknownRecord, fields: string[]): void {
  const allowed = new Set(fields);
  const extraFields = Object.keys(input).filter((field) => !allowed.has(field));
  if (extraFields.length > 0) {
    throw new RouteInputError("Unexpected request fields", { fields: extraFields });
  }
}

async function getOwnedRequirement(store: FormaStore, productId: string, requirementId: string) {
  const requirement = await store.requirements.getRequirement({ requirement_id: requirementId });
  if (requirement.product_id !== productId) {
    throw new RouteNotFoundError("REQUIREMENT_NOT_FOUND", "Requirement not found", {
      product_id: productId,
      requirement_id: requirementId
    });
  }
  return requirement;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
