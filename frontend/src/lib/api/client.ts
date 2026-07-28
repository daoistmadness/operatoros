// client.js
// HTTP API client — configurable base URL, no Portless domain mapping.
// Tech Stack: Vite / React 19

const DEFAULT_TIMEOUT_MS = 30000;
const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF_MIME = 'application/pdf';

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;
export type ApiHeaders = Record<string, string>;
export type ApiResponse<T> = {
  data: T;
  status: number;
  headers: ApiHeaders;
};

export type ApiRequestOptions = {
  path: string;
  method?: string;
  params?: QueryParams;
  body?: unknown;
  data?: unknown;
  headers?: ApiHeaders;
  timeout?: number;
  responseType?: 'json' | 'blob';
  expectedBlobTypes?: string[];
};

/**
 * Resolve the API base URL using the following priority order:
 * 1. window.__APP_CONFIG__.apiBaseUrl  — injected at runtime by the desktop launcher (Tauri)
 * 2. import.meta.env.VITE_API_BASE_URL — build-time environment variable
 * 3. Empty string                      — same-origin; Vite dev proxy forwards /api/* to FastAPI
 */
function getApiBaseUrl(): string {
  const desktopUrl =
    typeof window !== 'undefined' &&
    window.__APP_CONFIG__ &&
    typeof window.__APP_CONFIG__.apiBaseUrl === 'string'
      ? window.__APP_CONFIG__.apiBaseUrl
      : '';

  if (desktopUrl) {
    return desktopUrl.replace(/\/$/, '');
  }

  const envUrl =
    typeof import.meta !== 'undefined' && import.meta && import.meta.env
      ? import.meta.env.VITE_API_BASE_URL
      : '';

  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }

  // Empty string: requests use same-origin paths (/api/...)
  // The Vite dev server proxy forwards these to the configured backend target.
  return '';
}

export const API_BASE_URL = getApiBaseUrl();

export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;
  readonly headers: ApiHeaders;
  readonly url: string;
  readonly response: { data: unknown; status: number; headers: ApiHeaders };

  constructor(
    message: string,
    { status = 0, data = null, headers = {}, url = '' }: {
      status?: number;
      data?: unknown;
      headers?: ApiHeaders;
      url?: string;
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.headers = headers;
    this.url = url;
    this.response = { data, status, headers };
  }
}

export const AUTH_UNAUTHORIZED_EVENT = 'astryx:auth-unauthorized';

function buildUrl(path: string, params: QueryParams = {}): URL {
  const base = API_BASE_URL;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  let url: URL;
  if (/^https?:\/\//i.test(base)) {
    // Absolute base URL (standalone deployment or desktop runtime)
    const baseUrl = new URL(base.endsWith('/') ? base : `${base}/`);
    url = new URL(
      normalizedPath.startsWith('/') ? normalizedPath.slice(1) : normalizedPath,
      baseUrl
    );
  } else {
    // Relative base (empty string for Vite proxy, or relative path)
    url = new URL(normalizedPath, window.location.origin);
  }

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry !== undefined && entry !== null && entry !== '') {
          url.searchParams.append(key, String(entry));
        }
      });
      return;
    }

    url.searchParams.set(key, String(value));
  });

  return url;
}

export function buildApiUrl(path: string, params: QueryParams = {}): string {
  return buildUrl(path, params).toString();
}

function headersToObject(headers: Headers): ApiHeaders {
  return Object.fromEntries(headers.entries());
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

async function parseErrorResponse(response: Response, responseType: 'json' | 'blob'): Promise<unknown> {
  if (responseType === 'blob') {
    const blob = await response.blob();
    const text = await blob.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (_error) {
      return { detail: text };
    }
  }

  return parseJsonResponse(response);
}

function getErrorMessage(status: number, data: unknown): string {
  if (data && typeof data === 'object') {
    const payload = data as Record<string, unknown>;
    if (typeof payload.detail === 'string') {
      return payload.detail;
    }

    if (typeof payload.message === 'string') {
      return payload.message;
    }
  }

  return status >= 500 ? 'Terjadi gangguan pada server.' : 'Permintaan tidak dapat diproses.';
}

function validateBlobResponse(blob: Blob, headers: ApiHeaders, expectedBlobTypes: string[]): Blob {
  if (!(blob instanceof Blob)) {
    throw new ApiError('Respons file tidak valid.');
  }

  const contentType = headers['content-type'] || blob.type || '';
  if (expectedBlobTypes.length > 0) {
    const matchesExpectedType = expectedBlobTypes.some((expectedType) =>
      contentType.includes(expectedType)
    );
    if (!matchesExpectedType) {
      throw new ApiError('Format file dari server tidak sesuai.', {
        headers,
        data: { detail: contentType },
      });
    }
  }

  return blob;
}

export function apiRequest(options: ApiRequestOptions & { responseType: 'blob' }): Promise<ApiResponse<Blob>>;
export function apiRequest<T = unknown>(options: ApiRequestOptions): Promise<ApiResponse<T>>;
export async function apiRequest({
  path,
  method = 'GET',
  params,
  body,
  headers = {},
  timeout = DEFAULT_TIMEOUT_MS,
  responseType = 'json',
  expectedBlobTypes = [],
}: ApiRequestOptions): Promise<ApiResponse<unknown>> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeout);
  const requestHeaders = new Headers({
    Accept: responseType === 'blob' ? `${EXCEL_MIME}, ${PDF_MIME}` : 'application/json',
    ...headers,
  });

  const init: RequestInit = {
    method,
    headers: requestHeaders,
    credentials: 'include',
    signal: controller.signal,
  };

  if (body !== undefined) {
    if (body instanceof FormData || body instanceof Blob) {
      init.body = body;
    } else if (typeof body === 'string') {
      if (!requestHeaders.has('Content-Type')) {
        requestHeaders.set('Content-Type', 'text/plain;charset=UTF-8');
      }
      init.body = body;
    } else {
      requestHeaders.set('Content-Type', 'application/json');
      init.body = JSON.stringify(body);
    }
  }

  const url = buildUrl(path, params);

  try {
    const response = await fetch(url, init);
    const responseHeaders = headersToObject(response.headers);

    if (!response.ok) {
      const errorData = await parseErrorResponse(response, responseType);
      if (response.status === 401) {
        window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
      }
      throw new ApiError(getErrorMessage(response.status, errorData), {
        status: response.status,
        data: errorData,
        headers: responseHeaders,
        url: url.toString(),
      });
    }

    if (responseType === 'blob') {
      const blob = await response.blob();
      return {
        data: validateBlobResponse(blob, responseHeaders, expectedBlobTypes),
        status: response.status,
        headers: responseHeaders,
      };
    }

    return {
      data: await parseJsonResponse(response),
      status: response.status,
      headers: responseHeaders,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('Permintaan melebihi batas waktu.', { url: url.toString() });
    }

    const message = error instanceof Error ? error.message : '';
    throw new ApiError(message || 'Terjadi kesalahan jaringan.', { url: url.toString() });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function createDownloadUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export function revokeDownloadUrl(url: string): void {
  URL.revokeObjectURL(url);
}

export const API_BLOB_TYPES = {
  excel: [EXCEL_MIME, 'application/octet-stream'],
  pdf: [PDF_MIME, 'application/octet-stream'],
};
