export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type Platform = "mobile" | "desktop" | "tablet" | "web";
export type RequirementStatus = "empty" | "submitted" | "active" | "archived";
export type DesignStatus = "pending" | "done" | "expired";

export interface StyleVariables {
  primary: string;
  background: string;
  "text-primary": string;
  "font-heading": string;
  "font-body": string;
  "border-radius": string;
  "spacing-unit": string;
}

export interface StyleMetadata {
  name: string;
  description: string;
  design_md_path: string;
  variables: StyleVariables;
}

export interface ProductIndexEntry {
  id: string;
  name: string;
  description: string;
}

export interface Product extends ProductIndexEntry {
  components_initialized?: boolean;
  platform?: Platform;
  style?: StyleMetadata;
}

export interface BaselineNavigation {
  from: string;
  label?: string;
  to: string;
}

export interface RequirementPage {
  baseline_page: string;
  copy?: string;
  design_id?: string;
  design_status: DesignStatus;
  features?: string;
  fields?: string;
  interactions?: string;
  name: string;
  page_id: string;
}

export interface RequirementWithDocument {
  created_at: string;
  document_md: string;
  id: string;
  navigation: BaselineNavigation[];
  pages: RequirementPage[];
  product_id: string;
  status: RequirementStatus;
  title: string;
  updated_at: string;
}

export interface CreateRequirementInput {
  document_md: string;
  navigation: BaselineNavigation[];
  pages: Array<Omit<RequirementPage, "design_status"> & { design_status?: DesignStatus }>;
  title: string;
}

export interface BaselinePage {
  copy: string;
  features: string;
  fields: string;
  id: string;
  interactions: string;
  name: string;
  source_requirements: string[];
}

export interface ProductBaseline {
  navigation: BaselineNavigation[];
  pages: BaselinePage[];
  product_id: string;
}

export interface StyleDetailPayload {
  designMd: string;
  metadata: StyleMetadata;
}

export interface StylePreviewPayload {
  image_url?: string;
  metadata?: StyleMetadata;
  name: string;
  preview_path?: string;
}

export interface FormaApiClient {
  archiveRequirement(productId: string, requirementId: string): Promise<RequirementWithDocument>;
  createProduct(input: Pick<ProductIndexEntry, "description" | "name">): Promise<Product>;
  createRequirement(productId: string, input: CreateRequirementInput): Promise<RequirementWithDocument>;
  getBaseline(productId: string): Promise<ProductBaseline>;
  getProduct(productId: string): Promise<Product>;
  getRequirement(productId: string, requirementId: string): Promise<RequirementWithDocument>;
  getStyle(name: string): Promise<StyleDetailPayload>;
  getStylePreview(name: string): Promise<StylePreviewPayload>;
  listProducts(): Promise<ProductIndexEntry[]>;
  listRequirements(productId: string): Promise<RequirementWithDocument[]>;
  listStyles(): Promise<StyleMetadata[]>;
}

export interface ApiRequestOptions {
  body?: unknown;
  fetcher?: Fetcher;
  headers?: HeadersInit;
  method?: string;
}

export class ApiError extends Error {
  readonly error_code: string;
  readonly details: Record<string, unknown>;
  readonly status: number;

  constructor(error_code: string, message: string, details: Record<string, unknown>, status: number) {
    super(message);
    this.name = "ApiError";
    this.error_code = error_code;
    this.details = details;
    this.status = status;
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body, fetcher = fetch, headers, method } = options;
  const requestHeaders = headersToRecord(headers);
  const init: RequestInit = {};

  if (method) {
    init.method = method;
  }

  if (body !== undefined) {
    if (!hasHeader(requestHeaders, "Content-Type")) {
      requestHeaders["Content-Type"] = "application/json";
    }
    init.body = JSON.stringify(body);
  }

  if (Object.keys(requestHeaders).length > 0) {
    init.headers = requestHeaders;
  }

  const response = await fetcher(normalizeApiPath(path), init);
  const payload = await parseJsonPayload(response);

  if (!response.ok) {
    throw toApiError(response, payload);
  }

  return payload as T;
}

export function createApiClient(fetcher?: Fetcher): FormaApiClient {
  return {
    archiveRequirement: (productId, requirementId) =>
      apiRecord<RequirementWithDocument>(`/api/products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}/archive`, {
        ...requestOptions(fetcher),
        method: "PUT"
      }),
    createProduct: (input) =>
      apiRecord<Product>("/api/products", {
        ...requestOptions(fetcher),
        body: input,
        method: "POST"
      }),
    createRequirement: (productId, input) =>
      apiRecord<RequirementWithDocument>(`/api/products/${encodeURIComponent(productId)}/requirements`, {
        ...requestOptions(fetcher),
        body: input,
        method: "POST"
      }),
    getBaseline: (productId) => apiRecord<ProductBaseline>(`/api/products/${encodeURIComponent(productId)}/baseline`, requestOptions(fetcher)),
    getProduct: (productId) => apiRecord<Product>(`/api/products/${encodeURIComponent(productId)}`, requestOptions(fetcher)),
    getRequirement: (productId, requirementId) =>
      apiRecord<RequirementWithDocument>(
        `/api/products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}`,
        requestOptions(fetcher)
      ),
    getStyle: (name) => apiRecord<StyleDetailPayload>(`/api/styles/${encodeURIComponent(name)}`, requestOptions(fetcher)),
    getStylePreview: (name) => apiRecord<StylePreviewPayload>(`/api/styles/${encodeURIComponent(name)}/preview`, requestOptions(fetcher)),
    listProducts: () => apiArray<ProductIndexEntry>("/api/products", requestOptions(fetcher)),
    listRequirements: (productId) =>
      apiArray<RequirementWithDocument>(`/api/products/${encodeURIComponent(productId)}/requirements`, requestOptions(fetcher)),
    listStyles: () => apiArray<StyleMetadata>("/api/styles", requestOptions(fetcher))
  };
}

export const apiClient = createApiClient();

export interface ApiErrorInfo {
  error_code: string;
  message: string;
  status?: number;
}

export function formatApiError(error: unknown): ApiErrorInfo {
  if (error instanceof ApiError) {
    return {
      error_code: error.error_code,
      message: error.message,
      status: error.status
    };
  }

  if (error instanceof Error) {
    return {
      error_code: "CLIENT_ERROR",
      message: error.message
    };
  }

  return {
    error_code: "CLIENT_ERROR",
    message: "Unexpected client error"
  };
}

function normalizeApiPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function requestOptions(fetcher: Fetcher | undefined): Pick<ApiRequestOptions, "fetcher"> {
  return fetcher ? { fetcher } : {};
}

async function apiArray<T>(path: string, options?: ApiRequestOptions): Promise<T[]> {
  const payload = await apiRequest<unknown>(path, options);
  if (!Array.isArray(payload)) {
    throw invalidResponseError();
  }

  return payload as T[];
}

async function apiRecord<T>(path: string, options?: ApiRequestOptions): Promise<T> {
  const payload = await apiRequest<unknown>(path, options);
  if (!isRecord(payload)) {
    throw invalidResponseError();
  }

  return payload as T;
}

function invalidResponseError(): ApiError {
  return new ApiError("INVALID_RESPONSE", "Invalid API response", {}, 502);
}

async function parseJsonPayload(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function toApiError(response: Response, payload: unknown): ApiError {
  if (isErrorPayload(payload)) {
    const details = isRecord(payload.details) ? payload.details : {};
    return new ApiError(payload.error_code, payload.message, details, response.status);
  }

  return new ApiError("HTTP_ERROR", response.statusText || `HTTP ${response.status}`, {}, response.status);
}

function isErrorPayload(payload: unknown): payload is {
  details: Record<string, unknown>;
  error_code: string;
  message: string;
} {
  if (!isRecord(payload)) {
    return false;
  }

  return typeof payload.error_code === "string" && typeof payload.message === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return { ...(headers as Record<string, string>) };
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((headerName) => headerName.toLowerCase() === name.toLowerCase());
}
