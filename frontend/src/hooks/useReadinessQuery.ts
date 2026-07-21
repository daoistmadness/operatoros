import { useQuery } from "@tanstack/react-query";
import { getReadiness } from "../api/readiness";
import { queryKeys } from "../lib/query/queryKeys";

export function useReadinessQuery(userId: number | null) {
  return useQuery({
    queryKey: queryKeys.readiness.status(userId),
    queryFn: getReadiness,
    enabled: userId !== null,
    staleTime: 0,
    refetchOnMount: "always",
  });
}
