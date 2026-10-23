import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { AuthUser } from "../api/auth";
import { getCurrentUser } from "../api/auth";
import { advanceAuthSessionEpoch, AUTH_FORBIDDEN_EVENT, AUTH_UNAUTHORIZED_EVENT } from "../lib/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser, useLoginMutation, useLogoutMutation } from "../hooks/useAuthQueries";
import { createAuthSessionSync } from "../lib/auth/sessionSync";
import { clearProtectedQueries, clearSessionQueries, resetProtectedQueries } from "../lib/query/sessionCache";
import { queryKeys } from "../lib/query/queryKeys";

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  authenticated: boolean;
  can: (capability: string) => boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

function authorizationChanged(previousUser: AuthUser | null, nextUser: AuthUser | null) {
  return previousUser?.role !== nextUser?.role
    || previousUser?.capabilities?.length !== nextUser?.capabilities?.length
    || previousUser?.capabilities?.some((capability) => !nextUser?.capabilities?.includes(capability));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const sessionSync = useMemo(() => createAuthSessionSync(), []);
  const currentUser = useCurrentUser();
  const loginMutation = useLoginMutation();
  const logoutMutation = useLogoutMutation();
  const revalidationSequence = useRef(0);
  const user = currentUser.data ?? null;
  const loading = currentUser.isLoading && !currentUser.isError;

  const revalidateSession = useCallback(async (sessionEpochAdvanced = false) => {
    const sequence = revalidationSequence.current + 1;
    revalidationSequence.current = sequence;
    await client.cancelQueries({ queryKey: queryKeys.auth.me });
    try {
      const nextUser = await getCurrentUser();
      if (sequence !== revalidationSequence.current) return;
      const previousUser = client.getQueryData<AuthUser | null>(queryKeys.auth.me) ?? null;
      const identityChanged = (previousUser?.id ?? null) !== (nextUser?.id ?? null);
      const permissionsChanged = authorizationChanged(previousUser, nextUser);
      if (identityChanged || permissionsChanged) {
        if (identityChanged && !sessionEpochAdvanced) advanceAuthSessionEpoch();
        await clearProtectedQueries(client);
        if (sequence !== revalidationSequence.current) return;
        if (!identityChanged && permissionsChanged) sessionSync.notifyAuthorizationChange();
      }
      client.setQueryData(queryKeys.auth.me, nextUser);
    } catch {
      // A 401 response dispatches AUTH_UNAUTHORIZED_EVENT. Network failures keep the current session.
    }
  }, [client, sessionSync]);

  useEffect(() => {
    const handleUnauthorized = () => {
      void clearSessionQueries(client);
    };
    const handleForbidden = () => {
      void (async () => {
        await clearProtectedQueries(client);
        await revalidateSession();
      })();
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    window.addEventListener(AUTH_FORBIDDEN_EVENT, handleForbidden);
    return () => {
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
      window.removeEventListener(AUTH_FORBIDDEN_EVENT, handleForbidden);
    };
  }, [client, revalidateSession]);

  const revalidateAfterFocus = useCallback(async () => {
    const reset = resetProtectedQueries(client);
    await revalidateSession();
    await reset;
  }, [client, revalidateSession]);

  useEffect(() => {
    const handleSessionChange = (change: "session" | "authorization") => {
      if (change === "authorization") {
        void (async () => {
          await clearProtectedQueries(client);
          await revalidateSession();
        })();
        return;
      }
      void (async () => {
        advanceAuthSessionEpoch();
        revalidationSequence.current += 1;
        await clearSessionQueries(client);
        await revalidateSession(true);
      })();
    };
    return sessionSync.subscribe(handleSessionChange);
  }, [client, revalidateSession, sessionSync]);

  useEffect(() => {
    const handleFocus = () => {
      void revalidateAfterFocus();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void revalidateAfterFocus();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [revalidateAfterFocus]);

  const login = useCallback(async (username: string, password: string) => {
    const nextUser = await loginMutation.mutateAsync({ username, password });
    sessionSync.notify();
    return nextUser;
  }, [loginMutation, sessionSync]);

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
    sessionSync.notify();
  }, [logoutMutation, sessionSync]);

  const can = useCallback(
    (capability: string) => Boolean(user?.capabilities?.includes(capability)),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, authenticated: user !== null, can, login, logout }),
    [user, loading, can, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
