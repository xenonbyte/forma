import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  applyProductComponentOperations,
  applyRequirementDesignOperations,
  beginProductComponentSession,
  beginRequirementDesignSession,
  commitProductComponentSession,
  commitRequirementDesignSession,
  diffRequirementDesignVersions,
  discardProductComponentSession,
  discardRequirementDesignSession,
  exportRequirementDesignAsset,
  findBaselinePreviewMetadata,
  getProductComponentLibrary,
  getRequirementDesign,
  getRequirementDesignHistory,
  getRequirementDesignScene,
  indexRequirementDesignCanvas,
  planImportMetadataNormalization,
  readRequirementDesignMetadata,
  readYaml,
  recoverV6NormalizationJournal,
  recoverDesignCommitJournal,
  refreshRequirementComponents,
  rollbackRequirementDesign,
  runDesignQualityPipeline,
  restoreV6NormalizationBackup,
  SchemaNormalizationRecoveryError,
  type Language,
  type Platform,
  type SchemaNormalizationRecoveryState
} from "@xenonbyte/forma-core";

type UnknownRecord = Record<string, unknown>;
type RouteServiceInput = Record<string, unknown> & { home: string };

type V6RouteServices = Partial<{
  beginRequirementDesignSession(input: RouteServiceInput): Promise<unknown>;
  applyRequirementDesignOperations(input: RouteServiceInput): Promise<unknown>;
  commitRequirementDesignSession(input: RouteServiceInput): Promise<unknown>;
  discardRequirementDesignSession(input: RouteServiceInput): Promise<unknown>;
  recoverDesignCommitJournal(input: RouteServiceInput): Promise<unknown>;
  beginProductComponentSession(input: RouteServiceInput): Promise<unknown>;
  applyProductComponentOperations(input: RouteServiceInput): Promise<unknown>;
  commitProductComponentSession(input: RouteServiceInput): Promise<unknown>;
  discardProductComponentSession(input: RouteServiceInput): Promise<unknown>;
  getRequirementDesign(home: string, productId: string, requirementId: string): Promise<unknown>;
  indexRequirementDesignCanvas(input: RouteServiceInput): Promise<unknown>;
  getRequirementDesignScene(input: RouteServiceInput): Promise<unknown>;
  getRequirementDesignHistory(input: RouteServiceInput): Promise<unknown>;
  rollbackRequirementDesign(input: RouteServiceInput): Promise<unknown>;
  diffRequirementDesignVersions(input: RouteServiceInput): Promise<unknown>;
  exportRequirementDesignAsset(input: RouteServiceInput): Promise<unknown>;
  getProductComponentLibrary(home: string, productId: string): Promise<unknown>;
  refreshRequirementComponents(input: RouteServiceInput): Promise<unknown>;
  planImportMetadataNormalization(input: RouteServiceInput): Promise<unknown>;
  runDesignQualityPipeline(input: RouteServiceInput): Promise<unknown>;
}>;

const forbiddenPathFieldNames = new Set([
  "filePath",
  "file_path",
  "canvas_path",
  "staging_path",
  "outputDir",
  "output_dir",
  "path",
  "pen_path",
  "preview_path",
  "history_path"
]);

interface RequirementRecord {
  id: string;
  product_id: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  document_md?: string;
  pages: Array<{
    page_id: string;
    baseline_page?: string;
    design_status?: string;
    status?: string;
    copy?: unknown[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

interface BaselinePageRecord {
  id: string;
  source_requirements: string[];
  [key: string]: unknown;
}

export interface FormaRoutesStore {
  home: string;
  baseline: {
    getProductBaseline(productId: string): Promise<{ pages: BaselinePageRecord[]; navigation?: unknown[]; [key: string]: unknown }>;
  };
  copy: {
    getTranslations(productId: string, requirementId: string): Promise<Array<{ page_id: string; entries?: unknown[]; [key: string]: unknown }>>;
  };
  deleteProduct(input: { product_id: string; confirm_product_id: string }): Promise<unknown>;
  products: {
    createProduct(input: { name: string; description: string }): Promise<unknown>;
    getProduct(productId: string): Promise<unknown>;
    initProductConfig(productId: string, config: unknown): Promise<unknown>;
    listProducts(): Promise<Array<{ id: string; [key: string]: unknown }>>;
  };
  requirements: {
    archiveRequirement(requirementId: string): Promise<{ id: string; [key: string]: unknown }>;
    createEmptyRequirement(productId: string, title: string): Promise<unknown>;
    getRequirement(input: { requirement_id: string } | { product_id: string }): Promise<RequirementRecord>;
    getRequirementHistory(productId: string): Promise<RequirementRecord[]>;
    saveRequirement(input: unknown): Promise<unknown>;
  };
  styles: {
    getStyle(name: string): Promise<{ metadata: { design_md_path: string; [key: string]: unknown }; [key: string]: unknown }>;
    listStyles(): Promise<unknown>;
  };
  sync: {
    getStatus(): Promise<unknown>;
    startSync(): Promise<{ task_id: string; status: string; [key: string]: unknown }>;
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

export function registerRoutes(app: FastifyInstance, store: FormaRoutesStore): void {
  const v6 = getV6RouteServices(store);

  app.get("/api/products", async () => store.products.listProducts());

  app.post<{ Body: unknown }>("/api/products", async (request) => {
    const body = objectBody(request.body);
    return store.products.createProduct({
      name: requiredString(body, "name"),
      description: requiredString(body, "description")
    });
  });

  app.get<{ Params: { id: string } }>("/api/products/:id", async (request) => store.products.getProduct(request.params.id));

  app.delete<{ Params: { id: string }; Body: unknown }>("/api/products/:id", async (request) => {
    const body = objectBody(request.body);
    return store.deleteProduct({
      product_id: request.params.id,
      confirm_product_id: requiredString(body, "confirm_product_id")
    });
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/products/:id/config", async (request) => {
    const body = objectBody(request.body);
    const style = await store.styles.getStyle(requiredString(body, "style"));
    return store.products.initProductConfig(request.params.id, {
      platform: requiredPlatform(body, "platform"),
      style: style.metadata,
      languages: requiredStringArray(body, "languages") as Language[],
      default_language: requiredString(body, "default_language") as Language
    });
  });

  app.get<{ Params: { id: string } }>("/api/products/:id/requirements", async (request) =>
    store.requirements.getRequirementHistory(request.params.id)
  );

  app.post<{ Params: { id: string }; Body: unknown }>("/api/products/:id/requirements", async (request) => {
    const body = objectBody(request.body);
    requireOnlyFields(body, ["title"]);
    return store.requirements.createEmptyRequirement(request.params.id, requiredString(body, "title"));
  });

  app.post<{ Params: { id: string; reqId: string }; Body: unknown }>("/api/products/:id/requirements/:reqId/save", async (request) => {
    await getOwnedRequirement(store, request.params.id, request.params.reqId);
    const body = objectBody(request.body);
    const input = { ...body, requirement_id: request.params.reqId } as Parameters<typeof store.requirements.saveRequirement>[0];
    return store.requirements.saveRequirement(input);
  });

  app.put<{ Params: { id: string; reqId: string } }>("/api/products/:id/requirements/:reqId/archive", async (request) => {
    await getOwnedRequirement(store, request.params.id, request.params.reqId);
    const archived = await store.requirements.archiveRequirement(request.params.reqId);
    return store.requirements.getRequirement({ requirement_id: archived.id });
  });

  app.get<{ Params: { id: string; reqId: string } }>("/api/products/:id/requirements/:reqId", async (request) =>
    getOwnedRequirement(store, request.params.id, request.params.reqId)
  );

  app.get<{ Params: { productId: string; requirementId: string } }>(
    "/api/products/:productId/requirements/:requirementId/design/canvas",
    async (request) =>
      (v6.getRequirementDesign ?? getRequirementDesign)(store.home, request.params.productId, request.params.requirementId)
  );

  app.post<{ Params: { productId: string; requirementId: string }; Body: unknown }>(
    "/api/products/:productId/requirements/:requirementId/design/index",
    async (request) => {
      const input = requirementMutationInput(store, request.params, request.body);
      return v6.indexRequirementDesignCanvas
        ? v6.indexRequirementDesignCanvas(input)
        : indexRequirementDesignCanvas({
          home: store.home,
          product_id: request.params.productId,
          requirement_id: request.params.requirementId
        });
    }
  );

  app.get<{ Params: { productId: string; requirementId: string } }>(
    "/api/products/:productId/requirements/:requirementId/design/scene",
    async (request) =>
      (v6.getRequirementDesignScene ?? getRequirementDesignScene)({
        home: store.home,
        product_id: request.params.productId,
        requirement_id: request.params.requirementId
      })
  );

  app.get<{ Params: { productId: string; requirementId: string }; Querystring: { page_id?: string } }>(
    "/api/products/:productId/requirements/:requirementId/design/history",
    async (request) =>
      (v6.getRequirementDesignHistory ?? getRequirementDesignHistory)({
        home: store.home,
        product_id: request.params.productId,
        requirement_id: request.params.requirementId,
        ...(request.query.page_id ? { page_id: request.query.page_id } : {})
      })
  );

  app.get<{ Params: { productId: string; requirementId: string; pageId: string }; Querystring: { page_version?: string } }>(
    "/api/products/:productId/requirements/:requirementId/design/preview/:pageId/file",
    async (request, reply) =>
      sendRequirementDesignPreviewFile(
        store,
        request.params.productId,
        request.params.requirementId,
        request.params.pageId,
        optionalIntegerQuery(request.query, "page_version"),
        reply
      )
  );

  app.get<{ Params: { productId: string; requirementId: string }; Querystring: { node_id?: string; format?: string } }>(
    "/api/products/:productId/requirements/:requirementId/design/export",
    async (request) => {
      const input = {
        home: store.home,
        product_id: request.params.productId,
        requirement_id: request.params.requirementId,
        ...(request.query.node_id ? { node_id: request.query.node_id } : {}),
        ...(request.query.format ? { format: request.query.format } : {})
      };
      return v6.exportRequirementDesignAsset
        ? v6.exportRequirementDesignAsset(input)
        : exportRequirementDesignAsset({
          home: store.home,
          product_id: request.params.productId,
          requirement_id: request.params.requirementId,
          kind: "canvas"
        });
    }
  );

  app.get<{
    Params: { productId: string; requirementId: string };
    Querystring: { page_id?: string; from_page_version?: string; to_page_version?: string; from_canvas_version?: string; to_canvas_version?: string };
  }>(
    "/api/products/:productId/requirements/:requirementId/design/diff",
    async (request) => {
      const fromPageVersion = requiredIntegerQuery(request.query, "from_page_version", "from_canvas_version");
      const toPageVersion = requiredIntegerQuery(request.query, "to_page_version", "to_canvas_version");
      const input = {
        home: store.home,
        product_id: request.params.productId,
        requirement_id: request.params.requirementId,
        ...(request.query.page_id ? { page_id: request.query.page_id } : {}),
        from_page_version: fromPageVersion,
        to_page_version: toPageVersion
      };
      return v6.diffRequirementDesignVersions
        ? v6.diffRequirementDesignVersions(input)
        : diffRequirementDesignVersions({
          home: store.home,
          product_id: request.params.productId,
          requirement_id: request.params.requirementId,
          from_canvas_version: fromPageVersion,
          to_canvas_version: toPageVersion
        });
    }
  );

  app.get<{ Params: { productId: string } }>("/api/products/:productId/design/session/active", async (request) =>
    getActiveDesignSessionLease(store, request.params.productId)
  );

  app.get<{ Params: { productId: string; requirementId: string } }>(
    "/api/products/:productId/requirements/:requirementId/design/session/active",
    async (request) => getActiveDesignSessionLease(store, request.params.productId, request.params.requirementId)
  );

  app.post<{ Params: { productId: string; requirementId: string }; Body: unknown }>(
    "/api/products/:productId/requirements/:requirementId/design/session/begin",
    async (request) => {
      const input = requirementMutationInput(store, request.params, request.body);
      return v6.beginRequirementDesignSession
        ? v6.beginRequirementDesignSession(input)
        : beginRequirementDesignSession(input as unknown as Parameters<typeof beginRequirementDesignSession>[0]);
    }
  );

  app.post<{ Params: { productId: string; requirementId: string; sessionId: string }; Body: unknown }>(
    "/api/products/:productId/requirements/:requirementId/design/session/:sessionId/operations",
    async (request) => {
      const input = requirementMutationInput(store, request.params, request.body);
      return v6.applyRequirementDesignOperations
        ? v6.applyRequirementDesignOperations(input)
        : applyRequirementDesignOperations(input as unknown as Parameters<typeof applyRequirementDesignOperations>[0]);
    }
  );

  app.post<{ Params: { productId: string; requirementId: string; sessionId: string }; Body: unknown }>(
    "/api/products/:productId/requirements/:requirementId/design/session/:sessionId/quality",
    async (request) => {
      const input = requirementMutationInput(store, request.params, request.body);
      return v6.runDesignQualityPipeline
        ? v6.runDesignQualityPipeline(input)
        : validateRequirementDesignQualityFromRoute(input);
    }
  );

  app.post<{ Params: { productId: string; requirementId: string; sessionId: string }; Body: unknown }>(
    "/api/products/:productId/requirements/:requirementId/design/session/:sessionId/component-refresh/plan",
    async (request) => {
      const input = requirementMutationInput(store, request.params, request.body);
      return v6.refreshRequirementComponents
        ? v6.refreshRequirementComponents(input)
        : refreshRequirementComponentsFromRoute(input);
    }
  );

  app.post<{ Params: { productId: string; requirementId: string; sessionId: string }; Body: unknown }>(
    "/api/products/:productId/requirements/:requirementId/design/session/:sessionId/import-metadata-normalization/plan",
    async (request) =>
      (v6.planImportMetadataNormalization ?? planImportMetadataNormalization)(
        requirementMutationInput(store, request.params, request.body) as Parameters<typeof planImportMetadataNormalization>[0]
      )
  );

  app.post<{ Params: { productId: string; requirementId: string; sessionId: string }; Body: unknown }>(
    "/api/products/:productId/requirements/:requirementId/design/session/:sessionId/rollback/plan",
    async (request) => {
      const input = requirementMutationInput(store, request.params, request.body);
      return v6.rollbackRequirementDesign
        ? v6.rollbackRequirementDesign(input)
        : rollbackRequirementDesign({
          home: store.home,
          product_id: request.params.productId,
          requirement_id: request.params.requirementId,
          canvas_version: requiredIntegerField(input, "canvas_version")
        });
    }
  );

  app.post<{ Params: { productId: string; requirementId: string; sessionId: string }; Body: unknown }>(
    "/api/products/:productId/requirements/:requirementId/design/session/:sessionId/commit",
    async (request) => {
      const input = requirementMutationInput(store, request.params, request.body);
      return v6.commitRequirementDesignSession
        ? v6.commitRequirementDesignSession(input)
        : commitRequirementDesignSessionFromRoute(input);
    }
  );

  app.post<{ Params: { productId: string; requirementId: string; sessionId: string }; Body: unknown }>(
    "/api/products/:productId/requirements/:requirementId/design/session/:sessionId/discard",
    async (request) =>
      (v6.discardRequirementDesignSession ?? discardRequirementDesignSession)(
        requirementMutationInput(store, request.params, request.body) as Parameters<typeof discardRequirementDesignSession>[0]
      )
  );

  app.get<{ Params: { productId: string } }>("/api/products/:productId/component-library", async (request) =>
    (v6.getProductComponentLibrary ?? getProductComponentLibrary)(store.home, request.params.productId)
  );

  app.post<{ Params: { productId: string }; Body: unknown }>(
    "/api/products/:productId/component-library/session/begin",
    async (request) =>
      (v6.beginProductComponentSession ?? beginProductComponentSession)(
        productMutationInput(store, request.params, request.body) as Parameters<typeof beginProductComponentSession>[0]
      )
  );

  app.post<{ Params: { productId: string; sessionId: string }; Body: unknown }>(
    "/api/products/:productId/component-library/session/:sessionId/operations",
    async (request) =>
      (v6.applyProductComponentOperations ?? applyProductComponentOperations)(
        productMutationInput(store, request.params, request.body) as Parameters<typeof applyProductComponentOperations>[0]
      )
  );

  app.post<{ Params: { productId: string; sessionId: string }; Body: unknown }>(
    "/api/products/:productId/component-library/session/:sessionId/commit",
    async (request) =>
      (v6.commitProductComponentSession ?? commitProductComponentSession)(
        productMutationInput(store, request.params, request.body) as Parameters<typeof commitProductComponentSession>[0]
      )
  );

  app.post<{ Params: { productId: string; sessionId: string }; Body: unknown }>(
    "/api/products/:productId/component-library/session/:sessionId/discard",
    async (request) =>
      (v6.discardProductComponentSession ?? discardProductComponentSession)(
        productMutationInput(store, request.params, request.body) as Parameters<typeof discardProductComponentSession>[0]
      )
  );

  app.post<{ Params: { productId: string; sessionId: string }; Body: unknown }>(
    "/api/products/:productId/design/session/:sessionId/recover-commit-journal",
    async (request) =>
      (v6.recoverDesignCommitJournal ?? recoverDesignCommitJournal)(
        productMutationInput(store, request.params, request.body) as Parameters<typeof recoverDesignCommitJournal>[0]
      )
  );

  app.get<{ Params: { id: string } }>("/api/products/:id/baseline", async (request) =>
    store.baseline.getProductBaseline(request.params.id)
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
        }
      }]
    };
  });

  app.get("/api/styles", async () => store.styles.listStyles());

  app.post("/api/styles/sync", async (_request, reply) => {
    const started = await store.sync.startSync();
    reply.status(202).send({ task_id: started.task_id, status: "running", message: "Style sync started" });
  });

  app.get("/api/styles/sync/status", async () => store.sync.getStatus());

  app.get<{ Params: { name: string } }>("/api/styles/:name", async (request) => store.styles.getStyle(request.params.name));

  app.get<{ Params: { name: string } }>("/api/styles/:name/preview", async (request) => {
    const { previewPath, style } = await getStylePreview(store, request.params.name);
    const hasPreview = await fileExists(previewPath);
    return {
      name: request.params.name,
      preview_path: previewPath,
      ...(hasPreview ? { image_url: `/api/styles/${encodeURIComponent(request.params.name)}/preview/image` } : {}),
      metadata: style.metadata
    };
  });

  app.get<{ Params: { name: string } }>("/api/styles/:name/preview/image", async (request, reply) => {
    const { previewPath } = await getStylePreview(store, request.params.name);
    if (!(await fileExists(previewPath))) {
      throw new RouteNotFoundError("STYLE_PREVIEW_NOT_FOUND", "Style preview not found", { style: request.params.name });
    }

    reply.type("image/png").send(await readFile(previewPath));
  });
}

function getV6RouteServices(store: FormaRoutesStore): V6RouteServices {
  return (store as FormaRoutesStore & { v6?: V6RouteServices }).v6 ?? {};
}

function optionalObjectBody(body: unknown): UnknownRecord {
  if (body === undefined) {
    return {};
  }
  return objectBody(body);
}

function objectBody(body: unknown): UnknownRecord {
  if (!isRecord(body)) {
    throw new RouteInputError("Request body must be a JSON object");
  }
  return body;
}

function productMutationInput(
  store: FormaRoutesStore,
  params: { productId: string; sessionId?: string },
  body: unknown
): RouteServiceInput {
  const input = optionalObjectBody(body);
  assertNoForbiddenPathFields(input);
  assertRouteBodyMatches(input, "product_id", params.productId);
  if (params.sessionId) {
    assertRouteBodyMatches(input, "session_id", params.sessionId);
  }
  return {
    home: store.home,
    ...input,
    product_id: params.productId,
    ...(params.sessionId ? { session_id: params.sessionId } : {})
  };
}

function requirementMutationInput(
  store: FormaRoutesStore,
  params: { productId: string; requirementId: string; sessionId?: string },
  body: unknown
): RouteServiceInput {
  const input = optionalObjectBody(body);
  assertNoForbiddenPathFields(input);
  assertRouteBodyMatches(input, "product_id", params.productId);
  assertRouteBodyMatches(input, "requirement_id", params.requirementId);
  if (params.sessionId) {
    assertRouteBodyMatches(input, "session_id", params.sessionId);
  }
  return {
    home: store.home,
    ...input,
    product_id: params.productId,
    requirement_id: params.requirementId,
    ...(params.sessionId ? { session_id: params.sessionId } : {})
  };
}

function assertRouteBodyMatches(input: UnknownRecord, field: string, expected: string): void {
  const actual = input[field];
  if (actual !== undefined && actual !== expected) {
    throw new RouteInputError(`${field} must match the route parameter`, { field, expected, actual });
  }
}

function assertNoForbiddenPathFields(value: unknown, path: Array<string | number> = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenPathFields(item, [...path, index]));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (forbiddenPathFieldNames.has(key)) {
      throw new RouteHttpError("FORBIDDEN_PATH_PARAMETER", "Pencil file paths are session-owned", {
        parameter: formatParameterPath(nextPath)
      }, 400);
    }
    assertNoForbiddenPathFields(nested, nextPath);
  }
}

function formatParameterPath(path: Array<string | number>): string {
  return path.map((part) => String(part)).join(".");
}

async function sendRequirementDesignPreviewFile(
  store: FormaStore,
  productId: string,
  requirementId: string,
  pageId: string,
  pageVersion: number | undefined,
  reply: FastifyReply
): Promise<void> {
  const metadata = await readRequirementDesignMetadata(store.home, productId, requirementId);
  const page = metadata.pages.find((item) => item.page_id === pageId);
  const previewFile = pageVersion === undefined
    ? page?.preview_file
    : `history/previews/${pageId}.p${pageVersion}@2x.png`;

  if (!previewFile) {
    throw new RouteHttpError("PREVIEW_NOT_EXPORTED", "Preview was not exported", {
      product_id: productId,
      requirement_id: requirementId,
      page_id: pageId,
      page_version: pageVersion
    }, 404);
  }

  const previewPath = safeStorePath(store, "data", productId, requirementId, previewFile);
  if (!(await fileExists(previewPath))) {
    throw new RouteHttpError("PREVIEW_NOT_EXPORTED", "Preview was not exported", {
      product_id: productId,
      requirement_id: requirementId,
      page_id: pageId,
      page_version: pageVersion,
      preview_file: previewFile
    }, 404);
  }

  reply.type("image/png").send(await readFile(previewPath));
}

async function getActiveDesignSessionLease(store: FormaStore, productId: string, requirementId?: string): Promise<Record<string, unknown>> {
  const leasePath = requirementId
    ? safeStorePath(store, "data", productId, requirementId, "sessions", "active.yaml")
    : safeStorePath(store, "data", productId, "sessions", "active-design-session.yaml");
  if (!(await fileExists(leasePath))) {
    return {
      product_id: productId,
      ...(requirementId ? { requirement_id: requirementId } : {}),
      status: "none"
    };
  }

  const lease = await readYaml<Record<string, unknown>>(leasePath);
  return {
    product_id: productId,
    ...(requirementId ? { requirement_id: requirementId } : {}),
    ...lease,
    elapsed_ms: elapsedMs(lease)
  };
}

function elapsedMs(lease: Record<string, unknown>): number {
  const timestamp = typeof lease.started_at === "string"
    ? lease.started_at
    : typeof lease.updated_at === "string"
      ? lease.updated_at
      : undefined;
  if (!timestamp) {
    return 0;
  }
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Date.now() - parsed);
}

function optionalIntegerQuery(query: UnknownRecord, field: string): number | undefined {
  const value = query[field];
  if (value === undefined) {
    return undefined;
  }
  return parseIntegerValue(value, field);
}

function requiredIntegerQuery(query: UnknownRecord, primaryField: string, fallbackField?: string): number {
  const field = query[primaryField] === undefined && fallbackField ? fallbackField : primaryField;
  const value = query[field];
  if (value === undefined) {
    throw new RouteInputError(`Missing required query field: ${primaryField}`, { field: primaryField });
  }
  return parseIntegerValue(value, field);
}

function requiredIntegerField(input: UnknownRecord, field: string): number {
  const value = input[field];
  if (value === undefined) {
    throw new RouteInputError(`Missing required field: ${field}`, { field });
  }
  return parseIntegerValue(value, field);
}

function parseIntegerValue(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new RouteInputError(`Invalid integer field: ${field}`, { field, value });
  }
  return parsed;
}

async function validateRequirementDesignQualityFromRoute(input: RouteServiceInput) {
  const sessionId = requiredString(input, "session_id");
  const session = await findSessionRecord(input.home, sessionId);
  return {
    session_id: sessionId,
    product_id: input.product_id,
    requirement_id: input.requirement_id,
    page_id: input.page_id,
    frame_id: input.frame_id,
    quality_report: await runDesignQualityPipeline({ pen_file: session.staging_path })
  };
}

async function refreshRequirementComponentsFromRoute(input: RouteServiceInput) {
  const scope = input.scope === "all_pages" ? undefined : isRecord(input.scope) ? input.scope : undefined;
  return refreshRequirementComponents({
    home: input.home,
    session_id: requiredString(input, "session_id"),
    target_component_library_version: typeof input.version === "number" ? input.version : undefined,
    page_ids: Array.isArray(scope?.page_ids) ? scope.page_ids.filter((item): item is string => typeof item === "string") : undefined
  });
}

async function commitRequirementDesignSessionFromRoute(input: RouteServiceInput) {
  const qualityReport = input.quality_report;
  if (!isRecord(qualityReport)) {
    throw new RouteInputError("quality_report is required", { field: "quality_report" });
  }
  return commitRequirementDesignSession({
    home: input.home,
    session_id: requiredString(input, "session_id"),
    page_id: requiredString(input, "page_id"),
    frame_id: requiredString(input, "frame_id"),
    quality_report: qualityReport as unknown as Parameters<typeof commitRequirementDesignSession>[0]["quality_report"],
    previewExporter: async () => {
      throw new RouteHttpError("PENCIL_CAPABILITY_UNAVAILABLE", "Preview export requires a live Pencil session adapter", {}, 503);
    }
  });
}

async function findSessionRecord(home: string, sessionId: string): Promise<{ staging_path: string }> {
  for (const file of await candidateSessionFiles(home, sessionId)) {
    if (!await fileExists(file)) {
      continue;
    }
    const record = await readYaml<Record<string, unknown>>(file);
    if (record.session_id !== sessionId || typeof record.staging_path !== "string") {
      continue;
    }
    return { staging_path: resolve(home, record.staging_path) };
  }
  throw new RouteInputError("Design session not found", { session_id: sessionId });
}

async function candidateSessionFiles(home: string, sessionId: string): Promise<string[]> {
  const files: string[] = [];
  const dataDir = join(home, "data");
  for (const productId of await safeReaddir(dataDir)) {
    const productDir = join(dataDir, productId);
    for (const requirementId of await safeReaddir(productDir)) {
      if (requirementId === "sessions" || requirementId.startsWith("D-")) {
        continue;
      }
      files.push(join(productDir, requirementId, "sessions", sessionId, "design_session.yaml"));
    }
  }
  const libraryDir = join(home, "library");
  for (const entry of await safeReaddir(libraryDir)) {
    if (entry.endsWith(".sessions")) {
      files.push(join(libraryDir, entry, sessionId, "design_session.yaml"));
    }
  }
  return files;
}

async function safeReaddir(path: string): Promise<string[]> {
  return readdir(path).catch(() => []);
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

async function getBaselinePage(store: FormaStore, productId: string, pageId: string) {
  const baseline = await store.baseline.getProductBaseline(productId);
  const page = baseline.pages.find((item) => item.id === pageId);
  if (!page) {
    throw new RouteNotFoundError("BASELINE_PAGE_NOT_FOUND", "Baseline page not found", { product_id: productId, page_id: pageId });
  }
  return page;
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

async function getBaselinePageCopy(store: FormaStore, productId: string, pageId: string, requirementId: string | undefined) {
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
  if (!requirementPage.copy || requirementPage.copy.length === 0) {
    return emptyBaselinePageCopy(pageId);
  }

  const translations = await store.copy.getTranslations(productId, requirement.id);
  const pageTranslation = translations.find((item) => item.page_id === requirementPage.page_id);
  return {
    page_id: pageId,
    default_language_copy: requirementPage.copy ?? [],
    translations: pageTranslation?.entries ?? []
  };
}

function emptyBaselinePageCopy(pageId: string) {
  return {
    page_id: pageId,
    default_language_copy: [],
    translations: []
  };
}

async function getStylePreview(store: FormaStore, name: string) {
  const style = await store.styles.getStyle(name);
  const styleDir = dirname(style.metadata.design_md_path);
  return {
    previewPath: safeStorePath(store, styleDir, "preview@2x.png"),
    style
  };
}

async function getBaselineImageMetadata(store: FormaStore, productId: string, pageId: string) {
  const page = await getBaselinePage(store, productId, pageId);
  const preview = await findBaselinePreviewMetadata(store, productId, pageId);
  if (preview) {
    return preview;
  }

  throw new RouteNotFoundError("BASELINE_IMAGE_NOT_FOUND", "Baseline image not found", {
    product_id: productId,
    page_id: pageId,
    source_requirements: page.source_requirements
  });
}

function compareRequirementsNewestFirst(
  left: { id: string; created_at?: string; updated_at?: string },
  right: { id: string; created_at?: string; updated_at?: string }
): number {
  return timestampForRequirement(right) - timestampForRequirement(left) || right.id.localeCompare(left.id);
}

function timestampForRequirement(requirement: { created_at?: string; updated_at?: string }): number {
  const updatedAt = requirement.updated_at ? Date.parse(requirement.updated_at) : Number.NaN;
  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }
  const createdAt = requirement.created_at ? Date.parse(requirement.created_at) : Number.NaN;
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeStorePath(store: FormaRoutesStore, ...segments: string[]): string {
  const home = resolve(store.home);
  const file = resolve(home, ...segments);
  if (file !== home && !file.startsWith(`${home}${sep}`)) {
    throw new RouteNotFoundError("FILE_NOT_FOUND", "File not found", { path: segments.join("/") });
  }
  return file;
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
