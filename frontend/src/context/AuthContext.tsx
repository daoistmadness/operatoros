import React, { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import type { AuthUser } from "../api/auth";
import { AUTH_UNAUTHORIZED_EVENT } from "../lib/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser, useLoginMutation, useLogoutMutation } from "../hooks/useAuthQueries";
import { queryKeys } from "../lib/query/queryKeys";

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  authenticated: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const currentUser = useCurrentUser();
  const loginMutation = useLoginMutation();
  const logoutMutation = useLogoutMutation();
  const user = currentUser.data ?? null;
  const loading = currentUser.isLoading && !currentUser.isError;

  useEffect(() => {
    const handleUnauthorized = () => {
      void client.cancelQueries({ queryKey: queryKeys.auth.all });
      client.setQueryData(queryKeys.auth.me, null);
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [client]);

  const login = useCallback(async (username: string, password: string) => {
    return loginMutation.mutateAsync({ username, password });
  }, [loginMutation]);

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, authenticated: user !== null, login, logout }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
