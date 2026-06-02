import { access, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, join, resolve } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  recoverV6NormalizationJournal,
  restoreV6NormalizationBackup,
  SchemaNormalizationRecoveryError,
  getArtifactDir,
  getArtifactVersionDir,
  getArtifactVersionPreviewPath,
  getFormaPaths,
  isSameOrChildPath,
  normalizeKind,
  normalizeFormaExtension,
  exportArchiveAssets,
  FormaError,
  makeExportArchiveAssetsDeps,
  type ArtifactManifest,
  type BrandStyleContent,
  type DesignPointer,
  type ExportArchiveAssetsResult,
  type Language,
  type Platform,
  type SchemaNormalizationRecoveryState
} from "@xenonbyte/forma-core";

type UnknownRecord = Record<string, unknown>;

interface RequirementPageRecord {
  page_id: string;
  baseline_page?: string;
  copy?: unknown[];
  features?: string;
  fields?: string;
  interactions?: string;
  name?: string;
  semantic_contract?: unknown;
  semantic_contract_coverage?: unknown;
  [key: string]: unknown;
}

interface RequirementRecord {
  id: string;
  product_id: string;
  created_at?: string;
  updated_at?: string;
  status?: string;
  navigation?: unknown[];
  pages: RequirementPageRecord[];
  [key: string]: unknown;
}

interface BaselinePageRecord {
  id: string;
  copy: unknown[];
  features: string;
  fields: string;
  interactions: string;
  name: string;
  semantic_contract?: unknown;
  semantic_contract_coverage?: unknown;
  source_requirements: string[];
}

const ALLOWED_MUTATION_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:4173"
]);

export interface FormaRoutesStore {
  home: string;
  artifacts: {
    readArtifact(productId: string, artifactId: string): Promise<{ manifest: ArtifactManifest; etag: string }>;
    readArtifactVersion(productId: string, artifactId: string, version: number): Promise<{ manifest: ArtifactManifest; etag: string }>;
    listArtifacts(productId: string): Promise<Array<{ artifactId: string }>>;
    listArtifactVersions(productId: string, artifactId: string): Promise<number[]>;
  };
  copy: {
    getTranslations(productId: string, requirementId: string): Promise<Array<{ page_id: string; entries?: unknown[]; [key: string]: unknown }>>;
  };
  deleteProduct(input: { product_id: string; confirm_product_id: string }): Promise<unknown>;
  /**
   * Optional injectable for archive-time asset generation (icons + VZI).
   * When provided (e.g. in tests), it is used directly. When absent, the route
   * builds production deps from `home` + `products` and calls the core function.
   */
  exportArchiveAssets?: (productId: string, requirementId: string) => Promise<ExportArchiveAssetsResult>;
  products: {
    createProduct(input: { name: string; description: string }): Promise<unknown>;
    getProduct(productId: string): Promise<{ id: string; platform?: string; designSystemArtifactId?: string; requirements?: Record<string, { latestArtifactId?: string }>; [key: string]: unknown }>;
    initProductConfig(productId: string, config: unknown): Promise<unknown>;
    listProducts(): Promise<Array<{ id: string; [key: string]: unknown }>>;
    listDesignPointers(productId: string): Promise<DesignPointer[]>;
  };
  requirements: {
    archiveRequirement(requirementId: string): Promise<{ id: string; [key: string]: unknown }>;
    archiveRequirementLocked?(requirementId: string): Promise<{ id: string; [key: string]: unknown }>;
    createEmptyRequirement(productId: string, title: string): Promise<unknown>;
    getRequirement(input: { requirement_id: string } | { product_id: string }): Promise<RequirementRecord>;
    getRequirementHistory(productId: string): Promise<RequirementRecord[]>;
    saveRequirement(input: unknown): Promise<unknown>;
  };
  runProductMutation?<T>(
    input: { operation: string; product_id?: string },
    fn: (context: { warnings: string[] }) => Promise<T>
  ): Promise<T>;
  styles: {
    getStyle(name: string): Promise<BrandStyleContent>;
    listStyles(): Promise<unknown>;
    listSystemStyles(): Promise<unknown>;
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

function isMutationMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH";
}

function isOriginAllowed(originStr: string | undefined, request: FastifyRequest): boolean {
  if (originStr === undefined) return true;
  if (originStr === "null") return false;
  if (originStr.startsWith("forma-asset://")) return false;
  return ALLOWED_MUTATION_ORIGINS.has(originStr) || isSameRequestOrigin(originStr, request);
}

function isSameRequestOrigin(originStr: string, request: FastifyRequest): boolean {
  let origin: URL;
  try {
    origin = new URL(originStr);
  } catch {
    return false;
  }

  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    return false;
  }

  const host = request.headers.host;
  const hostStr = Array.isArray(host) ? host[0] : host;
  return typeof hostStr === "string" && origin.host.toLowerCase() === hostStr.toLowerCase();
}

function checkMutationOrigin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!isMutationMethod(request.method)) {
    return true;
  }

  const origin = request.headers["origin"];
  const originStr = Array.isArray(origin) ? origin[0] : origin;
  const formaClient = request.headers["x-forma-client"];
  const formaClientStr = Array.isArray(formaClient) ? formaClient[0] : (formaClient ?? null);
  const allowed = isOriginAllowed(originStr, request);

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    route: request.url,
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
    if (!checkMutationOrigin(request, reply)) return;
    const body = objectBody(request.body);
    return store.products.createProduct({
      name: requiredString(body, "name"),
      description: requiredString(body, "description")
    });
  });

  app.get<{ Params: { id: string } }>("/api/products/:id", async (request) => store.products.getProduct(request.params.id));

  app.delete<{ Params: { id: string }; Body: unknown }>("/api/products/:id", async (request, reply) => {
    if (!checkMutationOrigin(request, reply)) return;
    const body = objectBody(request.body);
    return store.deleteProduct({
      product_id: request.params.id,
      confirm_product_id: requiredString(body, "confirm_product_id")
    });
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/products/:id/config", async (request, reply) => {
    if (!checkMutationOrigin(request, reply)) return;
    const body = objectBody(request.body);
    const config: Record<string, unknown> = {
      platform: requiredPlatform(body, "platform"),
      brand_style: requiredString(body, "brand_style"),
      languages: requiredStringArray(body, "languages") as Language[],
      default_language: requiredString(body, "default_language") as Language
    };
    if (body["system_style"] !== undefined) {
      config["system_style"] = requiredString(body, "system_style");
    }
    return store.products.initProductConfig(request.params.id, config);
  });

  // ─── Requirement routes ────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>("/api/products/:id/requirements", async (request) =>
    store.requirements.getRequirementHistory(request.params.id)
  );

  app.post<{ Params: { id: string }; Body: unknown }>("/api/products/:id/requirements", async (request, reply) => {
    if (!checkMutationOrigin(request, reply)) return;
    const body = objectBody(request.body);
    requireOnlyFields(body, ["title"]);
    return store.requirements.createEmptyRequirement(request.params.id, requiredString(body, "title"));
  });

  app.post<{ Params: { id: string; reqId: string }; Body: unknown }>("/api/products/:id/requirements/:reqId/save", async (request, reply) => {
    if (!checkMutationOrigin(request, reply)) return;
    await getOwnedRequirement(store, request.params.id, request.params.reqId);
    const body = objectBody(request.body);
    const input = { ...body, requirement_id: request.params.reqId } as Parameters<typeof store.requirements.saveRequirement>[0];
    return store.requirements.saveRequirement(input);
  });

  app.put<{ Params: { id: string; reqId: string } }>("/api/products/:id/requirements/:reqId/archive", async (request, reply) => {
    if (!checkMutationOrigin(request, reply)) return;
    const productId = request.params.id;
    const requirementId = request.params.reqId;

    // Ownership check (also gives us the current requirement status)
    const requirement = await getOwnedRequirement(store, productId, requirementId);

    // Precheck: only active requirements can be archived
    if (requirement.status !== "active") {
      throw new RouteHttpError(
        "REQUIREMENT_STATUS_INVALID",
        "Requirement status invalid",
        { requirement_id: requirementId, status: requirement.status },
        409
      );
    }

    // Phase 1: generate handoff assets (icons + VZI) BEFORE committing archived status.
    // If generation fails, the error propagates and archiveRequirement is NOT called.
    const generateAssets: (pid: string, rid: string) => Promise<ExportArchiveAssetsResult> =
      store.exportArchiveAssets ??
      ((pid, rid) => {
        const productsRoot = getFormaPaths(store.home).productsDir;
        const deps = makeExportArchiveAssetsDeps(
          productsRoot,
          async (productId) => {
            const product = await store.products.getProduct(productId);
            return product.platform as Platform | undefined;
          },
          (productId) => resolveArchiveDesignPointers(store, productId),
          async (productId, requirementId) => {
            const current = await getOwnedRequirement(store, productId, requirementId);
            return current.pages.map((page) => page.page_id);
          }
        );
        return exportArchiveAssets(deps, { productId: pid, requirementId: rid, generatedFrom: "requirement-archive" });
      });

    const archiveWithAssets = async (recheckStatus: boolean) => {
      if (recheckStatus) {
        const current = await getOwnedRequirement(store, productId, requirementId);
        if (current.status !== "active") {
          throw new RouteHttpError(
            "REQUIREMENT_STATUS_INVALID",
            "Requirement status invalid",
            { requirement_id: requirementId, status: current.status },
            409
          );
        }
      }

      const assets = await generateAssets(productId, requirementId);
      const archiveRequirementLocked = store.requirements.archiveRequirementLocked;
      const archived = archiveRequirementLocked
        ? await archiveRequirementLocked.call(store.requirements, requirementId)
        : await store.requirements.archiveRequirement(requirementId);
      const archivedRequirement = await store.requirements.getRequirement({ requirement_id: archived.id });

      return { requirement: archivedRequirement, icons: assets.icons, vzi: assets.vzi };
    };

    if (store.runProductMutation && store.requirements.archiveRequirementLocked) {
      return await store.runProductMutation(
        { operation: "archive_requirement", product_id: productId },
        () => archiveWithAssets(true)
      );
    }

    return await archiveWithAssets(false);
  });

  app.get<{ Params: { id: string; reqId: string } }>("/api/products/:id/requirements/:reqId", async (request) =>
    getOwnedRequirement(store, request.params.id, request.params.reqId)
  );

  // ─── Baseline compatibility routes ────────────────────────────────────────

  app.get<{ Params: { id: string } }>("/api/products/:id/baseline", async (request) =>
    getProductBaseline(store, request.params.id)
  );

  app.get<{ Params: { id: string; pageId: string } }>("/api/products/:id/baseline/pages/:pageId/image", async (request) =>
    getBaselineImageMetadata(store, request.params.id, request.params.pageId)
  );

  app.get<{ Params: { id: string; pageId: string }; Querystring: { requirement_id?: string } }>(
    "/api/products/:id/baseline/pages/:pageId/copy",
    async (request) => getBaselinePageCopy(store, request.params.id, request.params.pageId, request.query.requirement_id)
  );

  app.get<{ Params: { id: string; pageId: string } }>("/api/products/:id/baseline/pages/:pageId/annotations", async (request) => {
    const page = await getBaselinePage(store, request.params.id, request.params.pageId);
    return {
      product_id: request.params.id,
      baseline_page_id: request.params.pageId,
      annotations: [{
        id: page.id,
        name: page.name,
        type: "baseline_page",
        content: {
          features: page.features,
          copy: page.copy,
          fields: page.fields,
          interactions: page.interactions
        },
        source_requirements: page.source_requirements
      }]
    };
  });

  // ─── Artifact routes (SPEC-IF-HTTP-001 ~ 003) ─────────────────────────────

  // SPEC-IF-HTTP-001: list artifacts
  app.get<{ Params: { pid: string }; Querystring: { kind?: string; include_superseded?: string } }>(
    "/api/products/:pid/artifacts",
    async (request) => {
      const pid = request.params.pid;
      const { currentPointerIds, pointerVersions } = await loadArtifactPointers(store, pid);
      const includeSuperseded = request.query.include_superseded === "true";
      const kindFilter = request.query.kind;

      const entries = await store.artifacts.listArtifacts(pid);
      const artifacts = [];
      for (const { artifactId } of entries) {
        let manifest: ArtifactManifest;
        let version: number | undefined;
        try {
          ({ manifest, version } = await resolveCurrentArtifact(store, pid, artifactId, pointerVersions));
        } catch {
          continue; // unreadable artifact — skip rather than fail the whole listing
        }
        // Match legacy and new kind aliases (html↔design-page, design-system↔component-library)
        if (kindFilter && normalizeKind(manifest.kind) !== normalizeKind(kindFilter)) continue;
        const requirementId = manifest.requirementId ?? manifest.forma?.requirementId;
        const superseded = requirementId !== undefined && !currentPointerIds.has(artifactId);
        if (!includeSuperseded && superseded) continue;
        const forma = manifest.forma ? normalizeFormaExtension(manifest.forma) : undefined;
        artifacts.push({
          id: artifactId,
          kind: normalizeKind(manifest.kind),
          title: manifest.title,
          preview_url: artifactPreviewUrl(pid, artifactId, "2x"),
          updated_at: manifest.updatedAt,
          source_skill_id: manifest.sourceSkillId,
          requirement_id: requirementId,
          page_id: forma?.pageId,
          variant: forma?.variant,
          ...(typeof version === "number" ? { current_version: version } : {}),
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
      const { pid, aid } = request.params;
      const { pointerVersions } = await loadArtifactPointers(store, pid);
      const { manifest, etag } = await resolveCurrentArtifact(store, pid, aid, pointerVersions);
      reply.header("ETag", etag);
      reply.header("Cache-Control", "private, max-age=300");
      return {
        manifest,
        supportingFiles: manifest.supportingFiles ?? [],
        preview_url: artifactPreviewUrl(pid, aid, "2x")
      };
    }
  );

  // SPEC-IF-HTTP-003: preview PNG. Falls back to the artifact's current version
  // when no flat (legacy) preview exists, so versioned artifacts are previewable.
  app.get<{ Params: { pid: string; aid: string; res: string } }>(
    "/api/products/:pid/artifacts/:aid/preview/:res",
    async (request, reply) => {
      const { pid, aid, res } = request.params;
      if (res !== "1x" && res !== "2x") {
        reply.status(404).send({ error_code: "ARTIFACT_NOT_FOUND", message: "Preview resolution not found", details: {} });
        return;
      }
      const productsDir = getFormaPaths(store.home).productsDir;
      const previewPath = await resolveCurrentPreviewPath(store, productsDir, pid, aid, res);
      if (!previewPath || !(await fileExists(previewPath))) {
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

  // ─── Versioned artifact bundle route ──────────────────────────────────────

  app.get<{ Params: { pid: string; aid: string; v: string; "*": string } }>(
    "/api/products/:pid/artifacts/:aid/versions/:v/bundle/*",
    async (request, reply) => {
      const { pid, aid, v } = request.params;
      const relPath = request.params["*"];
      const version = Number(v);
      if (!Number.isInteger(version) || version < 1) {
        reply.status(400).send({ error_code: "ARTIFACT_INVALID_INPUT", message: "Invalid artifact version", details: { version: v } });
        return;
      }
      const productsDir = getFormaPaths(store.home).productsDir;
      let versionDir: string;
      try {
        versionDir = getArtifactVersionDir(productsDir, pid, aid, version);
      } catch {
        reply.status(400).send({ error_code: "ARTIFACT_INVALID_INPUT", message: "Invalid artifact or product id", details: {} });
        return;
      }
      if (!relPath) {
        reply.status(400).send({ error_code: "ARTIFACT_INVALID_INPUT", message: "Bundle path is required", details: {} });
        return;
      }
      const resolvedFile = resolve(versionDir, relPath);
      if (!isSameOrChildPath(resolve(versionDir), resolvedFile)) {
        reply.status(400).send({ error_code: "ARTIFACT_INVALID_INPUT", message: "Path escapes bundle directory", details: {} });
        return;
      }
      if (!(await fileExists(resolvedFile))) {
        reply.status(404).send({ error_code: "ARTIFACT_NOT_FOUND", message: "Bundle file not found", details: {} });
        return;
      }
      const content = await readFile(resolvedFile);
      reply.header("Content-Type", contentTypeForPath(resolvedFile));
      reply.header("Cache-Control", "public, max-age=3600");
      reply.send(content);
    }
  );

  // ─── Versioned artifact preview route ─────────────────────────────────────

  app.get<{ Params: { pid: string; aid: string; v: string; res: string } }>(
    "/api/products/:pid/artifacts/:aid/versions/:v/preview/:res",
    async (request, reply) => {
      const { pid, aid, v, res } = request.params;
      if (res !== "1x.png" && res !== "2x.png") {
        reply.status(400).send({ error_code: "ARTIFACT_INVALID_INPUT", message: "Preview resolution must be 1x.png or 2x.png", details: { res } });
        return;
      }
      const version = Number(v);
      if (!Number.isInteger(version) || version < 1) {
        reply.status(400).send({ error_code: "ARTIFACT_INVALID_INPUT", message: "Invalid artifact version", details: { version: v } });
        return;
      }
      const productsDir = getFormaPaths(store.home).productsDir;
      const resolution: "1x" | "2x" = res === "2x.png" ? "2x" : "1x";
      let previewPath: string;
      try {
        previewPath = getArtifactVersionPreviewPath(productsDir, pid, aid, version, resolution);
      } catch {
        reply.status(400).send({ error_code: "ARTIFACT_INVALID_INPUT", message: "Invalid artifact or product id", details: {} });
        return;
      }
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

  app.get("/api/system-styles", async () => store.styles.listSystemStyles());
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

type ArchiveDesignPointerCandidate = Pick<DesignPointer, "artifactId" | "version"> &
  Partial<Omit<DesignPointer, "artifactId" | "version">>;

const DESIGN_POINTER_STATUSES = new Set(["pending", "active", "expired"]);

function isCompleteDesignPointer(pointer: ArchiveDesignPointerCandidate): pointer is DesignPointer {
  return (
    typeof pointer.requirementId === "string" &&
    pointer.requirementId.length > 0 &&
    typeof pointer.pageId === "string" &&
    pointer.pageId.length > 0 &&
    typeof pointer.variant === "string" &&
    pointer.variant.length > 0 &&
    typeof pointer.designStatus === "string" &&
    DESIGN_POINTER_STATUSES.has(pointer.designStatus)
  );
}

async function resolveArchiveDesignPointers(
  store: FormaRoutesStore,
  productId: string
): Promise<DesignPointer[]> {
  const pointers = await store.products.listDesignPointers(productId) as ArchiveDesignPointerCandidate[];
  return Promise.all(pointers.map(async (pointer) => {
    if (isCompleteDesignPointer(pointer)) {
      return pointer;
    }

    const { manifest } = await store.artifacts.readArtifactVersion(productId, pointer.artifactId, pointer.version);
    const forma = normalizeFormaExtension(manifest.forma ?? {});
    const requirementId = forma.requirementId ?? manifest.requirementId;
    const pageId = forma.pageId;
    if (!requirementId || !pageId) {
      throw new FormaError("ARTIFACT_INVALID_INPUT", "Design pointer is missing requirement/page metadata", {
        product_id: productId,
        artifact_id: pointer.artifactId,
        version: pointer.version,
      });
    }

    return {
      requirementId,
      pageId,
      variant: forma.variant ?? "default",
      artifactId: pointer.artifactId,
      version: pointer.version,
      designStatus: "active",
    };
  }));
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

async function getProductBaseline(store: FormaStore, productId: string) {
  await store.products.getProduct(productId);
  const requirements = (await store.requirements.getRequirementHistory(productId))
    .filter((requirement) => requirement.status !== "archived")
    .sort(compareRequirementsOldestFirst);
  const pagesById = new Map<string, BaselinePageRecord>();
  const navigation: unknown[] = [];

  for (const requirement of requirements) {
    if (Array.isArray(requirement.navigation)) {
      navigation.push(...mapRequirementNavigationToBaseline(requirement.pages, requirement.navigation));
    }

    for (const page of requirement.pages) {
      const pageId = stringValue(page.baseline_page) ?? stringValue(page.page_id);
      if (!pageId) {
        continue;
      }

      const existing = pagesById.get(pageId);
      pagesById.set(pageId, {
        id: pageId,
        name: stringValue(page.name) ?? existing?.name ?? pageId,
        features: stringValue(page.features) ?? existing?.features ?? "",
        copy: Array.isArray(page.copy) ? page.copy : existing?.copy ?? [],
        fields: stringValue(page.fields) ?? existing?.fields ?? "",
        interactions: stringValue(page.interactions) ?? existing?.interactions ?? "",
        ...(page.semantic_contract !== undefined ? { semantic_contract: page.semantic_contract } : {}),
        ...(page.semantic_contract_coverage !== undefined ? { semantic_contract_coverage: page.semantic_contract_coverage } : {}),
        source_requirements: uniqueStrings([...(existing?.source_requirements ?? []), requirement.id])
      });
    }
  }

  return {
    product_id: productId,
    pages: [...pagesById.values()],
    navigation
  };
}

function mapRequirementNavigationToBaseline(
  pages: RequirementPageRecord[],
  navigation: unknown[]
): unknown[] {
  const pageToBaseline = new Map<string, string>();
  for (const page of pages) {
    const pageId = stringValue(page.page_id);
    const baselineId = stringValue(page.baseline_page) ?? pageId;
    if (!pageId || !baselineId) {
      continue;
    }
    pageToBaseline.set(pageId, baselineId);
    pageToBaseline.set(baselineId, baselineId);
  }

  return navigation.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const fromRaw = stringValue(item.from);
    const toRaw = stringValue(item.to);
    if (!fromRaw || !toRaw) {
      return [];
    }
    return [{
      ...item,
      from: pageToBaseline.get(fromRaw) ?? fromRaw,
      to: pageToBaseline.get(toRaw) ?? toRaw
    }];
  });
}

async function getBaselinePage(store: FormaStore, productId: string, pageId: string): Promise<BaselinePageRecord> {
  const baseline = await getProductBaseline(store, productId);
  const page = baseline.pages.find((item) => item.id === pageId);
  if (!page) {
    throw new RouteNotFoundError("BASELINE_PAGE_NOT_FOUND", "Baseline page not found", {
      product_id: productId,
      page_id: pageId
    });
  }
  return page;
}

async function getBaselinePageCopy(
  store: FormaStore,
  productId: string,
  pageId: string,
  requirementId: string | undefined
) {
  const baselinePage = await getBaselinePage(store, productId, pageId);
  const requirement = requirementId
    ? await getOwnedRequirement(store, productId, requirementId)
    : (await store.requirements.getRequirementHistory(productId))
      .filter((item) => baselinePage.source_requirements.includes(item.id))
      .sort(compareRequirementsNewestFirst)[0];

  if (!requirement) {
    return emptyBaselinePageCopy(pageId);
  }

  const requirementPage = requirement.pages.find((item) => item.baseline_page === pageId);
  if (!requirementPage) {
    return emptyBaselinePageCopy(pageId);
  }

  const translations = await store.copy.getTranslations(productId, requirement.id);
  const pageTranslation = translations.find((item) => item.page_id === requirementPage.page_id);
  return {
    page_id: pageId,
    default_language_copy: Array.isArray(requirementPage.copy) ? requirementPage.copy : [],
    translations: pageTranslation?.entries ?? []
  };
}

async function getBaselineImageMetadata(store: FormaStore, productId: string, pageId: string) {
  const page = await getBaselinePage(store, productId, pageId);
  const product = await store.products.getProduct(productId);
  const pointers = product.requirements ?? {};
  const requirements = (await store.requirements.getRequirementHistory(productId))
    .filter((requirement) => page.source_requirements.includes(requirement.id))
    .sort(compareRequirementsNewestFirst);

  for (const requirement of requirements) {
    const artifactId = pointers[requirement.id]?.latestArtifactId;
    if (artifactId) {
      return {
        product_id: productId,
        baseline_page_id: pageId,
        requirement_id: requirement.id,
        preview_url: artifactPreviewUrl(productId, artifactId, "2x")
      };
    }
  }

  throw new RouteNotFoundError("BASELINE_IMAGE_NOT_FOUND", "Baseline image not found", {
    product_id: productId,
    page_id: pageId,
    source_requirements: page.source_requirements
  });
}

function emptyBaselinePageCopy(pageId: string) {
  return {
    page_id: pageId,
    default_language_copy: [],
    translations: []
  };
}

function compareRequirementsOldestFirst(left: RequirementRecord, right: RequirementRecord): number {
  return timestampForRequirement(left) - timestampForRequirement(right) || left.id.localeCompare(right.id);
}

function compareRequirementsNewestFirst(left: RequirementRecord, right: RequirementRecord): number {
  return timestampForRequirement(right) - timestampForRequirement(left) || right.id.localeCompare(left.id);
}

function timestampForRequirement(requirement: RequirementRecord): number {
  const updatedAt = requirement.updated_at ? Date.parse(requirement.updated_at) : Number.NaN;
  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }
  const createdAt = requirement.created_at ? Date.parse(requirement.created_at) : Number.NaN;
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function artifactPreviewUrl(productId: string, artifactId: string, resolution: "1x" | "2x"): string {
  return `/api/products/${encodeURIComponent(productId)}/artifacts/${encodeURIComponent(artifactId)}/preview/${resolution}`;
}

/**
 * Collect the artifact ids that are "current" (referenced by a requirement pointer
 * or a design pointer) plus the current version for each design-pointer artifact.
 */
async function loadArtifactPointers(
  store: FormaRoutesStore,
  productId: string
): Promise<{ currentPointerIds: Set<string>; pointerVersions: Map<string, number> }> {
  const product = await store.products.getProduct(productId);
  const requirementPointers = (product.requirements ?? {}) as Record<string, { latestArtifactId?: string }>;
  const currentPointerIds = new Set(
    Object.values(requirementPointers).map((r) => r.latestArtifactId).filter((id): id is string => Boolean(id))
  );
  const pointerVersions = new Map<string, number>();
  for (const pointer of await store.products.listDesignPointers(productId)) {
    pointerVersions.set(pointer.artifactId, pointer.version);
    currentPointerIds.add(pointer.artifactId);
  }
  return { currentPointerIds, pointerVersions };
}

/**
 * Read an artifact's current manifest: the design-pointer version (or highest
 * version) for versioned artifacts, falling back to the flat (legacy) manifest.
 */
async function resolveCurrentArtifact(
  store: FormaRoutesStore,
  productId: string,
  artifactId: string,
  pointerVersions: Map<string, number>
): Promise<{ manifest: ArtifactManifest; etag: string; version?: number }> {
  const versions = await store.artifacts.listArtifactVersions(productId, artifactId);
  if (versions.length > 0) {
    const version = pointerVersions.get(artifactId) ?? Math.max(...versions);
    const { manifest, etag } = await store.artifacts.readArtifactVersion(productId, artifactId, version);
    return { manifest, etag, version };
  }
  const { manifest, etag } = await store.artifacts.readArtifact(productId, artifactId);
  return { manifest, etag };
}

/**
 * Resolve the on-disk preview PNG path for an artifact: the flat (legacy) preview
 * if present, otherwise the current version's preview.
 */
async function resolveCurrentPreviewPath(
  store: FormaRoutesStore,
  productsDir: string,
  productId: string,
  artifactId: string,
  res: "1x" | "2x"
): Promise<string | undefined> {
  const flatPreviewPath = join(getArtifactDir(productsDir, productId, artifactId), "preview", `${res}.png`);
  if (await fileExists(flatPreviewPath)) {
    return flatPreviewPath;
  }
  const versions = await store.artifacts.listArtifactVersions(productId, artifactId);
  if (versions.length === 0) {
    return undefined;
  }
  const pointer = (await store.products.listDesignPointers(productId)).find((p) => p.artifactId === artifactId);
  const version = pointer?.version ?? Math.max(...versions);
  try {
    return getArtifactVersionPreviewPath(productsDir, productId, artifactId, version, res);
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
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

function contentTypeForPath(file: string): string {
  switch (extname(file)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    case ".woff":
      return "font/woff";
    case ".ttf":
      return "font/ttf";
    default:
      return "application/octet-stream";
  }
}
