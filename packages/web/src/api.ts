import type { AnnotationNode, DesignDiff, ExportedDesignAsset } from "@xenonbyte/forma-core";

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type Platform = "mobile" | "desktop" | "tablet" | "web";
export type Language = "zh-CN" | "zh-TW" | "en" | "ja" | "ko" | "pt" | "fr" | "de" | "ru";
export type RequirementStatus = "empty" | "submitted" | "active" | "archived";
export type DesignStatus = "pending" | "done" | "expired";
export type RequirementChangeType = "new" | "patch" | "rebuild";

export const languageLabels: Record<Language, string> = {
  "zh-CN": "Chinese (Simplified)",
  "zh-TW": "Chinese (Traditional)",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  ru: "Russian"
};

export const languageOptions: Array<{ label: string; value: Language }> = (Object.keys(languageLabels) as Language[]).map((value) => ({
  label: languageLabels[value],
  value
}));

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
  default_language?: Language;
  languages?: Language[];
  platform?: Platform;
  style?: StyleMetadata;
}

export interface DeleteProductResult {
  product_id: string;
  deleted: true;
  session_cleared: boolean;
  cleanup_pending: boolean;
  recovery_warnings: string[];
}

export interface BaselineNavigation {
  from: string;
  label?: string;
  to: string;
}

export interface CopyItem {
  context: string;
  text: string;
}

export interface TranslationEntry {
  context: string;
  outdated?: boolean;
  texts: Record<string, string>;
}

export interface PageTranslation {
  entries: TranslationEntry[];
  page_id: string;
}

export interface PageCopyPayload {
  default_language_copy: CopyItem[];
  page_id: string;
  translations: TranslationEntry[];
}

export interface RequirementPage {
  baseline_page: string;
  change_summary?: string;
  change_type?: RequirementChangeType;
  copy?: CopyItem[];
  design_id?: string;
  design_status: DesignStatus;
  features?: string;
  fields?: string;
  interactions?: string;
  name: string;
  page_id: string;
}

export interface Requirement {
  created_at: string;
  id: string;
  navigation: BaselineNavigation[];
  pages: RequirementPage[];
  product_id: string;
  status: RequirementStatus;
  title: string;
  ui_affected?: boolean;
  updated_at: string;
}

export interface RequirementWithDocument extends Requirement {
  document_md: string;
}

export interface ProductConfigInput {
  default_language: Language;
  languages: Language[];
  platform: Platform;
  style: string;
}

export interface CreateEmptyRequirementInput {
  title: string;
}

export interface CreateRequirementPageInput extends Omit<SaveRequirementPageInput, "change_type"> {
  change_type?: RequirementChangeType;
}

export interface CreateRequirementInput {
  document_md: string;
  navigation: BaselineNavigation[];
  pages: CreateRequirementPageInput[];
  remove_page_ids?: string[];
  remove_rule_ids?: string[];
  rules?: RequirementRuleInput[];
  title: string;
  translations?: PageTranslation[];
  ui_affected?: boolean;
}

export interface SaveRequirementPageInput {
  baseline_page: string;
  change_summary?: string;
  change_type: RequirementChangeType;
  copy?: CopyItem[];
  features?: string;
  fields?: string;
  interactions?: string;
  name: string;
  page_id: string;
}

export interface RequirementRuleInput {
  given: string;
  id: string;
  page_id?: string;
  replaces_rule_id?: string;
  then: string;
  when: string;
}

export interface SaveRequirementInput {
  document_md: string;
  navigation?: BaselineNavigation[];
  pages?: SaveRequirementPageInput[];
  remove_page_ids?: string[];
  remove_rule_ids?: string[];
  rules?: RequirementRuleInput[];
  translations?: PageTranslation[];
  ui_affected?: boolean;
}

export interface BaselinePage {
  copy: CopyItem[];
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

export type SyncPhase = "git_clone" | "scanning" | "extracting_variables" | "rendering_previews" | "updating_index" | "cleanup";

export type SyncStatusPayload =
  | {
      last_sync?: {
        completed_at: string;
        duration_ms: number;
        styles_added: number;
        styles_failed: number;
        styles_total: number;
        styles_updated: number;
      };
      status: "idle";
    }
  | {
      progress: { current: number; current_style?: string; phase: SyncPhase; total: number };
      started_at: string;
      status: "running";
      task_id: string;
    }
  | {
      error: { message: string; phase: SyncPhase };
      status: "failed";
      task_id?: string;
    };

export interface SyncStartedPayload {
  message: string;
  status: "running";
  task_id: string;
}

export interface DesignHistoryVersion {
  created_at: string;
  current: boolean;
  file: string;
  image_url: string;
  preview_file?: string;
  version: number;
}

export interface DesignHistoryPayload {
  current_version: number;
  design_id: string;
  page_id: string;
  product_id: string;
  requirement_id: string;
  versions: DesignHistoryVersion[];
}

export interface DesignImageMetadata {
  design_id: string;
  image_url: string;
  preview_path: string;
  version: number;
}

export interface DesignDiffPayload extends DesignDiff {
  visual: {
    from_image_url: string;
    to_image_url: string;
  };
}

export type DesignExportFormat = ExportedDesignAsset["format"];
export type DesignExportPayload = ExportedDesignAsset;
export type { AnnotationNode, DesignDiff };

export interface FormaApiClient {
  archiveRequirement(productId: string, requirementId: string): Promise<RequirementWithDocument>;
  configureProduct(productId: string, input: ProductConfigInput): Promise<Product>;
  createEmptyRequirement(productId: string, input: CreateEmptyRequirementInput): Promise<Requirement>;
  createProduct(input: Pick<ProductIndexEntry, "description" | "name">): Promise<Product>;
  createRequirement(productId: string, input: CreateRequirementInput): Promise<RequirementWithDocument>;
  deleteProduct(productId: string, input: { confirm_product_id: string }): Promise<DeleteProductResult>;
  exportDesignAsset(designId: string, nodeId: string, format: DesignExportFormat): Promise<DesignExportPayload>;
  getBaseline(productId: string): Promise<ProductBaseline>;
  getDesignAnnotations(designId: string): Promise<AnnotationNode[]>;
  getDesignDiff(designId: string, fromVersion: number, toVersion: number): Promise<DesignDiffPayload>;
  getDesignHistory(designId: string): Promise<DesignHistoryPayload>;
  getDesignImage(designId: string, version?: number): Promise<DesignImageMetadata>;
  getPageCopy(productId: string, pageId: string, requirementId?: string): Promise<PageCopyPayload>;
  getProduct(productId: string): Promise<Product>;
  getRequirement(productId: string, requirementId: string): Promise<RequirementWithDocument>;
  getStyle(name: string): Promise<StyleDetailPayload>;
  getStylePreview(name: string): Promise<StylePreviewPayload>;
  getSyncStatus(): Promise<SyncStatusPayload>;
  listProducts(): Promise<ProductIndexEntry[]>;
  listRequirements(productId: string): Promise<RequirementWithDocument[]>;
  listStyles(): Promise<StyleMetadata[]>;
  saveRequirement(productId: string, requirementId: string, input: SaveRequirementInput): Promise<RequirementWithDocument>;
  syncStyles(): Promise<SyncStartedPayload>;
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
    configureProduct: (productId, input) =>
      apiRecord<Product>(`/api/products/${encodeURIComponent(productId)}/config`, {
        ...requestOptions(fetcher),
        body: input,
        method: "POST"
      }),
    createEmptyRequirement: (productId, input) =>
      apiRecord<Requirement>(`/api/products/${encodeURIComponent(productId)}/requirements`, {
        ...requestOptions(fetcher),
        body: input,
        method: "POST"
      }),
    createProduct: (input) =>
      apiRecord<Product>("/api/products", {
        ...requestOptions(fetcher),
        body: input,
        method: "POST"
      }),
    createRequirement: async (productId, input) => {
      const encodedProductId = encodeURIComponent(productId);
      const created = await apiRecord<Requirement>(`/api/products/${encodedProductId}/requirements`, {
        ...requestOptions(fetcher),
        body: { title: input.title },
        method: "POST"
      });
      const saveInput = {
        document_md: input.document_md,
        navigation: input.navigation,
        pages: input.pages.map(normalizeCreateRequirementPage),
        ...(input.remove_page_ids ? { remove_page_ids: input.remove_page_ids } : {}),
        ...(input.remove_rule_ids ? { remove_rule_ids: input.remove_rule_ids } : {}),
        ...(input.rules ? { rules: input.rules } : {}),
        ...(input.translations ? { translations: input.translations } : {}),
        ui_affected: input.ui_affected ?? true
      };

      return apiRecord<RequirementWithDocument>(
        `/api/products/${encodedProductId}/requirements/${encodeURIComponent(created.id)}/save`,
        {
          ...requestOptions(fetcher),
          body: saveInput,
          method: "POST"
        }
      );
    },
    deleteProduct: (productId, input) =>
      apiRecord<DeleteProductResult>(`/api/products/${encodeURIComponent(productId)}`, {
        ...requestOptions(fetcher),
        body: { confirm_product_id: input.confirm_product_id },
        method: "DELETE"
      }),
    exportDesignAsset: (designId, nodeId, format) =>
      apiRecord<DesignExportPayload>(
        `/api/designs/${encodeURIComponent(designId)}/export?${new URLSearchParams({ node_id: nodeId, format }).toString()}`,
        requestOptions(fetcher)
      ),
    getBaseline: (productId) => apiRecord<ProductBaseline>(`/api/products/${encodeURIComponent(productId)}/baseline`, requestOptions(fetcher)),
    getDesignAnnotations: (designId) =>
      apiArray<AnnotationNode>(`/api/designs/${encodeURIComponent(designId)}/annotations`, requestOptions(fetcher)),
    getDesignDiff: (designId, fromVersion, toVersion) =>
      apiRecord<DesignDiffPayload>(
        `/api/designs/${encodeURIComponent(designId)}/diff?${new URLSearchParams({
          v1: String(fromVersion),
          v2: String(toVersion)
        }).toString()}`,
        requestOptions(fetcher)
      ),
    getDesignHistory: (designId) => apiRecord<DesignHistoryPayload>(`/api/designs/${encodeURIComponent(designId)}/history`, requestOptions(fetcher)),
    getDesignImage: (designId, version) => {
      const query = version === undefined ? "" : `?${new URLSearchParams({ version: String(version) }).toString()}`;
      return apiRecord<DesignImageMetadata>(`/api/designs/${encodeURIComponent(designId)}/image${query}`, requestOptions(fetcher));
    },
    getPageCopy: (productId, pageId, requirementId) => {
      const query = requirementId ? `?${new URLSearchParams({ requirement_id: requirementId }).toString()}` : "";
      return apiRecord<PageCopyPayload>(
        `/api/products/${encodeURIComponent(productId)}/baseline/pages/${encodeURIComponent(pageId)}/copy${query}`,
        requestOptions(fetcher)
      );
    },
    getProduct: (productId) => apiRecord<Product>(`/api/products/${encodeURIComponent(productId)}`, requestOptions(fetcher)),
    getRequirement: (productId, requirementId) =>
      apiRecord<RequirementWithDocument>(
        `/api/products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}`,
        requestOptions(fetcher)
      ),
    getStyle: (name) => apiRecord<StyleDetailPayload>(`/api/styles/${encodeURIComponent(name)}`, requestOptions(fetcher)),
    getStylePreview: (name) => apiRecord<StylePreviewPayload>(`/api/styles/${encodeURIComponent(name)}/preview`, requestOptions(fetcher)),
    getSyncStatus: () => apiRecord<SyncStatusPayload>("/api/styles/sync/status", requestOptions(fetcher)),
    listProducts: () => apiArray<ProductIndexEntry>("/api/products", requestOptions(fetcher)),
    listRequirements: (productId) =>
      apiArray<RequirementWithDocument>(`/api/products/${encodeURIComponent(productId)}/requirements`, requestOptions(fetcher)),
    listStyles: () => apiArray<StyleMetadata>("/api/styles", requestOptions(fetcher)),
    saveRequirement: (productId, requirementId, input) =>
      apiRecord<RequirementWithDocument>(`/api/products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}/save`, {
        ...requestOptions(fetcher),
        body: input,
        method: "POST"
      }),
    syncStyles: () =>
      apiRecord<SyncStartedPayload>("/api/styles/sync", {
        ...requestOptions(fetcher),
        method: "POST"
      })
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

function normalizeCreateRequirementPage(page: CreateRequirementPageInput): SaveRequirementPageInput {
  const next: SaveRequirementPageInput = {
    baseline_page: page.baseline_page,
    change_type: page.change_type ?? "new",
    name: page.name,
    page_id: page.page_id
  };

  if (page.change_summary !== undefined) {
    next.change_summary = page.change_summary;
  }
  if (page.copy !== undefined) {
    next.copy = page.copy;
  }
  if (page.features !== undefined) {
    next.features = page.features;
  }
  if (page.fields !== undefined) {
    next.fields = page.fields;
  }
  if (page.interactions !== undefined) {
    next.interactions = page.interactions;
  }

  return next;
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
