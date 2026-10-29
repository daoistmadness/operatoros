import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getServerStatus } from "../lib/api/endpoints";
import { queryKeys } from "../lib/query/queryKeys";
import { queryFreshness } from "../lib/query/queryConfig";

const BASE_POLL_INTERVAL_MS = 10_000;
const MAX_POLL_INTERVAL_MS = 60_000;

export function serverStatusPollInterval(failures: number): number {
  return Math.min(MAX_POLL_INTERVAL_MS, BASE_POLL_INTERVAL_MS * 2 ** Math.min(Math.max(failures, 0), 3));
}

export function useServerStatusQuery() {
  const consecutiveFailures = useRef(0);

  return useQuery({
    queryKey: queryKeys.system.health,
    queryFn: async ({ signal }) => {
      try {
        const status = await getServerStatus(signal);
        consecutiveFailures.current = 0;
        return status;
      } catch (error) {
        if (!signal.aborted) consecutiveFailures.current += 1;
        throw error;
      }
    },
    staleTime: queryFreshness.operational,
    refetchInterval: () => serverStatusPollInterval(consecutiveFailures.current),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
  });
}
