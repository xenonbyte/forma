import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import { designSchema, readYamlAs, type createFormaStore, type Design, type SubmitRequirementInput } from "@xenonbyte/forma-core";

export type FormaStore = ReturnType<typeof createFormaStore>;

type UnknownRecord = Record<string, unknown>;

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

class RouteNotFoundError extends RouteHttpError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(code, message, details, 404);
    this.name = "RouteNotFoundError";
  }
}

export function registerRoutes(app: FastifyInstance, store: FormaStore): void {
  app.get("/api/products", async () => store.products.listProducts());

  app.post<{ Body: unknown }>("/api/products", async (request) => {
    const body = objectBody(request.body);
    return store.products.createProduct({
      name: requiredString(body, "name"),
      description: requiredString(body, "description")
    });
  });

  app.get<{ Params: { id: string } }>("/api/products/:id", async (request) => store.products.getProduct(request.params.id));

  app.get<{ Params: { id: string } }>("/api/products/:id/requirements", async (request) =>
    store.requirements.getRequirementHistory(request.params.id)
  );

  app.post<{ Params: { id: string }; Body: unknown }>("/api/products/:id/requirements", async (request) => {
    const body = objectBody(request.body);
    const requirement = await store.requirements.createEmptyRequirement(request.params.id, requiredString(body, "title"));
    return store.requirements.submitRequirement({
      requirement_id: requirement.id,
      document_md: requiredString(body, "document_md"),
      pages: requiredArray(body, "pages") as SubmitRequirementInput["pages"],
      navigation: requiredArray(body, "navigation") as SubmitRequirementInput["navigation"]
    });
  });

  app.put<{ Params: { id: string; reqId: string } }>("/api/products/:id/requirements/:reqId/archive", async (request) => {
    await getOwnedRequirement(store, request.params.id, request.params.reqId);
    return store.requirements.archiveRequirement(request.params.reqId);
  });

  app.get<{ Params: { id: string; reqId: string } }>("/api/products/:id/requirements/:reqId", async (request) =>
    getOwnedRequirement(store, request.params.id, request.params.reqId)
  );

  app.get<{ Params: { id: string } }>("/api/products/:id/baseline", async (request) =>
    store.baseline.getProductBaseline(request.params.id)
  );

  app.get<{ Params: { id: string; pageId: string } }>("/api/products/:id/baseline/pages/:pageId/image", async (request) =>
    getBaselineImageMetadata(store, request.params.id, request.params.pageId)
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

  app.get<{ Params: { designId: string } }>("/api/designs/:designId/annotations", async (request) =>
    store.designs.getDesignAnnotations(request.params.designId)
  );

  app.get<{ Params: { designId: string }; Querystring: { version?: string } }>("/api/designs/:designId/image", async (request) =>
    getDesignImageMetadata(store, request.params.designId, request.query.version)
  );

  app.get<{ Params: { designId: string } }>("/api/designs/:designId/history", async (request) =>
    getDesignHistoryMetadata(store, request.params.designId)
  );

  app.get<{ Params: { designId: string }; Querystring: { v1?: string; v2?: string } }>("/api/designs/:designId/diff", async (request) => {
    const v1 = requiredPositiveIntegerQuery(request.query.v1, "v1");
    const v2 = requiredPositiveIntegerQuery(request.query.v2, "v2");
    const diff = await store.designs.diffDesigns(request.params.designId, v1, v2);
    return {
      ...diff,
      visual: {
        from_image_url: `/api/designs/${request.params.designId}/image?version=${v1}`,
        to_image_url: `/api/designs/${request.params.designId}/image?version=${v2}`
      }
    };
  });

  app.get<{ Params: { designId: string }; Querystring: { node_id?: string; format?: string } }>("/api/designs/:designId/export", async (request) =>
    store.designs.exportDesignAsset(
      request.params.designId,
      requiredString(request.query, "node_id"),
      requiredExportFormat(request.query.format)
    )
  );

  app.get("/api/styles", async () => store.styles.listStyles());

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

function requiredArray(input: UnknownRecord, field: string): unknown[] {
  const value = input[field];
  if (!Array.isArray(value)) {
    throw new RouteInputError(`Missing required field: ${field}`, { field });
  }
  return value;
}

function requiredPositiveIntegerQuery(value: string | undefined, field: string): number {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RouteInputError(`Missing required query parameter: ${field}`, { field });
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new RouteInputError(`Invalid query parameter: ${field}`, { field, value });
  }
  return parsed;
}

function optionalPositiveIntegerQuery(value: string | undefined, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredPositiveIntegerQuery(value, field);
}

function requiredExportFormat(format: string | undefined): "png" | "svg" | "pdf" {
  if (format !== "png" && format !== "svg" && format !== "pdf") {
    throw new RouteInputError("Missing or invalid export format", { field: "format", value: format });
  }
  return format;
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
  const sourceRequirements = new Set(page.source_requirements);
  const requirements = (await store.requirements.getRequirementHistory(productId))
    .filter((requirement) => sourceRequirements.has(requirement.id))
    .sort(compareRequirementsNewestFirst);

  for (const requirement of requirements) {
    const requirementPage = requirement.pages.find((item) => item.baseline_page === pageId);
    if (!requirementPage?.design_id || requirementPage.design_status !== "done") {
      continue;
    }

    const previewPath = safeStorePath(store, "data", productId, requirement.id, requirementPage.design_id, "preview@2x.png");
    if (!(await fileExists(previewPath))) {
      continue;
    }

    return {
      product_id: productId,
      baseline_page_id: pageId,
      requirement_id: requirement.id,
      requirement_page_id: requirementPage.page_id,
      design_id: requirementPage.design_id,
      image_url: `/api/designs/${requirementPage.design_id}/image`,
      preview_path: previewPath
    };
  }

  throw new RouteNotFoundError("BASELINE_IMAGE_NOT_FOUND", "Baseline image not found", {
    product_id: productId,
    page_id: pageId,
    source_requirements: page.source_requirements
  });
}

async function getDesignImageMetadata(store: FormaStore, designId: string, versionQuery: string | undefined) {
  const requestedVersion = optionalPositiveIntegerQuery(versionQuery, "version");
  const { design, reference } = await readDesignMetadata(store, designId);
  const resolvedImage = resolveDesignPreview(design, requestedVersion);
  const previewPath = safeStorePath(store, "data", reference.product_id, reference.requirement_id, designId, resolvedImage.previewFile);
  if (!(await fileExists(previewPath))) {
    throw new RouteNotFoundError("HISTORY_FILE_MISSING", "Design history file is missing", {
      design_id: designId,
      version: resolvedImage.version,
      file: resolvedImage.previewFile
    });
  }

  return {
    design_id: designId,
    version: resolvedImage.version,
    image_url: `/api/designs/${designId}/image?version=${resolvedImage.version}`,
    preview_path: previewPath
  };
}

async function getDesignHistoryMetadata(store: FormaStore, designId: string) {
  const { design, reference } = await readDesignMetadata(store, designId);
  const versions = [
    ...design.history
      .sort((left, right) => left.version - right.version)
      .map((entry) => ({
        version: entry.version,
        file: entry.file,
        preview_file: entry.preview_file,
        created_at: entry.created_at,
        current: false,
        image_url: `/api/designs/${designId}/image?version=${entry.version}`
      })),
    {
      version: design.version,
      file: "design.pen",
      preview_file: "preview@2x.png",
      created_at: design.updated_at,
      current: true,
      image_url: `/api/designs/${designId}/image?version=${design.version}`
    }
  ];
  return {
    design_id: designId,
    product_id: reference.product_id,
    requirement_id: reference.requirement_id,
    page_id: reference.page_id,
    current_version: design.version,
    versions
  };
}

async function readDesignMetadata(store: FormaStore, designId: string) {
  const reference = await getDesignReference(store, designId);
  const designFile = safeStorePath(store, "data", reference.product_id, reference.requirement_id, designId, "design.yaml");
  if (!(await fileExists(designFile))) {
    throw new RouteNotFoundError("DESIGN_NOT_FOUND", "Design not found", { design_id: designId });
  }
  const design = await readYamlAs(designFile, designSchema);
  if (
    design.id !== designId ||
    design.product_id !== reference.product_id ||
    design.requirement_id !== reference.requirement_id ||
    design.page_id !== reference.page_id
  ) {
    throw new RouteNotFoundError("DESIGN_NOT_FOUND", "Design not found", { design_id: designId });
  }
  return { design, reference };
}

function resolveDesignPreview(design: Design, requestedVersion: number | undefined): { version: number; previewFile: string } {
  const version = requestedVersion ?? design.version;
  if (version === design.version) {
    return { version, previewFile: "preview@2x.png" };
  }
  if (version > design.version) {
    throw new RouteNotFoundError("HISTORY_FILE_MISSING", "Design history file is missing", {
      design_id: design.id,
      version,
      file: `preview.v${version}@2x.png`
    });
  }

  const historyEntry = design.history.find((entry) => entry.version === version);
  const expectedPreviewFile = `preview.v${version}@2x.png`;
  if (!historyEntry || historyEntry.preview_file !== expectedPreviewFile) {
    throw new RouteNotFoundError("HISTORY_FILE_MISSING", "Design history file is missing", {
      design_id: design.id,
      version,
      file: expectedPreviewFile
    });
  }
  return { version, previewFile: expectedPreviewFile };
}

async function getDesignReference(store: FormaStore, designId: string) {
  const reference = await findDesignReference(store, designId);
  if (!reference) {
    throw new RouteNotFoundError("DESIGN_NOT_FOUND", "Design not found", { design_id: designId });
  }
  return reference;
}

async function findDesignReference(store: FormaStore, designId: string) {
  const products = await store.products.listProducts();
  for (const product of products) {
    const requirements = await store.requirements.getRequirementHistory(product.id);
    for (const requirement of requirements) {
      const page = requirement.pages.find((item) => item.design_id === designId);
      if (page) {
        return {
          product_id: product.id,
          requirement_id: requirement.id,
          page_id: page.page_id
        };
      }
    }
  }
  return null;
}

function compareRequirementsNewestFirst(
  left: { id: string; created_at?: string; updated_at?: string },
  right: { id: string; created_at?: string; updated_at?: string }
): number {
  return timestampForRequirement(right) - timestampForRequirement(left) || left.id.localeCompare(right.id);
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

function safeStorePath(store: FormaStore, ...segments: string[]): string {
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
