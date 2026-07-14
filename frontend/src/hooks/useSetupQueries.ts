import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSetupStatus, provisionFirstAdmin } from "../api/setup";
import { queryKeys } from "../lib/query/queryKeys";

export const useSetupStatusQuery = () => useQuery({
  queryKey: queryKeys.setup.status,
  queryFn: getSetupStatus,
  staleTime: 0,
});

export function useProvisionFirstAdminMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: provisionFirstAdmin,
    onSuccess: async () => {
      await client.cancelQueries({ queryKey: queryKeys.auth.all });
      client.setQueryData(queryKeys.auth.me, null);
      await client.invalidateQueries({ queryKey: queryKeys.setup.all });
    },
  });
}
