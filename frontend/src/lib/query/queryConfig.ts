import type { QueryClientConfig } from "@tanstack/react-query";
import { shouldRetryQuery } from "../api/errors";

export const APP_STALE_TIME = 5 * 60 * 1000;
export const APP_GC_TIME = 30 * 60 * 1000;

export const shouldRetry = shouldRetryQuery;

export const appQueryConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: APP_STALE_TIME,
      gcTime: APP_GC_TIME,
      refetchOnWindowFocus: false,
      retry: shouldRetry,
    },
    mutations: { retry: false },
  },
};

export const testQueryConfig: QueryClientConfig = {
  defaultOptions: {
    queries: { staleTime: 0, gcTime: Infinity, retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
};
