import { stripLeadingApiPrefix } from './routing';

const DEFAULT_TIMEOUT_MS = 30000;
const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function resolveApiBaseUrl() {
  const configuredUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  if (
    typeof window !== 'undefined' &&
    window.location.hostname === 'school-attendance.localhost' &&
    configuredUrl === 'http://localhost:8000'
  ) {
    return `${window.location.protocol}//api.school-attendance.localhost:${window.location.port}`;
  }

  return configuredUrl;
}

export const API_BASE_URL = resolveApiBaseUrl();

export class ApiError extends Error {
  constructor(message, { status = 0, data = null, headers = {}, url = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.headers = headers;
    this.url = url;
    this.response = { data, status, headers };
  }
}

function getAuthToken() {
  const keys = ['access_token', 'token', 'authToken'];
  for (const key of keys) {
    const value = window.localStorage.getItem(key);
    if (value) {
      return value;
    }
  }
  return '';
}

function buildUrl(path, params = {}) {
  const normalizedBase = API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const baseUrl = /^https?:\/\//i.test(normalizedBase)
    ? new URL(normalizedBase)
    : new URL(normalizedBase, window.location.origin);
  const requestPath = /^https?:\/\//i.test(normalizedBase)
    ? normalizedPath
    : stripLeadingApiPrefix(normalizedPath);
  const url = new URL(requestPath.startsWith('/') ? requestPath.slice(1) : requestPath, baseUrl);

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

export function buildApiUrl(path, params = {}) {
  return buildUrl(path, params).toString();
}

function headersToObject(headers) {
  return Object.fromEntries(headers.entries());
}

async function parseJsonResponse(response) {
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

async function parseErrorResponse(response, responseType) {
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

function getErrorMessage(status, data) {
  if (data && typeof data === 'object') {
    if (typeof data.detail === 'string') {
      return data.detail;
    }

    if (typeof data.message === 'string') {
      return data.message;
    }
  }

  return status >= 500 ? 'Terjadi gangguan pada server.' : 'Permintaan tidak dapat diproses.';
}

function validateBlobResponse(blob, headers, expectedBlobTypes) {
  if (!(blob instanceof Blob)) {
    throw new ApiError('Respons file tidak valid.');
  }

  const contentType = headers['content-type'] || blob.type || '';
  if (expectedBlobTypes.length > 0) {
    const matchesExpectedType = expectedBlobTypes.some((expectedType) => contentType.includes(expectedType));
    if (!matchesExpectedType) {
      throw new ApiError('Format file dari server tidak sesuai.', { headers, data: { detail: contentType } });
    }
  }

  return blob;
}

export async function apiRequest({
  path,
  method = 'GET',
  params,
  body,
  headers = {},
  timeout = DEFAULT_TIMEOUT_MS,
  responseType = 'json',
  expectedBlobTypes = [],
}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeout);
  const token = getAuthToken();

  const requestHeaders = new Headers({
    Accept: responseType === 'blob' ? EXCEL_MIME : 'application/json',
    ...headers,
  });

  if (token && !requestHeaders.has('Authorization')) {
    requestHeaders.set('Authorization', `Bearer ${token}`);
  }

  const init = {
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

    if (error.name === 'AbortError') {
      throw new ApiError('Permintaan melebihi batas waktu.', { url: url.toString() });
    }

    throw new ApiError(error.message || 'Terjadi kesalahan jaringan.', { url: url.toString() });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function createDownloadUrl(blob) {
  return URL.createObjectURL(blob);
}

export function revokeDownloadUrl(url) {
  URL.revokeObjectURL(url);
}

export const API_BLOB_TYPES = {
  excel: [EXCEL_MIME, 'application/octet-stream'],
};
