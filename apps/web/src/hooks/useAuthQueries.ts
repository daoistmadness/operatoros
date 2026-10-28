import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, login, logout, type AuthUser } from "../api/auth";
import { cancelProtectedQueries, clearProtectedQueries, clearSessionQueries } from "../lib/query/sessionCache";
import { queryKeys } from "../lib/query/queryKeys";

export function useCurrentUser() {
  return useQuery({ queryKey: queryKeys.auth.me, queryFn: getCurrentUser });
}

export function useLoginMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) => login(username, password),
    onSuccess: async (user: AuthUser) => {
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
