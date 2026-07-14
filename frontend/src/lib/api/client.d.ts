export const API_BASE_URL: string;
export const AUTH_UNAUTHORIZED_EVENT: string;

export class ApiError extends Error {
  status: number;
  data: unknown;
  headers: Record<string, string>;
  url: string;
  response: {
    data: unknown;
    status: number;
    headers: Record<string, string>;
  };
}

export interface ApiRequestOptions {
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  params?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  responseType?: "json" | "blob";
  expectedBlobTypes?: string[];
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

export function apiRequest<T = unknown>(options: ApiRequestOptions): Promise<ApiResponse<T>>;
export function buildApiUrl(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>
): string;
export function createDownloadUrl(blob: Blob): string;
export function revokeDownloadUrl(url: string): void;
export const API_BLOB_TYPES: {
  excel: string[];
  pdf: string[];
};
