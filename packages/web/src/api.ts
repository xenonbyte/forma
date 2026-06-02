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

export interface StyleMetadata {
  name: string;
  description: string;
  category?: string;
  upstream?: string;
  design_md_path: string;
  tokens_css_path: string;
  components_html_path: string;
}

export interface SystemStyleMetadata {
  name: string;
  description: string;
  mode: "design-system";
  category?: string;
  upstream?: string;
}

/** getStyle 返回的三文件内容(对齐 core BrandStyleContent)。 */
export interface BrandStyleContent {
  kind: "brand";
  metadata: StyleMetadata;
  designMd: string;
  tokensCss: string;
  componentsHtml: string;
}

export interface ProductIndexEntry {
  id: string;
  name: string;
  description: string;
}

export interface Product extends ProductIndexEntry {
  default_language?: Language;
  languages?: Language[];
  platform?: Platform;
  brand_style?: string;
  system_style?: string;
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
  design_status: DesignStatus;
  declared_actions?: SemanticContractItem[];
  declared_component_keys?: string[];
  declared_fields?: SemanticContractItem[];
  features?: string;
  fields?: string;
  interactions?: string;
  name: string;
  page_id: string;
  semantic_contract?: SemanticContract;
  semantic_contract_coverage?: "explicit" | "minimal";
}

export interface SemanticContractItem {
  key: string;
  label: string;
}

export interface SemanticContract {
  actions: SemanticContractItem[];
  allowed_copy: string[];
  component_keys: string[];
  fields: SemanticContractItem[];
  navigation: Array<{ target_page_id: string; label?: string }>;
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
  brand_style: string;
  system_style?: string;
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
  semantic_contract?: SemanticContract;
  semantic_contract_coverage?: "explicit" | "minimal";
  source_requirements: string[];
}

export interface ProductBaseline {
  navigation: BaselineNavigation[];
  pages: BaselinePage[];
  product_id: string;
}


export interface ArtifactSummary {
  id: string;
  /** 归一 kind:"design-page" | "component-library"。 */
  kind: string;
  title: string;
  preview_url?: string;
  updated_at: string;
  source_skill_id?: string;
  requirement_id?: string;
  /** design-page only — 分组键。 */
  page_id?: string;
  /** design-page only — 变体,缺省 "default"。 */
  variant?: string;
  /** 当前版本指针的版本号;legacy flat artifact 无此字段。 */
  current_version?: number;
  superseded: boolean;
}

export interface ArtifactDetail {
  manifest: {
    id: string;
    kind: string;
    title: string;
    entry: string;
    supportingFiles?: string[];
    status: string;
    exports: string[];
    requirementId?: string;
  };
  preview_url?: string;
}

export interface RequirementDesignHistoryEntry {
  audit_link?: string;
  created_at?: string;
  file?: string;
  session_id?: string;
  version?: number;
}

export interface RequirementDesignDiff {
  changed: boolean;
  from_canvas_version?: number;
  from_hash?: string;
  to_canvas_version?: number;
  to_hash?: string;
}

export interface RequirementDesignAssetExport {
  path: string;
  revision: string;
}

export interface ArchiveIconsResult {
  pages: unknown[];
  totalIcons: number;
}

export interface ArchiveVziResult {
  pages: unknown[];
}

export interface ArchiveRequirementResult {
  requirement: RequirementWithDocument;
  icons: ArchiveIconsResult;
  vzi: ArchiveVziResult;
}

export type RequirementDesignOperationIntent =
  | "generate"
  | "refine"
  | "rebuild"
  | "rollback"
  | "component_refresh"
  | "quality_repair"
  | "import_metadata_normalization";

export interface RequirementDesignOperationInput {
  args: Record<string, unknown>;
  intent: RequirementDesignOperationIntent;
  target_node_ids?: string[];
  tool: "batch_design";
}

export interface RequirementDesignSessionResult {
  [key: string]: unknown;
  session_id: string;
  status?: string;
}

export interface ComponentSeedInput {
  component_key: string;
  name?: string;
  required_by?: Array<{ page_id?: string; requirement_id: string }>;
  semantic_contract_hash?: string;
  source?: string;
}

export interface ProductComponentOperationInput {
  args: Record<string, unknown>;
  intent: string;
  target_node_ids?: string[];
  tool: "batch_design" | "set_variables";
}

export interface FormaApiClient {
  archiveRequirement(productId: string, requirementId: string): Promise<ArchiveRequirementResult>;
  applyProductComponentOperations(productId: string, sessionId: string, input: { operations: ProductComponentOperationInput[] }): Promise<RequirementDesignSessionResult>;
  applyRequirementDesignOperations(productId: string, requirementId: string, sessionId: string, input: { operations: RequirementDesignOperationInput[] }): Promise<RequirementDesignSessionResult>;
  beginProductComponentSession(productId: string, input: {
    newly_required_component_keys?: string[];
    operation: "generate" | "refine" | "change_style";
    seed_components?: ComponentSeedInput[];
  }): Promise<RequirementDesignSessionResult>;
  beginRequirementDesignSession(productId: string, requirementId: string, input: {
    operation: "generate" | "refine" | "rebuild" | "rollback" | "component_refresh";
    page_id?: string;
  }): Promise<RequirementDesignSessionResult>;
  commitProductComponentSession(productId: string, sessionId: string): Promise<RequirementDesignSessionResult>;
  commitRequirementDesignSession(productId: string, requirementId: string, sessionId: string, input: {
    frame_id?: string;
    page_id?: string;
    quality_report?: Record<string, unknown>;
  }): Promise<RequirementDesignSessionResult>;
  configureProduct(productId: string, input: ProductConfigInput): Promise<Product>;
  createEmptyRequirement(productId: string, input: CreateEmptyRequirementInput): Promise<Requirement>;
  createProduct(input: Pick<ProductIndexEntry, "description" | "name">): Promise<Product>;
  createRequirement(productId: string, input: CreateRequirementInput): Promise<RequirementWithDocument>;
  deleteProduct(productId: string, input: { confirm_product_id: string }): Promise<DeleteProductResult>;
  discardProductComponentSession(productId: string, sessionId: string): Promise<RequirementDesignSessionResult>;
  discardRequirementDesignSession(productId: string, requirementId: string, sessionId: string): Promise<RequirementDesignSessionResult>;
  exportRequirementDesignAsset(productId: string, requirementId: string, input: { format?: string; node_id: string }): Promise<RequirementDesignAssetExport>;
  getArtifactPreviewUrl(productId: string, artifactId: string, resolution: "1x" | "2x"): string;
  getBaseline(productId: string): Promise<ProductBaseline>;
  getPageCopy(productId: string, pageId: string, requirementId?: string): Promise<PageCopyPayload>;
  getProduct(productId: string): Promise<Product>;
  getProductArtifact(productId: string, artifactId: string): Promise<ArtifactDetail>;
  getRequirement(productId: string, requirementId: string): Promise<RequirementWithDocument>;
  getRequirementDesignDiff(productId: string, requirementId: string, input: { from_page_version: number; page_id?: string; to_page_version: number }): Promise<RequirementDesignDiff>;
  getRequirementDesignHistory(productId: string, requirementId: string, pageId?: string): Promise<RequirementDesignHistoryEntry[]>;
  getStyle(name: string): Promise<BrandStyleContent>;
  listProductArtifacts(productId: string, kind?: string, include_superseded?: boolean): Promise<{ artifacts: ArtifactSummary[] }>;
  listProducts(): Promise<ProductIndexEntry[]>;
  listRequirements(productId: string): Promise<RequirementWithDocument[]>;
  listStyles(): Promise<StyleMetadata[]>;
  listSystemStyles(): Promise<SystemStyleMetadata[]>;
  planImportMetadataNormalization(productId: string, requirementId: string, sessionId: string, input: { frame_id: string; page_id: string }): Promise<RequirementDesignSessionResult>;
  planRequirementComponentRefresh(productId: string, requirementId: string, sessionId: string, input: { scope?: "all_pages" | { component_keys?: string[]; page_ids?: string[] }; version?: "latest" | number }): Promise<RequirementDesignSessionResult>;
  planRequirementDesignRollback(productId: string, requirementId: string, sessionId: string, input: { canvas_version: number }): Promise<RequirementDesignSessionResult>;
  recoverDesignCommitJournal(productId: string, sessionId: string, input: { scope: "requirement_canvas" | "product_component_library" }): Promise<RequirementDesignSessionResult>;
  saveRequirement(productId: string, requirementId: string, input: SaveRequirementInput): Promise<RequirementWithDocument>;
  validateRequirementDesignQuality(productId: string, requirementId: string, sessionId: string, input: { frame_id: string; page_id: string }): Promise<RequirementDesignSessionResult>;
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
      apiRecord<ArchiveRequirementResult>(`/api/products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}/archive`, {
        ...requestOptions(fetcher),
        method: "PUT"
      }),
    applyProductComponentOperations: (productId, sessionId, input) =>
      apiRecord<RequirementDesignSessionResult>(`${productComponentSessionPath(productId, sessionId)}/operations`, {
        ...requestOptions(fetcher),
        body: input,
        method: "POST"
      }),
    applyRequirementDesignOperations: (productId, requirementId, sessionId, input) =>
      apiRecord<RequirementDesignSessionResult>(`${requirementDesignSessionPath(productId, requirementId, sessionId)}/operations`, {
        ...requestOptions(fetcher),
        body: input,
        method: "POST"
      }),
    beginProductComponentSession: (productId, input) =>
      apiRecord<RequirementDesignSessionResult>(`${productComponentPath(productId)}/session/begin`, {
        ...requestOptions(fetcher),
        body: input,
        method: "POST"
      }),
    beginRequirementDesignSession: (productId, requirementId, input) =>
      apiRecord<RequirementDesignSessionResult>(`${requirementDesignPath(productId, requirementId)}/session/begin`, {
        ...requestOptions(fetcher),
        body: input,
        method: "POST"
      }),
    commitProductComponentSession: (productId, sessionId) =>
      apiRecord<RequirementDesignSessionResult>(`${productComponentSessionPath(productId, sessionId)}/commit`, {
        ...requestOptions(fetcher),
        method: "POST"
      }),
    commitRequirementDesignSession: (productId, requirementId, sessionId, input) =>
      apiRecord<RequirementDesignSessionResult>(`${requirementDesignSessionPath(productId, requirementId, sessionId)}/commit`, {
        ...requestOptions(fetcher),
        body: input,
        method: "POST"
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
    discardProductComponentSession: (productId, sessionId) =>
      apiRecord<RequirementDesignSessionResult>(`${productComponentSessionPath(productId, sessionId)}/discard`, {
        ...requestOptions(fetcher),
        method: "POST"
      }),
    discardRequirementDesignSession: (productId, requirementId, sessionId) =>
      apiRecord<RequirementDesignSessionResult>(`${requirementDesignSessionPath(productId, requirementId, sessionId)}/discard`, {
        ...requestOptions(fetcher),
        method: "POST"
      }),
    exportRequirementDesignAsset: (productId, requirementId, input) =>
      apiRecord<RequirementDesignAssetExport>(
        `${requirementDesignPath(productId, requirementId)}/export?${new URLSearchParams({
          node_id: input.node_id,
          ...(input.format ? { format: input.format } : {})
        }).toString()}`,
        requestOptions(fetcher)
      ),
    getArtifactPreviewUrl: (productId, artifactId, resolution) =>
      `/api/products/${encodeURIComponent(productId)}/artifacts/${encodeURIComponent(artifactId)}/preview/${resolution}`,
    getBaseline: (productId) => apiRecord<ProductBaseline>(`/api/products/${encodeURIComponent(productId)}/baseline`, requestOptions(fetcher)),
    getPageCopy: (productId, pageId, requirementId) => {
      const query = requirementId ? `?${new URLSearchParams({ requirement_id: requirementId }).toString()}` : "";
      return apiRecord<PageCopyPayload>(
        `/api/products/${encodeURIComponent(productId)}/baseline/pages/${encodeURIComponent(pageId)}/copy${query}`,
        requestOptions(fetcher)
      );
    },
    getProduct: (productId) => apiRecord<Product>(`/api/products/${encodeURIComponent(productId)}`, requestOptions(fetcher)),
    getProductArtifact: (productId, artifactId) =>
      apiRecord<ArtifactDetail>(`/api/products/${encodeURIComponent(productId)}/artifacts/${encodeURIComponent(artifactId)}`, requestOptions(fetcher)),
    getRequirement: (productId, requirementId) =>
      apiRecord<RequirementWithDocument>(
        `/api/products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}`,
        requestOptions(fetcher)
      ),
    getRequirementDesignDiff: (productId, requirementId, input) =>
      apiRecord<RequirementDesignDiff>(
        `${requirementDesignPath(productId, requirementId)}/diff?${new URLSearchParams({
          ...(input.page_id ? { page_id: input.page_id } : {}),
          from_page_version: String(input.from_page_version),
          to_page_version: String(input.to_page_version)
        }).toString()}`,
        requestOptions(fetcher)
      ),
    getRequirementDesignHistory: (productId, requirementId, pageId) => {
      const query = pageId ? `?${new URLSearchParams({ page_id: pageId }).toString()}` : "";
      return apiArray<RequirementDesignHistoryEntry>(`${requirementDesignPath(productId, requirementId)}/history${query}`, requestOptions(fetcher));
    },
    getStyle: (name) => apiRecord<BrandStyleContent>(`/api/styles/${encodeURIComponent(name)}`, requestOptions(fetcher)),
    listProductArtifacts: (productId, kind, include_superseded) => {
      const basePath = `/api/products/${encodeURIComponent(productId)}/artifacts`;
      const params = new URLSearchParams();
      if (kind) params.set("kind", kind);
      if (include_superseded) params.set("include_superseded", "true");
      const query = params.size > 0 ? `?${params.toString()}` : "";
      return apiRecord<{ artifacts: ArtifactSummary[] }>(`${basePath}${query}`, requestOptions(fetcher));
    },
    listProducts: () => apiArray<ProductIndexEntry>("/api/products", requestOptions(fetcher)),
    listRequirements: (productId) =>
      apiArray<RequirementWithDocument>(`/api/products/${encodeURIComponent(productId)}/requirements`, requestOptions(fetcher)),
    listStyles: () => apiArray<StyleMetadata>("/api/styles", requestOptions(fetcher)),
    listSystemStyles: () => apiArray<SystemStyleMetadata>("/api/system-styles", requestOptions(fetcher)),
    planImportMetadataNormalization: (productId, requirementId, sessionId, input) =>
      apiRecord<RequirementDesignSessionResult>(`${requirementDesignSessionPath(productId, requirementId, sessionId)}/import-metadata-normalization/plan`, {
        ...requestOptions(fetcher),
        body: input,
        method: "POST"
      }),
    planRequirementComponentRefresh: (productId, requirementId, sessionId, input) =>
      apiRecord<RequirementDesignSessionResult>(`${requirementDesignSessionPath(productId, requirementId, sessionId)}/component-refresh/plan`, {
        ...requestOptions(fetcher),
        body: input,
        method: "POST"
      }),
    planRequirementDesignRollback: (productId, requirementId, sessionId, input) =>
      apiRecord<RequirementDesignSessionResult>(`${requirementDesignSessionPath(productId, requirementId, sessionId)}/rollback/plan`, {
        ...requestOptions(fetcher),
        body: input,
        method: "POST"
      }),
    recoverDesignCommitJournal: (productId, sessionId, input) =>
      apiRecord<RequirementDesignSessionResult>(
        `/api/products/${encodeURIComponent(productId)}/design/session/${encodeURIComponent(sessionId)}/recover-commit-journal`,
        {
          ...requestOptions(fetcher),
          body: input,
          method: "POST"
        }
      ),
    saveRequirement: (productId, requirementId, input) =>
      apiRecord<RequirementWithDocument>(`/api/products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}/save`, {
        ...requestOptions(fetcher),
        body: input,
        method: "POST"
      }),
    validateRequirementDesignQuality: (productId, requirementId, sessionId, input) =>
      apiRecord<RequirementDesignSessionResult>(`${requirementDesignSessionPath(productId, requirementId, sessionId)}/quality`, {
        ...requestOptions(fetcher),
        body: input,
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

function requirementDesignPath(productId: string, requirementId: string): string {
  return `/api/products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}/design`;
}

function requirementDesignSessionPath(productId: string, requirementId: string, sessionId: string): string {
  return `${requirementDesignPath(productId, requirementId)}/session/${encodeURIComponent(sessionId)}`;
}

function productComponentPath(productId: string): string {
  return `/api/products/${encodeURIComponent(productId)}/component-library`;
}

function productComponentSessionPath(productId: string, sessionId: string): string {
  return `${productComponentPath(productId)}/session/${encodeURIComponent(sessionId)}`;
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
