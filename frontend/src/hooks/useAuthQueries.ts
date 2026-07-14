import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, login, logout, type AuthUser } from "../api/auth";
import { queryKeys } from "../lib/query/queryKeys";

export function useCurrentUser() {
  return useQuery({ queryKey: queryKeys.auth.me, queryFn: getCurrentUser });
}

export function useLoginMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) => login(username, password),
    onSuccess: (user: AuthUser) => client.setQueryData(queryKeys.auth.me, user),
  });
}

export function useLogoutMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: async () => {
      await client.cancelQueries({ queryKey: queryKeys.auth.all });
      client.setQueryData(queryKeys.auth.me, null);
      await client.invalidateQueries({ queryKey: queryKeys.auth.all, refetchType: "none" });
    },
  });
}
