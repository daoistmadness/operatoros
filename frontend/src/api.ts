import {
  API_BASE_URL,
  apiRequest,
  type ApiHeaders,
  type ApiResponse,
  type QueryParams,
} from './lib/api/client';

type JsonCompatibilityConfig = {
  params?: QueryParams;
  headers?: ApiHeaders;
  timeout?: number;
  responseType?: 'json';
  data?: unknown;
};

type BlobCompatibilityConfig = Omit<JsonCompatibilityConfig, 'responseType'> & {
  responseType: 'blob';
};

type CompatibilityConfig = JsonCompatibilityConfig | BlobCompatibilityConfig;

function requestCompatibility<T>(
  path: string,
  method: string,
  body: unknown,
  config: CompatibilityConfig,
): Promise<ApiResponse<T> | ApiResponse<Blob>> {
  const common = {
    path,
    method,
    params: config.params,
    headers: config.headers,
    timeout: config.timeout,
  };
  if (config.responseType === 'blob') {
    return apiRequest({ ...common, body, responseType: 'blob' });
  }
  return apiRequest<T>({ ...common, body, responseType: 'json' });
}

function get<T = unknown>(path: string, config?: JsonCompatibilityConfig): Promise<ApiResponse<T>>;
function get(path: string, config: BlobCompatibilityConfig): Promise<ApiResponse<Blob>>;
function get<T = unknown>(
  path: string,
  config: CompatibilityConfig = {},
): Promise<ApiResponse<T> | ApiResponse<Blob>> {
  return requestCompatibility<T>(path, 'GET', undefined, config);
}

function post<T = unknown>(path: string, data?: unknown, config?: JsonCompatibilityConfig): Promise<ApiResponse<T>>;
function post(path: string, data: unknown, config: BlobCompatibilityConfig): Promise<ApiResponse<Blob>>;
function post<T = unknown>(
  path: string,
  data?: unknown,
  config: CompatibilityConfig = {},
): Promise<ApiResponse<T> | ApiResponse<Blob>> {
  return requestCompatibility<T>(path, 'POST', data, config);
}

function put<T = unknown>(path: string, data?: unknown, config?: JsonCompatibilityConfig): Promise<ApiResponse<T>>;
function put(path: string, data: unknown, config: BlobCompatibilityConfig): Promise<ApiResponse<Blob>>;
function put<T = unknown>(
  path: string,
  data?: unknown,
  config: CompatibilityConfig = {},
): Promise<ApiResponse<T> | ApiResponse<Blob>> {
  return requestCompatibility<T>(path, 'PUT', data, config);
}

function patch<T = unknown>(path: string, data?: unknown, config?: JsonCompatibilityConfig): Promise<ApiResponse<T>>;
function patch(path: string, data: unknown, config: BlobCompatibilityConfig): Promise<ApiResponse<Blob>>;
function patch<T = unknown>(
  path: string,
  data?: unknown,
  config: CompatibilityConfig = {},
): Promise<ApiResponse<T> | ApiResponse<Blob>> {
  return requestCompatibility<T>(path, 'PATCH', data, config);
}

function remove<T = unknown>(path: string, config?: JsonCompatibilityConfig): Promise<ApiResponse<T>>;
function remove(path: string, config: BlobCompatibilityConfig): Promise<ApiResponse<Blob>>;
function remove<T = unknown>(
  path: string,
  config: CompatibilityConfig = {},
): Promise<ApiResponse<T> | ApiResponse<Blob>> {
  return requestCompatibility<T>(path, 'DELETE', config.data, config);
}

const api = {
  defaults: {
    baseURL: API_BASE_URL,
  },
  get,
  post,
  put,
  patch,
  delete: remove,
};

export default api;
