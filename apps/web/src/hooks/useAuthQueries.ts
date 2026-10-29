import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, login, logout, type AuthUser } from "../api/auth";
import { cancelCurrentUserQuery, cancelProtectedQueries, clearProtectedQueries, clearSessionQueries } from "../lib/query/sessionCache";
import { queryKeys } from "../lib/query/queryKeys";
import { queryFreshness } from "../lib/query/queryConfig";

export function useCurrentUser() {
  return useQuery({ queryKey: queryKeys.auth.me, queryFn: ({ signal }) => getCurrentUser(signal), staleTime: queryFreshness.auth });
}

export function useLoginMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) => login(username, password),
    onSuccess: async (user: AuthUser) => {
      await cancelCurrentUserQuery(client);
      await clearProtectedQueries(client);
      client.setQueryData(queryKeys.auth.me, user);
    },
  });
}

export function useLogoutMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onMutate: () => cancelProtectedQueries(client),
    onSuccess: async () => {
      await clearSessionQueries(client);
    },
  });
}
