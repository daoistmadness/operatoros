export type ApiErrorKind =
  | "authentication"
  | "authorization"
  | "validation"
  | "conflict"
  | "not_found"
  | "rate_limit"
  | "network"
  | "timeout"
  | "cancelled"
  | "server"
  | "contract"
  | "unknown";

export type ApiHeaders = Record<string, string>;
export type FieldErrors = Readonly<Record<string, readonly string[]>>;

const MAX_MESSAGE_LENGTH = 320;
const SAFE_FALLBACK = "The request could not be completed. Please try again.";

const STATUS_KIND: Readonly<Record<number, ApiErrorKind>> = {
  400: "validation",
  401: "authentication",
  403: "authorization",
  404: "not_found",
  405: "not_found",
  409: "conflict",
  422: "validation",
  429: "rate_limit",
};

const SAFE_STATUS_MESSAGES: Readonly<Partial<Record<ApiErrorKind, string>>> = {
  authentication: "Your session has expired. Sign in again and retry.",
  authorization: "Your account does not have permission to perform this action.",
  not_found: "The requested resource was not found. Refresh the page or contact the system administrator.",
  rate_limit: "Too many requests were sent. Wait briefly and try again.",
  server: "The server could not complete the request. Retry or contact the system administrator if the problem persists.",
  network: "The server could not be reached. Check the connection and try again.",
  timeout: "The request took too long. Please try again.",
  contract: "The server returned an unexpected response. Refresh and try again.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeText(value: unknown, fallback = SAFE_FALLBACK): string {
  if (typeof value !== "string") return fallback;
  let text = value
    .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, "[credential removed]")
    .replace(/(password|token|cookie|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[removed]")
    .replace(/[a-z]:\\(?:[^\\\r\n]+\\)+[^\\\r\n]*/gi, "[local path removed]")
    .replace(/\/(?:home|users|tmp|var|etc)\/[^\s"'<>]+/gi, "[local path removed]")
    .replace(/\b(?:select|insert|update|delete|drop|alter)\b[\s\S]*?\b(?:from|into|table|where)\b[\s\S]*/gi, "[internal query removed]")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+at\s+\S+\s+\([^)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) text = fallback;
  return text.length > MAX_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1).trimEnd()}…`
    : text;
}

function classifyStatus(status: number | null): ApiErrorKind {
  if (status == null || status === 0) return "unknown";
  if (STATUS_KIND[status]) return STATUS_KIND[status];
  if (status >= 500) return "server";
  if (status >= 400) return "validation";
  return "unknown";
}

function isRetryable(kind: ApiErrorKind): boolean {
  return kind === "network" || kind === "timeout" || kind === "server" || kind === "rate_limit";
}

function parseValidationDetail(value: unknown): FieldErrors | null {
  if (!Array.isArray(value)) return null;
  const result: Record<string, string[]> = {};
  for (const item of value) {
    if (!isRecord(item) || !Array.isArray(item.loc) || typeof item.msg !== "string") continue;
    const field = item.loc.filter((part) => typeof part === "string" || typeof part === "number").join(".");
    if (!field) continue;
    (result[field] ??= []).push(sanitizeText(item.msg, "Invalid value."));
  }
  return Object.keys(result).length ? result : null;
}

function extractPayload(error: unknown): {
  status: number | null;
  data: unknown;
  headers: ApiHeaders;
  message: unknown;
} {
  if (!isRecord(error)) return { status: null, data: null, headers: {}, message: null };
  const response = isRecord(error.response) ? error.response : {};
  const rawStatus = error.status ?? response.status;
  const status = typeof rawStatus === "number" && Number.isFinite(rawStatus) ? rawStatus : null;
  const data = error.data ?? response.data ?? null;
  const headers = isRecord(error.headers) ? error.headers as ApiHeaders : {};
  return { status, data, headers, message: error.message };
}

function payloadMessage(data: unknown): unknown {
  if (!isRecord(data)) return null;
  if (typeof data.detail === "string") return data.detail;
  if (typeof data.message === "string") return data.message;
  return null;
}

function payloadCode(data: unknown): string | null {
  if (!isRecord(data)) return null;
  if (isRecord(data.detail) && typeof data.detail.code === "string") return sanitizeText(data.detail.code, "").slice(0, 80) || null;
  return typeof data.code === "string" ? sanitizeText(data.code, "").slice(0, 80) || null : null;
}

function requestId(headers: ApiHeaders, data: unknown): string | null {
  const headerValue = headers["x-request-id"] || headers["x-correlation-id"];
  if (headerValue) return sanitizeText(headerValue, "").slice(0, 128) || null;
  if (isRecord(data) && typeof data.request_id === "string") {
    return sanitizeText(data.request_id, "").slice(0, 128) || null;
  }
  return null;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly retryable: boolean;
  readonly requestId: string | null;
  readonly fieldErrors: FieldErrors | null;
  readonly data: unknown;
  readonly headers: ApiHeaders;
  readonly url: string;
  readonly response: { data: unknown; status: number; headers: ApiHeaders };
  override readonly cause?: unknown;

  constructor(message: string, options: {
    kind?: ApiErrorKind;
    status?: number | null;
    code?: string | null;
    retryable?: boolean;
    requestId?: string | null;
    fieldErrors?: FieldErrors | null;
    data?: unknown;
    headers?: ApiHeaders;
    url?: string;
    cause?: unknown;
  } = {}) {
    const status = options.status ?? null;
    const kind = options.kind ?? classifyStatus(status);
    super(sanitizeText(message, SAFE_STATUS_MESSAGES[kind] ?? SAFE_FALLBACK));
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.code = options.code ?? payloadCode(options.data);
    this.retryable = options.retryable ?? isRetryable(kind);
    this.requestId = options.requestId ?? requestId(options.headers ?? {}, options.data);
    this.fieldErrors = options.fieldErrors ?? (
      isRecord(options.data) ? parseValidationDetail(options.data.detail) : null
    );
    this.data = options.data ?? null;
    this.headers = options.headers ?? {};
    this.url = options.url ?? "";
    this.response = { data: this.data, status: status ?? 0, headers: this.headers };
    this.cause = options.cause;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function normalizeApiError(error: unknown, fallbackMessage = SAFE_FALLBACK): ApiError {
  if (isApiError(error)) return error;

  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (isRecord(error) && error.name === "AbortError")
  ) {
    return new ApiError("Request cancelled.", { kind: "cancelled", retryable: false, cause: error });
  }

  const { status, data, headers, message } = extractPayload(error);
  let kind = classifyStatus(status);
  if (status == null && error instanceof Error) {
    const lowered = error.message.toLowerCase();
    if (lowered.includes("timeout") || lowered.includes("timed out")) kind = "timeout";
    else if (lowered.includes("network") || lowered.includes("failed to fetch")) kind = "network";
  }

  const safeDefault = SAFE_STATUS_MESSAGES[kind] ?? fallbackMessage;
  const detail = payloadMessage(data);
  const userMessage = kind === "server" || kind === "authentication" || kind === "authorization" || kind === "not_found"
    ? safeDefault
    : sanitizeText(detail ?? message, safeDefault);

  return new ApiError(userMessage, {
    kind,
    status,
    data,
    headers,
    code: payloadCode(data),
    requestId: requestId(headers, data),
    fieldErrors: isRecord(data) ? parseValidationDetail(data.detail) : null,
    cause: error,
  });
}

export function getApiErrorMessage(error: unknown, fallbackMessage = SAFE_FALLBACK): string {
  const normalized = normalizeApiError(error, fallbackMessage);
  return normalized.kind === "cancelled" ? "" : normalized.message;
}

export function getPageApiError(error: unknown, fallback: string): string {
  return getApiErrorMessage(error, fallback) || fallback;
}

export function isCancelledApiError(error: unknown): boolean {
  return normalizeApiError(error).kind === "cancelled";
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const normalized = normalizeApiError(error);
  return normalized.retryable && normalized.kind !== "cancelled" && failureCount < 1;
}
