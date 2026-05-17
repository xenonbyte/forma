import { dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { createFormaStore, SubmitRequirementInput } from "@xenonbyte/forma-core";

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

  app.put<{ Params: { id: string; reqId: string } }>("/api/products/:id/requirements/:reqId/archive", async (request) =>
    store.requirements.archiveRequirement(request.params.reqId)
  );

  app.get<{ Params: { id: string; reqId: string } }>("/api/products/:id/requirements/:reqId", async (request) =>
    store.requirements.getRequirement({ requirement_id: request.params.reqId })
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
    const style = await store.styles.getStyle(request.params.name);
    const styleDir = dirname(style.metadata.design_md_path);
    return {
      name: request.params.name,
      preview_path: join(store.home, styleDir, "preview@2x.png"),
      image_url: `/api/styles/${encodeURIComponent(request.params.name)}/preview`,
      metadata: style.metadata
    };
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

    return {
      product_id: productId,
      baseline_page_id: pageId,
      requirement_id: requirement.id,
      requirement_page_id: requirementPage.page_id,
      design_id: requirementPage.design_id,
      image_url: `/api/designs/${requirementPage.design_id}/image`,
      preview_path: join(store.home, "data", productId, requirement.id, requirementPage.design_id, "preview@2x.png")
    };
  }

  return {
    product_id: productId,
    baseline_page_id: pageId,
    source_requirements: page.source_requirements,
    image_url: null,
    preview_path: null
  };
}

async function getDesignImageMetadata(store: FormaStore, designId: string, versionQuery: string | undefined) {
  const version = optionalPositiveIntegerQuery(versionQuery, "version");
  const reference = await findDesignReference(store, designId);
  const previewFile = version === undefined ? "preview@2x.png" : `preview.v${version}@2x.png`;

  return {
    design_id: designId,
    version: version ?? null,
    image_url: version === undefined ? `/api/designs/${designId}/image` : `/api/designs/${designId}/image?version=${version}`,
    preview_path: reference ? join(store.home, "data", reference.product_id, reference.requirement_id, designId, previewFile) : null
  };
}

async function getDesignHistoryMetadata(store: FormaStore, designId: string) {
  const reference = await findDesignReference(store, designId);
  return {
    design_id: designId,
    product_id: reference?.product_id ?? null,
    requirement_id: reference?.requirement_id ?? null,
    page_id: reference?.page_id ?? null,
    versions: reference ? [{ version: 1, image_url: `/api/designs/${designId}/image?version=1` }] : []
  };
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
