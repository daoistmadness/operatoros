export function getPageApiError(error, fallback) {
  const status = Number(error?.status || error?.response?.status || 0);
  const detail = error?.response?.data?.detail;

  if (status === 401) return "Your session has expired. Sign in again and retry.";
  if (status === 403) return "Your account does not have permission to perform this action.";
  if (status === 404 || status === 405) return "The requested server route is unavailable. Check the API routing configuration.";
  if (status >= 500) return "The server could not complete the request. Retry or check the backend logs.";
  if (typeof detail === "string" && detail.trim()) return detail;
  return fallback;
}
