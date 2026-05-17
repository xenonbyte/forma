export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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

function normalizeApiPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
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
